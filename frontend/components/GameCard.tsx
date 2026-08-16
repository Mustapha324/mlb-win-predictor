"use client";

import Link from "next/link";
import { useState } from "react";
import { TeamBadge } from "@/components/TeamBadge";
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
  return /live|in progress|top |bottom |middle |end |inning|manager challenge|review|delay/i.test(status);
}

export function GameCard({ game }: { game: TeamPrediction }) {
  const [showReason, setShowReason] = useState(false);
  const homeIsPick = game.predicted_winner === game.home_team;
  const pick = homeIsPick ? game.homeTeam : game.awayTeam;
  const pickProbability = homeIsPick ? game.home_win_probability : game.away_win_probability;
  const finished = isFinished(game.status);
  const showScore = finished || isInProgress(game.status);
  const gameStatusLabel = !finished && game.inning ? game.inning : game.status;
  const firstReason = game.factors[0] ?? `${pick.name} has the stronger overall profile`;
  const secondReason = game.factors[1] ?? "The remaining inputs are closely balanced";
  const reasonSummary = `The model gives ${pick.name} a ${percent(pickProbability)} win probability; ${firstReason}. ${secondReason}, with the overall call rated as ${game.confidence.toLowerCase()} rather than a certainty.`;
  const statusTone = /live|progress|delay/i.test(game.status)
    ? "border-amber-300/25 bg-amber-300/10 text-amber-200"
    : finished
      ? "border-white/10 bg-white/5 text-slate-400"
      : "border-cyan-300/20 bg-cyan-300/8 text-cyan-200";

  return (
    <article className="game-card group relative overflow-hidden rounded-[24px] border border-white/[0.09] bg-[#0c1120]/92 p-5 shadow-[0_24px_70px_rgba(0,0,0,.28)] transition duration-300 hover:-translate-y-1 hover:border-cyan-300/20 sm:p-6">
      <div className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-cyan-300/[0.035] blur-3xl transition group-hover:bg-cyan-300/[0.07]" />
      <header className="relative flex items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
        <div>
          <p className="text-sm font-bold text-white">{timeLabel(game.game_time_utc)}</p>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">{game.venue ?? "Ballpark TBD"}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone}`}>{gameStatusLabel}</span>
      </header>

      <div className="relative mt-5 space-y-5">
        {[
          { team: game.awayTeam, pitcher: game.awayProbablePitcher, probability: game.away_win_probability, score: game.away_score, side: "Away" },
          { team: game.homeTeam, pitcher: game.homeProbablePitcher, probability: game.home_win_probability, score: game.home_score, side: "Home" }
        ].map((entry) => (
          <div key={entry.side} className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
            <TeamBadge team={entry.team} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-extrabold text-white">{entry.team.name}</p>
                <span className="text-[10px] font-semibold text-slate-600">{entry.team.record}</span>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">{entry.pitcher || "Starter TBD"}</p>
            </div>
            <div className="text-right">
              {showScore && entry.score !== null ? <p className="text-lg font-black text-white">{entry.score}</p> : null}
              <p className="font-mono text-sm font-bold text-slate-200">{percent(entry.probability)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="relative mt-5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-1.5 rounded-full bg-gradient-to-r from-cyan-400 to-emerald-300" style={{ width: `${game.away_win_probability * 100}%` }} />
      </div>

      <div className="relative mt-5 rounded-2xl border border-white/[0.07] bg-black/20 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-slate-600">Model pick</p>
            <p className="mt-1 text-base font-black text-white">{pick.name}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-xl font-black text-cyan-300">{percent(pickProbability)}</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{game.confidence}</p>
          </div>
        </div>
        <p className="mt-3 line-clamp-1 text-xs text-slate-500">{game.factors[0] ?? "Balanced matchup"}</p>
      </div>

      {showReason ? (
        <p className="relative mt-4 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.04] p-3 text-xs leading-5 text-slate-300">{reasonSummary}</p>
      ) : null}
      <div className="relative mt-4 flex flex-wrap items-center gap-4">
        <button type="button" onClick={() => setShowReason((value) => !value)} className="text-xs font-bold uppercase tracking-[0.12em] text-cyan-300 transition hover:text-cyan-100" aria-expanded={showReason}>
          {showReason ? "Hide reason" : "Why this pick?"}
        </button>
        <Link href={`/games/${game.gameId}`} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 transition hover:text-white">
          Full breakdown <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  );
}
