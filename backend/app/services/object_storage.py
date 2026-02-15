import io
import logging
from urllib.parse import quote, urlencode

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError, BotoCoreError

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
                    connect_timeout=5,
                    read_timeout=30,
                    retries={"max_attempts": 3, "mode": "standard"},
                ),
            )
            self._bucket = settings.S3_BUCKET
            self._ensure_bucket()

    def _ensure_bucket(self) -> None:
        """Create bucket if it doesn't exist (MinIO dev convenience)."""
        try:
            self._client.head_bucket(Bucket=self._bucket)
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code in ("404", "NoSuchBucket"):
                try:
                    self._client.create_bucket(Bucket=self._bucket)
                    logger.info("Created bucket: %s", self._bucket)
                except (ClientError, BotoCoreError) as create_err:
                    logger.warning("Could not create bucket %s: %s", self._bucket, create_err)
            else:
                logger.warning("Could not check bucket %s: %s", self._bucket, e)
        except BotoCoreError as e:
            logger.warning("Could not connect to object storage: %s", e)

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

    def presign_download(
        self,
        key: str,
        filename: str,
        expires: int = 300,
        response_content_type: str | None = None,
    ) -> str:
        """Create a temporary signed URL for direct browser download."""
        # Keep ASCII-safe header value and include RFC5987 UTF-8 fallback.
        safe_name = (filename or "document").replace('"', "")
        utf8_name = quote(safe_name, safe="")
        disposition = f'inline; filename="{safe_name}"; filename*=UTF-8\'\'{utf8_name}'
        params: dict[str, str] = {
            "Bucket": self._bucket,
            "Key": key,
            "ResponseContentDisposition": disposition,
        }
        if response_content_type:
            params["ResponseContentType"] = response_content_type
        return self._client.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=expires,
        )

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
