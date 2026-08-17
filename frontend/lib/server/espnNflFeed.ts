import "server-only";

export const ESPN_NFL_BASE = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl";
export const ESPN_NFL_HEADERS = {
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.espn.com/",
  "User-Agent": "Mozilla/5.0 (compatible; SportIQ/1.0; +https://sport-iq.example)"
};

type SeasonCacheEntry = { expiresAt: number; events: unknown[] };
const globalFeedCache = globalThis as typeof globalThis & { __sportIqNflSeasonCache?: Map<number, SeasonCacheEntry> };
const seasonCache = globalFeedCache.__sportIqNflSeasonCache ?? new Map<number, SeasonCacheEntry>();
globalFeedCache.__sportIqNflSeasonCache = seasonCache;

export async function fetchEspnNflSeason<T>(year: number): Promise<T[]> {
  const cached = seasonCache.get(year);
  if (cached && cached.expiresAt > Date.now()) return cached.events as T[];
  const query = new URLSearchParams({ dates: String(year), limit: "1000" });
  const response = await fetch(`${ESPN_NFL_BASE}/scoreboard?${query}`, { cache: "no-store", headers: ESPN_NFL_HEADERS });
  if (!response.ok) throw new Error(`NFL schedule service returned ${response.status}.`);
  const payload = (await response.json()) as { events?: T[] };
  const events = payload.events ?? [];
  seasonCache.set(year, { events, expiresAt: Date.now() + 5 * 60 * 1000 });
  return events;
}
