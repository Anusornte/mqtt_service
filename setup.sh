#!/bin/bash
# ==========================================================
# Solar IoT — VPS Setup Script
# รันหลัง git clone เพื่อเตรียม environment ให้พร้อม deploy
# Usage: bash setup.sh
# ==========================================================

set -e

CONTAINER_DIR="$(cd "$(dirname "$0")/container" && pwd)"

echo "=============================="
echo " Solar IoT — VPS Setup"
echo " Dir: $CONTAINER_DIR"
echo "=============================="

# --- 1. สร้าง directories ---
echo "[1/5] สร้าง directories..."
mkdir -p "$CONTAINER_DIR/mosquitto/data"
mkdir -p "$CONTAINER_DIR/mosquitto/log"
mkdir -p "$CONTAINER_DIR/nodered/data"
mkdir -p "$CONTAINER_DIR/nodered/lib/decoders"

chown -R 1883:1883 "$CONTAINER_DIR/mosquitto/data"
chown -R 1883:1883 "$CONTAINER_DIR/mosquitto/log"
chown -R 1000:1000 "$CONTAINER_DIR/nodered/data"
chown -R 1000:1000 "$CONTAINER_DIR/nodered/lib"

echo "    OK: directories พร้อม"

# --- 2. สร้าง .env ---
echo "[2/5] ตรวจสอบ .env..."
if [ ! -f "$CONTAINER_DIR/.env" ]; then
    cp "$CONTAINER_DIR/.env.example" "$CONTAINER_DIR/.env"
    SECRET=$(openssl rand -hex 32)
    sed -i "s/change-this-to-a-random-64-char-string/$SECRET/" "$CONTAINER_DIR/.env"
    chmod 600 "$CONTAINER_DIR/.env"
    echo "    สร้าง .env แล้ว — กรุณาแก้ NODERED_MQTT_PASS ใน .env ก่อนรัน"
    echo "    >>> nano $CONTAINER_DIR/.env <<<"
else
    echo "    OK: .env มีอยู่แล้ว"
fi

# --- 3. สร้าง passwd file ---
echo "[3/5] ตรวจสอบ passwd file..."
PASSWD_FILE="$CONTAINER_DIR/mosquitto/config/passwd"
if [ ! -f "$PASSWD_FILE" ]; then
    touch "$PASSWD_FILE"
    chmod 600 "$PASSWD_FILE"

    # โหลด .env
    export $(grep -v '^#' "$CONTAINER_DIR/.env" | xargs)

    # Device user (HARDCODED — ห้ามเปลี่ยน)
    echo "    กรุณาใส่ Device Password (Solarstreetlight):"
    read -s DEVICE_PASS
    docker run --rm \
        -v "$PASSWD_FILE:/passwd" \
        eclipse-mosquitto:2.0.18 \
        mosquitto_passwd -b /passwd "Solarstreetlight" "$DEVICE_PASS"
    echo "    OK: เพิ่ม Solarstreetlight แล้ว"

    # Node-RED user
    docker run --rm \
        -v "$PASSWD_FILE:/passwd" \
        eclipse-mosquitto:2.0.18 \
        mosquitto_passwd -b /passwd "nodered" "$NODERED_MQTT_PASS"
    echo "    OK: เพิ่ม nodered แล้ว"
else
    echo "    OK: passwd file มีอยู่แล้ว"
fi

# --- 4. Linux Kernel Tuning ---
echo "[4/5] ตรวจสอบ kernel tuning..."
if ! grep -q "Solar IoT MQTT Tuning" /etc/sysctl.conf 2>/dev/null; then
    cat >> /etc/sysctl.conf << 'EOF'

# === Solar IoT MQTT Tuning ===
fs.file-max = 100000
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_keepalive_time = 600
net.ipv4.ip_local_port_range = 1024 65535
EOF
    sysctl -p > /dev/null 2>&1
    echo "    OK: kernel tuning ใส่แล้ว"
else
    echo "    OK: kernel tuning มีอยู่แล้ว"
fi

# --- 5. สรุป ---
echo ""
echo "[5/5] สรุป"
echo "-------------------------------"
echo " Config : $CONTAINER_DIR/mosquitto/config/"
echo " .env   : $CONTAINER_DIR/.env"
echo " passwd : $CONTAINER_DIR/mosquitto/config/passwd"
echo ""
echo "ขั้นตอนต่อไป:"
echo "  1. ตรวจสอบ .env  : nano $CONTAINER_DIR/.env"
echo "  2. รัน containers : cd $CONTAINER_DIR && docker compose up -d"
echo "  3. ดู logs        : docker compose logs -f"
echo "=============================="
