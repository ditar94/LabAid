import io
import logging
from urllib.parse import urlencode

import boto3
from botocore.config import Config as BotoConfig

from app.core.config import settings

logger = logging.getLogger(__name__)


class ObjectStorageService:
    """S3-compatible object storage. Works with MinIO (dev) and GCS (prod)."""

    def __init__(self) -> None:
        self._enabled = bool(settings.S3_ENDPOINT_URL and settings.S3_ACCESS_KEY)
        if self._enabled:
            self._client = boto3.client(
                "s3",
                endpoint_url=settings.S3_ENDPOINT_URL,
                aws_access_key_id=settings.S3_ACCESS_KEY,
                aws_secret_access_key=settings.S3_SECRET_KEY,
                region_name=settings.S3_REGION,
                config=BotoConfig(
                    s3={"addressing_style": "path" if settings.S3_USE_PATH_STYLE else "virtual"},
                    signature_version="s3v4",
                ),
            )
            self._bucket = settings.S3_BUCKET
            self._ensure_bucket()

    def _ensure_bucket(self) -> None:
        """Create bucket if it doesn't exist (MinIO dev convenience)."""
        try:
            self._client.head_bucket(Bucket=self._bucket)
        except Exception:
            try:
                self._client.create_bucket(Bucket=self._bucket)
                logger.info("Created bucket: %s", self._bucket)
            except Exception as e:
                logger.warning("Could not create bucket %s: %s", self._bucket, e)

    @property
    def enabled(self) -> bool:
        return self._enabled

    def upload(
        self,
        key: str,
        data: io.BytesIO,
        content_type: str = "application/octet-stream",
        tags: dict[str, str] | None = None,
    ) -> str:
        """Upload a file. Returns the object key."""
        extra: dict = {"ContentType": content_type}
        if tags:
            extra["Tagging"] = urlencode(tags)
        self._client.upload_fileobj(data, self._bucket, key, ExtraArgs=extra)
        return key

    def download(self, key: str) -> tuple[io.BytesIO, str]:
        """Download a file. Returns (file_bytes, content_type)."""
        response = self._client.get_object(Bucket=self._bucket, Key=key)
        body = io.BytesIO(response["Body"].read())
        content_type = response.get("ContentType", "application/octet-stream")
        return body, content_type

    def update_tags(self, key: str, tags: dict[str, str]) -> None:
        """Replace all tags on an object."""
        tag_set = [{"Key": k, "Value": v} for k, v in tags.items()]
        self._client.put_object_tagging(
            Bucket=self._bucket,
            Key=key,
            Tagging={"TagSet": tag_set},
        )

    def delete(self, key: str) -> None:
        """Delete an object."""
        self._client.delete_object(Bucket=self._bucket, Key=key)


object_storage = ObjectStorageService()
