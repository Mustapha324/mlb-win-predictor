"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getErrorMessage, getPlayerPicks, type PlayerPicksResponse } from "@/lib/api";
import type { Sport } from "@/lib/sports";

export function PlayerPicksSection({ sport, date }: { sport: Sport; date: string }) {
  const [data, setData] = useState<PlayerPicksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    getPlayerPicks(date, sport)
      .then((result) => { if (!canceled) { setData(result); setError(null); } })
      .catch((requestError) => { if (!canceled) setError(getErrorMessage(requestError, "Unable to load player picks.")); });
    return () => { canceled = true; };
  }, [date, sport]);

  const accent = sport === "nfl" ? "text-lime-300" : "text-cyan-300";
  const loading = !data || data.date !== date || data.sport !== sport;
  return (
    <section className="mt-9 border-t border-white/[0.08] pt-8" aria-labelledby={`${sport}-player-picks-heading`}>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className={`text-[10px] font-black uppercase tracking-[0.2em] ${accent}`}>{sport.toUpperCase()} player model</p><h2 id={`${sport}-player-picks-heading`} className="mt-2 text-3xl font-black tracking-[-0.045em] text-white sm:text-4xl">Top 20 Player Picks</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">Ranked by model confidence using season production, recent form, team outlook, opponent context, and available head-to-head history.</p></div>
        {!data?.isPro ? <Link href="/pro" className="primary-button shrink-0">Unlock picks 6–20</Link> : <span className="rounded-full border border-lime-300/20 bg-lime-300/[0.07] px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-lime-200">All 20 unlocked</span>}
      </header>

      {loading ? <div className="mt-5 h-72 animate-pulse rounded-[24px] border border-white/[0.07] bg-white/[0.025]" /> : null}
      {error ? <div className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-5 text-sm text-amber-100">{error}</div> : null}
      {!loading && !error && data?.picks.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-white/[0.1] p-7 text-sm text-neutral-500">Player data will populate when the official game slate and season leader feeds are available.</div> : null}

      {data?.picks.length ? (
        <div className="mt-5 overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#090909]">
          <div className="hidden grid-cols-[42px_1.15fr_.9fr_.75fr_.65fr_1.3fr] gap-4 border-b border-white/[0.08] px-5 py-3 text-[9px] font-black uppercase tracking-[0.14em] text-neutral-600 lg:grid"><span>#</span><span>Player</span><span>Pick</span><span>Projection</span><span>Confidence</span><span>Why</span></div>
          <div className="divide-y divide-white/[0.055]">
            {data.picks.map((pick) => (
              <article key={pick.id} className="relative grid gap-3 px-5 py-4 lg:grid-cols-[42px_1.15fr_.9fr_.75fr_.65fr_1.3fr] lg:items-center lg:gap-4">
                <span className={`font-mono text-sm font-black ${pick.rank <= 5 ? accent : "text-neutral-700"}`}>{String(pick.rank).padStart(2, "0")}</span>
                <div className={pick.is_locked ? "select-none blur-[7px]" : ""}><p className="text-sm font-black text-white">{pick.playerName}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-600">{pick.position ? `${pick.position} · ` : ""}{pick.team} vs {pick.opponent}</p></div>
                <div className={pick.is_locked ? "select-none blur-[7px]" : ""}><p className="text-sm font-black text-white">{pick.selection} {pick.line}</p><p className="mt-1 text-[10px] text-neutral-500">{pick.market}</p></div>
                <p className={`font-mono text-sm font-bold text-neutral-300 ${pick.is_locked ? "select-none blur-[7px]" : ""}`}>{pick.projection === null ? "000.0" : pick.projection}</p>
                <p className={`font-mono text-sm font-black ${accent} ${pick.is_locked ? "select-none blur-[7px]" : ""}`}>{pick.confidence === null ? "00%" : `${Math.round(pick.confidence * 100)}%`}</p>
                <div className={pick.is_locked ? "select-none blur-[7px]" : ""}>{pick.explanation ? <p className="text-xs leading-5 text-neutral-400">{pick.explanation}</p> : <p className="text-xs text-neutral-600">{pick.supportingStats[0] ?? "Full supporting stats with Pro"}</p>}{pick.supportingStats.length > 1 ? <div className="mt-2 flex flex-wrap gap-1">{pick.supportingStats.slice(0, 3).map((stat) => <span key={stat} className="rounded-md bg-white/[0.04] px-2 py-1 text-[9px] text-neutral-500">{stat}</span>)}</div> : null}</div>
                {pick.is_locked ? <div className="absolute inset-0 flex items-center justify-end bg-gradient-to-r from-transparent via-black/10 to-black/80 px-5"><Link href="/pro" className="rounded-full border border-lime-300/25 bg-black px-3 py-2 text-[9px] font-black uppercase tracking-[0.12em] text-lime-200">Pro pick</Link></div> : null}
              </article>
            ))}
          </div>
          {!data.isPro && data.picks.length > 5 ? <div className="border-t border-lime-300/10 bg-lime-300/[0.035] px-5 py-5 text-center"><p className="text-sm font-black text-white">You&apos;re seeing the top 5 of 20.</p><p className="mt-1 text-xs text-neutral-500">Unlock the remaining ranked picks, confidence, supporting stats, and explanations.</p><Link href="/pro" className="mt-3 inline-flex text-[10px] font-black uppercase tracking-[0.13em] text-lime-300">Get Sport IQ Pro →</Link></div> : null}
        </div>
      ) : null}
    </section>
  );
}
