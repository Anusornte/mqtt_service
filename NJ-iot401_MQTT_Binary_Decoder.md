# NJ-iot401 — ถอดรหัส MQTT Binary Payload

> NJ-iot401 ส่ง Modbus RTU Response Frame ขึ้น MQTT โดยตรงเป็น raw bytes  
> ต้องถอดรหัสฝั่ง subscriber ก่อนนำค่าไปใช้งาน

---

## โครงสร้าง Binary Payload ที่รับได้

```
Byte[0]  = Slave ID       → 0x01
Byte[1]  = Function Code  → 0x03
Byte[2]  = Byte Count     → 0x40 (64 bytes = 32 registers)
Byte[3..4]   = Register 0x3000 (PV Voltage)
Byte[5..6]   = Register 0x3001 (PV Current)
Byte[7..8]   = Register 0x3002 (PV Power Lo)
Byte[9..10]  = Register 0x3003 (PV Power Hi)
Byte[11..12] = Register 0x3004 (Battery Voltage)
...
Byte[-2]     = CRC Lo
Byte[-1]     = CRC Hi
```

**ตัวอย่าง payload hex จริง:**
```
01 03 40 05 64 01 2C 00 6F 00 00 04 DA 00 64 00 0C 00 00 0B B8 0A 28 0A 28 00 00 00 00 00 00 04 DA 00 28 00 03 00 00 00 4B 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 XX XX
```

---

## Python — ถอดรหัสจาก MQTT

```python
import struct
import json
import paho.mqtt.client as mqtt

# ─── CRC16 Verifier ───────────────────────────────────────────
def crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc

def verify_crc(frame: bytes) -> bool:
    if len(frame) < 4:
        return False
    calc = crc16_modbus(frame[:-2])
    recv = frame[-2] | (frame[-1] << 8)
    return calc == recv

# ─── Signed int16 ─────────────────────────────────────────────
def to_signed(val: int) -> int:
    return val - 0x10000 if val > 0x7FFF else val

# ─── แปลง charging status bits ────────────────────────────────
CHARGE_MODE = {0b00: "no_charge", 0b01: "float", 0b10: "boost", 0b11: "equalize"}

# ─── Decoder หลัก ─────────────────────────────────────────────
def decode_modbus_response(payload: bytes) -> dict | None:
    """
    รับ Modbus RTU response frame (binary)
    คืนค่า dict พร้อมใช้งาน หรือ None ถ้า frame ผิดพลาด
    """
    if len(payload) < 5:
        return None

    slave_id = payload[0]
    fc       = payload[1]

    # ตรวจ error response (FC | 0x80)
    if fc & 0x80:
        exc = payload[2] if len(payload) > 2 else 0
        return {"error": True, "exception_code": exc, "fc": fc & 0x7F}

    if fc != 0x03:
        return None

    # ตรวจ CRC
    if not verify_crc(payload):
        return {"error": True, "reason": "CRC mismatch"}

    byte_count = payload[2]
    data = payload[3 : 3 + byte_count]

    # แยก 2-byte registers (Big-Endian)
    regs = [int.from_bytes(data[i:i+2], "big") for i in range(0, len(data), 2)]
    n = len(regs)

    def reg(i):
        return regs[i] if i < n else 0

    def reg32(lo_i, hi_i):
        return (reg(hi_i) << 16) | reg(lo_i)

    # ─── Real-Time Data (FC03 จาก 0x3000) ───────────────────
    result = {
        "slave_id": slave_id,
        "pv": {
            "voltage": round(reg(0) * 0.01, 2),   # V
            "current": round(reg(1) * 0.01, 2),   # A
            "power":   round(reg32(2, 3) * 0.01, 2),  # W (32-bit)
        },
        "battery": {
            "voltage": round(reg(4) * 0.01, 2),   # V
            "current": round(reg(5) * 0.01, 2),   # A
            "power":   round(reg32(6, 7) * 0.01, 2),  # W
            "temp":    round(to_signed(reg(9)) * 0.01, 1),   # °C
            "soc":     reg(18),                    # %
        },
        "controller": {
            "temp": round(to_signed(reg(8)) * 0.01, 1),      # °C
        },
        "load": {
            "voltage": round(reg(14) * 0.01, 2),  # V
            "current": round(reg(15) * 0.01, 2),  # A
            "power":   round(reg32(16, 17) * 0.01, 2),  # W
        },
    }
    return result

# ─── Status Register Decoder (0x3201) ────────────────────────
def decode_status(reg_3201: int) -> dict:
    return {
        "input_overvoltage":  bool(reg_3201 & (1 << 15)),
        "mosfet_short":       bool(reg_3201 & (1 << 14)),
        "load_over_current":  bool(reg_3201 & (1 << 10)),
        "pv_short":           bool(reg_3201 & (1 << 4)),
        "charge_mode":        CHARGE_MODE.get((reg_3201 >> 2) & 0x03, "unknown"),
        "load_on":            bool(reg_3201 & (1 << 1)),
        "running":            bool(reg_3201 & (1 << 0)),
    }

# ─── MQTT Callback ────────────────────────────────────────────
def on_message(client, userdata, msg):
    raw: bytes = msg.payload          # raw binary bytes จาก MQTT

    print(f"\n[TOPIC] {msg.topic}")
    print(f"[RAW]   {raw.hex(' ').upper()}  ({len(raw)} bytes)")

    result = decode_modbus_response(raw)
    if result is None:
        print("[ERR]   ถอดรหัสไม่ได้ — frame ผิดรูปแบบ")
        return

    if result.get("error"):
        print(f"[ERR]   {result}")
        return

    # แสดงผลที่อ่านได้
    pv   = result["pv"]
    batt = result["battery"]
    load = result["load"]
    ctrl = result["controller"]

    print(f"[PV]    {pv['voltage']} V  {pv['current']} A  {pv['power']} W")
    print(f"[BATT]  {batt['voltage']} V  SOC={batt['soc']}%  Temp={batt['temp']}°C")
    print(f"[LOAD]  {load['voltage']} V  {load['current']} A  {load['power']} W")
    print(f"[CTRL]  Temp={ctrl['temp']}°C")

    # แปลงเป็น JSON สำหรับส่งต่อหรือเก็บ DB
    print(f"[JSON]  {json.dumps(result, ensure_ascii=False)}")

# ─── MQTT Client ──────────────────────────────────────────────
client = mqtt.Client()
client.username_pw_set("user", "password")
client.on_message = on_message
client.connect("mqtt.example.com", 1883, keepalive=60)
client.subscribe("solar/site01/NJ401-001/raw", qos=1)
client.loop_forever()
```

