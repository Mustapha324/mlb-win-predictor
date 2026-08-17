"use server";

import { redirect } from "next/navigation";
import { getServerAccess } from "@/lib/server/access";
import { getStripe } from "@/lib/stripe";

export async function startProCheckout(): Promise<void> {
  const access = await getServerAccess();
  if (!access.authenticated || !access.userId || !access.email) redirect("/account?error=Sign%20in%20before%20starting%20Pro.");
  if (access.isPro) redirect("/account?success=Pro%20is%20already%20active.");
  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) redirect("/pro?error=Stripe%20price%20is%20not%20configured%20yet.");
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: access.stripeCustomerId ?? undefined,
    customer_email: access.stripeCustomerId ? undefined : access.email,
    allow_promotion_codes: true,
    client_reference_id: access.userId,
    metadata: { user_id: access.userId, product: "sport_iq_pro" },
    subscription_data: { metadata: { user_id: access.userId, product: "sport_iq_pro" } },
    success_url: `${origin}/pro/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pro?canceled=1`
  });
  if (!session.url) redirect("/pro?error=Stripe%20did%20not%20return%20a%20checkout%20URL.");
  redirect(session.url);
}

export async function openBillingPortal(): Promise<void> {
  const access = await getServerAccess();
  if (!access.authenticated || !access.stripeCustomerId) redirect("/account?error=No%20Stripe%20subscription%20was%20found.");
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await getStripe().billingPortal.sessions.create({
    customer: access.stripeCustomerId,
    return_url: `${origin}/account`
  });
  redirect(session.url);
}
