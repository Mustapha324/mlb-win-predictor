import "server-only";
import type { PlayerPick, PlayerPicksResponse } from "@/lib/api";
import { americanToImplied } from "@/lib/marketMath";
import { estimateNbaProp, parseNbaGameLog, type NbaGameLog } from "@/lib/nbaPlayerModel";
import { parseEspnPropBets, type EspnPropBetItem } from "@/lib/sportsbookPropParsing";
import { calculatePerformance, gameProgress, gradePlayerPick, livePace, mergePlayerPickResults, pickStatus, summarizeLive } from "@/lib/server/playerPickScoring";
import { loadPendingPlayerPickDates, loadPlayerPickSnapshots, loadRecentPlayerPickResults, storeInitialPlayerPicks, updatePlayerPickResults } from "@/lib/server/playerPickStore";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const VERSION = "nba-player-form-v1-experimental";
// Bounded process-only fallback; never advertised as permanent tracking.
const memoryBoards = new Map<string, PlayerPick[]>();
type Athlete = { id?: string; displayName?: string; headshot?: { href?: string }; position?: { abbreviation?: string }; status?: { type?: string }; injuries?: Array<{ status?: string }> };
type Event = { id?: string; date?: string; status?: { type?: { state?: string; completed?: boolean; shortDetail?: string } }; competitions?: Array<{ competitors?: Array<{ homeAway?: string; team?: { id?: string; displayName?: string } }> }> };
type Summary = { boxscore?: { players?: Array<{ statistics?: Array<{ labels?: string[]; athletes?: Array<{ athlete?: Athlete; stats?: string[]; didNotPlay?: boolean }> }> }> }; header?: { competitions?: Array<{ status?: { type?: { state?: string; completed?: boolean; shortDetail?: string } } }> } };
async function json<T>(url: string, seconds = 300): Promise<T | null> {
  try {
    const response = await fetch(url, { next: { revalidate: seconds }, signal: AbortSignal.timeout(10000) });
    return response.ok ? await response.json() as T : null;
  } catch { return null; }
}

