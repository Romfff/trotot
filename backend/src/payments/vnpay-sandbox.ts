import { BadRequestException,ServiceUnavailableException } from '@nestjs/common';
import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

// VNPay PAY 2.1.0 only. Official protocol reference:
// https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html
// No HTTP route, credentials, DB write or payment simulator is enabled here.
const endpoint='https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const offsetMs=7*60*60*1000;
type Config={tmnCode:string;hashSecret:string;returnUrl:string};
type RedirectInput={transactionRef:string;amountVnd:string;clientIp:string;createdAt:Date;expiresAt:Date};
const callbackFields=new Set(['vnp_TmnCode','vnp_Amount','vnp_BankCode','vnp_BankTranNo','vnp_CardType',
  'vnp_PayDate','vnp_OrderInfo','vnp_TransactionNo','vnp_ResponseCode','vnp_TransactionStatus','vnp_TxnRef','vnp_CurrCode','vnp_SecureHash']);
const bad=(code='INVALID_VNPAY_NOTIFICATION')=>new BadRequestException({errorCode:code,message:'Dữ liệu cổng thanh toán không hợp lệ.'});

// PHP urlencode / application/x-www-form-urlencoded (RFC1738), per official
// checksum example. Sort ASCII field names, then encode once; never URL-decode twice.
function encode(value:string) {
  return encodeURIComponent(value).replace(/[!'()*~]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g,'+');
}
function canonical(params:Record<string,string>) {
  return Object.keys(params).sort().map(key=>`${encode(key)}=${encode(params[key])}`).join('&');
}
function dateText(date:Date,code='INVALID_VNPAY_REDIRECT') {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw bad(code);
  const local=new Date(date.getTime()+offsetMs);
  if (local.getUTCFullYear()<1970 || local.getUTCFullYear()>9999) throw bad(code);
  return local.toISOString().slice(0,19).replace(/[-T:]/g,'');
}
function parsePayDate(value:string|undefined) {
  if (value===undefined) return null;
  if (!/^\d{14}$/.test(value)) throw bad();
  const iso=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:${value.slice(12,14)}+07:00`;
  const date=new Date(iso);
  // Reject silently normalized dates such as 30 February and 24:00.
  if (!Number.isFinite(date.getTime()) || dateText(date,'INVALID_VNPAY_NOTIFICATION')!==value) throw bad();
  return date.toISOString();
}

export function createVnpaySandboxAdapter(config:Config) {
  const unconfigured=()=>new ServiceUnavailableException({errorCode:'PAYMENT_NOT_CONFIGURED',message:'Chưa cấu hình VNPay Sandbox hợp lệ.'});
  if (!config || typeof config.tmnCode!=='string' || typeof config.hashSecret!=='string' || typeof config.returnUrl!=='string') throw unconfigured();
  let returnUrl:URL;
  try { returnUrl=new URL(config.returnUrl); } catch { throw unconfigured(); }
  if (!/^[A-Za-z0-9]{8}$/.test(config.tmnCode) || typeof config.hashSecret!=='string' || !/^[\x21-\x7e]{32,256}$/.test(config.hashSecret)
    || returnUrl.toString().length>255 || returnUrl.protocol!=='https:' || returnUrl.username || returnUrl.password || returnUrl.hash)
    throw unconfigured();
  // Snapshot config: mutating the caller object cannot change the verifier key
  // or merchant mid-session. Nothing is logged or read from browser/public env.
  const {tmnCode,hashSecret}=config,callbackUrl=returnUrl.toString();
  const sign=(data:string)=>createHmac('sha512',hashSecret).update(data,'utf8').digest('hex');
  return {
    createRedirect(input:RedirectInput) {
      if (typeof input.transactionRef!=='string' || !/^[A-Za-z0-9]{1,100}$/.test(input.transactionRef)
        || typeof input.amountVnd!=='string' || !/^[1-9]\d{0,9}$/.test(input.amountVnd) || typeof input.clientIp!=='string' || isIP(input.clientIp)===0)
        throw bad('INVALID_VNPAY_REDIRECT');
      const createdAt=dateText(input.createdAt),expiresAt=dateText(input.expiresAt);
      // Do not extend a DB reservation by truncating a sub-second deadline.
      if (expiresAt<=createdAt) throw bad('INVALID_VNPAY_REDIRECT');
      const params={vnp_Version:'2.1.0',vnp_Command:'pay',vnp_TmnCode:tmnCode,vnp_Amount:(BigInt(input.amountVnd)*100n).toString(),
        vnp_CurrCode:'VND',vnp_TxnRef:input.transactionRef,vnp_OrderInfo:`Thanh toan don ${input.transactionRef}`,vnp_OrderType:'other',
        vnp_Locale:'vn',vnp_ReturnUrl:callbackUrl,vnp_IpAddr:input.clientIp,vnp_CreateDate:createdAt,vnp_ExpireDate:expiresAt};
      const data=canonical(params);
      return `${endpoint}?${data}&vnp_SecureHash=${sign(data)}`;
    },
    verifyIpn(rawQuery:string) {
      // Take the raw query, not Express's object parser: duplicate keys/arrays
      // cannot select a different amount or merchant after signature validation.
      if (typeof rawQuery!=='string' || !rawQuery || rawQuery.length>8192 || /%(?![a-fA-F0-9]{2})/.test(rawQuery)) throw bad();
      const params:Record<string,string>=Object.create(null);
      for (const [key,value] of new URLSearchParams(rawQuery)) {
        const invalidText=[...value].some(char=>{const code=char.charCodeAt(0);return code<32 || code===127 || code===65533;});
        if (!callbackFields.has(key) || Object.hasOwn(params,key) || value.length>500 || invalidText) throw bad();
        params[key]=value;
      }
      const hash=params.vnp_SecureHash;
      if (!hash || !/^[a-fA-F0-9]{128}$/.test(hash)) throw bad('INVALID_VNPAY_SIGNATURE');
      delete params.vnp_SecureHash;
      const signedData=canonical(params);
      if (!timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(sign(signedData),'hex'))) throw bad('INVALID_VNPAY_SIGNATURE');
      // Authentication does NOT imply a successful, exact or timely booking payment.
      if (params.vnp_TmnCode!==tmnCode || !/^\d{1,12}$/.test(params.vnp_Amount??'') || BigInt(params.vnp_Amount)%100n!==0n
        || !/^[A-Za-z0-9]{1,100}$/.test(params.vnp_TxnRef??'') || !/^\d{1,15}$/.test(params.vnp_TransactionNo??'')
        || !/^\d{2}$/.test(params.vnp_ResponseCode??'') || !/^\d{2}$/.test(params.vnp_TransactionStatus??'')
        || !/^[A-Za-z0-9]{3,20}$/.test(params.vnp_BankCode??'') || !params.vnp_OrderInfo || params.vnp_OrderInfo.length>255
        || (params.vnp_CurrCode!==undefined && params.vnp_CurrCode!=='VND')
        || (params.vnp_BankTranNo!==undefined && !/^[A-Za-z0-9]{1,255}$/.test(params.vnp_BankTranNo))
        || (params.vnp_CardType!==undefined && !/^[A-Za-z]{2,20}$/.test(params.vnp_CardType))) throw bad();
      const providerReportedSuccess=params.vnp_ResponseCode==='00' && params.vnp_TransactionStatus==='00';
      if (providerReportedSuccess && (BigInt(params.vnp_TransactionNo)===0n || BigInt(params.vnp_Amount)===0n)) throw bad();
      return {provider:'VNPAY_SANDBOX' as const,merchantCode:tmnCode,transactionRef:params.vnp_TxnRef,transactionNo:params.vnp_TransactionNo,
        amountVnd:(BigInt(params.vnp_Amount)/100n).toString(),currency:'VND' as const,responseCode:params.vnp_ResponseCode,
        transactionStatus:params.vnp_TransactionStatus,providerReportedSuccess,payDate:parsePayDate(params.vnp_PayDate),
        payloadHash:createHash('sha256').update(signedData,'utf8').digest('hex')};
    },
  };
}
