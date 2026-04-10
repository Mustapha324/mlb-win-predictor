import { notFound } from "next/navigation";
import { getGameById } from "@/lib/games";

type GamePageProps = {
  params: Promise<{ id: string }>;
};

function asPercent(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "N/A";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function asBattingAverage(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "N/A";
  }

  return value.toFixed(3).replace(/^0/, "");
}

function asEra(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "N/A";
  }

  return value.toFixed(2);
}

function withFallback(value: string | null | undefined, fallback = "TBD"): string {
  return value && value.trim() ? value : fallback;
}

export default async function GameDetailsPage({ params }: GamePageProps) {
  const { id } = await params;
  const game = await getGameById(id);

  if (!game) {
    notFound();
  }

  const awayTeam = withFallback(game.awayTeam, "Unknown Away Team");
  const homeTeam = withFallback(game.homeTeam, "Unknown Home Team");
  const awayPitcher = withFallback(game.awayProbablePitcher, "N/A");
  const homePitcher = withFallback(game.homeProbablePitcher, "N/A");
  const awayWin = asPercent(game.awayWinProbability);
  const homeWin = asPercent(game.homeWinProbability);
  const predictedWinner = withFallback(game.predictedWinner, "N/A");
  const gameStatus = withFallback(game.status, "Scheduled");

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Game details</h1>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <dl className="grid gap-2 text-slate-900">
          <div>
            <dt className="text-sm text-slate-500">Matchup</dt>
            <dd>
              {awayTeam} at {homeTeam}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Date</dt>
            <dd>{withFallback(game.date, "Unknown date")}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Status</dt>
            <dd>{gameStatus}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Probable pitchers</dt>
            <dd>
              {awayPitcher} vs {homePitcher}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Away win probability</dt>
            <dd>{awayWin}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Home win probability</dt>
            <dd>{homeWin}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Predicted winner</dt>
            <dd>{predictedWinner}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Team records</dt>
            <dd>
              {awayTeam}: {withFallback(game.awayTeamRecord, "N/A")} · {homeTeam}:{" "}
              {withFallback(game.homeTeamRecord, "N/A")}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Team batting average</dt>
            <dd>
              {awayTeam}: {asBattingAverage(game.awayTeamBattingAverage)} · {homeTeam}:{" "}
              {asBattingAverage(game.homeTeamBattingAverage)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Team ERA</dt>
            <dd>
              {awayTeam}: {asEra(game.awayTeamEra)} · {homeTeam}: {asEra(game.homeTeamEra)}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
