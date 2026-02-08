"""Shared fixtures for integration tests.

Uses an in-memory SQLite database for speed. Tests that rely on
PostgreSQL-specific features (JSON operators, etc.) should be run
against the real database via Docker instead.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import hash_password, create_access_token
from app.main import app
from app.models.models import Lab, User, UserRole


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
    with TestClient(app) as c:
        yield c
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