async function candidates(event: Event, now: number): Promise<PlayerPick[]> {
  if (!event.id || !event.date || event.status?.type?.state !== "pre" || Date.parse(event.date) <= now || /postpon|cancel|delay|suspend/i.test(event.status?.type?.shortDetail ?? "")) return [];
  const teams = event.competitions?.[0]?.competitors ?? [];
  const [raw, ...rosters] = await Promise.all([
    process.env.SPORTSBOOK_PROPS === "off" ? Promise.resolve(null) : json<{ items?: EspnPropBetItem[] }>(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${event.id}/competitions/${event.id}/odds/100/propBets?limit=1000`),
    ...teams.map(team => json<{ athletes?: Athlete[] }>(`${SITE}/teams/${team.team?.id}/roster`, 600))
  ]);
  const board = parseEspnPropBets("nba", (raw?.items ?? []).filter(item => !!item.lastUpdated && Date.parse(item.lastUpdated) <= now && Date.parse(item.lastUpdated) < Date.parse(event.date!)));
  const season = Number(event.date.slice(0, 4)) + (Number(event.date.slice(5, 7)) >= 7 ? 1 : 0);
  const players = rosters.flatMap((roster, index) => (roster?.athletes ?? []).filter(athlete => athlete.id && board.has(athlete.id) && athlete.status?.type === "active" && !(athlete.injuries ?? []).some(injury => /out|doubtful|questionable|day.to.day|suspend/i.test(injury.status ?? ""))).map(athlete => ({ athlete, team: teams[index]?.team?.displayName ?? "", opponent: teams.find((_, other) => other !== index)?.team?.displayName ?? "" })));
  const output: PlayerPick[] = [];
  // Bound fan-out for full slates. Only players with book-listed markets are fetched.
  for (let offset = 0; offset < players.length; offset += 6) await Promise.all(players.slice(offset, offset + 6).map(async ({ athlete, team, opponent }) => {
    const current = await json<NbaGameLog>(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${athlete.id}/gamelog?season=${season}`, 1800);
    let samples = current ? parseNbaGameLog(current, event.date!) : [];
    if (samples.length < 20) {
      const previous = await json<NbaGameLog>(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${athlete.id}/gamelog?season=${season - 1}`, 86400);
      samples = [...samples, ...(previous ? parseNbaGameLog(previous, event.date!) : [])].filter((row, index, all) => all.findIndex(other => other.id === row.id) === index).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    }
    for (const [market, line] of board.get(athlete.id!) ?? []) {
      const estimate = estimateNbaProp(samples, market, line.line);
      if (!estimate || estimate.confidence < 0.54) continue;
      const odds = estimate.selection === "Over" ? line.overOdds : line.underOdds;
      if (odds === null || odds < -160) continue;
      const edge = estimate.confidence - americanToImplied(odds);
      if (edge < 0.02) continue;
      output.push({ id: `nba:${event.id}:${athlete.id}:${market}`, sport: "nba", rank: 0, gameId: event.id!, playerId: athlete.id!, playerName: athlete.displayName ?? "Player", headshotUrl: athlete.headshot?.href ?? null, position: athlete.position?.abbreviation ?? null, team, opponent, gameTime: event.date!, market, selection: estimate.selection, line: line.line, projection: Number(estimate.projection.toFixed(1)), confidence: estimate.confidence, supportingStats: [`${estimate.sampleSize} prior games`, `Projection ${estimate.projection.toFixed(1)}`, "Experimental form estimate"], explanation: "Recent completed-game form against the posted DraftKings line. Prior-season games fill early-season samples; this player model is not yet calibrated on historical prop prices.", modelVersion: VERSION, modelEdge: edge, lineSource: "sportsbook_consensus", americanOdds: odds, sportsbook: "DraftKings", overOdds: line.overOdds, underOdds: line.underOdds, marketBooks: 1, marketUpdatedAt: line.updatedAt, expectedValue: null, sampleSize: estimate.sampleSize, status: "scheduled", statusLabel: "Scheduled", actualValue: null, result: "pending", resultUpdatedAt: null, isTopFive: false, is_locked: false });
    }
  }));
  return output;
}

const LABELS: Record<string, string[]> = { Points: ["PTS"], Rebounds: ["REB"], Assists: ["AST"], "3-pointers": ["3PT"], "Points+Assists": ["PTS", "AST"], "Points+Rebounds": ["PTS", "REB"], "Rebounds+Assists": ["REB", "AST"], "Points+Rebounds+Assists": ["PTS", "REB", "AST"] };
async function grade(picks: PlayerPick[], events: Event[]): Promise<PlayerPick[]> {
  const summaries = new Map<string, Summary | null>();
  await Promise.all([...new Set(picks.filter(p => p.result === "pending" && p.gameTime && Date.parse(p.gameTime) <= Date.now()).map(p => p.gameId))].map(async id => summaries.set(id, await json<Summary>(`${SITE}/summary?event=${id}`, 30))));
  return picks.map(pick => {
    if (pick.result !== "pending") return pick;
    const event = events.find(event => event.id === pick.gameId);
    const summary = summaries.get(pick.gameId);
    const state = summary?.header?.competitions?.[0]?.status?.type ?? event?.status?.type;
    if (!state) return pick;
    const status = pickStatus(`${state.state === "in" ? "Live " : ""}${state.shortDetail ?? "Scheduled"}`, Boolean(state.completed));
    let actual: number | null = null, didPlay = false, explicitDnp = false;
    for (const team of summary?.boxscore?.players ?? []) for (const group of team.statistics ?? []) {
      const row = group.athletes?.find(row => row.athlete?.id === pick.playerId);
      if (!row) continue;
      if (row.didNotPlay) { explicitDnp = true; continue; }
      const raw = (LABELS[pick.market] ?? []).map(label => row.stats?.[group.labels?.indexOf(label) ?? -1]);
      if (raw.length && raw.every(value => value !== undefined && /^\d+(?:-\d+)?$/.test(value))) { actual = raw.reduce((sum, value) => sum + Number(value!.split("-")[0]), 0); didPlay = true; }
    }
    // A failed or partial box score stays pending; missing data must not become a void.
    const result = status === "postponed" ? "void" : status === "final" && !didPlay && !explicitDnp ? "pending" : gradePlayerPick(pick.selection, pick.line, actual, status, didPlay);
    return { ...pick, status, statusLabel: state.shortDetail ?? status, actualValue: actual, result, resultUpdatedAt: result === "pending" ? null : new Date().toISOString(), live: livePace(pick.selection, pick.line, actual, gameProgress("nba", status, state.shortDetail ?? status), status, result) };
  });
}

export async function getNbaPlayerPicks(date: string, refreshRecent = true): Promise<PlayerPicksResponse> {
  const schedule = await json<{ events?: Event[] }>(`${SITE}/scoreboard?dates=${date.replaceAll("-", "")}&limit=1000`, 60);
  if (!schedule) throw new Error("NBA schedule unavailable");
  const events = schedule.events ?? [];
  const saved = await loadPlayerPickSnapshots("nba", date);
  const existing = [...(saved ?? []), ...(memoryBoards.get(date) ?? []).filter(pick => !saved?.some(row => row.id === pick.id))];
  const now = Date.now();
  const fresh = (await Promise.all(events.filter(event => !existing.some(pick => pick.gameId === event.id)).map(event => candidates(event, now)))).flat().sort((a, b) => (b.modelEdge ?? 0) - (a.modelEdge ?? 0) || a.id.localeCompare(b.id));
  // One headline slot per player; keep the wider market board below it.
  const seen = new Set<string>();
  const headlines = fresh.filter(pick => { if (seen.has(pick.playerId)) return false; seen.add(pick.playerId); return true; }).slice(0, Math.max(0, 5 - existing.filter(pick => pick.isTopFive).length));
  const ordered = [...headlines, ...fresh.filter(pick => !headlines.includes(pick))].slice(0, Math.max(0, 50 - existing.length));
  let rank = Math.max(0, ...existing.map(pick => pick.rank));
  const additions = ordered.filter(pick => pick.gameTime && Date.parse(pick.gameTime) > Date.now()).map(pick => ({ ...pick, rank: ++rank, isTopFive: headlines.includes(pick) && rank <= 5 }));
  const stored = additions.length ? await storeInitialPlayerPicks(date, [...existing, ...additions]) : existing;
  const picks = await grade(stored, events);
  memoryBoards.set(date, picks);
  while (memoryBoards.size > 7) memoryBoards.delete(memoryBoards.keys().next().value!);
  await updatePlayerPickResults(date, picks);
  if (refreshRecent) await refreshNbaPlayerResults(date, 1);
  const history = await loadRecentPlayerPickResults("nba");
  const persisted = additions.length ? await loadPlayerPickSnapshots("nba", date) : saved;
  const trackingAvailable = persisted !== null && picks.every(pick => persisted.some(row => row.id === pick.id));
  const recentResults = mergePlayerPickResults(history ?? [], picks.filter(pick => pick.result !== "pending"));
  return { sport: "nba", date, updatedAt: new Date().toISOString(), totalPicks: picks.length, topFiveCount: picks.filter(pick => pick.isTopFive).length, hasLiveGames: picks.some(pick => pick.status === "live"), trackingAvailable, performance: calculatePerformance(recentResults), slatePerformance: calculatePerformance(picks), liveSummary: summarizeLive(picks), topFiveLive: summarizeLive(picks.filter(pick => pick.isTopFive)), lineProvider: picks.length ? "DraftKings via ESPN" : null, recentResults, picks };
}

export async function refreshNbaPlayerResults(today: string, limit = 3) {
  const dates = await loadPendingPlayerPickDates("nba", today, limit);
  await Promise.all(dates.map(date => getNbaPlayerPicks(date, false)));
  return { checkedDates: dates.length };
}
