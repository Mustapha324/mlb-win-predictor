import type { Sport } from "./sports";

export const SOCIAL_AVATARS = ["⚾", "🏈", "🏆", "📊", "🦊", "🐻", "🦅", "🐯"] as const;
export const LEADERBOARD_MIN_PICKS = 20;
export type PickResult = "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID";
export type PickRecord = { wins: number; losses: number; pending: number; pushes: number; voids: number; graded: number; winPercentage: number | null };
export type SocialStats = PickRecord & {
  total: number; currentStreak: string; bestStreak: number; last10: PickRecord;
  mlb: PickRecord; nfl: PickRecord; modelWinPercentage: number | null;
  agreementPercentage: number | null; agreeWinPercentage: number | null; disagreeWinPercentage: number | null;
  tails: Array<{ username: string; wins: number; losses: number; winPercentage: number | null }>;
};
export type SocialProfile = {
  username: string; displayName: string; avatar: string; favoriteMlb: string | null; favoriteNfl: string | null;
  joinedAt: string; friendCount: number; isOwn: boolean;
  relationship: "none" | "self" | "friends" | "incoming" | "outgoing";
  stats: SocialStats;
};
export type SocialPick = {
  id: string; username: string; displayName: string; avatar: string; sport: Sport; gameId: string;
  homeTeam: string; awayTeam: string; selection: string; modelSelection: string; modelProbability: number;
  modelVersion: string; startsAt: string; createdAt: string; updatedAt: string; locked: boolean;
  result: PickResult; correct: boolean | null; tailedFrom: string | null; sourcePickId: string | null; tailedAt: string | null; isOwn: boolean;
};
export type SocialMe = { authenticated: boolean; profile: SocialProfile | null };
export type SocialFriends = { friends: SocialProfile[]; incoming: SocialProfile[]; outgoing: SocialProfile[] };
export type SocialLeaderboard = { minimumPicks: number; sport: "overall" | Sport; scope: "friends" | "community"; entries: Array<{ rank: number; username: string; displayName: string; avatar: string; wins: number; losses: number; winPercentage: number; picks: number }> };
export type SocialGame = { picks: SocialPick[]; ownPick: SocialPick | null; friends: { total: number; home: number; away: number }; community: { total: number; home: number; away: number } };
export type SocialFeed = Array<{ id: string; type: "pick"; createdAt: string; pick: SocialPick }>;
export type SocialResponse<T> = { available: true; data: T } | { available: false; error: string };

/** Null means no graded sample. Pushes and voids never inflate accuracy. */
export function winPercentage(wins: number, losses: number): number | null {
  return wins + losses > 0 ? Math.round(wins / (wins + losses) * 1000) / 10 : null;
}

export function isPickOpen(startsAt: string | null, status: string, now = Date.now()): boolean {
  const deadline = startsAt ? Date.parse(startsAt) : NaN;
  return Number.isFinite(deadline) && deadline > now && /^(scheduled|pre-game|pregame|preview|warmup|\d)/i.test(status) && !/final|progress|live|postpon|cancel|suspend|delay|end|quarter|half|top|bottom/i.test(status);
}

export function classifyGameResult(game: { is_final: boolean; status: string; home_team: string; away_team: string; actual_winner: string | null; home_score: number | null; away_score: number | null }): { status: "scheduled" | "closed" | "final" | "void"; winner: string | null } {
  if (/cancel|postpon/i.test(game.status)) return { status: "void", winner: null };
  if (!game.is_final) return { status: "closed", winner: null };
  if (game.home_score !== null && game.away_score !== null && game.home_score === game.away_score) return { status: "final", winner: null };
  if (game.actual_winner === game.home_team || game.actual_winner === game.away_team) return { status: "final", winner: game.actual_winner };
  return { status: "closed", winner: null };
}
