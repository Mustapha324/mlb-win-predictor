import Link from "next/link";

export function LegalDocument({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-4xl">
      <nav aria-label="Legal navigation" className="mb-6 flex flex-wrap gap-2 text-xs font-bold text-neutral-400">
        <Link href="/settings" className="secondary-button">← Settings</Link>
        <Link href="/terms" className="secondary-button">Terms</Link>
        <Link href="/privacy" className="secondary-button">Privacy</Link>
        <Link href="/responsible-use" className="secondary-button">Responsible use</Link>
      </nav>
      <header className="border-b border-white/[0.09] pb-7">
        <p className="sport-kicker">Sport IQ policies</p>
        <h1 className="mt-3 text-4xl font-black tracking-[-0.05em] text-white sm:text-6xl">{title}</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-neutral-300">{summary}</p>
        <p className="mt-3 text-xs text-neutral-500">Effective August 24, 2026</p>
      </header>
      <article className="legal-copy mt-7 sport-panel p-5 sm:p-8">{children}</article>
    </main>
  );
}
