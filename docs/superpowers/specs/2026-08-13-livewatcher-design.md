# LiveWatcher — Design Spec

**Ngày:** 2026-08-13
**Trạng thái:** Đã duyệt, sẵn sàng lập implementation plan

---

## 1. Mục tiêu

Tool desktop chạy nền, hiển thị ở menu bar (macOS) và system tray (Windows), liệt kê các local server đang chạy trên máy (`localhost:3000`, `localhost:5173`…). Tự khởi động cùng hệ điều hành.

Vấn đề cần giải: khi có nhiều dev server chạy song song, không có cách nhanh nào để biết cổng nào đang bận, ai đang giữ nó, và làm sao dừng nó mà không phải đi lục từng cửa sổ terminal.

**Tham chiếu giao diện:** layout dropdown kiểu CodexBar — panel frameless thả xuống dưới tray icon, dark theme, danh sách dòng gọn có action ẩn hiện khi hover.

## 2. Phạm vi

**Có trong bản này**
- Phát hiện cổng đang LISTEN trên cả hai OS
- HTTP probe làm giàu thông tin (status, `<title>`, framework hint)
- Lọc nhiễu theo luật kết hợp, tách nhóm "other ports"
- Mở trong browser, copy URL, dừng process (có rào chắn)
- Auto-start cùng hệ điều hành, bật/tắt được
- Đóng gói `.dmg` (macOS) và `.exe` (Windows)

**Không có trong bản này (YAGNI)**
- Notification khi server lên/xuống — dễ spam khi hot-reload; cân nhắc lại sau, mặc định tắt
- Theo dõi server ở máy remote
- Biểu đồ lịch sử, thống kê tài nguyên (CPU/RAM per process)
- Auto-update

## 3. Quyết định thiết kế

| # | Quyết định | Lý do |
|---|---|---|
| 1 | Quét cổng LISTEN + HTTP probe làm giàu | Thấy mọi server bất kể cách khởi động, mà vẫn hiện được tên dự án thay vì chỉ số cổng |
| 2 | Lọc: cổng thuộc dải dev **HOẶC** process thuộc danh sách dev | Bắt được nhiều nhất mà vẫn sạch; kèm mục "other" thu gọn nên không bao giờ mất dấu cổng lạ |
| 3 | Cho phép kill process, có rào chắn | Đúng nhu cầu chính (giành lại cổng 3000) nhưng là hành động phá huỷ nên cần chặn PID hệ thống + xác nhận |
| 4 | Electron | Một codebase cho cả hai OS, dùng đúng toolchain đã có sẵn trên máy (Node 24). Tauri nhẹ hơn nhưng phải cài Rust và viết lại logic quét bằng Rust |

**Đã cân nhắc và loại:** Tauri (chi phí setup Rust lớn hơn lợi ích ở giai đoạn này; logic scanner tách module nên port sau vẫn được), Swift + app Windows riêng (hai codebase, vi phạm yêu cầu cross-platform).

## 4. Kiến trúc

Toàn bộ logic nặng ở **main process**; renderer chỉ vẽ và gửi intent qua IPC.

```
src/
  main/
    index.js          app lifecycle, khởi tạo tray + poll loop
    scanner/
      index.js        dispatcher theo process.platform
      darwin.js       chạy lsof + export parse thuần
      win32.js        chạy netstat/tasklist + export parse thuần
    probe.js          HTTP enrich
    classify.js       luật lọc dev/other
    kill.js           dừng process có rào chắn
    store.js          settings JSON trong app.getPath('userData')
    tray.js           Tray icon + panel BrowserWindow
    ipc.js            cầu nối main ↔ renderer
  preload.js          contextBridge, whitelist API
  renderer/
    index.html
    panel.js
    panel.css
test/
  fixtures/           output lsof/netstat đã ghi sẵn
```

**Ranh giới quan trọng:** mỗi scanner tách đôi — phần *chạy shell* và phần *parse output*. Hàm parse là hàm thuần nhận string, trả `RawPort[]`. Đây là chỗ dễ sai nhất của tool (format `lsof`/`netstat` khác nhau giữa các phiên bản OS), nên phải test được bằng fixture mà không cần chạy shell thật.

**Bảo mật renderer:** `contextIsolation: true`, `nodeIntegration: false`, mọi API đi qua preload contextBridge với danh sách kênh IPC cố định.

## 5. Mô hình dữ liệu

```js
// scanner trả về
RawPort = { port, pid, processName, address }   // address: '127.0.0.1' | '0.0.0.0' | '::1'

// sau probe + classify
ServerEntry = {
  port, pid, processName,
  kind: 'http' | 'tcp',          // 'tcp' = không trả HTTP (Postgres, Redis…)
  httpStatus: number | null,
  title: string | null,          // <title> của trang
  framework: string | null,      // suy từ header: x-powered-by, x-nextjs-*, server…
  firstSeenAt: number,           // epoch ms, để tính uptime
  isDev: boolean
}
```

## 6. Luồng dữ liệu

Timer: **5 giây khi panel mở, 15 giây khi đóng** (tool chạy 24/7, cần tiết kiệm pin).

```
timer → scanner.listPorts()   → RawPort[]
      → dedupe theo port       (một process thường listen cả IPv4 lẫn IPv6)
      → probe song song ≤8     → thêm httpStatus, title, framework, kind
      → classify               → { dev: [], other: [] }
      → diff với snapshot trước
      → chỉ push IPC khi khác  → renderer vẽ lại
```

