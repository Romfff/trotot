# Sprint 5 — contract và quyết định triển khai riêng

Ngày: 2026-10-08. Không sửa/thay thế 01–06 hoặc 08. Tài liệu nội bộ, không tự stage/push.

## Quyền và nguồn

Chủ dự án yêu cầu bắt đầu Sprint 5, sau đó trả lời trực tiếp:
“Duyệt cả 3, ghi contract riêng trước khi code”.

- 01: review sau chuyến đi, chat Tenant–Host, Admin quản lý người dùng/tin.
- 02: review gắn với booking; dữ liệu, quyền và quan hệ phải kiểm ở server.
- 03 Sprint 5: Admin CMS, verified review, chat, SEO, hiệu năng, vận hành/bàn giao.
- 04 Sprint 5/vận hành: Socket.io, phân quyền, backup/restore, CI.
- 05 Sprint 5: frontend tối giản theo brand hiện có, review/chat/Admin.
- 06: envelope hiện có và sự kiện NEW_CHAT_MESSAGE; thiếu REST contract review/chat/ban nên ghi riêng tại đây.

Không dùng mức “90% Sprint 4” làm bằng chứng nghiệm thu. Gateway thật, upload và SMS vẫn chưa nghiệm thu.

## D-S5-01 — review (đã duyệt)

- Đúng một review cho mỗi booking COMPLETED, do khách đặt booking đó tạo.
- Ba tiêu chí: Sạch sẽ, Vị trí, Đáng tiền; giải quyết khác biệt giữa ví dụ Host trong 01 và Value trong 03 bằng quyết định mới này.
- Hiển thị công khai ngay. Chưa có sửa/xóa/trả lời review.
- Partial stay, no-show và đơn không COMPLETED không mở quyền đánh giá.
- Không giả dữ liệu review, số lượt, điểm trung bình hoặc JSON-LD aggregateRating.
- D-S5-04 (chủ dự án chốt trực tiếp 2026-10-08): review đã đăng của khách bị khóa giữ công khai; khóa không thay đổi điểm/hiển thị review cũ. Chưa có kiểm duyệt/xóa review, đây là giới hạn đã biết, không tự thêm. Chưa dựng điểm trung bình; khi có sau này không loại review chỉ vì guest bị khóa.

Mapping triển khai dự kiến, giữ prefix /api/v1 và envelope 06:

Checkpoint 2026-10-08 S5-01: mapping review bên dưới đã được triển khai riêng theo hướng được duyệt; không sửa API Guest/Host cũ. `GET own` trả `data:null` nếu chưa đánh giá. Giới hạn kỹ thuật comment 1–2000 ký tự sau trim; điểm là số nguyên 1–5, không ép chuỗi thành số. GET public không cache, không dựng aggregateRating. API trả tên hiển thị và không trả guestId/bookingId/contact/payment; không thêm quyền chỉnh/xóa.

| Method/path | Quyền và nội dung |
| --- | --- |
| POST /bookings/:id/review | Access token; server kiểm guestId và COMPLETED; booking không thuộc người gọi trả 404. Body cleanliness/location/value (số nguyên 1–5), comment. |
| GET /bookings/:id/review | Khách đặt đọc review của booking của mình; không tự mở quyền cho người khác. |
| GET /properties/:slug/reviews | Public, chỉ tin công khai; danh sách phân trang page/limit, meta ngoài data. Không trả số điện thoại, email, thông tin thanh toán hay mã đơn. |

DB unique booking_id; transaction kiểm trạng thái và ownership. Retry/race không tạo review thứ hai; trả 409 với mã riêng khi đã có. Response dùng review id, ba điểm, comment, createdAt và tên hiển thị; không lộ bookingId ở API công khai.

## D-S5-02 — chat (đã duyệt)

