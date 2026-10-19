export async function GET(): Promise<Response> {
  const checks = await Promise.all(["20251021", "20251021-20251022", "202510", "2025", "2026"].map(async (dates) => {
    try {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dates}&limit=1000`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      const payload = response.ok ? await response.json() as { events?: Array<{ season?: { type?: number }; status?: { type?: { completed?: boolean } }; competitions?: Array<{ competitors?: Array<{ team?: { id?: string } }> }> }> } : null;
      return { dates, status: response.status, count: payload?.events?.length ?? 0, sample: payload?.events?.[0] ?? null };
    } catch (error) { return { dates, error: error instanceof Error ? error.message : String(error) }; }
  }));
  return Response.json(checks);
}
