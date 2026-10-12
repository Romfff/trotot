import { BadRequestException,ConflictException,ForbiddenException,NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { createVnpaySandboxAdapter } from './vnpay-sandbox.js';

type Session={id:string;bookingId:string;guestId:string;bookingVersion:number;merchantCode:string;transactionRef:string;amountVnd:string;expiresAt:Date;createdAt:Date};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Internal transaction primitive; no API caller is enabled without provider
// configuration and a durable IPN/ledger consumer. URL is not payment evidence.
export async function persistVnpaySession(tx:Prisma.TransactionClient,guestId:string,bookingId:string,expectedVersion:number,
  config:Parameters<typeof createVnpaySandboxAdapter>[0],clientIp:string,readOnly=false) {
  if (!uuid.test(guestId) || !uuid.test(bookingId) || !Number.isSafeInteger(expectedVersion) || expectedVersion<1 || expectedVersion>2147483647)
    throw new BadRequestException({errorCode:'INVALID_PAYMENT_SESSION_REQUEST',message:'Thông tin phiên thanh toán không hợp lệ.'});
  guestId=guestId.toLowerCase();bookingId=bookingId.toLowerCase();
  const adapter=createVnpaySandboxAdapter(config);
  const merchantCode=config.tmnCode; // snapshot before the first await, like the verifier configuration
  const [actor]=await tx.$queryRaw<{role:string;status:string}[]>`SELECT role,status FROM users WHERE id=${guestId}::uuid FOR SHARE`;
  if (!actor || actor.status!=='ACTIVE' || !['TENANT','HOST'].includes(actor.role))
    throw new ForbiddenException({errorCode:'PAYMENT_ACTOR_NOT_ALLOWED',message:'Tài khoản không được tạo phiên thanh toán.'});
  const initial=await tx.booking.findFirst({where:{id:bookingId,guestId},select:{homestayUnitId:true}});
  if (!initial) throw new NotFoundException({errorCode:'BOOKING_NOT_FOUND',message:'Không tìm thấy đơn.'});
  await tx.$queryRaw`SELECT id FROM homestay_units WHERE id=${initial.homestayUnitId}::uuid FOR UPDATE`;
  const [booking]=await tx.$queryRaw<{version:number;amount:string;status:string;paymentStatus:string;expiresAt:Date}[]>`
    SELECT version,total_amount::text AS amount,booking_status AS status,payment_status AS "paymentStatus",expires_at AS "expiresAt"
    FROM bookings WHERE id=${bookingId}::uuid AND guest_id=${guestId}::uuid FOR UPDATE`;
  if (!booking) throw new NotFoundException({errorCode:'BOOKING_NOT_FOUND',message:'Không tìm thấy đơn.'});
  if (booking.version!==expectedVersion) throw new ConflictException({errorCode:'STALE_BOOKING_VERSION',message:'Đơn đã thay đổi. Vui lòng tải lại.'});
  const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
  if (booking.status!=='PENDING_PAYMENT' || booking.paymentStatus!=='PENDING' || booking.expiresAt<=now)
    throw new ConflictException({errorCode:'BOOKING_NOT_PAYABLE',message:'Đơn không còn ở trạng thái có thể thanh toán.'});
  const existing=await tx.$queryRaw<Session[]>`SELECT id,booking_id AS "bookingId",guest_id AS "guestId",booking_version AS "bookingVersion",
    merchant_code AS "merchantCode",transaction_ref AS "transactionRef",amount_vnd::text AS "amountVnd",expires_at AS "expiresAt",created_at AS "createdAt"
    FROM payment_sessions WHERE booking_id=${bookingId}::uuid AND provider='VNPAY_SANDBOX'`;
  if(readOnly && !existing.length)throw new NotFoundException({errorCode:'PAYMENT_SESSION_NOT_FOUND',message:'Chưa tạo phiên thanh toán cho đơn.'});
  if (existing.length && (existing[0].merchantCode!==merchantCode || existing[0].bookingVersion!==expectedVersion
    || !new Prisma.Decimal(existing[0].amountVnd).eq(booking.amount) || existing[0].expiresAt.getTime()!==booking.expiresAt.getTime()))
    throw new ConflictException({errorCode:'PAYMENT_SESSION_REVIEW_REQUIRED',message:'Phiên thanh toán cần được đối soát.'});
  const session=existing[0]??{id:randomUUID(),bookingId,guestId,bookingVersion:expectedVersion,merchantCode,
    transactionRef:'',amountVnd:new Prisma.Decimal(booking.amount).toFixed(),expiresAt:booking.expiresAt,createdAt:now};
  if (!existing.length) session.transactionRef=session.id.replaceAll('-','');
  const redirectUrl=adapter.createRedirect({transactionRef:session.transactionRef,amountVnd:session.amountVnd,clientIp,
    createdAt:session.createdAt,expiresAt:session.expiresAt});
  if (!existing.length) {
    const [stored]=await tx.$queryRaw<{createdAt:Date}[]>`INSERT INTO payment_sessions(id,provider,booking_id,guest_id,booking_version,merchant_code,transaction_ref,amount_vnd,expires_at)
      VALUES(${session.id}::uuid,'VNPAY_SANDBOX',${bookingId}::uuid,${guestId}::uuid,${expectedVersion},${session.merchantCode},${session.transactionRef},${session.amountVnd}::numeric,${session.expiresAt})
      RETURNING created_at AS "createdAt"`;
    // Sign using the exact persisted creation clock, not a caller timestamp.
    session.createdAt=stored.createdAt;
  }
  return {sessionId:session.id,bookingId,transactionRef:session.transactionRef,amountVnd:session.amountVnd,
    expiresAt:session.expiresAt.toISOString(),createdAt:session.createdAt.toISOString(),
    redirectUrl:existing.length?redirectUrl:adapter.createRedirect({transactionRef:session.transactionRef,amountVnd:session.amountVnd,clientIp,
      createdAt:session.createdAt,expiresAt:session.expiresAt})};
}
