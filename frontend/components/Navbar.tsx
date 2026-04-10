import Link from "next/link";

const navItems = [
  { href: "/", label: "Predictions" },
  { href: "/history", label: "History" },
  { href: "/metrics", label: "Metrics" }
];

export function Navbar() {
  return (
    <header className="border-b border-slate-800 bg-slate-950/90">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 text-slate-100">
        <p className="text-lg font-semibold tracking-tight">MLB Win Predictor</p>
        <ul className="flex items-center gap-2">
          {navItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
