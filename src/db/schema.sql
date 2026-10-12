-- Database Schema for Discord LXC VPS Manager

CREATE TABLE IF NOT EXISTS users (
    discord_id VARCHAR(32) PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    is_banned BOOLEAN DEFAULT FALSE,
    notifications_enabled BOOLEAN DEFAULT TRUE,
    max_vps INT DEFAULT 3,
    max_ram_mb INT DEFAULT 8192,
    max_cpu INT DEFAULT 4,
    max_disk_gb INT DEFAULT 50,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nodes (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INT DEFAULT 4000,
    api_token VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    is_maintenance BOOLEAN DEFAULT FALSE,
    max_ram_mb INT DEFAULT 32768,
    max_cpu INT DEFAULT 16,
    max_disk_gb INT DEFAULT 500,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operating_system_images (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    distro VARCHAR(50) NOT NULL,
    release VARCHAR(50) NOT NULL,
    arch VARCHAR(20) DEFAULT 'amd64',
    template_name VARCHAR(100) NOT NULL,
    is_verified BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vps_instances (
    id VARCHAR(50) PRIMARY KEY,
    vps_number SERIAL,
    node_id VARCHAR(50) NOT NULL REFERENCES nodes(id) ON DELETE RESTRICT,
    owner_discord_id VARCHAR(32) NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    os_id VARCHAR(50) NOT NULL REFERENCES operating_system_images(id),
    ram_mb INT NOT NULL,
    cpu_cores INT NOT NULL,
    disk_gb INT NOT NULL,
    status VARCHAR(30) DEFAULT 'stopped', -- stopped, running, provisioning, reinstalling, suspended, error
    ip_address VARCHAR(45) DEFAULT '10.0.3.100',
    mac_address VARCHAR(18),
    auto_backup BOOLEAN DEFAULT FALSE,
    suspended_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resource_allocations (
    id SERIAL PRIMARY KEY,
    vps_id VARCHAR(50) NOT NULL REFERENCES vps_instances(id) ON DELETE CASCADE,
    ram_allocated_mb INT NOT NULL,
    cpu_allocated INT NOT NULL,
    disk_allocated_gb INT NOT NULL,
    allocated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sshx_sessions (
    id VARCHAR(50) PRIMARY KEY,
    vps_id VARCHAR(50) NOT NULL REFERENCES vps_instances(id) ON DELETE CASCADE,
    user_discord_id VARCHAR(32) NOT NULL REFERENCES users(discord_id),
    session_url VARCHAR(255) NOT NULL,
    token_hash VARCHAR(128) NOT NULL,
    status VARCHAR(20) DEFAULT 'active', -- active, revoked, expired
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS operation_jobs (
    id VARCHAR(50) PRIMARY KEY,
    vps_id VARCHAR(50) REFERENCES vps_instances(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- create, start, stop, restart, reinstall, delete, resize
    status VARCHAR(30) DEFAULT 'pending', -- pending, running, completed, failed
    stage VARCHAR(100) DEFAULT 'queued', -- validating, provisioning, configuring, starting, ready
    error_message TEXT,
    requested_by VARCHAR(32) NOT NULL REFERENCES users(discord_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_discord_id VARCHAR(32) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id VARCHAR(100),
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bot_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backups (
    id VARCHAR(50) PRIMARY KEY,
    vps_id VARCHAR(50) NOT NULL REFERENCES vps_instances(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    size_bytes BIGINT DEFAULT 0,
    checksum VARCHAR(64),
    status VARCHAR(30) DEFAULT 'completed', -- creating, completed, failed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nat_ports (
    id SERIAL PRIMARY KEY,
    vps_id VARCHAR(50) NOT NULL REFERENCES vps_instances(id) ON DELETE CASCADE,
    public_port INT NOT NULL,
    private_port INT NOT NULL,
    protocol VARCHAR(10) DEFAULT 'tcp', -- tcp, udp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_public_port UNIQUE (public_port, protocol)
);

-- Seed default verified OS images
INSERT INTO operating_system_images (id, name, distro, release, arch, template_name, is_verified, is_active)
VALUES
    ('debian-12', 'Debian 12 (Bookworm)', 'debian', 'bookworm', 'amd64', 'debian:12', true, true),
    ('debian-13', 'Debian 13 (Trixie)', 'debian', 'trixie', 'amd64', 'debian:13', true, true),
    ('ubuntu-2204', 'Ubuntu 22.04 LTS (Jammy)', 'ubuntu', 'jammy', 'amd64', 'ubuntu:jammy', true, true),
    ('ubuntu-2404', 'Ubuntu 24.04 LTS (Noble)', 'ubuntu', 'noble', 'amd64', 'ubuntu:noble', true, true),
    ('alpine-320', 'Alpine Linux 3.20', 'alpine', '3.20', 'amd64', 'alpine:3.20', true, true)
ON CONFLICT (id) DO NOTHING;

-- The local node is registered by initDatabase using the configured host, port and token.
