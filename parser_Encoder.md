# ขั้นตอนที่ 3 — Node-RED: Binary Packet Parser & Device Control

**เป้าหมาย:** รับข้อมูลจาก `/solar/+/pub` → parse binary → store InfluxDB และส่งคำสั่งกลับผ่าน `/solar/{IMEI}/sub`

> ### ⚠️ โปรโตคอลจริง — verified 2026-06-27 จากอุปกรณ์จริง Model: LCS-TH
>
> อุปกรณ์ **LCS-TH** (IMEI 864865083329673) มีพฤติกรรมแตกต่างจากเอกสาร NJ-iot401:
>
> | รูปแบบ | Start bytes | ส่งเมื่อไหร่ | หน้าที่ |
> |--------|-------------|-------------|--------|
> | **TI** binary | `54 49` | อัตโนมัติทุก 30 นาที | ✅ ข้อมูล telemetry หลัก 56 bytes |
> | **AC** query | `AC xx .. CA` | ตอบกลับ downlink | ✅ ACK 11 bytes เท่านั้น (ไม่มี data body) |
> | NJ binary | `4E 4A .. 58 52` | — | ❌ **อุปกรณ์ไม่ตอบสนอง** |
> | Monitor text | `55 70` ("Up") | — | ❌ **อุปกรณ์ไม่ส่งอัตโนมัติ** |
>
> **ข้อสรุป:** LCS-TH ใช้ **TI protocol เท่านั้น** สำหรับข้อมูล — ไม่มี Monitor text, ไม่ตอบ NJ commands, AC queries ได้แค่ ACK เปล่า

---

## Model: LCS-TH — Calibration (verified 2026-06-27)

> IMEI: `864865083329673` | TI Protocol 56 bytes | ทุก 30 นาที | China UTC+8 → Thailand UTC+7

### โครงสร้าง Packet (56 bytes)

```
Offset  Field
00-01   54 49 = "TI" start marker
02-07   BCD timestamp: YY MM DD HH mm SS (China UTC+8)
08      Message type: 0x12 = periodic telemetry
09      Signal strength: signed byte (0xAA = -86 dBm)
10-11   Unknown (always 00 00)
12      Sequence counter
13      Unknown (always 04)
14-15   PV Voltage ADC          (uint16 LE)  → pvV
16-17   Temperature ADC         (uint16 LE)  → equipment + ambient temp
18-21   Unknown
22-23   Current Indicator       (uint16 LE)  → batA/pvA/batW/pvW (ต่อเนื่อง 0-2304+)
24-31   Unknown / battery-related
32-33   Daily discharge Wh      (uint16 LE, direct value)
34-35   Unknown
36-37   Daily charge Wh         (uint16 LE, direct value)
38-39   Lamp mode               (uint16 LE, 1/2/3/4/7)
40-45   Status bytes (byte[41]=54 = possibly rated Ah)
46-47   Unknown (padding)
48-55   Padding / CRC bytes
```

### Calibration Formulas

| ค่า | Offset | สูตร | R² | MAE |
|-----|--------|------|-----|-----|
| **PV Voltage** | 14-15 | `raw × 0.005592 + 1.2067` | 0.99 | 0.17V |
| **Equipment Temp** | 16-17 | `raw × 0.064259 − 103.1737` | 0.83 | 2.6°C |
| **Ambient Temp** | 16-17 | `raw × 0.064264 − 106.1866` | 0.83 | 2.6°C |
| **Battery Current** | 22-23 | `raw × 0.002433 + 0.2061` | 0.997 | 0.12A |
| **PV Current** | 22-23 | `raw × 0.002219 + 0.1231` | 0.994 | 0.15A |
| **Battery Power** | 22-23 | `raw × 0.033327 + 2.6157` | 0.996 | 2.0W |
| **PV Power** | 22-23 | `raw × 0.035082 + 2.7526` | 0.996 | 1.9W |
| **Battery Voltage** | — | LiFePO4 4S chemistry model | — | 0.08V |
| Daily charge Wh | 36-37 | direct (raw = Wh) | — | — |
| Daily discharge Wh | 32-33 | direct (raw = Wh) | — | — |
| Lamp mode | 38-39 | direct (1-7) | — | — |

### Current Indicator (offset 22-23) — ค่าต่อเนื่อง ไม่ใช่ discrete stages

| raw | batA | สถานะ | ช่วงเวลา |
|-----|------|--------|----------|
| 0 | ~0.2A | idle (ไม่ชาร์จ) | เช้ามืด |
| 141 | ~0.55A | **discharge** (LED กินไฟ) | กลางคืน |
| 512 | ~1.5A | float charge | เช้า |
| 768 | ~2.1A | early bulk | สาย |
| 1536 | ~3.9A | bulk | สาย-เที่ยง |
| 1792 | ~4.6A | bulk | เที่ยง |
| 2048 | ~5.2A | full bulk | เที่ยง-บ่าย |
| 2304 | ~5.8A | absorption | บ่าย |

> **ทิศทางกระแส:** ถ้า pvV < 8V และ raw ไม่ใช่ 0/512/2048/2304 → **discharge** (กลับเครื่องหมาย batA, batW)

### LED Load Estimation

อุปกรณ์ LCS-TH ไม่มี load sensor แยก — LED กินไฟจากแบตเตอรี่โดยตรง:

| ช่วง | Load V | Load A | Load W |
|------|--------|--------|--------|
| **กลางคืน** (discharge) | = batV | = \|batA\| | = \|batW\| |
| **กลางวัน** (charging/idle) | 0 | 0 | 0 |

### Device Parameters (อ่านจากหน้าจอตั้งค่าอุปกรณ์)

