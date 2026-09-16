import type { PlayerPick } from "@/lib/api";

export const TOP_PLAYER_PICK_COUNT = 5;
// Preserve board diversification groups independently of account status.
export const SECONDARY_PLAYER_PICK_COUNT = 5;
export const MAX_PLAYER_PICK_COUNT = 40;

export function publicPlayerPicks(picks: PlayerPick[]): PlayerPick[] {
  return picks.map((pick) => ({ ...pick, is_locked: false }));
}

export function publicPlayerResults(picks: PlayerPick[], limit = 20): PlayerPick[] {
  return publicPlayerPicks(picks.slice(0, limit));
}
