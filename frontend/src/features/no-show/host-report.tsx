"use client";

import {useEffect,useRef,useState,type FormEvent} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {Alert} from "@/components/ui/alert";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {apiError} from "@/lib/api/client";
import type {Booking} from "@/lib/api/homestays";
import {noShowApi,type NoShowInput,type NoShowReport} from "@/lib/api/no-show";
import {useAuthStore} from "@/stores/auth-store";
import {bankNeedsReplay} from "@/features/host-finance/bank-form";
import {canReportNoShow,noShowFieldErrors} from "./form";

export function HostNoShowReport({booking,sessionId,disabled,setLock}:{booking:Booking;sessionId:string;disabled:boolean;setLock:(id:string,lock:boolean)=>boolean}) {
  const client=useQueryClient();
  const scope=`${sessionId}:${booking.bookingId}`;
  const [open,setOpen]=useState(false),[reason,setReason]=useState("");
  const [error,setError]=useState(""),[fieldError,setFieldError]=useState("");
  const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const [receipt,setReceipt]=useState<NoShowReport|null>(null);
  const attempt=useRef<{key:string;body:NoShowInput}|null>(null);
  const inFlight=useRef(false),mounted=useRef(false),ownsLock=useRef(false);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;if(ownsLock.current){setLock(scope,false);ownsLock.current=false;}};},[scope,setLock]);
  const isCurrent=()=>{
    const state=useAuthStore.getState();
    return mounted.current&&state.sessionId===sessionId&&state.status==="authenticated"&&state.user?.role==="HOST"&&state.user.status==="ACTIVE";
  };
  const release=()=>{if(ownsLock.current){setLock(scope,false);ownsLock.current=false;}};
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(inFlight.current||disabled||!isCurrent()||receipt)return;
    if(!attempt.current){
      if(!canReportNoShow(booking))return;
      const invalid=noShowFieldErrors({reason,evidenceNote:""},"host").reason;
      setFieldError(invalid||"");
      if(invalid){event.currentTarget.querySelector<HTMLInputElement>('[name="reason"]')?.focus();return;}
      if(!setLock(scope,true))return;
      ownsLock.current=true;
      attempt.current={key:crypto.randomUUID(),body:{expectedVersion:booking.version,reason}};
    }
    const sent=attempt.current;
    inFlight.current=true;setBusy(true);setError("");
    try {
      const saved=await noShowApi.report(booking.bookingId,sent.body,sent.key);
      if(!isCurrent())return;
      setReceipt(saved);attempt.current=null;setUncertain(false);release();
      void client.invalidateQueries({queryKey:["bookings",sessionId]});
    } catch(failure){
      if(!isCurrent())return;
      const issue=apiError(failure),replay=bankNeedsReplay(issue);
      setUncertain(replay);
      setError(replay?"Chưa xác nhận được kết quả. Giữ nguyên lý do và bấm thử lại; chưa thao tác khác trên đơn này.":issue.message);
      setFieldError(issue.fieldErrors.reason||"");
      if(!replay){attempt.current=null;release();}
      if(issue.errorCode==="STALE_BOOKING_VERSION"||issue.errorCode==="NO_SHOW_ALREADY_REPORTED")void client.invalidateQueries({queryKey:["bookings",sessionId]});
    } finally {
      inFlight.current=false;
      if(isCurrent())setBusy(false);
    }
  }
  // Keep an uncertain attempt even if polling returns a newer booking version.
  if(!canReportNoShow(booking)&&!attempt.current&&!receipt)return null;
  if(receipt)return <p role="status" className="border-t border-gray-200 pt-4 text-sm text-primary-dark">Đã gửi báo cáo khách không đến. Admin sẽ xác minh; trạng thái đơn và thanh toán chưa thay đổi.</p>;
  return <section className="min-w-0 space-y-4 border-t border-gray-200 pt-4" aria-label="Báo khách không đến">
    {!open?<Button variant="secondary" aria-expanded={false} aria-disabled={disabled} onClick={()=>{if(!disabled)setOpen(true);}}>Báo khách không đến</Button>
      :<form onSubmit={submit} noValidate aria-label="Báo cáo khách không đến" className="space-y-4">
        <header><h3 className="text-base font-semibold">Báo khách không đến</h3><p className="mt-1 text-sm text-gray-600">Chỉ gửi sau giờ nhận phòng. Admin xác minh báo cáo; thao tác này không hoàn tất đơn hay chuyển tiền.</p></header>
        {error?<Alert>{error}</Alert>:null}
        <Input id={`no-show-reason-${booking.bookingId}`} name="reason" label="Lý do báo cáo" required value={reason} error={fieldError}
          hint={reason.trim().length>=400?`${reason.trim().length}/500 ký tự; tối đa 500 ký tự.`:"Mô tả ngắn, từ 1 đến 500 ký tự. Không nhập số điện thoại hoặc thông tin ngân hàng."}
          className="text-base md:text-sm" readOnly={busy||uncertain} autoComplete="off"
          onChange={event=>{setReason(event.target.value);setFieldError("");}} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" aria-disabled={busy||uncertain} onClick={()=>{if(!busy&&!uncertain){setOpen(false);setError("");setFieldError("");}}}>Đóng</Button>
          <Button type="submit" aria-busy={busy} aria-disabled={busy||disabled} onClick={event=>{if(busy||disabled)event.preventDefault();}}>
            {busy?"Đang gửi…":uncertain?"Thử lại cùng lý do":"Gửi báo cáo"}
          </Button>
        </div>
      </form>}
  </section>;
}
