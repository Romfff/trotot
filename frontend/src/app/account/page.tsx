"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { authApi } from "@/lib/api/client";
import { useState } from "react";
import { LogOut, Mail, Phone, ShieldCheck, UserRound } from "lucide-react";
import { InfoRow, ProfileHeader, ProfileSkeleton, StatusBadge } from "@/components/profile/profile-ui";

export default function AccountPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [logoutError, setLogoutError] = useState("");
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);
  if (status === "initializing") return <section className="account-card" aria-live="polite"><ProfileSkeleton /></section>;
  if (!user) return <section className="account-card profile-empty">
    <div className="profile-avatar"><UserRound size={30} aria-hidden="true" /></div>
    <h1>{status === "unavailable" ? "Chưa thể tải tài khoản" : "Bạn chưa đăng nhập"}</h1>
    {status !== "unavailable" && <p>Đăng nhập để xem thông tin tài khoản của bạn.</p>}
    {status === "unavailable" && <p role="alert" className="form-error">Chưa thể kiểm tra phiên đăng nhập. Vui lòng thử lại khi kết nối ổn định.</p>}
    {logoutError && <p role="alert" className="form-error">{logoutError}</p>}
    {status === "unavailable"
      ? <Button onClick={() => window.dispatchEvent(new Event("trotot:retry-session"))}>Thử lại</Button>
      : <Link className="button" href="/login">Đăng nhập</Link>}
  </section>;
  return <section className="account-card">
    <ProfileHeader fullName={user.fullName} role={user.role} />
    <dl className="account-details">
      <InfoRow label="Số điện thoại" icon={<Phone size={18} />}>{user.phone}</InfoRow>
      <InfoRow label="Email" icon={<Mail size={18} />}>{user.email || "Chưa cập nhật"}</InfoRow>
      <InfoRow label="Xác thực số điện thoại" icon={<ShieldCheck size={18} />}><StatusBadge tone={user.isPhoneVerified ? "verified" : "pending"}>{user.isPhoneVerified ? "Đã xác thực" : "Chưa xác thực"}</StatusBadge></InfoRow>
    </dl>
    {logoutError && <p role="alert" className="form-error">{logoutError}</p>}
    <Button variant="secondary" className="profile-logout" onClick={async () => { setLogoutError(""); try { await authApi.logout(); queryClient.clear(); router.replace("/"); } catch { setLogoutError("Đã đăng xuất trên thiết bị này, nhưng máy chủ chưa xác nhận thu hồi phiên."); } }}><LogOut size={17} aria-hidden="true" />Đăng xuất</Button>
  </section>;
}
