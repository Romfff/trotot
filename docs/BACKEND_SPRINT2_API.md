# Backend Sprint 2 — contract đang triển khai

Base `/api/v1`. Chưa phải bản bàn giao hoàn chỉnh. Nguồn nghiệp vụ: 01 §3.1/§4.1/§5, dữ liệu 02, Sprint 2 trong 03/04 và API/lifecycle 06. Bổ sung theo xác nhận của chủ dự án ngày 03/10/2026: địa chỉ hiện hành; duyệt tối thiểu; pending revision; quota FREE; soft delete.

**Contract liên hệ cập nhật 05/10/2026:** search/detail công khai không còn `contactPhone`/`contactZalo`. Client phải lấy qua `GET /properties/:slug/contact` khi người dùng bấm xem số; xem mục liên hệ cuối file. Các đoạn giới hạn cũ phía dưới là lịch sử, không thay trạng thái hiện tại trong progress.

**Cập nhật 05/10/2026:** endpoint lịch/thông báo và cost-estimate đã được chốt, triển khai và kiểm thử local ở mục cuối file. Các đoạn P03 cũ ghi “chưa có API/importmain/chưa nhập catalog” là lịch sử 04/10; API catalog đã dùng được và DB local đã có snapshot nso-2026-10-04. Dataset bàn giao/máy sạch, POI và upload server ảnh vẫn chưa được nghiệm thu.

## Endpoint hiện có trong source

| Method/path | Quyền | Request / kết quả |
| --- | --- | --- |
| GET `/properties/long-term/search` | Public | Query trong 06; trả mảng public và `meta` ngoài `data` |
| GET `/properties/:slug` | Public | Chỉ LONG_TERM, PUBLISHED, chưa xóa; còn lại 404 |
| GET `/properties/:slug/contact` | Public, Bearer hợp lệ tùy chọn | Chỉ tin công khai; trả `{contactPhone,contactZalo}`, no-store, giới hạn IP/tài khoản |
| GET `/amenities` | Public | Danh mục `{id,name}`; cache 24 giờ |
| POST `/auth/become-host` | TENANT/HOST đã xác thực | `{}`; tự chuyển chính mình thành HOST, nhắc lại không nhân bản profile; không cấp ADMIN/KYC |
| POST `/properties/long-term` | HOST | Payload 06; server gán hostId, LONG_TERM/FREE/PENDING_REVIEW; 201 |
| GET `/host/properties` | HOST | Chỉ tin của phiên hiện tại; page/limit |
| GET `/host/properties/:id` | HOST | Bản gốc + chi tiết + images/amenities + revision của tin mình; 404 nếu sai chủ |
| PUT `/host/properties/:id` | HOST | Payload đầy đủ như POST + `expectedVersion`; không phải partial PATCH |
| POST `/host/properties/:id/hide` | HOST | `{expectedVersion}`; ẩn tin đã duyệt ngay |
| POST `/host/properties/:id/show` | HOST | `{expectedVersion}`; mở lại tin đã duyệt ngay |
| POST `/host/properties/:id/availability` | HOST | `{expectedVersion,isAvailable}`; báo còn/hết phòng ngay |
| DELETE `/host/properties/:id` | HOST | `{expectedVersion}`; xóa mềm khi không có lịch sắp tới PENDING/ACCEPTED |
| GET `/admin/properties` | ADMIN | Hàng chờ tin mới/bản sửa, page/limit, bỏ tin đã xóa |
| GET `/admin/properties/:id` | ADMIN | Đọc nội dung/bản sửa và version trước khi duyệt |
| POST `/admin/properties/:id/approve` | ADMIN | `{expectedVersion}`; duyệt tin hoặc pending revision; 200 |
| POST `/admin/properties/:id/reject` | ADMIN | `{expectedVersion}`; từ chối tin hoặc revision; 200 |

POST search/create đã có trong 06; các URL Host/Admin còn lại là mapping triển khai bổ sung, không phải endpoint được viết sẵn trong 06. GET danh mục và chi tiết dựa trên 04 §4, chuẩn hóa về cùng base version. Frontend hiện nối trở thành Host và CMS dài hạn theo cập nhật ngày 04/10/2026 ở cuối tài liệu.

## Envelope và kiểu dữ liệu

