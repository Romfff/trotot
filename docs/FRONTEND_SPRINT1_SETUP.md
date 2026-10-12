# Frontend Sprint 1 — Chạy local

## Bổ sung Sprint 2 — 05/10/2026

Các route thật mới: Host `/host/properties` (list), `/host/properties/create`, `/host/properties/:id/edit`; Tenant `/my-appointments`; Host `/host/appointments`; cả hai `/notifications`. Menu tài khoản có link theo vai trò. API private qua `/api/management`, bearer memory/refresh cookie HttpOnly theo client Auth hiện có; public catalog/detail/ước tính qua `/api/listings`. Không đặt secret trong biến NEXT_PUBLIC.

Backend cần đủ migration mới và đang chạy; catalog lấy `/catalog/provinces`/`/catalog/wards?provinceCode=...`, snapshot hiện hành đã review theo decision log. Chưa có catalog thì form hiển thị lỗi, không dùng fixture giả làm địa chỉ. Snapshot hiện ở file local, chưa đóng gói dataset bàn giao; không coi `npm ci/build` là đã nghiệm thu đầy đủ trên máy khác.

Tin mới phải Admin duyệt trước khi public. Khi sửa tin đã duyệt, bản public giữ nguyên đến khi revision được duyệt; action ẩn/hiện/hết phòng tức thời, UI gửi expectedVersion và yêu cầu reload nếu409. Upload server riêng hoãn: form không giả upload thành công và giữ metadata ảnh cũ khi sửa. MapPicker/gallery/kéo thả ảnh thật còn thiếu.

Detail `/thue-phong-tro/:slug` có bảng ước tính từ server, người dùng tự nhập mức dùng (ban đầu trống), phí gửi xe đ/xe/tháng và cọc riêng. FE không có công thức dự phòng; lỗi giữ kết quả cũ với nhãn cảnh báo và nút thử lại. Chủ dự án đã chốt giữ phí bắt buộc: form có nút “Miễn phí / đã gồm trong giá thuê” đặt0 theo từng khoản; ô trống không được gửi. Nhánh null “Chưa kê khai” chỉ phòng thủ dữ liệu cũ bằng calculator/render, không thay DB/DTO để lưu null. FREE là đơn giá đã khai0, không phải amount0 do làm tròn/mức dùng0.

Đặt lịch xem trọ chỉ TENANT hoạt động; không giữ phòng/không thanh toán. Host xác nhận/từ chối/hoàn thành/hủy theo server; hủy Host cần lý do. Lịch/thông báo tải khi mở/quay lại tab/sau thao tác, không polling định kỳ. Notification chỉ in-app, không SMS/Zalo/Socket. Idempotency-Key giữ trong memory cho retry cùng payload/phiên, không bảo đảm qua reload tab. Giờ native input có thể hiển thị theo locale máy, payload và ngày giờ lịch là Việt Nam.

Sau backend chạy, kiểm tra contract FE: `node scripts/generate-appointment-types.mjs --check` (mặc định Swagger tại localhost5000, hoặc OPENAPI_URL). Không hand-edit file generated. Không commit/push nếu chưa được chủ dự án xác nhận riêng. Bằng chứng, ca skip và acceptance còn thiếu xem `SPRINT2_PROGRESS_LOCAL.md`, không gọi Sprint2DONE.

## Yêu cầu

- Khuyến nghị Node `24.15.0` và npm; engines đồng bộ backend (`^22.22.3 || ^24.15.0 || >=26.0.0`).
- Backend/API tại `http://localhost:5000/api/v1`; xem `docs/BACKEND_SPRINT1_SETUP.md`.

## Cài và chạy

Từ repo root:

```powershell
Copy-Item frontend/.env.example frontend/.env.local
Set-Location frontend
npm ci
npm run dev
```

macOS/Linux:

```sh
cp frontend/.env.example frontend/.env.local
cd frontend
npm ci
npm run dev
```

Mở `http://localhost:3000`. Backend `FRONTEND_ORIGIN`/`CORS_ORIGINS` và frontend `FRONTEND_ORIGIN` phải cùng `http://localhost:3000`. Route Handler gọi upstream bằng `BACKEND_API_URL` chỉ phía server; không đặt backend URL vào biến `NEXT_PUBLIC_*`.

`BFF_PROXY_SECRET` trong frontend `.env.local` phải giống backend `.env`, ít nhất 32 ký tự. Giá trị mẫu dùng local; thay bằng secret ngẫu nhiên trước triển khai. `TRUSTED_CLIENT_IP_HEADER` để trống ở local. Chỉ cấu hình header này khi edge proxy của bạn ghi đè IP đơn và chặn truy cập bỏ qua edge; chi tiết ở hướng dẫn backend.

## Scripts

