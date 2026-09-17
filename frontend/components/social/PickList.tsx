"use client";

import Link from "next/link";
import { useState } from "react";
import type { SocialPick } from "@/lib/social";
import { socialRequest, SocialError, useSocialClock } from "@/lib/socialClient";

export function PickList({ picks, reload, allowTail = false }: { picks: SocialPick[]; reload?: () => void; allowTail?: boolean }) {
  const now = useSocialClock();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  async function act(pick: SocialPick, action: "tail" | "deletePick" | "pick", selection?: string) {
    setBusy(pick.id); setNotice(""); setNeedsLogin(false);
    try {
      await socialRequest("", { action, pickId: pick.id, sport: pick.sport, gameId: pick.gameId, selection });
      setNotice(action === "tail" ? `You tailed @${pick.username}. Your pick is saved independently.` : action === "deletePick" ? "Pick removed." : "Your selection is updated.");
      reload?.();
    } catch (error) { setNeedsLogin(error instanceof SocialError && error.status === 401); setNotice(error instanceof Error ? error.message : "Unable to save. Try again."); }
    finally { setBusy(null); }
  }
  return <><div aria-live="polite">{notice ? <p className="mb-4 rounded-xl border border-white/10 p-4 text-sm text-cyan-100">{notice} {needsLogin ? <Link className="underline" href="/account?next=/friends">Log in / Sign up</Link> : null}</p> : null}</div>{picks.length ? <ul className="space-y-3">{picks.map((pick) => {
    const locked = pick.locked || now === 0 || Date.parse(pick.startsAt) <= now;
    const editable = pick.isOwn && !locked && pick.result === "PENDING";
    return <li key={pick.id} className="sport-panel p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><Link href={`/profile/${encodeURIComponent(pick.username)}`} className="text-xs font-bold text-neutral-300"><span aria-hidden="true">{pick.avatar}</span> @{pick.username}</Link><Link href={`${pick.sport === "nfl" ? "/nfl" : ""}/games/${encodeURIComponent(pick.gameId)}`} className="mt-2 block text-sm font-bold text-white">{pick.awayTeam} at {pick.homeTeam}</Link><p className="mt-1 text-xs text-neutral-400">{pick.sport.toUpperCase()} · {new Date(pick.startsAt).toLocaleString()}</p></div><span className={`rounded-full border px-3 py-1 text-xs font-black ${pick.result === "WIN" ? "border-lime-300/30 text-lime-200" : pick.result === "LOSS" ? "border-rose-300/30 text-rose-200" : "border-white/15 text-neutral-300"}`}>{pick.result}{locked && pick.result === "PENDING" ? " · LOCKED" : ""}</span></div><div className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2"><div><p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">{pick.isOwn ? "Your pick" : "Their pick"}</p><p className="mt-1 font-black text-lime-200">{pick.selection}</p></div><div><p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">SportIQ at pick time</p><p className="mt-1 text-sm text-cyan-200">{pick.modelSelection} · {Math.round(pick.modelProbability * 100)}%</p></div></div>{pick.tailedFrom ? <p className="mt-3 text-xs text-neutral-400">Tailed from @{pick.tailedFrom} · saved independently</p> : null}{editable ? <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy !== null} className="secondary-button" onClick={() => act(pick, "pick", pick.selection === pick.homeTeam ? pick.awayTeam : pick.homeTeam)}>Switch to {pick.selection === pick.homeTeam ? pick.awayTeam : pick.homeTeam}</button><button disabled={busy !== null} className="secondary-button" onClick={() => act(pick, "deletePick")}>Remove pick</button></div> : null}{allowTail && !pick.isOwn && !locked && pick.result === "PENDING" ? <button disabled={busy !== null} onClick={() => act(pick, "tail")} className="secondary-button mt-4">{busy === pick.id ? "Saving…" : "Tail pick"}</button> : null}</li>;
  })}</ul> : <div className="sport-panel p-7"><p className="font-bold">No picks to show yet.</p><p className="mt-2 text-sm leading-7 text-neutral-400">Public picks appear after game start. Friends can share their picks before the deadline.</p><Link href="/" className="secondary-button mt-4">Explore today’s games</Link></div>}</>;
}
