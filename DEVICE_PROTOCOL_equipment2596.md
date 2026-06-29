# Device Protocol Reference: equipment2596 (IMEI 864865083329673)

> **Source:** Cross-referenced raw MQTT payloads against dashboard values  
> **Date calibrated:** 2026-06-28 ~ 2026-06-29  
> **Status:** Voltage + Daily ✅ | Current + Temp + SOC ❌ (pending)

---

## 1. MQTT Connection

| Parameter | Value |
|-----------|-------|
| Broker | `187.127.102.131:1883` |
| Username | `Solarstreetlight` |
| Password | `Nongaom@1Anusorn` |
| Topic (publish) | `/solar/{IMEI}/pub` |
| Topic (subscribe/cmd) | `/solar/{IMEI}/sub` |
| Protocol | MQTT 3.1.1 |
| QoS | 0 |
| Keepalive | 240s |

---

## 2. Payload Structure (Publish — Device → Server)

Two message types, identified by `byte[13]`:

| byte[13] | Length | Name | Contains |
|----------|--------|------|----------|
| `4` | 56 bytes | **Full Telemetry** | Voltages, daily stats, (current, temp TBD) |
| `16` | 21 bytes | **Short Status** | Header only — minimal data |

### 2.1 Header (bytes 0–14, common to both types)

```
Byte  |  0 |  1 |  2 |  3 |  4 |  5 |  6 |  7 |  8 |  9 | 10 | 11 | 12 | 13 | 14 |
------+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+
ASCII |  T |  I |  & |  ? |  ? |  ? |  ? |  ? |  ? |  ? |  ? |  ? |  ? |  ? |  ? |
Hex   | 54 | 49 | 26 | 06 | 28 |  * |  * |  * | 12 | AA | 00 | 00 | 01 | 04 | 26 |
```

| Byte | Purpose | Notes |
|------|---------|-------|
| 0–3 | Start marker | `TI&\x06` (0x54492606) |
| 4 | Constant? | 0x28 = 40 (seen in all samples) |
| 5–7 | Varies | Changes with load/solar state — purpose TBD |
| 8 | Constant | 0x12 = 18 |
| 9 | Constant | 0xAA = 170 |
| 10–11 | Constant | 0x0000 |
| 12 | Constant | 0x01 |
| **13** | **Message Type** | **4 = Full 56B, 16 = Short 21B** |
| 14 | Constant? | 0x26 = 38 (seen in all samples) |

---

### 2.2 Full Telemetry (56 bytes)

#### ✅ CONFIRMED — Voltage Fields (bytes 15–20)

```
Byte  | 15 | 16 | 17 | 18 | 19 | 20 |
------+----+----+----+----+----+----+
Field | Solar V  | Battery V | Load V   |
Type  |  BE u16  |  BE u16   |  BE u16  |
```

| Bytes | Field | Type | Scale | Unit | Example (raw → value) |
|-------|-------|------|-------|------|----------------------|
| 15–16 | Solar Panel Voltage | uint16 BE | `÷ 170.7` | V | `85 → 0.50` |
| 17–18 | Battery Voltage | uint16 BE | `÷ 170.7` | V | `2214 → 12.97` |
| 19–20 | Load Voltage | uint16 BE | `÷ 170.7` | V | `7502 → 43.95` |

```python
# Python decode
import struct
solar_v  = struct.unpack('>H', data[15:17])[0] / 170.7
battery_v = struct.unpack('>H', data[17:19])[0] / 170.7
load_v    = struct.unpack('>H', data[19:21])[0] / 170.7
```

```javascript
// JavaScript decode
var solarV  = ((data[15] << 8) | data[16]) / 170.7;
var battV   = ((data[17] << 8) | data[18]) / 170.7;
var loadV   = ((data[19] << 8) | data[20]) / 170.7;
```

#### ✅ CONFIRMED — Daily Stats

| Byte | Field | Type | Scale | Unit |
|------|-------|------|-------|------|
| 32 | Daily Discharge | uint8 | `× 1` | Wh or Ah |
| 36 | Daily Charge | uint8 | `× 1` | Wh or Ah |

#### ❌ NOT FOUND — Current Fields

