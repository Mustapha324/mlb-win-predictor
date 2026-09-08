/**
 * Pure eligibility rules for player picks — who is allowed to be a pick at
 * all, before any projection or line is considered. No fetches and no
 * server-only import so the rules are unit-testable.
 *
 * NFL: a pick must be a current, active, healthy starter-tier player for the
 * market. Backups are refused outright (a backup quarterback's passing line
 * is not a real proposition), and "Questionable" players stay eligible with a
 * confidence haircut and a visible flag.
 *
 * MLB: hitters must be on the active roster and either in the posted lineup
 * or a genuine everyday player; pitchers must be the probable starter.
 */

export type NflEligibilityInput = {
  market: string;
  position: string | null;
  /** ESPN roster status name: Active, Practice Squad, Injured Reserve, PUP, Suspended… null = not on the roster. */
  rosterStatus: string | null;
  /** Latest ESPN injury designation (Out, Doubtful, Questionable, Probable…) or null when healthy. */
  injuryStatus: string | null;
  /** Depth-chart rank at the player's slot (1 = starter); null when the chart lacks the player. */
  depthRank: number | null;
  /** False when the team has no depth chart at all (offseason gaps); rank rules are skipped with a haircut. */
  depthChartAvailable: boolean;
};

export type EligibilityVerdict = {
  eligible: boolean;
  reason: string | null;
  confidenceMultiplier: number;
  note: string | null;
};

const PASSING_MARKETS = new Set(["Passing yards", "Passing touchdowns", "Completions", "Pass attempts"]);
const RUSHING_MARKETS = new Set(["Rushing yards", "Rush attempts"]);
const RECEIVING_MARKETS = new Set(["Receiving yards", "Receptions"]);

function positionGroup(position: string | null): "QB" | "RB" | "WR" | "TE" | "OTHER" {
  const value = (position ?? "").toUpperCase();
  if (value === "QB") return "QB";
  if (value === "RB" || value === "FB" || value === "HB") return "RB";
  if (value === "WR") return "WR";
  if (value === "TE") return "TE";
  if (value === "WR/TE") return "WR";
  return "OTHER";
}

/** Maximum depth-chart rank that still counts as a real role for the market. */
function allowedDepth(market: string, group: ReturnType<typeof positionGroup>): number {
  if (PASSING_MARKETS.has(market)) return group === "QB" ? 1 : 0;
  if (RUSHING_MARKETS.has(market)) return group === "RB" ? 2 : group === "QB" ? 1 : 0;
  if (RECEIVING_MARKETS.has(market)) return group === "WR" ? 3 : group === "TE" ? 1 : group === "RB" ? 2 : 0;
  if (market === "Rush+Rec yards") return group === "RB" ? 2 : group === "WR" ? 3 : group === "TE" ? 1 : 0;
  if (market === "Rush+Rec TDs") return group === "RB" ? 2 : group === "WR" ? 3 : group === "TE" ? 2 : group === "QB" ? 1 : 0;
  return 0;
}

export function evaluateNflEligibility(input: NflEligibilityInput): EligibilityVerdict {
  if (input.rosterStatus === null) return { eligible: false, reason: "not on the current roster", confidenceMultiplier: 0, note: null };
  if (!/^active$/i.test(input.rosterStatus)) return { eligible: false, reason: `roster status ${input.rosterStatus}`, confidenceMultiplier: 0, note: null };
  const injury = (input.injuryStatus ?? "").toLowerCase();
  if (/^(out|doubtful|injured reserve|ir|suspended|pup)/.test(injury)) return { eligible: false, reason: `listed ${input.injuryStatus}`, confidenceMultiplier: 0, note: null };
  const group = positionGroup(input.position);
  const maximum = allowedDepth(input.market, group);
  if (maximum === 0) return { eligible: false, reason: `${input.position ?? "position"} is not a ${input.market.toLowerCase()} role`, confidenceMultiplier: 0, note: null };
  let multiplier = 1;
  let note: string | null = null;
  if (input.depthChartAvailable) {
    if (input.depthRank === null) return { eligible: false, reason: "not on the depth chart", confidenceMultiplier: 0, note: null };
    if (input.depthRank > maximum) return { eligible: false, reason: `depth-chart rank ${input.depthRank} at ${input.position ?? "the position"} (backup)`, confidenceMultiplier: 0, note: null };
    if (input.depthRank > 1 && group !== "WR") {
      multiplier *= 0.95;
      note = `${input.position ?? "Depth"} ${input.depthRank} on the depth chart`;
    }
  } else {
    multiplier *= 0.9;
    note = "Depth chart unavailable; role inferred from recent box scores";
  }
  if (/questionable/.test(injury)) {
    multiplier *= 0.92;
    note = note ? `${note} · listed questionable` : "Listed questionable on the injury report";
  }
  return { eligible: true, reason: null, confidenceMultiplier: Number(multiplier.toFixed(3)), note };
}

export type MlbHitterEligibilityInput = {
  onActiveRoster: boolean;
  /** Posted lineup ids for the player's game, or null when no lineup is posted yet. */
  lineupIds: Set<string> | null;
  playerId: string;
  gamesPlayed: number;
  teamGames: number;
  plateAppearances: number;
};

export function evaluateMlbHitterEligibility(input: MlbHitterEligibilityInput): EligibilityVerdict {
  if (!input.onActiveRoster) return { eligible: false, reason: "not on the active roster", confidenceMultiplier: 0, note: null };
  if (input.lineupIds) {
    if (!input.lineupIds.has(input.playerId)) return { eligible: false, reason: "not in the posted lineup", confidenceMultiplier: 0, note: null };
    return { eligible: true, reason: null, confidenceMultiplier: 1, note: "Confirmed in the posted lineup" };
  }
  const share = input.teamGames > 0 ? input.gamesPlayed / input.teamGames : 0;
  const paPerGame = input.gamesPlayed > 0 ? input.plateAppearances / input.gamesPlayed : 0;
  if (input.gamesPlayed < 20) return { eligible: false, reason: "fewer than 20 games this season", confidenceMultiplier: 0, note: null };
  if (paPerGame < 2.5) return { eligible: false, reason: "part-time plate appearances", confidenceMultiplier: 0, note: null };
  if (share < 0.7) return { eligible: false, reason: "not an everyday player (under 70% of team games)", confidenceMultiplier: 0, note: null };
  return { eligible: true, reason: null, confidenceMultiplier: share >= 0.85 ? 1 : 0.95, note: share >= 0.85 ? null : "Lineup not posted yet; near-everyday player" };
}
