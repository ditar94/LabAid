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
) -> list[tuple[str, bytes, str, dict]]:
    """Fetch non-deleted QC documents for given lot IDs from storage.

    Returns list of (filename, file_bytes, content_type, metadata).
    """
    if not lot_ids or not object_storage.enabled:
        return []

    from app.models.models import Lot
    docs = (
        db.query(LotDocument, Lot.lot_number)
        .join(Lot, LotDocument.lot_id == Lot.id)
        .filter(
            LotDocument.lot_id.in_(lot_ids),
            LotDocument.lab_id == lab_id,
            LotDocument.is_qc_document.is_(True),
            LotDocument.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    results = []
    for doc, lot_number in docs:
        try:
            data, _ = object_storage.download(doc.file_path)
            meta = {
                "uploaded_at": doc.created_at.strftime("%Y-%m-%d %H:%M UTC") if doc.created_at else "",
                "lot_number": lot_number or "",
            }
            results.append((doc.file_name, data.read(), doc.content_type or "application/octet-stream", meta))
        except Exception:
            logger.warning("Failed to download QC doc %s (%s)", doc.id, doc.file_path)
    return results


def fetch_cocktail_qc_documents(
    db: Session,
    lab_id: UUID,
    cocktail_lot_ids: list[UUID],
) -> list[tuple[str, bytes, str, dict]]:
    """Fetch non-deleted QC documents for given cocktail lot IDs."""
    if not cocktail_lot_ids or not object_storage.enabled:
        return []

    from app.models.models import CocktailLot
    docs = (
        db.query(CocktailLotDocument, CocktailLot.lot_number)
        .join(CocktailLot, CocktailLotDocument.cocktail_lot_id == CocktailLot.id)
        .filter(
            CocktailLotDocument.cocktail_lot_id.in_(cocktail_lot_ids),
            CocktailLotDocument.lab_id == lab_id,
            CocktailLotDocument.is_qc_document.is_(True),
            CocktailLotDocument.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    results = []
    for doc, lot_number in docs:
        try:
            data, _ = object_storage.download(doc.file_path)
            rn = doc.renewal_number
            period = "Original" if rn == 0 else f"Renewal {rn}"
            meta = {
                "uploaded_at": doc.created_at.strftime("%Y-%m-%d %H:%M UTC") if doc.created_at else "",
                "lot_number": lot_number or "",
                "period": period,
            }
            results.append((doc.file_name, data.read(), doc.content_type or "application/octet-stream", meta))
        except Exception:
            logger.warning("Failed to download cocktail QC doc %s (%s)", doc.id, doc.file_path)
    return results


def build_export_zip(
    report_bytes: bytes,
    report_filename: str,
    documents: list[tuple[str, bytes, str, dict]],
) -> bytes:
    """Build a ZIP archive containing the report and QC documents."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(report_filename, report_bytes)
        seen_names: dict[str, int] = {}
        for filename, file_bytes, _, meta in documents:
            lot_num = meta.get("lot_number", "") if meta else ""
            prefix = f"{lot_num}_" if lot_num else ""
            name = f"{prefix}{filename}"
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


def _stamp_qc_metadata(page, filename: str, meta: dict | None):
    """Overlay a small bottom-left stamp with QC doc metadata onto a PDF page."""
    from app.services.pdf_renderer import render_qc_stamp_overlay

    mb = page.mediabox
    overlay_bytes = render_qc_stamp_overlay(
        filename=filename,
        uploaded_at=meta.get("uploaded_at", "") if meta else "",
        lot_number=meta.get("lot_number", "") if meta else "",
        period=meta.get("period", "") if meta else "",
        page_w_pt=float(mb.width),
        page_h_pt=float(mb.height),
    )
    overlay_page = PdfReader(io.BytesIO(overlay_bytes)).pages[0]
    page.merge_page(overlay_page)


def build_combined_pdf(
    report_pdf_bytes: bytes,
    documents: list[tuple[str, bytes, str, dict]],
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

    # Add QC document pages with footer stamp on first page
    for filename, file_bytes, content_type, meta in documents:
        ct = (content_type or "").lower()

        if ct == "application/pdf" or filename.lower().endswith(".pdf"):
            try:
                doc_reader = PdfReader(io.BytesIO(file_bytes))
                for i, page in enumerate(doc_reader.pages):
                    if i == 0:
                        _stamp_qc_metadata(page, filename, meta)
                    writer.add_page(page)
            except Exception:
                logger.warning("Failed to merge PDF document: %s", filename)
        elif ct in _IMAGE_MIMES or any(filename.lower().endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".gif")):
            pdf_bytes = _image_to_pdf(file_bytes)
            if pdf_bytes:
                try:
                    img_reader = PdfReader(io.BytesIO(pdf_bytes))
                    for i, page in enumerate(img_reader.pages):
                        if i == 0:
                            _stamp_qc_metadata(page, filename, meta)
                        writer.add_page(page)
                except Exception:
                    logger.warning("Failed to merge converted image: %s", filename)
        # else: skip non-convertible formats

    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()
