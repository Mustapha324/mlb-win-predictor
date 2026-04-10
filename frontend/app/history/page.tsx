import { GameCard } from "@/components/GameCard";

const recentPredictions = [
  {
    awayTeam: "Chicago Cubs",
    homeTeam: "Milwaukee Brewers",
    gameTime: "Yesterday · Final",
    predictedWinner: "Milwaukee Brewers",
    confidence: 61
  },
  {
    awayTeam: "Seattle Mariners",
    homeTeam: "Houston Astros",
    gameTime: "2 days ago · Final",
    predictedWinner: "Houston Astros",
    confidence: 57
  },
  {
    awayTeam: "Cleveland Guardians",
    homeTeam: "Minnesota Twins",
    gameTime: "3 days ago · Final",
    predictedWinner: "Cleveland Guardians",
    confidence: 54
  }
];

export default function HistoryPage() {
  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Prediction History</h1>
        <p className="mt-2 text-slate-600">A quick look at recent model outputs and confidence levels.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {recentPredictions.map((game) => (
          <GameCard key={`${game.awayTeam}-${game.homeTeam}`} {...game} />
        ))}
      </section>
    </main>
  );
}
