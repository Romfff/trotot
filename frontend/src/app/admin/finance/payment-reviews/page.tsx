import { AdminPaymentReviewScreen } from "@/features/admin-finance/payment-review-screen";

export const metadata = {
  title: "Giao dịch cần đối soát | Trotot",
  robots: { index: false, follow: false },
};

export default function PaymentReviewsPage() {
  return <AdminPaymentReviewScreen />;
}
