import { getRecentHistory } from "@/lib/server/mlbModel";
import { getNflHistory } from "@/lib/server/nflModel";

export async function GET(request: Request): Promise<Response> {
  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 60);
  const sport = new URL(request.url).searchParams.get("sport") === "nfl" ? "nfl" : "mlb";
  try {
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 60;
    return Response.json(sport === "nfl" ? await getNflHistory(limit) : await getRecentHistory(limit), {
      headers: { "Cache-Control": "public, max-age=900" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load prediction history.";
    return Response.json({ error: message }, { status: 503 });
  }
}
