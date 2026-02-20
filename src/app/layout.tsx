import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "../styles/performance-optimizations.css";
import { SessionProvider } from "@/components/SessionProvider";
import { InAppBrowserDetector } from "@/components/ui/InAppBrowserDetector";
import { AIChatBootstrap } from "@/components/ai-chat/AIChatBootstrap";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Clira",
  description: "Your AI-powered email assistant for Gmail",
  verification: {
    google: "4vrMfdYbYAd3FwALaLychRzGvV9CQTbFvqyzA4y92Aw",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <SessionProvider>
          <InAppBrowserDetector>
            {children}
            <AIChatBootstrap />
          </InAppBrowserDetector>
        </SessionProvider>
      </body>
    </html>
  );
}
