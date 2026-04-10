import { GameCard } from "@/components/GameCard";
import { getFeaturedGames } from "@/lib/games";

export default async function Home() {
  const games = await getFeaturedGames();

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Today&apos;s MLB Predictions
        </h1>
        <p className="mt-2 text-slate-600">Featured model picks with expanded game-level context.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {games.map((game) => {
          const confidence = Math.round(
            Math.max(game.predicted_probabilities.away_win, game.predicted_probabilities.home_win) * 100
          );
          const predictedWinner =
            game.predicted_probabilities.away_win >= game.predicted_probabilities.home_win
              ? game.teams.away
              : game.teams.home;

          return (
            <GameCard
              key={game.game_id}
              gameId={game.game_id}
              awayTeam={game.teams.away}
              homeTeam={game.teams.home}
              gameTime={new Date(game.game_time).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short"
              })}
              predictedWinner={predictedWinner}
              confidence={confidence}
            />
          );
        })}
      </section>
    </main>
  );
}
