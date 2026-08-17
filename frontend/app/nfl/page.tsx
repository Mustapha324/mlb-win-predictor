import { Dashboard } from "@/components/Dashboard";

export const metadata = { title: "NFL predictions" };

export default function NflHomePage() {
  return <Dashboard sport="nfl" />;
}
