from fastapi import APIRouter
from models.responses import DeviceListData
from services.vendor_client import vendor_client

router = APIRouter()


@router.get("", response_model=DeviceListData, summary="ดูรายการอุปกรณ์ทั้งหมด")
async def list_devices(page: int = 1, size: int = 10):
    return await vendor_client.post_form("/deviceList", {"pageNumber": page, "pageSize": size})


@router.post("/{serial}", summary="เพิ่มอุปกรณ์เข้าบัญชี")
async def add_device(serial: str):
    return await vendor_client.post_form("/addDevice", {"serial": serial})


@router.delete("/{serial}", summary="ลบอุปกรณ์ออกจากบัญชี")
async def remove_device(serial: str):
    return await vendor_client.post_form("/delDevice", {"serial": serial})


@router.post("/{serial}/refresh", summary="บังคับ Poll สถานะทันที")
async def force_poll(serial: str):
    return await vendor_client.post_form("/updateStatus", {"serial": serial})


@router.post("/{serial}/refresh-params", summary="บังคับดึงพารามิเตอร์ทันที")
async def force_param_update(serial: str):
    return await vendor_client.post_form("/updateParams", {"serial": serial})
