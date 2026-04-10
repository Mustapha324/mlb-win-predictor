type GameCardProps = {
  awayTeam: string;
  homeTeam: string;
  gameTime: string;
  predictedWinner: string;
  confidence: number;
};

export function GameCard({
  awayTeam,
  homeTeam,
  gameTime,
  predictedWinner,
  confidence
}: GameCardProps) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{gameTime}</p>
        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
          {confidence}% confidence
        </span>
      </div>
      <div className="space-y-1">
        <p className="text-lg font-semibold text-slate-900">{awayTeam}</p>
        <p className="text-sm text-slate-400">@</p>
        <p className="text-lg font-semibold text-slate-900">{homeTeam}</p>
      </div>
      <p className="mt-4 text-sm text-slate-600">
        Model pick: <span className="font-semibold text-slate-900">{predictedWinner}</span>
      </p>
    </article>
  );
}
