/**
 * Game Brain walk-forward backtest, factor lab, and weight tuner (internal
 * tooling — nothing here ships to the website).
 *
 * v2 — multi-season research loop:
 * - Seasons are split into burn-in → train → validation → final holdout.
 * - Baseline is a margin-of-victory Elo (538-style MOV multiplier).
 * - Every game gets pregame-only features built incrementally (leak-proof by
 *   construction): form, rest, schedule density, rolling scoring margin,
 *   home/road splits, Pythagorean expectation, MLB starter form from probable
 *   pitchers, MLB IL counts from transactions, stadium weather from the
 *   Open-Meteo archive, NFL division rivalry + bye flags.
 * - `--experiment`: greedy forward selection over candidate factors. Each
 *   candidate is tuned walk-forward across the train seasons only, then
 *   measured with FROZEN weights on the validation season; it is kept only if
 *   validation log-loss genuinely improves. The final holdout is never touched
 *   during selection. Ledger lands in docs/backtests/experiments.md.
 * - Default (final) mode: the kept-factor config tunes across train +
 *   validation, freezes, and reports on the untouched holdout; charts land in
 *   docs/backtests/{sport}-backtest.html/.json.
 * - Loss taxonomy on every wrong pick (coin-flip / signal-missed / rating-gap
 *   / fluke); flukes — confident pick, all signals agreed, decided by a
 *   whisker — are logged but excluded from tuning, per product direction.
 *
 * Usage:
 *   node --experimental-strip-types scripts/brain-backtest.mjs [mlb|nfl|all] [--experiment] [--frozen] [--refresh]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyLogitDelta,
  combineFactors,
  computeTeamForm,
  DEFAULT_BRAIN_WEIGHTS,
  factorTerms,
  injuryBurden,
  pythagoreanExpectation,
  weatherSeverity
} from "../lib/server/brain/brainScoring.ts";
import { NFL_DIVISIONS, NFL_STADIUMS } from "../lib/server/brain/nflStadiums.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(here, ".brain-backtest-cache");
const OUT_DIR = path.join(here, "..", "..", "docs", "backtests");
const REFRESH = process.argv.includes("--refresh");
const EXPERIMENT = process.argv.includes("--experiment");
const FROZEN = process.argv.includes("--frozen"); // evaluate current production weights with tuning disabled
const SPORT_ARG = process.argv.find((arg) => ["mlb", "nfl", "all"].includes(arg)) ?? "all";
const TODAY = "2026-08-24";

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

async function cachedJson(key, url, delayMs = 0) {
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (!REFRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  const payload = await response.json();
  fs.writeFileSync(file, JSON.stringify(payload));
  return payload;
}

// ---------------------------------------------------------------------------
// Raw data
// ---------------------------------------------------------------------------

async function mlbSeasonGames(season, endDate) {
  const payload = await cachedJson(
    `mlb-sched2-${season}`,
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R&hydrate=probablePitcher&startDate=${season}-03-01&endDate=${endDate ?? `${season}-11-10`}`
  );
  const games = [];
  for (const day of payload.dates ?? []) {
    for (const game of day.games ?? []) {
      if (game.status?.abstractGameState !== "Final") continue;
      const home = game.teams?.home;
      const away = game.teams?.away;
      if (!home?.team?.id || !away?.team?.id || typeof home.score !== "number" || typeof away.score !== "number") continue;
      if (home.score === away.score) continue;
      games.push({
        sport: "mlb",
        season,
        date: game.officialDate,
        timeUtc: game.gameDate,
        homeId: home.team.id,
        awayId: away.team.id,
        homeName: home.team.name,
        awayName: away.team.name,
        homeScore: home.score,
        awayScore: away.score,
        homeWon: home.score > away.score,
        margin: Math.abs(home.score - away.score),
        venueId: game.venue?.id ?? null,
        homeStarterId: home.probablePitcher?.id ?? null,
        awayStarterId: away.probablePitcher?.id ?? null
      });
    }
  }
  return games.toSorted((a, b) => a.timeUtc.localeCompare(b.timeUtc));
}

async function mlbVenueInfo() {
  const payload = await cachedJson("mlb-venues", "https://statsapi.mlb.com/api/v1/venues?hydrate=location,fieldInfo");
  const venues = new Map();
  for (const venue of payload.venues ?? []) {
    venues.set(venue.id, {
      lat: venue.location?.defaultCoordinates?.latitude ?? null,
      lon: venue.location?.defaultCoordinates?.longitude ?? null,
      open: venue.fieldInfo?.roofType === "Open"
    });
  }
  return venues;
}

async function mlbIlTimeline(seasons) {
  const placements = [];
  const activations = [];
  for (const season of seasons) {
    for (let month = 2; month <= 10; month += 1) {
      const start = `${season}-${String(month + 1).padStart(2, "0")}-01`;
      const end = month === 10 ? `${season}-11-15` : `${season}-${String(month + 2).padStart(2, "0")}-01`;
      let payload;
      try {
        payload = await cachedJson(`mlb-tx-${season}-${month}`, `https://statsapi.mlb.com/api/v1/transactions?startDate=${start}&endDate=${end}`);
      } catch {
        continue;
      }
      for (const tx of payload.transactions ?? []) {
        const description = tx.description ?? "";
        const teamId = tx.toTeam?.id;
        const personId = tx.person?.id;
        const date = tx.effectiveDate ?? tx.date;
        if (!teamId || teamId > 160 || !personId || !date || !/injured list/i.test(description)) continue;
        if (/placed/i.test(description)) placements.push({ personId, teamId, date, pitcher: /\b[LR]HP\b/.test(description) });
        else if (/activated|reinstated|returned/i.test(description)) activations.push({ personId, date });
      }
    }
  }
  activations.sort((a, b) => a.date.localeCompare(b.date));
  return placements.map((placement) => ({
    ...placement,
    end: activations.find((item) => item.personId === placement.personId && item.date > placement.date)?.date ?? "9999-12-31"
  }));
}

async function nflSeasonGames(seasonYear) {
  const events = new Map();
  for (const calendarYear of [seasonYear, seasonYear + 1]) {
    const payload = await cachedJson(
      `nfl-sched-${calendarYear}`,
      `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${calendarYear}&limit=1000`
    );
    for (const event of payload.events ?? []) {
      if (event.season?.year !== seasonYear || event.season?.type !== 2) continue;
      if (!(event.status?.type?.completed || event.status?.type?.state === "post")) continue;
      const competition = event.competitions?.[0];
      const home = competition?.competitors?.find((team) => team.homeAway === "home");
      const away = competition?.competitors?.find((team) => team.homeAway === "away");
      if (!home?.id || !away?.id) continue;
      const homeScore = Number(home.score);
      const awayScore = Number(away.score);
      if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore === awayScore) continue;
      events.set(event.id, {
        sport: "nfl",
        season: seasonYear,
        date: event.date.slice(0, 10),
        timeUtc: event.date,
        week: event.week?.number ?? 0,
        homeId: home.id,
        awayId: away.id,
        homeName: home.team?.displayName ?? home.id,
        awayName: away.team?.displayName ?? away.id,
        homeAbbr: (home.team?.abbreviation ?? "").toUpperCase(),
        awayAbbr: (away.team?.abbreviation ?? "").toUpperCase(),
        homeScore,
        awayScore,
        homeWon: homeScore > awayScore,
        margin: Math.abs(homeScore - awayScore)
      });
    }
  }
  return [...events.values()].toSorted((a, b) => a.timeUtc.localeCompare(b.timeUtc));
}

async function archiveWeather(key, lat, lon, start, end) {
  const query = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), start_date: start, end_date: end,
    hourly: "temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,snowfall",
    temperature_unit: "fahrenheit", wind_speed_unit: "mph", timezone: "UTC"
  });
  const payload = await cachedJson(key, `https://archive-api.open-meteo.com/v1/archive?${query}`, 200);
  const index = new Map();
  (payload.hourly?.time ?? []).forEach((hour, i) => index.set(hour, i));
  return { index, hourly: payload.hourly ?? {} };
}

function weatherAt(archive, timeUtc) {
  if (!archive) return null;
  const i = archive.index.get(`${timeUtc.slice(0, 13)}:00`);
  if (i === undefined) return null;
  const value = (name) => {
    const v = archive.hourly[name]?.[i];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  return {
    tempF: value("temperature_2m"),
    windMph: value("wind_speed_10m"),
    gustMph: value("wind_gusts_10m"),
    precipProbability: value("precipitation") >= 1 ? 0.9 : 0,
    snowfall: value("snowfall") > 0
  };
}

// ---------------------------------------------------------------------------
// Feature assembly — one chronological pass, pregame state only
// ---------------------------------------------------------------------------

function teamState() {
  return { results: [], margins: [], dates: [], homeW: 0, homeG: 0, roadW: 0, roadG: 0, scored: 0, allowed: 0, games: 0 };
}

function buildFeatures(games, options) {
  const { sport, ilIntervals, weatherFor, marginWindow, pythagExponent, minSplitGames, minPythagGames } = options;
  const teams = new Map();
  const stateOf = (id) => teams.get(id) ?? teams.set(id, teamState()).get(id);
  const starters = new Map();
  const starterAvg = (id) => {
    const runs = starters.get(id);
    return runs && runs.length >= 3 ? runs.reduce((sum, value) => sum + value, 0) / runs.length : null;
  };
  let lastSeason = games[0]?.season;

  for (const game of games) {
    if (game.season !== lastSeason) {
      for (const state of teams.values()) {
        Object.assign(state, { homeW: 0, homeG: 0, roadW: 0, roadG: 0, scored: 0, allowed: 0, games: 0 });
      }
      lastSeason = game.season;
    }
    const home = stateOf(game.homeId);
    const away = stateOf(game.awayId);

    game.homeForm = computeTeamForm(home.results, game.date);
    game.awayForm = computeTeamForm(away.results, game.date);

    const recentMargin = (state) => {
      const window = state.margins.slice(-marginWindow);
      return window.length >= Math.min(3, marginWindow) ? window.reduce((sum, value) => sum + value, 0) / window.length : 0;
    };
    game.scoringFormGap = Number((recentMargin(home) - recentMargin(away)).toFixed(3));

    const splitRate = (wins, count) => (count >= minSplitGames ? wins / count : 0.5);
    game.homeSplitGap = Number((splitRate(home.homeW, home.homeG) - splitRate(away.roadW, away.roadG)).toFixed(3));

    const pythag = (state) =>
      state.games >= minPythagGames ? pythagoreanExpectation(state.scored, state.allowed, pythagExponent) : 0.5;
    game.pythagGap = Number((pythag(home) - pythag(away)).toFixed(4));

    const inWindow = (state) => state.dates.filter((d) => d < game.date && daysBetween(d, game.date) <= 6).length;
    game.densityGap = inWindow(away) - inWindow(home);

    if (sport === "mlb") {
      game.homeBurden = ilIntervals ? injuryBurden(ilEntries(ilIntervals, game.homeId, game.date), "mlb") : 0;
      game.awayBurden = ilIntervals ? injuryBurden(ilEntries(ilIntervals, game.awayId, game.date), "mlb") : 0;
      const homeStarter = game.homeStarterId ? starterAvg(game.homeStarterId) : null;
      const awayStarter = game.awayStarterId ? starterAvg(game.awayStarterId) : null;
      game.pitcherFormGap = homeStarter !== null && awayStarter !== null ? Number((awayStarter - homeStarter).toFixed(3)) : undefined;
    } else {
      game.homeBurden = 0;
      game.awayBurden = 0;
      game.divisionGame = NFL_DIVISIONS[game.homeAbbr] !== undefined && NFL_DIVISIONS[game.homeAbbr] === NFL_DIVISIONS[game.awayAbbr];
      game.homeOffBye = (game.homeForm.restDays ?? 0) >= 10 && game.homeForm.lastTenGames > 0;
      game.awayOffBye = (game.awayForm.restDays ?? 0) >= 10 && game.awayForm.lastTenGames > 0;
    }
    const snapshot = weatherFor ? weatherFor(game) : null;
    game.weatherSeverity = snapshot ? weatherSeverity(snapshot) : 0;

    // --- update state (post-game; next games see it) ---
    home.results.push({ date: game.date, won: game.homeWon });
    away.results.push({ date: game.date, won: !game.homeWon });
    home.margins.push(game.homeScore - game.awayScore);
    away.margins.push(game.awayScore - game.homeScore);
    home.dates.push(game.date);
    away.dates.push(game.date);
    home.homeG += 1;
    home.homeW += game.homeWon ? 1 : 0;
    away.roadG += 1;
    away.roadW += game.homeWon ? 0 : 1;
    home.scored += game.homeScore;
    home.allowed += game.awayScore;
    away.scored += game.awayScore;
    away.allowed += game.homeScore;
    home.games += 1;
    away.games += 1;
    if (sport === "mlb") {
      if (game.homeStarterId) starters.set(game.homeStarterId, [...(starters.get(game.homeStarterId) ?? []), game.awayScore].slice(-8));
      if (game.awayStarterId) starters.set(game.awayStarterId, [...(starters.get(game.awayStarterId) ?? []), game.homeScore].slice(-8));
    }
  }
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000);
}

function ilEntries(intervals, teamId, date) {
  return intervals
    .filter((interval) => interval.teamId === teamId && interval.date <= date && date < interval.end)
    .map((interval) => ({ position: interval.pitcher ? "P" : "OF", status: "il_short" }));
}

// ---------------------------------------------------------------------------
// MOV Elo baseline
// ---------------------------------------------------------------------------

function makeElo(k, homeAdvantage) {
  const ratings = new Map();
  const get = (id) => ratings.get(id) ?? 1500;
  return {
    probability(homeId, awayId) {
      return 1 / (1 + 10 ** (-(get(homeId) + homeAdvantage - get(awayId)) / 400));
    },
    update(game) {
      const expected = this.probability(game.homeId, game.awayId);
      const winnerEloDiff = game.homeWon ? get(game.homeId) + homeAdvantage - get(game.awayId) : get(game.awayId) - get(game.homeId) - homeAdvantage;
      const movMultiplier = Math.log(game.margin + 1) * (2.2 / (winnerEloDiff * 0.001 + 2.2));
      const delta = k * movMultiplier * ((game.homeWon ? 1 : 0) - expected);
      ratings.set(game.homeId, get(game.homeId) + delta);
      ratings.set(game.awayId, get(game.awayId) - delta);
    },
    regress(keep = 2 / 3) {
      for (const [id, rating] of ratings) ratings.set(id, 1500 + (rating - 1500) * keep);
    }
  };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const logLoss = (probability, won) => -Math.log(Math.max(1e-9, won ? probability : 1 - probability));

function gameInputs(sport, game, baselineLogit) {
  return {
    sport,
    burdenGap: (game.awayBurden ?? 0) - (game.homeBurden ?? 0),
    homeQbOut: false,
    awayQbOut: false,
    homeForm: game.homeForm,
    awayForm: game.awayForm,
    weatherSeverity: game.weatherSeverity ?? 0,
    scoringFormGap: game.scoringFormGap,
    homeSplitGap: game.homeSplitGap,
    pythagGap: game.pythagGap,
    densityGap: game.densityGap,
    pitcherFormGap: game.pitcherFormGap,
    divisionGame: game.divisionGame,
    baselineLogit,
    homeOffBye: game.homeOffBye,
    awayOffBye: game.awayOffBye
  };
}

function brainProbability(sport, game, baseProbability, weights) {
  const baselineLogit = Math.log(baseProbability / (1 - baseProbability));
  const terms = factorTerms(gameInputs(sport, game, baselineLogit), weights).map((term) => ({ label: term.kind, detail: "", homeLogit: term.homeLogit }));
  const { logitDelta } = combineFactors(terms);
  return { probability: applyLogitDelta(baseProbability, logitDelta), terms };
}

function diagnoseLoss(pickProbability, pickedHome, terms, margin, closeMargin) {
  const against = terms.filter((term) => (pickedHome ? term.homeLogit < 0 : term.homeLogit > 0));
  if (pickProbability >= 0.65 && against.length === 0 && margin <= closeMargin) return { cause: "fluke", against: [] };
  if (pickProbability < 0.575) return { cause: "coin-flip", against: against.map((term) => term.label) };
  if (against.length > 0) return { cause: "signal-missed", against: against.map((term) => term.label) };
  return { cause: "rating-gap", against: [] };
}

function tuneStep(sport, weights, tunable, window, step) {
  const evaluate = (candidate) => {
    let total = 0;
    for (const game of window) {
      const { probability } = brainProbability(sport, game, game.baseProbability, candidate);
      total += logLoss(probability, game.homeWon);
    }
    return total / window.length;
  };
  let next = structuredClone(weights);
  for (const key of Object.keys(tunable)) {
    const { min, max, delta } = tunable[key];
    let best = next[sport][key];
    let bestLoss = evaluate(next);
    for (const candidate of [next[sport][key] - delta * step, next[sport][key] + delta * step]) {
      const clamped = Math.min(max, Math.max(min, candidate));
      const trial = { ...next, [sport]: { ...next[sport], [key]: clamped } };
      const loss = evaluate(trial);
      if (loss < bestLoss - 1e-6) {
        best = clamped;
        bestLoss = loss;
      }
    }
    next = { ...next, [sport]: { ...next[sport], [key]: Number(best.toFixed(4)) } };
  }
  return next;
}

/**
 * batches: [{label, phase: burnin|train|validation|holdout, games}]
 * Tuning runs only in phases named by tuneIn; burn-in feeds Elo only.
 */
