# 🚀 HỆ THỐNG DISCORD LXC VPS MANAGER BOT (V2.0)

> **Enterprise Production-Ready Linux Infrastructure Platform**  
> Quản lý, khởi tạo, theo dõi và cài lại VPS LXC trực tiếp qua Discord với giao diện Interactive Embeds, Buttons, Select Menus, Modals và cơ sở dữ liệu PostgreSQL.

---

## 📑 MỤC LỤC
1. [Kiến trúc hệ thống](#-kiến-trúc-hệ-thống)
2. [Nguyên tắc phân quyền nghiêm ngặt](#-nguyên-tắc-phân-quyền-nghiêm-ngặt)
3. [Yêu cầu hệ thống máy chủ (Debian 13)](#-yêu-cầu-hệ-thống-máy-chủ-debian-13)
4. [Hướng dẫn cài đặt nhanh](#-hướng-dẫn-cài-đặt-nhanh)
5. [Cấu hình môi trường (.env)](#-cấu-hình-môi-trường-env)
6. [Quản lý tiến trình bằng systemd](#-quản-lý-tiến-trình-bằng-systemd)
7. [Danh sách toàn bộ lệnh (Slash Commands `/`)](#-danh-sách-toàn-bộ-lệnh-slash-commands-)
8. [Tích hợp Terminal SSHX & Bảo mật](#-tích-hợp-terminal-sshx--bảo-mật)
9. [Cơ chế Reinstall OS (Cài lại VPS)](#-cơ-chế-reinstall-os-cài-lại-vps)
10. [Remote LXC Node Mode (Chế độ đa node)](#-remote-lxc-node-mode-chế-độ-đa-node)
11. [Sao lưu & Phục hồi (Backup & Disaster Recovery)](#-sao-lưu--phục-hồi-backup--disaster-recovery)
12. [Xử lý lỗi thường gặp (Troubleshooting)](#-xử-lý-lỗi-thường-gặp-troubleshooting)

---

## 🏗️ KIẾN TRÚC HỆ THỐNG

```
[ Discord Client ] 
        │
        ▼ (Gateway WebSocket / Interactions)
┌────────────────────────────────────────────────────────┐
│                   DISCORD BOT CORE                     │
│  - Slash & Interaction Handlers (/create, /manage)    │
│  - State Machine & Concurrency Locks (JobQueue)        │
│  - PostgreSQL Pool & Data Repositories                 │
│  - Background Crash & Health Monitoring Daemon         │
└────────────────────────────────────────────────────────┘
        │
        │ HTTP REST API (Bearer Token Auth)
        ▼
┌────────────────────────────────────────────────────────┐
│                   VPS NODE AGENT                       │
│  - Host Compatibility Validator (cgroup v2, virt check)│
│  - Real LXC Engine (lxc-create, cgroup2, memory, cpu)  │
│  - Network & NAT Engine (iptables, dnsmasq, lxcbr0)    │
│  - SSHX Terminal Supervisor & Token Hasher             │
│  - Backup & Rootfs Extraction Engine (SHA-256)         │
└────────────────────────────────────────────────────────┘
        │
        ▼
[ Linux Kernel Cgroup v2 / LXC Containers (Debian, Ubuntu, Alpine) ]
```

---

## 🗄️ TOÀN BỘ DỮ LIỆU LƯU TRỮ 100% CỤC BỘ TRÊN MÁY CHỦ VPS

Hệ thống được thiết kế theo tiêu chuẩn **On-Premise / Self-Contained**, cam kết **tuyệt đối không phụ thuộc vào bất kỳ dịch vụ đám mây (Cloud) hay bên thứ ba nào**. Bạn toàn quyền sở hữu và kiểm soát 100% dữ liệu vật lý trên ổ cứng VPS:

| Dữ liệu | Vị trí lưu trữ cục bộ trên máy chủ VPS | Mô tả bảo vệ |
|---|---|---|
| **Filesystem của VPS** | `/var/lib/lxc/<vps-id>/rootfs/` | Toàn bộ source code, web server, cơ sở dữ liệu và file của người dùng trong container. |
| **Cơ sở dữ liệu Bot** | PostgreSQL Local (`127.0.0.1:5432`) | Lưu trữ users, vps_instances, lịch sử audit, sessions, cấu hình bot ngay trong `/var/lib/postgresql/`. |
| **Bản sao lưu (Backups)** | `/var/lib/vpsbot/backups/` | Tệp nén `.tar.gz` kèm mã băm SHA-256 nằm độc lập ngoài container, không bị ảnh hưởng khi Reinstall. |
| **Nhật ký & Audit Logs** | PostgreSQL & `journalctl` VPS | Nhật ký quản trị và lệnh thực thi lưu nội bộ, không rò rỉ ra kênh chat hay dịch vụ ngoài. |
| **SSHX Terminal Sessions** | Process quản lý nội bộ container | Phiên terminal chỉ phân phối qua tin nhắn riêng tư (DM/Ephemeral) và có thể thu hồi tức thì. |

> [!IMPORTANT]
> **Khi người dùng Reinstall OS:** Bot **chỉ xóa duy nhất** thư mục `/var/lib/lxc/<id>/rootfs` của container đó. Toàn bộ cơ sở dữ liệu của Bot, dữ liệu máy chủ Host và các bản Backup đã tạo tại `/var/lib/vpsbot/backups/` đều được bảo toàn nguyên vẹn 100% trên VPS.
> 
> Để sao lưu toàn bộ hệ thống bot và database trên VPS chỉ với một lệnh:
> ```bash
> sudo ./scripts/backup-all.sh
> ```

---

## 🔒 NGUYÊN TẮC PHÂN QUYỀN NGHIÊM NGẶT

Theo đúng yêu cầu nghiệp vụ:
- **Chỉ duy nhất 1 Master Owner (`OWNER_DISCORD_ID`)**: Có toàn quyền tạo VPS, xóa VPS, thay đổi cấu hình RAM/CPU/Disk, quản trị node, ban người dùng, xem audit logs, sao lưu và khôi phục.
- **Người dùng thông thường (VPS User)**: **Chỉ được phép sử dụng duy nhất lệnh `/manage`**.
  - Trong panel `/manage`, người dùng chỉ có thể điều khiển VPS mà họ sở hữu (Bật, Tắt, Khởi động lại, Mở SSHX terminal bảo mật, Cài lại OS, Xem thống kê tài nguyên).
  - Mọi nỗ lực thực thi lệnh tạo VPS, xóa VPS, thay đổi cấu hình hoặc can thiệp VPS của người khác đều bị từ chối và ghi log bảo mật.

---

## 💻 YÊU CẦU HỆ THỐNG MÁY CHỦ (DEBIAN 13)

- **Hệ điều hành**: Debian 13 (Trixie) hoặc Ubuntu 24.04 LTS (Bare Metal hoặc KVM VPS).
- **CPU**: Tối thiểu 2 Cores.
- **RAM**: Tối thiểu 4 GB RAM vật lý.
- **Ổ cứng**: Tối thiểu 25 GB còn trống (để lưu trữ rootfs container và cache template OS).
- **Kernel cgroups**: Bắt buộc hỗ trợ **Cgroup v2** (`/sys/fs/cgroup/cgroup.controllers`).
- **Phần mềm**: Node.js v22+, PostgreSQL 15+, LXC, bridge-utils, dnsmasq-base, iptables.

---

## 🚀 HƯỚNG DẪN CÀI ĐẶT NHANH

### Bước 1: Clone mã nguồn và cài đặt dependencies
```bash
git clone <repository_url> /opt/vpsbot
cd /opt/vpsbot
npm install
```

### Bước 2: Chạy script cài đặt môi trường Debian 13
Script tự động cài đặt toàn bộ gói hệ thống, cấu hình network bridge `lxcbr0`, kích hoạt ip_forward và cài đặt SSHX:
```bash
sudo chmod +x scripts/*.sh
sudo ./scripts/install-debian13.sh
```

### Bước 3: Khởi tạo Database PostgreSQL
```bash
sudo ./scripts/setup-db.sh
```

### Bước 4: Kiểm tra tính tương thích của máy chủ
```bash
./scripts/check-node.sh
```

### Bước 5: Biên dịch mã nguồn TypeScript
```bash
npm run build
```

---

## ⚙️ CẤU HÌNH MÔI TRƯỜNG (.env)

Sao chép file mẫu:
```bash
cp .env.example .env
nano .env
```

Các tham số quan trọng:
```ini
# Token lấy từ Discord Developer Portal
DISCORD_TOKEN=MTE5...
DISCORD_CLIENT_ID=123456789...

# ID Discord của DUY NHẤT 1 OWNER có toàn quyền
OWNER_DISCORD_ID=789123456789012345

# ID server Discord để đăng ký slash commands (bỏ trống = toàn cục)
DISCORD_GUILD_ID=

# Lệnh prefix cũ tắt mặc định
ENABLE_PREFIX_COMMANDS=false
PREFIX=?

# Chuỗi kết nối PostgreSQL
DATABASE_URL=postgresql://vpsbot:strong_password@127.0.0.1:5432/vpsbot

# VPS Node Agent
NODE_ID=node-1
AGENT_HOST=127.0.0.1
AGENT_PORT=4000
AGENT_API_TOKEN=vpsbot_secret_node_token_change_me

# Đường dẫn lưu trữ LXC
LXC_PATH=/var/lib/lxc
BACKUP_PATH=/var/lib/vpsbot/backups
BRIDGE_INTERFACE=lxcbr0
```

---

### Sử dụng slash command

Bot tự đăng ký các lệnh `/` sau khi đăng nhập Discord. Mặc định bot chỉ cần intent `Guilds`, không cần bật Message Content Intent.

1. Điền `DISCORD_TOKEN`, `OWNER_DISCORD_ID` và nên điền `DISCORD_GUILD_ID` (ID server Discord) trong `.env`.
2. Mời bot vào server bằng link OAuth2 có scope `bot` và `applications.commands`.
3. Chạy `npm run build`, sau đó khởi động lại bot (`sudo systemctl restart vpsbot` nếu dùng service).
4. Kiểm tra log có dòng `Registered ... slash commands`. Gõ `/help` hoặc `/manage` trong server đã cấu hình.
5. Tạo VPS: chọn `/create`, điền `ram:4096`, `cpu:2`, `disk:20`, `user:@thành_viên`, rồi chọn OS và xác nhận.

Các bảng lệnh bên dưới liệt kê chức năng và tham số; khi dùng slash, điền vào các ô Discord hiển thị. Ví dụ `/rename id:vps-0001 name:Máy chủ riêng`. Các phản hồi slash chỉ hiển thị cho người gọi. Quyền quản trị vẫn được kiểm tra theo `OWNER_DISCORD_ID`.

Nếu chưa thấy lệnh, kiểm tra bot online, `DISCORD_GUILD_ID` đúng server, scope cài đặt và quyền **Use Application Commands** trong kênh. Nếu log báo lỗi đăng ký, sửa cấu hình rồi khởi động lại bot. `/help` không truy cập database để có thể kiểm tra riêng kết nối Discord.

Nếu cần dùng lại `?create`, `?manage`, đặt `ENABLE_PREFIX_COMMANDS=true` và bật **Message Content Intent** trong Discord Developer Portal. Slash commands vẫn hoạt động song song.

Tài liệu Discord: [Application Commands](https://docs.discord.com/developers/docs/interactions/slash-commands).

### Lưu ý khi khởi động

- Bot cần `DISCORD_TOKEN` và `OWNER_DISCORD_ID` hợp lệ; lỗi kết nối database hoặc đăng nhập sẽ dừng tiến trình để systemd có thể khởi động lại.
- `scripts/setup-db.sh` tạo quyền PostgreSQL cho user hệ điều hành `root`, đúng với các service bên dưới. Nếu chạy bằng user khác hoặc dùng database từ xa, cấu hình `DATABASE_URL` hoặc `PGUSER`/`PGPASSWORD` tương ứng.
- Bot mặc định chạy agent tích hợp. Nếu bật thêm `vpsbot-agent.service` trên cùng máy, đặt `EMBEDDED_AGENT=false` để tránh lỗi `EADDRINUSE`.
- Agent độc lập cũng cần truy cập database chứa metadata VPS. Mỗi worker cần `NODE_ID` riêng; đặt `AGENT_HOST` thành địa chỉ có thể truy cập từ bot và đăng ký host/token tương ứng.
- Dải IP tĩnh của bot là `10.0.3.50–10.0.3.199`. DHCP trong script cài đặt dùng `10.0.3.200–10.0.3.254`; máy đã cài trước đó cần điều chỉnh `/etc/default/lxc-net` để hai dải không trùng nhau.
- Restore yêu cầu container đã dừng và dung lượng trống để giải nén bản backup trước khi thay rootfs. File cũ được giữ nguyên nếu giải nén thất bại.

## 🛠️ QUẢN LÝ TIẾN TRÌNH BẰNG SYSTEMD

Cài đặt 2 dịch vụ systemd để bot và agent tự động khởi chạy cùng hệ thống:

```bash
# 1. Cài đặt service Bot
sudo cp systemd/vpsbot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vpsbot.service

# 2. Kiểm tra trạng thái
sudo systemctl status vpsbot.service

# 3. Xem log thời gian thực
journalctl -u vpsbot.service -f
```

---

## 📋 DANH SÁCH TOÀN BỘ LỆNH (SLASH COMMANDS `/`)

### 1. Khởi tạo & Vòng đời VPS

| Lệnh | Mô tả | Quyền hạn |
|---|---|---|
| `/create <ram> <cpu> <disk> @user` | Tạo VPS mới, mở bảng chọn OS | **Owner only** |
| `/manage [id]` | Bảng điều khiển VPS trực quan | **Mọi người** (Chỉ VPS sở hữu) |
| `/list` | Danh sách VPS trên hệ thống | **Owner only** |
| `/info <id>` | Xem chi tiết thông số VPS | **Owner only** |
| `/start <id>` | Khởi động container | **Owner only** |
| `/stop <id>` | Dừng container | **Owner only** |
| `/restart <id>` | Khởi động lại container | **Owner only** |
| `/reinstall <id>` | Cài lại hệ điều hành, xóa dữ liệu cũ | **Owner only** |
| `/delete <id>` | Xóa vĩnh viễn container | **Owner only** |
| `/rename <id> <name>` | Đổi tên gợi nhớ cho VPS | **Owner only** |
| `/status <id>` | Xem trạng thái running/stopped | **Owner only** |
| `/uptime <id>` | Thời gian container đã hoạt động | **Owner only** |
| `/os <id>` | Xem OS đang chạy | **Owner only** |
| `/transfer <id> @user` | Chuyển quyền sở hữu VPS | **Owner only** |

### 2. Tài nguyên & Thống kê

| Lệnh | Mô tả | Quyền hạn |
|---|---|---|
| `/stats <id>` | Thống kê RAM, CPU, PID thực tế | **Owner only** |
| `/usage <id>` | Dung lượng ổ đĩa (`df -h`) & bộ nhớ (`free -m`) | **Owner only** |
| `/resources` | Xem tổng tài nguyên máy chủ node | **Owner only** |
| `/resize <id> <ram> <cpu> <disk>` | Thay đổi cấu hình động | **Owner only** |
| `/setram <id> <mb>` | Thay đổi RAM bằng cgroup v2 | **Owner only** |
| `/setcpu <id> <cores>` | Thay đổi số vCPU | **Owner only** |
| `/setdisk <id> <gb>` | Tăng dung lượng ổ đĩa | **Owner only** |
| `/limits <id>` | Xem giới hạn cgroup v2 active | **Owner only** |
| `/top` | Top VPS chiếm dụng tài nguyên | **Owner only** |

### 3. SSHX & Terminal Truy cập

| Lệnh | Mô tả | Quyền hạn |
|---|---|---|
| `/sshx <id>` | Tạo phiên SSHX, gửi link qua tin nhắn riêng | **Owner only** |
| `/terminal <id>` | Hướng dẫn mở terminal | **Owner only** |
| `/sshxreset <id>` | Thu hồi phiên cũ và tạo link mới | **Owner only** |
| `/sshxstop <id>` | Đóng phiên terminal đang mở | **Owner only** |
| `/sshxstatus <id>` | Kiểm tra trạng thái tiến trình SSHX | **Owner only** |
| `/console <id>` | Đọc console log container | **Owner only** |
| `/exec <id> <command>` | Chạy lệnh an toàn trong container (Allowlist) | **Owner only** |
| `/logs <id>` | Xem log chi tiết LXC | **Owner only** |

### 4. Mạng & NAT Port Forwarding

| Lệnh | Mô tả | Quyền hạn |
|---|---|---|
| `/ip <id>` | Xem IP nội bộ (10.0.3.x) của VPS | **Owner only** |
| `/network <id>` | Xem interface & packet statistics | **Owner only** |
| `/ports <id>` | Danh sách port mapping NAT | **Owner only** |
| `/portadd <id> <pub> <priv> [proto]` | Thêm quy tắc NAT qua iptables | **Owner only** |
| `/portremove <id> <pub>` | Xóa quy tắc port NAT | **Owner only** |
| `/dns <id>` | Xem DNS nameservers | **Owner only** |
| `/setdns <id> <dns1> [dns2]` | Cập nhật file `/etc/resolv.conf` | **Owner only** |
| `/ping <id> <host>` | Kiểm tra độ trễ mạng từ container | **Owner only** |
| `/bandwidth <id>` | Xem lưu lượng mạng đã truyền nhận | **Owner only** |

### 5. Sao lưu & Khôi phục (Backup)

| Lệnh | Mô tả | Quyền hạn |
|---|---|---|
| `/backup <id>` | Nén tarball rootfs, tính mã băm SHA-256 | **Owner only** |
| `/backups <id>` | Danh sách các bản backup đã tạo | **Owner only** |
| `/restore <id> <backup_id>` | Khôi phục filesystem từ backup | **Owner only** |
| `/backupdelete <backup_id>` | Xóa tệp backup | **Owner only** |
| `/autobackup <id> on/off` | Bật/tắt tự động sao lưu định kỳ | **Owner only** |

### 6. Quản trị viên (Master Admin)

| Lệnh | Mô tả | Quyền hạn |
|---|---|---|
| `/admin` | Mở Dashboard quản trị trung tâm | **Owner only** |
| `/nodes` | Danh sách các worker node | **Owner only** |
| `/nodeinfo <id>` | Xem thông số chi tiết node | **Owner only** |
| `/nodeadd <id> <name> <host> <port> <token>` | Đăng ký node mới vào cụm | **Owner only** |
| `/noderemove <id>` | Hủy đăng ký node | **Owner only** |
| `/maintenance <id> on/off` | Bật/tắt chế độ bảo trì node | **Owner only** |
| `/allvps` | Danh sách toàn bộ VPS trên mọi node | **Owner only** |
| `/suspend <id> [reason]` | Khóa VPS tạm thời | **Owner only** |
| `/unsuspend <id>` | Mở khóa VPS | **Owner only** |
| `/setowner <id> @user` | Đổi chủ sở hữu VPS | **Owner only** |
| `/setquota @user <vps> <ram> <cpu> <disk>` | Đặt hạn mức tài nguyên | **Owner only** |
| `/banvps @user` | Cấm thành viên sử dụng VPS | **Owner only** |
| `/unbanvps @user` | Gỡ lệnh cấm | **Owner only** |
| `/audit` | Xem nhật ký kiểm toán hệ thống | **Owner only** |

### 7. Tiện ích & Hỗ trợ

| Lệnh | Mô tả | Quyền hạn |
|---|---|---|
| `/help` | Hướng dẫn lệnh theo quyền hạn người gọi | **Mọi người** |
| `/profile [@user]` | Xem hồ sơ tài khoản | **Owner only** |
| `/myvps` | Lối tắt xem VPS của tôi | **Owner only** |
| `/quota [@user]` | Xem hạn mức của tài khoản | **Owner only** |
| `/notifications on/off` | Bật/tắt thông báo qua DM | **Owner only** |
| `/health` | Kiểm tra toàn diện tình trạng máy chủ | **Owner only** |
| `/images` | Danh sách các image OS đã xác minh | **Owner only** |
| `/version` | Phiên bản hệ thống | **Owner only** |
| `/support` | Thông tin hỗ trợ | **Owner only** |

---

## 🖥️ TÍCH HỢP TERMINAL SSHX & BẢO MẬT

Hệ thống tích hợp terminal SSHX (https://sshx.io) trực tiếp bên trong container LXC:
1. **Cài đặt tự động**: SSHX được tải và thiết lập nhị phân tự động khi khởi tạo container hoặc cài lại OS.
2. **Không lưu Token công khai**: URL truy cập terminal SSHX chứa token bảo mật. URL này **tuyệt đối không bao giờ được gửi vào kênh chat công khai**.
3. **Phân phối bí mật**: URL được gửi trực tiếp qua Direct Message (DM) hoặc nút bấm Ephemeral (chỉ người dùng click mới nhìn thấy trên Discord).
4. **Cơ chế thu hồi (Revocation)**: Khi người dùng đổi chủ sở hữu (`/transfer`), cài lại OS (`/reinstall`), hoặc bấm nút `/sshxstop` / `/sshxreset`, tiến trình SSHX lập tức bị ngắt (`pkill -9 sshx`) và phiên cũ bị đánh dấu `revoked` trong database.
5. **Giám sát tự động**: Tiến trình nền tự động kiểm tra xem SSHX có bị crash hay không để khởi động lại cho người dùng.

---

## 💿 CƠ CHẾ REINSTALL OS (CÀI LẠI VPS)

Quy trình Reinstall OS tuân thủ nghiêm ngặt chuẩn bảo vệ dữ liệu:
1. Người dùng chọn hệ điều hành mới (Debian 13, Debian 12, Ubuntu 24.04, Ubuntu 22.04, Alpine Linux 3.20).
2. Bot hiển thị **Cảnh báo hủy dữ liệu (DATA DESTRUCTION)** màu đỏ với các điều khoản rõ ràng.
3. Người dùng phải bấm nút **Confirm Reinstall (Wipe All Data)** để kích hoạt.
4. Quá trình thực hiện tuần tự qua `JobQueue`:
   - Dừng container.
   - Thu hồi phiên SSHX hiện tại.
   - Xóa sạch rootfs cũ của đúng VPS đó (không ảnh hưởng tới host hay container khác).
   - Tải và cài đặt template hệ điều hành mới.
   - Giữ nguyên VPS ID, Owner ID, cấu hình cgroups (RAM, CPU), và IP nội bộ.
   - Khởi động lại VPS và khởi tạo phiên SSHX mới.

---

## 🌐 REMOTE LXC NODE MODE (CHẾ ĐỘ ĐA NODE)

Nếu máy chủ bot hiện tại là VPS bị nhà cung cấp hạn chế lồng LXC (nested virtualization không được bật), hệ thống hỗ trợ tách rời:
- **Master Server**: Chạy Discord Bot và PostgreSQL Database.
- **Worker Node**: Chạy riêng `vpsbot-agent` trên máy chủ vật lý hoặc KVM VPS hỗ trợ LXC:
  ```bash
  npm run start:agent
  ```
- Trên Discord, Owner chỉ cần đăng ký node vào cụm:
  ```
  /nodeadd node-2 Worker-Singapore 198.51.100.25 4000 secret_node_token
  ```
- Bot sẽ phân bổ và tạo container LXC từ xa qua REST API bảo mật.

---

## 📦 SAO LƯU & PHỤC HỒI (BACKUP & DISASTER RECOVERY)

### Sao lưu Container:
Bản sao lưu rootfs được nén bằng `tar.gz` và lưu trữ tại thư mục tách biệt `/var/lib/vpsbot/backups/`, đồng thời tự động tính toán mã kiểm tra SHA-256:
```
/backup vps-0001
```

### Sao lưu PostgreSQL Database:
```bash
# Tạo file backup cơ sở dữ liệu
pg_dump -U vpsbot -h 127.0.0.1 vpsbot > /var/backups/vpsbot_$(date +%F).sql

# Khôi phục cơ sở dữ liệu
psql -U vpsbot -h 127.0.0.1 vpsbot < /var/backups/vpsbot_2026-10-11.sql
```

---

## ❓ XỬ LÝ LỖI THƯỜNG GẶP (TROUBLESHOOTING)

### 1. Bot không hiển thị `/create` hoặc báo không có quyền
- **Nguyên nhân**: Bạn chưa cấu hình đúng `OWNER_DISCORD_ID` trong file `.env`.
- **Cách sửa**: Bật Developer Mode trong Discord -> Chuột phải vào tài khoản của bạn -> Chọn **Copy User ID** -> Điền ID đó vào `OWNER_DISCORD_ID` trong `.env` và khởi động lại bot.

### 2. Lỗi `Cgroup v2 is not active on this host`
- **Nguyên nhân**: Kernel của máy chủ đang sử dụng cgroup v1 cũ.
- **Cách sửa**: Thêm `systemd.unified_cgroup_hierarchy=1` vào `/etc/default/grub` tại dòng `GRUB_CMDLINE_LINUX` rồi chạy `update-grub` và `reboot`.

### 3. Container không nhận IP từ `lxcbr0`
- **Nguyên nhân**: Dịch vụ `lxc-net` chưa chạy hoặc dnsmasq bị xung đột.
- **Cách sửa**:
  ```bash
  sudo systemctl restart lxc-net
  sudo ip addr show lxcbr0
  ```

---

## ✅ TIÊU CHÍ NGHIỆM THU (ACCEPTANCE CHECKLIST)

- [x] Lệnh `/create <ram> <cpu> <disk> @user` mở menu chọn OS trực quan.
- [x] Tạo container LXC thật với cgroups v2 và mạng bridge nội bộ.
- [x] Lệnh `/manage` hiển thị đúng danh sách và phân quyền chuẩn xác (Chỉ Owner mới có toàn quyền, người khác chỉ dùng `/manage`).
- [x] Các nút Start, Stop, Restart hoạt động thực tế trên máy chủ.
- [x] SSHX mở terminal thực tế và gửi link bảo mật qua Ephemeral/DM.
- [x] Reinstall OS xác nhận 2 bước và xóa sạch rootfs cũ an toàn.
- [x] Khóa ID container chống xung đột Race Condition qua `JobQueue`.
- [x] Tách kiến trúc Bot và Node Agent hỗ trợ Remote Worker Node.
- [x] Tự động khởi động sau reboot qua dịch vụ systemd.
# botvps
# botvps
# botvps
# botvps
