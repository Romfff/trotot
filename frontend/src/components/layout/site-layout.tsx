"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Calendar, ChevronDown, Heart, House, LogOut, Search, UserRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { authApi } from "@/lib/api/client";
import { clearSessionCache } from "@/lib/bootstrap-session";
import { useAuthStore } from "@/stores/auth-store";
import { NotificationBell } from "./notification-bell";
import "./stitch-shell.css";

function Brand() {
  return (
    <Link href="/" className="wordmark" aria-label="Trotot — trang chủ">
      <div>tro<span>tot</span></div>
      <small className="wordmark-tag">VN · Living &amp; Stay</small>
    </Link>
  );
}

function AccountAction({ compact = false }: { compact?: boolean }) {
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [logoutError, setLogoutError] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);

  async function logout() {
    setBusy(true);
    setLogoutError("");
    try {
      await authApi.logout();
      clearSessionCache(queryClient);
      router.replace("/");
    } catch {
      clearSessionCache(queryClient);
      setLogoutError("Đã đăng xuất trên thiết bị này, nhưng máy chủ chưa xác nhận thu hồi phiên.");
      router.replace("/");
    } finally {
      setBusy(false);
      setLogoutOpen(false);
    }
  }

  return <>
    {logoutError ? <span className="logout-warning"><Alert>{logoutError}<button type="button" className="warning-dismiss" aria-label="Đóng thông báo" onClick={() => setLogoutError("")}>×</button></Alert></span> : null}
    {status === "initializing" ? <span className="session-loading" aria-live="polite">Đang kiểm tra phiên…</span>
      : user
        ? <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="secondary" aria-label="Mở menu tài khoản" className={compact ? "stitch-account-trigger" : undefined}>{compact ? <span aria-hidden="true">{user.fullName.trim().charAt(0).toUpperCase()}</span> : <>{user.fullName.split(" ").at(-1)} <ChevronDown size={16} aria-hidden="true" /></>}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user.fullName}<span className="menu-role">{user.role}</span></DropdownMenuLabel>
              <DropdownMenuItem asChild><Link href="/account">Thông tin tài khoản</Link></DropdownMenuItem>
              {user.role === "ADMIN" ? <DropdownMenuItem asChild><Link href="/admin">Tổng quan quản trị</Link></DropdownMenuItem> : null}
              {user.role === "ADMIN" ? <DropdownMenuItem asChild><Link href="/admin/users">Quản lý người dùng</Link></DropdownMenuItem> : null}
              {user.role === "ADMIN" ? <DropdownMenuItem asChild><Link href="/admin/finance/bank-accounts">Xác minh ngân hàng chủ nhà</Link></DropdownMenuItem> : null}
              {user.role === "ADMIN" ? <DropdownMenuItem asChild><Link href="/admin/finance/payouts">Lô chi trả chủ nhà</Link></DropdownMenuItem> : null}
              {user.role === "ADMIN" ? <DropdownMenuItem asChild><Link href="/admin/finance/refunds">Hoàn tiền thủ công</Link></DropdownMenuItem> : null}
              {user.role === "ADMIN" ? <DropdownMenuItem asChild><Link href="/admin/finance/complaints">Xử lý khiếu nại</Link></DropdownMenuItem> : null}
              {user.role === "ADMIN" ? <DropdownMenuItem asChild><Link href="/admin/finance/no-show-reports">Xác minh khách không đến</Link></DropdownMenuItem> : null}
              {user.role === "ADMIN" ? <DropdownMenuItem asChild><Link href="/admin/finance/payment-reviews">Giao dịch cần đối soát</Link></DropdownMenuItem> : null}
              {user.role === "HOST" ? <DropdownMenuItem asChild><Link href="/host/properties">Tin trọ của tôi</Link></DropdownMenuItem> : null}
              {user.role === "HOST" ? <DropdownMenuItem asChild><Link href="/host/homestays">Homestay của tôi</Link></DropdownMenuItem> : null}
              {user.role === "HOST" ? <DropdownMenuItem asChild><Link href="/host/calendar">Lịch và giá phòng</Link></DropdownMenuItem> : null}
              {user.role === "HOST" ? <DropdownMenuItem asChild><Link href="/host/finance">Sổ tài chính chủ nhà</Link></DropdownMenuItem> : null}
              {user.role === "HOST" ? <DropdownMenuItem asChild><Link href="/host/bank-account">Ngân hàng nhận tiền</Link></DropdownMenuItem> : null}
              {user.role === "TENANT" ? <DropdownMenuItem asChild><Link href="/my-appointments">Lịch xem trọ của tôi</Link></DropdownMenuItem> : null}
              {user.role === "HOST" ? <DropdownMenuItem asChild><Link href="/host/appointments">Lịch khách xem trọ</Link></DropdownMenuItem> : null}
              {user.role !== "ADMIN" ? <DropdownMenuItem asChild><Link href="/notifications">Thông báo lịch xem trọ</Link></DropdownMenuItem> : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setLogoutOpen(true)}><LogOut size={16} aria-hidden="true" />Đăng xuất</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
            <DialogContent aria-describedby="logout-description">
              <DialogHeader><DialogTitle>Đăng xuất khỏi TroTot?</DialogTitle></DialogHeader>
              <DialogDescription id="logout-description">Phiên trên thiết bị này sẽ được đóng. Bạn có thể đăng nhập lại bất cứ lúc nào.</DialogDescription>
              <DialogFooter>
                <Button variant="secondary" disabled={busy} onClick={() => setLogoutOpen(false)}>Ở lại</Button>
                <Button disabled={busy} onClick={() => void logout()}>{busy ? "Đang đăng xuất…" : "Đăng xuất"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
        : <><Link className="button button-secondary" href="/login">Đăng nhập</Link><Link className="button" href="/register">Đăng ký</Link></>}
  </>;
}

