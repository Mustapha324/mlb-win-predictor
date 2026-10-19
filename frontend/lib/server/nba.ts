import "server-only";
import { parseEspnMoneyline, type EspnOddsLike } from "@/lib/marketMath";
import { modelProbability, ratingsBefore, type NbaResult } from "@/lib/nbaPrediction";

type Team = { id?: string; displayName?: string; abbreviation?: string; color?: string; logo?: string };
type Competitor = { homeAway?: "home" | "away"; score?: string; team?: Team; records?: Array<{ type?: string; summary?: string }> };
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

async function fetchEvents(start: string, end: string, historical: boolean): Promise<Event[]> {
  const dates = start === end ? compact(start) : `${compact(start)}-${compact(end)}`;
  const response = await fetch(`${BASE}?dates=${dates}&limit=1000`, {
    next: { revalidate: historical ? 86_400 : 120 },
    headers: { Accept: "application/json", "User-Agent": "SportIQ/2.0 (NBA predictions)" },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`NBA schedule provider returned ${response.status}.`);
  const payload = await response.json() as { events?: Event[] };
  return payload.events ?? [];
}

function ranges(start: string, end: string): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  let cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    const from = toDate(cursor);
    const next = new Date(cursor);
    next.setUTCDate(next.getUTCDate() + 29);
    const through = toDate(next < last ? next : last);
    result.push([from, through]);
    cursor = new Date(`${through}T12:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function resultOf(event: Event): NbaResult | null {
  if (event.season?.type !== 2 && event.season?.type !== 3) return null;
  if (!event.id || !event.date || !event.status?.type?.completed) return null;
  const teams = event.competitions?.[0]?.competitors ?? [];
  const home = teams.find((team) => team.homeAway === "home");
  const away = teams.find((team) => team.homeAway === "away");
  const homeScore = Number(home?.score);
  const awayScore = Number(away?.score);
  if (!home?.team?.id || !away?.team?.id || !Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
  return { id: event.id, date: event.date, homeId: home.team.id, awayId: away.team.id, homeScore, awayScore };
}

function seasonStart(date: string): number {
  const [year, month] = date.split("-").map(Number);
  return month >= 7 ? year : year - 1;
}

export async function getNbaSlate(date: string): Promise<{ date: string; updatedAt: string; games: NbaGame[]; note: string }> {
  const slate = await fetchEvents(date, date, false);
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
  const historyRanges = [...ranges(priorStart, priorEnd), ...(historyEnd >= currentStart ? ranges(currentStart, historyEnd) : [])];
  const history = slate.some((event) => event.status?.type?.state === "pre")
    ? await Promise.allSettled(historyRanges.map(([start, end]) => fetchEvents(start, end, true)))
    : [];
  // Partial history can skew ratings. Withhold the model if any range failed.
  const completeHistory = history.every((entry) => entry.status === "fulfilled");
  const results = completeHistory ? history.flatMap((entry) => entry.status === "fulfilled" ? entry.value.map(resultOf).filter((item): item is NbaResult => item !== null) : []) : [];
  const ratings = ratingsBefore(results, `${date}T12:00:00Z`);
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
      home: { id: home.team.id, name: home.team.displayName, abbreviation: home.team.abbreviation ?? "HOME", record: home.records?.[0]?.summary ?? "", score: state === "pre" || home.score === undefined ? null : Number(home.score) },
      away: { id: away.team.id, name: away.team.displayName, abbreviation: away.team.abbreviation ?? "AWAY", record: away.records?.[0]?.summary ?? "", score: state === "pre" || away.score === undefined ? null : Number(away.score) },
      homeWinProbability: probability === null ? null : Number(probability.toFixed(4)),
      modelHomeProbability: model === null ? null : Number(model.toFixed(4)),
      marketHomeProbability: quote?.homeWinProbability ?? null,
      probabilitySource: quote ? quote.source : model !== null ? "NBA rating estimate" : null
    }];
  }).toSorted((a, b) => a.tipoff.localeCompare(b.tipoff));
  return {
    date,
    updatedAt: now,
    games,
    note
  };
}
