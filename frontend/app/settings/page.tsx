import Link from "next/link";
import { SettingsPreferences } from "@/components/SettingsPreferences";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-5xl">
      <header className="border-b border-white/[0.09] pb-7">
        <p className="sport-kicker">Settings & support</p>
        <h1 className="mt-3 text-4xl font-black tracking-[-0.05em] text-white sm:text-6xl">Your Sport IQ experience.</h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-neutral-300">Adjust readability and live updates, manage your account, join the community, and review the policies behind the product.</p>
      </header>

      <div className="mt-7 grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <SettingsPreferences />
        <div className="space-y-5">
          <section className="sport-panel p-5 sm:p-7" aria-labelledby="account-settings-heading">
            <p className="eyebrow">Account</p>
            <h2 id="account-settings-heading" className="mt-2 text-xl font-black text-white">Profile & preferences</h2>
            <p className="mt-3 text-sm leading-6 text-neutral-400">Sign in, edit your public profile, and track your picks and friends. All predictions are free.</p>
            <Link href="/account" className="primary-button mt-5 w-full sm:w-auto">Open account</Link>
          </section>

          <section className="sport-panel border-indigo-300/15 p-5 sm:p-7" aria-labelledby="community-settings-heading">
            <p className="eyebrow">Community</p>
            <h2 id="community-settings-heading" className="mt-2 text-xl font-black text-white">Join the Sport IQ Discord</h2>
            <p className="mt-3 text-sm leading-6 text-neutral-400">Share feedback, discuss picks, and hear about product updates. Never post passwords or private account information.</p>
            <a href="https://discord.gg/zJnduXrDv" target="_blank" rel="noopener noreferrer" className="secondary-button mt-5 w-full border-indigo-300/25 text-indigo-200 sm:w-auto">Join Discord ↗</a>
          </section>
        </div>
      </div>

      <section className="mt-5 sport-panel p-5 sm:p-7" aria-labelledby="legal-settings-heading">
        <p className="eyebrow">Trust, data & legal</p>
        <h2 id="legal-settings-heading" className="mt-2 text-2xl font-black text-white">Clear rules, no hidden promises</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Link href="/terms" className="settings-link-card"><span>Terms of Service</span><small>Accounts, acceptable use, and limitations</small></Link>
          <Link href="/privacy" className="settings-link-card"><span>Privacy Policy</span><small>What data is used and why</small></Link>
          <Link href="/responsible-use" className="settings-link-card"><span>Responsible Use</span><small>Analytics are information, not a guarantee</small></Link>
        </div>
      </section>
    </main>
  );
}
