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
const FACEOFF = process.argv.includes("--faceoff"); // deployed GitHub models vs the new model, head to head
const SPORT_ARG = process.argv.find((arg) => ["mlb", "nfl", "all"].includes(arg)) ?? "all";
const TODAY = "2026-08-24";
const NFL_HFA = Number((process.argv.find((arg) => arg.startsWith("--hfa=")) ?? "--hfa=28").slice(6)); // 28 Elo ~ modern-era home edge; swept on validation 2026-08-24

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
        eventId: event.id,
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
  const { sport, ilIntervals, churnEvents, starterLogs, qbByEvent, weatherFor, marginWindow, pythagExponent, minSplitGames, minPythagGames } = options;
  const teamStarter = new Map();
  const qbHistory = new Map();
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
      game.rosterChurnGap = churnEvents ? churnCount(churnEvents, game.awayId, game.date) - churnCount(churnEvents, game.homeId, game.date) : undefined;
      if (starterLogs) {
        const homeFip = starterFip(starterLogs, game.homeStarterId, game.date);
        const awayFip = starterFip(starterLogs, game.awayStarterId, game.date);
        game.starterFipGap = homeFip !== null && awayFip !== null ? Number((awayFip - homeFip).toFixed(3)) : undefined;
      }
    } else {
      game.homeBurden = 0;
      game.awayBurden = 0;
      game.divisionGame = NFL_DIVISIONS[game.homeAbbr] !== undefined && NFL_DIVISIONS[game.homeAbbr] === NFL_DIVISIONS[game.awayAbbr];
      game.homeOffBye = (game.homeForm.restDays ?? 0) >= 10 && game.homeForm.lastTenGames > 0;
      game.awayOffBye = (game.awayForm.restDays ?? 0) >= 10 && game.awayForm.lastTenGames > 0;
      game.homeShortWeek = (game.homeForm.restDays ?? 7) <= 4 && game.homeForm.lastTenGames > 0;
      game.awayShortWeek = (game.awayForm.restDays ?? 7) <= 4 && game.awayForm.lastTenGames > 0;
      const homeStadium = NFL_STADIUMS[game.homeAbbr];
      const awayStadium = NFL_STADIUMS[game.awayAbbr];
      game.travelMm = homeStadium && awayStadium ? Number((haversineKm(awayStadium, homeStadium) / 1000).toFixed(3)) : undefined;
      if (qbByEvent) {
        const qbValueOf = (qbId) => {
          const history = qbId ? qbHistory.get(qbId) ?? [] : [];
          return history.length >= 2 ? history.slice(-8).reduce((sum, value) => sum + value, 0) / Math.min(8, history.length) : null;
        };
        const homeQb = qbValueOf(teamStarter.get(game.homeId));
        const awayQb = qbValueOf(teamStarter.get(game.awayId));
        // Week 1 projections carry last season's starter across the offseason — too unreliable to trade on.
        game.qbValueGap = game.week >= 2 && homeQb !== null && awayQb !== null ? Number((homeQb - awayQb).toFixed(3)) : undefined;
      }
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
    } else if (qbByEvent) {
      const lines = qbByEvent.get(game.eventId);
      for (const teamId of [game.homeId, game.awayId]) {
        const line = lines?.[teamId];
        if (!line?.qbId) continue;
        teamStarter.set(teamId, line.qbId);
        qbHistory.set(line.qbId, [...(qbHistory.get(line.qbId) ?? []), line.value].slice(-12));
      }
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

/** Roster-disruption events (trades/claims/releases/selections/DFAs) per MLB club — the archivable "news wire". */
async function mlbChurnEvents(seasons) {
  const byTeam = new Map();
  const churnTypes = /trade|claimed|released|selected|designated/i;
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
        const teamId = tx.toTeam?.id;
        const date = tx.effectiveDate ?? tx.date;
        if (!teamId || teamId > 160 || !date || !churnTypes.test(tx.typeDesc ?? "")) continue;
        const dates = byTeam.get(teamId) ?? [];
        dates.push(date);
        byTeam.set(teamId, dates);
      }
    }
  }
  for (const dates of byTeam.values()) dates.sort();
  return byTeam;
}

function churnCount(byTeam, teamId, date) {
  const cutoff = new Date(`${date}T12:00:00Z`).getTime() - 14 * 86400000;
  return (byTeam.get(teamId) ?? []).filter((d) => d < date && new Date(`${d}T12:00:00Z`).getTime() >= cutoff).length;
}

