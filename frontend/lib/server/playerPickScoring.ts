export type PlayerPickResult = "pending" | "correct" | "incorrect" | "push" | "void";
export type PlayerPickStatus = "scheduled" | "live" | "final" | "postponed";

export function isValidPickDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  const year = parsed.getUTCFullYear();
  return year >= 2020 && year <= new Date().getUTCFullYear() + 1;
}

export function pickStatus(status: string, isFinal: boolean): PlayerPickStatus {
  if (/postponed|cancelled|canceled|suspended/i.test(status)) return "postponed";
  if (isFinal || /final|completed|game over/i.test(status)) return "final";
  if (/live|in progress|warmup|delay|halftime|quarter|\bQ[1-4]\b|\bOT\b|top |bottom |inning/i.test(status)) return "live";
  return "scheduled";
}

export function gradePlayerPick(
  selection: "Over" | "Under",
  line: number,
  actualValue: number | null,
  status: PlayerPickStatus,
  didPlay = true
): PlayerPickResult {
  if (status === "postponed") return "void";
  if (status !== "final") return "pending";
  if (!didPlay || actualValue === null || !Number.isFinite(actualValue)) return "void";
  if (actualValue === line) return "push";
  const overHit = actualValue > line;
  return (selection === "Over" && overHit) || (selection === "Under" && !overHit) ? "correct" : "incorrect";
}

export function confidenceFromEdge(edge: number, sampleSize: number, scale: number): number {
  const normalized = Math.max(-3, Math.min(3, edge / Math.max(0.1, scale)));
  const rawOverProbability = 1 / (1 + Math.exp(-normalized * 1.75));
  const reliability = Math.min(1, 0.35 + Math.sqrt(Math.max(1, sampleSize)) / 3.5);
  const calibrated = 0.5 + (rawOverProbability - 0.5) * reliability;
  return Number(Math.max(0.51, Math.min(0.84, Math.max(calibrated, 1 - calibrated))).toFixed(4));
}

export function calculatePerformance<T extends { result: PlayerPickResult; rank: number; market: string }>(picks: T[]) {
  const gradedPicks = picks.filter((pick) => pick.result === "correct" || pick.result === "incorrect");
  const correct = gradedPicks.filter((pick) => pick.result === "correct").length;
  const topFive = gradedPicks.filter((pick) => pick.rank <= 5);
  const topFiveCorrect = topFive.filter((pick) => pick.result === "correct").length;
  const markets = new Map<string, { graded: number; correct: number }>();
  for (const pick of gradedPicks) {
    const value = markets.get(pick.market) ?? { graded: 0, correct: 0 };
    value.graded += 1;
    value.correct += Number(pick.result === "correct");
    markets.set(pick.market, value);
  }
  return {
    graded: gradedPicks.length,
    correct,
    incorrect: gradedPicks.length - correct,
    pushes: picks.filter((pick) => pick.result === "push").length,
    voids: picks.filter((pick) => pick.result === "void").length,
    accuracy: gradedPicks.length ? correct / gradedPicks.length : null,
    topFiveGraded: topFive.length,
    topFiveCorrect,
    topFiveAccuracy: topFive.length ? topFiveCorrect / topFive.length : null,
    byMarket: [...markets.entries()]
      .map(([market, value]) => ({ ...value, market, accuracy: value.correct / value.graded }))
      .sort((a, b) => b.graded - a.graded || b.accuracy - a.accuracy)
      .slice(0, 8)
  };
}
