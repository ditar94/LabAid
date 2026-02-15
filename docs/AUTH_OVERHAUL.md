# AUTH Overhaul — Pluggable Enterprise Authentication

> Upgrade authentication to support per-lab identity providers (internal password, Microsoft SSO, Google SSO, future SAML) while keeping all authorization, lab scoping, role enforcement, and billing state enforcement internal to LabAid. Authentication becomes pluggable per lab — authorization never leaves the app.

## Architectural Invariants (must hold across all phases)

- `lab_id` scoping on every query remains unchanged — SSO does not weaken tenant isolation
- Roles (`super_admin`, `lab_admin`, `supervisor`, `tech`, `read_only`) remain internal — SSO authenticates identity, LabAid assigns roles
- `LabSuspensionMiddleware` enforces billing state regardless of auth provider — no bypass via SSO
- Audit logging covers all login methods with the same granularity
- The current User model (`user.lab_id` FK, `user.role` enum) is unchanged — SSO users are regular User records
- Admin pre-creates users (current flow preserved) — SSO is an alternative *authentication* method, not an alternative *provisioning* method
- Labs can run password + SSO simultaneously (transition period), then optionally go SSO-only

## How It Works (end-to-end)

1. User enters email on login page -> backend checks email domain against `lab_auth_providers` -> returns available login methods
2. **Password login**: existing flow unchanged (email + password -> JWT cookie)
3. **SSO login**: frontend redirects to provider (Microsoft/Google) -> provider redirects back with auth code -> backend exchanges code for identity -> matches identity to existing User via `external_identities` table -> issues same JWT cookie with same claims (`sub`, `lab_id`, `role`)
4. From this point forward, the session is identical regardless of how the user authenticated — all middleware, role checks, and lab scoping work exactly the same

## Beta/Dev Considerations

- No special "switch" needed — provider config is per-lab, so beta labs use dev OAuth app credentials while prod labs use prod credentials
- `APP_URL` already differentiates environments -> callback URLs are correct per environment
- Microsoft and Google both allow `http://localhost` redirect URIs for dev/test OAuth apps
- Labs without any provider configured default to password-only (current behavior, zero migration risk)

---

## Phase 1 — Auth Provider Infrastructure

### Database / Schema

