"use client";

import Link from "next/link";
import { useState } from "react";
import { TeamBadge } from "@/components/TeamBadge";
import { UserPickControls } from "@/components/social/UserPickControls";
import type { TeamPrediction } from "@/lib/api";

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function timeLabel(value: string | null): string {
  if (!value) return "Time TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time TBD";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isFinished(status: string): boolean {
  return /final|completed|game over/i.test(status);
}

function isInProgress(status: string): boolean {
  return /live|in progress|Q[1-4]|\bOT\b|halftime|top |bottom |middle |end |inning|manager challenge|review|delay/i.test(status);
}

export function GameCard({ game }: { game: TeamPrediction }) {
  const [showReason, setShowReason] = useState(false);
  const homeIsPick = game.pregame_predicted_winner === game.home_team;
  const pick = homeIsPick ? game.homeTeam : game.awayTeam;
  const pickProbability = homeIsPick ? game.pregame_home_win_probability : game.pregame_away_win_probability;
  const finished = game.is_final || isFinished(game.status);
  const showScore = finished || isInProgress(game.status);
  const gameStatusLabel = !finished && game.inning ? game.inning : game.status;
  const firstReason = game.factors[0] ?? `${pick.name} has the stronger overall profile`;
  const secondReason = game.factors[1] ?? "The remaining inputs are closely balanced";
  const marketPick = game.market_home_win_probability === null || game.market_home_win_probability === undefined
    ? null
    : homeIsPick ? game.market_home_win_probability : 1 - game.market_home_win_probability;
  const marketNote = marketPick === null ? "" : ` The pregame sportsbook line priced ${pick.name} at ${percent(marketPick)}, and the served number is anchored to that line because the market has out-predicted every model variant in backtests.`;
  const reasonSummary = `Before the game, the model gave ${pick.name} a ${percent(pickProbability)} win probability; ${firstReason}. ${secondReason}, with the call rated ${game.confidence.toLowerCase()} rather than a certainty.${marketNote}`;
  const inProgress = !finished && isInProgress(game.status);
  const pickLiveLabel = !inProgress || locked ? null : game.pick_leading === true ? "Pick leading" : game.pick_leading === false ? "Pick trailing" : game.home_score !== null && game.away_score !== null ? "Tied" : null;
  const pickLiveTone = game.pick_leading === true ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-200" : game.pick_leading === false ? "border-amber-300/25 bg-amber-300/10 text-amber-200" : "border-white/10 bg-white/5 text-neutral-300";
  const statusTone = /live|progress|delay/i.test(game.status)
    ? "border-amber-300/25 bg-amber-300/10 text-amber-200"
    : finished
      ? "border-white/10 bg-white/5 text-slate-400"
      : "border-cyan-300/20 bg-cyan-300/8 text-cyan-200";

  return (
    <article className={`game-card group relative overflow-hidden rounded-[24px] border bg-[#0a0a0a] p-5 shadow-[0_24px_70px_rgba(0,0,0,.35)] transition duration-300 hover:-translate-y-1 sm:p-6 ${game.sport === "nfl" ? "border-lime-300/[0.12] hover:border-lime-300/25" : "border-cyan-300/[0.12] hover:border-cyan-300/25"}`}>
      <div className={`pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full blur-3xl transition ${game.sport === "nfl" ? "bg-lime-300/[0.035] group-hover:bg-lime-300/[0.07]" : "bg-cyan-300/[0.035] group-hover:bg-cyan-300/[0.07]"}`} />
      <header className="relative flex items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
        <div>
          <p className="text-sm font-bold text-white">{timeLabel(game.game_time_utc)}</p>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-600">{game.venue ?? "Venue TBD"}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone}`}>{gameStatusLabel}</span>
          {pickLiveLabel ? <span className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] ${pickLiveTone}`}>{pickLiveLabel}</span> : null}
        </div>
      </header>

      <div className="relative mt-5 space-y-5">
        {[
          { team: game.awayTeam, pitcher: game.awayProbablePitcher, probability: game.pregame_away_win_probability, score: game.away_score, side: "Away" },
          { team: game.homeTeam, pitcher: game.homeProbablePitcher, probability: game.pregame_home_win_probability, score: game.home_score, side: "Home" }
        ].map((entry) => (
          <div key={entry.side} className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
            <TeamBadge team={entry.team} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-extrabold text-white">{entry.team.name}</p>
                <span className="text-[10px] font-semibold text-neutral-600">{entry.team.record}</span>
              </div>
              <p className="mt-1 truncate text-xs text-neutral-500">{game.sport === "mlb" ? entry.pitcher || "Starter TBD" : `${entry.side} team`}</p>
            </div>
            <div className="text-right">
              {showScore && entry.score !== null ? <p className="text-lg font-black text-white">{entry.score}</p> : null}
              <p className="font-mono text-sm font-bold text-neutral-200">{percent(entry.probability)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="relative mt-5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-1.5 rounded-full ${game.sport === "nfl" ? "bg-gradient-to-r from-lime-500 to-amber-300" : "bg-gradient-to-r from-cyan-400 to-emerald-300"}`} style={{ width: `${game.pregame_away_win_probability * 100}%` }} />
      </div>

      <div className="relative mt-5 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
        <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-neutral-600">Pregame pick · locked</p>
            <p className="mt-1 text-base font-black text-white">{pick.name}</p>
          </div>
          <div className="text-right">
            <p className={`font-mono text-xl font-black ${game.sport === "nfl" ? "text-lime-300" : "text-cyan-300"}`}>{percent(pickProbability)}</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500">{game.confidence}{game.prediction_tier ? ` · Tier ${game.prediction_tier}` : ""}</p>
          </div>
        </div>
        <p className="mt-3 line-clamp-1 text-xs text-neutral-500">{game.factors[0] ?? "Balanced matchup"}</p>
        </div>
      </div>

      {finished && game.actual_winner ? (
        <div className="relative mt-4 flex items-center justify-between gap-4 rounded-2xl border border-white/[0.09] bg-white/[0.04] p-4">
          <div><p className="text-[9px] font-black uppercase tracking-[0.16em] text-neutral-600">Final winner</p><p className="mt-1 text-sm font-black text-white">{game.actual_winner}</p>{game.home_score !== null && game.away_score !== null ? <p className="mt-0.5 font-mono text-[11px] text-neutral-400">{game.awayTeam.abbreviation} {game.away_score} · {game.homeTeam.abbreviation} {game.home_score}</p> : null}</div>
          {<span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.11em] ${game.actual_winner === game.pregame_predicted_winner ? "bg-emerald-300/10 text-emerald-200" : "bg-rose-300/10 text-rose-200"}`}>{game.actual_winner === game.pregame_predicted_winner ? "Pick hit" : "Pick missed"}</span>}
        </div>
      ) : null}

      {!finished ? game.live_market || game.live_home_win_probability !== null ? (
        <div className="relative mt-4 rounded-2xl border border-lime-300/15 bg-lime-300/[0.045] p-4">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-[9px] font-black uppercase tracking-[0.16em] text-lime-300">{game.live_market ? "Live market" : "Live win chance"}</p><p className="mt-1 text-sm font-black text-white">{game.live_market?.favorite ?? game.live_favorite}</p></div>
            <div className="text-right"><p className="font-mono text-lg font-black text-lime-200">{percent(game.live_market ? Math.max(game.live_market.homeWinProbability, game.live_market.awayWinProbability) : Math.max(game.live_home_win_probability ?? 0.5, game.live_away_win_probability ?? 0.5))}</p><p className="text-[9px] text-neutral-600">{game.live_market ? `${game.live_market.books} books` : game.live_probability_source}</p></div>
          </div>
        </div>
      ) : (
        <div className="relative mt-4 flex items-center justify-between rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
          <div><p className="text-[9px] font-black uppercase tracking-[0.16em] text-neutral-600">Live movement</p><p className="mt-1 text-xs font-bold text-neutral-400">Waiting for live game data</p></div>
        </div>
      ) : null}

      {showReason ? (
        <p className="relative mt-4 rounded-xl border border-white/10 bg-white/[0.035] p-3 text-xs leading-5 text-neutral-300">{reasonSummary}</p>
      ) : null}
      <div className="relative mt-4 flex flex-wrap items-center gap-4">
        {<button type="button" onClick={() => setShowReason((value) => !value)} className={`text-xs font-bold uppercase tracking-[0.12em] transition ${game.sport === "nfl" ? "text-lime-300 hover:text-lime-100" : "text-cyan-300 hover:text-cyan-100"}`} aria-expanded={showReason}>
          {showReason ? "Hide reason" : "Why this pick?"}
        </button>}
        <Link href={game.sport === "nfl" ? `/nfl/games/${game.gameId}` : `/games/${game.gameId}`} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500 transition hover:text-white">
          Full breakdown <span aria-hidden="true">→</span>
        </Link>
      </div>
      <UserPickControls game={game} />
    </article>
  );
}
