import "server-only";
import type { TeamPrediction } from "@/lib/api";
import type { Sport } from "@/lib/sports";
import {
  applyLogitDelta,
  combineFactors,
  DEFAULT_BRAIN_WEIGHTS,
  factorTerms,
  weatherSeverity,
  type BrainFactor,
  type TeamForm,
  type TeamInjuryReport,
  type WeatherSnapshot
} from "@/lib/server/brain/brainScoring";
import { getMlbTeamInjuries, getNflTeamInjuries } from "@/lib/server/brain/injuries";
import { getMlbTeamForms, getNflTeamForms } from "@/lib/server/brain/form";
import { getGameWeather } from "@/lib/server/brain/weather";
import { getMlbVenueContext, getNflVenueContext, type VenueContext } from "@/lib/server/brain/venues";
import { pickStatus } from "@/lib/server/playerPickScoring";

/**
 * Game Brain orchestrator (Phase 1, shadow mode).
 *
 * Assembles pregame matchup intelligence per scheduled game — injuries,
 * venue + weather, recent form — compares the two sides, and computes a
 * BOUNDED shadow adjustment that is reported alongside the model's number but
 * never changes the published prediction. See docs/game-brain-plan.md.
 */

export type TeamBrainSide = {
  team: string;
  injuries: TeamInjuryReport;
  form: TeamForm;
};

export type GameBrainContext = {
  gameId: string;
  sport: Sport;
  assembledAt: string;
  home: TeamBrainSide;
  away: TeamBrainSide;
  venue: VenueContext;
  weather: WeatherSnapshot | null;
  weatherSeverity: number;
  factors: Array<{ label: string; detail: string; homeLogit: number }>;
  shadow: {
    baselineHomeWinProbability: number;
    logitDelta: number;
    brainHomeWinProbability: number;
  };
};

type MlbVenueRef = { id: number | null; name: string | null };

