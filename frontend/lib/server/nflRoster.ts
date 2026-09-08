import "server-only";
import {
  parseNflDepthChart,
  parseNflRoster,
  type EspnDepthChartPayload,
  type EspnRosterPayload,
  type NflRosterPlayer
} from "@/lib/nflRosterParsing";

/**
 * Current NFL roster + depth-chart context per team, so player picks are only
 * generated for active, healthy, starter-tier players. Two ESPN site-API calls
 * per team, both cached; failures leave `loaded` false and the eligibility
 * rules fall back to box-score inference with a confidence haircut.
 */

export type NflRosterContext = {
  loaded: boolean;
  players: Map<string, NflRosterPlayer>;
  /** athlete id -> depth rank at their slot (1 = starter; WR1/WR2/WR3 starters are ranks 1–3). */
  depthRank: Map<string, number>;
  depthChartAvailable: boolean;
};

const SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

async function fetchJson<T>(url: string, revalidate: number): Promise<T | null> {
  try {
    const response = await fetch(url, { next: { revalidate }, headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function getNflRosterContext(teamId: string): Promise<NflRosterContext> {
  const [roster, depth] = await Promise.all([
    fetchJson<EspnRosterPayload>(`${SITE_BASE}/teams/${encodeURIComponent(teamId)}/roster`, 3_600),
    fetchJson<EspnDepthChartPayload>(`${SITE_BASE}/teams/${encodeURIComponent(teamId)}/depthcharts`, 21_600)
  ]);
  const players = parseNflRoster(roster);
  const chart = parseNflDepthChart(depth);
  return { loaded: players.size > 0, players, depthRank: chart.depthRank, depthChartAvailable: chart.available };
}

export async function getNflRosterContexts(teamIds: string[]): Promise<Map<string, NflRosterContext>> {
  const unique = [...new Set(teamIds)];
  const contexts = await Promise.all(unique.map(async (teamId) => [teamId, await getNflRosterContext(teamId)] as const));
  return new Map(contexts);
}
