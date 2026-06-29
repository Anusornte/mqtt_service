# คู่มือชุดคำสั่งและการถอดรหัสข้อมูล: NJ-iot401 ↔ M1280

> **Solar IoT Module ↔ Solar Street Light Controller**  
> Protocol: Modbus RTU | Interface: RS485 / TTL | Network: 4G Cat.1

---

## สารบัญ

1. [สถาปัตยกรรมระบบ](#1-สถาปัตยกรรมระบบ)
2. [พารามิเตอร์การสื่อสาร RS485 / TTL](#2-พารามิเตอร์การสื่อสาร-rs485--ttl)
3. [โครงสร้าง Modbus RTU Frame](#3-โครงสร้าง-modbus-rtu-frame)
4. [Function Codes ที่รองรับ](#4-function-codes-ที่รองรับ)
5. [ชุดคำสั่ง (Command Set)](#5-ชุดคำสั่ง-command-set)
6. [Register Map (M1280)](#6-register-map-m1280)
7. [การถอดรหัสข้อมูล (Data Decoding)](#7-การถอดรหัสข้อมูล-data-decoding)
8. [ถอดรหัส Status / Fault Register](#8-ถอดรหัส-status--fault-register)
9. [CRC16 Modbus](#9-crc16-modbus)
10. [ตัวอย่าง Code Python](#10-ตัวอย่าง-code-python)
11. [Error Handling](#11-error-handling)
12. [หมายเหตุ](#12-หมายเหตุ)
13. [MQTT Broker — การเชื่อมต่อและถอดรหัส Payload](#13-mqtt-broker--การเชื่อมต่อและถอดรหัส-payload)
14. [Xiamen NengJia Cloud REST API](#14-xiamen-nengjia-cloud-rest-api)
15. [NJ-iot401 Binary Controller Protocol (AC...CA Frame)](#15-nj-iot401-binary-controller-protocol-acca-frame)
16. [Common Hardware Protocol (DE...ED Frame)](#16-common-hardware-protocol-deed-frame)

---

## 1. สถาปัตยกรรมระบบ

```
┌──────────────┐     RS485 / TTL      ┌─────────────────────┐     4G Cat.1 / MQTT     ┌──────────────────┐
│    M1280     │ ◄──────────────────► │     NJ-iot401        │ ◄─────────────────────► │   Cloud Server   │
│  (Slave 01)  │     9600, 8N1, RTU   │  (Modbus RTU Master) │    TCP/IP / MQTT        │  Remote Monitor  │
└──────────────┘                      └─────────────────────┘                          └──────────────────┘
       │
  ┌────┴────────────────────┐
  │  Solar Panel (PV Input)  │
  │  Battery 12V / 24V       │
  │  LED Street Light Load   │
  └──────────────────────────┘
```

### บทบาทของอุปกรณ์

| อุปกรณ์ | บทบาท | หมายเหตุ |
|---|---|---|
| **M1280** | Modbus RTU **Slave** | Solar charge controller, Slave ID = 01 (default) |
| **NJ-iot401** | Modbus RTU **Master** | ส่ง query ไปหา M1280, รับข้อมูลส่งขึ้น Cloud |
| **Cloud Server** | Remote Platform | รับข้อมูลผ่าน 4G Cat.1, MQTT Broker / REST API |

---

## 2. พารามิเตอร์การสื่อสาร RS485 / TTL

### Serial Port Settings

| พารามิเตอร์ | ค่า | หมายเหตุ |
|---|---|---|
| **Baud Rate** | `9600` bps | ค่า default (บาง firmware ใช้ 115200) |
| **Data Bits** | `8` | Fixed |
| **Stop Bits** | `1` | Fixed |
| **Parity** | `None` (N) | Fixed |
| **Mode** | `Modbus RTU` | Binary, ไม่ใช่ ASCII |
| **Slave Address** | `0x01` | ตั้งค่าได้ใน controller (ช่วง 1–247) |
| **Max Slaves per Bus** | 247 | มาตรฐาน Modbus |
| **Inter-frame Gap** | ≥ 3.5 characters | ช่วงเงียบระหว่าง frames |
| **Response Timeout** | 200–500 ms | แนะนำ 300 ms |
| **Max Query Registers** | 125 registers | ต่อ 1 request |

### การต่อสาย RS485 (NJ-iot401 ↔ M1280)

| NJ-iot401 Pin | M1280 Pin | สี (ทั่วไป) | หมายเหตุ |
|---|---|---|---|
| `A+` (RS485+) | `A+` | ขาว / เขียว | Differential pair (+) |
| `B-` (RS485-) | `B-` | น้ำเงิน / เหลือง | Differential pair (-) |
| `GND` | `GND` | ดำ | Common ground |
| `VCC` (5V) | `VCC` | แดง | ถ้า module ต้องการไฟ |

> **TTL (UART):** ต่อ `TX→RX`, `RX→TX`, `GND→GND` ตรวจสอบ voltage level (3.3V หรือ 5V) ให้ตรงกันก่อน

---

## 3. โครงสร้าง Modbus RTU Frame

### Request Frame (Master → Slave)

```
┌──────────┬──────────┬──────────────────┬──────────────────┬──────────┐
│ Slave ID │    FC    │  Register Addr   │  Qty / Data      │  CRC16   │
│  1 byte  │  1 byte  │    2 bytes       │    2 bytes       │  2 bytes │
│          │          │  (Hi byte first) │  (Hi byte first) │ (Lo, Hi) │
└──────────┴──────────┴──────────────────┴──────────────────┴──────────┘
```

**ตัวอย่าง:**

```
01   03   30 00   00 20   C2 07
│    │    │        │       └── CRC16 (Low byte ก่อน)
│    │    │        └────────── จำนวน registers ที่ต้องการ = 32 (0x0020)
│    │    └─────────────────── Register address เริ่มต้น = 0x3000
│    └──────────────────────── Function Code = 03 (Read Holding Registers)
└───────────────────────────── Slave ID = 01
```

### Response Frame (Slave → Master)

```
┌──────────┬──────────┬────────────┬──────────────────────┬──────────┐
│ Slave ID │    FC    │ Byte Count │    Data (N bytes)    │  CRC16   │
│  1 byte  │  1 byte  │   1 byte   │  Qty × 2 bytes       │  2 bytes │
└──────────┴──────────┴────────────┴──────────────────────┴──────────┘
```

**ตัวอย่าง:**

```
01   03   40   05 64   01 2C   ...   XX XX
│    │    │    │        │             └── CRC16
│    │    │    │        └──────────────── Register 0x3001 = 0x012C
│    │    │    └───────────────────────── Register 0x3000 = 0x0564
│    │    └────────────────────────────── Byte Count = 64 bytes (32 regs × 2)
│    └─────────────────────────────────── Function Code = 03
└──────────────────────────────────────── Slave ID = 01
```

---

## 4. Function Codes ที่รองรับ

| FC | Hex | ฟังก์ชัน | ใช้กับ |
|---|---|---|---|
| **03** | `0x03` | Read Holding Registers | อ่านค่า real-time, พารามิเตอร์ตั้งค่า |
| **04** | `0x04` | Read Input Registers | อ่านค่า read-only (ถ้า firmware รองรับ) |
| **06** | `0x06` | Write Single Register | เขียนครั้งละ 1 register |
| **10** | `0x10` | Write Multiple Registers | เขียนหลาย register พร้อมกัน |

---

## 5. ชุดคำสั่ง (Command Set)

### 5.1 อ่านข้อมูล Real-Time (FC 03)

**อ่าน 32 registers จาก 0x3000** (PV, Battery, Load data)

```
Request:  01 03 30 00 00 20 C2 07
Response: 01 03 40 [64 bytes data] [CRC Lo] [CRC Hi]
```

**อ่าน 14 registers จาก 0x3000** (ข้อมูลพื้นฐาน)

```
Request:  01 03 30 00 00 0E 24 0F
```

### 5.2 อ่านข้อมูลสถิติรายวัน (FC 03)

**อ่าน 22 registers จาก 0x3100** (พลังงาน, เวลา, จำนวนครั้ง)

```
Request:  01 03 31 00 00 16 9D CF
```

### 5.3 อ่าน Status Register (FC 03)

**อ่าน 3 registers จาก 0x3200** (charging status, load status, fault bits)

```
Request:  01 03 32 00 00 03 44 07
```

### 5.4 อ่านพารามิเตอร์ตั้งค่า Battery (FC 03)

**อ่าน 15 registers จาก 0x9000**

```
Request:  01 03 90 00 00 0F 89 CA
```

### 5.5 อ่านพารามิเตอร์ Charging Voltage (FC 03)

**อ่าน 9 registers จาก 0x9013**

```
Request:  01 03 90 13 00 09 5B D7
```

### 5.6 เปิด Load Output (FC 06)

**เขียน 0x0001 → register 0x9002**

```
Request:  01 06 90 02 00 01 E9 DB
Response: 01 06 90 02 00 01 E9 DB  (echo กลับมาเหมือนกัน)
```

### 5.7 ปิด Load Output (FC 06)

**เขียน 0x0000 → register 0x9002**

```
Request:  01 06 90 02 00 00 28 1B
```

### 5.8 ตั้ง Battery Type (FC 06)

**เขียนประเภทแบตเตอรี:**

```
01 06 90 00 00 00 48 1B   ← Sealed (AGM/SLA) = 0
01 06 90 00 00 01 89 DB   ← Gel = 1
01 06 90 00 00 02 09 DA   ← Flooded = 2
01 06 90 00 00 03 C8 1A   ← Lithium = 3
```

### 5.9 ตั้ง Load Working Mode (FC 06)

**เขียนโหมดควบคุม Load:**

```
01 06 90 03 00 00 F9 DB   ← Manual Control = 0
01 06 90 03 00 01 38 1B   ← Light+Timer = 1
01 06 90 03 00 02 B8 1A   ← Test = 2
```

### 5.10 เปลี่ยน Slave ID (FC 06)

**เขียน Slave ID ใหม่ที่ register 0x9065**

```
01 06 90 65 00 02 28 19   ← เปลี่ยน Slave ID เป็น 2
```

> ⚠️ หลังเปลี่ยน Slave ID ต้อง query ด้วย ID ใหม่

### 5.11 เขียนหลาย Registers พร้อมกัน (FC 10)

**ตัวอย่าง: ตั้ง Over Voltage Disconnect + Reconnect**

```
Request:
01 10 90 13 00 02 04 [HiOVD] [LoOVD] [HiOVR] [LoOVR] [CRC Lo] [CRC Hi]

ตัวอย่าง OVD=15.50V (0x060E), OVR=15.00V (0x05DC):
01 10 90 13 00 02 04 06 0E 05 DC [CRC]
```

---

## 6. Register Map (M1280)

### 6.1 Real-Time Data Registers (Read Only, FC 03/04)

**เริ่มต้นที่ 0x3000**

| Address (Hex) | ชื่อ | หน่วย | Scale | ประเภท |
|---|---|---|---|---|
| `0x3000` | PV Array Voltage | V | × 0.01 | uint16 |
| `0x3001` | PV Array Current | A | × 0.01 | uint16 |
| `0x3002` | PV Power (Lo Word) | W | × 0.01 | uint16 |
| `0x3003` | PV Power (Hi Word) | W | × 0.01 | uint16 |
| `0x3004` | Battery Voltage | V | × 0.01 | uint16 |
| `0x3005` | Battery Charging Current | A | × 0.01 | uint16 |
| `0x3006` | Charging Power (Lo Word) | W | × 0.01 | uint16 |
| `0x3007` | Charging Power (Hi Word) | W | × 0.01 | uint16 |
| `0x3008` | Controller Temperature | °C | × 0.01 | int16 (signed) |
| `0x3009` | Battery Temperature | °C | × 0.01 | int16 (signed) |
| `0x300A` | Ambient Temperature | °C | × 0.01 | int16 (signed) |
| `0x300E` | Load Voltage | V | × 0.01 | uint16 |
| `0x300F` | Load Current | A | × 0.01 | uint16 |
| `0x3010` | Load Power (Lo Word) | W | × 0.01 | uint16 |
| `0x3011` | Load Power (Hi Word) | W | × 0.01 | uint16 |
| `0x3012` | Battery SOC (%) | % | × 1 | uint16 |

### 6.2 Statistical Data Registers (Read Only, FC 03)

**เริ่มต้นที่ 0x3100**

| Address (Hex) | ชื่อ | หน่วย | Scale |
|---|---|---|---|
| `0x3100` | Energy Generated Today (Lo) | kWh | × 0.01 |
| `0x3101` | Energy Generated Today (Hi) | kWh | × 0.01 |
| `0x3102` | Generation Hours Today | hr | × 0.01 |
| `0x3103` | Total Battery Full Charge Count | ครั้ง | × 1 |
| `0x3104` | Total Battery Over-Discharge Count | ครั้ง | × 1 |
| `0x3106` | Energy Consumed Today (Lo) | kWh | × 0.01 |
| `0x3107` | Energy Consumed Today (Hi) | kWh | × 0.01 |
| `0x310A` | Total Energy Generated (Lo) | kWh | × 0.01 |
| `0x310B` | Total Energy Generated (Hi) | kWh | × 0.01 |
| `0x3110` | Total Energy Consumed (Lo) | kWh | × 0.01 |
| `0x3111` | Total Energy Consumed (Hi) | kWh | × 0.01 |
| `0x3112` | Total Operating Days | วัน | × 1 |

### 6.3 Status Registers (Read Only, FC 03)

**เริ่มต้นที่ 0x3200**

| Address (Hex) | ชื่อ | หมายเหตุ |
|---|---|---|
| `0x3200` | Battery Status Flags | ดู bit map ด้านล่าง |
| `0x3201` | Charging Equipment Status | ดู bit map ด้านล่าง |
| `0x3202` | Discharging Equipment Status | ดู bit map ด้านล่าง |

### 6.4 Settings / Control Registers (Read/Write, FC 03 อ่าน / FC 06,10 เขียน)

**เริ่มต้นที่ 0x9000**

| Address (Hex) | ชื่อ | ค่า / หน่วย | Default |
|---|---|---|---|
| `0x9000` | Battery Type | 0=sealed, 1=gel, 2=flooded, 3=lithium | 0 |
| `0x9001` | Battery Capacity | Ah | 200 |
| `0x9002` | Load Control | 0=off, 1=on | – |
| `0x9003` | Load Working Mode | 0=manual, 1=light-timer, 2=test | 0 |
| `0x9013` | Over Voltage Disconnect | V × 0.01 | 1600 (16.00V) |
| `0x9014` | Charging Limit Voltage | V × 0.01 | 1550 (15.50V) |
| `0x9015` | Over Voltage Reconnect | V × 0.01 | 1500 (15.00V) |
| `0x9016` | Equalize Charging Voltage | V × 0.01 | 1480 (14.80V) |
| `0x9017` | Boost Charging Voltage | V × 0.01 | 1440 (14.40V) |
| `0x9018` | Float Charging Voltage | V × 0.01 | 1370 (13.70V) |
| `0x9019` | Boost Reconnect Voltage | V × 0.01 | 1280 (12.80V) |
| `0x901A` | Low Voltage Disconnect | V × 0.01 | 1100 (11.00V) |
| `0x901B` | Under Voltage Warning | V × 0.01 | 1200 (12.00V) |
| `0x901C` | Under Voltage Warning Reconnect | V × 0.01 | 1250 (12.50V) |
| `0x901D` | Low Voltage Reconnect | V × 0.01 | 1200 (12.00V) |
| `0x9065` | Modbus Slave Address | 1–247 | 1 |
| `0x9066` | Modbus Baud Rate | 0=1200,1=2400,2=4800,3=9600,4=19200 | 3 |

---

## 7. การถอดรหัสข้อมูล (Data Decoding)

### 7.1 หลักการ

- ข้อมูลทุก register เป็น **16-bit (2 bytes)** ส่ง **Hi byte ก่อน, Lo byte หลัง** (Big-Endian)
- ค่า unsigned: `value = (Hi × 256 + Lo) × scale`
- ค่า signed (อุณหภูมิ): ถ้า raw > 0x7FFF → `value = (raw - 0x10000) × scale`
- ค่า 32-bit Power: รวม Lo Word และ Hi Word → `power = (Hi_word × 65536 + Lo_word) × 0.01`

### 7.2 ตารางตัวอย่างการถอดรหัส

| Raw Hex | Register | การคำนวณ | ผลลัพธ์ |
|---|---|---|---|
| `05 64` | PV Voltage | `(0x05 × 256 + 0x64) × 0.01` = `1380 × 0.01` | **13.80 V** |
| `01 2C` | PV Current | `(0x01 × 256 + 0x2C) × 0.01` = `300 × 0.01` | **3.00 A** |
| `00 6F 00 00` | PV Power | `(0 × 65536 + 111) × 0.01` | **1.11 W** |
| `04 DA` | Battery Voltage | `(0x04 × 256 + 0xDA) × 0.01` = `1242 × 0.01` | **12.42 V** |
| `00 64` | Charge Current | `(0x00 × 256 + 0x64) × 0.01` = `100 × 0.01` | **1.00 A** |
| `0B B8` | Controller Temp | `0x0BB8 × 0.01` = `3000 × 0.01` | **30.00 °C** |
| `FF 9C` | Temp (ติดลบ) | `(0xFF9C - 0x10000) × 0.01` = `-100 × 0.01` | **-1.00 °C** |
| `00 4B` | SOC | `0x004B` | **75 %** |

### 7.3 ตัวอย่าง Response จริง — 32 Registers จาก 0x3000

```
01 03 40
05 64    ← [0x3000] PV Voltage    = 13.80 V
01 2C    ← [0x3001] PV Current    = 3.00 A
00 6F    ← [0x3002] PV Power Lo   
00 00    ← [0x3003] PV Power Hi   → Power = 1.11 W
04 DA    ← [0x3004] Battery V     = 12.42 V
00 64    ← [0x3005] Charge A      = 1.00 A
00 0C    ← [0x3006] Charge W Lo   
00 00    ← [0x3007] Charge W Hi   → Charge = 0.12 W
0B B8    ← [0x3008] Controller T  = 30.00 °C
0A 28    ← [0x3009] Battery T     = 26.00 °C
0A 28    ← [0x300A] Ambient T     = 26.00 °C
00 00    ← [0x300B] Reserved
00 00    ← [0x300C] Reserved
00 00    ← [0x300D] Reserved
04 DA    ← [0x300E] Load Voltage  = 12.42 V
00 28    ← [0x300F] Load Current  = 0.40 A
00 03    ← [0x3010] Load Power Lo
00 00    ← [0x3011] Load Power Hi → Load = 0.03 W
00 4B    ← [0x3012] Battery SOC   = 75 %
... (ต่อจนครบ 32 registers = 64 bytes data)
XX XX    ← CRC16 (Lo, Hi)
```

---

## 8. ถอดรหัส Status / Fault Register

### 8.1 Battery Status (0x3200)

| Bit | D15–D8 | ความหมาย |
|---|---|---|
| D15 | Over Temp | 1 = แบตร้อนเกิน |
| D14 | Inner Resist | 1 = Internal resistance error |
| D13–D8 | Reserved | – |

| Bit | D7–D0 | ความหมาย |
|---|---|---|
| D7 | Normal | 1 = ปกติ |
| D6 | Over Discharge | 1 = Discharge เกิน |
| D5 | Full | 1 = ชาร์จเต็ม |
| D4 | Charge | 1 = กำลังชาร์จ |
| D3 | Equalization | 1 = Equalization mode |
| D2 | Boost | 1 = Boost charge |
| D1 | Float | 1 = Float charge |
| D0 | No Charging | 1 = ไม่มีการชาร์จ |

### 8.2 Charging Equipment Status (0x3201)

| Bit | ความหมาย | 0 = ปกติ | 1 = ผิดปกติ |
|---|---|---|---|
| D15 | Input overvoltage | ปกติ | Over voltage |
| D14 | Charging MOSFET Short | ปกติ | Short circuit |
| D13 | Anti-reverse MOSFET Short | ปกติ | Short circuit |
| D12 | Anti-reverse MOSFET Open | ปกติ | Open circuit |
| D11 | Load MOSFET Short | ปกติ | Short circuit |
| D10 | Load Over Current | ปกติ | Over current |
| D9 | Input Over Current | ปกติ | Over current |
| D8 | Anti-reverse MOSFET Short | ปกติ | Short circuit |
| D4 | PV Short Circuit | ปกติ | Short circuit |
| D3–D2 | Charging Status | 00=no charge | 01=float, 10=boost, 11=equalize |
| D1 | Load Status | off | on |
| D0 | Running Status | fault | normal |

---

## 9. CRC16 Modbus

### หลักการ

- Polynomial: `0x8005` (reversed: `0xA001`)
- Initial value: `0xFFFF`
- ส่ง **Low Byte ก่อน, High Byte หลัง** (Little-Endian)

### Algorithm (Python)

```python
def crc16_modbus(data: bytes) -> bytes:
    """คำนวณ CRC16 Modbus RTU — ส่ง Lo byte ก่อน, Hi byte หลัง"""
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x0001:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    return bytes([crc & 0xFF, (crc >> 8) & 0xFF])

# ทดสอบ
frame = bytes([0x01, 0x03, 0x30, 0x00, 0x00, 0x20])
crc = crc16_modbus(frame)
print(crc.hex(' ').upper())  # → C2 07

full_frame = frame + crc
print(full_frame.hex(' ').upper())  # → 01 03 30 00 00 20 C2 07
```

### ตารางตรวจสอบ CRC

| Frame (hex) | CRC (Lo Hi) | Full Frame |
|---|---|---|
| `01 03 30 00 00 20` | `C2 07` | `01 03 30 00 00 20 C2 07` |
| `01 03 31 00 00 16` | `9D CF` | `01 03 31 00 00 16 9D CF` |
| `01 03 32 00 00 03` | `44 07` | `01 03 32 00 00 03 44 07` |
| `01 03 90 00 00 09` | `89 D5` | `01 03 90 00 00 09 89 D5` |
| `01 06 90 02 00 01` | `E9 DB` | `01 06 90 02 00 01 E9 DB` |
| `01 06 90 02 00 00` | `28 1B` | `01 06 90 02 00 00 28 1B` |

---

## 10. ตัวอย่าง Code Python

### 10.1 คลาสสำหรับสื่อสารกับ M1280

```python
import serial
import time
import struct

def crc16_modbus(data: bytes) -> bytes:
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return bytes([crc & 0xFF, crc >> 8])

def build_request(slave_id: int, fc: int, reg_addr: int, value: int) -> bytes:
    frame = bytes([slave_id, fc]) + reg_addr.to_bytes(2, 'big') + value.to_bytes(2, 'big')
    return frame + crc16_modbus(frame)

def verify_crc(response: bytes) -> bool:
    if len(response) < 4:
        return False
    data, crc_recv = response[:-2], response[-2:]
    return crc16_modbus(data) == crc_recv

class M1280:
    def __init__(self, port: str, slave_id: int = 1, baudrate: int = 9600):
        self.ser = serial.Serial(port, baudrate=baudrate, bytesize=8,
                                  parity='N', stopbits=1, timeout=0.5)
        self.slave_id = slave_id

    def _query(self, request: bytes) -> bytes | None:
        self.ser.write(request)
        time.sleep(0.05)
        response = self.ser.read(256)
        if not verify_crc(response):
            print(f"CRC Error: {response.hex(' ')}")
            return None
        return response

    def read_registers(self, start_addr: int, count: int) -> list[int] | None:
        req = build_request(self.slave_id, 0x03, start_addr, count)
        resp = self._query(req)
        if resp is None or len(resp) < 5:
            return None
        byte_count = resp[2]
        data = resp[3:3 + byte_count]
        return [int.from_bytes(data[i:i+2], 'big') for i in range(0, len(data), 2)]

    def write_register(self, reg_addr: int, value: int) -> bool:
        req = build_request(self.slave_id, 0x06, reg_addr, value)
        resp = self._query(req)
        return resp is not None and resp[:6] == req[:6]

    def get_realtime_data(self) -> dict:
        regs = self.read_registers(0x3000, 32)
        if not regs:
            return {}

        def signed(v):
            return (v - 0x10000) * 0.01 if v > 0x7FFF else v * 0.01

        return {
            "pv_voltage":       regs[0] * 0.01,
            "pv_current":       regs[1] * 0.01,
            "pv_power":         (regs[3] * 65536 + regs[2]) * 0.01,
            "battery_voltage":  regs[4] * 0.01,
            "charge_current":   regs[5] * 0.01,
            "charge_power":     (regs[7] * 65536 + regs[6]) * 0.01,
            "controller_temp":  signed(regs[8]),
            "battery_temp":     signed(regs[9]),
            "load_voltage":     regs[14] * 0.01,
            "load_current":     regs[15] * 0.01,
            "load_power":       (regs[17] * 65536 + regs[16]) * 0.01,
            "battery_soc":      regs[18],
        }

    def set_load(self, on: bool) -> bool:
        return self.write_register(0x9002, 1 if on else 0)

    def close(self):
        self.ser.close()


# ตัวอย่างการใช้งาน
if __name__ == "__main__":
    m = M1280(port="/dev/ttyUSB0", slave_id=1, baudrate=9600)
    
    data = m.get_realtime_data()
    print(f"PV: {data['pv_voltage']:.2f}V, {data['pv_current']:.2f}A, {data['pv_power']:.1f}W")
    print(f"Battery: {data['battery_voltage']:.2f}V ({data['battery_soc']}%)")
    print(f"Load: {data['load_voltage']:.2f}V, {data['load_current']:.2f}A")
    print(f"Temp: Controller={data['controller_temp']:.1f}°C")
    
    m.set_load(True)   # เปิดไฟ
    time.sleep(5)
    m.set_load(False)  # ปิดไฟ
    
    m.close()
```

### 10.2 ถอดรหัส Status Register

```python
def decode_charging_status(reg_3201: int) -> dict:
    charge_map = {0b00: "no_charge", 0b01: "float", 0b10: "boost", 0b11: "equalize"}
    return {
        "input_overvoltage":    bool(reg_3201 & (1 << 15)),
        "mosfet_short":         bool(reg_3201 & (1 << 14)),
        "anti_reverse_short":   bool(reg_3201 & (1 << 13)),
        "input_open":           bool(reg_3201 & (1 << 12)),
        "load_mosfet_short":    bool(reg_3201 & (1 << 11)),
        "load_over_current":    bool(reg_3201 & (1 << 10)),
        "input_over_current":   bool(reg_3201 & (1 << 9)),
        "pv_short":             bool(reg_3201 & (1 << 4)),
        "charge_status":        charge_map.get((reg_3201 >> 2) & 0x03, "unknown"),
        "load_on":              bool(reg_3201 & (1 << 1)),
        "running":              bool(reg_3201 & (1 << 0)),
    }
```

---

## 11. Error Handling

### Exception Response Frame

เมื่อ Slave เกิด error จะตอบ:

```
[Slave ID] [FC | 0x80] [Exception Code] [CRC Lo] [CRC Hi]
ตัวอย่าง: 01 83 02 C0 F1
                 │   └── Exception Code 0x02
                 └──── FC 03 + 0x80 = 0x83
```

### Exception Codes

| Code | Hex | ความหมาย | วิธีแก้ไข |
|---|---|---|---|
| 01 | `0x01` | Illegal Function | ตรวจสอบ Function Code ที่รองรับ |
| 02 | `0x02` | Illegal Data Address | Register address ไม่ถูกต้อง |
| 03 | `0x03` | Illegal Data Value | ค่าที่เขียนเกิน range ที่อนุญาต |
| 04 | `0x04` | Slave Device Failure | Controller เกิด error ภายใน |

### ปัญหาที่พบบ่อย

| อาการ | สาเหตุที่เป็นไปได้ | วิธีแก้ |
|---|---|---|
| ไม่ได้รับ response เลย | สาย RS485 ผิดขั้ว A+/B- | สลับ A+ และ B- |
| CRC Error ทุก frame | Baud rate ไม่ตรง | ลอง 115200 หรือ 4800 |
| Exception 0x02 | Register address ผิด | เช็ค register map ของ controller |
| Response ขาดตอน | Timeout สั้นเกิน | เพิ่ม timeout เป็น 500 ms |
| ข้อมูลอ่านได้แต่ผิดปกติ | Scale factor ผิด | ตรวจสอบ × 0.01 |

---

## 12. หมายเหตุ

> ⚠️ **ข้อสำคัญ:** Register map ในเอกสารนี้อ้างอิงจากมาตรฐาน **EPEVER/EPsolar Tracer Modbus Protocol v2.5** ซึ่ง Solar Street Light Controller จีนส่วนใหญ่ใช้ร่วมกัน
>
> NJ-iot401 และ M1280 ไม่ได้เผยแพร่ datasheet สาธารณะ — หากพบว่า register บางตัวไม่ตรง ให้:
> 1. ติดต่อผู้ผลิตโดยตรง (solar-energy-system.com) เพื่อขอ protocol document
> 2. ทดสอบด้วยการ scan register 0x3000–0x31FF ทีละ register
> 3. ใช้ Modbus scanner tool เช่น ModRSsim2 หรือ Modbus Poll

### อ้างอิง

- EPEVER Tracer Modbus Communication Protocol V2.5
- Modbus Application Protocol Specification V1.1b3
- IEC 62386 (DALI) สำหรับ dimming protocol (ถ้าต้องการ)
- NJ-iot401 Product Page: https://solar-energy-system.com/content-444276320491274240.html

---

*เอกสารนี้จัดทำเพื่อเป็นแนวทาง — ตรวจสอบกับ firmware จริงก่อนใช้งาน production*

---

## 13. MQTT Broker — การเชื่อมต่อและถอดรหัส Payload

### 13.1 สถาปัตยกรรม Modbus RTU → MQTT Bridge

```
┌──────────┐   RS485/TTL    ┌─────────────────────────────────────────────┐   4G/TCP   ┌────────────┐
│  M1280   │ ◄────────────► │           NJ-iot401 (Bridge/Gateway)         │ ──────────► │   MQTT     │
│ (Slave)  │   Modbus RTU   │  1. Poll registers (FC03)                    │   port     │  Broker    │
└──────────┘                │  2. Decode raw values (×0.01)                │  1883/8883 │(Mosquitto/ │
                            │  3. Build JSON payload                       │            │ EMQX/HiveMQ│
                            │  4. PUBLISH to topic                         │            └────────────┘
                            └─────────────────────────────────────────────┘                   │
                                                                                               ▼
                                                                                    ┌────────────────┐
                                                                                    │  Cloud App /   │
                                                                                    │  Dashboard     │
                                                                                    │  (SUBSCRIBE)   │
                                                                                    └────────────────┘
```

### 13.2 พารามิเตอร์การเชื่อมต่อ MQTT

| พารามิเตอร์ | ค่า | หมายเหตุ |
|---|---|---|
| **Protocol** | MQTT v3.1.1 | รองรับ v5.0 บางตัว |
| **Port (Plain)** | `1883` | ไม่เข้ารหัส (ใช้ใน LAN/VPN) |
| **Port (TLS/SSL)** | `8883` | แนะนำสำหรับ production |
| **Client ID** | `NJ-iot401-{IMEI}` | ไม่ซ้ำกันต่อ device |
| **Username** | ตามการตั้งค่า Broker | – |
| **Password** | ตามการตั้งค่า Broker | – |
| **Keep-Alive** | `240` วินาที | ค่า default ของ NJ-iot401 (ปรับได้) |
| **QoS** | `0` (At Most Once) | ค่า default ของ NJ-iot401 |
| **Retain** | `true` | เก็บ message ล่าสุดไว้บน broker |
| **Clean Session** | `false` | รักษา session เมื่อ reconnect |

### 13.3 Topic Structure (MQTT Topic Hierarchy)

#### Format จริงของ NJ-iot401 (จากเอกสาร Xiamen NengJia)

NJ-iot401 ใช้ Topic format คงที่ตามที่ผู้ผลิตกำหนด:

```
/AAA/{IMEI}/pub   ← device publish ข้อมูลขึ้น Cloud (uplink)
/AAA/{IMEI}/sub   ← device subscribe รับคำสั่งจาก Cloud (downlink)
```

| ตัวแปร | ความหมาย | ตัวอย่าง |
|---|---|---|
| `AAA` | ประเภทผลิตภัณฑ์: `solar`=Solar, `electricity`=ไฟฟ้าบ้าน | `solar` |
| `{IMEI}` | IMEI ของ NJ-iot401 (ดูจาก configuration หน้า web หรือติดต่อผู้ผลิต) | `868000012345678` |

**ตัวอย่าง Topic จริงสำหรับ NJ-iot401:**

```
/solar/868000012345678/pub    ← อุปกรณ์ส่งข้อมูลขึ้น Broker
/solar/868000012345678/sub    ← Broker ส่งคำสั่งลงอุปกรณ์
```

> ⚠️ IMEI สามารถดูได้จาก configuration interface หรือ ติดต่อทีม business ของ Xiamen NengJia

#### แนวทาง Topic ที่แนะนำสำหรับ Multi-device Platform

หากต้องการออกแบบ Topic hierarchy สำหรับระบบ 1,000 อุปกรณ์:

```
{project}/{site}/{device_id}/telemetry       ← publish ข้อมูล real-time (NJ-iot401 → Broker)
{project}/{site}/{device_id}/status          ← publish สถานะ device
{project}/{site}/{device_id}/cmd/set         ← subscribe รับคำสั่ง (Broker → NJ-iot401)
{project}/{site}/{device_id}/cmd/response    ← publish ผลลัพธ์คำสั่ง
{project}/{site}/{device_id}/lwt             ← Last Will Testament (offline alert)
```

**Wildcard Subscription (Cloud/Dashboard):**

```
solar/site01/+/telemetry        ← รับข้อมูลทุก device ใน site01
solar/#                         ← รับทุก topic ใน project
```

### 13.4 MQTT Payload Format — Telemetry (JSON)

#### Publish: Real-Time Data (`/telemetry`)

NJ-iot401 อ่านค่าจาก M1280 แล้ว publish ขึ้น broker ในรูปแบบ JSON:

```json
{
  "device_id":   "NJ401-001",
  "imei":        "868000012345678",
  "slave_id":    1,
  "timestamp":   1719500400,
  "ts_iso":      "2025-06-27T12:00:00Z",

  "pv": {
    "voltage":   13.80,
    "current":   3.00,
    "power":     41.40
  },

  "battery": {
    "voltage":   12.42,
    "current":   1.00,
    "power":     12.42,
    "soc":       75,
    "temp":      26.0,
    "status":    "charging"
  },

  "load": {
    "voltage":   12.42,
    "current":   0.40,
    "power":     4.97,
    "state":     1
  },

  "controller": {
    "temp":      30.0,
    "charge_mode": "boost"
  },

  "fault": {
    "code":      0,
    "flags":     "0x0001"
  }
}
```

#### Publish: Status (`/status`)

```json
{
  "device_id":  "NJ401-001",
  "timestamp":  1719500400,
  "online":     true,
  "signal":     -75,
  "network":    "4G",
  "uptime":     3600,
  "fw_version": "1.2.3"
}
```

#### Last Will Testament (`/lwt`)

ตั้งค่าใน CONNECT packet เพื่อแจ้งเมื่อ device ออฟไลน์กะทันหัน:

```json
{
  "device_id":  "NJ401-001",
  "online":     false,
  "timestamp":  1719500400
}
```

### 13.5 MQTT Payload Format — Command (JSON)

#### Subscribe: รับคำสั่งจาก Cloud (`/cmd/set`)

```json
{
  "cmd_id":     "cmd-20250627-001",
  "action":     "set_load",
  "value":      1
}
```

| action | value | ผลลัพธ์ |
|---|---|---|
| `set_load` | `0` / `1` | ปิด/เปิด Load Output |
| `set_battery_type` | `0–3` | Sealed/Gel/Flooded/Lithium |
| `set_load_mode` | `0–2` | Manual/Light-Timer/Test |
| `set_brightness` | `0–100` | ความสว่าง (%) ถ้ารองรับ Dimmer |
| `read_register` | `"0x3000"` | อ่านค่า register เดียว |
| `reboot` | `1` | Restart โมดูล |

#### Publish: ผลลัพธ์คำสั่ง (`/cmd/response`)

```json
{
  "cmd_id":    "cmd-20250627-001",
  "action":    "set_load",
  "status":    "ok",
  "timestamp": 1719500405
}
```

หรือเมื่อเกิด error:

```json
{
  "cmd_id":    "cmd-20250627-001",
  "action":    "set_load",
  "status":    "error",
  "error":     "modbus_timeout",
  "timestamp": 1719500405
}
```

### 13.6 การถอดรหัส Payload บน Cloud (Python)

```python
import json
import paho.mqtt.client as mqtt

BROKER   = "mqtt.example.com"
PORT     = 8883
USERNAME = "user"
PASSWORD = "pass"
TOPIC_SUB = "solar/site01/+/telemetry"

def on_connect(client, userdata, flags, rc):
    print(f"Connected: {rc}")
    client.subscribe(TOPIC_SUB, qos=1)

def on_message(client, userdata, msg):
    topic = msg.topic
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
    except json.JSONDecodeError:
        print(f"Invalid JSON from {topic}")
        return

    device_id = payload.get("device_id", "unknown")
    ts        = payload.get("ts_iso", "")

    pv   = payload.get("pv", {})
    batt = payload.get("battery", {})
    load = payload.get("load", {})
    ctrl = payload.get("controller", {})

    print(f"[{ts}] {device_id}")
    print(f"  PV:      {pv.get('voltage')}V  {pv.get('current')}A  {pv.get('power')}W")
    print(f"  Battery: {batt.get('voltage')}V  SOC={batt.get('soc')}%  {batt.get('status')}")
    print(f"  Load:    {load.get('power')}W  state={'ON' if load.get('state') else 'OFF'}")
    print(f"  Temp:    Controller={ctrl.get('temp')}°C")
    print()

client = mqtt.Client()
client.username_pw_set(USERNAME, PASSWORD)
client.tls_set()                    # เปิด TLS (port 8883)
client.on_connect = on_connect
client.on_message = on_message
client.connect(BROKER, PORT, keepalive=60)
client.loop_forever()
```

### 13.7 ส่งคำสั่งจาก Cloud → NJ-iot401

```python
import json
import time
import paho.mqtt.client as mqtt

def send_command(client, device_id: str, action: str, value):
    topic = f"solar/site01/{device_id}/cmd/set"
    payload = {
        "cmd_id":    f"cmd-{int(time.time())}",
        "action":    action,
        "value":     value
    }
    client.publish(topic, json.dumps(payload), qos=1)
    print(f"Sent: {topic} → {payload}")

# ตัวอย่าง
# เปิดไฟ
send_command(client, "NJ401-001", "set_load", 1)

# ปิดไฟ
send_command(client, "NJ401-001", "set_load", 0)

# เปลี่ยนแบตเตอรีเป็น Lithium
send_command(client, "NJ401-001", "set_battery_type", 3)
```

### 13.8 การแมป Modbus Register → JSON Field

| Modbus Register | JSON Path | Scale | ตัวอย่างค่า |
|---|---|---|---|
| `0x3000` | `pv.voltage` | × 0.01 | 13.80 |
| `0x3001` | `pv.current` | × 0.01 | 3.00 |
| `0x3002–3003` | `pv.power` | × 0.01 (32-bit) | 41.40 |
| `0x3004` | `battery.voltage` | × 0.01 | 12.42 |
| `0x3005` | `battery.current` | × 0.01 | 1.00 |
| `0x3006–3007` | `battery.power` | × 0.01 (32-bit) | 12.42 |
| `0x3008` | `controller.temp` | × 0.01 (signed) | 30.0 |
| `0x3009` | `battery.temp` | × 0.01 (signed) | 26.0 |
| `0x300E` | `load.voltage` | × 0.01 | 12.42 |
| `0x300F` | `load.current` | × 0.01 | 0.40 |
| `0x3010–3011` | `load.power` | × 0.01 (32-bit) | 4.97 |
| `0x3012` | `battery.soc` | × 1 | 75 |
| `0x3201` bits D3–D2 | `controller.charge_mode` | enum | `"boost"` |
| `0x3201` bit D1 | `load.state` | bool | `1` |
| `0x9002` | `load.state` (control) | 0/1 | – |

### 13.9 QoS และ Retain — แนวทางเลือก

| ประเภทข้อมูล | QoS | Retain | เหตุผล |
|---|---|---|---|
| Real-time telemetry (ส่งทุก 30s) | `0` หรือ `1` | `true` | Dashboard ดูค่าล่าสุดได้เสมอ |
| คำสั่งควบคุม (cmd/set) | `1` | `false` | รับรองการส่ง แต่ไม่เก็บค้าง |
| Status / Online | `1` | `true` | dashboard รู้สถานะทันที |
| Last Will Testament | `1` | `true` | แจ้ง offline แม้ subscribe ทีหลัง |

### 13.10 Security — TLS + Authentication

```python
import ssl

client.tls_set(
    ca_certs    = "/path/to/ca.crt",        # CA certificate
    certfile    = "/path/to/client.crt",    # Client cert (optional)
    keyfile     = "/path/to/client.key",    # Client key (optional)
    tls_version = ssl.PROTOCOL_TLSv1_2
)
client.tls_insecure_set(False)             # ตรวจสอบ cert เสมอ
```

> ⚠️ ใช้ port **8883** (MQTTS) เสมอในระบบ production — port 1883 ไม่มีการเข้ารหัส

### 13.11 Store-and-Forward — รองรับ 4G ขาด

NJ-iot401 ที่ดีควรมี buffer ข้อมูลเมื่อ 4G หลุด:

```
หลักการ:
- ขณะ MQTT offline → บันทึก telemetry ลง local flash/RAM
- เมื่อ reconnect สำเร็จ → drain buffer ส่งขึ้น broker ตามลำดับ
- ใช้ QoS 1 + persistent session → broker เก็บ message ระหว่าง offline
- ตั้ง Clean Session = false → รับ missed messages เมื่อกลับ online
```

**Flow การ reconnect:**

```
1. detect MQTT disconnect
2. buffer ข้อมูลลง local storage
3. retry connect ด้วย exponential backoff
   (1s → 2s → 4s → 8s → ... → 60s max)
4. reconnect สำเร็จ → publish buffered data
5. resume normal polling
```

---

## 14. Xiamen NengJia Cloud REST API

> อ้างอิงจากเอกสาร https://docapi.xmnengjia.com — ระบบ API ของผู้ผลิต NJ-iot401

### 14.1 ภาพรวมและข้อกำหนด

- Base URL: `http://xmnengjia.com/sdLamp/api/external/`
- Authentication: ทุก request ต้องส่ง `accessToken` ใน body
- อุปกรณ์ออนไลน์จะ poll ทุก **30 นาที** — อย่า call API บ่อยกว่า **100 ครั้ง/24hr/อุปกรณ์/endpoint**
- Token ไม่มีวันหมดอายุโดยหลักการ — ถ้าได้ error `1003` ให้ขอ token ใหม่

### 14.2 Error Codes ทั่วไป

| Code | ความหมาย |
|---|---|
| `1000` | Success |
| `1001` | คำสั่งถูกส่งลงอุปกรณ์แล้ว (command dispatched) |
| `1002` | Serial number อุปกรณ์ผิดพลาด (device serial number error) |
| `1003` | Token หมดอายุ / ไม่ valid — ขอ token ใหม่ |
| `1004` | ประเภทอุปกรณ์ผิดพลาด (device type error) |
| `1005` | จำนวนครั้งการ request เกินขีดจำกัด (request limit reached) |
| `1006` | เนื้อหาพารามิเตอร์ผิดพลาด (parameter content error) |
| `1007` | คำสั่งไม่ valid (invalid instruction) |
| `1008` | พารามิเตอร์ไม่ตรงกับประเภท controller (parameter-controller type mismatch) |
| `2000` | ชื่อผู้ใช้หรือรหัสผ่านผิด (username or password error) |
| `20002` | ไม่พบอุปกรณ์ (device does not exist) |
| `20003` | อุปกรณ์ถูกเพิ่มโดยผู้ใช้นี้แล้ว (device already added by user) |
| `20004` | ผู้ใช้ไม่ได้เป็นเจ้าของอุปกรณ์นี้ (user does not own device) |
| `60003` | ไม่พบผู้ใช้ (user does not exist) |

### 14.3 ขอ accessToken

**POST** `/accessToken`  
Header: `Content-Type: application/x-www-form-urlencoded`

| พารามิเตอร์ | จำเป็น | ประเภท | คำอธิบาย |
|---|---|---|---|
| `username` | ✓ | string | ชื่อผู้ใช้ |
| `password` | ✓ | string | รหัสผ่าน |

```json
{
  "msg": "success",
  "code": 1000,
  "data": "9fc1a31beb5848cea320220419854075"
}
```

### 14.4 รายการอุปกรณ์

**POST** `/deviceList`

| พารามิเตอร์ | จำเป็น | ประเภท | คำอธิบาย |
|---|---|---|---|
| `accessToken` | ✓ | string | Token จาก 14.3 |
| `pageNumber` | ✗ | int | หน้า (เริ่มจาก 1) |
| `pageSize` | ✗ | int | ขนาดหน้า (default 10) |

```json
{
  "msg": "success",
  "code": 1000,
  "data": {
    "list": [
      {
        "iccid": "89860472052080xxxxxx",
        "serial": "n7401982004641f999202108xxxxxxxx",
        "latitude": "24.618772158123246",
        "longitude": "118.05147887942763",
        "is_online": 1,
        "signal_strength": 3,
        "timestamp": 1654053626815
      }
    ],
    "total": 1,
    "size": 10,
    "current": 1
  },
  "success": true
}
```

| Field | ประเภท | คำอธิบาย |
|---|---|---|
| `iccid` | string | หมายเลข IoT SIM card |
| `serial` | string | รหัสอุปกรณ์ 32 หลัก — ใช้ใน API อื่นทุกตัว |
| `latitude` / `longitude` | string | พิกัด GPS |
| `is_online` | int | 0=ออฟไลน์, 1=ออนไลน์ |
| `signal_strength` | int | ความแรงสัญญาณ |
| `total` | int | จำนวนอุปกรณ์ทั้งหมด |
| `size` | int | ขนาด page |
| `current` | int | หน้าปัจจุบัน |

### 14.5 สถานะอุปกรณ์ Solar (PV)

**POST** `/deviceStatus`

| พารามิเตอร์ | จำเป็น | ประเภท | คำอธิบาย |
|---|---|---|---|
| `accessToken` | ✓ | string | Token |
| `serial` | ✓ | string | รหัสอุปกรณ์ 32 หลัก |

```json
{
  "msg": "success",
  "code": 1000,
  "data": {
    "serial": "n7401982004641f999202108xxxxxxxx",
    "is_online": 1,
    "signal_strength": 4,
    "is_lighting": 0,
    "timestamp": "1621489392276",
    "battery_voltage": 12.0,
    "battery_circuit": 0,
    "battery_power": 0,
    "led_voltage": 1,
    "led_circuit": 0,
    "led_power": 4,
    "solar_panel_voltage": 1,
    "solar_panel_circuit": 0,
    "solar_panel_power": 0,
    "battery_percent": 50,
    "outer_temperature": 1,
    "inner_temperature": 2,
    "charge_capacity": 0.0,
    "discharge_capacity": 0.0,
    "run_day": 1,
    "longitude": "0.0",
    "latitude": "0.0"
  }
}
```

| Field | ประเภท | หน่วย | คำอธิบาย |
|---|---|---|---|
| `is_online` | int | – | 0=ออฟไลน์, 1=ออนไลน์ |
| `is_lighting` | int | – | 0=ดับ, 1=ติด |
| `battery_voltage` | float | V | แรงดันแบตเตอรี่ |
| `battery_circuit` | float | mA | กระแสแบตเตอรี่ |
| `battery_power` | float | W | กำลังแบตเตอรี่ |
| `led_voltage` | float | V | แรงดัน Load (LED) |
| `led_circuit` | float | mA | กระแส Load |
| `led_power` | float | W | กำลัง Load |
| `solar_panel_voltage` | float | V | แรงดัน Solar Panel |
| `solar_panel_circuit` | float | mA | กระแส Solar Panel |
| `solar_panel_power` | float | W | กำลัง Solar Panel |
| `battery_percent` | int | % | SOC แบตเตอรี่ |
| `outer_temperature` | int | °C | อุณหภูมิสิ่งแวดล้อม |
| `inner_temperature` | int | °C | อุณหภูมิ Controller |
| `charge_capacity` | float | – | ปริมาณการชาร์จสะสม |
| `discharge_capacity` | float | – | ปริมาณการคายประจุสะสม |
| `led_brightness` | int | % | ความสว่าง LED (0–100) |
| `run_day` | int | วัน | จำนวนวันที่ทำงาน |

### 14.6 เพิ่มอุปกรณ์เข้าบัญชี

**POST** `/addDevice`

| พารามิเตอร์ | จำเป็น | ประเภท | คำอธิบาย |
|---|---|---|---|
| `accessToken` | ✓ | string | Token จาก 14.3 |
| `serial` | ✓ | string | รหัสอุปกรณ์ 32 หลัก |

```json
{
  "msg": "success",
  "code": 1000,
  "data": ""
}
```

### 14.7 ลบอุปกรณ์ออกจากบัญชี

**POST** `/delDevice`

| พารามิเตอร์ | จำเป็น | ประเภท | คำอธิบาย |
|---|---|---|---|
| `accessToken` | ✓ | string | Token จาก 14.3 |
| `serial` | ✓ | string | รหัสอุปกรณ์ 32 หลัก |

```json
{
  "msg": "success",
  "code": 1000,
  "data": ""
}
```

### 14.8 ควบคุมความสว่าง (Solar)

**POST** `/adjustLight`

| พารามิเตอร์ | จำเป็น | ประเภท | คำอธิบาย |
|---|---|---|---|
| `accessToken` | ✓ | string | Token |
| `serial` | ✓ | string | รหัสอุปกรณ์ 32 หลัก |
| `style` | ✓ | string | `on`=เปิด, `off`=ปิด, `dim`=ปรับความสว่าง |
| `power` | ✗ | int | ความสว่าง 0–100 (ใช้เมื่อ style=dim) |

```json
{"msg": "指令已下发", "code": 1001, "data": ""}
```

### 14.9 Push พารามิเตอร์ลงอุปกรณ์ Solar

**POST** `/distributeParam`  
Query params: `accessToken`, `serial`  
Body (JSON):

```json
{
  "producer": 2,
  "overchargeVoltage": 2.6,
  "overchargeReturnVoltage": 3.0,
  "dischargeVoltage": 3.6,
  "dischargeReturnVoltage": 3.4,
  "batteryNumber": 1,
  "loadCurrent": 0.3,
  "intelligent": 2,
  "batteryType": 1,
  "workPattern": 0,
  "timeBrightness": [
    {"h": 1, "s": 30, "d": "100"}
  ]
}
```

| Field | ค่า | คำอธิบาย |
|---|---|---|
| `producer` | `2` | ค่าคงที่สำหรับ Tianying Solar Controller |
| `overchargeVoltage` | float (V) | แรงดัน over-charge cutoff |
| `overchargeReturnVoltage` | float (V) | แรงดัน over-charge recovery (ต้องห่างจาก overcharge > 0.6V สำหรับระบบ 12V+) |
| `dischargeVoltage` | float (V) | แรงดัน over-discharge cutoff |
| `dischargeReturnVoltage` | float (V) | แรงดัน over-discharge recovery (ต้องห่างจาก discharge < 1.5V สำหรับ 12V+) |
| `batteryNumber` | int | จำนวน cell ที่ต่อ series |
| `loadCurrent` | float (A) | กระแส Load |
| `batteryType` | 0=Sealed/AGM, 1=Lithium, 2=Custom, 3=AGM, 4=Gel, 5=Liquid | ประเภทแบตเตอรี่ |
| `intelligent` | 0=เปิดลดกำลัง (derating on), 1=ปิด, 2=365 mode | โหมดประหยัดพลังงาน |
| `workPattern` | 0=ปกติ, 1=24H, 2=D2D (dusk-to-dawn) | โหมดการทำงาน |
| `timeBrightness` | array | ช่วงเวลาและความสว่าง: `h`=ชั่วโมง, `s`=นาทีที่เริ่ม, `d`=% brightness |

```json
{"msg": "指令已下发", "code": 1001, "data": ""}
```

### 14.10 อัปเดตสถานะอุปกรณ์

**POST** `/updateStatus`

| พารามิเตอร์ | จำเป็น | ประเภท | คำอธิบาย |
|---|---|---|---|
| `accessToken` | ✓ | string | Token |
| `serial` | ✓ | string | รหัสอุปกรณ์ 32 หลัก |

```json
{"msg": "指令已下发", "code": 1001, "data": ""}
```

> สั่งให้อุปกรณ์รายงานสถานะปัจจุบัน (trigger poll)

### 14.11 อัปเดตพารามิเตอร์อุปกรณ์

**POST** `/updateParams`

| พารามิเตอร์ | จำเป็น | ประเภท | คำอธิบาย |
|---|---|---|---|
| `accessToken` | ✓ | string | Token |
| `serial` | ✓ | string | รหัสอุปกรณ์ 32 หลัก |

```json
{"msg": "指令已下发", "code": 1001, "data": ""}
```

### 14.12 ดึงพารามิเตอร์ปัจจุบัน

**POST** `/getDeviceParams`

| พารามิเตอร์ | จำเป็น | ประเภท | คำอธิบาย |
|---|---|---|---|
| `accessToken` | ✓ | string | Token |
| `serial` | ✓ | string | รหัสอุปกรณ์ 32 หลัก |

```json
{
  "msg": "成功",
  "code": 10000,
  "data": { ... }
}
```

> Response `data` มีโครงสร้างเดียวกันกับ body ของ `/distributeParam`

### 14.13 ไฟถนน Market Street Light — ควบคุมความสว่าง

**POST** `/adjustLight`

> ใช้สำหรับ **Market Street Light** (ไฟถนนเมือง) ที่รองรับ dual-channel

| พารามิเตอร์ | จำเป็น | ประเภท | คำอธิบาย |
|---|---|---|---|
| `accessToken` | ✓ | string | Token |
| `serial` | ✓ | string | รหัสอุปกรณ์ 32 หลัก |
| `style` | ✓ | string | `on`=เปิด, `off`=ปิด, `dim`=ปรับความสว่าง |
| `power` | ✗ | int | ความสว่างโคม 1 (0–100, ใช้เมื่อ style=dim) |
| `power2` | ✗ | int | ความสว่างโคม 2 (0–100, สำหรับ dual-channel เท่านั้น) |

```json
{"msg": "指令已下发", "code": 1001, "data": ""}
```

### 14.14 ไฟถนน Market Street Light — Push พารามิเตอร์

**POST** `/distributeParam`  
Query params: `accessToken`, `serial`  
Body (JSON):

```json
{
  "param": [
    {
      "time": "18:30",
      "state1": 1,
      "brightness1": 100,
      "state2": 1,
      "brightness2": 100
    },
    {
      "time": "23:00",
      "state1": 1,
      "brightness1": 50,
      "state2": 0,
      "brightness2": 0
    }
  ]
}
```

| Field | ประเภท | คำอธิบาย |
|---|---|---|
| `time` | string | เวลาเริ่ม (HH:MM, 24H) |
| `state1` / `state2` | int | 0=ดับ, 1=ติด, 2=ปรับความสว่าง |
| `brightness1` / `brightness2` | int | % ความสว่าง (0–100) |

> รองรับสูงสุด **12 time segments** ต่อการตั้งค่า

### 14.15 Market Street Light — สถานะอุปกรณ์

**POST** `/deviceStatus`

Response เพิ่มเติมสำหรับ Market Street Light:

```json
{
  "msg": "success",
  "code": 1000,
  "data": {
    "serial": "nb6c4deb572d46248920200107390536",
    "is_online": 1,
    "signal_strength": 4,
    "is_lighting": 0,
    "voltage": 231.6,
    "current": 0.0,
    "active_power": 0.0,
    "total_active_power": 123.14,
    "reactive_power": 1.0,
    "brightness": 0,
    "brightness2": 0,
    "timestamp": 1621489392276,
    "longitude": "0.0",
    "latitude": "0.0",
    "strategy_content": [
      {
        "time": "12:01",
        "state1": 1,
        "brightness1": 100,
        "state2": 0,
        "brightness2": 100
      }
    ]
  }
}
```

| Field | ประเภท | หน่วย | คำอธิบาย |
|---|---|---|---|
| `voltage` | float | V | แรงดันไฟฟ้า AC |
| `current` | float | mA | กระแสไฟฟ้า |
| `active_power` | float | W | กำลังไฟฟ้าปัจจุบัน |
| `total_active_power` | float | kWh | พลังงานสะสมรวม |
| `brightness` / `brightness2` | int | % | ความสว่างโคม 1/2 |
| `strategy_content` | array | – | ตารางเวลาที่ตั้งค่าไว้ |

### 14.16 API Endpoints สรุป

| Endpoint | Method | คำอธิบาย |
|---|---|---|
| `/accessToken` | POST | ขอ Token |
| `/deviceList` | POST | รายการอุปกรณ์ (pagination) |
| `/addDevice` | POST | เพิ่มอุปกรณ์เข้าบัญชี |
| `/delDevice` | POST | ลบอุปกรณ์ออกจากบัญชี |
| `/deviceStatus` | POST | สถานะอุปกรณ์ (Solar / Street Light) |
| `/adjustLight` | POST | เปิด/ปิด/ปรับความสว่าง |
| `/distributeParam` | POST | Push พารามิเตอร์ (Solar หรือ Street Light) |
| `/updateStatus` | POST | สั่ง poll สถานะปัจจุบัน |
| `/updateParams` | POST | อัปเดตพารามิเตอร์อุปกรณ์ |
| `/getDeviceParams` | POST | ดึงพารามิเตอร์ปัจจุบัน |

---

## 15. NJ-iot401 Binary Controller Protocol (AC...CA Frame)

> โปรโตคอลระดับ Hardware สำหรับ NJ-iot401/NJ-iot402 (Solar Series)  
> อ้างอิง: Controller Protocol Document 2 จาก Xiamen NengJia

### 15.1 โครงสร้าง Frame

| ตำแหน่ง | ค่า | ความหมาย |
|---|---|---|
| Byte 0 | `0xAC` | Start marker |
| Byte 1 | Command word | คำสั่ง |
| Byte 2 | Length / Data | ความยาวข้อมูล |
| ... | Data | ข้อมูล |
| Last byte | `0xCA` | End marker |

### 15.2 เปิด/ปิด/ปรับความสว่างไฟ (Cloud → Device)

```
AC  C2  02  [SW]  [BRT]  CA
│   │   │    │     │     └── End
│   │   │    │     └──────── ความสว่าง 0-100 (%)
│   │   │    └────────────── 0xAA=เปิด  0xAB=ปิด
│   │   └─────────────────── ความยาว data = 02
│   └─────────────────────── Command = 0xC2
└─────────────────────────── Start
```

**Response:**

```
AC  32  00  CA   ← สำเร็จ
AC  33  00  CA   ← ล้มเหลว
```

**ตัวอย่าง:**

```
เปิดไฟ 100%:  AC C2 02 AA 64 CA
ปิดไฟ:        AC C2 02 AB 00 CA
ปรับ 50%:     AC C2 02 AA 32 CA
```

### 15.3 อ่านข้อมูล Real-Time (Cloud → Device)

**Request:** `AC B4 00 CA`

**Response:** `AC 20 [length] [data...] CA`

| Byte | คำอธิบาย | หน่วย / Scale |
|---|---|---|
| 3 | สถานะกลางวัน/กลางคืน (nibble สูง) + ประเภทแบตเตอรี่ (nibble ต่ำ) | 0=กลางวัน, 1=กลางคืน, 2=เปลี่ยนผ่าน |
| 4 | Software version | – |
| 5–6 | Battery voltage (Hi, Lo) | ÷100 = V |
| 7–8 | Load current (Hi, Lo) | ÷10 = A |
| 9 | Load voltage | 1 V ต่อหน่วย |
| 10 | PV voltage | ÷10 = V |
| 11 | PV current | ÷10 = A |
| 12 | Error flags | bit mask |
| 13–14 | Cumulative discharge (Hi, Lo) | 1 = 1 Ah (reset ที่ 65535) |
| 15 | Over-discharge count | 0–255 |
| 16 | Full-charge count | 0–255 |
| 19–20 | Cumulative charge (Hi, Lo) | Ah |
| 21 | High bits: PV voltage [bits 1-2] + PV current [bits 3-4] | MSBs |
| 24 | External temperature | actual + 100 (−40°C ถึง 87°C) |
| 25 | Internal temperature | actual + 100 |

**ตัวอย่างถอดรหัส Battery Voltage:**
```python
batt_v = (data[5] * 256 + data[6]) / 100   # e.g. 0x04DA → 12.42 V
load_a = (data[7] * 256 + data[8]) / 10    # e.g. 0x0004 → 0.4 A
pv_v   = data[10] / 10                     # e.g. 0x8C → 14.0 V
ext_temp = data[24] - 100                  # e.g. 0x7A → 22°C
```

### 15.4 อ่าน/เขียนพารามิเตอร์ตั้งค่า

| คำสั่ง | Frame | คำอธิบาย |
|---|---|---|
| อ่านพารามิเตอร์ | `AC B0 00 CA` | อ่านพารามิเตอร์ปัจจุบัน |
| Response | `AC 12 [len] [data...] CA` | ข้อมูลพารามิเตอร์ |
| ตั้งพารามิเตอร์ | `AC B2 12 [data...] CA` | เขียนพารามิเตอร์ (data 18 bytes) |

**โครงสร้าง data สำหรับตั้งค่า (AC B2, 18 bytes):**

| Byte | ความหมาย | ค่า |
|---|---|---|
| 0 | Battery type | 0x00=Li, 0x0D=AGM, 0x0C=Gel, 0x0B=Liquid, 0x0A=Custom |
| 1–5 | Time segments 1–5 | nibble สูง=เวลา(×0.5h), nibble ต่ำ=กำลัง(×10%) |
| 6 | Load current | ×0.05 = A (range 0.1–10.0 A) |
| 7 | Over-discharge voltage (LVDH) | ×0.1 = V (6.0–21.0 V) |
| 8 | Over-discharge voltage (LVDL) | เหมือน LVDH |
| 9 | LVR (reconnect voltage) | ×0.1 = V |
| 10 | Light control threshold | ÷10 = V (3.0–20.0 V) |
| 11 | Dimming flag / light-ctrl delay | bit7=dim on/off; bit6=365; low 5 bits=delay (นาที ×5) |
| 12 | Auto-dimming start voltage | ตรงกับช่วงแรงดันเป้าหมาย |
| 13 | Per-0.1V dimming ratio | high 2 bits=low-temp charge; low 5 bits=ratio (1–20%) |
| 14 | Li charge target / equalize voltage | ×0.1 = V (8.0–25.5 V) |
| 15 | Li recovery charge / boost | ×0.1 = V (7.5–25.3 V) |
| 16 | Voltage 9th bits + system select | MSB=0 ไฟถนน, 1=ระบบควบคุม |
| 17 | Infrared sensor | high nibble=delay (×10s, 0–150s); low nibble=no-motion power (×10%) |

**Response ตั้งค่า:**

| Frame | ความหมาย |
|---|---|
| `AC 11 00 CA` | สำเร็จ |
| `AC 10 00 CA` | ล้มเหลว (controller model ไม่ตรง) |
| `AC 1A 00 CA` | ค่า Load current อยู่นอก range |

---

## 16. Common Hardware Protocol (DE...ED Frame)

> โปรโตคอลร่วมสำหรับ Solar series ทั้งหมด (NJ-iot2410, NJ-iot401/402)  
> อ้างอิง: 公共协议类 — Xiamen NengJia

### 16.1 รีสตาร์ทอุปกรณ์

```
ส่ง: DE BA 12 ED
รับ: ไม่มี response
```

### 16.2 ตั้งค่าพารามิเตอร์อุปกรณ์

```
ส่ง: DE BB [interval] [baud_parity] [ctrl_flag] [poll_cmds...] ED
รับ: ไม่มี response
```

| Byte | ความหมาย | ค่า |
|---|---|---|
| 2 | Polling interval | `0x01`=1 นาที, `0x1E`=30 นาที |
| 3 | Baud rate + Parity | baud: 0=300, 1=600, 2=1200, 3=2400, 4=4800, 5=9600, 6=19200, 7=38400, 8=14400, 9=28800, A=57600, B=115200; parity: 0=None, 1=Odd, 2=Even |
| 4 | Controller flag | ดูเอกสารเพิ่มเติม |
| 5–N | Polling commands | ชุดคำสั่งที่ใช้ poll |

### 16.3 ตั้ง Timing Task (6 ช่วงเวลา)

```
ส่ง: DE AC [HH1][MM1] [HH2][MM2] ... [HH6][MM6] [L1][cmd1...] [L2][cmd2...] ... ED
รับ: ไม่มี response
```

- กำหนดได้สูงสุด 6 ช่วงเวลา (HH = ชั่วโมง 24H, MM = นาที)
- L1–L6 = ความยาว command แต่ละช่วง (01 = ไม่มีคำสั่ง, data = 00)

### 16.4 อ่าน Timing Task

```
ส่ง:   DE BD 00 ED
รับ:   CB A0 [6×2 bytes: HH MM] [cmd1] [cmd2] ... [cmd6]
```

Format ของแต่ละ command: `[index] [length] [data...]`  
ถ้าไม่มีคำสั่ง: `01 00` (ทุกช่วง → `01 00 01 00 01 00 01 00 01 00 01 00`)

### 16.5 Active Report เมื่อเชื่อมต่อ (Location + SIM)

อุปกรณ์จะส่งข้อมูลนี้ทันทีเมื่อเชื่อมต่อ server:

```
\xDD + [latitude_hex] + \xDE + [longitude_hex] + \xCC + [ICCID]
```

- ถ้าไม่มีสัญญาณ GPS: `\xDD\xDE\xCC` + ICCID (ไม่มีพิกัด)

### 16.6 MQTT Data Format (Uplink Packet)

ข้อมูลที่อุปกรณ์ส่งขึ้น MQTT Broker:

| Protocol | รูปแบบ |
|---|---|
| **TCP/IP** | `[IMEI]` + `[Controller Model]` + `[Data Packet]` + `[Signal Value]` |
| **MQTT** | `[Controller Model]` + `[Data Packet]` + `[Signal Value]` |

> Controller Model สำหรับ NJ-iot401 ดูจากเอกสารที่ทีม technical ของ Xiamen NengJia จัดเตรียมให้

