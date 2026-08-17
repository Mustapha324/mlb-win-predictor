import { getDefaultPredictionDate, getPredictions } from "@/lib/server/mlbModel";
import { getDefaultNflDate, getNflPredictions } from "@/lib/server/nflModel";
import { getServerAccess } from "@/lib/server/access";
import { applyPredictionEntitlements } from "@/lib/server/entitlements";
import { preservePregameSnapshots } from "@/lib/server/predictionSnapshots";

export async function GET(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const sport = searchParams.get("sport") === "nfl" ? "nfl" : "mlb";
  const date = searchParams.get("date") ?? (sport === "nfl" ? getDefaultNflDate() : getDefaultPredictionDate());
  try {
    const [predictions, access] = await Promise.all([
      sport === "nfl" ? getNflPredictions(date) : getPredictions(date),
      getServerAccess()
    ]);
    return Response.json(applyPredictionEntitlements(await preservePregameSnapshots(predictions), access), {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load predictions.";
    return Response.json({ error: message }, { status: 503 });
  }
}