---

## JavaScript / Node.js

```javascript
const mqtt = require("mqtt");

// ─── ถอดรหัส binary buffer ──────────────────────────────────
function toSigned16(val) {
  return val > 0x7FFF ? val - 0x10000 : val;
}

function reg32(data, loIdx, hiIdx) {
  const lo = data.readUInt16BE(loIdx * 2);
  const hi = data.readUInt16BE(hiIdx * 2);
  return (hi << 16 | lo) >>> 0;
}

function decodeModbusResponse(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 5) return null;

  const slaveId = buf[0];
  const fc      = buf[1];

  if (fc & 0x80) {
    return { error: true, exceptionCode: buf[2], fc: fc & 0x7F };
  }
  if (fc !== 0x03) return null;

  const byteCount = buf[2];
  const data = buf.slice(3, 3 + byteCount);

  // อ่าน register เป็น array ของ uint16
  const regs = [];
  for (let i = 0; i + 1 < data.length; i += 2) {
    regs.push(data.readUInt16BE(i));
  }

  const r = (i) => regs[i] ?? 0;
  const r32 = (lo, hi) => (r(hi) * 65536 + r(lo));

  return {
    slaveId,
    pv: {
      voltage: +(r(0) * 0.01).toFixed(2),
      current: +(r(1) * 0.01).toFixed(2),
      power:   +(r32(2, 3) * 0.01).toFixed(2),
    },
    battery: {
      voltage: +(r(4) * 0.01).toFixed(2),
      current: +(r(5) * 0.01).toFixed(2),
      power:   +(r32(6, 7) * 0.01).toFixed(2),
      temp:    +(toSigned16(r(9)) * 0.01).toFixed(1),
      soc:     r(18),
    },
    controller: {
      temp: +(toSigned16(r(8)) * 0.01).toFixed(1),
    },
    load: {
      voltage: +(r(14) * 0.01).toFixed(2),
      current: +(r(15) * 0.01).toFixed(2),
      power:   +(r32(16, 17) * 0.01).toFixed(2),
      state:   (r(17) >> 1) & 1,
    },
  };
}

// ─── MQTT Client ────────────────────────────────────────────
const client = mqtt.connect("mqtt://mqtt.example.com", {
  username: "user",
  password: "password",
});

client.on("connect", () => {
  console.log("Connected to MQTT Broker");
  client.subscribe("solar/site01/NJ401-001/raw", { qos: 1 });
});

client.on("message", (topic, payload) => {
  console.log(`\n[TOPIC] ${topic}`);
  console.log(`[RAW]   ${payload.toString("hex").toUpperCase().match(/../g).join(" ")}`);

  const result = decodeModbusResponse(payload);

  if (!result || result.error) {
    console.log("[ERR]  ", result);
    return;
  }

  console.log("[PV]   ", result.pv);
  console.log("[BATT] ", result.battery);
  console.log("[LOAD] ", result.load);
  console.log("[CTRL] ", result.controller);
  console.log("[JSON] ", JSON.stringify(result));
});
```

---

## Node-RED — Function Node

นำ code นี้ใส่ใน **Function Node** ต่อจาก MQTT In node:

