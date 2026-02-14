"""Shared fixtures for integration tests.

Uses an in-memory SQLite database for speed. Tests that rely on
PostgreSQL-specific features (JSON operators, etc.) should be run
against the real database via Docker instead.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import String, create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import hash_password, create_access_token
from app.main import app
from app.models.models import Lab, User, UserRole


# ── SQLite UUID compatibility ─────────────────────────────────────────────

# Register PostgreSQL UUID type as String(36) for SQLite so tests can run
# without a real PostgreSQL database.
from sqlalchemy.dialects.sqlite.base import SQLiteTypeCompiler

if not hasattr(SQLiteTypeCompiler, "visit_UUID"):
    SQLiteTypeCompiler.visit_UUID = lambda self, type_, **kw: "VARCHAR(36)"


# ── SQLite test database ────────────────────────────────────────────────────

@pytest.fixture()
def db():
    """Create a fresh in-memory SQLite database for each test."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # SQLite needs foreign key enforcement turned on explicitly
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client(db):
    """FastAPI test client with the DB session overridden."""
    def _override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db

    # Patch SessionLocal so middleware (e.g. LabSuspensionMiddleware) also
    # uses the test SQLite session instead of the real PostgreSQL engine.
    import app.core.database as db_module
    import app.main as main_module
    original_session_local = db_module.SessionLocal
    db_module.SessionLocal = lambda: db
    main_module.SessionLocal = lambda: db

    # Reset rate limiter state so tests don't interfere with each other
    from app.routers.auth import limiter
    limiter.reset()

    with TestClient(app) as c:
        yield c

    db_module.SessionLocal = original_session_local
    main_module.SessionLocal = original_session_local
    app.dependency_overrides.clear()


# ── Seed data ────────────────────────────────────────────────────────────────

@pytest.fixture()
def lab(db):
    """Create a test lab."""
    lab = Lab(id=uuid.uuid4(), name="Test Lab", is_active=True, settings={})
    db.add(lab)
    db.commit()
    db.refresh(lab)
    return lab


@pytest.fixture()
def admin_user(db, lab):
    """Create a lab admin user with known credentials."""
    user = User(
        id=uuid.uuid4(),
        lab_id=lab.id,
        email="admin@test.com",
        hashed_password=hash_password("password123"),
        full_name="Test Admin",
        role=UserRole.LAB_ADMIN,
        is_active=True,
        must_change_password=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def admin_token(admin_user):
    """JWT token for the admin user."""
    return create_access_token({
        "sub": str(admin_user.id),
        "lab_id": str(admin_user.lab_id),
        "role": admin_user.role.value,
    })


@pytest.fixture()
def auth_headers(admin_token):
    """Authorization headers for authenticated requests."""
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture()
def super_admin(db):
    """Create a super admin user (no lab)."""
    user = User(
        id=uuid.uuid4(),
        lab_id=None,
        email="super@test.com",
        hashed_password=hash_password("superpass"),
        full_name="Super Admin",
        role=UserRole.SUPER_ADMIN,
        is_active=True,
        must_change_password=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def super_token(super_admin):
    """JWT token for the super admin."""
    return create_access_token({
        "sub": str(super_admin.id),
        "lab_id": None,
        "role": super_admin.role.value,
    })


@pytest.fixture()
def invited_user(db, lab):
    """Create a user with a valid invite token."""
    user = User(
        id=uuid.uuid4(),
        lab_id=lab.id,
        email="invited@test.com",
        hashed_password=hash_password("placeholder"),
        full_name="Invited User",
        role=UserRole.TECH,
        is_active=True,
        must_change_password=True,
        invite_token="valid-test-token-abc123",
        invite_token_expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def expired_invite_user(db, lab):
    """Create a user with an expired invite token."""
    user = User(
        id=uuid.uuid4(),
        lab_id=lab.id,
        email="expired@test.com",
        hashed_password=hash_password("placeholder"),
        full_name="Expired Invite",
        role=UserRole.TECH,
        is_active=True,
        must_change_password=True,
        invite_token="expired-test-token-xyz",
        invite_token_expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