function inningsToOuts(value) {
  const [whole = "0", fraction = "0"] = String(value ?? "0").split(".");
  return (Number(whole) || 0) * 3 + Math.min(2, Number(fraction) || 0);
}

/** Per-start K/BB/HR/IP logs for every probable starter, batched 40 ids per call. */
async function mlbStarterLogs(games) {
  const bySeason = new Map();
  for (const game of games) {
    for (const pitcherId of [game.homeStarterId, game.awayStarterId]) {
      if (!pitcherId) continue;
      const ids = bySeason.get(game.season) ?? new Set();
      ids.add(pitcherId);
      bySeason.set(game.season, ids);
    }
  }
  const logs = new Map();
  for (const [season, idSet] of bySeason) {
    const ids = [...idSet].toSorted((a, b) => a - b);
    for (let index = 0; index < ids.length; index += 40) {
      const chunk = ids.slice(index, index + 40);
      const key = `mlb-plog-${season}-${index}`;
      const file = path.join(CACHE_DIR, `${key}.json`);
      let extracted;
      if (!REFRESH && fs.existsSync(file)) {
        extracted = JSON.parse(fs.readFileSync(file, "utf8"));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const url = `https://statsapi.mlb.com/api/v1/people?personIds=${chunk.join(",")}&hydrate=stats(group=[pitching],type=[gameLog],season=${season})`;
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        if (!response.ok) continue;
        const payload = await response.json();
        extracted = {};
        for (const person of payload.people ?? []) {
          const splits = person.stats?.[0]?.splits ?? [];
          extracted[person.id] = splits
            .filter((split) => split.date && split.stat)
            .map((split) => ({
              date: split.date,
              outs: inningsToOuts(split.stat.inningsPitched),
              k: split.stat.strikeOuts ?? 0,
              bb: split.stat.baseOnBalls ?? 0,
              hr: split.stat.homeRuns ?? 0
            }));
        }
        fs.writeFileSync(file, JSON.stringify(extracted));
      }
      for (const [pitcherId, starts] of Object.entries(extracted)) {
        logs.set(Number(pitcherId), [...(logs.get(Number(pitcherId)) ?? []), ...starts]);
      }
    }
  }
  for (const starts of logs.values()) starts.sort((a, b) => a.date.localeCompare(b.date));
  return logs;
}

/** Rolling FIP-lite ((13·HR + 3·BB − 2·K) per inning) over the last 10 pregame starts; null under 3 starts / 15 IP. */
function starterFip(logs, pitcherId, date) {
  if (!pitcherId) return null;
  const prior = (logs.get(pitcherId) ?? []).filter((start) => start.date < date).slice(-10);
  const outs = prior.reduce((sum, start) => sum + start.outs, 0);
  if (prior.length < 3 || outs < 45) return null;
  const innings = outs / 3;
  const hr = prior.reduce((sum, start) => sum + start.hr, 0);
  const bb = prior.reduce((sum, start) => sum + start.bb, 0);
  const k = prior.reduce((sum, start) => sum + start.k, 0);
  return (13 * hr + 3 * bb - 2 * k) / innings;
}

/** Per-game passer lines from ESPN summaries (slim-cached): eventId -> { [espnTeamId]: {qbId, value} }. */
async function nflQbGames(games) {
  const byEvent = new Map();
  for (const game of games) {
    const key = `nfl-qb-${game.eventId}`;
    const file = path.join(CACHE_DIR, `${key}.json`);
    let extracted;
    if (!REFRESH && fs.existsSync(file)) {
      extracted = JSON.parse(fs.readFileSync(file, "utf8"));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 120));
      try {
        const response = await fetch(`https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${game.eventId}`, {
          headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; SportIQ/1.0)" }
        });
        if (!response.ok) continue;
        const payload = await response.json();
        extracted = {};
        for (const team of payload.boxscore?.players ?? []) {
          const passing = team.statistics?.find((group) => group.name === "passing");
          if (!team.team?.id || !passing?.athletes?.length) continue;
          const labels = passing.labels ?? [];
          const lines = passing.athletes
            .map((entry) => {
              const [completions, attempts] = String(entry.stats?.[labels.indexOf("C/ATT")] ?? "").split("/").map(Number);
              return {
                qbId: entry.athlete?.id,
                attempts: Number.isFinite(attempts) ? attempts : 0,
                yards: Number(entry.stats?.[labels.indexOf("YDS")]) || 0,
                tds: Number(entry.stats?.[labels.indexOf("TD")]) || 0,
                ints: Number(entry.stats?.[labels.indexOf("INT")]) || 0,
                completions: Number.isFinite(completions) ? completions : 0
              };
            })
            .filter((line) => line.qbId && line.attempts > 0)
            .toSorted((a, b) => b.attempts - a.attempts);
          const starter = lines[0];
          if (!starter || starter.attempts < 8) continue;
          // Per-start value: yards/attempt centered on 6.5, plus TD-INT rate.
          const value = starter.yards / starter.attempts - 6.5 + (8 * (starter.tds - starter.ints)) / starter.attempts;
          extracted[team.team.id] = { qbId: starter.qbId, value: Number(value.toFixed(3)) };
        }
        fs.writeFileSync(file, JSON.stringify(extracted));
      } catch {
        continue;
      }
    }
    if (extracted) byEvent.set(game.eventId, extracted);
  }
  return byEvent;
}

