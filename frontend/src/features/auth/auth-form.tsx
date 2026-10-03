"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "@/components/ui/password-input";
import { ApiError } from "@/lib/auth-types";
import { apiError, authApi } from "@/lib/api/client";
import { authPending } from "@/lib/auth-pending";

export type AuthMode = "login" | "register" | "verify" | "forgot" | "reset";
const titles: Record<AuthMode, { title: string; description: string }> = {
  login: { title: "Đăng nhập", description: "" },
  register: { title: "Tạo tài khoản", description: "" },
  verify: { title: "Xác thực OTP", description: "Nhập mã OTP gồm 6 chữ số để xác thực số điện thoại." },
  forgot: { title: "Bạn quên mật khẩu?", description: "Nhập số điện thoại để nhận mã đặt lại mật khẩu." },
  reset: { title: "Đặt mật khẩu mới", description: "Nhập mã OTP và chọn mật khẩu mới cho tài khoản." },
};

function ErrorText({ error }: { error: unknown }) {
  return <Alert>{apiError(error).message}</Alert>;
}

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [otpSendFailed, setOtpSendFailed] = useState("");
  const [developmentOtp, setDevelopmentOtp] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const title = titles[mode];

  useEffect(() => {
    const savedPhone = sessionStorage.getItem("trotot_pending_phone") || "";
    setPhone(savedPhone);
    setOtpSendFailed(authPending.getSendError() || "");
    setDevelopmentOtp(authPending.getOtp(savedPhone));
    if (mode === "verify" || mode === "reset" || mode === "forgot") {
      setResendIn(authPending.getCooldownRemaining(mode === "verify" ? "VERIFY_PHONE" : "RESET_PASSWORD", savedPhone));
    }
    const query = new URLSearchParams(window.location.search);
    if (mode === "login" && query.get("verified") === "1") setNotice("Số điện thoại đã được xác thực. Bạn có thể đăng nhập.");
    if (mode === "login" && query.get("passwordReset") === "1") setNotice("Mật khẩu đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới.");
    if (mode === "login" && query.get("sessionExpired") === "1") setNotice("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    if (mode === "reset" && query.get("sent") === "1") setNotice("Nếu số điện thoại có tài khoản, mã đặt lại sẽ được gửi theo phương thức đã cấu hình.");
  }, [mode]);

  useEffect(() => {
    if (!resendIn) return;
    const timer = window.setTimeout(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const errorFields = useMemo(() => error instanceof ApiError ? error.fieldErrors : {}, [error]);

  async function resendOtp(nextPhone: string, purpose: "VERIFY_PHONE" | "RESET_PASSWORD") {
    let sent: Awaited<ReturnType<typeof authApi.sendOtp>>;
    try {
      sent = purpose === "VERIFY_PHONE"
        ? await authApi.sendOtp({ phone: nextPhone, purpose })
        : await authApi.forgotPassword({ phone: nextPhone });
    } catch (caught) {
      if (apiError(caught).status === 429) {
        authPending.startCooldown(purpose, nextPhone);
        setResendIn(authPending.getCooldownRemaining(purpose, nextPhone));
      }
      throw caught;
    }
    authPending.setOtp(sent.devOtp, nextPhone);
    authPending.startCooldown(purpose, nextPhone);
    setDevelopmentOtp(sent.devOtp || null);
    setResendIn(60);
    setOtpSendFailed("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) || "").trim();
    try {
      if (mode === "register" || mode === "reset") {
        const passwordField = mode === "register" ? "password" : "newPassword";
        if (String(form.get(passwordField) || "") !== String(form.get("confirmPassword") || "")) {
          setError(new ApiError(400, "PASSWORD_MISMATCH", "Hai mật khẩu chưa khớp.", { confirmPassword: "Nhập lại đúng mật khẩu." }));
          return;
        }
      }
      if (mode === "login") {
        await authApi.login({ phone: value("phone"), password: String(form.get("password") || "") });
        router.replace("/account");
      } else if (mode === "register") {
        const newPhone = value("phone");
        await authApi.register({ fullName: value("fullName"), phone: newPhone, password: String(form.get("password") || ""), ...(value("email") ? { email: value("email") } : {}) });
        sessionStorage.setItem("trotot_pending_phone", newPhone);
        setPhone(newPhone);
        try {
          await resendOtp(newPhone, "VERIFY_PHONE");
        } catch (sendError) {
          const message = apiError(sendError).message;
          authPending.setSendError(message);
          setOtpSendFailed(message);
        }
        router.push("/verify-otp");
      } else if (mode === "verify") {
        const result = await authApi.verifyOtp({ phone: value("phone"), code: value("code") });
        authPending.setOtp();
        sessionStorage.removeItem("trotot_pending_phone");
        setNotice(`Đã xác thực số điện thoại ${result.phone}. Bây giờ bạn có thể đăng nhập.`);
        router.replace("/login?verified=1");
      } else if (mode === "forgot") {
        const newPhone = value("phone");
        const sent = await authApi.forgotPassword({ phone: newPhone });
        sessionStorage.setItem("trotot_pending_phone", newPhone);
        authPending.setOtp(sent.devOtp, newPhone);
        authPending.startCooldown("RESET_PASSWORD", newPhone);
        setResendIn(60);
        setDevelopmentOtp(sent.devOtp || null);
        setPhone(newPhone);
        router.replace("/reset-password?sent=1");
      } else {
        await authApi.resetPassword({ phone: value("phone"), code: value("code"), newPassword: String(form.get("newPassword") || "") });
        authPending.setOtp();
        sessionStorage.removeItem("trotot_pending_phone");
        router.replace("/login?passwordReset=1");
      }
    } catch (caught) {
      setError(caught);
      if (mode === "forgot" && apiError(caught).status === 429) {
        const attemptedPhone = value("phone");
        authPending.startCooldown("RESET_PASSWORD", attemptedPhone);
        setResendIn(authPending.getCooldownRemaining("RESET_PASSWORD", attemptedPhone));
      }
      if (mode === "login" && apiError(caught).errorCode === "PHONE_NOT_VERIFIED") {
        const unverifiedPhone = value("phone");
        setPhone(unverifiedPhone);
        sessionStorage.setItem("trotot_pending_phone", unverifiedPhone);
        try {
          await resendOtp(unverifiedPhone, "VERIFY_PHONE");
        } catch (sendError) {
          const sendMessage = apiError(sendError).message;
          authPending.setSendError(sendMessage);
          setOtpSendFailed(sendMessage);
        }
        router.push("/verify-otp");
      }
    } finally {
      setBusy(false);
    }
  }

  async function retrySendOtp() {
    setError(null);
    setBusy(true);
    try { await resendOtp(phone, mode === "verify" ? "VERIFY_PHONE" : "RESET_PASSWORD"); }
    catch (caught) { setError(caught); }
    finally { setBusy(false); }
  }

  return <section className="auth-page">
    <div className="auth-card">
      <div className="auth-form-panel">
        <h1 className="auth-title">{title.title}</h1>
        {title.description ? <p className="auth-description">{title.description}</p> : null}
        {error ? <div className="form-message"><ErrorText error={error} /></div> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {mode === "verify" && otpSendFailed ? <div className="form-message"><Alert tone="notice">{otpSendFailed}</Alert></div> : null}
        {mode === "reset" && <Alert tone="notice">Nếu số điện thoại có tài khoản, mã đặt lại sẽ được gửi theo phương thức đã cấu hình.</Alert>}
        <form className="auth-form" onSubmit={submit}>
          {(mode === "register") && <Input name="fullName" label="Họ và tên" placeholder="Nhập họ và tên của bạn" autoComplete="name" maxLength={150} required error={errorFields.fullName} />}
          {(mode === "login" || mode === "register" || mode === "forgot" || mode === "verify" || mode === "reset") && <Input name="phone" label="Số điện thoại" placeholder="Nhập số điện thoại" autoComplete="tel" inputMode="tel" maxLength={16} minLength={9} pattern="\+?[0-9\s().-]{9,20}" required value={phone} onChange={(event) => {
            const nextPhone = event.target.value;
            setPhone(nextPhone);
            setDevelopmentOtp(authPending.getOtp(nextPhone));
            if (mode !== "login" && mode !== "register") {
              setResendIn(authPending.getCooldownRemaining(mode === "verify" ? "VERIFY_PHONE" : "RESET_PASSWORD", nextPhone));
            }
          }} error={errorFields.phone} />}
          {(mode === "register") && <Input name="email" label="Email" placeholder="Nhập địa chỉ email" autoComplete="email" type="email" maxLength={255} error={errorFields.email} />}
          {mode === "login" && <PasswordInput name="password" label="Mật khẩu" placeholder="Nhập mật khẩu" autoComplete="current-password" required />}
          {mode === "register" && <><PasswordInput name="password" label="Mật khẩu" placeholder="Tạo mật khẩu" autoComplete="new-password" required requireLetterAndNumber error={errorFields.password} /><p className="password-rules">Tối thiểu 8 ký tự, gồm chữ cái và chữ số.</p></>}
          {mode === "register" && <PasswordInput name="confirmPassword" label="Xác nhận mật khẩu" placeholder="Nhập lại mật khẩu" autoComplete="new-password" required error={errorFields.confirmPassword} />}
          {(mode === "verify" || mode === "reset") && <OtpInput name="code" label="Mã xác thực" placeholder="Nhập mã 6 chữ số" required error={errorFields.code} />}
          {mode === "reset" && <><PasswordInput name="newPassword" label="Mật khẩu mới" placeholder="Tạo mật khẩu mới" autoComplete="new-password" required requireLetterAndNumber error={errorFields.newPassword} /><PasswordInput name="confirmPassword" label="Nhập lại mật khẩu mới" placeholder="Nhập lại mật khẩu mới" autoComplete="new-password" required error={errorFields.confirmPassword} /></>}
          {mode === "login" && <div className="form-row"><span>Đăng nhập an toàn</span><Link className="text-link" href="/forgot-password">Quên mật khẩu?</Link></div>}
          <Button className="full-width" type="submit" disabled={busy || (mode === "forgot" && resendIn > 0)}>{busy ? "Đang xử lý…" : mode === "forgot" && resendIn > 0 ? `Gửi lại mã sau ${resendIn}s` : mode === "login" ? "Đăng nhập" : mode === "register" ? "Tạo tài khoản" : mode === "verify" ? "Xác thực số điện thoại" : mode === "forgot" ? "Gửi mã xác thực" : "Đặt lại mật khẩu"}</Button>
          {(mode === "verify" || mode === "reset") && <Button variant="plain" type="button" className="full-width" disabled={busy || resendIn > 0 || !phone} onClick={() => void retrySendOtp()}>{resendIn > 0 ? `Gửi lại mã sau ${resendIn}s` : "Gửi lại mã OTP"}</Button>}
          {mode === "verify" && developmentOtp && <Alert tone="notice">OTP mô phỏng chỉ dành cho local/dev: <strong>{developmentOtp}</strong>.</Alert>}
          {mode === "reset" && developmentOtp && <Alert tone="notice">OTP mô phỏng chỉ dành cho local/dev: <strong>{developmentOtp}</strong>.</Alert>}
        </form>
        <p className="auth-switch">{mode === "login" ? <>Chưa có tài khoản? <Link className="text-link" href="/register">Đăng ký ngay</Link></> : mode === "register" ? <>Đã có tài khoản? <Link className="text-link" href="/login">Đăng nhập</Link></> : mode === "verify" ? <>Đã xác thực rồi? <Link className="text-link" href="/login">Đăng nhập</Link></> : mode === "forgot" ? <Link className="text-link" href="/login">Quay lại đăng nhập</Link> : <Link className="text-link" href="/forgot-password">Gửi mã mới</Link>}</p>
      </div>
    </div>
  </section>;
}
