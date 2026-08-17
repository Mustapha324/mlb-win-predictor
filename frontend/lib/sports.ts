export type Sport = "mlb" | "nfl";

export type SportConfig = {
  id: Sport;
  name: string;
  shortName: string;
  scheduleLabel: string;
  accent: string;
  accentSoft: string;
  homeHref: string;
  historyHref: string;
  metricsHref: string;
};

export const APP_NAME = "Sport IQ";

export const SPORTS: Record<Sport, SportConfig> = {
  mlb: {
    id: "mlb",
    name: "Major League Baseball",
    shortName: "MLB",
    scheduleLabel: "Today's games",
    accent: "#22d3ee",
    accentSoft: "rgba(34, 211, 238, .12)",
    homeHref: "/",
    historyHref: "/history",
    metricsHref: "/metrics"
  },
  nfl: {
    id: "nfl",
    name: "National Football League",
    shortName: "NFL",
    scheduleLabel: "This week's games",
    accent: "#a3e635",
    accentSoft: "rgba(163, 230, 53, .12)",
    homeHref: "/nfl",
    historyHref: "/nfl/history",
    metricsHref: "/nfl/metrics"
  }
};

export function isSport(value: string): value is Sport {
  return value === "mlb" || value === "nfl";
}

export function sportFromPath(pathname: string): Sport {
  return pathname === "/nfl" || pathname.startsWith("/nfl/") ? "nfl" : "mlb";
}
