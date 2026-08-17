import type { PlayerPick, PlayerPicksResponse, TeamPrediction, TodayPredictionsResponse } from "@/lib/api";
import type { AccessState } from "@/lib/server/access";
import { getPredictions } from "@/lib/server/mlbModel";
import { getNflPredictions } from "@/lib/server/nflModel";
import type { Sport } from "@/lib/sports";

const MLB_API = "https://statsapi.mlb.com/api/v1";
const ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";

type MlbStat = Record<string, number | string | undefined>;
type MlbSplit = {
  player?: { id?: number; fullName?: string };
  team?: { id?: number; name?: string };
  position?: { abbreviation?: string };
  stat?: MlbStat;
};
type MlbStatsPayload = { stats?: Array<{ splits?: MlbSplit[] }> };

type EspnLeader = {
  athlete?: { id?: string; displayName?: string; position?: { abbreviation?: string } };
  displayValue?: string;
  value?: number;
  statistics?: Array<{ name?: string; displayName?: string; value?: number; displayValue?: string }>;
};
type EspnLeaderCategory = { name?: string; displayName?: string; leaders?: EspnLeader[] };
type EspnSummary = {
  leaders?: Array<{ team?: { id?: string; displayName?: string }; leaders?: EspnLeaderCategory[] }>;
};

type Candidate = Omit<PlayerPick, "rank" | "is_locked"> & { recentRate?: number; seasonRate?: number; group?: "hitting" | "pitching" };

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

function candidate(
  base: Omit<Candidate, "selection" | "confidence" | "projection" | "supportingStats" | "explanation">,
  projection: number,
  seasonRate: number,
  recentRate: number,
  teamProbability: number
): Candidate {
  const overProbability = poissonOver(Math.max(0.01, projection), base.line);
  const selection = overProbability >= 0.5 ? "Over" : "Under";
  const confidence = Math.max(overProbability, 1 - overProbability);
  const lineLabel = Number.isInteger(base.line) ? base.line.toFixed(1) : String(base.line);
  const confidenceCap = base.market === "Home runs" && selection === "Under" ? 0.78 : 0.91;
  return {
    ...base,
    selection,
    projection: Number(projection.toFixed(2)),
    confidence: Number(Math.min(confidenceCap, Math.max(0.51, confidence)).toFixed(4)),
    seasonRate,
    recentRate,
    supportingStats: [
      `${seasonRate.toFixed(2)} per game this season`,
      `${recentRate.toFixed(2)} per game over the recent sample`,
      `${Math.round(teamProbability * 100)}% team win chance`
    ],
    explanation: `${selection} ${lineLabel} rates best after blending season production, recent form, and the matchup-adjusted team outlook.`
  };
}

async function fetchMlbStats(group: "hitting" | "pitching", stats: "season" | "lastXGames", season: number): Promise<MlbSplit[]> {
  const query = new URLSearchParams({
    stats,
    group,
    season: String(season),
    sportIds: "1",
    playerPool: "QUALIFIED",
    hydrate: "team",
    limit: "1000"
  });
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

function mlbTeamContext(games: TeamPrediction[]): Map<string, { opponent: string; probability: number; gameTime: string | null; opponentId: number }> {
  const context = new Map<string, { opponent: string; probability: number; gameTime: string | null; opponentId: number }>();
  for (const game of games) {
    context.set(game.home_team, { opponent: game.away_team, probability: game.pregame_home_win_probability, gameTime: game.game_time_utc, opponentId: game.awayTeam.id });
    context.set(game.away_team, { opponent: game.home_team, probability: game.pregame_away_win_probability, gameTime: game.game_time_utc, opponentId: game.homeTeam.id });
  }
  return context;
}

async function fetchVsOpponent(playerId: string, group: "hitting" | "pitching", opponentId: number, season: number): Promise<number | null> {
  const query = new URLSearchParams({ stats: "vsTeam", group, season: String(season), opposingTeamId: String(opponentId) });
  try {
    const response = await fetch(`${MLB_API}/people/${playerId}/stats?${query}`, { next: { revalidate: 3600 }, headers: { Accept: "application/json" } });
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
      candidates.push(candidate({ id: `mlb-${playerId}-${market}`, sport: "mlb", playerId, playerName, position: split.position?.abbreviation ?? null, team, opponent: context.opponent, gameTime: context.gameTime, market, line, group: "hitting" }, projection, seasonRate, recentRate, context.probability));
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
    candidates.push(candidate({ id: `mlb-${playerId}-strikeouts`, sport: "mlb", playerId, playerName, position: "P", team, opponent: context.opponent, gameTime: context.gameTime, market: "Strikeouts", line: 4.5, group: "pitching" }, projection, seasonRate, recentRate, context.probability));
  }

  const initial = candidates.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).slice(0, 28);
  await Promise.all(initial.map(async (pick) => {
    const context = teamContext.get(pick.team);
    if (!context || !pick.group) return;
    const opponentRate = await fetchVsOpponent(pick.playerId, pick.group, context.opponentId, season);
    if (opponentRate === null) return;
    pick.supportingStats.push(`${opponentRate.toFixed(2)} relevant results per game vs ${pick.opponent}`);
    pick.explanation = `${pick.explanation} Historical results against ${pick.opponent} also inform the ranking.`;
  }));
  return diversify(initial);
}

