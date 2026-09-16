import Link from "next/link";
import { getServerAccess } from "@/lib/server/access";
import { signIn, signOut, signUp } from "@/app/account/actions";
import { safeReturnPath } from "@/lib/authNavigation";

export const metadata = { title: "Your SportIQ account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string; next?: string }> }) {
  const [access, query] = await Promise.all([getServerAccess(), searchParams]);
  const next = safeReturnPath(query.next);
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return (
    <main className="mx-auto max-w-5xl">
      <header className="border-b border-white/[0.08] pb-8">
        <p className="sport-kicker">Your SportIQ</p>
        <h1 className="mt-2 text-4xl font-black tracking-[-0.05em] text-white sm:text-6xl">Make your call.</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-400">An optional account saves your picks, tracks your record, and connects you with friends. Every model prediction is free to view without signing in.</p>
        <Link href="/" className="mt-4 inline-flex text-sm font-bold text-cyan-300">View predictions →</Link>
      </header>
      {query.error ? <p role="alert" className="mt-6 rounded-2xl border border-rose-400/20 bg-rose-400/[0.07] p-4 text-sm text-rose-100">{query.error}</p> : null}
      {query.success ? <p role="status" className="mt-6 rounded-2xl border border-lime-300/20 bg-lime-300/[0.07] p-4 text-sm text-lime-100">{query.success}</p> : null}
      {access.authenticated ? (
        <section className="sport-panel mt-7 p-6 sm:p-8">
          <p className="eyebrow">Signed in as</p><h2 className="mt-2 break-all text-xl font-black text-white">{access.email}</h2>
          <p className="mt-3 text-sm text-neutral-400">Your email stays private. Your public profile uses your username.</p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">{[["/profile", "My profile"], ["/my-picks", "My picks"], ["/my-stats", "My stats"], ["/friends", "Friends"]].map(([href, label]) => <Link key={href} href={href} className="feature-tile"><span>→</span><p>{label}</p></Link>)}</div>
          <div className="mt-7 flex flex-wrap gap-3"><Link href="/profile" className="primary-button">Edit profile</Link><form action={signOut}><button className="secondary-button" type="submit">Log out</button></form></div>
        </section>
      ) : !configured ? (
        <section className="sport-panel mt-7 p-6 sm:p-8"><h2 className="text-xl font-black text-white">Accounts are not available on this installation yet.</h2><p className="mt-3 text-sm leading-6 text-neutral-400">You can still explore all MLB and NFL predictions, player picks, model explanations, and results.</p><Link href="/" className="primary-button mt-5 inline-flex">Explore predictions</Link></section>
      ) : (
        <section className="mt-7 grid gap-5 lg:grid-cols-2">
          <article id="sign-in" className="sport-panel scroll-mt-28 p-6 sm:p-8">
            <p className="eyebrow">Welcome back</p><h2 className="mt-2 text-2xl font-black text-white">Log in</h2>
            <form action={signIn} className="mt-6 space-y-4">
              <input type="hidden" name="next" value={next} />
              <label className="block text-xs font-bold text-neutral-300" htmlFor="sign-in-email">Email</label><input id="sign-in-email" name="email" type="email" autoComplete="email" required className="text-input" />
              <label className="block text-xs font-bold text-neutral-300" htmlFor="sign-in-password">Password</label><input id="sign-in-password" name="password" type="password" autoComplete="current-password" required className="text-input" />
              <button type="submit" className="primary-button w-full">Log in</button>
            </form>
          </article>
          <article id="sign-up" className="sport-panel scroll-mt-28 p-6 sm:p-8">
            <p className="eyebrow">New to SportIQ</p><h2 className="mt-2 text-2xl font-black text-white">Create a free account</h2>
            <form action={signUp} className="mt-6 space-y-4">
              <input type="hidden" name="next" value={next} />
              <label className="block text-xs font-bold text-neutral-300" htmlFor="sign-up-email">Email</label><input id="sign-up-email" name="email" type="email" autoComplete="email" required className="text-input" />
              <label className="block text-xs font-bold text-neutral-300" htmlFor="sign-up-password">Password</label><input id="sign-up-password" name="password" type="password" minLength={8} autoComplete="new-password" required className="text-input" />
              <button type="submit" className="primary-button w-full">Sign up</button>
            </form>
          </article>
        </section>
      )}
    </main>
  );
}
