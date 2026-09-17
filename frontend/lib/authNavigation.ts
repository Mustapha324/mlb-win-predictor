/** Only local application paths may be used after authentication. */
export function safeReturnPath(value: unknown, fallback = "/profile"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return fallback;
  try {
    const destination = new URL(value, "https://sportiq.invalid");
    if (destination.origin !== "https://sportiq.invalid") return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}
