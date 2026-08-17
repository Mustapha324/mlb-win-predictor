import { getModelMetrics } from "@/lib/server/mlbModel";
import { getNflMetrics } from "@/lib/server/nflModel";
import { getModelRefreshStatus } from "@/lib/server/modelRefresh";

export async function GET(request: Request): Promise<Response> {
  const sport = new URL(request.url).searchParams.get("sport") === "nfl" ? "nfl" : "mlb";
  const [metrics, refresh] = await Promise.all([
    sport === "nfl" ? getNflMetrics() : Promise.resolve(getModelMetrics()),
    getModelRefreshStatus(sport)
  ]);
  return Response.json({ ...metrics, refresh }, { headers: { "Cache-Control": "public, max-age=300" } });
}
