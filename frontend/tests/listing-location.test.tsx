import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("leaflet/dist/leaflet.css", () => ({})); // CSS is verified in the browser harness, not the node renderer.
import { renderToStaticMarkup } from "react-dom/server";
import { isVietnamLocation, locationCanContinue, lookupListingLocation, roundedLocation } from "../src/lib/listing-location";
import { ListingLocationPicker } from "../src/features/host-listings/location-picker";
import boundary from "../src/lib/vietnam-boundary.json";

afterEach(() => vi.unstubAllGlobals());
describe("listing location frontend-only guard", () => {
  it.each([[10.7725,106.6578],[21.0285,105.8542],[16.0544,108.2022],[10.2896,103.984],[8.7063,106.617]])("accepts Vietnamese city/island interior %s,%s", (latitude,longitude) => expect(isVietnamLocation({ latitude,longitude })).toBe(true));
  it.each([[0,106.7],[11.5564,104.9282],[17.9757,102.6331],[14.9,103.4],[11,108.5],[NaN,106.7],[10.7,Infinity],[90,180]])("rejects invalid/foreign/offshore %s,%s", (latitude,longitude) => expect(isVietnamLocation({ latitude,longitude })).toBe(false));
  it("rejects missing coordinates, includes boundary vertices and rounds six places", () => {
    expect(isVietnamLocation(null)).toBe(false);
    const [longitude,latitude] = boundary.coordinates[0][0][0]; expect(isVietnamLocation({ latitude,longitude })).toBe(true);
    expect(roundedLocation(10.77251265,106.65781234)).toEqual({ latitude:10.772513,longitude:106.657812 });
  });
  it("requires confirmation, valid point, and completed movement", () => {
    const point={latitude:10.7725,longitude:106.6578};
    expect(locationCanContinue({point,confirmed:true,moving:false})).toBe(true);
    for(const value of [{point,confirmed:false,moving:false},{point,confirmed:true,moving:true},{point:null,confirmed:true,moving:false}]) expect(locationCanContinue(value)).toBe(false);
  });
  it("renders inline map, hidden coordinates, accessible alternatives, and no regular coordinate inputs", () => {
    const html=renderToStaticMarkup(<ListingLocationPicker provinceCode="" wardCode="" provinceName="" wardName="" initialAddress="" selection={{point:null,confirmed:false,moving:false}} onChange={()=>{}} active disabled={false} />);
    expect(html).toContain('aria-label="Bản đồ chọn vị trí phòng"'); expect(html).toContain('tabindex="0"');
    expect(html).toContain('type="hidden" name="latitude"'); expect(html).toContain('name="longitude"');
    for(const text of ["phím mũi tên","Phóng to bản đồ","Thu nhỏ bản đồ","Xác nhận vị trí","Kéo bản đồ để ghim đúng vị trí phòng"]) expect(html).toContain(text);
    expect(html).toContain("Nhấp hoặc chạm vào vị trí phòng để đặt ghim");
    for(const text of ["Nhích lên","Nhích xuống","Nhích trái","Nhích phải","Điều khiển bản đồ"]) expect(html).not.toContain(text);
    expect(html).not.toContain('type="number"'); expect(html).not.toContain('role="dialog"');
  });
  it("only searches through same-origin POST without credentials/key or external provider", async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{point:{latitude:10.7725,longitude:106.6578}}}))); vi.stubGlobal("fetch",fetchMock);
    const signal=new AbortController().signal;
    const address={provinceCode:"79",wardCode:"26740",provinceName:"TP.HCM",wardName:"Phường thử",addressDetail:"Đường thử"};
    expect(await lookupListingLocation(address,signal)).toEqual({point:{latitude:10.7725,longitude:106.6578}});
    expect(fetchMock).toHaveBeenCalledWith("/api/listing-location",expect.objectContaining({method:"POST",body:JSON.stringify(address),signal,cache:"no-store"}));
  });
  it.each([[503, "GEOCODING_NOT_CONFIGURED", "Chưa kết nối dịch vụ"], [429, "LOCATION_RATE_LIMITED", "Tìm địa chỉ quá nhiều lần"], [500, "UPSTREAM_FAILED", "Không thể tìm địa chỉ"]])("preserves cause for status %s without treating all errors as unconfigured", async (status, errorCode, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, errorCode }), { status: Number(status) })));
    await expect(lookupListingLocation({provinceCode:"79",wardCode:"26740",provinceName:"TP.HCM",wardName:"Phường thử",addressDetail:"Đường thử"}, new AbortController().signal)).rejects.toMatchObject({ cause: errorCode, message: expect.stringContaining(String(message)) });
  });
  it.each([{success:true,data:{point:null}},{success:true,data:{point:{latitude:11.55,longitude:104.92}}},{success:true,data:{}},{success:false}])("checks lookup response shape and country %j",async body=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    const promise=lookupListingLocation({provinceCode:"79",wardCode:"26740",provinceName:"TP.HCM",wardName:"Phường thử",addressDetail:"Đường thử"},new AbortController().signal);
    if(body.data && "point" in body.data && body.data.point===null) expect(await promise).toEqual({point:null}); else await expect(promise).rejects.toThrow();
  });
});
