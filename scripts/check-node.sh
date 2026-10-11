#!/bin/bash
# ==============================================================================
# DISCORD LXC VPS MANAGER - HOST & NODE DIAGNOSTICS SCRIPT
# ==============================================================================

echo "=========================================================="
echo " Running VPS Node Compatibility & Health Diagnostics..."
echo "=========================================================="

# 1. Virtualization Check
VIRT=$(systemd-detect-virt 2>/dev/null || echo "Unknown/BareMetal")
echo "🔍 Virtualization environment: ${VIRT}"
if [[ "$VIRT" =~ "lxc" ]]; then
    echo "⚠️ ALERT: Running inside nested LXC. Make sure host allows nested cgroups."
fi

# 2. Cgroup v2
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
    echo "✅ Cgroup v2: ACTIVE ($(cat /sys/fs/cgroup/cgroup.controllers))"
else
    echo "❌ Cgroup v2: NOT ACTIVE or legacy cgroup v1 detected."
fi

# 3. LXC binaries
for cmd in lxc-create lxc-start lxc-stop lxc-info lxc-attach lxc-destroy; do
    if command -v $cmd >/dev/null 2>&1; then
        echo "✅ ${cmd}: Available"
    else
        echo "❌ ${cmd}: MISSING"
    fi
done

# 4. Network bridge
if ip link show lxcbr0 >/dev/null 2>&1; then
    echo "✅ Network Bridge (lxcbr0): UP"
else
    echo "❌ Network Bridge (lxcbr0): NOT DETECTED"
fi

# 5. IP Forwarding
IP_FWD=$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null || echo "0")
if [ "$IP_FWD" -eq 1 ]; then
    echo "✅ IPv4 Packet Forwarding: ENABLED"
else
    echo "❌ IPv4 Packet Forwarding: DISABLED"
fi

# 6. Disk space in /var/lib/lxc
LXC_PATH="/var/lib/lxc"
if [ -d "$LXC_PATH" ]; then
    FREE_SPACE=$(df -h "$LXC_PATH" | awk 'NR==2 {print $4}')
    echo "✅ Disk Space at ${LXC_PATH}: ${FREE_SPACE} free"
else
    echo "⚠️ ${LXC_PATH} does not exist yet."
fi

echo "=========================================================="
echo " Diagnostics complete."
echo "=========================================================="
