import { HistoryView } from "@/components/HistoryView";

export const metadata = { title: "MLB prediction history" };

export default function HistoryPage() {
  return <HistoryView sport="mlb" />;
}
