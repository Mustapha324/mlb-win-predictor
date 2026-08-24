/**
 * Game Brain walk-forward backtest + weight tuner (internal tooling — nothing
 * here ships to the website).
 *
 * Replays past seasons chronologically. For every game it computes a baseline
 * Elo probability, layers the brain's factor adjustment (shared math from
 * brainScoring.ts) with the CURRENT weight vector, records the pick as a win
 * or loss, diagnoses every loss, and after each batch takes a bounded
 * coordinate-descent step on trailing log-loss — training strictly on the
 * past, in the walk-forward style. "Miracle" losses (high-confidence picks
 * where every signal agreed and the game was decided by a whisker) are logged
 * but EXCLUDED from tuning, per product direction.
 *
 * Outputs per sport: docs/backtests/{sport}-backtest.html (self-contained
 * chart page) and {sport}-backtest.json (raw record).
 *
 * Usage: node --experimental-strip-types scripts/brain-backtest.mjs [mlb|nfl|all] [--refresh]
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
  weatherSeverity
} from "../lib/server/brain/brainScoring.ts";
import { NFL_STADIUMS } from "../lib/server/brain/nflStadiums.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(here, ".brain-backtest-cache");
const OUT_DIR = path.join(here, "..", "..", "docs", "backtests");
const REFRESH = process.argv.includes("--refresh");
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
// Data: MLB
// ---------------------------------------------------------------------------

async function mlbSeasonGames(season, endDate) {
  const payload = await cachedJson(
    `mlb-sched-${season}`,
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R&startDate=${season}-03-01&endDate=${endDate ?? `${season}-11-10`}`
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
        date: game.officialDate,
        timeUtc: game.gameDate,
        homeId: home.team.id,
        awayId: away.team.id,
        homeName: home.team.name,
        awayName: away.team.name,
        homeWon: home.score > away.score,
        margin: Math.abs(home.score - away.score),
        venueId: game.venue?.id ?? null
      });
    }
  }
  return games.toSorted((a, b) => a.date.localeCompare(b.date) || a.timeUtc.localeCompare(b.timeUtc));
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

/** IL intervals per player from transaction descriptions -> per-team daily IL counts. */
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
  const intervals = [];
  for (const placement of placements) {
    const activation = activations.find((item) => item.personId === placement.personId && item.date > placement.date);
    intervals.push({ ...placement, end: activation?.date ?? "9999-12-31" });
  }
  return intervals;
}

function mlbIlEntriesOn(intervals, teamId, date) {
  return intervals
    .filter((interval) => interval.teamId === teamId && interval.date <= date && date < interval.end)
    .map((interval) => ({ position: interval.pitcher ? "P" : "OF", status: "il_short" }));
}

// ---------------------------------------------------------------------------
// Data: NFL
// ---------------------------------------------------------------------------

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
        date: event.date.slice(0, 10),
        timeUtc: event.date,
        week: event.week?.number ?? 0,
        homeId: home.id,
        awayId: away.id,
        homeName: home.team?.displayName ?? home.id,
        awayName: away.team?.displayName ?? away.id,
        homeAbbr: (home.team?.abbreviation ?? "").toUpperCase(),
        homeWon: homeScore > awayScore,
        margin: Math.abs(homeScore - awayScore)
      });
    }
  }
  return [...events.values()].toSorted((a, b) => a.timeUtc.localeCompare(b.timeUtc));
}

// ---------------------------------------------------------------------------
// Weather (Open-Meteo archive; one call per venue-season)
// ---------------------------------------------------------------------------

async function archiveWeather(key, lat, lon, start, end) {
  const query = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: start,
    end_date: end,
    hourly: "temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,snowfall",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "UTC"
  });
  const payload = await cachedJson(key, `https://archive-api.open-meteo.com/v1/archive?${query}`, 200);
  const index = new Map();
  const hours = payload.hourly?.time ?? [];
  for (let i = 0; i < hours.length; i += 1) index.set(hours[i], i);
  return { index, hourly: payload.hourly ?? {} };
}