Probe: `GET http://127.0.0.1:PORT/`, timeout 1500ms, không follow redirect, chỉ đọc 8KB đầu để lấy `<title>` bằng regex. Không trả HTTP → `kind: 'tcp'`, **không** coi là lỗi.

`firstSeenAt` chỉ tính trong phiên chạy hiện tại; app restart thì uptime đếm lại từ đầu — không cố suy uptime thật của process.

## 7. Luật lọc (classify)

Một cổng vào nhóm **dev** nếu thoả **một trong hai**:

- **Dải cổng dev:** 1337, 3000–3999, 4000–4999, 5000–5999, 8000–8999, 9000–9999 (chỉnh được trong Settings)
- **Tên process dev:** `node`, `bun`, `deno`, `python`, `python3`, `ruby`, `java`, `php`, `dotnet`, `go`, `nginx`, `caddy`, `docker`, `com.docker.backend`

Còn lại vào nhóm **other**, hiện trong mục thu gọn ở cuối panel. Không bao giờ ẩn hoàn toàn.

## 8. Rào chắn kill

Phần duy nhất gây thiệt hại thật. **Từ chối** nếu bất kỳ điều nào đúng:

- `pid < 500` (process hệ thống)
- Chủ sở hữu process không phải user hiện tại — macOS kiểm bằng `ps -o uid= -p PID` so với `process.getuid()`; Windows không có `getuid()` nên bỏ qua bước này và dựa vào `process.kill` trả EPERM
- Tên process thuộc denylist: `launchd`, `mDNSResponder`, `rapportd`, `ControlCenter`, `sharingd`, `com.docker.backend`

Nếu qua: hộp thoại xác nhận ghi rõ **cổng + tên process + PID** → `SIGTERM` → chờ 3 giây → nếu còn sống mới hỏi `SIGKILL`. Thất bại (EPERM) thì hiện lý do cụ thể, không im lặng.

## 9. Giao diện

Panel frameless rộng 360px, thả dưới tray icon, tự ẩn khi mất focus.

```
┌──────────────────────────────────┐
│ LiveWatcher          4 live  ⟳ ⚙ │
├──────────────────────────────────┤
│ ● localhost:3000          2h 14m │
│   PorfolioWebsite · Next.js      │
│                    ↗  ⧉  ■       │  ← hover: mở / copy / dừng
│ ● localhost:5173            34m  │
│   Vite · node (pid 8823)         │
│ ◐ localhost:5432             —   │  ← amber: TCP không phải HTTP
│   postgres (pid 601)             │
├──────────────────────────────────┤
│ › Other listening ports (7)      │
├──────────────────────────────────┤
│ Launch at login          [ on ]  │
│ Settings              Quit  ⌘Q   │
└──────────────────────────────────┘
```

Trạng thái chấm: **xanh** = HTTP 2xx/3xx, **amber** = TCP hoặc HTTP 4xx/5xx, **xám** = đang probe.

Dark theme mặc định, tự đổi theo hệ thống qua `nativeTheme`. Không dùng thư viện UI ngoài (rule workspace). Không animation quá 300ms.

## 10. Auto-start & đóng gói

`app.setLoginItemSettings({ openAtLogin, openAsHidden: true })` — Electron hỗ trợ sẵn cả macOS lẫn Windows, không cần thư viện thứ ba. Toggle ngay trong panel, lưu vào `store.js`.

Đóng gói `electron-builder`: `.dmg` (macOS, arm64) và NSIS `.exe` (Windows x64). macOS đặt `LSUIElement: true` để app không hiện trong Dock.

**Dependency toàn bộ:** `electron`, `electron-builder`. Test dùng `node --test` có sẵn trong Node 24.

## 11. Xử lý lỗi

| Tình huống | Xử lý |
|---|---|
| `lsof`/`netstat` không tồn tại hoặc chết | Banner lỗi trong panel, **giữ nguyên danh sách cũ** thay vì xoá trắng |
| Probe timeout | Bình thường, đánh dấu `kind: 'tcp'`, không phải lỗi |
| Kill thất bại (EPERM) | Hiện lý do cụ thể trong panel |
| Parse trả mảng rỗng bất thường | Giữ snapshot cũ, log nội bộ, thử lại chu kỳ sau |

## 12. Kiểm thử & tiêu chí hoàn thành

**Unit test (node --test):**
- `scanner/darwin.js` parse đúng fixture `lsof` thật đã ghi sẵn, gồm cả dòng IPv6 và process có khoảng trắng trong tên
- `scanner/win32.js` parse đúng fixture `netstat -ano` + `tasklist`
- `classify.js`: cổng trong dải → dev; process trong danh sách nhưng cổng lạ → dev; cả hai đều không → other
- `kill.js`: từ chối đúng với PID < 500, process denylist, process khác chủ sở hữu

**Smoke test thủ công:** chạy `python3 -m http.server 8000` → cổng phải hiện trong ≤15 giây; tắt server → phải biến mất trong ≤15 giây; bấm dừng một dev server thật → process chết và dòng biến mất.

**"Xong" nghĩa là:** toàn bộ unit test pass, smoke test trên macOS pass, app đóng gói `.dmg` chạy được và tự khởi động sau khi reboot.

## 13. Ghi chú triển khai

Bản đầu ưu tiên macOS. `scanner/win32.js` vẫn viết đầy đủ kèm fixture test, nhưng **chưa verify trên máy Windows thật** — đánh dấu là việc còn treo cho tới khi có máy kiểm chứng.