function simulate({ sport, batches, initialWeights, tunable, tuneIn, closeMargin, trailingWindow, elo }) {
  let weights = structuredClone(initialWeights);
  const record = [];
  const batchSummaries = [];
  const weightTrail = [];
  const tuningGames = [];

  for (const batch of batches) {
    if (batch.phase === "burnin") {
      for (const game of batch.games) elo.update(game);
      continue;
    }
    let baseWins = 0;
    let brainWins = 0;
    const causes = { fluke: 0, "coin-flip": 0, "signal-missed": 0, "rating-gap": 0 };
    const missedBy = {};
    for (const game of batch.games) {
      const baseProbability = elo.probability(game.homeId, game.awayId);
      game.baseProbability = baseProbability;
      const { probability, terms } = brainProbability(sport, game, baseProbability, weights);
      const pickedHome = probability >= 0.5;
      const brainCorrect = pickedHome === game.homeWon;
      const baseCorrect = baseProbability >= 0.5 === game.homeWon;
      baseWins += baseCorrect ? 1 : 0;
      brainWins += brainCorrect ? 1 : 0;
      let loss = null;
      if (!brainCorrect) {
        loss = diagnoseLoss(pickedHome ? probability : 1 - probability, pickedHome, terms, game.margin, closeMargin);
        causes[loss.cause] += 1;
        for (const label of loss.against) missedBy[label] = (missedBy[label] ?? 0) + 1;
      }
      record.push({
        date: game.date,
        matchup: `${game.awayName} @ ${game.homeName}`,
        phase: batch.phase,
        baseProbability: Number(baseProbability.toFixed(4)),
        brainProbability: Number(probability.toFixed(4)),
        baseCorrect,
        brainCorrect,
        baseLogLoss: logLoss(baseProbability, game.homeWon),
        brainLogLoss: logLoss(probability, game.homeWon),
        cause: loss?.cause ?? null,
        fluke: loss?.cause === "fluke"
      });
      if (loss?.cause !== "fluke") tuningGames.push(game);
      elo.update(game);
    }
    batchSummaries.push({
      label: batch.label, phase: batch.phase, games: batch.games.length, baseWins, brainWins,
      causes: { ...causes }, missedBy, weights: { ...weights[sport] }
    });
    if (tuneIn.has(batch.phase)) {
      const windowGames = tuningGames.slice(-trailingWindow);
      if (windowGames.length >= 40) {
        const step = Math.max(0.35, 0.97 ** batchSummaries.length);
        weights = tuneStep(sport, weights, tunable, windowGames, step);
      }
    }
    weightTrail.push({ label: batch.label, ...weights[sport] });
  }
  return { sport, record, batchSummaries, weightTrail, finalWeights: weights };
}

