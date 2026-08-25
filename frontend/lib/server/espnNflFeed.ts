import "server-only";

export const ESPN_NFL_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const ESPN_NFL_FALLBACK_BASE = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl";
export const ESPN_NFL_HEADERS = {
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.espn.com/",
  "User-Agent": "SportIQ/2.0 (NFL analytics feed)"
};

type SeasonCacheEntry = { expiresAt: number; events: unknown[] };
const globalFeedCache = globalThis as typeof globalThis & { __sportIqNflSeasonCache?: Map<number, SeasonCacheEntry> };
const seasonCache = globalFeedCache.__sportIqNflSeasonCache ?? new Map<number, SeasonCacheEntry>();
globalFeedCache.__sportIqNflSeasonCache = seasonCache;

export async function fetchEspnNflSeason<T>(year: number): Promise<T[]> {
  const cached = seasonCache.get(year);
  if (cached && cached.expiresAt > Date.now()) return cached.events as T[];
  const query = new URLSearchParams({ dates: String(year), limit: "1000" });
  let lastStatus = 503;
  for (const baseUrl of [ESPN_NFL_BASE, ESPN_NFL_FALLBACK_BASE]) {
    try {
      const response = await fetch(`${baseUrl}/scoreboard?${query}`, {
        cache: "no-store",
        headers: ESPN_NFL_HEADERS,
        signal: AbortSignal.timeout(12_000)
      });
      lastStatus = response.status;
      if (!response.ok) continue;
      const payload = (await response.json()) as { events?: T[] };
      const events = payload.events ?? [];
      const isHistorical = year < new Date().getUTCFullYear() - 1;
      seasonCache.set(year, { events, expiresAt: Date.now() + (isHistorical ? 24 * 60 * 60 * 1000 : 2 * 60 * 1000) });
      return events;
    } catch {
      // Try the alternate ESPN host, then use stale data if both are unavailable.
    }
  }
  if (cached?.events.length) return cached.events as T[];
  throw new Error(`NFL schedule service is temporarily unavailable (${lastStatus}).`);
}
