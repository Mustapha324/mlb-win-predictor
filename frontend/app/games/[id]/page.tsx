"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { TeamBadge } from "@/components/TeamBadge";
import { getErrorMessage, getGamePrediction, type TeamPrediction } from "@/lib/api";

export default function GameDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [game, setGame] = useState<TeamPrediction | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getGamePrediction(id).then(setGame).catch((requestError) => setError(getErrorMessage(requestError, "Unable to load this matchup.")));
  }, [id]);

  if (error) return <main><Link href="/" className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-300">← Back to slate</Link><div className="mt-6 rounded-[24px] border border-rose-300/20 bg-rose-300/[0.06] p-6 text-rose-100">{error}</div></main>;
  if (!game) return <main><div className="h-[480px] animate-pulse rounded-[28px] border border-white/[0.07] bg-white/[0.025]" /></main>;

  const homeIsPick = game.predicted_winner === game.home_team;
  const pickProbability = homeIsPick ? game.home_win_probability : game.away_win_probability;
  return (
    <main>
      <Link href="/" className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-300">← Back to slate</Link>
      <section className="relative mt-5 overflow-hidden rounded-[30px] border border-white/[0.08] bg-[#0c1120] p-6 sm:p-10">
        <div className="scoreboard-dots pointer-events-none absolute inset-y-0 right-0 w-1/3 opacity-20" />
        <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-5">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">{game.date} · {game.venue ?? "Ballpark TBD"}</p><p className="mt-1 text-sm font-bold text-white">{game.inning ?? game.status}</p></div>
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/8 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200">{game.prediction_source}</span>
        </div>

        <div className="relative mt-8 grid items-center gap-8 md:grid-cols-[1fr_auto_1fr]">
          {[game.awayTeam, game.homeTeam].map((team, index) => {
            const probability = index === 0 ? game.away_win_probability : game.home_win_probability;
            const pitcher = index === 0 ? game.awayProbablePitcher : game.homeProbablePitcher;
            return (
              <div key={team.id} className={`flex items-center gap-4 ${index === 1 ? "order-3 md:flex-row-reverse md:text-right" : "order-1"}`}>
                <TeamBadge team={team} size="lg" />
                <div><p className="text-xl font-black text-white">{team.name}</p><p className="mt-1 text-xs text-slate-500">{team.record} · {pitcher || "Starter TBD"}</p><p className="mt-3 font-mono text-3xl font-black text-white">{Math.round(probability * 100)}%</p></div>
              </div>
            );
          })}
          <div className="order-2 text-center text-xs font-black uppercase tracking-[0.2em] text-slate-700">AT</div>
        </div>

        <div className="relative mt-10 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
          <div className="rounded-[22px] border border-cyan-300/15 bg-cyan-300/[0.055] p-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Model call</p>
            <p className="mt-2 text-2xl font-black text-white">{game.predicted_winner}</p>
            <p className="mt-1 font-mono text-4xl font-black text-cyan-300">{Math.round(pickProbability * 100)}%</p>
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{game.confidence} confidence</p>
          </div>
          <div className="rounded-[22px] border border-white/[0.07] bg-black/20 p-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">Why the model leans this way</p>
            <ul className="mt-4 space-y-3">
              {game.factors.map((factor, index) => <li key={factor} className="flex gap-3 text-sm text-slate-300"><span className="font-mono text-cyan-300">0{index + 1}</span><span>{factor}</span></li>)}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
