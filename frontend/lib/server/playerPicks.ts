import "server-only";
import type { PlayerPick, PlayerPicksResponse, TeamPrediction, TodayPredictionsResponse } from "@/lib/api";
import { americanToDecimal, playerPropKey, type PlayerPropQuote } from "@/lib/playerPropOdds";
import type { AccessState } from "@/lib/server/access";
import { getPredictions } from "@/lib/server/mlbModel";
import { getNflPredictions } from "@/lib/server/nflModel";
import { getPlayerPropMarkets } from "@/lib/server/marketOdds";
import { fetchEspnNflSeason, fetchEspnNflSummary } from "@/lib/server/espnNflFeed";
import {
  applyPlayerPickAccess,
  applyResultAccess,
  FREE_PLAYER_PICK_COUNT,
  MAX_PLAYER_PICK_COUNT,
  TOP_PLAYER_PICK_COUNT
} from "@/lib/server/playerPickAccess";
import { calculatePerformance, confidenceFromEdge, gradePlayerPick, mergePlayerPickResults, pickStatus } from "@/lib/server/playerPickScoring";
import { getDfsBoard, normalizePlayerName, type DfsBoardProp } from "@/lib/server/dfsBoards";
import {
  diversifyBoard,
  isBoardRealisticConfidence,
  isBoardSelectionAllowed,
  MAX_REAL_BOARD_CONFIDENCE,
  MIN_RARE_OVER_PROBABILITY,
  MLB_HITTER_MARKETS,
  MLB_PITCHER_MARKETS,
  mlbBoardLine,
  NFL_MARKETS,
  nflBoardLine,
  RARE_EVENT_MARKETS,
  type BoardMarketKind
} from "@/lib/server/propBoardCatalog";
import {
  loadPlayerPickSnapshots,
  loadPendingPlayerPickDates,
  loadRecentPlayerPickResults,
  storeInitialPlayerPicks,
  updatePlayerPickResults
} from "@/lib/server/playerPickStore";
import { hasSupabaseAdminCredentials } from "@/lib/supabase/admin";
import type { Sport } from "@/lib/sports";

const MLB_API = "https://statsapi.mlb.com/api/v1";

function easternToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

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

function boardStatChip(boardProp: DfsBoardProp | undefined): string[] {
  return boardProp ? [`Live on the ${boardProp.sources.join(" + ")} board${boardProp.sources.length > 1 ? "s" : ""}`] : [];
}

/**
 * Builds a pick only when it is a proposition a DFS board would sell at full
 * payout: rare-event markets stay over-only longshot boosts, 0.5-line unders
 * are refused, and standard picks must land in the contested-probability band.
 */
function baseCandidate(
  base: Omit<Candidate, "selection" | "confidence" | "projection" | "supportingStats" | "explanation" | "modelEdge">,
  projection: number,
  seasonRate: number,
  recentRate: number,
  teamProbability: number,
  kind: BoardMarketKind,
  boardProp?: DfsBoardProp
): Candidate | null {
  const line = boardProp?.line ?? base.line;
  const overProbability = poissonOver(Math.max(0.01, projection), line);
  const edge = projection - line;
  if (kind === "rare") {
    if (overProbability < MIN_RARE_OVER_PROBABILITY) return null;
    return {
      ...base,
      line,
      selection: "Over",
      projection: Number(projection.toFixed(2)),
      confidence: Number(overProbability.toFixed(4)),
      modelEdge: Number(edge.toFixed(2)),
      seasonRate,
      recentRate,
      supportingStats: [
        ...boardStatChip(boardProp),
        `${seasonRate.toFixed(2)} per game this season`,
        `${recentRate.toFixed(2)} per game over the last 10`,
        `${Math.round(overProbability * 100)}% model chance of the over`
      ],
      explanation: `Boost-style pick: boards list ${base.market.toLowerCase()} over-only with elevated payouts, so it is shown for this genuinely elite rate but ranked below the standard board as a longshot.`
    };
  }
  const selection: "Over" | "Under" = overProbability >= 0.5 ? "Over" : "Under";
  if (!isBoardSelectionAllowed(base.market, line, selection)) return null;
  const confidence = Math.min(MAX_REAL_BOARD_CONFIDENCE, Math.max(overProbability, 1 - overProbability));
  if (!isBoardRealisticConfidence(confidence, Boolean(boardProp))) return null;
  return {
    ...base,
    line,
    selection,
    projection: Number(projection.toFixed(2)),
    confidence: Number(confidence.toFixed(4)),
    modelEdge: Number(edge.toFixed(2)),
    seasonRate,
    recentRate,
    supportingStats: [
      ...boardStatChip(boardProp),
      `${seasonRate.toFixed(2)} per game this season`,
      `${recentRate.toFixed(2)} per game over the last 10`,
      `${edge >= 0 ? "+" : ""}${edge.toFixed(2)} model edge vs line`,
      `${Math.round(teamProbability * 100)}% team win chance`
    ],
    explanation: `${selection} ${line} is the stronger side of a board-realistic line after blending season production, recent form, and the matchup-adjusted team outlook.${boardProp ? "" : " The line mirrors standard DFS board conventions for this market."}`
  };
}

