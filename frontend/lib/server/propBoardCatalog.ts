/**
 * Keeps generated player props aligned with what DFS pick'em boards
 * (PrizePicks, Underdog) actually list at standard full-payout multipliers.
 *
 * Board reality this module encodes:
 * - Boards set every standard line adjacent to the player's expected median, so
 *   both sides are near coin flips. A pick the model grades far above ~72-74%
 *   is not a standard board proposition — it is the shape of a discounted
 *   goblin/"easier" square, so we refuse to surface it as a headline pick.
 * - Near-certain unders on 0.5 lines ("Under 0.5 Home runs") are never
 *   full-multiplier picks anywhere, so unders on 0.5 lines are banned outright.
 * - Rare-event markets (Home runs, Stolen bases, Rush+Rec TDs) appear on
 *   boards over-only and payout-boosted. They are kept over-only, gated to
 *   players with genuine rates, capped per slate, and ranked below the
 *   standard board instead of on top of it.
 */

export type BoardMarketKind = "standard" | "rare";

export type MlbMarketDef = {
  market: string;
  kind: BoardMarketKind;
  /** Minimum per-game projection for the prop to plausibly be listed. */
  minProjection: number;
  /** Inclusive clamp for the synthesized 0.5-step line. */
  lineRange: [number, number];
};

/** Bounds for how contested a synthetic-line pick must be to mirror a standard board square. */
export const MIN_BOARD_CONFIDENCE = 0.52;
export const MAX_SYNTHETIC_BOARD_CONFIDENCE = 0.74;
export const MAX_REAL_BOARD_CONFIDENCE = 0.78;
/** Rare over-only picks below this over-probability are noise, not boosts worth showing. */
export const MIN_RARE_OVER_PROBABILITY = 0.3;
/** At most this many rare boost-style picks (HR, SB, Rush+Rec TDs) per slate. */
export const RARE_EVENT_SLATE_CAP = 2;
/**
 * Any standard pick must pay at least this much. -160 is a 1.63x multiplier;
 * a heavier favourite (Under 1.5 hits at -250, say) is a low-payout square
 * that is not worth a slot however sure the model is, so it is dropped from
 * the board outright. Rare over-only markets are plus-money by nature.
 */
export const MAX_PICK_JUICE = -160;

/** Whether a price is worth selling; an unknown price is allowed (lines-only feeds). */
export function isSellablePrice(americanOdds: number | null): boolean {
  return americanOdds === null || americanOdds > 0 || americanOdds >= MAX_PICK_JUICE;
}

export const RARE_EVENT_MARKETS = new Set(["Home runs", "Stolen bases", "Rush+Rec TDs"]);

export const MLB_HITTER_MARKETS: MlbMarketDef[] = [
  { market: "Hits", kind: "standard", minProjection: 0.85, lineRange: [0.5, 2.5] },
  { market: "Total bases", kind: "standard", minProjection: 1.0, lineRange: [0.5, 2.5] },
  { market: "Hits+Runs+RBIs", kind: "standard", minProjection: 1.4, lineRange: [1.5, 4.5] },
  { market: "RBIs", kind: "standard", minProjection: 0.5, lineRange: [0.5, 1.5] },
  { market: "Runs", kind: "standard", minProjection: 0.5, lineRange: [0.5, 1.5] },
  { market: "Home runs", kind: "rare", minProjection: 0.2, lineRange: [0.5, 0.5] },
  { market: "Stolen bases", kind: "rare", minProjection: 0.25, lineRange: [0.5, 0.5] }
];

export const MLB_PITCHER_MARKETS: MlbMarketDef[] = [
  { market: "Strikeouts", kind: "standard", minProjection: 3.8, lineRange: [3.5, 9.5] },
  { market: "Pitching outs", kind: "standard", minProjection: 12, lineRange: [11.5, 21.5] },
  { market: "Earned runs allowed", kind: "standard", minProjection: 1.3, lineRange: [1.5, 3.5] },
  { market: "Hits allowed", kind: "standard", minProjection: 3.2, lineRange: [3.5, 7.5] },
  { market: "Walks allowed", kind: "standard", minProjection: 0.8, lineRange: [0.5, 2.5] }
];

export type NflMarketDef = {
  market: string;
  kind: BoardMarketKind;
  minAverage: number;
  lineRange: [number, number];
  /** Spread fed to confidenceFromEdge; roughly one game-to-game standard deviation. */
  scale: number;
};

export const NFL_MARKETS: NflMarketDef[] = [
  { market: "Passing yards", kind: "standard", minAverage: 150, lineRange: [149.5, 349.5], scale: 70 },
  { market: "Passing touchdowns", kind: "standard", minAverage: 0.9, lineRange: [1.5, 2.5], scale: 1.25 },
  { market: "Completions", kind: "standard", minAverage: 14, lineRange: [12.5, 32.5], scale: 5 },
  { market: "Pass attempts", kind: "standard", minAverage: 22, lineRange: [19.5, 44.5], scale: 7 },
  { market: "Rushing yards", kind: "standard", minAverage: 25, lineRange: [24.5, 149.5], scale: 32 },
  { market: "Rush attempts", kind: "standard", minAverage: 8, lineRange: [5.5, 24.5], scale: 4 },
  { market: "Receiving yards", kind: "standard", minAverage: 25, lineRange: [24.5, 129.5], scale: 32 },
  { market: "Receptions", kind: "standard", minAverage: 2.2, lineRange: [1.5, 8.5], scale: 2.5 },
  { market: "Rush+Rec yards", kind: "standard", minAverage: 40, lineRange: [39.5, 179.5], scale: 38 },
  { market: "Rush+Rec TDs", kind: "rare", minAverage: 0.45, lineRange: [0.5, 0.5], scale: 0.75 }
];

