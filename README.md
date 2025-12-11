# CalendarBot Frontend

CalendarBot là giao diện web giàu tương tác cho một trợ lý lịch thông minh. Ứng dụng được thiết kế để kết nối tới API calendar backend (REST + SignalR) nhằm trò chuyện, duyệt/gỡ/cập nhật sự kiện, quản lý danh bạ và liên kết nhiều tài khoản OAuth trong một trải nghiệm giống chatbot.

## Tính năng nổi bật

- **Đăng nhập/đăng ký + OTP**: màn hình riêng tại `Partials/login.html` và `Partials/register.html`, hỗ trợ gửi lại OTP, đếm ngược và xác thực trước khi chuyển hướng vào ứng dụng chính.
- **Chat realtime qua SignalR**: `JS/script.js` khởi tạo Hub connection, gửi prompt, nhận preview (create/update/delete) và dựng các modal xác nhận (`Partials/confirm-*.html`, `Partials/update-preview.html`).
- **Quản lý tài khoản**: dropdown tài khoản đọc từ `GET /User/Refresh`, thêm tài khoản qua flow OAuth popup (`/OAuth`), đồng bộ avatar/label và tự refresh token (`/OAuth/Refresh`).
- **Danh bạ và sidebar**: sidebar contact đồng bộ với API `/Contacts` (GET/POST/DELETE), modal thêm nhiều contact cùng lúc, validation email và hiển thị thông báo lỗi thân thiện.
- **Trải nghiệm người dùng**: theme tối/sáng, giữ phím Space hoặc giữ nút micro để nhập liệu giọng nói, double-click nút micro để xoá lịch sử chat, auto-gửi câu "ngày hôm nay có lịch gì không" khi vào trang, và highlight code block bằng Highlight.js.
- **Thông báo nhắc việc**: backend có thể bắn `CalendarEventReminder`, client hiển thị thông điệp định dạng giờ địa phương.

## Công nghệ chính