- Chat chữ theo từng tin giữa khách và Host, không tự chat.
- Chỉ người tham gia được đọc/gửi. Lịch sử vẫn xem được khi tin ẩn.
- Không file/ảnh, nhóm chat, read receipt, thông báo SMS, nội dung dựng sẵn hay chatbot.
- D-S5-05 (chủ dự án chốt trực tiếp 2026-10-08): chat mới chỉ mở từ tin PUBLISHED chưa xóa mềm, Host ACTIVE; chặn ở server, kể cả link cũ/API trực tiếp. Tin HIDDEN không mở chat mới; chat đã tồn tại vẫn đọc/gửi, khi hiện lại được mở mới bình thường.
- D-S5-06 (chủ dự án chốt trực tiếp cùng ngày): tin EXPIRED chặn chat mới, chat cũ vẫn đọc/gửi. REJECTED, bị gỡ hoặc deletedAt khác null: chặn chat mới, chat cũ chỉ đọc; Admin đọc lịch sử. Tin được khôi phục/gia hạn về trạng thái cho gửi thì gửi lại được. Không thêm ngoại lệ booking đang hiệu lực, giới hạn đã biết.
- Tài khoản bị khóa không gửi/nhận realtime; server kiểm ACTIVE và session khi kết nối, gửi, tham gia và trước phát sự kiện. Không đổi nội dung review cũ khi khóa khách.
- D-S5-07: "bị gỡ" dùng deletedAt hiện có, ưu tiên hơn status; không thêm trạng thái/đổi DTO listing. Một hàm policy duy nhất kiểm bảng status × deletedAt. Chat không phân biệt Admin gỡ với chủ nhà tự xóa; kiểm tra và báo khả năng khôi phục hiện có, không tự thêm restore.

Mapping dự kiến:

| Method/path | Nội dung |
| --- | --- |
| POST /conversations | Body propertyId; lấy hostId từ server, không nhận participants tùy ý từ client. |
| GET /conversations | Chỉ conversation người gọi tham gia; phân trang. |
| GET /conversations/:id/messages | Chỉ thành viên; phân trang ổn định theo createdAt/id. Không thuộc conversation trả 404. |
| POST /conversations/:id/messages | Body clientMessageId (UUID), text; persist trước emit. Unique conversationId/senderId/clientMessageId chống gửi lặp. |

Socket xác thực access token qua handshake auth, không URL. NEW_CHAT_MESSAGE giữ tên của 06; room chỉ được server cấp sau kiểm quyền. Reconnect đọc lại API; socket không thay thế kiểm quyền DB. Không phát sự kiện nếu transaction thất bại. Phiên bị khóa/thu hồi không tiếp tục gửi hoặc nhận dữ liệu.

Chi tiết kỹ thuật S5-02: namespace /chat dùng cùng Socket.io server hiện có, cờ REALTIME_ENABLED và Origin allowlist. joinConversation nhận {conversationId}; NEW_CHAT_MESSAGE gửi {conversationId,clientMessageId,text}, ack sau DB commit. Sự kiện server chỉ là hint {conversationId,message: messageId}; client đọc lại API được kiểm quyền, không phát nội dung chat lên kênh Redis. Text trim 1–3000 ký tự, clientMessageId UUID; cùng id cùng nội dung trả bản cũ, khác nội dung 409 CHAT_MESSAGE_KEY_REUSED. GET messages dùng before (message UUID) và limit 1–50, thứ tự createdAt/id giảm dần, cursor chỉ thuộc conversation; client đảo thứ tự để hiển thị. Danh sách conversation dùng page/limit envelope 06, không trả contact. Admin chỉ đọc lịch sử qua GET, không join/send thay người tham gia. Chưa file/ảnh/read-receipt.

## D-S5-03 — khóa/mở tài khoản (đã duyệt)

- Admin thực hiện, có lý do. Không khóa chính mình hoặc Admin cuối cùng.
- Khóa thu hồi phiên và kết nối chat. Mở khóa không khôi phục token cũ.
- Không xóa booking, lịch hẹn, sổ tiền hoặc số dư.
- Tin của Host bị khóa không hiển thị công khai, kể cả qua detail/map/cache/SEO.

Mapping dự kiến: GET /admin/users (phân trang), POST /admin/users/:id/ban và /unban, body reason/expectedStatus. Server kiểm Admin; cập nhật có điều kiện trạng thái hiện tại, lệch trả 409. Audit ghi actor/target/trạng thái trước-sau/lý do/thời gian; không ghi secret.

## Gate chưa được tự quyết

