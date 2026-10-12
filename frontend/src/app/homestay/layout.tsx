import type { Metadata } from "next";

// Keep Sprint 3 outside indexing until real media/catalog/payment onboarding is accepted.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function HomestayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