function clampToRange(value: number, [minimum, maximum]: [number, number]): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Board-style 0.5-step line adjacent to the projected median. */
export function boardCountLine(projection: number, range: [number, number]): number {
  return clampToRange(Math.max(0.5, Math.round(projection) - 0.5), range);
}

/** Line for an MLB market, or null when the projection is too thin to be board-listed. */
export function mlbBoardLine(definition: MlbMarketDef, projection: number): number | null {
  if (projection < definition.minProjection) return null;
  if (definition.kind === "rare") return 0.5;
  return boardCountLine(projection, definition.lineRange);
}

/** Line + scale for an NFL market, or null when the recent average is too thin to be board-listed. */
export function nflBoardLine(definition: NflMarketDef, average: number): { line: number; scale: number } | null {
  if (average < definition.minAverage) return null;
  if (definition.kind === "rare") return { line: 0.5, scale: definition.scale };
  if (definition.market === "Passing touchdowns") return { line: average >= 2.25 ? 2.5 : 1.5, scale: definition.scale };
  return { line: boardCountLine(average, definition.lineRange), scale: definition.scale };
}

/**
 * Whether a selection is one a DFS board would actually sell at full payout.
 * Unders on 0.5 lines are the "player does nothing" freebies boards only offer
 * as discounted squares, and rare-event markets are over-only boosts.
 */
export function isBoardSelectionAllowed(market: string, line: number, selection: "Over" | "Under"): boolean {
  if (selection === "Under" && line <= 0.5) return false;
  if (selection === "Under" && RARE_EVENT_MARKETS.has(market)) return false;
  return true;
}

/**
 * Whether a standard pick's win probability sits in the contested band a
 * full-multiplier board square occupies. Lines confirmed on a real board get a
 * wider band: a genuine model edge against a real line is the product's point.
 */
export function isBoardRealisticConfidence(confidence: number, onRealBoard: boolean): boolean {
  const maximum = onRealBoard ? MAX_REAL_BOARD_CONFIDENCE : MAX_SYNTHETIC_BOARD_CONFIDENCE;
  return confidence >= MIN_BOARD_CONFIDENCE && confidence <= maximum;
}

type DiversifiableCandidate = {
  id: string;
  playerId: string;
  market: string;
  confidence: number | null;
  modelEdge: number | null;
  expectedValue?: number | null;
};

/**
 * Orders the standard board by confidence with player/market diversity caps,
 * then appends up to RARE_EVENT_SLATE_CAP rare boost-style picks at the bottom
 * of the board so they can never crowd the headline slots.
 */
export function diversifyBoard<T extends DiversifiableCandidate>(
  candidates: T[],
  limits: { top: number; freePreview: number; maximum: number },
  options: { headline?: (pick: T) => boolean } = {}
): T[] {
  const headline = options.headline ?? (() => true);
  const standard = candidates.filter((pick) => !RARE_EVENT_MARKETS.has(pick.market));
  const rare = candidates
    .filter((pick) => RARE_EVENT_MARKETS.has(pick.market))
    .toSorted((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, RARE_EVENT_SLATE_CAP);
  const standardLimit = limits.maximum - rare.length;

  const ordered = standard.toSorted(
    (a, b) =>
      (b.confidence ?? 0) - (a.confidence ?? 0) ||
      (b.expectedValue ?? 0) - (a.expectedValue ?? 0) ||
      Math.abs(b.modelEdge ?? 0) - Math.abs(a.modelEdge ?? 0)
  );
  const selected: T[] = [];
  const selectedIds = new Set<string>();
  const playerCounts = new Map<string, number>();
  const marketCounts = new Map<string, number>();
  const add = (pick: T) => {
    selected.push(pick);
    selectedIds.add(pick.id);
    playerCounts.set(pick.playerId, (playerCounts.get(pick.playerId) ?? 0) + 1);
    marketCounts.set(pick.market, (marketCounts.get(pick.market) ?? 0) + 1);
  };
  for (const pick of ordered) {
    if (selected.length >= limits.top) break;
    if (!headline(pick)) continue;
    if ((playerCounts.get(pick.playerId) ?? 0) >= 1 || (marketCounts.get(pick.market) ?? 0) >= 2) continue;
    add(pick);
  }
  // Headline slots stay headline-only: relax the market cap before ever letting a non-headline pick in.
  for (const pick of ordered) {
    if (selected.length >= limits.top) break;
    if (selectedIds.has(pick.id) || !headline(pick) || (playerCounts.get(pick.playerId) ?? 0) >= 1) continue;
    add(pick);
  }
  for (const pick of ordered) {
    if (selected.length >= limits.top + limits.freePreview) break;
    if (selectedIds.has(pick.id) || (playerCounts.get(pick.playerId) ?? 0) >= 1 || (marketCounts.get(pick.market) ?? 0) >= 3) continue;
    add(pick);
  }
  for (const pick of ordered) {
    if (selected.length >= standardLimit) break;
    if (selectedIds.has(pick.id) || (playerCounts.get(pick.playerId) ?? 0) >= 2 || (marketCounts.get(pick.market) ?? 0) >= 10) continue;
    add(pick);
  }
  for (const pick of ordered) {
    if (selected.length >= standardLimit) break;
    if (!selectedIds.has(pick.id)) add(pick);
  }
  return [...selected.slice(0, standardLimit), ...rare].slice(0, limits.maximum);
}
