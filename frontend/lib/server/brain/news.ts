import "server-only";
import { tagNewsText, type NewsTag } from "@/lib/server/brain/brainScoring";
import type { Sport } from "@/lib/sports";

/**
 * News ingestion for the Game Brain — no database, everything fetched live
 * and cached in the framework fetch cache:
 *
 * - ESPN team headlines (both sports): current articles per team, tagged by
 *   the pure classifier so injury/trade/pitching notes surface first.
 * - MLB transactions (the one news feed with a real archive): trades, IL
 *   moves, call-ups over the last two weeks per club. The same feed powers
 *   the backtestable roster-churn signal, so what the lab measures and what
 *   the product displays share one source.
 *
 * Failures return empty lists — news is context, never a dependency.
 */

export type NewsFlag = {
  source: "espn" | "transactions";
  headline: string;
  detail: string | null;
  publishedAt: string | null;
  tags: NewsTag[];
  url: string | null;
};

const ESPN_NEWS_BASE: Record<Sport, string> = {
  mlb: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news",
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news"
};

type EspnNewsPayload = {
  articles?: Array<{
    headline?: string;
    description?: string;
    published?: string;
    links?: { web?: { href?: string } };
  }>;
};

type MlbTransactionsPayload = {
  transactions?: Array<{
    date?: string;
    effectiveDate?: string;
    typeDesc?: string;
    description?: string;
    toTeam?: { id?: number; name?: string };
  }>;
};

/** League + team headlines from ESPN, tagged; team abbreviation filter when provided. */
export async function getEspnTeamNews(sport: Sport, teamAbbreviation?: string, limit = 6): Promise<NewsFlag[]> {
  try {
    const query = new URLSearchParams({ limit: String(limit) });
    if (teamAbbreviation) query.set("team", teamAbbreviation.toLowerCase());
    const response = await fetch(`${ESPN_NEWS_BASE[sport]}?${query}`, {
      next: { revalidate: 1800 },
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as EspnNewsPayload;
    return (payload.articles ?? [])
      .filter((article) => article.headline)
      .map((article) => ({
        source: "espn" as const,
        headline: article.headline!,
        detail: article.description ?? null,
        publishedAt: article.published ?? null,
        tags: tagNewsText(`${article.headline} ${article.description ?? ""}`),
        url: article.links?.web?.href ?? null
      }));
  } catch {
    return [];
  }
}

export type TeamTransactionNews = {
  flags: NewsFlag[];
  /** Roster-disruption count over the window (feeds the lab-testable churn factor). */
  churn: number;
};

/** MLB transactions per club over the trailing window (default 14 days). */
export async function getMlbTransactionNews(teamIds: number[], date: string, windowDays = 14): Promise<Map<number, TeamTransactionNews>> {
  const result = new Map<number, TeamTransactionNews>(teamIds.map((id) => [id, { flags: [], churn: 0 }]));
  try {
    const end = new Date(`${date}T12:00:00Z`);
    const start = new Date(end.getTime() - windowDays * 86400000);
    const query = new URLSearchParams({ startDate: start.toISOString().slice(0, 10), endDate: date });
    const response = await fetch(`https://statsapi.mlb.com/api/v1/transactions?${query}`, {
      next: { revalidate: 3600 },
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return result;
    const payload = (await response.json()) as MlbTransactionsPayload;
    const churnTypes = /trade|claimed|released|selected|designated/i;
    for (const tx of payload.transactions ?? []) {
      const teamId = tx.toTeam?.id;
      if (!teamId || !result.has(teamId) || !tx.description) continue;
      const entry = result.get(teamId)!;
      if (churnTypes.test(tx.typeDesc ?? "")) entry.churn += 1;
      if (entry.flags.length < 8) {
        entry.flags.push({
          source: "transactions",
          headline: tx.typeDesc ?? "Roster move",
          detail: tx.description,
          publishedAt: tx.effectiveDate ?? tx.date ?? null,
          tags: tagNewsText(tx.description),
          url: null
        });
      }
    }
    return result;
  } catch {
    return result;
  }
}
