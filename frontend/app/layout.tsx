import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { PreferenceSync } from "@/components/PreferenceSync";
import { APP_NAME } from "@/lib/sports";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const description = "Transparent MLB and NFL pregame predictions, live probability movement, market consensus, and verified final results.";
  return {
    metadataBase: new URL(origin),
    title: { default: `${APP_NAME} — MLB & NFL Predictions`, template: `%s | ${APP_NAME}` },
    description,
    openGraph: {
      title: `${APP_NAME} — MLB & NFL Predictions`,
      description,
      type: "website"
    },
    twitter: {
      card: "summary_large_image",
      title: `${APP_NAME} — MLB & NFL Predictions`,
      description
    }
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black text-neutral-100 antialiased">
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <PreferenceSync />
        <Navbar />
        <div id="main-content" tabIndex={-1} className="mx-auto max-w-[1480px] px-3 py-6 outline-none sm:px-7 sm:py-10">{children}</div>
        <footer className="mx-auto flex max-w-[1480px] flex-col gap-5 border-t border-white/[0.07] px-4 py-8 text-xs leading-6 text-neutral-400 sm:px-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-3xl items-center gap-4">
            <Image src="/sport-iq-logo.png" alt="Sport IQ" width={76} height={76} className="h-14 w-14 shrink-0 rounded-xl object-cover" />
            <p>Sport IQ is an independent analytics platform. Pregame predictions are locked separately from live updates and final results. Informational only—not betting advice.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2 font-bold">
            <Link href="/settings" className="grid min-h-11 items-center">Settings</Link>
            <Link href="/terms" className="grid min-h-11 items-center">Terms</Link>
            <Link href="/privacy" className="grid min-h-11 items-center">Privacy</Link>
            <a href="https://discord.gg/zJnduXrDv" target="_blank" rel="noopener noreferrer" className="grid min-h-11 items-center">Discord ↗</a>
          </nav>
        </footer>
      </body>
    </html>
  );
}
