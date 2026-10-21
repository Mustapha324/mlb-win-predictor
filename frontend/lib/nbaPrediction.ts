/** Pure NBA pregame rating math. Ratings are updated only after completed games. */
export type NbaResult = { id: string; date: string; homeId: string; awayId: string; homeScore: number; awayScore: number };

const BASE = 1500;
// Selected on 2024-25, frozen for 2025-26. See the experiment ledger.
const HOME_EDGE = 40;
const K = 10;

export function winProbability(homeRating: number, awayRating: number): number {
  return 1 / (1 + 10 ** ((awayRating - homeRating - HOME_EDGE) / 400));
}

/** Winning margins carry information; discount expected blowouts by strong teams. */
export function ratingChange(home: number, away: number, homeScore: number, awayScore: number, config = { k: K, mov: true }): number {
  const outcome = Number(homeScore > awayScore);
  const winnerGap = (home - away + HOME_EDGE) * (outcome ? 1 : -1);
  const multiplier = config.mov ? Math.log1p(Math.abs(homeScore - awayScore)) * 2.2 / Math.max(1, 2.2 + 0.001 * winnerGap) : 1;
  return config.k * multiplier * (outcome - winProbability(home, away));
}

export function ratingsBefore(results: NbaResult[], cutoff: string): Map<string, number> {
  const ratings = new Map<string, number>();
  const deadline = Date.parse(cutoff);
  const ordered = results.filter((game) => Date.parse(game.date) < deadline).toSorted((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  for (const game of ordered) {
    if (seen.has(game.id) || !Number.isFinite(Date.parse(game.date)) || !game.homeId || !game.awayId || game.homeId === game.awayId || !Number.isFinite(game.homeScore) || !Number.isFinite(game.awayScore) || game.homeScore < 0 || game.awayScore < 0 || game.homeScore === game.awayScore) continue;
    seen.add(game.id);
    const home = ratings.get(game.homeId) ?? BASE;
    const away = ratings.get(game.awayId) ?? BASE;
    const delta = ratingChange(home, away, game.homeScore, game.awayScore);
    ratings.set(game.homeId, home + delta);
    ratings.set(game.awayId, away - delta);
  }
  return ratings;
}

export function modelProbability(ratings: Map<string, number>, homeId: string, awayId: string): number | null {
  if (homeId === awayId || !Number.isFinite(ratings.get(homeId)) || !Number.isFinite(ratings.get(awayId))) return null;
  return Math.max(0.1, Math.min(0.9, winProbability(ratings.get(homeId)!, ratings.get(awayId)!)));
}
