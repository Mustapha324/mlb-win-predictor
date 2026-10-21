/** Pure, pregame-only player form. Empirical confidence is not a calibrated betting edge. */
export const NBA_MARKET_KEYS: Record<string, string[]> = {
  Points: ["points"], Assists: ["assists"], Rebounds: ["totalRebounds"], "3-pointers": ["threePointFieldGoalsMade-threePointFieldGoalsAttempted"],
  "Points+Assists": ["points", "assists"], "Points+Rebounds": ["points", "totalRebounds"],
  "Rebounds+Assists": ["totalRebounds", "assists"], "Points+Rebounds+Assists": ["points", "totalRebounds", "assists"]
};
export type NbaPlayerSample = { id: string; date: string; minutes: number; values: Record<string, number> };
export type NbaGameLog = {
  names?: string[];
  events?: Record<string, { gameDate?: string; gameResult?: string }>;
  seasonTypes?: Array<{ displayName?: string; categories?: Array<{ type?: string; events?: Array<{ eventId?: string; stats?: string[] }> }> }>;
};

export function parseNbaGameLog(payload: NbaGameLog, cutoff: string): NbaPlayerSample[] {
  const seen = new Set<string>();
  const samples: NbaPlayerSample[] = [];
  for (const season of payload.seasonTypes ?? []) {
    if (!/regular season|postseason/i.test(season.displayName ?? "")) continue;
    for (const category of season.categories ?? []) for (const row of category.events ?? []) {
      const event = row.eventId ? payload.events?.[row.eventId] : null;
      if (!row.eventId || seen.has(row.eventId) || !event?.gameDate || !/^[WL]$/.test(event.gameResult ?? "") || !(Date.parse(event.gameDate) < Date.parse(cutoff))) continue;
      const values: Record<string, number> = {};
      for (const [index, name] of (payload.names ?? []).entries()) {
        const raw = row.stats?.[index];
        const numeric = raw?.match(/^\d+(?:\.\d+)?(?:-\d+)?$/) ? Number(raw.split("-")[0]) : NaN;
        if (Number.isFinite(numeric)) values[name] = numeric;
      }
      if (!(values.minutes > 0)) continue;
      seen.add(row.eventId);
      samples.push({ id: row.eventId, date: event.gameDate, minutes: values.minutes, values });
    }
  }
  return samples.sort((a, b) => b.date.localeCompare(a.date));
}

export function estimateNbaProp(samples: NbaPlayerSample[], market: string, line: number) {
  const keys = NBA_MARKET_KEYS[market];
  if (!keys || !Number.isFinite(line) || line < 0) return null;
  const recent = samples.slice(0, 20);
  if (recent.length < 10 || recent.reduce((sum, row) => sum + row.minutes, 0) / recent.length < 20) return null;
  const values = recent.filter(row => keys.every(key => Number.isFinite(row.values[key]))).map(row => keys.reduce((sum, key) => sum + row.values[key], 0));
  if (values.length < 10) return null;
  const decisive = values.filter(value => value !== line);
  const over = (decisive.filter(value => value > line).length + 2) / (decisive.length + 4);
  const selection = over >= 0.5 ? "Over" as const : "Under" as const;
  return { selection, projection: values.reduce((sum, value) => sum + value, 0) / values.length, confidence: Math.min(0.72, Math.max(over, 1 - over)), sampleSize: values.length };
}
