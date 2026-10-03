import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/auth-form";

export const metadata: Metadata = { title: "Quên mật khẩu" };
export default function ForgotPage() { return <AuthForm mode="forgot" />; }
