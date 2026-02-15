"""Integration tests for authentication endpoints."""

import uuid

import pytest

from app.core.security import hash_password
from app.models.models import User, UserRole


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


class TestInviteEndToEnd:
    """Full end-to-end invite flow: create user → accept invite → login."""

    def test_create_user_accept_invite_login(self, client, auth_headers, lab, db):
        # 1. Admin creates a new user
        res = client.post("/api/auth/users", json={
            "email": "newtech@test.com",
            "full_name": "New Tech",
            "role": "tech",
        }, headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert data["invite_sent"] is True
        assert data["set_password_link"] is not None  # console backend returns the link
        user_id = data["id"]

        # 2. Verify invite token was stored in DB
        from app.models.models import User
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        assert user.invite_token is not None
        assert user.invite_token_expires_at is not None
        assert user.must_change_password is True
        token = user.invite_token

        # 3. Accept the invite (set password)
        res = client.post("/api/auth/accept-invite", json={
            "token": token,
            "password": "mysecurepass123",
        })
        assert res.status_code == 200
        assert "access_token" in res.json()

        # 4. Verify token is cleared and must_change_password is False
        db.expire_all()
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        assert user.invite_token is None
        assert user.invite_token_expires_at is None
        assert user.must_change_password is False

        # 5. Verify user can login with the new password
        res = client.post("/api/auth/login", json={
            "email": "newtech@test.com",
            "password": "mysecurepass123",
        })
        assert res.status_code == 200
        assert "access_token" in res.json()


class TestResetPasswordFlow:
    """Reset password flow: old token invalidated, new token works."""

    def test_reset_password_invalidates_old_token(self, client, auth_headers, invited_user, db):
        # 1. Accept the original invite to establish a password
        res = client.post("/api/auth/accept-invite", json={
            "token": "valid-test-token-abc123",
            "password": "originalpass123",
        })
        assert res.status_code == 200

        # 2. Verify login works with original password
        res = client.post("/api/auth/login", json={
            "email": "invited@test.com",
            "password": "originalpass123",
        })
        assert res.status_code == 200

        # 3. Admin resets the user's password
        res = client.post(
            f"/api/auth/users/{invited_user.id}/reset-password",
            headers=auth_headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["email_sent"] is True
        assert data["set_password_link"] is not None  # console backend

        # 4. Old password no longer works (random password was set)
        res = client.post("/api/auth/login", json={
            "email": "invited@test.com",
            "password": "originalpass123",
        })
        assert res.status_code == 401

        # 5. Verify new token exists in DB
        from app.models.models import User
        db.expire_all()
        user = db.query(User).filter(User.id == invited_user.id).first()
        assert user.invite_token is not None
        assert user.invite_token != "valid-test-token-abc123"  # new token
        assert user.must_change_password is True
        new_token = user.invite_token

        # 6. Accept invite with new token
        res = client.post("/api/auth/accept-invite", json={
            "token": new_token,
            "password": "newpassword123",
        })
        assert res.status_code == 200

        # 7. Login works with new password
        res = client.post("/api/auth/login", json={
            "email": "invited@test.com",
            "password": "newpassword123",
        })
        assert res.status_code == 200


class TestEmailBackend:
    """Console email backend returns success and link."""

    def test_send_invite_email_console(self):
        from app.services.email import send_invite_email
        success, link = send_invite_email("user@test.com", "Test User", "test-token-123")
        assert success is True
        assert "set-password" in link
        assert "test-token-123" in link

    def test_send_reset_email_console(self):
        from app.services.email import send_reset_email
        success, link = send_reset_email("user@test.com", "Test User", "reset-token-456")
        assert success is True
        assert "set-password" in link
        assert "reset-token-456" in link


class TestUpdateUser:
    """Admin can change email and toggle active status."""

    def test_change_email(self, client, auth_headers, lab, db):
        # Create a tech user to modify
        res = client.post("/api/auth/users", json={
            "email": "tech@test.com",
            "full_name": "Tech User",
            "role": "tech",
        }, headers=auth_headers)
        assert res.status_code == 200
        user_id = res.json()["id"]

        # Change email
        res = client.patch(f"/api/auth/users/{user_id}", json={
            "email": "newemail@test.com",
        }, headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["email"] == "newemail@test.com"

    def test_change_email_duplicate(self, client, auth_headers, admin_user, lab, db):
        # Create a second user
        res = client.post("/api/auth/users", json={
            "email": "tech@test.com",
            "full_name": "Tech User",
            "role": "tech",
        }, headers=auth_headers)
        assert res.status_code == 200
        user_id = res.json()["id"]

        # Try changing to admin's email
        res = client.patch(f"/api/auth/users/{user_id}", json={
            "email": "admin@test.com",
        }, headers=auth_headers)
        assert res.status_code == 400
        assert "already registered" in res.json()["detail"]

    def test_deactivate_user(self, client, auth_headers, lab, db):
        res = client.post("/api/auth/users", json={
            "email": "tech@test.com",
            "full_name": "Tech User",
            "role": "tech",
        }, headers=auth_headers)
        user_id = res.json()["id"]

        # Deactivate
        res = client.patch(f"/api/auth/users/{user_id}", json={
            "is_active": False,
        }, headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["is_active"] is False

    def test_deactivated_user_cannot_login(self, client, auth_headers, lab, db):
        res = client.post("/api/auth/users", json={
            "email": "deactivate@test.com",
            "full_name": "Deactivate Me",
            "role": "tech",
        }, headers=auth_headers)
        user_id = res.json()["id"]

        # Get invite token and set password
        from app.models.models import User
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        token = user.invite_token

        res = client.post("/api/auth/accept-invite", json={
            "token": token,
            "password": "testpass123",
        })
        assert res.status_code == 200

        # Verify login works
        res = client.post("/api/auth/login", json={
            "email": "deactivate@test.com",
            "password": "testpass123",
        })
        assert res.status_code == 200

        # Deactivate
        res = client.patch(f"/api/auth/users/{user_id}", json={
            "is_active": False,
        }, headers=auth_headers)
        assert res.status_code == 200

        # Login should fail
        res = client.post("/api/auth/login", json={
            "email": "deactivate@test.com",
            "password": "testpass123",
        })
        assert res.status_code == 401

    def test_reactivate_user(self, client, auth_headers, lab, db):
        res = client.post("/api/auth/users", json={
            "email": "tech@test.com",
            "full_name": "Tech User",
            "role": "tech",
        }, headers=auth_headers)
        user_id = res.json()["id"]

        # Deactivate then reactivate
        client.patch(f"/api/auth/users/{user_id}", json={"is_active": False}, headers=auth_headers)
        res = client.patch(f"/api/auth/users/{user_id}", json={"is_active": True}, headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["is_active"] is True

    def test_cannot_modify_self(self, client, auth_headers, admin_user):
        res = client.patch(f"/api/auth/users/{admin_user.id}", json={
            "is_active": False,
        }, headers=auth_headers)
        assert res.status_code == 403

    def test_cannot_modify_higher_role(self, client, db, lab):
        # Create a supervisor
        from app.core.security import create_access_token
        supervisor = User(
            id=uuid.uuid4(),
            lab_id=lab.id,
            email="supervisor@test.com",
            hashed_password=hash_password("password123"),
            full_name="Supervisor",
            role=UserRole.SUPERVISOR,
            is_active=True,
            must_change_password=False,
        )
        db.add(supervisor)

        admin = User(
            id=uuid.uuid4(),
            lab_id=lab.id,
            email="admin2@test.com",
            hashed_password=hash_password("password123"),
            full_name="Admin",
            role=UserRole.LAB_ADMIN,
            is_active=True,
            must_change_password=False,
        )
        db.add(admin)
        db.commit()

        # Supervisor tries to modify admin
        sup_token = create_access_token({
            "sub": str(supervisor.id),
            "lab_id": str(lab.id),
            "role": supervisor.role.value,
        })
        res = client.patch(f"/api/auth/users/{admin.id}", json={
            "is_active": False,
        }, headers={"Authorization": f"Bearer {sup_token}"})
        assert res.status_code in (403, 401)  # 401 if supervisor not in require_role


class TestForgotPassword:
    def test_forgot_password_sends_token(self, client, admin_user, db):
        res = client.post("/api/auth/forgot-password", json={
            "email": "admin@test.com",
        })
        assert res.status_code == 200
        assert "password reset link" in res.json()["message"]

        # Verify token was set in DB
        db.expire_all()
        user = db.query(User).filter(User.id == admin_user.id).first()
        assert user.invite_token is not None
        assert user.invite_token_expires_at is not None

    def test_forgot_password_unknown_email(self, client, db):
        res = client.post("/api/auth/forgot-password", json={
            "email": "nobody@test.com",
        })
        assert res.status_code == 200
        assert "password reset link" in res.json()["message"]

    def test_forgot_password_deactivated_user(self, client, db, lab):
        # Create a deactivated user
        user = User(
            id=uuid.uuid4(),
            lab_id=lab.id,
            email="deactivated@test.com",
            hashed_password=hash_password("password123"),
            full_name="Deactivated User",
            role=UserRole.TECH,
            is_active=False,
            must_change_password=False,
        )
        db.add(user)
        db.commit()

        res = client.post("/api/auth/forgot-password", json={
            "email": "deactivated@test.com",
        })
        assert res.status_code == 200
        assert "password reset link" in res.json()["message"]

        # No token should be set
        db.expire_all()
        user = db.query(User).filter(User.email == "deactivated@test.com").first()
        assert user.invite_token is None

    def test_forgot_password_token_works(self, client, admin_user, db):
        # 1. Request reset
        res = client.post("/api/auth/forgot-password", json={
            "email": "admin@test.com",
        })
        assert res.status_code == 200

        # 2. Get the token from DB
        db.expire_all()
        user = db.query(User).filter(User.id == admin_user.id).first()
        token = user.invite_token
        assert token is not None

        # 3. Use token via accept-invite
        res = client.post("/api/auth/accept-invite", json={
            "token": token,
            "password": "newpass123456",
        })
        assert res.status_code == 200
        assert "access_token" in res.json()

        # 4. Login with new password
        res = client.post("/api/auth/login", json={
            "email": "admin@test.com",
            "password": "newpass123456",
        })
        assert res.status_code == 200


class TestHealthCheck:
    def test_health_endpoint(self, client):
        res = client.get("/api/health")
        assert res.status_code == 200
        data = res.json()
        assert "status" in data
        assert "checks" in data
