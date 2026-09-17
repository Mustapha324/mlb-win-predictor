import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { safeReturnPath } from "../lib/authNavigation.ts";
import { isValidPickDate } from "../lib/server/playerPickScoring.ts";

// Execute the real route/action with isolated providers. An unexpected auth or
// billing dependency fails the test rather than silently becoming a guest.
async function loadModule(path, providers) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const loadedModule = { exports: {} };
  const requireProvider = (name) => {
    assert.ok(Object.hasOwn(providers, name), `Unexpected dependency: ${name}`);
    return providers[name];
  };
  new Function("require", "module", "exports", outputText)(requireProvider, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const validators = {
  "@/lib/server/playerPickScoring": { isValidPickDate },
  "@/lib/sports": { isSport: (sport) => sport === "mlb" || sport === "nfl" }
};

for (const sport of ["mlb", "nfl"]) {
  test(`${sport}: guests receive every game, model factor, live field and preserved prediction`, async () => {
    const predictions = [1, 2, 3, 4].map((id) => ({
      game_id: String(id), sport, predicted_winner: "Home", pregame_predicted_winner: "Original pick",
      pregame_home_win_probability: 0.67, home_win_probability: 0.64,
      live_home_win_probability: 0.72, live_market: { favorite: "Home", homeWinProbability: 0.7 },
      model_home_win_probability: 0.64, market_delta: 0.04, prediction_tier: "A", factors: ["Pregame factor"],
      pick_result: "hit", pick_leading: true
    }));
    const slate = { sport, live_updates: true, predictions };
    let snapshots = 0;
    const serve = async () => slate;
    const { GET } = await loadModule("../app/api/predictions/today/route.ts", {
      ...validators,
      "@/lib/server/mlbModel": { getPredictions: serve, getDefaultPredictionDate: () => "2026-09-14" },
      "@/lib/server/nflModel": { getNflPredictions: serve, getDefaultNflDate: () => "2026-09-14" },
      "@/lib/server/predictionSnapshots": { preservePregameSnapshots: async (value) => { snapshots++; return value; } }
    });
    const response = await GET(new Request(`http://localhost/api/predictions/today?sport=${sport}&date=2026-09-14`));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), slate);
    assert.equal(snapshots, 1);
    assert.equal(response.headers.get("location"), null);
    const invalid = await GET(new Request("http://localhost/api/predictions/today?sport=bad"));
    assert.equal(invalid.status, 400);
    assert.equal(snapshots, 1);
  });
}

test("guest game detail keeps saved model data; missing games and provider failures have explicit states", async () => {
  let game = { game_id: "123", pregame_predicted_winner: "Away", factors: ["Pitching"], live_home_win_probability: 0.4 };
  let fail = false;
  const serve = async () => { if (fail) throw new Error("Feed unavailable"); return game; };
  const { GET } = await loadModule("../app/api/games/[id]/route.ts", {
    "@/lib/server/mlbModel": { getGamePrediction: serve },
    "@/lib/server/nflModel": { getNflGamePrediction: serve },
    "@/lib/server/predictionSnapshots": { preserveGameSnapshot: async (value) => ({ ...value, prediction_source: "stored pregame" }) }
  });
  const request = () => GET(new Request("http://localhost/api/games/123"), { params: Promise.resolve({ id: "123" }) });
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...game, prediction_source: "stored pregame" });
  game = null;
  assert.equal((await request()).status, 404);
  fail = true;
  assert.equal((await request()).status, 503);
});

test("player board route serves all ranks and live summaries without account dependencies", async () => {
  let calls = 0;
  let fail = false;
  const board = { picks: Array.from({ length: 40 }, (_, rank) => ({ rank: rank + 1 })), topFiveLive: { leading: 4 }, liveSummary: { active: 40 } };
  const { GET } = await loadModule("../app/api/player-picks/route.ts", {
    ...validators,
    "@/lib/server/playerPicks": { getPlayerPicks: async () => { calls++; if (fail) throw new Error("Feed unavailable"); return board; } }
  });
  const response = await GET(new Request("http://localhost/api/player-picks?sport=nfl&date=2026-09-14"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), board);
  assert.equal((await GET(new Request("http://localhost/api/player-picks?date=2026-02-30"))).status, 400);
  assert.equal(calls, 1);
  fail = true;
  const unavailable = await GET(new Request("http://localhost/api/player-picks?date=2026-09-14"));
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("Retry-After"), "30");
});

test("session endpoint exposes no email or internal identifiers", async () => {
  const { GET } = await loadModule("../app/api/account/access/route.ts", {
    "@/lib/server/access": { getServerAccess: async () => ({ authenticated: true, email: "private@example.invalid", userId: "private-id" }) }
  });
  assert.deepEqual(await (await GET()).json(), { authenticated: true });
});

test("post-login navigation permits local pages and rejects external or malformed destinations", () => {
  assert.equal(safeReturnPath("/nfl/games/123?view=picks#my-pick"), "/nfl/games/123?view=picks#my-pick");
  for (const value of [null, "https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "javascript:alert(1)", "/\nevil", new Blob()]) {
    assert.equal(safeReturnPath(value), "/profile");
  }
});

function redirect(path) { throw new Error(`REDIRECT:${path}`); }

test("sign-in preserves the requested local pick page and blocks external return URLs", async () => {
  const { signIn } = await loadModule("../app/account/actions.ts", {
    "next/navigation": { redirect },
    "@/lib/authNavigation": { safeReturnPath },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ auth: { signInWithPassword: async ({ email }) => { assert.equal(email, "guest@example.invalid"); return { error: null }; } } }) }
  });
  const form = new FormData();
  form.set("email", "guest@example.invalid"); form.set("password", "sample-password"); form.set("next", "/games/123");
  await assert.rejects(signIn(form), /REDIRECT:\/games\/123$/);
  form.set("next", "https://evil.invalid");
  await assert.rejects(signIn(form), /REDIRECT:\/profile$/);
});

test("authentication failures do not redirect into account-only features", async () => {
  const { signIn } = await loadModule("../app/account/actions.ts", {
    "next/navigation": { redirect }, "@/lib/authNavigation": { safeReturnPath },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ auth: { signInWithPassword: async () => ({ error: { message: "Invalid login" } }) } }) }
  });
  const form = new FormData(); form.set("next", "/friends");
  await assert.rejects(signIn(form), /REDIRECT:\/account\?error=Invalid\+login&next=%2Ffriends$/);
});