| Field | Expected Location | Reason Unknown |
|-------|-------------------|----------------|
| Solar Current (A) | TBD | Current didn't vary during test window |
| Battery Current (A) | TBD | (signed; − for discharge, + for charge) |
| Load Current (A) | TBD | Need ON/OFF test < 1 min apart |

**To calibrate:** Capture Full Telemetry from consecutive readings 1–2 minutes apart:
- LED OFF → wait 1 round → capture raw  
- LED ON → wait 1 round → capture raw

Diff the two arrays — bytes that change are Load-related fields.

#### ❌ NOT FOUND — Temperature

| Field | Expected Location | Reason Unknown |
|-------|-------------------|----------------|
| Equipment Temperature (°C) | TBD | Need samples with varying temperature |
| Ambient Temperature (°C) | TBD | |

#### ❌ NOT FOUND — Battery SOC

Not confirmed whether this device reports SOC at all.

---

### 2.3 Short Status (21 bytes)

```
Byte  | 0..14  | 15 | 16 | 17 | 18 | 19 | 20 |
------+--------+----+----+----+----+----+----+
Field | Header |  ? |  ? |  ? |  ? |  ? |  ? |
      | 14 B   |        7 bytes TBD          |
```

Seen during low-activity periods. Purpose of the 7 data bytes is unknown. Voltages are NOT present in this message type.

---

## 3. Downlink — Server → Device

### 3.1 Command Topic

```
/solar/864865083329673/sub
```

Publish JSON to this topic. Device subscribes and responds.

### 3.2 Command Format (TBD)

Based on NJ-iot401 protocol (`nj_iot401_decoder.py`), likely commands:

| Action | Payload | Description |
|--------|---------|-------------|
| `set_load` | `{"action":"set_load","value":1}` | Turn LED ON |
| `set_load` | `{"action":"set_load","value":0}` | Turn LED OFF |
| `reboot` | `{"action":"reboot","value":1}` | Restart module |

> ⚠️ Command format NOT verified for this device. May use NJ-iot401 binary frame format instead of JSON.

### 3.3 Command via Binary Frame (NJ-iot401 Protocol)

Reference: `nj_iot401_decoder.py`

```python
from nj_iot401_decoder import build_solar_light_switch

# Turn LED ON (dimming 100%)
frame = build_solar_light_switch(on=True, dimming=100, message_id=1)
# Publish to MQTT topic /solar/{IMEI}/sub
```

Frame structure:
```
[4E 4A] [Length 2B] [Header: equip + cmd + msgId + rssi] [Body: AC C2 AA {dim%} CA] [CRC 2B] [58 52]
  "NJ"                                                                                    "XR"
```

---

## 4. CRC — Last 2 Bytes

```
Byte  | ... | -2 | -1 |
------+-----+----+----+
Field | ... |CRC |CRC |
```

Bytes 54–55 (`data[-2:]`) appear to be a checksum. Algorithm not yet confirmed — may be CRC16-Modbus (polynomial 0x8005) like the NJ-iot401 frame, or a simple sum.

---

## 5. Quick Reference — Read Code (Python)

```python
import struct

def decode_equipment2596(data: bytes) -> dict:
    """Decode equipment2596 Full Telemetry (56-byte) payload."""
    if len(data) < 21:
        return {"error": "payload too short"}

    msg_type = data[13]
    if msg_type != 4 or len(data) < 56:
        return {"type": "short_status", "msg_type": msg_type}

    V_SCALE = 170.7

    def be16(i):
        return (data[i] << 8) | data[i + 1]

    def to_v(raw):
        return round(raw / V_SCALE, 2)

    return {
        "type": "full_telemetry",
        "imei": "864865083329673",
        "solar": {
            "voltage_v": to_v(be16(15)),       # ✅
            "current_a": None,                  # ❌ TBD
            "power_w": None                     # ℹ = V × A
        },
        "battery": {
            "voltage_v": to_v(be16(17)),        # ✅
            "current_a": None,                  # ❌ TBD
            "power_w": None,                    # ℹ = V × A
            "soc_pct": None                     # ❌ TBD
        },
        "load": {
            "voltage_v": to_v(be16(19)),        # ✅
            "current_a": None,                  # ❌ TBD
            "power_w": None,                    # ℹ = V × A
            "state": None                       # ❌ TBD
        },
        "daily": {
            "discharge": data[32],              # ✅
            "charge": data[36]                  # ✅
        },
        "temperature": {
            "equipment_c": None,                # ❌ TBD
            "ambient_c": None                   # ❌ TBD
        },
        "_raw": data.hex(" ")
    }
```