- Khi Host đổi/chuyển quyền thì conversation cũ xử lý thế nào: hỏi trước nhánh phụ thuộc. D-S5-04/05/06/07 đã chốt review guest bị khóa và chat khi ẩn/hết hạn/từ chối/xóa mềm.
- Gate GMV đã được chủ dự án chốt ở D-S5-08; không suy ra GMV từ tổng đơn chưa thanh toán.
- Độ dài comment/text và giới hạn spam sẽ dùng giới hạn kỹ thuật rõ trong DTO; không thêm chính sách nghiệp vụ ẩn.
- Mỗi mapping trên cần đối chiếu OpenAPI thực tế khi triển khai. Review đã có API/BFF/UI và kiểm thử local tại checkpoint S5-01; chat có DB/API/Socket checkpoint S5-02, chưa BFF/UI; ban chưa có endpoint, không ghi là đã tích hợp.
- Không tự deploy, tạo offsite backup provider, đăng ký gateway hoặc thêm hợp đồng thu nợ/ngân hàng.

## D-S5-08 — Dashboard GMV (chủ dự án duyệt trực tiếp 2026-10-08)

- GET /api/v1/admin/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD: chỉ Admin ACTIVE, envelope 06, không thông tin khách/ngân hàng/mã booking.
- Hai ngày bắt buộc, tính cả ngày to theo Asia/Ho_Chi_Minh; tối đa 366 ngày. Sai ngày hoặc from > to trả 400.
- GMV gốc gồm phòng, vệ sinh, phí dịch vụ và thuế đã thanh toán thành công, theo lúc ghi nhận PAYMENT vào sổ. Không lấy cờ PAID hoặc đơn chưa trả làm bằng chứng tiền; chuyển thiếu/thừa/quá hạn chưa đối soát không tính.
- Nguồn finance_journals/finance_entries và price snapshot giống báo cáo Host; tiền VND nguyên dạng chuỗi để không mất độ chính xác khi cộng nhiều đơn. Hoa hồng ghi nhận riêng, GMV không phải doanh thu sàn.
- Hoàn đã duyệt và hoàn đã chuyển là hai dòng theo thời điểm ghi sổ của từng sự kiện trong kỳ. GMV trừ hoàn đã duyệt chỉ tham khảo, có thể âm nếu hoàn của kỳ trước.
- Khoản đã duyệt còn chờ chuyển là số dư nghĩa vụ hoàn hiện tại (không số dư lịch sử cuối kỳ), ghi nhãn rõ; không hồi tố GMV gốc.
- Số người dùng theo role/status là hiện tại; số tin theo status loại deletedAt khác null, số đã xóa mềm trả riêng. Không thay trạng thái tin để làm báo cáo.
- Test quyền/ngày/giờ VN/hoàn khác tháng/thiếu tiền/đối chiếu sổ bắt buộc.

## D-S5-09 — Hạ tầng nghiệm thu chưa có (2026-10-08)

Chủ dự án xác nhận chưa VPS, tên miền hoặc backup offsite. Tiếp tục code/config/test local; không tự deploy, không ghi deploy/SSL/offsite hoàn tất. Không có provider thật thì không tính kiểm thử gateway thật.

## S5-10 technical fix — restore sổ tiền (2026-10-08)

