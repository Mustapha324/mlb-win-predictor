import "server-only";
import type { WeatherSnapshot } from "@/lib/server/brain/brainScoring";
import type { VenueContext } from "@/lib/server/brain/venues";

/**
 * Game-hour weather via Open-Meteo (free, keyless, hourly resolution).
 * Returns null for sheltered venues, missing coordinates, or fetch failures —
 * the brain treats null as "weather is not a factor".
 *
 * Note: Open-Meteo's keyless tier is for non-commercial use (~10k req/day).
 * Calls are cached for 30 minutes and only made for outdoor slate games, which
 * keeps volume tiny, but a commercial plan or pluggable provider belongs on
 * the roadmap before heavy traffic.
 */

type OpenMeteoPayload = {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    wind_speed_10m?: number[];
    wind_gusts_10m?: number[];
    precipitation_probability?: number[];
    snowfall?: number[];
  };
};

export async function getGameWeather(venue: VenueContext, gameTimeUtc: string | null): Promise<WeatherSnapshot | null> {
  if (venue.sheltered || venue.latitude === null || venue.longitude === null || !gameTimeUtc) return null;
  const gameTime = new Date(gameTimeUtc);
  if (Number.isNaN(gameTime.getTime())) return null;
  const query = new URLSearchParams({
    latitude: String(venue.latitude),
    longitude: String(venue.longitude),
    hourly: "temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability,snowfall",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "UTC",
    start_date: gameTimeUtc.slice(0, 10),
    end_date: gameTimeUtc.slice(0, 10)
  });
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, {
      next: { revalidate: 1800 },
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as OpenMeteoPayload;
    const hours = payload.hourly?.time ?? [];
    if (hours.length === 0) return null;
    const target = `${gameTimeUtc.slice(0, 13)}:00`;
    let index = hours.findIndex((hour) => hour === target);
    if (index === -1) index = Math.min(hours.length - 1, gameTime.getUTCHours());
    const at = (values: number[] | undefined) => {
      const value = values?.[index];
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    };
    return {
      tempF: at(payload.hourly?.temperature_2m),
      windMph: at(payload.hourly?.wind_speed_10m),
      gustMph: at(payload.hourly?.wind_gusts_10m),
      precipProbability: at(payload.hourly?.precipitation_probability) / 100,
      snowfall: at(payload.hourly?.snowfall) > 0
    };
  } catch {
    return null;
  }
}
