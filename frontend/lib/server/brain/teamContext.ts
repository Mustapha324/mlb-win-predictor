import "server-only";
import { pythagoreanExpectation } from "@/lib/server/brain/brainScoring";
import { fetchEspnNflSeason } from "@/lib/server/espnNflFeed";

/**
 * Season-to-date team context for the Game Brain's record-derived factors:
 * rolling scoring margin, home/road splits, Pythagorean expectation, and
 * schedule density — plus MLB probable-starter recent form. Everything is
 * computed strictly from games completed before the slate date (no leakage),
 * from the same free schedule feeds the rest of the brain uses.
 */

export type TeamSeasonContext = {
  /** Average scoring margin over the recent window (15 MLB / 5 NFL games). */
  scoringMargin: number;
  /** null until the split has a meaningful sample. */
  homeWinRate: number | null;
  roadWinRate: number | null;
  /** Season-to-date Pythagorean expectation; null until sampled. */
  pythag: number | null;
  gamesLastSixDays: number;
};

export type MlbStarterContext = {
  /** gameId -> probable starter ids as posted. */
  probables: Map<string, { homeStarterId: number | null; awayStarterId: number | null }>;
  /** starter id -> average runs allowed by their team in their recent starts (min 3). */
  recentRunsAllowed: Map<number, number>;
};

const EMPTY_CONTEXT: TeamSeasonContext = { scoringMargin: 0, homeWinRate: null, roadWinRate: null, pythag: null, gamesLastSixDays: 0 };

type Tally = { margins: number[]; dates: string[]; homeW: number; homeG: number; roadW: number; roadG: number; scored: number; allowed: number; games: number };

function newTally(): Tally {
  return { margins: [], dates: [], homeW: 0, homeG: 0, roadW: 0, roadG: 0, scored: 0, allowed: 0, games: 0 };
}

function contextFrom(tally: Tally | undefined, date: string, options: { marginWindow: number; minSplit: number; minPythag: number; exponent: number }): TeamSeasonContext {
  if (!tally) return EMPTY_CONTEXT;
  const window = tally.margins.slice(-options.marginWindow);
  const sixDaysAgo = new Date(`${date}T12:00:00Z`).getTime() - 6 * 86400000;
  return {
    scoringMargin: window.length >= 3 ? Number((window.reduce((sum, value) => sum + value, 0) / window.length).toFixed(3)) : 0,
    homeWinRate: tally.homeG >= options.minSplit ? tally.homeW / tally.homeG : null,
    roadWinRate: tally.roadG >= options.minSplit ? tally.roadW / tally.roadG : null,
    pythag: tally.games >= options.minPythag ? pythagoreanExpectation(tally.scored, tally.allowed, options.exponent) : null,
    gamesLastSixDays: tally.dates.filter((d) => d < date && new Date(`${d}T12:00:00Z`).getTime() >= sixDaysAgo).length
  };
}

type MlbSchedulePayload = {
  dates?: Array<{
    games?: Array<{
      gamePk?: number;
      officialDate?: string;
      status?: { abstractGameState?: string };
      teams?: {
        home?: { team?: { id?: number }; score?: number; probablePitcher?: { id?: number } };
        away?: { team?: { id?: number }; score?: number; probablePitcher?: { id?: number } };
      };
    }>;
  }>;
};

