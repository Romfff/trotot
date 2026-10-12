import { ServiceUnavailableException } from '@nestjs/common';
import { createVnpaySandboxAdapter } from './vnpay-sandbox.js';

export function vnpaySandboxConfig() {
  const unavailable=()=>new ServiceUnavailableException({errorCode:'PAYMENT_NOT_CONFIGURED',message:'Chưa cấu hình VNPay Sandbox hợp lệ.'});
  if(process.env.VNPAY_SANDBOX_ENABLED!=='true' || process.env.NODE_ENV==='production')throw unavailable();
  const config={tmnCode:process.env.VNPAY_TMN_CODE??'',hashSecret:process.env.VNPAY_HASH_SECRET??'',returnUrl:process.env.VNPAY_RETURN_URL??''};
  createVnpaySandboxAdapter(config);
  return config;
}
