import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AccessState = {
  authenticated: boolean;
  email: string | null;
  userId: string | null;
};

const GUEST_ACCESS: AccessState = {
  authenticated: false,
  email: null,
  userId: null
};

export async function getServerAccess(): Promise<AccessState> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return GUEST_ACCESS;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return GUEST_ACCESS;
  return {
    authenticated: true,
    email: user.email ?? null,
    userId: user.id
  };
}
