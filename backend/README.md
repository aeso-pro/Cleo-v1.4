# Backend changes and deployment

These changes are implemented and tested locally on `codex/backend-auth-operations`. They have **not** been applied to the hosted Supabase project. Frontend integration is tracked in [GitHub issue #1](https://github.com/aeso-pro/Cleo-v1.4/issues/1) and [the handoff](../Docs/BACKEND_FRONTEND_HANDOFF.md).

## Confirmed live findings

- The supplied production domain, `https://cleopos.online`, currently serves a Hostinger parked-domain document. Both `/index.html` and the expected SDK URL return that HTML. A successful HTTP status does not establish that Cleo is deployed.
- Supabase public Auth settings enable email, Facebook and Google; signup is allowed and email confirmation is required.
- Facebook authorization redirects to Facebook with email scope and the correct Supabase callback (`https://ntbkbvlsgymupjdpuvob.supabase.co/auth/v1/callback`). A complete user consent/signup round trip has not been performed.
- Anonymous profile reads and context calls return permission denied as intended. Do not grant anonymous access to resolve a signup UI issue.
- This cloud session has no access to the user's Chrome tabs. A management token is required to inspect private Supabase configuration or run migrations through the management API. Store `SUPABASE_ACCESS_TOKEN` securely in environment settings, never in source or chat.

## Migrations

Keep the already deployed `202610170001_auth_onboarding.sql` immutable. Its collision guard is intentional. On a fresh database, apply all migrations in order. On the documented existing project, inspect its actual schema/privileges first, then apply the new **002**, **003**, **004** migrations in order through the Supabase migration workflow or SQL Editor. Each file is transactional. Record any SQL Editor applications in the normal deployment history; a blind CLI `db push` must not try to reapply 001, which was originally applied manually. Do not run the test fixture schema against production.

| Migration | Change |
| --- | --- |
| 002 | Adds a separate `auth.users` trigger to create a Cleo profile for a confirmed, nonempty-email account, including Facebook. Backfills confirmed users, preserves chosen profile names, creates no business/membership/legal consent. Context names ignore whitespace-only metadata; legal acceptance now requires confirmed email. Existing unrelated Auth triggers and `public.profiles` remain intact. |
| 003 | Adds role-checked record batches, settings, stock ledger/balances, counts, period locks and server-written audit history. Extends the existing bootstrap contract without inventing a subscription. |
| 004 | Adds request/approve/dispatch/receive/reject transfers. Dispatch deducts source stock; receipt uses the captured source cost, weighted into destination stock. Shortages require a manager and are recorded. |

Trigger failures abort the surrounding Auth transaction, so test 002 on a staging copy of the actual hosted schema before live rollout. Local tests exercise the included minimal Auth schema, not every hosted Supabase extension or existing Auth trigger. To roll back an application deployment, retain these data-bearing schemas and disable new frontend integrations; do not drop operational history. A database rollback needs a separately reviewed migration based on actual production state.

## API contracts for Claude

All APIs use the existing authenticated Supabase client: `await client.rpc(name, parameters)`. Check `error` before changing frontend state. Business and actor always come from `auth.uid()` and active membership; no caller-supplied tenant, role or author is accepted. MFA and current legal acceptance are required for operational access.

### Catalog, stock items and customers

`cleo_apply_records({ p_kind, p_upserts: [], p_archive: [] })`

Kinds: `products`, `ingredients`, `categories`, `modifiers`, `customers`. Product/inventory master data is owner/HQ only. Customers may also be managed by branch managers and cashiers. Batches are atomic and limited to 500 records / 1 MiB. Return value is the current active collection, with `id` and `_version` on each record.

Example product create:

```js
await client.rpc('cleo_apply_records', {
  p_kind: 'products',
  p_upserts: [{ id: crypto.randomUUID(), name: 'Americano', price: 130, sku: 'COFFEE-01' }],
  p_archive: []
});
```

- Create with a unique string id (UUIDs are accepted). Update with `{ id, _version, ...changedFields }`; archive with `{ id, _version }`. Stale versions fail with SQLSTATE `40001`.
- Product price is nonnegative, at most two decimals. SKU and barcode are unique per business among active products. Recipes use `[[itemId, positiveQuantity], ...]` and require active stock items from the same business. Recipe persistence does not yet implement sale deduction.
- Ingredients require `name` and `unit`; optional `grp`, `rp`, `supplier`, `exp`. `oh` and stock `cost` are server-owned and must not be sent back. Units cannot change after movement history exists. Archive is blocked by recipes, nonzero stock, or an open transfer.
- Customer fields currently supported: `name`, normalized `mobile` (`+639` and nine digits), `email`, `birthday`, `tin`, `address`, `consentAt`. Other fields such as points or charge balances are rejected until authoritative ledgers exist. Duplicate mobile numbers yield conflict; automatic customer merging is not implemented. Customer removal erases the record. Customer personal values are never copied to audit snapshots.
- This RPC implements a validated subset of each editor, not all generic `save()` collections. Do not send `users`, `expenses`, `terminals`, `ejournal`, or payment/loyalty state to it.

### Settings

`cleo_save_setting({ p_path, p_value, p_expected_version })` returns `{ ok, config, version }`. Initial expected version is `0`, supplied thereafter by `bootstrap.settingsVersion` or the previous response. Owner/HQ only. Supported paths: `business.name`, `business.legal`, `business.tin`, `business.style`, `business.receiptHeader`, `business.receiptFooter`, `limits.adjustApproval`, `limits.countVariance`. Other paths fail explicitly. A changed business name is reflected in account context and bootstrap. Stale version returns `40001`.

### Inventory

```js
await client.rpc('cleo_post_stock', {
  p_branch_id: branchId,
  p_item_id: itemId,
  p_kind: 'receive',
  p_quantity: 10,
  p_unit_cost: 100,
  p_reason: 'PO-123 · Supplier',
  p_request_id: crypto.randomUUID()
});
```

- `receive`: positive delivery quantity and nonnegative unit cost.
- `adjust`: signed quantity delta, including negative deductions; unit cost must be null. **The existing demo passes a positive amount to subtract. The frontend adapter must negate that amount for this RPC.**
- `count`: nonnegative physical stock target; unit cost null. Variance is calculated on the server, not supplied by the browser.
- `p_request_id` must be retained with the exact original request when retrying. An identical retry returns the committed original result; reuse for another payload fails. Decimal quantities/costs are limited to six places.
- Roles: owner, HQ, branch manager, inventory clerk. Assigned-branch access is enforced. Above-limit adjustments/counts require owner/HQ; no approval request is silently fabricated.
- Returns `{ ok, approved, needsApproval, movementId, item, branch, quantity, unitCost }`. All successful writes are approved. Disallowed changes reject with `42501`. Hydrate the returned item or refresh bootstrap only after success.
- Read `cleo_stock_movements` with an authenticated branch/item filter, descending `created_at`; RLS applies. Rows include `kind`, `quantity`, `unit_cost`, `reason`, `actor_id`, `created_at`. Map them to the frontend's stockLedger presentation.
- Bootstrap ingredients contain `oh` and `_branchCosts` maps keyed by branch id. Legacy `cost` is the first visible branch's cost; branch-specific screens must select `_branchCosts[branchId]`.

### Transfers

`cleo_create_transfer({ p_from, p_to, p_item_id, p_quantity, p_request_id })`

`cleo_advance_transfer({ p_id, p_action, p_expected_version, p_request_id, p_received: null })`

Both return `{ ok, transfer }`. State is `requested -> approved -> dispatched -> received`; `reject` is allowed before dispatch. `version` advances on each transition. Requests are idempotent using the same original request id/payload. Approvals/rejections require owner/HQ or a manager of the source branch. Dispatch requires source-branch access and enough stock. Receipt requires destination access. `p_received` defaults to the dispatched quantity; a shortage requires a manager and is recorded as `received_quantity` without manufacturing missing stock. It cannot exceed dispatched quantity. Transfer costs come from source inventory, never the client.

Fetch `cleo_transfers` after bootstrap and transitions; RLS exposes only transfers touching the assigned branch (all branches for global membership). Convert source/target/quantity/status fields into the frontend's transfer model. `cleo_transfer_requests` is private idempotency storage and is not browser-readable.

### Period locks and audit

`cleo_lock_period({ p_month: '2026-10-01', p_locked: true })` locks a Manila accounting month for stock dispatch/receipt/adjust/count. Reopening uses `false` and is audited. Owner/HQ only. The current server timestamp chooses the stock posting period; backdated postings are not supported. New writes fail during a lock, while retrying an already committed request remains safe. **This does not yet implement locks on future sales/expense APIs.**

Read `cleo_audit_log` in descending `created_at` for the authorized business/branch; owners, HQ, managers and accountants may read it. Clients cannot insert/update/delete audit rows or call the internal audit helper. Identity and timestamps are server-owned. Never map frontend `logAudit()` to a direct table insert.

### Errors and cache integration

Map `42501` to forbidden, `40001`/`23505` to conflict, `22023`/`23514` to validation, and `P0002` to not_found. Do not reuse the existing Auth-specific “account already exists” message for catalog conflicts. Bound query result sizes and paginate large collections. Treat realtime notifications as hints to refresh; this branch does not enable Realtime publications or add a subscription implementation.

## Validation

Node 22+:

```sh
npm --prefix supabase/tests ci --ignore-scripts
npm --prefix supabase/tests test
```

All **46 checks pass**: 19 original migration/auth checks, 19 profile/operations checks, 8 transfer checks. PGlite 0.5.10 is pinned with an npm lockfile. Tests create disposable databases and never touch the hosted project. The original harness now validates the actual built app's legal version instead of a missing frontend builder and writes a report only when `CLEO_RESULTS_FILE` is explicitly set. The tracked historical results.json is not this run's report.

`python3 backend/check-auth.py` performs read-only public Auth/deployment checks and private configuration checks when `SUPABASE_ACCESS_TOKEN` is securely bound. It prints an allowlisted diagnostic summary, never auth config/secrets or OAuth state. Exit 2 means readiness is incomplete. At the time of this change the public provider checks pass; the deployed page is parked and private config checks are blocked.

## Scope still pending

Frontend binding and a complete email/Facebook consent/confirmation round trip; private redirect/provider/SMTP inspection; hosted migration rollout. Core sales/fiscal upload, terminal credentials/PINs, staff invitations, shifts, expenses, reports, loyalty/charge ledgers, payment/subscription webhooks, delivery integrations and the later feature-spec items are not implemented by this branch. No paid plan or payment success is manufactured to bypass the unfinished billing flow. These require follow-up server work and, for provider integrations, the relevant service configuration. This branch is a backend implementation milestone, not completion of every feature in the specification.
