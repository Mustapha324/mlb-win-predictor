import type { DashboardMetricCardData } from "@/lib/types";

/** Card showing one aggregate model performance metric. */
export function MetricsCard({ metricLabel, metricValue, metricTrend }: DashboardMetricCardData) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{metricLabel}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{metricValue}</p>
      <p className="mt-2 text-sm text-sky-700">{metricTrend}</p>
    </article>
  );
}