function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
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
    rosterChurnGap: game.rosterChurnGap,
    starterFipGap: game.starterFipGap,
    qbValueGap: game.qbValueGap,
    travelMm: game.travelMm,
    homeShortWeek: game.homeShortWeek,
    awayShortWeek: game.awayShortWeek,
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
    pitcherForm: { min: 0, max: 0.12, delta: 0.012 },
    rosterChurn: { min: 0, max: 0.08, delta: 0.008 },
    starterFip: { min: 0, max: 0.5, delta: 0.04 }
  },
  nfl: {
    formWinRate: { min: 0, max: 0.35, delta: 0.03 },
    restDay: { min: 0, max: 0.06, delta: 0.006 },
    weatherHome: { min: 0, max: 0.15, delta: 0.012 },
    scoringForm: { min: 0, max: 0.06, delta: 0.006 },
    homeSplit: { min: 0, max: 0.6, delta: 0.05 },
    pythag: { min: 0, max: 1.2, delta: 0.1 },
    divisionDamp: { min: 0, max: 0.3, delta: 0.03 },
    bye: { min: 0, max: 0.3, delta: 0.03 },
    qbValue: { min: 0, max: 0.2, delta: 0.02 },
    travel: { min: 0, max: 0.1, delta: 0.01 },
    shortWeek: { min: 0, max: 0.3, delta: 0.03 }
  }
};

const BASE_TUNABLES = {
  mlb: ["injuryGap", "formWinRate", "restDay", "weatherHome"],
  nfl: ["formWinRate", "restDay", "weatherHome"]
};

