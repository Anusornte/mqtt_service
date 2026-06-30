from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator, field_validator


class AdjustLightRequest(BaseModel):
    style: Literal["on", "off", "dim"]
    power: Optional[int] = Field(None, ge=0, le=100)

    @model_validator(mode="after")
    def power_required_for_dim(self):
        if self.style == "dim" and self.power is None:
            raise ValueError("power (0-100) is required when style='dim'")
        return self


class TimeBrightnessEntry(BaseModel):
    h: int = Field(..., ge=0, le=23, description="ชั่วโมง")
    s: int = Field(..., ge=0, le=59, description="นาที")
    d: int = Field(..., ge=0, le=100, description="% ความสว่าง")


class SolarParamRequest(BaseModel):
    workPattern: Optional[int] = Field(None, ge=0, le=2, description="0=ปกติ, 1=24H, 2=D2D")
    timeBrightness: Optional[list[TimeBrightnessEntry]] = Field(None, description="ตารางเวลา (สูงสุด 6 ช่วง)")
    batteryType: Optional[int] = Field(None, ge=0, le=5, description="0=NMC,1=LFP,2=Custom,3=AGM,4=Gel,5=Flooded")
    batteryNumber: Optional[int] = Field(None, description="จำนวน Cell ต่อ Series")
    intelligent: Optional[int] = Field(None, ge=0, le=2, description="Derating mode: 0=เปิด,1=ปิด,2=365days")
    overchargeVoltage: Optional[float] = Field(None, description="แรงดัน Over-Discharge (V) แนะนำ 2.6")
    overchargeReturnVoltage: Optional[float] = Field(None, description="แรงดันกลับมาชาร์จหลัง Over-Discharge (V)")
    dischargeVoltage: Optional[float] = Field(None, description="แรงดัน Over-Charge (V) แนะนำ 3.6")
    dischargeReturnVoltage: Optional[float] = Field(None, description="แรงดันกลับจาก Over-Charge (V)")
    loadCurrent: Optional[float] = Field(None, description="กระแสโหลด (A)")
    startVoltage: Optional[float] = Field(None, description="จุดแรงดันเริ่ม Derating (V)")
    oneDeratingRatio: Optional[int] = Field(None, description="อัตรา Derating ต่อ 0.1V")
    twoDeratingRatio: Optional[int] = Field(None, description="สถานะการชาร์จที่ 0°C")
    sensorElayStart: Optional[int] = Field(None, description="Delay เซนเซอร์ IR (วินาที: 10,20,...150)")
    sensorUnmannedPower: Optional[int] = Field(None, ge=10, le=100, description="% กำลังไฟเมื่อไม่มีคน")
    turnOffVoltage: Optional[float] = Field(None, description="แรงดัน Light Sensor (V)")
    turnOffDelayTime: Optional[int] = Field(None, description="หน่วงเวลา Light Sensor (นาที)")

    @field_validator("timeBrightness")
    @classmethod
    def max_six_entries(cls, v):
        if v is not None and len(v) > 6:
            raise ValueError("timeBrightness ตั้งได้สูงสุด 6 ช่วงเวลาเท่านั้น")
        return v