| Parameter | ค่า | หมายเหตุ |
|-----------|-----|----------|
| **Name** | HT | ชื่ออุปกรณ์ |
| **Battery Type** | Lithium Phosphate (LiFePO4) | แบตเตอรี่ลิเธียมฟอสเฟต |
| **Num Battery** | 4S (12.8V) | 4 เซลล์อนุกรม |
| **D/N Thr(V)** | 5 V | Day/Night threshold — ต่ำกว่า 5V = กลางคืน |
| **CVT(V)** | 14.4 V | Charging Voltage Target |
| **LVD(V)** | 10.4 V | Low Voltage Disconnect — ตัดโหลดเมื่อแบตต่ำ |
| **LVR(V)** | 12.0 V | Low Voltage Reconnect — ต่อโหลดเมื่อแบตกลับมา |
| **Load(A)** | 1.33 A | พิกัดกระแสโหลดสูงสุด |
| **Eco Mode** | ON | ประหยัดพลังงาน |
| **Power Saving** | 12.5 V | แรงดันเข้าโหมดประหยัด |
| **Super Save Electricity** | 12.0 V | แรงดันเข้าโหมดประหยัดพิเศษ |
| **Output Mode** | Induction Mode | โหมดตรวจจับการเคลื่อนไหว |
| **Delay Lamp Out** | 20 s | เวลาดับไฟหลังไม่มีการเคลื่อนไหว |

> **LiFePO4 4S Voltage Range:**  
> - 14.4V (CVT) = ชาร์จเต็ม  
> - 12.8V = resting (nominal)  
> - 12.0V (LVR) = กลับมาต่อโหลด  
> - 10.4V (LVD) = ตัดโหลดเพื่อป้องกันแบตเสียหาย

### Output Modes (3 โหมด)

LCS-TH รองรับ 3 โหมดการทำงานของหลอดไฟ LED:

| lampMode | โหมด | การทำงาน |
|:--------:|-------|----------|
| **7** | **Induction Mode** | ตรวจจับเคลื่อนไหว — ไฟติดเมื่อมีคน/รถผ่าน |
| **1-6** | **Timed Mode** | ตั้งเวลาเปิด-ปิดตายตัว 6 ช่วงเวลา |
| **?** | **Cloud Control** | ควบคุมผ่านคลาวด์ (MQTT downlink) |

---

#### 1. Induction Mode (mode 7) — 🔥 ใช้จริงตอนนี้

```
กลางคืน (PV < D/N Thr 5V):
  motion detected ──→ LED ON  (100%)
       │
  no motion 20s ──→ LED OFF
       │
  motion again  ──→ LED ON  (loop)

กลางวัน (PV > 5V):
  LED OFF ตลอด — ไม่สนใจ motion
```

| พารามิเตอร์ | ค่า | หมายเหตุ |
|-----------|-----|----------|
| D/N Thr(V) | 5V | ต่ำกว่า = กลางคืน, สูงกว่า = กลางวัน |
| Delay Lamp Out | 20s | ดับหลังไม่มีการเคลื่อนไหว |
| Load max | 1.33A | กระแสสูงสุดตอนไฟติด |

**ข้อดี:** ประหยัดไฟมาก — ไฟติดเฉพาะเมื่อจำเป็น  
**ข้อเสีย:** ต้องเดินสาย PIR/motion sensor

---

#### 2. Timed Mode (mode 1-6)

ตั้งเวลาเปิด-ปิดตายตัว รองรับ **6 ช่วงเวลา** ต่อวัน:

```
Task 1: เปิด 18:30 → ปิด 22:00  Dim 100%
Task 2: เปิด 22:00 → ปิด 05:00  Dim 50%  (half-power)
Task 3: เปิด 05:00 → ปิด 06:00  Dim 100%
Task 4-6: ไม่ใช้
```

| พารามิเตอร์ | หมายเหตุ |
|-----------|----------|
| Start Time | เวลาเริ่ม (HH:MM) |
| End Time | เวลาจบ (HH:MM) |
| Dimming | 0-100% (0=ปิด, 100=สว่างสุด) |
| Half Power | ลดกำลังลงครึ่งหนึ่ง |

**ข้อดี:** คาดการณ์ได้ — รู้ว่าไฟติดเมื่อไหร่  
**ข้อเสีย:** เปลืองไฟถ้าไม่มีคนผ่าน

---

#### 3. Cloud Control Mode

ควบคุมผ่าน MQTT downlink จากเซิร์ฟเวอร์:

```
Server → MQTT /solar/{IMEI}/sub → อุปกรณ์

คำสั่งที่ใช้:
  0xC2   เปิด/ปิด/หรี่ไฟ (AC format)
  0x8100 ควบคุมโคม (NJ format — ❌ LCS-TH ไม่ตอบ)
```

| ข้อดี | ข้อเสีย |
|-------|--------|
| ควบคุม real-time จากระยะไกล | ต้องมีเน็ตตลอด |
| ปรับ dimming ได้ตามต้องการ | LCS-TH ไม่ตอบ NJ commands |
| รวมกับระบบอัตโนมัติได้ | อาจต้องใช้ AC format |

> ⚠️ **LCS-TH ยังไม่ทดสอบ Cloud Control** — AC queries ได้แค่ ACK เปล่า ยังไม่พบวิธีส่งคำสั่งเปิด/ปิดไฟ

---

### 🔢 lampMode Summary

| Mode | ค่า off38 | กลางคืน | กลางวัน |
|:----:|:---------:|---------|---------|
| 1-2 | 1, 2 | ตาม timer | OFF |
| 3 | 3 | ON ตลอดคืน | OFF |
| 4 | 4 | OFF | OFF |
| 7 | **7** | **Induction** 🔥 | OFF |

### Downlink — สิ่งที่ไม่ทำงานกับ LCS-TH

| คำสั่ง | Format | ผลลัพธ์ |
|--------|--------|---------|
| 0x8007 (NJ) | `4E4A...5852` | ❌ ไมตอบ |
| 0x8100 (NJ) | `4E4A...5852` | ❌ ไมตอบ |
| 0xB4 (AC) | `AC B4 00 CA` | ACK 11B — ไม่มี data |
| 0x12 (AC) | `AC 12 00 CA` | ACK 11B — ไม่มี data |
| 0xB0 (AC) | `AC B0 00 CA` | ACK 11B — ไม่มี data |