- HTML/CSS thuần (UI trong `index.html`, SCSS-like styling trong `CSS/style.css` và `CSS/auth.css`).
- JavaScript ES Modules với templating thủ công từ thư mục `Partials/`.
- [SignalR browser client](https://learn.microsoft.com/aspnet/core/signalr/) (CDN) cho realtime.
- [marked](https://marked.js.org) + [highlight.js](https://highlightjs.org/) để render markdown / code block.
- Web Speech API cho voice-to-text.

## Cấu trúc thư mục

```
.
├── index.html                  # Giao diện chính CalendarBot
├── JS/
│   ├── script.js               # Chat UI, SignalR, contacts, theme, voice, auto question
│   ├── auth.js                 # Luồng auth + OTP
│   ├── config.js               # API_URL cấu hình backend
│   ├── LoginResponse.js        # DTO helpers cho auth response
│   └── contact.js              # (để trống, dự phòng mở rộng)
├── CSS/
│   ├── style.css               # Toàn bộ styling cho app chính + modal
│   └── auth.css                # Styling cho login/register/OTP modal
├── Partials/                   # Template HTML được nạp động (message, modal, v.v.)
├── data/accounts.json          # Dữ liệu tài khoản mẫu (không còn dùng khi đã kết nối API)
├── websocket-test.js           # Ví dụ client Node.js dùng @microsoft/signalr
└── Test OAuth Server/Server/   # Mẫu ASP.NET Core host cho flow OAuth thử nghiệm
```

## Thiết lập & chạy

1. **Chuẩn bị backend**: CalendarBot cần một API đang chạy với các endpoint REST + SignalR hub tương thích.
   - Mặc định `API_URL` trỏ tới `https://localhost:7127/api` (xem `JS/config.js`).
   - Nếu backend chạy port/host khác, sửa `export const API_URL = "..."` trước khi build/runtime.
2. **Phục vụ frontend**:
   - Cách nhanh nhất là mở trực tiếp `index.html` bằng VS Code Live Server hoặc `npx serve .` rồi truy cập `http://localhost:3000`.
   - Hãy chắc chắn trình duyệt cho phép microphone (để dùng voice) và popup (để mở cửa sổ OAuth).
3. **Luồng đăng nhập**:
   - Mở `Partials/register.html` để đăng ký, nhập OTP được backend gửi (UI modal nằm trong cùng file).
   - Sau khi đăng ký thành công, chuyển sang `Partials/login.html`, đăng nhập và hệ thống lưu `sessionToken` + `userId` trong `sessionStorage`.
   - Khi vào `index.html`, script sẽ kiểm tra `sessionToken`. Nếu thiếu/expired sẽ redirect về login.
4. **Kết nối SignalR**:
   - `script.js` gọi `POST /api/ws` để lấy URL hub động; nếu thất bại sẽ fallback về `${API_URL}/../hubs/notifications`.
   - Trình duyệt cần tải script CDN `@microsoft/signalr@7.0.5` (đã khai báo cuối `index.html`).
5. **Danh bạ & tài khoản**:
   - Nút "Thêm danh bạ" mở modal `#contactsModal`. Sau khi nhập danh sách email, client gửi POST `/Contacts` với mảng `{ email, name }`.
   - Dropdown accounts hiển thị danh sách provider từ `loginInfo.data.user.authProviders`. Nút "+ Add account" mở `/OAuth` trong popup và chờ postMessage `oauth-success` để refresh UI.

## Các endpoint backend đang sử dụng

| Mục đích               | HTTP                                         | Đường dẫn                                               |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------- |
| Login                  | POST                                         | `/Auth/login`                                           |
| Register               | POST                                         | `/Auth/register`                                        |
| Gửi OTP                | POST                                         | `/Auth/SendOTP`                                         |
| Xác thực OTP           | POST                                         | `/Auth/VerifyOTP`                                       |
| Logout                 | POST                                         | `/Auth/logout?sessionToken=...`                         |
| Làm mới thông tin user | GET                                          | `/User/Refresh?sessionToken=...`                        |
| Danh sách liên hệ      | GET                                          | `/Contacts?sessionToken=...&search=&page=1&pageSize=20` |
| Tạo liên hệ hàng loạt  | POST                                         | `/Contacts?sessionToken=...`                            |
| Xóa liên hệ            | DELETE                                       | `/Contacts/{id}?sessionToken=...`                       |
| Lấy URL OAuth          | GET                                          | `/OAuth?sessionToken=...`                               |
| Làm mới OAuth          | GET                                          | `/OAuth/Refresh?SessionToken=...&providerUserId=...`    |
| Lấy URL SignalR        | POST                                         | `/ws` (body: sessionToken)                              |
| Hub method             | `ProcessMessage`, `ConfirmOperation`, `Echo` |

> **Lưu ý**: Client mong đợi responses JSON dạng `{ success, message, data }` giống `LoginResponse`. Nếu backend trả cấu trúc khác cần cập nhật parser tương ứng.

## Websocket test client

`websocket-test.js` là ví dụ Node.js dùng `@microsoft/signalr` và `uuid`:

```bash
npm install @microsoft/signalr uuid
node websocket-test.js
```

Script đọc `sessionToken` từ `sessionStorage` (trong browser). Khi dùng Node bạn cần thay thế bằng token thật (ví dụ hard-code hoặc đọc file `.env`).

## Test OAuth Server mẫu

Thư mục `Test OAuth Server/Server` chứa cấu hình ASP.NET Core minimal để giả lập OAuth server:

- `appsettings.json` khai báo `OAuthSettings` với `ClientId`, `ClientSecret`, `TokenEndpoint`.
- `web.config` cấu hình hosting IIS Express/Kestrel.
  Bạn có thể dùng dự án này để mock quy trình liên kết tài khoản trước khi tích hợp với provider thật.

## Template & assets

- Các template chat/modal nằm trong `Partials/*.html`. `loadTemplate(path)` tải file, thay thế `{{placeholder}}` bằng dữ liệu runtime.
- Ảnh đại diện tạm thời đặt trong `Picture/`.
- Nếu muốn thêm template mới, chỉ cần đặt file vào `Partials/` và gọi `loadTemplate('Partials/<file>.html', data)`.

## Ghi chú phát triển

- **Voice input**: giữ Space hoặc giữ nút micro để ghi âm. Thả ra để gửi prompt.
- **Auto logout**: `script.js` tự lên lịch logout sau 24h dựa trên `sessionLoginAt` trong `sessionStorage`.
- **Auto hỏi**: sau khi vào trang, client thử gửi prompt mặc định tối đa 5 lần cho tới khi kết nối SignalR thành công.
- **Error handling**: mọi lỗi WS/REST sẽ được hiển thị trong bong bóng chat incoming với class `message--error`.
- **Styling**: `CSS/style.css` ~2k dòng, bao gồm cả modal confirm-delete/update-preview và sidebar responsive. Khi chỉnh sửa nên bật VS Code "Format on Save" để tránh phá layout.

## Định hướng mở rộng

- Thêm unit test cho luồng xử lý preview (`showUpdatePreviewModal`, `normalizeExecutionPayload`, ...).
- Bổ sung cơ chế cache danh bạ nội bộ để giảm số lần gọi API khi thêm/xóa.
- Cho phép đổi ngôn ngữ UI (hiện tại hard-code tiếng Việt/Anh lẫn lộn).

Chúc bạn làm việc hiệu quả với CalendarBot!
