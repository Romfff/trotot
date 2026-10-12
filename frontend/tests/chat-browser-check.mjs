// UI fixture mode, or real protected BFF/API/DB via isolated integration runner.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {fixtureFrontend} from './fixture-frontend.mjs';
import {loginThroughUi,logoutThroughUi} from './login-through-ui.mjs';
const {chromium}=createRequire(import.meta.url)(process.argv[3]||'playwright');
const dir=resolve(process.argv[2]||'.'),live=process.env.CHAT_BROWSER_FIXTURE?JSON.parse(process.env.CHAT_BROWSER_FIXTURE):null;
const evidence=process.env.BROWSER_EVIDENCE_DIR;
const bridges=new Set();
const uid='00000000-0000-4000-8000-000000000002',cid='00000000-0000-4000-8000-000000000003';
const user=live?.user||{id:uid,phone:'0990000000',fullName:'Synthetic guest',role:'TENANT',status:'ACTIVE',email:null,avatarUrl:null,isPhoneVerified:true,isIdentityVerified:false,createdAt:null,updatedAt:null};
const convo=live?.conversation||{id:cid,propertyId:'00000000-0000-4000-8000-000000000004',title:'Phòng '+ 'địa chỉ dài '.repeat(14),guest:{id:uid,fullName:'Synthetic guest'},host:{id:'00000000-0000-4000-8000-000000000005',fullName:'Synthetic Host'},createdAt:'2026-10-08T00:00:00Z',canSend:true,readOnlyReason:null};
const ok=data=>({success:true,message:'Synthetic fixture',data}),pageList=data=>({...ok(data),meta:{page:1,limit:20,total:data.length,totalPages:data.length?1:0}});
async function realFrontend() {
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(live.api))throw new Error('Only isolated API allowed');
  const reserved=createServer();reserved.listen(0,'127.0.0.1');await once(reserved,'listening');
  const port=reserved.address().port;await new Promise(done=>reserved.close(done));const baseUrl=`http://localhost:${port}`;
  const child=spawn(process.execPath,[resolve(dir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
    cwd:dir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:`${live.api}/api/v1`,FRONTEND_ORIGIN:baseUrl,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
  const close=async()=>{if(child.exitCode===null){const done=once(child,'close');child.kill();await done;}};
  try{for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('Isolated frontend exited');if(await fetch(baseUrl+'/login').then(r=>r.ok,()=>false))return {baseUrl,close};await new Promise(done=>setTimeout(done,100));}throw new Error('Frontend readiness timeout');}catch(error){await close();throw error;}
}
const app=live?await realFrontend():await fixtureFrontend(dir,()=>pageList([]));
let browser;
try {
  if(evidence)await mkdir(evidence,{recursive:true});
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});
  async function newPage(width,credentials=live?.login){const page=await browser.newPage({viewport:{width,height:900}});
    if(!live){
      await page.routeWebSocket('ws://localhost:5000/socket.io/**',socket=>socket.close());
      await page.route('**/api/auth/refresh',r=>r.fulfill({json:ok({accessToken:'synthetic-token',user})}));
      await page.route('**/api/auth/me',r=>r.fulfill({json:ok(user)}));
      await page.route('**/api/auth/logout',r=>r.fulfill({json:ok({signedOut:true})}));
      await page.route('**/api/management/conversations/unread',r=>r.fulfill({json:ok({totalUnread:0,conversations:[]})}));
      await page.route('**/api/management/notifications?*',r=>r.fulfill({json:{...ok([]),meta:{page:1,limit:20,total:0,totalPages:0,unreadCount:0}}}));
      await page.route('**/api/management/conversations/*/read',r=>r.fulfill({status:201,json:ok({conversationId:cid,messageId:r.request().postDataJSON().messageId})}));
    }
    if(live){
      // Transport-only bridge: forward real Engine.IO/Socket.IO frames unchanged
      // to the isolated server. No fake ack/events, token in query, or main DB.
      const WebSocket=createRequire(resolve(import.meta.dirname,'../../backend/package.json'))('ws');
      await page.routeWebSocket('ws://localhost:5000/socket.io/**',route=>{
        const url=new URL(route.url());const upstream=new URL(live.api);
        url.host=upstream.host;url.protocol='ws:';
        const socket=new WebSocket(url,{headers:{Origin:'http://localhost:3000'}}),pending=[];
        bridges.add(socket);
        route.onMessage(frame=>socket.readyState===WebSocket.OPEN?socket.send(frame):pending.push(frame));
        socket.on('open',()=>{for(const frame of pending)socket.send(frame);pending.length=0;});
        socket.on('message',(frame,binary)=>route.send(binary?frame:frame.toString()));
        socket.on('close',()=>{bridges.delete(socket);void route.close();});
        socket.on('error',()=>{void route.close();});
        route.onClose(()=>socket.close());
      });
      await loginThroughUi(page,app.baseUrl,credentials);
    }
    return page;}
  async function shot(page,name){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow');
    const panel=page.getByRole('dialog');const box=await panel.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=page.viewportSize().width&&box.y>=0&&box.y+box.height<=900,'chat panel inside viewport');
    if(!live&&['chat-empty','chat-bubbles','chat-readonly','chat-history-error'].includes(name))assert.ok(Math.abs(box.height-630)<1,'Conversation height stays 70vh across empty/messages/readonly/error');
    if(evidence)await page.screenshot({path:`${evidence}/${name}-${page.viewportSize().width}.png`});}
  async function open(page){await page.goto(app.baseUrl+'/account');await page.getByRole('button',{name:'Mở tin nhắn',exact:true}).click();}
  if(live){
    const page=await newPage(375);await open(page);await page.getByRole('button',{name:convo.title,exact:false}).click();
    await page.getByText('Đã kết nối',{exact:true}).waitFor();
    await page.getByLabel('Tin nhắn',{exact:true}).fill('Synthetic real BFF chat <script>window.__chatXss=1</script>');
    const sent=page.waitForResponse(r=>r.url().endsWith(`/conversations/${convo.id}/messages`)&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Gửi',exact:true}).click();assert.equal((await sent).status(),201);
    await page.getByRole('list',{name:'Lịch sử tin nhắn'}).getByText('Synthetic real BFF chat <script>window.__chatXss=1</script>',{exact:true}).waitFor();
    const hostPage=await newPage(1440,live.hostLogin);
    await hostPage.getByTestId('chat-unread-dot').waitFor();
    if(evidence)await hostPage.screenshot({path:`${evidence}/unread-closed-host-1440.png`});
    await open(hostPage);
    await hostPage.getByRole('button',{name:convo.title,exact:false}).click();
    await hostPage.getByText('Đã kết nối',{exact:true}).waitFor();
    await hostPage.getByRole('list',{name:'Lịch sử tin nhắn'}).getByText('Synthetic real BFF chat <script>window.__chatXss=1</script>',{exact:true}).waitFor();
    await hostPage.getByTestId('chat-unread-dot').waitFor({state:'hidden'});
    await hostPage.getByLabel('Tin nhắn',{exact:true}).fill('Synthetic Host reply');
    const reply=hostPage.waitForResponse(r=>r.url().endsWith(`/conversations/${convo.id}/messages`)&&r.request().method()==='POST');
    await hostPage.getByRole('button',{name:'Gửi',exact:true}).click();assert.equal((await reply).status(),201);
    await page.getByText('Synthetic Host reply',{exact:true}).waitFor();
    await page.getByTestId('chat-unread-dot').waitFor({state:'hidden'});
    for(const width of [375,1440]){await page.setViewportSize({width,height:900});await shot(page,'real-bff-chat');}
    for(const width of [375,1440]){await hostPage.setViewportSize({width,height:900});await shot(hostPage,'real-bff-host-chat');}
    assert.equal(await page.evaluate(()=>window.__chatXss),undefined);
    await page.getByRole('button',{name:'Đóng tin nhắn',exact:true}).click();
    await hostPage.getByLabel('Tin nhắn',{exact:true}).fill('Synthetic inbox while closed');
    const closedReply=hostPage.waitForResponse(r=>r.url().endsWith(`/conversations/${convo.id}/messages`)&&r.request().method()==='POST');
    await hostPage.getByRole('button',{name:'Gửi',exact:true}).click();assert.equal((await closedReply).status(),201);
    await page.getByTestId('chat-unread-dot').waitFor();
    for(const width of [375,1440]){await page.setViewportSize({width,height:900});if(evidence)await page.screenshot({path:`${evidence}/unread-closed-guest-${width}.png`});}
    await page.reload();await page.getByTestId('chat-unread-dot').waitFor();
    // Deterministic visibility boundary; not a physical-device background-tab test.
    await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'}));
    let reads=0;page.on('request',r=>{if(r.url().endsWith(`/conversations/${convo.id}/read`)&&r.method()==='POST')reads++;});
    await page.getByRole('button',{name:'Mở tin nhắn',exact:true}).click();await page.getByRole('button',{name:convo.title,exact:false}).click();
    await page.getByText('Synthetic inbox while closed',{exact:true}).waitFor();await page.waitForTimeout(250);
    assert.equal(reads,0,'Hidden tab must not mark read');assert.equal(await page.getByTestId('chat-unread-dot').count(),1);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.getByTestId('chat-unread-dot').waitFor({state:'hidden'});assert.ok(reads>0);
    await logoutThroughUi(page);assert.equal(await page.getByRole('button',{name:'Mở tin nhắn',exact:true}).count(),0);
    await loginThroughUi(page,app.baseUrl,live.otherLogin);await open(page);
    await page.getByText('Chọn “Chat với chủ nhà” trên tin để bắt đầu.').waitFor();
    assert.equal(await page.getByRole('button',{name:convo.title,exact:false}).count(),0,'Different Tenant cannot see cached conversation');
    await page.keyboard.press('Escape');await logoutThroughUi(page);await logoutThroughUi(hostPage);
    await page.close();await hostPage.close();
    console.log('REAL PASS: real Tenant/Host UI login, protected BFF/DB and realtime both ways without reload, closed inbox dot, read clearing, reload persistence, hidden-tab boundary, logout/cache isolation, escaped text, 375/1440. Transport-only WS bridge to isolated API; not deployment/device acceptance.');
  } else {
    for(const width of [375,1440]){
      const page=await newPage(width);let mode='list-error',rows=[],posts=0,firstKey,release;let readonly=false;
      await page.route('**/api/management/conversations?*',r=>mode==='list-error'?r.fulfill({status:503,json:{success:false,message:'Chưa tải được tin nhắn fixture.'}}):r.fulfill({json:pageList([convo])}));
      await page.route(`**/api/management/conversations/${cid}/messages?*`,r=>mode==='history-error'?r.fulfill({status:503,json:{success:false,message:'Không tải được lịch sử fixture.'}}):r.fulfill({json:ok({conversation:{...convo,canSend:!readonly,readOnlyReason:readonly?'Tin đã xóa, chỉ xem lịch sử.':null},messages:rows,nextCursor:null})}));
      await page.route(`**/api/management/conversations/${cid}/messages`,async r=>{
        posts++;const body=r.request().postDataJSON();assert.equal(body.text,'<script>window.__chatXss=1</script> '+'URL'.repeat(200));
        if(!firstKey)firstKey=body.clientMessageId;else assert.equal(body.clientMessageId,firstKey,'retry keeps UUID');
        if(mode==='slow')await new Promise(done=>{release=done;});
        if(mode==='send-error')return r.fulfill({status:503,json:{success:false,message:'Chưa gửi được fixture.'}});
        const entry={...body,id:'00000000-0000-4000-8000-000000000006',conversationId:cid,senderId:uid,createdAt:'2026-10-08T00:00:00Z'};
        rows=[entry];return r.fulfill({status:201,json:ok(entry)});
      });
      await open(page);await page.getByRole('alert').getByText('Chưa tải được tin nhắn fixture.',{exact:true}).waitFor();await shot(page,'chat-error');
      mode='ok';await page.getByRole('dialog').getByRole('button',{name:'Thử lại'}).click();
      await page.getByRole('button',{name:convo.title,exact:false}).click();await page.getByText('Chưa có tin nhắn',{exact:true}).waitFor();await shot(page,'chat-empty');
      const panel=page.getByRole('dialog'),input=page.getByLabel('Tin nhắn',{exact:true});
      await panel.getByRole('heading',{name:convo.host.fullName,exact:true}).waitFor();
      assert.equal(await panel.getByText(`Tin: ${convo.title}`,{exact:true}).count(),1,'Property title is labeled, not mistaken for an ID');
      assert.equal(await panel.getByText('Chưa kết nối realtime',{exact:true}).count(),1);assert.equal(await panel.getByText('Đã kết nối',{exact:true}).count(),0,'Do not fake a realtime connection');
      for(const label of ['Về danh sách tin nhắn','Tải lại tin nhắn','Đóng tin nhắn','Gửi']){const box=await panel.getByRole('button',{name:label,exact:true}).boundingBox();assert.ok(box.width>=44&&box.height>=44,'44px action: '+label);}
      assert.equal(await panel.getByText('0/3000',{exact:true}).count(),0);
      assert.ok((await input.boundingBox()).height<=46,'Composer starts at one line');
      await input.fill('a'.repeat(2700));await panel.getByText('2700/3000',{exact:true}).waitFor();
      await input.fill('a'.repeat(3000));assert.equal(await input.inputValue(),'a'.repeat(3000));
      await page.waitForFunction(()=>{const el=document.querySelector('[name=chatMessage]');return el&&el.clientHeight<=116&&el.scrollHeight>el.clientHeight;});
      await shot(page,'chat-limit');await input.fill('');
      mode='history-error';await panel.getByRole('button',{name:'Tải lại tin nhắn'}).click();await panel.getByRole('alert').getByText('Không tải được lịch sử fixture.',{exact:true}).waitFor();await shot(page,'chat-history-error');
      mode='ok';await panel.getByRole('button',{name:'Thử lại',exact:true}).click();await panel.getByRole('alert').waitFor({state:'hidden'});
      const draft='<script>window.__chatXss=1</script> '+'URL'.repeat(200);await page.getByLabel('Tin nhắn',{exact:true}).fill(draft);
      mode='send-error';await page.getByRole('button',{name:'Gửi',exact:true}).click();await page.getByRole('alert').getByText('Chưa gửi được fixture.').waitFor();assert.equal(await page.getByLabel('Tin nhắn',{exact:true}).inputValue(),draft);
      mode='slow';await page.getByRole('button',{name:'Gửi',exact:true}).dblclick();await page.waitForFunction(()=>!!document.querySelector('form button[aria-busy="true"]'));assert.equal(posts,2);release();
      await page.getByRole('list',{name:'Lịch sử tin nhắn'}).getByText(draft,{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__chatXss),undefined);await shot(page,'chat-sent');
      rows=Array.from({length:30},(_,index)=>({id:`fixture-${String(index).padStart(3,'0')}`,conversationId:cid,senderId:index%2?uid:convo.host.id,clientMessageId:`fixture-client-${index}`,text:`Tin ${index}: `+'Nội dung trao đổi về phòng. '.repeat(3),createdAt:index<15?`2026-10-08T0${Math.floor(index/10)}:${String(index%10).padStart(2,'0')}:00Z`:`2026-10-09T01:${String(index).padStart(2,'0')}:00Z`}));
      await panel.getByRole('button',{name:'Tải lại tin nhắn'}).click();await page.getByText(rows.at(-1).text,{exact:true}).waitFor();
      assert.equal(await panel.locator('ol > li.text-center > time[datetime]').count(),2,'One separator for each Vietnam day');
      await shot(page,'chat-bubbles');
      const scroll=panel.locator('div[aria-busy]').filter({has:page.getByRole('list',{name:'Lịch sử tin nhắn'})});
      await scroll.evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll',{bubbles:true}));});
      const olderPosition=await scroll.evaluate(el=>el.scrollTop);
      rows.push({id:'fixture-999',conversationId:cid,senderId:convo.host.id,clientMessageId:'fixture-new',text:'Tin mới khi đang đọc phía trên',createdAt:'2026-10-09T02:00:00Z'});
      await panel.getByRole('button',{name:'Tải lại tin nhắn'}).click();await panel.getByRole('button',{name:'Tin mới',exact:true}).waitFor();
      assert.equal(await scroll.evaluate(el=>el.scrollTop),olderPosition,'New message must not drag an older reader to the bottom');await shot(page,'chat-new-message');
      await panel.getByRole('button',{name:'Tin mới',exact:true}).click();await panel.getByRole('button',{name:'Tin mới',exact:true}).waitFor({state:'hidden'});
      assert.ok(await scroll.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<2),'New message button scrolls to latest');
      if(width===375){
        await page.evaluate(()=>{window.__chatViewportHeight=Object.getOwnPropertyDescriptor(window.visualViewport,'height');Object.defineProperty(window.visualViewport,'height',{configurable:true,value:480});window.visualViewport.dispatchEvent(new Event('resize'));});
        const box=await panel.boundingBox(),composer=await input.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=480,'Panel fits simulated keyboard viewport');assert.ok(composer.y+composer.height<=480,'Composer stays above simulated keyboard');await shot(page,'chat-keyboard');
        await page.waitForFunction(()=>{const root=document.querySelector('[aria-label="Lịch sử tin nhắn"]')?.parentElement;return root&&root.scrollHeight-root.scrollTop-root.clientHeight<2;});
        await page.evaluate(()=>{if(window.__chatViewportHeight)Object.defineProperty(window.visualViewport,'height',window.__chatViewportHeight);else delete window.visualViewport.height;window.visualViewport.dispatchEvent(new Event('resize'));});
      }
      readonly=true;await page.getByRole('button',{name:'Tải lại tin nhắn'}).click();await page.getByText('Tin đã xóa, chỉ xem lịch sử.').waitFor();assert.equal(await page.getByLabel('Tin nhắn',{exact:true}).count(),0);await shot(page,'chat-readonly');
      await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
      await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Mở tin nhắn');
      assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Mở tin nhắn');
      await page.close();
    }
    const page=await newPage(375);await page.route('**/api/management/conversations?*',r=>r.fulfill({json:pageList([])}));await open(page);
    await page.getByText('Chọn “Chat với chủ nhà” trên tin để bắt đầu.').waitFor();await shot(page,'chat-list-empty');await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Mở menu tài khoản',exact:true}).click();await page.getByRole('menuitem',{name:'Đăng xuất',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Đăng xuất',exact:true}).click();
    await page.getByRole('link',{name:'Đăng nhập',exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:'Mở tin nhắn',exact:true}).count(),0);await page.close();
    console.log('FIXTURE PASS: list/history error/retry/empty, compact header/property title, 44px actions, honest offline status, one-line/4-line composer/limit counter, daily bubbles, no forced scroll while reading, new-message button, simulated keyboard viewport, draft after failure, UUID retry, double-submit lock, escaped long text, readonly reason, Escape/focus, logout removal, 375/1440. HTTP/Auth fixtures, no DB writes.');
  }
} finally {for(const socket of bridges)socket.terminate();await browser?.close();await app.close();}
