"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameCard } from "@/components/GameCard";
import { PlayerPicksSection } from "@/components/PlayerPicksSection";
import { getErrorMessage, getTodayPredictions, type TodayPredictionsResponse } from "@/lib/api";
import { SPORTS, type Sport } from "@/lib/sports";

type GameFilter = "all" | "strong" | "active";

function easternToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function shiftDate(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateHeading(value: string, sport: Sport, slateLabel?: string): string {
  if (sport === "nfl" && slateLabel) return slateLabel;
  const date = new Date(`${value}T12:00:00Z`);
  const label = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  return value === easternToday() ? `Today · ${label}` : label;
}

function isActive(status: string): boolean {
  return /live|progress|warmup|delay|quarter|halftime|Q[1-4]|\bOT\b|top |bottom |inning/i.test(status);
}

export function Dashboard({ sport }: { sport: Sport }) {
  const config = SPORTS[sport];
  const [date, setDate] = useState(easternToday);
  const [data, setData] = useState<TodayPredictionsResponse | null>(null);
  const [filter, setFilter] = useState<GameFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (silent = false) => {
    const currentRequest = ++requestId.current;
    try {
      if (silent) setRefreshing(true); else setLoading(true);
      setError(null);
      const result = await getTodayPredictions(date, sport);
      if (currentRequest === requestId.current) setData(result);
    } catch (requestError) {
      if (currentRequest === requestId.current) setError(getErrorMessage(requestError, `Unable to load the ${config.shortName} slate.`));
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [config.shortName, date, sport]);

  useEffect(() => {
    const request = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(request);
  }, [load]);

  const hasActiveGame = data?.predictions.some((game) => !game.is_final && (game.live_home_win_probability !== null || isActive(game.status))) ?? false;
  const isPro = data?.access?.isPro ?? false;
  useEffect(() => {
    if (!isPro || !hasActiveGame) return;
    const interval = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(interval);
  }, [hasActiveGame, isPro, load]);

  const visibleGames = useMemo(() => {
    const games = data?.predictions ?? [];
    if (filter === "strong") return games.filter((game) => !game.is_locked && game.confidence === "Strong");
    if (filter === "active") return games.filter((game) => !game.is_final && (game.live_home_win_probability !== null || isActive(game.status)));
    return games;
  }, [data, filter]);

  const availableGames = data?.predictions.filter((game) => !game.is_locked) ?? [];
  const averageConfidence = availableGames.length
    ? availableGames.reduce((sum, game) => sum + Math.max(game.pregame_home_win_probability, game.pregame_away_win_probability), 0) / availableGames.length
    : 0;
  const strongEdges = availableGames.filter((game) => game.confidence === "Strong").length;
  const accent = sport === "nfl" ? "text-lime-300" : "text-cyan-300";

  return (
    <main>
      <section className={`relative overflow-hidden rounded-[32px] border bg-[#080808] px-5 py-9 sm:px-8 sm:py-11 lg:px-10 ${sport === "nfl" ? "border-lime-300/[0.12]" : "border-cyan-300/[0.12]"}`}>
        <div className={`pointer-events-none absolute -right-24 -top-28 h-96 w-96 rounded-full blur-[110px] ${sport === "nfl" ? "bg-lime-300/[0.08]" : "bg-cyan-300/[0.08]"}`} />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-3xl">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${sport === "nfl" ? "border-lime-300/20 bg-lime-300/[0.07] text-lime-200" : "border-cyan-300/20 bg-cyan-300/[0.07] text-cyan-200"}`}>● {config.shortName} intelligence</span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-500">Pregame picks stay locked</span>
            </div>
            <p className={`text-xs font-black uppercase tracking-[0.24em] ${accent}`}>{sport === "nfl" ? "Weekly matchup intelligence" : "Daily matchup intelligence"}</p>
            <h1 className="mt-3 max-w-3xl text-4xl font-black leading-[0.94] tracking-[-0.06em] text-white sm:text-6xl lg:text-7xl">Know the call. Watch it move.</h1>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-neutral-400 sm:text-base">Sport IQ preserves the model&apos;s original pregame pick, then layers live probability, market movement, and the verified winner beside it.</p>
          </div>
          <div className="min-w-[290px] rounded-2xl border border-white/[0.09] bg-white/[0.025] p-4">
            <div className="flex items-center justify-between"><p className="eyebrow">Your access</p><span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.13em] ${isPro ? "bg-lime-300 text-black" : "bg-white/[0.07] text-neutral-400"}`}>{isPro ? "Pro" : "Free preview"}</span></div>
            <p className="mt-4 text-sm font-bold text-white">{isPro ? "Full player + team boards" : "5 player samples + team preview"}</p>
            <p className="mt-2 text-xs leading-5 text-neutral-600">{isPro ? "Every player pick, team pick, and live result refreshes without changing the pregame call." : "Your player samples come from below today’s premium top five."}</p>
            {!isPro ? <Link href="/pro" className="mt-4 inline-flex text-[10px] font-black uppercase tracking-[0.13em] text-lime-300">Unlock Pro for $3.99 →</Link> : null}
          </div>
        </div>
      </section>

      <section className="mt-7 flex flex-col gap-4 border-b border-white/[0.08] pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div><p className="eyebrow">{sport === "nfl" ? "Game week" : "Game slate"}</p><h2 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">{dateHeading(date, sport, data?.slate_label)}</h2>{data ? <p className="mt-1 text-xs text-neutral-500">Pregame data through {data.data_through}</p> : null}</div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-xl border border-white/[0.09] bg-white/[0.025] p-1">
            <button type="button" onClick={() => setDate((value) => shiftDate(value, sport === "nfl" ? -7 : -1))} className="rounded-lg px-3 py-2 text-neutral-400 hover:bg-white/[0.07] hover:text-white" aria-label={sport === "nfl" ? "Previous week" : "Previous date"}>←</button>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="min-h-10 rounded-lg border-0 bg-transparent px-2 text-xs font-bold text-white [color-scheme:dark] focus:outline-none" aria-label="Prediction date" />
            <button type="button" onClick={() => setDate((value) => shiftDate(value, sport === "nfl" ? 7 : 1))} className="rounded-lg px-3 py-2 text-neutral-400 hover:bg-white/[0.07] hover:text-white" aria-label={sport === "nfl" ? "Next week" : "Next date"}>→</button>
          </div>
          {(["all", "strong", "active"] as GameFilter[]).map((option) => <button key={option} type="button" onClick={() => setFilter(option)} className={`rounded-xl border px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.12em] transition ${filter === option ? sport === "nfl" ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-cyan-300/25 bg-cyan-300/10 text-cyan-200" : "border-white/[0.08] bg-white/[0.02] text-neutral-500 hover:text-white"}`}>{option}</button>)}
          {isPro ? <button type="button" onClick={() => void load(true)} disabled={refreshing} className="rounded-xl border border-lime-300/20 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] text-lime-300 disabled:opacity-50">{refreshing ? "Updating…" : "Refresh live"}</button> : null}
        </div>
      </section>

      {data && !loading ? <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Games", String(data.predictions.length)],["Avg. revealed pick", averageConfidence ? `${Math.round(averageConfidence * 100)}%` : "—"],["Strong revealed", String(strongEdges)],["Live access", isPro ? "On" : "Pro"]].map(([label,value]) => <div key={label} className="rounded-2xl border border-white/[0.07] bg-white/[0.022] px-4 py-3"><p className="eyebrow">{label}</p><p className="mt-1 font-mono text-xl font-black text-white">{value}</p></div>)}</section> : null}

      <PlayerPicksSection sport={sport} date={date} />

      <section id="team-picks" className="mt-10 scroll-mt-28 border-t border-white/[0.08] pt-8" aria-labelledby={`${sport}-team-picks-heading`}>
        <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${accent}`}>{sport.toUpperCase()} game model</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 id={`${sport}-team-picks-heading`} className="text-3xl font-black tracking-[-0.045em] text-white sm:text-4xl">Team Picks</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">Pregame winner probabilities, live movement, market context, and verified final outcomes for the full game slate.</p></div><span className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-600">Original picks stay locked</span></div>
      </section>

      {loading ? <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading team picks">{[0,1,2,3,4,5].map((item) => <div key={item} className="h-[520px] animate-pulse rounded-[24px] border border-white/[0.07] bg-white/[0.025]" />)}</section> : null}
      {error && !loading ? <section className="mt-6 rounded-[22px] border border-rose-300/20 bg-rose-300/[0.06] p-6"><p className="font-bold text-rose-100">{error}</p><button type="button" onClick={() => void load()} className="mt-4 rounded-xl bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-black">Try again</button></section> : null}
      {!loading && !error && visibleGames.length > 0 ? <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleGames.map((game) => <GameCard key={game.gameId} game={game} />)}</section> : null}
      {!loading && !error && visibleGames.length === 0 ? <section className="mt-6 rounded-[24px] border border-dashed border-white/[0.12] bg-white/[0.02] p-10 text-center"><p className="text-lg font-black text-white">No games match this view.</p><p className="mt-2 text-sm text-neutral-500">Try another filter or move to the next game date.</p></section> : null}
    </main>
  );
}