Thành công `{success:true,message,data}`; phân trang có thêm `meta:{page,limit,total,totalPages}` bên ngoài `data`. Lỗi `{success:false,errorCode,message,errors?}`. Page mặc định 1, limit 20, limit tối đa 100; danh sách rỗng có total/totalPages = 0.

Public record gồm id/slug/title/description/videoUrl/propertyType/addressDetail/codes, latitude/longitude, isVerified/isAvailable/createdAt, ward `{name,province:{name}}`, host `{fullName,avatarUrl}`, images `{url,position,sortOrder}[]`, amenities `{id,name}[]`, distanceMeters (null khi không có tâm); trường chi tiết dài hạn được trải phẳng, bao gồm garbageCost. Các giá Decimal được serialize number ở public search/detail. Không lộ hostId, revision, password, token, ngân hàng hay số dư.

Record riêng Host/Admin giữ cấu trúc Prisma: `longTermDetail`, `images`, `amenities` mapping, `revision`, `version`, `status`. Decimal trong record riêng serialize thành chuỗi; đây không phải cùng DTO với public record. JSON revision chỉ chứa nội dung, không chứa quyền/trạng thái do client tự gán.

Các bổ sung D06 đã chốt: garbageCost bắt buộc >=0, đ/phòng/tháng; videoUrl nullable, URL http(s), không fetch/upload; các propertyType PHONG_TRO/CHUNG_CU_MINI/NHA_NGUYEN_CAN/O_GHEP. imageUrls vẫn là mảng URL có thứ tự trong 06; response ảnh thêm sortOrder = position, giữ position để tương thích. Danh mục tiện ích seed từ tên trong 01 và các ID mẫu của 06; allowPets vẫn là field riêng, không tạo hai nguồn dữ liệu pets mâu thuẫn.

Frontend Auth BFF đã nối become-host: bắt buộc Origin tin cậy + Bearer, không nhận refresh từ body và không đổi cookie. Axios cập nhật user/role trong memory + broadcast; chặn kết quả muộn sau logout/đổi phiên; cache xóa khi role đổi. Nút tự chuyển Host ở /account đã được kiểm tra với backend/DB test thật ngày 04/10/2026.

Sửa review 03/10/2026: client phân biệt phiên bằng ID ngẫu nhiên nội bộ. Login tạo ID mới kể cả cùng user/token; refresh và đồng bộ tab giữ ID. Request cũ không retry sang phiên mới, không ghi đè phiên mới bằng response muộn. LocalStorage chỉ có metadata ID, không chứa access/refresh token. Payload/cookie/API backend không đổi bởi cách đánh dấu phiên này.

`expectedVersion` là số nguyên lấy từ lần đọc gần nhất. Stale trả 409 `STALE_LISTING_VERSION`; client phải tải lại nội dung, không tự retry duyệt với version mới khi Admin chưa xem bản mới.

## Giới hạn request chống spam

Theo 03 §3 DoD và yêu cầu sửa review ngày 03/10/2026: các endpoint listing trong bảng trên và `POST /auth/become-host` dùng chung giới hạn **240 request/IP/60 giây**. Các endpoint Host/Admin và become-host có thêm **120 lượt đọc/user/60 giây**, **30 lượt ghi/user/60 giây**. Toàn bộ POST/PUT/DELETE dùng chung một bucket ghi cho tài khoản; đổi tin, action hoặc access token không đặt lại bucket. Đây là giới hạn kỹ thuật chống spam, độc lập với quota 2 tin FREE và việc chốt nghiệp vụ Lead/click ở D12.

Redis INCR + TTL chạy trong Lua nguyên tử. Cửa sổ 60 giây bắt đầu khi có request đầu tiên; vượt giới hạn trả 429 envelope `RATE_LIMITED`, chưa gọi service hoặc thay dữ liệu tin. Redis không thể thực thi giới hạn thì trả 503 `RATE_LIMIT_UNAVAILABLE`. IP trực tiếp lấy từ kết nối; chỉ dùng IP chuyển tiếp khi chữ ký BFF hợp lệ, bỏ qua `X-Forwarded-For` không được xác thực. BFF local không có edge IP dùng bucket kết nối chung; khi bàn giao phải cấu hình edge ký IP đúng nếu muốn phân biệt khách truy cập. Các con số trên là cấu hình kỹ thuật hiện tại trong `src/common/sprint2-rate-limit.guard.ts`, không phải số được ghi sẵn trong sáu plan.

