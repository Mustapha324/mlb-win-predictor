import { GameCard } from "@/components/GameCard";

const mockGames = [
  {
    awayTeam: "New York Yankees",
    homeTeam: "Boston Red Sox",
    awayPitcher: "Gerrit Cole",
    homePitcher: "Brayan Bello",
    awayWinPct: 62,
    homeWinPct: 38,
    gameTime: "7:05 PM ET",
    predictedWinner: "New York Yankees"
  },
  {
    awayTeam: "Los Angeles Dodgers",
    homeTeam: "San Diego Padres",
    awayPitcher: "Tyler Glasnow",
    homePitcher: "Joe Musgrove",
    awayWinPct: 58,
    homeWinPct: 42,
    gameTime: "9:40 PM ET",
    predictedWinner: "Los Angeles Dodgers"
  },
  {
    awayTeam: "Atlanta Braves",
    homeTeam: "Philadelphia Phillies",
    awayPitcher: "Max Fried",
    homePitcher: "Zack Wheeler",
    awayWinPct: 45,
    homeWinPct: 55,
    gameTime: "6:45 PM ET",
    predictedWinner: "Philadelphia Phillies"
  }
];

export default function Home() {
  return (
    <main className="space-y-8">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          MLB Forecast Dashboard
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
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
