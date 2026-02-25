"""Tests for SSO OIDC login flow (Phase 2)."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.core.security import create_access_token, decode_access_token
from app.models.models import (
    AuthProviderType,
    ExternalIdentity,
    Lab,
    LabAuthProvider,
    User,
    UserRole,
)
from app.core.security import hash_password


@pytest.fixture()
def sso_provider(db, lab):
    """Create an enabled Microsoft OIDC provider."""
    provider = LabAuthProvider(
        id=uuid.uuid4(),
        lab_id=lab.id,
        provider_type=AuthProviderType.OIDC_MICROSOFT,
        config={
            "client_id": "test-client-id",
            "tenant_id": "test-tenant-id",
            "client_secret": "test-secret",
        },
        email_domain="hospital.org",
        is_enabled=True,
    )
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return provider


@pytest.fixture()
def google_provider(db, lab):
    """Create an enabled Google OIDC provider."""
    provider = LabAuthProvider(
        id=uuid.uuid4(),
        lab_id=lab.id,
        provider_type=AuthProviderType.OIDC_GOOGLE,
        config={"client_id": "google-client-id", "client_secret": "google-secret"},
        email_domain="university.edu",
        is_enabled=True,
    )
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return provider


@pytest.fixture()
def sso_user(db, lab):
    """Create a user in the lab with an SSO-matching email."""
    user = User(
        id=uuid.uuid4(),
        lab_id=lab.id,
        email="doctor@hospital.org",
        hashed_password=hash_password("placeholder"),
        full_name="Dr. Test",
        role=UserRole.TECH,
        is_active=True,
        must_change_password=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


class TestSSOAuthorize:
    """GET /api/auth/sso/{provider_type}/authorize"""

    def test_authorize_redirects_to_provider(self, client, sso_provider):
        res = client.get(
            "/api/auth/sso/oidc_microsoft/authorize",
            params={"email_domain": "hospital.org"},
            follow_redirects=False,
        )
        assert res.status_code == 302
        location = res.headers["location"]
        assert "login.microsoftonline.com" in location
        assert "test-client-id" in location
        assert "state=" in location
        assert "prompt=select_account" in location

    def test_authorize_google_redirects(self, client, google_provider):
        res = client.get(
            "/api/auth/sso/oidc_google/authorize",
            params={"email_domain": "university.edu"},
            follow_redirects=False,
        )
        assert res.status_code == 302
        assert "accounts.google.com" in res.headers["location"]

    def test_authorize_unknown_provider_type(self, client):
        res = client.get(
            "/api/auth/sso/oidc_github/authorize",
            params={"email_domain": "example.com"},
        )
        assert res.status_code == 400

    def test_authorize_no_provider_for_domain(self, client, sso_provider):
        res = client.get(
            "/api/auth/sso/oidc_microsoft/authorize",
            params={"email_domain": "unknown.org"},
        )
        assert res.status_code == 404

    def test_authorize_disabled_provider(self, client, db, sso_provider):
        sso_provider.is_enabled = False
        db.commit()
        res = client.get(
            "/api/auth/sso/oidc_microsoft/authorize",
            params={"email_domain": "hospital.org"},
        )
        assert res.status_code == 404

    def test_authorize_state_contains_provider_id(self, client, sso_provider):
        res = client.get(
            "/api/auth/sso/oidc_microsoft/authorize",
            params={"email_domain": "hospital.org"},
            follow_redirects=False,
        )
        location = res.headers["location"]
        # Extract state from URL
        from urllib.parse import parse_qs, urlparse
        parsed = urlparse(location)
        state = parse_qs(parsed.query)["state"][0]
        payload = decode_access_token(state)
        assert payload is not None
        assert payload["provider_id"] == str(sso_provider.id)
        assert payload["purpose"] == "oidc_state"
        assert "nonce" in payload


class TestSSOCallback:
    """GET /api/auth/sso/callback"""

    def _make_state(self, provider_id: str, nonce: str = "test-nonce") -> str:
        return create_access_token(
            {"purpose": "oidc_state", "provider_id": provider_id, "nonce": nonce},
            expires_minutes=5,
        )

    @patch("app.routers.sso.validate_id_token", new_callable=AsyncMock)
    @patch("app.routers.sso.exchange_code", new_callable=AsyncMock)
    def test_callback_issues_jwt_cookie(
        self, mock_exchange, mock_validate, client, db, sso_provider, sso_user
    ):
        mock_exchange.return_value = {"id_token": "fake.id.token"}
        mock_validate.return_value = {
            "sub": "microsoft-user-123",
            "email": "doctor@hospital.org",
            "name": "Dr. Test",
            "nonce": "test-nonce",
        }

        state = self._make_state(str(sso_provider.id))
        res = client.get(
            "/api/auth/sso/callback",
            params={"code": "auth-code-123", "state": state},
            follow_redirects=False,
        )

        assert res.status_code == 302
        # Should redirect to app root
        assert res.headers["location"].endswith("/")
        # Should set the __session cookie
        cookies = res.cookies
        assert "__session" in res.headers.get("set-cookie", "")

    @patch("app.routers.sso.validate_id_token", new_callable=AsyncMock)
    @patch("app.routers.sso.exchange_code", new_callable=AsyncMock)
    def test_callback_creates_external_identity(
        self, mock_exchange, mock_validate, client, db, sso_provider, sso_user
    ):
        mock_exchange.return_value = {"id_token": "fake.id.token"}
        mock_validate.return_value = {
            "sub": "ms-sub-456",
            "email": "doctor@hospital.org",
            "name": "Dr. Test",
            "nonce": "test-nonce",
        }

        state = self._make_state(str(sso_provider.id))
        client.get(
            "/api/auth/sso/callback",
            params={"code": "auth-code", "state": state},
            follow_redirects=False,
        )

        # Verify external_identity was created
        ext = db.query(ExternalIdentity).filter(
            ExternalIdentity.provider_subject == "ms-sub-456"
        ).first()
        assert ext is not None
        assert ext.user_id == sso_user.id
        assert ext.provider_type == "oidc_microsoft"
        assert ext.provider_email == "doctor@hospital.org"

    @patch("app.routers.sso.validate_id_token", new_callable=AsyncMock)
    @patch("app.routers.sso.exchange_code", new_callable=AsyncMock)
    def test_callback_uses_existing_external_identity(
        self, mock_exchange, mock_validate, client, db, sso_provider, sso_user
    ):
        # Pre-create external identity
        ext = ExternalIdentity(
            user_id=sso_user.id,
            provider_type="oidc_microsoft",
            provider_subject="existing-sub-789",
            provider_email="doctor@hospital.org",
        )
        db.add(ext)
        db.commit()

        mock_exchange.return_value = {"id_token": "fake.id.token"}
        mock_validate.return_value = {
            "sub": "existing-sub-789",
            "email": "doctor@hospital.org",
            "name": "Dr. Test",
            "nonce": "test-nonce",
        }

        state = self._make_state(str(sso_provider.id))
        res = client.get(
            "/api/auth/sso/callback",
            params={"code": "auth-code", "state": state},
            follow_redirects=False,
        )

        assert res.status_code == 302
        # Should not create a duplicate
        count = db.query(ExternalIdentity).filter(
            ExternalIdentity.provider_subject == "existing-sub-789"
        ).count()
        assert count == 1

    def test_callback_invalid_state(self, client):
        res = client.get(
            "/api/auth/sso/callback",
            params={"code": "auth-code", "state": "invalid-jwt"},
            follow_redirects=False,
        )
        assert res.status_code == 400

    def test_callback_expired_state(self, client, sso_provider):
        state = create_access_token(
            {"purpose": "oidc_state", "provider_id": str(sso_provider.id), "nonce": "n"},
            expires_minutes=-1,  # Already expired
        )
        res = client.get(
            "/api/auth/sso/callback",
            params={"code": "auth-code", "state": state},
            follow_redirects=False,
        )
        assert res.status_code == 400

    @patch("app.routers.sso.validate_id_token", new_callable=AsyncMock)
    @patch("app.routers.sso.exchange_code", new_callable=AsyncMock)
    def test_callback_unknown_email_redirects_error(
        self, mock_exchange, mock_validate, client, sso_provider
    ):
        mock_exchange.return_value = {"id_token": "fake.id.token"}
        mock_validate.return_value = {
            "sub": "unknown-sub",
            "email": "nobody@hospital.org",
            "name": "Nobody",
            "nonce": "test-nonce",
        }

        state = self._make_state(str(sso_provider.id))
        res = client.get(
            "/api/auth/sso/callback",
            params={"code": "auth-code", "state": state},
            follow_redirects=False,
        )

        assert res.status_code == 302
        assert "error=user_not_found" in res.headers["location"]

    @patch("app.routers.sso.validate_id_token", new_callable=AsyncMock)
    @patch("app.routers.sso.exchange_code", new_callable=AsyncMock)
    def test_callback_inactive_user_redirects_error(
        self, mock_exchange, mock_validate, client, db, sso_provider, sso_user
    ):
        sso_user.is_active = False
        db.commit()

        mock_exchange.return_value = {"id_token": "fake.id.token"}
        mock_validate.return_value = {
            "sub": "ms-sub-inactive",
            "email": "doctor@hospital.org",
            "name": "Dr. Test",
            "nonce": "test-nonce",
        }

        state = self._make_state(str(sso_provider.id))
        res = client.get(
            "/api/auth/sso/callback",
            params={"code": "auth-code", "state": state},
            follow_redirects=False,
        )

        assert res.status_code == 302
        assert "error=user_inactive" in res.headers["location"]

    @patch("app.routers.sso.validate_id_token", new_callable=AsyncMock)
    @patch("app.routers.sso.exchange_code", new_callable=AsyncMock)
    def test_callback_inactive_lab_redirects_error(
        self, mock_exchange, mock_validate, client, db, sso_provider, sso_user, lab
    ):
        lab.is_active = False
        db.commit()

        mock_exchange.return_value = {"id_token": "fake.id.token"}
        mock_validate.return_value = {
            "sub": "ms-sub-labinactive",
            "email": "doctor@hospital.org",
            "name": "Dr. Test",
            "nonce": "test-nonce",
        }

        state = self._make_state(str(sso_provider.id))
        res = client.get(
            "/api/auth/sso/callback",
            params={"code": "auth-code", "state": state},
            follow_redirects=False,
        )

        assert res.status_code == 302
        assert "error=lab_inactive" in res.headers["location"]

    @patch("app.routers.sso.exchange_code", new_callable=AsyncMock)
    def test_callback_token_exchange_failure(self, mock_exchange, client, sso_provider):
        mock_exchange.side_effect = ValueError("Token exchange failed: 400")

        state = self._make_state(str(sso_provider.id))
        res = client.get(
            "/api/auth/sso/callback",
            params={"code": "bad-code", "state": state},
            follow_redirects=False,
        )

        assert res.status_code == 302
        assert "error=token_exchange_failed" in res.headers["location"]

    @patch("app.routers.sso.validate_id_token", new_callable=AsyncMock)
    @patch("app.routers.sso.exchange_code", new_callable=AsyncMock)
    def test_callback_jwt_has_correct_claims(
        self, mock_exchange, mock_validate, client, db, sso_provider, sso_user
    ):
        mock_exchange.return_value = {"id_token": "fake.id.token"}
        mock_validate.return_value = {
            "sub": "ms-claims-check",
            "email": "doctor@hospital.org",
            "name": "Dr. Test",
            "nonce": "test-nonce",
        }

        state = self._make_state(str(sso_provider.id))
        res = client.get(
            "/api/auth/sso/callback",
            params={"code": "auth-code", "state": state},
            follow_redirects=False,
        )

        # Extract JWT from set-cookie header
        cookie_header = res.headers.get("set-cookie", "")
        # Parse __session=<token>;
        for part in cookie_header.split(";"):
            part = part.strip()
            if part.startswith("__session="):
                token = part.split("=", 1)[1]
                break
        else:
            pytest.fail("No __session cookie found")

        payload = decode_access_token(token)
        assert payload is not None
        assert payload["sub"] == str(sso_user.id)
        assert payload["lab_id"] == str(sso_user.lab_id)
        assert payload["role"] == "tech"

    @patch("app.routers.sso.validate_id_token", new_callable=AsyncMock)
    @patch("app.routers.sso.exchange_code", new_callable=AsyncMock)
    def test_callback_disabled_provider_rejected(
        self, mock_exchange, mock_validate, client, db, sso_provider
    ):
        # State was created when provider was enabled, then provider was disabled
        state = self._make_state(str(sso_provider.id))
        sso_provider.is_enabled = False
        db.commit()

        res = client.get(
            "/api/auth/sso/callback",
            params={"code": "auth-code", "state": state},
            follow_redirects=False,
        )

        assert res.status_code == 400