```sh
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

Auth pages: `/login`, `/register`, `/verify-otp`, `/forgot-password`, `/reset-password`. `/account` hiển thị phiên và role hiện tại.

OTP provider hiện ở mock local; mã `devOtp` hiện trong giao diện khi backend mock trả về. Không dùng backend mock OTP ở production.

Login, refresh, reset và logout cùng dùng Web Locks để cập nhật cookie và memory theo thứ tự giữa các tab. BroadcastChannel kèm revision không chứa token trong storage; tab bỏ thông báo của phiên cũ. Trình duyệt cần Web Locks trên secure context (HTTPS hoặc localhost). Kiểm thử nhiều tab browser và thiết bị mobile thật còn cần xác nhận.

`/`, `/homestay`, `/phong-tro/1` còn dữ liệu mẫu để xem UI. `/thue-phong-tro` và `/thue-phong-tro/[slug]` dùng API public thật, không thay bằng phòng mẫu khi rỗng/lỗi; lịch hẹn chưa nối. Trang chủ tìm trọ chuyển ID địa điểm dùng chung với trang tìm kiếm, bán kính km đổi sang mét. Danh sách địa điểm hiện chỉ là preset UI cũ, chưa phải danh mục POI chính thức.

Trình duyệt gọi cùng origin qua `/api/listings`, chỉ cho GET tiện ích/search/detail; `BACKEND_API_URL` chỉ được đọc trên máy chạy Next.js. Không cần `NEXT_PUBLIC_API_URL`, không đưa `BFF_PROXY_SECRET` vào biến public. Production cần `BACKEND_API_URL` rõ ràng và secret BFF khớp backend; thiếu cấu hình trả lỗi, không âm thầm gọi localhost trên máy người xem. Cấu hình IP edge theo hướng dẫn ở trên để rate limit phân biệt khách; local không có edge dùng bucket IP vận chuyển chung. Không cần thư mục giao diện nguồn trên máy khác để chạy frontend này.

Kiểm thử hồi quy tìm trọ: sau khi build và bật frontend, chạy `npm run test:browser:listings -- http://localhost:3000 <đường-dẫn-package-playwright>`. Cần môi trường Playwright có Chromium, hoặc đặt `PLAYWRIGHT_BROWSER_CHANNEL=msedge` để dùng Edge đã cài. Đây là công cụ kiểm thử tùy chọn, không thêm dependency vào ứng dụng. Script intercept response listing/catalog bằng fixture, không ghi DB; smoke HTTP/backend thật cần chạy riêng.

Nền Leaflet hiện dùng tile OpenStreetMap chuẩn, không cần cấu hình key CARTO. Giữ attribution/Referer và cache trình duyệt mặc định; không thêm prefetch/offline hoặc quét tile. Browser regression cũng intercept tile bằng PNG fixture; kiểm tra tải tile live phải chạy riêng, không tải lặp/quét/pan-zoom tự động. Dịch vụ public này không có SLA; trước vận hành tải lớn cần chốt nhà cung cấp phù hợp với [chính sách tile OSM](https://operations.osmfoundation.org/policies/tiles/), không coi cấu hình local là cam kết production.

Browser regression tìm trọ còn kiểm tra chọn nhiều filter liên tiếp, giữ marker/zoom khi hover, giá/diện tích trong URL ngoài preset, map ẩn→hiện/resize trên mobile và lớp map dưới bảng lọc. Khi mất kết nối tile, giao diện có nút tải lại nền bản đồ; không cần tải lại trang hay xóa filter. Test giả lập cả lần tải lại tiếp tục lỗi và phục hồi bằng PNG fixture, không phải kiểm thử SLA nhà cung cấp hoặc mobile vật lý.

## Cập nhật frontend — 04/10/2026

`/account` cho TENANT ACTIVE đã xác thực số điện thoại tự chuyển HOST qua API hiện có. UI chỉ cập nhật role từ server, không tự cấp ADMIN/KYC. `/admin/properties` phục vụ ADMIN ACTIVE duyệt tin trọ dài hạn, so sánh bản đã duyệt/bản sửa, giữ expectedVersion và khóa action sau 409 cho đến khi Admin tải và đọc lại. Trang có noindex/nofollow và không render dữ liệu riêng trong HTML anonymous. BFF `/api/management` dùng Bearer memory và allowlist API Admin hiện có.

Tab bị lỡ BroadcastChannel đăng nhập sẽ xác minh lại phiên từ HttpOnly cookie qua refresh và `/me` khi thấy opaque session ID mới trong storage. Không áp payload thông báo lỗi thời; không đọc role/token từ storage. Khi logout đang chờ, không phục hồi phiên. Private cache bị xóa khi account/role/identity thay đổi; response riêng đến muộn bị chặn. Browser Edge đã kiểm tra hai tab, kể cả một tab không nhận BroadcastChannel. Web Locks/secure context vẫn cần; iOS Safari/Android Chrome vật lý chưa chạy.

Regression mới: `npm run test:browser:catalog-homestay -- <frontend-origin> <playwright-package-path>` dùng fixture cho catalog/tile và homestay demo, kiểm tra nhánh lỗi/retry và URL/history/draft. CMS và Host E2E dùng các runner tại backend với backend/DB test thật, mô tả trong [API Sprint 2](BACKEND_SPRINT2_API.md). Build/UI mới được kiểm tra trong copy clean riêng; frontend 3000 hiện vẫn là build trước, chưa bật lại runtime chính.


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

### Auth reload coordination (05/10/2026)

The browser must support Web Locks, fetch keepalive and writable origin storage. Refresh credentials remain in HttpOnly cookies, access credentials in memory; storage contains only opaque session/revision metadata and a pending-until timestamp. If a document reloads during refresh, restoration may wait up to15seconds to avoid reusing the old cookie while its keepalive response is still arriving. A live wait uses a monotonic clock. Network/abort failures retain the bounded marker because they do not prove the response/Set-Cookie was received; confirmed HTTP responses remove it. Storage denied fails closed and shows a session-unavailable error, not a successful restore.

No new environment variables, dependencies, Auth/listing endpoints or token-reuse grace were added. The pending marker is not durable recovery after OS/browser termination or a lost response beyond its window. Do not claim this is server-side refresh idempotency. Real browser regression must use native network lifecycle for unload; broad Playwright routing can interfere with keepalive. Existing transport-failure fixtures for other flows remain separate from DB/HTTP acceptance.
