/**
 * Live pregame capture + forward-test ledger (no database, no accounts).
 *
 * Capture mode (default): for every scheduled game today (MLB + NFL), records
 * the live information the backtest could never see — posted probables and
 * lineups, current IL/injury reports, projected starting QB with rolling
 * value, the game-hour weather forecast, tagged news and transactions — plus
 * the brain's factor terms and probabilities computed AT CAPTURE TIME against
 * a self-contained MOV-Elo baseline. Snapshots land in
 * data/live-snapshots/{sport}/{date}/{HHmm}Z.json; re-runs through the day
 * capture the drift as game time approaches.
 *
 * Grade mode (--grade [--date=YYYY-MM-DD]): after games finish, joins the
 * LAST pregame capture of each game to the final score and appends the result
 * to data/live-snapshots/ledger-{sport}.json — the cumulative record of how
 * the live-informed brain actually performs, game by real game. This is the
 * forward test that historical simulation cannot provide.
 *
 * Automation: .github/workflows/live-capture.yml runs this on a schedule and
 * commits snapshots to the `live-snapshots` branch (git-scraping pattern).
 * Locally: `npm run capture` / `npm run capture -- --grade`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyLogitDelta,
  applyTemperature,
  challengerProbability,
  confidenceTier,
  factorInputVector,
  MODEL_TEMPERATURE,
  onlineUpdate,
  combineFactors,
  computeTeamForm,
  DEFAULT_BRAIN_WEIGHTS,
  factorTerms,
  injuryBurden,
  bucketInjuryStatus,
  isQbOut,
  pythagoreanExpectation,
  tagNewsText,
  weatherSeverity
} from "../lib/server/brain/brainScoring.ts";
import { NFL_DIVISIONS, NFL_STADIUMS } from "../lib/server/brain/nflStadiums.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.join(here, "..", "..", "data", "live-snapshots");
const GRADE = process.argv.includes("--grade");
const dateArg = process.argv.find((arg) => arg.startsWith("--date="))?.slice(7);

const easternToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const easternYesterday = () => {
  const now = new Date(Date.now() - 24 * 3600 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
};

async function getJson(url, headers = {}) {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; SportIQ/1.0)", ...headers } });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

const logitOf = (p) => Math.log(Math.max(0.02, Math.min(0.98, p)) / (1 - Math.max(0.02, Math.min(0.98, p))));

function movElo(k, homeAdvantage) {
  const ratings = new Map();
  const get = (id) => ratings.get(id) ?? 1500;
  return {
    probability: (homeId, awayId) => 1 / (1 + 10 ** (-(get(homeId) + homeAdvantage - get(awayId)) / 400)),
    update(homeId, awayId, homeScore, awayScore) {
      if (homeScore === awayScore) return;
      const expected = this.probability(homeId, awayId);
      const homeWon = homeScore > awayScore;
      const diff = homeWon ? get(homeId) + homeAdvantage - get(awayId) : get(awayId) - get(homeId) - homeAdvantage;
      const mult = Math.log(Math.abs(homeScore - awayScore) + 1) * (2.2 / (diff * 0.001 + 2.2));
      const change = k * mult * ((homeWon ? 1 : 0) - expected);
      ratings.set(homeId, get(homeId) + change);
      ratings.set(awayId, get(awayId) - change);
    },
    regress() {
      for (const [id, rating] of ratings) ratings.set(id, 1500 + (rating - 1500) * (2 / 3));
    }
  };
}

// ---------------------------------------------------------------------------
// MLB capture
// ---------------------------------------------------------------------------

async function captureMlb(date) {
  const season = date.slice(0, 4);
  const [slate, seasonSchedule, priorSchedule, transactions] = await Promise.all([
    getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher,lineups,venue`),
    getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R&startDate=${season}-03-01&endDate=${date}`),
    getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R&startDate=${Number(season) - 1}-03-01&endDate=${Number(season) - 1}-11-10`),
    getJson(`https://statsapi.mlb.com/api/v1/transactions?startDate=${new Date(Date.parse(date) - 3 * 86400000).toISOString().slice(0, 10)}&endDate=${date}`)
  ]);
  const games = (slate?.dates?.[0]?.games ?? []).filter((game) => game.status?.abstractGameState === "Preview");
  if (!games.length) return null;

  const elo = movElo(4, 24);
  const results = new Map();
  const resultsFor = (id) => results.get(id) ?? results.set(id, []).get(id);
  const replay = (payload, evaluate) => {
    for (const day of payload?.dates ?? []) {
      for (const game of day.games ?? []) {
        const home = game.teams?.home;
        const away = game.teams?.away;
        if (game.status?.abstractGameState !== "Final" || !home?.team?.id || !away?.team?.id) continue;
        if (typeof home.score !== "number" || home.score === away.score) continue;
        elo.update(home.team.id, away.team.id, home.score, away.score);
        if (evaluate && game.officialDate < date) {
          resultsFor(home.team.id).push({ date: game.officialDate, won: home.score > away.score });
          resultsFor(away.team.id).push({ date: game.officialDate, won: away.score > home.score });
        }
      }
    }
  };
  replay(priorSchedule, false);
  elo.regress();
  replay(seasonSchedule, true);

  const ilReports = new Map();
  await Promise.all(
    [...new Set(games.flatMap((game) => [game.teams?.home?.team?.id, game.teams?.away?.team?.id]))].filter(Boolean).map(async (teamId) => {
      const roster = await getJson(`https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=40Man`);
      const entries = (roster?.roster ?? [])
        .map((spot) => ({ name: spot.person?.fullName, position: spot.position?.abbreviation ?? null, status: bucketInjuryStatus(spot.status?.description ?? "") }))
        .filter((entry) => entry.name && entry.status)
        .map((entry) => ({ playerName: entry.name, position: entry.position, status: entry.status, detail: null }));
      ilReports.set(teamId, { entries, burden: injuryBurden(entries, "mlb") });
    })
  );

  const txByTeam = new Map();
  for (const tx of transactions?.transactions ?? []) {
    const teamId = tx.toTeam?.id;
    if (!teamId || teamId > 160 || !tx.description) continue;
    const list = txByTeam.get(teamId) ?? [];
    if (list.length < 5) list.push({ type: tx.typeDesc ?? "Move", detail: tx.description, tags: tagNewsText(tx.description) });
    txByTeam.set(teamId, list);
  }

  const snapshots = [];
  for (const game of games) {
    const home = game.teams?.home;
    const away = game.teams?.away;
    if (!home?.team?.id || !away?.team?.id) continue;
    const venue = game.venue?.id ? await getJson(`https://statsapi.mlb.com/api/v1/venues/${game.venue.id}?hydrate=location,fieldInfo`) : null;
    const venueInfo = venue?.venues?.[0];
    const sheltered = venueInfo?.fieldInfo?.roofType !== undefined && venueInfo.fieldInfo.roofType !== "Open";
    let weather = null;
    const coordinates = venueInfo?.location?.defaultCoordinates;
    if (!sheltered && coordinates && game.gameDate) {
      const forecast = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${coordinates.latitude}&longitude=${coordinates.longitude}&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability,snowfall&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&start_date=${date}&end_date=${date}`
      );
      const hourKey = `${game.gameDate.slice(0, 13)}:00`;
      const index = forecast?.hourly?.time?.indexOf(hourKey) ?? -1;
      if (index >= 0) {
        const at = (name) => forecast.hourly[name]?.[index] ?? 0;
        weather = { tempF: at("temperature_2m"), windMph: at("wind_speed_10m"), gustMph: at("wind_gusts_10m"), precipProbability: at("precipitation_probability") / 100, snowfall: at("snowfall") > 0 };
      }
    }
    const homeForm = computeTeamForm(results.get(home.team.id) ?? [], date);
    const awayForm = computeTeamForm(results.get(away.team.id) ?? [], date);
    const homeInjuries = ilReports.get(home.team.id) ?? { entries: [], burden: 0 };
    const awayInjuries = ilReports.get(away.team.id) ?? { entries: [], burden: 0 };
    const baseProbability = elo.probability(home.team.id, away.team.id);
    const factorInputs = {
      sport: "mlb",
      burdenGap: awayInjuries.burden - homeInjuries.burden,
      homeQbOut: false,
      awayQbOut: false,
      homeForm,
      awayForm,
      weatherSeverity: weather ? weatherSeverity(weather) : 0
    };
    const terms = factorTerms(factorInputs, DEFAULT_BRAIN_WEIGHTS);
    const { logitDelta } = combineFactors(terms.map((term) => ({ label: term.kind, detail: "", homeLogit: term.homeLogit })));
    snapshots.push({
      gameId: String(game.gamePk),
      gameTimeUtc: game.gameDate ?? null,
      home: home.team.name,
      away: away.team.name,
      probables: { home: home.probablePitcher?.fullName ?? null, away: away.probablePitcher?.fullName ?? null },
      lineupsPosted: Boolean(game.lineups?.homePlayers?.length || game.lineups?.awayPlayers?.length),
      injuries: {
        home: { burden: homeInjuries.burden, count: homeInjuries.entries.length },
        away: { burden: awayInjuries.burden, count: awayInjuries.entries.length }
      },
      weather,
      form: { home: homeForm, away: awayForm },
      news: { home: txByTeam.get(home.team.id) ?? [], away: txByTeam.get(away.team.id) ?? [] },
      terms,
      baseProbability: applyTemperature(baseProbability, "mlb"),
      brainProbability: applyTemperature(applyLogitDelta(baseProbability, logitDelta), "mlb"),
      tier: confidenceTier(applyTemperature(applyLogitDelta(baseProbability, logitDelta), "mlb"), "mlb"),
      learn: { baseLogit: Number(logitOf(baseProbability).toFixed(4)), inputs: factorInputVector(factorInputs) }
    });
  }
  return snapshots;
}

// ---------------------------------------------------------------------------
// NFL capture
// ---------------------------------------------------------------------------

async function captureNfl(date) {
  const scoreboard = await getJson(`https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${date.replaceAll("-", "")}`);
  const games = (scoreboard?.events ?? []).filter((event) => event.status?.type?.state === "pre" && event.season?.type === 2);
  if (!games.length) return null;

  const seasonYear = games[0].season?.year ?? Number(date.slice(0, 4));
  const [currentSeason, priorSeason] = await Promise.all([
    getJson(`https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${seasonYear}&limit=1000`),
    getJson(`https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${seasonYear - 1}&limit=1000`)
  ]);
  const completed = (payload, wantSeason) =>
    (payload?.events ?? [])
      .filter((event) => event.season?.year === wantSeason && event.season?.type === 2 && (event.status?.type?.completed || event.status?.type?.state === "post"))
      .map((event) => {
        const competition = event.competitions?.[0];
        const home = competition?.competitors?.find((team) => team.homeAway === "home");
        const away = competition?.competitors?.find((team) => team.homeAway === "away");
        return home && away
          ? { id: event.id, date: event.date.slice(0, 10), homeId: home.id, awayId: away.id, homeScore: Number(home.score), awayScore: Number(away.score) }
          : null;
      })
      .filter(Boolean)
      .toSorted((a, b) => a.date.localeCompare(b.date));

  const prior = completed(priorSeason, seasonYear - 1);
  const current = completed(currentSeason, seasonYear).filter((game) => game.date < date);
  const elo = movElo(20, 28);
  const results = new Map();
  const resultsFor = (id) => results.get(id) ?? results.set(id, []).get(id);
  const teamTallies = new Map();
  const tallyFor = (id) => teamTallies.get(id) ?? teamTallies.set(id, { scored: 0, allowed: 0, games: 0 }).get(id);
  for (const game of prior) elo.update(game.homeId, game.awayId, game.homeScore, game.awayScore);
  elo.regress();
  for (const game of current) {
    elo.update(game.homeId, game.awayId, game.homeScore, game.awayScore);
    resultsFor(game.homeId).push({ date: game.date, won: game.homeScore > game.awayScore });
    resultsFor(game.awayId).push({ date: game.date, won: game.awayScore > game.homeScore });
    const homeTally = tallyFor(game.homeId);
    const awayTally = tallyFor(game.awayId);
    homeTally.scored += game.homeScore;
    homeTally.allowed += game.awayScore;
    homeTally.games += 1;
    awayTally.scored += game.awayScore;
    awayTally.allowed += game.homeScore;
    awayTally.games += 1;
  }

  const teamIds = [...new Set(games.flatMap((event) => (event.competitions?.[0]?.competitors ?? []).map((team) => team.id)))].filter(Boolean);
  const injuryReports = new Map();
  await Promise.all(
    teamIds.map(async (teamId) => {
      const roster = await getJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`);
      const fresh = Date.now() - 14 * 86400000;
      const entries = [];
      for (const group of roster?.athletes ?? []) {
        for (const athlete of group.items ?? []) {
          if (!athlete.displayName) continue;
          const position = athlete.position?.abbreviation ?? null;
          const rosterStatus = athlete.status?.name ?? "Active";
          if (rosterStatus !== "Active") {
            entries.push({ playerName: athlete.displayName, position, status: bucketInjuryStatus(rosterStatus) ?? "il_long", detail: rosterStatus });
            continue;
          }
          const latest = (athlete.injuries ?? [])
            .filter((injury) => injury.status && injury.date && new Date(injury.date).getTime() >= fresh)
            .toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
          const status = latest?.status ? bucketInjuryStatus(latest.status) : null;
          if (status) entries.push({ playerName: athlete.displayName, position, status, detail: latest.status });
        }
      }
      injuryReports.set(teamId, { entries, burden: injuryBurden(entries, "nfl"), qbOut: isQbOut(entries) });
    })
  );

  // Projected starter QB value: last game's leading passer, rolling over his recent starts.
  const qbContext = new Map();
  const staleCutoff = Date.now() - 21 * 86400000;
  for (const teamId of teamIds) {
    const recent = current.filter((game) => game.homeId === teamId || game.awayId === teamId).slice(-8).toReversed();
    if (!recent.length || new Date(recent[0].date).getTime() < staleCutoff) continue;
    const values = [];
    let starterId = null;
    let starterName = null;
    for (const game of recent) {
      const summary = await getJson(`https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${game.id}`);
      const team = summary?.boxscore?.players?.find((entry) => entry.team?.id === teamId);
      const passing = team?.statistics?.find((group) => group.name === "passing");
      const labels = passing?.labels ?? [];
      const line = (passing?.athletes ?? [])
        .map((entry) => {
          const [, attempts] = String(entry.stats?.[labels.indexOf("C/ATT")] ?? "").split("/").map(Number);
          return {
            qbId: entry.athlete?.id,
            name: entry.athlete?.displayName ?? null,
            attempts: Number.isFinite(attempts) ? attempts : 0,
            yards: Number(entry.stats?.[labels.indexOf("YDS")]) || 0,
            tds: Number(entry.stats?.[labels.indexOf("TD")]) || 0,
            ints: Number(entry.stats?.[labels.indexOf("INT")]) || 0
          };
        })
        .filter((entry) => entry.qbId && entry.attempts >= 8)
        .toSorted((a, b) => b.attempts - a.attempts)[0];
      if (!line) continue;
      if (!starterId) {
        starterId = line.qbId;
        starterName = line.name;
      }
      if (line.qbId === starterId) values.push(line.yards / line.attempts - 6.5 + (8 * (line.tds - line.ints)) / line.attempts);
    }
    if (values.length >= 2) {
      qbContext.set(teamId, { starterName, value: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)) });
    }
  }

  const snapshots = [];
  for (const event of games) {
    const competition = event.competitions?.[0];
    const home = competition?.competitors?.find((team) => team.homeAway === "home");
    const away = competition?.competitors?.find((team) => team.homeAway === "away");
    if (!home?.id || !away?.id) continue;
    const homeAbbr = (home.team?.abbreviation ?? "").toUpperCase();
    const awayAbbr = (away.team?.abbreviation ?? "").toUpperCase();
    const stadium = NFL_STADIUMS[homeAbbr];
    let weather = null;
    if (stadium && !(competition?.venue?.indoor ?? stadium.indoor) && event.date) {
      const forecast = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${stadium.lat}&longitude=${stadium.lon}&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability,snowfall&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&start_date=${date}&end_date=${date}`
      );
      const hourKey = `${event.date.slice(0, 13)}:00`;
      const index = forecast?.hourly?.time?.indexOf(hourKey) ?? -1;
      if (index >= 0) {
        const at = (name) => forecast.hourly[name]?.[index] ?? 0;
        weather = { tempF: at("temperature_2m"), windMph: at("wind_speed_10m"), gustMph: at("wind_gusts_10m"), precipProbability: at("precipitation_probability") / 100, snowfall: at("snowfall") > 0 };
      }
    }
    const homeInjuries = injuryReports.get(home.id) ?? { entries: [], burden: 0, qbOut: false };
    const awayInjuries = injuryReports.get(away.id) ?? { entries: [], burden: 0, qbOut: false };
    const homeForm = computeTeamForm(results.get(home.id) ?? [], date);
    const awayForm = computeTeamForm(results.get(away.id) ?? [], date);
    const pythagOf = (teamId) => {
      const tally = teamTallies.get(teamId);
      return tally && tally.games >= 5 ? pythagoreanExpectation(tally.scored, tally.allowed, 2.37) : null;
    };
    const homePythag = pythagOf(home.id);
    const awayPythag = pythagOf(away.id);
    const homeQb = qbContext.get(home.id);
    const awayQb = qbContext.get(away.id);
    const baseProbability = elo.probability(home.id, away.id);
    const factorInputs = {
      sport: "nfl",
        burdenGap: awayInjuries.burden - homeInjuries.burden,
        homeQbOut: homeInjuries.qbOut,
        awayQbOut: awayInjuries.qbOut,
        homeForm,
        awayForm,
        weatherSeverity: weather ? weatherSeverity(weather) : 0,
        pythagGap: homePythag != null && awayPythag != null ? Number((homePythag - awayPythag).toFixed(4)) : undefined,
        divisionGame: NFL_DIVISIONS[homeAbbr] !== undefined && NFL_DIVISIONS[homeAbbr] === NFL_DIVISIONS[awayAbbr],
        baselineLogit: logitOf(baseProbability),
        homeOffBye: (homeForm.restDays ?? 0) >= 10 && homeForm.lastTenGames > 0,
        awayOffBye: (awayForm.restDays ?? 0) >= 10 && awayForm.lastTenGames > 0,
        qbValueGap: homeQb?.value != null && awayQb?.value != null ? Number((homeQb.value - awayQb.value).toFixed(3)) : undefined
    };
    const terms = factorTerms(factorInputs, DEFAULT_BRAIN_WEIGHTS);
    const { logitDelta } = combineFactors(terms.map((term) => ({ label: term.kind, detail: "", homeLogit: term.homeLogit })));
    snapshots.push({
      gameId: String(event.id),
      gameTimeUtc: event.date ?? null,
      home: home.team?.displayName ?? home.id,
      away: away.team?.displayName ?? away.id,
      injuries: {
        home: { burden: homeInjuries.burden, qbOut: homeInjuries.qbOut, notable: homeInjuries.entries.filter((entry) => entry.status !== "questionable").slice(0, 5) },
        away: { burden: awayInjuries.burden, qbOut: awayInjuries.qbOut, notable: awayInjuries.entries.filter((entry) => entry.status !== "questionable").slice(0, 5) }
      },
      qb: { home: homeQb ?? null, away: awayQb ?? null },
      weather,
      form: { home: homeForm, away: awayForm },
      pythag: { home: homePythag, away: awayPythag },
      terms,
      baseProbability: applyTemperature(baseProbability, "nfl"),
      brainProbability: applyTemperature(applyLogitDelta(baseProbability, logitDelta), "nfl"),
      tier: confidenceTier(applyTemperature(applyLogitDelta(baseProbability, logitDelta), "nfl"), "nfl"),
      learn: { baseLogit: Number(logitOf(baseProbability).toFixed(4)), inputs: factorInputVector(factorInputs) }
    });
  }
  return snapshots;
}

// ---------------------------------------------------------------------------
// Grading: join yesterday's last pregame captures to final scores
// ---------------------------------------------------------------------------

async function finalsFor(sport, date) {
  const finals = new Map();
  if (sport === "mlb") {
    const payload = await getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`);
    for (const game of payload?.dates?.[0]?.games ?? []) {
      if (game.status?.abstractGameState !== "Final") continue;
      const home = game.teams?.home;
      const away = game.teams?.away;
      if (typeof home?.score !== "number" || home.score === away.score) continue;
      finals.set(String(game.gamePk), { homeScore: home.score, awayScore: away.score, homeWon: home.score > away.score });
    }
  } else {
    const payload = await getJson(`https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${date.replaceAll("-", "")}`);
    for (const event of payload?.events ?? []) {
      if (!(event.status?.type?.completed || event.status?.type?.state === "post")) continue;
      const competition = event.competitions?.[0];
      const home = competition?.competitors?.find((team) => team.homeAway === "home");
      const away = competition?.competitors?.find((team) => team.homeAway === "away");
      const homeScore = Number(home?.score);
      const awayScore = Number(away?.score);
      if (!Number.isFinite(homeScore) || homeScore === awayScore) continue;
      finals.set(String(event.id), { homeScore, awayScore, homeWon: homeScore > awayScore });
    }
  }
  return finals;
}

const LEARN_ETA = { mlb: 0.005, nfl: 0.02 };
const STATE_PATH = path.join(OUT_ROOT, "brain-state.json");

function loadBrainState() {
  if (fs.existsSync(STATE_PATH)) return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const fresh = (sport) => ({
    state: { weights: {}, temperature: MODEL_TEMPERATURE[sport], gamesLearned: 0, buffer: [], resets: 0 },
    guard: [],
    events: []
  });
  return { mlb: fresh("mlb"), nfl: fresh("nfl") };
}

async function grade(date) {
  for (const sport of ["mlb", "nfl"]) {
    const dayDir = path.join(OUT_ROOT, sport, date);
    if (!fs.existsSync(dayDir)) continue;
    const captureFiles = fs.readdirSync(dayDir).filter((file) => /^\d{4}Z\.json$/.test(file)).toSorted();
    if (!captureFiles.length) continue;
    const resultPath = path.join(dayDir, "result.json");
    if (fs.existsSync(resultPath)) continue;
    const finals = await finalsFor(sport, date);
    if (!finals.size) continue;
    const lastPregame = new Map();
    for (const file of captureFiles) {
      const capture = JSON.parse(fs.readFileSync(path.join(dayDir, file), "utf8"));
      for (const game of capture.games) {
        if (!game.gameTimeUtc || capture.capturedAt < game.gameTimeUtc) lastPregame.set(game.gameId, { ...game, capturedAt: capture.capturedAt });
      }
    }
    const brainState = loadBrainState();
    const slot = brainState[sport];
    const graded = [];
    for (const [gameId, snapshot] of lastPregame) {
      const final = finals.get(gameId);
      if (!final) continue;
      let challenger = null;
      if (snapshot.learn) {
        const p = challengerProbability(slot.state, sport, snapshot.learn.baseLogit, snapshot.learn.inputs);
        challenger = { probability: p, correct: p >= 0.5 === final.homeWon };
        const champLl = -Math.log(Math.max(1e-9, final.homeWon ? snapshot.brainProbability : 1 - snapshot.brainProbability));
        const chalLl = -Math.log(Math.max(1e-9, final.homeWon ? p : 1 - p));
        slot.guard = [...slot.guard, [chalLl, champLl]].slice(-60);
        slot.state = onlineUpdate(slot.state, sport, snapshot.learn.baseLogit, snapshot.learn.inputs, final.homeWon, LEARN_ETA[sport]);
      }
      graded.push({
        challengerProbability: challenger?.probability ?? null,
        challengerCorrect: challenger?.correct ?? null,
        gameId,
        matchup: `${snapshot.away} @ ${snapshot.home}`,
        capturedAt: snapshot.capturedAt,
        baseProbability: snapshot.baseProbability,
        brainProbability: snapshot.brainProbability,
        homeWon: final.homeWon,
        score: `${final.awayScore}-${final.homeScore}`,
        baseCorrect: snapshot.baseProbability >= 0.5 === final.homeWon,
        brainCorrect: snapshot.brainProbability >= 0.5 === final.homeWon
      });
    }
    if (!graded.length) continue;
    // Drift guard: if the learning challenger is clearly losing to the shipped
    // champion over the trailing window, reset it to shipped (ALARM + RESET).
    if (slot.guard.length >= 40) {
      const challengerMean = slot.guard.reduce((sum, [chal]) => sum + chal, 0) / slot.guard.length;
      const championMean = slot.guard.reduce((sum, [, champ]) => sum + champ, 0) / slot.guard.length;
      if (challengerMean > championMean + 0.02) {
        slot.events = [...slot.events, { at: new Date().toISOString(), event: "reset", challengerMean: Number(challengerMean.toFixed(4)), championMean: Number(championMean.toFixed(4)) }].slice(-20);
        slot.state = { weights: {}, temperature: MODEL_TEMPERATURE[sport], gamesLearned: slot.state.gamesLearned, buffer: [], resets: slot.state.resets + 1 };
        slot.guard = [];
        console.log(`[${sport}] LEARNER RESET: challenger trailing logloss ${challengerMean.toFixed(4)} vs champion ${championMean.toFixed(4)}`);
      }
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify(brainState, null, 1));
    fs.writeFileSync(resultPath, JSON.stringify({ date, graded }, null, 1));
    const ledgerPath = path.join(OUT_ROOT, `ledger-${sport}.json`);
    const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, "utf8")) : { games: 0, baseWins: 0, brainWins: 0, days: [] };
    ledger.games += graded.length;
    ledger.baseWins += graded.filter((game) => game.baseCorrect).length;
    ledger.brainWins += graded.filter((game) => game.brainCorrect).length;
    const challengerGraded = graded.filter((game) => game.challengerCorrect !== null);
    ledger.challengerWins = (ledger.challengerWins ?? 0) + challengerGraded.filter((game) => game.challengerCorrect).length;
    ledger.challengerGames = (ledger.challengerGames ?? 0) + challengerGraded.length;
    ledger.days.push({ date, games: graded.length, baseWins: graded.filter((game) => game.baseCorrect).length, brainWins: graded.filter((game) => game.brainCorrect).length, challengerWins: challengerGraded.filter((game) => game.challengerCorrect).length });
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1));
    console.log(`[${sport}] graded ${graded.length} games for ${date}; ledger: champion ${ledger.brainWins}-${ledger.games - ledger.brainWins}, challenger ${ledger.challengerWins ?? 0}-${(ledger.challengerGames ?? 0) - (ledger.challengerWins ?? 0)} (learned ${loadBrainState()[sport].state.gamesLearned} games, ${loadBrainState()[sport].state.resets} resets)`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (GRADE) {
  await grade(dateArg ?? easternYesterday());
} else {
  const date = dateArg ?? easternToday();
  const stamp = `${new Date().toISOString().slice(11, 16).replace(":", "")}Z`;
  for (const [sport, capture] of [["mlb", captureMlb], ["nfl", captureNfl]]) {
    const games = await capture(date);
    if (!games?.length) {
      console.log(`[${sport}] no scheduled games to capture for ${date}`);
      continue;
    }
    const dir = path.join(OUT_ROOT, sport, date);
    fs.mkdirSync(dir, { recursive: true });
    const payload = { sport, date, capturedAt: new Date().toISOString(), games };
    fs.writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify(payload, null, 1));
    console.log(`[${sport}] captured ${games.length} games -> data/live-snapshots/${sport}/${date}/${stamp}.json`);
  }
  // Grade yesterday opportunistically so the ledger stays current without a second cron.
  await grade(easternYesterday());
}
