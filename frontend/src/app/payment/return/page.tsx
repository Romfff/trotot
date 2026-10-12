import Link from 'next/link';
import '@/features/homestays/stitch-guest.css';
export const metadata={robots:{index:false,follow:false}};
export default function Page() {
  // Return parameters are untrusted. Only server IPN/API may establish paid state.
  return <div className="stitch-workflow-page stitch-payment-page mx-auto max-w-2xl space-y-4 p-4 sm:p-6"><h1 className="text-xl font-semibold">Kiểm tra kết quả thanh toán</h1>
    <p className="text-sm text-gray-600 text-pretty">Bạn đã quay lại từ cổng thanh toán. Thông tin trên đường dẫn không xác nhận đã trả tiền. Mở đơn của bạn để máy chủ kiểm tra giao dịch.</p>
    <Link className="button" href="/bookings">Mở Đơn của tôi</Link></div>;
}
