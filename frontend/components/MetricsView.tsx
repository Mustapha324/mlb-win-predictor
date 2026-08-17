"use client";

import { useEffect, useState } from "react";
import { MetricsCard } from "@/components/MetricsCard";
import { getErrorMessage, getModelMetrics, type ModelMetricsResponse } from "@/lib/api";
import type { Sport } from "@/lib/sports";

const METRIC_EXPLAINERS = [
  ["Accuracy", "The share of holdout games where the higher-probability team won. Useful, but it ignores whether 51% and 75% calls were appropriately different."],
  ["Home baseline", "A deliberately simple comparison: pick the home team every time. A model should be judged against this, not against a coin flip."],
  ["Brier score", "The average squared probability error. A confident miss is punished more than a cautious miss, so it measures probability quality rather than picks alone."],
  ["Log loss", "Another calibration score that sharply penalizes unjustified certainty. Lower is better; it discourages dramatic 90% claims in noisy matchups."]
] as const;

const FEATURE_DETAILS: Record<Sport, Array<[string, string, string]>> = {
  mlb: [
    ["Long-term Elo strength", "Every result moves both teams' ratings by opponent quality and run margin, then offseason regression prevents old performance from dominating.", "Creates a durable talent baseline even early in a season."],
    ["Season record", "Win percentage is calculated only from games completed before the prediction date.", "Captures current-year performance while avoiding future information."],
    ["Last-10 form", "The rolling result window is shifted one game before scoring.", "Responds to meaningful changes faster than full-season record."],
    ["Run differential", "Runs scored minus runs allowed, normalized per game.", "Often reveals team quality hidden by close-game luck."],
    ["Home/road split", "Home win rate is compared with the opponent's road win rate.", "Accounts for venue, travel, batting order, and context effects."],
    ["Probable starter", "ERA and WHIP create a small adjustment scaled down until the pitcher has a reliable innings sample.", "Lets pitching matter without allowing a tiny sample to hijack the call."]
  ],
  nfl: [
    ["Regressed Elo strength", "Team ratings update sequentially after each final and move partway toward league average between seasons.", "Carries real signal forward without assuming last year's team is unchanged."],
    ["Home-field adjustment", "A measured rating bonus is applied before the win probability is calculated.", "Represents travel, crowd, routine, and venue effects."],
    ["Pregame record", "Wins and losses are counted only before the scheduled kickoff.", "Measures current-season results without leaking the final being predicted."],
    ["Recent form", "The last five completed outcomes are compared between teams.", "Gives more weight to current performance than distant games."],
    ["Scoring margin", "Points scored minus points allowed is averaged per game and capped before entering the model.", "Separates repeatable dominance from a record built on narrow wins."],
    ["Opponent context", "The richer offline pipeline tracks schedule strength, rest, QB efficiency, turnovers, sacks, third downs, red zone, weather, injuries, and head-to-head history when reliable.", "Adds context only when it is timestamped before kickoff and available consistently."]
  ]
};

const MODEL_STEPS: Record<Sport, Array<[string, string, string]>> = {
  mlb: [
    ["01", "Baseline", "Completed MLB seasons establish durable team strength without peeking ahead."],
    ["02", "Replay", "The current season is replayed in order so every game only sees earlier results."],
    ["03", "Game day", "Probable-starter ERA and WHIP make a reliability-weighted adjustment."],
    ["04", "Game state", "Score and inning update a separate probability without rewriting pregame."]
  ],
  nfl: [
    ["01", "Prior season", "Completed NFL games establish team strength before the new season."],
    ["02", "Regression", "Ratings move toward average so last year informs rather than dictates."],
    ["03", "Chronological replay", "Record, scoring margin, and recent form only use games already completed."],
    ["04", "Game state", "Live score and clock update a separate probability without rewriting pregame."]
  ]
};

