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
    { href: config.homeHref, label: "Home" },
    { href: `${config.homeHref}#player-picks`, label: "Player Picks" },
    { href: `${config.homeHref}#team-picks`, label: "Team Picks" },
    { href: config.historyHref, label: "Results" },
    { href: config.metricsHref, label: "Model" },
    { href: "/settings", label: "Settings" }
  ];
  const isCurrent = (href: string) => !href.includes("#") && pathname === href;

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-black/85 backdrop-blur-xl">
      <nav aria-label="Primary" className="mx-auto flex min-h-16 max-w-[1480px] items-center justify-between gap-2 px-3 sm:gap-4 sm:px-7">
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
            <Link key={item} href={SPORTS[item].homeHref} aria-current={sport === item ? "page" : undefined} className={`grid min-h-10 place-items-center rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] transition ${sport === item ? item === "mlb" ? "bg-cyan-300 text-black" : "bg-lime-300 text-black" : "text-neutral-400 hover:text-white"}`}>
              {SPORTS[item].shortName}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ul className="hidden items-center gap-1 lg:flex">
            {navigationItems.map((item) => (
              <li key={item.href}><Link href={item.href} aria-current={isCurrent(item.href) ? "page" : undefined} className={`grid min-h-10 place-items-center rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition hover:bg-white/[0.05] hover:text-white ${isCurrent(item.href) ? "bg-white/[0.07] text-white" : "text-neutral-400"}`}>{item.label}</Link></li>
            ))}
          </ul>
          <Link href="/pro" className="grid min-h-11 place-items-center rounded-full border border-lime-300/25 bg-lime-300/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-lime-200 transition hover:bg-lime-300 hover:text-black">Pro</Link>
          <Link href="/account" aria-current={pathname === "/account" ? "page" : undefined} className="grid min-h-11 place-items-center rounded-full border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-neutral-200 transition hover:bg-white hover:text-black">Account</Link>
        </div>
      </nav>

      <nav aria-label="Mobile navigation" className="mobile-nav-scroll overflow-x-auto border-t border-white/[0.05] px-3 md:hidden">
        <div className="flex min-w-max items-center gap-1 py-1.5">
          {(["mlb", "nfl"] as const).map((item) => <Link key={item} href={SPORTS[item].homeHref} aria-current={sport === item ? "page" : undefined} className={`grid min-h-11 place-items-center rounded-lg px-3 text-[10px] font-black ${sport === item ? item === "mlb" ? "bg-cyan-300 text-black" : "bg-lime-300 text-black" : "text-neutral-400"}`}>{SPORTS[item].shortName}</Link>)}
          <span className="mx-1 h-6 w-px bg-white/10" aria-hidden="true" />
          {navigationItems.map((item) => <Link key={item.href} href={item.href} aria-current={isCurrent(item.href) ? "page" : undefined} className={`grid min-h-11 place-items-center rounded-lg px-3 text-[10px] font-bold uppercase tracking-[0.08em] ${isCurrent(item.href) ? "bg-white/[0.07] text-white" : "text-neutral-400"}`}>{item.label}</Link>)}
        </div>
      </nav>
    </header>
  );
}
