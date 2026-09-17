"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/app/account/actions";
import type { SocialMe, SocialResponse } from "@/lib/social";
import { APP_NAME, SPORTS, sportFromPath } from "@/lib/sports";

export function Navbar() {
  const pathname = usePathname();
  const [account, setAccount] = useState<SocialMe | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function loadAccount() {
      try {
        const response = await fetch("/api/social?view=me", { signal: controller.signal, cache: "no-store" });
        const payload: SocialResponse<SocialMe> = await response.json();
        if (response.ok && payload.available) {
          setAccount(payload.data);
          return;
        }
        const sessionResponse = await fetch("/api/account/access", { signal: controller.signal, cache: "no-store" });
        if (sessionResponse.ok) setAccount({ ...(await sessionResponse.json()), profile: null });
      } catch {
        // Navigation and public predictions remain usable if accounts are unavailable.
      }
    }
    void loadAccount();
    window.addEventListener("sportiq:profile-updated", loadAccount);
    return () => {
      controller.abort();
      window.removeEventListener("sportiq:profile-updated", loadAccount);
    };
  }, [pathname]);
  const sport = sportFromPath(pathname);
  const config = SPORTS[sport];
  const navigationItems = [
    { href: config.homeHref, label: "Games" },
    { href: `${config.homeHref}#player-picks`, label: "Player Picks" },
    { href: config.historyHref, label: "Results" },
    { href: "/leaderboard", label: "Leaderboard" },
    { href: "/friends", label: "Friends" },
    { href: "/model", label: "Model" }
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
          <ul className="hidden items-center gap-1 xl:flex">
            {navigationItems.map((item) => (
              <li key={item.href}><Link href={item.href} aria-current={isCurrent(item.href) ? "page" : undefined} className={`grid min-h-10 place-items-center rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition hover:bg-white/[0.05] hover:text-white ${isCurrent(item.href) ? "bg-white/[0.07] text-white" : "text-neutral-400"}`}>{item.label}</Link></li>
            ))}
          </ul>
          {account?.authenticated ? <details key={pathname} className="relative">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-white"><span aria-hidden="true">{account.profile?.avatar ?? "⚾"}</span><span className="max-w-24 truncate">{account.profile?.username ?? "My SportIQ"}</span><span aria-hidden="true">▾</span></summary>
            <div className="absolute right-0 mt-2 w-48 rounded-2xl border border-white/10 bg-neutral-950 p-2 shadow-xl">
              {[["/profile", "My profile"], ["/my-picks", "My picks"], ["/my-stats", "My stats"], ["/friends", "Friends"], ["/settings", "Settings"], ["/account", "Account"]].map(([href, label]) => <Link key={href} href={href} className="block rounded-lg px-3 py-2.5 text-sm text-neutral-300 hover:bg-white/5 hover:text-white">{label}</Link>)}
              <form action={signOut}><button type="submit" className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-neutral-300 hover:bg-white/5 hover:text-white">Log out</button></form>
            </div>
          </details> : <>
            <Link href="/account#sign-in" className="grid min-h-11 place-items-center rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-[0.1em] text-neutral-200 hover:text-white">Log in</Link>
            <Link href="/account#sign-up" className="grid min-h-11 place-items-center rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.1em] text-cyan-200 transition hover:bg-cyan-300 hover:text-black">Sign up</Link>
          </>}
        </div>
      </nav>

      <nav aria-label="Mobile navigation" className="mobile-nav-scroll overflow-x-auto border-t border-white/[0.05] px-3 xl:hidden">
        <div className="flex min-w-max items-center gap-1 py-1.5">
          {(["mlb", "nfl"] as const).map((item) => <Link key={item} href={SPORTS[item].homeHref} aria-current={sport === item ? "page" : undefined} className={`grid min-h-11 place-items-center rounded-lg px-3 text-[10px] font-black ${sport === item ? item === "mlb" ? "bg-cyan-300 text-black" : "bg-lime-300 text-black" : "text-neutral-400"}`}>{SPORTS[item].shortName}</Link>)}
          <span className="mx-1 h-6 w-px bg-white/10" aria-hidden="true" />
          {navigationItems.map((item) => <Link key={item.href} href={item.href} aria-current={isCurrent(item.href) ? "page" : undefined} className={`grid min-h-11 place-items-center rounded-lg px-3 text-[10px] font-bold uppercase tracking-[0.08em] ${isCurrent(item.href) ? "bg-white/[0.07] text-white" : "text-neutral-400"}`}>{item.label}</Link>)}
        </div>
      </nav>
    </header>
  );
}
