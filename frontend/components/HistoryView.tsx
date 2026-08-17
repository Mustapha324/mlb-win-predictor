"use client";

import { useEffect, useMemo, useState } from "react";
import { TeamBadge } from "@/components/TeamBadge";
import { getErrorMessage, getPredictionHistory, type PredictionHistoryItem } from "@/lib/api";
import type { Sport } from "@/lib/sports";

type FilterStatus = "all" | "correct" | "incorrect";

export function HistoryView({ sport }: { sport: Sport }) {
  const [history, setHistory] = useState<PredictionHistoryItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPredictionHistory(100, sport)
      .then(setHistory)
      .catch((requestError) => setError(getErrorMessage(requestError, "Unable to replay recent results.")))
      .finally(() => setLoading(false));
  }, [sport]);

  const filtered = useMemo(() => history.filter((item) => statusFilter === "all" || (statusFilter === "correct" ? item.wasCorrect : !item.wasCorrect)), [history, statusFilter]);
  const accuracy = history.length ? history.filter((item) => item.wasCorrect).length / history.length : 0;
  const accent = sport === "nfl" ? "text-lime-300" : "text-cyan-300";

  return (
    <main>
      <header className="flex flex-col gap-6 border-b border-white/[0.08] pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div><p className={`text-xs font-black uppercase tracking-[0.22em] ${accent}`}>{sport.toUpperCase()} accountability ledger</p><h1 className="mt-2 text-4xl font-black tracking-[-0.055em] text-white sm:text-6xl">The call versus reality.</h1><p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-500">Every probability is reconstructed from information available before kickoff or first pitch. Live movement and final scores never rewrite the original pick.</p></div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-5 py-4"><p className="eyebrow">Last {history.length || "—"}</p><p className="mt-1 font-mono text-2xl font-black text-white">{history.length ? `${(accuracy * 100).toFixed(1)}%` : "—"}</p></div>
      </header>

      <section className="my-6 flex flex-wrap gap-2">{(["all", "correct", "incorrect"] as FilterStatus[]).map((option) => <button key={option} type="button" onClick={() => setStatusFilter(option)} className={`rounded-xl border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.13em] ${statusFilter === option ? sport === "nfl" ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-cyan-300/25 bg-cyan-300/10 text-cyan-200" : "border-white/[0.08] bg-white/[0.025] text-neutral-500"}`}>{option}</button>)}</section>
      {loading ? <div className="sport-panel p-8 text-sm text-neutral-500">Replaying the season chronologically…</div> : null}
      {error ? <div className="rounded-[24px] border border-rose-300/20 bg-rose-300/[0.06] p-6 text-rose-100">{error}</div> : null}
      {!loading && !error ? (
        <section className="overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#0a0a0a]">
          <div className="hidden grid-cols-[100px_1fr_1fr_1fr_100px_90px] gap-4 border-b border-white/[0.08] px-5 py-3 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-600 md:grid"><span>Date</span><span>Matchup</span><span>Pregame pick</span><span>Final winner</span><span>Confidence</span><span>Result</span></div>
          <div className="divide-y divide-white/[0.06]">
            {filtered.map((item) => {
              const pickProbability = item.predictedWinner === item.homeTeam.name ? item.homeWinProbability : item.awayWinProbability;
              const pickTeam = item.predictedWinner === item.homeTeam.name ? item.homeTeam : item.awayTeam;
              return (
                <article key={item.gameId} className="grid gap-4 px-5 py-4 transition hover:bg-white/[0.025] md:grid-cols-[100px_1fr_1fr_1fr_100px_90px] md:items-center">
                  <p className="text-xs text-neutral-500">{new Date(`${item.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</p>
                  <div className="flex items-center gap-2"><TeamBadge team={item.awayTeam} size="sm" /><span className="text-xs font-bold text-neutral-300">{item.awayTeam.abbreviation} @ {item.homeTeam.abbreviation}</span><TeamBadge team={item.homeTeam} size="sm" /></div>
                  <p className="text-xs font-bold text-white">{pickTeam.name}</p><p className="text-xs text-neutral-400">{item.actualWinner}<span className="mt-1 block text-[10px] text-neutral-600">{item.awayTeam.abbreviation} {item.awayScore} · {item.homeTeam.abbreviation} {item.homeScore}</span></p>
                  <p className="font-mono text-sm font-black text-white">{Math.round(pickProbability * 100)}%</p><span className={`w-fit rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] ${item.wasCorrect ? "bg-emerald-300/10 text-emerald-200" : "bg-rose-300/10 text-rose-200"}`}>{item.wasCorrect ? "Correct" : "Miss"}</span>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </main>
  );
}