/** One season-to-date schedule call powers team context AND starter form. */
export async function getMlbSeasonContext(
  date: string
): Promise<{ teams: Map<number, TeamSeasonContext>; starters: MlbStarterContext }> {
  const teams = new Map<number, TeamSeasonContext>();
  const starters: MlbStarterContext = { probables: new Map(), recentRunsAllowed: new Map() };
  try {
    const season = date.slice(0, 4);
    const query = new URLSearchParams({ sportId: "1", gameType: "R", hydrate: "probablePitcher", startDate: `${season}-03-01`, endDate: date });
    const response = await fetch(`https://statsapi.mlb.com/api/v1/schedule?${query}`, {
      next: { revalidate: 3600 },
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return { teams, starters };
    const payload = (await response.json()) as MlbSchedulePayload;
    const tallies = new Map<number, Tally>();
    const starterRuns = new Map<number, number[]>();
    for (const day of payload.dates ?? []) {
      for (const game of day.games ?? []) {
        const home = game.teams?.home;
        const away = game.teams?.away;
        if (game.officialDate === date && game.gamePk) {
          starters.probables.set(String(game.gamePk), {
            homeStarterId: home?.probablePitcher?.id ?? null,
            awayStarterId: away?.probablePitcher?.id ?? null
          });
        }
        if (game.status?.abstractGameState !== "Final" || !game.officialDate || game.officialDate >= date) continue;
        if (!home?.team?.id || !away?.team?.id || typeof home.score !== "number" || typeof away.score !== "number" || home.score === away.score) continue;
        const homeTally = tallies.get(home.team.id) ?? tallies.set(home.team.id, newTally()).get(home.team.id)!;
        const awayTally = tallies.get(away.team.id) ?? tallies.set(away.team.id, newTally()).get(away.team.id)!;
        homeTally.margins.push(home.score - away.score);
        awayTally.margins.push(away.score - home.score);
        homeTally.dates.push(game.officialDate);
        awayTally.dates.push(game.officialDate);
        homeTally.homeG += 1;
        homeTally.homeW += home.score > away.score ? 1 : 0;
        awayTally.roadG += 1;
        awayTally.roadW += away.score > home.score ? 1 : 0;
        homeTally.scored += home.score;
        homeTally.allowed += away.score;
        awayTally.scored += away.score;
        awayTally.allowed += home.score;
        homeTally.games += 1;
        awayTally.games += 1;
        if (home.probablePitcher?.id) starterRuns.set(home.probablePitcher.id, [...(starterRuns.get(home.probablePitcher.id) ?? []), away.score].slice(-8));
        if (away.probablePitcher?.id) starterRuns.set(away.probablePitcher.id, [...(starterRuns.get(away.probablePitcher.id) ?? []), home.score].slice(-8));
      }
    }
    for (const [teamId, tally] of tallies) {
      teams.set(teamId, contextFrom(tally, date, { marginWindow: 15, minSplit: 8, minPythag: 20, exponent: 1.83 }));
    }
    for (const [starterId, runs] of starterRuns) {
      if (runs.length >= 3) starters.recentRunsAllowed.set(starterId, Number((runs.reduce((sum, value) => sum + value, 0) / runs.length).toFixed(3)));
    }
    return { teams, starters };
  } catch {
    return { teams, starters };
  }
}

type NflSeasonEvent = {
  id?: string;
  date?: string;
  season?: { year?: number; type?: number };
  status?: { type?: { state?: string; completed?: boolean } };
  competitions?: Array<{ competitors?: Array<{ id?: string; homeAway?: string; winner?: boolean; score?: string }> }>;
};

export type NflQbContext = {
  /** Rolling per-start value of the team's projected starter (last game's starter); null when unknown. */
  value: number | null;
  starterName: string | null;
};

type EspnSummaryPassing = {
  boxscore?: {
    players?: Array<{
      team?: { id?: string };
      statistics?: Array<{ name?: string; labels?: string[]; athletes?: Array<{ athlete?: { id?: string; displayName?: string }; stats?: string[] }> }>;
    }>;
  };
};

/**
 * Projected-starter QB value per team: the starter is whoever led pass
 * attempts in the team's most recent completed game, valued by a rolling
 * composite (yards/attempt centered on 6.5 plus TD−INT rate) over his last
 * 8 starts. Mirrors the backtested factor exactly, including the guard:
 * no value when the team's last game is more than 21 days old (offseason
 * carryover is unreliable — the week-1 exclusion from the lab).
 */
export async function getNflQbContext(teamIds: string[], date: string): Promise<Map<string, NflQbContext>> {
  const contexts = new Map<string, NflQbContext>(teamIds.map((id) => [id, { value: null, starterName: null }]));
  try {
    const seasonYear = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 3 ? 1 : 0);
    const events = (
      await Promise.all([
        fetchEspnNflSeason<NflSeasonEvent>(seasonYear).catch(() => []),
        fetchEspnNflSeason<NflSeasonEvent>(seasonYear + 1).catch(() => [])
      ])
    ).flat();
    const completedByTeam = new Map<string, NflSeasonEvent[]>();
    for (const event of events) {
      if (!event.id || !event.date || event.date.slice(0, 10) >= date) continue;
      // Regular season only — preseason passers are backups and would poison starter detection.
      if (event.season?.type !== undefined && event.season.type !== 2) continue;
      if (!(event.status?.type?.completed || event.status?.type?.state === "post")) continue;
      for (const competitor of event.competitions?.[0]?.competitors ?? []) {
        if (!competitor.id || !teamIds.includes(competitor.id)) continue;
        const list = completedByTeam.get(competitor.id) ?? [];
        list.push(event);
        completedByTeam.set(competitor.id, list);
      }
    }
    const staleCutoff = new Date(`${date}T12:00:00Z`).getTime() - 21 * 86400000;
    const summaryCache = new Map<string, EspnSummaryPassing | null>();
    const fetchSummary = async (eventId: string) => {
      if (summaryCache.has(eventId)) return summaryCache.get(eventId) ?? null;
      try {
        const response = await fetch(`https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(eventId)}`, {
          next: { revalidate: 604800 },
          headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; SportIQ/1.0)" }
        });
        const payload = response.ok ? ((await response.json()) as EspnSummaryPassing) : null;
        summaryCache.set(eventId, payload);
        return payload;
      } catch {
        summaryCache.set(eventId, null);
        return null;
      }
    };
    const passerLine = (summary: EspnSummaryPassing | null, teamId: string) => {
      const team = summary?.boxscore?.players?.find((entry) => entry.team?.id === teamId);
      const passing = team?.statistics?.find((group) => group.name === "passing");
      if (!passing?.athletes?.length) return null;
      const labels = passing.labels ?? [];
      const lines = passing.athletes
        .map((entry) => {
          const [, attempts] = String(entry.stats?.[labels.indexOf("C/ATT")] ?? "").split("/").map(Number);
          return {
            qbId: entry.athlete?.id ?? null,
            name: entry.athlete?.displayName ?? null,
            attempts: Number.isFinite(attempts) ? attempts : 0,
            yards: Number(entry.stats?.[labels.indexOf("YDS")]) || 0,
            tds: Number(entry.stats?.[labels.indexOf("TD")]) || 0,
            ints: Number(entry.stats?.[labels.indexOf("INT")]) || 0
          };
        })
        .filter((line) => line.qbId && line.attempts >= 8)
        .toSorted((a, b) => b.attempts - a.attempts);
      return lines[0] ?? null;
    };
    await Promise.all(
      teamIds.map(async (teamId) => {
        const recent = (completedByTeam.get(teamId) ?? []).toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 10);
        if (recent.length === 0 || new Date(recent[0].date!).getTime() < staleCutoff) return;
        const latestSummary = await fetchSummary(recent[0].id!);
        const starter = passerLine(latestSummary, teamId);
        if (!starter?.qbId) return;
        const values: number[] = [];
        for (const event of recent) {
          if (values.length >= 8) break;
          const line = passerLine(await fetchSummary(event.id!), teamId);
          if (line?.qbId !== starter.qbId || line.attempts === 0) continue;
          values.push(line.yards / line.attempts - 6.5 + (8 * (line.tds - line.ints)) / line.attempts);
        }
        if (values.length < 2) return;
        contexts.set(teamId, {
          value: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)),
          starterName: starter.name
        });
      })
    );
    return contexts;
  } catch {
    return contexts;
  }
}