## Ba quy tắc đã được chốt

- PUT vào PUBLISHED/HIDDEN lưu pending revision; bản đã duyệt giữ nguyên công khai. Approve thay nội dung trong transaction nhưng giữ lựa chọn ẩn/hiện và trạng thái còn phòng của Host. Reject revision giữ bản đã duyệt. Slug không đổi khi đổi tiêu đề.
- Chỉ gói FREE của LONG_TERM giới hạn 2 tin chưa xóa ở PENDING_REVIEW/PUBLISHED/HIDDEN. Nháp, từ chối, hết hạn, xóa mềm, PAID và homestay không tính. Quota kiểm tra cùng transaction và khóa hàng Host; client không tự gán listingPlan/VIP. Chưa có API/billing cấp gói PAID.
- Lịch sắp tới dùng ngày+giờ theo `Asia/Ho_Chi_Minh` và đồng hồ DB. Có lịch PENDING/ACCEPTED sắp tới thì DELETE trả 409 `UPCOMING_APPOINTMENTS`; Host dùng hide. Soft delete giữ bảng property và lịch hẹn, public/owner/queue không trả bản đã xóa. API tạo/đổi lịch sau này phải khóa cùng property trước khi ghi để không chen vào phép kiểm tra xóa.

## Giới hạn chưa được hoàn tất

- Danh mục tỉnh/xã chính thức chưa nhập. Khi catalog rỗng, POST/PUT trả 503 `ADDRESS_CATALOG_NOT_READY`. Code kiểm tra ward thuộc province; không seed fixture vào DB chính. `districtCode` giữ nullable, địa chỉ hiện hành không nhận mã huyện giả.
- Form Host/frontend, upload thật và đơn vị/công thức ước tính chi phí còn chưa hoàn tất; backend đã bổ sung mapping D06 được chốt, không có nghĩa form đầy đủ đã nghiệm thu.
- Server ảnh riêng chưa có: imageUrls không rỗng trả 503 `MEDIA_SERVER_NOT_CONFIGURED`. DTO vẫn kiểm tra tối đa 15 ảnh, nhưng không được diễn giải đây là upload thật đã hoàn tất.
- Nhiều tiện ích dùng AND theo xác nhận trực tiếp; de-duplicate ID, mỗi ID phải tồn tại trên tin. Các filter giá/diện tích/tỉnh/huyện cũ và bán kính mét đã được test độc lập/kết hợp.
- API lịch hẹn/notification, catalog ward/POI chính thức và ước tính đủ chi phí vẫn chưa hoàn tất; xem progress để phân biệt phần frontend đã kiểm chứng và phần còn mở.
- Không lấy một bài đo local nhỏ làm chứng nhận hiệu năng production; ghi riêng dataset/concurrency/percentile và các ca chưa chạy.

## Kiểm tra và migration

`npm run build`, `npm run lint`, `npm test`, `npm run test:listings:integration`. Integration chỉ nhận PostgreSQL/Redis loopback; tạo DB ngẫu nhiên `trotot_listing_test_<uuid>` và Redis prefix riêng, sau đó dọn đúng namespace. User/token/catalog/media trong test là fixture; PostgreSQL/PostGIS/Redis và HTTP/guards/transaction là thật.

Migration mới `20261003000000_sprint2_listings` chạy nguyên khối transaction; không sửa migration hoặc dữ liệu Auth Sprint 1. Đã kiểm tra DB trống, deploy lặp lại và nâng schema Sprint 1 có user bằng test. Khi chủ dự án giao bật web ngày 03/10/2026, đã sao lưu rồi áp migration vào DB local và bật API 5000 + frontend 3000. Health/Swagger/search/BFF đã kiểm tra HTTP thật; chưa triển khai public. Các phần catalog/UI/upload chưa hoàn tất ở trên vẫn chưa nghiệm thu.

## Cập nhật moderation và frontend — 04/10/2026

Các caller frontend hiện có: nút tự chuyển Host ở `/account` và CMS Admin tại `/admin/properties`. CMS dùng BFF riêng `/api/management` chỉ allowlist GET hàng chờ/chi tiết và POST approve/reject của API đã có. Bearer lấy từ memory; BFF không chuyển refresh cookie upstream, POST kiểm tra Origin và chỉ nhận `expectedVersion`. Quyền ADMIN và tài khoản ACTIVE do backend xác minh. Không có contract homestay/finance/users mới.

