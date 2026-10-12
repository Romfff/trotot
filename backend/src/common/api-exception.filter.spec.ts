import { describe, expect, it, vi } from 'vitest';
import { ConflictException,HttpException,Logger,type ArgumentsHost } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter.js';

describe('ApiExceptionFilter', () => {
  it('carries the approved replacement refund preview on cutoff changes',()=>{
    const json=vi.fn(),host={switchToHttp:()=>({getRequest:()=>({method:'POST',url:'/api/v1/bookings/fixture/cancel-paid'}),
      getResponse:()=>({setHeader:vi.fn(),status:()=>({json})})})} as unknown as ArgumentsHost;
    const data={refundQuoteToken:'synthetic-preview-token',refundPercent:0,refund:{total:0}};
    new ApiExceptionFilter().catch(new ConflictException({errorCode:'REFUND_QUOTE_CHANGED',message:'Confirm new refund',data}),host);
    expect(json).toHaveBeenCalledWith({success:false,errorCode:'REFUND_QUOTE_CHANGED',message:'Confirm new refund',data});
    new ApiExceptionFilter().catch(new ConflictException({errorCode:'OTHER_CONFLICT',message:'No financial data',data}),host);
    expect(json).toHaveBeenLastCalledWith({success:false,errorCode:'OTHER_CONFLICT',message:'No financial data'});
  });
  it('does not persist cost-estimate usage query in server failure logs', () => {
    const log=vi.spyOn(Logger.prototype,'error').mockImplementation(()=>{});
    const host={switchToHttp:()=>({getRequest:()=>({method:'GET',url:'/api/v1/properties/sample/cost-estimate?electricityKwh=123.4&vehicles=2'}),getResponse:()=>({setHeader:vi.fn(),status:()=>({json:vi.fn()})})})} as unknown as ArgumentsHost;
    try {
      new ApiExceptionFilter().catch(new Error('Fixture database unavailable'),host);
      expect(log).toHaveBeenCalledWith('GET /api/v1/properties/sample/cost-estimate failed',expect.any(String));
      expect(JSON.stringify(log.mock.calls)).not.toContain('electricityKwh=');
    } finally {log.mockRestore();}
  });
  it('returns only approved stale status data and bounded retry header',()=>{
    const json=vi.fn(),setHeader=vi.fn(),status=vi.fn(()=>({json}));
    const host={switchToHttp:()=>({getRequest:()=>({method:'POST',url:'/api/v1/appointments'}),getResponse:()=>({status,setHeader})})} as unknown as ArgumentsHost;
    new ApiExceptionFilter().catch(new ConflictException({errorCode:'STALE_APPOINTMENT_STATUS',message:'stale',data:{currentStatus:'ACCEPTED',tenantPhone:'never expose'}}),host);
    expect(json).toHaveBeenLastCalledWith({success:false,errorCode:'STALE_APPOINTMENT_STATUS',message:'stale',data:{currentStatus:'ACCEPTED'}});
    new ApiExceptionFilter().catch(new HttpException({errorCode:'RATE_LIMITED',message:'limit',retryAfter:60},429),host);
    expect(setHeader).toHaveBeenCalledWith('Retry-After','60');
  });
  it('maps Multer size/count failures to a safe 413 envelope', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', url: '/api/v1/storage/upload' }),
        getResponse: () => ({ status, setHeader: vi.fn() }),
      }),
    } as unknown as ArgumentsHost;
    const error = Object.assign(new Error('internal upload details'), {
      name: 'MulterError',
      code: 'LIMIT_FILE_SIZE',
    });

    new ApiExceptionFilter().catch(error, host);

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorCode: 'UPLOAD_LIMIT_EXCEEDED',
      message: 'Tệp tải lên vượt giới hạn dung lượng hoặc số lượng.',
    }));
  });
  it.each([400,401,403,404,409,429,503])('marks HTTP %i errors no-store even before controller execution',statusCode=>{
    const setHeader=vi.fn(),json=vi.fn(),status=vi.fn(()=>({json}));
    const log=vi.spyOn(Logger.prototype,'error').mockImplementation(()=>{});
    try {
      const host={switchToHttp:()=>({getRequest:()=>({method:'GET',url:'/api/v1/admin/finance/no-show-reports'}),getResponse:()=>({setHeader,status})})} as unknown as ArgumentsHost;
      new ApiExceptionFilter().catch(new HttpException('Synthetic error',statusCode),host);
      expect(setHeader).toHaveBeenCalledWith('Cache-Control','no-store');
      expect(status).toHaveBeenCalledWith(statusCode);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({success:false,message:'Synthetic error'}));
    } finally {log.mockRestore();}
  });
});
