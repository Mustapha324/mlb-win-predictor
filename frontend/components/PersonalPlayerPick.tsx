"use client";

import { useState, useSyncExternalStore } from "react";
import type { PlayerPick } from "@/lib/api";
import { gradePlayerPick } from "@/lib/server/playerPickScoring";

const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback); window.addEventListener("personal-player-pick", callback);
  const timer = window.setInterval(callback, 1000);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener("personal-player-pick", callback); window.clearInterval(timer); };
};
type Saved = { selection: "Over" | "Under"; line: number };
function read(key: string): string { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } }
function parse(raw: string): Saved | null {
  try { const value = JSON.parse(raw); return (value.selection === "Over" || value.selection === "Under") && Number.isFinite(value.line) ? value : null; } catch { return null; }
}
export default function PersonalPlayerPick({ pick }: { pick: PlayerPick }) {
  const key = `sportiq:personal-player:${pick.id}`;
  const raw = useSyncExternalStore(subscribe, () => read(key), () => "");
  const open = useSyncExternalStore(subscribe, () => pick.status === "scheduled" && !!pick.gameTime && Date.parse(pick.gameTime) > Date.now(), () => false);
  const saved = parse(raw);
  const [error, setError] = useState("");
  function choose(selection: "Over" | "Under" | null) {
    // eslint-disable-next-line react-hooks/purity -- Event-time deadline check, never a render-time clock.
    if (!open || !pick.gameTime || Date.now() >= Date.parse(pick.gameTime)) return;
    try { if (selection === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify({ selection, line: pick.line })); window.dispatchEvent(new Event("personal-player-pick")); setError(""); }
    catch { setError("Your browser could not save the pick."); }
  }
  const result = saved ? pick.status === "final" && pick.result === "pending" ? "pending" : gradePlayerPick(saved.selection, saved.line, pick.actualValue, pick.status, pick.result !== "void") : "pending";
  return <div className="mt-3 border-t border-white/10 pt-3" aria-label={`Your pick for ${pick.playerName} ${pick.market}`}>
    <p className="text-[10px] font-bold text-neutral-400">Your pick · this device only</p>
    {open ? <div className="mt-2 flex gap-2">{(["Over", "Under"] as const).map(side => <button key={side} type="button" onClick={() => choose(side)} aria-pressed={saved?.selection === side && saved.line === pick.line} className="min-h-11 flex-1 rounded-lg border border-white/15 px-2 text-[10px] font-bold text-neutral-200 aria-pressed:border-orange-300 aria-pressed:bg-orange-300/15">{side} {pick.line}</button>)}</div> : null}
    <p className="mt-2 text-[10px] text-orange-200" role="status">{error || (saved ? `${saved.selection} ${saved.line}${result !== "pending" ? ` · ${result === "correct" ? "Won" : result === "incorrect" ? "Lost" : result}` : open ? " · saved" : " · locked"}` : open ? "Choose your own side. Excluded from account stats." : "Locked at game time.")}</p>
    {saved && open ? <button type="button" onClick={() => choose(null)} className="mt-1 min-h-11 text-[10px] text-neutral-400 underline">Clear my pick</button> : null}
  </div>;
}