```javascript
// Node-RED Function Node: decode Modbus RTU binary payload
const buf = msg.payload;   // Buffer อัตโนมัติใน Node-RED

if (!Buffer.isBuffer(buf) || buf.length < 5) {
    node.warn("payload ไม่ใช่ binary buffer หรือสั้นเกิน");
    return null;
}

const fc = buf[1];
if (fc !== 0x03) {
    node.warn("FC ไม่ใช่ 0x03");
    return null;
}

const byteCount = buf[2];
const data = buf.slice(3, 3 + byteCount);

function r(i) {
    if (i * 2 + 1 >= data.length) return 0;
    return data.readUInt16BE(i * 2);
}
function r32(lo, hi) { return r(hi) * 65536 + r(lo); }
function signed(v) { return v > 0x7FFF ? v - 0x10000 : v; }

msg.payload = {
    device_id:  msg.topic.split("/")[2] || "unknown",
    timestamp:  Math.floor(Date.now() / 1000),
    pv: {
        voltage: +(r(0) * 0.01).toFixed(2),
        current: +(r(1) * 0.01).toFixed(2),
        power:   +(r32(2, 3) * 0.01).toFixed(2),
    },
    battery: {
        voltage: +(r(4) * 0.01).toFixed(2),
        current: +(r(5) * 0.01).toFixed(2),
        power:   +(r32(6, 7) * 0.01).toFixed(2),
        temp:    +(signed(r(9)) * 0.01).toFixed(1),
        soc:     r(18),
    },
    controller: {
        temp: +(signed(r(8)) * 0.01).toFixed(1),
    },
    load: {
        voltage: +(r(14) * 0.01).toFixed(2),
        current: +(r(15) * 0.01).toFixed(2),
        power:   +(r32(16, 17) * 0.01).toFixed(2),
        state:   r(15) > 0 ? 1 : 0,
    },
};

return msg;
// ต่อจาก node นี้ → msg.payload เป็น JSON พร้อมใช้
// → ส่งต่อไป Dashboard / InfluxDB / MySQL ได้เลย
```

**Node-RED Flow สำเร็จรูป:**
```
[MQTT In] → [Function: decode binary] → [JSON → Debug]
                                       → [InfluxDB Out]
                                       → [Dashboard Chart]
```

---

## ตัวอย่างผลลัพธ์หลังถอดรหัส

**Input binary (hex):**
```
01 03 40 05 64 01 2C 00 6F 00 00 04 DA 00 64 00 0C 00 00 0B B8 0A 28 ...
```

**Output JSON:**
```json
{
  "slave_id": 1,
  "pv": {
    "voltage": 13.80,
    "current": 3.00,
    "power":   41.40
  },
  "battery": {
    "voltage": 12.42,
    "current": 1.00,
    "power":   12.42,
    "temp":    26.0,
    "soc":     75
  },
  "controller": {
    "temp": 30.0
  },
  "load": {
    "voltage": 12.42,
    "current": 0.40,
    "power":   4.97,
    "state":   1
  }
}
```

---

## ตารางตำแหน่ง Byte ใน Payload

| Byte Index | Register | ชื่อ | สูตร | ผลลัพธ์ |
|---|---|---|---|---|
| `[3..4]` | 0x3000 | PV Voltage | `×0.01` | V |
| `[5..6]` | 0x3001 | PV Current | `×0.01` | A |
| `[7..8]` | 0x3002 | PV Power Lo | `32-bit ×0.01` | W |
| `[9..10]` | 0x3003 | PV Power Hi | รวมกับ Lo | W |
| `[11..12]` | 0x3004 | Battery Voltage | `×0.01` | V |
| `[13..14]` | 0x3005 | Charge Current | `×0.01` | A |
| `[15..16]` | 0x3006 | Charge Power Lo | `32-bit ×0.01` | W |
| `[17..18]` | 0x3007 | Charge Power Hi | รวมกับ Lo | W |
| `[19..20]` | 0x3008 | Controller Temp | `signed ×0.01` | °C |
| `[21..22]` | 0x3009 | Battery Temp | `signed ×0.01` | °C |
| `[23..24]` | 0x300A | Ambient Temp | `signed ×0.01` | °C |
| `[31..32]` | 0x300E | Load Voltage | `×0.01` | V |
| `[33..34]` | 0x300F | Load Current | `×0.01` | A |
| `[35..36]` | 0x3010 | Load Power Lo | `32-bit ×0.01` | W |
| `[37..38]` | 0x3011 | Load Power Hi | รวมกับ Lo | W |
| `[39..40]` | 0x3012 | Battery SOC | `×1` | % |
| `[-2..-1]` | – | CRC16 | Lo, Hi | verify |

---

## ข้อควรระวัง

| ปัญหา | สาเหตุ | วิธีแก้ |
|---|---|---|
| ค่าออกมาแปลก เช่น 655.35 | ลืม `×0.01` | ตรวจ scale factor |
| อุณหภูมิติดลบเป็นบวกผิด | ไม่ได้ signed conversion | ใช้ `to_signed()` |
| Power ค่าผิด | ลืม combine 32-bit (Lo+Hi) | `(Hi<<16) \| Lo` |
| payload ว่าง / None | NJ-iot401 ยังไม่ได้รับ response จาก M1280 | ตรวจ RS485 wiring |
| CRC fail | frame ขาด/เสียระหว่างส่ง | ตรวจ QoS หรือ frame ซ้ำ |
