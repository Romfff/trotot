"use client";
import { useEffect,useRef,useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { RotateCw,LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { bookingPaymentsApi,type BookingPaymentStatus,type BookingPaymentSession } from '@/lib/api/booking-payments';
import { apiError } from '@/lib/api/client';
import { decimalPriceLabel } from '@/lib/decimal-price-label';
import { useAuthStore } from '@/stores/auth-store';
import { subscribeBookingRealtime } from '@/lib/booking-realtime';
import { canPayBooking,preparePaymentSession,validatePaymentSession } from './payment-session';
import { LegalPaymentVoucher } from '@/components/booking/LegalBookingVoucher';
import '@/features/homestays/stitch-guest.css';

const deadline=(date:string)=>new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}).format(new Date(date));
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function BookingPaymentScreen({id}:{id:string}) {
  const {sessionId,status,user}=useAuthStore();
  return <div className="stitch-workflow-page stitch-payment-page mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
    <header><h1 className="text-xl font-semibold">Thanh toán đặt phòng</h1>
      <p className="mt-2 text-sm text-gray-600 text-pretty">Trạng thái được kiểm tra từ máy chủ. Quay lại từ cổng hoặc nhận thông báo không có nghĩa là đã thanh toán.</p></header>
    {!uuid.test(id)?<Alert>Đường dẫn đơn không hợp lệ.</Alert>:status==='initializing'?<p role="status">Đang kiểm tra phiên…</p>
      :status==='unavailable'?<Alert>Chưa kiểm tra được phiên. Hãy tải lại để thử lại.</Alert>
      :!user || !sessionId?<Link className="text-link underline" href={`/login?next=${encodeURIComponent(`/bookings/${id}/payment`)}`}>Đăng nhập để xem đơn của bạn</Link>
      :<PaymentContent key={`${sessionId}:${id}`} id={id} sessionId={sessionId} />}
    <Link className="text-link underline" href="/bookings">Về Đơn của tôi</Link>
  </div>;
}
function PaymentContent({id,sessionId}:{id:string;sessionId:string}) {
  const user=useAuthStore(s=>s.user);
  const query=useQuery({queryKey:['booking-payment-status',sessionId,id],queryFn:({signal})=>bookingPaymentsApi.status(id,signal),
    retry:false,gcTime:0,refetchOnWindowFocus:true});
  const [connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [prepared,setPrepared]=useState<{session:BookingPaymentSession;version:number}|null>(null);
  const [sound,setSound]=useState(false),[soundNotice,setSoundNotice]=useState('');
  const attempt=useRef<{version:number;key:string}|null>(null),inFlight=useRef(false),audio=useRef<AudioContext|null>(null);
  const seen=useRef<boolean|null>(null),refetch=useRef(query.refetch);refetch.current=query.refetch;
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  const current=()=>{const state=useAuthStore.getState();return mounted.current && state.sessionId===sessionId && state.status==='authenticated';};
  useEffect(()=>subscribeBookingRealtime(id,()=>{if(useAuthStore.getState().sessionId===sessionId)void refetch.current();},setConnected),[id,sessionId]);
  useEffect(()=>()=>{void audio.current?.close().catch(()=>{});},[]);
  useEffect(()=>{
    if(!query.data) return;
    const paid=query.data.payment?.verified===true && query.data.paymentStatus==='PAID';
    if(paid && seen.current===false && sound && audio.current?.state==='running') {
      try {const context=audio.current,tone=context.createOscillator(),volume=context.createGain();
        tone.frequency.value=660;volume.gain.value=0.08;tone.connect(volume);volume.connect(context.destination);
        tone.start();tone.stop(context.currentTime+0.2);tone.onended=()=>{tone.disconnect();volume.disconnect();};
      }catch {setSoundNotice('Trình duyệt chưa phát được âm thanh; trạng thái thanh toán vẫn được kiểm tra bình thường.');}
    }
    seen.current=paid;
  },[query.data,sound]);
  async function toggleSound() {
    if(sound) {setSound(false);return;}
    try {audio.current??=new AudioContext();await audio.current.resume();if(current()){setSound(audio.current.state==='running');setSoundNotice(audio.current.state==='running'?'':'Trình duyệt đang chặn âm thanh.');}}
    catch {if(current())setSoundNotice('Trình duyệt không hỗ trợ hoặc đang chặn âm thanh; bạn vẫn thanh toán bình thường.');}
  }
  async function action(open:boolean) {
    if(inFlight.current || !current()) return;inFlight.current=true;setBusy(true);setError('');
    try {
      if(open && prepared) {await validatePaymentSession(id,prepared.version,prepared.session);
        if(current())window.location.assign(prepared.session.redirectUrl);
      }else {
        const result=await preparePaymentSession(id,version=>{
          if(attempt.current?.version!==version)attempt.current={version,key:crypto.randomUUID()};return attempt.current!.key;
        },current);if(current())setPrepared(result);
      }
    }catch(failure){if(current())setError(apiError(failure).message);}
    finally {inFlight.current=false;if(current()){setBusy(false);void query.refetch();}}
  }
  const ready=prepared && query.data && canPayBooking(query.data) && query.data.version===prepared.version;
  return <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5" aria-label="Trạng thái thanh toán">
    {query.isError?<div className="space-y-3"><Alert>Chưa kiểm tra được trạng thái. {apiError(query.error).message}</Alert></div>:null}
    {!query.data && !query.isError?<div role="status" aria-label="Đang kiểm tra thanh toán" aria-busy="true" className="space-y-4 py-4">
      {[1,2,3,4].map(i=><div key={i} aria-hidden="true" className="h-5 w-2/3 rounded bg-gray-200 animate-pulse motion-reduce:animate-none" />)}</div>
      :query.data?<PaymentStatusDetails data={query.data} updating={query.isFetching}/>:null}
    {error?<Alert>{error} Bạn có thể thử lại; cùng phiên đơn sẽ dùng lại Idempotency-Key.</Alert>:null}
    <div className="flex flex-wrap gap-3">
      {query.data && canPayBooking(query.data)?<Button aria-busy={busy} aria-disabled={busy || query.isError || query.isFetching} onClick={()=>{if(!query.isError && !query.isFetching)void action(Boolean(ready));}}>
        {busy?<LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true"/>:null}{ready?'Mở VNPay Sandbox':'Chuẩn bị phiên VNPay Sandbox'}</Button>:null}
      <Button variant="secondary" aria-disabled={query.isFetching || busy} onClick={()=>{if(!query.isFetching && !busy)void query.refetch();}}><RotateCw className="size-4" aria-hidden="true" />Kiểm tra lại</Button>
      <Button variant="secondary" aria-pressed={sound} onClick={()=>void toggleSound()}>{sound?'Tắt âm thanh':'Bật âm thanh khi xác minh thành công'}</Button>
    </div>
    <p className="text-xs text-gray-600">{connected?'Đã nối thông báo realtime; mỗi thông báo sẽ kiểm tra lại API.':'Chưa nối realtime. Trạng thái được tải khi mở, quay lại tab hoặc bấm Kiểm tra lại.'}</p>
    {soundNotice?<p role="status" className="text-xs text-gray-600">{soundNotice}</p>:null}
    {query.data?<div className="pt-2"><LegalPaymentVoucher status={query.data} guestName={user?.fullName} guestPhone={user?.phone} /></div>:null}
  </section>;
}
export function PaymentStatusDetails({data,updating=false}:{data:BookingPaymentStatus;updating?:boolean}) {
  const verified=data.payment?.verified===true && data.paymentStatus==='PAID';
  return <div className="space-y-4" aria-busy={updating}>
    <dl className="@container space-y-3 text-sm">
      <div className="grid gap-1 @sm:grid-cols-[7rem_minmax(0,1fr)] @sm:gap-6"><dt className="text-gray-600">Mã đơn</dt><dd className="min-w-0 font-medium wrap-anywhere">{data.bookingCode}</dd></div>
      <div className="grid gap-1 @sm:grid-cols-[7rem_minmax(0,1fr)] @sm:gap-6"><dt className="text-gray-600">Tổng khách trả</dt><dd className="font-medium tabular-nums wrap-anywhere">{decimalPriceLabel(data.amount)}đ</dd></div>
    </dl>
    {verified?<p role="status" className="font-medium text-brand">Máy chủ đã xác minh thanh toán VNPay Sandbox.</p>
      :data.paymentStatus==='REFUNDED'?<p role="status">Đơn được ghi nhận đã hoàn tiền. Thanh toán gốc không làm đơn hoạt động trở lại.</p>
      :data.paymentStatus==='PAID'?<Alert tone="notice">Đơn có trạng thái đã trả nhưng chưa có chứng cứ gateway hợp lệ; cần đối soát, chưa xác nhận thành công ở màn này.</Alert>
      :data.reservationExpired?<Alert tone="notice">Đã qua hạn giữ phòng. Không thanh toán qua phiên cũ; máy chủ sẽ kiểm tra trạng thái đơn.</Alert>
      :data.bookingStatus==='PENDING_HOST_APPROVAL'?<p role="status">Chờ chủ nhà chấp nhận; chưa mở thanh toán.</p>
      :!data.providerConnected || data.paymentStatus==='NOT_CONFIGURED'?<p role="status">Chưa thanh toán.</p>
      :!canPayBooking(data)?<p role="status">Đơn không còn ở trạng thái có thể thanh toán.</p>:<p role="status">Chờ thanh toán qua VNPay Sandbox. Chưa có xác nhận từ cổng.</p>}
    {data.reservationExpiresAt?<p className="text-sm text-gray-600">Hạn giữ phòng: trước {deadline(data.reservationExpiresAt)} (giờ Việt Nam).</p>:null}
    <p className="text-xs text-gray-600">Máy chủ kiểm tra lúc {deadline(data.serverTime)}{updating?' · Đang cập nhật…':''}.</p>
  </div>;
}
