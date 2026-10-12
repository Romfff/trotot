import { describe, expect, it } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { ApiEnvelopeInterceptor } from './api-envelope.interceptor.js';
import { PaginatedResult } from './paginated-result.js';
import { PaginatedResource } from './paginated-resource.js';

describe('API envelope pagination regression', () => {
  const run = (value: unknown) => firstValueFrom(new ApiEnvelopeInterceptor().intercept({} as ExecutionContext, { handle: () => of(value) }));
  it('puts pagination meta beside data, not inside data', async () => {
    const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };
    expect(await run(new PaginatedResult([{ id: 'fixture' }], meta))).toMatchObject({ success: true, data: [{ id: 'fixture' }], meta });
  });
  it('does not unwrap ordinary Auth or resource objects that happen to have data/meta keys', async () => {
    const value = { accessToken: 'fixture', user: { id: 'fixture' }, data: ['ordinary'], meta: { unrelated: true } };
    const result = await run(value);
    expect(result).toMatchObject({ success: true, data: value }); expect(result).not.toHaveProperty('meta');
  });
  it('supports grouped resource pagination without changing existing array envelopes',async()=>{
    const data={status:'READY',groups:[]};const meta={page:2,limit:5,total:8,totalPages:2};
    expect(await run(new PaginatedResource(data,meta))).toEqual({success:true,message:'Yêu cầu thành công.',data,meta});
  });
});
