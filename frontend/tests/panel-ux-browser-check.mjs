// Isolated presentation fixtures: no real accounts, notifications, messages or Socket writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureFrontend} from './fixture-frontend.mjs';
const {chromium}=createRequire(import.meta.url)(process.argv[3]||'playwright');
const app=await fixtureFrontend(resolve(process.argv[2]),()=>({success:true,data:[],meta:{page:1,limit:20,total:0,totalPages:0}}));
assert.equal(app.serverFixture,true,'Only isolated frontend fixtures permitted');
const baseline=Boolean(process.env.PANEL_BASELINE),evidence=process.env.BROWSER_EVIDENCE_DIR;
const ok=data=>({success:true,message:'Presentation fixture',data});
const user={id:'00000000-0000-4000-8000-000000000001',fullName:'Khách thử giao diện',phone:'0990000000',role:'TENANT',status:'ACTIVE',isPhoneVerified:true};
const conversations=Array.from({length:12},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+2).padStart(12,'0')}`,propertyId:'00000000-0000-4000-8000-000000000099',title:i===0?'Phòng có ban công, gần trường đại học — tên tin dài để kiểm tra xuống dòng':`Phòng cho thuê ${i+1}`,guest:{id:user.id,fullName:user.fullName},host:{id:'00000000-0000-4000-8000-000000000098',fullName:i===0?'Nguyễn Hoàng Minh Anh — tên dài':`Chủ nhà ${i+1}`},createdAt:'2026-10-10T00:00:00Z',canSend:i!==1,readOnlyReason:i===1?'Tin đã xóa, chỉ xem lịch sử.':null}));
const notices=Array.from({length:8},(_,i)=>({id:`notice-${i}`,appointmentId:'fixture-only',type:'APPOINTMENT_ACCEPTED',message:i===0?'Chủ nhà đã xác nhận lịch xem trọ của bạn. Tên phòng khá dài để kiểm tra bố cục.':`Lịch xem trọ ${i+1} đã được cập nhật`,readAt:i%2?'2026-10-10T00:00:00Z':null,createdAt:'2026-10-10T01:00:00Z'}));
export async function installPanelFixtures(context,state={rows:conversations,mode:'ok'}) {
  await context.routeWebSocket('ws://localhost:5000/socket.io/**',socket=>socket.close());
  await context.route('**/api/auth/refresh',r=>r.fulfill({json:ok({accessToken:'fixture-only',user})}));
  await context.route('**/api/auth/me',r=>r.fulfill({json:ok(user)}));
  await context.route('**/api/management/**',async r=>{
    const path=new URL(r.request().url()).pathname;
    if(path.endsWith('/notifications'))return r.fulfill({json:{...ok(notices),meta:{page:1,limit:20,total:8,totalPages:1,unreadCount:4}}});
    if(path.endsWith('/conversations/unread'))return r.fulfill({json:ok({totalUnread:1,conversations:[{conversationId:conversations[0].id,unreadCount:1}]})});
    if(path.endsWith('/conversations')) {
      if(state.mode==='loading')await new Promise(done=>{state.release=done;});
      if(state.mode==='error')return r.fulfill({status:503,json:{success:false,message:'Không tải được cuộc trò chuyện thử nghiệm.'}});
      return r.fulfill({json:{...ok(state.rows),meta:{page:1,limit:20,total:state.rows.length,totalPages:1}}});
    }
    if(path.endsWith('/messages'))return r.fulfill({json:ok({conversation:conversations.find(c=>path.includes(c.id)),messages:[],nextCursor:null})});
    return r.fulfill({status:405,json:{success:false,message:'No writes allowed in panel fixture'}});
  });
}
const chat=p=>p.getByRole('dialog',{name:'Tin nhắn',exact:true});
const notifications=p=>p.getByRole('dialog',{name:'Thông báo',exact:true});
const trigger=p=>p.getByRole('button',{name:'Mở tin nhắn',exact:true});
const bell=p=>p.getByRole('button',{name:'Thông báo, 4 chưa đọc',exact:true});
async function shot(page,name) {
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
  if(evidence)await page.screenshot({path:`${evidence}/${name}-${page.viewportSize().width}.png`});
}
async function size(page) {
  const box=await chat(page).boundingBox();
  const launcher=await trigger(page).boundingBox();
  if(page.viewportSize().width>=768) {
    assert.ok(box.height<=page.viewportSize().height*.7+1,'Desktop list <=70vh');
    assert.ok(box.width>=360&&box.width<=380,'Desktop width 360–380px');
    assert.ok(Math.abs(box.x+box.width-launcher.x-launcher.width)<1,'Same right edge as launcher');
    assert.ok(Math.abs(launcher.y-box.y-box.height-6)<1,'Anchored 6px above launcher');
  } else {
    assert.ok(box.width>=page.viewportSize().width-32,'Mobile nearly full width');
    assert.ok(box.height<=page.viewportSize().height-199,'Mobile fits usable height');
    assert.ok(box.y+box.height<=launcher.y-3,'Mobile launcher not covering list');
    const nav=await page.locator('.mobile-nav').boundingBox();
    assert.ok(box.y+box.height<=nav.y,'Bottom navigation not covering list');
  }
  assert.ok(box.y>=64&&box.y+box.height<=page.viewportSize().height,'Header bell remains reachable; panel inside viewport');
  assert.ok(Math.abs(box.height-Math.min(page.viewportSize().height*.7,page.viewportSize().height-(page.viewportSize().width>=768?112:200)))<1,'List retains the same viewport-capped height for every state');
  assert.equal(await chat(page).evaluate(el=>getComputedStyle(el).zIndex),'600','Reuse existing overlay layer');
  return box.height;
}
async function oneLayer(page) {
  assert.equal(await page.getByRole('dialog').count(),1,'Only one visible floating panel, even during handoff');
}
function luminance(rgb) {
  const values=rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return .2126*values[0]+.7152*values[1]+.0722*values[2];
}
async function contrast(element) {
  const color=await element.evaluate(el=>getComputedStyle(el).color);
  const channels=color.startsWith('color(srgb')?color.match(/[\d.]+/g).slice(0,3).map(v=>Number(v)*255):color.match(/[\d.]+/g).slice(0,3).map(Number);
  assert.ok(1.05/(luminance(channels)+.05)>=4.5,`Secondary text has >=4.5 contrast on white: ${color}`);
}
let browser;
try {
  if(evidence)await mkdir(evidence,{recursive:true});
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined,headless:true});
  for(const width of [375,1440]) {
    const page=await browser.newPage({viewport:{width,height:900}}),state={rows:conversations,mode:'ok'};
    await installPanelFixtures(page,state);await page.goto(app.baseUrl+'/account');await trigger(page).click();
    await chat(page).getByRole('button',{name:new RegExp(conversations[0].title)}).waitFor();await shot(page,'chat-list');
    if(!baseline) {
      const listHeight=await size(page);
      assert.ok(Math.abs(listHeight-630)<1,'Long list uses the shared 70vh height');
      const close=chat(page).getByRole('button',{name:'Đóng tin nhắn',exact:true});
      const closeBox=await close.boundingBox();assert.ok(closeBox.width>=44&&closeBox.height>=44,'Close remains 44px');
      assert.equal(await close.locator('svg').evaluate(el=>getComputedStyle(el).width),'16px','Smaller close glyph');
      assert.equal(await chat(page).getByRole('heading').evaluate(el=>getComputedStyle(el).fontSize),'14px','Compact heading');
      assert.ok(await chat(page).locator('header').evaluate(el=>el.getBoundingClientRect().height<=58),'Compact header padding');
      assert.equal(await chat(page).locator('time').count(),0,'No made-up last-message time from conversation creation date');
      const row=chat(page).locator('li button').first();
      assert.equal(await row.locator('[aria-hidden="true"]').first().innerText(),'N','Initial avatar');
      const avatar=await row.locator('[aria-hidden="true"]').first().boundingBox();assert.ok(avatar.width>=36&&avatar.width<=40&&avatar.height===avatar.width,'Avatar 36–40px');
      assert.equal(await row.getByText('Có tin nhắn chưa đọc',{exact:true}).count(),1,'Unread dot from matching server response');
      assert.equal(await chat(page).locator('li button').nth(1).getByText('Có tin nhắn chưa đọc',{exact:true}).count(),0,'No invented unread dot for other rows');
      const name=await row.getByText(conversations[0].host.fullName,{exact:true}).evaluate(el=>getComputedStyle(el).fontWeight);
      assert.ok(Number(name)>=600,'Person name is primary');
      await contrast(row.getByText(conversations[0].title,{exact:true}));
      assert.equal(await chat(page).locator('li').nth(1).evaluate(el=>getComputedStyle(el).borderTopWidth),'1px','Thin row separators');
      await row.hover();await shot(page,'chat-hover');
      assert.notEqual(await row.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)','Clear hover');
      assert.ok(await chat(page).locator('div.overflow-y-auto').evaluate(el=>el.scrollHeight>el.clientHeight),'Long list scrolls inside panel');
      if(width===1440) {
        await bell(page).click();await notifications(page).waitFor();await oneLayer(page);
        await page.waitForTimeout(200);
        assert.equal(await notifications(page).getByRole('heading').evaluate(el=>el===document.activeElement),true,'Focus handed to notifications');
        await contrast(notifications(page).locator('time').first());await shot(page,'notifications');
        await trigger(page).click();await chat(page).waitFor();await oneLayer(page);
        await page.waitForTimeout(200);
        assert.equal(await chat(page).getByRole('heading').evaluate(el=>el===document.activeElement),true,'Focus handed to chat');
        for(let i=0;i<3;i++){await bell(page).click();await notifications(page).waitFor();await oneLayer(page);await trigger(page).click();await chat(page).waitFor();await oneLayer(page);}
      } else {
        await bell(page).click();await page.waitForURL('**/notifications');await chat(page).waitFor({state:'hidden'});
        assert.equal(await page.getByRole('dialog').count(),0,'Mobile navigation closes chat, no popup');
        await trigger(page).click();await chat(page).waitFor();
      }
    } else if(width===1440) {
      await page.keyboard.press('Escape');await chat(page).waitFor({state:'hidden'});await bell(page).click();await notifications(page).waitFor();await shot(page,'notifications');await page.keyboard.press('Escape');await trigger(page).click();
    }
    state.rows=conversations.slice(0,1);await page.reload();await trigger(page).click();await chat(page).locator('li button').waitFor();await shot(page,'chat-short');
    if(!baseline) {
      const height=await size(page);
      assert.ok(Math.abs(height-630)<1,'One conversation keeps the same height as a long list');
    }
    await chat(page).locator('li button').click();await page.getByText('Chưa có tin nhắn',{exact:true}).waitFor();await shot(page,'chat-thread');
    if(!baseline) {
      const box=await page.getByRole('dialog').boundingBox();assert.ok(box.height<=630,'Thread <=70vh');
      assert.ok(Math.abs(box.height-630)<1,'Empty conversations retain the same 70vh height as populated threads');
      const input=await page.getByLabel('Tin nhắn',{exact:true}).boundingBox();assert.ok(input.y+input.height<=box.y+box.height,'Composer visible');
    }
    state.rows=[];await page.reload();await trigger(page).click();await page.getByText('Chọn “Chat với chủ nhà” trên tin để bắt đầu.').waitFor();await shot(page,'chat-empty');
    if(!baseline)assert.ok(Math.abs(await size(page)-630)<1,'Empty list keeps the same height as a conversation');
    state.mode='error';await page.reload();await trigger(page).click();await chat(page).getByRole('alert').waitFor();await shot(page,'chat-error');
    if(!baseline)await size(page);
    state.mode='loading';await page.reload();await trigger(page).click();await chat(page).getByRole('status').waitFor();await shot(page,'chat-loading');state.mode='ok';state.release();
    if(!baseline)await size(page);
    await page.close();
  }
  console.log(baseline?'Baseline 375/1440 captured.':'PASS: 375/1440; list and thread share 70vh, including short/empty lists; desktop 370px, right edge + 6px gap; compact header/44px close; mobile clear of launcher/nav; inner scroll; truthful metadata; single layer/focus; loading/error; visible composer. HTTP/WS fixtures only, no writes.');
} finally {await browser?.close();await app.close();}
