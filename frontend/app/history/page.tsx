import { GameCard } from "@/components/GameCard";
import { historicalPredictions } from "@/lib/mockData";

export default function HistoryPage() {
  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Prediction History</h1>
        <p className="mt-2 text-slate-600">A quick look at recent model outputs and confidence levels.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {historicalPredictions.map((game) => (
          <GameCard key={`${game.awayTeamName}-${game.homeTeamName}`} {...game} />
        ))}
      </section>
    </main>
  );
}