Migration cộng thêm `20261004000000_listing_moderation_audit` tạo lịch sử duyệt nội bộ. Actor lấy từ phiên server; action, listing/revision, version trước/sau, status và thời điểm được ghi cùng transaction với thay đổi nội dung. Audit thất bại thì review rollback. Soft delete giữ lịch sử. Request `{expectedVersion}` và response `{id,status,version}` không đổi; public/detail riêng không trả bảng audit. Chưa thêm endpoint đọc/xóa audit.

Backend source đã được build/lint, integration thật 26 ca gồm CMS Edge hai tab và DB audit. Migration mới đã kiểm tra fresh/upgrade/backup-restore trên DB test riêng; chưa áp vào DB ứng dụng đang chạy ở 5000. Khi bật source mới cần `npm run db:deploy`, `npm run db:generate`, build và khởi động runtime đồng bộ. Không sửa migration đã áp dụng. Xem [runbook backup/restore](DATABASE_BACKUP_RUNBOOK.md).

Tại `backend/`, runner tùy chọn `npm run test:admin:browser:integration -- <frontend-dir-đã-build> <playwright-package-path>` kiểm tra UI/BFF/Nest/DB/Redis thật; `npm run test:auth:browser:integration -- <frontend-dir-đã-build> <playwright-package-path>` kiểm tra chuyển Host và Auth hai tab. Đặt `PLAYWRIGHT_BROWSER_CHANNEL=msedge` khi dùng Edge đã cài. Runner dùng DB UUID/Redis namespace riêng và tự dọn; không restart hạ tầng trong khi suite đang chạy. OTP mock, user/catalog/listing là fixture; chưa phải sandbox provider hay thiết bị vật lý.

## P03 kiểm catalog địa chỉ (local, 04/10/2026)

`backend/scripts/check-address-catalog.mjs` chỉ validate file đã review và các XLS nguồn kèm SHA256. Mã tỉnh2chữ số/mã xã5chữ số luôn là string. API catalog nhóm E còn PROPOSED; không có endpoint địa chỉ mới để FE gọi lúc này.

Chạy từ backend trên clean copy đã npmci:

```powershell
npm run test:catalog
npm run catalog:check -- E:/DuAn/trotot/.tmp/s345/address-catalog-nso-2026-10-04.json b59a28ef00e9b4566f19407ec63f1913cc4c277d0e97a7b76d81fbe0e3352d81
npm run test:catalog:integration -- E:/DuAn/trotot/.tmp/s345/address-catalog-nso-2026-10-04.json b59a28ef00e9b4566f19407ec63f1913cc4c277d0e97a7b76d81fbe0e3352d81
```

Integration chỉ nhận root.env `NODE_ENV=test`, loopback và database `trotot_clean_test_<UUID>` của clean infrastructure, tự tạo/xóa database `trotot_catalog_test_<UUID>`. Không chạy với env chính. Không dùng `seed:dev` để nhập catalog thật; script hiện không có lệnh importmain. Real DB dry-run đã kiểm4migrations/3355records/idempotence/FK/SQLfailure/rollback. Nội dung/version/nguồn phải được kiểm lại khi đổi ngày; bảng2025 không đại diện dữ liệu hiện hành04/10/2026.

Raw/normalized exports hiện ở .tmp/s345 cùng checksum, chưa đóng gói dataset vào source bàn giao. DB provenance/import vận hành/API catalog vẫn là acceptance còn thiếu; không coi dry-run là nhập DB chính thành công.



## SEO chi tiết trọ (local verified 04/10/2026)

Public detail `/thue-phong-tro/[slug]` renders approved backend content and metadata on server. Layout checks visibility before loading can sendHTTP200; hidden/pending/deleted return404, noindex. Page/layout/metadata share one request-scoped detail fetch. Pendingrevision does not replace approved SEO. Errors503 stay server error (not false404), retry reloads current URL. Account has noindex/nofollow; auth enforcement remains server responsibility.

`FRONTEND_ORIGIN` must be the actual frontend origin to emit canonical/OG URL; local test uses its generated loopback origin. No deployment domain is assumed. Media fields only when API provides valid HTTP(S) URL; no invented JSON-LD ratings/prices.

