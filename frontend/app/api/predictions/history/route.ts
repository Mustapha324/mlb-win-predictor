import { getRecentHistory } from "@/lib/server/mlbModel";

export async function GET(request: Request): Promise<Response> {
  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 60);
  try {
    return Response.json(await getRecentHistory(Number.isFinite(requestedLimit) ? requestedLimit : 60), {
      headers: { "Cache-Control": "public, max-age=900" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load prediction history.";
    return Response.json({ error: message }, { status: 503 });
  }
}
