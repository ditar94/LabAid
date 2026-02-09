from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://labaid:labaid@localhost:5432/labaid"
    SECRET_KEY: str = "change-me-in-production-use-a-real-secret"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours

    # CORS
    CORS_ORIGINS: str = "http://localhost:5173"

    # Database pool
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 900

    # Object Storage (S3-compatible)
    S3_ENDPOINT_URL: str | None = None
    S3_ACCESS_KEY: str | None = None
    S3_SECRET_KEY: str | None = None
    S3_BUCKET: str = "labaid-documents"
    S3_REGION: str = "us-east-1"
    S3_USE_PATH_STYLE: bool = True

    # Server
    PORT: int = 8000

    # Cookie settings
    COOKIE_SECURE: bool = False  # Set True in production (requires HTTPS)
    COOKIE_DOMAIN: str | None = None  # Set to your domain in production
    COOKIE_SAMESITE: str = "lax"

    # File upload limits
    MAX_UPLOAD_SIZE_MB: int = 50

    # Google Cloud Error Reporting (set GCP_PROJECT to enable)
    GCP_PROJECT: str | None = None

    # Email notifications (SMTP)
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM: str | None = None
    ADMIN_EMAIL: str | None = None

    class Config:
        env_file = ".env"


settings = Settings()
