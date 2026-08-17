import Image from "next/image";
import Link from "next/link";
import { startProCheckout } from "@/app/pro/actions";
import { getServerAccess } from "@/lib/server/access";

export const metadata = { title: "Sport IQ Pro" };

const rows = [
  ["Pregame slate", "Half preview", "Every game"],
  ["Live win probability", "Locked", "30-second updates"],
  ["Live market consensus", "Locked", "Included"],
  ["Model factors", "Top factor", "Full breakdown"],
  ["History & final winners", "Included", "Included"],
  ["Ads", "May be added", "Ad-free"]
];

export default async function ProPage({ searchParams }: { searchParams: Promise<{ error?: string; canceled?: string }> }) {
  const [access, query] = await Promise.all([getServerAccess(), searchParams]);
  return (
    <main className="mx-auto max-w-6xl">
      <section className="relative overflow-hidden rounded-[32px] border border-lime-300/15 bg-[#0b0d09] px-6 py-12 text-center sm:px-10 sm:py-16">
        <div className="pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-lime-300/10 blur-[90px]" />
        <div className="relative">
          <Image src="/sport-iq-logo.png" alt="Sport IQ" width={112} height={112} priority className="mx-auto mb-5 h-28 w-28 rounded-2xl object-cover shadow-[0_0_40px_rgba(132,204,22,0.08)]" />
          <p className="text-xs font-black uppercase tracking-[0.24em] text-lime-300">Sport IQ Pro</p>
          <h1 className="mx-auto mt-4 max-w-4xl text-5xl font-black tracking-[-0.065em] text-white sm:text-7xl">See the whole slate move.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-neutral-400 sm:text-base">Every locked pregame pick stays visible beside live model movement, market consensus, and the final winner.</p>
          <div className="mt-8 flex items-end justify-center gap-2"><span className="text-5xl font-black text-white">$3.99</span><span className="pb-1 text-sm text-neutral-500">/ month</span></div>
          {query.error ? <p className="mx-auto mt-5 max-w-lg rounded-xl border border-rose-400/20 bg-rose-400/[0.07] p-3 text-sm text-rose-100">{query.error}</p> : null}
          {query.canceled ? <p className="mt-5 text-sm text-neutral-500">Checkout canceled. Nothing was charged.</p> : null}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {access.isPro ? <Link href="/account" className="primary-button">Pro is active — view account</Link> : access.authenticated ? <form action={startProCheckout}><button type="submit" className="primary-button">Unlock Pro</button></form> : <Link href="/account" className="primary-button">Create account to upgrade</Link>}
            <Link href="/" className="secondary-button">Preview predictions</Link>
          </div>
          <p className="mt-4 text-[11px] text-neutral-600">Cancel anytime through Stripe&apos;s secure billing portal.</p>
        </div>
      </section>

      <section className="mt-8 overflow-hidden rounded-[26px] border border-white/[0.08] bg-[#0a0a0a]">
        <div className="grid grid-cols-[1.2fr_.8fr_.8fr] border-b border-white/[0.08] px-4 py-4 text-[10px] font-black uppercase tracking-[0.15em] text-neutral-500 sm:px-7">
          <span>Feature</span><span>Free</span><span className="text-lime-300">Pro</span>
        </div>
        {rows.map(([feature, free, pro]) => (
          <div key={feature} className="grid grid-cols-[1.2fr_.8fr_.8fr] border-b border-white/[0.055] px-4 py-4 text-xs last:border-0 sm:px-7 sm:text-sm">
            <span className="font-bold text-white">{feature}</span><span className="text-neutral-500">{free}</span><span className="font-semibold text-lime-200">{pro}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