---

## 6. Device Registry (All Known Devices)

| Serial Number | IMEI | Nickname | Status |
|---|---|---|---|
| `njc7d6pBulDDfBBa2025050870002968` | `864865083327800` | device-01 | Active |
| `njuxAJIxAnz2TkqY2025050870751562` | `867920075008640` | device-02 | Active |
| `njfJ4FhLDCiZzZbB2025050857732596` | `864865083329673` | equipment2596 | Active (this doc) |

> All three devices use the same `TI&` binary protocol format.
> REST API credentials: `anusorn` / `123456` at `http://xmnengjia.com/sdLamp/api/external/`

---

## 7. REST API ↔ MQTT Binary Comparison Methodology

### Principle
ใช้ REST API ของ Vendor (JSON — รู้ field names + values ที่แน่นอน) 
เทียบกับ MQTT Binary Payload (raw bytes — รู้แค่บาง byte offsets) 
เพื่อหา mapping ของฟิลด์ที่ยัง ❌ TBD

### Tools

| Tool | File | Purpose |
|------|------|---------|
| Python Capture | `capture_compare.py` | Subscribe MQTT + Call REST API + Diff analysis |
| Node-RED Sniffer | `deploy/node-red/flow-sniffer.json` | Flow สำหรับ capture + compare ใน Node-RED |
| Multi-Decoder | `deploy/node-red/function-decode.js` | ถอดรหัส 3 formats (equipment2596, Modbus, NJ-Frame) |

### Workflow
1. **Capture:** รัน `capture_compare.py --mode capture` บน VPS → ดัก MQTT binary + เรียก REST API ทุก 30 นาที
2. **Compare:** ใช้ `capture_compare.py --mode compare` → วิเคราะห์ payloads ที่บันทึกไว้ → diff analysis
3. **Scan:** ใช้ `capture_compare.py --mode scan` → ป้อน hex + target value → หา byte offsets
4. **Node-RED:** Import `flow-sniffer.json` → ดูผล compare แบบ real-time

### Differential Analysis Steps
1. เก็บ ≥ 2 payloads ที่สถานะต่างกัน (เช่น LED ON vs LED OFF)
2. XOR ทีละ byte → bytes ที่เปลี่ยนคือ candidate
3. ทดลอง scale factors: `÷170.7`, `×0.01`, `×0.1`, `÷100`, `÷10`
4. เทียบค่าที่ได้กับ REST JSON → match คือ ✅ CONFIRMED
5. อัปเดตตาราง byte offsets ใน Section 2

---

## 8. Calibration To-Do

| Priority | Task | How |
|----------|------|-----|
| 🔴 HIGH | Find Load Current offset | ON/OFF test < 2 min apart |
| 🔴 HIGH | Find Battery Current offset | Daytime charging vs nighttime |
| 🟡 MED | Find Temperature offsets | Compare morning vs noon readings |
| 🟡 MED | Confirm CRC algorithm | Reverse-engineer last 2 bytes |
| 🟢 LOW | Find Battery SOC | May not exist in this device |
| 🟢 LOW | Test downlink commands | Send ON/OFF via MQTT |

---

## 9. Related Documents

| File | Content |
|------|---------|
| `MQTT_BROKER.md` | Broker config, ACL, credentials |
| `API_IN.md` | Vendor REST API documentation (xmnengjia.com) |
| `NJ-iot401_M1280_Protocol_Guide.md` | Modbus RTU protocol + register map (different device) |
| `NJ-iot401_MQTT_Binary_Decoder.md` | Binary payload decoder (different format) |
| `nj_iot401_decoder.py` | NJ-iot401 frame parser + command builder |
| `capture_compare.py` | MQTT capture + REST API comparator + diff analyzer |
| `deploy/node-red/flow-decode-864865083329673.json` | Node-RED flow for this device |
| `deploy/node-red/flow-sniffer.json` | Node-RED flow: REST+MQTT sniffer & comparator |
| `deploy/node-red/function-decode.js` | Multi-format binary decoder function node |
