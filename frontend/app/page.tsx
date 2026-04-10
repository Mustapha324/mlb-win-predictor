"use client";

import { useEffect, useState } from "react";

import { GameCard } from "@/components/GameCard";
import { getTodayPredictions, type TeamPrediction } from "@/lib/api";

function toGameTimeLabel(apiDate: string): string {
  return `${apiDate} · Scheduled`;
}

export default function Home() {
  const [games, setGames] = useState<TeamPrediction[]>([]);
  const [dateLabel, setDateLabel] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadGames = async () => {
      try {
        setLoading(true);
        setError(null);

        const data = await getTodayPredictions();

        setGames(data.predictions);
        setDateLabel(data.date);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(`Unable to load today's predictions. ${message}`);
      } finally {
        setLoading(false);
      }
    };

    void loadGames();
  }, []);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Today&apos;s MLB Predictions</h1>
        <p className="mt-2 text-slate-600">Live model picks from the FastAPI backend.</p>
      </header>

      {loading && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 text-slate-600 shadow-sm">
          Loading today&apos;s predictions...
        </section>
      )}

      {error && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-700 shadow-sm">{error}</section>
      )}

      {!loading && !error && (
        <>
          {dateLabel && <p className="text-sm text-slate-500">Date: {dateLabel}</p>}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {games.map((game) => (
              <GameCard
                key={game.game_id}
                awayTeam={game.away_team}
                homeTeam={game.home_team}
                gameTime={toGameTimeLabel(dateLabel)}
                predictedWinner={game.predicted_winner}
                confidence={Math.round(game.win_probability * 100)}
              />
            ))}
          </section>

          {games.length === 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 text-slate-600 shadow-sm">
              No games returned for today.
            </section>
          )}
        </>
      )}
    </main>
  );
}
