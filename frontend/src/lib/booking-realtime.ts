import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth-store';

// Hints never write auth/query/payment state. The consumer must read its authoritative API.
export function subscribeBookingRealtime(bookingId:string, refresh:()=>void, availability?:(connected:boolean)=>void) {
  return subscribeResourceRealtime('bookingId',bookingId,refresh,availability);
}
export function subscribeCalendarRealtime(unitId:string,refresh:()=>void,availability?:(connected:boolean)=>void) {
  return subscribeResourceRealtime('unitId',unitId,refresh,availability);
}
function subscribeResourceRealtime(field:'bookingId'|'unitId',id:string,refresh:()=>void,availability?:(connected:boolean)=>void) {
  const configured=process.env.NEXT_PUBLIC_PAYMENT_REALTIME_URL;
  if(!configured) {availability?.(false);return ()=>{};}
  let origin:string;
  try {
    const url=new URL(configured);
    if(url.username || url.password || url.search || url.hash || url.pathname!=='/'
      || !(url.protocol==='https:' || (url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error();
    origin=url.origin;
  } catch {availability?.(false);return ()=>{};}
  const sessionId=useAuthStore.getState().sessionId;
  if(!sessionId) {availability?.(false);return ()=>{};}
  let stopped=false, socket:Socket|undefined;
  const current=()=>!stopped && useAuthStore.getState().sessionId===sessionId && useAuthStore.getState().status==='authenticated';
  function reconnect() {
    socket?.disconnect();socket=undefined;
    const state=useAuthStore.getState();
    if(!current() || !state.accessToken) {availability?.(false);return;}
    const active=io(`${origin}/payments`,{path:'/socket.io',transports:['websocket'],auth:{token:state.accessToken},
      reconnectionAttempts:5,reconnectionDelay:1000,reconnectionDelayMax:10000,timeout:10000});
    socket=active;
    const isCurrent=()=>current() && socket===active;
    active.on('connect',()=>{
      if(!isCurrent()) return;
      // Reconnect always repairs missed events by rereading the API, even before join completes.
      refresh();
      active.timeout(5000).emit(field==='bookingId'?'joinBooking':'joinUnit',{[field]:id},(error:unknown,ack:unknown)=>{
        if(!isCurrent()) return;
        const accepted=!error && !!ack && typeof ack==='object' && 'ok' in ack && ack.ok===true;
        availability?.(accepted);
        if(!accepted) active.disconnect();
      });
    });
    for(const name of field==='bookingId'?['PAYMENT_SUCCESS','CALENDAR_UPDATED']:['CALENDAR_UPDATED']) active.on(name,(body:unknown)=>{
      if(isCurrent() && body && typeof body==='object' && !Array.isArray(body) && Object.keys(body).length===1
        && field in body && (body as Record<string,unknown>)[field]===id) refresh();
    });
    active.on('disconnect',()=>{if(isCurrent()) availability?.(false);});
    active.on('connect_error',()=>{if(isCurrent()) availability?.(false);});
  }
  const unsubscribe=useAuthStore.subscribe((state,previous)=>{
    if(state.sessionId!==sessionId || state.status!=='authenticated') {socket?.disconnect();socket=undefined;availability?.(false);}
    else if(state.accessToken!==previous.accessToken) reconnect();
  });
  reconnect();
  return ()=>{stopped=true;unsubscribe();socket?.disconnect();socket=undefined;};
}
