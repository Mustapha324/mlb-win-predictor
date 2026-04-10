import { MetricsCard } from "@/components/MetricsCard";

const metrics = [
  { label: "Model Accuracy", value: "63.4%", trend: "+1.8% vs last 7 days" },
  { label: "Games Predicted", value: "1,248", trend: "102 this week" },
  { label: "Avg Confidence", value: "58.9%", trend: "Stable this month" }
];

export default function MetricsPage() {
  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Model Metrics</h1>
        <p className="mt-2 text-slate-600">Performance signals from the latest prediction windows.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <MetricsCard key={metric.label} {...metric} />
        ))}
      </section>
    </main>
  );
}
