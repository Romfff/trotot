import { BookingPaymentScreen } from '@/features/payments/payment-screen';
export const metadata={robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;return <BookingPaymentScreen id={id}/>;
}
