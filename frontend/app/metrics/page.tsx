"use client";

import { useCallback, useEffect, useState } from "react";

import { MetricsCard } from "@/components/MetricsCard";
import {
  getErrorMessage,
  getModelMetrics,
  getPredictionHistory,
  syncCompletedResults,
  type ModelMetricsResponse
} from "@/lib/api";

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

  const cards: MetricCardItem[] = [];

  if (metrics.model_name) {
    cards.push({
      label: "Model",
      value: metrics.model_name,
      trend: metrics.version ? `Version ${metrics.version}` : "Version unavailable"
    });
  }

  if (metrics.total_predictions_evaluated !== null) {
    cards.push({
      label: "Predictions Evaluated",
      value: metrics.total_predictions_evaluated.toLocaleString(),
      trend: "Total games in the latest evaluation set"
    });
  }

  if (metrics.correct_predictions !== null) {
    cards.push({
      label: "Correct Predictions",
      value: metrics.correct_predictions.toLocaleString(),
      trend: "Correct winner picks in evaluation"
    });
  }

  if (metrics.accuracy !== null) {
    cards.push({
      label: "Accuracy",
      value: toPercent(metrics.accuracy),
      trend: "Overall prediction accuracy"
    });
  }

  cards.push(
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
      : [])
  );

  if (metrics.last_trained_at !== null) {
    cards.push({
      label: "Last Trained",
      value: lastTrainedLabel,
      trend: "Most recent training run"
    });
  }

  return cards;
}

export default function MetricsPage() {
  const [cards, setCards] = useState<MetricCardItem[]>([]);
  const [availabilityMessage, setAvailabilityMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setAvailabilityMessage(null);

      const metrics = await getModelMetrics();
      if (!metrics.available) {
        setCards([]);
        setAvailabilityMessage(metrics.message ?? "Model metrics are currently unavailable.");
        return;
      }

      setCards(buildMetricCards(metrics));
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load model metrics."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const handleSyncCompletedResults = useCallback(async () => {
    try {
      setIsSyncing(true);
      setSyncError(null);
      setSyncMessage(null);

      const update = await syncCompletedResults();
      const history = await getPredictionHistory();
      await loadMetrics();

      setSyncMessage(
        `Sync complete: updated ${update.updated_predictions} games. History records: ${history.length}.`
      );
    } catch (err) {
      setSyncError(getErrorMessage(err, "Failed to sync completed results."));
    } finally {
      setIsSyncing(false);
    }
  }, [loadMetrics]);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Model Metrics</h1>
        <p className="mt-2 text-slate-600">Live performance metrics from the FastAPI backend.</p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSyncCompletedResults()}
            disabled={isSyncing}
            className="rounded-md border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSyncing ? "Syncing..." : "Sync Completed Results"}
          </button>
          {syncMessage && <p className="text-sm text-emerald-700">{syncMessage}</p>}
          {syncError && <p className="text-sm text-rose-700">{syncError}</p>}
        </div>
      </section>

      {loading && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 text-slate-600 shadow-sm">
          Loading model metrics...
        </section>
      )}

      {error && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-700 shadow-sm">{error}</section>
      )}

      {!loading && !error && availabilityMessage && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 text-slate-700 shadow-sm">
          {availabilityMessage}
        </section>
      )}

      {!loading && !error && cards.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((metric) => (
            <MetricsCard key={metric.label} {...metric} />
          ))}
        </section>
      )}
    </main>
  );
}
