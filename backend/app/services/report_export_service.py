"""Report export service: packages report PDFs with QC documents.

Supports two output formats:
  - ZIP archive: report + qc_documents/ subfolder
  - Combined PDF: report pages merged with QC document pages (images converted to PDF)
"""

import io
import logging
import zipfile
from uuid import UUID

from pypdf import PdfReader, PdfWriter
from PIL import Image
from sqlalchemy.orm import Session

from app.models.models import CocktailLotDocument, LotDocument
from app.services.object_storage import object_storage

logger = logging.getLogger(__name__)

# Image formats Pillow can convert to PDF
_IMAGE_MIMES = {
    "image/png", "image/jpeg", "image/jpg", "image/tiff", "image/bmp", "image/gif",
}


def fetch_qc_documents(
    db: Session,
    lab_id: UUID,
    lot_ids: list[UUID],
) -> list[tuple[str, bytes, str]]:
    """Fetch non-deleted QC documents for given lot IDs from storage.

    Returns list of (filename, file_bytes, content_type).
    """
    if not lot_ids or not object_storage.enabled:
        return []

    docs = (
        db.query(LotDocument)
        .filter(
            LotDocument.lot_id.in_(lot_ids),
            LotDocument.lab_id == lab_id,
            LotDocument.is_qc_document.is_(True),
            LotDocument.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    results = []
    for doc in docs:
        try:
            data, _ = object_storage.download(doc.file_path)
            results.append((doc.file_name, data.read(), doc.content_type or "application/octet-stream"))
        except Exception:
            logger.warning("Failed to download QC doc %s (%s)", doc.id, doc.file_path)
    return results


def fetch_cocktail_qc_documents(
    db: Session,
    lab_id: UUID,
    cocktail_lot_ids: list[UUID],
) -> list[tuple[str, bytes, str]]:
    """Fetch non-deleted QC documents for given cocktail lot IDs."""
    if not cocktail_lot_ids or not object_storage.enabled:
        return []

    docs = (
        db.query(CocktailLotDocument)
        .filter(
            CocktailLotDocument.cocktail_lot_id.in_(cocktail_lot_ids),
            CocktailLotDocument.lab_id == lab_id,
            CocktailLotDocument.is_qc_document.is_(True),
            CocktailLotDocument.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    results = []
    for doc in docs:
        try:
            data, _ = object_storage.download(doc.file_path)
            results.append((doc.file_name, data.read(), doc.content_type or "application/octet-stream"))
        except Exception:
            logger.warning("Failed to download cocktail QC doc %s (%s)", doc.id, doc.file_path)
    return results


def build_export_zip(
    report_bytes: bytes,
    report_filename: str,
    documents: list[tuple[str, bytes, str]],
) -> bytes:
    """Build a ZIP archive containing the report and QC documents."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(report_filename, report_bytes)
        seen_names: dict[str, int] = {}
        for filename, file_bytes, _ in documents:
            # Deduplicate filenames
            name = filename
            if name in seen_names:
                seen_names[name] += 1
                parts = name.rsplit(".", 1)
                if len(parts) == 2:
                    name = f"{parts[0]}_{seen_names[name]}.{parts[1]}"
                else:
                    name = f"{name}_{seen_names[name]}"
            else:
                seen_names[name] = 0
            zf.writestr(f"qc_documents/{name}", file_bytes)
    return buf.getvalue()


def _image_to_pdf(image_bytes: bytes) -> bytes | None:
    """Convert an image to a single-page PDF using Pillow."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGB")
        pdf_buf = io.BytesIO()
        img.save(pdf_buf, format="PDF")
        return pdf_buf.getvalue()
    except Exception:
        logger.warning("Failed to convert image to PDF")
        return None


def build_combined_pdf(
    report_pdf_bytes: bytes,
    documents: list[tuple[str, bytes, str]],
) -> bytes:
    """Merge report PDF with QC document pages into one combined PDF.

    PDFs are appended directly. Images are converted to PDF pages via Pillow.
    Other formats are skipped (use ZIP export to include them).
    """
    writer = PdfWriter()

    # Add report pages
    report_reader = PdfReader(io.BytesIO(report_pdf_bytes))
    for page in report_reader.pages:
        writer.add_page(page)

    # Add QC document pages
    for filename, file_bytes, content_type in documents:
        ct = (content_type or "").lower()

        if ct == "application/pdf" or filename.lower().endswith(".pdf"):
            try:
                doc_reader = PdfReader(io.BytesIO(file_bytes))
                for page in doc_reader.pages:
                    writer.add_page(page)
            except Exception:
                logger.warning("Failed to merge PDF document: %s", filename)
        elif ct in _IMAGE_MIMES or any(filename.lower().endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".gif")):
            pdf_bytes = _image_to_pdf(file_bytes)
            if pdf_bytes:
                try:
                    img_reader = PdfReader(io.BytesIO(pdf_bytes))
                    for page in img_reader.pages:
                        writer.add_page(page)
                except Exception:
                    logger.warning("Failed to merge converted image: %s", filename)
        # else: skip non-convertible formats

    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()
