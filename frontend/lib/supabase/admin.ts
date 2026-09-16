import "server-only";
import { createClient } from "@supabase/supabase-js";

function isServiceRoleJwt(value: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(value.split(".")[1] ?? "", "base64url").toString("utf8")) as { role?: unknown };
    return payload.role === "service_role";
  } catch { return false; }
}

export function hasSupabaseAdminCredentials(): boolean {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && key && key !== process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && (key.startsWith("sb_secret_") || isServiceRoleJwt(key)));
}

export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !hasSupabaseAdminCredentials()) throw new Error("Supabase admin access requires a server-side secret or service-role key.");
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
