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

## Backend work in progress

- Follow-up migration for verified-account profile registration and auth validation regressions. Original deployed migration stays immutable.
- Tenant-scoped catalog, stock items, inventory ledger/receiving/adjustments, settings and audit APIs, with database security tests.
- Fix the existing backend harness's missing-frontend-build dependency by asserting the actual checked-in app's legal-version contract.

Hosted configuration and a human Facebook/email round trip still need validation. This environment has no access to the user's Chrome session. Git fetch works through the platform proxy; GitHub API and Supabase HTTPS currently return proxy Forbidden. No passwords are stored in the repository or this handoff.
