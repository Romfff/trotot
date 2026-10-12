"use client";

import {useRef,useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {Alert} from "@/components/ui/alert";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {apiError} from "@/lib/api/client";
import {ApiError} from "@/lib/auth-types";
import {adminPayoutsApi,type AdminPayoutDetail} from "@/lib/api/payouts";
import {debtSettlementsApi} from "@/lib/api/debt-settlements";
import {bankNeedsReplay} from "@/features/host-finance/bank-form";
import {useAuthStore} from "@/stores/auth-store";
import {payoutFieldErrors,type PayoutFields,type PayoutOperation} from "./payout-form";

const empty={hostId:"",reason:"",bankReference:"",evidenceNote:""};
type Props={sessionId:string;row?:AdminPayoutDetail;creating?:boolean;readBusy?:boolean;locked:boolean;setLocked:(value:boolean)=>void;onCreated?:(id:string)=>void};
export function PayoutActions({sessionId,row,creating=false,readBusy=false,locked,setLocked,onCreated}:Props) {
  const client=useQueryClient(),form=useRef<HTMLFormElement>(null),inFlight=useRef(false);
  const [fields,setFields]=useState<PayoutFields>(empty),[errors,setErrors]=useState<Partial<Record<keyof PayoutFields,string>>>({});
  const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState(""),[saved,setSaved]=useState(false);
  const attempt=useRef<{action:PayoutOperation;body:PayoutFields;version:number;id:string;amount:string;key:string}|null>(null);
  const current=()=>{const state=useAuthStore.getState();return state.sessionId===sessionId&&state.status==="authenticated"&&state.user?.role==="ADMIN"&&state.user.status==="ACTIVE";};
  const allowed=(action:PayoutOperation)=>!readBusy&&(action==="create"?creating:!!row&&row.version<2147483647&&({
    approve:row.status==="DRAFT"&&!row.operations.reviewRequired&&row.operations.canApprove,
    cancel:["DRAFT","APPROVED"].includes(row.status)&&row.operations.canCancel,
    confirmPaid:row.status==="APPROVED"&&!row.operations.reviewRequired&&row.operations.canConfirmPaid,
  })[action]);
  async function submit(action:PayoutOperation) {
    if(inFlight.current||!current())return;
    if(!attempt.current) {
      if(locked||!allowed(action))return;
      const invalid=payoutFieldErrors(fields,action);setErrors(invalid);
      const first=Object.keys(invalid)[0];if(first){form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();return;}
      attempt.current={action,body:{...fields},version:row?.version??0,id:row?.id??"",amount:row?.amount??"",key:crypto.randomUUID()};
    }
    const sent=attempt.current;inFlight.current=true;setBusy(true);setLocked(true);setSaved(false);setMessage("");
    try {
      let created:string|undefined,offsetOnly=false;
      if(sent.action==="create") {
        const settlement=await debtSettlementsApi.create({hostId:sent.body.hostId.trim(),reason:sent.body.reason},sent.key);
        created=settlement.batchId??undefined;offsetOnly=settlement.batchId===null;
      }
      else if(sent.action==="confirmPaid") {
        const result=await adminPayoutsApi.confirmPaid(sent.id,{expectedVersion:sent.version,reason:sent.body.reason,bankReference:sent.body.bankReference,evidenceNote:sent.body.evidenceNote},sent.key);
        if(result.amount!==sent.amount)throw new ApiError(502,"INVALID_PAYOUT_RESPONSE","Chưa thể xác nhận kết quả ghi sổ.");
      }else await adminPayoutsApi[sent.action](sent.id,{expectedVersion:sent.version,reason:sent.body.reason},sent.key);
      if(!current())return;
      attempt.current=null;setUncertain(false);setLocked(false);setSaved(true);setFields(empty);
      if(offsetOnly)setMessage("Đã ghi bù trừ toàn bộ khoản đủ điều kiện. Không lập lô 0đ và không chuyển tiền.");
      if(created)onCreated?.(created);
      await client.invalidateQueries({queryKey:["admin-payout-detail",sessionId,sent.id]});
      void client.invalidateQueries({queryKey:["admin-payouts",sessionId]});
    }catch(failure) {
      if(!current())return;
      const error=apiError(failure),replay=bankNeedsReplay(error);setUncertain(replay);setLocked(replay);setErrors(error.fieldErrors);
      setMessage(replay?"Chưa rõ kết quả ghi sổ. Thử lại cùng yêu cầu; không chuyển tiền ngân hàng lần nữa và không đổi lô.":error.message);
      if(!replay){attempt.current=null;void client.invalidateQueries({queryKey:["admin-payout-detail",sessionId]});void client.invalidateQueries({queryKey:["admin-payouts",sessionId]});}
    }finally{inFlight.current=false;if(current())setBusy(false);}
  }
  async function exportCsv() {
    if(inFlight.current||locked||readBusy||row?.status!=="APPROVED"||row.operations.reviewRequired||!row.operations.canExport||!current())return;
    inFlight.current=true;setBusy(true);setLocked(true);setMessage("");setSaved(false);
    try {
      const result=await adminPayoutsApi.exportCsv(row.id);
      if(!current())return;
      if(result.filename!==`payout-${row.id.toLowerCase()}-v${row.version}.csv`)throw new ApiError(409,"STALE_PAYOUT_VERSION","Lô đã thay đổi. Tải lại trước khi xuất CSV.");
      const url=URL.createObjectURL(new Blob([result.csv],{type:"text/csv;charset=utf-8"})),link=document.createElement("a");
      try{link.href=url;link.download=result.filename;document.body.appendChild(link);link.click();}finally{link.remove();URL.revokeObjectURL(url);}
      setMessage("Đã xuất CSV. Việc xuất không chuyển tiền và không xác nhận đã chi trả.");
    }catch(failure){if(current())setMessage(apiError(failure).message);}finally{inFlight.current=false;if(current()){setBusy(false);setLocked(false);}}
  }
  const terminal=row?.status==="PAID"||row?.status==="CANCELLED";
  const names:(keyof PayoutFields)[]=creating?["hostId","reason"]:terminal?[]:row?.status==="APPROVED"?["reason","bankReference","evidenceNote"]:["reason"];
  // Keep a pending attempt mounted even if a background detail read fails or changes status.
  const visibleNames=uncertain&&attempt.current?.action==="confirmPaid"?["reason","bankReference","evidenceNote"] as (keyof PayoutFields)[]:names;
  return <form ref={form} onSubmit={event=>event.preventDefault()} aria-label={creating?"Tạo lô chi trả":"Thao tác lô chi trả"} className={creating?"space-y-4":"space-y-4 border-t border-gray-200 pt-4"}>
    <h3 className="text-base font-semibold">{creating?"Quyết toán và lập lô":"Xử lý lô"}</h3>
    {!creating?<Alert tone="notice">Chỉ xác nhận đã chi trả sau khi tự chuyển tiền và kiểm tra mã giao dịch, chứng cứ. Hệ thống không chuyển tiền thay Admin.</Alert>:<p className="text-sm text-gray-600 text-pretty">Máy chủ chốt các khoản đủ điều kiện tại thứ Hai 09:00, bù nợ cũ trước trong cùng Host. Chỉ lập lô cho phần thực trả lớn hơn 0. Thao tác chưa chuyển tiền.</p>}
    {saved?<Alert tone="success">Máy chủ đã ghi nhận thao tác. Xem trạng thái hiện tại ở phần chi tiết.</Alert>:null}
    {message?<Alert>{message}</Alert>:null}
    {visibleNames.map(name=><Input key={name} id={`payout-${creating?"create":row?.id??"detail"}-${name}`} name={name}
      label={{hostId:"ID Host (UUID)",reason:"Lý do xử lý",bankReference:"Mã giao dịch ngân hàng",evidenceNote:"Ghi chú chứng cứ"}[name]}
      value={fields[name]} error={errors[name]} required={name!=="bankReference"&&name!=="evidenceNote"} maxLength={name==="hostId"?36:name==="bankReference"?200:500}
      autoComplete="off" readOnly={busy||uncertain||locked} className="text-base md:text-sm"
      onChange={event=>{setFields(value=>({...value,[name]:event.target.value}));setErrors(value=>({...value,[name]:undefined}));}}/>)}
    <div className="flex flex-wrap justify-end gap-3">
      {uncertain?<Button type="button" disabled={busy} onClick={()=>void submit(attempt.current!.action)}>{busy?"Đang xử lý…":"Thử lại cùng yêu cầu"}</Button>
        :creating?<Button type="button" disabled={busy||locked} onClick={()=>void submit("create")}>Quyết toán và lập lô</Button>:terminal?<p className="text-sm text-gray-600">Lô đã đóng, không còn thao tác chi trả.</p>:<>
          <Button type="button" variant="secondary" disabled={busy||locked||!allowed("cancel")} onClick={()=>void submit("cancel")}>Hủy lô</Button>
          {row?.status==="DRAFT"?<Button type="button" disabled={busy||locked||!allowed("approve")} onClick={()=>void submit("approve")}>Duyệt lô, chưa chuyển tiền</Button>:null}
          {row?.status==="APPROVED"?<><Button type="button" variant="secondary" disabled={busy||locked||readBusy||row.operations.reviewRequired||!row.operations.canExport} onClick={()=>void exportCsv()}>Xuất CSV</Button>
            <Button type="button" disabled={busy||locked||!allowed("confirmPaid")} onClick={()=>void submit("confirmPaid")}>Xác nhận đã chuyển tiền</Button></>:null}
        </>}
    </div>
    {busy?<p role="status" className="text-sm text-gray-600">Đang xử lý…</p>:null}
  </form>;
}
