# Bot Thu Chi Team 05

Bot Zalo tự động ghi nhận thu chi: thành viên gửi ảnh hoá đơn vào nhóm và tag bot → bot đọc ảnh bằng OpenAI Vision (gpt-4o-mini) → ghi dữ liệu vào Google Sheet.

## Luồng hoạt động

1. Thành viên gửi ảnh hoá đơn vào nhóm Zalo Team 05, kèm theo **bất kỳ chữ gì** trong CÙNG 1 tin nhắn (ví dụ gõ `chi ăn trưa` rồi đính kèm ảnh, gửi chung 1 lần). Không bắt buộc phải gõ đúng tên bot.
2. Bot xử lý ngay khi nhận được.

### Vì sao bắt buộc phải kèm chữ, và vì sao không hỗ trợ "gửi ảnh trước, tag sau"?

Đã kiểm thử thực tế và xác nhận: **Zalo Bot Platform không đẩy sự kiện ảnh (`message.image.received`) qua `getUpdates` nếu ảnh gửi không kèm theo chữ nào** — ảnh gửi trơn (không caption) sẽ không bao giờ tới được bot, dù gửi trong nhóm hay riêng. Đây là giới hạn của nền tảng (Beta), không phải lỗi code.

Vì vậy:
- Không thể làm luồng "gửi ảnh trước, gửi tag ở 1 tin nhắn riêng sau đó" — vì bot sẽ không hề biết có ảnh nào được gửi cho tới khi có chữ đi kèm.
- Vì ảnh luôn bắt buộc phải có chữ đi kèm để tới được bot, nên bot không yêu cầu chữ đó phải đúng là tên bot nữa — gõ gì cũng được, miễn có nội dung.
- Nếu ai đó tag bot bằng 1 tin nhắn text thuần (không kèm ảnh), bot sẽ trả lời nhắc lại cách dùng đúng.

Cả 2 cách đều xử lý giống nhau ở bước sau:
1. Server liên tục hỏi Zalo (polling qua API `getUpdates`) xem có tin nhắn mới không.
2. Khi ghép được đủ ảnh + tag, server tải ảnh về, gửi cho OpenAI (gpt-4o-mini) để đọc và trích xuất: số tiền, ngày, đơn vị, nội dung, thu/chi.
3. Server ghi một dòng mới vào Google Sheet.
4. Bot trả lời xác nhận trong nhóm.

### Vì sao dùng Polling thay vì Webhook?

Ban đầu bot được xây dựng theo cơ chế Webhook (theo khuyến nghị của Zalo cho môi trường production). Tuy nhiên qua kiểm thử thực tế, đã xác nhận: **Zalo không đẩy được sự kiện `message.*.received` qua Webhook cho tin nhắn nhóm ở thời điểm hiện tại** (dù đăng ký webhook thành công và được chính Zalo xác minh phản hồi `200 OK`), trong khi API `getUpdates` (long-polling) vẫn nhận đúng tin nhắn. Đây nhiều khả năng là giới hạn của tính năng chat nhóm đang ở bản **Beta**.

Vì vậy code hiện dùng polling làm cơ chế chính để đảm bảo hoạt động đúng ngay bây giờ. Nếu sau này Zalo khắc phục webhook cho nhóm, có thể cân nhắc chuyển lại (code webhook cũ có thể khôi phục dễ dàng nếu cần — hỏi lại nếu muốn làm việc này).

## Cấu trúc Google Sheet

| Cột | Ý nghĩa |
|---|---|
| Thời gian ghi nhận | Thời điểm bot xử lý (giờ VN) |
| Người gửi | Tên hiển thị Zalo của người gửi bill |
| Loại (Thu/Chi) | Thu hoặc Chi |
| Số tiền (VNĐ) | Số tiền đọc được từ hoá đơn |
| Nội dung | Tóm tắt nội dung |
| Đơn vị/Merchant | Tên cửa hàng/đơn vị trên hoá đơn |
| Ngày trên hoá đơn | Ngày ghi trên hoá đơn (nếu đọc được) |
| Link ảnh hoá đơn | Link ảnh gốc để đối chiếu |
| Độ tin cậy OCR | high/medium/low — để biết dòng nào cần kiểm tra tay |
| Message ID | Dùng để chống ghi trùng |

Sheet sẽ tự tạo dòng tiêu đề khi bot ghi dòng dữ liệu đầu tiên, không cần tạo tay.

---

## Bước 1 — Tạo Zalo Bot

1. Mở Zalo → tìm OA **Zalo Bot Manager** → chọn **Tạo bot**.
2. Đặt tên bot bắt đầu bằng "Bot", ví dụ: `Bot Thu Chi Team 05`.
3. Sau khi tạo, Zalo sẽ nhắn cho bạn **Bot Token** — lưu lại, dùng cho `BOT_TOKEN` ở Bước 4.

## Bước 2 — Tạo Google Sheet + Service Account

1. Tạo một Google Sheet mới (đặt tên gì cũng được), copy `GOOGLE_SHEET_ID` từ URL:
   `https://docs.google.com/spreadsheets/d/<GOOGLE_SHEET_ID>/edit`
