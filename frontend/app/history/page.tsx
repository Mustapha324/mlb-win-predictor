import { GameCard } from "@/components/GameCard";

const recentPredictions = [
  {
    awayTeam: "Chicago Cubs",
    homeTeam: "Milwaukee Brewers",
    awayPitcher: "Shota Imanaga",
    homePitcher: "Freddy Peralta",
    awayWinPct: 39,
    homeWinPct: 61,
    gameTime: "Yesterday · Final",
    predictedWinner: "Milwaukee Brewers"
  },
  {
    awayTeam: "Seattle Mariners",
    homeTeam: "Houston Astros",
    awayPitcher: "Luis Castillo",
    homePitcher: "Framber Valdez",
    awayWinPct: 43,
    homeWinPct: 57,
    gameTime: "2 days ago · Final",
    predictedWinner: "Houston Astros"
  },
  {
    awayTeam: "Cleveland Guardians",
    homeTeam: "Minnesota Twins",
    awayPitcher: "Tanner Bibee",
    homePitcher: "Pablo López",
    awayWinPct: 54,
    homeWinPct: 46,
    gameTime: "3 days ago · Final",
    predictedWinner: "Cleveland Guardians"
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
