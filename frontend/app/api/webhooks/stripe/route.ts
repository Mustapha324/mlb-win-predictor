import type Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

async function updateProfile(userId: string, values: Record<string, unknown>): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("profiles").update({ ...values, updated_at: new Date().toISOString() }).eq("id", userId);
  if (error) throw error;
}

async function updateByCustomer(customerId: string, values: Record<string, unknown>): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("profiles").update({ ...values, updated_at: new Date().toISOString() }).eq("stripe_customer_id", customerId);
  if (error) throw error;
}

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) return Response.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return Response.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.user_id ?? session.client_reference_id;
    if (userId) {
      await updateProfile(userId, {
        access_tier: "pro",
        pro_source: "stripe",
        stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id,
        stripe_subscription_id: typeof session.subscription === "string" ? session.subscription : session.subscription?.id,
        subscription_status: "active"
      });
    }
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const userId = subscription.metadata?.user_id;
    const active = ["active", "trialing"].includes(subscription.status);
    const values = {
      access_tier: active ? "pro" : "free",
      pro_source: active ? "stripe" : null,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      pro_expires_at: active ? null : new Date().toISOString()
    };
    if (userId) await updateProfile(userId, values);
    else await updateByCustomer(customerId, values);
  }
  return Response.json({ received: true });
}