From the clean backend after building its sibling frontend:

```powershell
$env:PLAYWRIGHT_BROWSER_CHANNEL='msedge'
npm run test:seo:browser:integration -- ../frontend C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright
```

Runner creates DB UUID/Redis namespace from local test env, starts loopback backend/pass-through instrumentation/built frontend, runs Edge with JS off and JS on for error retry, then cleans owned resources. Pass-through uses real API/DB;503response injection is explicitly a fixture. Last SEO fullresult28PASS2SKIP09:52:32 (CMS/Lighthouse separate); FE151unitPASS andbuild/lint/typePASS. SearchSSR/hydration, sitemap/robots/noindex verified local; long-term JSON-LD mapped/verified; homestay/action/price schema, canonicalquery/Lighthouse/physicaldevice still pending; this is not all S5-07 acceptance or production readiness.


Search now server-renders the exact initial URL query; shared parser hydrates without duplicate request and native history retains rapid filters. Sitemap index `/sitemap.xml` links `/sitemaps/0.xml` (home/search) and current public pages1..N (100items each) via existing searchAPI; each read uses current publication, no-store. Missing FRONTEND_ORIGIN/upstream failure returns503, not a false successful empty sitemap. Invalid/out-of-range child page404. Robots and noindex exclude Auth/Admin/Account and current demo routes; these do not replace server auth. Protocol ceiling49999listingpages (nested index required above this), current offset pagination can shift under simultaneous publish/hide so it is no immutable cross-page snapshot. No public media/license/provider acceptance inferred.

Frontend fixture browser commands now accept a built frontend directory as first argument. Prefer `npm run test:browser:listings -- . <playwright-package-path>` and `npm run test:browser:catalog-homestay -- . <playwright-package-path>` after build. Runner starts its own loopback Next + explicit Node upstream fixture for SSR, plus browser API/tile fixtures; cleans its own processes. External origin legacy mode cannot intercept server reads and requires its own upstream. Fixtures are not DB/provider acceptance. Latest listings/P01/P02 passed; new8screens375–2560 reviewed.


Public real long-term detail now emits JSON-LD property + BreadcrumbList from its reviewed API snapshot. Types follow current propertyType (Room/Apartment/House/Accommodation), address uses actual ward/province, area uses MTK, images only valid supplied HTTP(S). Inline script escapes every< as literal\u003c; malicious closing-script host text remains JSON data, verified in real JSoff browser. No invented Offer/Review/rating/RentAction or homestay business schema, no guarantee of Google rich-result eligibility. Missing canonical origin omits the script. Pendingrevision preserves approved data; hide removes schema with404.


SSR search cache now belongs to a unique server-render ID; new SSR data cannot be overridden by a previous query cache. Real browser detail→Hosthide→search tested; native Back/Forward still reuse fresh data within the same render. Map uses one native keyboard button per pin, labeled with roomtitle+price; Enter/popup/hover/tile regression verified. Current active-render cached results have no realtime invalidation push; do not claim allclients instantly update without a newread.

Lighthouse runner: `npm run test:lighthouse:integration -- ../frontend <playwright-package-path> <separate-lighthouse-package-dir>` after building siblingfrontend; optional LIGHTHOUSE_EVIDENCE_DIR selects reportfolder. Audit tool13.5.0 lives separately in .tmp, not appdependency. Runner creates own UUIDDB/Redis,20syntheticpublishedrooms, loopbackNext/Edge/debugport; audits mobile/desktop search/detail via native Nodechild and checks Performance/SEO/BestPractices>90, then cleans ownedresources. Externaltiles/media blocked; noimages, simulateddevices, localAPI; provider/production/physicaldevice acceptance not implied. Latestfourresults passedlocalthreshold; fullreports in .tmp/s345/lighthouse-after-cache-map. InitialVitestworkercrashunconfirmed and cleanup proved; auditimport moved outsideworker without suppressing findings. CLS/console and allother failingaudits retained; realmedia test stillpending.


