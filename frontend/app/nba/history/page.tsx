import { HistoryView } from "@/components/HistoryView";
import { PlayerPicksSection } from "@/components/PlayerPicksSection";

export const metadata = { title: "NBA prediction and player-pick results" };
export const dynamic = "force-dynamic";

export default function NbaHistoryPage() {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return <><HistoryView sport="nba" /><PlayerPicksSection sport="nba" date={date} initialView="results" /></>;
}
