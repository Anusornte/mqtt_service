from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import FileResponse
from services.vendor_client import vendor_client
from routers import devices, solar


@asynccontextmanager
async def lifespan(app: FastAPI):
    vendor_client.startup()
    yield
    await vendor_client.shutdown()


app = FastAPI(
    title="WEP IoT API",
    description="API wrapper สำหรับอุปกรณ์ IoT Solar Street Light",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(devices.router, prefix="/api/v1/devices", tags=["Devices"])
app.include_router(solar.router, prefix="/api/v1/solar", tags=["Solar"])


@app.get("/", include_in_schema=False)
async def ui():
    return FileResponse("static/index.html")
