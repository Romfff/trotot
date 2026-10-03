import type { Metadata } from "next";
import { AuthForm } from "@/features/auth/auth-form";

export const metadata: Metadata = { title: "Đặt lại mật khẩu" };
export default function ResetPage() { return <AuthForm mode="reset" />; }
