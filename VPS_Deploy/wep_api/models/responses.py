from typing import Optional
from pydantic import BaseModel


class DeviceListItem(BaseModel):
    iccid: Optional[str] = None
    serial: str
    latitude: Optional[str] = None
    longitude: Optional[str] = None
    is_online: int
    signal_strength: Optional[int] = None
    timestamp: Optional[int] = None


class DeviceListData(BaseModel):
    list: list[DeviceListItem]
    total: int
    size: int
    current: int


class SolarStatus(BaseModel):
    serial: str
    is_online: int
    signal_strength: Optional[int] = None
    is_lighting: Optional[int] = None
    timestamp: Optional[int] = None
    battery_voltage: Optional[float] = None
    battery_circuit: Optional[float] = None
    battery_power: Optional[float] = None
    led_voltage: Optional[float] = None
    led_circuit: Optional[float] = None
    led_power: Optional[float] = None
    solar_panel_voltage: Optional[float] = None
    solar_panel_circuit: Optional[float] = None
    solar_panel_power: Optional[float] = None
    battery_percent: Optional[int] = None
    outer_temperature: Optional[int] = None
    inner_temperature: Optional[int] = None
    charge_capacity: Optional[float] = None
    discharge_capacity: Optional[float] = None
    run_day: Optional[int] = None
    longitude: Optional[str] = None
    latitude: Optional[str] = None
