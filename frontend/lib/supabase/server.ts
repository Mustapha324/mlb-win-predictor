import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function publicConfig(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

export async function createSupabaseServerClient() {
  const config = publicConfig();
  if (!config) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const cookie of cookiesToSet) cookieStore.set(cookie.name, cookie.value, cookie.options);
        } catch {
          // Server Components cannot always mutate cookies; proxy.ts refreshes them.
        }
      }
    }
  });
}
