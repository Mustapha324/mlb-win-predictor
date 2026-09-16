"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getErrorMessage, getPlayerPicks, type LivePaceInfo, type PlayerPick, type PlayerPicksResponse } from "@/lib/api";
import type { Sport } from "@/lib/sports";
import { useUiPreferences } from "@/lib/uiPreferences";

type View = "board" | "results" | "model";
type StatusFilter = "all" | PlayerPick["status"];

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function resultTone(result: PlayerPick["result"]): string {
  if (result === "correct") return "border-emerald-300/20 bg-emerald-300/10 text-emerald-200";
  if (result === "incorrect") return "border-rose-300/20 bg-rose-300/10 text-rose-200";
  if (result === "push" || result === "void") return "border-white/10 bg-white/[0.05] text-neutral-400";
  return "border-amber-300/20 bg-amber-300/10 text-amber-200";
}

function statusLabel(pick: PlayerPick): string {
  if (pick.result === "correct") return "Pick hit";
  if (pick.result === "incorrect") return "Pick missed";
  if (pick.result === "push") return "Push";
  if (pick.result === "void") return "Void";
  if (pick.status === "live") return `Live · ${pick.statusLabel}`;
  return pick.status === "final" ? "Final" : pick.statusLabel;
}

function paceText(state: LivePaceInfo["state"] | undefined): string {
  if (state === "cleared") return "text-emerald-200";
  if (state === "on_pace") return "text-lime-200";
  if (state === "behind") return "text-amber-200";
  if (state === "busted") return "text-rose-200";
  return "text-neutral-400";
}

function paceBar(state: LivePaceInfo["state"] | undefined): string {
  if (state === "cleared") return "bg-emerald-300";
  if (state === "on_pace") return "bg-lime-300";
  if (state === "behind") return "bg-amber-300";
  if (state === "busted") return "bg-rose-400";
  return "bg-neutral-500";
}

function payoutLabel(americanOdds: number | null): string | null {
  if (americanOdds === null) return null;
  const multiplier = americanOdds > 0 ? 1 + americanOdds / 100 : 1 + 100 / Math.abs(americanOdds);
  return `${multiplier.toFixed(2)}x`;
}

/** Live progress toward the line while the game runs; the final stat once it is over. */
function PaceMeter({ pick, compact = false }: { pick: PlayerPick; compact?: boolean }) {
  const live = pick.live;
  if (!live || (pick.status !== "live" && pick.status !== "final")) return null;
  const current = live.current ?? pick.actualValue;
  if (current === null) return <p className="mt-2 text-[10px] text-neutral-500">{live.label}</p>;
  const target = pick.selection === "Over" ? pick.line + 0.5 : pick.line;
  const fill = Math.max(0.04, Math.min(1, current / Math.max(0.5, target)));
  return (
    <div className={compact ? "mt-2" : "mt-3"} aria-label={`${live.label}: ${current} of ${pick.line}`}>
      <div className="flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-[0.1em]">
        <span className={`truncate ${paceText(live.state)}`}>{live.label}</span>
        <span className="shrink-0 font-mono text-white">{current} / {pick.line}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className={`h-full rounded-full ${paceBar(live.state)}`} style={{ width: `${fill * 100}%` }} /></div>
      {pick.status === "live" && !compact ? <p className="mt-1 text-[9px] text-neutral-500">{Math.round(live.progress * 100)}% of the game played{live.projected !== null ? ` · projects ${live.projected}` : ""}</p> : null}
    </div>
  );
}

function LiveStrip({ data }: { data: PlayerPicksResponse }) {
  const summary = data.liveSummary;
  if (!summary || (summary.live === 0 && summary.final === 0)) return null;
  const record = data.slatePerformance;
  const tiles: Array<[string, string, string]> = [
    ["Live now", String(summary.live), "text-white"],
    ["Cleared", String(summary.cleared), "text-emerald-200"],
    ["On pace", String(summary.onPace), "text-lime-200"],
    ["In trouble", String(summary.behind + summary.busted), "text-amber-200"],
    ["Today’s record", record ? `${record.correct}-${record.incorrect}` : "—", "text-white"]
  ];
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label="Live pick tracker">
      {tiles.map(([label, value, tone]) => <div key={label} className="rounded-2xl border border-white/[0.07] bg-white/[0.022] px-4 py-3"><p className="eyebrow">{label}</p><p className={`mt-1 font-mono text-xl font-black ${tone}`}>{value}</p></div>)}
    </div>
  );
}

