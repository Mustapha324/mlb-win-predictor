import { notFound } from "next/navigation";
import { getGameById, summarizeLeanFactors } from "@/lib/games";

type GamePageProps = {
  params: Promise<{ id: string }>;
};

function formatFeatureValue(value: number | string | null): string {
  if (value === null) {
    return "N/A";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toString() : value.toFixed(2);
  }
  return value;
}

export default async function GameDetailsPage({ params }: GamePageProps) {
  const { id } = await params;
  const game = await getGameById(id);

  if (!game) {
    notFound();
  }

  const leanFactors = summarizeLeanFactors(game.feature_values);

  return (
    <main className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          {game.teams.away} @ {game.teams.home}
        </h1>
        <p className="text-sm text-slate-600">Game ID: {game.game_id}</p>
      </header>

      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Teams</h2>
          <p className="mt-2 text-slate-900">Away: {game.teams.away}</p>
          <p className="text-slate-900">Home: {game.teams.home}</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Probable pitchers</h2>
          <p className="mt-2 text-slate-900">Away: {game.probable_pitchers.away}</p>
          <p className="text-slate-900">Home: {game.probable_pitchers.home}</p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Predicted probabilities
        </h2>
        <p className="mt-2 text-slate-900">{game.teams.away}: {(game.predicted_probabilities.away_win * 100).toFixed(1)}%</p>
        <p className="text-slate-900">{game.teams.home}: {(game.predicted_probabilities.home_win * 100).toFixed(1)}%</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Actual result</h2>
        {!game.actual_result || game.actual_result.status !== "final" ? (
          <p className="mt-2 text-slate-700">Game not final yet.</p>
        ) : (
          <div className="mt-2 space-y-1 text-slate-900">
            <p>Winner: {game.actual_result.winner}</p>
            <p>
              Final score: {game.teams.away} {game.actual_result.away_runs} - {game.teams.home}{" "}
              {game.actual_result.home_runs}
            </p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Feature values used</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {Object.entries(game.feature_values).map(([feature, value]) => (
            <div key={feature} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{feature}</p>
              <p className="text-sm text-slate-900">{formatFeatureValue(value)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Why the model leaned this way
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          This is a plain summary of large input feature differences, not a causal or SHAP-style explanation.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-900">
          {leanFactors.map((factor) => (
            <li key={factor}>{factor}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
