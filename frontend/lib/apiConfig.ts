const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8000";

export const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_BACKEND_BASE_URL;
export const API_BASE_URL = `${BACKEND_BASE_URL}/api`;

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
