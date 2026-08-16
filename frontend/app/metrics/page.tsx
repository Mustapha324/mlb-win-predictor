"use client";

import { useEffect, useState } from "react";
import { MetricsCard } from "@/components/MetricsCard";
import { getErrorMessage, getModelMetrics, type ModelMetricsResponse } from "@/lib/api";

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<ModelMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getModelMetrics().then(setMetrics).catch((requestError) => setError(getErrorMessage(requestError, "Unable to load model metrics.")));
  }, []);

  return (
    <main>
      <header className="max-w-4xl border-b border-white/[0.08] pb-8">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">Transparent by design</p>
        <h1 className="mt-2 text-4xl font-black uppercase tracking-[-0.045em] text-white sm:text-6xl">Inside the model.</h1>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-500">No mystery accuracy claims. The main score below comes from an untouched 2025 holdout after the model was tuned on earlier seasons.</p>
      </header>

      {error ? <section className="mt-6 rounded-[22px] border border-rose-300/20 bg-rose-300/[0.06] p-6 text-rose-100">{error}</section> : null}
      {!metrics && !error ? <section className="mt-6 h-48 animate-pulse rounded-[24px] bg-white/[0.025]" /> : null}

      {metrics ? (
        <>
          <section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricsCard label="Holdout accuracy" value={`${(metrics.accuracy * 100).toFixed(1)}%`} trend={`${metrics.correct_predictions.toLocaleString()} of ${metrics.total_predictions_evaluated.toLocaleString()} games correct`} accent />
            <MetricsCard label="Home baseline" value={`${(metrics.majority_baseline_accuracy * 100).toFixed(1)}%`} trend="Accuracy from simply choosing every home team" />
            <MetricsCard label="Brier score" value={metrics.brier_score.toFixed(3)} trend="Probability error; lower is better" />
            <MetricsCard label="Training games" value={metrics.total_training_examples.toLocaleString()} trend={`${metrics.seasons[0]}–${metrics.seasons.at(-1)} regular seasons`} />
          </section>

          <section className="mt-7 grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
            <article className="rounded-[24px] border border-white/[0.08] bg-[#0c1120] p-6 sm:p-8">
              <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-slate-600">How it works</p>
              <h2 className="mt-2 text-2xl font-black text-white">Chronological, not random.</h2>
              <p className="mt-4 text-sm leading-7 text-slate-400">{metrics.description}</p>
              <div className="mt-6 space-y-4">
                {[
                  ["01", "Baseline", "Five complete seasons establish durable team strength without peeking ahead."],
                  ["02", "Replay", "The current season is replayed in order so every game only sees earlier results."],
                  ["03", "Game day", "Probable-starter ERA and WHIP make a small, reliability-weighted adjustment."],
                  ["04", "Calibration", "Probabilities are capped to avoid false certainty in a high-variance sport."]
                ].map(([number, title, description]) => (
                  <div key={number} className="grid grid-cols-[36px_1fr] gap-3 border-t border-white/[0.06] pt-4">
                    <span className="font-mono text-xs font-black text-cyan-300">{number}</span>
                    <div><p className="text-sm font-bold text-white">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-[24px] border border-white/[0.08] bg-[#0c1120] p-6 sm:p-8">
              <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-slate-600">Signals used</p>
              <h2 className="mt-2 text-2xl font-black text-white">Six compact inputs.</h2>
              <div className="mt-6 flex flex-wrap gap-2">
                {metrics.features.map((feature) => <span key={feature} className="rounded-full border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-xs font-semibold text-slate-300">{feature.replaceAll("_", " ")}</span>)}
              </div>
              <div className="mt-8 rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-5">
                <p className="text-xs font-black uppercase tracking-[0.13em] text-amber-200">Important limitation</p>
                <p className="mt-2 text-xs leading-6 text-slate-400">A 56% baseball model still misses often. Lineups, weather, bullpen availability, injuries, and market information are not fully modeled. Use probabilities as context, never certainty.</p>
              </div>
              <p className="mt-6 text-xs text-slate-600">Model {metrics.version} · training data {metrics.training_start} through {metrics.trained_through}</p>
            </article>
          </section>
        </>
      ) : null}
    </main>
  );
}
