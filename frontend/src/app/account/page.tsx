"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { authApi, apiError } from "@/lib/api/client";
import { clearSessionCache } from "@/lib/bootstrap-session";
import { Alert } from "@/components/ui/alert";
import type { User } from "@/lib/auth-types";
import { useState } from "react";
import { LogOut, Mail, Phone, ShieldCheck, UserRound } from "lucide-react";
import { InfoRow, ProfileHeader, ProfileSkeleton, StatusBadge } from "@/components/profile/profile-ui";
import "./stitch-account.css";

function HostPromotion({ user }: { user: User }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const eligible = user.status === "ACTIVE" && user.isPhoneVerified;
  return <div className="account-card account-role-card">
    <h2 className="mb-2 font-semibold text-ink">Dành cho chủ nhà</h2>
    <p className="mb-3 text-sm text-muted">Chuyển tài khoản để đăng và quản lý tin cho thuê của bạn.</p>
    {!eligible && <Alert tone="notice">Tài khoản cần hoạt động và xác thực số điện thoại để chuyển sang Chủ nhà.</Alert>}
    {error && <Alert>{error}</Alert>}
    <Button disabled={busy || !eligible} onClick={async () => {
      if (busy) return;
      setBusy(true); setError("");
      try { await authApi.becomeHost(); }
      catch (failure) { setError(apiError(failure).message); }
      finally { setBusy(false); }
    }}>{busy ? "Đang chuyển tài khoản…" : "Chuyển sang Chủ nhà"}</Button>
  </div>;
}

export default function AccountPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [logoutError, setLogoutError] = useState("");
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);
  const sessionId = useAuthStore((state) => state.sessionId);
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
  return <section className="account-page">
    <header className="account-page-heading"><h1>Hồ sơ tài khoản</h1><p>Thông tin cá nhân và các thao tác theo vai trò của bạn.</p></header>
    <section className="account-card account-identity">
    <h2 className="account-section-title"><UserRound size={22} aria-hidden="true" />Thông tin tài khoản</h2>
    <div className="account-identity-layout">
    <ProfileHeader fullName={user.fullName} role={user.role} />
    <dl className="account-details">
      <InfoRow label="Số điện thoại" icon={<Phone size={18} />}>{user.phone}</InfoRow>
      <InfoRow label="Email" icon={<Mail size={18} />}>{user.email || "Chưa cập nhật"}</InfoRow>
      <InfoRow label="Xác thực số điện thoại" icon={<ShieldCheck size={18} />}><StatusBadge tone={user.isPhoneVerified ? "verified" : "pending"}>{user.isPhoneVerified ? "Đã xác thực" : "Chưa xác thực"}</StatusBadge></InfoRow>
    </dl>
    </div>
    </section>
    {user.role === "TENANT" && <HostPromotion key={sessionId} user={user} />}
    {user.role === "HOST" && <div className="account-card account-role-card space-y-3">
      <Alert tone="success">Tài khoản Chủ nhà đã sẵn sàng.</Alert>
      <nav aria-label="Đăng tin cho thuê" className="grid gap-3 sm:grid-cols-2">
        <Link className="button button-secondary" href="/host/properties/create">Đăng tin trọ</Link>
        <Link className="button button-secondary" href="/host/homestays/create">Đăng homestay</Link>
      </nav>
    </div>}
    {user.role === "ADMIN" && <div className="account-card account-role-card"><h2 className="account-section-title">Quản trị tin đăng</h2><Link className="button" href="/admin/properties">Duyệt tin trọ dài hạn</Link></div>}
    <section className="account-card account-session">
    <h2 className="account-section-title"><LogOut size={22} aria-hidden="true" />Phiên đăng nhập</h2>
    <div className="account-session-action"><p>Đăng xuất khỏi tài khoản trên trình duyệt này.</p>
    {logoutError && <p role="alert" className="form-error">{logoutError}</p>}
    <Button variant="secondary" className="profile-logout" onClick={async () => { setLogoutError(""); try { await authApi.logout(); clearSessionCache(queryClient); router.replace("/"); } catch { setLogoutError("Đã đăng xuất trên thiết bị này, nhưng máy chủ chưa xác nhận thu hồi phiên."); } }}><LogOut size={17} aria-hidden="true" />Đăng xuất</Button>
    </div>
    </section>
  </section>;
}
