import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Real PostgreSQL semantics in an isolated database. auth functions reproduce
// PostgREST's verified JWT settings; no hosted account or credentials are used.
test("social migrations enforce identity, deadlines, grading and authorization", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const alice = "11111111-1111-4111-8111-111111111111";
  const bob = "22222222-2222-4222-8222-222222222222";
  const eve = "33333333-3333-4333-8333-333333333333";
  const legacy = "44444444-4444-4444-8444-444444444444";
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key,email text,created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    insert into auth.users(id,email) values('${legacy}','private@example.invalid');
  `);
  const folder = new URL("../../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(folder)).filter((name) => name.endsWith(".sql")).sort()) {
    let sql = await readFile(new URL(name, folder), "utf8");
    // pgcrypto digest is used only by the retired invite RPC; PGlite ships core
    // gen_random_uuid but not pgcrypto. All tables, grants, triggers and RPCs run.
    sql = sql.replace(/create extension if not exists pgcrypto;/i, "");
    if (name === "202609140001_free_social_platform.sql") await db.query("insert into public.profiles(id,email) values($1,$2)", [legacy, "private@example.invalid"]);
    await db.exec(sql);
  }
  for (const [id, email] of [[alice, "alice@example.invalid"], [bob, "bob@example.invalid"], [eve, "eve@example.invalid"]]) await db.query("insert into auth.users(id,email) values($1,$2)", [id, email]);
  async function as(role, id, sql, params = []) {
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)", [id ?? "", role]);
      const result = await tx.query(sql, params);
      return result.rows[0]?.value;
    });
  }
  const read = (id, view, params = {}) => as(id ? "authenticated" : "anon", id, "select public.social_read($1,$2) as value", [view, params]);
  const write = (id, action, payload, role = "authenticated") => as(role, role === "service_role" ? null : id, "select public.social_write($1,$2,$3) as value", [action, payload, role === "service_role" ? id : null]);
  const pick = (id, gameId, selection) => write(id, "pick", { sport: "mlb", gameId, selection }, "service_role");
  const startsAt = new Date(Date.now() + 3_600_000).toISOString();
  const game = (gameId, overrides = {}) => ({ sport: "mlb", gameId, date: startsAt.slice(0, 10), startsAt, homeTeam: "Home", awayTeam: "Away", modelSelection: "Home", modelProbability: 0.64, modelVersion: "snapshot-v1", status: "scheduled", winner: null, ...overrides });
  const register = (value) => as("service_role", null, "select public.social_register_game($1) as value", [value]);
  await t.test("backfills legacy profiles and creates new identities without leaking email or IDs", async () => {
    for (const id of [legacy, alice, bob, eve]) {
      const me = await read(id, "me");
      assert.equal(me.authenticated, true);
      assert.match(me.profile.username, /^player_[a-f0-9]{12}$/);
      assert.equal(me.profile.stats.total, 0);
      const serialized = JSON.stringify(me);
      assert.ok(!serialized.includes(id)); assert.ok(!serialized.includes("@example.invalid"));
    }
    assert.deepEqual(await read(null, "me"), { authenticated: false, profile: null });
    await assert.rejects(read(null, "picks"), /Sign in/);
  });
  for (const [id, username] of [[alice, "alice"], [bob, "bob"], [eve, "eve"]]) await write(id, "profile", { username, displayName: username, avatar: "⚾" });
  await t.test("profile uniqueness and table grants prevent forgery and retired billing changes", async () => {
    await assert.rejects(write(eve, "profile", { username: "alice" }), /already taken/);
    await assert.rejects(as("authenticated", eve, "select public.social_write('profile','{\"username\":\"stolen\"}',$1) as value", [alice]), /another account/);
    for (const table of ["profiles", "social_profiles", "social_games", "user_picks", "social_stats", "friendships"]) {
      await assert.rejects(as("authenticated", eve, `select * from public.${table}`), /permission denied/);
    }
    await assert.rejects(as("authenticated", eve, "update public.profiles set access_tier='pro' where id=$1", [eve]), /permission denied/);
    await assert.rejects(as("authenticated", eve, "select public.redeem_pro_code('retired')"), /permission denied/);
    await assert.rejects(as("anon", null, "select public.social_refresh_stats($1)", [alice]), /permission denied/);
  });
  await register(game("edit"));
  let alicePick;
  await t.test("only verified server submissions work; selection and snapshot ignore forged client data", async () => {
    await assert.rejects(write(alice, "pick", { sport: "mlb", gameId: "edit", selection: "Home" }), /Submit picks through/);
    await assert.rejects(as("authenticated", alice, "select public.social_register_game($1)", [game("forged")]), /permission denied/);
    await assert.rejects(pick(alice, "missing", "Home"), /unavailable/);
    await assert.rejects(pick(alice, "edit", "Not a team"), /Choose one/);
    alicePick = await write(alice, "pick", { sport: "mlb", gameId: "edit", selection: "Home", modelProbability: 1, startsAt: "2099-01-01", user_id: eve }, "service_role");
    assert.equal(alicePick.modelProbability, 0.64); assert.equal(alicePick.modelSelection, "Home"); assert.equal(alicePick.username, "alice");
    await register(game("edit", { modelSelection: "Away", modelProbability: 0.8, modelVersion: "updated" }));
    const changed = await pick(alice, "edit", "Away");
    assert.equal(changed.id, alicePick.id); assert.equal(changed.selection, "Away");
    assert.equal(changed.modelProbability, 0.64); assert.equal(changed.modelVersion, "snapshot-v1");
    assert.equal((await read(alice, "me")).profile.stats.pending, 1);
  });
  await t.test("friend requests require the recipient; outsiders cannot mutate another pair", async () => {
    await write(alice, "friend", { username: "bob", operation: "request" });
    await assert.rejects(write(alice, "friend", { username: "bob", operation: "accept" }), /No incoming/);
    await assert.rejects(write(eve, "friend", { username: "alice", operation: "accept" }), /No incoming/);
    await write(eve, "friend", { username: "alice", operation: "remove" });
    assert.equal((await read(bob, "friends")).incoming.length, 1);
    await write(bob, "friend", { username: "alice", operation: "accept" });
    assert.equal((await read(alice, "friends")).friends[0].username, "bob");
    assert.equal((await read(alice, "me")).profile.friendCount, 1);
    await write(eve, "friend", { username: "bob", operation: "request" });
    await write(bob, "friend", { username: "eve", operation: "decline" });
    assert.equal((await read(eve, "friends")).outgoing.length, 0);
  });
  await t.test("pregame picks are friends-only and community counts wait for lock", async () => {
    assert.equal((await read(null, "picks", { username: "alice" })).length, 0);
    assert.equal((await read(eve, "picks", { username: "alice" })).length, 0);
    assert.equal((await read(bob, "picks", { username: "alice" })).length, 1);
    const view = await read(bob, "game", { sport: "mlb", gameId: "edit" });
    assert.equal(view.friends.total, 1); assert.equal(view.community.total, 0);
    assert.equal((await read(bob, "feed"))[0].pick.selection, "Away");
  });
  await t.test("tails are independent copies; changing or deleting source never rewrites them", async () => {
    await assert.rejects(write(eve, "tail", { pickId: alicePick.id }, "service_role"), /Only current friends/);
    const tail = await write(bob, "tail", { pickId: alicePick.id }, "service_role");
    assert.equal(tail.selection, "Away"); assert.equal(tail.sourcePickId, alicePick.id); assert.equal(tail.tailedFrom, "alice");
    await pick(alice, "edit", "Home");
    assert.equal((await read(bob, "picks"))[0].selection, "Away");
    await write(alice, "deletePick", { sport: "mlb", gameId: "edit" }, "service_role");
    const saved = (await read(bob, "picks"))[0];
    assert.equal(saved.selection, "Away"); assert.equal(saved.sourcePickId, alicePick.id);
    assert.equal((await read(alice, "me")).profile.stats.pending, 0);
  });
  await t.test("database deadline rejects creation, edits, deletion and tails at game start", async () => {
    alicePick = await pick(alice, "edit", "Home");
    await db.query("update public.social_games set starts_at=clock_timestamp()-interval '1 second' where game_id='edit'");
    for (const [id, action, payload] of [[eve, "pick", { sport: "mlb", gameId: "edit", selection: "Home" }], [alice, "pick", { sport: "mlb", gameId: "edit", selection: "Away" }], [alice, "deletePick", { sport: "mlb", gameId: "edit" }], [bob, "tail", { pickId: alicePick.id }]]) await assert.rejects(write(id, action, payload, "service_role"), /locked/);
    assert.equal((await read(null, "picks", { username: "alice" }))[0].locked, true);
    assert.equal((await read(null, "game", { sport: "mlb", gameId: "edit" })).community.total, 2);
    await register(game("edit", { startsAt: new Date(Date.now() + 86_400_000).toISOString() }));
    await assert.rejects(pick(eve, "edit", "Home"), /locked/);
  });
  await t.test("grading is idempotent and refreshes cached model comparison and tail records", async () => {
    assert.equal(await register(game("edit", { status: "final", winner: "Home" })), 2);
    const cachedBefore = (await db.query("select user_id,stats,updated_at::text from public.social_stats where user_id in ($1,$2) order by user_id", [alice, bob])).rows;
    assert.equal(await register(game("edit", { status: "final", winner: "Home" })), 0);
    const cachedAfter = (await db.query("select user_id,stats,updated_at::text from public.social_stats where user_id in ($1,$2) order by user_id", [alice, bob])).rows;
    assert.deepEqual(cachedAfter, cachedBefore, "repeated final must not rewrite either user's stats cache");
    const a = (await read(alice, "me")).profile.stats;
    const b = (await read(bob, "me")).profile.stats;
    assert.equal(a.wins, 1); assert.equal(a.pending, 0); assert.equal(a.winPercentage, 100); assert.equal(a.currentStreak, "W1");
    assert.equal(b.losses, 1); assert.equal(b.currentStreak, "L1"); assert.equal(b.tails[0].losses, 1);
    assert.equal((await read(bob, "picks"))[0].correct, false);
    await assert.rejects(db.query("delete from public.social_games where game_id='edit'"), /foreign key/);
  });
  await t.test("ties and postponements become pushes/voids and never inflate win percentage", async () => {
    for (const [id, status] of [["tie", "final"], ["postponed", "void"]]) {
      await register(game(id)); await pick(alice, id, "Home");
      await register(game(id, { status, winner: null }));
      await assert.rejects(pick(bob, id, "Home"), /locked/);
    }
    const stats = (await read(alice, "me")).profile.stats;
    assert.equal(stats.pushes, 1); assert.equal(stats.voids, 1); assert.equal(stats.graded, 1); assert.equal(stats.winPercentage, 100);
    assert.equal((await read(null, "leaderboard")).entries.length, 0);
  });
  await t.test("leaderboards require twenty graded picks and aggregate sport/last-ten records", async () => {
    for (let i = 0; i < 19; i++) { const id = `rank-${i}`; await register(game(id)); await pick(alice, id, "Home"); await register(game(id, { status: "final", winner: i < 4 ? "Away" : "Home" })); }
    const board = await read(null, "leaderboard", { sport: "mlb", scope: "community" });
    assert.equal(board.entries.length, 1); assert.equal(board.entries[0].username, "alice");
    assert.equal(board.entries[0].picks, 20); assert.equal(board.entries[0].winPercentage, 80);
    const stats = (await read(alice, "me")).profile.stats;
    assert.equal(stats.mlb.graded, 20); assert.equal(stats.nfl.graded, 0); assert.equal(stats.last10.graded, 10); assert.equal(stats.bestStreak, 15);
    await write(bob, "friend", { username: "alice", operation: "remove" });
    assert.equal((await read(bob, "friends")).friends.length, 0);
    assert.equal((await read(bob, "leaderboard", { scope: "friends" })).entries.length, 0);
  });
  await t.test("tail records follow stable identity across renames and username reuse", async () => {
    const cachedAt = (await db.query("select updated_at::text from public.social_stats where user_id=$1", [bob])).rows[0].updated_at;
    await write(alice, "profile", { username: "ace", displayName: "Alice" });
    await write(eve, "profile", { username: "alice", displayName: "Eve" });
    assert.deepEqual((await read(bob, "me")).profile.stats.tails, [{ username: "ace", profileUsername: "ace", wins: 0, losses: 1, winPercentage: 0 }]);
    assert.equal((await db.query("select updated_at::text from public.social_stats where user_id=$1", [bob])).rows[0].updated_at, cachedAt, "renames resolve at read time without refreshing the follower cache");
    for (const [id, username] of [[alice, "ace"], [eve, "alice"]]) {
      await write(bob, "friend", { username, operation: "request" });
      await write(id, "friend", { username: "bob", operation: "accept" });
    }
    for (const [id, gameId, selection] of [[alice, "tail-renamed", "Home"], [eve, "tail-reused", "Away"]]) {
      await register(game(gameId));
      const source = await pick(id, gameId, selection);
      await write(bob, "tail", { pickId: source.id }, "service_role");
      await register(game(gameId, { status: "final", winner: "Home" }));
    }
    const tails = (await read(bob, "me")).profile.stats.tails;
    assert.equal(tails.length, 2, "renamed source stays one group while another account reusing its old name stays separate");
    assert.deepEqual(tails.find((tail) => tail.profileUsername === "ace"), { username: "ace", profileUsername: "ace", wins: 1, losses: 1, winPercentage: 50 });
    assert.deepEqual(tails.find((tail) => tail.profileUsername === "alice"), { username: "alice", profileUsername: "alice", wins: 0, losses: 1, winPercentage: 0 });
    const cachedTails = (await db.query("select stats->'tails' as tails from public.social_stats where user_id=$1", [bob])).rows[0].tails;
    assert.ok(cachedTails.some((tail) => tail.sourceUserId === alice), "private cache retains stable identity for name resolution");
    const responses = [
      await read(bob, "me"), await read(null, "profile", { username: "bob" }),
      await read(null, "search", { q: "bo" }), await read(alice, "friends"),
      await write(bob, "profile", { username: "bob" }),
      await write(alice, "friend", { username: "bob", operation: "request" }),
      await read(null, "leaderboard"), await read(alice, "feed"),
      await read(null, "game", { sport: "mlb", gameId: "tail-renamed" }),
      await read(null, "picks", { username: "bob" })
    ];
    for (const response of responses) {
      const serialized = JSON.stringify(response);
      for (const internalId of [alice, bob, eve]) assert.ok(!serialized.includes(internalId), "public DTOs must not expose account UUIDs");
      assert.ok(!serialized.includes("sourceUserId"), "internal tail identity must never appear in any public read or mutation response");
    }
    for (const role of ["anon", "authenticated"]) await assert.rejects(as(role, role === "anon" ? null : bob, "select public.social_stats_dto('{}'::jsonb)"), /permission denied/);
  });
  await t.test("deleted tail sources keep historical attribution without linking a reused username", async () => {
    const cachedAt = (await db.query("select updated_at::text from public.social_stats where user_id=$1", [bob])).rows[0].updated_at;
    await db.query("delete from auth.users where id=$1", [eve]);
    const replacement = "55555555-5555-4555-8555-555555555555";
    await db.query("insert into auth.users(id,email) values($1,$2)", [replacement, "replacement@example.invalid"]);
    await write(replacement, "profile", { username: "alice" });
    const expected = { username: "alice", profileUsername: null, wins: 0, losses: 1, winPercentage: 0 };
    let tails = (await read(null, "profile", { username: "bob" })).stats.tails;
    assert.deepEqual(tails.find((tail) => tail.username === "alice"), expected);
    assert.equal((await db.query("select updated_at::text from public.social_stats where user_id=$1", [bob])).rows[0].updated_at, cachedAt, "deletion is resolved safely even before a follower cache refresh");
    await write(bob, "profile", { username: "bob" });
    tails = (await read(bob, "me")).profile.stats.tails;
    assert.deepEqual(tails.find((tail) => tail.username === "alice"), expected, "rebuilding the cache must never resolve deleted identity by username");
    assert.deepEqual(tails.find((tail) => tail.profileUsername === "ace"), { username: "ace", profileUsername: "ace", wins: 1, losses: 1, winPercentage: 50 });
    assert.ok(!JSON.stringify(tails).includes(replacement));
  });
});
