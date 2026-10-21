/* eslint-disable @next/next/no-img-element -- ESPN supplies athlete headshot URLs. */
import Link from "next/link";
import NbaPersonalPick from "@/components/NbaPersonalPick";
import { PlayerPicksSection } from "@/components/PlayerPicksSection";
import { getNbaSlate } from "@/lib/server/nba";

export const metadata = { title: "NBA predictions", description: "NBA game slate and transparent pregame win probabilities." };
export const dynamic = "force-dynamic";

function easternToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function shift(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function percent(value: number): string { return `${Math.round(value * 100)}%`; }

export default async function NbaPage({ searchParams }: { searchParams: Promise<{ date?: string; view?: string }> }) {
  const params = await searchParams;
  const requested = params.date;
  const resultsView = params.view === "results";
  const date = requested && /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(requested) && new Date(`${requested}T12:00:00Z`).toISOString().slice(0, 10) === requested ? requested : shift(easternToday(), resultsView ? -1 : 0);
  const viewQuery = resultsView ? "&view=results" : "";
  let slate: Awaited<ReturnType<typeof getNbaSlate>> | null = null;
  let error: string | null = null;
  try { slate = await getNbaSlate(date); } catch (cause) { error = cause instanceof Error ? cause.message : "NBA games are temporarily unavailable."; }
  const heading = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });

  return <main className="mx-auto min-h-screen max-w-[1480px] px-4 pb-24 pt-10 sm:px-7">
    <section className="relative overflow-hidden rounded-[28px] border border-orange-300/15 bg-[#100d0b] p-7 sm:p-10">
      <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-orange-500/10 blur-3xl" />
      <p className="text-xs font-black uppercase tracking-[0.28em] text-orange-300">Sport IQ / Basketball</p>
      <h1 className="mt-3 text-4xl font-black tracking-[-0.05em] text-white sm:text-6xl">{resultsView ? "NBA results" : "NBA game picks"}</h1>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-400">Today&apos;s matchups, honest win chances, and live scores. Every number names its source.</p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link href={`/nba?date=${shift(date, -1)}${viewQuery}`} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-bold text-neutral-200 hover:bg-white/5" aria-label="Previous day">←</Link>
        <span className="min-w-48 text-center text-sm font-bold text-white">{heading}</span>
        <Link href={`/nba?date=${shift(date, 1)}${viewQuery}`} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-bold text-neutral-200 hover:bg-white/5" aria-label="Next day">→</Link>
        <Link href="/nba" className="rounded-xl border border-orange-300/20 bg-orange-300/10 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-orange-200">Today</Link>
        <Link href={resultsView ? "/nba" : "/nba/history"} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-bold text-neutral-200">{resultsView ? "Game picks" : "Results"}</Link>
      </div>
    </section>

    {error ? <section className="mt-6 rounded-2xl border border-rose-300/20 bg-rose-300/5 p-6 text-rose-100" role="alert">{error} <Link href="/nba" className="ml-2 underline">Try again</Link></section> : null}
    {slate ? <>
      <div className="mt-10 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-300">Daily slate</p><h2 className="mt-2 text-2xl font-black text-white">{slate.games.length} {slate.games.length === 1 ? "game" : "games"}</h2></div><p className="max-w-xl text-xs leading-5 text-neutral-500">{slate.note}</p></div>
      {slate.games.length ? <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{slate.games.map((game) => {
        const home = game.homeWinProbability;
        const pickHome = home !== null && home >= 0.5;
        const pick = home === null ? null : pickHome ? game.home : game.away;
        return <article key={game.id} className="rounded-[24px] border border-orange-300/10 bg-[#0b0b0b] p-6">
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] pb-4"><div><p className="text-sm font-bold text-white">{new Date(game.tipoff).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET</p><p className="mt-1 text-xs text-neutral-600">{game.venue ?? "Venue TBD"}</p></div><span className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-neutral-300">{game.status}</span></div>
          <div className="mt-5 space-y-4">{[game.away, game.home].map((team) => <div key={team.id} className="flex items-center justify-between gap-3"><div><p className="font-bold text-white">{team.name}</p><p className="text-xs text-neutral-500">{team.record}</p></div><div className="text-right font-mono font-bold text-neutral-200">{game.state === "pre" && home !== null ? percent(team.id === game.home.id ? home : 1 - home) : team.score ?? "—"}</div></div>)}</div>
          <div className="mt-5 rounded-2xl border border-orange-300/10 bg-orange-300/[0.05] p-4">{game.state === "pre" && pick ? <><p className="text-[10px] font-black uppercase tracking-[0.15em] text-orange-300">Pregame lean</p><div className="mt-1 flex items-center justify-between gap-2"><p className="font-black text-white">{pick.name}</p><p className="font-mono text-xl font-black text-orange-200">{percent(pickHome ? home! : 1 - home!)}</p></div><p className="mt-2 text-xs text-neutral-500">{game.probabilitySource}{game.marketHomeProbability !== null ? " · no-vig moneyline" : " · no current market price"}</p></> : <p className="text-sm text-neutral-400">{game.state === "pre" ? "Waiting for enough data to make a responsible call." : "Pregame probability unavailable after tipoff; score shown above."}</p>}</div>
          {game.state === "pre" && game.modelHomeProbability !== null && game.marketHomeProbability !== null ? <p className="mt-3 text-xs text-neutral-500">Independent rating: {game.modelHomeProbability >= 0.5 ? game.home.abbreviation : game.away.abbreviation} {percent(Math.max(game.modelHomeProbability, 1 - game.modelHomeProbability))}</p> : null}
          {game.state === "post" && /^final/i.test(game.status) && game.home.score !== null && game.away.score !== null ? <p className="mt-4 font-bold text-orange-200">Final result: {game.home.score === game.away.score ? "Tied" : `${game.home.score > game.away.score ? game.home.name : game.away.name} win`}</p> : null}
          {game.players.length ? <section className="mt-5 border-t border-white/10 pt-4"><h3 className="text-xs font-bold uppercase tracking-widest text-neutral-400">Players</h3><div className="mt-3 grid grid-cols-2 gap-3">{game.players.map(player => <div key={player.id} className="flex items-center gap-2">{player.photo ? <img src={player.photo} alt={player.name} width={48} height={36} loading="lazy" className="rounded-lg bg-white/5 object-contain" /> : null}<div><p className="text-xs font-bold text-neutral-200">{player.name}</p><p className="text-[10px] text-neutral-500">{player.stat}</p></div></div>)}</div></section> : <p className="mt-4 text-xs text-neutral-500">Player leaders have not been supplied for this matchup.</p>}
          <NbaPersonalPick game={game} />
        </article>;
      })}</div> : <div className="mt-5 rounded-2xl border border-dashed border-white/10 p-10 text-center text-neutral-400">No NBA games on this date. Try the next day.</div>}
    </> : null}
    <PlayerPicksSection sport="nba" date={date} />
  </main>;
}
