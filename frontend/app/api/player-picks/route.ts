import { getPlayerPicks } from "@/lib/server/playerPicks";
import { getNbaPlayerPicks } from "@/lib/server/nbaPlayerPicks";
import { isValidPickDate } from "@/lib/server/playerPickScoring";
import { isSport } from "@/lib/sports";

function easternToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const requestedSport = query.get("sport") ?? "mlb";
  if (!isSport(requestedSport) && requestedSport !== "nba") return Response.json({ error: "Unsupported sport." }, { status: 400 });
  const sport = requestedSport;
  const date = query.get("date") ?? easternToday();
  if (!isValidPickDate(date)) return Response.json({ error: "Use a valid date in YYYY-MM-DD format." }, { status: 400 });
  try {
    return Response.json(await (sport === "nba" ? getNbaPlayerPicks(date) : getPlayerPicks(sport, date)), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return Response.json({ error: "Player picks are temporarily unavailable." }, { status: 503, headers: { "Retry-After": "30" } });
  }
}
