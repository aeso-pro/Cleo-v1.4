# Cleo account and onboarding database

`migrations/202610170001_auth_onboarding.sql` connects the real Supabase Auth account to a Cleo business. It is a deliberately limited foundation for authentication and onboarding. It does not implement payments, subscriptions, staff invitations, terminal credentials, sales, product editing, stock, or fiscal records. Those operations must continue to report that their server integration is unavailable.

## Apply

1. Inspect the target project's existing schema and functions. This migration reserves only the five `public.cleo_*` tables and five functions listed below.
2. Apply the entire migration once as the database owner, through the Supabase CLI migrations or the dashboard SQL Editor. The file includes a transaction and a PostgREST schema-cache reload notification.
3. Inspect the tables, RLS policies, and function grants. Test authentication with a fresh account and a returning account through the configured application callback URL.

The first guard stops the transaction if any reserved table or function already exists. It does not replace an existing implementation. Reapplying this file manually is therefore intentionally rejected; use a new reviewed migration for future changes. Existing `public.profiles`, existing `handle_new_user` functions, Auth users, and Auth triggers are untouched. No trigger is added to `auth.users`.

## Tables

| Table | Purpose | Browser permission |
| --- | --- | --- |
| `cleo_profiles` | Display name keyed by the authenticated Auth UUID | Read own row after any enrolled MFA |
| `cleo_businesses` | Real business name and selected `fnb`, `retail`, `svc` modules | Read active membership's business |
| `cleo_branches` | Main branch created with the business | Read branches allowed by active membership |
| `cleo_memberships` | Authoritative user, business, branch, and role | Read own active membership |
| `cleo_legal_acceptances` | First server timestamp per user and bundled legal version | Read own acceptance |

All five tables enable RLS. Anonymous roles receive no table access. Authenticated browsers receive `SELECT` only; they cannot change names, create businesses directly, assign roles, restore revoked memberships, or forge legal timestamps. The database owner can administer these records. The current account contract permits one active business per account; supporting multiple business memberships needs a separate migration and a workspace selector.

## RPC contract

All functions pin `search_path = ''`, qualify application objects, and revoke public and anonymous execution. `authenticated` receives explicit execution permission. Their elevated access is limited to the caller identified by `auth.uid()`.

### `cleo_auth_context()`

Lazily creates the caller's display profile from their Auth metadata after checking that the Auth user has a confirmed email. Metadata may supply a display name; it never supplies tenant access or a role.

Returns:

```json
{
  "account": {
    "id": "authenticated-user-uuid",
    "name": "Owner name",
    "email": "owner@example.com",
    "role": "Owner",
    "businessId": "business-uuid",
    "needsBusiness": false,
    "needsMfa": false
  },
  "profile": { "id": "authenticated-user-uuid", "name": "Owner name", "email": "owner@example.com" },
  "business": { "id": "business-uuid", "name": "Business name", "modules": ["retail"] },
  "branch": { "id": "branch-uuid", "businessId": "business-uuid", "name": "Main branch", "code": "MAIN" },
  "role": "owner",
  "legal": { "version": "privacy 1.0, terms 1.0", "at": "server timestamp", "method": "email" },
  "needsMfa": false
}
```

Before onboarding, business, branch, role, and account.businessId are null and account.needsBusiness is true. Before the caller completes enrolled MFA, only their own basic account/profile is returned; business, branch, role, and legal are null, with `needsMfa: true`. This permits displaying the authenticator challenge without disclosing tenant data.

### `cleo_create_business(p_business jsonb, p_modules jsonb, p_owner jsonb)`

Accepted input example:

```json
{
  "p_business": { "name": "My store" },
  "p_modules": ["retail", "svc"],
  "p_owner": { "name": "Owner name" }
}
```

Requires a confirmed account and any enrolled MFA. Names must have 1–120 characters after trimming. Modules must contain 1–3 unique values from `fnb`, `retail`, and `svc`. Unknown business/owner keys are rejected. It creates the business, a `MAIN` branch, and the caller's `owner` membership in one transaction, then returns the complete context above. The browser cannot nominate another user, tenant, role, or branch.

