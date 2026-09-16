"use client";

import { useCallback, useEffect, useState } from "react";
import type { SocialResponse } from "@/lib/social";

export class SocialError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.name = "SocialError"; this.status = status; }
}

export async function socialRequest<T>(query: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/social${query ? `?${query}` : ""}`, {
    method: body ? "POST" : "GET", cache: "no-store", signal,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
  });
  const result: SocialResponse<T> = await response.json();
  if (!response.ok || !result.available) throw new SocialError(result.available ? "Unable to complete this request." : result.error, response.status);
  return result.data;
}

export function useSocialResource<T>(query: string | null) {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: SocialError | null }>({ key: null, data: null, error: null });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    socialRequest<T>(query, undefined, controller.signal).then((data) => setState({ key: query, data, error: null })).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ key: query, data: null, error: error instanceof SocialError ? error : new SocialError("Unable to connect. Please try again.", 0) });
    });
    return () => controller.abort();
  }, [query, revision]);
  return { data: state.key === query ? state.data : null, error: state.key === query ? state.error : null, reload };
}
