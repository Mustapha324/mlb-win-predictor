"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function accountRedirect(kind: "error" | "success", message: string): never {
  redirect(`/account?${kind}=${encodeURIComponent(message)}`);
}

export async function signIn(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) accountRedirect("error", "Supabase is not configured yet.");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) accountRedirect("error", error.message);
  redirect("/account");
}

export async function signUp(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) accountRedirect("error", "Supabase is not configured yet.");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) accountRedirect("error", "Use a password with at least 8 characters.");
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` }
  });
  if (error) accountRedirect("error", error.message);
  accountRedirect("success", "Check your email to confirm your account.");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/");
}

