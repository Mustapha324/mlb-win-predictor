import "server-only";
import type { PlayerPick, PlayerPicksResponse, TeamPrediction, TodayPredictionsResponse } from "@/lib/api";
import { americanToDecimal, playerPropKey, type PlayerPropQuote } from "@/lib/playerPropOdds";
import type { AccessState } from "@/lib/server/access";
import { getPredictions } from "@/lib/server/mlbModel";
import { getNflPredictions } from "@/lib/server/nflModel";
import { getPlayerPropMarkets } from "@/lib/server/marketOdds";
import { ESPN_NFL_BASE, ESPN_NFL_HEADERS, fetchEspnNflSeason } from "@/lib/server/espnNflFeed";
import {
  applyPlayerPickAccess,
  applyResultAccess,
  FREE_PLAYER_PICK_COUNT,
  MAX_PLAYER_PICK_COUNT,
  TOP_PLAYER_PICK_COUNT
} from "@/lib/server/playerPickAccess";
import { calculatePerformance, confidenceFromEdge, gradePlayerPick, pickStatus } from "@/lib/server/playerPickScoring";
import {
  loadPlayerPickSnapshots,
  loadRecentPlayerPickResults,
  storeInitialPlayerPicks,
  updatePlayerPickResults
} from "@/lib/server/playerPickStore";
import type { Sport } from "@/lib/sports";

const MLB_API = "https://statsapi.mlb.com/api/v1";

type MlbStat = Record<string, number | string | undefined>;
type MlbSplit = {
  player?: { id?: number; fullName?: string };
  team?: { id?: number; name?: string };
  position?: { abbreviation?: string };
  stat?: MlbStat;
};
type MlbStatsPayload = { stats?: Array<{ splits?: MlbSplit[] }> };
type MlbBoxscorePlayer = { person?: { id?: number }; stats?: { batting?: MlbStat; pitching?: MlbStat } };
type MlbBoxscore = { teams?: { away?: { players?: Record<string, MlbBoxscorePlayer> }; home?: { players?: Record<string, MlbBoxscorePlayer> } } };

type EspnAthlete = {
  id?: string;
  displayName?: string;
  fullName?: string;
  headshot?: { href?: string };
  position?: { abbreviation?: string };
};
type EspnBoxscoreGroup = {
  team?: { id?: string; displayName?: string };
  statistics?: Array<{
    name?: string;
    labels?: string[];
    athletes?: Array<{ athlete?: EspnAthlete; stats?: string[] }>;
  }>;
};
type EspnSummary = { boxscore?: { players?: EspnBoxscoreGroup[] } };
type EspnEvent = {
  id?: string;
  date?: string;
  season?: { year?: number };
  status?: { type?: { state?: "pre" | "in" | "post"; completed?: boolean } };
  competitions?: Array<{ competitors?: Array<{ id?: string; homeAway?: "home" | "away"; team?: { id?: string; displayName?: string } }> }>;
};
type Candidate = Omit<PlayerPick, "rank" | "isTopFive" | "is_locked"> & {
  recentRate?: number;
  seasonRate?: number;
  group?: "hitting" | "pitching";
};

type MlbContext = {
  gameId: string;
  opponent: string;
  probability: number;
  gameTime: string | null;
  opponentId: number;
};

type NflPlayerForm = {
  playerId: string;
  playerName: string;
  headshotUrl: string | null;
  position: string | null;
  values: Map<string, number[]>;
};

