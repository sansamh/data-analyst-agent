from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    cors_allowed_origins: str = "http://localhost:5175"
    workspace_root: str = "./data/workspace"
    code_timeout_seconds: int = 120
    max_upload_mb: int = 20

    class Config:
        env_file = ".env"


settings = Settings()
