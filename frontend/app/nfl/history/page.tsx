import { HistoryView } from "@/components/HistoryView";

export const metadata = { title: "NFL prediction history" };

export default function NflHistoryPage() {
  return <HistoryView sport="nfl" />;
}