2. Vào [Google Cloud Console](https://console.cloud.google.com/) → tạo project mới (hoặc dùng project có sẵn).
3. Bật **Google Sheets API** cho project đó (APIs & Services → Enable APIs → tìm "Google Sheets API").
4. Tạo **Service Account** (IAM & Admin → Service Accounts → Create Service Account).
5. Vào service account vừa tạo → tab **Keys** → **Add Key** → **Create new key** → chọn **JSON** → tải file JSON về.
   - Nếu gặp lỗi "Service account key creation is disabled": vào **IAM & Admin → Organization Policies**, tìm 2 constraint `Disable service account key creation` (cả bản Legacy và Managed), Override parent's policy → thêm rule → Enforcement **Off** cho từng cái, đợi vài phút rồi thử lại. Nếu vẫn bị chặn (do chính sách tổ chức công ty), tạo project bằng Gmail cá nhân thay vì email công ty.
6. Mở file JSON, copy toàn bộ nội dung, dán thành 1 dòng vào biến `GOOGLE_SERVICE_ACCOUNT_JSON` trong `.env`.
7. Mở lại Google Sheet đã tạo ở bước 1 → bấm **Share** → thêm email của service account (dạng `xxx@xxx.iam.gserviceaccount.com`, có trong file JSON, field `client_email`) → cấp quyền **Editor**.

## Bước 3 — Lấy OpenAI API Key

Vào [OpenAI Platform](https://platform.openai.com/api-keys) → **Create new secret key** → tạo key mới, dùng cho `OPENAI_API_KEY`. Nhớ vào **Billing** thêm phương thức thanh toán, nếu không key sẽ báo lỗi khi bot gọi API.

## Bước 4 — Cấu hình project

```bash
cd bot-thu-chi-team05
npm install
cp .env.example .env
```

Điền vào `.env`:
- `BOT_TOKEN` — lấy ở Bước 1
- `OPENAI_API_KEY` — lấy ở Bước 3
- `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` — lấy ở Bước 2
- `BOT_MENTION_KEYWORDS` — để trống là dùng mặc định (đã khớp sẵn với tên "Bot Thu - Chi Team 05")

## Bước 5 — Gỡ Webhook cũ (nếu trước đó đã từng set)

Polling (`getUpdates`) và Webhook không thể dùng đồng thời. Nếu trước đó bạn đã từng chạy `set-webhook`, cần gỡ đi:

```bash
npm run remove-webhook
```

## Bước 6 — Deploy server (dùng Render, miễn phí)

1. Đẩy code lên GitHub repo riêng (`git add . && git commit -m "..." && git push`).
2. Vào [Render](https://render.com/) → **New** → **Web Service** → chọn repo.
3. Cấu hình: Build Command `npm install`, Start Command `npm start`, Instance Type **Free**.
4. Vào tab **Environment** → thêm toàn bộ biến trong `.env`.
5. Bấm **Create Web Service**, đợi deploy xong, trạng thái chuyển **Live**.

### Quan trọng: giữ cho server không bị "ngủ"

Vì bot dùng polling (vòng lặp chạy liên tục trong app, không đợi request đến), nhưng Render **free tier vẫn tự tắt server sau ~15 phút không có traffic HTTP đến** — điều này sẽ làm dừng luôn vòng lặp polling. Cần một dịch vụ ping định kỳ để giữ server "thức":

1. Đăng ký free tại [UptimeRobot](https://uptimerobot.com/) (hoặc [cron-job.org](https://cron-job.org/)).
2. Tạo 1 monitor mới, loại **HTTP(s)**, URL = `https://<tên-service-render-của-bạn>.onrender.com/`, tần suất **5 phút/lần**.
3. Lưu lại. Từ giờ mỗi 5 phút sẽ có 1 request giữ server luôn hoạt động → vòng lặp polling không bị gián đoạn.

## Bước 7 — Thêm bot vào nhóm & test

1. Thêm bot vào nhóm Zalo Team 05.
2. Gửi 1 ảnh hoá đơn vào nhóm, kèm theo bất kỳ chữ gì trong CÙNG 1 tin nhắn (ví dụ: `chi ăn trưa`). **Lưu ý:** phải đính kèm ảnh và gõ chữ trong cùng 1 lần gửi — ảnh gửi riêng không kèm chữ sẽ không tới được bot (giới hạn của nền tảng Zalo, xem phần "Luồng hoạt động" ở trên).
3. Đợi vài giây → xem log server (Render → Logs) để kiểm tra dòng `[handler] event=message.image.received ...`.
4. Kiểm tra Google Sheet đã có dòng mới chưa, và bot có trả lời xác nhận trong nhóm không.

Nếu ai đó tag bot bằng 1 tin nhắn text thuần (không kèm ảnh), bot sẽ tự trả lời nhắc lại cách dùng đúng — không cần chỉnh gì thêm. Biến `BOT_MENTION_KEYWORDS` trong `.env`/Render Environment chỉ còn dùng để nhận diện tin nhắn text kiểu này, không ảnh hưởng đến việc xử lý ảnh.

## Giới hạn hiện tại

- Chống trùng tin nhắn (`processedMessageIds`) chỉ lưu trong bộ nhớ — nếu server restart, có thể xử lý trùng nếu Zalo trả lại cùng message. Với nhóm nhỏ, rủi ro thấp.
- `gpt-4o-mini` đọc số tiền tốt với hoá đơn rõ nét; hoá đơn mờ/viết tay có thể cho `confidence: "low"` hoặc đọc sai số — bot sẽ nhắc trong tin nhắn trả lời để kiểm tra tay. Có thể đổi `OPENAI_MODEL=gpt-4o` để tăng độ chính xác (chi phí cao hơn).
- Chi phí vận hành: OpenAI API tính theo lượt gọi (mỗi ảnh ~1 lượt).
- Cơ chế polling đang là giải pháp thay thế tạm thời cho lỗi Webhook nhóm hiện tại của Zalo Bot Platform — nếu muốn báo lỗi này cho Zalo, có thể nhắn qua OA **Zalo Bot Manager**, cung cấp: đã `setWebhook` thành công (`webhook.ok`, 200), nhưng không nhận được event `message.*.received` nào cho tin nhắn nhóm/riêng dù `getUpdates` xác nhận có tin nhắn.
