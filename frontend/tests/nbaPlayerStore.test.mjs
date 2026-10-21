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
});
