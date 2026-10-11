#!/bin/bash
# ==============================================================================
# DISCORD LXC VPS MANAGER - FULL LOCAL VPS DATA BACKUP SCRIPT
# ==============================================================================

set -euo pipefail

BACKUP_DEST="/var/lib/vpsbot/backups/system"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DEST}/vpsbot_full_backup_${TIMESTAMP}.tar.gz"
TEMP_DIR="/tmp/vpsbot_backup_${TIMESTAMP}"

echo "=========================================================="
echo " Bắt đầu sao lưu toàn bộ dữ liệu VPSBot cục bộ trên VPS..."
echo "=========================================================="

mkdir -p "${BACKUP_DEST}"
mkdir -p "${TEMP_DIR}"

# 1. Dump database PostgreSQL cục bộ
echo "🐘 [1/3] Đang xuất cơ sở dữ liệu PostgreSQL cục bộ..."
sudo -u postgres pg_dump vpsbot > "${TEMP_DIR}/database_dump.sql" 2>/dev/null || pg_dump -U vpsbot -h 127.0.0.1 vpsbot > "${TEMP_DIR}/database_dump.sql"

# 2. Sao lưu file cấu hình & metadata
echo "⚙️ [2/3] Đang sao lưu cấu hình hệ thống (.env, lxc configs)..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"

if [ -f "${PROJECT_ROOT}/.env" ]; then
    cp "${PROJECT_ROOT}/.env" "${TEMP_DIR}/env_backup"
fi

# Sao lưu danh sách cấu hình LXC (/var/lib/lxc/*/config)
mkdir -p "${TEMP_DIR}/lxc_configs"
if [ -d "/var/lib/lxc" ]; then
    find /var/lib/lxc -maxdepth 2 -name "config" -exec cp --parents {} "${TEMP_DIR}/lxc_configs" \; 2>/dev/null || true
fi

# 3. Nén toàn bộ dữ liệu vào một file lưu cục bộ trên VPS
echo "📦 [3/3] Đang đóng gói bản sao lưu..."
tar -czf "${BACKUP_FILE}" -C "${TEMP_DIR}" .
rm -rf "${TEMP_DIR}"

CHECKSUM=$(sha256sum "${BACKUP_FILE}" | awk '{print $1}')
FILE_SIZE=$(du -h "${BACKUP_FILE}" | awk '{print $1}')

echo "=========================================================="
echo "✅ SAO LƯU DỮ LIỆU CỤC BỘ TRÊN VPS THÀNH CÔNG!"
echo "📁 Đường dẫn lưu trên VPS: ${BACKUP_FILE}"
echo "📊 Dung lượng: ${FILE_SIZE}"
echo "🔒 Mã băm SHA-256: ${CHECKSUM}"
echo "=========================================================="