const CANDIDATES = {
  mlb: ["starterFip", "scoringForm", "homeSplit", "pythag", "density", "rosterChurn"],
  nfl: ["qbValue", "travel", "shortWeek", "scoringForm", "homeSplit", "pythag", "divisionDamp", "bye"]
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
  const [venues, intervals, churnEvents] = await Promise.all([mlbVenueInfo(), mlbIlTimeline([2022, 2023, 2024, 2025, 2026]), mlbChurnEvents([2022, 2023, 2024, 2025, 2026])]);
  const starterLogs = await mlbStarterLogs([2022, 2023, 2024, 2025, 2026].flatMap((season) => bySeason.get(season)));
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
    churnEvents,
    starterLogs,
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
  const all = seasons.flatMap((season) => bySeason.get(season));
  const qbByEvent = await nflQbGames(all);
  console.log(`[nfl] seasons ${seasons.join("/")}: ${seasons.map((s) => bySeason.get(s).length).join("/")} games; weather archives ${archives.size}; QB box scores ${qbByEvent.size}`);
  buildFeatures(all, {
    sport: "nfl",
    ilIntervals: null,
    qbByEvent,
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
    elo: sport === "mlb" ? makeElo(4, 24) : makeElo(20, NFL_HFA)
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
// Faceoff: faithful replays of the deployed GitHub models vs the new model
// ---------------------------------------------------------------------------

/**
 * Deployed MLB model ("diamond-elo-v4", mlbModel.ts): Elo (k=12, HA=20,
 * margin mult min(1.75, 1+log1p(m)/5)) feeding a pretrained standardized
 * logistic over [eloLogit, W% gap, last-10 gap, runDiff/g gap, home/road
 * split gap], clamped [0.2, 0.8]; ratings update on the logistic probability.
 * The live pitcher ERA/WHIP adjustment is approximated with the same
 * runs-allowed-per-start proxy the brain uses (ERA ≈ RA/start × 0.92 × 9/5.5,
 * WHIP neutral) — disclosed in the report. NOTE: its logistic weights were
 * trained through 2025-09-28, so 2022–2025 replays are in-sample FOR IT; the
 * 2026 holdout is the only window that is out-of-sample for both models.
 */
function mlbGithubReplayer() {
  const snapshot = JSON.parse(fs.readFileSync(path.join(here, "..", "data", "model-snapshot.json"), "utf8"));
  const hyper = snapshot.hyperparameters;
  const portable = snapshot.portable_model;
  const ratings = new Map();
  const states = new Map();
  const pitchers = new Map();
  let currentSeason = null;
  const ratingOf = (id) => ratings.get(id) ?? 1500;
  const stateOf = (id) => states.get(id) ?? { games: 0, wins: 0, runDiff: 0, homeGames: 0, homeWins: 0, awayGames: 0, awayWins: 0, recent: [] };
  const rateOr = (n, d, f = 0.5) => (d ? n / d : f);
  return {
    probability(game) {
      if (game.season !== currentSeason) {
        for (const [id, rating] of ratings) ratings.set(id, 1500 + (rating - 1500) * (1 - hyper.season_regression));
        states.clear();
        pitchers.clear();
        currentSeason = game.season;
      }
      const home = stateOf(game.homeId);
      const away = stateOf(game.awayId);
      const elo = 1 / (1 + 10 ** (-(ratingOf(game.homeId) + hyper.home_advantage - ratingOf(game.awayId)) / 400));
      const features = [
        Math.log(elo / (1 - elo)),
        rateOr(home.wins, home.games) - rateOr(away.wins, away.games),
        rateOr(home.recent.reduce((sum, value) => sum + value, 0), home.recent.length) - rateOr(away.recent.reduce((sum, value) => sum + value, 0), away.recent.length),
        rateOr(home.runDiff, home.games, 0) - rateOr(away.runDiff, away.games, 0),
        rateOr(home.homeWins, home.homeGames) - rateOr(away.awayWins, away.awayGames)
      ];
      const standardized = features.map((value, index) => (value - portable.means[index]) / portable.scales[index]);
      const score = portable.weights[0] + standardized.reduce((sum, value, index) => sum + value * portable.weights[index + 1], 0);
      const forUpdate = Math.max(0.2, Math.min(0.8, 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, score))))));
      let display = forUpdate;
      const homePitcher = game.homeStarterId ? pitchers.get(game.homeStarterId) : null;
      const awayPitcher = game.awayStarterId ? pitchers.get(game.awayStarterId) : null;
      if (homePitcher?.runs.length >= 3 && awayPitcher?.runs.length >= 3) {
        const eraProxy = (record) => (record.runs.reduce((sum, value) => sum + value, 0) / record.runs.length) * 0.92 * (9 / 5.5);
        const reliability = Math.min(1, (Math.min(homePitcher.starts, awayPitcher.starts) * 5.5) / 45);
        const adjustment = (eraProxy(awayPitcher) - eraProxy(homePitcher)) * 0.045 * reliability;
        const logit = Math.log(display / (1 - display)) + adjustment;
        display = Math.max(0.2, Math.min(0.8, 1 / (1 + Math.exp(-logit))));
      }
      return { display, forUpdate };
    },
    update(game, forUpdate) {
      const homeWon = Number(game.homeWon);
      const multiplier = Math.min(1.75, 1 + Math.log1p(game.margin) / 5);
      const change = hyper.k_factor * multiplier * (homeWon - forUpdate);
      ratings.set(game.homeId, ratingOf(game.homeId) + change);
      ratings.set(game.awayId, ratingOf(game.awayId) - change);
      const home = stateOf(game.homeId);
      const away = stateOf(game.awayId);
      home.games += 1;
      home.wins += homeWon;
      home.runDiff += game.homeScore - game.awayScore;
      home.recent = [...home.recent.slice(-9), homeWon];
      home.homeGames += 1;
      home.homeWins += homeWon;
      away.games += 1;
      away.wins += 1 - homeWon;
      away.runDiff += game.awayScore - game.homeScore;
      away.recent = [...away.recent.slice(-9), 1 - homeWon];
      away.awayGames += 1;
      away.awayWins += 1 - homeWon;
      states.set(game.homeId, home);
      states.set(game.awayId, away);
      for (const [pitcherId, runsAgainst] of [[game.homeStarterId, game.awayScore], [game.awayStarterId, game.homeScore]]) {
        if (!pitcherId) continue;
        const record = pitchers.get(pitcherId) ?? { runs: [], starts: 0 };
        record.runs = [...record.runs, runsAgainst].slice(-8);
        record.starts += 1;
        pitchers.set(pitcherId, record);
      }
    }
  };
}

