import { Alert } from "@/components/ui/alert";

// Only display a devOtp supplied by the server on an exact loopback hostname.
export function LocalOtpNotice({ code }: { code: string | null }) {
  if (
    typeof window === "undefined" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) ||
    !code || !/^\d{6}$/.test(code)
  ) return null;

  return <Alert tone="notice">Mã OTP thử (chỉ trên máy local): <strong className="tabular-nums">{code}</strong>. Nhập mã này vào các ô phía trên.</Alert>;
}
