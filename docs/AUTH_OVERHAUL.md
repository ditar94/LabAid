# AUTH Overhaul — Pluggable Enterprise Authentication

> Upgrade authentication to support per-lab identity providers (internal password, Microsoft SSO, Google SSO, future SAML) while keeping all authorization, lab scoping, role enforcement, and billing state enforcement internal to LabAid. Authentication becomes pluggable per lab — authorization never leaves the app.

## Architectural Invariants (must hold across all phases)

- `lab_id` scoping on every query remains unchanged — SSO does not weaken tenant isolation
- Roles (`super_admin`, `lab_admin`, `supervisor`, `tech`, `read_only`) remain internal — SSO authenticates identity, LabAid assigns roles
- `LabSuspensionMiddleware` enforces billing state regardless of auth provider — no bypass via SSO
- Audit logging covers all login methods with the same granularity
- The current User model (`user.lab_id` FK, `user.role` enum) is unchanged — SSO users are regular User records
- Admin pre-creates users (current flow preserved) — SSO is an alternative *authentication* method, not an alternative *provisioning* method. JIT provisioning (auto-create user on first SSO login with a default role) is a future consideration, not V1.
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

- [x] Create `lab_auth_providers` table: `id` (UUID PK), `lab_id` (FK to labs), `provider_type` (enum: `password`, `oidc_microsoft`, `oidc_google`, `saml`), `config` (JSON — client_id, tenant_id, etc.), `email_domain` (String, nullable — for org discovery), `is_enabled` (Boolean), `created_at`
- [x] Create `external_identities` table: `id` (UUID PK), `user_id` (FK to users), `provider_type` (String), `provider_subject` (String — the provider's unique user ID), `provider_email` (String), `created_at`. Unique constraint on `(provider_type, provider_subject)`.
- [x] Alembic migration for both tables
- [x] Every existing lab implicitly has password auth (no row needed — password is the default when no providers are configured)

### Backend

- [x] Add `LabAuthProvider` and `ExternalIdentity` SQLAlchemy models
- [x] Add Pydantic schemas: `AuthProviderCreate`, `AuthProviderOut`, `AuthProviderUpdate`
- [x] Add `GET /api/auth/providers/{lab_id}` — super admin + lab admin can view configured providers
- [x] Add `POST /api/auth/providers` — super admin can add a provider to a lab
- [x] Add `PATCH /api/auth/providers/{id}` — super admin can update/disable a provider
- [x] Add `POST /api/auth/discover` — public endpoint, accepts `{ email }`, returns `{ providers: ["password", "oidc_microsoft"], lab_name }` based on email domain match. Rate-limited.
- [x] Provider config validation: reject incomplete configs (e.g. OIDC without client_id/tenant_id)
- [x] Store OAuth `client_secret` as a GCP Secret Manager reference in config — never plaintext in DB. `resolve_secret()` reads from Secret Manager; `store_secret()` writes raw secrets and returns the ref. Create/update endpoints auto-store raw secrets.

### Frontend

- [x] Add auth provider management UI to Labs page (super admin only) — list, add, edit, disable providers per lab
- [x] Config forms per provider type: Microsoft OIDC (tenant_id, client_id, secret ref), Google OIDC (client_id, secret ref)
- [x] Self-service: `POST` and `PATCH` endpoints now accept `lab_admin` (scoped to own lab). Frontend form accepts raw `client_secret` (password field) instead of GCP Secret Manager path. SSO Settings section added to SettingsPage for lab admins.

### Testing

- [x] Migration test: verify existing labs work with zero providers (password default)
- [x] Test `POST /api/auth/discover`: returns `["password"]` for labs without providers, returns correct providers for configured labs, returns `["password"]` for unknown domains

---

## Phase 2 — OIDC Integration (Microsoft Entra ID + Google Workspace)

### Backend

- [x] Add `httpx` (or `authlib`) dependency for OIDC token exchange
- [x] Add `GET /api/auth/sso/{provider_type}/authorize` — generates OIDC authorization URL with state parameter (CSRF protection), redirect_uri based on `APP_URL`, provider-specific scopes, and `prompt=select_account` (forces account picker — critical for shared lab workstations where multiple techs use the same browser)
- [x] Add `GET /api/auth/sso/callback` — receives auth code + state -> exchanges code for tokens -> extracts identity claims -> looks up `external_identities` -> finds User -> issues JWT cookie -> redirects to frontend
- [x] Identity matching logic: first check `external_identities` for exact match. If no external identity exists, fall back to email match + verify user belongs to a lab with this provider enabled. On first SSO login, auto-create the `external_identities` record.
- [x] OIDC token validation: verify `id_token` signature against provider's JWKS endpoint, validate `iss`, `aud`, `exp` claims
- [x] Microsoft-specific: support both single-tenant and multi-tenant Entra ID apps
- [x] Google-specific: validate `hd` (hosted domain) claim
- [x] Session creation: SSO login produces the exact same JWT cookie as password login — same claims, downstream code can't tell the difference
- [x] Audit logging: `action="user.login_sso"` with `note="provider: oidc_microsoft"`
- [x] Error handling: provider unreachable, email not found, user inactive

### Frontend

- [x] Add `/auth/callback` route (public) — receives redirect from SSO provider, extracts code + state, calls backend callback, on success navigates to `/`
- [x] Add `/auth/callback` to `publicPaths` in `client.ts`

### Testing

- [x] Integration test: mock OIDC token exchange -> user matched -> JWT issued
- [x] Integration test: SSO login for user in inactive lab -> rejected
- [x] Integration test: SSO login for unknown email -> 400
- [x] Integration test: SSO login auto-creates external_identity on first login
- [ ] Manual test (beta): configure a dev Microsoft Entra ID app -> full SSO login flow

---

## Phase 3 — Login Flow & Frontend Overhaul

### Frontend

- [x] Refactor `LoginPage.tsx` to email-first discovery flow:
  1. Step 1: email input only -> calls `POST /api/auth/discover` on submit
  2. Step 2: if `providers` includes `password` -> show password field
  3. Step 2: if `providers` includes `oidc_microsoft` -> show "Sign in with Microsoft" button
  4. Step 2: if `providers` includes `oidc_google` -> show "Sign in with Google" button
  5. If multiple providers -> show all applicable options
  6. If only SSO -> hide password field entirely
- [x] SSO button click: calls authorize endpoint -> redirects to provider
- [x] Persist discovered email in sessionStorage for callback page
- [x] Handle SSO callback errors with clear messages
- [x] Hide "Reset Password" button for users in SSO-only labs
- [x] Hide password UI in user creation for SSO-only labs (skip invite for SSO-only)
- [x] `ChangePasswordPage.tsx`: only accessible if lab allows password auth
- [x] `ForgotPasswordPage.tsx`: checks discover before sending reset email, shows SSO message for SSO-only labs

### Backend

- [x] Add `password_enabled` helper: checks if a lab has password auth enabled. SSO-only = explicit PASSWORD row with `is_enabled=False`
- [x] `POST /auth/login` — reject with 403 if lab is SSO-only
- [x] `POST /auth/users/{id}/reset-password` — reject if lab is SSO-only
- [x] `POST /auth/accept-invite` — reject if lab is SSO-only
- [x] `password_enabled` exposed in bootstrap response for frontend gating
- [x] User creation: SSO-only labs skip invite token/email, set `must_change_password=False`

### Testing

- [x] Test: SSO-only lab -> password login rejected with 403
- [x] Test: SSO-only lab -> password reset rejected
- [x] Test: SSO-only lab -> accept-invite rejected
- [x] Test: mixed lab (password + SSO) -> both methods work
- [x] Test: lab with no providers -> password login works (backward compatible)
- [x] Test: discover for SSO-only lab -> password not in response

---

## Phase 4 — Hardening & Security Audit

- [x] Add `is_active` check to `SlidingWindowMiddleware` token refresh — if user has been deactivated, don't reissue token; let current JWT expire naturally
- [x] Validate that password auth cannot be disabled for a lab if it would lock out all lab_admin users — `_check_password_disable_safe()` enforces: must have enabled SSO provider AND at least one lab_admin with external_identity
- [x] Verify tenant isolation: SSO user for Lab A cannot access Lab B data — test_tenant_isolation_sso_providers
- [x] Verify OIDC state parameter prevents CSRF on callback — test_authorize_state_contains_provider_id, test_callback_invalid_state, test_callback_expired_state
- [x] Verify `id_token` signature validation prevents token forgery — validate_id_token in oidc_service.py verifies against JWKS endpoint
- [x] Verify rate limiting on `/auth/discover` (10/min) and `/auth/sso/callback` (10/min)
- [x] Verify `external_identities` unique constraint `(provider_type, provider_subject)` prevents duplicate mappings
- [x] Verify audit trail: `user.login_sso` for SSO logins, `auth_provider.created`/`auth_provider.updated` for config changes
- [x] Verify suspension enforcement: LabSuspensionMiddleware checks lab_id from JWT — works identically for all auth methods
- [x] Verify impersonation works identically regardless of target lab's auth provider — no provider-specific logic in impersonate endpoint
- [x] Security review: OAuth client secrets sanitized to `••••••••` in all API responses — test_secrets_never_in_response
- [x] Full integration test suite: password-only, SSO-only, mixed lab, lockout prevention, tenant isolation, bootstrap password_enabled flag

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

- [x] Update README's Auth & Multi-Tenancy section to describe pluggable auth
- [x] Document auth invariants: what SSO can and cannot change
- [x] Document provider setup guide for lab admins
- [x] Document the email-first login flow for end users

---

## Auth Invariants — What SSO Can and Cannot Change

SSO is an alternative **authentication** method. It proves "this person is who they claim to be." Everything else stays internal to LabAid.

### SSO does NOT change:

- **Roles** — `super_admin`, `lab_admin`, `supervisor`, `tech`, `read_only` are assigned in LabAid. The identity provider has no influence over roles.
- **Lab scoping** — Every query is scoped by `lab_id` from the JWT. SSO users get the same JWT as password users. Tenant isolation is identical.
- **User provisioning** — Admins must pre-create users in LabAid before they can log in via SSO. There is no JIT (just-in-time) provisioning. A valid Microsoft/Google identity alone does not grant access.
- **Billing enforcement** — `LabSuspensionMiddleware` reads `lab_id` from the JWT and blocks writes for suspended labs. Auth method is irrelevant.
- **Audit logging** — SSO logins are logged as `user.login_sso` with the provider type in the note. Same granularity as password logins.
- **Impersonation** — Super admin impersonation works identically regardless of the target lab's auth provider.
- **Session lifetime** — Same JWT expiry and sliding window refresh for all auth methods. Demo sessions still have fixed expiry.

### SSO does change:

- **How identity is verified** — Instead of checking a bcrypt hash, the backend exchanges an OAuth authorization code for an `id_token` and validates the signature against the provider's JWKS endpoint.
- **Login UI** — The login page shows SSO buttons (e.g., "Sign in with Microsoft") in addition to or instead of the password field, depending on the lab's configuration.
- **Password requirements** — SSO-only labs skip invite tokens, password resets, and `must_change_password`. Users created in SSO-only labs get a random unusable password.
- **Account recovery** — For SSO-only labs, password reset is disabled. Account recovery goes through the identity provider (e.g., Microsoft self-service password reset).

---

## Provider Setup Guide for Lab Admins

Lab admins can configure SSO from **Settings > Single Sign-On (SSO)**.

### Microsoft Entra ID (Azure AD)

1. Go to [Azure Portal > App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and create a new registration:
   - **Name**: `LabAid SSO`
   - **Supported account types**: "Accounts in this organizational directory only" (single tenant)
   - **Redirect URI**: Web — `https://labaid.io/api/auth/sso/callback` (or `https://beta.labaid.io/api/auth/sso/callback` for testing)
2. From the app's **Overview** page, copy:
   - **Application (client) ID** → paste into LabAid's "Client ID" field
   - **Directory (tenant) ID** → paste into LabAid's "Tenant ID" field
3. Go to **Certificates & secrets > New client secret**:
   - Set a description and expiry (recommended: 24 months)
   - Copy the **Value** immediately (it won't be shown again) → paste into LabAid's "Client Secret" field
4. Go to **API permissions** and ensure these are granted:
   - `openid` (sign users in)
   - `email` (read user email)
   - `profile` (read user name)
5. In LabAid Settings, enter the **Email domain** (e.g., `hospital.org`) — this tells LabAid which emails should see the Microsoft SSO option on the login page.
6. Click **Save**. The provider is now active.

### Google Workspace

1. Go to [Google Cloud Console > APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials) and create an OAuth 2.0 Client ID:
   - **Application type**: Web application
   - **Authorized redirect URIs**: `https://labaid.io/api/auth/sso/callback`
2. Copy the **Client ID** and **Client Secret** into LabAid's SSO settings.
3. Enter the **Email domain** (e.g., `hospital.org`).
4. Click **Save**.

### Going SSO-Only

Once SSO is configured and working:

1. Ensure at least one lab admin has successfully logged in via SSO (this is enforced — LabAid will reject the request otherwise).
2. In the auth provider management UI, add a `password` provider with **Enabled = No** (or disable the existing password provider).
3. From this point: password login, password reset, and invite acceptance are all blocked for this lab. New users are created without invite tokens.

**To revert**: Re-enable the password provider. All password-related features immediately become available again.

### Transition Period

Labs can run password + SSO simultaneously for as long as needed. Users can log in with either method. This is the recommended approach during rollout — let users try SSO, then go SSO-only once everyone has confirmed it works.

---

## Email-First Login Flow

The login page uses a two-step flow to support labs with different authentication configurations.

### Step 1 — Email Discovery

The user enters their email address and clicks "Continue." The frontend calls `POST /api/auth/discover` with the email. The backend:

1. Extracts the email domain (e.g., `hospital.org` from `user@hospital.org`)
2. Looks up `lab_auth_providers` rows where `email_domain` matches and `is_enabled = true`
3. Returns the list of available providers (e.g., `["password", "oidc_microsoft"]`) and the lab name

If no providers are found for the domain, `["password"]` is returned (backward compatible — the existing login flow for labs without SSO configured).

### Step 2 — Authentication

Based on the discovered providers, the login page shows:

- **Password field** — if `"password"` is in the list. Standard email + password login.
- **"Sign in with Microsoft" button** — if `"oidc_microsoft"` is in the list. Clicking redirects to Microsoft's login page.
- **"Sign in with Google" button** — if `"oidc_google"` is in the list. Clicking redirects to Google's login page.
- **Divider** — if both password and SSO options are available, an "or" divider separates them.

For SSO-only labs (no `"password"` in the list), only SSO buttons are shown.

### SSO Redirect Flow

When a user clicks an SSO button:

1. Browser redirects to `/api/auth/sso/{provider_type}/authorize?email_domain={domain}`
2. Backend generates the OIDC authorization URL with `prompt=select_account` (forces account picker — important for shared lab workstations)
3. Browser redirects to the identity provider (Microsoft/Google)
4. User authenticates with their organization credentials
5. Provider redirects back to `/api/auth/sso/callback` with an authorization code
6. Backend exchanges the code for tokens, validates the `id_token` signature, extracts the user's email/subject
7. Backend matches the identity to an existing LabAid user (via `external_identities` table or email fallback)
8. Backend issues the same JWT cookie as a password login and redirects to the app

From this point, the session is identical to a password login — all middleware, role checks, and lab scoping work the same way.