function topFiveLiveLabel(data: PlayerPicksResponse): string | null {
  const top = data.topFiveLive;
  if (!top || (top.live === 0 && top.final === 0)) return null;
  const parts: string[] = [];
  if (top.live > 0) parts.push(`${top.live} live`, `${top.cleared} cleared`, `${top.onPace} on pace`, `${top.behind + top.busted} in trouble`);
  if (top.correct + top.incorrect > 0) parts.push(`${top.correct}-${top.incorrect} final`);
  return `Top 5 right now: ${parts.join(" · ")}`;
}

function PlayerImage({ pick, priority = false }: { pick: PlayerPick; priority?: boolean }) {
  return (
    <div className="relative h-24 w-20 shrink-0 self-end overflow-hidden rounded-t-[18px] bg-gradient-to-b from-white/[0.08] to-transparent sm:h-28 sm:w-24">
      {pick.headshotUrl ? <Image src={pick.headshotUrl} alt="" fill priority={priority} sizes="96px" className="object-contain object-bottom" /> : <span className="grid h-full place-items-center text-xl font-black text-neutral-700">{pick.playerName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>}
    </div>
  );
}

function ConfidenceRing({ value, sport }: { value: number | null; sport: Sport }) {
  const degrees = Math.round((value ?? 0) * 360);
  const color = sport === "nfl" ? "#bef264" : "#67e8f9";
  return (
    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full p-[3px]" style={{ background: `conic-gradient(${color} ${degrees}deg, rgba(255,255,255,.08) 0)` } as CSSProperties} aria-label={`${percent(value)} confidence`}>
      <span className="grid h-full w-full place-items-center rounded-full bg-[#0b0b0b] font-mono text-xs font-black text-white">{percent(value)}</span>
    </div>
  );
}

function PickPrice({ pick }: { pick: PlayerPick }) {
  if (pick.lineSource !== "sportsbook_consensus") {
    return <span className="mt-1 inline-flex rounded-md border border-white/[0.08] px-2 py-1 text-[8px] font-bold uppercase tracking-[0.08em] text-neutral-500">Model line</span>;
  }
  if (pick.americanOdds === null) {
    return <span className="mt-1 inline-flex rounded-md border border-emerald-300/20 bg-emerald-300/[0.07] px-2 py-1 text-[8px] font-black uppercase tracking-[0.08em] text-emerald-200">{pick.sportsbook ?? "Sportsbook"} line</span>;
  }
  const price = `${pick.americanOdds > 0 ? "+" : ""}${pick.americanOdds}`;
  const payout = payoutLabel(pick.americanOdds);
  return <span className="mt-1 inline-flex rounded-md border border-emerald-300/20 bg-emerald-300/[0.07] px-2 py-1 text-[8px] font-black uppercase tracking-[0.08em] text-emerald-200" aria-label={`${price} pays ${payout}${pick.sportsbook ? ` at ${pick.sportsbook}` : ""}`}>{price} · {payout}{pick.sportsbook ? ` · ${pick.sportsbook}` : ""}</span>;
}

function TopPickCard({ pick, sport, priority }: { pick: PlayerPick; sport: Sport; priority: boolean }) {
  const accent = sport === "nfl" ? "text-lime-300" : "text-cyan-300";
  return (
    <article className={`relative flex min-h-52 overflow-hidden rounded-[22px] border bg-[#0a0a0a] px-4 pt-4 ${pick.rank === 1 ? sport === "nfl" ? "border-lime-300/40" : "border-cyan-300/40" : "border-white/[0.1]"}`}>
      <span className={`absolute left-3 top-3 z-10 grid h-7 min-w-7 place-items-center rounded-lg border px-1 font-mono text-xs font-black ${pick.rank === 1 ? sport === "nfl" ? "border-lime-300/30 bg-lime-300/15 text-lime-200" : "border-cyan-300/30 bg-cyan-300/15 text-cyan-200" : "border-white/10 bg-white/[0.06] text-neutral-400"}`}>{pick.rank}</span>
      <div className="flex w-full items-end gap-3">
        <PlayerImage pick={pick} priority={priority} />
        <div className="min-w-0 flex-1 self-stretch pb-4 pt-1">
          <p className="truncate text-sm font-black text-white">{pick.playerName}</p>
          <p className="mt-1 truncate text-[9px] font-bold uppercase tracking-[0.11em] text-neutral-600">{pick.team} vs {pick.opponent}</p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <div><p className={`text-base font-black ${accent}`}>{pick.selection} {pick.line}</p><p className="text-[10px] text-neutral-400">{pick.market}</p><PickPrice pick={pick} /></div>
            <ConfidenceRing value={pick.confidence} sport={sport} />
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-white/[0.07] pt-3">
            <div><p className="eyebrow">Projection</p><p className="mt-1 font-mono text-xs font-bold text-neutral-300">{pick.projection ?? "—"}</p></div>
            <span className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-[0.1em] ${resultTone(pick.result)}`}>{statusLabel(pick)}</span>
          </div>
          <PaceMeter pick={pick} />
        </div>
      </div>
    </article>
  );
}

export function PlayerPicksSection({ sport, date }: { sport: Sport; date: string }) {
  const preferences = useUiPreferences();
  const [data, setData] = useState<PlayerPicksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("board");
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async (silent = false) => {
    const currentRequest = ++requestId.current;
    if (silent) setRefreshing(true);
    try {
      const result = await getPlayerPicks(date, sport);
      if (currentRequest === requestId.current) {
        setData(result);
        setError(null);
      }
    } catch (requestError) {
      if (currentRequest === requestId.current) setError(getErrorMessage(requestError, "Unable to load player picks."));
    } finally {
      if (currentRequest === requestId.current) setRefreshing(false);
    }
  }, [date, sport]);

  useEffect(() => {
    const request = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(request);
  }, [load]);

  useEffect(() => {
    if (!preferences.liveRefresh || !data?.hasLiveGames) return;
    const interval = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(interval);
  }, [data?.hasLiveGames, load, preferences.liveRefresh]);

  const loading = !error && (!data || data.date !== date || data.sport !== sport);
  const topPicks = data?.picks.filter((pick) => pick.isTopFive).slice(0, 5) ?? [];
  const boardPicks = useMemo(() => {
    const picks = data?.picks.filter((pick) => !pick.isTopFive) ?? [];
    const normalized = query.trim().toLowerCase();
    return picks.filter((pick) =>
      (!normalized || `${pick.playerName} ${pick.team} ${pick.opponent}`.toLowerCase().includes(normalized)) &&
      (market === "all" || pick.market === market) &&
      (status === "all" || pick.status === status)
    );
  }, [data, market, query, status]);
  const markets = [...new Set(data?.picks.map((pick) => pick.market) ?? [])].sort();
  const accent = sport === "nfl" ? "text-lime-300" : "text-cyan-300";
  const accentButton = sport === "nfl" ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-cyan-300/25 bg-cyan-300/10 text-cyan-200";

  return (
    <section id="player-picks" className="mt-9 scroll-mt-28 border-t border-white/[0.08] pt-8" aria-labelledby={`${sport}-player-picks-heading`}>
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2"><p className={`text-[10px] font-black uppercase tracking-[0.2em] ${accent}`}>{sport.toUpperCase()} player model</p>{data?.lineProvider ? <span className="rounded-md border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-200">{data.lineProvider} lines</span> : null}{data?.hasLiveGames ? <span className="rounded-full border border-rose-300/20 bg-rose-300/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-rose-200">● Live</span> : null}</div>
          <h2 id={`${sport}-player-picks-heading`} className="mt-2 text-3xl font-black tracking-[-0.045em] text-white sm:text-5xl">Player Picks</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">Pregame player calls on real sportsbook lines with their payout multipliers, live pace toward the line while games run, and a permanent final result. Picks lock daily; live games refresh every 30 seconds when enabled.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-white/[0.09] bg-white/[0.025] p-1" aria-label="Choose sport">
            <Link href="/#player-picks" aria-current={sport === "mlb" ? "page" : undefined} className={`grid min-h-11 place-items-center rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] ${sport === "mlb" ? "bg-cyan-300 text-black" : "text-neutral-400 hover:text-white"}`}>MLB</Link>
            <Link href="/nfl#player-picks" aria-current={sport === "nfl" ? "page" : undefined} className={`grid min-h-11 place-items-center rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] ${sport === "nfl" ? "bg-lime-300 text-black" : "text-neutral-400 hover:text-white"}`}>NFL</Link>
          </div>
        </div>
      </header>

      <div className="mt-6 flex items-center gap-1 overflow-x-auto border-b border-white/[0.08]" role="tablist" aria-label="Player pick views">
        {(["board", "results", "model"] as View[]).map((item) => <button key={item} type="button" role="tab" aria-selected={view === item} onClick={() => setView(item)} className={`min-h-12 shrink-0 border-b-2 px-4 py-3 text-[10px] font-black uppercase tracking-[0.14em] transition ${view === item ? `${accent} border-current` : "border-transparent text-neutral-400 hover:text-white"}`}>{item === "board" ? "Today’s picks" : item}</button>)}
        <button type="button" onClick={() => void load(true)} disabled={refreshing} className="ml-auto min-h-12 shrink-0 px-3 py-3 text-[9px] font-black uppercase tracking-[0.12em] text-neutral-400 hover:text-white disabled:opacity-50">{refreshing ? "Updating…" : "Refresh"}</button>
      </div>

      <p className="sr-only" aria-live="polite">{refreshing ? "Refreshing player picks" : error ? error : data ? `${data.totalPicks} player picks loaded` : "Loading player picks"}</p>

      {loading ? <div className="mt-6 h-[430px] animate-pulse rounded-[24px] border border-white/[0.07] bg-white/[0.025]" /> : null}
      {error && !loading ? <div className="mt-6 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-5 text-sm text-amber-100">{error}<button type="button" onClick={() => void load()} className="ml-3 font-black underline">Try again</button></div> : null}

      {!loading && !error && data && view === "board" ? (
        <>
          <LiveStrip data={data} />
          <div className="mt-6 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Top-ranked board</p><h3 className="mt-1 text-lg font-black text-white">★ Today&apos;s Top 5</h3></div><p className={`text-xs ${topFiveLiveLabel(data) ? "font-bold text-lime-200" : "text-neutral-600"}`}>{topFiveLiveLabel(data) ?? "Ranked before game time · never rewritten"}</p></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {topPicks.map((pick, index) => <TopPickCard key={pick.id} pick={pick} sport={sport} priority={index === 0} />)}
          </div>


          <div className="mt-7 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div><p className="eyebrow">Full board</p><h3 className="mt-1 text-lg font-black text-white">{`${Math.max(0, data.totalPicks - data.topFiveCount)} more player picks`}</h3></div>
            <div className="grid gap-2 sm:grid-cols-3">
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 rounded-xl border border-white/[0.09] bg-white/[0.025] px-3 text-xs text-white outline-none placeholder:text-neutral-500 focus:border-white/20" placeholder="Search player or team" aria-label="Search player picks" />
              <select value={market} onChange={(event) => setMarket(event.target.value)} className="min-h-11 rounded-xl border border-white/[0.09] bg-[#090909] px-3 text-xs text-neutral-300" aria-label="Filter by market"><option value="all">All markets</option>{markets.map((item) => <option key={item} value={item}>{item}</option>)}</select>
              <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className="min-h-11 rounded-xl border border-white/[0.09] bg-[#090909] px-3 text-xs text-neutral-300" aria-label="Filter by status"><option value="all">All statuses</option><option value="scheduled">Scheduled</option><option value="live">Live</option><option value="final">Final</option><option value="postponed">Postponed</option></select>
            </div>
          </div>

          {data.totalPicks === 0 ? <div className="mt-4 rounded-[24px] border border-dashed border-white/[0.1] p-9 text-center"><p className="text-base font-black text-white">No new pregame player board for this slate.</p><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-neutral-600">Picks are created only before games begin so final stats can never leak into the model. Move to the next game date or check Results for previously tracked picks.</p></div> : null}
          {data.totalPicks > 0 ? <div className="mt-4 overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#090909]">
            <div className="hidden grid-cols-[48px_1.1fr_.8fr_.62fr_.62fr_.72fr_1.1fr] gap-4 border-b border-white/[0.08] px-5 py-3 text-[9px] font-black uppercase tracking-[0.14em] text-neutral-600 lg:grid"><span>#</span><span>Player</span><span>Pick</span><span>Projection</span><span>Confidence</span><span>Live / Final</span><span>Model detail</span></div>
            <div className="divide-y divide-white/[0.055]">
              {boardPicks.map((pick) => <article key={pick.id} className="grid gap-3 px-5 py-4 transition hover:bg-white/[0.02] lg:grid-cols-[48px_1.1fr_.8fr_.62fr_.62fr_.72fr_1.1fr] lg:items-center lg:gap-4">
                <span className={`font-mono text-sm font-black ${accent}`}><span className="mr-2 text-[9px] uppercase text-neutral-500 lg:hidden">Rank</span>{String(pick.rank).padStart(2, "0")}</span>
                <div className="flex items-center gap-3"><div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-white/[0.05]">{pick.headshotUrl ? <Image src={pick.headshotUrl} alt="" fill sizes="44px" className="object-contain object-bottom" /> : null}</div><div className="min-w-0"><p className="truncate text-sm font-black text-white">{pick.playerName}</p><p className="mt-1 truncate text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-600">{pick.position ? `${pick.position} · ` : ""}{pick.team} vs {pick.opponent}</p></div></div>
                <div><p className="eyebrow lg:hidden">Pick & captured price</p><p className="mt-1 text-sm font-black text-white">{pick.selection} {pick.line}</p><p className="mt-1 text-[10px] text-neutral-400">{pick.market}</p><PickPrice pick={pick} /></div>
                <p className="font-mono text-sm font-bold text-neutral-300"><span className="mr-2 font-sans text-[9px] font-black uppercase tracking-[0.12em] text-neutral-500 lg:hidden">Projection</span>{pick.projection ?? "—"}</p>
                <p className={`font-mono text-sm font-black ${accent}`}><span className="mr-2 font-sans text-[9px] font-black uppercase tracking-[0.12em] text-neutral-500 lg:hidden">Confidence</span>{percent(pick.confidence)}</p>
                <div><span className={`inline-flex rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-[0.09em] ${resultTone(pick.result)}`}>{statusLabel(pick)}</span>{pick.live && pick.status === "live" ? <PaceMeter pick={pick} compact /> : pick.actualValue !== null ? <p className="mt-1 text-[10px] text-neutral-500">Final: <span className="font-mono text-white">{pick.actualValue}</span> / {pick.line}</p> : null}</div>
                <div><p className="text-xs leading-5 text-neutral-400">{pick.explanation}</p><div className="mt-2 flex flex-wrap gap-1">{pick.supportingStats.slice(0, 3).map((stat) => <span key={stat} className="rounded-md bg-white/[0.04] px-2 py-1 text-[8px] text-neutral-500">{stat}</span>)}</div></div>
              </article>)}
            </div>
            {boardPicks.length === 0 ? <p className="p-7 text-center text-sm text-neutral-600">No picks match these filters.</p> : null}
          </div> : null}
        </>
      ) : null}

      {!loading && !error && data && view === "results" ? (
        <div className="mt-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Tracked decisions", String(data.performance.graded)],
              ["Overall accuracy", percent(data.performance.accuracy)],
              ["Top-five accuracy", percent(data.performance.topFiveAccuracy)],
              ["Pushes / voids", `${data.performance.pushes} / ${data.performance.voids}`]
            ].map(([label, value]) => <div key={label} className="rounded-[20px] border border-white/[0.08] bg-white/[0.025] p-5"><p className="eyebrow">{label}</p><p className="mt-2 font-mono text-2xl font-black text-white">{value}</p></div>)}
          </div>
          <div className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_.8fr]">
            <section className="overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#090909]" aria-labelledby="recent-player-results"><div className="border-b border-white/[0.08] px-5 py-4"><h3 id="recent-player-results" className="font-black text-white">Recent graded picks</h3><p className="mt-1 text-xs text-neutral-600">Original line and projection beside the verified final stat.</p></div><div className="divide-y divide-white/[0.055]">{data.recentResults.map((pick) => <article key={`${pick.id}-${pick.resultUpdatedAt}`} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_.8fr_.55fr_auto] sm:items-center"><div><p className="text-sm font-black text-white">{pick.playerName}</p><p className="mt-1 text-[10px] text-neutral-600">{pick.team} vs {pick.opponent} · {pick.market}</p></div><p className="text-xs font-bold text-neutral-300">{pick.selection} {pick.line}</p><p className="font-mono text-xs text-white">Final {pick.actualValue ?? "—"}</p><span className={`w-fit rounded-full border px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.1em] ${resultTone(pick.result)}`}>{statusLabel(pick)}</span></article>)}{data.recentResults.length === 0 ? <p className={`p-7 text-sm ${data.trackingAvailable ? "text-neutral-600" : "text-amber-200"}`}>{data.trackingAvailable ? "Results will appear as tracked games become final." : "Current-slate finals can still appear here, but permanent result history needs the server-side Supabase secret configured."}</p> : null}</div></section>
            <section className="rounded-[24px] border border-white/[0.08] bg-[#090909] p-5"><h3 className="font-black text-white">Performance by market</h3><div className="mt-4 space-y-4">{data.performance.byMarket.map((item) => <div key={item.market}><div className="flex items-center justify-between text-xs"><span className="text-neutral-400">{item.market}</span><span className="font-mono font-black text-white">{percent(item.accuracy)} · {item.graded}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className={`h-full rounded-full ${sport === "nfl" ? "bg-lime-300" : "bg-cyan-300"}`} style={{ width: `${item.accuracy * 100}%` }} /></div></div>)}{data.performance.byMarket.length === 0 ? <p className="text-sm leading-6 text-neutral-600">Market splits need at least one correct or incorrect final result.</p> : null}</div></section>
          </div>
        </div>
      ) : null}

      {!loading && !error && data && view === "model" ? (
        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["01", "Pregame-only inputs", sport === "mlb" ? "Season rates, last-10 form, probable starters, opponent history, and the team model are captured before first pitch." : "Only games completed before kickoff feed the rolling three-game player form, role, team strength, and matchup context."],
            ["02", "Calibrated confidence", "Confidence is capped for small samples and volatile markets. It describes model separation from the line—not certainty or a guarantee."],
            ["03", "Real lines, real payouts", "Every pick is built on the DraftKings line posted for that exact market, with its payout multiplier shown. Top-five slots require a price no heavier than -160, and the model only surfaces a side when it still likes it against the market."],
            ["04", "Starters only, tracked live", sport === "nfl" ? "Current rosters, injury designations, and depth charts gate every NFL pick, so backups and inactive players are never propositions. During games each pick shows its pace toward the line; the saved pick never changes and grades only once the game is final." : "Active rosters, posted lineups, probable starters, and playing-time share gate every pick. During games each pick shows its pace toward the line; the saved pick never changes and grades only once the game is final."]
          ].map(([number, title, copy]) => <article key={number} className="rounded-[24px] border border-white/[0.08] bg-[#090909] p-6"><span className={`font-mono text-xs font-black ${accent}`}>{number}</span><h3 className="mt-4 text-lg font-black text-white">{title}</h3><p className="mt-3 text-sm leading-6 text-neutral-400">{copy}</p></article>)}
          <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.02] p-6 md:col-span-2 xl:col-span-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="eyebrow">Current release</p><p className="mt-2 font-mono text-sm font-black text-white">{sport === "mlb" ? "mlb-player-board-v3+book-v1" : "nfl-player-board-v3+book-v1"}</p><p className="mt-2 text-xs text-neutral-400">Daily locked snapshot · optional 30-second live polling · official final grading</p></div><span className={`w-fit rounded-full border px-3 py-2 text-[9px] font-black uppercase tracking-[0.12em] ${accentButton}`}>Audit trail active</span></div></div>
        </div>
      ) : null}
    </section>
  );
}
