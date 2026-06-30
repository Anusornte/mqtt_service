import httpx
from fastapi import HTTPException
from config import settings

# map vendor error code → (HTTP status, message)
VENDOR_ERRORS: dict[int, tuple[int, str]] = {
    1002: (400, "Device serial number error"),
    1004: (400, "Device type error"),
    1005: (429, "Rate limit exceeded — 100 req/24h/device/endpoint"),
    1006: (400, "Incorrect parameter content"),
    1007: (400, "Invalid instruction"),
    1008: (400, "Parameters do not match controller type"),
    2000: (401, "Vendor username or password incorrect"),
    20002: (404, "Device not found — add it first with POST /devices/{serial}"),
    20003: (409, "Device already added to this account"),
    20004: (403, "This account does not own the device"),
    60003: (404, "Vendor user does not exist"),
}


class VendorClient:
    def __init__(self):
        self._token: str | None = None
        self._http: httpx.AsyncClient | None = None

    def startup(self):
        self._http = httpx.AsyncClient(
            base_url=settings.vendor_base_url,
            timeout=30.0,
        )

    async def shutdown(self):
        if self._http:
            await self._http.aclose()

    async def _refresh_token(self) -> str:
        resp = await self._http.post("/accessToken", data={
            "username": settings.vendor_username,
            "password": settings.vendor_password,
        })
        result = resp.json()
        if result["code"] not in (1000, 1001):
            raise HTTPException(status_code=401, detail="Cannot obtain vendor token")
        self._token = result["data"]
        return self._token

    async def _get_token(self) -> str:
        return self._token or await self._refresh_token()

    def _raise_for_error(self, code: int, msg: str):
        if code in (1000, 1001):
            return
        http_status, detail = VENDOR_ERRORS.get(code, (502, msg))
        raise HTTPException(status_code=http_status, detail=detail)

    async def post_form(self, endpoint: str, data: dict) -> dict | None:
        """POST x-www-form-urlencoded — accessToken แนบใน body อัตโนมัติ"""
        token = await self._get_token()
        payload = {"accessToken": token, **data}

        resp = await self._http.post(endpoint, data=payload)
        result = resp.json()

        if result["code"] == 1003:
            payload["accessToken"] = await self._refresh_token()
            resp = await self._http.post(endpoint, data=payload)
            result = resp.json()

        self._raise_for_error(result["code"], result.get("msg", ""))
        return result.get("data")

    async def post_json(self, endpoint: str, serial: str, body: dict) -> dict | None:
        """POST JSON body — accessToken + serial แนบเป็น URL query params"""
        token = await self._get_token()

        resp = await self._http.post(
            endpoint,
            params={"accessToken": token, "serial": serial},
            json=body,
        )
        result = resp.json()

        if result["code"] == 1003:
            token = await self._refresh_token()
            resp = await self._http.post(
                endpoint,
                params={"accessToken": token, "serial": serial},
                json=body,
            )
            result = resp.json()

        self._raise_for_error(result["code"], result.get("msg", ""))
        return result.get("data")


vendor_client = VendorClient()
