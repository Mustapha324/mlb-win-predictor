import "server-only";
import { NFL_STADIUMS } from "@/lib/server/brain/nflStadiums";

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
