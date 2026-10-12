import {beforeEach,expect,it,vi} from "vitest";
import {managementRequest} from "@/lib/api/client";
import {complaintsApi} from "@/lib/api/complaints";
vi.mock("@/lib/api/client",()=>({managementRequest:vi.fn()}));
const id="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002",at="2026-10-06T00:00:00.000Z";
const row={id,bookingId:id,reason:"Synthetic",status:"OPEN",assigneeId:null,version:1,createdAt:at,overdue:false};
const event={id,action:"CREATED",message:"Synthetic",createdAt:at},detail={...row,events:[event],resolution:null};
const allocation={baseAmount:"1000",cleaningFee:"100",serviceFee:"0",taxAmount:"0"},zero={baseAmount:"0",cleaningFee:"0",serviceFee:"0",taxAmount:"0"};
const bookingSnapshot={version:7,bookingStatus:"CONFIRMED",paymentStatus:"PAID",checkoutAt:at,amounts:{...allocation,totalAmount:"1100"},approvedRefundAmounts:zero,
  refundedAmount:"0",pendingRefundAmount:"0",remainingRefundableAmounts:allocation,reviewRequired:false};
const resolution={decision:"HOST",reason:"Reviewed",resolvedAt:at};
const ok=(data:unknown)=>({success:true,message:"OK",data});
beforeEach(()=>vi.clearAllMocks());
it("keeps mixed-source numbers Admin-only and accepts only a Host review indicator",async()=>{
  const settlementReview={originalHostAmount:"900000",offsetAmount:"450000",paidAmount:"450000",potentialExcessAmount:"450000"};
  const data={...detail,bookingSnapshot:{...bookingSnapshot,reviewRequired:true,remainingRefundableAmounts:null},settlementReview};
  vi.mocked(managementRequest).mockResolvedValueOnce(ok(data)).mockResolvedValueOnce(ok({...detail,settlementReviewStatus:"PENDING"})).mockResolvedValueOnce(ok({...detail,settlementReview}));
  expect(await complaintsApi.adminDetail(id)).toEqual(data);
  expect(await complaintsApi.hostDetail(id)).toMatchObject({settlementReviewStatus:"PENDING"});
  await expect(complaintsApi.hostDetail(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
});
it("rejects unbalanced review evidence",async()=>{
  vi.mocked(managementRequest).mockResolvedValue(ok({...detail,bookingSnapshot,settlementReview:{originalHostAmount:"900000",offsetAmount:"450000",paidAmount:"450000",potentialExcessAmount:"1"}}));
  await expect(complaintsApi.adminDetail(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
});
it("accepts verified private Admin late-case metadata but rejects it in Host/Guest response",async()=>{
  const lateCase={caseType:"ADMIN_LATE_REFUND",caseLabel:"Admin mở sau hạn",actorId:id,evidenceNote:"Private synthetic",bookingVersionAtOpen:7,openedAt:at};
  const data={...detail,bookingSnapshot,lateCase};
  vi.mocked(managementRequest).mockResolvedValueOnce(ok(data)).mockResolvedValueOnce(ok({...detail,lateCase})).mockResolvedValueOnce(ok([{...detail,lateCase}]));
  expect(await complaintsApi.adminDetail(id)).toEqual(data);
  await expect(complaintsApi.hostDetail(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
  await expect(complaintsApi.booking(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
});
it.each([{caseType:"GUEST"},{caseLabel:"Other"},{actorId:"bad"},{evidenceNote:" "},{bookingVersionAtOpen:0},{openedAt:"bad"},{privateBank:"leak"}])("rejects malformed late case %j",async patch=>{
  vi.mocked(managementRequest).mockResolvedValue(ok({...detail,bookingSnapshot,lateCase:{caseType:"ADMIN_LATE_REFUND",caseLabel:"Admin mở sau hạn",actorId:id,evidenceNote:"Private synthetic",bookingVersionAtOpen:7,openedAt:at,...patch}}));
  await expect(complaintsApi.adminDetail(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
});
it.each([{version:0},{version:1.5},{paymentStatus:"FAKE"},{checkoutAt:"bad"},{refundedAmount:"0.5"},{pendingRefundAmount:"1"},
  {remainingRefundableAmounts:zero},{amounts:{...allocation,totalAmount:"1200"}},{approvedRefundAmounts:{...zero,baseAmount:"1001"}},
  {reviewRequired:true},{remainingRefundableAmounts:null},{privateBank:"leak"}])("rejects malformed Admin booking snapshot %j",async patch=>{
  vi.mocked(managementRequest).mockResolvedValue(ok({...detail,bookingSnapshot:{...bookingSnapshot,...patch}}));
  await expect(complaintsApi.adminDetail(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
});
it("accepts review snapshot without inventing available amount and forbids snapshot on Host/Guest",async()=>{
  const data={...detail,bookingSnapshot:{...bookingSnapshot,reviewRequired:true,remainingRefundableAmounts:null}};
  vi.mocked(managementRequest).mockResolvedValueOnce(ok(data)).mockResolvedValueOnce(ok(data)).mockResolvedValueOnce(ok([data]));
  expect(await complaintsApi.adminDetail(id)).toEqual(data);await expect(complaintsApi.hostDetail(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
  await expect(complaintsApi.booking(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
});
it("reads own booking current version with AbortSignal, not a caller supplied version",async()=>{
  const signal=new AbortController().signal,data={bookingId:id,bookingCode:"FIXTURE",version:7,paymentStatus:"PAID",bookingStatus:"CONFIRMED",otherExistingBookingField:true};
  vi.mocked(managementRequest).mockResolvedValue(ok(data));expect(await complaintsApi.ownBooking(id,signal)).toEqual(data);
  expect(managementRequest).toHaveBeenCalledWith(`/bookings/${id}`,{signal});
});
it.each([{bookingId:other},{bookingId:"bad"},{bookingCode:""},{version:0},{version:1.5},{version:2147483648},{paymentStatus:null},{bookingStatus:null}])("refuses invalid own booking snapshot %j",async patch=>{
  vi.mocked(managementRequest).mockResolvedValue(ok({bookingId:id,bookingCode:"FIXTURE",version:1,paymentStatus:"PAID",bookingStatus:"CONFIRMED",...patch}));await expect(complaintsApi.ownBooking(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
});
it("reads both private scopes with AbortSignal and meta outside data",async()=>{
  const signal=new AbortController().signal,meta={page:1,limit:20,total:1,totalPages:1};
  vi.mocked(managementRequest).mockResolvedValue({...ok([row]),meta});
  for(const scope of ["host","admin"] as const) {
    expect((await complaintsApi.list(scope,1,signal)).data).toEqual([row]);
    expect(managementRequest).toHaveBeenLastCalledWith(`/${scope}/finance/complaints`,{params:{page:1,limit:20},signal});
  }
});
it("reads own booking array and separate Host/Admin detail models",async()=>{
  const signal=new AbortController().signal;
  vi.mocked(managementRequest).mockResolvedValueOnce(ok([detail])).mockResolvedValueOnce(ok(detail)).mockResolvedValueOnce(ok({...detail,bookingSnapshot}));
  expect(await complaintsApi.booking(id,signal)).toEqual([detail]);expect(await complaintsApi.hostDetail(id,signal)).toEqual(detail);expect(await complaintsApi.adminDetail(id,signal)).toEqual({...detail,bookingSnapshot});
  for(const call of vi.mocked(managementRequest).mock.calls)expect(call[1]).toEqual({signal});
});
it("requires internal evidence for resolved Admin detail but refuses it in Guest/Host models",async()=>{
  const publicDetail={...detail,status:"RESOLVED",version:2,resolution},privateDetail={...publicDetail,bookingSnapshot,resolution:{...resolution,actorId:id,evidenceNote:"Private synthetic"}};
  vi.mocked(managementRequest).mockResolvedValueOnce(ok(publicDetail)).mockResolvedValueOnce(ok(privateDetail)).mockResolvedValueOnce(ok(privateDetail)).mockResolvedValueOnce(ok([privateDetail])).mockResolvedValueOnce(ok(publicDetail));
  expect(await complaintsApi.hostDetail(id)).toEqual(publicDetail);expect(await complaintsApi.adminDetail(id)).toEqual(privateDetail);
  await expect(complaintsApi.hostDetail(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
  await expect(complaintsApi.booking(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
  await expect(complaintsApi.adminDetail(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
});
it.each([{id:other},{bookingId:"bad"},{version:0},{version:1.5},{status:"CLOSED"},{overdue:"false"},{createdAt:"2026-02-30T00:00:00.000Z"},{assigneeId:"bad"},{reason:" "},{reason:"x".repeat(501)},
  {events:[{...event,actorId:id}]},{events:[{...event,evidenceNote:"private"}]},{events:[event,event]},{events:[{...event,action:"PAID"}]},{resolution},
  {status:"RESOLVED",resolution:null},{status:"RESOLVED",resolution,overdue:true},{guestPhone:"private"}])("rejects malformed or leaking Host detail %j",async patch=>{
  vi.mocked(managementRequest).mockResolvedValue(ok({...detail,...patch}));await expect(complaintsApi.hostDetail(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
});
it.each([{page:2},{limit:50},{total:-1},{totalPages:3}])("rejects inconsistent list meta %j",async patch=>{
  vi.mocked(managementRequest).mockResolvedValue({...ok([row]),meta:{page:1,limit:20,total:1,totalPages:1,...patch}});
  await expect(complaintsApi.list("admin",1)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
});
it("refuses another booking and duplicate complaint IDs",async()=>{
  vi.mocked(managementRequest).mockResolvedValueOnce(ok([{...detail,bookingId:other}])).mockResolvedValueOnce(ok([detail,detail]));
  await expect(complaintsApi.booking(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});await expect(complaintsApi.booking(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
});
it("creates version 1 even when expectedVersion refers to a later booking version",async()=>{
  const input={expectedVersion:7,reason:" Synthetic "};vi.mocked(managementRequest).mockResolvedValue(ok(row));
  expect(await complaintsApi.create(id,input,"stable-key")).toEqual(row);
  expect(managementRequest).toHaveBeenLastCalledWith(`/bookings/${id}/complaints`,{method:"POST",data:input,headers:{"Idempotency-Key":"stable-key"}});
});
it("respond/assign retain OPEN, advance complaint version, and preserve payload/key",async()=>{
  const respond={expectedVersion:1,message:" Synthetic "},assign={expectedVersion:1,reason:" Review ",assigneeId:other};
  vi.mocked(managementRequest).mockResolvedValueOnce(ok({...row,version:2})).mockResolvedValueOnce(ok({...row,version:2,assigneeId:other}));
  await complaintsApi.respond(id,respond,"same-key");await complaintsApi.assign(id,assign,"same-key");
  expect(managementRequest).toHaveBeenNthCalledWith(1,`/host/finance/complaints/${id}/respond`,{method:"POST",data:respond,headers:{"Idempotency-Key":"same-key"}});
  expect(managementRequest).toHaveBeenNthCalledWith(2,`/admin/finance/complaints/${id}/assign`,{method:"POST",data:assign,headers:{"Idempotency-Key":"same-key"}});
});
it.each([{version:1},{version:3},{status:"RESOLVED"},{id:other},{assigneeId:id},{resolution}])("rejects invalid assign result without auto POST retry %j",async patch=>{
  vi.mocked(managementRequest).mockResolvedValue(ok({...row,version:2,assigneeId:other,...patch}));
  await expect(complaintsApi.assign(id,{expectedVersion:1,reason:"Review",assigneeId:other},"same-key")).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});expect(managementRequest).toHaveBeenCalledTimes(1);
});
it("resolve preserves body/key and confirms existing HOST result without inventing a refund",async()=>{
  const input={expectedVersion:1,decision:"HOST" as const,reason:" Reviewed ",evidenceNote:" Private "},result={...row,status:"RESOLVED",version:2,resolution};
  vi.mocked(managementRequest).mockResolvedValue(ok(result));expect(await complaintsApi.resolve(id,input,"same-key")).toEqual(result);
  expect(managementRequest).toHaveBeenLastCalledWith(`/admin/finance/complaints/${id}/resolve`,{method:"POST",data:input,headers:{"Idempotency-Key":"same-key"}});
});
it.each(["FULL_REFUND","PARTIAL_REFUND"] as const)("reads %s obligation without leaking Admin evidence and preserves exact request/key",async decision=>{
  const result={...row,status:"RESOLVED",version:2,resolution:{decision,reason:"Reviewed",resolvedAt:at,
    refundObligation:{id:other,amount:"500",status:"PENDING"},holdUntil:decision==="FULL_REFUND"?null:"2026-10-09T00:00:00.000Z"}};
  const input={expectedVersion:1,decision,reason:" Reviewed ",evidenceNote:" Private ",expectedBookingVersion:7,
    allocation:{baseAmount:"500",cleaningFee:"0",serviceFee:"0",taxAmount:"0"}};
  vi.mocked(managementRequest).mockResolvedValueOnce(ok(result)).mockResolvedValueOnce(ok({...result,events:[event]}));
  expect(await complaintsApi.resolve(id,input,"same-refund-key")).toEqual(result);
  expect(managementRequest).toHaveBeenNthCalledWith(1,`/admin/finance/complaints/${id}/resolve`,{method:"POST",data:input,headers:{"Idempotency-Key":"same-refund-key"}});
  expect(await complaintsApi.hostDetail(id)).toEqual({...result,events:[event]});
});
it.each([{refundObligation:{id:other,amount:"0",status:"PENDING"}},{refundObligation:{id:other,amount:"0.5",status:"PENDING"}},
  {refundObligation:{id:other,amount:"500",status:"PENDING",bankReference:"private"}},{holdUntil:null},{holdUntil:"bad"}])("refuses malformed partial refund detail %j",async patch=>{
  const refund={decision:"PARTIAL_REFUND",reason:"Reviewed",resolvedAt:at,refundObligation:{id:other,amount:"500",status:"PENDING"},holdUntil:"2026-10-09T00:00:00.000Z",...patch};
  vi.mocked(managementRequest).mockResolvedValue(ok({...detail,status:"RESOLVED",version:2,resolution:refund}));
  await expect(complaintsApi.hostDetail(id)).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
});
it.each([{version:1},{status:"OPEN"},{overdue:true},{id:other},{resolution:{...resolution,decision:"FULL_REFUND"}},{resolution:{...resolution,reason:"Other"}},{resolution:{...resolution,evidenceNote:"private"}},{events:[]}])("rejects invalid resolution %j",async patch=>{
  vi.mocked(managementRequest).mockResolvedValue(ok({...row,status:"RESOLVED",version:2,resolution,...patch}));
  await expect(complaintsApi.resolve(id,{expectedVersion:1,decision:"HOST",reason:"Reviewed",evidenceNote:"Proof"},"same-key")).rejects.toMatchObject({errorCode:"INVALID_COMPLAINT_RESPONSE"});
});