/** Converts MLB innings-pitched notation (e.g. "175.2" = 175 IP + 2 outs) to total outs. */
function inningsToOuts(value: number | string | undefined): number {
  const [whole = "0", fraction = "0"] = String(value ?? "0").split(".");
  const innings = Number(whole);
  const outs = Number(fraction);
  if (!Number.isFinite(innings)) return 0;
  return innings * 3 + (Number.isFinite(outs) ? Math.min(2, outs) : 0);
}

/** Allowed-stat projections shrink as the pitcher's team gets stronger; strikeouts and outs grow mildly. */
function pitcherMatchupFactor(market: string, probability: number): number {
  if (market === "Earned runs allowed" || market === "Hits allowed" || market === "Walks allowed") {
    return 1.08 - probability * 0.16;
  }
  return 0.95 + probability * 0.1;
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
  const scheduledGames = slate.predictions.filter((game) => pickStatus(game.status, game.is_final) === "scheduled");
  const dfsBoard = await getDfsBoard("mlb", scheduledGames.map((game) => ({ homeTeam: game.home_team, awayTeam: game.away_team })));
  const recentHitters = new Map(recentHitting.map((split) => [String(split.player?.id), split]));
  const recentPitchers = new Map(recentPitching.map((split) => [String(split.player?.id), split]));
  const candidates: Candidate[] = [];

  const hitterRates = (stat: MlbStat | undefined, games: number): Record<string, number> => ({
    Hits: numberValue(stat, "hits") / games,
    "Total bases": numberValue(stat, "totalBases") / games,
    "Hits+Runs+RBIs": (numberValue(stat, "hits") + numberValue(stat, "runs") + numberValue(stat, "rbi")) / games,
    RBIs: numberValue(stat, "rbi") / games,
    Runs: numberValue(stat, "runs") / games,
    "Home runs": numberValue(stat, "homeRuns") / games,
    "Stolen bases": numberValue(stat, "stolenBases") / games
  });

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
    const seasonRates = hitterRates(split.stat, games);
    const recentRates = hitterRates(recent, recentGames);
    const boardMarkets = dfsBoard.get(normalizePlayerName(playerName));
    for (const definition of MLB_HITTER_MARKETS) {
      const seasonRate = seasonRates[definition.market];
      const recentRate = recentRates[definition.market];
      const projection = (seasonRate * 0.58 + recentRate * 0.42) * matchupFactor;
      const boardProp = boardMarkets?.get(definition.market);
      const line = boardProp?.line ?? mlbBoardLine(definition, projection);
      if (line === null) continue;
      const candidate = baseCandidate({
        id: `mlb-${context.gameId}-${playerId}-${definition.market.toLowerCase().replace(/[\s+]/g, "-")}`,
        sport: "mlb",
        gameId: context.gameId,
        playerId,
        playerName,
        headshotUrl: `https://img.mlbstatic.com/mlb-photos/image/upload/w_240,q_auto:best/v1/people/${playerId}/headshot/67/current`,
        position: split.position?.abbreviation ?? null,
        team,
        opponent: context.opponent,
        gameTime: context.gameTime,
        market: definition.market,
        line,
        group: "hitting",
        ...pendingFields("mlb-player-board-v3", Math.round(games))
      }, projection, seasonRate, recentRate, context.probability, definition.kind, boardProp);
      if (candidate) candidates.push(candidate);
    }
  }

  const pitcherRates = (stat: MlbStat | undefined, starts: number): Record<string, number> => ({
    Strikeouts: numberValue(stat, "strikeOuts") / starts,
    "Pitching outs": inningsToOuts(stat?.inningsPitched) / starts,
    "Earned runs allowed": numberValue(stat, "earnedRuns") / starts,
    "Hits allowed": numberValue(stat, "hits") / starts,
    "Walks allowed": numberValue(stat, "baseOnBalls") / starts
  });

  const probableNames = new Set(slate.predictions.flatMap((game) => [game.homeProbablePitcher, game.awayProbablePitcher].filter((name): name is string => Boolean(name))));
  for (const split of seasonPitching) {
    const playerId = String(split.player?.id ?? "");
    const playerName = split.player?.fullName;
    const team = split.team?.name;
    const context = team ? teamContext.get(team) : undefined;
    if (!playerId || !playerName || !team || !context || !probableNames.has(playerName)) continue;
    const recent = recentPitchers.get(playerId)?.stat;
    const starts = Math.max(1, numberValue(split.stat, "gamesStarted") || numberValue(split.stat, "gamesPitched"));
    const recentStarts = Math.max(1, numberValue(recent, "gamesStarted") || numberValue(recent, "gamesPitched"));
    const seasonRates = pitcherRates(split.stat, starts);
    const recentRates = pitcherRates(recent, recentStarts);
    const boardMarkets = dfsBoard.get(normalizePlayerName(playerName));
    for (const definition of MLB_PITCHER_MARKETS) {
      const seasonRate = seasonRates[definition.market];
      const recentRate = recentRates[definition.market];
      const projection = (seasonRate * 0.58 + recentRate * 0.42) * pitcherMatchupFactor(definition.market, context.probability);
      const boardProp = boardMarkets?.get(definition.market);
      const line = boardProp?.line ?? mlbBoardLine(definition, projection);
      if (line === null) continue;
      const candidate = baseCandidate({
        id: `mlb-${context.gameId}-${playerId}-${definition.market.toLowerCase().replace(/[\s+]/g, "-")}`,
        sport: "mlb", gameId: context.gameId, playerId, playerName,
        headshotUrl: `https://img.mlbstatic.com/mlb-photos/image/upload/w_240,q_auto:best/v1/people/${playerId}/headshot/67/current`,
        position: "P", team, opponent: context.opponent, gameTime: context.gameTime, market: definition.market, line, group: "pitching",
        ...pendingFields("mlb-player-board-v3", Math.round(starts))
      }, projection, seasonRate, recentRate, context.probability, definition.kind, boardProp);
      if (candidate) candidates.push(candidate);
    }
  }

  const byConfidence = (a: Candidate, b: Candidate) => (b.confidence ?? 0) - (a.confidence ?? 0);
  const initial = [
    ...candidates.filter((pick) => !RARE_EVENT_MARKETS.has(pick.market)).toSorted(byConfidence).slice(0, 60),
    ...candidates.filter((pick) => RARE_EVENT_MARKETS.has(pick.market)).toSorted(byConfidence).slice(0, 6)
  ];
  await Promise.all(initial.slice(0, 20).map(async (pick) => {
    const context = teamContext.get(pick.team);
    if (!context || !pick.group) return;
    const opponentRate = await fetchVsOpponent(pick.playerId, pick.group, context.opponentId, season);
    if (opponentRate !== null) pick.supportingStats.push(`${opponentRate.toFixed(2)} relevant results per game vs ${pick.opponent}`);
  }));
  return diversify(initial);
}

