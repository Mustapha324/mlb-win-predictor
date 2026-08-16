import { getGamePrediction } from "@/lib/server/mlbModel";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const prediction = await getGamePrediction(id);
    return prediction ? Response.json(prediction) : Response.json({ error: "Game not found." }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the game.";
    return Response.json({ error: message }, { status: 503 });
  }
}