async function getMlbVenueRefs(date: string): Promise<Map<string, MlbVenueRef>> {
  const refs = new Map<string, MlbVenueRef>();
  try {
    const query = new URLSearchParams({ sportId: "1", date, fields: "dates,games,gamePk,venue,id,name" });
    const response = await fetch(`https://statsapi.mlb.com/api/v1/schedule?${query}`, {
      next: { revalidate: 3600 },
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return refs;
    const payload = (await response.json()) as {
      dates?: Array<{ games?: Array<{ gamePk?: number; venue?: { id?: number; name?: string } }> }>;
    };
    for (const day of payload.dates ?? []) {
      for (const game of day.games ?? []) {
        if (game.gamePk) refs.set(String(game.gamePk), { id: game.venue?.id ?? null, name: game.venue?.name ?? null });
      }
    }
    return refs;
  } catch {
    return refs;
  }
}

function buildFactors(sport: Sport, game: TeamPrediction, home: TeamBrainSide, away: TeamBrainSide, weather: WeatherSnapshot | null): BrainFactor[] {
  const terms = factorTerms(
    {
      sport,
      burdenGap: away.injuries.burden - home.injuries.burden,
      homeQbOut: home.injuries.qbOut,
      awayQbOut: away.injuries.qbOut,
      homeForm: home.form,
      awayForm: away.form,
      weatherSeverity: weather ? weatherSeverity(weather) : 0
    },
    DEFAULT_BRAIN_WEIGHTS
  );
  return terms.map((term) => {
    if (term.kind === "injury") {
      const healthier = term.homeLogit > 0 ? game.home_team : game.away_team;
      const keyNames = (term.homeLogit > 0 ? away : home).injuries.entries.slice(0, 3).map((entry) => entry.playerName);
      return {
        label: "Injury edge",
        detail: `${healthier} is healthier${keyNames.length ? ` (${keyNames.join(", ")} on the other side's report)` : ""}`,
        homeLogit: term.homeLogit
      };
    }
    if (term.kind === "qb") {
      const side = term.homeLogit < 0 ? game.home_team : game.away_team;
      return { label: "QB availability", detail: `${side} may be without their starting quarterback`, homeLogit: term.homeLogit };
    }
    if (term.kind === "form") {
      const hotter = term.homeLogit > 0 ? game.home_team : game.away_team;
      const hotterSide = term.homeLogit > 0 ? home : away;
      return {
        label: "Recent form",
        detail: `${hotter} enters ${hotterSide.form.lastTenWins}-${hotterSide.form.lastTenGames - hotterSide.form.lastTenWins} over their last ${hotterSide.form.lastTenGames}${hotterSide.form.restDays !== null ? ` with ${hotterSide.form.restDays} rest day${hotterSide.form.restDays === 1 ? "" : "s"}` : ""}`,
        homeLogit: term.homeLogit
      };
    }
    return {
      label: "Weather",
      detail: weather
        ? `${Math.round(weather.tempF)}°F, wind ${Math.round(weather.windMph)} mph${weather.snowfall ? ", snow expected" : weather.precipProbability >= 0.7 ? ", rain likely" : ""} — favors the home side's familiarity`
        : "Adverse conditions favor the home side's familiarity",
      homeLogit: term.homeLogit
    };
  });
}

export async function getGameBrainContexts(sport: Sport, date: string, games: TeamPrediction[]): Promise<GameBrainContext[]> {
  const scheduled = games.filter((game) => pickStatus(game.status, game.is_final) === "scheduled");
  if (scheduled.length === 0) return [];

  const teamIds = [...new Set(scheduled.flatMap((game) => [game.homeTeam.id, game.awayTeam.id]))];
  const [forms, injuryPairs, mlbVenues] = await Promise.all([
    sport === "mlb"
      ? getMlbTeamForms(teamIds, date)
      : getNflTeamForms(teamIds.map(String), date),
    Promise.all(
      teamIds.map(async (teamId) => {
        const report = sport === "mlb" ? await getMlbTeamInjuries(teamId) : await getNflTeamInjuries(String(teamId));
        return [teamId, report] as const;
      })
    ),
    sport === "mlb" ? getMlbVenueRefs(date) : Promise.resolve(new Map<string, MlbVenueRef>())
  ]);
  const injuries = new Map(injuryPairs);
  const emptyForm: TeamForm = { lastTenWins: 0, lastTenGames: 0, streak: 0, restDays: null };
  const emptyInjuries: TeamInjuryReport = { entries: [], burden: 0, qbOut: false };
  const formFor = (teamId: number): TeamForm =>
    (forms as Map<number | string, TeamForm>).get(teamId) ?? (forms as Map<number | string, TeamForm>).get(String(teamId)) ?? emptyForm;

  return Promise.all(
    scheduled.map(async (game) => {
      const venue =
        sport === "mlb"
          ? await getMlbVenueContext(mlbVenues.get(game.gameId)?.id ?? null, mlbVenues.get(game.gameId)?.name ?? game.venue)
          : getNflVenueContext(game.homeTeam.abbreviation, game.venue);
      const weather = await getGameWeather(venue, game.game_time_utc);
      const home: TeamBrainSide = { team: game.home_team, injuries: injuries.get(game.homeTeam.id) ?? emptyInjuries, form: formFor(game.homeTeam.id) };
      const away: TeamBrainSide = { team: game.away_team, injuries: injuries.get(game.awayTeam.id) ?? emptyInjuries, form: formFor(game.awayTeam.id) };
      const { logitDelta, factors } = combineFactors(buildFactors(sport, game, home, away, weather));
      return {
        gameId: game.gameId,
        sport,
        assembledAt: new Date().toISOString(),
        home,
        away,
        venue,
        weather,
        weatherSeverity: weather ? weatherSeverity(weather) : 0,
        factors,
        shadow: {
          baselineHomeWinProbability: game.pregame_home_win_probability,
          logitDelta,
          brainHomeWinProbability: applyLogitDelta(game.pregame_home_win_probability, logitDelta)
        }
      };
    })
  );
}
