import Link from "next/link";

export const metadata = { title: "Pro activated" };

export default function ProSuccessPage() {
  return (
    <main className="mx-auto max-w-2xl py-12 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-lime-300/30 bg-lime-300/10 text-2xl text-lime-200">✓</div>
      <h1 className="mt-6 text-4xl font-black tracking-[-0.05em] text-white">Welcome to Sport IQ Pro.</h1>
      <p className="mt-4 text-sm leading-6 text-neutral-400">Stripe confirmed checkout. Your webhook will activate the full slate and live updates in your account.</p>
      <div className="mt-7 flex justify-center gap-3"><Link href="/" className="primary-button">View MLB slate</Link><Link href="/nfl" className="secondary-button">View NFL slate</Link></div>
    </main>
  );
}
