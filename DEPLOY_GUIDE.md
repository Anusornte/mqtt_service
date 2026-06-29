# คู่มือ Deploy — Solar IoT MQTT Server
## Mosquitto + Node-RED บน VPS (Docker Compose)

---

## วิธี Deploy ผ่าน GitHub (Quick Start)

```bash
# 1. SSH เข้า VPS
ssh root@187.127.102.131

# 2. ติดตั้ง Docker (ถ้ายังไม่มี)
curl -fsSL https://get.docker.com | sh

# 3. Clone โปรเจค
git clone https://github.com/Anusornte/mqtt_service.git /opt/mosquitto
cd /opt/mosquitto

# 4. รัน setup script (สร้าง dirs, .env, passwd, kernel tuning)
bash setup.sh

# 5. แก้ .env (ใส่ NODERED_MQTT_PASS ที่ต้องการ)
nano container/.env

# 6. รัน containers
cd container
docker compose up -d

# 7. ตรวจสอบ
docker ps
docker compose logs -f
```

> **หมายเหตุ:** `setup.sh` จะถามหา Device Password (`Solarstreetlight`) ตอนรัน ครั้งเดียว — hardcoded ในอุปกรณ์ ห้ามเปลี่ยน

---

## สารบัญ (คู่มือละเอียด)

