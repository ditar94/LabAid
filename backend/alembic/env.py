import logging
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool, text

from app.core.config import settings
from app.core.database import Base
from app.models import models  # noqa: F401 — ensure all models are imported

logger = logging.getLogger("alembic.env")

config = context.config
config.set_main_option(
    "sqlalchemy.url",
    settings.DATABASE_URL_MIGRATE or settings.DATABASE_URL,
)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

POST_MIGRATION_GRANTS = """
GRANT USAGE ON SCHEMA public TO labaid_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO labaid_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO labaid_app;
GRANT USAGE ON SCHEMA public TO labaid_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO labaid_readonly;
"""


def apply_grants(connection):
    """Grant permissions to app and readonly users after migrations."""
    for stmt in POST_MIGRATION_GRANTS.strip().split("\n"):
        stmt = stmt.strip()
        if stmt:
            try:
                connection.execute(text("SAVEPOINT grant_sp"))
                connection.execute(text(stmt))
                connection.execute(text("RELEASE SAVEPOINT grant_sp"))
            except Exception as e:
                logger.warning("Grant failed (user may not exist): %s", e)
                connection.execute(text("ROLLBACK TO SAVEPOINT grant_sp"))
    logger.info("Post-migration grants applied")


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
        apply_grants(connection)
        connection.commit()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
