from datetime import datetime

# Simple TTL cache for lab suspension status
# Tuple: (is_active, billing_status, trial_ends_at, cache_time)
suspension_cache: dict[str, tuple[bool, str | None, datetime | None, float]] = {}
SUSPENSION_TTL = 60  # seconds

# Stripe verification cache — only populated when middleware is about to block a lab
# Tuple: (should_block: bool, cache_time: float)
stripe_verify_cache: dict[str, tuple[bool, float]] = {}
