import { MetricsCard } from "@/components/MetricsCard";

type CumulativeAccuracyPoint = {
  date: string;
  accuracy: number;
};

type ModelMetricsResponse = {
  total_predictions_evaluated: number;
  correct_predictions: number;
  accuracy: number;
  brier_score: number;
  model_version: string;
  cumulative_accuracy: CumulativeAccuracyPoint[];
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api";

function toPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function toBrier(value: number): string {
  return value.toFixed(3);
}

function buildLinePath(points: CumulativeAccuracyPoint[]): string {
  const width = 800;
  const height = 260;
  const padding = 28;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  return points
    .map((point, index) => {
      const x = padding + (index / (points.length - 1)) * innerWidth;
      const y = padding + (1 - point.accuracy) * innerHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

async function getMetrics(): Promise<ModelMetricsResponse | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/metrics`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as ModelMetricsResponse;
  } catch {
    return null;
  }
}

export default async function MetricsPage() {
  const metrics = await getMetrics();
  const cumulativeAccuracy = metrics?.cumulative_accuracy ?? [];
  const hasChartData = cumulativeAccuracy.length >= 2;

  const metricCards = [
    {
      label: "Total Predictions Evaluated",
      value: metrics ? metrics.total_predictions_evaluated.toLocaleString() : "—"
    },
    {
      label: "Correct Predictions",
      value: metrics ? metrics.correct_predictions.toLocaleString() : "—"
    },
    {
      label: "Accuracy",
      value: metrics ? toPercent(metrics.accuracy) : "—"
    },
    {
      label: "Brier Score",
      value: metrics ? toBrier(metrics.brier_score) : "—"
    },
    {
      label: "Current Model Version",
      value: metrics?.model_version ?? "—"
    }
  ];

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Model Metrics</h1>
        <p className="mt-2 text-slate-600">Live model performance pulled from the backend.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {metricCards.map((metric) => (
          <MetricsCard key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Cumulative Accuracy Over Time</h2>

        {hasChartData ? (
          <div className="mt-4">
            <svg
              viewBox="0 0 800 260"
              role="img"
              aria-label="Line chart showing cumulative model accuracy over time"
              className="h-64 w-full"
            >
              <path d={buildLinePath(cumulativeAccuracy)} fill="none" stroke="currentColor" strokeWidth="3" className="text-sky-600" />
            </svg>
            <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-500">
              <span>{cumulativeAccuracy[0]?.date}</span>
              <span>→</span>
              <span>{cumulativeAccuracy[cumulativeAccuracy.length - 1]?.date}</span>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-slate-600">
            We&apos;re still collecting evaluated predictions. Check back soon for a cumulative accuracy trend line.
          </p>
        )}
      </section>
    </main>
  );
}
