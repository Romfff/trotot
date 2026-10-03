import type { ReactNode } from "react";
import { Check, Clock3 } from "lucide-react";

export function StatusBadge({ children, tone = "role" }: { children: ReactNode; tone?: "role" | "verified" | "pending" }) {
  return <span className={`profile-badge profile-badge-${tone}`}>
    {tone === "verified" ? <Check size={14} aria-hidden="true" /> : tone === "pending" ? <Clock3 size={14} aria-hidden="true" /> : null}
    {children}
  </span>;
}

export function ProfileHeader({ fullName, role }: { fullName: string; role: string }) {
  return <header className="profile-header">
    <div className="profile-avatar" aria-hidden="true">{fullName.trim().charAt(0).toLocaleUpperCase("vi-VN")}</div>
    <div className="profile-heading">
      <p className="profile-eyebrow">Tài khoản của bạn</p>
      <h1>{fullName}</h1>
      <StatusBadge>{role}</StatusBadge>
    </div>
  </header>;
}

export function InfoRow({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return <div className="profile-info-row">
    <dt><span className="profile-info-icon" aria-hidden="true">{icon}</span>{label}</dt>
    <dd>{children}</dd>
  </div>;
}

export function ProfileSkeleton() {
  return <>
    <p className="profile-loading-label">Đang kiểm tra phiên đăng nhập…</p>
    <div className="profile-skeleton" aria-hidden="true">
      <div className="profile-header"><span className="profile-skeleton-avatar" /><div className="profile-heading"><span className="profile-skeleton-name" /><span className="profile-skeleton-badge" /></div></div>
      <div className="profile-skeleton-rows">{[0, 1, 2].map((key) => <div key={key}><span /><span /></div>)}</div>
      <span className="profile-skeleton-button" />
    </div>
  </>;
}
