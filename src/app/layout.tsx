import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Newsreader, Source_Sans_3 } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
  style: ["normal", "italic"],
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source",
  display: "swap",
});

const ibm = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Vellum — contract desk",
    template: "%s · Vellum",
  },
  description:
    "Upload a contract, ask what it actually says, and open the verified passage on the page. Every answer backed by a quote that was found in the document.",
  applicationName: "Vellum",
  keywords: ["contracts", "legal tech", "contract analysis", "verified citations"],
  openGraph: {
    type: "website",
    title: "Vellum — contract desk",
    description: "Ask what the contract actually says. Every answer backed by a verified quote.",
  },
  twitter: {
    card: "summary",
    title: "Vellum — contract desk",
    description: "Ask what the contract actually says. Every answer backed by a verified quote.",
  },
};

export const viewport: Viewport = {
  themeColor: "#efe6d4",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${newsreader.variable} ${sourceSans.variable} ${ibm.variable} antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
