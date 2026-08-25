import "server-only";
import { computeTeamForm, type CompletedTeamResult, type TeamForm } from "@/lib/server/brain/brainScoring";
import { fetchEspnNflSeason } from "@/lib/server/espnNflFeed";

/**
 * Recent-form context: last-10 record, current streak (positive = winning),
 * and rest days before the given game date. Computed strictly from games
 * completed before the slate date — no leakage.
 */

const EMPTY_FORM: TeamForm = { lastTenWins: 0, lastTenGames: 0, streak: 0, restDays: null };

type MlbSchedulePayload = {
  dates?: Array<{
    games?: Array<{
      officialDate?: string;
      status?: { abstractGameState?: string };
      teams?: {
        home?: { team?: { id?: number }; score?: number; isWinner?: boolean };
        away?: { team?: { id?: number }; score?: number; isWinner?: boolean };
      };
    }>;
  }>;
};

type NflSeasonEvent = {
  date?: string;
  status?: { type?: { state?: string; completed?: boolean } };
  competitions?: Array<{
    competitors?: Array<{ id?: string; homeAway?: string; winner?: boolean; score?: string }>;
  }>;
};

type CompletedResult = CompletedTeamResult;

const formFrom = computeTeamForm;

/** Completed-game results per MLB team id over the window before `date`. */
export async function getMlbTeamForms(teamIds: number[], date: string, lookbackDays = 18): Promise<Map<number, TeamForm>> {
  const forms = new Map<number, TeamForm>(teamIds.map((id) => [id, EMPTY_FORM]));
  try {
    const end = new Date(`${date}T12:00:00Z`);
    const start = new Date(end.getTime() - lookbackDays * 86400000);
    const query = new URLSearchParams({
      sportId: "1",
      startDate: start.toISOString().slice(0, 10),
      endDate: date
    });
    const response = await fetch(`https://statsapi.mlb.com/api/v1/schedule?${query}`, {
      next: { revalidate: 1800 },
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return forms;
    const payload = (await response.json()) as MlbSchedulePayload;
    const byTeam = new Map<number, CompletedResult[]>();
    for (const day of payload.dates ?? []) {
      for (const game of day.games ?? []) {
        if (game.status?.abstractGameState !== "Final" || !game.officialDate) continue;
        for (const side of ["home", "away"] as const) {
          const teamId = game.teams?.[side]?.team?.id;
          if (typeof teamId !== "number") continue;
          const results = byTeam.get(teamId) ?? [];
          results.push({ date: game.officialDate, won: game.teams?.[side]?.isWinner === true });
          byTeam.set(teamId, results);
        }
      }
    }
    for (const teamId of teamIds) forms.set(teamId, formFrom(byTeam.get(teamId) ?? [], date));
    return forms;
  } catch {
    return forms;
  }
}

/** Completed-game results per ESPN NFL team id before `date` (spans two season feeds around January). */
export async function getNflTeamForms(teamIds: string[], date: string): Promise<Map<string, TeamForm>> {
  const forms = new Map<string, TeamForm>(teamIds.map((id) => [id, EMPTY_FORM]));
  try {
    const season = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 3 ? 1 : 0);
    const events = (
      await Promise.all([
        fetchEspnNflSeason<NflSeasonEvent>(season - 1).catch(() => []),
        fetchEspnNflSeason<NflSeasonEvent>(season).catch(() => [])
      ])
    ).flat();
    const byTeam = new Map<string, CompletedResult[]>();
    for (const event of events) {
      if (!event.date || !(event.status?.type?.completed || event.status?.type?.state === "post")) continue;
      const day = event.date.slice(0, 10);
      for (const competitor of event.competitions?.[0]?.competitors ?? []) {
        if (!competitor.id) continue;
        const results = byTeam.get(competitor.id) ?? [];
        results.push({ date: day, won: competitor.winner === true });
        byTeam.set(competitor.id, results);
      }
    }
    for (const teamId of teamIds) forms.set(teamId, formFrom(byTeam.get(teamId) ?? [], date));
    return forms;
  } catch {
    return forms;
  }
}