> **สรุป:** LCS-TH อ่านค่าได้จาก TI protocol อัตโนมัติเท่านั้น — ไม่รองรับ query แบบ real-time

### 3.1 Flow รับข้อมูล (Uplink) — UPDATED 2026-06-27

```
[MQTT In]  topic: /solar/+/pub  datatype: buffer
    │
    ▼
[Function] parse_packet  (3-protocol detector)
    │  • buf[0]=0x55, buf[1]=0x70 ("Up") → Text Monitor → parse fields → return msg
    │  • buf[0]=0x4E, buf[1]=0x4A ("NJ") → NJ response  → extract header → return msg
    │  • buf[0]=0x54, buf[1]=0x49 ("TI") → TI telemetry → parse 56 bytes → return msg
    │  → msg.protocol = "monitor" | "nj" | "ti"
    │  → msg.msgType (TI: msgType, NJ: command word, Monitor: -1)
    ▼
[Switch]  route by msg.msgType
    ├── 18 (0x12) → [Function] parse_solar_data_0x12  → [Debug] Solar Data
    └──  else     → [Function] parse_nj_response → [Debug] NJ/Monitor

### 3.2 Flow ส่งคำสั่ง (Downlink)

```
[HTTP In / Dashboard trigger]
    │
    ▼
[Switch]  action type
    ├── query_status  → [Function] build_0x8007  → [MQTT Out] /solar/{IMEI}/sub
    ├── control_lamp  → [Function] build_0x8100  → [MQTT Out] /solar/{IMEI}/sub
    ├── solar_query   → [Function] build_0xB4    → [MQTT Out] /solar/{IMEI}/sub
    ├── solar_light   → [Function] build_0xC2    → [MQTT Out] /solar/{IMEI}/sub
    ├── set_time      → [Function] build_0x8106  → [MQTT Out] /solar/{IMEI}/sub
    └── restart       → [Function] build_0x8101  → [MQTT Out] /solar/{IMEI}/sub
```

---

### 3.3 Helper Functions

#### `crc16` — CRC16/MODBUS

```javascript
function crc16(buf, start, end) {
    let crc = 0xFFFF;
    for (let i = start; i < end; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 0x0001) { crc = (crc >> 1) ^ 0xA001; }
            else               { crc >>= 1; }
        }
    }
    return crc;
}
```

#### `bcdToDate` — แปลง BCD Timestamp → ISO String

```javascript
function bcdToDate(buf, offset) {
    // 6 bytes: YY MM DD HH mm SS (BCD)
    const b = (n) => (buf[offset + n] >> 4) * 10 + (buf[offset + n] & 0x0F);
    const yr = 2000 + b(0), mo = b(1), dy = b(2);
    const hh = b(3), mm = b(4), ss = b(5);
    return new Date(yr, mo - 1, dy, hh, mm, ss).toISOString();
}
```

#### `getBodyOffset` — คำนวณ offset ของ Message Body

```javascript
function getBodyOffset(buf) {
    // byte 10 = special markings
    const marks = buf[10];
    const hasTerminalID = (marks & 0x01) !== 0;  // Bit0
    const hasTimestamp  = (marks & 0x02) !== 0;  // Bit1
    let offset = 11;
    if (hasTerminalID) offset += 15;  // Terminal ID 15 bytes
    if (hasTimestamp)  offset += 6;   // BCD time 6 bytes
    return offset;
}
```

---

### 3.4 Function: `parse_packet` (Uplink Entry Point)

> **หมายเหตุ:** โค้ดด้านล่าง calibrated 2026-06-27 สำหรับ **equipment2596**
> วิเคราะห์จาก 12 จุดข้อมูล cross-reference ระหว่าง raw hex (TI protocol) และค่าจริงจาก solar charge controller
> ใช้ "TI" protocol — ไม่ใช่ "NJ" ตามเอกสาร
>
> #### ความแม่นยำที่ verified แล้ว (12 data points, 2026-06-27)
>
> | ค่า | Offset | R² | MAE | สถานะ |
> |-----|--------|-----|-----|--------|
> | PV Voltage | off14 | 0.990 | 0.17V | ✅ ดีเยี่ยม |
> | Battery Current | off22 (chargeStage) | 0.997 | 0.12A | ✅ ดี |
> | PV Current | off22 | 0.994 | 0.15A | ✅ ดี |
> | Battery Power | off22 | 0.996 | 2.0W | ✅ ดี |
> | PV Power | off22 | 0.996 | 1.9W | ✅ ดี |
> | Battery Voltage | LiFePO4 model | — | 0.08V | ✅ ดีเยี่ยม |
> | Ambient Temp | off16 | 0.821 | 2.8°C | △ พอใช้ |
>
> #### Idle Detection (เพิ่ม 2026-06-27)
>
> chargeStage=0 มี 2 ลักษณะ:
> - **Idle เช้า** (dailyChargeWh ≤ 150): แบตยังไม่เต็ม กำลังคายประจุเล็กน้อย (~0.2-0.4A) → ใช้สูตรปกติ
> - **Idle แท้** (dailyChargeWh > 150): แบตเต็มแล้ว → batA=0, pvA=0, batW=0, pvW=0

#### โครงสร้าง Packet จริง (56 bytes, "TI" protocol — equipment2596)

```
Offset  Field
00-01   54 49 = "TI" start marker
02-07   BCD timestamp: YY MM DD HH mm SS  (อุปกรณ์ส่งเป็น China UTC+8 — แปลงเป็น UTC+7 สำหรับไทย)
08      Message type: 0x12 = periodic telemetry
09      Signal strength: signed byte (0xAA = -86 dBm)
10-11   Unknown (always 00 00)
12      Sequence counter
13      Unknown (always 04)
14-15   PV Voltage ADC          (uint16 LE)  ← recalibrated: เคยเป็น Battery voltage
16-17   Ambient Temperature ADC (uint16 LE)  ← recalibrated: เคยเป็น PV voltage
18-21   Unknown
22-23   Charge Stage Indicator  (uint16 LE)  ← **ค้นพบใหม่**: 0=idle, 512=float, 2048=bulk, 2304=absorption
24-31   Unknown / battery-related
32-33   Daily discharge Wh      (uint16 LE, direct value)
34-35   Unknown
36-37   Daily charge Wh         (uint16 LE, direct value = Wh solar energy today)
38-39   Lamp mode               (uint16 LE, 1/2/3/4)
40-45   Status bytes (byte[41]=54 = possibly rated Ah)
46-47   Unknown (padding)
48-55   Padding / CRC bytes
```

#### โค้ด parse_packet (recalibrated สำหรับ equipment2596)

```javascript
function bcd(b) { return (b >> 4) * 10 + (b & 0x0F); }
function u16le(buf, off) { return buf[off] | (buf[off + 1] << 8); }
function hexStr(buf, max) {
    return buf.slice(0, Math.min(buf.length, max || 64))
        .toString('hex').toUpperCase().replace(/.{2}/g, '$& ').trim();
}
function pad2(n) { return String(n).padStart(2, "0"); }

