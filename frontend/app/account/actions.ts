"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/authNavigation";

function accountRedirect(kind: "error" | "success", message: string, next = "/profile"): never {
  const query = new URLSearchParams({ [kind]: message, next: safeReturnPath(next) });
  redirect(`/account?${query}`);
}

export async function signIn(formData: FormData): Promise<void> {
  const next = safeReturnPath(formData.get("next"));
  const supabase = await createSupabaseServerClient();
  if (!supabase) accountRedirect("error", "Accounts are not available on this installation yet.", next);
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) accountRedirect("error", error.message, next);
  redirect(next);
}

export async function signUp(formData: FormData): Promise<void> {
  const next = safeReturnPath(formData.get("next"));
  const supabase = await createSupabaseServerClient();
  if (!supabase) accountRedirect("error", "Accounts are not available on this installation yet.", next);
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) accountRedirect("error", "Use a password with at least 8 characters.", next);
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` }
  });
  if (error) accountRedirect("error", error.message, next);
  if (data.session) redirect(next);
  accountRedirect("success", "Check your email to confirm your account.", next);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/");
}

