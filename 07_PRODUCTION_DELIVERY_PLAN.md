# Kế hoạch phát triển và bàn giao Trọ Tốt

Ngày lập: 28/09/2026. Cơ sở rà soát: commit `475984d` và toàn bộ README, tài liệu 01–06, `.gitignore`.

**Trạng thái: kế hoạch triển khai, chưa phải ứng dụng đã chạy được.** Repo hiện chỉ có tài liệu; chưa có frontend, backend, migration, Dockerfile, bộ kiểm thử hay CI. Các đường dẫn, script và lệnh chạy ứng dụng bên dưới là đầu ra phải xây dựng, không phải những thứ đã tồn tại.

Quyết định đã nhận từ chủ dự án: **ra mắt trọ dài hạn và homestay cùng lúc**. Chủ dự án làm backend; người còn lại thiên về UX, phân vai linh hoạt. Trợ lý có thể hỗ trợ backend, frontend và tích hợp theo từng đầu việc; thay đổi vẫn phải qua các cổng kiểm tra bên dưới.

## 1. Mục tiêu và cách dùng kế hoạch

Sản phẩm cần phục vụ người thật: chủ nhà đăng và quản lý tin, khách tìm trọ/đặt lịch hoặc đặt homestay/thanh toán, quản trị viên xử lý nội dung và tiền. Mục tiêu bàn giao là người khác lấy một commit từ GitHub, dựng được cùng môi trường, thực hiện được luồng nghiệp vụ và tiếp tục phát triển.

Kế hoạch này đề xuất điều chỉnh các điểm mâu thuẫn của tài liệu 01–06. Các tài liệu cũ được giữ để truy nguyên yêu cầu; code mẫu cũ không được xem là giải pháp đã kiểm chứng. Trước khi triển khai từng module, cập nhật lại phần đặc tả liên quan và khóa hợp đồng API trong cùng PR. Không được âm thầm chọn một trong hai mô tả trái nhau.

Ba mức hoàn thành phải tách biệt:

| Mức | Bằng chứng cần có |
| --- | --- |
| Hoàn thành đầu việc | Code + migration + UI/API liên quan + kiểm thử đạt + hướng dẫn cập nhật + push nhánh |
| Bản chạy được trên máy khác | Fresh clone đúng commit, cấu hình local bằng tài liệu, seed, smoke test thành công, ghi hệ điều hành và commit |
| Sẵn sàng mở cho khách thật | Cả trọ và homestay đạt UAT; tích hợp thật được kiểm chứng; có người xử lý tiền/khiếu nại, backup/restore, cảnh báo và rollback |

Không dùng số lượng màn hình, tỷ lệ coverage hoặc việc push thành công để thay thế ba mức này.

## 2. Những điểm phải sửa trước khi dùng thiết kế cũ

| Ưu tiên | Bằng chứng trong repo | Rủi ro và hướng xử lý |
| --- | --- | --- |
| P0 | `04`, mục 3.2: Redis key chứa nguyên `checkInDate_checkOutDate` | A đặt 20–23, B đặt 22–24 tạo hai key khác nhau. Cả hai có thể qua kiểm tra vì DB chưa có `BOOKED`. Đưa quyền chiếm phòng về DB theo từng đêm, transaction và unique constraint. |
| P0 | `04`, mục 3.3: đánh dấu Redis processed trước DB commit | DB lỗi rồi provider retry sẽ bị bỏ qua. Dedupe bằng unique trong DB và ghi giao dịch/trạng thái/outbox trong cùng transaction. |
| P0 | Mẫu webhook ở `04` không kiểm tra amount, currency, merchant và trạng thái hợp lệ | Không được tự động confirm một đơn sai tiền, hết hạn, đã hủy hoặc không thuộc merchant. Cần nhánh đối soát ngoại lệ. |
| P0 | `04` gửi Socket event bên trong DB transaction | Có thể báo thành công rồi rollback. Ghi outbox cùng transaction, phát thông báo sau commit. |
| P0 | `01` hứa refund/payout nhưng `02` chỉ có bản phác thảo transaction và wallet | Thiếu nghĩa vụ hoàn tiền, sổ tiền, payout batch và chống trả trùng. Bổ sung trước khi mở thanh toán thật. |
| P1 | `02`, `03`, `06` dùng `PENDING_CONFIRMATION`, `PENDING`, `PENDING_PAYMENT` khác nhau | Chuẩn hóa state machine và lý do chuyển trạng thái; tách booking, payment, refund, payout. |
| P1 | `01` có Request to Book 12 giờ, `06` không có luồng duyệt | Quy định rõ giữ phòng khi chờ duyệt, thời hạn, lúc bắt đầu thu tiền, từ chối và hết hạn. |
| P1 | `03` ghi khoảng ngày đóng cả hai đầu; code `04` dùng `< checkOut` | Chuẩn hóa `[checkIn, checkOut)`; ngày checkout không chiếm đêm. |
| P1 | `02` index geometry nhưng tìm trên `location::geography` | Dùng geography và GiST tương ứng; kiểm tra EXPLAIN trên dữ liệu đủ lớn, không hứa dưới 10ms khi chưa đo. |
| P1 | `03` seed 63 tỉnh và bắt buộc địa chỉ 3 cấp | Danh mục cũ không phù hợp mô hình hành chính hai cấp. Có dữ liệu phiên bản mới và alias địa chỉ cũ, không bắt nhập huyện. |
| P1 | `03` cho phép token ở Cookie / LocalStorage | Chốt cookie HttpOnly + cơ chế CSRF/session; không để người triển khai tự chọn cách lưu refresh token. |
| P1 | `06` join socket bằng bookingCode | Mã đặt phòng không phải quyền truy cập. Backend xác thực tài khoản và quyền với booking/conversation trước khi join. |
| P1 | `06` thiếu reset password, logout, cancel, refund, payout, moderation, chat và nhiều host API | Hợp đồng API phải đủ luồng, không để frontend đoán endpoint hoặc tự quyết nghiệp vụ. |
| P1 | `03` để admin/moderation và vận hành đến sprint cuối | Duyệt tin phải đi cùng module tin đăng. Kiểm thử, staging, logs và backup bắt đầu từ nền tảng. |
| P1 | README có `file:///d:/...`; `.gitignore` chỉ bỏ qua một số biến thể `.env` | Link tài liệu phải tương đối; chuẩn hóa bỏ qua toàn bộ env thật, chỉ cho phép template vô hại. |
| P2 | `03` cam kết 10 tuần, 500 requests/s và API dưới 150ms | Chưa có scope được chốt, test workload hay năng lực đội. Chuyển thành mục tiêu đo trên cấu hình xác định. |

