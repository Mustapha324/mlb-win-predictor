import { getDefaultPredictionDate, getPredictions } from "@/lib/server/mlbModel";
import { getDefaultNflDate, getNflPredictions } from "@/lib/server/nflModel";
import { preservePregameSnapshots } from "@/lib/server/predictionSnapshots";
import { isValidPickDate } from "@/lib/server/playerPickScoring";
import { isSport } from "@/lib/sports";

export async function GET(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const requestedSport = searchParams.get("sport") ?? "mlb";
  if (!isSport(requestedSport)) return Response.json({ error: "Unsupported sport." }, { status: 400 });
  const sport = requestedSport;
  const date = searchParams.get("date") ?? (sport === "nfl" ? getDefaultNflDate() : getDefaultPredictionDate());
  if (!isValidPickDate(date)) return Response.json({ error: "Use a valid date in YYYY-MM-DD format." }, { status: 400 });
  try {
    const predictions = await (sport === "nfl" ? getNflPredictions(date) : getPredictions(date));
    return Response.json(await preservePregameSnapshots(predictions), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load predictions.";
    return Response.json({ error: message }, { status: 503 });
  }
}
