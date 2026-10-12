import { describe,expect,it } from 'vitest';
import { chatPolicy } from './chat-policy.js';
describe('D-S5-05/06/07 listing chat policy',()=>{
  for(const status of ['DRAFT','PENDING_REVIEW','PUBLISHED','HIDDEN','REJECTED','EXPIRED']) {
    it.each([null,new Date('2026-10-08')])(`${status} × deletedAt=%s`,deletedAt=>{
      expect(chatPolicy({status,deletedAt})).toMatchObject({canStart:!deletedAt&&status==='PUBLISHED',canSend:!deletedAt&&['PUBLISHED','HIDDEN','EXPIRED'].includes(status)});
      if(deletedAt||!['PUBLISHED','HIDDEN','EXPIRED'].includes(status))expect(chatPolicy({status,deletedAt}).reason).toBeTruthy();
    });
  }
  it('fails closed for unknown future states until owner approves',()=>{
    expect(chatPolicy({status:'UNKNOWN',deletedAt:null})).toMatchObject({canStart:false,canSend:false});
  });
});
