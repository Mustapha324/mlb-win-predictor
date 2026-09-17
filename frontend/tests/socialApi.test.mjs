import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { classifyGameResult, isPickOpen, winPercentage } from "../lib/social.ts";

async function load(path, providers) {
  const { outputText } = ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => { assert.ok(Object.hasOwn(providers, name), name); return providers[name]; }, loaded, loaded.exports);
  return loaded.exports;
}

test("social API validates origins, payloads, sessions and caches without exposing internal errors", async () => {
  class SocialError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
  let failure = null; let writes = 0;
  const handlers = await load("../app/api/social/route.ts", { "@/lib/server/social": {
    SocialError,
    readSocial: async () => { if (failure) throw failure; return { authenticated: false, profile: null }; },
    writeSocial: async () => { writes++; if (failure) throw failure; return { ok: true }; }
  } });
  const post = (body, headers = {}) => handlers.POST(new Request("http://localhost/api/social", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body }));
  assert.equal((await post('{"action":"friend"}', { Origin: "https://evil.invalid" })).status, 403);
  assert.equal((await post('{"action":"friend"}', { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await post('{}', { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post("{" )).status, 400);
  assert.equal((await post("[]")).status, 400);
  assert.equal((await post('{"action":"billing"}')).status, 400);
  assert.equal((await post(' '.repeat(4097))).status, 413);
  assert.equal(writes, 0);
  failure = new SocialError("Sign in", 401);
  assert.equal((await post('{"action":"pick"}')).status, 401);
  failure = new Error("Internal secret or DB details");
  const failed = await handlers.GET(new Request("http://localhost/api/social?view=me"));
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes("Internal secret"));
  failure = null;
  const response = await handlers.GET(new Request("http://localhost/api/social?view=me"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
});

test("social writes refresh trusted game data and derive actor exclusively from verified authentication", async () => {
  const calls = [];
  let signedIn = true; let configured = true; let missing = false; let failFeed = false;
  const game = { sport: "mlb", gameId: "123", date: "2030-01-01", game_time_utc: "2030-01-01T12:00:00Z", status: "Scheduled", is_final: false, home_team: "Home", away_team: "Away", pregame_predicted_winner: "Home", pregame_home_win_probability: 0.62, pregame_away_win_probability: 0.38, prediction_source: "model", home_score: null, away_score: null, actual_winner: null };
  const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null, error: null }; } };
  const admin = { from: () => query, async rpc(name, payload) { calls.push({ name, payload }); return { data: name === "social_register_game" ? 0 : { saved: true }, error: null }; } };
  const domain = await load("../lib/server/social.ts", {
    "server-only": {},
    "@/lib/sports": { isSport: (sport) => sport === "mlb" || sport === "nfl" },
    "@/lib/social": { isPickOpen, classifyGameResult },
    "@/lib/supabase/admin": { createSupabaseAdminClient: () => admin, hasSupabaseAdminCredentials: () => configured },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: "verified-user" } : null }, error: null }) }, rpc: async () => ({ data: null, error: null }) }) },
    "@/lib/server/mlbModel": { getGamePrediction: async () => { if (failFeed) throw new Error("Feed offline"); return missing ? null : game; } }
  });
  signedIn = false;
  await assert.rejects(domain.writeSocial("pick", { sport: "mlb", gameId: "123" }), (e) => e.status === 401);
  assert.equal(calls.length, 0);
  signedIn = true; configured = false;
  await assert.rejects(domain.writeSocial("pick", { sport: "mlb", gameId: "123" }), (e) => e.status === 503);
  configured = true; missing = true;
  await assert.rejects(domain.writeSocial("pick", { sport: "mlb", gameId: "123" }), (e) => e.status === 404);
  missing = false; failFeed = true;
  await assert.rejects(domain.writeSocial("pick", { sport: "mlb", gameId: "123" }), /Feed offline/);
  assert.equal(calls.length, 0);
  failFeed = false;
  for (const status of ["In Progress", "Postponed", "Cancelled", "Delayed", "Unknown"]) {
    game.status = status;
    await assert.rejects(domain.writeSocial("pick", { sport: "mlb", gameId: "123" }), (e) => e.status === 409);
  }
  game.status = "Scheduled";
  await domain.writeSocial("pick", { sport: "mlb", gameId: "123", selection: "Home", p_actor: "forged", user_id: "forged", startsAt: "2099-01-01", modelProbability: 1 });
  assert.equal(calls[0].name, "social_register_game");
  assert.equal(calls[0].payload.p_game.startsAt, game.game_time_utc);
  assert.equal(calls[0].payload.p_game.modelProbability, 0.62);
  assert.equal(calls[1].payload.p_actor, "verified-user");
});

test("game result and win-rate helpers reject ambiguous finals and invalid deadlines", () => {
  assert.equal(winPercentage(0, 0), null); assert.equal(winPercentage(64, 41), 61);
  const now = Date.parse("2030-01-01T12:00:00Z");
  assert.equal(isPickOpen("2030-01-01T12:00:00Z", "Scheduled", now), false);
  assert.equal(isPickOpen(null, "Scheduled", now), false);
  assert.equal(isPickOpen("not-a-date", "Scheduled", now), false);
  assert.equal(isPickOpen("2030-01-01T13:00:00Z", "Scheduled", now), true);
  const game = { is_final: true, status: "Final", home_team: "Home", away_team: "Away", actual_winner: null, home_score: null, away_score: null };
  assert.equal(classifyGameResult(game).status, "closed");
  assert.deepEqual(classifyGameResult({ ...game, home_score: 3, away_score: 3 }), { status: "final", winner: null });
  assert.equal(classifyGameResult({ ...game, status: "Postponed" }).status, "void");
});
