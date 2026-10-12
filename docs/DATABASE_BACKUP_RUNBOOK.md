# Sao lưu và khôi phục PostgreSQL local

Phạm vi local đã kiểm chứng bổ sung ngày 08/10/2026: schema Auth/danh mục/tin, booking có dữ liệu, inventory exclusion, sổ tiền append-only/cân bằng và GMV, review/chat/audit sau pg_dump/psql restore. Worker BullMQ mới đã kiểm phục hồi hai nhánh giữ phòng/chờ Host quá hạn từ DB restored, không có job Redis cũ; nhả inventory và không tự thanh toán. Không có lịch chạy tự động, retention, upload offsite hay triển khai production được bật bởi tài liệu này. Số bảng/migration và lượt chạy chính xác nằm ở `SPRINT5_PROGRESS_LOCAL.md`.

## Công cụ và cấu hình

Script `backend/scripts/backup-database.sh` chạy trên Linux với Bash, PostgreSQL client 16, gzip, GNU coreutils. Đã kiểm chứng bằng công cụ trong image PostGIS 16 đang dùng. Không có dependency npm mới. Windows có thể chạy script trong container PostGIS cách ly; test bên dưới dùng Docker từ PowerShell.

Đặt `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` theo database muốn sao lưu. `PGDATABASE` là tên DB, không phải connection URL. Dùng `PGPASSFILE` trỏ tới file mật khẩu riêng, quyền `0600`; không truyền password trong argv hoặc đưa vào log. Không bật `set -x`. Script dùng `--no-password` để thiếu credential sẽ thất bại thay vì chờ nhập.

Ví dụ Linux, sau khi đã cấu hình kết nối/credential ở môi trường riêng:

```bash
bash backend/scripts/backup-database.sh /path/to/private-backups
```

Kết quả thành công là đường dẫn thư mục gồm `database.sql.gz` và `SHA256SUMS`. Tên dùng UTC để không nhập nhằng thời điểm. Thư mục/file mới có quyền `0700`/`0600`. Script ghi vào thư mục `.partial-*`, kiểm tra gzip/checksum và đổi tên trong cùng thư mục sau khi hoàn tất. `pg_dump`, nén, checksum hoặc cảnh báo thất bại đều không công bố bản sao hoàn tất. `SIGKILL`/mất điện có thể để lại `.partial-*`; không dùng nó để restore. Kết nối mặc định timeout 10 giây, chờ lock tối đa 30 giây; `PGCONNECT_TIMEOUT` có thể cấu hình riêng.

Script không tự xóa bản sao cũ. Cần chủ dự án chốt timezone/lịch 02:00, retention, nơi offsite, mã hóa/quyền truy cập, cảnh báo thất bại, RPO/RTO và người quản lý credential trước khi cấu hình vận hành. Upload chỉ thành công khi đối chiếu checksum tại đích; file local không chứng minh đã sao lưu offsite.

## Thử restore vào DB mới

Chỉ dùng bản sao từ nguồn tin cậy. `pg_dump` sao lưu một database; role/tablespace của cluster không nằm trong bản sao này. Máy đích cần PostGIS/uuid-ossp tương thích và các role cần thiết; không tự đổi owner/ACL để che lỗi restore.

Sau khi chọn thư mục backup và cấu hình kết nối tới PostGIS test riêng:

```bash
backup_dir=/path/to/private-backups/selected-backup
(cd "$backup_dir" && sha256sum -c SHA256SUMS)
gzip -t "$backup_dir/database.sql.gz"
restore_db="trotot_restore_test_$(node -p "require('node:crypto').randomUUID().replaceAll('-', '')")"
createdb --no-password --template=template0 "$restore_db"
set -o pipefail
gzip -dc "$backup_dir/database.sql.gz" |
  PGDATABASE="$restore_db" psql --no-password --single-transaction --set ON_ERROR_STOP=on
```

Không thêm `--clean`, không restore đè DB đang vận hành. Nếu restore lỗi, transaction rollback; giữ DB test để điều tra hoặc dọn đúng DB test đã tạo. Kiểm tra migration records, row counts/content, foreign keys, tổng số dư và dữ liệu ứng dụng trước khi sử dụng. Migration mới `20261008030000_restore_safe_finance_txid` chuyển kiểm current transaction từ CHECK sang BEFORE INSERT trigger, giữ txid lịch sử và các guard append-only/balance. Dùng full schema/data dump vào DB trống, không data-only restore vào schema đang chạy và không disable trigger để né lỗi. Worker expiry đã có bằng chứng local ở hai nhánh; không thay cho thử payment provider retry hoặc rehearsal trên cluster/máy bàn giao khác.

## Test tự động, có guard hạ tầng cách ly

Hai script yêu cầu `.env` ở thư mục gốc của **bản source test riêng**, `NODE_ENV=test`, PostGIS loopback có quyền tạo DB, và container Docker mang nhãn project test. Không chạy với `.env` ứng dụng chính. `backup.integration.mjs` chỉ tạo/drop DB `trotot_backup_test_<uuid>` và `trotot_restore_test_<uuid>`, dọn file `/tmp/trotot-backup-test-<uuid>`; không xóa volume. Runtime restart chỉ chấp nhận DB `trotot_clean_test_<uuid>` và hai container của project test đã xác minh; nó thêm rồi dọn fixture trong DB đó.

Từ `backend/` của bản test riêng, PowerShell:

```powershell
$env:BACKUP_TEST_CONTAINER='trotot-s345-<12-hex-id>-postgres-1'
npm run test:backup:integration
$env:RUNTIME_TEST_PROJECT='trotot-s345-<12-hex-id>'
npm run test:runtime:restart
```

ID phải là project test thực do người chạy tạo; script đối chiếu Docker label và port, không chỉ tin tên. Test backup kiểm nội dung toàn bộ bảng public/migration, relations, wallet fixture, FK, permissions, thiếu config, DB không tồn tại, cảnh báo dump, lỗi gzip/checksum/ghi, `/dev/full` mô phỏng ENOSPC, cleanup và corruption. Lỗi checksum cố ý in warning rồi test vẫn PASS khi phát hiện đúng. `/dev/full` không phải làm đầy đĩa vật lý.

Runtime test chạy API từ build mới trên port tạm, restart đúng hai container test, kiểm readiness, PostGIS/Redis AOF persistence và lỗi env/mock OTP production. Nó không kiểm app/worker trong Linux container, deploy, provider hay dữ liệu tài chính thật.

Checkpoint restore 08/10/2026: chạy `npm run build` backend trước test. `test/backup-fixtures.ts` khởi tạo Nest từ `dist/app.module.js` để dùng metadata decorator đã compile (không dùng TSX làm runtime Nest), không mở cổng HTTP; DB là UUID restored đã có guard cổng 58491, Redis 58492 với namespace riêng. Không có job cũ: startup recovery tìm hai đơn quá hạn, chuyển đúng CANCELLED_TIMEOUT/CANCELLED_HOST_TIMEOUT, tăng version, nhả lịch trong DB; thử giữ lại đúng đêm đã nhả. Không tự PAID/CONFIRMED. GMV và hai journal đã thanh toán vẫn giữ nguyên. Application/worker được đóng và chỉ namespace test được dọn. Đây là phục hồi logical dump sang DB mới trong cùng cluster test; cluster/VPS bàn giao khác và payment gateway retry chưa kiểm.

Tham chiếu chính thức: [pg_dump 16](https://www.postgresql.org/docs/16/app-pgdump.html), [psql 16](https://www.postgresql.org/docs/16/app-psql.html), [libpq environment](https://www.postgresql.org/docs/16/libpq-envars.html).
