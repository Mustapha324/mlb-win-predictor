import "server-only";
import { unstable_cache } from "next/cache";
import { parseEspnMoneyline, type EspnOddsLike } from "@/lib/marketMath";
import { modelProbability, ratingsBefore, type NbaResult } from "@/lib/nbaPrediction";

type Team = { id?: string; displayName?: string; abbreviation?: string; color?: string; logo?: string };
type Competitor = { homeAway?: "home" | "away"; score?: string; team?: Team; leaders?: Array<{ name?: string; leaders?: Array<{ displayValue?: string; athlete?: { id?: string; displayName?: string; headshot?: string } }> }>; records?: Array<{ type?: string; summary?: string }> };
type Event = {
  id?: string;
  date?: string;
  season?: { type?: number };
  status?: { type?: { state?: "pre" | "in" | "post"; completed?: boolean; detail?: string; shortDetail?: string } };
  competitions?: Array<{ competitors?: Competitor[]; odds?: EspnOddsLike[]; venue?: { fullName?: string } }>;
};

export type NbaGame = {
  id: string;
  tipoff: string;
  status: string;
  state: "pre" | "in" | "post";
  venue: string | null;
  players: Array<{ id: string; name: string; photo: string | null; stat: string }>;
  home: { id: string; name: string; abbreviation: string; record: string; score: number | null };
  away: { id: string; name: string; abbreviation: string; record: string; score: number | null };
  homeWinProbability: number | null;
  modelHomeProbability: number | null;
  marketHomeProbability: number | null;
  probabilitySource: string | null;
};

const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const compact = (date: string) => date.replaceAll("-", "");
const toDate = (value: Date) => value.toISOString().slice(0, 10);
const validScore = (value: string | undefined): number | null => value?.trim() && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

