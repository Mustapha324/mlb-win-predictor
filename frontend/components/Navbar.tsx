"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME, SPORTS, sportFromPath } from "@/lib/sports";

export function Navbar() {
  const pathname = usePathname();
  const sport = sportFromPath(pathname);
  const config = SPORTS[sport];
  const navigationItems = [
    { href: config.homeHref, label: sport === "mlb" ? "Today" : "Week" },
    { href: config.historyHref, label: "Results" },
    { href: config.metricsHref, label: "Model" }
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-black/85 backdrop-blur-xl">
      <nav className="mx-auto flex min-h-16 max-w-[1480px] items-center justify-between gap-4 px-4 sm:px-7">
        <Link href={config.homeHref} className="group flex shrink-0 items-center gap-3" aria-label={`${APP_NAME} home`}>
          <span className="relative h-10 w-14 overflow-hidden rounded-xl border border-white/15 bg-black shadow-[0_0_22px_rgba(14,165,233,0.14)]">
            <Image
              src="/sport-iq-logo.png"
              alt=""
              fill
              priority
              sizes="56px"
              className="object-cover"
              style={{ objectPosition: "center 30%" }}
            />
          </span>
          <span>
            <span className="block text-sm font-black tracking-[0.15em] text-white sm:text-base">SPORT IQ</span>
            <span className="hidden text-[8px] font-bold uppercase tracking-[0.24em] text-neutral-600 sm:block">Predict · Track · Verify</span>
          </span>
        </Link>

        <div className="hidden items-center rounded-full border border-white/[0.09] bg-white/[0.035] p-1 md:flex" aria-label="Choose sport">
          {(["mlb", "nfl"] as const).map((item) => (
            <Link key={item} href={SPORTS[item].homeHref} className={`rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] transition ${sport === item ? item === "mlb" ? "bg-cyan-300 text-black" : "bg-lime-300 text-black" : "text-neutral-500 hover:text-white"}`}>
              {SPORTS[item].shortName}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ul className="hidden items-center gap-1 lg:flex">
            {navigationItems.map((item) => (
              <li key={item.href}><Link href={item.href} className="block rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500 transition hover:bg-white/[0.05] hover:text-white">{item.label}</Link></li>
            ))}
          </ul>
          <Link href="/pro" className="rounded-full border border-lime-300/25 bg-lime-300/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-lime-200 transition hover:bg-lime-300 hover:text-black">Pro</Link>
          <Link href="/account" className="rounded-full border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-neutral-300 transition hover:bg-white hover:text-black">Account</Link>
        </div>
      </nav>

      <div className="flex items-center justify-between border-t border-white/[0.05] px-4 py-2 md:hidden">
        <div className="flex gap-1">
          {(["mlb", "nfl"] as const).map((item) => <Link key={item} href={SPORTS[item].homeHref} className={`rounded-lg px-3 py-1.5 text-[10px] font-black ${sport === item ? item === "mlb" ? "bg-cyan-300 text-black" : "bg-lime-300 text-black" : "text-neutral-500"}`}>{SPORTS[item].shortName}</Link>)}
        </div>
        <div className="flex gap-1">{navigationItems.map((item) => <Link key={item.href} href={item.href} className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500">{item.label}</Link>)}</div>
      </div>
    </header>
  );
}
