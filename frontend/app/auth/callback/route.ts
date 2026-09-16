import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/authNavigation";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = supabase ? await supabase.auth.exchangeCodeForSession(code) : { error: new Error("Supabase is not configured.") };
    if (!error) return NextResponse.redirect(new URL(safeReturnPath(url.searchParams.get("next")), url.origin));
  }
  return NextResponse.redirect(new URL("/account?error=Confirmation%20link%20could%20not%20be%20verified.", url.origin));
}
