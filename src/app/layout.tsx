import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Deep-init AI — Your 24/7 Autonomous Agent",
  description:
    "Deep-init AI is a full-time personal agent that lives on your computer and your Telegram. Pair the built-in bot or your own, connect any AI provider with automatic fallback, and let a self-directed agent work for you around the clock.",
  keywords: [
    "Deep-init",
    "AI agent",
    "autonomous agent",
    "personal assistant",
    "Telegram bot",
    "MCP",
    "AI providers",
    "fallback",
  ],
  authors: [{ name: "Deep-init AI" }],
  openGraph: {
    title: "Deep-init AI — Your 24/7 Autonomous Agent",
    description:
      "Pair your Telegram, connect any AI provider, answer a short wizard — your always-on agent takes over from there.",
    siteName: "Deep-init AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Deep-init AI",
    description: "Your 24/7 autonomous agent. Pair. Connect. Initialize.",
  },
};

export const viewport: Viewport = {
  themeColor: "#faf5ec",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
