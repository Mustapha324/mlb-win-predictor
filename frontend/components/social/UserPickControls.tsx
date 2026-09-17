"use client";

import Link from "next/link";
import { useState } from "react";
import type { TeamPrediction } from "@/lib/api";
import { isPickOpen, type SocialGame } from "@/lib/social";
import { SocialError, socialRequest, useSocialClock, useSocialResource } from "@/lib/socialClient";
import { PickList } from "@/components/social/PickList";

export function UserPickControls({ game }: { game: TeamPrediction }) {
  const [expanded, setExpanded] = useState(false);
  const now = useSocialClock();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const resource = useSocialResource<SocialGame>(expanded ? `view=game&sport=${game.sport}&gameId=${encodeURIComponent(game.game_id)}` : null);
  const open = now > 0 && isPickOpen(game.game_time_utc, game.status, now) && !game.is_final;
  async function choose(selection: string) {
    setBusy(true); setNotice(""); setNeedsLogin(false);
    try { await socialRequest("", { action: "pick", sport: game.sport, gameId: game.game_id, selection }); setNotice(`Your pick: ${selection}. Saved with SportIQ’s current model call.`); resource.reload(); }
    catch (error) { setNeedsLogin(error instanceof SocialError && error.status === 401); setNotice(error instanceof Error ? error.message : "Unable to save your pick."); }
    finally { setBusy(false); }
  }
  return <section className="relative mt-5 border-t border-white/10 pt-4" aria-label="Your game pick"><div className="flex items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-widest text-neutral-300">Your call</p><span className="text-[10px] font-bold text-neutral-400">{open ? "Open until game time" : "LOCKED / NOT OPEN"}</span></div>{open ? <div className="mt-3 grid grid-cols-2 gap-2">{[game.away_team, game.home_team].map((team) => <button key={team} disabled={busy} onClick={() => { setExpanded(true); void choose(team); }} className="min-h-11 rounded-xl border border-cyan-300/20 bg-cyan-300/[.04] px-3 py-2 text-xs font-bold text-cyan-100 transition hover:bg-cyan-300/15 disabled:opacity-50">Pick {team}</button>)}</div> : <p className="mt-2 text-xs leading-6 text-neutral-400">Picks lock at the scheduled start. Unknown, postponed, and in-progress games do not accept picks.</p>}<div aria-live="polite">{notice ? <p className="mt-3 text-xs leading-6 text-cyan-100">{notice}</p> : null}{needsLogin ? <Link className="secondary-button mt-3" href={`/account?next=${encodeURIComponent(`${game.sport === "nfl" ? "/nfl" : ""}/games/${game.game_id}`)}`}>Log in / Sign up to pick</Link> : null}</div><button className="mt-3 min-h-11 text-xs font-bold text-neutral-300 underline-offset-4 hover:underline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Hide picks & consensus" : "View my pick, friends & consensus"}</button>{expanded ? <div className="mt-3 space-y-4">{resource.error ? <p role="status" className="text-xs leading-6 text-neutral-400">{resource.error.message}</p> : resource.data ? <><div className="grid grid-cols-2 gap-3">{(["friends", "community"] as const).map((kind) => { const counts = resource.data![kind]; return <div key={kind} className="rounded-xl border border-white/10 p-3"><p className="text-xs font-bold capitalize">{kind} · {counts.total}</p>{counts.total ? <div className="mt-2 space-y-1 text-xs text-neutral-400"><p>{game.away_team}: {Math.round(counts.away / counts.total * 100)}%</p><p>{game.home_team}: {Math.round(counts.home / counts.total * 100)}%</p></div> : <p className="mt-2 text-xs text-neutral-400">No picks yet.</p>}</div>; })}</div>{resource.data.ownPick ? <PickList picks={[resource.data.ownPick]} reload={resource.reload} /> : null}{resource.data.picks.length ? <PickList picks={resource.data.picks.filter((pick) => !pick.isOwn)} allowTail reload={resource.reload} /> : null}</> : <p role="status" className="animate-pulse text-xs text-neutral-400">Loading picks…</p>}</div> : null}</section>;
}
