import { getModelMetrics } from "@/lib/server/mlbModel";

export function GET(): Response {
  return Response.json(getModelMetrics(), { headers: { "Cache-Control": "public, max-age=3600" } });
}
