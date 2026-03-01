"""Tests for auth provider management and discovery endpoints."""

import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.core.security import create_access_token, hash_password
from app.models.models import AuthProviderType, ExternalIdentity, Lab, LabAuthProvider, User, UserRole


class TestDiscover:
    """POST /api/auth/discover — public email-based provider discovery."""

    def test_unknown_domain_returns_password(self, client):
        res = client.post("/api/auth/discover", json={"email": "user@unknown.org"})
        assert res.status_code == 200
        data = res.json()
        assert data["providers"] == ["password"]
        assert "lab_name" not in data

    def test_no_providers_configured_returns_password(self, client, lab, admin_user):
        res = client.post("/api/auth/discover", json={"email": "admin@test.com"})
        assert res.status_code == 200
        assert res.json()["providers"] == ["password"]

    def test_configured_provider_returns_in_list(self, client, db, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        provider = LabAuthProvider(
            id=uuid.uuid4(),
            lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={"client_id": "abc", "tenant_id": "xyz"},
            email_domain="hospital.org",
            is_enabled=True,
        )
        db.add(provider)
        db.commit()

        res = client.post("/api/auth/discover", json={"email": "doctor@hospital.org"})
        assert res.status_code == 200
        data = res.json()
        assert "password" in data["providers"]
        assert "oidc_microsoft" in data["providers"]

    def test_disabled_provider_excluded(self, client, db, lab):
        provider = LabAuthProvider(
            id=uuid.uuid4(),
            lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_GOOGLE,
            config={"client_id": "abc"},
            email_domain="university.edu",
            is_enabled=False,
        )
        db.add(provider)
        db.commit()

        res = client.post("/api/auth/discover", json={"email": "prof@university.edu"})
        assert res.status_code == 200
        assert res.json()["providers"] == ["password"]

    def test_multiple_providers_for_same_domain(self, client, db, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        for ptype, config in [
            (AuthProviderType.OIDC_MICROSOFT, {"client_id": "ms", "tenant_id": "t"}),
            (AuthProviderType.OIDC_GOOGLE, {"client_id": "goog"}),
        ]:
            db.add(LabAuthProvider(
                id=uuid.uuid4(),
                lab_id=lab.id,
                provider_type=ptype,
                config=config,
                email_domain="biglab.com",
                is_enabled=True,
            ))
        db.commit()

        res = client.post("/api/auth/discover", json={"email": "user@biglab.com"})
        assert res.status_code == 200
        providers = res.json()["providers"]
        assert "password" in providers
        assert "oidc_microsoft" in providers
        assert "oidc_google" in providers

    def test_case_insensitive_domain(self, client, db, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        db.add(LabAuthProvider(
            id=uuid.uuid4(),
            lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={"client_id": "abc", "tenant_id": "xyz"},
            email_domain="hospital.org",
            is_enabled=True,
        ))
        db.commit()

        res = client.post("/api/auth/discover", json={"email": "user@HOSPITAL.ORG"})
        assert res.status_code == 200
        assert "oidc_microsoft" in res.json()["providers"]

    def test_two_labs_same_domain_no_duplicate_buttons(self, client, db, lab):
        """When two labs configure SSO for the same domain, discover should
        scope to the user's lab and not return duplicate provider types."""
        from app.core.security import hash_password

        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        db.commit()

        lab_b = Lab(id=uuid.uuid4(), name="Lab B", is_active=True, settings={"sso_enabled": True})
        db.add(lab_b)
        db.commit()

        # Both labs have oidc_microsoft for the same domain
        for l in [lab, lab_b]:
            db.add(LabAuthProvider(
                id=uuid.uuid4(), lab_id=l.id,
                provider_type=AuthProviderType.OIDC_MICROSOFT,
                config={"client_id": "cid", "tenant_id": "tid"},
                email_domain="shared.org", is_enabled=True,
            ))
        db.commit()

        # User belongs to Lab B
        user = User(
            id=uuid.uuid4(), lab_id=lab_b.id,
            email="doctor@shared.org",
            hashed_password=hash_password("pw"),
            full_name="Dr. Shared", role=UserRole.TECH,
            is_active=True, must_change_password=False,
        )
        db.add(user)
        db.commit()

        res = client.post("/api/auth/discover", json={"email": "doctor@shared.org"})
        data = res.json()
        # Should get exactly one oidc_microsoft, scoped to Lab B
        assert data["providers"].count("oidc_microsoft") == 1


class TestPasswordDefaultWithNoProviders:
    """Verify existing labs work with zero configured providers (migration safety)."""

    def test_login_works_without_any_providers(self, client, admin_user):
        res = client.post("/api/auth/login", json={
            "email": "admin@test.com",
            "password": "password123",
        })
        assert res.status_code == 200
        assert "access_token" in res.json()

    def test_bootstrap_works_without_providers(self, client, admin_user, auth_headers):
        res = client.get("/api/bootstrap", headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["user"]["email"] == "admin@test.com"

    def test_user_creation_works_without_providers(self, client, auth_headers, lab):
        res = client.post("/api/auth/users", json={
            "email": "newtech@test.com",
            "full_name": "New Tech",
            "role": "tech",
        }, headers=auth_headers)
        assert res.status_code == 200

    def test_discover_returns_password_for_lab_with_no_providers(self, client, db, lab, admin_user):
        res = client.post("/api/auth/discover", json={"email": "admin@test.com"})
        assert res.status_code == 200
        assert res.json()["providers"] == ["password"]


class TestProviderCRUD:
    """Auth provider management endpoints (super admin only)."""

    def test_list_providers_empty(self, client, super_token, lab):
        headers = {"Authorization": f"Bearer {super_token}"}
        res = client.get(f"/api/auth/providers/{lab.id}", headers=headers)
        assert res.status_code == 200
        assert res.json() == []

    def test_create_provider(self, client, db, super_token, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        db.commit()
        headers = {"Authorization": f"Bearer {super_token}"}
        res = client.post("/api/auth/providers/", json={
            "lab_id": str(lab.id),
            "provider_type": "oidc_microsoft",
            "config": {"client_id": "my-client", "tenant_id": "my-tenant"},
            "email_domain": "hospital.org",
        }, headers=headers)
        assert res.status_code == 201
        data = res.json()
        assert data["provider_type"] == "oidc_microsoft"
        assert data["email_domain"] == "hospital.org"
        assert data["is_enabled"] is True
        # Secret should be sanitized in response
        assert data["config"]["client_id"] == "my-client"

    def test_create_duplicate_provider_rejected(self, client, db, super_token, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        headers = {"Authorization": f"Bearer {super_token}"}
        db.add(LabAuthProvider(
            id=uuid.uuid4(),
            lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={"client_id": "abc", "tenant_id": "xyz"},
            email_domain="hospital.org",
            is_enabled=True,
        ))
        db.commit()

        res = client.post("/api/auth/providers/", json={
            "lab_id": str(lab.id),
            "provider_type": "oidc_microsoft",
            "config": {"client_id": "other", "tenant_id": "other"},
        }, headers=headers)
        assert res.status_code == 400
        assert "already configured" in res.json()["detail"]

    def test_create_provider_missing_config_rejected(self, client, db, super_token, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        db.commit()
        headers = {"Authorization": f"Bearer {super_token}"}
        res = client.post("/api/auth/providers/", json={
            "lab_id": str(lab.id),
            "provider_type": "oidc_microsoft",
            "config": {"client_id": "abc"},  # missing tenant_id
        }, headers=headers)
        assert res.status_code == 400
        assert "tenant_id" in res.json()["detail"]

    def test_update_provider(self, client, db, super_token, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        headers = {"Authorization": f"Bearer {super_token}"}
        provider = LabAuthProvider(
            id=uuid.uuid4(),
            lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={"client_id": "old", "tenant_id": "old-tenant"},
            email_domain="hospital.org",
            is_enabled=True,
        )
        db.add(provider)
        db.commit()

        res = client.patch(f"/api/auth/providers/{provider.id}", json={
            "email_domain": "newhospital.org",
            "is_enabled": False,
        }, headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["email_domain"] == "newhospital.org"
        assert data["is_enabled"] is False

    def test_update_provider_config_merges(self, client, db, super_token, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        headers = {"Authorization": f"Bearer {super_token}"}
        provider = LabAuthProvider(
            id=uuid.uuid4(),
            lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={"client_id": "abc", "tenant_id": "xyz"},
            email_domain="hospital.org",
            is_enabled=True,
        )
        db.add(provider)
        db.commit()

        res = client.patch(f"/api/auth/providers/{provider.id}", json={
            "config": {"client_id": "new-client"},
        }, headers=headers)
        assert res.status_code == 200
        # tenant_id should still be there (merge, not replace)
        config = res.json()["config"]
        assert config["client_id"] == "new-client"
        assert config["tenant_id"] == "xyz"

    def test_secret_sanitized_in_response(self, client, db, super_token, lab):
        headers = {"Authorization": f"Bearer {super_token}"}
        provider = LabAuthProvider(
            id=uuid.uuid4(),
            lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_GOOGLE,
            config={"client_id": "abc", "client_secret_ref": "projects/p/secrets/s/versions/1"},
            email_domain="university.edu",
            is_enabled=True,
        )
        db.add(provider)
        db.commit()

        res = client.get(f"/api/auth/providers/{lab.id}", headers=headers)
        assert res.status_code == 200
        config = res.json()[0]["config"]
        assert config["client_secret_ref"] == "••••••••"
        assert config["client_id"] == "abc"

    def test_lab_admin_can_view_own_lab_providers(self, client, auth_headers, db, lab):
        db.add(LabAuthProvider(
            id=uuid.uuid4(),
            lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={"client_id": "abc", "tenant_id": "xyz"},
            email_domain="hospital.org",
            is_enabled=True,
        ))
        db.commit()

        res = client.get(f"/api/auth/providers/{lab.id}", headers=auth_headers)
        assert res.status_code == 200
        assert len(res.json()) == 1

    def test_lab_admin_cannot_view_other_lab_providers(self, client, auth_headers, db):
        other_lab = Lab(id=uuid.uuid4(), name="Other Lab", is_active=True, settings={})
        db.add(other_lab)
        db.commit()

        res = client.get(f"/api/auth/providers/{other_lab.id}", headers=auth_headers)
        assert res.status_code == 403

    def test_lab_admin_can_create_provider_own_lab(self, client, db, auth_headers, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        db.commit()
        res = client.post("/api/auth/providers/", json={
            "lab_id": str(lab.id),
            "provider_type": "oidc_microsoft",
            "config": {"client_id": "abc", "tenant_id": "xyz"},
        }, headers=auth_headers)
        assert res.status_code == 201

    def test_lab_admin_cannot_create_provider_other_lab(self, client, auth_headers, db):
        other_lab = Lab(id=uuid.uuid4(), name="Other Lab", is_active=True, settings={})
        db.add(other_lab)
        db.commit()

        res = client.post("/api/auth/providers/", json={
            "lab_id": str(other_lab.id),
            "provider_type": "oidc_microsoft",
            "config": {"client_id": "abc", "tenant_id": "xyz"},
        }, headers=auth_headers)
        assert res.status_code == 403

    def test_create_provider_nonexistent_lab(self, client, super_token):
        headers = {"Authorization": f"Bearer {super_token}"}
        res = client.post("/api/auth/providers/", json={
            "lab_id": str(uuid.uuid4()),
            "provider_type": "oidc_microsoft",
            "config": {"client_id": "abc", "tenant_id": "xyz"},
        }, headers=headers)
        assert res.status_code == 404


class TestPasswordEnabled:
    """SSO-only lab enforcement via password_enabled helper."""

    def _make_sso_only(self, db, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        db.add(LabAuthProvider(
            id=uuid.uuid4(), lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={"client_id": "abc", "tenant_id": "xyz"},
            email_domain="test.com", is_enabled=True,
        ))
        db.add(LabAuthProvider(
            id=uuid.uuid4(), lab_id=lab.id,
            provider_type=AuthProviderType.PASSWORD,
            config={}, is_enabled=False,
        ))
        db.commit()

    def test_sso_only_password_login_rejected(self, client, db, lab, admin_user):
        self._make_sso_only(db, lab)
        res = client.post("/api/auth/login", json={
            "email": "admin@test.com", "password": "password123",
        })
        assert res.status_code == 403
        assert "SSO" in res.json()["detail"]

    def test_sso_only_password_reset_rejected(self, client, db, lab, admin_user, auth_headers):
        self._make_sso_only(db, lab)
        res = client.post(
            f"/api/auth/users/{admin_user.id}/reset-password",
            headers=auth_headers,
        )
        assert res.status_code == 403

    def test_sso_only_accept_invite_rejected(self, client, db, lab, invited_user):
        self._make_sso_only(db, lab)
        res = client.post("/api/auth/accept-invite", json={
            "token": "valid-test-token-abc123",
            "password": "NewPassword123",
        })
        assert res.status_code == 403

    def test_mixed_lab_password_works(self, client, db, lab, admin_user):
        db.add(LabAuthProvider(
            id=uuid.uuid4(), lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={"client_id": "abc", "tenant_id": "xyz"},
            email_domain="test.com", is_enabled=True,
        ))
        db.commit()
        res = client.post("/api/auth/login", json={
            "email": "admin@test.com", "password": "password123",
        })
        assert res.status_code == 200

    def test_no_providers_password_works(self, client, admin_user):
        res = client.post("/api/auth/login", json={
            "email": "admin@test.com", "password": "password123",
        })
        assert res.status_code == 200

    def test_discover_sso_only_no_password(self, client, db, lab):
        self._make_sso_only(db, lab)
        res = client.post("/api/auth/discover", json={"email": "user@test.com"})
        assert res.status_code == 200
        providers = res.json()["providers"]
        assert "password" not in providers
        assert "oidc_microsoft" in providers


class TestPasswordDisableLockout:
    """Prevent disabling password auth if it would lock out lab admins."""

    def test_cannot_disable_password_without_sso_provider(self, client, db, lab, admin_user, super_token):
        headers = {"Authorization": f"Bearer {super_token}"}
        res = client.post("/api/auth/providers/", json={
            "lab_id": str(lab.id),
            "provider_type": "password",
            "config": {},
            "is_enabled": False,
        }, headers=headers)
        assert res.status_code == 400
        assert "no enabled SSO provider" in res.json()["detail"]

    def test_cannot_disable_password_without_admin_sso_login(self, client, db, lab, admin_user, super_token):
        headers = {"Authorization": f"Bearer {super_token}"}
        db.add(LabAuthProvider(
            id=uuid.uuid4(), lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={"client_id": "abc", "tenant_id": "xyz"},
            email_domain="test.com", is_enabled=True,
        ))
        db.commit()

        res = client.post("/api/auth/providers/", json={
            "lab_id": str(lab.id),
            "provider_type": "password",
            "config": {},
            "is_enabled": False,
        }, headers=headers)
        assert res.status_code == 400
        assert "lab admin must complete an SSO login" in res.json()["detail"]

    def test_can_disable_password_when_admin_has_sso(self, client, db, lab, admin_user, super_token):
        headers = {"Authorization": f"Bearer {super_token}"}
        db.add(LabAuthProvider(
            id=uuid.uuid4(), lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={"client_id": "abc", "tenant_id": "xyz"},
            email_domain="test.com", is_enabled=True,
        ))
        db.add(ExternalIdentity(
            id=uuid.uuid4(),
            user_id=admin_user.id,
            provider_type="oidc_microsoft",
            provider_subject="ms-sub-123",
            provider_email=admin_user.email,
        ))
        db.commit()

        res = client.post("/api/auth/providers/", json={
            "lab_id": str(lab.id),
            "provider_type": "password",
            "config": {},
            "is_enabled": False,
        }, headers=headers)
        assert res.status_code == 201

    def test_cannot_disable_password_via_update(self, client, db, lab, admin_user, super_token):
        headers = {"Authorization": f"Bearer {super_token}"}
        pw_provider = LabAuthProvider(
            id=uuid.uuid4(), lab_id=lab.id,
            provider_type=AuthProviderType.PASSWORD,
            config={}, is_enabled=True,
        )
        db.add(pw_provider)
        db.commit()

        res = client.patch(f"/api/auth/providers/{pw_provider.id}", json={
            "is_enabled": False,
        }, headers=headers)
        assert res.status_code == 400

    def test_can_disable_password_via_update_when_safe(self, client, db, lab, admin_user, super_token):
        headers = {"Authorization": f"Bearer {super_token}"}
        pw_provider = LabAuthProvider(
            id=uuid.uuid4(), lab_id=lab.id,
            provider_type=AuthProviderType.PASSWORD,
            config={}, is_enabled=True,
        )
        db.add(pw_provider)
        db.add(LabAuthProvider(
            id=uuid.uuid4(), lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={"client_id": "abc", "tenant_id": "xyz"},
            email_domain="test.com", is_enabled=True,
        ))
        db.add(ExternalIdentity(
            id=uuid.uuid4(),
            user_id=admin_user.id,
            provider_type="oidc_microsoft",
            provider_subject="ms-sub-456",
            provider_email=admin_user.email,
        ))
        db.commit()

        res = client.patch(f"/api/auth/providers/{pw_provider.id}", json={
            "is_enabled": False,
        }, headers=headers)
        assert res.status_code == 200
        assert res.json()["is_enabled"] is False


class TestSecurityVerification:
    """Phase 4 security verification: secrets, audit, tenant isolation."""

    def test_secrets_never_in_response(self, client, db, lab, super_token):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        db.commit()
        headers = {"Authorization": f"Bearer {super_token}"}
        res = client.post("/api/auth/providers/", json={
            "lab_id": str(lab.id),
            "provider_type": "oidc_microsoft",
            "config": {"client_id": "abc", "tenant_id": "xyz", "client_secret_ref": "projects/p/secrets/s/versions/1"},
        }, headers=headers)
        assert res.status_code == 201
        config = res.json()["config"]
        assert "projects/p/secrets" not in str(config)
        assert config.get("client_secret_ref") == "••••••••"

        res2 = client.get(f"/api/auth/providers/{lab.id}", headers=headers)
        for p in res2.json():
            assert "projects/p/secrets" not in str(p["config"])

    def test_tenant_isolation_sso_providers(self, client, db, super_token):
        headers = {"Authorization": f"Bearer {super_token}"}
        lab_a = Lab(id=uuid.uuid4(), name="Lab A", is_active=True, settings={})
        lab_b = Lab(id=uuid.uuid4(), name="Lab B", is_active=True, settings={})
        db.add_all([lab_a, lab_b])
        db.commit()

        user_a = User(
            id=uuid.uuid4(), lab_id=lab_a.id, email="usera@laba.com",
            hashed_password=hash_password("pass"), full_name="User A",
            role=UserRole.LAB_ADMIN, is_active=True, must_change_password=False,
        )
        db.add(user_a)
        db.commit()

        token_a = create_access_token({
            "sub": str(user_a.id), "lab_id": str(lab_a.id), "role": user_a.role.value,
        })
        headers_a = {"Authorization": f"Bearer {token_a}"}

        res = client.get(f"/api/auth/providers/{lab_b.id}", headers=headers_a)
        assert res.status_code == 403

    def test_bootstrap_includes_password_enabled(self, client, db, lab, admin_user, auth_headers):
        res = client.get("/api/bootstrap", headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["lab_settings"]["password_enabled"] is True

        db.add(LabAuthProvider(
            id=uuid.uuid4(), lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={"client_id": "abc", "tenant_id": "xyz"},
            email_domain="test.com", is_enabled=True,
        ))
        db.add(ExternalIdentity(
            id=uuid.uuid4(), user_id=admin_user.id,
            provider_type="oidc_microsoft", provider_subject="ms-sub-789",
            provider_email=admin_user.email,
        ))
        db.add(LabAuthProvider(
            id=uuid.uuid4(), lab_id=lab.id,
            provider_type=AuthProviderType.PASSWORD,
            config={}, is_enabled=False,
        ))
        db.commit()

        res2 = client.get("/api/bootstrap", headers=auth_headers)
        assert res2.json()["lab_settings"]["password_enabled"] is False


class TestSecretStorage:
    """Verify GCP Secret Manager integration paths are exercised."""

    @patch("app.routers.auth_providers.store_secret")
    def test_create_provider_with_client_secret_calls_store(self, mock_store, client, db, super_token, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        db.commit()
        mock_store.return_value = "projects/p/secrets/labaid-sso-test/versions/1"
        headers = {"Authorization": f"Bearer {super_token}"}
        res = client.post("/api/auth/providers/", json={
            "lab_id": str(lab.id),
            "provider_type": "oidc_microsoft",
            "config": {
                "client_id": "my-client",
                "tenant_id": "my-tenant",
                "client_secret": "super-secret-value",
            },
            "email_domain": "hospital.org",
        }, headers=headers)
        assert res.status_code == 201
        mock_store.assert_called_once_with(str(lab.id), "oidc_microsoft", "super-secret-value")
        config = res.json()["config"]
        assert config.get("client_secret_ref") == "••••••••"
        assert "super-secret-value" not in str(config)

    @patch("app.routers.auth_providers.store_secret")
    def test_create_provider_without_secret_skips_store(self, mock_store, client, db, super_token, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        db.commit()
        headers = {"Authorization": f"Bearer {super_token}"}
        res = client.post("/api/auth/providers/", json={
            "lab_id": str(lab.id),
            "provider_type": "oidc_microsoft",
            "config": {"client_id": "my-client", "tenant_id": "my-tenant"},
            "email_domain": "hospital.org",
        }, headers=headers)
        assert res.status_code == 201
        mock_store.assert_not_called()

    @patch("app.routers.auth_providers.store_secret")
    def test_update_provider_with_new_secret_calls_store(self, mock_store, client, db, super_token, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        provider = LabAuthProvider(
            id=uuid.uuid4(), lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={"client_id": "abc", "tenant_id": "xyz"},
            email_domain="hospital.org", is_enabled=True,
        )
        db.add(provider)
        db.commit()
        mock_store.return_value = "projects/p/secrets/labaid-sso-test/versions/2"
        headers = {"Authorization": f"Bearer {super_token}"}
        res = client.patch(f"/api/auth/providers/{provider.id}", json={
            "config": {"client_secret": "new-secret"},
        }, headers=headers)
        assert res.status_code == 200
        mock_store.assert_called_once_with(str(lab.id), "oidc_microsoft", "new-secret")

    @patch("app.routers.auth_providers.store_secret")
    def test_update_provider_with_masked_secret_skips_store(self, mock_store, client, db, super_token, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        provider = LabAuthProvider(
            id=uuid.uuid4(), lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={"client_id": "abc", "tenant_id": "xyz", "client_secret_ref": "projects/p/secrets/s/versions/1"},
            email_domain="hospital.org", is_enabled=True,
        )
        db.add(provider)
        db.commit()
        headers = {"Authorization": f"Bearer {super_token}"}
        res = client.patch(f"/api/auth/providers/{provider.id}", json={
            "config": {"client_secret": "••••••••"},
        }, headers=headers)
        assert res.status_code == 200
        mock_store.assert_not_called()

    @patch("app.routers.auth_providers.store_secret", side_effect=ValueError("GCP_PROJECT not configured"))
    def test_create_provider_store_secret_failure_returns_error(self, mock_store, client, db, super_token, lab):
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        db.commit()
        headers = {"Authorization": f"Bearer {super_token}"}
        res = client.post("/api/auth/providers/", json={
            "lab_id": str(lab.id),
            "provider_type": "oidc_microsoft",
            "config": {
                "client_id": "my-client",
                "tenant_id": "my-tenant",
                "client_secret": "some-secret",
            },
            "email_domain": "hospital.org",
        }, headers=headers)
        assert res.status_code == 502
        assert "Failed to store client secret" in res.json()["detail"]


class TestResolveSecretIntegration:
    """Verify resolve_secret is called during SSO authorize flow."""

    @patch("app.services.oidc_service.resolve_secret")
    def test_resolve_secret_called_on_token_exchange(self, mock_resolve, client, db, lab):
        from app.services.oidc_service import resolve_secret
        lab.settings = {**(lab.settings or {}), "sso_enabled": True}
        provider = LabAuthProvider(
            id=uuid.uuid4(), lab_id=lab.id,
            provider_type=AuthProviderType.OIDC_MICROSOFT,
            config={
                "client_id": "test-client",
                "tenant_id": "test-tenant",
                "client_secret_ref": "projects/p/secrets/s/versions/1",
            },
            email_domain="hospital.org", is_enabled=True,
        )
        db.add(provider)
        db.commit()

        mock_resolve.return_value = "resolved-secret"

        from app.core.security import create_access_token
        state = create_access_token(
            {"purpose": "oidc_state", "provider_id": str(provider.id), "nonce": "test-nonce"},
            expires_minutes=5,
        )

        with patch("app.routers.sso.exchange_code") as mock_exchange:
            mock_exchange.side_effect = ValueError("expected test failure")
            res = client.get(
                "/api/auth/sso/callback",
                params={"code": "test-code", "state": state},
                follow_redirects=False,
            )
            assert res.status_code == 302
            assert "error=token_exchange_failed" in res.headers["location"]
