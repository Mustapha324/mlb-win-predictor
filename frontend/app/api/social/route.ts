import { readSocial, SocialError, writeSocial } from "@/lib/server/social";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const views = new Set(["me", "profile", "picks", "friends", "feed", "leaderboard", "search", "game"]);
const actions = new Set(["profile", "pick", "deletePick", "tail", "friend"]);

function failure(error: unknown): Response {
  const known = error instanceof SocialError;
  return Response.json({ available: false, error: known ? error.message : "Social features are temporarily unavailable. Please try again." }, { status: known ? error.status : 503, headers });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const view = params.get("view") ?? "me";
  if (!views.has(view)) return failure(new SocialError("Choose a supported social view."));
  try { return Response.json({ available: true, data: await readSocial(view, Object.fromEntries(params)) }, { headers }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request): Promise<Response> {
  // Cookie-authenticated mutations require same-origin JSON. Also reject
  // cross-site fetches even when an Origin header is absent.
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return failure(new SocialError("Use SportIQ to update your account.", 403));
  if (!request.headers.get("content-type")?.startsWith("application/json")) return failure(new SocialError("Send account updates as JSON.", 415));
  try {
    const text = await request.text();
    if (text.length > 4096) return failure(new SocialError("Account update is too large.", 413));
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { return failure(new SocialError("Invalid account update.")); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return failure(new SocialError("Invalid account update."));
    const body = payload as Record<string, unknown>;
    if (typeof body.action !== "string" || !actions.has(body.action)) return failure(new SocialError("Choose a supported account action."));
    return Response.json({ available: true, data: await writeSocial(body.action, body) }, { headers });
  } catch (error) { return failure(error); }
}
