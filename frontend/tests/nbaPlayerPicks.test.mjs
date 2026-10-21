import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Execute the real server pipeline with isolated storage and provider responses.
// Production still imports the normal server-only Supabase module.
async function pipeline() {
  const nonce = Math.random();
  const storageUrl = `data:text/javascript;base64,${Buffer.from(`
    let rows=[];
    export const loadPlayerPickSnapshots=async()=>structuredClone(rows);
    export const loadRecentPlayerPickResults=async()=>structuredClone(rows.filter(p=>p.result!=="pending"));
    export const loadPendingPlayerPickDates=async()=>[];
    export const storeInitialPlayerPicks=async(date,picks)=>{for(const p of picks)if(!rows.some(r=>r.id===p.id))rows.push(structuredClone(p));return structuredClone(rows)};
    export const updatePlayerPickResults=async(date,picks)=>{for(const p of picks){const row=rows.find(r=>r.id===p.id);if(row)Object.assign(row,{status:p.status,statusLabel:p.statusLabel,actualValue:p.actualValue,result:p.result,resultUpdatedAt:p.resultUpdatedAt})}};
    // ${nonce}
  `).toString("base64")}`;
  let source = await readFile(new URL("../lib/server/nbaPlayerPicks.ts", import.meta.url), "utf8");
  source = source.replace('import "server-only";', "").replaceAll('"@/lib/server/playerPickStore"', JSON.stringify(storageUrl));
  source = source.replace(/"@\/lib\/([^"]+)"/g, (_, path) => JSON.stringify(new URL(`../lib/${path}.ts`, import.meta.url).href));
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output + `\n//${nonce}`).toString("base64")}`);
}

test("NBA player board freezes pregame lines, grades real finals, and leaves missing stats pending", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const { getNbaPlayerPicks } = await pipeline();
  const tipoff = new Date(Date.now() + 86400000).toISOString();
  const date = tipoff.slice(0, 10);
  const event = { id: "game", date: tipoff, status: { type: { state: "pre", shortDetail: "Scheduled" } }, competitions: [{ competitors: [{ team: { id: "home", displayName: "Home" } }, { team: { id: "away", displayName: "Away" } }] }] };
  let line = 24.5, phase = "pre", missing = false, callsToProps = 0;
  const prior = Array.from({ length: 20 }, (_, i) => ({ eventId: `prior-${i}`, stats: ["32", "30", "9", "8", "3-6"] }));
  const log = { names: ["minutes", "points", "totalRebounds", "assists", "threePointFieldGoalsMade-threePointFieldGoalsAttempted"], events: Object.fromEntries(prior.map((row, i) => [row.eventId, { gameDate: new Date(Date.now() - (i + 1) * 86400000).toISOString(), gameResult: "W" }])), seasonTypes: [{ displayName: "Regular Season", categories: [{ events: prior }] }] };
  globalThis.fetch = async url => {
    const path = String(url);
    if (path.includes("scoreboard")) return Response.json({ events: [{ ...event, date: phase === "pre" ? tipoff : new Date(Date.now() - 86400000).toISOString(), status: { type: { state: phase, completed: phase === "post", shortDetail: phase === "post" ? "Final" : "Scheduled" } } }] });
    if (path.includes("propBets")) {
      callsToProps++;
      const row = { athlete: { $ref: "https://example.invalid/athletes/1" }, type: { id: "1" }, current: { target: { value: line } }, lastUpdated: new Date(Date.now() - 60000).toISOString(), odds: { american: { value: "-110" } } };
      return Response.json({ items: [row, row, {...row, athlete: {$ref:"https://example.invalid/athletes/2"}}, {...row, athlete: {$ref:"https://example.invalid/athletes/2"}}, {...row, athlete: {$ref:"https://example.invalid/athletes/3"}}] });
    }
    if (path.includes("/roster")) return Response.json({ athletes: path.includes("/home/") ? [{ id: "1", displayName: "Test Player", status: { type: "active" }, headshot: { href: "https://a.espncdn.com/i/headshots/nba/players/full/1.png" } }, { id:"2", displayName:"DNP Player", status:{type:"active"} }, { id:"3", displayName:"Injured Player", status:{type:"active"}, injuries:[{status:"Out"}] }] : [] });
    if (path.includes("gamelog")) return Response.json(log);
    if (path.includes("summary")) return Response.json({ header: { competitions: [{ status: { type: { state: "post", completed: true, shortDetail: "Final" } } }] }, boxscore: { players: [{ statistics: [{ labels: ["PTS"], athletes: missing ? [] : [{ athlete: { id: "1" }, stats: ["28"], didNotPlay: false }, {athlete:{id:"2"},didNotPlay:true,stats:[]}] }] }] } });
    throw new Error(`Unexpected provider: ${path}`);
  };
  const first = await getNbaPlayerPicks(date);
  assert.equal(first.totalPicks, 2); assert.equal(first.picks[0].line, 24.5); assert.equal(first.picks[0].selection, "Over");
  assert.match(first.picks[0].headshotUrl, /nba\/players/);
  line = 99.5;
  const second = await getNbaPlayerPicks(date);
  assert.equal(second.picks[0].line, 24.5); assert.equal(callsToProps, 1);
  // The provider can report a completed rescheduled game before our original tipoff.
  // Move the frozen snapshot's start past only for this test through an event-time clock.
  const originalNow = Date.now;
  Date.now = () => Date.parse(tipoff) + 86400000;
  t.after(() => { Date.now = originalNow; });
  phase = "post"; missing = true;
  const awaiting = await getNbaPlayerPicks(date);
  assert.equal(awaiting.picks[0].result, "pending");
  missing = false;
  const final = await getNbaPlayerPicks(date);
  assert.equal(final.picks[0].line, 24.5); assert.equal(final.picks[0].projection, 30);
  assert.equal(final.picks[0].actualValue, 28); assert.equal(final.picks[0].result, "correct");
  assert.equal(final.performance.graded, 1); assert.equal(final.recentResults.length, 2); assert.equal(final.picks.find(p=>p.playerId==="2").result,"void"); assert.ok(!final.picks.some(p=>p.playerId==="3"));
  assert.equal(callsToProps, 1);
});
