import { GameCard } from "@/components/GameCard";

const mockGames = [
  {
    awayTeam: "New York Yankees",
    homeTeam: "Boston Red Sox",
    gameTime: "7:05 PM ET",
    predictedWinner: "New York Yankees",
    confidence: 62
  },
  {
    awayTeam: "Los Angeles Dodgers",
    homeTeam: "San Diego Padres",
    gameTime: "9:40 PM ET",
    predictedWinner: "Los Angeles Dodgers",
    confidence: 58
  },
  {
    awayTeam: "Atlanta Braves",
    homeTeam: "Philadelphia Phillies",
    gameTime: "6:45 PM ET",
    predictedWinner: "Philadelphia Phillies",
    confidence: 55
  }
];

export default function Home() {
  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Today&apos;s MLB Predictions
        </h1>
        <p className="mt-2 text-slate-600">Three featured model picks for today&apos;s slate.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {mockGames.map((game) => (
          <GameCard key={`${game.awayTeam}-${game.homeTeam}`} {...game} />
        ))}
      </section>
    </main>
  );
}