export function MetricsView({ sport }: { sport: Sport }) {
  const [metrics, setMetrics] = useState<ModelMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getModelMetrics(sport).then(setMetrics).catch((requestError) => setError(getErrorMessage(requestError, "Unable to load model metrics.")));
  }, [sport]);
  const accent = sport === "nfl" ? "text-lime-300" : "text-cyan-300";

  return (
    <main>
      <header className="max-w-4xl border-b border-white/[0.08] pb-8">
        <p className={`text-xs font-black uppercase tracking-[0.22em] ${accent}`}>{sport.toUpperCase()} · Transparent by design</p>
        <h1 className="mt-2 text-4xl font-black tracking-[-0.055em] text-white sm:text-6xl">Inside the model.</h1>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-neutral-500">Pregame evaluation is kept separate from live updates and market odds, making every historical result auditable.</p>
      </header>
      {error ? <section className="mt-6 rounded-[22px] border border-rose-300/20 bg-rose-300/[0.06] p-6 text-rose-100">{error}</section> : null}
      {!metrics && !error ? <section className="mt-6 h-48 animate-pulse rounded-[24px] bg-white/[0.025]" /> : null}

      {metrics ? (
        <>
          <section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricsCard label="Holdout accuracy" value={`${(metrics.accuracy * 100).toFixed(1)}%`} trend={`${metrics.correct_predictions.toLocaleString()} of ${metrics.total_predictions_evaluated.toLocaleString()} games correct`} accent />
            <MetricsCard label="Home baseline" value={`${(metrics.majority_baseline_accuracy * 100).toFixed(1)}%`} trend="Accuracy from choosing every home team" />
            <MetricsCard label="Brier score" value={metrics.brier_score.toFixed(3)} trend="Probability error; lower is better" />
            <MetricsCard label="Training games" value={metrics.total_training_examples.toLocaleString()} trend={`${metrics.seasons[0]}–${metrics.seasons.at(-1)} seasons`} />
          </section>

          <section className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {METRIC_EXPLAINERS.map(([title, description]) => (
              <article key={title} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
                <h2 className="text-sm font-black text-white">{title}</h2>
                <p className="mt-2 text-xs leading-5 text-neutral-500">{description}</p>
              </article>
            ))}
          </section>

          <section className="mt-7 grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
            <article className="sport-panel p-6 sm:p-8">
              <p className="eyebrow">How it works</p><h2 className="mt-2 text-2xl font-black text-white">Chronological, never random.</h2>
              <p className="mt-4 text-sm leading-7 text-neutral-400">{metrics.description}</p>
              <div className="mt-6 space-y-4">{MODEL_STEPS[sport].map(([number, title, description]) => <div key={number} className="grid grid-cols-[36px_1fr] gap-3 border-t border-white/[0.06] pt-4"><span className={`font-mono text-xs font-black ${accent}`}>{number}</span><div><p className="text-sm font-bold text-white">{title}</p><p className="mt-1 text-xs leading-5 text-neutral-500">{description}</p></div></div>)}</div>
            </article>
            <article className="sport-panel p-6 sm:p-8">
              <p className="eyebrow">From features to a pick</p><h2 className="mt-2 text-2xl font-black text-white">Why one team moves above 50%.</h2>
              <ol className="mt-6 space-y-5">
                {[
                  ["Compare", "Each home feature is measured against its away counterpart, so the model reads matchup advantages rather than isolated rankings."],
                  ["Weight", "Historically useful signals receive learned or validated weights. Bigger evidence moves the underlying score more; weak signals move it less."],
                  ["Transform", "The combined score passes through a logistic curve, converting it into a home probability between 0 and 1; away probability is the complement."],
                  ["Calibrate", "Holdout probability scores and caps check false certainty. Confidence labels describe distance from 50%, not a guarantee."]
                ].map(([title, description], index) => <li key={title} className="grid grid-cols-[30px_1fr] gap-3"><span className={`font-mono text-xs font-black ${accent}`}>{index + 1}</span><div><p className="text-sm font-black text-white">{title}</p><p className="mt-1 text-xs leading-5 text-neutral-500">{description}</p></div></li>)}
              </ol>
            </article>
          </section>

          <section className="mt-7 sport-panel overflow-hidden">
            <header className="border-b border-white/[0.07] p-6 sm:p-8"><p className="eyebrow">Feature dictionary</p><h2 className="mt-2 text-2xl font-black text-white">What data the winner call actually uses.</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-500">Every production feature below is computed as of the pregame cutoff. A signal is excluded when it cannot be timestamped reliably or would reveal information from after the game began.</p></header>
            <div className="divide-y divide-white/[0.06]">{FEATURE_DETAILS[sport].map(([feature, calculation, reason]) => <article key={feature} className="grid gap-3 px-6 py-5 md:grid-cols-[.7fr_1.3fr_1fr] md:gap-6 sm:px-8"><h3 className="text-sm font-black text-white">{feature}</h3><div><p className="eyebrow">How it is calculated</p><p className="mt-2 text-xs leading-5 text-neutral-400">{calculation}</p></div><div><p className="eyebrow">Why it matters</p><p className="mt-2 text-xs leading-5 text-neutral-400">{reason}</p></div></article>)}</div>
          </section>

          <section className="mt-7 grid gap-5 lg:grid-cols-2">
            <article className="sport-panel p-6 sm:p-8">
              <p className="eyebrow">Pregame versus live</p><h2 className="mt-2 text-2xl font-black text-white">Two probabilities, two jobs.</h2>
              <p className="mt-4 text-sm leading-7 text-neutral-400">The pregame prediction is the accountable model call and is written once to Supabase. The live layer starts from that prior, then responds to score and remaining game time. Bookmaker consensus, when enabled, is displayed as a third independent reference. Neither live value can edit the pregame snapshot.</p>
              <div className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-5"><p className="text-xs font-black uppercase tracking-[0.13em] text-amber-200">No data leakage</p><p className="mt-2 text-xs leading-6 text-neutral-400">Rolling features are shifted before training and evaluation. Final scores, later injuries, closing results, and postgame statistics are unavailable to the row being predicted.</p></div>
            </article>
            <article className="sport-panel p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Daily model update</p><h2 className="mt-2 text-2xl font-black text-white">Fresh state every morning.</h2></div><span className={`rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-[0.13em] ${metrics.refresh?.status === "success" ? "bg-emerald-300/10 text-emerald-200" : "bg-white/[0.05] text-neutral-500"}`}>{metrics.refresh?.status ?? "scheduled"}</span></div>
              <p className="mt-4 text-sm leading-7 text-neutral-400">{metrics.refresh?.mode ?? "Chronological state replay + current player features"}. The daily job refreshes completed results, team form, matchup inputs, Player Picks, and new immutable pregame snapshots.</p>
              <dl className="mt-6 grid grid-cols-2 gap-3 text-xs"><div className="rounded-xl bg-white/[0.03] p-4"><dt className="eyebrow">Schedule</dt><dd className="mt-2 font-bold text-white">{metrics.refresh?.schedule ?? "Daily"}</dd></div><div className="rounded-xl bg-white/[0.03] p-4"><dt className="eyebrow">Last run</dt><dd className="mt-2 font-bold text-white">{metrics.refresh?.lastRunAt ? new Date(metrics.refresh.lastRunAt).toLocaleString() : "Runs after setup"}</dd></div><div className="rounded-xl bg-white/[0.03] p-4"><dt className="eyebrow">Games</dt><dd className="mt-2 font-bold text-white">{metrics.refresh?.gamesRefreshed ?? "—"}</dd></div><div className="rounded-xl bg-white/[0.03] p-4"><dt className="eyebrow">Player picks</dt><dd className="mt-2 font-bold text-white">{metrics.refresh?.playerPicksRefreshed ?? "—"}</dd></div></dl>
              <p className="mt-5 text-xs leading-5 text-neutral-600">Model {metrics.version} · training data {metrics.training_start} through {metrics.trained_through} · holdout log loss {metrics.log_loss.toFixed(3)}</p>
            </article>
          </section>
        </>
      ) : null}
    </main>
  );
}