/** Deployed NFL model ("nfl-elo-form-v1", nflModel.ts): fully self-contained constants — fair on every window. */
function nflGithubReplayer() {
  const HOME_ADVANTAGE = 48;
  const K_FACTOR = 22;
  const SEASON_REGRESSION = 0.35;
  const ratings = new Map();
  const teams = new Map();
  let currentSeason = null;
  const ratingOf = (id) => ratings.get(id) ?? 1500;
  const stateOf = (id) => teams.get(id) ?? { games: 0, wins: 0, pointDiff: 0, recent: [] };
  const rateOr = (n, d, f = 0.5) => (d ? n / d : f);
  return {
    probability(game) {
      if (game.season !== currentSeason) {
        for (const [id, rating] of ratings) ratings.set(id, 1500 + (rating - 1500) * (1 - SEASON_REGRESSION));
        teams.clear();
        currentSeason = game.season;
      }
      const home = stateOf(game.homeId);
      const away = stateOf(game.awayId);
      const elo = 1 / (1 + 10 ** (-(ratingOf(game.homeId) + HOME_ADVANTAGE - ratingOf(game.awayId)) / 400));
      const recordEdge = rateOr(home.wins, home.games) - rateOr(away.wins, away.games);
      const recentEdge = rateOr(home.recent.reduce((sum, value) => sum + value, 0), home.recent.length) - rateOr(away.recent.reduce((sum, value) => sum + value, 0), away.recent.length);
      const pointEdge = rateOr(home.pointDiff, home.games, 0) - rateOr(away.pointDiff, away.games, 0);
      const logit = Math.log(elo / (1 - elo)) + recordEdge * 0.7 + recentEdge * 0.45 + Math.max(-18, Math.min(18, pointEdge)) * 0.018;
      const probability = Math.max(0.18, Math.min(0.82, 1 / (1 + Math.exp(-logit))));
      return { display: probability, forUpdate: probability };
    },
    update(game, forUpdate) {
      const homeWon = Number(game.homeWon);
      const multiplier = Math.min(1.8, 1 + Math.log1p(game.margin) / 4.5);
      const change = K_FACTOR * multiplier * (homeWon - forUpdate);
      ratings.set(game.homeId, ratingOf(game.homeId) + change);
      ratings.set(game.awayId, ratingOf(game.awayId) - change);
      const home = stateOf(game.homeId);
      const away = stateOf(game.awayId);
      home.games += 1;
      home.wins += homeWon;
      home.pointDiff += game.homeScore - game.awayScore;
      home.recent = [...home.recent.slice(-4), homeWon];
      away.games += 1;
      away.wins += 1 - homeWon;
      away.pointDiff += game.awayScore - game.homeScore;
      away.recent = [...away.recent.slice(-4), 1 - homeWon];
      teams.set(game.homeId, home);
      teams.set(game.awayId, away);
    }
  };
}

