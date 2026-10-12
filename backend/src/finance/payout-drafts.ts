import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { reverseDebtOffsets } from './debt-offsets.js';

type DraftItem = { bookingId: string; sourceJournalId: string; amount: string; eligibleAt: Date };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function reasonText(reason: string) {
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500)
    throw new BadRequestException({ errorCode: 'PAYOUT_REASON_REQUIRED', message: 'Cần lý do từ 1 đến 500 ký tự.' });
  return reason.trim();
}

// Internal transaction primitives only. Future domain executor must select/lock
// eligible, unreserved ledger sources and wrap these writes in HTTP idempotency.
// SQL guards independently recheck ownership/source/hold/bank/threshold at commit.
export async function persistPayoutDraft(tx: Prisma.TransactionClient, hostId: string, actorId: string,
  cutoff: Date, reason: string, items: readonly DraftItem[], beforeItems?:(batchId:string)=>Promise<void>) {
  const message = reasonText(reason), ids = new Set<string>();
  if (!uuid.test(hostId) || !uuid.test(actorId) || !(cutoff instanceof Date) || !Number.isFinite(cutoff.getTime()) || !items.length)
    throw new BadRequestException({ errorCode: 'INVALID_PAYOUT_DRAFT', message: 'Lô chưa có dữ liệu hợp lệ để lưu.' });
  hostId=hostId.toLowerCase();
  let total = new Prisma.Decimal(0);
  for (const item of items) {
    if (!uuid.test(item.bookingId) || !uuid.test(item.sourceJournalId) || ids.has(item.bookingId)
      || typeof item.amount !== 'string' || !/^\d{1,18}$/.test(item.amount)
      || !(item.eligibleAt instanceof Date) || !Number.isFinite(item.eligibleAt.getTime()))
      throw new BadRequestException({ errorCode: 'INVALID_PAYOUT_ITEM', message: 'Khoản phân bổ không hợp lệ hoặc trùng đơn.' });
    const amount = new Prisma.Decimal(item.amount);
    if (amount.lte(0)) throw new BadRequestException({ errorCode: 'INVALID_PAYOUT_ITEM', message: 'Khoản chi trả phải lớn hơn 0.' });
    total = total.plus(amount); ids.add(item.bookingId);
  }
  if (total.gte('1000000000000000000')) throw new BadRequestException({ errorCode: 'PAYOUT_AMOUNT_TOO_LARGE', message: 'Tổng tiền vượt giới hạn sổ.' });
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bank:${hostId}`},0))`;
  const [bank] = await tx.$queryRaw<{ id: string; version: number; bankCode: string; accountNumber: string; accountName: string }[]>`
    SELECT a.id,s.version,a.bank_code AS "bankCode",a.account_number AS "accountNumber",a.account_name AS "accountName"
    FROM finance_bank_states s JOIN finance_bank_accounts a ON a.id=s.account_id AND a.host_id=s.host_id
    WHERE s.host_id=${hostId}::uuid AND a.status='VERIFIED' FOR UPDATE OF s`;
  if (!bank) throw new ConflictException({ errorCode: 'PAYOUT_BANK_NOT_VERIFIED', message: 'Ngân hàng hiện tại chưa được Admin xác minh.' });
  const [batch] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO finance_payout_batches
    (host_id,bank_account_id,bank_version,bank_code,account_number,account_name,cutoff,amount)
    VALUES(${hostId}::uuid,${bank.id}::uuid,${bank.version},${bank.bankCode},${bank.accountNumber},${bank.accountName},${cutoff},${total.toFixed(0)}::numeric) RETURNING id`;
  await tx.$executeRaw`INSERT INTO finance_payout_events(batch_id,actor_id,action,version_before,reason)
    VALUES(${batch.id}::uuid,${actorId}::uuid,'CREATED',0,${message})`;
  if(beforeItems) await beforeItems(batch.id);
  // Parameterized rows; the DB rejects duplicate ACTIVE reservations across all batches.
  for (const item of items) await tx.$executeRaw`INSERT INTO finance_payout_items(batch_id,booking_id,source_journal_id,amount,eligible_at)
    VALUES(${batch.id}::uuid,${item.bookingId}::uuid,${item.sourceJournalId}::uuid,${item.amount}::numeric,${item.eligibleAt})`;
  return { id: batch.id, hostId, amount: total.toFixed(0), cutoff: cutoff.toISOString(), status: 'DRAFT', version: 1 };
}

export async function cancelPayoutDraft(tx: Prisma.TransactionClient, actorId: string, id: string, expectedVersion: number, reason: string) {
  const message = reasonText(reason);
  if (!uuid.test(actorId) || !uuid.test(id) || !Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion > 2147483646)
    throw new BadRequestException({ errorCode: 'INVALID_PAYOUT_ACTION', message: 'Thông tin thao tác lô không hợp lệ.' });
  const [batch] = await tx.$queryRaw<{ status: string; version: number }[]>`SELECT status,version FROM finance_payout_batches WHERE id=${id}::uuid FOR UPDATE`;
  if (!batch) throw new NotFoundException({ errorCode: 'PAYOUT_NOT_FOUND', message: 'Không tìm thấy lô chi trả.' });
  if (batch.version !== expectedVersion) throw new ConflictException({ errorCode: 'STALE_PAYOUT_VERSION', message: 'Lô đã thay đổi. Vui lòng tải lại.' });
  if (!['DRAFT','APPROVED'].includes(batch.status)) throw new ConflictException({ errorCode: 'PAYOUT_NOT_DRAFT', message: 'Lô không còn ở trạng thái có thể hủy.' });
  await tx.$executeRaw`INSERT INTO finance_payout_events(batch_id,actor_id,action,version_before,reason)
    VALUES(${id}::uuid,${actorId}::uuid,'CANCELLED',${expectedVersion},${message})`;
  await tx.$executeRaw`UPDATE finance_payout_batches SET status='CANCELLED',version=version+1 WHERE id=${id}::uuid AND version=${expectedVersion} AND status IN('DRAFT','APPROVED')`;
  await tx.$executeRaw`UPDATE finance_payout_items SET status='RELEASED' WHERE batch_id=${id}::uuid AND status='ACTIVE'`;
  await reverseDebtOffsets(tx,actorId,message,{batchId:id});
  return { id, status: 'CANCELLED', version: expectedVersion + 1 };
}

// Caller holds bank, inventory and booking locks before this batch lock.
// Approval reserves the same ledger sources; it is not bank transfer evidence.
export async function approvePayoutDraft(tx: Prisma.TransactionClient, actorId: string, id: string, expectedVersion: number, reason: string) {
  const message=reasonText(reason);
  if (!uuid.test(actorId) || !uuid.test(id) || !Number.isInteger(expectedVersion) || expectedVersion<1 || expectedVersion>2147483646)
    throw new BadRequestException({errorCode:'INVALID_PAYOUT_ACTION',message:'Thông tin thao tác lô không hợp lệ.'});
  const [batch]=await tx.$queryRaw<{status:string;version:number}[]>`SELECT status,version FROM finance_payout_batches WHERE id=${id}::uuid FOR UPDATE`;
  if (!batch) throw new NotFoundException({errorCode:'PAYOUT_NOT_FOUND',message:'Không tìm thấy lô chi trả.'});
  if (batch.version!==expectedVersion) throw new ConflictException({errorCode:'STALE_PAYOUT_VERSION',message:'Lô đã thay đổi. Vui lòng tải lại.'});
  if (batch.status!=='DRAFT') throw new ConflictException({errorCode:'PAYOUT_NOT_DRAFT',message:'Chỉ duyệt lô đang ở trạng thái nháp.'});
  const [{ready}]=await tx.$queryRaw<{ready:boolean}[]>`SELECT finance_payout_ready(${id}::uuid) AS ready`;
  if (!ready) throw new ConflictException({errorCode:'PAYOUT_REVIEW_REQUIRED',message:'Điều kiện chi trả đã thay đổi. Hãy đối soát và lập lại lô.'});
  await tx.$executeRaw`INSERT INTO finance_payout_events(batch_id,actor_id,action,version_before,reason)
    VALUES(${id}::uuid,${actorId}::uuid,'APPROVED',${expectedVersion},${message})`;
  await tx.$executeRaw`UPDATE finance_payout_batches SET status='APPROVED',version=version+1 WHERE id=${id}::uuid AND version=${expectedVersion} AND status='DRAFT'`;
  return {id,status:'APPROVED',version:expectedVersion+1};
}
