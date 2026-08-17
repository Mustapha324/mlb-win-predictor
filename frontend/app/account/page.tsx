import Link from "next/link";
import { getServerAccess } from "@/lib/server/access";
import { openBillingPortal } from "@/app/pro/actions";
import { redeemInviteCode, signIn, signOut, signUp } from "@/app/account/actions";

export const metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const [access, query] = await Promise.all([getServerAccess(), searchParams]);
  return (
    <main className="mx-auto max-w-5xl">
      <header className="border-b border-white/[0.08] pb-8">
        <p className="sport-kicker">Sport IQ account</p>
        <h1 className="mt-2 text-4xl font-black tracking-[-0.05em] text-white sm:text-6xl">Your edge, saved.</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-400">Sign in to keep favorites, redeem an invite, and unlock the full MLB and NFL slate.</p>
      </header>

      {query.error ? <p className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/[0.07] p-4 text-sm text-rose-100">{query.error}</p> : null}
      {query.success ? <p className="mt-6 rounded-2xl border border-lime-300/20 bg-lime-300/[0.07] p-4 text-sm text-lime-100">{query.success}</p> : null}

      {access.authenticated ? (
        <section className="mt-7 grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
          <article className="sport-panel p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Signed in as</p>
                <h2 className="mt-2 text-xl font-black text-white">{access.email}</h2>
              </div>
              <span className={`rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] ${access.isPro ? "border-lime-300/25 bg-lime-300/10 text-lime-200" : "border-white/10 bg-white/[0.04] text-neutral-400"}`}>
                {access.tier === "friends_family" ? "Friends & Family Pro" : access.isPro ? "Sport IQ Pro" : "Free plan"}
              </span>
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {access.isPro ? (
                <>
                  <div className="feature-tile"><span>✓</span><p>Every pregame prediction</p></div>
                  <div className="feature-tile"><span>✓</span><p>Live probability updates</p></div>
                  <div className="feature-tile"><span>✓</span><p>Live market consensus</p></div>
                  <div className="feature-tile"><span>✓</span><p>Full matchup factors</p></div>
                </>
              ) : (
                <>
                  <div className="feature-tile"><span>•</span><p>Half-slate pregame preview</p></div>
                  <div className="feature-tile opacity-50"><span>×</span><p>No live movement</p></div>
                  <div className="feature-tile opacity-50"><span>×</span><p>Limited model factors</p></div>
                  <Link href="/pro" className="feature-tile border-lime-300/20 text-lime-200"><span>→</span><p>Unlock for $3.99/month</p></Link>
                </>
              )}
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              {access.isPro && access.tier === "pro" ? <form action={openBillingPortal}><button className="secondary-button" type="submit">Manage billing</button></form> : null}
              <form action={signOut}><button className="secondary-button" type="submit">Sign out</button></form>
            </div>
          </article>

          <article className="sport-panel p-6 sm:p-8">
            <p className="eyebrow">Friends & Family</p>
            <h2 className="mt-2 text-2xl font-black text-white">Have a permanent Pro code?</h2>
            <p className="mt-3 text-sm leading-6 text-neutral-500">Each invite works once and is permanently tied to the account that redeems it.</p>
            <form action={redeemInviteCode} className="mt-6 space-y-3">
              <label className="block text-xs font-bold text-neutral-300" htmlFor="invite-code">Invite code</label>
              <input id="invite-code" name="code" required autoComplete="off" placeholder="SI-FAM-XXXXXXXX" className="text-input uppercase" />
              <button type="submit" className="primary-button w-full">Redeem code</button>
            </form>
          </article>
        </section>
      ) : (
        <section className="mt-7 grid gap-5 lg:grid-cols-2">
          <article className="sport-panel p-6 sm:p-8">
            <p className="eyebrow">Welcome back</p>
            <h2 className="mt-2 text-2xl font-black text-white">Sign in</h2>
            <form action={signIn} className="mt-6 space-y-4">
              <label className="block text-xs font-bold text-neutral-300" htmlFor="sign-in-email">Email</label>
              <input id="sign-in-email" name="email" type="email" autoComplete="email" required className="text-input" />
              <label className="block text-xs font-bold text-neutral-300" htmlFor="sign-in-password">Password</label>
              <input id="sign-in-password" name="password" type="password" autoComplete="current-password" required className="text-input" />
              <button type="submit" className="primary-button w-full">Sign in</button>
            </form>
          </article>
          <article className="sport-panel p-6 sm:p-8">
            <p className="eyebrow">New to Sport IQ</p>
            <h2 className="mt-2 text-2xl font-black text-white">Create a free account</h2>
            <form action={signUp} className="mt-6 space-y-4">
              <label className="block text-xs font-bold text-neutral-300" htmlFor="sign-up-email">Email</label>
              <input id="sign-up-email" name="email" type="email" autoComplete="email" required className="text-input" />
              <label className="block text-xs font-bold text-neutral-300" htmlFor="sign-up-password">Password</label>
              <input id="sign-up-password" name="password" type="password" minLength={8} autoComplete="new-password" required className="text-input" />
              <button type="submit" className="primary-button w-full">Create account</button>
            </form>
          </article>
        </section>
      )}
    </main>
  );
}
