# Backend / frontend coordination

User-approved split: Codex owns `supabase/`, `backend/`, backend tests and this handoff. Claude Code owns frontend source, generated pages, assets and frontend tests. Communicate through this shared repository. This file is an asynchronous handoff; no response from Claude has been received in this cloud session.

User requirement: successful verified email or Facebook sign-in automatically creates a Cleo profile; business setup remains a separate user step. Never grant business membership or mark legal consent from user/provider metadata.

## Frontend work needed from Claude

- Restore the missing source/, assets/, content/, legal/ and frontend tests. Current index.html requests an absent Supabase SDK, so real sign-in is unavailable.
- For Facebook call Supabase signInWithOAuth with provider `facebook`, scopes `email`, the explicit app callback URL and PKCE. Handle a missing verified provider email with a useful message; do not invent an email or disable confirmation.
- Provider callback in Meta: https://ntbkbvlsgymupjdpuvob.supabase.co/auth/v1/callback. This differs from Supabase's allowlisted app redirect URL.
- Await code exchange and server-verified getUser(), then cleo_auth_context(); route needsMfa, needsBusiness and needsLegal from the server response. Existing users must not create duplicate profiles/businesses.
- Keep provider secrets out of frontend code. Request only the public SDK configuration.
- Integrate the backend APIs documented below after migrations are deployed; refresh bootstrap/cache only after an RPC succeeds. Do not enable billing, payment confirmations or terminal sale upload while their server contracts remain pending.

## Backend implementation available on this branch

- Migration 002 registers confirmed email/Facebook accounts automatically and fixes the unconfirmed legal-acceptance gap. Original deployed migration stays immutable.
- Migrations 003–004 add tenant-scoped catalog, customers, stock items, ledger/receiving/adjustments/counts, transfers, settings, inventory period locks and audit APIs. 46 local checks pass. See [complete RPC contracts and limits](../backend/README.md).
- The backend harness now checks the actual built app legal-version contract and no longer requires the absent frontend builder.

Hosted configuration, migration deployment and a human Facebook/email round trip still need validation. Production domain confirmed by the user: `https://cleopos.online`. It currently serves a Hostinger **Parked Domain** page at both `/index.html` and the SDK path. Supabase public settings enable email/Facebook/Google; Facebook authorize redirects to Facebook with email scope and the expected Supabase callback. Private management settings remain inaccessible without a securely bound management token. This session cannot use the user's Chrome tabs. No passwords are stored in source or this handoff.

Coordination thread: https://github.com/aeso-pro/Cleo-v1.4/issues/1. No Claude response has been received yet. Read the frontend mapping notes before wiring APIs: stock adjustment sign differs from the demo; stale versions and idempotency keys are required; only documented settings/collections are implemented; transfer and ledger reads are protected by RLS. Keep unfinished payments, billing and fiscal-sale APIs visibly unavailable.
