import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("NBA snapshot migration preserves private access and admits basketball rows", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec("create role anon; create role authenticated;");
  const migrations = new URL("../../supabase/migrations/", import.meta.url);
  await db.exec(await readFile(new URL("202608170001_player_pick_snapshots.sql", migrations), "utf8"));
  const insert = "insert into public.player_pick_snapshots(pick_key,sport,slate_date,game_id,rank,player_id,player_name,team,opponent,market,selection,line,projection,confidence,model_version) values('nba-test','nba','2026-10-20','1',1,'1','Player','Home','Away','Points','Over',24.5,28,0.65,'nba-player-form-v1-experimental')";
  await assert.rejects(db.exec(insert), /check constraint/);
  await db.exec(await readFile(new URL("202610200001_nba_player_picks.sql", migrations), "utf8"));
  await db.exec(insert);
  assert.equal((await db.query("select count(*)::int as n from public.player_pick_snapshots where sport='nba'")).rows[0].n, 1);
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await db.query("select has_table_privilege($1,'public.player_pick_snapshots','select') as allowed", [role])).rows[0].allowed, false);
    assert.equal((await db.query("select has_table_privilege($1,'public.player_pick_snapshots','insert') as allowed", [role])).rows[0].allowed, false);
  }
  await db.exec(await readFile(new URL("202608240001_player_pick_market_odds.sql", migrations), "utf8"));
  const launch = JSON.parse(await readFile(new URL("../scripts/nba-launch-snapshot.json", import.meta.url), "utf8"));
  const script = await readFile(new URL("../scripts/migrate-nba.mjs", import.meta.url), "utf8");
  const seedLoop = script.slice(script.indexOf("for (const pick of launch.picks)"), script.indexOf('    await client.query("commit")'));
  const seed = new Function("client", "launch", `return (async()=>{${seedLoop}})()`);
  await seed(db, launch);
  const record = (await db.query("select count(*)::int as total,count(*) filter(where result='correct')::int as wins,count(*) filter(where result='incorrect')::int as losses from public.player_pick_snapshots where slate_date='2026-10-20' and pick_key <> 'nba-test'")).rows[0];
  assert.deepEqual(record, { total:40, wins:22, losses:18 });
  const originalLine = launch.picks[0].line;
  launch.picks[0].line = 999;
  await seed(db, launch);
  assert.equal((await db.query("select line from public.player_pick_snapshots where pick_key=$1",[launch.picks[0].id])).rows[0].line, originalLine);
});
