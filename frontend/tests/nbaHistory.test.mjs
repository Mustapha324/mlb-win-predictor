import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

test("NBA results distinguish captured calls from pregame-only replays and only update final fields", async () => {
  const rows = [{id:"warmup",date:"2026-10-18T20:00Z",homeId:"1",awayId:"2",homeName:"Home",awayName:"Away",homeScore:100,awayScore:90},{id:"captured",date:"2026-10-19T20:00Z",homeId:"1",awayId:"2",homeName:"Home",awayName:"Away",homeScore:90,awayScore:100},{id:"replay",date:"2026-10-20T20:00Z",homeId:"1",awayId:"2",homeName:"Home",awayName:"Away",homeScore:110,awayScore:100}];
  const provider = moduleUrl(`export const nbaCompletedResults=async()=>${JSON.stringify(rows)};`);
  const storage = moduleUrl(`export const updates=[];export const hasSupabaseAdminCredentials=()=>true;
    export const createSupabaseAdminClient=()=>({from:()=>({select:()=>({eq:()=>({in:async()=>({data:[{game_id:"captured",pregame_predicted_winner:"Away",pregame_home_win_probability:.3,pregame_away_win_probability:.7}]})})}),update:(value)=>{updates.push(value);return {eq:()=>({eq:async()=>({error:null})})}}})});`);
  let source = await readFile(new URL("../lib/server/nbaHistory.ts",import.meta.url),"utf8");
  source=source.replace('import "server-only";',"").replace('"@/lib/server/nba"',JSON.stringify(provider)).replace('"@/lib/supabase/admin"',JSON.stringify(storage)).replace('"@/lib/nbaPrediction"',JSON.stringify(new URL("../lib/nbaPrediction.ts",import.meta.url).href));
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const {getNbaHistory}=await import(moduleUrl(compiled));
  const result=await getNbaHistory(100);
  const captured=result.find(row=>row.gameId==="captured");
  assert.equal(captured.historySource,"Captured pregame");assert.equal(captured.predictedWinner,"Away");assert.equal(captured.homeWinProbability,.3);assert.equal(captured.wasCorrect,true);
  assert.equal(result.find(row=>row.gameId==="replay").historySource,"Rating replay");
  const {updates}=await import(storage);
  assert.equal(updates.length,1);
  assert.deepEqual(Object.keys(updates[0]).sort(),["actual_winner","away_score","final_at","home_score"]);
});
