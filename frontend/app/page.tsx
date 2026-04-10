"use client";

import { useEffect, useState } from "react";

import { GameCard } from "@/components/GameCard";
import { getErrorMessage, getTodayPredictions, type TeamPrediction } from "@/lib/api";

function toGameTimeLabel(dateLabel: string, gameTimeUtc?: string | null): string {
  if (!gameTimeUtc) {
    return `${dateLabel} · Scheduled`;
  }

  const parsedDate = new Date(gameTimeUtc);
  if (Number.isNaN(parsedDate.getTime())) {
    return `${dateLabel} · Scheduled`;
  }

  return parsedDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });
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
        setError(getErrorMessage(err, "Unable to load today's predictions."));
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
                gameId={game.game_id}
                awayTeam={game.away_team}
                homeTeam={game.home_team}
                awayPitcher={game.away_probable_pitcher}
                homePitcher={game.home_probable_pitcher}
                awayWinPct={game.away_win_probability}
                homeWinPct={game.home_win_probability}
                gameTime={toGameTimeLabel(dateLabel, game.game_time_utc)}
                predictedWinner={game.predicted_winner}
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
