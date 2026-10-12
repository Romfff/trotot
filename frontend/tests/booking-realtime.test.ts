import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { io } from 'socket.io-client';
import { subscribeBookingRealtime,subscribeCalendarRealtime } from '@/lib/booking-realtime';
import { useAuthStore } from '@/stores/auth-store';
import type { User } from '@/lib/auth-types';
vi.mock('socket.io-client',()=>({io:vi.fn()}));
const id='00000000-0000-4000-8000-000000000001';
const user={id,role:'TENANT',status:'ACTIVE'} as User;
function fakeSocket() {
  const handlers=new Map<string,(...args:unknown[])=>void>();
  const socket={on:vi.fn((name:string,handler:(...args:unknown[])=>void)=>{handlers.set(name,handler);return socket;}),
    disconnect:vi.fn(),timeout:vi.fn(),emit:vi.fn()};socket.timeout.mockReturnValue(socket);
  vi.mocked(io).mockReturnValue(socket as unknown as ReturnType<typeof io>);
  return {socket,fire:(name:string,...args:unknown[])=>handlers.get(name)?.(...args)};
}
let cleanup=()=>{};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('NEXT_PUBLIC_PAYMENT_REALTIME_URL','http://localhost:5000');useAuthStore.getState().setSession('memory-only-token',user,'session-a');});
afterEach(()=>{cleanup();cleanup=()=>{};useAuthStore.getState().clearSession();vi.unstubAllEnvs();});
describe('S4 realtime hints, mock socket transport (no gateway)',()=>{
  it('calendar joins only the selected unit and rereads API on its exact hint',()=>{
    const f=fakeSocket(),refresh=vi.fn();cleanup=subscribeCalendarRealtime(id,refresh);f.fire('connect');
    expect(f.socket.emit.mock.calls[0].slice(0,2)).toEqual(['joinUnit',{unitId:id}]);refresh.mockClear();
    for(const body of [{unitId:'someone-else'},{bookingId:id},{unitId:id,guestName:'private'}])f.fire('CALENDAR_UPDATED',body);
    expect(refresh).not.toHaveBeenCalled();f.fire('CALENDAR_UPDATED',{unitId:id});expect(refresh).toHaveBeenCalledOnce();
  });
  it.each(['','http://evil.example','https://example.test/?token=secret','https://name:secret@example.test/','https://example.test/payments'])('does not connect to missing/unsafe configuration %j',url=>{
    vi.stubEnv('NEXT_PUBLIC_PAYMENT_REALTIME_URL',url);const refresh=vi.fn(),available=vi.fn();cleanup=subscribeBookingRealtime(id,refresh,available);
    expect(io).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();expect(available).toHaveBeenCalledWith(false);
  });
  it('sends token only in handshake auth, joins UUID and rereads API after every connect',()=>{
    const f=fakeSocket(),refresh=vi.fn(),available=vi.fn();cleanup=subscribeBookingRealtime(id,refresh,available);
    expect(io).toHaveBeenCalledWith('http://localhost:5000/payments',expect.objectContaining({auth:{token:'memory-only-token'},transports:['websocket']}));
    expect(JSON.stringify(vi.mocked(io).mock.calls[0][0])).not.toContain('token');
    f.fire('connect');expect(refresh).toHaveBeenCalledOnce();
    const [name,body,ack]=f.socket.emit.mock.calls[0];expect(name).toBe('joinBooking');expect(body).toEqual({bookingId:id});
    (ack as (error:unknown,body:unknown)=>void)(null,{ok:true});expect(available).toHaveBeenLastCalledWith(true);
    f.fire('connect');expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('ignores malformed/cross-booking hints and never marks the session paid',()=>{
    const f=fakeSocket(),refresh=vi.fn();cleanup=subscribeBookingRealtime(id,refresh);
    const before=useAuthStore.getState();
    for(const body of [null,[],{bookingId:'someone-else'},{bookingId:id,amount:'100'}])f.fire('PAYMENT_SUCCESS',body);
    expect(refresh).not.toHaveBeenCalled();f.fire('PAYMENT_SUCCESS',{bookingId:id});f.fire('CALENDAR_UPDATED',{bookingId:id});
    expect(refresh).toHaveBeenCalledTimes(2);expect(useAuthStore.getState()).toBe(before);
  });
  it('disconnects rejected ownership without turning transport failure into logout',()=>{
    const f=fakeSocket(),refresh=vi.fn(),available=vi.fn();cleanup=subscribeBookingRealtime(id,refresh,available);f.fire('connect');
    const ack=f.socket.emit.mock.calls[0][2] as (error:unknown,body:unknown)=>void;ack(null,{ok:false,errorCode:'BOOKING_NOT_FOUND'});
    expect(f.socket.disconnect).toHaveBeenCalledOnce();expect(available).toHaveBeenLastCalledWith(false);
    expect(useAuthStore.getState().status).toBe('authenticated');
  });
  it('drops late events/ack after logout or another login even to the same account',()=>{
    const f=fakeSocket(),refresh=vi.fn();cleanup=subscribeBookingRealtime(id,refresh);f.fire('connect');refresh.mockClear();
    const ack=f.socket.emit.mock.calls[0][2] as (error:unknown,body:unknown)=>void;
    useAuthStore.getState().clearSession();useAuthStore.getState().setSession('new-token',user,'session-b');
    f.fire('PAYMENT_SUCCESS',{bookingId:id});ack(null,{ok:true});expect(refresh).not.toHaveBeenCalled();expect(f.socket.disconnect).toHaveBeenCalled();
  });
  it('rotates the socket on access-token refresh and ignores the previous socket',()=>{
    const first=fakeSocket(),refresh=vi.fn();cleanup=subscribeBookingRealtime(id,refresh);const second=fakeSocket();
    useAuthStore.getState().setAccessToken('rotated-memory-token');expect(first.socket.disconnect).toHaveBeenCalled();
    first.fire('PAYMENT_SUCCESS',{bookingId:id});expect(refresh).not.toHaveBeenCalled();second.fire('connect');expect(refresh).toHaveBeenCalledOnce();
    expect(vi.mocked(io).mock.calls.at(-1)![1]).toMatchObject({auth:{token:'rotated-memory-token'}});
  });
  it('unmount closes connection and stops late callback effects',()=>{
    const f=fakeSocket(),refresh=vi.fn();cleanup=subscribeBookingRealtime(id,refresh);cleanup();f.fire('connect');f.fire('PAYMENT_SUCCESS',{bookingId:id});
    expect(refresh).not.toHaveBeenCalled();expect(f.socket.disconnect).toHaveBeenCalledOnce();
  });
});
