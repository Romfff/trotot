import { describe,expect,it } from 'vitest';
import { toApiError } from '../src/lib/auth-types';
describe('Approved stale appointment state',()=>{
  it('preserves the current known status only, not private fields or arbitrary error data',()=>{
    expect(toApiError(409,{errorCode:'STALE_APPOINTMENT_STATUS',data:{currentStatus:'ACCEPTED',tenantPhone:'must not persist'}}).data).toEqual({currentStatus:'ACCEPTED'});
    expect(toApiError(409,{errorCode:'STALE_APPOINTMENT_STATUS',data:{currentStatus:'UNKNOWN'}}).data).toBeUndefined();
    expect(toApiError(403,{errorCode:'FORBIDDEN',data:{currentStatus:'ACCEPTED'}}).data).toBeUndefined();
  });
});
