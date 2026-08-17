import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY in the environment.");
  client ??= new Stripe(secretKey, { typescript: true });
  return client;
}