function numberValue(stat: MlbStat | undefined, key: string): number {
  const value = Number(stat?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function poissonOver(mean: number, line: number): number {
  const maximum = Math.floor(line);
  let term = Math.exp(-mean);
  let cumulative = term;
  for (let value = 1; value <= maximum; value += 1) {
    term *= mean / value;
    cumulative += term;
  }
  return Math.max(0.02, Math.min(0.98, 1 - cumulative));
}

function baseCandidate(
  base: Omit<Candidate, "selection" | "confidence" | "projection" | "supportingStats" | "explanation" | "modelEdge">,
  projection: number,
  seasonRate: number,
  recentRate: number,
  teamProbability: number
): Candidate {
  const overProbability = poissonOver(Math.max(0.01, projection), base.line);
  const selection = overProbability >= 0.5 ? "Over" : "Under";
  const confidenceCap = base.market === "Home runs" && selection === "Under" ? 0.78 : 0.88;
  const confidence = Math.min(confidenceCap, Math.max(0.51, Math.max(overProbability, 1 - overProbability)));
  const edge = projection - base.line;
  return {
    ...base,
    selection,
    projection: Number(projection.toFixed(2)),
    confidence: Number(confidence.toFixed(4)),
    modelEdge: Number(edge.toFixed(2)),
    seasonRate,
    recentRate,
    supportingStats: [
      `${seasonRate.toFixed(2)} per game this season`,
      `${recentRate.toFixed(2)} per game over the last 10`,
      `${edge >= 0 ? "+" : ""}${edge.toFixed(2)} model edge vs line`,
      `${Math.round(teamProbability * 100)}% team win chance`
    ],
    explanation: `${selection} ${base.line} is the stronger side after blending season production, recent form, opponent history, and the matchup-adjusted team outlook.`
  };
}

async function fetchMlbStats(group: "hitting" | "pitching", stats: "season" | "lastXGames", season: number): Promise<MlbSplit[]> {
  const query = new URLSearchParams({ stats, group, season: String(season), sportIds: "1", playerPool: "QUALIFIED", hydrate: "team", limit: "1000" });
  if (stats === "lastXGames") query.set("numberOfGames", "10");
  try {
    const response = await fetch(`${MLB_API}/stats?${query}`, { next: { revalidate: 900 }, headers: { Accept: "application/json" } });
    if (!response.ok) return [];
    const payload = (await response.json()) as MlbStatsPayload;
    return payload.stats?.[0]?.splits ?? [];
  } catch {
    return [];
  }
}

function mlbTeamContext(games: TeamPrediction[]): Map<string, MlbContext> {
  const context = new Map<string, MlbContext>();
  for (const game of games) {
    if (pickStatus(game.status, game.is_final) !== "scheduled") continue;
    context.set(game.home_team, { gameId: game.gameId, opponent: game.away_team, probability: game.pregame_home_win_probability, gameTime: game.game_time_utc, opponentId: game.awayTeam.id });
    context.set(game.away_team, { gameId: game.gameId, opponent: game.home_team, probability: game.pregame_away_win_probability, gameTime: game.game_time_utc, opponentId: game.homeTeam.id });
  }
  return context;
}

async function fetchVsOpponent(playerId: string, group: "hitting" | "pitching", opponentId: number, season: number): Promise<number | null> {
  const query = new URLSearchParams({ stats: "vsTeam", group, season: String(season), opposingTeamId: String(opponentId) });
  try {
    const response = await fetch(`${MLB_API}/people/${encodeURIComponent(playerId)}/stats?${query}`, { next: { revalidate: 3600 }, headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const payload = (await response.json()) as MlbStatsPayload;
    const stat = payload.stats?.[0]?.splits?.[0]?.stat;
    if (!stat) return null;
    const appearances = Math.max(1, numberValue(stat, group === "hitting" ? "gamesPlayed" : "gamesPitched"));
    return group === "hitting" ? numberValue(stat, "hits") / appearances : numberValue(stat, "strikeOuts") / appearances;
  } catch {
    return null;
  }
}

function pendingFields(modelVersion: string, sampleSize: number) {
  return {
    modelVersion,
    sampleSize,
    lineSource: "model_estimate" as const,
    americanOdds: null,
    sportsbook: null,
    overOdds: null,
    underOdds: null,
    marketBooks: 0,
    marketUpdatedAt: null,
    expectedValue: null,
    status: "scheduled" as const,
    statusLabel: "Scheduled",
    actualValue: null,
    result: "pending" as const,
    resultUpdatedAt: null
  };
}

async function getMlbPlayerPicks(date: string, slateOverride?: TodayPredictionsResponse): Promise<Candidate[]> {
  const season = Number(date.slice(0, 4));
  const [slate, [seasonHitting, recentHitting, seasonPitching, recentPitching]] = await Promise.all([
    slateOverride ? Promise.resolve(slateOverride) : getPredictions(date),
    Promise.all([
      fetchMlbStats("hitting", "season", season),
      fetchMlbStats("hitting", "lastXGames", season),
      fetchMlbStats("pitching", "season", season),
      fetchMlbStats("pitching", "lastXGames", season)
    ])
  ]);
  const teamContext = mlbTeamContext(slate.predictions);
  const recentHitters = new Map(recentHitting.map((split) => [String(split.player?.id), split]));
  const recentPitchers = new Map(recentPitching.map((split) => [String(split.player?.id), split]));
  const candidates: Candidate[] = [];

  for (const split of seasonHitting) {
    const playerId = String(split.player?.id ?? "");
    const playerName = split.player?.fullName;
    const team = split.team?.name;
    const context = team ? teamContext.get(team) : undefined;
    if (!playerId || !playerName || !team || !context) continue;
    const recent = recentHitters.get(playerId)?.stat;
    const games = Math.max(1, numberValue(split.stat, "gamesPlayed"));
    const recentGames = Math.max(1, numberValue(recent, "gamesPlayed"));
    const matchupFactor = 0.9 + context.probability * 0.2;
    const props = [
      ["Hits", 0.5, numberValue(split.stat, "hits") / games, numberValue(recent, "hits") / recentGames],
      ["Total bases", 1.5, numberValue(split.stat, "totalBases") / games, numberValue(recent, "totalBases") / recentGames],
      ["Home runs", 0.5, numberValue(split.stat, "homeRuns") / games, numberValue(recent, "homeRuns") / recentGames],
      ["RBIs", 0.5, numberValue(split.stat, "rbi") / games, numberValue(recent, "rbi") / recentGames]
    ] as const;
    for (const [market, line, seasonRate, recentRate] of props) {
      const projection = (seasonRate * 0.58 + recentRate * 0.42) * matchupFactor;
      candidates.push(baseCandidate({
        id: `mlb-${context.gameId}-${playerId}-${market.toLowerCase().replace(/\s/g, "-")}`,
        sport: "mlb",
        gameId: context.gameId,
        playerId,
        playerName,
        headshotUrl: `https://img.mlbstatic.com/mlb-photos/image/upload/w_240,q_auto:best/v1/people/${playerId}/headshot/67/current`,
        position: split.position?.abbreviation ?? null,
        team,
        opponent: context.opponent,
        gameTime: context.gameTime,
        market,
        line,
        group: "hitting",
        ...pendingFields("mlb-player-blend-v2", Math.round(games))
      }, projection, seasonRate, recentRate, context.probability));
    }
  }

  const probableNames = new Set(slate.predictions.flatMap((game) => [game.homeProbablePitcher, game.awayProbablePitcher].filter((name): name is string => Boolean(name))));
  for (const split of seasonPitching) {
    const playerId = String(split.player?.id ?? "");
    const playerName = split.player?.fullName;
    const team = split.team?.name;
    const context = team ? teamContext.get(team) : undefined;
    if (!playerId || !playerName || !team || !context || !probableNames.has(playerName)) continue;
    const recent = recentPitchers.get(playerId)?.stat;
    const games = Math.max(1, numberValue(split.stat, "gamesStarted") || numberValue(split.stat, "gamesPitched"));
    const recentGames = Math.max(1, numberValue(recent, "gamesStarted") || numberValue(recent, "gamesPitched"));
    const seasonRate = numberValue(split.stat, "strikeOuts") / games;
    const recentRate = numberValue(recent, "strikeOuts") / recentGames;
    const projection = (seasonRate * 0.58 + recentRate * 0.42) * (0.95 + context.probability * 0.1);
    candidates.push(baseCandidate({
      id: `mlb-${context.gameId}-${playerId}-strikeouts`, sport: "mlb", gameId: context.gameId, playerId, playerName,
      headshotUrl: `https://img.mlbstatic.com/mlb-photos/image/upload/w_240,q_auto:best/v1/people/${playerId}/headshot/67/current`,
      position: "P", team, opponent: context.opponent, gameTime: context.gameTime, market: "Strikeouts", line: 4.5, group: "pitching",
      ...pendingFields("mlb-player-blend-v2", Math.round(games))
    }, projection, seasonRate, recentRate, context.probability));
  }

  const initial = candidates.toSorted((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).slice(0, 60);
  await Promise.all(initial.slice(0, 20).map(async (pick) => {
    const context = teamContext.get(pick.team);
    if (!context || !pick.group) return;
    const opponentRate = await fetchVsOpponent(pick.playerId, pick.group, context.opponentId, season);
    if (opponentRate !== null) pick.supportingStats.push(`${opponentRate.toFixed(2)} relevant results per game vs ${pick.opponent}`);
  }));
  return diversify(initial);
}

function diversify(candidates: Candidate[]): Candidate[] {
  const ordered = candidates.toSorted((a, b) =>
    (b.confidence ?? 0) - (a.confidence ?? 0) ||
    (b.expectedValue ?? Number.NEGATIVE_INFINITY) - (a.expectedValue ?? Number.NEGATIVE_INFINITY) ||
    Math.abs(b.modelEdge ?? 0) - Math.abs(a.modelEdge ?? 0)
  );
  const selected: Candidate[] = [];
  const selectedIds = new Set<string>();
  const playerCounts = new Map<string, number>();
  const marketCounts = new Map<string, number>();
  const add = (pick: Candidate) => {
    selected.push(pick);
    selectedIds.add(pick.id);
    playerCounts.set(pick.playerId, (playerCounts.get(pick.playerId) ?? 0) + 1);
    marketCounts.set(pick.market, (marketCounts.get(pick.market) ?? 0) + 1);
  };
  for (const pick of ordered) {
    if (selected.length >= TOP_PLAYER_PICK_COUNT) break;
    if ((playerCounts.get(pick.playerId) ?? 0) >= 1 || (marketCounts.get(pick.market) ?? 0) >= 2) continue;
    add(pick);
  }
  for (const pick of ordered) {
    if (selected.length >= TOP_PLAYER_PICK_COUNT + FREE_PLAYER_PICK_COUNT) break;
    if (selectedIds.has(pick.id) || (playerCounts.get(pick.playerId) ?? 0) >= 1 || (marketCounts.get(pick.market) ?? 0) >= 3) continue;
    add(pick);
  }
  for (const pick of ordered) {
    if (selected.length >= MAX_PLAYER_PICK_COUNT) break;
    if (selectedIds.has(pick.id) || (playerCounts.get(pick.playerId) ?? 0) >= 2 || (marketCounts.get(pick.market) ?? 0) >= 12) continue;
    add(pick);
  }
  for (const pick of ordered) {
    if (selected.length >= MAX_PLAYER_PICK_COUNT) break;
    if (!selectedIds.has(pick.id)) add(pick);
  }
  return selected.slice(0, MAX_PLAYER_PICK_COUNT);
}

function propScale(market: string): number {
  if (market === "Passing yards") return 70;
  if (market === "Rushing yards" || market === "Receiving yards") return 32;
  if (market === "Receptions") return 2.5;
  if (market === "Passing touchdowns") return 1.25;
  if (market === "Strikeouts") return 2.5;
  return 1;
}

function applyMarketQuotes(candidates: Candidate[], quotes: Map<string, PlayerPropQuote>): Candidate[] {
  return candidates.map((candidate) => {
    const quote = quotes.get(playerPropKey(candidate.gameId, candidate.playerName, candidate.market));
    if (!quote || candidate.projection === null) return candidate;
    const edge = candidate.projection - quote.line;
    const selection = edge >= 0 ? "Over" as const : "Under" as const;
    const modelSideProbability = confidenceFromEdge(edge, candidate.sampleSize, propScale(candidate.market));
    const marketSideProbability = selection === "Over" ? quote.fairOverProbability : 1 - quote.fairOverProbability;
    const confidence = Number(Math.max(0.51, Math.min(0.84, modelSideProbability * 0.75 + marketSideProbability * 0.25)).toFixed(4));
    const americanOdds = selection === "Over" ? quote.overAmericanOdds : quote.underAmericanOdds;
    const sportsbook = selection === "Over" ? quote.overBook : quote.underBook;
    const expectedValue = americanOdds === null ? null : Number((confidence * americanToDecimal(americanOdds) - 1).toFixed(4));
    const priceLabel = americanOdds === null ? "price unavailable" : `${americanOdds > 0 ? "+" : ""}${americanOdds}${sportsbook ? ` at ${sportsbook}` : ""}`;
    return {
      ...candidate,
      selection,
      line: quote.line,
      confidence,
      modelEdge: Number(edge.toFixed(candidate.sport === "mlb" ? 2 : 1)),
      lineSource: "sportsbook_consensus" as const,
      americanOdds,
      sportsbook,
      overOdds: quote.overAmericanOdds,
      underOdds: quote.underAmericanOdds,
      marketBooks: quote.books,
      marketUpdatedAt: quote.updatedAt,
      expectedValue,
      modelVersion: `${candidate.modelVersion}+market-v1`,
      supportingStats: [
        ...candidate.supportingStats.filter((item) => !item.includes("model edge vs line")),
        `${edge >= 0 ? "+" : ""}${edge.toFixed(candidate.sport === "mlb" ? 2 : 1)} model edge vs consensus line`,
        `${quote.books} sportsbook${quote.books === 1 ? "" : "s"} at the selected line`,
        `Best captured ${selection.toLowerCase()} price: ${priceLabel}`
      ],
      explanation: `${selection} ${quote.line} uses the most widely posted line across ${quote.books} sportsbook${quote.books === 1 ? "" : "s"}. Confidence blends the pregame projection with the no-vig market consensus; ${priceLabel} was the best captured price for this side.`
    };
  });
}

async function fetchNflSeason(year: number): Promise<EspnEvent[]> {
  try {
    return await fetchEspnNflSeason<EspnEvent>(year);
  } catch {
    return [];
  }
}

async function fetchNflSummary(gameId: string): Promise<EspnSummary | null> {
  try {
    const response = await fetch(`${ESPN_NFL_BASE}/summary?event=${encodeURIComponent(gameId)}`, { next: { revalidate: 300 }, headers: ESPN_NFL_HEADERS, signal: AbortSignal.timeout(10_000) });
    return response.ok ? await response.json() as EspnSummary : null;
  } catch {
    return null;
  }
}

function numericStat(value: string | undefined): number {
  if (!value || value.includes("/")) return 0;
  const parsed = Number(value.replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function inferredPosition(group: string): string | null {
  if (group === "passing") return "QB";
  if (group === "rushing") return "RB";
  if (group === "receiving") return "WR/TE";
  return null;
}

function extractNflBoxscore(summary: EspnSummary | null, teamId: string): Map<string, { athlete: EspnAthlete; values: Map<string, number>; position: string | null }> {
  const players = new Map<string, { athlete: EspnAthlete; values: Map<string, number>; position: string | null }>();
  const team = summary?.boxscore?.players?.find((group) => group.team?.id === teamId);
  for (const group of team?.statistics ?? []) {
    const name = group.name ?? "";
    if (!["passing", "rushing", "receiving"].includes(name)) continue;
    const labels = group.labels ?? [];
    for (const entry of group.athletes ?? []) {
      const athlete = entry.athlete;
      if (!athlete?.id || !athlete.displayName) continue;
      const record = players.get(athlete.id) ?? { athlete, values: new Map<string, number>(), position: athlete.position?.abbreviation ?? inferredPosition(name) };
      const stat = (label: string) => numericStat(entry.stats?.[labels.indexOf(label)]);
      if (name === "passing") {
        record.values.set("Passing yards", stat("YDS"));
        record.values.set("Passing touchdowns", stat("TD"));
      } else if (name === "rushing") {
        record.values.set("Rushing yards", stat("YDS"));
        record.values.set("Anytime touchdown", (record.values.get("Anytime touchdown") ?? 0) + stat("TD"));
      } else if (name === "receiving") {
        record.values.set("Receptions", stat("REC"));
        record.values.set("Receiving yards", stat("YDS"));
        record.values.set("Anytime touchdown", (record.values.get("Anytime touchdown") ?? 0) + stat("TD"));
      }
      players.set(athlete.id, record);
    }
  }
  return players;
}

function eventHasTeam(event: EspnEvent, teamId: string): boolean {
  return event.competitions?.[0]?.competitors?.some((team) => (team.id ?? team.team?.id) === teamId) ?? false;
}

function nflLine(market: string, average: number): { line: number; scale: number } {
  if (market === "Passing yards") return { line: Math.max(174.5, Math.min(299.5, Math.round(average / 25) * 25 - 0.5)), scale: 70 };
  if (market === "Rushing yards" || market === "Receiving yards") return { line: Math.max(19.5, Math.min(99.5, Math.round(average / 10) * 10 - 0.5)), scale: 32 };
  if (market === "Receptions") return { line: Math.max(1.5, Math.min(7.5, Math.round(average) - 0.5)), scale: 2.5 };
  if (market === "Passing touchdowns") return { line: average >= 2.25 ? 2.5 : 1.5, scale: 1.25 };
  return { line: 0.5, scale: 0.75 };
}

async function teamForms(teamId: string, gameTime: string, events: EspnEvent[], summaries: Map<string, EspnSummary | null>): Promise<Map<string, NflPlayerForm>> {
  const priorEvents = events
    .filter((event) => event.id && event.date && event.date < gameTime && (event.status?.type?.completed || event.status?.type?.state === "post") && eventHasTeam(event, teamId))
    .toSorted((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .slice(-8);
  const forms = new Map<string, NflPlayerForm>();
  for (const event of priorEvents) {
    if (!event.id) continue;
    for (const [playerId, record] of extractNflBoxscore(summaries.get(event.id) ?? null, teamId)) {
      const form = forms.get(playerId) ?? {
        playerId,
        playerName: record.athlete.displayName ?? record.athlete.fullName ?? "NFL player",
        headshotUrl: record.athlete.headshot?.href ?? `https://a.espncdn.com/i/headshots/nfl/players/full/${playerId}.png`,
        position: record.position,
        values: new Map<string, number[]>()
      };
      for (const [market, value] of record.values) form.values.set(market, [...(form.values.get(market) ?? []), value]);
      forms.set(playerId, form);
    }
  }
  return forms;
}

async function getNflPlayerPicks(date: string, slateOverride?: TodayPredictionsResponse): Promise<Candidate[]> {
  const slate = slateOverride ?? await getNflPredictions(date);
  const scheduled = slate.predictions.filter((game) => pickStatus(game.status, game.is_final) === "scheduled" && game.game_time_utc);
  if (scheduled.length === 0) return [];
  const season = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 3 ? 1 : 0);
  const events = (await Promise.all([fetchNflSeason(season - 1), fetchNflSeason(season)])).flat();
  const priorEventIds = new Set<string>();
  for (const game of scheduled) {
    for (const teamId of [String(game.homeTeam.id), String(game.awayTeam.id)]) {
      events
        .filter((event) => event.id && event.date && event.date < (game.game_time_utc ?? "") && (event.status?.type?.completed || event.status?.type?.state === "post") && eventHasTeam(event, teamId))
        .toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
        .slice(0, 8)
        .forEach((event) => { if (event.id) priorEventIds.add(event.id); });
    }
  }
  const summaries = new Map(await Promise.all([...priorEventIds].map(async (id) => [id, await fetchNflSummary(id)] as const)));
  const candidates: Candidate[] = [];
  for (const game of scheduled) {
    const sides = [
      { teamId: String(game.homeTeam.id), team: game.home_team, opponent: game.away_team, probability: game.pregame_home_win_probability, record: game.homeTeam.record },
      { teamId: String(game.awayTeam.id), team: game.away_team, opponent: game.home_team, probability: game.pregame_away_win_probability, record: game.awayTeam.record }
    ];
    for (const side of sides) {
      const forms = await teamForms(side.teamId, game.game_time_utc!, events, summaries);
      for (const form of forms.values()) {
        for (const [market, values] of form.values) {
          if (values.length === 0) continue;
          const eightGameAverage = values.reduce((sum, value) => sum + value, 0) / values.length;
          const lastThree = values.slice(-3);
          const threeGameAverage = lastThree.reduce((sum, value) => sum + value, 0) / lastThree.length;
          const formAverage = threeGameAverage * 0.62 + eightGameAverage * 0.38;
          if (formAverage <= 0 && market !== "Anytime touchdown") continue;
          const projection = formAverage * (0.94 + side.probability * 0.12);
          const { line, scale } = nflLine(market, formAverage);
          const edge = projection - line;
          const selection = edge >= 0 ? "Over" : "Under";
          const variance = values.reduce((sum, value) => sum + (value - eightGameAverage) ** 2, 0) / values.length;
          candidates.push({
            id: `nfl-${game.gameId}-${form.playerId}-${market.toLowerCase().replace(/\s/g, "-")}`,
            sport: "nfl", gameId: game.gameId, playerId: form.playerId, playerName: form.playerName, headshotUrl: form.headshotUrl,
            position: form.position, team: side.team, opponent: side.opponent, gameTime: game.game_time_utc, market, selection, line,
            projection: Number(projection.toFixed(1)), confidence: confidenceFromEdge(edge, values.length, scale), modelEdge: Number(edge.toFixed(1)),
            supportingStats: [
              `${threeGameAverage.toFixed(1)} average over the last ${lastThree.length}`,
              `${eightGameAverage.toFixed(1)} average over ${values.length} available game${values.length === 1 ? "" : "s"}`,
              `${Math.sqrt(variance).toFixed(1)} game-to-game volatility`,
              `${values.at(-1)?.toFixed(1) ?? "0.0"} in the latest game`,
              `${edge >= 0 ? "+" : ""}${edge.toFixed(1)} model edge vs line`,
              `${Math.round(side.probability * 100)}% team win chance`, `${side.record} team record`
            ],
            explanation: `${selection} ${line} is the calibrated side after weighting short-term form against up to eight games, role continuity, volatility, 15-season team strength, and the ${side.opponent} matchup. Small samples are deliberately confidence-capped.`,
            ...pendingFields("nfl-player-form-v3", values.length)
          });
        }
      }
    }
  }
  return diversify([...new Map(candidates.map((pick) => [pick.id, pick])).values()]);
}

function rankCandidates(candidates: Candidate[]): PlayerPick[] {
  return candidates.map((candidate, index) => {
    const ranked = {
      ...candidate,
      rank: index + 1,
      isTopFive: index < TOP_PLAYER_PICK_COUNT,
      is_locked: false
    } as PlayerPick & Pick<Candidate, "recentRate" | "seasonRate" | "group">;
    delete ranked.recentRate;
    delete ranked.seasonRate;
    delete ranked.group;
    return ranked;
  });
}

async function fetchMlbBoxscore(gameId: string): Promise<MlbBoxscore | null> {
  try {
    const response = await fetch(`${MLB_API}/game/${encodeURIComponent(gameId)}/boxscore`, { cache: "no-store", headers: { Accept: "application/json" } });
    return response.ok ? await response.json() as MlbBoxscore : null;
  } catch {
    return null;
  }
}

function mlbActualValue(boxscore: MlbBoxscore | null, playerId: string, market: string): { value: number | null; didPlay: boolean } {
  const players = { ...(boxscore?.teams?.away?.players ?? {}), ...(boxscore?.teams?.home?.players ?? {}) };
  const player = Object.values(players).find((entry) => String(entry.person?.id ?? "") === playerId);
  if (!player) return { value: null, didPlay: false };
  const battingKeys: Record<string, string> = { Hits: "hits", "Total bases": "totalBases", "Home runs": "homeRuns", RBIs: "rbi" };
  const key = battingKeys[market];
  if (key) return { value: numberValue(player.stats?.batting, key), didPlay: Boolean(player.stats?.batting) };
  if (market === "Strikeouts") return { value: numberValue(player.stats?.pitching, "strikeOuts"), didPlay: Boolean(player.stats?.pitching) };
  return { value: null, didPlay: false };
}

async function enrichLiveResults(picks: PlayerPick[], slate: TodayPredictionsResponse): Promise<PlayerPick[]> {
  const games = new Map(slate.predictions.map((game) => [game.gameId, game]));
  const activeGameIds = [...new Set(picks.map((pick) => pick.gameId).filter((gameId) => {
    const game = games.get(gameId);
    return game && pickStatus(game.status, game.is_final) !== "scheduled";
  }))];
  const mlbBoxes = new Map<string, MlbBoxscore | null>();
  const nflBoxes = new Map<string, EspnSummary | null>();
  await Promise.all(activeGameIds.map(async (gameId) => {
    if (slate.sport === "mlb") mlbBoxes.set(gameId, await fetchMlbBoxscore(gameId));
    else nflBoxes.set(gameId, await fetchNflSummary(gameId));
  }));
  const now = new Date().toISOString();
  return picks.map((pick) => {
    const game = games.get(pick.gameId);
    if (!game) return pick;
    const status = pickStatus(game.status, game.is_final);
    const statusLabel = game.inning ?? game.status;
    if (status === "scheduled") return { ...pick, status, statusLabel };
    let actual: { value: number | null; didPlay: boolean } = { value: null, didPlay: false };
    if (pick.sport === "mlb") actual = mlbActualValue(mlbBoxes.get(pick.gameId) ?? null, pick.playerId, pick.market);
    else {
      const teamId = pick.team === game.home_team ? String(game.homeTeam.id) : String(game.awayTeam.id);
      const record = extractNflBoxscore(nflBoxes.get(pick.gameId) ?? null, teamId).get(pick.playerId);
      actual = { value: record?.values.get(pick.market) ?? null, didPlay: Boolean(record?.values.has(pick.market)) };
    }
    return {
      ...pick, status, statusLabel, actualValue: actual.value,
      result: gradePlayerPick(pick.selection, pick.line, actual.value, status, actual.didPlay),
      resultUpdatedAt: now
    };
  });
}

export async function getPlayerPicks(sport: Sport, date: string, access: AccessState, slateOverride?: TodayPredictionsResponse): Promise<PlayerPicksResponse> {
  const slate = slateOverride ?? (sport === "nfl" ? await getNflPredictions(date) : await getPredictions(date));
  let picks = await loadPlayerPickSnapshots(sport, date);
  if (!picks?.length) {
    let candidates = sport === "nfl" ? await getNflPlayerPicks(date, slate) : await getMlbPlayerPicks(date, slate);
    const candidateGameIds = new Set(candidates.map((candidate) => candidate.gameId));
    const quotes = await getPlayerPropMarkets(sport, slate.predictions
      .filter((game) => candidateGameIds.has(game.gameId))
      .map((game) => ({ gameId: game.gameId, homeTeam: game.home_team, awayTeam: game.away_team })));
    candidates = applyMarketQuotes(candidates, quotes);
    picks = await storeInitialPlayerPicks(date, rankCandidates(diversify(candidates)));
  }
  picks = await enrichLiveResults(picks, slate);
  if (picks.some((pick) => pick.status !== "scheduled")) await updatePlayerPickResults(date, picks);
  const storedResults = await loadRecentPlayerPickResults(sport);
  const performanceSource = storedResults ?? picks.filter((pick) => pick.result !== "pending");
  return {
    sport, date, updatedAt: new Date().toISOString(), isPro: access.isPro, tier: access.tier,
    totalPicks: picks.length, topFiveCount: Math.min(TOP_PLAYER_PICK_COUNT, picks.length), freePreviewCount: FREE_PLAYER_PICK_COUNT,
    hasLiveGames: picks.some((pick) => pick.status === "live"), performance: calculatePerformance(performanceSource),
    recentResults: applyResultAccess(performanceSource, access.isPro, 24), picks: applyPlayerPickAccess(picks, access.isPro)
  };
}