The caller's profile row is locked while onboarding. A repeated submission returns the caller's existing business without creating duplicates or changing its identity. An account with a revoked membership must have its access restored by an administrator; onboarding cannot bypass a revocation.

### `cleo_accept_legal(p_version text, p_method text)`

The exact bundled version is **`privacy 1.0, terms 1.0`**, matching `Frontend/source/build.js` and the two Markdown legal documents. Accepted method labels are `email`, `google`, `facebook`, and `oauth`. The method is a client-reported label, not provider attestation. The function derives the user and timestamp on the server. Repeated acceptance of the same version preserves the first timestamp and method.

Returns `{ "ok": true, "version": "privacy 1.0, terms 1.0", "at": "server timestamp" }`.

When either document's version changes, release a new migration to update the version constraint and the two functions that compare it. Old acceptance records must remain as history. The frontend and server versions must be deployed together.

### `cleo_bootstrap()`

Requires active membership, the current legal acceptance, and any enrolled MFA. Returns `{ data, config, collections, plan: null, subscription: null }` using the frontend's bootstrap contract. Identity, selected modules, and allowed branches are real database records. Product, customer, staff PIN, terminal, sales, and financial collections are empty. The `users` collection contains only the authenticated caller with their database membership role; it contains no password, token, PIN, or MFA secret.

A branch initially reports one planned terminal slot, while the registered-terminal collection remains empty. This migration issues no terminal credential and activates no paid subscription or entitlement.

### `cleo_session_is_strong()`

Returns only a boolean for the current caller. If the caller has a verified factor in `auth.mfa_factors`, their JWT must have `aal2`. This is enforced in table read policies and in the business, legal, and bootstrap RPCs. It does not expose factor details. Accounts with no enrolled factor may continue at `aal1`; enforcing mandatory owner enrollment is an additional product/server requirement.

## Verification

Before live deployment, the migration was executed in PGlite 0.5.10, a local PostgreSQL WASM runtime. The test database supplied minimal `auth.users`, `auth.mfa_factors`, `auth.uid()`, `auth.jwt()`, `anon`, and `authenticated` fixtures. **19 checks passed**:

The runnable harness, pinned development dependency, and recorded result are in `supabase/tests/`. It uses an in-memory database and makes no connection to the hosted project. To rerun from the project root:

```sh
npm --prefix supabase/tests install --ignore-scripts
npm --prefix supabase/tests test
```

The run writes its check list and timestamp to `supabase/tests/results.json`. `node_modules` is not included in the deliverable.

`supabase/tests/live-rollback-verification.sql` is a separate, optional database-owner check for the target Supabase PostgreSQL instance after migration. It creates two synthetic confirmed `example.invalid` Auth users inside one transaction, performs nine named assertions against the actual functions and RLS, returns their results, and ends with `ROLLBACK`. It sends no email and leaves no persistent verification users or business rows. Run the whole file together; if a client stops on an assertion error, issue `ROLLBACK`. Its fixture shape and rollback cleanup were also exercised locally. It does not change any existing user or existing `public.profiles` row.

- SQL compilation and successful migration; collision rerun stops atomically; unrelated profiles remain unchanged.
- Anonymous calls/reads, missing authenticated UUID, and unconfirmed email accounts are rejected.
- Auth metadata cannot grant owner access; client-supplied user/role keys and invalid modules are rejected.
- Atomic business/branch/owner creation; repeated onboarding creates no duplicate business.
- Exact legal version required; repeat legal acceptance preserves the first server timestamp.
- Bootstrap contains real identity, an empty catalog, and no invented subscription.
- Two tenant accounts see only their own business; all direct browser table writes are denied.
- Enrolled-MFA `aal1` sessions cannot access tenant data; `aal2` restores permitted access.
- Revoked membership blocks bootstrap and cannot be bypassed by self-onboarding.
- Every exposed function pins its search path and denies anonymous execution.

These tests validate PostgreSQL behavior against the fixture Auth schema. They do not verify Google/Facebook provider configuration, redirect allowlists, email delivery, or a complete hosted sign-in round trip. Those need live verification in the target Supabase project.

Security patterns follow the official [Database Functions](https://supabase.com/docs/guides/database/functions) and [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) documentation.
