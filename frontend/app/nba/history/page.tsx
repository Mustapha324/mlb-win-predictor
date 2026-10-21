import { redirect } from "next/navigation";

export default function NbaHistoryPage() {
  redirect("/nba?view=results");
}
