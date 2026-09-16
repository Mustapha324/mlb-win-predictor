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

export type LivePaceState = "pending" | "cleared" | "on_pace" | "behind" | "busted" | "final";
export type LivePace = {
  current: number | null;
  line: number;
  /** Share of the game completed, 0–1. */
  progress: number;
  /** Full-game projection from the current pace, once enough of the game has been played. */
  projected: number | null;
  state: LivePaceState;
  label: string;
};

/** Share of the game completed from the slate's status label ("Bottom 7th", "Q3 05:14", "Halftime"). */
export function gameProgress(sport: "mlb" | "nfl", status: PlayerPickStatus, statusLabel: string): number {
  if (status === "final") return 1;
  if (status !== "live") return 0;
  const clamp = (value: number) => Math.max(0.02, Math.min(0.98, value));
  if (sport === "mlb") {
    const inning = Number(statusLabel.match(/(\d+)(?:st|nd|rd|th)?/)?.[1] ?? 1);
    const half = /bottom|end/i.test(statusLabel) ? 0.75 : /middle/i.test(statusLabel) ? 0.5 : 0.25;
    return clamp((Math.max(1, inning) - 1 + half) / 9);
  }
  if (/halftime/i.test(statusLabel)) return 0.5;
  if (/\bOT\b/i.test(statusLabel)) return 0.97;
  const quarter = Number(statusLabel.match(/Q(\d)/i)?.[1] ?? 1);
  const clock = statusLabel.match(/(\d{1,2}):(\d{2})/);
  const secondsLeft = clock ? Number(clock[1]) * 60 + Number(clock[2]) : 900;
  return clamp(((Math.max(1, quarter) - 1) * 900 + (900 - Math.min(900, secondsLeft))) / 3600);
}

/** How a pick is doing right now: cleared/busted are settled, on-pace/behind extrapolate the current rate. */
export function livePace(
  selection: "Over" | "Under",
  line: number,
  current: number | null,
  progress: number,
  status: PlayerPickStatus,
  result: PlayerPickResult
): LivePace {
  if (status === "final" || (result !== "pending" && status !== "live")) {
    const label = result === "correct" ? "Hit" : result === "incorrect" ? "Missed" : result === "push" ? "Push" : result === "void" ? "Void" : "Final";
    return { current, line, progress: 1, projected: current, state: "final", label };
  }
  if (status !== "live" || current === null) {
    return { current, line, progress, projected: null, state: "pending", label: status === "live" ? "Waiting for stats" : "Not started" };
  }
  const projected = progress >= 0.1 ? Number((current / progress).toFixed(1)) : null;
  const needed = Number((Math.floor(line) + 1 - current).toFixed(1));
  if (selection === "Over") {
    if (current > line) return { current, line, progress, projected, state: "cleared", label: "Over cleared" };
    if (projected !== null && projected >= line) return { current, line, progress, projected, state: "on_pace", label: `On pace · ${projected} projected` };
    return { current, line, progress, projected, state: "behind", label: `Needs ${needed} more` };
  }
  if (current > line) return { current, line, progress, projected, state: "busted", label: "Under busted" };
  if (projected === null || projected < line) return { current, line, progress, projected, state: "on_pace", label: projected === null ? "Under holding" : `Under holding · ${projected} projected` };
  return { current, line, progress, projected, state: "behind", label: `Pace threatens the under · ${projected} projected` };
}

export type LiveSummary = {
  total: number;
  scheduled: number;
  live: number;
  final: number;
  cleared: number;
  onPace: number;
  behind: number;
  busted: number;
  correct: number;
  incorrect: number;
};

/** Counts for the live strip: how many picks are settled, on pace, or in trouble. */
export function summarizeLive<T extends { status: PlayerPickStatus; result: PlayerPickResult; live?: LivePace | null }>(picks: T[]): LiveSummary {
  const summary: LiveSummary = { total: picks.length, scheduled: 0, live: 0, final: 0, cleared: 0, onPace: 0, behind: 0, busted: 0, correct: 0, incorrect: 0 };
  for (const pick of picks) {
    if (pick.status === "live") summary.live += 1;
    else if (pick.status === "final" || pick.status === "postponed") summary.final += 1;
    else summary.scheduled += 1;
    if (pick.result === "correct") summary.correct += 1;
    if (pick.result === "incorrect") summary.incorrect += 1;
    const state = pick.live?.state;
    if (pick.status !== "live" || !state) continue;
    if (state === "cleared") summary.cleared += 1;
    else if (state === "on_pace") summary.onPace += 1;
    else if (state === "behind") summary.behind += 1;
    else if (state === "busted") summary.busted += 1;
  }
  return summary;
}

export function confidenceFromEdge(edge: number, sampleSize: number, scale: number): number {
  const normalized = Math.max(-3, Math.min(3, edge / Math.max(0.1, scale)));
  const rawOverProbability = 1 / (1 + Math.exp(-normalized * 1.75));
  const reliability = Math.min(1, 0.35 + Math.sqrt(Math.max(1, sampleSize)) / 3.5);
  const calibrated = 0.5 + (rawOverProbability - 0.5) * reliability;
  return Number(Math.max(0.51, Math.min(0.84, Math.max(calibrated, 1 - calibrated))).toFixed(4));
}

export function mergePlayerPickResults<T extends { id: string; result: PlayerPickResult; resultUpdatedAt: string | null }>(
  stored: T[],
  current: T[]
): T[] {
  const merged = new Map<string, T>();
  for (const pick of stored) {
    if (pick.result !== "pending") merged.set(pick.id, pick);
  }
  for (const pick of current) {
    if (pick.result !== "pending") merged.set(pick.id, pick);
  }
  return [...merged.values()].toSorted((left, right) =>
    (right.resultUpdatedAt ?? "").localeCompare(left.resultUpdatedAt ?? "")
  );
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
