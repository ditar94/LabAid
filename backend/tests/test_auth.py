"""Integration tests for authentication endpoints."""

import pytest


class TestLogin:
    def test_login_success(self, client, admin_user):
        res = client.post("/api/auth/login", json={
            "email": "admin@test.com",
            "password": "password123",
        })
        assert res.status_code == 200
        data = res.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_login_wrong_password(self, client, admin_user):
        res = client.post("/api/auth/login", json={
            "email": "admin@test.com",
            "password": "wrong",
        })
        assert res.status_code == 401
        assert res.json()["detail"] == "Invalid credentials"

    def test_login_nonexistent_user(self, client):
        res = client.post("/api/auth/login", json={
            "email": "nobody@test.com",
            "password": "password123",
        })
        assert res.status_code == 401

    def test_login_case_insensitive_email(self, client, admin_user):
        res = client.post("/api/auth/login", json={
            "email": "ADMIN@TEST.COM",
            "password": "password123",
        })
        assert res.status_code == 200


class TestMe:
    def test_get_me(self, client, auth_headers, admin_user):
        res = client.get("/api/auth/me", headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert data["email"] == "admin@test.com"
        assert data["role"] == "lab_admin"

    def test_get_me_unauthenticated(self, client):
        res = client.get("/api/auth/me")
        assert res.status_code == 401


class TestChangePassword:
    def test_change_password(self, client, auth_headers):
        res = client.post("/api/auth/change-password", json={
            "new_password": "newpass123",
        }, headers=auth_headers)
        assert res.status_code == 200

        # Verify new password works
        res = client.post("/api/auth/login", json={
            "email": "admin@test.com",
            "password": "newpass123",
        })
        assert res.status_code == 200

    def test_change_password_too_short(self, client, auth_headers):
        res = client.post("/api/auth/change-password", json={
            "new_password": "ab",
        }, headers=auth_headers)
        assert res.status_code == 400


class TestSetup:
    def test_initial_setup(self, client, db):
        res = client.post("/api/auth/setup", json={
            "email": "first@admin.com",
            "password": "adminpass",
            "full_name": "First Admin",
        })
        assert res.status_code == 200
        data = res.json()
        assert data["role"] == "super_admin"

    def test_setup_blocked_after_first(self, client, super_admin):
        res = client.post("/api/auth/setup", json={
            "email": "second@admin.com",
            "password": "adminpass",
            "full_name": "Second Admin",
        })
        assert res.status_code == 400
        assert "already completed" in res.json()["detail"]


class TestUserManagement:
    def test_create_user(self, client, auth_headers, lab):
        res = client.post("/api/auth/users", json={
            "email": "tech@test.com",
            "full_name": "Test Tech",
            "role": "tech",
        }, headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert data["email"] == "tech@test.com"
        assert data["role"] == "tech"
        assert data["invite_sent"] is True
        assert "temp_password" not in data

    def test_create_user_duplicate_email(self, client, auth_headers, admin_user):
        res = client.post("/api/auth/users", json={
            "email": "admin@test.com",
            "full_name": "Duplicate",
            "role": "tech",
        }, headers=auth_headers)
        assert res.status_code == 400
        assert "already registered" in res.json()["detail"]

    def test_cannot_create_higher_role(self, client, auth_headers):
        res = client.post("/api/auth/users", json={
            "email": "rogue@test.com",
            "full_name": "Rogue Admin",
            "role": "super_admin",
        }, headers=auth_headers)
        assert res.status_code == 403


class TestAcceptInvite:
    def test_accept_invite_success(self, client, invited_user):
        res = client.post("/api/auth/accept-invite", json={
            "token": "valid-test-token-abc123",
            "password": "mynewpass123",
        })
        assert res.status_code == 200
        data = res.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_accept_invite_short_password(self, client, invited_user):
        res = client.post("/api/auth/accept-invite", json={
            "token": "valid-test-token-abc123",
            "password": "short",
        })
        assert res.status_code == 400
        assert "8 characters" in res.json()["detail"]

    def test_accept_invite_expired(self, client, expired_invite_user):
        res = client.post("/api/auth/accept-invite", json={
            "token": "expired-test-token-xyz",
            "password": "mynewpass123",
        })
        assert res.status_code == 400
        assert "expired" in res.json()["detail"].lower()

    def test_accept_invite_used_token(self, client, invited_user):
        # First use succeeds
        res = client.post("/api/auth/accept-invite", json={
            "token": "valid-test-token-abc123",
            "password": "mynewpass123",
        })
        assert res.status_code == 200

        # Second use fails (token cleared)
        res = client.post("/api/auth/accept-invite", json={
            "token": "valid-test-token-abc123",
            "password": "anotherpass123",
        })
        assert res.status_code == 400

    def test_accept_invite_invalid_token(self, client):
        res = client.post("/api/auth/accept-invite", json={
            "token": "nonexistent-token",
            "password": "mynewpass123",
        })
        assert res.status_code == 400


class TestHealthCheck:
    def test_health_endpoint(self, client):
        res = client.get("/api/health")
        assert res.status_code == 200
        data = res.json()
        assert "status" in data
        assert "checks" in data
