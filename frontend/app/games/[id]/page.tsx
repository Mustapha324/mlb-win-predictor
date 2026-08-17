import { GameDetailsView } from "@/components/GameDetailsView";

export default async function GameDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameDetailsView id={id} sport="mlb" />;
}
