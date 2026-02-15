"""Integration tests for document upload/download endpoints."""

import hashlib
import io
import uuid

import pytest

from app.core.security import create_access_token
from app.models.models import Antibody, Designation, Lot, QCStatus, User, UserRole


@pytest.fixture()
def antibody(db, lab):
    ab = Antibody(
        id=uuid.uuid4(),
        lab_id=lab.id,
        target="CD3",
        fluorochrome="FITC",
        designation=Designation.RUO,
    )
    db.add(ab)
    db.commit()
    db.refresh(ab)
    return ab


@pytest.fixture()
def lot(db, lab, antibody):
    lot = Lot(
        id=uuid.uuid4(),
        lab_id=lab.id,
        antibody_id=antibody.id,
        lot_number="LOT-001",
        vendor_barcode="BC001",
        qc_status=QCStatus.PENDING,
    )
    db.add(lot)
    db.commit()
    db.refresh(lot)
    return lot


class TestDocumentUpload:
    def test_upload_document(self, client, auth_headers, lot):
        """Upload a document to a lot (local filesystem fallback)."""
        file_content = b"fake PDF content"
        res = client.post(
            f"/api/documents/lots/{lot.id}",
            files={"file": ("test.pdf", io.BytesIO(file_content), "application/pdf")},
            data={"description": "QC report", "is_qc_document": "true"},
            headers=auth_headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["file_name"] == "test.pdf"
        assert data["description"] == "QC report"
        assert data["is_qc_document"] is True

    def test_upload_stores_blob_metadata(self, client, auth_headers, lot):
        """Upload stores file_size, content_type, and checksum_sha256."""
        file_content = b"blob metadata test content"
        expected_hash = hashlib.sha256(file_content).hexdigest()
        res = client.post(
            f"/api/documents/lots/{lot.id}",
            files={"file": ("meta.pdf", io.BytesIO(file_content), "application/pdf")},
            headers=auth_headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["file_size"] == len(file_content)
        assert data["content_type"] == "application/pdf"
        assert data["checksum_sha256"] == expected_hash

    def test_upload_to_nonexistent_lot(self, client, auth_headers):
        fake_id = uuid.uuid4()
        res = client.post(
            f"/api/documents/lots/{fake_id}",
            files={"file": ("test.pdf", io.BytesIO(b"data"), "application/pdf")},
            headers=auth_headers,
        )
        assert res.status_code == 404

    def test_upload_requires_auth(self, client, lot):
        res = client.post(
            f"/api/documents/lots/{lot.id}",
            files={"file": ("test.pdf", io.BytesIO(b"data"), "application/pdf")},
        )
        assert res.status_code == 401


class TestDocumentList:
    def test_list_lot_documents(self, client, auth_headers, lot):
        # Upload first
        client.post(
            f"/api/documents/lots/{lot.id}",
            files={"file": ("a.pdf", io.BytesIO(b"content"), "application/pdf")},
            headers=auth_headers,
        )
        client.post(
            f"/api/documents/lots/{lot.id}",
            files={"file": ("b.pdf", io.BytesIO(b"content"), "application/pdf")},
            headers=auth_headers,
        )

        res = client.get(f"/api/documents/lots/{lot.id}", headers=auth_headers)
        assert res.status_code == 200
        docs = res.json()
        assert len(docs) == 2

    def test_list_empty_lot(self, client, auth_headers, lot):
        res = client.get(f"/api/documents/lots/{lot.id}", headers=auth_headers)
        assert res.status_code == 200
        assert res.json() == []


class TestDocumentDownload:
    def test_download_document(self, client, auth_headers, lot):
        # Upload
        upload_res = client.post(
            f"/api/documents/lots/{lot.id}",
            files={"file": ("test.pdf", io.BytesIO(b"hello world"), "application/pdf")},
            headers=auth_headers,
        )
        doc_id = upload_res.json()["id"]

        # Download
        res = client.get(f"/api/documents/{doc_id}", headers=auth_headers)
        assert res.status_code == 200

    def test_download_nonexistent(self, client, auth_headers):
        fake_id = uuid.uuid4()
        res = client.get(f"/api/documents/{fake_id}", headers=auth_headers)
        assert res.status_code == 404


class TestDocumentRoleAccess:
    def test_tech_cannot_upload(self, client, db, lab, lot):
        """Techs should not be able to upload documents."""
        tech = User(
            id=uuid.uuid4(),
            lab_id=lab.id,
            email="tech@test.com",
            hashed_password="hashed",
            full_name="Tech User",
            role=UserRole.TECH,
            is_active=True,
            must_change_password=False,
        )
        db.add(tech)
        db.commit()

        token = create_access_token({
            "sub": str(tech.id),
            "lab_id": str(lab.id),
            "role": "tech",
        })
        headers = {"Authorization": f"Bearer {token}"}

        res = client.post(
            f"/api/documents/lots/{lot.id}",
            files={"file": ("test.pdf", io.BytesIO(b"data"), "application/pdf")},
            headers=headers,
        )
        assert res.status_code == 403


class TestDocumentSizeLimit:
    def test_reject_oversized_file(self, client, auth_headers, lot, monkeypatch):
        """Files exceeding MAX_UPLOAD_SIZE_MB are rejected."""
        from app.routers import documents
        monkeypatch.setattr(documents, "MAX_UPLOAD_BYTES", 100)  # 100 bytes limit
        big_content = b"x" * 200
        res = client.post(
            f"/api/documents/lots/{lot.id}",
            files={"file": ("big.pdf", io.BytesIO(big_content), "application/pdf")},
            headers=auth_headers,
        )
        assert res.status_code == 400
        assert "exceeds" in res.json()["detail"].lower()

    def test_reject_disallowed_mime_type(self, client, auth_headers, lot):
        """Files with disallowed MIME types are rejected."""
        res = client.post(
            f"/api/documents/lots/{lot.id}",
            files={"file": ("script.exe", io.BytesIO(b"data"), "application/x-msdownload")},
            headers=auth_headers,
        )
        assert res.status_code == 400
        assert "not allowed" in res.json()["detail"].lower()


class TestIntegrityCheck:
    def test_integrity_check_ok(self, client, auth_headers):
        """Super admin can run integrity checks."""
        res = client.get("/api/admin/integrity", headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["checks"]["orphaned_lots"] == 0
        assert data["checks"]["orphaned_vials"] == 0
        assert data["checks"]["orphaned_documents"] == 0

    def test_integrity_check_requires_super_admin(self, client, db, lab):
        """Non-super-admin users cannot access integrity checks."""
        tech = User(
            id=uuid.uuid4(),
            lab_id=lab.id,
            email="integ-tech@test.com",
            hashed_password="hashed",
            full_name="Tech",
            role=UserRole.TECH,
            is_active=True,
            must_change_password=False,
        )
        db.add(tech)
        db.commit()
        token = create_access_token({
            "sub": str(tech.id),
            "lab_id": str(lab.id),
            "role": "tech",
        })
        res = client.get("/api/admin/integrity", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 403
