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

function withFallback(value: string | null | undefined, fallback = "TBD"): string {
  return value && value.trim() ? value : fallback;
}

export default async function GameDetailsPage({ params }: GamePageProps) {
  const { id } = await params;
  const game = await getGameById(id);

  if (!game) {
    notFound();
  }

  const awayTeam = withFallback(game.teams?.away, "Unknown Away Team");
  const homeTeam = withFallback(game.teams?.home, "Unknown Home Team");
  const awayPitcher = withFallback(game.probable_pitchers?.away);
  const homePitcher = withFallback(game.probable_pitchers?.home);
  const awayWin = asPercent(game.predicted_probabilities?.away_win);
  const homeWin = asPercent(game.predicted_probabilities?.home_win);
  const predictedWinner =
    game.predicted_probabilities?.home_win >= game.predicted_probabilities?.away_win
      ? homeTeam
      : awayTeam;
  const gameStatus = withFallback(game.actual_result?.status, "Scheduled");

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Game details</h1>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <dl className="grid gap-2 text-slate-900">
          <div>
            <dt className="text-sm text-slate-500">Game date</dt>
            <dd>{withFallback(game.game_time, "Unknown date")}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Away team</dt>
            <dd>{awayTeam}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">Home team</dt>
            <dd>{homeTeam}</dd>
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
            <dt className="text-sm text-slate-500">Game status</dt>
            <dd>{gameStatus}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
