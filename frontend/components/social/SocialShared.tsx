"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { PickRecord, SocialStats } from "@/lib/social";
import type { SocialError } from "@/lib/socialClient";

export function SocialShell({ title, eyebrow = "Your game. Your record.", description, children }: { title: string; eyebrow?: string; description: string; children: ReactNode }) {
  return <main className="mx-auto max-w-6xl"><header className="mb-7 border-b border-white/10 pb-7"><p className="sport-kicker">{eyebrow}</p><h1 className="mt-3 text-4xl font-black tracking-tight sm:text-6xl">{title}</h1><p className="mt-4 max-w-2xl text-sm leading-7 text-neutral-400">{description}</p></header>{children}</main>;
}

export function AccountPrompt({ returnTo = "/my-picks" }: { returnTo?: string }) {
  return <section className="sport-panel p-6 sm:p-9"><p className="sport-kicker">Join the game</p><h2 className="mt-3 text-2xl font-black">Keep a record of your own picks.</h2><p className="mt-3 max-w-xl text-sm leading-7 text-neutral-400">Create a free profile to make picks, compare your record with SportIQ, and follow your friends. Every prediction is available without an account.</p><div className="mt-5 flex flex-wrap gap-3"><Link href={`/account?next=${encodeURIComponent(returnTo)}`} className="primary-button">Log in / Sign up</Link><Link href="/" className="secondary-button">View predictions</Link></div></section>;
}

export function SocialStatus({ error, retry }: { error: SocialError | null; retry: () => void }) {
  if (error?.status === 401) return <AccountPrompt />;
  if (error) return <section className="sport-panel p-7" role="status"><h2 className="text-xl font-bold">{error.status === 503 ? "Social features are not available yet" : "We couldn’t load this page"}</h2><p className="mt-3 text-sm leading-7 text-neutral-400">{error.message}</p><div className="mt-5 flex gap-3"><button className="secondary-button" onClick={retry}>Try again</button><Link href="/" className="secondary-button">View predictions</Link></div></section>;
  return <div role="status" aria-label="Loading" className="grid gap-4 sm:grid-cols-3">{[1, 2, 3].map((n) => <div key={n} className="h-40 animate-pulse rounded-3xl border border-white/10 bg-white/[.035]" />)}<span className="sr-only">Loading SportIQ data…</span></div>;
}

export const formatPercent = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}%`;
export const recordLabel = (record: PickRecord) => `${record.wins}–${record.losses}`;

export function StatCard({ label, value, note, accent = false }: { label: string; value: string | number; note?: string; accent?: boolean }) {
  return <div className="sport-panel p-5"><p className="text-xs font-bold uppercase tracking-widest text-neutral-400">{label}</p><p className={`mt-3 font-mono text-3xl font-black ${accent ? "text-lime-300" : "text-white"}`}>{value}</p>{note ? <p className="mt-2 text-xs text-neutral-400">{note}</p> : null}</div>;
}

function ComparisonBar({ label, value }: { label: string; value: number | null }) {
  return <div><div className="mb-2 flex justify-between gap-2 text-sm"><span className="text-neutral-300">{label}</span><span className="font-mono text-white">{formatPercent(value)}</span></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-300" style={{ width: `${value ?? 0}%` }} /></div></div>;
}

export function StatsGrid({ stats, comparison = false }: { stats: SocialStats; comparison?: boolean }) {
  return <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><StatCard label="Overall record" value={recordLabel(stats)} note={`${stats.graded} graded picks`} /><StatCard label="Win rate" value={formatPercent(stats.winPercentage)} accent /><StatCard label="Pending" value={stats.pending} note={`${stats.pushes} pushes · ${stats.voids} voids`} /><StatCard label="Last 10" value={recordLabel(stats.last10)} /><StatCard label="MLB" value={recordLabel(stats.mlb)} note={formatPercent(stats.mlb.winPercentage)} /><StatCard label="NFL" value={recordLabel(stats.nfl)} note={formatPercent(stats.nfl.winPercentage)} /><StatCard label="Current streak" value={stats.currentStreak || "—"} /><StatCard label="Best win streak" value={stats.bestStreak ? `W${stats.bestStreak}` : "—"} /></div>{comparison ? <div className="mt-5 grid gap-5 md:grid-cols-2"><section className="sport-panel p-6"><p className="sport-kicker">You × SportIQ</p><h2 className="mt-2 text-xl font-black">Same games. Two perspectives.</h2><p className="mb-6 mt-3 text-xs leading-6 text-neutral-400">Compared on your graded games using the model call saved when you made each pick. Pushes and voids are excluded.</p><div className="space-y-5"><ComparisonBar label="Your win rate" value={stats.winPercentage} /><ComparisonBar label="SportIQ on your games" value={stats.modelWinPercentage} /><ComparisonBar label="When you agree with SportIQ" value={stats.agreeWinPercentage} /><ComparisonBar label="When you disagree" value={stats.disagreeWinPercentage} /></div><p className="mt-5 text-xs text-neutral-400">Model agreement across submitted picks: {formatPercent(stats.agreementPercentage)}</p></section><section className="sport-panel p-6"><p className="sport-kicker">Following good company</p><h2 className="mt-2 text-xl font-black">Your tailing record</h2>{stats.tails.length ? <ul className="mt-5 divide-y divide-white/10">{stats.tails.map((tail) => <li key={tail.username} className="flex flex-wrap justify-between gap-3 py-4"><Link href={`/profile/${encodeURIComponent(tail.username)}`} className="font-bold text-cyan-200">@{tail.username}</Link><span className="font-mono text-sm">{tail.wins}–{tail.losses} · {formatPercent(tail.winPercentage)}</span></li>)}</ul> : <p className="mt-4 text-sm leading-7 text-neutral-400">Tail a friend’s pregame pick to start tracking how you perform together.</p>}<Link href="/friends" className="secondary-button mt-5">Friends picks</Link></section></div> : null}</>;
}
