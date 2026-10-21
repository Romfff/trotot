import type { Metadata } from "next";
import "./globals.css";
import { AppProviders } from "@/components/providers";
import { SiteLayout } from "@/components/layout/site-layout";
import { ToastProvider } from "@/components/ToastContext";
import { ChatProvider } from "@/features/chat/chat";
import type { Viewport } from "next";

export const metadata: Metadata = {
  title: { default: "TroTot — tìm nơi ở hợp với bạn", template: "%s | TroTot" },
  description: "Tìm phòng trọ và homestay phù hợp với bạn.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" data-js="1">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Luxury Resort & 5-Star Hospitality Font Pairing: Playfair Display (Display Headings) + Plus Jakarta Sans & Inter (Room Titles, Prices, Addresses & UI) */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,400;1,600&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <AppProviders><ToastProvider><ChatProvider><SiteLayout>{children}</SiteLayout></ChatProvider></ToastProvider></AppProviders>
      </body>
    </html>
  );
}