function phaseStats(record, phase) {
  const rows = record.filter((row) => row.phase === phase);
  if (!rows.length) return null;
  const wins = (key) => rows.filter((row) => row[key]).length;
  const mean = (key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  return {
    games: rows.length,
    baseAccuracy: wins("baseCorrect") / rows.length,
    brainAccuracy: wins("brainCorrect") / rows.length,
    baseWins: wins("baseCorrect"),
    brainWins: wins("brainCorrect"),
    baseLogLoss: mean("baseLogLoss"),
    brainLogLoss: mean("brainLogLoss")
  };
}

// ---------------------------------------------------------------------------
// Sport setups
// ---------------------------------------------------------------------------

const TUNABLE_BOUNDS = {
  mlb: {
    injuryGap: { min: 0, max: 0.6, delta: 0.03 },
    formWinRate: { min: 0, max: 0.35, delta: 0.03 },
    restDay: { min: 0, max: 0.06, delta: 0.006 },
    weatherHome: { min: 0, max: 0.15, delta: 0.012 },
    scoringForm: { min: 0, max: 0.25, delta: 0.02 },
    homeSplit: { min: 0, max: 0.6, delta: 0.05 },
    pythag: { min: 0, max: 1.2, delta: 0.1 },
    density: { min: 0, max: 0.06, delta: 0.008 },
    pitcherForm: { min: 0, max: 0.12, delta: 0.012 }
  },
  nfl: {
    formWinRate: { min: 0, max: 0.35, delta: 0.03 },
    restDay: { min: 0, max: 0.06, delta: 0.006 },
    weatherHome: { min: 0, max: 0.15, delta: 0.012 },
    scoringForm: { min: 0, max: 0.06, delta: 0.006 },
    homeSplit: { min: 0, max: 0.6, delta: 0.05 },
    pythag: { min: 0, max: 1.2, delta: 0.1 },
    divisionDamp: { min: 0, max: 0.3, delta: 0.03 },
    bye: { min: 0, max: 0.3, delta: 0.03 }
  }
};

const BASE_TUNABLES = {
  mlb: ["injuryGap", "formWinRate", "restDay", "weatherHome"],
  nfl: ["formWinRate", "restDay", "weatherHome"]
};

const CANDIDATES = {
  mlb: ["pitcherForm", "scoringForm", "homeSplit", "pythag", "density"],
  nfl: ["scoringForm", "homeSplit", "pythag", "divisionDamp", "bye"]
};

function batchesFor(sport, games, phaseOf) {
  const buckets = new Map();
  for (const game of games) {
    const label =
      sport === "mlb"
        ? `${game.date.slice(0, 8)}${String(Math.floor((Number(game.date.slice(8, 10)) - 1) / 10) * 10 + 1).padStart(2, "0")}`
        : `${game.season}-wk${String(game.week).padStart(2, "0")}`;
    if (!buckets.get(label)) buckets.set(label, { label, phase: phaseOf(game), games: [] });
    buckets.get(label).games.push(game);
  }
  return [...buckets.values()].toSorted((a, b) => a.label.localeCompare(b.label));
}

async function loadMlb() {
  const seasons = [2021, 2022, 2023, 2024, 2025, 2026];
  const bySeason = new Map();
  for (const season of seasons) bySeason.set(season, await mlbSeasonGames(season, season === 2026 ? TODAY : undefined));
  const [venues, intervals] = await Promise.all([mlbVenueInfo(), mlbIlTimeline([2022, 2023, 2024, 2025, 2026])]);
  const evalGames = [2022, 2023, 2024, 2025, 2026].flatMap((season) => bySeason.get(season));
  const outdoorIds = [...new Set(evalGames.map((game) => game.venueId).filter(Boolean))].filter((id) => venues.get(id)?.open && venues.get(id)?.lat);
  const archives = new Map();
  for (const venueId of outdoorIds) {
    const venue = venues.get(venueId);
    for (const season of [2022, 2023, 2024, 2025, 2026]) {
      try {
        archives.set(`${venueId}-${season}`, await archiveWeather(`wx-mlb-${venueId}-${season}`, venue.lat, venue.lon, `${season}-03-01`, season === 2026 ? TODAY : `${season}-11-10`));
      } catch { /* factor absent */ }
    }
  }
  console.log(`[mlb] seasons ${seasons.join("/")}: ${seasons.map((s) => bySeason.get(s).length).join("/")} games; IL intervals ${intervals.length}; weather for ${outdoorIds.length} parks`);
  const all = seasons.flatMap((season) => bySeason.get(season));
  buildFeatures(all, {
    sport: "mlb",
    ilIntervals: intervals,
    weatherFor: (game) => weatherAt(archives.get(`${game.venueId}-${game.season}`), game.timeUtc),
    marginWindow: 15,
    pythagExponent: 1.83,
    minSplitGames: 8,
    minPythagGames: 20
  });
  return all;
}

async function loadNfl() {
  const seasons = [2021, 2022, 2023, 2024, 2025];
  const bySeason = new Map();
  for (const season of seasons) bySeason.set(season, await nflSeasonGames(season));
  const archives = new Map();
  for (const abbr of Object.keys(NFL_STADIUMS)) {
    const stadium = NFL_STADIUMS[abbr];
    if (stadium.indoor) continue;
    for (const season of [2022, 2023, 2024, 2025]) {
      try {
        archives.set(`${abbr}-${season}`, await archiveWeather(`wx-nfl-${abbr}-${season}`, stadium.lat, stadium.lon, `${season}-09-01`, `${season + 1}-01-15`));
      } catch { /* factor absent */ }
    }
  }
  console.log(`[nfl] seasons ${seasons.join("/")}: ${seasons.map((s) => bySeason.get(s).length).join("/")} games; weather archives ${archives.size}`);
  const all = seasons.flatMap((season) => bySeason.get(season));
  buildFeatures(all, {
    sport: "nfl",
    ilIntervals: null,
    weatherFor: (game) => weatherAt(archives.get(`${game.homeAbbr}-${game.season}`), game.timeUtc),
    marginWindow: 5,
    pythagExponent: 2.37,
    minSplitGames: 3,
    minPythagGames: 5
  });
  return all;
}

const PHASES = {
  mlb: (game) => (game.season === 2021 ? "burnin" : game.season <= 2024 ? "train" : game.season === 2025 ? "validation" : "holdout"),
  nfl: (game) => (game.season === 2021 ? "burnin" : game.season <= 2023 ? "train" : game.season === 2024 ? "validation" : "holdout")
};

function weightsWith(sport, activeKeys) {
  const weights = structuredClone(DEFAULT_BRAIN_WEIGHTS);
  for (const key of Object.keys(weights[sport])) {
    if (key === "qbOut" || (key === "injuryGap" && sport === "nfl")) continue; // NFL priors stay
    if (!activeKeys.includes(key)) weights[sport][key] = 0;
  }
  return weights;
}

function runConfig(sport, games, activeKeys, tuneIn) {
  const tunable = Object.fromEntries(activeKeys.filter((key) => TUNABLE_BOUNDS[sport][key]).map((key) => [key, TUNABLE_BOUNDS[sport][key]]));
  return simulate({
    sport,
    batches: batchesFor(sport, games, PHASES[sport]),
    initialWeights: weightsWith(sport, activeKeys),
    tunable,
    tuneIn,
    closeMargin: sport === "mlb" ? 1 : 3,
    trailingWindow: sport === "mlb" ? 400 : 96,
    elo: sport === "mlb" ? makeElo(4, 24) : makeElo(20, 48)
  });
}

// ---------------------------------------------------------------------------
// Experiment mode: greedy forward selection on validation log-loss
// ---------------------------------------------------------------------------

function experiment(sport, games) {
  const ledger = [];
  let kept = [...BASE_TUNABLES[sport]];
  const evaluateConfig = (keys) => {
    const result = runConfig(sport, games, keys, new Set(["train"]));
    return { result, validation: phaseStats(result.record, "validation") };
  };
  let best = evaluateConfig(kept);
  ledger.push({ config: "base (form/rest/weather" + (sport === "mlb" ? "/injury" : "") + ")", keys: [...kept], ...summaryRow(best.validation) });
  console.log(`[${sport}] base validation: ${fmt(best.validation)}`);

  let remaining = [...CANDIDATES[sport]];
  let improved = true;
  while (improved && remaining.length) {
    improved = false;
    let winner = null;
    for (const candidate of remaining) {
      const trial = evaluateConfig([...kept, candidate]);
      const delta = best.validation.brainLogLoss - trial.validation.brainLogLoss;
      ledger.push({ config: `+ ${candidate}`, keys: [...kept, candidate], ...summaryRow(trial.validation), deltaVsBest: Number(delta.toFixed(5)) });
      console.log(`[${sport}] + ${candidate}: ${fmt(trial.validation)} (Δlogloss ${delta >= 0 ? "+" : ""}${delta.toFixed(5)})`);
      if (delta > 0.0003 && (!winner || trial.validation.brainLogLoss < winner.trial.validation.brainLogLoss)) winner = { candidate, trial };
    }
    if (winner) {
      kept.push(winner.candidate);
      remaining = remaining.filter((key) => key !== winner.candidate);
      best = winner.trial;
      improved = true;
      console.log(`[${sport}] KEEP ${winner.candidate} -> ${kept.join(", ")}`);
      ledger.push({ config: `KEPT ${winner.candidate}`, keys: [...kept], ...summaryRow(best.validation) });
    }
  }
  return { kept, ledger, bestValidation: best.validation };
}

const fmt = (stats) => `acc ${(stats.brainAccuracy * 100).toFixed(1)}% (base ${(stats.baseAccuracy * 100).toFixed(1)}%), logloss ${stats.brainLogLoss.toFixed(5)} (base ${stats.baseLogLoss.toFixed(5)})`;
const summaryRow = (stats) => ({
  games: stats.games,
  brainAcc: Number((stats.brainAccuracy * 100).toFixed(2)),
  baseAcc: Number((stats.baseAccuracy * 100).toFixed(2)),
  brainLogLoss: Number(stats.brainLogLoss.toFixed(5)),
  baseLogLoss: Number(stats.baseLogLoss.toFixed(5))
});

// ---------------------------------------------------------------------------
// Report (self-contained HTML + inline SVG)
// ---------------------------------------------------------------------------

function polyline(points, color, width = 2) {
  return `<polyline fill="none" stroke="${color}" stroke-width="${width}" points="${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"/>`;
}

function accuracyChart(record, title) {
  const width = 900, height = 260, pad = 42;
  let baseWins = 0, brainWins = 0;
  const basePoints = [], brainPoints = [];
  record.forEach((row, index) => {
    baseWins += row.baseCorrect ? 1 : 0;
    brainWins += row.brainCorrect ? 1 : 0;
    const x = pad + ((width - 2 * pad) * index) / Math.max(1, record.length - 1);
    const yFor = (wins) => height - pad - (height - 2 * pad) * ((wins / (index + 1) - 0.4) / 0.3);
    basePoints.push([x, Math.min(height - pad, Math.max(pad, yFor(baseWins)))]);
    brainPoints.push([x, Math.min(height - pad, Math.max(pad, yFor(brainWins)))]);
  });
  const gridLines = [0.45, 0.5, 0.55, 0.6, 0.65].map((level) => {
    const y = height - pad - (height - 2 * pad) * ((level - 0.4) / 0.3);
    return `<line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="#26262b"/><text x="8" y="${y + 4}" fill="#7a7a85" font-size="11">${Math.round(level * 100)}%</text>`;
  }).join("");
  const marks = ["validation", "holdout"].map((phase) => {
    const start = record.findIndex((row) => row.phase === phase);
    if (start <= 0) return "";
    const x = pad + ((width - 2 * pad) * start) / (record.length - 1);
    return `<line x1="${x}" y1="${pad}" x2="${x}" y2="${height - pad}" stroke="#d9a441" stroke-dasharray="5,4"/><text x="${x + 6}" y="${pad + 12}" fill="#d9a441" font-size="11">${phase}</text>`;
  }).join("");
  return `<h2>${title}</h2><svg viewBox="0 0 ${width} ${height}" role="img">${gridLines}${marks}${polyline(basePoints, "#6b7280")}${polyline(brainPoints, "#22d3ee")}<text x="${pad}" y="18" fill="#6b7280" font-size="12">— baseline (MOV Elo)</text><text x="${pad + 160}" y="18" fill="#22d3ee" font-size="12">— brain-adjusted</text></svg>`;
}

function batchBars(batchSummaries, title) {
  const width = 900, height = 230, pad = 42;
  const shown = batchSummaries.filter((batch) => batch.phase !== "burnin");
  const barSpace = (width - 2 * pad) / shown.length;
  const bars = shown.map((batch, index) => {
    const x = pad + index * barSpace;
    const winShare = batch.games ? batch.brainWins / batch.games : 0;
    const barHeight = (height - 2 * pad) * winShare;
    const color = batch.phase === "holdout" ? "#d9a441" : batch.phase === "validation" ? "#a78bfa" : winShare >= 0.5 ? "#34d399" : "#f87171";
    return `<rect x="${x + 0.5}" y="${height - pad - barHeight}" width="${Math.max(1.2, barSpace - 1.5)}" height="${barHeight}" fill="${color}" opacity="0.85"><title>${batch.label} [${batch.phase}]: ${batch.brainWins}-${batch.games - batch.brainWins} (baseline ${batch.baseWins}-${batch.games - batch.baseWins})</title></rect>`;
  }).join("");
  const half = height - pad - (height - 2 * pad) * 0.5;
  return `<h2>${title}</h2><svg viewBox="0 0 ${width} ${height}" role="img"><line x1="${pad}" y1="${half}" x2="${width - pad}" y2="${half}" stroke="#3f3f46" stroke-dasharray="4,4"/><text x="8" y="${half + 4}" fill="#7a7a85" font-size="11">50%</text>${bars}</svg><p class="hint">One bar per batch; height = brain win share (hover for W-L). Green/red = train, purple = validation, amber = untouched holdout.</p>`;
}

function weightChart(weightTrail, keys, title) {
  const width = 900, height = 220, pad = 42;
  const palette = ["#a78bfa", "#22d3ee", "#34d399", "#f59e0b", "#f87171", "#60a5fa", "#facc15", "#4ade80", "#fb923c"];
  const maxValue = Math.max(0.2, ...weightTrail.flatMap((row) => keys.map((key) => row[key] ?? 0)));
  const lines = keys.map((key, keyIndex) => {
    const points = weightTrail.map((row, index) => [
      pad + ((width - 2 * pad) * index) / Math.max(1, weightTrail.length - 1),
      height - pad - (height - 2 * pad) * ((row[key] ?? 0) / maxValue)
    ]);
    return polyline(points, palette[keyIndex % palette.length]);
  }).join("");
  const legend = keys.map((key, index) => `<text x="${pad + (index % 5) * 165}" y="${18 + Math.floor(index / 5) * 15}" fill="${palette[index % palette.length]}" font-size="12">— ${key}</text>`).join("");
  return `<h2>${title}</h2><svg viewBox="0 0 ${width} ${height}" role="img">${lines}${legend}</svg>`;
}

function report(result, meta) {
  const rows = result.record;
  const train = phaseStats(rows, "train");
  const validation = phaseStats(rows, "validation");
  const holdout = phaseStats(rows, "holdout");
  const causes = { fluke: 0, "coin-flip": 0, "signal-missed": 0, "rating-gap": 0 };
  const missedBy = {};
  for (const batch of result.batchSummaries) {
    for (const [cause, count] of Object.entries(batch.causes)) causes[cause] += count;
    for (const [label, count] of Object.entries(batch.missedBy)) missedBy[label] = (missedBy[label] ?? 0) + count;
  }
  const pct = (value) => `${(value * 100).toFixed(1)}%`;
  const phasePanel = (name, stats, extra = "") =>
    stats
      ? `<div class="panel"><h3>${name}</h3><p>Brain <b class="k">${stats.brainWins}-${stats.games - stats.brainWins}</b> (${pct(stats.brainAccuracy)}) · baseline ${stats.baseWins}-${stats.games - stats.baseWins} (${pct(stats.baseAccuracy)}) · log-loss ${stats.brainLogLoss.toFixed(4)} vs ${stats.baseLogLoss.toFixed(4)} · ${stats.games} games${extra}</p></div>`
      : "";
  const missedRows = Object.entries(missedBy).toSorted((a, b) => b[1] - a[1]).map(([label, count]) => `<tr><td>${label}</td><td>${count}</td></tr>`).join("");
  return `<!-- INTERNAL: generated by frontend/scripts/brain-backtest.mjs. Not linked from the site. -->
<title>${meta.title}</title>
<style>
  body { background:#0b0b0e; color:#e5e5ea; font-family: ui-sans-serif, system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.05rem; margin-top: 2rem; color:#c7c7d1; } h3 { font-size: .95rem; }
  svg { width: 100%; height: auto; background:#111114; border:1px solid #1f1f24; border-radius: 12px; }
  .panel { border:1px solid #2a2a31; border-radius: 12px; padding: .75rem 1rem; margin-top: 1rem; background:#121216; }
  table { border-collapse: collapse; margin-top:.5rem; } td { border:1px solid #26262b; padding:.3rem .6rem; font-size:.85rem; }
  .hint { color:#8a8a94; font-size:.8rem; } .k { color:#22d3ee; }
</style>
<h1>${meta.title}</h1>
<p class="hint">Internal walk-forward simulation — ${meta.subtitle}. Generated ${TODAY}; regenerate with <code>npm run backtest</code>.</p>
${phasePanel("Train (walk-forward tuning active)", train)}
${phasePanel("Validation (used for factor selection)", validation)}
${phasePanel("Final holdout — untouched until the end", holdout, " — <b>the number that counts</b>")}
${accuracyChart(rows, "Cumulative accuracy — baseline vs brain")}
${batchBars(result.batchSummaries, "Win share by batch (brain picks)")}
${weightChart(result.weightTrail, meta.weightKeys, "Weight evolution (walk-forward tuning)")}
<div class="panel"><h3>Loss taxonomy (brain losses, all phases)</h3>
<table><tr><td>Coin-flip losses (&lt;57.5% picks)</td><td>${causes["coin-flip"]}</td></tr>
<tr><td>Signal-missed (a factor pointed the other way)</td><td>${causes["signal-missed"]}</td></tr>
<tr><td>Rating-gap (baseline simply wrong)</td><td>${causes["rating-gap"]}</td></tr>
<tr><td>Fluke / miracle (excluded from tuning)</td><td>${causes.fluke}</td></tr></table>
<h3>Which signal pointed at the winner in losses</h3>
<table><tr><td>factor</td><td>count</td></tr>${missedRows || "<tr><td colspan=2>none</td></tr>"}</table>
<p class="hint">Fluke = pick ≥65%, every signal agreed, decided by ≤${meta.closeMargin}.</p></div>
<div class="panel"><h3>Active factors & final weights</h3><p>${meta.keptNote}</p><pre>${JSON.stringify(result.finalWeights[result.sport], null, 2)}</pre></div>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const sports = SPORT_ARG === "all" ? ["mlb", "nfl"] : [SPORT_ARG];
const experimentsLog = [];

for (const sport of sports) {
  const games = sport === "mlb" ? await loadMlb() : await loadNfl();

  let kept;
  if (EXPERIMENT) {
    const outcome = experiment(sport, games);
    kept = outcome.kept;
    experimentsLog.push({ sport, ledger: outcome.ledger, kept });
  } else {
    kept = [...BASE_TUNABLES[sport], ...CANDIDATES[sport].filter((key) => DEFAULT_BRAIN_WEIGHTS[sport][key] > 0)];
  }

  console.log(`[${sport}] ${FROZEN ? "frozen evaluation of production weights" : "final run"} with factors: ${kept.join(", ")}`);
  const finalResult = runConfig(sport, games, kept, FROZEN ? new Set() : new Set(["train", "validation"]));
  const holdout = phaseStats(finalResult.record, "holdout");
  const validation = phaseStats(finalResult.record, "validation");
  console.log(`[${sport}] validation ${fmt(validation)}`);
  console.log(`[${sport}] HOLDOUT ${fmt(holdout)}`);
  console.log(`[${sport}] final weights:`, JSON.stringify(finalResult.finalWeights[sport]));

  const meta = {
    title: `${sport.toUpperCase()} — Game Brain backtest`,
    subtitle:
      sport === "mlb"
        ? "2021 burn-in · train 2022–2024 · validation 2025 (factor selection) · untouched holdout 2026-to-date"
        : "2021 burn-in · train 2022–2023 · validation 2024 (factor selection) · untouched holdout 2025",
    weightKeys: kept,
    closeMargin: sport === "mlb" ? "1 run" : "3 points",
    keptNote: `Factors active in this run: ${kept.join(", ")}. Selection method: greedy forward selection on validation log-loss (see experiments.md).`
  };
  fs.writeFileSync(path.join(OUT_DIR, `${sport}-backtest.html`), report(finalResult, meta));
  fs.writeFileSync(
    path.join(OUT_DIR, `${sport}-backtest.json`),
    JSON.stringify({ generated: TODAY, kept, finalWeights: finalResult.finalWeights[sport], validation, holdout, batches: finalResult.batchSummaries }, null, 1)
  );
}

if (EXPERIMENT && experimentsLog.length) {
  const lines = ["# Game Brain factor experiments", "", `Generated ${TODAY} by \`npm run backtest -- all --experiment\`. Selection: greedy forward on validation log-loss (candidates tuned walk-forward on train only, measured frozen on validation; final holdout untouched).`, ""];
  for (const entry of experimentsLog) {
    lines.push(`## ${entry.sport.toUpperCase()} — kept: ${entry.kept.join(", ")}`, "");
    lines.push("| config | val games | brain acc % | base acc % | brain logloss | base logloss | Δ vs best |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const row of entry.ledger) {
      lines.push(`| ${row.config} | ${row.games} | ${row.brainAcc} | ${row.baseAcc} | ${row.brainLogLoss} | ${row.baseLogLoss} | ${row.deltaVsBest ?? ""} |`);
    }
    lines.push("");
  }
  fs.writeFileSync(path.join(OUT_DIR, "experiments.md"), lines.join("\n"));
  console.log("experiment ledger written to docs/backtests/experiments.md");
}
console.log("done.");
