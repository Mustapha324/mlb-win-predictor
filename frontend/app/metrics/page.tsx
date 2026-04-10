import { MetricsCard } from "@/components/MetricsCard";
import { dashboardMetrics } from "@/lib/mockData";

export default function MetricsPage() {
  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Model Metrics</h1>
        <p className="mt-2 text-slate-600">Performance signals from the latest prediction windows.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {dashboardMetrics.map((metric) => (
          <MetricsCard key={metric.metricLabel} {...metric} />
        ))}
      </section>
    </main>
  );
}