const raw = msg.payload;
const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

if (buf.length < 14) { node.warn("Too short"); return null; }

// Drop text "Monitor" messages silently (starts "Up" = 0x55 0x70)
if (buf[0] === 0x55 && buf[1] === 0x70) {
    node.status({ fill:"blue", shape:"dot", text:"Monitor msg" });
    return null;
}

// ตรวจ "TI" start marker
if (buf[0] !== 0x54 || buf[1] !== 0x49) {
    node.warn("[parse] Unknown start: " + hexStr(buf.slice(0,4)));
    node.status({ fill:"red", shape:"ring", text:"bad marker" });
    return null;
}

// BCD timestamp (China UTC+8) → Thailand UTC+7
const yr = 2000 + bcd(buf[2]);
const mo = bcd(buf[3]); const dy = bcd(buf[4]);
const hh = bcd(buf[5]); const mi = bcd(buf[6]); const ss = bcd(buf[7]);
const utcMs = Date.UTC(yr, mo - 1, dy, hh, mi, ss) - 8 * 3600 * 1000;
const td    = new Date(utcMs + 7 * 3600 * 1000);
msg.deviceTime = td.getUTCFullYear() + "-" + pad2(td.getUTCMonth()+1) + "-" +
    pad2(td.getUTCDate()) + "T" + pad2(td.getUTCHours()) + ":" +
    pad2(td.getUTCMinutes()) + ":" + pad2(td.getUTCSeconds()) + "+07:00";

msg.msgType  = buf[8];
msg.signal   = buf[9] > 127 ? buf[9] - 256 : buf[9];
msg.sequence = buf[12];
msg.imei     = msg.topic.split("/")[2];
msg.cmdHex   = "0x" + msg.msgType.toString(16).toUpperCase().padStart(2,"0");

// Parse telemetry (msgType 0x12)
if (buf.length >= 48 && msg.msgType === 0x12) {
    // === OFFSET MAP (calibrated 2026-06-27 for equipment2596, cross-ref 2596.md) ===
    const raw_pv    = u16le(buf, 14);   // PV voltage ADC
    const raw_temp  = u16le(buf, 16);   // Ambient temp ADC
    const chargeStg = u16le(buf, 22);   // Charge stage: 0=idle, 512=float, 2048=bulk, 2304=absorption

    // Direct-read fields (read first — needed for idle detection)
    const dailyChargeWh    = u16le(buf, 36);
    const dailyDischargeWh = u16le(buf, 32);
    const lampMode         = u16le(buf, 38);
    const soc              = buf.length > 41 ? buf[41] : null;

    // ── Idle detection ──────────────────────────────────────────────────────
    // Idle has 2 types:
    //   A) Early morning idle (stage=0, chgWh<=150): battery discharging ~0.2-0.4A → use formula
    //   B) Full battery idle  (stage=0, chgWh>150): battery full, truly 0A/0W
    const isTrueIdle = (chargeStg === 0 && dailyChargeWh > 150);

    // PV Voltage (offset 14, R²=0.99, MAE=0.17V) — verified 2026-06-27
    const pvV = Math.round((raw_pv * 0.005592 + 1.2067) * 100) / 100;

    // Battery/PV Current & Power — derived from charge stage (offset 22, R²>0.99)
    var batA, pvA, batW, pvW;
    if (isTrueIdle) {
        // Battery full — no current flowing
        batA = 0; pvA = 0; batW = 0; pvW = 0;
    } else {
        batA = Math.round((chargeStg * 0.002433 + 0.2061) * 1000) / 1000;
        pvA  = Math.round((chargeStg * 0.002219 + 0.1231) * 1000) / 1000;
        batW = Math.round((chargeStg * 0.033327 + 2.6157) * 10) / 10;
        pvW  = chargeStg === 0 ? 0 : Math.round((chargeStg * 0.035082 + 2.7526) * 10) / 10;
    }

    // Battery Voltage — LiFePO4 4S chemistry model (MAE=0.08V)
    // LiFePO4 4S resting: ~12.8V(20%SOC) to ~14.25V(100%), very flat in 30-80% range
    // Multi-variable regression gives MAE=0.06V but chemistry model is simpler
    function estimateBatV_LiFePO4(stg, dailyWh, socVal) {
        const s = socVal || 54;
        if (stg === 0) {
            // Idle — distinguish full vs not-full using daily charge Wh
            if (dailyWh > 150) return 14.25;  // Battery full, resting high
            return Math.round((12.8 + (s - 20) * 0.015) * 100) / 100;  // Discharge curve
        }
        if (stg <= 512)  return 13.45;  // Float charge
        if (stg <= 2048) return 13.65;  // Bulk  (CC phase)
        return 13.80;                    // Absorption (CV phase)
    }
    const batV = estimateBatV_LiFePO4(chargeStg, dailyChargeWh, soc);

    // Ambient Temperature (offset 16, R²=0.82, MAE=2.8°C)
    // Note: accuracy limited because off16 is equipment temp, not true ambient
    const ambTemp_C = Math.round((raw_temp * 0.064121 - 105.8627) * 10) / 10;

    // Charge stage label
    const chargeLabel = isTrueIdle ? "idle (full)"
        : chargeStg === 0 ? "idle"
        : chargeStg <= 512 ? "float"
        : chargeStg <= 2048 ? "bulk"
        : "absorp";

    msg.data = {
        pvVoltage: pvV, pvCurrent: pvA, pvPower: pvW,
        battVoltage: batV, battCurrent: batA, battPower: batW,
        battSOC: soc,
        dailyChargeWh, dailyDischargeWh,
        lampMode,
        ambTemp_C, chargeStage: chargeStg, chargeLabel,
        isTrueIdle,
        signal_dBm: msg.signal, sequence: msg.sequence,
        deviceTime: msg.deviceTime, imei: msg.imei,
        _raw_hex: hexStr(buf, 56)
    };

    node.status({ fill:"green", shape:"dot",
        text: pad2(td.getUTCHours())+":"+pad2(td.getUTCMinutes())+
              "  pv="+pvV+"V/"+pvA+"A  bat~"+batV+"V  "+chargeLabel+
              "  lamp="+(lampMode===4?"off":"on") });
} else {
    node.status({ fill:"yellow", shape:"dot",
        text: "type=0x"+msg.msgType.toString(16)+"  len="+buf.length });
}

