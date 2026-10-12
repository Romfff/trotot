import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/auth-form";

export const metadata: Metadata = { title: "Xác thực số điện thoại" };
export default function VerifyPage() { return <AuthForm mode="verify" />; }
