"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TeamBadge } from "@/components/TeamBadge";
import { getErrorMessage, getGamePrediction, type TeamPrediction } from "@/lib/api";
import { SPORTS, type Sport } from "@/lib/sports";

function percent(value: number): string { return `${Math.round(value * 100)}%`; }

export function GameDetailsView({ id, sport }: { id: string; sport: Sport }) {
  const [game, setGame] = useState<TeamPrediction | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getGamePrediction(id, sport).then(setGame).catch((requestError) => setError(getErrorMessage(requestError, "Unable to load this matchup."))); }, [id, sport]);
  const homeHref = SPORTS[sport].homeHref;
  const accent = sport === "nfl" ? "text-lime-300" : "text-cyan-300";
  if (error) return <main><Link href={homeHref} className={`text-xs font-bold uppercase tracking-[0.14em] ${accent}`}>← Back to slate</Link><div className="mt-6 rounded-[24px] border border-rose-300/20 bg-rose-300/[0.06] p-6 text-rose-100">{error}</div></main>;
  if (!game) return <main><div className="h-[560px] animate-pulse rounded-[28px] border border-white/[0.07] bg-white/[0.025]" /></main>;

  const locked = game.is_locked === true;
  const homeIsPick = game.pregame_predicted_winner === game.home_team;
  const pickProbability = homeIsPick ? game.pregame_home_win_probability : game.pregame_away_win_probability;
  return (
    <main>
      <Link href={homeHref} className={`text-xs font-bold uppercase tracking-[0.14em] ${accent}`}>← Back to slate</Link>
      <section className="relative mt-5 overflow-hidden rounded-[30px] border border-white/[0.08] bg-[#080808] p-6 sm:p-10">
        <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-5"><div><p className="eyebrow">{game.date} · {game.venue ?? "Venue TBD"}</p><p className="mt-1 text-sm font-bold text-white">{game.inning ?? game.status}</p></div><span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">{game.prediction_source}</span></div>
        <div className="relative mt-8 grid items-center gap-8 md:grid-cols-[1fr_auto_1fr]">
          {[game.awayTeam, game.homeTeam].map((team, index) => { const probability = index === 0 ? game.pregame_away_win_probability : game.pregame_home_win_probability; const player = index === 0 ? game.awayProbablePitcher : game.homeProbablePitcher; return <div key={`${team.id}-${index}`} className={`flex items-center gap-4 ${index === 1 ? "order-3 md:flex-row-reverse md:text-right" : "order-1"}`}><TeamBadge team={team} size="lg" /><div><p className="text-xl font-black text-white">{team.name}</p><p className="mt-1 text-xs text-neutral-500">{team.record}{sport === "mlb" ? ` · ${player || "Starter TBD"}` : ""}</p><p className={`mt-3 font-mono text-3xl font-black text-white ${locked ? "blur-[7px]" : ""}`}>{percent(probability)}</p></div></div>; })}
          <div className="order-2 text-center text-xs font-black uppercase tracking-[0.2em] text-neutral-700">AT</div>
        </div>

        <div className="relative mt-10 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
          <div className="relative overflow-hidden rounded-[22px] border border-white/[0.09] bg-white/[0.03] p-6"><div className={locked ? "blur-[9px] select-none" : ""}><p className="eyebrow">Pregame call · locked</p><p className="mt-2 text-2xl font-black text-white">{game.pregame_predicted_winner}</p><p className={`mt-1 font-mono text-4xl font-black ${accent}`}>{percent(pickProbability)}</p><p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">{game.confidence} confidence</p></div>{locked ? <div className="absolute inset-0 grid place-items-center bg-black/35"><Link href="/pro" className="primary-button">Unlock full breakdown</Link></div> : null}</div>
          <div className="relative overflow-hidden rounded-[22px] border border-white/[0.07] bg-black/20 p-6"><div className={locked ? "blur-[9px] select-none" : ""}><p className="eyebrow">Why the model leans this way</p><ul className="mt-4 space-y-3">{(game.factors.length ? game.factors : ["Full model factors are available with Sport IQ Pro."]).map((factor, index) => <li key={`${factor}-${index}`} className="flex gap-3 text-sm text-neutral-300"><span className={`font-mono ${accent}`}>0{index + 1}</span><span>{factor}</span></li>)}</ul></div></div>
        </div>

        {game.is_final && game.actual_winner ? <div className="mt-5 rounded-[22px] border border-white/[0.09] bg-white/[0.035] p-6"><p className="eyebrow">Verified final winner</p><div className="mt-2 flex flex-wrap items-center justify-between gap-3"><p className="text-2xl font-black text-white">{game.actual_winner}</p>{!locked ? <span className={game.actual_winner === game.pregame_predicted_winner ? "text-emerald-300" : "text-rose-300"}>{game.actual_winner === game.pregame_predicted_winner ? "Pregame pick hit" : "Pregame pick missed"}</span> : null}</div></div> : null}
        {!game.is_final ? <div className="mt-5 rounded-[22px] border border-lime-300/15 bg-lime-300/[0.045] p-6"><p className="eyebrow">Live layer · never overwrites pregame</p>{game.live_market || game.live_favorite ? <div className="mt-2 flex items-center justify-between"><p className="text-xl font-black text-white">{game.live_market?.favorite ?? game.live_favorite}</p><p className="font-mono text-2xl font-black text-lime-300">{percent(game.live_market ? Math.max(game.live_market.homeWinProbability, game.live_market.awayWinProbability) : Math.max(game.live_home_win_probability ?? 0.5, game.live_away_win_probability ?? 0.5))}</p></div> : <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-neutral-500">Live probability and market movement are a Pro feature.</p><Link href="/pro" className="text-xs font-black uppercase tracking-[0.12em] text-lime-300">Unlock live →</Link></div>}</div> : null}
      </section>
    </main>
  );
}
