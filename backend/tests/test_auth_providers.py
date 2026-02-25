"""Tests for auth provider management and discovery endpoints."""

import uuid

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
        assert data["lab_name"] is None

    def test_no_providers_configured_returns_password(self, client, lab, admin_user):
        res = client.post("/api/auth/discover", json={"email": "admin@test.com"})
        assert res.status_code == 200
        assert res.json()["providers"] == ["password"]

    def test_configured_provider_returns_in_list(self, client, db, lab):
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
        assert data["lab_name"] == "Test Lab"

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

    def test_create_provider(self, client, super_token, lab):
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

    def test_create_provider_missing_config_rejected(self, client, super_token, lab):
        headers = {"Authorization": f"Bearer {super_token}"}
        res = client.post("/api/auth/providers/", json={
            "lab_id": str(lab.id),
            "provider_type": "oidc_microsoft",
            "config": {"client_id": "abc"},  # missing tenant_id
        }, headers=headers)
        assert res.status_code == 400
        assert "tenant_id" in res.json()["detail"]

    def test_update_provider(self, client, db, super_token, lab):
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

    def test_lab_admin_can_create_provider_own_lab(self, client, auth_headers, lab):
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
            "password": "newpassword123",
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
