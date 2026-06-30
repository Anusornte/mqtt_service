from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    vendor_base_url: str = "http://xmnengjia.com/sdLamp/api/external"
    vendor_username: str
    vendor_password: str

    model_config = {"env_file": ".env"}


settings = Settings()