function weatherAt(archive, timeUtc) {
  if (!archive) return null;
  const key = `${timeUtc.slice(0, 13)}:00`;
  const i = archive.index.get(key);
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
// Elo baseline
// ---------------------------------------------------------------------------

function makeElo(k, homeAdvantage) {
  const ratings = new Map();
  const get = (id) => ratings.get(id) ?? 1500;
  return {
    probability(homeId, awayId) {
      return 1 / (1 + 10 ** (-(get(homeId) + homeAdvantage - get(awayId)) / 400));
    },
    update(homeId, awayId, homeWon) {
      const expected = this.probability(homeId, awayId);
      const delta = k * ((homeWon ? 1 : 0) - expected);
      ratings.set(homeId, get(homeId) + delta);
      ratings.set(awayId, get(awayId) - delta);
    },
    regress(toward = 1500, keep = 2 / 3) {
      for (const [id, rating] of ratings) ratings.set(id, toward + (rating - toward) * keep);
    }
  };
}

// ---------------------------------------------------------------------------
// Walk-forward simulation
// ---------------------------------------------------------------------------

const logLoss = (probability, won) => -Math.log(Math.max(1e-9, won ? probability : 1 - probability));

function brainProbability(baseProbability, inputs, weights) {
  const terms = factorTerms(inputs, weights).map((term) => ({ label: term.kind, detail: "", homeLogit: term.homeLogit }));
  const { logitDelta } = combineFactors(terms);
  return { probability: applyLogitDelta(baseProbability, logitDelta), terms };
}

/**
 * Diagnose a brain loss. Returns a cause tag; "fluke" losses are excluded from
 * tuning: a confident pick, every signal agreed, and the game was one swing.
 */
function diagnoseLoss(pickProbability, pickedHome, terms, margin, closeMargin) {
  const against = terms.filter((term) => (pickedHome ? term.homeLogit < 0 : term.homeLogit > 0));
  if (pickProbability >= 0.65 && against.length === 0 && margin <= closeMargin) return { cause: "fluke", against: [] };
  if (pickProbability < 0.575) return { cause: "coin-flip", against: against.map((term) => term.label) };
  if (against.length > 0) return { cause: "signal-missed", against: against.map((term) => term.label) };
  return { cause: "rating-gap", against: [] };
}

function tuneStep(sport, weights, tunable, window, step, computeInputs) {
  const evaluate = (candidate) => {
    let total = 0;
    for (const game of window) {
      const { probability } = brainProbability(game.baseProbability, computeInputs(game), candidate);
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

function simulate({ sport, games, batches, initialWeights, tunable, computeInputs, closeMargin, trailingWindow, holdoutFrom, elo, burnInGames }) {
  for (const game of burnInGames) elo.update(game.homeId, game.awayId, game.homeWon);
  elo.regress();

  let weights = structuredClone(initialWeights);
  const record = [];
  const batchSummaries = [];
  const weightTrail = [{ label: "start", ...weights[sport] }];
  const tuningGames = [];
  let frozen = false;

  for (const batch of batches) {
    if (!frozen && holdoutFrom && batch.label >= holdoutFrom) frozen = true;
    let baseWins = 0;
    let brainWins = 0;
    const causes = { fluke: 0, "coin-flip": 0, "signal-missed": 0, "rating-gap": 0 };
    const missedBy = {};
    for (const game of batch.games) {
      const baseProbability = elo.probability(game.homeId, game.awayId);
      game.baseProbability = baseProbability;
      const { probability, terms } = brainProbability(baseProbability, computeInputs(game), weights);
      const pickedHome = probability >= 0.5;
      const basePickedHome = baseProbability >= 0.5;
      const brainCorrect = pickedHome === game.homeWon;
      const baseCorrect = basePickedHome === game.homeWon;
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
        baseProbability: Number(baseProbability.toFixed(4)),
        brainProbability: Number(probability.toFixed(4)),
        baseCorrect,
        brainCorrect,
        holdout: frozen,
        cause: loss?.cause ?? null,
        fluke: loss?.cause === "fluke",
        homeWon: game.homeWon
      });
      if (loss?.cause !== "fluke") tuningGames.push(game);
      elo.update(game.homeId, game.awayId, game.homeWon);
    }
    batchSummaries.push({
      label: batch.label,
      games: batch.games.length,
      baseWins,
      brainWins,
      causes: { ...causes },
      missedBy,
      holdout: frozen,
      weights: { ...weights[sport] }
    });

    if (!frozen) {
      const windowGames = tuningGames.slice(-trailingWindow);
      if (windowGames.length >= 40) {
        const step = Math.max(0.35, 0.97 ** batchSummaries.length);
        weights = tuneStep(sport, weights, tunable, windowGames, step, computeInputs);
      }
    }
    weightTrail.push({ label: batch.label, ...weights[sport] });
  }
  return { sport, record, batchSummaries, weightTrail, finalWeights: weights };
}

// ---------------------------------------------------------------------------
// Sport runners
// ---------------------------------------------------------------------------

function batchByDays(games, days, labelPrefix = "") {
  const batches = new Map();
  for (const game of games) {
    const bucket = game.date.slice(0, 8) + String(Math.floor((Number(game.date.slice(8, 10)) - 1) / days) * days + 1).padStart(2, "0");
    const key = `${labelPrefix}${bucket}`;
    if (!batches.get(key)) batches.set(key, { label: key, games: [] });
    batches.get(key).games.push(game);
  }
  return [...batches.values()].toSorted((a, b) => a.label.localeCompare(b.label));
}

async function runMlb() {
  console.log("[mlb] loading data...");
  const [burnIn, tune2025, holdout2026, venues, intervals] = await Promise.all([
    mlbSeasonGames(2024),
    mlbSeasonGames(2025),
    mlbSeasonGames(2026, TODAY),
    mlbVenueInfo(),
    mlbIlTimeline([2025, 2026])
  ]);
  console.log(`[mlb] burn-in ${burnIn.length}, 2025 ${tune2025.length}, 2026-to-date ${holdout2026.length}, IL intervals ${intervals.length}`);

  const outdoorIds = [...new Set([...tune2025, ...holdout2026].map((game) => game.venueId).filter(Boolean))].filter((id) => venues.get(id)?.open && venues.get(id)?.lat);
  const archives = new Map();
  for (const venueId of outdoorIds) {
    const venue = venues.get(venueId);
    for (const [season, start, end] of [[2025, "2025-03-01", "2025-11-10"], [2026, "2026-03-01", TODAY]]) {
      try {
        archives.set(`${venueId}-${season}`, await archiveWeather(`wx-mlb-${venueId}-${season}`, venue.lat, venue.lon, start, end));
      } catch {
        /* missing weather -> factor absent */
      }
    }
  }
  console.log(`[mlb] weather archives for ${outdoorIds.length} outdoor parks`);

  const results = new Map();
  const resultsFor = (id) => results.get(id) ?? results.set(id, []).get(id);
  const evalGames = [...tune2025, ...holdout2026];
  for (const game of evalGames) {
    game.homeForm = computeTeamForm(resultsFor(game.homeId), game.date);
    game.awayForm = computeTeamForm(resultsFor(game.awayId), game.date);
    game.homeBurden = injuryBurden(mlbIlEntriesOn(intervals, game.homeId, game.date), "mlb");
    game.awayBurden = injuryBurden(mlbIlEntriesOn(intervals, game.awayId, game.date), "mlb");
    const season = Number(game.date.slice(0, 4));
    const snapshot = weatherAt(archives.get(`${game.venueId}-${season}`), game.timeUtc);
    game.weatherSeverity = snapshot ? weatherSeverity(snapshot) : 0;
    resultsFor(game.homeId).push({ date: game.date, won: game.homeWon });
    resultsFor(game.awayId).push({ date: game.date, won: !game.homeWon });
  }
  for (const game of burnIn) {
    /* burn-in results feed Elo only; 2025 form starts fresh in-season */
  }

  const computeInputs = (game) => ({
    sport: "mlb",
    burdenGap: game.awayBurden - game.homeBurden,
    homeQbOut: false,
    awayQbOut: false,
    homeForm: game.homeForm,
    awayForm: game.awayForm,
    weatherSeverity: game.weatherSeverity
  });

  return simulate({
    sport: "mlb",
    batches: batchByDays(evalGames, 10),
    initialWeights: DEFAULT_BRAIN_WEIGHTS,
    tunable: {
      injuryGap: { min: 0, max: 0.6, delta: 0.03 },
      formWinRate: { min: 0, max: 0.35, delta: 0.03 },
      restDay: { min: 0, max: 0.06, delta: 0.006 },
      weatherHome: { min: 0, max: 0.15, delta: 0.012 }
    },
    computeInputs,
    closeMargin: 1,
    trailingWindow: 400,
    holdoutFrom: "2026",
    elo: makeElo(4, 24),
    burnInGames: burnIn
  });
}

async function runNfl() {
  console.log("[nfl] loading data...");
  const [burnIn, season2025] = await Promise.all([nflSeasonGames(2024), nflSeasonGames(2025)]);
  console.log(`[nfl] burn-in ${burnIn.length}, 2025 regular season ${season2025.length}`);

  const archives = new Map();
  const abbrs = [...new Set(season2025.map((game) => game.homeAbbr))];
  for (const abbr of abbrs) {
    const stadium = NFL_STADIUMS[abbr];
    if (!stadium || stadium.indoor) continue;
    try {
      archives.set(abbr, await archiveWeather(`wx-nfl-${abbr}-2025`, stadium.lat, stadium.lon, "2025-09-01", "2026-01-15"));
    } catch {
      /* factor absent */
    }
  }
  console.log(`[nfl] weather archives for ${archives.size} outdoor stadiums`);

  const results = new Map();
  const resultsFor = (id) => results.get(id) ?? results.set(id, []).get(id);
  for (const game of burnIn) {
    resultsFor(game.homeId).push({ date: game.date, won: game.homeWon });
    resultsFor(game.awayId).push({ date: game.date, won: !game.homeWon });
  }
  for (const game of season2025) {
    game.homeForm = computeTeamForm(resultsFor(game.homeId), game.date);
    game.awayForm = computeTeamForm(resultsFor(game.awayId), game.date);
    const snapshot = weatherAt(archives.get(game.homeAbbr), game.timeUtc);
    game.weatherSeverity = snapshot ? weatherSeverity(snapshot) : 0;
    resultsFor(game.homeId).push({ date: game.date, won: game.homeWon });
    resultsFor(game.awayId).push({ date: game.date, won: !game.homeWon });
  }

  const computeInputs = (game) => ({
    sport: "nfl",
    burdenGap: 0, // no free historical injury reports; weight keeps its research prior
    homeQbOut: false,
    awayQbOut: false,
    homeForm: game.homeForm,
    awayForm: game.awayForm,
    weatherSeverity: game.weatherSeverity
  });

  const batches = new Map();
  for (const game of season2025) {
    const key = `wk${String(game.week).padStart(2, "0")}`;
    if (!batches.get(key)) batches.set(key, { label: key, games: [] });
    batches.get(key).games.push(game);
  }

  return simulate({
    sport: "nfl",
    batches: [...batches.values()].toSorted((a, b) => a.label.localeCompare(b.label)),
    initialWeights: DEFAULT_BRAIN_WEIGHTS,
    tunable: {
      formWinRate: { min: 0, max: 0.35, delta: 0.03 },
      restDay: { min: 0, max: 0.06, delta: 0.006 },
      weatherHome: { min: 0, max: 0.15, delta: 0.012 }
    },
    computeInputs,
    closeMargin: 3,
    trailingWindow: 96,
    holdoutFrom: "wk15",
    elo: makeElo(20, 48),
    burnInGames: burnIn
  });
}

// ---------------------------------------------------------------------------
// Report generation (self-contained HTML + inline SVG)
// ---------------------------------------------------------------------------

function polyline(points, color, width = 2) {
  return `<polyline fill="none" stroke="${color}" stroke-width="${width}" points="${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"/>`;
}

function accuracyChart(record, title) {
  const width = 900;
  const height = 260;
  const pad = 42;
  let baseWins = 0;
  let brainWins = 0;
  const basePoints = [];
  const brainPoints = [];
  record.forEach((row, index) => {
    baseWins += row.baseCorrect ? 1 : 0;
    brainWins += row.brainCorrect ? 1 : 0;
    const x = pad + ((width - 2 * pad) * index) / Math.max(1, record.length - 1);
    const yFor = (wins) => height - pad - (height - 2 * pad) * ((wins / (index + 1) - 0.4) / 0.3);
    basePoints.push([x, Math.min(height - pad, Math.max(pad, yFor(baseWins)))]);
    brainPoints.push([x, Math.min(height - pad, Math.max(pad, yFor(brainWins)))]);
  });
  const gridLines = [0.45, 0.5, 0.55, 0.6, 0.65]
    .map((level) => {
      const y = height - pad - (height - 2 * pad) * ((level - 0.4) / 0.3);
      return `<line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="#26262b" /><text x="8" y="${y + 4}" fill="#7a7a85" font-size="11">${Math.round(level * 100)}%</text>`;
    })
    .join("");
  const holdoutStart = record.findIndex((row) => row.holdout);
  const holdoutMark =
    holdoutStart > 0
      ? `<line x1="${pad + ((width - 2 * pad) * holdoutStart) / (record.length - 1)}" y1="${pad}" x2="${pad + ((width - 2 * pad) * holdoutStart) / (record.length - 1)}" y2="${height - pad}" stroke="#d9a441" stroke-dasharray="5,4"/><text x="${pad + ((width - 2 * pad) * holdoutStart) / (record.length - 1) + 6}" y="${pad + 12}" fill="#d9a441" font-size="11">weights frozen</text>`
      : "";
  return `<h2>${title}</h2><svg viewBox="0 0 ${width} ${height}" role="img">${gridLines}${holdoutMark}${polyline(basePoints, "#6b7280")}${polyline(brainPoints, "#22d3ee")}<text x="${pad}" y="18" fill="#6b7280" font-size="12">— baseline (Elo)</text><text x="${pad + 130}" y="18" fill="#22d3ee" font-size="12">— brain-adjusted</text></svg>`;
}

function batchBars(batchSummaries, title) {
  const width = 900;
  const height = 230;
  const pad = 42;
  const barSpace = (width - 2 * pad) / batchSummaries.length;
  const bars = batchSummaries
    .map((batch, index) => {
      const x = pad + index * barSpace;
      const winShare = batch.games ? batch.brainWins / batch.games : 0;
      const barHeight = (height - 2 * pad) * winShare;
      const color = batch.holdout ? "#d9a441" : winShare >= 0.5 ? "#34d399" : "#f87171";
      return `<rect x="${x + 1}" y="${height - pad - barHeight}" width="${Math.max(2, barSpace - 3)}" height="${barHeight}" fill="${color}" opacity="0.85"><title>${batch.label}: ${batch.brainWins}-${batch.games - batch.brainWins} (baseline ${batch.baseWins}-${batch.games - batch.baseWins})</title></rect>`;
    })
    .join("");
  const half = height - pad - (height - 2 * pad) * 0.5;
  return `<h2>${title}</h2><svg viewBox="0 0 ${width} ${height}" role="img"><line x1="${pad}" y1="${half}" x2="${width - pad}" y2="${half}" stroke="#3f3f46" stroke-dasharray="4,4"/><text x="8" y="${half + 4}" fill="#7a7a85" font-size="11">50%</text>${bars}</svg><p class="hint">One bar per batch — bar height is the brain's win share (hover for W-L). Amber bars are the frozen-weights holdout.</p>`;
}

function weightChart(weightTrail, keys, title) {
  const width = 900;
  const height = 220;
  const pad = 42;
  const palette = { injuryGap: "#a78bfa", formWinRate: "#22d3ee", restDay: "#34d399", weatherHome: "#f59e0b" };
  const maxValue = Math.max(0.2, ...weightTrail.flatMap((row) => keys.map((key) => row[key])));
  const lines = keys
    .map((key) => {
      const points = weightTrail.map((row, index) => [
        pad + ((width - 2 * pad) * index) / Math.max(1, weightTrail.length - 1),
        height - pad - (height - 2 * pad) * (row[key] / maxValue)
      ]);
      return polyline(points, palette[key] ?? "#ddd");
    })
    .join("");
  const legend = keys.map((key, index) => `<text x="${pad + index * 150}" y="18" fill="${palette[key] ?? "#ddd"}" font-size="12">— ${key}</text>`).join("");
  return `<h2>${title}</h2><svg viewBox="0 0 ${width} ${height}" role="img">${lines}${legend}</svg>`;
}

function summarize(result) {
  const rows = result.record;
  const tuned = rows.filter((row) => !row.holdout);
  const holdout = rows.filter((row) => row.holdout);
  const accuracy = (subset, key) => (subset.length ? subset.filter((row) => row[key]).length / subset.length : null);
  const causes = { fluke: 0, "coin-flip": 0, "signal-missed": 0, "rating-gap": 0 };
  const missedBy = {};
  for (const batch of result.batchSummaries) {
    for (const [cause, count] of Object.entries(batch.causes)) causes[cause] += count;
    for (const [label, count] of Object.entries(batch.missedBy)) missedBy[label] = (missedBy[label] ?? 0) + count;
  }
  return { rows, tuned, holdout, accuracy, causes, missedBy };
}

function report(result, meta) {
  const { rows, tuned, holdout, accuracy, causes, missedBy } = summarize(result);
  const pct = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
  const wl = (subset, key) => `${subset.filter((row) => row[key]).length}-${subset.filter((row) => !row[key]).length}`;
  const holdoutPanel = holdout.length
    ? `<div class="panel"><h3>Frozen-weights holdout (${meta.holdoutLabel})</h3><p><b>${wl(holdout, "brainCorrect")}</b> brain (${pct(accuracy(holdout, "brainCorrect"))}) vs ${wl(holdout, "baseCorrect")} baseline (${pct(accuracy(holdout, "baseCorrect"))}) over ${holdout.length} games — out-of-sample, no tuning allowed.</p></div>`
    : "";
  const missedRows = Object.entries(missedBy)
    .toSorted((a, b) => b[1] - a[1])
    .map(([label, count]) => `<tr><td>${label}</td><td>${count}</td></tr>`)
    .join("");
  return `<!-- INTERNAL: generated by frontend/scripts/brain-backtest.mjs. Not linked from the site. -->
<title>${meta.title}</title>
<style>
  body { background:#0b0b0e; color:#e5e5ea; font-family: ui-sans-serif, system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.05rem; margin-top: 2rem; color:#c7c7d1; } h3 { font-size: .95rem; }
  svg { width: 100%; height: auto; background:#111114; border:1px solid #1f1f24; border-radius: 12px; }
  .panel { border:1px solid #2a2a31; border-radius: 12px; padding: .75rem 1rem; margin-top: 1rem; background:#121216; }
  table { border-collapse: collapse; margin-top:.5rem; } td { border:1px solid #26262b; padding:.3rem .6rem; font-size:.85rem; }
  .hint { color:#8a8a94; font-size:.8rem; }
  .k { color:#22d3ee; }
</style>
<h1>${meta.title}</h1>
<p class="hint">Internal walk-forward simulation — ${meta.subtitle}. Generated ${TODAY} by brain-backtest.mjs; regenerate with <code>npm run backtest</code>.</p>
<div class="panel"><h3>Record (tuning span)</h3>
<p>Brain <b class="k">${wl(tuned, "brainCorrect")}</b> (${pct(accuracy(tuned, "brainCorrect"))}) &nbsp;·&nbsp; baseline ${wl(tuned, "baseCorrect")} (${pct(accuracy(tuned, "baseCorrect"))}) &nbsp;·&nbsp; ${rows.length} graded games total</p></div>
${holdoutPanel}
${accuracyChart(rows, "Cumulative accuracy — baseline vs brain")}
${batchBars(result.batchSummaries, "Win share by batch (brain picks)")}
${weightChart(result.weightTrail, meta.weightKeys, "Weight evolution (walk-forward tuning)")}
<div class="panel"><h3>Loss taxonomy (brain losses)</h3>
<table><tr><td>Coin-flip losses (&lt;57.5% picks)</td><td>${causes["coin-flip"]}</td></tr>
<tr><td>Signal-missed (a factor pointed the other way)</td><td>${causes["signal-missed"]}</td></tr>
<tr><td>Rating-gap (baseline simply wrong)</td><td>${causes["rating-gap"]}</td></tr>
<tr><td>Fluke / miracle (excluded from tuning)</td><td>${causes.fluke}</td></tr></table>
<h3>Which ignored signal cost us (signal-missed breakdown)</h3>
<table><tr><td>factor</td><td>losses where it pointed to the winner</td></tr>${missedRows || "<tr><td colspan=2>none</td></tr>"}</table>
<p class="hint">Fluke = pick ≥65%, every signal agreed, decided by ≤${meta.closeMargin} — logged, never tuned on.</p></div>
<div class="panel"><h3>Final weights</h3><pre>${JSON.stringify(result.finalWeights, null, 2)}</pre></div>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const runs = [];
if (SPORT_ARG === "mlb" || SPORT_ARG === "all") runs.push(["mlb", runMlb]);
if (SPORT_ARG === "nfl" || SPORT_ARG === "all") runs.push(["nfl", runNfl]);

for (const [sport, runner] of runs) {
  const result = await runner();
  const meta =
    sport === "mlb"
      ? { title: "MLB — Game Brain backtest", subtitle: "2024 Elo burn-in, walk-forward tuning across 2025, frozen-weights holdout on 2026 to date", weightKeys: ["injuryGap", "formWinRate", "restDay", "weatherHome"], closeMargin: "1 run", holdoutLabel: "2026 season to date" }
      : { title: "NFL — Game Brain backtest", subtitle: "2024 Elo burn-in, walk-forward tuning across 2025 weeks 1–14, frozen-weights holdout weeks 15–18", weightKeys: ["formWinRate", "restDay", "weatherHome"], closeMargin: "3 points", holdoutLabel: "2025 weeks 15–18" };
  fs.writeFileSync(path.join(OUT_DIR, `${sport}-backtest.html`), report(result, meta));
  fs.writeFileSync(
    path.join(OUT_DIR, `${sport}-backtest.json`),
    JSON.stringify({ generated: TODAY, finalWeights: result.finalWeights, batches: result.batchSummaries, record: result.record }, null, 1)
  );
  const { tuned, holdout, accuracy } = summarize(result);
  console.log(`[${sport}] tuned span: brain ${(accuracy(tuned, "brainCorrect") * 100).toFixed(1)}% vs base ${(accuracy(tuned, "baseCorrect") * 100).toFixed(1)}%` +
    (holdout.length ? ` | holdout: brain ${(accuracy(holdout, "brainCorrect") * 100).toFixed(1)}% vs base ${(accuracy(holdout, "baseCorrect") * 100).toFixed(1)}% (${holdout.length} games)` : ""));
  console.log(`[${sport}] final weights:`, JSON.stringify(result.finalWeights));
}
console.log("done. reports in docs/backtests/");
