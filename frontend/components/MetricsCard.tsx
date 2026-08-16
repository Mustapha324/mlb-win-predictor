type MetricsCardProps = { label: string; value: string; trend?: string; accent?: boolean };

export function MetricsCard({ label, value, trend, accent = false }: MetricsCardProps) {
  return (
    <article className={`rounded-[22px] border p-5 ${accent ? "border-cyan-300/20 bg-cyan-300/[0.055]" : "border-white/[0.08] bg-[#0c1120]"}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-slate-500">{label}</p>
      <p className={`mt-2 font-mono text-3xl font-black tracking-tight ${accent ? "text-cyan-300" : "text-white"}`}>{value}</p>
      {trend ? <p className="mt-2 text-xs leading-5 text-slate-500">{trend}</p> : null}
    </article>
  );
}
