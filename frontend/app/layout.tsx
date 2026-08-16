import type { Metadata } from "next";
import { headers } from "next/headers";
import { Navbar } from "@/components/Navbar";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const description = "Daily MLB win probabilities powered by five seasons of results, current form, and probable-pitcher data.";
  return {
    metadataBase: new URL(origin),
    title: { default: "Diamond Dugout — MLB Win Predictor", template: "%s | Diamond Dugout" },
    description,
    openGraph: {
      title: "Diamond Dugout — MLB Win Predictor",
      description,
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1731, height: 909, alt: "Diamond Dugout MLB prediction intelligence" }]
    },
    twitter: {
      card: "summary_large_image",
      title: "Diamond Dugout — MLB Win Predictor",
      description,
      images: [`${origin}/og.png`]
    }
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#060914] text-slate-100 antialiased">
        <Navbar />
        <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-7 sm:py-10">{children}</div>
        <footer className="mx-auto max-w-[1440px] border-t border-white/[0.07] px-4 py-8 text-xs leading-6 text-slate-600 sm:px-7">
          Diamond Dugout is an independent analytics project. Team color badges are original identifiers, not official club logos. Predictions are informational—not betting advice.
        </footer>
      </body>
    </html>
  );
}
