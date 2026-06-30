from fastapi import APIRouter
from models.requests import AdjustLightRequest, SolarParamRequest
from models.responses import SolarStatus
from services.vendor_client import vendor_client

router = APIRouter()


@router.get("/{serial}/status", response_model=SolarStatus, summary="ดูสถานะอุปกรณ์โซลาร์")
async def get_status(serial: str):
    return await vendor_client.post_form("/deviceStatus", {"serial": serial})


@router.post("/{serial}/light", summary="ปรับแสง / เปิด-ปิด (on | off | dim)")
async def control_light(serial: str, body: AdjustLightRequest):
    """
    - `style=on` → เปิดไฟ
    - `style=off` → ปิดไฟ
    - `style=dim` + `power=0-100` → ปรับ % ความสว่าง
    """
    data: dict = {"serial": serial, "style": body.style}
    if body.style == "dim":
        data["power"] = body.power
    return await vendor_client.post_form("/adjustLight", data)


@router.put("/{serial}/params", summary="ส่งพารามิเตอร์ตั้งค่า (ชาร์จ, ตารางเวลา, ฯลฯ)")
async def update_params(serial: str, body: SolarParamRequest):
    """
    ส่งเฉพาะ field ที่ต้องการเปลี่ยน — field ที่ไม่ส่งจะไม่ถูกแตะ

    **timeBrightness** — ตารางเวลาเปิดไฟ สูงสุด 6 ช่วง:
    ```json
    [{"h": 18, "s": 0, "d": 100}, {"h": 23, "s": 0, "d": 50}]
    ```
    """
    payload = {"producer": 2, **body.model_dump(exclude_none=True)}
    return await vendor_client.post_json("/distributeParam", serial, payload)