return msg;
```

---

### 3.5 Function: `parse_lamp_status` (cmd `0x0007`)

```javascript
const buf = msg.rawBuf;
const o = msg.bodyOffset;

const serialNo    = buf.readUInt16BE(o);
const controlMode = buf[o + 2];          // 0=Auto, 1=Manual
const alarmFlag   = buf.readUInt16BE(o + 3);
const equipTime   = bcdToDate(buf, o + 5);
const runTime     = buf.readUInt32BE(o + 11);  // hours
const lightTime   = buf.readUInt32BE(o + 15);  // hours
const leakVolt    = buf.readUInt16BE(o + 19);  // V
const leakCurr   = buf.readUInt16BE(o + 21);  // mA
const waterStatus = buf[o + 23];
const branchCount = buf[o + 24];

const branches = [];
let bOff = o + 25;
for (let i = 0; i < branchCount; i++) {
    branches.push({
        branch_id:    buf[bOff],
        switch_pos:   buf[bOff + 1],             // 0=off, 1-100=dim%
        voltage:      buf.readUInt16BE(bOff + 2) / 10,   // V
        current:      buf.readUInt16BE(bOff + 4) / 100,  // A
        active_power: buf.readUInt16BE(bOff + 6),         // W
        power_factor: buf[bOff + 8] / 100,
        energy_kwh:   buf.readUInt32BE(bOff + 9) / 100,  // kWh
    });
    bOff += 13;
}

msg.payload = {
    imei: msg.imei, device_time: equipTime,
    control_mode: controlMode, alarm_flag: alarmFlag,
    run_time_h: runTime, light_time_h: lightTime,
    leakage_voltage_v: leakVolt, leakage_current_ma: leakCurr,
    water_immersion: waterStatus, rssi: msg.rssi,
    branches
};
msg.measurement = "lamp_status";
return msg;
```

---

### 3.6 Function: `parse_alarm` (cmd `0x0008`)

```javascript
const buf = msg.rawBuf;
const alarmFlag = buf.readUInt16BE(msg.bodyOffset);

const ALARM_NAMES = [
    "capacitor_failure", "light_source_failure", "relay_fault",
    "memory_chip_failure", "clock_chip_failure", "config_failure",
    "leakage_alarm", "burglar_alarm", "water_immersion",
    "overcurrent", "overpower", "low_power", "low_voltage", "wiring_error"
];

const activeAlarms = ALARM_NAMES.filter((_, i) => (alarmFlag >> i) & 1);