async function rosterPreview(teamId: string): Promise<NbaGame["players"]> {
  try {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${encodeURIComponent(teamId)}/roster`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];
    const payload = await response.json() as { athletes?: Array<{ id?: string; displayName?: string; headshot?: { href?: string }; position?: { abbreviation?: string }; status?: { type?: string } }> };
    return (payload.athletes ?? []).filter(player => player.id && player.displayName && (!player.status?.type || player.status.type === "active")).slice(0, 2).map(player => ({ id: player.id!, name: player.displayName!, photo: player.headshot?.href ?? null, stat: `${player.position?.abbreviation ?? "Player"} · roster preview` }));
  } catch {
    return [];
  }
}

async function fetchEvents(period: string, historical: boolean): Promise<Event[]> {
  const response = await fetch(`${BASE}?dates=${period}&limit=1000`, {
    ...(historical ? { cache: "no-store" as const } : { next: { revalidate: 120 } }),
    headers: { Accept: "application/json", "User-Agent": "SportIQ/2.0 (NBA predictions)" },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`NBA schedule provider returned ${response.status}.`);
  const payload = await response.json() as { events?: Event[] };
  return payload.events ?? [];
}

function monthsBetween(start: string, end: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${start.slice(0, 7)}-01T12:00:00Z`);
  const last = new Date(`${end.slice(0, 7)}-01T12:00:00Z`);
  while (cursor <= last) {
    result.push(`${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

function resultOf(event: Event): NbaResult | null {
  if (event.season?.type !== 2 && event.season?.type !== 3) return null;
  if (!event.id || !event.date || !event.status?.type?.completed) return null;
  const teams = event.competitions?.[0]?.competitors ?? [];
  const home = teams.find((team) => team.homeAway === "home");
  const away = teams.find((team) => team.homeAway === "away");
  if (!home?.score?.trim() || !away?.score?.trim()) return null;
  const homeScore = Number(home.score);
  const awayScore = Number(away?.score);
  if (!home?.team?.id || !away?.team?.id || !Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
  return { id: event.id, date: event.date, homeId: home.team.id, awayId: away.team.id, homeScore, awayScore };
}

// Monthly provider payloads exceed Next's 2 MB fetch-cache limit. Cache the
// compact completed-game rows instead of repeatedly downloading full events.
const historicalResults = unstable_cache(async (period: string) => (await fetchEvents(period, true)).map(resultOf).filter((item): item is NbaResult => item !== null), ["nba-result-history-v1"], { revalidate: 86400 });

function seasonStart(date: string): number {
  const [year, month] = date.split("-").map(Number);
  return month >= 7 ? year : year - 1;
}

export async function getNbaSlate(date: string): Promise<{ date: string; updatedAt: string; games: NbaGame[]; note: string }> {
  const slate = await fetchEvents(compact(date), false);
  const now = new Date().toISOString();
  const note = "Pregame prices are converted to no-vig probabilities when available. Otherwise, a conservative rating estimate uses completed prior games only. No live or final result is presented as a pregame call.";
  if (!slate.length) return { date, updatedAt: now, games: [], note };
  const year = seasonStart(date);
  const priorStart = `${year - 1}-10-01`;
  const currentStart = `${year}-10-01`;
  const priorEnd = `${year}-06-30`;
  const yesterday = new Date(`${date}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const historyEnd = toDate(yesterday);
  const historyPeriods = [...monthsBetween(priorStart, priorEnd), ...(historyEnd >= currentStart ? monthsBetween(currentStart, historyEnd) : [])];
  const history = slate.some((event) => event.status?.type?.state === "pre")
    ? await Promise.allSettled(historyPeriods.map(historicalResults))
    : [];
  // Partial history can skew ratings. Withhold the model if any range failed.
  const completeHistory = history.every((entry) => entry.status === "fulfilled");
  const results = completeHistory ? history.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []) : [];
  const ratings = ratingsBefore(results, `${date}T00:00:00Z`);
  const games = slate.flatMap((event): NbaGame[] => {
    const competition = event.competitions?.[0];
    const home = competition?.competitors?.find((team) => team.homeAway === "home");
    const away = competition?.competitors?.find((team) => team.homeAway === "away");
    if (!event.id || !event.date || !home?.team?.id || !away?.team?.id || !home.team.displayName || !away.team.displayName) return [];
    const state = event.status?.type?.state ?? "pre";
    const model = modelProbability(ratings, home.team.id, away.team.id);
    const quote = state === "pre" ? parseEspnMoneyline(competition?.odds?.[0], home.team.displayName, away.team.displayName, now, event.id) : null;
    // A current no-vig price is the primary estimate. Do not use post-tipoff odds as a pregame prediction.
    const probability = state === "pre" ? quote?.homeWinProbability ?? model : null;
    return [{
      id: event.id,
      tipoff: event.date,
      status: event.status?.type?.shortDetail ?? event.status?.type?.detail ?? (state === "pre" ? "Scheduled" : state === "post" ? "Final" : "Live"),
      state,
      venue: competition?.venue?.fullName ?? null,
      players: [home, away].flatMap(team => (team.leaders ?? []).flatMap(category => (category.leaders ?? []).flatMap(leader => leader.athlete?.id && leader.athlete.displayName ? [{ id: leader.athlete.id, name: leader.athlete.displayName, photo: leader.athlete.headshot ?? null, stat: `${leader.displayValue ?? ""} ${category.name ?? ""}`.trim() }] : []))).filter((player, index, all) => all.findIndex(item => item.id === player.id) === index).slice(0, 4),
      home: { id: home.team.id, name: home.team.displayName, abbreviation: home.team.abbreviation ?? "HOME", record: home.records?.[0]?.summary ?? "", score: state === "pre" ? null : validScore(home.score) },
      away: { id: away.team.id, name: away.team.displayName, abbreviation: away.team.abbreviation ?? "AWAY", record: away.records?.[0]?.summary ?? "", score: state === "pre" ? null : validScore(away.score) },
      homeWinProbability: probability === null ? null : Number(probability.toFixed(4)),
      modelHomeProbability: model === null ? null : Number(model.toFixed(4)),
      marketHomeProbability: quote?.homeWinProbability ?? null,
      probabilitySource: quote ? quote.source : model !== null ? "NBA rating estimate" : null
    }];
  }).toSorted((a, b) => a.tipoff.localeCompare(b.tipoff));
  // Historical views must never show today's roster as a past game's lineup.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await Promise.all(games.filter(game => game.state === "pre" && date >= today && !game.players.length).map(async game => {
    game.players = (await Promise.all([rosterPreview(game.away.id), rosterPreview(game.home.id)])).flat();
  }));
  return {
    date,
    updatedAt: now,
    games,
    note
  };
}
