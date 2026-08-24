import "server-only";
import {
  bucketInjuryStatus,
  injuryBurden,
  isQbOut,
  type InjuryEntry,
  type TeamInjuryReport
} from "@/lib/server/brain/brainScoring";

/**
 * Team injury reports for the Game Brain.
 *
 * MLB: StatsAPI 40-man roster status carries IL designations ("Injured 10-Day",
 * "Injured 60-Day"). One call per team.
 * NFL: the ESPN site-API roster embeds an `injuries` array and roster `status`
 * (Active / Injured Reserve / PUP) per athlete. One call per team — verified
 * far cheaper than the paginated core-API injuries feed.
 *
 * Failures return an empty healthy report; the brain treats unknown as healthy
 * rather than inventing burden.
 */

const EMPTY_REPORT: TeamInjuryReport = { entries: [], burden: 0, qbOut: false };
/** Ignore NFL injury notes older than this; ESPN keeps a season-long trail. */
const NFL_INJURY_FRESH_DAYS = 14;

type MlbRosterPayload = {
  roster?: Array<{
    person?: { fullName?: string };
    position?: { abbreviation?: string };
    status?: { description?: string };
  }>;
};

type EspnRosterPayload = {
  athletes?: Array<{
    items?: Array<{
      displayName?: string;
      position?: { abbreviation?: string };
      status?: { name?: string };
      injuries?: Array<{ status?: string; date?: string }>;
    }>;
  }>;
};

function buildReport(entries: InjuryEntry[], sport: "mlb" | "nfl"): TeamInjuryReport {
  return { entries, burden: injuryBurden(entries, sport), qbOut: sport === "nfl" && isQbOut(entries) };
}

export async function getMlbTeamInjuries(teamId: number): Promise<TeamInjuryReport> {
  try {
    const response = await fetch(`https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=40Man`, {
      next: { revalidate: 3600 },
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return EMPTY_REPORT;
    const payload = (await response.json()) as MlbRosterPayload;
    const entries: InjuryEntry[] = [];
    for (const spot of payload.roster ?? []) {
      const description = spot.status?.description ?? "";
      const status = bucketInjuryStatus(description);
      if (!status || !spot.person?.fullName) continue;
      entries.push({
        playerName: spot.person.fullName,
        position: spot.position?.abbreviation ?? null,
        status,
        detail: description
      });
    }
    return buildReport(entries, "mlb");
  } catch {
    return EMPTY_REPORT;
  }
}

export async function getNflTeamInjuries(espnTeamId: string): Promise<TeamInjuryReport> {
  try {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${encodeURIComponent(espnTeamId)}/roster`, {
      next: { revalidate: 3600 },
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return EMPTY_REPORT;
    const payload = (await response.json()) as EspnRosterPayload;
    const freshCutoff = Date.now() - NFL_INJURY_FRESH_DAYS * 86400000;
    const entries: InjuryEntry[] = [];
    for (const group of payload.athletes ?? []) {
      for (const athlete of group.items ?? []) {
        if (!athlete.displayName) continue;
        const rosterStatus = athlete.status?.name ?? "Active";
        const position = athlete.position?.abbreviation ?? null;
        if (rosterStatus !== "Active") {
          const status = bucketInjuryStatus(rosterStatus) ?? "il_long";
          entries.push({ playerName: athlete.displayName, position, status, detail: rosterStatus });
          continue;
        }
        const latest = (athlete.injuries ?? [])
          .filter((injury) => injury.status && injury.date && new Date(injury.date).getTime() >= freshCutoff)
          .toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
        if (!latest?.status) continue;
        const status = bucketInjuryStatus(latest.status);
        if (!status) continue;
        entries.push({ playerName: athlete.displayName, position, status, detail: latest.status });
      }
    }
    return buildReport(entries, "nfl");
  } catch {
    return EMPTY_REPORT;
  }
}