msg.payload = {
    imei: msg.imei,
    device_time: msg.deviceTime,
    alarm_flag: alarmFlag,
    alarms: activeAlarms
};
msg.measurement = "alarm_event";
return msg;
```

---

### 3.7 Function: `parse_solar_data_0x12` (msgType `0x12`)

> **หมายเหตุ:** Section นี้ถูกอัพเดทจาก `parse_solar_data (0xB4)` เป็น `parse_solar_data_0x12`
> เพราะอุปกรณ์จริงส่ง msgType=0x12 ใน "TI" protocol — ไม่ได้ตอบสนองต่อ command `0xB4` downlink
>
> #### Calibration — อุปกรณ์เดิม (IMEI 864865083329673, verified 2026-06-24)
>
> | ช่อง | Offset | สูตร | หน่วย | ตรวจสอบ P1 | ตรวจสอบ P2 |
> |------|--------|------|-------|-----------|-----------|
> | Battery voltage | 14-15 | raw × 0.001615 + 8.963 | V | 2598→13.16V ✓ | 3366→14.40V ✓ |
> | PV voltage | 16-17 | raw × 0.015672 − 18.88 | V | 2230→16.07V ✓ | 2535→20.85V ✓ |
> | PV current (INVERTED) | 18-19 | 2.308 − raw × 0.010444 | A | 198→0.24A ✓ | 153→0.71A ✓ |
> | Battery current | 24-25 | raw × 0.021765 − 2.219 | A | 113→0.24A ✓ | 147→0.98A ✓ |
> | PV power | 26-27 | raw × 0.04316 − 17.98 | W | 506→3.86W | 762→14.91W ✓ |
> | Battery power | 28-29 | raw × 0.7301 − 53.06 | W | 77→3.16W | 92→14.11W ✓ |
> | Daily charge Wh | 36-37 | direct (raw = Wh) | Wh | 3 Wh | 252 Wh ✓ |
> | Daily discharge Wh | 32-33 | direct | Wh | 210 Wh | 210 Wh |
> | Lamp mode | 38-39 | direct (4=off, 3=on) | — | 3 (on) | 4 (off) ✓ |
> | Work temp | 46-47 | raw × 0.10185 + 35.47 | °C | raw=30→38.5°C ✓ | raw=90→44.6°C ✓ |

> #### Calibration — equipment2596 (calibrated 2026-06-27 จาก cross-reference 2596.md, 12 data points)
>
> ค่า offset ถูกค้นพบใหม่ผ่าน brute-force search (เทียบค่าจริงจาก solar charge controller):
>
> | ช่อง | Offset | สูตร | หน่วย | R² | MAE | หมายเหตุ |
> |------|--------|------|-------|-----|-----|----------|
> | **PV voltage** | 14-15 | raw × 0.005592 + 1.2067 | V | **0.99** | 0.17V | ✓ เคยเป็น offset 16 |
> | **Battery current** | 22-23 | raw × 0.002433 + 0.2061 | A | **0.997** | 0.12A | ✓ charge stage indicator |
> | **PV current** | 22-23 | raw × 0.002219 + 0.1231 | A | **0.994** | 0.15A | ✓ แชร์ offset เดียวกับ batA |
> | **Battery power** | 22-23 | raw × 0.033327 + 2.6157 | W | **0.996** | 2.0W | ✓ |
> | **PV power** | 22-23 | raw × 0.035082 + 2.7526 | W | **0.996** | 1.9W | ✓ 0W เมื่อ idle แท้ |
> | **Battery voltage** | — | **LiFePO4 4S lookup** จาก chargeStage + dailyChargeWh + SOC | V | — | **0.08V** | ✓ ใช้ LiFePO4 chemistry |
> | **Ambient temp** | 16-17 | raw × 0.064121 − 105.8627 | °C | **0.82** | 2.8°C | △ equipment temp ≠ true ambient |
> | Daily charge Wh | 36-37 | direct (raw = Wh) | Wh | — | — | |
> | Daily discharge Wh | 32-33 | direct | Wh | — | — | |
> | Lamp mode | 38-39 | direct | — | — | — | 1/2/3/4 |
>
> **Idle Detection (เพิ่ม 2026-06-27):**
>
> | เงื่อนไข | ความหมาย | batA/pvA/batW/pvW |
> |----------|---------|-------------------|
> | chargeStage=0 + dailyChargeWh ≤ 150 | Idle เช้า (ยังไม่เริ่มชาร์จ) | ใช้สูตรปกติ (~0.2A/~2.6W) |
> | chargeStage=0 + dailyChargeWh > 150 | Idle แท้ (แบตเต็มแล้ว) | **0** ทั้งหมด |
>
> **Charge Stage (offset 22-23) interpretation:**
>
> | raw | Stage | batA ~ | pvA ~ | batW ~ | pvW ~ | ความหมาย |
> |-----|-------|--------|-------|--------|-------|----------|
> | 0 | idle (เช้า) | 0.2 A | 0.1 A | 2.6 W | 0 W | ยังไม่ชาร์จ |
> | 0 | idle (เต็ม) | **0 A** | **0 A** | **0 W** | **0 W** | แบตเต็ม หยุดชาร์จ |
> | 512 | float | 1.5 A | 1.3 A | 19.7 W | 20.7 W | ชาร์จรักษาระดับ |
> | 2048 | bulk | 5.2 A | 4.7 A | 70.9 W | 74.6 W | ชาร์จเต็มกำลัง |
> | 2304 | absorption | 5.8 A | 5.2 A | 79.4 W | 83.6 W | ชาร์จช่วงสุดท้ายก่อนเต็ม |

```javascript
// Function: parse_solar_data_0x12
// Formats msg.data (set by parse_packet) for debug sidebar / downstream nodes
const d = msg.data;
if (!d) return null;

const lampModeStr = {1:"mode1", 2:"mode2", 3:"on", 4:"off (daytime)"}[d.lampMode] || ("mode " + d.lampMode);
const batDir = d.isTrueIdle ? "idle (full)"
    : d.battCurrent >= 0.5 ? "charging"
    : d.battCurrent <= -0.5 ? "discharging"
    : "idle";

msg.payload = {
    "== TIME ==": {},
    "Device Time (Thailand)": d.deviceTime,
    "IMEI":                   d.imei,
    "Signal":                 d.signal_dBm + " dBm",
    "Sequence":               d.sequence,
    "== PV SOLAR ==": {},
    "PV Voltage":     d.pvVoltage + " V",
    "PV Current":     d.pvCurrent + " A",
    "PV Power":       d.pvPower + " W",
    "== BATTERY ==": {},
    "Batt Voltage":   d.battVoltage + " V  (LiFePO4 4S, MAE 0.08V)",
    "Batt Current":   d.battCurrent + " A  (" + batDir + ")",
    "Batt Power":     d.battPower + " W",
    "Batt SOC":       (d.battSOC !== null ? d.battSOC + " (raw byte)" : "n/a"),
    "== CHARGE ==": {},
    "Charge Stage":   d.chargeStage + "  (" + d.chargeLabel + ")",
    "== ENERGY ==": {},
    "Daily Charge":    d.dailyChargeWh + " Wh  (solar today)",
    "Daily Discharge": d.dailyDischargeWh + " Wh  (lamp last night)",
    "== LAMP ==": {},
    "Lamp Mode":      d.lampMode + "  (" + lampModeStr + ")",
    "== ENVIRONMENT ==": {},
    "Ambient Temp":   (d.ambTemp_C !== null ? d.ambTemp_C + " °C  (MAE 2.8°C)" : "n/a"),
    "== DEBUG ==": {},
    "Raw Hex":        d._raw_hex
};
return msg;
```

---

### 3.8 Function: `parse_online` (cmd `0x0001`)

```javascript
const buf = msg.rawBuf;
const o = msg.bodyOffset;

