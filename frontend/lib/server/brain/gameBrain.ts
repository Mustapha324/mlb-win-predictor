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
import { NFL_DIVISIONS } from "@/lib/server/brain/nflStadiums";
import { getNflQbContext, getNflSeasonContext, type NflQbContext, type TeamSeasonContext } from "@/lib/server/brain/teamContext";
import { getEspnTeamNews, getMlbTransactionNews, type NewsFlag, type TeamTransactionNews } from "@/lib/server/brain/news";
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
  news: NewsFlag[];
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

function buildFactors(
  sport: Sport,
  game: TeamPrediction,
  home: TeamBrainSide,
  away: TeamBrainSide,
  weather: WeatherSnapshot | null,
  season: { home?: TeamSeasonContext; away?: TeamSeasonContext },
  rosterChurnGap?: number,
  qbValueGap?: number,
  qb: { home?: NflQbContext; away?: NflQbContext } = {}
): BrainFactor[] {
  const divisionGame =
    sport === "nfl" &&
    NFL_DIVISIONS[game.homeTeam.abbreviation?.toUpperCase()] !== undefined &&
    NFL_DIVISIONS[game.homeTeam.abbreviation?.toUpperCase()] === NFL_DIVISIONS[game.awayTeam.abbreviation?.toUpperCase()];
  const baseline = Math.max(0.02, Math.min(0.98, game.pregame_home_win_probability));
  const terms = factorTerms(
    {
      sport,
      burdenGap: away.injuries.burden - home.injuries.burden,
      homeQbOut: home.injuries.qbOut,
      awayQbOut: away.injuries.qbOut,
      homeForm: home.form,
      awayForm: away.form,
      weatherSeverity: weather ? weatherSeverity(weather) : 0,
      pythagGap:
        season.home?.pythag != null && season.away?.pythag != null
          ? Number((season.home.pythag - season.away.pythag).toFixed(4))
          : undefined,
      divisionGame,
      baselineLogit: Math.log(baseline / (1 - baseline)),
      lateSeason: sport === "nfl" && (game.week ?? 0) >= 17,
      homeOffBye: sport === "nfl" ? (home.form.restDays ?? 0) >= 10 && home.form.lastTenGames > 0 : undefined,
      awayOffBye: sport === "nfl" ? (away.form.restDays ?? 0) >= 10 && away.form.lastTenGames > 0 : undefined,
      rosterChurnGap,
      qbValueGap
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
    if (term.kind === "pythag") {
      const stronger = term.homeLogit > 0 ? game.home_team : game.away_team;
      const strongerSeason = term.homeLogit > 0 ? season.home : season.away;
      return {
        label: "Underlying strength",
        detail: `${stronger}'s scoring margin says they are a ${Math.round((strongerSeason?.pythag ?? 0.5) * 100)}% quality side — better than the record alone shows`,
        homeLogit: term.homeLogit
      };
    }
    if (term.kind === "division") {
      const favorite = game.pregame_home_win_probability >= 0.5 ? game.home_team : game.away_team;
      return {
        label: "Division game",
        detail: `Familiar rivals play closer than ratings suggest — the edge for ${favorite} is dampened`,
        homeLogit: term.homeLogit
      };
    }
    if (term.kind === "qb-value") {
      const better = term.homeLogit > 0 ? game.home_team : game.away_team;
      const starter = (term.homeLogit > 0 ? qb.home : qb.away)?.starterName;
      return {
        label: "Quarterback edge",
        detail: `${better}${starter ? ` (${starter})` : ""} has the stronger recent quarterback play`,
        homeLogit: term.homeLogit
      };
    }
    if (term.kind === "roster-churn") {
      const steadier = term.homeLogit > 0 ? game.home_team : game.away_team;
      return { label: "Roster stability", detail: `${steadier} has had the quieter transaction wire over the last two weeks`, homeLogit: term.homeLogit };
    }
    if (term.kind === "late-season") {
      const favorite = game.pregame_home_win_probability >= 0.5 ? game.home_team : game.away_team;
      return {
        label: "Late-season trap",
        detail: `Weeks 17-18: locked teams rest starters and motivation splits — the edge for ${favorite} is dampened`,
        homeLogit: term.homeLogit
      };
    }
    if (term.kind === "bye") {
      const rested = term.homeLogit > 0 ? game.home_team : game.away_team;
      return { label: "Off the bye", detail: `${rested} comes in off a bye week`, homeLogit: term.homeLogit };
    }
    if (term.kind === "weather") {
      return {
        label: "Weather",
        detail: weather
          ? `${Math.round(weather.tempF)}°F, wind ${Math.round(weather.windMph)} mph${weather.snowfall ? ", snow expected" : weather.precipProbability >= 0.7 ? ", rain likely" : ""} — favors the home side's familiarity`
          : "Adverse conditions favor the home side's familiarity",
        homeLogit: term.homeLogit
      };
    }
    return { label: term.kind, detail: "", homeLogit: term.homeLogit };
  });
}

