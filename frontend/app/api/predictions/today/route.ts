import { getDefaultPredictionDate, getPredictions } from "@/lib/server/mlbModel";

export async function GET(request: Request): Promise<Response> {
  const date = new URL(request.url).searchParams.get("date") ?? getDefaultPredictionDate();
  try {
    return Response.json(await getPredictions(date), { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load MLB predictions.";
    return Response.json({ error: message }, { status: 503 });
  }
}