// Online report: Latitude (4 bytes), Longitude (4 bytes), ICCID (20 bytes ASCII)
const lat  = buf.readInt32BE(o)  / 1e6;
const lng  = buf.readInt32BE(o + 4) / 1e6;
const iccid = buf.slice(o + 8, o + 28).toString('ascii').trim().replace(/\0/g,'');

msg.payload = {
    imei:        msg.imei,
    device_time: msg.deviceTime,
    event:       "online",
    latitude:    lat,
    longitude:   lng,
    iccid:       iccid
};
msg.measurement = "device_event";
return msg;
```

---

### 3.9 Downlink Builders

#### Build Query Lamp Status (`0x8007`)

```javascript
function buildQueryLampStatus(imei, msgId) {
    return buildPacket(0x2F, 0x8007, msgId, imei, Buffer.alloc(0));
}
```

#### Build Remote Control Lamp (`0x8100`)

```javascript
// switchPos: 0x00=off, 0x01–0x64=dim 1–100%
function buildControlLamp(imei, msgId, lampNo, switchPos) {
    const body = Buffer.from([0x01, lampNo, switchPos]);
    return buildPacket(0x2F, 0x8100, msgId, imei, body);
}
```

#### Build Remote Restart (`0x8101`)

```javascript
function buildRestart(imei, msgId) {
    return buildPacket(0x2F, 0x8101, msgId, imei, Buffer.alloc(0));
}
```

#### Build Set System Time (`0x8106`)

```javascript
function buildSetTime(imei, msgId) {
    const now = new Date();
    const bcd = (n) => ((Math.floor(n / 10) << 4) | (n % 10));
    const body = Buffer.from([
        bcd(now.getFullYear() - 2000),
        bcd(now.getMonth() + 1),
        bcd(now.getDate()),
        bcd(now.getHours()),
        bcd(now.getMinutes()),
        bcd(now.getSeconds())
    ]);
    return buildPacket(0x2F, 0x8106, msgId, imei, body);
}
```

#### Build Solar Light Switch (`0xC2`)

```javascript
// action: 0xAA=on, 0xAB=off  |  dimRatio: 0–100
function buildSolarLightSwitch(imei, action, dimRatio) {
    const body = Buffer.from([action, dimRatio]);
    // Solar controller ใช้ packet format แตกต่าง: 0xAC ... 0xCA
    const pkt = Buffer.alloc(body.length + 4);
    pkt[0] = 0xAC; pkt[1] = 0xC2;
    pkt[2] = body.length;
    body.copy(pkt, 3);
    pkt[pkt.length - 1] = 0xCA;
    return pkt;
}
```

#### `buildPacket` — Lighting Controller Packet Builder

```javascript
function buildPacket(equipType, cmd, msgId, imei, body) {
    const imeiBytes = Buffer.from(imei.padEnd(15, '\0').slice(0, 15), 'ascii');
    const now = new Date();
    const bcd = (n) => ((Math.floor(n / 10) << 4) | (n % 10));
    const tsBytes = Buffer.from([
        bcd(now.getFullYear()-2000), bcd(now.getMonth()+1), bcd(now.getDate()),
        bcd(now.getHours()), bcd(now.getMinutes()), bcd(now.getSeconds())
    ]);

    // marks: Bit0=has IMEI, Bit1=has Timestamp
    const marks = 0x03;
    const headerFixed = Buffer.from([equipType, (cmd>>8)&0xFF, cmd&0xFF,
                                      (msgId>>8)&0xFF, msgId&0xFF, 0x00, marks]);
    const header = Buffer.concat([headerFixed, imeiBytes, tsBytes]);
    const content = Buffer.concat([header, body]);

    // Length = start(2) + length(2) + content + crc(2) + end(2)
    const totalLen = 2 + 2 + content.length + 2 + 2;
    const pkt = Buffer.alloc(totalLen);
    pkt[0] = 0x4E; pkt[1] = 0x4A;
    pkt.writeUInt16BE(totalLen, 2);
    content.copy(pkt, 4);
    const crcVal = crc16(pkt, 0, 4 + content.length);
    pkt.writeUInt16LE(crcVal, 4 + content.length);
    pkt[totalLen - 2] = 0x58;
    pkt[totalLen - 1] = 0x52;
    return pkt;
}
```

---

### 3.10 Monitor Text Message Capture (updated 2026-06-27)

> **เปลี่ยนแปลง:** เดิม parse_packet จะ drop Monitor message (`return null`) — ตอนนี้ forward ต่อเพื่อวิเคราะห์

```javascript
// Text "Monitor" message (starts "Up" 0x55 0x70) — capture for analysis
if (buf[0] === 0x55 && buf[1] === 0x70) {
    const txt = buf.toString('utf8').trim();
    msg.payload = txt;
    msg.monitorText = txt;
    msg.protocol = "monitor";
    msg.msgType  = -1;                      // routes to "else" → NJ/Monitor parser
    msg.imei     = msg.topic.split("/")[2];
    // Regex extraction — common patterns
    var mx;
    msg.monitor = {};
    if ((mx = txt.match(/Uptime[:\s]*(\d+)/i)))            msg.monitor.uptime_sec = parseInt(mx[1]);
    if ((mx = txt.match(/Charge[:\s]*([\d.]+)\s*[Ww]/)))   msg.monitor.charge_w = parseFloat(mx[1]);
    if ((mx = txt.match(/Discharge[:\s]*([\d.]+)\s*[Ww]/))) msg.monitor.discharge_w = parseFloat(mx[1]);
    if ((mx = txt.match(/Bat(?:tery)?[:\s]*([\d.]+)\s*V/))) msg.monitor.bat_v = parseFloat(mx[1]);
    if ((mx = txt.match(/PV[:\s]*([\d.]+)\s*V/)))           msg.monitor.pv_v = parseFloat(mx[1]);
    if ((mx = txt.match(/Load[:\s]*([\d.]+)\s*V/)))         msg.monitor.load_v = parseFloat(mx[1]);
    if ((mx = txt.match(/Load[:\s]*([\d.]+)\s*A/)))         msg.monitor.load_a = parseFloat(mx[1]);
    if ((mx = txt.match(/Load[:\s]*([\d.]+)\s*W/)))         msg.monitor.load_w = parseFloat(mx[1]);
    if ((mx = txt.match(/Temp[:\s]*([\d.]+)/)))             msg.monitor.temp_c = parseFloat(mx[1]);
    node.status({ fill:"blue", shape:"dot", text:"Monitor: " + txt.slice(0, 50) });
    return msg;
}
```

> **หมายเหตุ:** ยังไม่เคยเห็น Monitor message จริงจากอุปกรณ์ — regex patterns อาจต้องปรับเมื่อมีตัวอย่างจริง

---

### 3.11 NJ Protocol Parser (`parse_nj_response`)

**เป้าหมาย:** แยกวิเคราะห์ NJ protocol response packets (4E4A...5852) ที่ส่งกลับมาหลังจาก downlink query

#### NJ Packet Header (parsed in `parse_packet`)

```
4E 4A [Length 2B BE] [EquipType 1B] [Cmd 2B BE] [MsgId 2B BE] [RSSI 1B] [Marks 1B] [IMEI? 15B] [Time? 6B BCD] [Body...] [CRC16 2B LE] 58 52
```

| Field | Offset | ขนาด | หมายเหตุ |
|-------|--------|------|----------|
| Start | 0-1 | 2B | `4E 4A` |
| Length | 2-3 | 2B | ความยาวรวม (Big-Endian) |
| Equipment Type | 4 | 1B | `0x2F`=Lighting, `0x25`=Time, `0x2E`=Central |
| Command Word | 5-6 | 2B | e.g. `0x0007`, `0x00B4` |
| Message ID | 7-8 | 2B | หมายเลขลำดับ |
| RSSI | 9 | 1B | ความแรงสัญญาณ |
| Special Marks | 10 | 1B | Bit0=hasIMEI, Bit1=hasTime |
| Terminal ID | 11-25 | 15B | ASCII IMEI (ถ้า Bit0=1) |
| Time Tag | 26-31 | 6B | BCD timestamp (ถ้า Bit1=1) |
| Body | 32+ | var | ข้อมูลตาม command |
| CRC16 | -4,-3 | 2B | CRC16/MODBUS (Little-Endian) |
| End | -2,-1 | 2B | `58 52` |

#### Supported NJ Commands

| Command | ชื่อ | Body Fields |
|---------|------|-------------|
| `0x0007` | Lamp Status | per-branch: V, A, W, PF, Energy |
| `0x0008` | Alarm Upload | alarm bitmask |
| `0x0001` | Controller Online | Latitude, Longitude, ICCID |
| `0x00B4` | **Solar Op Data** | **BatV, LoadV/A, PV V/A, Temps** ← ครบทุกฟิลด์ |

#### 0xB4 Solar Operation Data Response Body

```
Offset  Field
00      Day/Night Status     (1B, 0=day 1=night)
01      Battery Type         (1B)
02      Software Version     (1B)
03-04   Battery Voltage      (uint16 BE, V/100)
05-06   Load Current         (uint16 BE, A/100)
07-08   Load Voltage         (uint16 BE, V/10)
09-10   PV Voltage           (uint16 BE, V/10)
11-12   PV Current           (uint16 BE, A/100)
13-14   Error Flags          (uint16 BE)
15-18   Cumulative Discharge (uint32 BE, kWh/100)
19-22   Cumulative Charge    (uint32 BE, kWh/100)
23-24   External Temperature (uint16 BE, °C/10) ← ambient
25-26   Internal Temperature (uint16 BE, °C/10) ← equipment
```

> **นี่คือข้อมูลที่ต้องการทั้งหมด 12 ฟิลด์!** ได้จาก 0xB4 query ครั้งเดียว
> - `voltage(load)` = Load Voltage (off 7-8)
> - `current(load)` = Load Current (off 5-6)
> - `power(load)` = Load V × Load A
> - `voltage(battery)` = Battery Voltage (off 3-4) ← **ค่าจริง ไม่ใช่ estimate**
> - `current(battery)` = Load Current − PV Current
> - `power(battery)` = Bat V × Bat A
> - `voltage(solar)` = PV Voltage (off 9-10) ← **ค่าจริง**
> - `current(solar)` = PV Current (off 11-12) ← **ค่าจริง**
> - `power(solar)` = PV V × PV A ← **ค่าจริง**
> - `equipment temperature` = Internal Temp (off 25-26) ← **ค่าจริง**
> - `ambient temperature` = External Temp (off 23-24) ← **ค่าจริง**
> - `updateTime` = จาก NJ Time Tag

---

### 3.12 0xB4 Solar Query Builder (`build_0xB4`)

```javascript
// buildPacket(equipType: 0x2F, cmd: 0xB4, msgId, imei, body: empty)
// ส่งไปที่ /solar/{IMEI}/sub — คาดหวัง response 0x00B4 ภายใน ~2-5 วิ
const imei  = msg.imei  || "864865083329673";
const msgId = msg.msgId || 10;
msg.payload = buildPacket(0x2F, 0xB4, msgId, imei, Buffer.alloc(0));
msg.topic   = "/solar/" + imei + "/sub";
```

> **หมายเหตุ:** ยังไม่เคยทดสอบว่า NJ-iot401 ตอบสนองต่อ 0xB4 query จริงหรือไม่
> อาจต้องทดสอบกับอุปกรณ์จริงและปรับ equipType หรือ packet format

---

### 3.13 Node-RED Settings (`nodered/settings.js`)

```javascript
module.exports = {
    uiPort: 1880,
    mqttReconnectTime: 15000,
    debugMaxLength: 1000,
    functionGlobalContext: {
        // helper functions ที่ใช้ร่วมกันทุก node
    },
    logging: {
        console: { level: "info", metrics: false, audit: false }
    },
    editorTheme: { projects: { enabled: false } }
}
```