function NavItems({ showPosting = true }: { showPosting?: boolean }) {
  const pathname = usePathname();
  const isTro = pathname.startsWith("/thue-phong-tro") || pathname.startsWith("/phong-tro/");
  const isHomestay = pathname.startsWith("/homestay");
  const isPosting = pathname.startsWith("/host/properties") || pathname.startsWith("/host/homestays");
  return <>
    <Link href="/thue-phong-tro" className={isTro ? "active" : undefined} aria-current={isTro ? "page" : undefined}>Thuê trọ dài hạn</Link>
    <Link href="/homestay" className={isHomestay ? "active" : undefined} aria-current={isHomestay ? "page" : undefined}>Homestay</Link>
    {showPosting && <Link href="/host/properties/create" className={isPosting ? "active" : undefined} aria-current={isPosting ? "page" : undefined}>Đăng tin</Link>}
  </>;
}

function BottomNavigation() {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);

  const accountHref = user ? "/account" : "/login";
  const accountActive = pathname === "/account" || ["/login", "/register", "/verify-otp", "/forgot-password", "/reset-password"].includes(pathname);
  const troActive = pathname.startsWith("/thue-phong-tro") || pathname.startsWith("/phong-tro/");
  const homestayActive = pathname.startsWith("/homestay");
  return <nav className="mobile-nav" aria-label="Điều hướng di động">
    <Link href="/" aria-current={pathname === "/" ? "page" : undefined} className={pathname === "/" ? "active" : undefined}><House size={20} aria-hidden="true" />Trang chủ</Link>
    <Link href="/thue-phong-tro" aria-current={troActive ? "page" : undefined} className={troActive ? "active" : undefined}><Search size={20} aria-hidden="true" />Thuê trọ</Link>
    <Link href="/homestay" aria-current={homestayActive ? "page" : undefined} className={homestayActive ? "active" : undefined}><Heart size={20} aria-hidden="true" />Homestay</Link>
    <Link href="/bookings" aria-current={pathname==='/bookings'?'page':undefined} className={pathname==='/bookings'?'active':undefined}><Calendar size={20} aria-hidden="true" />Chuyến đi</Link>
    <Link href={accountHref} aria-current={accountActive ? "page" : undefined} className={accountActive ? "active" : undefined}><UserRound size={20} aria-hidden="true" />Tài khoản</Link>
  </nav>;
}

export function SiteLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const pathname = usePathname();
  const isAuthRoute = ["/login", "/register", "/verify-otp", "/forgot-password", "/reset-password"].includes(pathname);
  return <>
    <header className={`site-header stitch-header${pathname === "/thue-phong-tro" ? " stitch-header-explorer" : ""}`}>
      <div className="site-header-inner">
        <Brand />
        <nav className="main-nav" aria-label="Điều hướng chính"><NavItems showPosting={false} /></nav>
        <div className="nav-actions"><Link href="/host/properties/create" className="button stitch-posting"><span>Đăng tin</span><span className="btn__arrow" aria-hidden="true">→</span></Link><NotificationBell /><AccountAction compact /></div>
      </div>
    </header>
    <main className={isAuthRoute ? "page-main page-main-auth" : "page-main"}>
      <div key={pathname} className="page-transition-stage">
        {children}
      </div>
    </main>
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-grid">
          <div>
            <Link href="/" className="site-footer-brand">tro<span>tot</span></Link>
            <p className="site-footer-blurb">
              Nền tảng kết nối không gian sống minh bạch: từ phòng trọ dài hạn dự toán chi phí rõ ràng đến homestay nghỉ dưỡng đặt theo đêm.
            </p>
          </div>
          <div className="site-footer-col">
            <h4>Khám phá</h4>
            <ul>
              <li><Link href="/thue-phong-tro">Thuê phòng trọ dài hạn</Link></li>
              <li><Link href="/homestay">Homestay theo đêm</Link></li>
              <li><Link href="/bookings">Quản lý chuyến đi</Link></li>
            </ul>
          </div>
          <div className="site-footer-col">
            <h4>Dành cho Chủ nhà</h4>
            <ul>
              <li><Link href="/host/properties/create">Đăng tin phòng trọ</Link></li>
              <li><Link href="/host/homestays">Quản lý Homestay &amp; Lịch giá</Link></li>
              <li><Link href="/host/finance">Đối soát &amp; Sổ cái doanh thu</Link></li>
            </ul>
          </div>
          <div className="site-footer-col">
            <h4>Tiêu chuẩn Minh bạch</h4>
            <ul>
              <li><Link href="/thue-phong-tro">Dự toán điện · nước · dịch vụ</Link></li>
              <li><Link href="/homestay">Báo giá ký số &amp; Giữ chỗ 3 lớp</Link></li>
              <li><Link href="/account">Bảo mật tài khoản &amp; Xác thực</Link></li>
            </ul>
          </div>
        </div>
        <div className="site-footer-bottom">
          <span>© 2026 TroTot Platform · Vietnam Living &amp; Stay</span>
          <span>Trotot. Nền tảng thuê trọ minh bạch và đặt homestay theo đêm.</span>
        </div>
      </div>
    </footer>
    <BottomNavigation key={user?.id || "guest"} />
  </>;
}
