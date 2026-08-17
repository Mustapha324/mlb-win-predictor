import type { PlayerPick } from "@/lib/api";

export const TOP_PLAYER_PICK_COUNT = 5;
export const FREE_PLAYER_PICK_COUNT = 5;
export const MAX_PLAYER_PICK_COUNT = 40;

export function applyPlayerPickAccess(picks: PlayerPick[], isPro: boolean): PlayerPick[] {
  if (isPro) return picks.map((pick) => ({ ...pick, is_locked: false }));
  return picks
    .filter((pick) => pick.rank > TOP_PLAYER_PICK_COUNT)
    .slice(0, FREE_PLAYER_PICK_COUNT)
    .map((pick) => ({ ...pick, is_locked: false }));
}

export function applyResultAccess(picks: PlayerPick[], isPro: boolean, limit = 20): PlayerPick[] {
  const visible = isPro ? picks : picks.filter((pick) => pick.rank > TOP_PLAYER_PICK_COUNT && pick.rank <= TOP_PLAYER_PICK_COUNT + FREE_PLAYER_PICK_COUNT);
  return visible.slice(0, limit).map((pick) => ({ ...pick, is_locked: false }));
}
