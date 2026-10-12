import type { Metadata } from "next";
import type { ReactNode } from "react";
import './stitch-admin.css';
export const metadata: Metadata = { title: "Quản trị | trotot", robots: { index: false, follow: false } };
export default function AdminLayout({ children }: { children: ReactNode }) { return <div className="stitch-admin-surface">{children}</div>; }
