"use client";

import { useEffect, useState } from "react";

import { MetricsCard } from "@/components/MetricsCard";
import { getErrorMessage, getModelMetrics, type ModelMetricsResponse } from "@/lib/api";

type MetricCardItem = {
  label: string;
  value: string;
  trend: string;
};

function toPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function buildMetricCards(metrics: ModelMetricsResponse): MetricCardItem[] {
  const parsedDate = metrics.last_trained_at ? new Date(metrics.last_trained_at) : null;
  const lastTrainedLabel =
    parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString() : "Unavailable";

  const cards: MetricCardItem[] = [
    {
      label: "Model",
      value: metrics.model_name,
      trend: `Version ${metrics.version}`
    },
    {
      label: "Predictions Evaluated",
      value: metrics.total_predictions_evaluated.toLocaleString(),
      trend: "Total games in the latest evaluation set"
    },
    {
      label: "Correct Predictions",
      value: metrics.correct_predictions.toLocaleString(),
      trend: "Correct winner picks in evaluation"
    },
    {
      label: "Accuracy",
      value: toPercent(metrics.accuracy),
      trend: "Overall prediction accuracy"
    },
    ...(metrics.brier_score !== null
      ? [
          {
            label: "Brier Score",
            value: metrics.brier_score.toFixed(4),
            trend: "Lower is better"
          }
        ]
      : []),
    ...(metrics.precision !== null
      ? [
          {
            label: "Precision",
            value: toPercent(metrics.precision),
            trend: "Positive prediction quality"
          }
        ]
      : []),
    ...(metrics.recall !== null
      ? [
          {
            label: "Recall",
            value: toPercent(metrics.recall),
            trend: "Coverage of positive outcomes"
          }
        ]
      : []),
    ...(metrics.roc_auc !== null
      ? [
          {
            label: "ROC AUC",
            value: toPercent(metrics.roc_auc),
            trend: "Model ranking performance"
          }
        ]
      : []),
    {
      label: "Last Trained",
      value: lastTrainedLabel,
      trend: "Most recent training run"
    }
  ];

  return cards;
}

export default function MetricsPage() {
  const [cards, setCards] = useState<MetricCardItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        setLoading(true);
        setError(null);

        const metrics = await getModelMetrics();
        setCards(buildMetricCards(metrics));
      } catch (err) {
        setError(getErrorMessage(err, "Unable to load model metrics."));
      } finally {
        setLoading(false);
      }
    };

    void loadMetrics();
  }, []);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Model Metrics</h1>
        <p className="mt-2 text-slate-600">Live performance metrics from the FastAPI backend.</p>
      </header>

      {loading && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 text-slate-600 shadow-sm">
          Loading model metrics...
        </section>
      )}

      {error && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-700 shadow-sm">{error}</section>
      )}

      {!loading && !error && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((metric) => (
            <MetricsCard key={metric.label} {...metric} />
          ))}
        </section>
      )}
    </main>
  );
}
