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
type SummaryCacheEntry = { expiresAt: number; summary: unknown };
const globalFeedCache = globalThis as typeof globalThis & {
  __sportIqNflSeasonCache?: Map<number, SeasonCacheEntry>;
  __sportIqNflSummaryCache?: Map<string, SummaryCacheEntry>;
};
const seasonCache = globalFeedCache.__sportIqNflSeasonCache ?? new Map<number, SeasonCacheEntry>();
const summaryCache = globalFeedCache.__sportIqNflSummaryCache ?? new Map<string, SummaryCacheEntry>();
globalFeedCache.__sportIqNflSeasonCache = seasonCache;
globalFeedCache.__sportIqNflSummaryCache = summaryCache;

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

export async function fetchEspnNflSummary<T>(gameId: string): Promise<T | null> {
  const cached = summaryCache.get(gameId);
  if (cached && cached.expiresAt > Date.now()) return cached.summary as T;
  for (const baseUrl of [ESPN_NFL_BASE, ESPN_NFL_FALLBACK_BASE]) {
    try {
      const response = await fetch(`${baseUrl}/summary?event=${encodeURIComponent(gameId)}`, {
        cache: "no-store",
        headers: ESPN_NFL_HEADERS,
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) continue;
      const summary = await response.json() as T;
      summaryCache.set(gameId, { summary, expiresAt: Date.now() + 2 * 60 * 1000 });
      return summary;
    } catch {
      // Try the alternate host, then return stale data when a prior response exists.
    }
  }
  return (cached?.summary as T | undefined) ?? null;
}