function runFaceoff(sport, games) {
  const github = sport === "mlb" ? mlbGithubReplayer() : nflGithubReplayer();
  const elo = sport === "mlb" ? makeElo(4, 24) : makeElo(20, NFL_HFA);
  const rows = [];
  for (const game of games) {
    const phase = PHASES[sport](game);
    const githubProbability = github.probability(game);
    const baseProbability = elo.probability(game.homeId, game.awayId);
    const { probability: newProbability } = brainProbability(sport, game, baseProbability, DEFAULT_BRAIN_WEIGHTS);
    if (phase !== "burnin") {
      rows.push({
        phase,
        season: game.season,
        githubCorrect: githubProbability.display >= 0.5 === game.homeWon,
        newCorrect: newProbability >= 0.5 === game.homeWon,
        githubLogLoss: logLoss(githubProbability.display, game.homeWon),
        newLogLoss: logLoss(newProbability, game.homeWon)
      });
    }
    github.update(game, githubProbability.forUpdate);
    elo.update(game);
  }
  const summarizeRows = (subset) => {
    const wins = (key) => subset.filter((row) => row[key]).length;
    const mean = (key) => subset.reduce((sum, row) => sum + row[key], 0) / subset.length;
    return {
      games: subset.length,
      githubAccuracy: wins("githubCorrect") / subset.length,
      newAccuracy: wins("newCorrect") / subset.length,
      githubWins: wins("githubCorrect"),
      newWins: wins("newCorrect"),
      githubLogLoss: mean("githubLogLoss"),
      newLogLoss: mean("newLogLoss")
    };
  };
  const bySeason = [...new Set(rows.map((row) => row.season))].toSorted().map((season) => ({ season, ...summarizeRows(rows.filter((row) => row.season === season)) }));
  return { sport, overall: summarizeRows(rows), holdout: summarizeRows(rows.filter((row) => row.phase === "holdout")), bySeason };
}

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

const faceoffResults = [];
for (const sport of sports) {
  const games = sport === "mlb" ? await loadMlb() : await loadNfl();

  if (FACEOFF) {
    const result = runFaceoff(sport, games);
    faceoffResults.push(result);
    const pct = (value) => `${(value * 100).toFixed(1)}%`;
    console.log(`[${sport}] FACEOFF overall (${result.overall.games} games): GitHub ${pct(result.overall.githubAccuracy)} (ll ${result.overall.githubLogLoss.toFixed(4)}) vs NEW ${pct(result.overall.newAccuracy)} (ll ${result.overall.newLogLoss.toFixed(4)})`);
    console.log(`[${sport}] FACEOFF holdout (${result.holdout.games} games): GitHub ${pct(result.holdout.githubAccuracy)} (ll ${result.holdout.githubLogLoss.toFixed(4)}) vs NEW ${pct(result.holdout.newAccuracy)} (ll ${result.holdout.newLogLoss.toFixed(4)})`);
    continue;
  }

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

if (FACEOFF && faceoffResults.length) {
  const lines = [
    "# Deployed GitHub models vs the new model — head to head",
    "",
    `Generated ${TODAY} by \`npm run backtest -- all --faceoff\`. Identical games, identical chronological replay; each model manages its own state exactly as its production code does.`,
    "",
    "- **GitHub MLB** (\"diamond-elo-v4\"): the deployed Elo + pretrained logistic, replayed with its exact hyperparameters and snapshot weights; the live pitcher ERA/WHIP adjustment is approximated with a runs-allowed-per-start proxy (WHIP neutral). Its logistic was trained through 2025-09-28, so **2022–2025 rows are in-sample for it** — the 2026 holdout is the only window that is out-of-sample for both sides.",
    "- **GitHub NFL** (\"nfl-elo-form-v1\"): fully self-contained constants — fair on every window.",
    "- **NEW model**: margin-of-victory Elo + Game Brain factors at shipped `DEFAULT_BRAIN_WEIGHTS`, frozen (no tuning during the faceoff).",
    ""
  ];
  for (const result of faceoffResults) {
    const pct = (value) => `${(value * 100).toFixed(1)}%`;
    lines.push(`## ${result.sport.toUpperCase()}`, "");
    lines.push("| window | games | GitHub W-L | GitHub acc | GitHub logloss | NEW W-L | NEW acc | NEW logloss |");
    lines.push("|---|---|---|---|---|---|---|---|");
    const row = (label, stats) =>
      `| ${label} | ${stats.games} | ${stats.githubWins}-${stats.games - stats.githubWins} | ${pct(stats.githubAccuracy)} | ${stats.githubLogLoss.toFixed(4)} | ${stats.newWins}-${stats.games - stats.newWins} | ${pct(stats.newAccuracy)} | ${stats.newLogLoss.toFixed(4)} |`;
    lines.push(row("**overall**", result.overall));
    lines.push(row(`**final holdout${result.sport === "mlb" ? " (2026 — fair for both)" : " (2025)"}**`, result.holdout));
    for (const season of result.bySeason) lines.push(row(String(season.season), season));
    lines.push("");
  }
  fs.writeFileSync(path.join(OUT_DIR, "faceoff.md"), lines.join("\n"));
  console.log("faceoff report written to docs/backtests/faceoff.md");
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