function diversify(candidates: Candidate[]): Candidate[] {
  const ordered = candidates.toSorted((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
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
    if (selected.length >= 5) break;
    if ((playerCounts.get(pick.playerId) ?? 0) >= 1 || (marketCounts.get(pick.market) ?? 0) >= 2) continue;
    add(pick);
  }
  for (const pick of ordered) {
    if (selected.length >= 20) break;
    if (selectedIds.has(pick.id) || (playerCounts.get(pick.playerId) ?? 0) >= 2 || (marketCounts.get(pick.market) ?? 0) >= 5) continue;
    add(pick);
  }
  for (const pick of ordered) {
    if (selected.length >= 20) break;
    if (!selectedIds.has(pick.id)) add(pick);
  }
  return selected.slice(0, 20);
}

function extractLeaderValue(leader: EspnLeader): number {
  if (typeof leader.value === "number") return leader.value;
  const fromStats = leader.statistics?.find((stat) => typeof stat.value === "number")?.value;
  if (typeof fromStats === "number") return fromStats;
  const text = leader.displayValue ?? leader.statistics?.[0]?.displayValue ?? "0";
  const value = Number(text.replace(/,/g, "").match(/[\d.]+/)?.[0] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function nflMarket(category: string): { market: string; line: number; scale: number } | null {
  const value = category.toLowerCase().replace(/[^a-z]/g, "");
  if (value.includes("passingyard")) return { market: "Passing yards", line: 249.5, scale: 85 };
  if (value.includes("rushingyard")) return { market: "Rushing yards", line: 49.5, scale: 40 };
  if (value.includes("receivingyard")) return { market: "Receiving yards", line: 49.5, scale: 40 };
  if (value.includes("reception")) return { market: "Receptions", line: 4.5, scale: 3 };
  if (value.includes("passingtouchdown")) return { market: "Passing touchdowns", line: 1.5, scale: 1.5 };
  if (value.includes("touchdown")) return { market: "Anytime touchdown", line: 0.5, scale: 0.8 };
  return null;
}

async function fetchNflSummary(gameId: string): Promise<EspnSummary | null> {
  try {
    const response = await fetch(`${ESPN_SUMMARY}?event=${encodeURIComponent(gameId)}`, { next: { revalidate: 900 }, headers: { Accept: "application/json" } });
    return response.ok ? await response.json() as EspnSummary : null;
  } catch {
    return null;
  }
}

async function getNflPlayerPicks(date: string, slateOverride?: TodayPredictionsResponse): Promise<Candidate[]> {
  const slate = slateOverride ?? await getNflPredictions(date);
  const summaries = await Promise.all(slate.predictions.map(async (game) => [game, await fetchNflSummary(game.gameId)] as const));
  const candidates: Candidate[] = [];
  for (const [game, summary] of summaries) {
    for (const teamGroup of summary?.leaders ?? []) {
      const teamId = teamGroup.team?.id;
      const isHome = teamId === String(game.homeTeam.id) || teamGroup.team?.displayName === game.home_team;
      const team = isHome ? game.home_team : game.away_team;
      const opponent = isHome ? game.away_team : game.home_team;
      const probability = isHome ? game.pregame_home_win_probability : game.pregame_away_win_probability;
      const record = isHome ? game.homeTeam.record : game.awayTeam.record;
      const gamesPlayed = Math.max(1, record.split("-").map(Number).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0));
      for (const category of teamGroup.leaders ?? []) {
        const config = nflMarket(`${category.name ?? ""} ${category.displayName ?? ""}`);
        if (!config) continue;
        for (const leader of category.leaders?.slice(0, 2) ?? []) {
          if (!leader.athlete?.id || !leader.athlete.displayName) continue;
          const seasonTotal = extractLeaderValue(leader);
          const perGame = seasonTotal / gamesPlayed;
          const projection = perGame * (0.9 + probability * 0.2);
          const distance = (projection - config.line) / config.scale;
          const overProbability = 1 / (1 + Math.exp(-distance));
          const selection = overProbability >= 0.5 ? "Over" : "Under";
          const confidence = Math.min(0.88, Math.max(0.51, Math.max(overProbability, 1 - overProbability)));
          candidates.push({
            id: `nfl-${leader.athlete.id}-${config.market}`,
            sport: "nfl",
            playerId: leader.athlete.id,
            playerName: leader.athlete.displayName,
            position: leader.athlete.position?.abbreviation ?? null,
            team,
            opponent,
            gameTime: game.game_time_utc,
            market: config.market,
            selection,
            line: config.line,
            projection: Number(projection.toFixed(1)),
            confidence: Number(confidence.toFixed(4)),
            supportingStats: [`${perGame.toFixed(1)} per game this season`, `${Math.round(probability * 100)}% team win chance`, `${record} team record`],
            explanation: `${selection} ${config.line} ranks best after weighting season production, recent team form, home/away context, and the ${opponent} matchup.`
          });
        }
      }
    }
  }
  const deduped = [...new Map(candidates.map((pick) => [pick.id, pick])).values()];
  return diversify(deduped);
}

function applyAccess(candidates: Candidate[], access: AccessState): PlayerPick[] {
  return candidates.map((candidate, index) => {
    const locked = !access.isPro && index >= 5;
    const base: PlayerPick = { ...candidate, rank: index + 1, is_locked: locked };
    if (access.isPro) return base;
    if (!locked) return { ...base, explanation: null, supportingStats: base.supportingStats.slice(0, 1) };
    return { ...base, projection: null, confidence: null, supportingStats: [], explanation: null, playerName: "Pro player pick", selection: "Over" };
  });
}

export async function getPlayerPicks(sport: Sport, date: string, access: AccessState, slate?: TodayPredictionsResponse): Promise<PlayerPicksResponse> {
  const candidates = sport === "nfl" ? await getNflPlayerPicks(date, slate) : await getMlbPlayerPicks(date, slate);
  return { sport, date, updatedAt: new Date().toISOString(), isPro: access.isPro, picks: applyAccess(candidates, access) };
}
