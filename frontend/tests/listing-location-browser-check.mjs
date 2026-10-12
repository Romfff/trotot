// Frontend browser/transport fixtures only: no DB writes, real login, geocoder, or live tile downloads.
// node tests/listing-location-browser-check.mjs <built frontend dir> <playwright package path> <evidence dir>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fixtureFrontend } from "./fixture-frontend.mjs";

const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[3] || "playwright");
const app=await fixtureFrontend(process.argv[2],()=>({success:true,data:[],meta:{page:1,total:0,totalPages:0}}));
const evidence=process.argv[4] || "../.tmp/listing-location"; await mkdir(evidence,{recursive:true});
const user={id:"00000000-0000-4000-8000-000000000001",phone:"0990000000",email:null,fullName:"Chủ nhà kiểm thử",role:"HOST",status:"ACTIVE",avatarUrl:null,isPhoneVerified:true,isIdentityVerified:false,createdAt:null,updatedAt:null};
const point={latitude:10.773333,longitude:106.658889}; const wardPoint={latitude:10.7725,longitude:106.6578};
const tile=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eef2ed"/><path d="M0 50H256M0 170H256M60 0V256M180 0V256" stroke="#fff" stroke-width="18"/><path d="M0 50H256M0 170H256M60 0V256M180 0V256" stroke="#d5ddd7" stroke-width="2"/><rect x="80" y="75" width="72" height="64" rx="8" fill="#d9e8d7"/><text x="12" y="235" font-family="sans-serif" font-size="12" fill="#52605c">Nền bản đồ kiểm thử</text></svg>');
let browser; let assertions=0;
try {
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge"});
  for (const width of [375,1440]) {
    const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===375,isMobile:width===375}); const page=await context.newPage();
    const calls=[]; let mode="found"; let release; let saveBody; let saveCalls=0;
    await context.route("https://tile.openstreetmap.org/**",r=>r.fulfill({contentType:"image/svg+xml",body:tile}));
    await context.route("https://fonts.googleapis.com/**",r=>r.abort()); await context.route("https://fonts.gstatic.com/**",r=>r.abort());
    await context.route("**/api/auth/refresh",r=>r.fulfill({json:{success:true,message:"Fixture session",data:{user,accessToken:"fixture-only-access"}}}));
    await context.route("**/api/auth/me",r=>r.fulfill({json:{success:true,data:user}}));
    await context.route("**/api/management/conversations/unread",r=>r.fulfill({json:{success:true,data:{totalUnread:0,conversations:[]}}}));
    await context.route("**/api/listings/catalog/provinces",r=>r.fulfill({json:{success:true,data:{version:"fixture",asOf:"2026-10-05",sourceUrl:"https://example.test",items:[{code:"79",name:"TP.HCM (kiểm thử)"},{code:"01",name:"Hà Nội (kiểm thử)"}]}}}));
    await context.route("**/api/listings/catalog/wards?*",r=>r.fulfill({json:{success:true,data:{version:"fixture",asOf:"2026-10-05",sourceUrl:"https://example.test",items:[{code:"26740",name:"Phường kiểm thử A",provinceCode:"79"},{code:"26741",name:"Phường kiểm thử B",provinceCode:"79"}]}}}));
    await context.route("**/api/listings/amenities",r=>r.fulfill({json:{success:true,data:[]}}));
    await context.route("**/api/listing-location",async r=>{
      if(mode==="blocker") return r.continue(); // Actual unconfigured Next handler.
      const body=r.request().postDataJSON(); calls.push(body);
      if(mode==="delayed" && body.addressDetail) { await new Promise(resolve=>{release=resolve;}); return r.fulfill({json:{success:true,data:{point}}}); }
      return r.fulfill({json:{success:true,data:{point:body.addressDetail ? mode==="missing" ? null : point : wardPoint}}});
    });
    await context.route("**/api/management/properties/long-term",r=>{saveCalls++;saveBody=r.request().postDataJSON();return r.fulfill({json:{success:true,data:{id:"00000000-0000-4000-8000-000000000002"}}});});
    await context.route("**/api/management/host/properties?*",r=>r.fulfill({json:{success:true,data:[],meta:{page:1,total:0,totalPages:0}}}));
    await page.goto(app.baseUrl+"/host/properties/create");
    await page.locator('[name="title"]').fill("Phòng kiểm thử giao diện"); await page.locator('textarea[name="description"]').fill("Dữ liệu fixture, không gửi vào cơ sở dữ liệu.");
    await page.getByRole("region",{name:"Bản đồ chọn vị trí phòng"}).locator(".leaflet-pane").first().waitFor({state:"attached"});
    await page.getByRole("status").filter({hasText:"Đang tải bản đồ…"}).waitFor({state:"hidden"});
    const checkStepper=async step=>{
      const stepper=page.getByRole("list",{name:"Các bước đăng tin"});
      const items=stepper.locator(":scope > li");
      assert.equal(await items.count(),3); assert.equal(await stepper.locator('[aria-current="step"]').count(),1);
      assert.equal(await items.nth(step).getAttribute("aria-current"),"step");
      assert.equal(await stepper.getByRole("button").count(),0);
      assert.equal(await stepper.locator('[aria-hidden="true"] svg.lucide-chevron-right').count(),2);
      const boxes=await items.evaluateAll(elements=>elements.map(element=>{const box=element.getBoundingClientRect();return {width:box.width,center:box.x+box.width/2,y:box.y};}));
      assert.ok(boxes.every(box=>Math.abs(box.width-boxes[0].width)<1 && Math.abs(box.y-boxes[0].y)<1));
      assert.ok(Math.abs((boxes[1].center-boxes[0].center)-(boxes[2].center-boxes[1].center))<1);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.evaluate(()=>window.scrollTo(0,0)); await page.waitForTimeout(100);
      await stepper.screenshot({path:`${evidence}/stepper-${step+1}-${width}.png`}); assertions++;
    };
    await checkStepper(0);
    const snapshot=async name=>{await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(300);await page.screenshot({path:`${evidence}/${name}-${width}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));};
    await snapshot("unselected"); assert.equal(await page.locator('[name="latitude"]').inputValue(),"");
    assert.equal(await page.getByRole("combobox",{name:"Phường/xã",exact:true}).isDisabled(),true);
    assert.equal(await page.locator('[aria-hidden="true"] svg.lucide-map-pin').count(),0);
    assert.equal(await page.locator("#listing-quick-address").isDisabled(),true); assertions++;
    const map=page.getByRole("region",{name:"Bản đồ chọn vị trí phòng"});
    const touchCheck=async()=>{
      await map.scrollIntoViewIfNeeded();const box=await map.boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;
      assert.ok(await map.evaluate((element,{x,y})=>element.contains(document.elementFromPoint(x,y)),{x,y}));
      const cdp=await context.newCDPSession(page),touch=(type,points)=>cdp.send("Input.dispatchTouchEvent",{type,touchPoints:points});
      const before=await page.locator('[name="longitude"]').inputValue();
      await touch("touchStart",[{x,y,id:1}]);
      for(let step=1;step<=8;step++){await touch("touchMove",[{x:x+step*5,y,id:1}]);await page.waitForTimeout(20);}
      await touch("touchEnd",[]);await page.waitForFunction(value=>document.querySelector('[name="longitude"]').value!==value,before);
      await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).waitFor();assertions++;
      const zoom=()=>map.locator("img.leaflet-tile").evaluateAll(images=>Math.max(...images.map(img=>Number(new URL(img.src).pathname.split("/")[1]))));
      const beforeZoom=await zoom();
      await touch("touchStart",[{x:x-20,y,id:1},{x:x+20,y,id:2}]);
      for(let step=1;step<=8;step++){await touch("touchMove",[{x:x-20-step*5,y,id:1},{x:x+20+step*5,y,id:2}]);await page.waitForTimeout(20);}
      await touch("touchEnd",[]);await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).waitFor();
      assert.ok(await zoom()>beforeZoom);assertions++;await cdp.detach();
    };
    await map.click({position:{x:100,y:120}});
    assert.equal(await page.locator('[name="latitude"]').inputValue(),"");
    assert.equal(await page.locator('[aria-hidden="true"] svg.lucide-map-pin').count(),0);assertions++;
    const choose=async(label,query,name)=>{
      await page.getByRole("combobox",{name:label,exact:true}).click();
      const input=page.getByRole("combobox",{name:`Tìm ${label.toLowerCase()}`,exact:true});
      await input.fill(query);
      assert.equal(await input.evaluate(element=>getComputedStyle(element).fontSize),"16px");
      await page.getByRole("option",{name,exact:true}).click();
      // Wait for Radix to return focus before filling the next field. Otherwise
      // the harness can blur an input mid-fill and count its old-address lookup.
      await page.waitForFunction(label=>document.activeElement?.getAttribute("aria-label")===label,label);
    };
    await choose("Tỉnh/thành phố","hcm","TP.HCM (kiểm thử)"); await snapshot("province");
    await choose("Phường/xã","kiem thu a","Phường kiểm thử A");
    await page.getByRole("status").filter({hasText:"Đã chuyển tới khu vực"}).waitFor();
    assert.equal(await page.locator('[name="latitude"]').inputValue(),"10.772500");await snapshot("ward");assertions++;
    // Test touch and a subsequent address lookup; a completed pinch must not override it.
    if(width===375)await touchCheck();
    const oldCount=calls.length; await page.locator('[name="addressDetail"]').fill("24 Đường kiểm thử");
    assert.equal(calls.length,oldCount); assertions++;
    await page.getByRole("button",{name:"Tìm trên bản đồ",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Đã tìm thấy địa chỉ"}).waitFor();
    await page.waitForFunction(()=>!document.getElementById("listing-location-confirm").disabled);
    assert.equal(calls.length,oldCount+1); assert.equal(await page.locator('[name="latitude"]').inputValue(),"10.773333");assertions++;
    await snapshot("found");
    await page.getByRole("button",{name:"Tiếp tục",exact:true}).click();await page.getByRole("alert").filter({hasText:"Cần đặt ghim"}).waitFor();
    assert.equal(await page.locator('[data-step="0"]').isVisible(),true);assertions++;
    mode="missing"; await page.locator('[name="addressDetail"]').fill("Địa chỉ kiểm thử không tìm thấy");
    await page.getByRole("button",{name:"Tìm trên bản đồ",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Không tìm thấy chính xác"}).waitFor();
    assert.equal(await page.locator('[name="latitude"]').inputValue(),"10.772500");await snapshot("not-found");assertions++;
    // Clicking/tapping a visible spot recentres the fixed pin without a geocoder.
    const clickBefore=await page.locator('[name="latitude"]').inputValue();const clickCalls=calls.length;
    await map.click({position:{x:100,y:120}});
    await page.waitForFunction(value=>document.querySelector('[name="latitude"]').value!==value,clickBefore);
    await page.waitForFunction(()=>!document.getElementById("listing-location-confirm").disabled);
    assert.equal(calls.length,clickCalls);
    assert.equal(await page.locator('[aria-hidden="true"] svg.lucide-map-pin').count(),1);assertions++;
    const before=await page.locator('[name="latitude"]').inputValue();
    assert.equal(await page.getByRole("button",{name:/Nhích (lên|xuống|trái|phải)/}).count(),0);
    const mapBox=await map.boundingBox();const zoomBox=await page.getByRole("button",{name:"Phóng to bản đồ",exact:true}).boundingBox();
    assert.ok(zoomBox.x>=mapBox.x && zoomBox.y>=mapBox.y && zoomBox.x+zoomBox.width<=mapBox.x+mapBox.width && zoomBox.y+zoomBox.height<=mapBox.y+mapBox.height);assertions++;
    await map.focus();await page.keyboard.press("ArrowUp");
    await page.waitForFunction(value=>document.querySelector('[name="latitude"]').value!==value,before);assertions++;
    await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).click();await page.getByRole("button",{name:"Đã xác nhận vị trí",exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement?.id),"listing-location-confirm"); await snapshot("confirmed");assertions++;
    const saved=await page.locator('[name="latitude"]').inputValue();
    await page.getByRole("button",{name:"Tiếp tục",exact:true}).click();await page.locator('[name="monthlyPrice"]').waitFor({state:"visible"});
    await checkStepper(1);
    await page.getByRole("button",{name:"Quay lại",exact:true}).click();assert.equal(await page.locator('[name="latitude"]').inputValue(),saved);await page.getByRole("button",{name:"Đã xác nhận vị trí",exact:true}).waitFor();assertions++;
    await map.scrollIntoViewIfNeeded();await map.click({position:{x:130,y:160}});
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute("aria-label")),"Bản đồ chọn vị trí phòng");
    const wheelBox=await map.boundingBox();await page.mouse.move(wheelBox.x+130,wheelBox.y+160);const scrollBefore=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,-240);
    await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).waitFor();assert.equal(await page.evaluate(()=>scrollY),scrollBefore);assertions++;
    await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).click();
    const dragBefore=await page.locator('[name="longitude"]').inputValue();
    const box=await map.boundingBox();await page.mouse.move(box.x+box.width/2+50,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+90,box.y+box.height/2,{steps:8});await page.mouse.up();
    await page.waitForFunction(value=>document.querySelector('[name="longitude"]').value!==value,dragBefore);
    await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).waitFor();assertions++;
    await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).click();
    if(width===375){await touchCheck();await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).click();}
    await page.locator('[name="addressDetail"]').fill("Địa chỉ sửa lại"); await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).waitFor();assertions++;
    // A late lookup must not overwrite a newer address/manual selection.
    mode="delayed";await page.getByRole("button",{name:"Tìm trên bản đồ",exact:true}).click();await page.getByRole("status").filter({hasText:"Đang tìm vị trí"}).waitFor();
    await page.locator('[name="addressDetail"]').fill("Địa chỉ mới hơn"); const lateAddressBefore=await page.locator('[name="latitude"]').inputValue();release();await page.waitForTimeout(150);
    assert.equal(await page.locator('[name="latitude"]').inputValue(),lateAddressBefore);assertions++;
    await page.locator('[name="addressDetail"]').fill("Địa chỉ đặt ghim thủ công");
    await page.getByRole("button",{name:"Tìm trên bản đồ",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Đang tìm vị trí"}).waitFor();
    await map.click({position:{x:100,y:120}});
    await page.waitForFunction(value=>document.querySelector('[name="latitude"]').value!==value,lateAddressBefore);
    const lateBefore=await page.locator('[name="latitude"]').inputValue();release();await page.waitForTimeout(150);
    assert.equal(await page.locator('[name="latitude"]').inputValue(),lateBefore);
    await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).click();
    await page.getByRole("button",{name:"Đã xác nhận vị trí",exact:true}).waitFor();assertions++;
    // Real Next blocker, no fabricated provider. It must not clear the manually placed point.
    let blockedLookups=0; page.on("request",request=>{if(mode==="blocker" && new URL(request.url()).pathname==="/api/listing-location") blockedLookups++;});
    mode="blocker";await page.getByRole("button",{name:"Tìm trên bản đồ",exact:true}).click();await page.getByRole("status").filter({hasText:"Chưa kết nối dịch vụ"}).waitFor();assert.equal(await page.locator('[name="latitude"]').inputValue(),lateBefore);assertions++;
    assert.equal(await page.getByRole("button",{name:"Tìm trên bản đồ",exact:true}).isDisabled(),true);
    if(width===375) await map.tap({position:{x:110,y:130}}); else await map.click({position:{x:110,y:130}});
    await page.waitForFunction(value=>document.querySelector('[name="latitude"]').value!==value,lateBefore);
    await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).click();
    await page.getByRole("button",{name:"Đã xác nhận vị trí",exact:true}).waitFor();
    const manualPoint=await page.locator('[name="latitude"]').inputValue();assertions++;
    await page.locator('[name="addressDetail"]').focus();await page.locator('[name="title"]').focus();await page.waitForTimeout(100);
    assert.equal(blockedLookups,1);assertions++;
    await page.evaluate(()=>{Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition(_ok,fail){fail({code:1});}}});});
    await page.getByRole("button",{name:"Dùng vị trí hiện tại",exact:true}).click();await page.getByRole("status").filter({hasText:"đã từ chối quyền"}).waitFor();assertions++;
    for(const [code,text] of [[2,"Không lấy được vị trí"],[3,"Lấy vị trí quá lâu"]]) {
      await page.evaluate(code=>{Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition(_ok,fail){fail({code});}}});},code);
      await page.getByRole("button",{name:"Dùng vị trí hiện tại",exact:true}).click();await page.getByRole("status").filter({hasText:text}).waitFor();assert.equal(await page.locator('[name="latitude"]').inputValue(),manualPoint);assertions++;
    }
    await page.evaluate(()=>{Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition(ok){ok({coords:{latitude:11.5564,longitude:104.9282}});}}});});
    await page.getByRole("button",{name:"Dùng vị trí hiện tại",exact:true}).click();await page.getByRole("status").filter({hasText:"Vị trí hiện tại nằm ngoài"}).waitFor();assert.equal(await page.locator('[name="latitude"]').inputValue(),manualPoint);assertions++;
    await page.evaluate(()=>{Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition(ok){ok({coords:{latitude:10.77251265,longitude:106.65781234}});}}});});
    await page.getByRole("button",{name:"Dùng vị trí hiện tại",exact:true}).click();await page.getByRole("status").filter({hasText:"Đã dùng vị trí hiện tại"}).waitFor();assert.equal(await page.locator('[name="latitude"]').inputValue(),"10.772513");assertions++;
    // Actual form submission uses the same DTO, with hidden coordinates; only transport is mocked.
    await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).click();
    const submittedLatitude=Number(await page.locator('[name="latitude"]').inputValue()); const submittedLongitude=Number(await page.locator('[name="longitude"]').inputValue());
    assert.ok(Math.abs(submittedLatitude-10.772513)<0.000005 && Math.abs(submittedLongitude-106.657812)<0.000005);
    await page.getByRole("button",{name:"Tiếp tục",exact:true}).click();
    for(const [name,value] of Object.entries({monthlyPrice:"3500000",depositAmount:"0",areaSqm:"25",electricityCost:"3500.5",waterCost:"20000",internetCost:"0",garbageCost:"0",parkingFee:"0"})) await page.locator(`[name="${name}"]`).fill(value);
    await page.getByRole("button",{name:"Tiếp tục",exact:true}).click();await checkStepper(2);await page.locator('[name="contactPhone"]').fill("0990000000");await page.getByRole("button",{name:"Gửi tin để duyệt",exact:true}).click();
    await page.waitForURL("**/host/properties");assert.equal(saveCalls,1);assert.equal(saveBody.latitude,submittedLatitude);assert.equal(saveBody.longitude,submittedLongitude);assert.equal(saveBody.provinceCode,"79");assert.equal(saveBody.wardCode,"26740");assert.ok(!("confirmed" in saveBody));assertions++;
    // Editing opens at saved coordinates, not a ward centroid; still requires explicit confirmation.
    const id="00000000-0000-4000-8000-000000000002";
    await context.route(`**/api/management/host/properties/${id}`,r=>r.fulfill({json:{success:true,data:{...saveBody,id,slug:"fixture",version:2,status:"PENDING_REVIEW",isAvailable:true,longTermDetail:saveBody,images:[],amenities:[],revision:null}}}));
    await page.goto(app.baseUrl+`/host/properties/${id}/edit`);await page.locator('[name="latitude"]').waitFor({state:"attached"});
    assert.equal(Number(await page.locator('[name="latitude"]').inputValue()),submittedLatitude);await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).waitFor();assertions++;
    await page.getByRole("status").filter({hasText:"Đang tải bản đồ…"}).waitFor({state:"hidden"});
    assert.equal(calls.at(-1)?.addressDetail,"Địa chỉ đặt ghim thủ công"); // No ward lookup on editor mount; saved point is preserved.
    mode="found";await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).click();await choose("Phường/xã","kiem thu b","Phường kiểm thử B");
    await page.getByRole("status").filter({hasText:"Đã chuyển tới khu vực"}).waitFor();await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).waitFor();assert.equal(await page.locator('[name="latitude"]').inputValue(),"10.772500");assertions++;
    const afterWard=calls.length;await page.locator('[name="addressDetail"]').fill("Tìm khi rời ô");await page.locator('[name="title"]').click();
    await page.getByRole("status").filter({hasText:"Đã tìm thấy địa chỉ"}).waitFor();assert.equal(calls.length,afterWard+1,JSON.stringify(calls.slice(afterWard).map(body=>body.addressDetail)));assertions++;
    await context.route("https://tile.openstreetmap.org/**",r=>r.abort());await page.getByRole("button",{name:"Phóng to bản đồ",exact:true}).click();
    await page.getByRole("alert").filter({hasText:"Không tải được nền bản đồ"}).waitFor();assert.equal(await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).isDisabled(),true);assertions++;
    await context.route("https://tile.openstreetmap.org/**",r=>r.fulfill({contentType:"image/svg+xml",body:tile}));await page.getByRole("button",{name:"Tải lại nền bản đồ",exact:true}).click();
    await page.getByRole("alert").filter({hasText:"Không tải được nền bản đồ"}).waitFor({state:"hidden"});assertions++;
    await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).click();
    await choose("Tỉnh/thành phố","ha noi","Hà Nội (kiểm thử)");
    assert.equal(await page.locator('[name="wardCode"]').inputValue(),"");
    assert.equal(await page.locator('[name="latitude"]').inputValue(),"");
    assert.equal(await page.getByRole("button",{name:"Xác nhận vị trí",exact:true}).isDisabled(),true);assertions++;
    await context.close();
  }
  console.log(`PASS ${assertions} browser assertion groups; 18 screenshots at 375/1440. Auth/catalog/geocoder/geolocation/tiles/save are fixtures; actual Next blocker checked. Quick suggestions and real geographic accuracy BLOCKED. No application DB writes.`);
} finally {await browser?.close();await app.close();}
