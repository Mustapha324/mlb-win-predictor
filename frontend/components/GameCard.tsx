import Link from "next/link";

type GameCardProps = {
  gameId: string;
  awayTeam: string;
  homeTeam: string;
  awayPitcher: string;
  homePitcher: string;
  awayWinPct: number;
  homeWinPct: number;
  gameTime: string;
  predictedWinner: string;
};

/** Card showing one model prediction for a single game matchup. */
export function GameCard({
  gameId,
  awayTeam,
  homeTeam,
  awayPitcher,
  homePitcher,
  awayWinPct,
  homeWinPct,
  gameTime,
  predictedWinner
}: GameCardProps) {
  const confidence = Math.max(awayWinPct, homeWinPct);
  const predictedWinnerTeam =
    predictedWinner || (homeWinPct >= awayWinPct ? homeTeam : awayTeam);

  const confidenceLabel =
    confidence <= 56 ? "Low" : confidence <= 64 ? "Medium" : "High";

  const confidenceStyles =
    confidenceLabel === "High"
      ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
      : confidenceLabel === "Medium"
        ? "bg-amber-100 text-amber-700 ring-amber-200"
        : "bg-slate-200 text-slate-700 ring-slate-300";

  return (
    <article className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4 flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{gameTime}</p>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${confidenceStyles}`}
        >
          {confidenceLabel} confidence
        </span>
      </div>

      <div className="space-y-1.5">
        <p className="text-base font-semibold text-slate-900">
          {awayTeam} at {homeTeam}
        </p>
        <p className="text-sm text-slate-600">
          Probable pitchers:{" "}
          <span className="font-medium text-slate-800">
            {awayPitcher} vs {homePitcher}
          </span>
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Away win</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{awayWinPct}%</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Home win</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{homeWinPct}%</p>
        </div>
      </div>

      <p className="mt-4 text-sm text-slate-600">
        Model pick: <span className="font-semibold text-slate-900">{predictedWinnerTeam}</span>
      </p>
      <Link
        href={`/games/${gameId}`}
        className="mt-4 inline-block text-sm font-medium text-blue-700 hover:text-blue-900"
      >
        View game details →
      </Link>
    </article>
  );
}
