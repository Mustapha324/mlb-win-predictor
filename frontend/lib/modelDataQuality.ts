/** Historical requests must stop before the selected day's games. */
export function pregamePitchingQuery(date: string) {
  const cutoff = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(cutoff.getTime()) || cutoff.toISOString().slice(0,10) !== date) throw new Error("Invalid prediction date.");
  cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  return { stats: "byDateRange", group: "pitching", season: Number(date.slice(0,4)), startDate: `${date.slice(0,4)}-01-01`, endDate: cutoff.toISOString().slice(0,10) };
}
export function validDecisiveScores(home: number | null, away: number | null): boolean {
  return home !== null && away !== null && Number.isFinite(home) && Number.isFinite(away) && home >= 0 && away >= 0 && home !== away;
}
