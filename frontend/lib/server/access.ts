import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AccessState = {
  authenticated: boolean;
  isPro: boolean;
  tier: "free" | "pro" | "friends_family";
  email: string | null;
  userId: string | null;
  stripeCustomerId: string | null;
  subscriptionStatus: string | null;
};

const FREE_ACCESS: AccessState = {
  authenticated: false,
  isPro: false,
  tier: "free",
  email: null,
  userId: null,
  stripeCustomerId: null,
  subscriptionStatus: null
};

export async function getServerAccess(): Promise<AccessState> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return FREE_ACCESS;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return FREE_ACCESS;
  const { data: profile } = await supabase
    .from("profiles")
    .select("access_tier,pro_expires_at,stripe_customer_id,subscription_status")
    .eq("id", user.id)
    .maybeSingle();
  const permanent = profile?.access_tier === "friends_family";
  const paidActive = profile?.access_tier === "pro" && ["active", "trialing"].includes(profile?.subscription_status ?? "");
  const notExpired = !profile?.pro_expires_at || new Date(profile.pro_expires_at).getTime() > Date.now();
  return {
    authenticated: true,
    isPro: Boolean((permanent || paidActive) && notExpired),
    tier: permanent ? "friends_family" : paidActive ? "pro" : "free",
    email: user.email ?? null,
    userId: user.id,
    stripeCustomerId: profile?.stripe_customer_id ?? null,
    subscriptionStatus: profile?.subscription_status ?? null
  };
}
