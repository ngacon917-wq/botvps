#!/bin/bash
# ==============================================================================
# DISCORD LXC VPS MANAGER - ZERO-CONFIG DATABASE PROVISIONING SCRIPT
# ==============================================================================

set -euo pipefail

DB_NAME="vpsbot"
if [ "$EUID" -ne 0 ]; then
    echo "Run this script as root (sudo ./scripts/setup-db.sh)."
    exit 1
fi

echo "=========================================================="
echo " Khởi tạo cơ sở dữ liệu PostgreSQL cục bộ cho VPSBot..."
echo "=========================================================="

# Đảm bảo dịch vụ postgresql đang chạy
systemctl start postgresql 2>/dev/null || service postgresql start 2>/dev/null || true

# Tạo database vpsbot nếu chưa có (dùng user postgres mặc định)
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1 || \
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME};"

echo "🐘 Nạp schema migrations từ schema.sql..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_FILE="${SCRIPT_DIR}/../src/db/schema.sql"

if [ -f "$SCHEMA_FILE" ]; then
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "$SCHEMA_FILE"
    # The systemd services run as root; peer authentication uses the OS username.
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<'SQL'
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'root') THEN
        CREATE ROLE root LOGIN;
    END IF;
END $$;
GRANT CONNECT ON DATABASE vpsbot TO root;
GRANT USAGE, CREATE ON SCHEMA public TO root;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO root;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO root;
SQL
    echo "✅ Database schema đã khởi tạo thành công!"
else
    echo "Schema file not found: ${SCHEMA_FILE}" >&2
    exit 1
fi

echo "=========================================================="
echo " Cấu hình cơ sở dữ liệu hoàn tất 100% tự động!"
echo " Hệ thống tự kết nối qua Unix Socket - KHÔNG CẦN PASSWORD."
echo "=========================================================="
