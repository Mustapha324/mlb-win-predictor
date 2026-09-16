/** Only local application paths may be used after authentication. */
export function safeReturnPath(value: unknown, fallback = "/profile"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const destination = new URL(value, "https://sportiq.invalid");
    if (destination.origin !== "https://sportiq.invalid") return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}
