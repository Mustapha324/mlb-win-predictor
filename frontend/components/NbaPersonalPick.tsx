"use client";

import { useSyncExternalStore, useState } from "react";
import type { NbaGame } from "@/lib/server/nba";

const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("nba-pick", callback);
  const timer = window.setInterval(callback, 1000);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener("nba-pick", callback); window.clearInterval(timer); };
};

export default function NbaPersonalPick({ game }: { game: NbaGame }) {
  const key = `sportiq:nba:pick:${game.id}`;
  const [notice, setNotice] = useState("");
  const saved = useSyncExternalStore(subscribe, () => {
    try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
  }, () => "");
  const open = useSyncExternalStore(subscribe, () => game.state === "pre" && Date.parse(game.tipoff) > Date.now() && !/postpon|cancel|delay|suspend/i.test(game.status), () => false);
  const winner = game.state === "post" && /^final/i.test(game.status) && game.home.score !== null && game.away.score !== null && game.home.score !== game.away.score ? (game.home.score > game.away.score ? game.home : game.away) : null;
  function choose(id: string) {
    // eslint-disable-next-line react-hooks/purity -- This runs on a click, and must recheck the deadline at that instant.
    if (!open || Date.now() >= Date.parse(game.tipoff)) return;
    try { localStorage.setItem(key, id); window.dispatchEvent(new Event("nba-pick")); setNotice("Pick saved."); }
    catch { setNotice("Your browser could not save this pick. Enable local storage and try again."); }
  }
  return <section className="mt-5 border-t border-white/10 pt-4" aria-label="Your NBA pick">
    <p className="text-xs font-bold uppercase tracking-widest text-neutral-300">Your call · {open ? "Open until tipoff" : "Locked"}</p>
    <p className="mt-2 text-xs text-neutral-500">Saved on this device. These picks do not count toward account stats or leaderboards.</p>
    {open ? <div className="mt-3 grid grid-cols-2 gap-2">{[game.away, game.home].map(team => <button key={team.id} aria-pressed={saved === team.id} onClick={() => choose(team.id)} className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-bold ${saved === team.id ? "border-orange-300 bg-orange-300/20 text-orange-100" : "border-white/15 text-neutral-300 hover:bg-white/5"}`}>Pick {team.abbreviation}</button>)}</div> : null}
    {saved ? <p className="mt-3 text-sm text-orange-200">Your pick: {saved === game.home.id ? game.home.name : game.away.name}{winner ? ` · ${winner.id === saved ? "Won" : "Lost"}` : ""}</p> : !open ? <p className="mt-3 text-xs text-neutral-400">No personal pick saved before tipoff.</p> : null}
    <p role="status" className="mt-2 text-xs text-neutral-400">{notice}</p>
  </section>;
}
