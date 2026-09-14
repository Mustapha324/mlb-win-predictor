import { PlayerPicksSection } from "@/components/PlayerPicksSection";
import Link from "next/link";
export const metadata = { title: "Player Picks" };
export default async function Page({ searchParams }: { searchParams: Promise<{ sport?: string }> }) {
  const { sport: input } = await searchParams;
  const sport = input === "nfl" ? "nfl" : "mlb";
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  return <main><div className="mb-6 flex gap-3"><Link className="secondary-button" href="/player-picks?sport=mlb" aria-current={sport === "mlb" ? "page" : undefined}>MLB</Link><Link className="secondary-button" href="/player-picks?sport=nfl" aria-current={sport === "nfl" ? "page" : undefined}>NFL</Link></div><PlayerPicksSection key={sport} sport={sport} date={date} /></main>;
}
