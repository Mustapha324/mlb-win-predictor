import { GameCard } from "@/components/GameCard";
import { featuredPredictions } from "@/lib/mockData";

export default function HomePage() {
  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Today&apos;s MLB Predictions</h1>
        <p className="mt-2 text-slate-600">Three featured model picks for today&apos;s slate.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {featuredPredictions.map((game) => (
          <GameCard key={`${game.awayTeamName}-${game.homeTeamName}`} {...game} />
        ))}
      </section>
    </main>
  );
}