- [ ] Create `lab_auth_providers` table: `id` (UUID PK), `lab_id` (FK to labs), `provider_type` (enum: `password`, `oidc_microsoft`, `oidc_google`, `saml`), `config` (JSON — client_id, tenant_id, etc.), `email_domain` (String, nullable — for org discovery), `is_enabled` (Boolean), `created_at`
- [ ] Create `external_identities` table: `id` (UUID PK), `user_id` (FK to users), `provider_type` (String), `provider_subject` (String — the provider's unique user ID), `provider_email` (String), `created_at`. Unique constraint on `(provider_type, provider_subject)`.
- [ ] Alembic migration for both tables
- [ ] Every existing lab implicitly has password auth (no row needed — password is the default when no providers are configured)

### Backend

- [ ] Add `LabAuthProvider` and `ExternalIdentity` SQLAlchemy models
- [ ] Add Pydantic schemas: `AuthProviderCreate`, `AuthProviderOut`, `AuthProviderUpdate`
- [ ] Add `GET /api/auth/providers/{lab_id}` — super admin + lab admin can view configured providers
- [ ] Add `POST /api/auth/providers` — super admin can add a provider to a lab
- [ ] Add `PATCH /api/auth/providers/{id}` — super admin can update/disable a provider
- [ ] Add `POST /api/auth/discover` — public endpoint, accepts `{ email }`, returns `{ providers: ["password", "oidc_microsoft"], lab_name }` based on email domain match. Rate-limited.
- [ ] Provider config validation: reject incomplete configs (e.g. OIDC without client_id/tenant_id)
- [ ] Store OAuth `client_secret` as a GCP Secret Manager reference in config — never plaintext in DB. Add a `resolve_secret(ref)` helper.

### Frontend

- [ ] Add auth provider management UI to Labs page (super admin only) — list, add, edit, disable providers per lab
- [ ] Config forms per provider type: Microsoft OIDC (tenant_id, client_id, secret ref), Google OIDC (client_id, secret ref)

### Testing

- [ ] Migration test: verify existing labs work with zero providers (password default)
- [ ] Test `POST /api/auth/discover`: returns `["password"]` for labs without providers, returns correct providers for configured labs, returns 404 for unknown domains

---

## Phase 2 — OIDC Integration (Microsoft Entra ID + Google Workspace)

### Backend

- [ ] Add `httpx` (or `authlib`) dependency for OIDC token exchange
- [ ] Add `GET /api/auth/sso/{provider_type}/authorize` — generates OIDC authorization URL with state parameter (CSRF protection), redirect_uri based on `APP_URL`, and provider-specific scopes
- [ ] Add `POST /api/auth/sso/callback` — receives auth code + state -> exchanges code for tokens -> extracts identity claims -> looks up `external_identities` -> finds User -> issues JWT cookie -> redirects to frontend
- [ ] Identity matching logic: first check `external_identities` for exact match. If no external identity exists, fall back to email match + verify user belongs to a lab with this provider enabled. On first SSO login, auto-create the `external_identities` record.
- [ ] OIDC token validation: verify `id_token` signature against provider's JWKS endpoint, validate `iss`, `aud`, `exp` claims
- [ ] Microsoft-specific: support both single-tenant and multi-tenant Entra ID apps
- [ ] Google-specific: validate `hd` (hosted domain) claim
- [ ] Session creation: SSO login produces the exact same JWT cookie as password login — same claims, downstream code can't tell the difference
- [ ] Audit logging: `action="user.login_sso"` with `note="provider: oidc_microsoft"`
- [ ] Error handling: provider unreachable, email not found, user inactive

### Frontend

- [ ] Add `/auth/callback` route (public) — receives redirect from SSO provider, extracts code + state, calls backend callback, on success navigates to `/`
- [ ] Add `/auth/callback` to `publicPaths` in `client.ts`

### Testing

- [ ] Integration test: mock OIDC token exchange -> user matched -> JWT issued
- [ ] Integration test: SSO login for user in inactive lab -> rejected
- [ ] Integration test: SSO login for unknown email -> 400
- [ ] Integration test: SSO login auto-creates external_identity on first login
- [ ] Manual test (beta): configure a dev Microsoft Entra ID app -> full SSO login flow

---

## Phase 3 — Login Flow & Frontend Overhaul

### Frontend

- [ ] Refactor `LoginPage.tsx` to email-first discovery flow:
  1. Step 1: email input only -> calls `POST /api/auth/discover` on submit
  2. Step 2: if `providers` includes `password` -> show password field
  3. Step 2: if `providers` includes `oidc_microsoft` -> show "Sign in with Microsoft" button
  4. Step 2: if `providers` includes `oidc_google` -> show "Sign in with Google" button
  5. If multiple providers -> show all applicable options
  6. If only SSO -> hide password field entirely
- [ ] SSO button click: calls authorize endpoint -> redirects to provider
- [ ] Persist discovered email in state for callback page
- [ ] Handle SSO callback errors with clear messages
- [ ] Hide "Reset Password" button for users in SSO-only labs
- [ ] Hide password UI in user creation for SSO-only labs
- [ ] `ChangePasswordPage.tsx`: only accessible if lab allows password auth

### Backend

- [ ] Add `password_enabled` helper: checks if a lab has password auth enabled
- [ ] `POST /auth/login` — reject with 403 if lab is SSO-only
- [ ] `POST /auth/users/{id}/reset-password` — reject if lab is SSO-only
- [ ] `POST /auth/accept-invite` — reject if lab is SSO-only

### Testing

- [ ] Test: SSO-only lab -> password login rejected with 403
- [ ] Test: SSO-only lab -> password reset rejected
- [ ] Test: mixed lab (password + SSO) -> both methods work
- [ ] Test: lab with no providers -> password login works (backward compatible)

---

## Phase 4 — Hardening & Security Audit

- [ ] Verify tenant isolation: SSO user for Lab A cannot access Lab B data
- [ ] Verify OIDC state parameter prevents CSRF on callback
- [ ] Verify `id_token` signature validation prevents token forgery
- [ ] Verify rate limiting on `/auth/discover` and `/auth/sso/callback`
- [ ] Verify `external_identities` unique constraint prevents duplicate mappings
- [ ] Verify audit trail: all SSO logins logged, all provider config changes logged
- [ ] Verify suspension enforcement: SSO user in suspended lab gets read-only
- [ ] Verify impersonation works identically regardless of target lab's auth provider
- [ ] Security review: OAuth client secrets never logged, never in API responses, never in audit snapshots
- [ ] Full integration test suite: password-only lab, SSO-only lab, mixed lab, suspended SSO lab

---

## Phase 5 — SAML Support (Future)

> Only implement when a customer specifically requires SAML (e.g., hospital with legacy ADFS). The abstraction from Phase 1 means no schema changes are needed — just new backend handlers.

- [ ] Add `python3-saml` or `pysaml2` dependency
- [ ] Add SAML SP metadata generation endpoint
- [ ] Add SAML assertion consumer endpoint
- [ ] SAML config schema in `lab_auth_providers.config`
- [ ] Frontend: SAML uses the same "SSO" button as OIDC
- [ ] Admin UI: SAML provider config form
- [ ] Test: full SAML flow with a test IdP

---

## Documentation

- [ ] Update README's Auth & Multi-Tenancy section to describe pluggable auth
- [ ] Document auth invariants: what SSO can and cannot change
- [ ] Document provider setup guide for lab admins
- [ ] Document the email-first login flow for end users