function diversify(candidates: Candidate[]): Candidate[] {
  return diversifyBoard(candidates, {
    top: TOP_PLAYER_PICK_COUNT,
    freePreview: FREE_PLAYER_PICK_COUNT,
    maximum: MAX_PLAYER_PICK_COUNT
  });
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
  return fetchEspnNflSummary<EspnSummary>(gameId);
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
        const [completions, attempts] = (entry.stats?.[labels.indexOf("C/ATT")] ?? "").split("/").map(Number);
        if (Number.isFinite(completions)) record.values.set("Completions", completions);
        if (Number.isFinite(attempts)) record.values.set("Pass attempts", attempts);
        record.values.set("Passing yards", stat("YDS"));
        record.values.set("Passing touchdowns", stat("TD"));
      } else if (name === "rushing") {
        record.values.set("Rushing yards", stat("YDS"));
        record.values.set("Rush attempts", stat("CAR"));
        record.values.set("Rush+Rec yards", (record.values.get("Rush+Rec yards") ?? 0) + stat("YDS"));
        record.values.set("Rush+Rec TDs", (record.values.get("Rush+Rec TDs") ?? 0) + stat("TD"));
      } else if (name === "receiving") {
        record.values.set("Receptions", stat("REC"));
        record.values.set("Receiving yards", stat("YDS"));
        record.values.set("Rush+Rec yards", (record.values.get("Rush+Rec yards") ?? 0) + stat("YDS"));
        record.values.set("Rush+Rec TDs", (record.values.get("Rush+Rec TDs") ?? 0) + stat("TD"));
      }
      players.set(athlete.id, record);
    }
  }
  return players;
}

