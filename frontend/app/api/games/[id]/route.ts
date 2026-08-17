import { getGamePrediction } from "@/lib/server/mlbModel";
import { getNflGamePrediction } from "@/lib/server/nflModel";
import { getServerAccess } from "@/lib/server/access";
import { applyGameEntitlement } from "@/lib/server/entitlements";
import { preserveGameSnapshot } from "@/lib/server/predictionSnapshots";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const sport = new URL(_request.url).searchParams.get("sport") === "nfl" ? "nfl" : "mlb";
    const [prediction, access] = await Promise.all([
      sport === "nfl" ? getNflGamePrediction(id) : getGamePrediction(id),
      getServerAccess()
    ]);
    return prediction ? Response.json(applyGameEntitlement(await preserveGameSnapshot(prediction), access, !access.isPro), { headers: { "Cache-Control": "private, no-store" } }) : Response.json({ error: "Game not found." }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the game.";
    return Response.json({ error: message }, { status: 503 });
  }
}
