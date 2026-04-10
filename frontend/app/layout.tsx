import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MLB Win Predictor",
  description: "Frontend for the MLB Win Predictor app"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