function eventHasTeam(event: EspnEvent, teamId: string): boolean {
  return event.competitions?.[0]?.competitors?.some((team) => (team.id ?? team.team?.id) === teamId) ?? false;
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
  const dfsBoard = await getDfsBoard("nfl", scheduled.map((game) => ({ homeTeam: game.home_team, awayTeam: game.away_team })));
  const candidates: Candidate[] = [];
  for (const game of scheduled) {
    const sides = [
      { teamId: String(game.homeTeam.id), team: game.home_team, opponent: game.away_team, probability: game.pregame_home_win_probability, record: game.homeTeam.record },
      { teamId: String(game.awayTeam.id), team: game.away_team, opponent: game.home_team, probability: game.pregame_away_win_probability, record: game.awayTeam.record }
    ];
    for (const side of sides) {
      const forms = await teamForms(side.teamId, game.game_time_utc!, events, summaries);
      for (const form of forms.values()) {
        const boardMarkets = dfsBoard.get(normalizePlayerName(form.playerName));
        for (const definition of NFL_MARKETS) {
          const values = form.values.get(definition.market) ?? [];
          if (values.length === 0) continue;
          const recentAverage = values.reduce((sum, value) => sum + value, 0) / values.length;
          if (recentAverage <= 0 && definition.kind !== "rare") continue;
          const projection = recentAverage * (0.94 + side.probability * 0.12);
          const boardProp = boardMarkets?.get(definition.market);
          const synthetic = nflBoardLine(definition, recentAverage);
          const line = boardProp?.line ?? synthetic?.line;
          if (line === undefined) continue;
          const edge = projection - line;
          const sharedFields = {
            id: `nfl-${game.gameId}-${form.playerId}-${definition.market.toLowerCase().replace(/[\s+]/g, "-")}`,
            sport: "nfl" as const, gameId: game.gameId, playerId: form.playerId, playerName: form.playerName, headshotUrl: form.headshotUrl,
            position: form.position, team: side.team, opponent: side.opponent, gameTime: game.game_time_utc, market: definition.market, line,
            projection: Number(projection.toFixed(1)), modelEdge: Number(edge.toFixed(1)),
            ...pendingFields("nfl-player-board-v3", values.length)
          };
          const formStats = [
            `${recentAverage.toFixed(1)} average over ${values.length} recent game${values.length === 1 ? "" : "s"}`,
            `${values.at(-1)?.toFixed(1) ?? "0.0"} in the latest game`
          ];
          if (definition.kind === "rare") {
            const overProbability = poissonOver(Math.max(0.01, projection), line);
            if (overProbability < MIN_RARE_OVER_PROBABILITY) continue;
            candidates.push({
              ...sharedFields, selection: "Over", confidence: Number(overProbability.toFixed(4)),
              supportingStats: [...boardStatChip(boardProp), ...formStats, `${Math.round(overProbability * 100)}% model chance of the over`],
              explanation: `Boost-style pick: boards list ${definition.market.toLowerCase()} over-only with elevated payouts, so it is shown for this player's genuine scoring role but ranked below the standard board as a longshot.`
            });
            continue;
          }
          const selection: "Over" | "Under" = edge >= 0 ? "Over" : "Under";
          if (!isBoardSelectionAllowed(definition.market, line, selection)) continue;
          const confidence = confidenceFromEdge(edge, values.length, synthetic?.scale ?? definition.scale);
          if (!isBoardRealisticConfidence(confidence, Boolean(boardProp))) continue;
          candidates.push({
            ...sharedFields, selection, confidence,
            supportingStats: [
              ...boardStatChip(boardProp), ...formStats,
              `${edge >= 0 ? "+" : ""}${edge.toFixed(1)} model edge vs line`,
              `${Math.round(side.probability * 100)}% team win chance`, `${side.record} team record`
            ],
            explanation: `${selection} ${line} is the calibrated side of a board-realistic line after weighting the player’s last three available games, role continuity, team strength, and the ${side.opponent} matchup. Small samples are deliberately confidence-capped.`
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
  const batting = player.stats?.batting;
  const pitching = player.stats?.pitching;
  const battingKeys: Record<string, string> = {
    Hits: "hits", "Total bases": "totalBases", "Home runs": "homeRuns", RBIs: "rbi", Runs: "runs", "Stolen bases": "stolenBases"
  };
  const battingKey = battingKeys[market];
  if (battingKey) return { value: numberValue(batting, battingKey), didPlay: Boolean(batting) };
  if (market === "Hits+Runs+RBIs") {
    return { value: numberValue(batting, "hits") + numberValue(batting, "runs") + numberValue(batting, "rbi"), didPlay: Boolean(batting) };
  }
  const pitchingKeys: Record<string, string> = {
    Strikeouts: "strikeOuts", "Earned runs allowed": "earnedRuns", "Hits allowed": "hits", "Walks allowed": "baseOnBalls"
  };
  const pitchingKey = pitchingKeys[market];
  if (pitchingKey) return { value: numberValue(pitching, pitchingKey), didPlay: Boolean(pitching) };
  if (market === "Pitching outs") {
    const outs = numberValue(pitching, "outs") || inningsToOuts(pitching?.inningsPitched);
    return { value: outs, didPlay: Boolean(pitching) };
  }
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
      // "Anytime touchdown" is the pre-board-alignment name for Rush+Rec TDs; keep old snapshots gradeable.
      const marketKey = pick.market === "Anytime touchdown" ? "Rush+Rec TDs" : pick.market;
      actual = { value: record?.values.get(marketKey) ?? null, didPlay: Boolean(record?.values.has(marketKey)) };
    }
    return {
      ...pick, status, statusLabel, actualValue: actual.value,
      result: gradePlayerPick(pick.selection, pick.line, actual.value, status, actual.didPlay),
      resultUpdatedAt: now
    };
  });
}

export async function refreshRecentPlayerPickResults(
  sport: Sport,
  beforeDate = easternToday(),
  maxDates = 1
): Promise<number> {
  const pendingDates = await loadPendingPlayerPickDates(sport, beforeDate, maxDates);
  let graded = 0;
  for (const pendingDate of pendingDates) {
    try {
      const snapshots = await loadPlayerPickSnapshots(sport, pendingDate);
      if (!snapshots?.length) continue;
      const slate = sport === "nfl" ? await getNflPredictions(pendingDate) : await getPredictions(pendingDate);
      const enriched = await enrichLiveResults(snapshots, slate);
      await updatePlayerPickResults(pendingDate, enriched);
      graded += enriched.filter((pick) => pick.result !== "pending").length;
    } catch (error) {
      console.warn("[playerPicks] recent result refresh failed", {
        sport,
        date: pendingDate,
        message: (error instanceof Error ? error.message : "Unknown refresh error").slice(0, 240)
      });
    }
  }
  return graded;
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
  await refreshRecentPlayerPickResults(sport);
  const storedResults = await loadRecentPlayerPickResults(sport);
  const performanceSource = mergePlayerPickResults(storedResults ?? [], picks);
  return {
    sport, date, updatedAt: new Date().toISOString(), isPro: access.isPro, tier: access.tier,
    totalPicks: picks.length, topFiveCount: Math.min(TOP_PLAYER_PICK_COUNT, picks.length), freePreviewCount: FREE_PLAYER_PICK_COUNT,
    hasLiveGames: picks.some((pick) => pick.status === "live"), trackingAvailable: hasSupabaseAdminCredentials(), performance: calculatePerformance(performanceSource),
    recentResults: applyResultAccess(performanceSource, access.isPro, 24), picks: applyPlayerPickAccess(picks, access.isPro)
  };
}
