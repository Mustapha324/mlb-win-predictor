/**
 * Pure parsers for ESPN's NFL roster and depth-chart payloads. No fetches and
 * no server-only import so the rules are unit-testable; lib/server/nflRoster.ts
 * does the fetching.
 */

export type NflRosterPlayer = {
  id: string;
  name: string;
  position: string | null;
  /** Active, Practice Squad, Injured Reserve, Suspended… */
  rosterStatus: string;
  /** Latest fresh injury designation (Out, Doubtful, Questionable…) or null. */
  injuryStatus: string | null;
};

/** ESPN keeps a season-long injury trail; only recent notes describe the coming game. */
export const INJURY_FRESH_DAYS = 10;

const GROUP_STATUS: Record<string, string> = {
  offense: "Active",
  defense: "Active",
  specialTeam: "Active",
  injuredReserveOrOut: "Injured Reserve",
  suspended: "Suspended",
  practiceSquad: "Practice Squad"
};

export type EspnRosterPayload = {
  athletes?: Array<{
    position?: string;
    items?: Array<{
      id?: string;
      displayName?: string;
      fullName?: string;
      position?: { abbreviation?: string };
      status?: { name?: string };
      injuries?: Array<{ status?: string; date?: string }>;
    }>;
  }>;
};

export type EspnDepthChartPayload = {
  depthchart?: Array<{
    name?: string;
    positions?: Record<string, { athletes?: Array<{ id?: string }> }>;
  }>;
};

/** Players with roster + injury status. Roster group decides the status; "Day-To-Day" on the roster reads as Questionable. */
export function parseNflRoster(payload: EspnRosterPayload | null, now = Date.now()): Map<string, NflRosterPlayer> {
  const players = new Map<string, NflRosterPlayer>();
  const freshCutoff = now - INJURY_FRESH_DAYS * 86_400_000;
  for (const group of payload?.athletes ?? []) {
    const rosterStatus = GROUP_STATUS[group.position ?? ""] ?? group.position ?? "Unknown";
    for (const athlete of group.items ?? []) {
      const name = athlete.displayName ?? athlete.fullName;
      if (!athlete.id || !name) continue;
      const latest = (athlete.injuries ?? [])
        .filter((injury) => injury.status && injury.date && Date.parse(injury.date) >= freshCutoff)
        .toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
      let injuryStatus = latest?.status ?? null;
      if (!injuryStatus && /day-to-day/i.test(athlete.status?.name ?? "")) injuryStatus = "Questionable";
      players.set(String(athlete.id), { id: String(athlete.id), name, position: athlete.position?.abbreviation ?? null, rosterStatus, injuryStatus });
    }
  }
  return players;
}

/**
 * Ranks every athlete on the offensive depth chart (the chart that lists a
 * quarterback). Slots hold ordered arrays: qb/rb/te rank by index; the three
 * receiver slots' first names are the WR1–WR3 starters and anyone behind them
 * is depth.
 */
export function parseNflDepthChart(payload: EspnDepthChartPayload | null): { depthRank: Map<string, number>; available: boolean } {
  const depthRank = new Map<string, number>();
  const chart = (payload?.depthchart ?? []).find((item) => item.positions?.qb?.athletes?.length);
  if (!chart?.positions) return { depthRank, available: false };
  for (const [slot, position] of Object.entries(chart.positions)) {
    if (!/^(qb|rb|fb|te|wr\d?)$/.test(slot)) continue;
    position.athletes?.forEach((athlete, index) => {
      if (!athlete.id) return;
      const wrSlot = slot.match(/^wr(\d)$/);
      const rank = wrSlot ? (index === 0 ? Number(wrSlot[1]) : 3 + index) : index + 1;
      const existing = depthRank.get(String(athlete.id));
      if (existing === undefined || rank < existing) depthRank.set(String(athlete.id), rank);
    });
  }
  return { depthRank, available: depthRank.size > 0 };
}
