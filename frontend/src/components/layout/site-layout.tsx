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
import { useAuthStore } from "@/stores/auth-store";
import { useToast } from "@/components/ToastContext";

function Brand() {
  return <Link href="/" className="wordmark" aria-label="Trotot — trang chủ">tro<span>tot</span></Link>;
}

function AccountAction() {
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
      queryClient.clear();
      router.replace("/");
    } catch {
      queryClient.clear();
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
            <DropdownMenuTrigger asChild><Button variant="secondary" aria-label="Mở menu tài khoản">{user.fullName.split(" ").at(-1)} <ChevronDown size={16} aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user.fullName}<span className="menu-role">{user.role}</span></DropdownMenuLabel>
              <DropdownMenuItem asChild><Link href="/account">Thông tin tài khoản</Link></DropdownMenuItem>
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

function NavItems() {
  const pathname = usePathname();
  const { showToast } = useToast();
  const isTro = pathname.startsWith("/thue-phong-tro") || pathname.startsWith("/phong-tro/");
  const isHomestay = pathname.startsWith("/homestay");
  return <>
    <Link href="/thue-phong-tro" className={isTro ? "active" : undefined} aria-current={isTro ? "page" : undefined}>Thuê trọ dài hạn</Link>
    <Link href="/homestay" className={isHomestay ? "active" : undefined} aria-current={isHomestay ? "page" : undefined}>Homestay</Link>
    <button type="button" onClick={() => showToast("Đăng tin dành cho chủ nhà chưa khả dụng.")}>Đăng tin</button>
  </>;
}

function BottomNavigation() {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const { showToast } = useToast();

  const accountHref = user ? "/account" : "/login";
  const accountActive = pathname === "/account" || ["/login", "/register", "/verify-otp", "/forgot-password", "/reset-password"].includes(pathname);
  const troActive = pathname.startsWith("/thue-phong-tro") || pathname.startsWith("/phong-tro/");
  const homestayActive = pathname.startsWith("/homestay");
  return <nav className="mobile-nav" aria-label="Điều hướng di động">
    <Link href="/" aria-current={pathname === "/" ? "page" : undefined} className={pathname === "/" ? "active" : undefined}><House size={20} aria-hidden="true" />Trang chủ</Link>
    <Link href="/thue-phong-tro" aria-current={troActive ? "page" : undefined} className={troActive ? "active" : undefined}><Search size={20} aria-hidden="true" />Thuê trọ</Link>
    <Link href="/homestay" aria-current={homestayActive ? "page" : undefined} className={homestayActive ? "active" : undefined}><Heart size={20} aria-hidden="true" />Homestay</Link>
    <button type="button" onClick={() => showToast("Quản lý chuyến đi sẽ khả dụng khi mở chức năng đặt phòng.")}><Calendar size={20} aria-hidden="true" />Chuyến đi</button>
    <Link href={accountHref} aria-current={accountActive ? "page" : undefined} className={accountActive ? "active" : undefined}><UserRound size={20} aria-hidden="true" />Tài khoản</Link>
  </nav>;
}

export function SiteLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const pathname = usePathname();
  const isAuthRoute = ["/login", "/register", "/verify-otp", "/forgot-password", "/reset-password"].includes(pathname);
  return <>
    <header className="site-header">
      <div className="site-header-inner">
        <Brand />
        <nav className="main-nav" aria-label="Điều hướng chính"><NavItems /></nav>
        <div className="nav-actions"><AccountAction /></div>
      </div>
    </header>
    <main className={isAuthRoute ? "page-main page-main-auth" : "page-main"}>
      {pathname === "/" || pathname.startsWith("/thue-phong-tro") || pathname.startsWith("/homestay") || pathname.startsWith("/phong-tro/") ? <div className="demo-notice" role="note">Dữ liệu phòng mẫu để xem giao diện. Đặt phòng và liên hệ chủ nhà chưa khả dụng.</div> : null}
      {children}
    </main>
    <footer className="site-footer">Trotot. Nền tảng thuê trọ minh bạch và đặt homestay theo đêm.</footer>
    <BottomNavigation key={user?.id || "guest"} />
  </>;
}