PostgreSQL có hỗ trợ constraint chặn khoảng giao nhau; kế hoạch này chọn occupancy từng đêm vì phù hợp lịch giá theo ngày và dễ nghiệm thu với đội nhỏ. Đây là lựa chọn thiết kế của dự án, không cần triển khai đồng thời cả hai cơ chế. [Tài liệu PostgreSQL](https://www.postgresql.org/docs/16/rangetypes.html).

PostGIS phân biệt đơn vị của geometry/geography; thiết kế index phải phù hợp biểu thức query. Chọn `geography(Point,4326)` để bán kính tính bằng mét, rồi đo kế hoạch thực thi. [ST_DWithin](https://postgis.net/docs/ST_DWithin.html).

Mô hình hai cấp đã vận hành từ 01/07/2025 với 34 đơn vị cấp tỉnh. Dữ liệu sử dụng khi triển khai vẫn phải đối chiếu danh mục chính thức tại thời điểm nhập, có phiên bản và ngày hiệu lực. [Nguồn Chính phủ](https://baochinhphu.vn/pho-thu-tuong-pham-thi-thanh-tra-lam-viec-voi-ha-tinh-ve-van-hanh-chinh-quyen-dia-phuong-hai-cap-va-cong-tac-bau-cu-102260228183020734.htm).

## 3. Phạm vi ra mắt chung và phạm vi hoàn thiện tiếp

Đợt R1 là một lần ra mắt chung trọ + homestay. Trong quá trình xây dựng chỉ demo/staging nội bộ từng phần. R2/R3 là thứ tự hoàn thiện toàn bộ tầm nhìn hiện có, không xóa các yêu cầu gốc.

| Nhóm | R1: bắt buộc cho lần ra mắt chung | R2/R3: hoàn thiện tiếp |
| --- | --- | --- |
| Tài khoản | SĐT/mật khẩu, xác thực SĐT qua một provider, khôi phục mật khẩu, hồ sơ, logout, quản lý phiên, khóa tài khoản; MFA admin/finance | Google login; thêm kênh OTP khi có nhu cầu/provider |
| Chủ nhà | Host onboarding, thông tin liên hệ, xác minh thủ công với hồ sơ riêng tư, tài khoản nhận tiền, quyền sở hữu dữ liệu | Nhiều nhân viên/môi giới cùng quản lý giỏ hàng bằng phân quyền rõ ràng |
| Trọ | CRUD bản nháp, tối đa 15 ảnh, phí điện/nước/wifi/rác/xe/quản lý, tiền cọc, diện tích, tiện ích, gửi duyệt, sửa/ẩn/báo hết phòng | Video ngắn, gói VIP nhiều cấp, auto-bump, trả phí xác minh |
| Tìm trọ | Địa chỉ hiện hành + alias, giá/diện tích/tiện ích, bản đồ, tìm bán kính quanh điểm/POI, phân trang, chi tiết SEO | Mở rộng POI/địa bàn và tối ưu dựa trên truy vấn thực |
| Lead/lịch xem | Gọi điện/Zalo, ghi lead theo quy tắc chống spam, hẹn xem, chấp nhận/từ chối/đổi lịch/hủy, lịch sử, thông báo | Nhắc lịch qua ZNS/SMS, báo cáo chuyển đổi nâng cao |
| Homestay | Property + unit vật lý, sức chứa/người lớn/trẻ em, gallery, nội quy, giờ nhận trả, lịch trống và giá từng ngày/cuối tuần/lễ | Quản lý tồn kho gộp theo loại phòng khi có yêu cầu cụ thể |
| Booking | Instant Book **và** Request to Book, báo giá phía server, giữ phòng, timeout, my-bookings, check-in/out, no-show, hủy | Mở rộng chính sách sau khi có dữ liệu vận hành |
| Thanh toán | Một cổng QR đã được duyệt cho mô hình kinh doanh; thông báo, kiểm tra trạng thái, đối soát và hoàn tiền có kiểm soát | VNPAY, MoMo, thẻ qua nhà cung cấp đáp ứng điều kiện; không tự lưu dữ liệu thẻ |
| Finance | Ghi nhận thu/chi, commission, refund một phần/toàn phần, payout có duyệt, chứng từ, export và audit | Tự động payout khi provider hỗ trợ và quy trình đã được kiểm chứng |
| Giao tiếp | Chat chữ có lưu lịch sử, thông báo trong ứng dụng/email, realtime có cơ chế lấy lại trạng thái | Kênh bổ sung, tệp chat nếu có nhu cầu thực |
| Review | Một review/booking đủ điều kiện hoàn tất lưu trú; moderation có lý do | Phản hồi của host và thống kê nâng cao |
| Admin/CSKH | Duyệt/từ chối tin, khóa user, xử lý report, complaint/dispute, tra cứu booking/payment/refund/payout, audit | Công cụ chăm sóc/phân tích nâng cao |
| Doanh thu | Commission theo thỏa thuận đã chốt, hiển thị giá minh bạch | Tin VIP, bump và verification fee; ví nạp tiền chỉ sau thiết kế nghiệp vụ riêng |
| Vận hành | CI, staging, HTTPS, secrets, backup/restore, log/cảnh báo, release/rollback, UAT trên máy thứ hai | Scale theo số liệu, tích hợp giám sát mở rộng |

R1 tập trung vào một địa bàn và tập host được onboard có kiểm soát (địa bàn/số host do chủ dự án chốt). Cho phép nhiều property, nhưng mỗi `unit` ngắn hạn ứng với một phòng/căn thực tế có thể bán độc lập. Không coi 10 phòng cùng loại là một unit tồn kho 10 nếu chưa xây cơ chế số lượng.

Với `HYBRID`, một tài sản có thể quảng bá hai hình thức nhưng **cùng một phòng vật lý chỉ có một lịch chiếm chỗ**. Khi cho thuê dài hạn bên ngoài nền tảng, host phải đóng đúng lịch homestay và đánh dấu trạng thái tin. Hợp đồng dài hạn không được tự động hủy booking đã xác nhận. R1 không thu hộ tiền cọc thuê trọ; nếu cần, bổ sung scope hợp đồng/thu hộ riêng trước khi làm.

## 4. Kiến trúc được đề xuất

Giữ modular monolith phù hợp đội hiện tại: một backend NestJS, một frontend Next.js cho public/guest/host/admin, PostgreSQL là nguồn dữ liệu chính. Background worker dùng chung code nghiệp vụ với API nhưng chạy process riêng. Chỉ thêm Redis/BullMQ khi xây tác vụ nền/chat, không dùng Redis làm nơi duy nhất đảm bảo quyền giữ phòng.

| Thành phần | Lựa chọn và quy tắc |
| --- | --- |
| Runtime | Node.js 24 LTS; pin patch khi dựng M0, đồng nhất local/CI/Docker |
| Frontend | Next.js 16 App Router, React tương thích, TypeScript strict; khóa version qua lockfile |
| UI | Tailwind + component cần dùng từ shadcn/ui; mobile-first, form có label và thông báo lỗi |
| State | URL cho bộ lọc; server data qua fetch/TanStack Query nơi cần; không thêm Zustand/Axios mặc định nếu chưa giải quyết nhu cầu thực |
| Backend | NestJS + DTO validation, module auth/properties/appointments/bookings/payments/finance/chat/admin |
| Database | PostgreSQL 16 + PostGIS, Prisma cho CRUD và SQL migration có kiểm soát cho phần đặc thù |
| Jobs | Redis + BullMQ; công việc hết hạn và reconciliation vẫn có dữ liệu nguồn để khôi phục từ DB |
| Storage | Object storage S3-compatible cho production; filesystem volume chỉ cho local/test; chọn một provider khi triển khai |
| Payment | Ưu tiên khảo sát payOS; quyết định sau khi xác nhận merchant, khả năng đối soát/refund và mô hình thu hộ. Nếu không phù hợp thì chọn SePAY/VNPAY với đánh giá tương đương |
| Bản đồ | Leaflet + tile/geocoding provider có quota/điều khoản phù hợp; OSM không đồng nghĩa tile/API miễn phí không giới hạn |
| Kiểm thử | Bộ test backend theo cấu hình NestJS, integration trên PostgreSQL thật, Playwright E2E; không lập nhiều framework trùng nhiệm vụ |
| Chạy/deploy | Docker Compose; GitHub Actions; reverse proxy cùng origin cho web/API; Linux server được cấu hình và đo tải trước ra mắt |

Theo trang hỗ trợ được kiểm tra ngày lập kế hoạch, Node 24 là LTS, Next 16 là Active LTS và Next 14 không còn nằm trong nhóm được hỗ trợ. M0 phải kiểm tra lại patch và advisory trước khi khóa phiên bản. [Node.js](https://nodejs.org/en/about/previous-releases), [Next.js](https://nextjs.org/support-policy).

Cấu trúc đích, chỉ tạo thư mục khi bắt đầu phần tương ứng:

```text
trotot/
  apps/web/                 # Public, guest, host, admin UI
  apps/api/                 # API và entry point worker dùng chung modules
  packages/api-client/      # Sinh từ OpenAPI, không sao chép DTO thủ công
  prisma/                   # Schema, SQL migrations, seed local/test
  tests/e2e/                # Các hành trình xuyên frontend/backend
  scripts/                  # Setup, smoke, chẩn đoán, backup/restore
  docs/                     # Setup, API, quyết định, vận hành, release evidence
  .github/workflows/        # Kiểm tra PR, build và deploy
  compose.yaml
  compose.production.yaml
  .env.example
  package.json              # npm workspaces + các script chung
  package-lock.json
```

Chọn một package manager (npm workspaces), một lockfile. Không cần microservices, Kubernetes, Kafka, Elasticsearch hay một framework monorepo bổ sung ở giai đoạn này. Đây là cách áp dụng nguyên tắc đơn giản của ponytail; các kiểm soát tiền và dữ liệu vẫn phải đầy đủ.

## 5. Các quy tắc nghiệp vụ và dữ liệu phải chốt trước M4

### 5.1. Giá, ngày và tồn phòng

- Ngày lưu trú dùng `DATE`, phạm vi `[checkIn, checkOut)`; ngày sự kiện/payment lưu UTC `timestamptz`, hiển thị theo `Asia/Ho_Chi_Minh`. Giờ máy khách không quyết định timeout.
- Tiền VND dùng số nguyên đồng trong DB, có `currency`; tính tỷ lệ bằng số thập phân/basis points với quy tắc làm tròn rõ ràng. Nếu dùng bigint, API gửi decimal string để không mất độ chính xác JavaScript. Client chỉ format, server tính và kiểm tra giới hạn.
- Quy tắc giá: giá override ngày cụ thể > giá cuối tuần đã cấu hình > giá cơ sở. Một đêm tính một lần; phí vệ sinh theo booking; phụ thu trẻ em/thêm khách, service fee, commission và thuế phải có định nghĩa riêng.
- Quote có thời hạn, breakdown từng đêm, tổng tiền, version giá/chính sách. Khi hold, tính lại trong transaction; giá đổi thì trả lỗi `PRICE_CHANGED` với quote mới cho khách xác nhận. Booking lưu snapshot giá/chính sách; sửa giá tương lai không sửa đơn cũ.
- Kiểm tra min/max stay, ngày không ở quá khứ, số khách/sức chứa, số đêm tối đa và thời gian được đặt trước. Giá trị giới hạn do chủ dự án chốt, không hardcode rải rác.
- Bản R1 đề xuất thu đủ tổng tiền lúc xác nhận. Nếu chọn thu cọc cần thêm lịch phần tiền còn lại và điều kiện check-in; không giả lập đã thu đủ.

### 5.2. Chống đặt trùng ở database

Thiết kế đề xuất: `inventory_reservations` ghi loại `HOLD`, `REQUEST`, `BOOKING`, `HOST_BLOCK`, thời hạn và liên kết booking; `occupancy_nights` ghi các đêm đang bị chiếm, unique `(unit_id, stay_date)`. `calendar_prices` chỉ lưu giá override, không là nguồn trạng thái tồn phòng thứ hai. Lịch hiển thị được suy ra từ occupancy/reservation.

Một thao tác tạo hold:

1. Kiểm tra quyền, dữ liệu và `Idempotency-Key` theo user + operation + hash request. Retry cùng key trả cùng kết quả; cùng key khác payload trả conflict.
2. Trong một DB transaction ngắn, khóa hàng unit (`SELECT ... FOR UPDATE`), kiểm tra trạng thái property/unit và dọn reservation hết hạn của unit bằng thời gian DB.
3. Tính giá, tạo booking/hold và insert tất cả đêm. Unique constraint chặn giao nhau kể cả hai request khác khoảng ngày. Lỗi thì rollback toàn bộ.
4. Ghi outbox cho việc tạo phiên thanh toán/thông báo; commit, sau đó mới gọi provider. Không giữ DB lock trong lúc đợi mạng.
5. Nếu provider chưa trả kết quả, đơn còn trạng thái chờ tạo payment và có API truy vấn/retry an toàn; không tạo nhiều phiên thu tiền khi client retry.

Host block/unblock, expiry, accept/reject request, payment confirmation và cancel cùng tuân thủ thứ tự lock unit → booking/reservation → payment; thao tác nhiều unit khóa theo ID có thứ tự. Block dùng `PUT` đặt trạng thái đích, không dùng toggle dễ đảo ngược khi retry. Unblock chỉ xóa block của host, không được giải phóng đêm của booking.

Worker quét `expires_at`, cập nhật trạng thái và nhả occupancy trong transaction. Khi worker/Redis ngừng, DB vẫn chặn trùng; request hold mới có thể dọn các hold hết hạn dưới cùng lock. Chậm giải phóng là sự cố khả dụng cần cảnh báo, không phải lý do cho phép hai người mua cùng đêm.

### 5.3. Vòng đời booking

| Trạng thái/luồng | Quy tắc và tác nhân |
| --- | --- |
| Instant Book | Tạo `PENDING_PAYMENT`, giữ phòng 15 phút, hết hạn theo thời gian server |
| Request to Book | `PENDING_HOST`, giữ inventory tối đa 12 giờ, chưa thu tiền; giới hạn số yêu cầu pending/user để tránh chiếm lịch |
| Host đồng ý | Trong transaction chuyển `PENDING_HOST` → `PENDING_PAYMENT`, giữ liên tục inventory và cấp hạn thanh toán 15 phút mới |
| Host từ chối/hết hạn | `REJECTED` hoặc `EXPIRED`, nhả inventory, thông báo; thao tác đồng thời với expiry có đúng một kết quả |
| Thu tiền hợp lệ | `PENDING_PAYMENT` → `CONFIRMED`; giữ nguyên các đêm đang sở hữu, ghi nhận tiền cùng transaction |
| Nhận phòng | Host hoặc nhân viên có quyền ghi `CHECKED_IN`, có audit; đến ngày không tự chứng minh khách đã nhận phòng |
| Trả phòng | `CHECKED_IN` → `COMPLETED` với điều kiện thời gian và xác nhận lưu trú; checkout sớm có lý do/audit |
| No-show | Host báo, vận hành xử lý theo chính sách snapshot; không tự cho phép review lưu trú |
| Hủy | Booking chuyển `CANCELLED` khi quyết định hủy có hiệu lực; refund theo lifecycle riêng và có thể còn pending |

R1 cho đổi lịch bằng hủy/đặt lại theo chính sách và sự đồng ý của khách; không sửa ngày/giá âm thầm trên đơn đã trả tiền. Host hủy, đóng tài khoản hoặc ẩn tin không được xóa nghĩa vụ với đơn đã xác nhận.

### 5.4. Payment, refund, payout

- Mỗi booking có thể có nhiều payment attempt. Tách `payment_attempts`, `payment_events`, `refunds`, `payout_batches`, `payout_items`, `ledger_entries`; không dùng một cột `wallet_balance` làm sổ tiền.
- Signature, encoding/canonicalization và response webhook theo đúng provider đã chọn; không áp một HMAC SHA512 chung cho tất cả. payOS có SDK xác thực webhook riêng. [Tài liệu payOS](https://payos.vn/docs/sdks/back-end/node/).
- Chỉ tin thông báo server-to-server đã xác thực hoặc truy vấn provider tin cậy. Redirect trình duyệt hay Socket event không phải bằng chứng thanh toán.
- Kiểm tra merchant/account nhận tiền, order mapping, provider transaction ID, amount, currency (hoặc currency cố định theo hợp đồng), status. Unique provider + transaction/event identity trong DB; không dedupe mọi event chỉ bằng orderCode.
- Khi có payment hợp lệ: ghi event, giao dịch, trạng thái booking và outbox atomically. Nếu rollback, retry vẫn xử lý được. Sau commit mới ACK theo yêu cầu provider; event trùng sau commit được ACK nhưng không ghi tiền lần hai.
- Thanh toán đến muộn sau khi hết hold, sai/thiếu/thừa tiền, giao dịch thành công lần hai: ghi nhận tiền và đưa `PAYMENT_EXCEPTION`; không tự confirm nếu inventory đã nhả. Vận hành giải quyết/hoàn tiền, có SLA và thông báo cho khách.
- Phiên thanh toán hết hạn/hủy không bảo đảm chuyển khoản ngân hàng không còn đến. Hủy provider session là best effort; webhook muộn vẫn phải xử lý như trên.
- Provider timeout sau khi tạo đơn/refund/payout: trạng thái `UNKNOWN`/`PENDING_RECONCILIATION`; truy vấn bằng reference ổn định trước retry. Không coi timeout là thất bại chắc chắn.
- Đối soát định kỳ và theo yêu cầu so ledger với provider/bank statement, tìm webhook thiếu và tiền không khớp. Đóng sự cố chỉ khi có chứng cứ đối soát, không sửa trực tiếp SQL để ép khớp.
- Refund có `REQUESTED → APPROVED → PROCESSING → SUCCEEDED / FAILED / UNKNOWN`, tổng hoàn không vượt số thực thu hợp lệ sau khi trừ hoàn trước. Booking bị hủy không đồng nghĩa tiền đã hoàn.
- Policy snapshot gồm hạn hủy, timezone/giờ check-in, thành phần được hoàn, phí không hoàn, no-show, host hủy và tranh chấp. Nút hủy hiển thị số dự kiến hoàn trước xác nhận.
- Sổ tiền append-only: entry có transaction/reference, loại nghĩa vụ, amount/currency và các dòng cân bằng; điều chỉnh bằng bút toán đảo, không sửa lịch sử. Ghi nhận riêng tiền khách, khoản phải trả host, phí nền tảng và refund.
- Payout chỉ gồm khoản đủ điều kiện sau lưu trú và thời gian xử lý tranh chấp đã chốt; loại khoản hold/dispute/refund. Mỗi payable chỉ được cấp phát một lần; retry dùng cùng batch/reference, lưu chứng từ chuyển khoản.
- R1 cho phép chuyển khoản refund/payout thủ công có lập lệnh, người duyệt khác người lập, xác nhận chứng từ và reconciliation. Không đánh dấu thành công chỉ vì nhấn nút. R2 mới tự động khi provider cho phép.
- Đổi tài khoản ngân hàng cần xác thực lại, audit và kiểm tra các payout đang chờ. Kế toán/chủ dự án chốt cách tính commission/thuế và trách nhiệm thu hộ trước bật thanh toán production.

### 5.5. Dữ liệu bổ sung và bảo vệ thông tin

Các nhóm bảng cần migration theo milestone: user/session/OTP/role; host/profile/verification; địa chỉ có version/POI; property/unit/details/media/amenities; appointment/status history; price/quote/booking/reservation/occupancy; payment/ledger/refund/payout; review; conversation/member/message; notification/outbox; moderation/report/dispute/audit.

Unique/FK/CHECK thể hiện được quy tắc thì đặt trong DB: ngày hợp lệ, số tiền không âm cho giá, một review/booking, một đêm/unit, provider reference chống trùng. Thuộc tính bắt buộc phụ thuộc loại trọ/homestay được validate ở biên API và kiểm tra trong transaction.

Không cascade xóa tài khoản/property làm mất lịch sử booking/finance/audit. Tách archive/anonymize theo chính sách lưu trữ. KYC, tài khoản ngân hàng và ảnh giấy tờ không xuất hiện trong API public hoặc log; private bucket, signed URL ngắn hạn, quyền truy cập và audit. Chỉ thu dữ liệu cần thiết, chủ dự án chốt thời hạn lưu trước khi nhận hồ sơ thật.

## 6. Hợp đồng API, frontend và trải nghiệm

Chốt một namespace `/api/v1`, tài liệu OpenAPI tại `/api/docs` ở local/staging (production hạn chế quyền). Có DTO, request/response example, quyền truy cập, errorCode, pagination và idempotency cho từng action. Sinh client từ contract; CI phát hiện drift.

| Nhóm contract | Các luồng tối thiểu |
| --- | --- |
| Auth | register/login/logout/me, send/verify OTP, refresh, reset password, revoke sessions, MFA admin |
| Public | search/detail properties và homestays, amenities, locations/POI; chỉ trả bản đã duyệt |
| Host listings | create/update draft, submit, media finalize/reorder/delete, publish visibility, mark rented, units |
| Appointment | create/list/detail, accept/reject/reschedule/cancel/complete, lịch sử; bên kia xác nhận giờ mới |
| Calendar | availability, range pricing, đặt/nhả host block với version chống ghi đè |
| Booking | quote, hold, detail/list, host accept/reject, cancel preview/confirm, check-in/out/no-show |
| Payment | create/read attempt, provider-specific webhook, reconciliation; không public API tự set PAID |
| Finance | refund request/approve/status, payout draft/approve/status, ledger/export; phân quyền riêng |
| Community | reviews theo booking, conversations/messages đọc/lưu, notifications/read/unread |
| Admin | moderation, account actions, verification, reports/disputes, audit và finance queue |

Access token nếu dùng để gọi API chỉ ở memory; refresh token trong cookie HttpOnly/Secure production, rotation/reuse detection, revoke khi đổi mật khẩu. Same-origin giúp giảm CORS phức tạp; mọi endpoint dùng cookie và thay đổi state phải có chống CSRF/kiểm tra origin. Backend kiểm tra ownership trên mọi ID, không chỉ role hay route frontend. Public đăng ký không được tự cấp admin/finance.

UX phải bàn giao cả trạng thái loading/empty/error/retry/403/404, bị giữ phòng, giá thay đổi, mất mạng, hết hạn và thanh toán đang đối soát. Luồng checkout hiển thị tổng tiền cuối cùng trước xác nhận, điều kiện hủy và số khách; countdown từ `expiresAt`, khi hết giờ đọc lại server trước thông báo kết quả.

WebSocket yêu cầu auth và kiểm tra thành viên cho booking/chat/host. Tin nhắn lưu DB trước ACK, có client message ID chống trùng, pagination/cursor và lấy lại lịch sử sau reconnect. Payment có polling dự phòng, refresh trang vẫn khôi phục đúng trạng thái; socket chỉ thúc đẩy đọc lại dữ liệu chính thức.

SEO cho trang public: SSR, canonical, metadata, sitemap chỉ tin được công khai, robots/noindex phù hợp staging và trang riêng tư, JSON-LD được escape an toàn. Không cam kết thứ hạng Google hay rich result chỉ vì có schema. Mobile có touch target, keyboard navigation, focus/error label, tương phản và ảnh thay thế; host calendar phải thao tác được bằng chạm, không phụ thuộc kéo chuột.

## 7. Lộ trình triển khai và điều kiện nghiệm thu

Ước lượng dưới đây là **khung lập kế hoạch**, chưa phải deadline cam kết. Giả định backend và frontend đều có người viết code thường xuyên; người thiên UX có thể cần trợ lý/người backend hỗ trợ frontend. Chưa có thông tin giờ làm mỗi tuần nên không lấy năng lực hai developer full-time làm sự thật.

| Mốc | Thời lượng tham chiếu | Đầu ra và điều kiện đạt | Phụ thuộc |
| --- | --- | --- | --- |
| M0 — Quyết định và nền repo | 1 tuần | Chốt scope R1, đơn vị tồn phòng, provider shortlist, runtime; workspaces, lockfile, env template, Compose, health, CI và hướng dẫn. Máy thứ hai chạy skeleton và DB bằng fresh clone | Không |
| M1 — Auth, quyền, UI nền | 1–2 tuần | Đăng ký/OTP/login/reset/logout thật trong dev, session rotation; RBAC/ownership, admin MFA; layout public/host/admin, xử lý lỗi, auth E2E | M0 |
| M2 — Tin đăng, media, duyệt | 2 tuần | Host tạo cả trọ/homestay/unit, phí đầy đủ, upload có kiểm soát, draft→review→publish/reject, audit. Người khác không sửa được tin; tin chưa duyệt không public | M1 |
| M3 — Tìm kiếm và lịch xem | 2 tuần | Địa chỉ mới/alias/POI, PostGIS, map/filter/SEO detail, gọi/Zalo và appointment end-to-end; đo query, xử lý spam/giờ hẹn | M2 |
| M4 — Lịch, quote, booking | 2–3 tuần | Lịch giá/block, inventory DB, instant/request, expiry worker, checkout và my-bookings. Test concurrency trên DB thật đạt tất cả ca mục 10 | M2; UI tích hợp sau M3 |
| M5 — Thu tiền và đối soát | 2–3 tuần | Một provider, webhook bền vững, outbox, UI QR/polling/reconnect; replay/late/wrong amount/timeout/recovery đạt. Chưa mở cho khách thật | M4; provider onboarding bắt đầu M0 |
| M6 — Sau booking và tài chính | 2–3 tuần | Cancel/refund policy snapshot, no-show/check-in/out, ledger, payout có duyệt, dispute queue, báo cáo host/admin; test mất phản hồi và chống trả trùng | M5 |
| M7 — Chat, review và thông báo | 1–2 tuần | Chat persistence/authorization/reconnect, notifications/email, review đủ điều kiện, report/moderation; UAT guest/host/admin đầy đủ | M3 + M6; UI có thể làm trước |
| M8 — Hardening và pilot kín | 2–3 tuần | Production-like staging, dữ liệu mẫu lớn, tải, bảo mật, đa trình duyệt, fresh clone máy thứ hai, restore drill, rollback drill; pilot với host kiểm soát | M1–M7 |
| M9 — Ra mắt chung R1 | 1 tuần + theo dõi | Release tag, cấu hình thật, smoke test production, host onboarding, CSKH/finance trực, cả trọ và homestay hoạt động; feature switch tắt nhận booking mới khi sự cố | M8 và gate vận hành |
| R2 — Doanh thu và kênh bổ sung | 4–6 tuần | VIP/bump/verification fee, Google login, video, provider thứ hai, ZNS/SMS; mỗi phần cùng tiêu chuẩn DoD | R1 ổn định |
| R3 — Hoàn thiện mở rộng | Ước lượng lại theo scope | MoMo/thẻ còn thiếu, payout tự động, ví nếu còn nhu cầu, cộng tác môi giới; migration, reconciliation và threat review tương ứng | Hợp đồng provider + dữ liệu vận hành |

M0–M9 cộng lại khoảng **16–22 tuần làm việc theo giả định trên**, thêm dự phòng 20–30% cho tích hợp, UAT và sự cố: khoảng **20–29 tuần** cho R1. Đây là dự báo ban đầu, cần hiệu chỉnh sau M1 bằng đầu ra thực tế. Thời gian chờ duyệt merchant và chuẩn bị vận hành có thể nằm ngoài khoảng này. Tổng phạm vi toàn bộ tài liệu sẽ dài hơn R1; chưa thể hứa ngày hoàn thành R3 khi các tích hợp chưa chốt.

Nếu chỉ làm buổi tối hoặc UX không trực tiếp viết frontend, lịch phải tính theo giờ thực tế và phần frontend cần người nhận; không giữ nguyên lịch bằng cách bỏ kiểm thử/refund/backup. Sau mỗi mốc ghi số task đạt, ca lỗi, thời gian thực và điều chỉnh phần còn lại.

Không để một nhánh sống suốt milestone: tách PR 0,5–2 ngày theo phần có thể kiểm tra. Một PR backend chưa có UI vẫn phải có contract/test để bên frontend dùng được; milestone chỉ xong khi luồng tích hợp chạy.

## 8. Chia việc cho đội hiện tại

| Trách nhiệm | Người dẫn | Người phối hợp và bằng chứng |
| --- | --- | --- |
| Quyết định giá/phí/chính sách/địa bàn/merchant | Chủ dự án | Ghi quyết định có ngày hiệu lực; trợ lý chuẩn bị phương án và tác động |
| Backend, DB, booking, payment, bảo mật | Bạn | Trợ lý triển khai/rà soát; phía UX kiểm tra contract và trạng thái lỗi ảnh hưởng giao diện |
| User journey, wireframe, UI rules, mobile UAT | Bạn UX | Trợ lý chuyển thiết kế thành frontend, tích hợp API; bạn review nghiệp vụ |
| Frontend và API client | Trợ lý hỗ trợ theo task đã nhận, hoặc người UX nếu có khả năng code | Có người chịu trách nhiệm cuối task; không mặc định “frontend tự xuất hiện” sau thiết kế |
| CI, Docker, migration, staging/release | Bạn + trợ lý hỗ trợ | Bạn UX thực hiện fresh clone theo tài liệu và báo lỗi thiếu hướng dẫn |
| CSKH, duyệt host/tin, dispute và đối soát | Chủ dự án chỉ định người vận hành | Có tài khoản quyền phù hợp, checklist xử lý, thời gian phản hồi; không gán ngầm cho developer |

Mỗi đầu việc ghi ID, mục tiêu, owner, dependency, phạm vi file, API/schema bị ảnh hưởng, checklist test và link PR. Trước khi hai người sửa cùng migration/OpenAPI/package-lock phải đồng bộ; review cả nghiệp vụ lẫn giao diện. Trợ lý có thể làm nhiều phần, nhưng merchant, quyết định kinh doanh và nghiệm thu trên máy thực tế vẫn cần người có quyền thực hiện.

### Backlog bắt đầu ngay trong M0–M1

| ID | Công việc | Bằng chứng hoàn thành |
| --- | --- | --- |
| FOUND-01 | Chốt decision log và R1 checklist | Có quyết định/tạm định/owner/hạn chốt cho mục 13 |
| FOUND-02 | Scaffold npm workspaces, Next/Nest, TypeScript/lint | Fresh install bằng lockfile, build cả hai app |
| FOUND-03 | Compose, DB PostGIS, migration và app health | Dựng từ volume trống; lỗi migration làm startup fail rõ |
| FOUND-04 | Env validation, local media và notification/payment fake | Chạy dev không cần tài khoản dịch vụ trả phí; production từ chối fake |
| FOUND-05 | CI và PR checklist | Lint/typecheck/test/build trên PR; log không chứa secret |
| FOUND-06 | Setup, seed và smoke script | Bạn UX chạy trên máy khác bằng đúng README, không cần gửi DB dump |
| AUTH-01 | Users/host profile/session, register/login/logout | Tests auth, tài khoản bị khóa, revoke session |
| AUTH-02 | OTP/reset/rate limit và provider adapter | OTP có TTL/giới hạn thử, không tái sử dụng, không ghi log production |
| AUTH-03 | Quyền owner/admin/finance, MFA admin | Tests gọi API trực tiếp vượt quyền đều bị chặn |
| UX-01 | Wireframe các luồng trọ/homestay/host/admin | Có loading/error/empty, mobile và exception payment |
| WEB-01 | Layout + auth screens + API client | End-to-end đăng nhập và điều hướng đúng quyền |

## 9. Chuẩn “máy khác clone là chạy được”

### 9.1. Hai chế độ chạy

**Chế độ bàn giao:** Git + Docker Engine/Desktop và Compose phiên bản được ghi trong README. Web, API, worker khi cần, PostgreSQL/PostGIS, Redis khi cần chạy bằng container; người nhận không phải cài DB hoặc Node trên host. Windows dùng Linux containers/WSL2; Linux là môi trường CI/deploy. macOS/ARM chỉ được tuyên bố hỗ trợ sau khi image và smoke test đã kiểm tra trên kiến trúc đó.

**Chế độ phát triển:** cùng DB qua Compose, app chạy Node/npm đã pin để hot reload. Script chung tránh phụ thuộc Bash-only hoặc PowerShell-only; nếu cần lệnh shell thì README cung cấp cả hai. `.gitattributes` định nghĩa line endings và tránh đường dẫn tuyệt đối trong config.

Quy trình dự kiến sau FOUND-06 (hiện chưa chạy được):

```text
git clone https://github.com/Romfff/trotot.git
cd trotot
# Checkout release tag hoặc nhánh/commit đã bàn giao.
# Copy .env.example thành .env theo lệnh phù hợp hệ điều hành.
docker compose up --build -d --wait
docker compose run --rm api npm run db:seed:local
docker compose run --rm api npm run smoke:local
```

M0 phải triển khai và kiểm chứng chính các command này hoặc cập nhật command thực tế, không để tài liệu có lệnh hư cấu sau bàn giao. Web mục tiêu tại `http://localhost:3000`, browser gọi `/api/v1` cùng origin, server-to-server dùng service name nội bộ; không trộn `localhost` của host và container.

### 9.2. Điều kiện kỹ thuật

- Pin runtime/package manager, commit lockfile, Docker image tag/digest đã kiểm tra; CI dùng `npm ci`. Có lịch cập nhật bản vá qua PR, không pin vĩnh viễn rồi bỏ vá lỗi.
- `.env.example` mô tả từng key, required/optional, local value vô hại. Secrets production không commit; `.env.*` bị ignore ngoại trừ example rõ ràng. Kiểm tra cả file tracked để tránh hiểu nhầm `.gitignore` sẽ loại secret đã commit.
- App validate config ngay startup; production thiếu secret/provider, bật fake hay dùng default password phải fail. Không lộ secret trong biến `NEXT_PUBLIC_*`, bundle hoặc Docker build layer.
- Compose healthcheck thật, app retry kết nối có giới hạn; DB healthy rồi chạy migration một lần, migration thành công mới mở API/worker. [Docker Compose startup](https://docs.docker.com/compose/how-tos/startup-order/).
- Migration có trong Git; không dùng schema sync/db push làm deploy. Seed idempotent chỉ môi trường local/test, dữ liệu giả đầy đủ ảnh local/tiện ích/property/booking; không tự chạy seed demo lên production.
- Seed có guest, hai host để test cách ly dữ liệu, moderator, finance/admin local và các trạng thái hợp lệ. Mật khẩu chỉ dành dev và được ghi rõ; prod tạo tài khoản đầu tiên qua quy trình riêng, không có admin mặc định.
- Local OTP/email hiển thị ở giao diện/hộp nhận dev; payment fake tạo cả event hợp lệ/trùng/trễ/sai tiền qua cùng luồng xử lý nghiệp vụ. Fake không đánh dấu trực tiếp PAID để bỏ qua booking/payment validation.
- Ảnh local và dữ liệu DB dùng named volume. Stop/start/rebuild app giữ dữ liệu; thao tác reset/xóa volume là lệnh riêng, có cảnh báo và không nằm trong setup thường ngày.
- README có đổi port khi bị chiếm, kiểm tra Docker/WSL2, log/health, migration lỗi, env thiếu, cookie/CORS, dung lượng đĩa, hướng dẫn update từ commit cũ.
- Cập nhật checkout có code đang sửa phải kiểm tra `git status` trước; không hướng dẫn reset hard hoặc xóa volume để “chạy cho được”.

### 9.3. Biên bản máy thứ hai

Người nhận ghi commit/tag, OS/CPU, Docker/Compose version, command đã chạy, kết quả health/migration/seed, login, đăng tin/duyệt/tìm kiếm, hold/payment fake và restart còn dữ liệu. Lưu evidence trong release checklist. Linux CI không thay cho việc đã xác minh máy Windows/macOS thật của đồng đội; nếu chưa test phải ghi rõ “chưa xác minh”.

## 10. Kiểm thử và ngưỡng chất lượng

| Nhóm | Các ca không được bỏ |
| --- | --- |
| Identity/permission | Host A đọc/sửa unit B; guest đọc booking khác; user tự cấp admin; user banned; token cũ sau reset/logout; socket room trái phép; CSRF và OTP brute force |
| Listing/media | Tin draft/rejected không public; sửa nội dung nhạy cảm cần duyệt lại; ảnh giả định dạng/quá dung lượng; upload của người khác; XSS trong mô tả/JSON-LD; không cho URL upload dẫn server đọc tài nguyên nội bộ |
| Search | Radius tính mét, lat/lng không đảo; địa chỉ/alias; lọc kết hợp, thứ tự ổn định và pagination; plan query đúng index trên dữ liệu đại diện |
| Inventory | Ít nhất 100 request đồng thời cùng phòng/cùng đêm chỉ một hold thắng; hai khoảng giao một phần cũng chỉ một thắng; hai kỳ sát checkout được phép; transaction nhiều đêm rollback sạch |
| Race conditions | Host block vs hold; host accept vs timeout; webhook vs timeout/cancel; worker chạy trùng; request retry cùng key; Redis restart/API restart không sinh hai booking hợp lệ cùng đêm |
| Pricing | Ngày thường/cuối tuần/lễ, qua tháng/năm/năm nhuận, checkout không tính đêm, khách vượt sức chứa, quote hết hạn/đổi giá, rounding/commission/refund đúng tới đồng |
| Payment | Chữ ký sai; đúng chữ ký sai merchant/amount/order; duplicate/reordered webhook; DB fail rồi retry; crash sau commit trước ACK; late payment; provider create timeout; redirect giả; reconciliation tìm giao dịch bị thiếu |
| Refund/payout | Hủy có/không hoàn, hoàn một phần nhiều lần, tổng hoàn vượt thu bị chặn; timeout phải reconcile; payout trùng bị chặn; không trả khoản dispute; account change có audit |
| Chat/review | Unauthorized join; message duplicate/reconnect; review chỉ booking hoàn tất của người viết; không review hai lần; report và moderation có dấu vết |
| Portability | DB trống→migration→seed; nâng cấp từ release trước; env mới; container rebuild; app restart giữ dữ liệu; fresh clone máy thứ hai |
| Recovery | Tắt worker/provider/Redis; restart; outbox còn xử lý lại; restore backup sang DB mới; rollback image tương thích schema |
| UI/UAT | Mobile 375px, desktop, Safari/Chrome thực tế; thao tác bàn phím, lỗi mạng, session hết hạn lúc checkout, lịch host trên màn hình nhỏ |

DB integration phải dùng PostgreSQL với constraint thật, không SQLite/mock cho bài test booking/finance. E2E tối thiểu hai hành trình trọ và homestay gồm host + admin + guest. Unit tests ưu tiên pricing, policy và transition; không viết test chỉ lặp lại implementation.

Mục tiêu hiệu năng ban đầu để đo, không phải kết quả đã đạt: p95 search <500ms, p95 mutation nội bộ <800ms (không cộng latency provider), lỗi 5xx <1% với workload 50 request/giây hỗn hợp trong 15 phút, dữ liệu 10.000 tin/100.000 booking và cấu hình staging được ghi lại. Test contention booking là bài riêng, không dùng kỳ vọng 409 làm lỗi 5xx. Điều chỉnh mục tiêu sau baseline và ngân sách; không suy từ đây ra 500 request/giây production.

Không để tồn lỗi nghiêm trọng về lộ dữ liệu, mất tiền, đặt trùng hoặc mất khả năng restore khi release. Accessibility, tốc độ trang mobile và SEO được đo trên trang đại diện; điểm Lighthouse là tín hiệu, không đủ chứng minh toàn bộ trải nghiệm.

## 11. Git, CI/CD và tiêu chuẩn push mỗi phần

Giữ quy ước repo: `main` là code đã kiểm tra, `develop` tích hợp/staging, nhánh `feature/...`, `fix/...`, `docs/...` ngắn hạn. Chỉ tạo `develop` khi dựng nền triển khai. Không trực tiếp đẩy code chưa qua review vào `main`.

Quy trình mỗi task:

1. Đồng bộ remote, kiểm tra thay đổi local, chọn base mới; nhận owner để tránh sửa chồng.
2. Chốt contract/schema ảnh hưởng trước frontend/backend; code + migration + UI + test + env/docs trong cùng chuỗi PR liên kết.
3. Chạy check phù hợp thay đổi, xem diff/secret, commit theo ý nghĩa rõ (`feat`, `fix`, `docs`, `test`, `chore`).
4. Push nhánh ngay sau phần kiểm tra được; mở PR với mục tiêu, cách chạy, migration/env mới, kết quả test, ảnh UI nếu cần và rủi ro triển khai.
5. CI chạy lint/typecheck, unit/integration, migration fresh và upgrade khi có release cũ, build; critical E2E trước merge. Docs-only PR kiểm tra link/format, không giả báo đã test ứng dụng.
6. Người còn lại review; với tiền/booking/auth bắt buộc kiểm tra quy tắc và các ca lỗi, không chỉ nhìn screenshot. Merge vào develop sau checks; demo staging và fresh-clone khi đổi nền/milestone.
7. Release PR develop→main với evidence UAT; tag release bất biến, build image gắn commit SHA, deploy đúng image đã test.

Checklist DoD cho mỗi đầu việc:

- [ ] Luồng chính và lỗi dự kiến chạy được, không còn mock trên đường production đã bàn giao.
- [ ] API validation/authorization, migration/index và trạng thái UI liên quan đầy đủ.
- [ ] Checks phù hợp đạt; ghi rõ phần chưa chạy và lý do.
- [ ] Không secret/dump/ảnh giấy tờ/node_modules/build output trong Git.
- [ ] Env template, contract và hướng dẫn cập nhật nếu có thay đổi.
- [ ] Commit + push nhánh; PR ghi dependency và cách người kia chạy/kiểm tra.
- [ ] Mốc có thay đổi setup phải có bằng chứng fresh clone, không chỉ “máy mình chạy được”.

Mỗi PR cần: `What/Why`, `How to run`, `Checks`, `Schema/env`, `Known limitations`, `Rollback impact`. Branch protection/required checks là cấu hình GitHub riêng phải thiết lập và kiểm tra ở M0; chưa thể coi đã có chỉ vì viết trong README.

## 12. Production, vận hành và gate ra mắt chung

- Tách local/staging/production: DB/bucket/keys/domain riêng, staging không index và không dùng dữ liệu khách thật để demo.
- Build image một lần rồi promote qua môi trường; HTTPS, chỉ mở reverse proxy, DB/Redis không public, tài khoản DB tối thiểu quyền, process không root khi khả thi.
- Migration do deploy job thực hiện một lần; backup trước thay đổi rủi ro. Ưu tiên expand→migrate→contract để image trước còn chạy được; rollback app không tự động rollback DB phá dữ liệu.
- Logs có requestId/bookingId/provider reference đã lọc dữ liệu, không token/OTP/giấy tờ. Metrics gồm 5xx/latency, failed jobs, outbox lag, overdue hold, payment exceptions, refund/payout pending, DB connections, disk và backup age.
- Có người nhận alert và runbook xử lý booking/payment/provider down, webhook retry, disk full, account compromise, restore và rollback. Khi lỗi thanh toán/tồn phòng nghiêm trọng, tắt nhận booking mới nhưng giữ khả năng tra cứu và xử lý nghĩa vụ hiện có.
- Backup DB được mã hóa và lưu ngoài máy chủ, media có chính sách phục hồi tương ứng. Pilot kỹ thuật có thể dùng daily backup; **trước thu tiền thật** mục tiêu đề xuất RPO ≤15 phút, RTO ≤4 giờ qua PITR/giải pháp phù hợp và restore drill. Nếu không đạt thì gate chưa qua hoặc chủ dự án phải quyết định mục tiêu vận hành khác bằng văn bản.
- Với DB restored có thể thiếu payment xảy ra sau recovery point: giữ booking mới tắt, chạy reconciliation ngân hàng/provider, kiểm tra occupancy và outbox trước mở lại. Restore file thành công chưa đủ.
- Lập ngân sách theo VPS/DB, storage/egress, email/SMS, map/geocoding, payment fees, backup/monitoring và công vận hành. Chốt giá từ provider vào lúc mua; theo dõi chi phí trên một booking/lead, không hứa mức tiền khi chưa có lưu lượng.
- Chủ dự án phối hợp người có chuyên môn rà mô hình marketplace/thu hộ, điều khoản host/guest, quyền riêng tư, xử lý khiếu nại, thuế/hóa đơn và thủ tục áp dụng trước kinh doanh. Đây là đầu việc kiểm tra điều kiện thực tế, không phải kết luận pháp lý từ bản kế hoạch.

Gate R1, cả trọ và homestay cùng phải đạt:

- [ ] Trọ: đăng→duyệt→tìm→liên hệ/hẹn→xác nhận, đủ bảng phí và trạng thái hết phòng.
- [ ] Homestay: instant/request→hold→pay→check-in/out→review; hủy/no-show/dispute/refund cũng chạy được.
- [ ] Payment provider production đã được chấp thuận cho mô hình kinh doanh; có kiểm thử giao dịch/đối soát/hoàn tiền có kiểm soát bởi người được ủy quyền.
- [ ] Payout có người lập/duyệt, sổ tiền đúng, không còn exception tiền chưa giải thích.
- [ ] Test suite trọng yếu, kiểm tra bảo mật, UAT guest/host/admin đạt; không còn lỗi chặn release.
- [ ] Máy đồng đội clone đúng release chạy được; ghi evidence thật, hỗ trợ OS chưa kiểm tra phải ghi rõ.
- [ ] Backup restore và rollback diễn tập thành công; cảnh báo có người nhận và hiểu cách xử lý.
- [ ] Provider keys/domain, chính sách kinh doanh, CSKH và host đầu tiên sẵn sàng; chủ dự án quyết định mở traffic.

Sau ra mắt, theo dõi sát 48 giờ đầu và đánh giá sau 1–2 tuần: lỗi đăng tin/tìm kiếm, hold→pay conversion, booking failures, hủy/refund, đối soát lệch, thời gian CSKH, chi phí hạ tầng. Mở rộng traffic/host dựa trên kết quả, không mở mọi tính năng R2 cùng lúc.

## 13. Quyết định còn cần chủ dự án chốt

Các quyết định này không chặn đọc tài liệu hoặc dựng local, nhưng phải được chốt trước milestone tương ứng. Không coi im lặng là đồng ý về tiền hoặc việc dùng production.

| Quyết định | Hiện trạng/đề xuất | Hạn chốt |
| --- | --- | --- |
| Trọ và homestay ra cùng lúc | **Đã chốt bởi chủ dự án** | Đã chốt |
| Phân vai | **Bạn backend, bạn kia UX, linh hoạt; trợ lý hỗ trợ code nhiều phần** | Đã chốt hướng; gán owner từng task |
| Giờ làm mỗi tuần và deadline kinh doanh | Chưa biết; estimate M0–M9 chỉ là tham chiếu | M0 để chốt lịch |
| OS/CPU máy bạn UX | Chưa biết; Windows/Linux là đường chạy phải kiểm tra đầu tiên | FOUND-06 |
| Địa bàn, loại host, nguồn tin/ảnh và quyền sử dụng | Đề xuất pilot một địa bàn với host đã onboard | M0–M2 |
| Thu đủ hay thu cọc homestay | Đề xuất R1 thu đủ; nếu thu cọc cần phần phải thu còn lại | Trước M4 |
| Commission/service fee/thuế/cancellation/no-show | Chưa chốt; mọi mức cũ 8–12% chỉ là đề xuất | Trước M4 |
| Merchant và ai nhận tiền/hoàn tiền/trả host | Chưa chốt; xác nhận với provider, không chỉ chọn logo QR | Bắt đầu M0, xong trước M5 production |
| Provider OTP/email/map/storage và quota | Dev dùng local; production chọn theo ngân sách và điều kiện | M1–M3 |
| Người duyệt tin/KYC, CSKH, finance và SLA | Chủ dự án chỉ định; developer không mặc định trực 24/7 | Trước pilot M8 |
| Hosting/backup budget, RPO/RTO | Đề xuất tại mục 12; cần năng lực thực hiện và diễn tập | Trước M8 |
| VIP/auto-bump/video/Google/multiple gateways/wallet | Nằm R2/R3, không tuyên bố đã hoàn thành R1 | Khi lập backlog R2 |

## 14. Bàn giao của lượt lập kế hoạch này

Đầu ra hiện tại là bản rà soát và kế hoạch trong Git, README trỏ đến kế hoạch, cảnh báo các mẫu cũ cần sửa trước triển khai. Chưa có ứng dụng, chưa chạy test booking/payment, chưa kiểm chứng Docker hay máy đồng đội và chưa có deployment production.

Bước triển khai kế tiếp là **FOUND-01 đến FOUND-06**: dựng nền chạy xuyên máy và CI, đồng thời chốt wireframe/contract auth. Sau khi nền được kiểm tra mới mở module nghiệp vụ; mỗi mốc đi theo thứ tự phụ thuộc và checklist trên, push từng phần đã kiểm tra lên nhánh để hai người tiếp tục được.
