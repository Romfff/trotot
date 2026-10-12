"use client";
import {useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Alert} from '@/components/ui/alert';
import {apiError} from '@/lib/api/client';
import {complaintsApi} from '@/lib/api/complaints';
import {debtSettlementsApi} from '@/lib/api/debt-settlements';
import {useAuthStore} from '@/stores/auth-store';
import {bankNeedsReplay} from '@/features/host-finance/bank-form';
// Two approved evidence actions only; never an arbitrary ledger adjustment.
export function FinanceRecordAction({kind,sessionId,onCreated}:{kind:'late'|'reverse';sessionId:string;onCreated?:(id:string)=>void}){
 const [fields,setFields]=useState({id:'',version:'',reason:'',evidence:''}),[errors,setErrors]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState(''),[saved,setSaved]=useState(false);
 const attempt=useRef<{fields:typeof fields;key:string}|null>(null),inFlight=useRef(false),form=useRef<HTMLFormElement>(null),cache=useQueryClient();
 const current=()=>{const s=useAuthStore.getState();return s.sessionId===sessionId&&s.status==='authenticated'&&s.user?.role==='ADMIN'&&s.user.status==='ACTIVE';};
 async function submit(){
  if(inFlight.current||!current())return;
  if(!attempt.current){
   const e:Record<string,string>={};if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(fields.id.trim()))e.id='Cần ID UUID hợp lệ.';
   if(kind==='late'&&(!/^[1-9]\d*$/.test(fields.version)||Number(fields.version)>2147483646))e.version='Cần phiên bản đơn hiện tại.';
   for(const name of kind==='late'?['reason','evidence'] as const:['reason'] as const)if(!fields[name].trim()||fields[name].trim().length>500)e[name]='Cần nội dung từ 1 đến 500 ký tự.';
   setErrors(e);if(Object.keys(e).length){form.current?.querySelector<HTMLInputElement>(`[name="${Object.keys(e)[0]}"]`)?.focus();return;}
   attempt.current={fields:{...fields},key:crypto.randomUUID()};
  }
  const a=attempt.current;inFlight.current=true;setBusy(true);setSaved(false);setMessage('');
  try{
   const result=kind==='late'?await complaintsApi.createAdminLate(a.fields.id.trim(),{expectedVersion:Number(a.fields.version),reason:a.fields.reason,evidenceNote:a.fields.evidence},a.key):await debtSettlementsApi.reverse(a.fields.id.trim(),a.fields.reason,a.key);
   if(!current())return;
   attempt.current=null;setUncertain(false);setSaved(true);setFields({id:'',version:'',reason:'',evidence:''});
   if(kind==='late')onCreated?.(result.id as string);
   void cache.invalidateQueries({queryKey:[kind==='late'?'admin-complaints':'admin-payouts',sessionId]});
  }catch(failure){if(!current())return;const e=apiError(failure),replay=bankNeedsReplay(e);setUncertain(replay);setMessage(replay?'Chưa rõ kết quả ghi sổ. Thử lại cùng yêu cầu và cùng khóa; không nhập thao tác mới.':e.message);if(!replay)attempt.current=null;}
  finally{inFlight.current=false;if(current())setBusy(false);}
 }
 const names:('id'|'version'|'reason'|'evidence')[]=kind==='late'?['id','version','reason','evidence']:['id','reason'];
 return <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5"><form ref={form} onSubmit={e=>{e.preventDefault();void submit();}} className="space-y-4">
  <h2 className="text-base font-semibold">{kind==='late'?'Admin mở hồ sơ sau hạn':'Đảo quyết toán bù trừ riêng'}</h2>
  <p className="max-w-[75ch] text-sm text-gray-600 text-pretty">{kind==='late'?'Chỉ dành cho đơn đã hoàn thành, đã thanh toán và qua 72 giờ. Cần lý do, bằng chứng; không mở lại quyền khiếu nại của khách.':'Chỉ đảo khoản bù không thuộc lô, kèm lý do. Khoản thuộc lô chưa trả phải dùng Hủy lô; lô PAID giữ nguyên.'}</p>
  {names.map(name=><Input key={name} id={`finance-${kind}-${name}`} name={name} label={name==='id'?(kind==='late'?'ID đơn (UUID)':'ID quyết toán (UUID)'):({version:'Phiên bản đơn',reason:'Lý do',evidence:'Bằng chứng nội bộ'})[name]} value={fields[name]} error={errors[name]} required autoComplete="off" readOnly={busy||uncertain} className="text-base md:text-sm" onChange={e=>{setFields(v=>({...v,[name]:e.target.value}));setErrors(v=>({...v,[name]:''}));}}/>)}
  {message?<Alert>{message}</Alert>:null}{saved?<Alert tone="success">Máy chủ đã ghi nhận. Thao tác này không chuyển tiền.</Alert>:null}
  <div className="flex justify-end"><Button type="submit" aria-disabled={busy} aria-busy={busy} onClick={e=>{if(busy)e.preventDefault();}}>{uncertain?'Thử lại cùng yêu cầu':kind==='late'?'Mở hồ sơ sau hạn':'Đảo bù trừ'}</Button></div>
 </form></section>;
}
