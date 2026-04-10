type MetricsCardProps = {
  label: string;
  value: string;
  trend: string;
};

export function MetricsCard({ label, value, trend }: MetricsCardProps) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-2 text-sm text-sky-700">{trend}</p>
    </article>
  );
}