Public SSR detail/search/sitemap now reuse the existing signed BFF GET protocol when TRUSTED_CLIENT_IP_HEADER is configured. Configure only a single IP header overwritten by the actual trusted edge; keep it empty in local direct Next. Server reads take no browser bearer/cookie/proxy signatures; missing/malformed trustedIP or missing signer failsclosed without a raw fallback. SignedAxiosreads do not followredirects. Backend HMAC validation/rate limits unchanged. Realintegration confirms separate TEST-NET IPv4/IPv6 buckets and forgedheadersignored across detail/search/sitemap; invalidedge sends noupstreamread. Actualproxydeployment/trustchain still needs G10 and separate deployment approval; do not simply enable trust on arbitrary forwardingheaders. Sourcebuild isverifiedlocally; main3000/5000 remain previousbuild.

## Sprint 2 approved contract update — 05/10/2026

Base `/api/v1`; BFF browser public `/api/listings`, private `/api/management`. OpenAPI `/api/docs-json`, UI `/api/docs`. Envelope 06 unchanged; pagination `meta` outside `data`. Later owner confirmations are recorded in `SPRINT2_DECISIONS_LOCAL.md`, not in 06.

| Method/path | Actor | Body/query |
| --- | --- | --- |
| GET `/catalog/provinces` | Public | `{version,asOf,sourceUrl,items}` |
| GET `/catalog/wards` | Public | `provinceCode`, leading-zero code is string |
| POST `/appointments` | Active TENANT | CreateAppointmentDto and required Idempotency-Key |
| GET `/appointments`, `/appointments/:id` | Active TENANT | Own rows; list page=1/limit=20, optional status |
| POST `/appointments/:id/cancel` | Active TENANT | expectedStatus, optional reason; before appointment |
| GET `/host/appointments`, `/host/appointments/:id` | Active HOST | Owned property rows; list same pagination/status |
| POST `/host/appointments/:id/accept`, `/reject` | Active owning HOST | PENDING, expectedStatus, optional reason for reject |
| POST `/host/appointments/:id/complete` | Active owning HOST | ACCEPTED, expectedStatus, after appointment |
| POST `/host/appointments/:id/cancel` | Active owning HOST | ACCEPTED, expectedStatus, required reason |
| GET `/notifications` | Active TENANT/HOST | Only recipient, page/limit, meta.unreadCount |
| POST `/notifications/:id/read` | Active recipient | Empty body; idempotent mark-read |
| GET `/properties/:slug/cost-estimate` | Public | Optional electricityKwh, waterM3, occupants, vehicles |

`:id` UUID; owned record missing/foreign 404, wrong role 403. Reason trimmed/max500; stale expectedStatus 409 STALE_APPOINTMENT_STATUS, `data.currentStatus` contains only the current enum. Date/time response YYYY-MM-DD/HH:mm:ss, Asia/Ho_Chi_Minh, not shifted to UTC. Base row contains id/propertyId/title/scheduledDate/scheduledTime/status/reason/notes/createdAt/updatedAt/cancelledBy. Only Host response adds tenantName/tenantPhone/simultaneousAppointments. Host collision count warns about other active same-time appointments, not reserved inventory.

POST idempotency accepts 1–128 visible ASCII characters, scoped user/operation/raw JSON hash. Same successful request returns saved data snapshot for 7 days; original success envelope is reapplied. Same key/different raw body 409 IDEMPOTENCY_KEY_REUSED; concurrent same key 409 IDEMPOTENCY_IN_PROGRESS. No business failures are saved. One PENDING/ACCEPTED per Tenant/property (partial unique + DB locks); Tenant PENDING limit5/property20 by config. Notifications are atomic with every action and system expiry, contain no phone, have no SMS/Socket promise. Background worker reconciles PENDING overdue at startup and each15s; ACCEPTED no-show is not automatically completed.

Estimate only LONG_TERM/PUBLISHED/notdeleted, else404. Empty query inputs should be **omitted**, explicit0 retained; irrelevant water input ignored. Decimal prices from DB, each line half-up to integer VND, sum rounded lines; deposit separate. `unitPrice` string|null; quantity number|null; amount integer|null; statuses FIXED/COMPUTED/NEEDS_INPUT/NOT_DECLARED/FREE. `data` contains lines/totalMonthly/deposit/missingInputs/missingCosts/isComplete/disclaimer. parkingFee VND/vehicle/month; no vehicles NEEDS_INPUT. Null is NOT_DECLARED, not zero. Query invalid 400 errors[], rate429 with Retry-After. No usage/lead persistence, no result cache, no client-side fallback calculator. Missing usage is not silently supplied.

