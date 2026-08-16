import Link from "next/link";

const navigationItems = [
  { href: "/", label: "Today" },
  { href: "/history", label: "Results" },
  { href: "/metrics", label: "Model" }
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/8 bg-[#060914]/88 backdrop-blur-xl">
      <nav className="mx-auto flex min-h-16 max-w-[1440px] items-center justify-between gap-5 px-4 sm:px-7">
        <Link href="/" className="group flex items-center gap-3" aria-label="Diamond Dugout home">
          <span className="diamond-mark grid h-9 w-9 rotate-45 place-items-center rounded-[9px] border border-cyan-300/50 bg-cyan-300/10 shadow-[0_0_24px_rgba(103,232,249,.14)]">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,.75)]" />
          </span>
          <span>
            <span className="block text-sm font-black tracking-[0.16em] text-white sm:text-base">DIAMOND DUGOUT</span>
            <span className="hidden text-[9px] font-semibold uppercase tracking-[0.28em] text-slate-500 sm:block">MLB prediction intelligence</span>
          </span>
        </Link>
        <ul className="flex items-center rounded-full border border-white/8 bg-white/[0.025] p-1">
          {navigationItems.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="block rounded-full px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400 transition hover:bg-white/7 hover:text-white sm:px-4">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
