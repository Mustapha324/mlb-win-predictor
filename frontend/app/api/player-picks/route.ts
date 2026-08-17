import { getServerAccess } from "@/lib/server/access";
import { getPlayerPicks } from "@/lib/server/playerPicks";

function easternToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const sport = query.get("sport") === "nfl" ? "nfl" : "mlb";
  const date = query.get("date") ?? easternToday();
  try {
    const access = await getServerAccess();
    return Response.json(await getPlayerPicks(sport, date, access), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load player picks.";
    return Response.json({ error: message }, { status: 503 });
  }
}