## Xem số liên hệ — 05/10/2026

Chủ dự án duyệt thay đổi contract trực tiếp: `GET /api/v1/properties/:slug/contact`; browser qua `GET /api/listings/properties/:slug/contact`. Envelope 06, `data:{contactPhone:string,contactZalo:string|null}`. Chỉ LONG_TERM/PUBLISHED/chưa xóa; còn lại404. Header `Cache-Control:no-store`. Search/detail/SSR/JSON-LD không còn số liên hệ; detail dùng namespace cache mới để không đọc số đã cache trong bản cũ. Record quản lý của Host/Admin không đổi.

Bearer là tùy chọn, nhưng nếu có thì phải hợp lệ; token giả/hết hạn/thu hồi trả401, không chuyển thành Guest. BFF chỉ chuyển Bearer cho contact route, không chuyển cookie hay Bearer vào public search/detail. FE dùng access token trong memory qua client refresh hiện có; không sửa Auth core.

Giới hạn bổ sung mặc định10lượt/phút/IP,5lượt/phút/tài khoản, dùng chung mọi tin: `LISTING_CONTACT_IP_LIMIT_PER_MINUTE`, `LISTING_CONTACT_USER_LIMIT_PER_MINUTE` phải là số nguyên dương. Redis Lua INCR+TTL60giây, key HMAC không chứa IP/UUID thô, không ghi lead/click history vào DB. Vượt trả429 `RATE_LIMITED` và `Retry-After:60` (mốc chờ bảo thủ); Redis lỗi trả503 `RATE_LIMIT_UNAVAILABLE`, không trả số. Giới hạn listing chung vẫn áp dụng. Cấu hình trusted edge/signed BFF như mục trên; local không có edge chia sẻ bucket IP kết nối, không tin X-Forwarded-For do khách tự gửi.

FE chỉ gọi khi bấm, không prefetch/poll, không lưu số vào query/localStorage; khi đổi phiên/slug thì xóa memory và hủy request cũ. API này hạn chế spam lấy số, không ngăn người đã xem lưu lại số. Không có migration mới cho liên hệ; giữ dữ liệu và lịch hẹn.

Example optional limits in root `.env.example`: APPOINTMENT_MIN_LEAD_MINUTES=120, MAX_DAYS=30, STEP_MINUTES=30, OPEN_TIME=07:00:00, CLOSE_TIME=21:00:00, TENANT_PENDING_LIMIT=5, PROPERTY_PENDING_LIMIT=20 (each key with APPOINTMENT_ prefix). ESTIMATE_MAX_ELECTRICITY_KWH=10000, WATER_M3=1000, OCCUPANTS=20, VEHICLES=10 (each with ESTIMATE_MAX_ prefix). Decimal input allows one fractional digit for kWh/m³; people/vehicles integers. Defaults work in local env without copying secrets to source.

Catalog snapshot nso-2026-10-04 has34provinces/3321wards, official source and JSON/XLS SHA256 checked. `scripts/initialize-local-address-catalog.mjs <json> <reviewed-sha256> --apply-empty-local` accepts only named loopback development `trotot`, all catalog tables empty, uses SERIALIZABLE/table locks and rejects replacing an existing catalog. It is not a general production importer. Do not use test fixtures or seed:dev as official catalog. Current files under .tmp are not yet a portable dataset package; provenance and POI acceptance still required on another machine.

Runtime source now matches builds at localhost3000/5000;13migrations applied local, latest cost/appointment schemas verified against OpenAPI. Full listing DB/browser run 05/10 12:52:55:157PASS5SKIP. See local progress for commands, failure injections, cleanup and limitations; not production/provider approval.

Latest owner D12 confirmation keeps **all listing fees mandatory**, no DB/DTO changes.0 is a deliberately declared free/included fee, blank is invalid. Host UI offers an explicit0 button on electricity/water/internet/garbage/parking; FREE display is “Miễn phí / đã gồm trong giá thuê” with0VND. NOT_DECLARED remains defensive calculator/render support for missing/null legacy data, not a nullable submission path. Existing optional usage rules stay unchanged (blank required usage yields NEEDS_INPUT, not an invented quantity). See decision log05/10 for confirmation and progress for latest UI checks.
