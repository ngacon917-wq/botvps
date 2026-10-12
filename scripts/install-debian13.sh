#!/bin/bash
# ==============================================================================
# DISCORD LXC VPS MANAGER - DEBIAN 13 (TRIXIE) HOST INSTALLATION SCRIPT
# ==============================================================================

set -euo pipefail

echo "=========================================================="
echo " Starting Debian 13 Host Provisioning for VPSBot..."
echo "=========================================================="

# Check root privilege
if [ "$EUID" -ne 0 ]; then
    echo "❌ Error: This script must be run as root."
    exit 1
fi

# 1. Update system packages
echo "📦 Updating system repositories..."
apt-get update && apt-get upgrade -y

# 2. Install essential dependencies, LXC, bridge utilities & iptables
echo "📦 Installing LXC, Networking, and System utilities..."
apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    lxc \
    lxc-templates \
    bridge-utils \
    dnsmasq-base \
    iptables \
    net-tools \
    iproute2 \
    tar \
    gzip \
    gnupg \
    lsb-release \
    ca-certificates

# 3. Setup Cgroup v2 check
echo "⚙️ Checking cgroup v2 support..."
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
    echo "✅ Cgroup v2 is active."
else
    echo "⚠️ Warning: Unified cgroup hierarchy not detected."
    echo "Ensure your kernel has systemd.unified_cgroup_hierarchy=1"
fi

# 4. Configure LXC default bridge (lxcbr0)
echo "🌐 Configuring LXC Network Bridge (lxcbr0)..."
cat << 'EOF' > /etc/default/lxc-net
USE_LXC_BRIDGE="true"
LXC_BRIDGE="lxcbr0"
LXC_ADDR="10.0.3.1"
LXC_NETMASK="255.255.255.0"
LXC_NETWORK="10.0.3.0/24"
LXC_DHCP_RANGE="10.0.3.200,10.0.3.254"
LXC_DHCP_MAX="55"
LXC_DHCP_CONFILE=""
LXC_DOMAIN=""
EOF

systemctl enable lxc-net || true
systemctl restart lxc-net || true

# 5. Enable IPv4 packet forwarding
echo "🌐 Enabling IPv4 IP Forwarding in sysctl..."
sed -i 's/#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf || true
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-vpsbot-forward.conf
sysctl --system

# 6. Install SSHX binary on host
echo "🖥️ Installing SSHX binary..."
curl -sSf https://sshx.io/get | sh || true

# 7. Install PostgreSQL
echo "🐘 Installing PostgreSQL..."
apt-get install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql

# 8. Install Node.js (v22 / v24 LTS)
if ! command -v node > /dev/null; then
    echo "⚡ Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
fi

echo "Node.js version: $(node -v)"
echo "npm version: $(npm -v)"

# 9. Create isolated backup directory
mkdir -p /var/lib/vpsbot/backups
chmod 700 /var/lib/vpsbot/backups

echo "=========================================================="
echo "✅ Debian 13 host environment setup completed successfully!"
echo "Next step: Run ./scripts/setup-db.sh to configure PostgreSQL."
echo "=========================================================="
