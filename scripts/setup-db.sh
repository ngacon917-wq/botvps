#!/bin/bash
# ==============================================================================
# DISCORD LXC VPS MANAGER - ZERO-CONFIG DATABASE PROVISIONING SCRIPT
# ==============================================================================

set -euo pipefail

DB_NAME="vpsbot"

echo "=========================================================="
echo " Khởi tạo cơ sở dữ liệu PostgreSQL cục bộ cho VPSBot..."
echo "=========================================================="

# Đảm bảo dịch vụ postgresql đang chạy
systemctl start postgresql 2>/dev/null || service postgresql start 2>/dev/null || true

# Tạo database vpsbot nếu chưa có (dùng user postgres mặc định)
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1 || \
sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME};"

echo "🐘 Nạp schema migrations từ schema.sql..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_FILE="${SCRIPT_DIR}/../src/db/schema.sql"

if [ -f "$SCHEMA_FILE" ]; then
    sudo -u postgres psql -d "${DB_NAME}" -f "$SCHEMA_FILE"
    echo "✅ Database schema đã khởi tạo thành công!"
fi

echo "=========================================================="
echo " Cấu hình cơ sở dữ liệu hoàn tất 100% tự động!"
echo " Hệ thống tự kết nối qua Unix Socket - KHÔNG CẦN PASSWORD."
echo "=========================================================="