export async function getNflSeasonContext(teamIds: string[], date: string): Promise<Map<string, TeamSeasonContext>> {
  const teams = new Map<string, TeamSeasonContext>(teamIds.map((id) => [id, EMPTY_CONTEXT]));
  try {
    const seasonYear = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 3 ? 1 : 0);
    const events = (
      await Promise.all([
        fetchEspnNflSeason<NflSeasonEvent>(seasonYear).catch(() => []),
        fetchEspnNflSeason<NflSeasonEvent>(seasonYear + 1).catch(() => [])
      ])
    ).flat();
    const tallies = new Map<string, Tally>();
    for (const event of events) {
      if (event.season?.year !== seasonYear || (event.season?.type !== undefined && event.season.type !== 2)) continue;
      if (!event.date || event.date.slice(0, 10) >= date) continue;
      if (!(event.status?.type?.completed || event.status?.type?.state === "post")) continue;
      const home = event.competitions?.[0]?.competitors?.find((team) => team.homeAway === "home");
      const away = event.competitions?.[0]?.competitors?.find((team) => team.homeAway === "away");
      const homeScore = Number(home?.score);
      const awayScore = Number(away?.score);
      if (!home?.id || !away?.id || !Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore === awayScore) continue;
      const day = event.date.slice(0, 10);
      const homeTally = tallies.get(home.id) ?? tallies.set(home.id, newTally()).get(home.id)!;
      const awayTally = tallies.get(away.id) ?? tallies.set(away.id, newTally()).get(away.id)!;
      homeTally.margins.push(homeScore - awayScore);
      awayTally.margins.push(awayScore - homeScore);
      homeTally.dates.push(day);
      awayTally.dates.push(day);
      homeTally.homeG += 1;
      homeTally.homeW += homeScore > awayScore ? 1 : 0;
      awayTally.roadG += 1;
      awayTally.roadW += awayScore > homeScore ? 1 : 0;
      homeTally.scored += homeScore;
      homeTally.allowed += awayScore;
      awayTally.scored += awayScore;
      awayTally.allowed += homeScore;
      homeTally.games += 1;
      awayTally.games += 1;
    }
    for (const teamId of teamIds) {
      teams.set(teamId, contextFrom(tallies.get(teamId), date, { marginWindow: 5, minSplit: 3, minPythag: 5, exponent: 2.37 }));
    }
    return teams;
  } catch {
    return teams;
  }
}