1. [ข้อกำหนดเบื้องต้น](#1-ข้อกำหนดเบื้องต้น)
2. [เชื่อมต่อ VPS](#2-เชื่อมต่อ-vps)
3. [ติดตั้ง Docker](#3-ติดตั้ง-docker)
4. [สร้างโครงสร้างไฟล์](#4-สร้างโครงสร้างไฟล์)
5. [สร้าง Config Files](#5-สร้าง-config-files)
6. [สร้าง Password File](#6-สร้าง-password-file)
7. [สร้าง docker-compose.yml](#7-สร้าง-docker-composeyml)
8. [สร้าง .env File](#8-สร้าง-env-file)
9. [ปรับ Linux Kernel](#9-ปรับ-linux-kernel)
10. [เริ่มระบบ](#10-เริ่มระบบ)
11. [ตรวจสอบระบบ](#11-ตรวจสอบระบบ)
12. [ทดสอบ MQTT](#12-ทดสอบ-mqtt)
13. [ตั้งค่า Node-RED](#13-ตั้งค่า-node-red)
14. [ตั้งค่า Firewall](#14-ตั้งค่า-firewall)
15. [ตั้งค่า Auto Backup](#15-ตั้งค่า-auto-backup)
16. [คำสั่งที่ใช้บ่อย](#16-คำสั่งที่ใช้บ่อย)
17. [การแก้ปัญหา](#17-การแก้ปัญหา)

---

## 1. ข้อกำหนดเบื้องต้น

### VPS Spec แนะนำ (รองรับ 1000 devices)

| รายการ | ขั้นต่ำ | แนะนำ |
|--------|--------|--------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Disk | 20 GB | 40 GB |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| Network | 10 Mbps | 100 Mbps |

### Port ที่ต้องเปิด

| Port | Protocol | ใช้สำหรับ |
|------|----------|-----------|
| 22 | TCP | SSH |
| 1883 | TCP | MQTT (devices + Node-RED) — **hardcoded ใน firmware** |
| 9001 | TCP | MQTT WebSocket (website) |
| 1880 | TCP | Node-RED UI |

### ข้อมูล VPS ในคู่มือนี้

```
IP  : 187.127.102.131
User: root
OS  : Ubuntu 22.04 LTS
```

---

## 2. เชื่อมต่อ VPS

```bash
ssh root@187.127.102.131
```

ตรวจสอบ OS version:

```bash
lsb_release -a
uname -r
```

ผลที่ควรได้:
```
Description: Ubuntu 22.04.x LTS
```

อัปเดต package list:

```bash
apt update && apt upgrade -y
```

---

## 3. ติดตั้ง Docker

### 3.1 ติดตั้ง Docker Engine

```bash
curl -fsSL https://get.docker.com | sh
```

### 3.2 ตรวจสอบการติดตั้ง

```bash
docker --version
docker compose version
```

ผลที่ควรได้:
```
Docker version 26.x.x, build ...
Docker Compose version v2.x.x
```

### 3.3 เปิดใช้ Docker ตอนเริ่ม OS

```bash
systemctl enable docker
systemctl start docker
```

---

## 4. สร้างโครงสร้างไฟล์

```bash
mkdir -p /opt/mosquitto/{config,data,log}
mkdir -p /opt/mosquitto/nodered/{data,lib/decoders}
```

### ตั้งค่า Permission

```bash
# Mosquitto ใช้ user ID 1883 ภายใน container
chown -R 1883:1883 /opt/mosquitto/data
chown -R 1883:1883 /opt/mosquitto/log

# Node-RED ใช้ user ID 1000 ภายใน container
chown -R 1000:1000 /opt/mosquitto/nodered/data
chown -R 1000:1000 /opt/mosquitto/nodered/lib
```

### ตรวจสอบโครงสร้าง

```bash
ls -la /opt/mosquitto/
```

ผลที่ควรได้:
```
drwxr-xr-x  config/
drwxr-xr-x  data/      (owner: 1883)
drwxr-xr-x  log/       (owner: 1883)
drwxr-xr-x  nodered/
```

---

## 5. สร้าง Config Files

### 5.1 mosquitto.conf

```bash
cat > /opt/mosquitto/config/mosquitto.conf << 'EOF'
# ============================================
# Mosquitto MQTT Broker — Solar IoT
# รองรับ 1000 Devices
# Broker: 187.127.102.131:1883
# ============================================

# --- MQTT TCP ---
listener 1883 0.0.0.0
max_connections 2000
socket_domain ipv4

# --- MQTT WebSocket (สำหรับ Website) ---
listener 9001 0.0.0.0
protocol websockets
max_connections 500
socket_domain ipv4

# --- Authentication ---
allow_anonymous false
password_file /mosquitto/config/passwd

# --- Authorization ---
acl_file /mosquitto/config/aclfile

# --- Performance ---
set_tcp_nodelay true

# --- Session Limits ---
max_inflight_messages 20
max_queued_messages 1000
queue_qos0_messages false
message_size_limit 10485760
retry_interval 20

# --- Persistence ---
persistence true
persistence_location /mosquitto/data/
persistence_file mosquitto.db
autosave_interval 1800

# --- Monitoring ---
sys_interval 30
connection_messages true

# --- Logging ---
log_dest file /mosquitto/log/mosquitto.log
log_dest stdout
log_type error
log_type warning
log_type notice
log_timestamp true
EOF
```

### 5.2 aclfile

```bash
cat > /opt/mosquitto/config/aclfile << 'EOF'
# ============================================
# ACL — Solar IoT
# ============================================

# ===== DEVICE =====
# %c = ClientID (= EMEI — hardcoded ในอุปกรณ์)
# %u = Username (= Solarstreetlight — shared ทุกอุปกรณ์)
pattern write /solar/%c/pub
pattern read  /solar/%c/sub

# ===== NODE-RED =====
user nodered
topic read  /solar/+/pub
topic write /solar/+/pub
topic write /solar/+/sub

# ===== WEBSITE (optional) =====
user website
topic read  /solar/+/pub
topic write /solar/+/sub
EOF
```

### 5.3 ตรวจสอบ Config

```bash
cat /opt/mosquitto/config/mosquitto.conf
cat /opt/mosquitto/config/aclfile
```

---

## 6. สร้าง Password File

> **สำคัญ:** user `Solarstreetlight` และ password ต้องตรงกับค่าที่ hardcode ในอุปกรณ์ — ห้ามเปลี่ยนเด็ดขาด

### 6.1 สร้างไฟล์ว่างและกำหนด Permission

```bash
touch /opt/mosquitto/config/passwd
chmod 600 /opt/mosquitto/config/passwd
```

### 6.2 เพิ่ม Device User (HARDCODED — ห้ามเปลี่ยน)

```bash
docker run --rm \
  -v /opt/mosquitto/config/passwd:/passwd \
  eclipse-mosquitto:2.0.18 \
  mosquitto_passwd -b /passwd "Solarstreetlight" "YOUR_DEVICE_PASSWORD"
```

> แทน `YOUR_DEVICE_PASSWORD` ด้วย password จริงที่ hardcode ใน firmware

### 6.3 เพิ่ม Node-RED User

```bash
docker run --rm \
  -v /opt/mosquitto/config/passwd:/passwd \
  eclipse-mosquitto:2.0.18 \
  mosquitto_passwd -b /passwd "nodered" "YOUR_NODERED_PASSWORD"
```

> ตั้ง password เองได้ — บันทึกไว้ใช้ใน `.env`

### 6.4 ตรวจสอบ Password File

```bash
cat /opt/mosquitto/config/passwd
```

ผลที่ควรได้ (password จะถูก hash):
```
Solarstreetlight:$7$101$...hashed...
nodered:$7$101$...hashed...
```

---

## 7. สร้าง docker-compose.yml

```bash
cat > /opt/mosquitto/docker-compose.yml << 'EOF'
services:

  # ===== Container 1: Mosquitto MQTT Broker =====
  mosquitto:
    image: eclipse-mosquitto:2.0.18
    container_name: mosquitto-solar
    restart: unless-stopped
    hostname: mosquitto-solar

    ports:
      - "1883:1883"
      - "9001:9001"

    volumes:
      - ./config:/mosquitto/config:ro
      - ./data:/mosquitto/data:rw
      - ./log:/mosquitto/log:rw

    ulimits:
      nofile:
        soft: 100000
        hard: 100000

    healthcheck:
      test: ["CMD", "mosquitto_sub", "-h", "localhost", "-t", "$$SYS/broker/uptime", "-C", "1",
             "-u", "nodered", "-P", "${NODERED_MQTT_PASS}"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s

    networks:
      - iot-net

  # ===== Container 2: Node-RED =====
  nodered:
    image: nodered/node-red:latest
    container_name: nodered-solar
    restart: unless-stopped
    hostname: nodered-solar

    ports:
      - "1880:1880"

    volumes:
      - ./nodered/data:/data
      - ./nodered/lib/decoders:/data/decoders

    environment:
      - TZ=Asia/Bangkok
      - NODE_RED_CREDENTIAL_SECRET=${NR_CREDENTIAL_SECRET}

    depends_on:
      mosquitto:
        condition: service_healthy

    networks:
      - iot-net

networks:
  iot-net:
    driver: bridge
EOF
```

---

## 8. สร้าง .env File

```bash
cat > /opt/mosquitto/.env << 'EOF'
# Password ของ user nodered (ตั้งเองได้ — ต้องตรงกับที่สร้างใน passwd file)
NODERED_MQTT_PASS=YOUR_NODERED_PASSWORD

# Secret key สำหรับเข้ารหัส credentials ของ Node-RED (random string)
NR_CREDENTIAL_SECRET=CHANGE_THIS_TO_RANDOM_64_CHAR_STRING
EOF
```

### สร้าง Random Secret Key

```bash
openssl rand -hex 32
```

คัดลอก output แล้วใส่แทน `CHANGE_THIS_TO_RANDOM_64_CHAR_STRING` ใน `.env`:

```bash
nano /opt/mosquitto/.env
```

### กำหนด Permission ของ .env

```bash
chmod 600 /opt/mosquitto/.env
```

---

## 9. ปรับ Linux Kernel

เพิ่ม performance parameters สำหรับรองรับ connection จำนวนมาก:

```bash
cat >> /etc/sysctl.conf << 'EOF'

# === Solar IoT MQTT Tuning ===
fs.file-max = 100000
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_keepalive_time = 600
net.ipv4.ip_local_port_range = 1024 65535
net.core.rmem_max = 65536
net.core.wmem_max = 65536
net.ipv4.tcp_rmem = 4096 16384 65536
net.ipv4.tcp_wmem = 4096 16384 65536
EOF
```

```bash
sysctl -p
```

ตรวจสอบค่า:

```bash
sysctl fs.file-max
```

ผลที่ควรได้:
```
fs.file-max = 100000
```

---

## 10. เริ่มระบบ

### 10.1 ตรวจสอบไฟล์ทั้งหมดก่อนรัน

```bash
ls -la /opt/mosquitto/
ls -la /opt/mosquitto/config/
```

ต้องมีครบ:
```
/opt/mosquitto/
├── .env
├── docker-compose.yml
├── config/
│   ├── aclfile
│   ├── mosquitto.conf
│   └── passwd
├── data/
├── log/
└── nodered/
    ├── data/
    └── lib/decoders/
```

### 10.2 Pull Docker Images

```bash
cd /opt/mosquitto
docker compose pull
```

### 10.3 รัน Containers

```bash
docker compose up -d
```

### 10.4 ดู Log ขณะ Start

```bash
docker compose logs -f
```

กด `Ctrl+C` เพื่อออกจาก log

---

## 11. ตรวจสอบระบบ

### 11.1 ตรวจสอบ Container Status

```bash
docker ps
```

ผลที่ควรได้:
```
CONTAINER ID   IMAGE                        STATUS
xxxxxxxxxxxx   eclipse-mosquitto:2.0.18     Up X minutes (healthy)
xxxxxxxxxxxx   nodered/node-red:latest      Up X minutes
```

> **สำคัญ:** Mosquitto ต้อง `(healthy)` ก่อน Node-RED จึงจะ start

### 11.2 ตรวจสอบ Mosquitto Log

```bash
docker logs mosquitto-solar --tail 20
```

ผลที่ควรได้:
```
1234567890: mosquitto version 2.0.18 starting
1234567890: Config loaded from /mosquitto/config/mosquitto.conf
1234567890: Opening ipv4 listen socket on port 1883
1234567890: Opening ipv4 listen socket on port 9001
1234567890: mosquitto version 2.0.18 running
```

### 11.3 ตรวจสอบ Node-RED Log

```bash
docker logs nodered-solar --tail 20
```

ผลที่ควรได้:
```
[info] Starting flows
[info] Started flows
[info] Server now running at http://127.0.0.1:1880/
```

### 11.4 ตรวจสอบ Port

```bash
ss -tlnp | grep -E '1883|9001|1880'
```

ผลที่ควรได้:
```
LISTEN  0  ...  0.0.0.0:1883  ...
LISTEN  0  ...  0.0.0.0:9001  ...
LISTEN  0  ...  0.0.0.0:1880  ...
```

### 11.5 ตรวจสอบ Active Connections (MQTT)

```bash
docker exec mosquitto-solar \
  mosquitto_sub -h localhost -t '$SYS/broker/clients/active' -C 1 \
  -u nodered -P "YOUR_NODERED_PASSWORD"
```

---

## 12. ทดสอบ MQTT

ติดตั้ง mosquitto client บน VPS:

```bash
apt install -y mosquitto-clients
```

### 12.1 Subscribe รอรับข้อมูล (Terminal 1)

```bash
mosquitto_sub \
  -h 187.127.102.131 \
  -t "/solar/+/pub" \
  -u "nodered" \
  -P "YOUR_NODERED_PASSWORD" \
  -v
```

### 12.2 Publish ทดสอบ (Terminal 2)

จำลอง device ส่งข้อมูล:

```bash
mosquitto_pub \
  -h 187.127.102.131 \
  -t "/solar/864865083329673/pub" \
  -m '{"test":"hello"}' \
  -u "Solarstreetlight" \
  -P "YOUR_DEVICE_PASSWORD" \
  -i "864865083329673"
```

> ต้องใช้ `-i` (ClientID = EMEI) เพราะ ACL ตรวจสอบด้วย `%c`

ผลที่ควรได้ใน Terminal 1:
```
/solar/864865083329673/pub {"test":"hello"}
```

### 12.3 ทดสอบ ACL — Device ส่ง topic ของตัวเองเท่านั้น

```bash
# ลองส่ง topic ของ device อื่น — ต้องถูก DENY
mosquitto_pub \
  -h 187.127.102.131 \
  -t "/solar/999999999999999/pub" \
  -m "test" \
  -u "Solarstreetlight" \
  -P "YOUR_DEVICE_PASSWORD" \
  -i "864865083329673"
```

ผลที่ควรได้:
```
Error: Connection refused
```
หรือ publish สำเร็จแต่ Mosquitto log แสดง ACL denied

---

## 13. ตั้งค่า Node-RED

### 13.1 เปิด Node-RED Editor

เปิด Browser ไปที่:
```
http://187.127.102.131:1880
```

### 13.2 ติดตั้ง Palette ที่จำเป็น

ไปที่ **Menu (☰) → Manage palette → Install**

ติดตั้ง:
- `node-red-dashboard` — UI Dashboard
- `node-red-contrib-mqtt-broker` (optional)

### 13.3 สร้าง MQTT Broker Config

1. ลาก **mqtt in** node ลงใน canvas
2. ดับเบิลคลิก → คลิก **ดินสอ** ที่ Server
3. ตั้งค่า:

| Field | ค่า |
|-------|-----|
| Server | `mosquitto-solar` (hostname ใน docker network) |
| Port | `1883` |
| Client ID | `nodered-client` |
| Username | `nodered` |
| Password | YOUR_NODERED_PASSWORD |

4. **Add** → **Done**

### 13.4 สร้าง Flow พื้นฐาน

**Flow: Subscribe → Debug**

```
[mqtt in: /solar/+/pub] → [debug]
```

1. **mqtt in** node:
   - Topic: `/solar/+/pub`
   - QoS: 0
   - Output: Buffer (สำหรับ binary data)

2. **debug** node:
   - Output: complete msg object

3. **Deploy** → ดูผลใน Debug tab

---

## 14. ตั้งค่า Firewall

```bash
# ติดตั้ง ufw
apt install -y ufw

# ตั้งค่า default policy
ufw default deny incoming
ufw default allow outgoing

# เปิด port ที่จำเป็น
ufw allow 22/tcp    # SSH
ufw allow 1883/tcp  # MQTT TCP (devices — hardcoded)
ufw allow 9001/tcp  # MQTT WebSocket
ufw allow 1880/tcp  # Node-RED UI

# เปิดใช้งาน
ufw enable
```

ตรวจสอบ:

```bash
ufw status verbose
```

ผลที่ควรได้:
```
Status: active

To                    Action    From
--                    ------    ----
22/tcp                ALLOW IN  Anywhere
1883/tcp              ALLOW IN  Anywhere
9001/tcp              ALLOW IN  Anywhere
1880/tcp              ALLOW IN  Anywhere
```

---

## 15. ตั้งค่า Auto Backup

### 15.1 สร้าง Backup Script

```bash
mkdir -p /root/scripts

cat > /root/scripts/backup-solar.sh << 'SCRIPT'
#!/bin/bash
BACKUP_DIR="/root/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/solar-$DATE.tar.gz"

mkdir -p "$BACKUP_DIR"

tar -czf "$BACKUP_FILE" \
  /opt/mosquitto/config \
  /opt/mosquitto/data \
  /opt/mosquitto/nodered/data

echo "Backup: $BACKUP_FILE ($(du -sh $BACKUP_FILE | cut -f1))"

# ลบ backup เก่ากว่า 30 วัน
find "$BACKUP_DIR" -name "solar-*.tar.gz" -mtime +30 -delete
SCRIPT

chmod +x /root/scripts/backup-solar.sh
```

### 15.2 ตั้ง Cron Job

```bash
crontab -e
```

เพิ่มบรรทัด:

```
# Backup Solar IoT ทุกวัน 02:00
0 2 * * * /root/scripts/backup-solar.sh >> /var/log/solar-backup.log 2>&1
```

### 15.3 ทดสอบ Backup

```bash
/root/scripts/backup-solar.sh
ls -lh /root/backups/
```

### 15.4 Restore (กรณีฉุกเฉิน)

```bash
# หยุด containers
docker compose -f /opt/mosquitto/docker-compose.yml down

# Backup ของเดิม
mv /opt/mosquitto /opt/mosquitto.old

# Restore
tar -xzf /root/backups/solar-YYYYMMDD_HHMMSS.tar.gz -C /

# แก้ permission
chown -R 1883:1883 /opt/mosquitto/data /opt/mosquitto/log
chown -R 1000:1000 /opt/mosquitto/nodered/data

# รัน
docker compose -f /opt/mosquitto/docker-compose.yml up -d
```

---

## 16. คำสั่งที่ใช้บ่อย

### Docker Compose

| คำสั่ง | คำอธิบาย |
|--------|----------|
| `docker compose -f /opt/mosquitto/docker-compose.yml up -d` | เริ่มทั้งหมด |
| `docker compose -f /opt/mosquitto/docker-compose.yml down` | หยุดทั้งหมด |
| `docker compose -f /opt/mosquitto/docker-compose.yml restart` | รีสตาร์ท |
| `docker compose -f /opt/mosquitto/docker-compose.yml logs -f` | Log ทั้งหมด |
| `docker compose -f /opt/mosquitto/docker-compose.yml pull` | อัปเดต images |

### Mosquitto

| คำสั่ง | คำอธิบาย |
|--------|----------|
| `docker logs mosquitto-solar -f` | Log แบบ realtime |
| `docker kill --signal=HUP mosquitto-solar` | Reload config (ไม่ restart) |
| `docker exec mosquitto-solar mosquitto_sub -h localhost -t '$SYS/broker/clients/active' -C 1 -u nodered -P "PASS"` | ดู active connections |

### Node-RED

| คำสั่ง | คำอธิบาย |
|--------|----------|
| `docker logs nodered-solar -f` | Log แบบ realtime |
| `docker restart nodered-solar` | รีสตาร์ท Node-RED |

### เพิ่ม MQTT User ใหม่

```bash
# เพิ่ม user ใหม่
docker exec -it mosquitto-solar \
  mosquitto_passwd /mosquitto/config/passwd NEW_USERNAME

# Reload Mosquitto รับ password ใหม่
docker kill --signal=HUP mosquitto-solar
```

---

## 17. การแก้ปัญหา

### Container ไม่ Start

```bash
docker compose -f /opt/mosquitto/docker-compose.yml logs
```

---

### Mosquitto: `Error: Unable to open pwfile`

```bash
ls -la /opt/mosquitto/config/passwd
```

ถ้าไม่มีไฟล์:
```bash
touch /opt/mosquitto/config/passwd
chmod 600 /opt/mosquitto/config/passwd
```

---

### Mosquitto: healthcheck ไม่ผ่าน

ตรวจสอบว่า user `nodered` มีใน passwd:

```bash
grep "nodered" /opt/mosquitto/config/passwd
```

ตรวจสอบว่า password ใน `.env` ตรงกับที่สร้างใน passwd:

```bash
cat /opt/mosquitto/.env
```

ทดสอบ connect ด้วยมือ:

```bash
docker exec mosquitto-solar \
  mosquitto_sub -h localhost -t '$SYS/broker/uptime' -C 1 \
  -u nodered -P "YOUR_NODERED_PASSWORD"
```

---

### Device Connect ไม่ได้

```bash
# ดู log realtime
docker logs mosquitto-solar -f

# ตรวจสอบ port
ss -tlnp | grep 1883

# ตรวจสอบ firewall
ufw status
```

สาเหตุที่พบบ่อย:

| อาการ | สาเหตุ | วิธีแก้ |
|-------|--------|--------|
| `Connection refused` | Port ปิด หรือ container ไม่รัน | เปิด firewall + ตรวจสอบ container |
| `Not authorized` | User/Password ผิด หรือไม่มีใน passwd | ตรวจสอบ passwd file |
| `ACL denied` | ClientID ไม่ตรงกับ topic | ตรวจสอบ `-i EMEI` ในคำสั่ง |
| Device เชื่อมต่อได้แต่ข้อมูลไม่มา | Topic ผิด | ตรวจสอบ topic ใน firmware |

---

### Node-RED ไม่รับข้อมูลจาก MQTT

1. ตรวจสอบ MQTT Broker config ใน Node-RED: Server = `mosquitto-solar`, Port = `1883`
2. ตรวจสอบ credentials: user = `nodered`
3. ดู Node-RED log:

```bash
docker logs nodered-solar --tail 30
```

---

### ดู Active Connections

```bash
# จำนวน device ที่เชื่อมต่ออยู่
docker exec mosquitto-solar \
  mosquitto_sub -h localhost -t '$SYS/broker/clients/connected' -C 1 \
  -u nodered -P "YOUR_NODERED_PASSWORD"

# จำนวน message ที่รับทั้งหมด
docker exec mosquitto-solar \
  mosquitto_sub -h localhost -t '$SYS/broker/messages/received' -C 1 \
  -u nodered -P "YOUR_NODERED_PASSWORD"
```

---

## สรุป Checklist ก่อน Go Live

```
[ ] Docker ติดตั้งแล้ว
[ ] โครงสร้างไฟล์ครบ (/opt/mosquitto/...)
[ ] mosquitto.conf สร้างแล้ว
[ ] aclfile สร้างแล้ว
[ ] passwd file มี Solarstreetlight (device user — hardcoded)
[ ] passwd file มี nodered user
[ ] docker-compose.yml สร้างแล้ว
[ ] .env สร้างแล้ว (NODERED_MQTT_PASS ตรงกับ passwd)
[ ] Linux kernel tuning ทำแล้ว
[ ] Containers รันและ healthy
[ ] Firewall เปิด port 1883, 9001, 1880
[ ] ทดสอบ MQTT publish/subscribe ผ่าน
[ ] Node-RED เปิดได้ที่ port 1880
[ ] Auto backup ตั้งค่าแล้ว
```