export async function getGameBrainContexts(sport: Sport, date: string, games: TeamPrediction[]): Promise<GameBrainContext[]> {
  const scheduled = games.filter((game) => pickStatus(game.status, game.is_final) === "scheduled");
  if (scheduled.length === 0) return [];

  const teamIds = [...new Set(scheduled.flatMap((game) => [game.homeTeam.id, game.awayTeam.id]))];
  const [forms, injuryPairs, mlbVenues, seasonContexts, transactionNews, qbContexts, espnNewsPairs] = await Promise.all([
    sport === "mlb"
      ? getMlbTeamForms(teamIds, date)
      : getNflTeamForms(teamIds.map(String), date),
    Promise.all(
      teamIds.map(async (teamId) => {
        const report = sport === "mlb" ? await getMlbTeamInjuries(teamId) : await getNflTeamInjuries(String(teamId));
        return [teamId, report] as const;
      })
    ),
    sport === "mlb" ? getMlbVenueRefs(date) : Promise.resolve(new Map<string, MlbVenueRef>()),
    // Season context feeds the record-derived factors; only the NFL has ones with non-zero weights today.
    sport === "nfl" ? getNflSeasonContext(teamIds.map(String), date) : Promise.resolve(new Map<string, TeamSeasonContext>()),
    sport === "mlb" ? getMlbTransactionNews(teamIds, date) : Promise.resolve(new Map<number, TeamTransactionNews>()),
    sport === "nfl" ? getNflQbContext(teamIds.map(String), date) : Promise.resolve(new Map<string, NflQbContext>()),
    Promise.all(
      scheduled
        .flatMap((game) => [game.homeTeam, game.awayTeam])
        .filter((team, index, all) => all.findIndex((entry) => entry.id === team.id) === index)
        .map(async (team) => [team.id, await getEspnTeamNews(sport, team.abbreviation)] as const)
    )
  ]);
  const injuries = new Map(injuryPairs);
  const espnNews = new Map(espnNewsPairs);
  const teamNews = (teamId: number) => [
    ...(espnNews.get(teamId) ?? []),
    ...(transactionNews.get(teamId)?.flags ?? [])
  ].slice(0, 8);
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
      const home: TeamBrainSide = { team: game.home_team, injuries: injuries.get(game.homeTeam.id) ?? emptyInjuries, form: formFor(game.homeTeam.id), news: teamNews(game.homeTeam.id) };
      const away: TeamBrainSide = { team: game.away_team, injuries: injuries.get(game.awayTeam.id) ?? emptyInjuries, form: formFor(game.awayTeam.id), news: teamNews(game.awayTeam.id) };
      const season = {
        home: seasonContexts.get(String(game.homeTeam.id)),
        away: seasonContexts.get(String(game.awayTeam.id))
      };
      const churnGap =
        sport === "mlb"
          ? (transactionNews.get(game.awayTeam.id)?.churn ?? 0) - (transactionNews.get(game.homeTeam.id)?.churn ?? 0)
          : undefined;
      const homeQb = qbContexts.get(String(game.homeTeam.id));
      const awayQb = qbContexts.get(String(game.awayTeam.id));
      const qbGap = homeQb?.value != null && awayQb?.value != null ? Number((homeQb.value - awayQb.value).toFixed(3)) : undefined;
      const { logitDelta, factors } = combineFactors(buildFactors(sport, game, home, away, weather, season, churnGap, qbGap, { home: homeQb, away: awayQb }));
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
