import { getGameBrainContexts } from "@/lib/server/brain/gameBrain";
import { getPredictions } from "@/lib/server/mlbModel";
import { getNflPredictions } from "@/lib/server/nflModel";
import { isValidPickDate } from "@/lib/server/playerPickScoring";
import { isSport } from "@/lib/sports";

function easternToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * Game Brain (Phase 1, shadow mode): pregame matchup intelligence per game —
 * injuries, venue + weather, recent form — with a bounded shadow adjustment
 * that never changes the published prediction. See docs/game-brain-plan.md.
 */
export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const requestedSport = query.get("sport") ?? "mlb";
  if (!isSport(requestedSport)) return Response.json({ error: "Unsupported sport." }, { status: 400 });
  const sport = requestedSport;
  const date = query.get("date") ?? easternToday();
  if (!isValidPickDate(date)) return Response.json({ error: "Use a valid date in YYYY-MM-DD format." }, { status: 400 });
  if (process.env.BRAIN === "off") return Response.json({ error: "Game Brain is disabled." }, { status: 503 });
  try {
    const slate = sport === "nfl" ? await getNflPredictions(date) : await getPredictions(date);
    const gameId = query.get("gameId");
    const contexts = await getGameBrainContexts(sport, date, slate.predictions);
    const payload = gameId ? contexts.filter((context) => context.gameId === gameId) : contexts;
    return Response.json(
      { sport, date, mode: "shadow", updatedAt: new Date().toISOString(), games: payload },
      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } }
    );
  } catch {
    return Response.json({ error: "Game Brain is temporarily unavailable." }, { status: 503, headers: { "Retry-After": "30" } });
  }
}
