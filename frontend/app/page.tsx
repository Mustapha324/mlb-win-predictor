"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GameCard } from "@/components/GameCard";
import { getErrorMessage, getTodayPredictions, type TodayPredictionsResponse } from "@/lib/api";

type GameFilter = "all" | "strong" | "active";

function easternToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function shiftDate(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateHeading(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  const label = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  return value === easternToday() ? `Today · ${label}` : label;
}

function isActive(status: string): boolean {
  return /live|progress|warmup|delay/i.test(status);
}

export default function Home() {
  const [date, setDate] = useState(easternToday);
  const [data, setData] = useState<TodayPredictionsResponse | null>(null);
  const [filter, setFilter] = useState<GameFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setData(await getTodayPredictions(date));
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Unable to load this slate."));
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const request = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(request);
  }, [load]);

  const visibleGames = useMemo(() => {
    const games = data?.predictions ?? [];
    if (filter === "strong") return games.filter((game) => game.confidence === "Strong");
    if (filter === "active") return games.filter((game) => isActive(game.status));
    return games;
  }, [data, filter]);

  const averageConfidence = data?.predictions.length
    ? data.predictions.reduce((sum, game) => sum + Math.max(game.home_win_probability, game.away_win_probability), 0) / data.predictions.length
    : 0;
  const strongEdges = data?.predictions.filter((game) => game.confidence === "Strong").length ?? 0;

  return (
    <main>
      <section className="relative overflow-hidden rounded-[30px] border border-white/[0.08] bg-[#0a0f1d]/88 px-5 py-8 sm:px-8 sm:py-10 lg:px-10">
        <div className="scoreboard-dots pointer-events-none absolute inset-y-0 right-0 hidden w-[38%] opacity-25 lg:block" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-3xl">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-emerald-300/20 bg-emerald-300/8 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200">● Live MLB data</span>
              <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">12,171 training games</span>
            </div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-300">Daily matchup intelligence</p>
            <h1 className="mt-3 max-w-2xl text-4xl font-black uppercase leading-[0.94] tracking-[-0.055em] text-white sm:text-6xl lg:text-7xl">The edge, before first pitch.</h1>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">Five completed seasons establish the baseline. Current form, run differential, venue splits, and probable starters sharpen each game-day probability.</p>
          </div>
          <div className="grid min-w-[280px] grid-cols-2 gap-2 rounded-2xl border border-white/[0.08] bg-black/20 p-3">
            <div className="rounded-xl bg-white/[0.035] p-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-600">Holdout accuracy</p>
              <p className="mt-1 font-mono text-2xl font-black text-cyan-300">56.4%</p>
            </div>
            <div className="rounded-xl bg-white/[0.035] p-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-600">Model</p>
              <p className="mt-1 font-mono text-lg font-black text-white">ELO v4</p>
            </div>
            <p className="col-span-2 px-1 pt-1 text-[10px] leading-4 text-slate-600">Tested on the untouched 2025 season. No odds or market lines are used.</p>
          </div>
        </div>
      </section>

      <section className="mt-7 flex flex-col gap-4 border-b border-white/[0.08] pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">Game slate</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">{dateHeading(date)}</h2>
          {data ? <p className="mt-1 text-xs text-slate-500">Current-season results through {data.data_through}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-xl border border-white/[0.09] bg-white/[0.025] p-1">
            <button type="button" onClick={() => setDate((value) => shiftDate(value, -1))} className="rounded-lg px-3 py-2 text-slate-400 hover:bg-white/[0.07] hover:text-white" aria-label="Previous date">←</button>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="min-h-10 rounded-lg border-0 bg-transparent px-2 text-xs font-bold text-white [color-scheme:dark] focus:outline-none" aria-label="Prediction date" />
            <button type="button" onClick={() => setDate((value) => shiftDate(value, 1))} className="rounded-lg px-3 py-2 text-slate-400 hover:bg-white/[0.07] hover:text-white" aria-label="Next date">→</button>
          </div>
          {(["all", "strong", "active"] as GameFilter[]).map((option) => (
            <button key={option} type="button" onClick={() => setFilter(option)} className={`rounded-xl border px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.12em] transition ${filter === option ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-200" : "border-white/[0.08] bg-white/[0.02] text-slate-500 hover:text-white"}`}>{option}</button>
          ))}
        </div>
      </section>

      {data && !loading ? (
        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Games", String(data.predictions.length)],
            ["Avg. pick", averageConfidence ? `${Math.round(averageConfidence * 100)}%` : "—"],
            ["Strong edges", String(strongEdges)],
            ["Data seasons", "2021–26"]
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-600">{label}</p>
              <p className="mt-1 font-mono text-xl font-black text-white">{value}</p>
            </div>
          ))}
        </section>
      ) : null}

      {loading ? (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="h-[410px] animate-pulse rounded-[24px] border border-white/[0.07] bg-white/[0.025]" />)}
        </section>
      ) : null}

      {error && !loading ? (
        <section className="mt-6 rounded-[22px] border border-rose-300/20 bg-rose-300/[0.06] p-6">
          <p className="font-bold text-rose-100">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-4 rounded-xl bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-950">Try again</button>
        </section>
      ) : null}

      {!loading && !error && visibleGames.length > 0 ? (
        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleGames.map((game) => <GameCard key={game.gameId} game={game} />)}
        </section>
      ) : null}

      {!loading && !error && visibleGames.length === 0 ? (
        <section className="mt-6 rounded-[24px] border border-dashed border-white/[0.12] bg-white/[0.02] p-10 text-center">
          <p className="text-lg font-black text-white">No games match this view.</p>
          <p className="mt-2 text-sm text-slate-500">Try another filter or move to the next game date.</p>
        </section>
      ) : null}
    </main>
  );
}
