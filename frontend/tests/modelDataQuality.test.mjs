import assert from "node:assert/strict";
import test from "node:test";
import { pregamePitchingQuery, validDecisiveScores } from "../lib/modelDataQuality.ts";
test("MLB pitching history ends before the requested day, including leap days", () => {
  assert.deepEqual(pregamePitchingQuery("2026-06-01"), { stats: "byDateRange", group: "pitching", season: 2026, startDate: "2026-01-01", endDate: "2026-05-31" });
  assert.equal(pregamePitchingQuery("2024-03-01").endDate,"2024-02-29");
  assert.throws(() => pregamePitchingQuery("2026-02-30"));
});
test("NFL corrupt finals cannot poison the rating state", () => {
  for (const scores of [[NaN,7],[Infinity,7],[-1,7],[null,7],[7,7]]) assert.equal(validDecisiveScores(...scores),false);
  assert.equal(validDecisiveScores(0,7),true);
});
