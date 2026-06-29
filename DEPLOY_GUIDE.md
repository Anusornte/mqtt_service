# คู่มือ Deploy — Solar IoT MQTT Server
## Mosquitto + Node-RED บน VPS ผ่าน GitHub

---

## Quick Start (ทำตามลำดับ)

```bash
# 1. SSH เข้า VPS
ssh root@187.127.102.131

# 2. ติดตั้ง Docker
curl -fsSL https://get.docker.com | sh

# 3. Clone โปรเจคจาก GitHub
git clone https://github.com/Anusornte/mqtt_service.git /opt/solar
cd /opt/solar

# 4. รัน setup script (สร้าง dirs, .env, passwd, kernel tuning)
bash setup.sh

# 5. แก้ไข .env ใส่ค่าจริง
nano VPS_Deploy/.env

# 6. รัน containers
cd VPS_Deploy
docker compose up -d

# 7. ตรวจสอบ
docker ps
```

---

## สารบัญ

1. [ข้อกำหนดเบื้องต้น](#1-ข้อกำหนดเบื้องต้น)
2. [เชื่อมต่อ VPS](#2-เชื่อมต่อ-vps)
3. [ติดตั้ง Docker](#3-ติดตั้ง-docker)
4. [Clone จาก GitHub](#4-clone-จาก-github)
5. [รัน setup.sh](#5-รัน-setupsh)
6. [ตั้งค่า .env](#6-ตั้งค่า-env)
7. [สร้าง passwd (MQTT Users)](#7-สร้าง-passwd-mqtt-users)
8. [เริ่มระบบ](#8-เริ่มระบบ)
9. [ตรวจสอบระบบ](#9-ตรวจสอบระบบ)
10. [ทดสอบ MQTT](#10-ทดสอบ-mqtt)
11. [ตั้งค่า Node-RED](#11-ตั้งค่า-node-red)
12. [ตั้งค่า Firewall](#12-ตั้งค่า-firewall)
13. [ตั้งค่า Auto Backup](#13-ตั้งค่า-auto-backup)
14. [อัปเดตโปรเจค (git pull)](#14-อัปเดตโปรเจค-git-pull)
15. [คำสั่งที่ใช้บ่อย](#15-คำสั่งที่ใช้บ่อย)
16. [การแก้ปัญหา](#16-การแก้ปัญหา)

---

## 1. ข้อกำหนดเบื้องต้น

### VPS Spec แนะนำ (รองรับ 1000 devices)

| รายการ | ขั้นต่ำ | แนะนำ |
|--------|--------|--------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Disk | 20 GB | 40 GB |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

### Port ที่ต้องเปิด

| Port | ใช้สำหรับ | หมายเหตุ |
|------|-----------|---------|
| 22 | SSH | — |
| 1883 | MQTT TCP | **Hardcoded ในอุปกรณ์ — ห้ามเปลี่ยน** |
| 9001 | MQTT WebSocket | สำหรับ Website |
| 1880 | Node-RED UI | — |

### โครงสร้างไฟล์บน VPS หลัง clone

```
/opt/solar/                          ← git clone ลงที่นี่
├── setup.sh                         ← รันครั้งแรกครั้งเดียว
├── DEPLOY_GUIDE.md
│
└── VPS_Deploy/                      ← ทำงานในโฟลเดอร์นี้
    ├── docker-compose.yml
    ├── .env.example                 ← template (อยู่ใน git)
    ├── .env                         ← สร้างจาก .env.example (ไม่อยู่ใน git)
    │
    ├── mosquitto/
    │   └── config/
    │       ├── mosquitto.conf       ← อยู่ใน git
    │       ├── aclfile              ← อยู่ใน git
    │       └── passwd               ← สร้างบน VPS (ไม่อยู่ใน git)
    │
    └── nodered/
        ├── data/                    ← Node-RED flows (ไม่อยู่ใน git)
        └── lib/decoders/
            └── ti_protocol.js      ← อยู่ใน git
```

---

## 2. เชื่อมต่อ VPS

```bash
ssh root@187.127.102.131
```

อัปเดต package list:

```bash
apt update && apt upgrade -y
```

---

## 3. ติดตั้ง Docker

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker
```

ตรวจสอบ:

```bash
docker --version
docker compose version
```

ผลที่ควรได้:
```
Docker version 26.x.x
Docker Compose version v2.x.x
```

---

## 4. Clone จาก GitHub

```bash
git clone https://github.com/Anusornte/mqtt_service.git /opt/solar
cd /opt/solar
```

ตรวจสอบไฟล์ที่ได้:

```bash
ls -la
ls -la VPS_Deploy/
```

---

## 5. รัน setup.sh

`setup.sh` จะทำสิ่งเหล่านี้ให้อัตโนมัติ:
- สร้าง directories ที่จำเป็น (data/, log/, nodered/data/)
- ตั้งค่า permission (chown)
- Copy `.env.example` → `.env` พร้อม generate secret key อัตโนมัติ
- สร้าง `passwd` file และถามหา Device Password
- ปรับ Linux kernel สำหรับ 1000 connections

```bash
bash /opt/solar/setup.sh
```

> `setup.sh` จะถามหา **Device Password** (`Solarstreetlight`) ระหว่างรัน
> — ใส่ password ที่ hardcode ในอุปกรณ์ กด Enter

---

## 6. ตั้งค่า .env

`setup.sh` สร้าง `.env` ให้แล้ว แต่ต้องตรวจสอบ `NODERED_MQTT_PASS`:

```bash
nano /opt/solar/VPS_Deploy/.env
```

เนื้อหาใน `.env`:

```env
# Password ของ user nodered (ตั้งเองได้)
NODERED_MQTT_PASS=YOUR_NODERED_PASSWORD

# Secret key สำหรับเข้ารหัส Node-RED credentials (auto-generated โดย setup.sh)
NR_CREDENTIAL_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> `NR_CREDENTIAL_SECRET` ถูก generate อัตโนมัติโดย `setup.sh` — ไม่ต้องเปลี่ยน
> ห้ามเปลี่ยน `NR_CREDENTIAL_SECRET` หลังจาก Node-RED รันไปแล้ว

กำหนด permission:

```bash
chmod 600 /opt/solar/VPS_Deploy/.env
```

---

## 7. สร้าง passwd (MQTT Users)

> ถ้า `setup.sh` ทำให้แล้วใน ขั้นที่ 5 — ข้ามหัวข้อนี้ได้

### ตรวจสอบว่ามี passwd แล้ว

```bash
cat /opt/solar/VPS_Deploy/mosquitto/config/passwd
```

ผลที่ควรได้:
```
Solarstreetlight:$7$101$...hashed...
nodered:$7$101$...hashed...
```

### สร้างใหม่ (ถ้ายังไม่มี)

```bash
PASSWD=/opt/solar/VPS_Deploy/mosquitto/config/passwd
touch $PASSWD && chmod 600 $PASSWD

# Device user (HARDCODED — ห้ามเปลี่ยน)
docker run --rm -v $PASSWD:/passwd eclipse-mosquitto:2.0.18 \
  mosquitto_passwd -b /passwd "Solarstreetlight" "YOUR_DEVICE_PASSWORD"

# Node-RED user (ต้องตรงกับ NODERED_MQTT_PASS ใน .env)
docker run --rm -v $PASSWD:/passwd eclipse-mosquitto:2.0.18 \
  mosquitto_passwd -b /passwd "nodered" "YOUR_NODERED_PASSWORD"
```

---

## 8. เริ่มระบบ

```bash
cd /opt/solar/VPS_Deploy
docker compose up -d
```

ดู log ขณะ start:

```bash
docker compose logs -f
```

กด `Ctrl+C` เพื่อออก

---

## 9. ตรวจสอบระบบ

### Container Status

```bash
docker ps
```

ผลที่ควรได้:
```
CONTAINER ID   IMAGE                      STATUS
xxxxxxxxxxxx   eclipse-mosquitto:2.0.18   Up X minutes (healthy)
xxxxxxxxxxxx   nodered/node-red:latest    Up X minutes
```

> Mosquitto ต้องเป็น `(healthy)` ก่อน — Node-RED จะ start หลังจากนั้น

### Mosquitto Log

```bash
docker logs mosquitto-solar --tail 20
```

ผลที่ควรได้:
```
mosquitto version 2.0.18 starting
Config loaded from /mosquitto/config/mosquitto.conf
Opening ipv4 listen socket on port 1883
Opening ipv4 listen socket on port 9001
mosquitto version 2.0.18 running
```

### Node-RED Log

```bash
docker logs nodered-solar --tail 20
```

ผลที่ควรได้:
```
[info] Starting flows
[info] Started flows
[info] Server now running at http://127.0.0.1:1880/
```

### ตรวจสอบ Port

```bash
ss -tlnp | grep -E '1883|9001|1880'
```

---

## 10. ทดสอบ MQTT

ติดตั้ง mosquitto client:

```bash
apt install -y mosquitto-clients
```

### Subscribe รอรับข้อมูล (Terminal 1)

```bash
mosquitto_sub \
  -h 127.0.0.1 -t "/solar/+/pub" \
  -u "nodered" -P "YOUR_NODERED_PASSWORD" -v
```

### จำลอง Device ส่งข้อมูล (Terminal 2)

```bash
mosquitto_pub \
  -h 127.0.0.1 \
  -t "/solar/864865083329673/pub" \
  -m '{"test":"hello"}' \
  -u "Solarstreetlight" \
  -P "YOUR_DEVICE_PASSWORD" \
  -i "864865083329673"
```

> `-i` คือ ClientID = EMEI — ACL ใช้ `%c` ตรวจสอบ topic ต้องตรงกัน

ผลที่ควรได้ใน Terminal 1:
```
/solar/864865083329673/pub {"test":"hello"}
```

### ทดสอบ ACL (Device ส่ง topic ตัวเองเท่านั้น)

```bash
# ลอง publish topic ของ device อื่น — Mosquitto ต้อง deny
mosquitto_pub \
  -h 127.0.0.1 \
  -t "/solar/999999999999999/pub" \
  -m "test" \
  -u "Solarstreetlight" \
  -P "YOUR_DEVICE_PASSWORD" \
  -i "864865083329673"
```

ดู log ว่า ACL denied:
```bash
docker logs mosquitto-solar --tail 5
```

---

## 11. ตั้งค่า Node-RED

เปิด Browser:
```
http://187.127.102.131:1880
```

### MQTT Broker Config ใน Node-RED

1. ลาก **mqtt in** node → ดับเบิลคลิก → คลิก **ดินสอ** ที่ Server
2. ตั้งค่า:

| Field | ค่า |
|-------|-----|
| Server | `mosquitto-solar` |
| Port | `1883` |
| Client ID | `nodered-client` |
| Username | `nodered` |
| Password | `YOUR_NODERED_PASSWORD` |

> ใช้ hostname `mosquitto-solar` (ไม่ใช่ IP) — containers อยู่ใน docker network เดียวกัน

### Flow พื้นฐาน

```
[mqtt in: /solar/+/pub]  →  [debug]
```

- Topic: `/solar/+/pub`
- QoS: `0`
- Output: `Buffer` (สำหรับ binary data)

**Deploy** → ดูผลใน Debug tab

---

## 12. ตั้งค่า Firewall

```bash
apt install -y ufw

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 1883/tcp
ufw allow 9001/tcp
ufw allow 1880/tcp
ufw enable
```

ตรวจสอบ:

```bash
ufw status
```

---

## 13. ตั้งค่า Auto Backup

### สร้าง Backup Script

```bash
mkdir -p /root/scripts

cat > /root/scripts/backup-solar.sh << 'SCRIPT'
#!/bin/bash
BACKUP_DIR="/root/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

tar -czf "$BACKUP_DIR/solar-$DATE.tar.gz" \
  /opt/solar/VPS_Deploy/mosquitto/config \
  /opt/solar/VPS_Deploy/nodered/data \
  /opt/solar/VPS_Deploy/.env

echo "Backup: solar-$DATE.tar.gz ($(du -sh $BACKUP_DIR/solar-$DATE.tar.gz | cut -f1))"
find "$BACKUP_DIR" -name "solar-*.tar.gz" -mtime +30 -delete
SCRIPT

chmod +x /root/scripts/backup-solar.sh
```

### ตั้ง Cron Job

```bash
crontab -e
```

เพิ่มบรรทัด:

```
0 2 * * * /root/scripts/backup-solar.sh >> /var/log/solar-backup.log 2>&1
```

### Restore

```bash
cd /opt/solar/VPS_Deploy
docker compose down
tar -xzf /root/backups/solar-YYYYMMDD_HHMMSS.tar.gz -C /
chown -R 1883:1883 /opt/solar/VPS_Deploy/mosquitto/data
chown -R 1000:1000 /opt/solar/VPS_Deploy/nodered/data
docker compose up -d
```

---

## 14. อัปเดตโปรเจค (git pull)

เมื่อมี config หรือ code เปลี่ยนใน GitHub:

```bash
cd /opt/solar

# pull latest
git pull

# restart containers รับ config ใหม่
cd container
docker compose down
docker compose up -d
```

> `.env` และ `passwd` ไม่ถูกเขียนทับ — อยู่ใน `.gitignore`

---

## 15. คำสั่งที่ใช้บ่อย

### Docker Compose (รันจาก `/opt/solar/VPS_Deploy/`)

| คำสั่ง | คำอธิบาย |
|--------|----------|
| `docker compose up -d` | เริ่มทั้งหมด |
| `docker compose down` | หยุดทั้งหมด |
| `docker compose restart` | รีสตาร์ท |
| `docker compose logs -f` | Log ทั้งหมด realtime |
| `docker compose pull && docker compose up -d` | อัปเดต image |

### Mosquitto

| คำสั่ง | คำอธิบาย |
|--------|----------|
| `docker logs mosquitto-solar -f` | Log realtime |
| `docker kill --signal=HUP mosquitto-solar` | Reload config (ไม่ restart) |

### เพิ่ม MQTT User ใหม่

```bash
docker exec -it mosquitto-solar \
  mosquitto_passwd /mosquitto/config/passwd NEW_USER

docker kill --signal=HUP mosquitto-solar
```

### ดู Active Connections

```bash
docker exec mosquitto-solar \
  mosquitto_sub -h localhost -t '$SYS/broker/clients/connected' -C 1 \
  -u nodered -P "YOUR_NODERED_PASSWORD"
```

---

## 16. การแก้ปัญหา

### Container ไม่ Start

```bash
cd /opt/solar/VPS_Deploy
docker compose logs
```

---

### Mosquitto: `Error: Unable to open pwfile`

```bash
ls -la /opt/solar/VPS_Deploy/mosquitto/config/passwd
```

ถ้าไม่มี:
```bash
touch /opt/solar/VPS_Deploy/mosquitto/config/passwd
chmod 600 /opt/solar/VPS_Deploy/mosquitto/config/passwd
```

---

### Mosquitto healthcheck ไม่ผ่าน

ตรวจสอบว่า `NODERED_MQTT_PASS` ใน `.env` ตรงกับ `passwd`:

```bash
cat /opt/solar/VPS_Deploy/.env

docker exec mosquitto-solar \
  mosquitto_sub -h localhost -t '$SYS/broker/uptime' -C 1 \
  -u nodered -P "YOUR_NODERED_PASSWORD"
```

---

### Device Connect ไม่ได้

| อาการ | สาเหตุ | วิธีแก้ |
|-------|--------|--------|
| `Connection refused` | Port ปิด / container ไม่รัน | `ufw allow 1883` + ตรวจ `docker ps` |
| `Not authorized` | Password ผิด / ไม่มีใน passwd | ตรวจสอบ passwd file |
| `ACL denied` | ClientID ไม่ตรงกับ topic | ตรวจ `-i EMEI` ให้ตรงกับ topic |

```bash
docker logs mosquitto-solar -f
```

---

### Node-RED ไม่รับข้อมูล MQTT

1. Server ต้องเป็น `mosquitto-solar` (hostname) ไม่ใช่ IP
2. Port: `1883`
3. ตรวจสอบ log:

```bash
docker logs nodered-solar --tail 30
```

---

## Checklist ก่อน Go Live

```
[ ] git clone สำเร็จ (/opt/solar/)
[ ] bash setup.sh สำเร็จ (ไม่มี error)
[ ] .env มี NODERED_MQTT_PASS ถูกต้อง
[ ] passwd มี Solarstreetlight (device — hardcoded)
[ ] passwd มี nodered (NODERED_MQTT_PASS ตรงกับ .env)
[ ] docker compose up -d สำเร็จ
[ ] mosquitto-solar STATUS: (healthy)
[ ] nodered-solar STATUS: Up
[ ] Firewall เปิด port 1883, 9001, 1880
[ ] ทดสอบ MQTT publish/subscribe ผ่าน
[ ] Node-RED เปิดได้ที่ http://187.127.102.131:1880
[ ] Auto backup ตั้งค่าแล้ว
```
