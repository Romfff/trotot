import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { appendFinancialJournal } from './finance-journal.js';

export type PayoutTransferEvidence = { expectedVersion:number; bankReference:string; evidenceNote:string; reason:string };
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Internal transaction primitive. An HTTP executor must wrap this in exact-response
// idempotency before exposing it. This records Admin evidence, never sends money.
export async function recordManualPayout(tx:Prisma.TransactionClient,actorId:string,id:string,input:PayoutTransferEvidence) {
  if (!uuid.test(actorId) || !uuid.test(id) || !Number.isInteger(input.expectedVersion)
    || input.expectedVersion<2 || input.expectedVersion>2147483646
    || [input.bankReference,input.evidenceNote,input.reason].some((value,index)=>typeof value!=='string' || !value.trim() || value.trim().length>(index===0?200:500)))
    throw new BadRequestException({errorCode:'INVALID_PAYOUT_EVIDENCE',message:'Cần phiên bản, mã giao dịch ngân hàng, bằng chứng và lý do hợp lệ.'});
  id=id.toLowerCase();
  const bankReference=input.bankReference.trim(),evidence=input.evidenceNote.trim(),reason=input.reason.trim();
  const [actor]=await tx.$queryRaw<{role:string;status:string}[]>`SELECT role,status FROM users WHERE id=${actorId}::uuid FOR SHARE`;
  if (!actor || actor.role!=='ADMIN' || actor.status!=='ACTIVE')
    throw new ForbiddenException({errorCode:'PAYOUT_CONFIRM_FORBIDDEN',message:'Tài khoản không được xác nhận chi trả.'});
  const [initial]=await tx.$queryRaw<{hostId:string}[]>`SELECT host_id AS "hostId" FROM finance_payout_batches WHERE id=${id}::uuid`;
  if (!initial) throw new NotFoundException({errorCode:'PAYOUT_NOT_FOUND',message:'Không tìm thấy lô chi trả.'});
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bank:${initial.hostId}`},0))`;
  await tx.$queryRaw`SELECT u.id FROM homestay_units u JOIN properties p ON p.id=u.property_id WHERE p.host_id=${initial.hostId}::uuid ORDER BY u.id FOR UPDATE OF u`;
  await tx.$queryRaw`SELECT b.id FROM bookings b JOIN finance_payout_items i ON i.booking_id=b.id WHERE i.batch_id=${id}::uuid ORDER BY b.id FOR UPDATE OF b`;
  const [batch]=await tx.$queryRaw<{status:string;version:number;amount:string}[]>`SELECT status,version,amount::text FROM finance_payout_batches WHERE id=${id}::uuid FOR UPDATE`;
  if (batch.version!==input.expectedVersion) throw new ConflictException({errorCode:'STALE_PAYOUT_VERSION',message:'Lô đã thay đổi. Vui lòng tải lại.'});
  if (batch.status!=='APPROVED') throw new ConflictException({errorCode:'PAYOUT_NOT_APPROVED',message:'Chỉ xác nhận lô đã được duyệt và chưa trả.'});
  const [{ready}]=await tx.$queryRaw<{ready:boolean}[]>`SELECT finance_payout_ready(${id}::uuid) AS ready`;
  if (!ready) throw new ConflictException({errorCode:'PAYOUT_REVIEW_REQUIRED',message:'Điều kiện chi trả đã thay đổi. Cần đối soát trước khi ghi nhận.'});
  const [{referenceKey}]=await tx.$queryRaw<{referenceKey:string}[]>`SELECT upper(${bankReference}) AS "referenceKey"`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payout-ref:${referenceKey}`},0))`;
  const used=await tx.$queryRaw<{batchId:string}[]>`SELECT batch_id AS "batchId" FROM finance_payout_confirmations WHERE reference_key=${referenceKey}`;
  if (used.length) throw new ConflictException({errorCode:'PAYOUT_REFERENCE_REUSED',message:'Mã giao dịch đã được dùng cho lô chi trả khác.'});
  // Evidence guard captures readiness before any debit; deferred guards require
  // the entire proof/journal/audit/status together at commit, including raw SQL.
  await tx.$executeRaw`INSERT INTO finance_payout_confirmations(batch_id,actor_id,version_before,bank_reference,reference_key,evidence_note,reason)
    VALUES(${id}::uuid,${actorId}::uuid,${input.expectedVersion},${bankReference},${referenceKey},${evidence},${reason})`;
  const items=await tx.$queryRaw<{id:string;bookingId:string;amount:string}[]>`SELECT id,booking_id AS "bookingId",amount::text FROM finance_payout_items WHERE batch_id=${id}::uuid AND status='ACTIVE' ORDER BY booking_id`;
  for (const item of items) {
    const journal=await appendFinancialJournal(tx,{eventKey:`payout-paid:${id}:${item.id}`,kind:'PAYOUT',bookingId:item.bookingId,hostId:initial.hostId,actorId,reason,
      lines:[{account:'HOST_PAYABLE',side:'DEBIT',amount:item.amount},{account:'CASH_CLEARING',side:'CREDIT',amount:item.amount}]});
    await tx.$executeRaw`INSERT INTO finance_payout_paid_items(item_id,journal_id,batch_id) VALUES(${item.id}::uuid,${journal.journalId}::uuid,${id}::uuid)`;
  }
  await tx.$executeRaw`INSERT INTO finance_payout_events(batch_id,actor_id,action,version_before,reason) VALUES(${id}::uuid,${actorId}::uuid,'PAID',${input.expectedVersion},${reason})`;
  await tx.$executeRaw`UPDATE finance_payout_batches SET status='PAID',version=version+1 WHERE id=${id}::uuid AND version=${input.expectedVersion} AND status='APPROVED'`;
  return {id,status:'PAID' as const,version:input.expectedVersion+1,amount:batch.amount,
    message:'Đã ghi nhận bằng chứng chi trả thủ công của Admin; hệ thống không thực hiện chuyển tiền.'};
}
