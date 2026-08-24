import "server-only";

/**
 * Venue resolution for the Game Brain: coordinates for weather lookups and
 * whether the game is sheltered from it (dome / closed roof / indoor).
 *
 * MLB venues come from StatsAPI (`roofType`: Open, Dome, Retractable) with
 * coordinates. NFL uses a static stadium table — ESPN exposes an `indoor`
 * flag per event but not coordinates, and stadiums change rarely.
 */

export type VenueContext = {
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** True when weather cannot affect play (dome, fixed roof, retractable assumed closed). */
  sheltered: boolean;
  roofType: string | null;
};

type MlbVenuePayload = {
  venues?: Array<{
    name?: string;
    location?: { defaultCoordinates?: { latitude?: number; longitude?: number } };
    fieldInfo?: { roofType?: string };
  }>;
};

/** NFL home stadiums by ESPN team abbreviation. indoor covers domes, fixed roofs, and retractables (assumed closed). */
const NFL_STADIUMS: Record<string, { name: string; lat: number; lon: number; indoor: boolean }> = {
  ARI: { name: "State Farm Stadium", lat: 33.5276, lon: -112.2626, indoor: true },
  ATL: { name: "Mercedes-Benz Stadium", lat: 33.7554, lon: -84.4008, indoor: true },
  BAL: { name: "M&T Bank Stadium", lat: 39.2779, lon: -76.6227, indoor: false },
  BUF: { name: "Highmark Stadium", lat: 42.7738, lon: -78.787, indoor: false },
  CAR: { name: "Bank of America Stadium", lat: 35.2258, lon: -80.8528, indoor: false },
  CHI: { name: "Soldier Field", lat: 41.8623, lon: -87.6167, indoor: false },
  CIN: { name: "Paycor Stadium", lat: 39.0955, lon: -84.516, indoor: false },
  CLE: { name: "Huntington Bank Field", lat: 41.5061, lon: -81.6995, indoor: false },
  DAL: { name: "AT&T Stadium", lat: 32.7473, lon: -97.0945, indoor: true },
  DEN: { name: "Empower Field at Mile High", lat: 39.7439, lon: -105.02, indoor: false },
  DET: { name: "Ford Field", lat: 42.34, lon: -83.0456, indoor: true },
  GB: { name: "Lambeau Field", lat: 44.5013, lon: -88.0622, indoor: false },
  HOU: { name: "NRG Stadium", lat: 29.6847, lon: -95.4107, indoor: true },
  IND: { name: "Lucas Oil Stadium", lat: 39.7601, lon: -86.1639, indoor: true },
  JAX: { name: "EverBank Stadium", lat: 30.3239, lon: -81.6373, indoor: false },
  KC: { name: "GEHA Field at Arrowhead", lat: 39.0489, lon: -94.4839, indoor: false },
  LAC: { name: "SoFi Stadium", lat: 33.9535, lon: -118.3392, indoor: true },
  LAR: { name: "SoFi Stadium", lat: 33.9535, lon: -118.3392, indoor: true },
  LV: { name: "Allegiant Stadium", lat: 36.0909, lon: -115.1833, indoor: true },
  MIA: { name: "Hard Rock Stadium", lat: 25.958, lon: -80.2389, indoor: false },
  MIN: { name: "U.S. Bank Stadium", lat: 44.9735, lon: -93.2575, indoor: true },
  NE: { name: "Gillette Stadium", lat: 42.0909, lon: -71.2643, indoor: false },
  NO: { name: "Caesars Superdome", lat: 29.951, lon: -90.0812, indoor: true },
  NYG: { name: "MetLife Stadium", lat: 40.8135, lon: -74.0745, indoor: false },
  NYJ: { name: "MetLife Stadium", lat: 40.8135, lon: -74.0745, indoor: false },
  PHI: { name: "Lincoln Financial Field", lat: 39.9008, lon: -75.1675, indoor: false },
  PIT: { name: "Acrisure Stadium", lat: 40.4468, lon: -80.0158, indoor: false },
  SEA: { name: "Lumen Field", lat: 47.5952, lon: -122.3316, indoor: false },
  SF: { name: "Levi's Stadium", lat: 37.403, lon: -121.9702, indoor: false },
  TB: { name: "Raymond James Stadium", lat: 27.9759, lon: -82.5033, indoor: false },
  TEN: { name: "Nissan Stadium", lat: 36.1665, lon: -86.7713, indoor: false },
  WSH: { name: "Northwest Stadium", lat: 38.9077, lon: -76.8645, indoor: false }
};

export async function getMlbVenueContext(venueId: number | null, venueName: string | null): Promise<VenueContext> {
  const fallback: VenueContext = { name: venueName ?? "Unknown venue", latitude: null, longitude: null, sheltered: false, roofType: null };
  if (!venueId) return fallback;
  try {
    const response = await fetch(`https://statsapi.mlb.com/api/v1/venues/${venueId}?hydrate=location,fieldInfo`, {
      next: { revalidate: 86400 },
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return fallback;
    const payload = (await response.json()) as MlbVenuePayload;
    const venue = payload.venues?.[0];
    if (!venue) return fallback;
    const roofType = venue.fieldInfo?.roofType ?? null;
    return {
      name: venue.name ?? fallback.name,
      latitude: venue.location?.defaultCoordinates?.latitude ?? null,
      longitude: venue.location?.defaultCoordinates?.longitude ?? null,
      // Retractable roofs close for bad weather, which is exactly when the brain would react.
      sheltered: roofType !== null && roofType !== "Open",
      roofType
    };
  } catch {
    return fallback;
  }
}

export function getNflVenueContext(homeTeamAbbreviation: string, venueName: string | null, indoorFlag?: boolean): VenueContext {
  const stadium = NFL_STADIUMS[homeTeamAbbreviation.toUpperCase()];
  if (!stadium) {
    return { name: venueName ?? "Unknown venue", latitude: null, longitude: null, sheltered: indoorFlag ?? false, roofType: null };
  }
  return {
    name: venueName ?? stadium.name,
    latitude: stadium.lat,
    longitude: stadium.lon,
    sheltered: indoorFlag ?? stadium.indoor,
    roofType: stadium.indoor ? "Indoor" : "Open"
  };
}
