import type { Metadata } from "next";
import "./globals.css";
import { AppProviders } from "@/components/providers";
import { SiteLayout } from "@/components/layout/site-layout";
import { ToastProvider } from "@/components/ToastContext";
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
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* App Router root layout loads this stylesheet for every route. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        <AppProviders><ToastProvider><SiteLayout>{children}</SiteLayout></ToastProvider></AppProviders>
      </body>
    </html>
  );
}
