const cooldownPrefix = "trotot_otp_cooldown_until";
let developmentOtp: { phone: string; code: string } | null = null;
let otpSendError: string | null = null;

function normalizedPhone(phone: string) {
  return phone.replace(/\D/g, "").replace(/^(?:0084|84)([1-9]\d{8})$/, "0$1");
}

function cooldownStorageKey(purpose: "VERIFY_PHONE" | "RESET_PASSWORD", phone: string) {
  return cooldownPrefix + ":" + purpose + ":" + normalizedPhone(phone);
}

export const authPending = {
  setOtp(code?: string, phone = "") {
    developmentOtp = code ? { phone, code } : null;
    otpSendError = null;
  },
  getOtp(phone = "") {
    if (!developmentOtp || (phone && normalizedPhone(developmentOtp.phone) !== normalizedPhone(phone))) return null;
    return developmentOtp.code;
  },
  setSendError(message: string) {
    otpSendError = message;
  },
  getSendError() {
    return otpSendError;
  },
  startCooldown(purpose: "VERIFY_PHONE" | "RESET_PASSWORD", phone: string, seconds = 60) {
    if (typeof window === "undefined" || !phone) return;
    try {
      window.sessionStorage.setItem(cooldownStorageKey(purpose, phone), String(Date.now() + seconds * 1000));
    } catch {
      // The server remains authoritative if browser storage is unavailable.
    }
  },
  getCooldownRemaining(purpose: "VERIFY_PHONE" | "RESET_PASSWORD", phone: string) {
    if (typeof window === "undefined" || !phone) return 0;
    try {
      const until = Number(window.sessionStorage.getItem(cooldownStorageKey(purpose, phone)));
      return Number.isFinite(until) ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
    } catch {
      return 0;
    }
  },
};