Test pg_dump/psql với PAYMENT có dữ liệu tái hiện CHECK(created_txid=txid_current()) thất bại khi restore. Đây là kiểm tra phụ thuộc transaction, không phải tính chất bất biến của dữ liệu lưu. Migration mới 20261008030000 thay chính xác tám CHECK dạng này bằng BEFORE INSERT trigger kiểm giá trị current transaction; không sửa migration cũ, lịch sử/txid đã lưu hoặc chính sách tiền. Các guard append-only, cân bằng, same-transaction source/entries, FK và unique giữ nguyên. Không dùng session_replication_role hoặc disable trigger. Cách phân biệt CHECK bất biến và kiểm tra insert bằng trigger theo [PostgreSQL 16 Constraints](https://www.postgresql.org/docs/16/ddl-constraints.html). Backup full schema/data của DB trống dựng lại trigger sau COPY theo pg_dump; restore data-only vào schema đang chạy không được hỗ trợ bằng cách bỏ guard.

## Chi tiết triển khai S5-03 theo mapping ban đã duyệt

GET /admin/users: page/limit, lọc role/status tùy chọn; chỉ id/tên/role/status/createdAt/updatedAt, không hash/token/contact/bank. Ban/unban body expectedStatus ACTIVE/BANNED và reason trim 1–500. Audit append-only, không sửa/xóa. Cập nhật status và tăng sessionVersion, thu hồi refresh token trong transaction; unban không khôi phục token cũ. Serialize các thao tác Admin để chống hai Admin khóa chéo. Phát thu hồi socket chỉ sau commit, Redis chuyển user UUID không thông tin cá nhân. Listing status không bị đổi khi ban; các public read kiểm Host ACTIVE, nên unban trả lại visibility theo trạng thái tin vốn có.

## Tiêu chí kiểm chứng theo chức năng

- Review: completed/không completed/sai khách/duplicate đồng thời/đầu vào sai/public PII; DB integration thật.
- Chat: đúng/sai thành viên, tự chat, retry và concurrency, persist trước emit, reconnect, tài khoản khóa; API + socket thật trên fixture riêng.
- Ban: sai vai trò, self/last Admin, ban/unban, token cũ và socket, public cache/detail/SEO; không thay lịch/sổ tiền.
- UI: desktop/mobile, lỗi/loading/empty, keyboard, không mock fallback khi API lỗi.
- Backup: restore DB riêng, dữ liệu và ràng buộc, checksum/failure cleanup; worker/phục hồi booking và ledger có dữ liệu cần kiểm riêng.
- Chỉ ghi DONE khi đủ bằng chứng; test fixture không được gọi là kiểm thử gateway hoặc production.

## Checkpoint UI S5-01 (2026-10-08)

Đã triển khai UI viết/đọc review của khách trên đơn COMPLETED và danh sách public ở chi tiết homestay theo D-S5-01; không thêm nghiệp vụ chỉnh/xóa/trả lời hoặc aggregateRating. Form không chọn điểm sẵn. Dùng API hiện có, không đổi Auth/token/booking/ledger. Bằng chứng và phân biệt fixture/DB thật ở `SPRINT5_PROGRESS_LOCAL.md`.

Hai câu hỏi dưới đây đã được trả lời sau checkpoint UI, xem D-S5-04/05/06:

1. Có giới hạn mở chat mới từ tin PUBLISHED của Host ACTIVE không; chat đã có được tiếp tục gửi khi tin ẩn hay chỉ đọc lịch sử?
2. Review đã đăng của khách bị khóa giữ công khai hay ẩn trong thời gian khóa?

Không áp dụng chính sách khác các quyết định đã chốt.

## Chi tiết kỹ thuật S5-03/08/09 sau triển khai (08/10/2026)

- S5-04 checkpoint 09/10/2026: đọc generation và COUNT trong cùng một câu SQL của snapshot RepeatableRead; truy vấn ID/order/distance giữ nguyên. Từ ba xuống hai raw SQL reads, kể cả trang rỗng vẫn có đúng total. Không thay API, DTO, migration, guard, TTL hoặc pool. Test quyền/publication và cache acknowledgement giữ nguyên.
- S5-LOCAL-HTTPS theo yêu cầu trực tiếp dùng PC làm server thử: reuse stack Docker test đã sở hữu, Nginx TLS/WSS cùng origin, certificate CA/leaf tạm 7 ngày riêng đúng IP; không trust store/firewall hoặc Internet mặc định. Loopback trước khi chốt LAN. Không mount CA private key, không publish DB/Redis/API/Next. Tài khoản/booking synthetic chỉ trong DB riêng, không giả thanh toán; setup/bằng chứng tại `LOCAL_HTTPS_TEST_SERVER.md`. Đây là lựa chọn kỹ thuật trong phạm vi vận hành/UAT, không hợp thức hóa deploy/SSL domain thật hoặc provider production.

- Các mapping Admin users/dashboard đã có REST/OpenAPI/BFF/UI. D-S5-08/09 là quyết định được chủ dự án duyệt, không còn câu hỏi mở. Trạng thái "chưa UI/ban" trong checkpoint cũ phía dưới là lịch sử.
- Search cache theo 03/04: L1 tối đa 128 query keys, TTL 60 giây; Redis TTL 60 giây. Mỗi hit đọc generation từ DB bằng cùng pool của Prisma, không cache generation theo TTL. Migration mới `20261008040000_public_search_cache_epoch` bump generation trong transaction khi tin/chi phí/ảnh/tiện ích/Host/danh mục thay đổi. Không đổi DTO/response/rate-limit; không thêm tracking.
- Cold search dùng snapshot RepeatableRead; query cũ không ghi cache vào generation sai nếu có write xen giữa. Request cùng key được gộp; malformed/outage cache quay về DB. Không dùng cache để bỏ kiểm trạng thái công khai hoặc Host ACTIVE.
- Frontend review/chat/Admin dùng client và session hiện có; access token vẫn memory, không token ở query URL. Socket chỉ hint để client đọc API, Redis không chứa nội dung chat. Ban/unban tăng version phiên, revoke refresh và phát thu hồi socket sau commit, kể cả đa instance.
- Preview ảnh Admin dùng gallery sẵn có, đúng thứ tự URL của từng bản, fallback ảnh lỗi/URL không hợp lệ, keyboard/swipe. Không biến fixture media thành dịch vụ upload đã hoạt động. Server ảnh thật vẫn DEFERRED theo yêu cầu chủ dự án.
- Không thêm business outbox cho chat hint, restore tin, kiểm duyệt review hoặc quản lý phí UI. Không tự deploy, bật backup định kỳ hay chọn offsite/gateway/SMS/Geoapify. Giới hạn và điều kiện mở lại giữ nguyên.
- S5-04 profiling/tuning 08/10/2026: `DATABASE_POOL_MAX` cấu hình cùng pg pool, mặc định 10, giới hạn 1–50 mỗi process. Không thêm pool riêng hoặc đổi lifetime dữ liệu/cache/epoch. Mức 20/40 chỉ thử trong DB UUID riêng; chưa thay cấu hình DB chính. Đây là lựa chọn kỹ thuật trong phạm vi tối ưu 03/04, không phải quyết định nghiệp vụ mới. Ngân sách kết nối và giới hạn nghiệm thu ghi ở `SPRINT5_OPERATIONS_LOCAL.md` / progress.
- S5-04 bổ sung 08/10/2026, 23:21: cache projection công khai theo ID, tối đa 256 record, TTL 60 giây, chỉ tái sử dụng trong đúng generation của snapshot DB. ID/filter/count/distance vẫn đọc SQL thật; không lấy khoảng cách từ cache của địa điểm tìm trước. Không chứa contact/token. Cache page/projection và Redis chỉ được ghi sau khi transaction đọc trả thành công; lỗi acknowledgement không công bố cache. Giữ nguyên DTO/envelope, guard, migration và pool mặc định. Đây là chi tiết kỹ thuật L1 theo 04, không phải nghiệp vụ mới.
- S5-UAT bổ sung: các browser case chat/Admin/review dùng đăng nhập UI thật với credential fixture trong DB UUID riêng, refresh HttpOnly, reload và logout thật. Không thay Auth sản phẩm. Booking COMPLETED/PAID vẫn là fixture DB; WebSocket bridge chỉ điều hướng transport từ URL build local sang API test, không chứng minh gateway hoặc mạng VPS thật. Test cũ dùng bootstrap Auth fixture vẫn là lịch sử, không đổi nhãn bằng chứng cũ.

## Checkpoint S5-02 (2026-10-08)

Đã triển khai DB/API/Socket theo D-S5-05/06/07 và OpenAPI, chưa UI chat. `canSend`/`readOnlyReason` là nguồn để frontend khóa ô nhập và hiển thị lý do, không tự đoán policy ở client. Main thêm migration chat mới, không seed message. Kết quả test riêng tại `SPRINT5_PROGRESS_LOCAL.md`.

Kiểm tra controller/service: Host không có endpoint restore tin xóa mềm; show/hide/edit loại deletedAt khác null. Không thêm restore trong phần chat. Không phân biệt Admin gỡ/Host xóa; không ngoại lệ booking hiệu lực; không kiểm duyệt/xóa review. Socket ban chủ động từ Admin là phần còn thiếu cùng endpoint ban/unban, hiện kiểm lại phiên trước join/send/delivery và chặn tài khoản khóa.
