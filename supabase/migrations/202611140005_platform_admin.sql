-- Cleo 005: platform administration, account suspension and hardening.
-- Apply AFTER 202610170001 … 0004, once, as the database owner (Supabase SQL Editor or migrations).
--
-- What this adds
--   1. Hardening of what is already deployed:
--        - the sign-up trigger on auth.users can no longer abort a sign-up (Facebook, Google or email);
--        - a suspended or banned account loses access at once, not when its token expires;
--        - business audit history becomes append-only for every role;
--        - stored records get size, type and character limits.
--   2. The platform admin console (admin.html): three private tables and nine RPCs.
--      Every admin RPC checks, on the server, that the caller is an active platform admin
--      with a confirmed email AND a session that completed two-step verification (aal2).
--
-- A browser can never make itself an admin: cleo_platform_admins has no browser privilege
-- and no policy. The first admin is added by the database owner in the SQL Editor:
--
--   INSERT INTO public.cleo_platform_admins(user_id, role, note)
--   SELECT id, 'superadmin', 'First administrator' FROM auth.users
--    WHERE lower(email) = lower('YOUR-EMAIL@example.com');
--
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.cleo_transfers') IS NULL OR to_regclass('public.cleo_audit_log') IS NULL
     OR to_regprocedure('public.cleo_require_actor(text[],uuid)') IS NULL THEN
    RAISE EXCEPTION 'Cleo admin migration stopped: apply migrations 001 to 004 first.';
  END IF;
  IF to_regclass('public.cleo_platform_admins') IS NOT NULL OR to_regclass('public.cleo_admin_audit') IS NOT NULL
     OR to_regclass('public.cleo_account_suspensions') IS NOT NULL THEN
    RAISE EXCEPTION 'Cleo admin migration stopped: it has already been applied.';
  END IF;
END;
$guard$;

-- ---------------------------------------------------------------------------
-- Tables. No browser role can read or write any of them directly.
-- ---------------------------------------------------------------------------
CREATE TABLE public.cleo_platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'support' CHECK (role IN ('superadmin', 'support')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
COMMENT ON TABLE public.cleo_platform_admins IS
  'Who may use the Cleo admin console. Rows are added and revoked by the database owner only, never from a browser.';

CREATE TABLE public.cleo_account_suspensions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  suspended_by uuid NOT NULL,
  suspended_at timestamptz NOT NULL DEFAULT now(),
  lifted_by uuid,
  lifted_at timestamptz
);
-- One open suspension per account; lifted ones stay as history.
CREATE UNIQUE INDEX cleo_account_suspensions_open ON public.cleo_account_suspensions(user_id)
  WHERE lifted_at IS NULL;

-- The admin's identity is copied in, not referenced: deleting an Auth user must never
-- rewrite or remove what that admin did.
CREATE TABLE public.cleo_admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id uuid NOT NULL,
  admin_email text NOT NULL DEFAULT '',
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  target_type text NOT NULL CHECK (target_type IN ('account', 'business', 'membership', 'system')),
  target_id text NOT NULL DEFAULT '' CHECK (char_length(target_id) <= 120),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cleo_admin_audit_recent ON public.cleo_admin_audit(created_at DESC);

ALTER TABLE public.cleo_platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_account_suspensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cleo_platform_admins, public.cleo_account_suspensions, public.cleo_admin_audit
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.cleo_account_suspensions_id_seq, public.cleo_admin_audit_id_seq
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Hardening
-- ---------------------------------------------------------------------------

-- Internal: an account an admin suspended, or one Supabase Auth has banned.
CREATE FUNCTION public.cleo_account_blocked(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.cleo_account_suspensions s
             WHERE s.user_id = p_user AND s.lifted_at IS NULL)
    OR EXISTS (SELECT 1 FROM auth.users u
                WHERE u.id = p_user AND u.banned_until IS NOT NULL AND u.banned_until > now()));
$function$;
REVOKE ALL ON FUNCTION public.cleo_account_blocked(uuid) FROM PUBLIC, anon, authenticated;

-- Every table policy and every RPC goes through this helper, so a blocked account is locked
-- out of all tenant data immediately. A token that is still valid no longer helps it.
CREATE OR REPLACE FUNCTION public.cleo_session_is_strong()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND NOT public.cleo_account_blocked(auth.uid())
    AND (
      COALESCE(auth.jwt() ->> 'aal', '') = 'aal2'
      OR NOT EXISTS (
        SELECT 1 FROM auth.mfa_factors f
         WHERE f.user_id = auth.uid() AND f.status::text = 'verified'
      )
    );
$function$;

-- Same contract as migration 002, plus: a blocked account gets a clear refusal instead of
-- an authenticator prompt it could never satisfy.
CREATE OR REPLACE FUNCTION public.cleo_auth_context()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  actor_email text;
  actor_name text;
  profile public.cleo_profiles%ROWTYPE;
  membership public.cleo_memberships%ROWTYPE;
  business public.cleo_businesses%ROWTYPE;
  branch public.cleo_branches%ROWTYPE;
  legal jsonb;
  display_role text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in to continue.'; END IF;
  IF public.cleo_account_blocked(actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This account has been suspended. Contact Cleo support.',
      HINT = 'cleo_account_suspended';
  END IF;
  SELECT u.email, left(COALESCE(NULLIF(btrim(u.raw_user_meta_data ->> 'name'), ''),
    NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1), ''), 120)
    INTO actor_email, actor_name FROM auth.users u
    WHERE u.id = actor AND u.email_confirmed_at IS NOT NULL;
  IF NOT FOUND OR NULLIF(btrim(actor_email), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'A verified email account is required.';
  END IF;
  INSERT INTO public.cleo_profiles(user_id, display_name) VALUES (actor, actor_name)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT p.* INTO profile FROM public.cleo_profiles p WHERE p.user_id = actor;

  IF NOT public.cleo_session_is_strong() THEN
    RETURN jsonb_build_object('account', jsonb_build_object('id', actor, 'name', profile.display_name,
      'email', actor_email, 'role', NULL, 'businessId', NULL, 'needsBusiness', false, 'needsMfa', true),
      'profile', jsonb_build_object('id', actor, 'name', profile.display_name, 'email', actor_email),
      'business', NULL, 'branch', NULL, 'role', NULL, 'legal', NULL, 'needsMfa', true);
  END IF;

  SELECT m.* INTO membership FROM public.cleo_memberships m
    WHERE m.user_id = actor AND m.revoked_at IS NULL;
  IF membership.business_id IS NOT NULL THEN
    SELECT b.* INTO business FROM public.cleo_businesses b WHERE b.id = membership.business_id;
    SELECT b.* INTO branch FROM public.cleo_branches b
      WHERE b.business_id = membership.business_id
        AND (membership.branch_id IS NULL OR b.id = membership.branch_id)
      ORDER BY b.created_at, b.id LIMIT 1;
    display_role := CASE membership.role WHEN 'owner' THEN 'Owner' WHEN 'hq' THEN 'HQ Manager'
      WHEN 'manager' THEN 'Branch Manager' WHEN 'cashier' THEN 'Cashier' WHEN 'kitchen' THEN 'Kitchen'
      WHEN 'clerk' THEN 'Stock Clerk' WHEN 'accountant' THEN 'Accountant' END;
  END IF;
  SELECT jsonb_build_object('version', a.version, 'at', a.accepted_at, 'method', a.method)
    INTO legal FROM public.cleo_legal_acceptances a
    WHERE a.user_id = actor AND a.version = 'privacy 1.0, terms 1.0';
  RETURN jsonb_build_object(
    'account', jsonb_build_object('id', actor, 'name', profile.display_name, 'email', actor_email,
      'role', display_role, 'businessId', membership.business_id,
      'needsBusiness', membership.business_id IS NULL, 'needsMfa', false),
    'profile', jsonb_build_object('id', actor, 'name', profile.display_name, 'email', actor_email),
    'business', CASE WHEN business.id IS NOT NULL THEN jsonb_build_object('id', business.id,
      'name', business.name, 'modules', business.modules) ELSE NULL END,
    'branch', CASE WHEN branch.id IS NOT NULL THEN jsonb_build_object('id', branch.id,
      'businessId', branch.business_id, 'name', branch.name, 'code', branch.code) ELSE NULL END,
    'role', membership.role, 'legal', legal, 'needsMfa', false);
END;
$function$;

-- A failure while creating the profile must never abort the surrounding Auth transaction:
-- that is what turns a Facebook or Google sign-up into "Database error saving new user".
-- cleo_auth_context() creates a missing profile at the first sign-in anyway.
CREATE OR REPLACE FUNCTION public.cleo_register_verified_profile()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND NULLIF(btrim(NEW.email), '') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.cleo_profiles(user_id, display_name)
      VALUES (NEW.id, left(COALESCE(NULLIF(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
        NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''), split_part(NEW.email, '@', 1)), 120))
      ON CONFLICT (user_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Cleo profile registration skipped for %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

-- Audit history is append-only for every role, including the service role.
CREATE FUNCTION public.cleo_refuse_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Audit history cannot be changed.';
END;
$function$;
REVOKE ALL ON FUNCTION public.cleo_refuse_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER cleo_audit_log_append_only BEFORE UPDATE OR DELETE ON public.cleo_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.cleo_refuse_change();
CREATE TRIGGER cleo_audit_log_no_truncate BEFORE TRUNCATE ON public.cleo_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.cleo_refuse_change();
CREATE TRIGGER cleo_admin_audit_append_only BEFORE UPDATE OR DELETE ON public.cleo_admin_audit
  FOR EACH ROW EXECUTE FUNCTION public.cleo_refuse_change();
CREATE TRIGGER cleo_admin_audit_no_truncate BEFORE TRUNCATE ON public.cleo_admin_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.cleo_refuse_change();

-- Limits on what a record may hold, whatever wrote it. cleo_apply_records already checks
-- names, prices, recipes and mobile numbers; this bounds everything else it lets through.
CREATE FUNCTION public.cleo_validate_record()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  d jsonb := NEW.data;
  field record;
  key text;
BEGIN
  IF octet_length(d::text) > 65536 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'This record is too large to save.';
  END IF;
  FOR field IN SELECT e.key, e.value FROM jsonb_each(d) AS e LOOP
    IF jsonb_typeof(field.value) = 'string' AND (char_length(field.value #>> '{}') > 2000
        OR (field.value #>> '{}') ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A text value is too long or has characters that cannot be saved.';
    END IF;
  END LOOP;
  IF NEW.kind = 'customers' THEN
    IF d ? 'email' AND (jsonb_typeof(d -> 'email') <> 'string' OR char_length(d ->> 'email') > 254
        OR (d ->> 'email' <> '' AND d ->> 'email' !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Enter a valid customer email address.';
    END IF;
    FOREACH key IN ARRAY ARRAY['birthday', 'tin', 'address', 'consentAt'] LOOP
      IF d ? key AND (jsonb_typeof(d -> key) <> 'string' OR char_length(d ->> key) >
          CASE key WHEN 'birthday' THEN 10 WHEN 'tin' THEN 20 WHEN 'address' THEN 300 ELSE 40 END) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A customer detail is too long or has the wrong type.';
      END IF;
    END LOOP;
  ELSIF NEW.kind = 'products' THEN
    FOREACH key IN ARRAY ARRAY['sku', 'barcode', 'cat', 'station', 'taxType'] LOOP
      IF d ? key AND (jsonb_typeof(d -> key) <> 'string' OR char_length(d ->> key) > 80) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A product detail is too long or has the wrong type.';
      END IF;
    END LOOP;
    IF d ? 'cost' AND (jsonb_typeof(d -> 'cost') <> 'number' OR (d ->> 'cost')::numeric NOT BETWEEN 0 AND 100000000) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Product cost must be a nonnegative amount.';
    END IF;
    IF d ? 'available' AND jsonb_typeof(d -> 'available') <> 'boolean' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Product availability must be on or off.';
    END IF;
  ELSIF NEW.kind = 'categories' THEN
    IF d ? 'icon' AND (jsonb_typeof(d -> 'icon') <> 'string' OR char_length(d ->> 'icon') > 60) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A category detail is too long or has the wrong type.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.cleo_validate_record() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER cleo_validate_record BEFORE INSERT OR UPDATE OF data ON public.cleo_records
  FOR EACH ROW EXECUTE FUNCTION public.cleo_validate_record();

-- ---------------------------------------------------------------------------
-- 2. Platform admin console
-- ---------------------------------------------------------------------------

-- Internal gate for every admin RPC. Returns the caller's admin role or refuses.
-- An admin session ALWAYS needs a completed second factor (aal2), enrolled or not:
-- the console therefore cannot be opened with a password alone.
CREATE FUNCTION public.cleo_require_admin(p_write boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  admin_role text;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in to continue.';
  END IF;
  SELECT a.role INTO admin_role
    FROM public.cleo_platform_admins a JOIN auth.users u ON u.id = a.user_id
   WHERE a.user_id = actor AND a.revoked_at IS NULL
     AND u.email_confirmed_at IS NOT NULL AND NULLIF(btrim(u.email), '') IS NOT NULL;
  IF admin_role IS NULL OR public.cleo_account_blocked(actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Admin access is required.';
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Confirm your authenticator code to use the admin console.', HINT = 'cleo_admin_mfa_required';
  END IF;
  IF p_write AND admin_role <> 'superadmin' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only a superadmin can make this change.';
  END IF;
  RETURN admin_role;
END;
$function$;
REVOKE ALL ON FUNCTION public.cleo_require_admin(boolean) FROM PUBLIC, anon, authenticated;

-- Internal: one line of admin history. Identity and time come from the server.
CREATE FUNCTION public.cleo_admin_log(p_action text, p_target_type text, p_target_id text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  INSERT INTO public.cleo_admin_audit(admin_id, admin_email, action, target_type, target_id, detail)
  SELECT auth.uid(), COALESCE((SELECT u.email FROM auth.users u WHERE u.id = auth.uid()), ''),
    p_action, p_target_type, COALESCE(p_target_id, ''), COALESCE(p_detail, '{}'::jsonb);
$function$;
REVOKE ALL ON FUNCTION public.cleo_admin_log(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- The caller's own admin standing, so the console can show the right step (two-step set-up,
-- the authenticator prompt, or the console). Tells a non-admin nothing about anyone else.
CREATE FUNCTION public.cleo_admin_context()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  admin_role text;
  actor_email text;
  actor_name text;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in to continue.';
  END IF;
  SELECT a.role, u.email INTO admin_role, actor_email
    FROM public.cleo_platform_admins a JOIN auth.users u ON u.id = a.user_id
   WHERE a.user_id = actor AND a.revoked_at IS NULL
     AND u.email_confirmed_at IS NOT NULL AND NULLIF(btrim(u.email), '') IS NOT NULL;
  IF admin_role IS NULL OR public.cleo_account_blocked(actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Admin access is required.';
  END IF;
  SELECT p.display_name INTO actor_name FROM public.cleo_profiles p WHERE p.user_id = actor;
  RETURN jsonb_build_object('admin', true, 'role', admin_role, 'canWrite', admin_role = 'superadmin',
    'email', actor_email, 'name', COALESCE(NULLIF(btrim(actor_name), ''), split_part(actor_email, '@', 1)),
    'mfaEnrolled', EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = actor AND f.status::text = 'verified'),
    'mfaVerified', COALESCE(auth.jwt() ->> 'aal', '') = 'aal2');
END;
$function$;

-- Called once when the console opens: who came in, from where.
CREATE FUNCTION public.cleo_admin_session_start()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  admin_role text;
  headers jsonb;
BEGIN
  admin_role := public.cleo_require_admin();
  BEGIN
    headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    headers := NULL;
  END;
  PERFORM public.cleo_admin_log('session.start', 'system', '', jsonb_build_object(
    'userAgent', left(COALESCE(headers ->> 'user-agent', ''), 200),
    'ip', left(btrim(split_part(COALESCE(headers ->> 'x-forwarded-for', ''), ',', 1)), 60)));
  RETURN jsonb_build_object('ok', true, 'role', admin_role);
END;
$function$;

CREATE FUNCTION public.cleo_admin_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  series jsonb;
BEGIN
  PERFORM public.cleo_require_admin();
  SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d.day::text,
      'accounts', (SELECT count(*) FROM auth.users u WHERE (u.created_at AT TIME ZONE 'Asia/Manila')::date = d.day),
      'businesses', (SELECT count(*) FROM public.cleo_businesses b WHERE (b.created_at AT TIME ZONE 'Asia/Manila')::date = d.day))
      ORDER BY d.day), '[]'::jsonb)
    INTO series
    FROM (SELECT generate_series(today - 29, today, interval '1 day')::date AS day) d;
  RETURN jsonb_build_object(
    'accounts', jsonb_build_object(
      'total', (SELECT count(*) FROM auth.users),
      'confirmed', (SELECT count(*) FROM auth.users u WHERE u.email_confirmed_at IS NOT NULL),
      'withBusiness', (SELECT count(DISTINCT m.user_id) FROM public.cleo_memberships m WHERE m.revoked_at IS NULL),
      'pendingSetup', (SELECT count(*) FROM auth.users u WHERE u.email_confirmed_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.cleo_memberships m WHERE m.user_id = u.id)),
      'suspended', (SELECT count(*) FROM public.cleo_account_suspensions s WHERE s.lifted_at IS NULL),
      'twoStep', (SELECT count(DISTINCT f.user_id) FROM auth.mfa_factors f WHERE f.status::text = 'verified'),
      'new7', (SELECT count(*) FROM auth.users u WHERE u.created_at > now() - interval '7 days'),
      'new30', (SELECT count(*) FROM auth.users u WHERE u.created_at > now() - interval '30 days'),
      'active7', (SELECT count(*) FROM auth.users u WHERE u.last_sign_in_at > now() - interval '7 days')),
    'providers', jsonb_build_object(
      'facebook', (SELECT count(*) FROM auth.users u WHERE u.raw_app_meta_data ->> 'provider' = 'facebook'
        OR COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'facebook'),
      'google', (SELECT count(*) FROM auth.users u WHERE u.raw_app_meta_data ->> 'provider' = 'google'
        OR COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'),
      'email', (SELECT count(*) FROM auth.users u WHERE COALESCE(NULLIF(u.raw_app_meta_data ->> 'provider', ''), 'email') = 'email'
        OR COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'email')),
    'businesses', jsonb_build_object(
      'total', (SELECT count(*) FROM public.cleo_businesses),
      'new7', (SELECT count(*) FROM public.cleo_businesses b WHERE b.created_at > now() - interval '7 days'),
      'new30', (SELECT count(*) FROM public.cleo_businesses b WHERE b.created_at > now() - interval '30 days'),
      'branches', (SELECT count(*) FROM public.cleo_branches),
      'fnb', (SELECT count(*) FROM public.cleo_businesses b WHERE 'fnb' = ANY (b.modules)),
      'retail', (SELECT count(*) FROM public.cleo_businesses b WHERE 'retail' = ANY (b.modules)),
      'svc', (SELECT count(*) FROM public.cleo_businesses b WHERE 'svc' = ANY (b.modules))),
    'signups', series,
    'generatedAt', now());
END;
$function$;

-- Accounts, newest first. Never returns password hashes, tokens, or authenticator secrets.
CREATE FUNCTION public.cleo_admin_list_accounts(p_search text DEFAULT '', p_filter text DEFAULT 'all',
  p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  needle text;
  total bigint;
  page jsonb;
BEGIN
  PERFORM public.cleo_require_admin();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000
     OR char_length(COALESCE(p_search, '')) > 100
     OR COALESCE(p_filter, '') NOT IN ('all', 'facebook', 'google', 'email', 'unconfirmed', 'no_business', 'suspended', 'no_two_step') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Check the search and page options.';
  END IF;
  -- The search text is matched literally: % and _ are not wildcards.
  needle := '%' || replace(replace(replace(lower(btrim(COALESCE(p_search, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  WITH base AS (
    SELECT u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
      COALESCE(NULLIF(u.raw_app_meta_data ->> 'provider', ''), 'email') AS provider,
      COALESCE(u.raw_app_meta_data -> 'providers', '[]'::jsonb) AS providers,
      COALESCE(p.display_name, '') AS display_name,
      m.business_id, m.role AS member_role, m.revoked_at, COALESCE(b.name, '') AS business_name,
      EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = u.id AND f.status::text = 'verified') AS two_step,
      s.reason AS suspended_reason, s.suspended_at,
      (u.banned_until IS NOT NULL AND u.banned_until > now()) AS banned,
      a.role AS admin_role
    FROM auth.users u
    LEFT JOIN public.cleo_profiles p ON p.user_id = u.id
    LEFT JOIN LATERAL (SELECT x.business_id, x.role, x.revoked_at FROM public.cleo_memberships x
      WHERE x.user_id = u.id ORDER BY (x.revoked_at IS NULL) DESC, x.created_at DESC LIMIT 1) m ON true
    LEFT JOIN public.cleo_businesses b ON b.id = m.business_id
    LEFT JOIN public.cleo_account_suspensions s ON s.user_id = u.id AND s.lifted_at IS NULL
    LEFT JOIN public.cleo_platform_admins a ON a.user_id = u.id AND a.revoked_at IS NULL
  ), filtered AS (
    SELECT * FROM base
    WHERE (needle = '%%' OR lower(COALESCE(email, '')) LIKE needle OR lower(display_name) LIKE needle
        OR lower(business_name) LIKE needle)
      AND CASE p_filter
        WHEN 'facebook' THEN provider = 'facebook' OR providers ? 'facebook'
        WHEN 'google' THEN provider = 'google' OR providers ? 'google'
        WHEN 'email' THEN provider = 'email' AND NOT (providers ? 'facebook' OR providers ? 'google')
        WHEN 'unconfirmed' THEN email_confirmed_at IS NULL
        WHEN 'no_business' THEN business_id IS NULL
        WHEN 'suspended' THEN suspended_at IS NOT NULL OR banned
        WHEN 'no_two_step' THEN NOT two_step
        ELSE true END
  )
  SELECT (SELECT count(*) FROM filtered),
    COALESCE((SELECT jsonb_agg(x.item ORDER BY x.created_at DESC NULLS LAST, x.id) FROM (
      SELECT f.created_at, f.id, jsonb_build_object(
        'id', f.id, 'email', COALESCE(f.email, ''), 'name', f.display_name,
        'provider', f.provider, 'providers', f.providers,
        'confirmed', f.email_confirmed_at IS NOT NULL,
        'createdAt', f.created_at, 'lastSignInAt', f.last_sign_in_at,
        'twoStep', f.two_step,
        'suspended', f.suspended_at IS NOT NULL, 'suspendedReason', COALESCE(f.suspended_reason, ''),
        'suspendedAt', f.suspended_at, 'banned', f.banned,
        'businessId', f.business_id, 'business', f.business_name, 'role', f.member_role,
        'membershipRevoked', f.revoked_at IS NOT NULL,
        'adminRole', f.admin_role) AS item
      FROM filtered f ORDER BY f.created_at DESC NULLS LAST, f.id LIMIT p_limit OFFSET p_offset) x), '[]'::jsonb)
    INTO total, page;
  RETURN jsonb_build_object('total', total, 'rows', page, 'limit', p_limit, 'offset', p_offset);
END;
$function$;

CREATE FUNCTION public.cleo_admin_list_businesses(p_search text DEFAULT '', p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  needle text;
  total bigint;
  page jsonb;
BEGIN
  PERFORM public.cleo_require_admin();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000
     OR char_length(COALESCE(p_search, '')) > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Check the search and page options.';
  END IF;
  needle := '%' || replace(replace(replace(lower(btrim(COALESCE(p_search, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  WITH base AS (
    SELECT b.id, b.name, b.modules, b.created_at,
      COALESCE(o.email, '') AS owner_email, COALESCE(op.display_name, '') AS owner_name,
      (om.user_id IS NOT NULL AND om.revoked_at IS NULL) AS has_owner,
      (SELECT count(*) FROM public.cleo_memberships x WHERE x.business_id = b.id AND x.revoked_at IS NULL) AS members,
      (SELECT count(*) FROM public.cleo_branches x WHERE x.business_id = b.id) AS branches,
      (SELECT count(*) FROM public.cleo_records x WHERE x.business_id = b.id AND x.kind = 'products' AND NOT x.archived) AS products,
      (SELECT max(x.created_at) FROM public.cleo_audit_log x WHERE x.business_id = b.id) AS last_activity
    FROM public.cleo_businesses b
    LEFT JOIN LATERAL (SELECT x.user_id, x.revoked_at FROM public.cleo_memberships x
      WHERE x.business_id = b.id AND x.role = 'owner' ORDER BY (x.revoked_at IS NULL) DESC, x.created_at LIMIT 1) om ON true
    LEFT JOIN auth.users o ON o.id = om.user_id
    LEFT JOIN public.cleo_profiles op ON op.user_id = om.user_id
  ), filtered AS (
    SELECT * FROM base
    WHERE needle = '%%' OR lower(name) LIKE needle OR lower(owner_email) LIKE needle OR lower(owner_name) LIKE needle
  )
  SELECT (SELECT count(*) FROM filtered),
    COALESCE((SELECT jsonb_agg(x.item ORDER BY x.created_at DESC, x.id) FROM (
      SELECT f.created_at, f.id, jsonb_build_object(
        'id', f.id, 'name', f.name, 'modules', to_jsonb(f.modules), 'createdAt', f.created_at,
        'ownerEmail', f.owner_email, 'ownerName', f.owner_name, 'hasOwner', f.has_owner,
        'members', f.members, 'branches', f.branches, 'products', f.products,
        'lastActivityAt', f.last_activity) AS item
      FROM filtered f ORDER BY f.created_at DESC, f.id LIMIT p_limit OFFSET p_offset) x), '[]'::jsonb)
    INTO total, page;
  RETURN jsonb_build_object('total', total, 'rows', page, 'limit', p_limit, 'offset', p_offset);
END;
$function$;

-- One business: who belongs to it and what happened recently. Activity lists actions and record
-- ids only; the before/after values of the business's own audit trail are not copied out.
CREATE FUNCTION public.cleo_admin_business(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  found_business jsonb;
BEGIN
  PERFORM public.cleo_require_admin();
  SELECT jsonb_build_object('id', b.id, 'name', b.name, 'modules', to_jsonb(b.modules), 'createdAt', b.created_at)
    INTO found_business FROM public.cleo_businesses b WHERE b.id = p_business_id;
  IF found_business IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That business no longer exists.';
  END IF;
  RETURN jsonb_build_object(
    'business', found_business,
    'branches', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'name', x.name, 'city', x.city)
        ORDER BY x.created_at, x.id), '[]'::jsonb)
      FROM public.cleo_branches x WHERE x.business_id = p_business_id),
    'members', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'userId', m.user_id, 'email', COALESCE(u.email, ''), 'name', COALESCE(p.display_name, ''),
        'role', m.role, 'branch', COALESCE(br.name, ''), 'since', m.created_at,
        'revoked', m.revoked_at IS NOT NULL, 'revokedAt', m.revoked_at,
        'lastSignInAt', u.last_sign_in_at,
        'twoStep', EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = m.user_id AND f.status::text = 'verified'),
        'suspended', public.cleo_account_blocked(m.user_id))
        ORDER BY (m.role = 'owner') DESC, m.created_at, m.user_id), '[]'::jsonb)
      FROM public.cleo_memberships m
      LEFT JOIN auth.users u ON u.id = m.user_id
      LEFT JOIN public.cleo_profiles p ON p.user_id = m.user_id
      LEFT JOIN public.cleo_branches br ON br.id = m.branch_id
      WHERE m.business_id = p_business_id),
    'counts', jsonb_build_object(
      'products', (SELECT count(*) FROM public.cleo_records x WHERE x.business_id = p_business_id AND x.kind = 'products' AND NOT x.archived),
      'stockItems', (SELECT count(*) FROM public.cleo_records x WHERE x.business_id = p_business_id AND x.kind = 'ingredients' AND NOT x.archived),
      'customers', (SELECT count(*) FROM public.cleo_records x WHERE x.business_id = p_business_id AND x.kind = 'customers' AND NOT x.archived),
      'stockMovements', (SELECT count(*) FROM public.cleo_stock_movements x WHERE x.business_id = p_business_id),
      'transfers', (SELECT count(*) FROM public.cleo_transfers x WHERE x.business_id = p_business_id)),
    'activity', (SELECT COALESCE(jsonb_agg(x.item ORDER BY x.created_at DESC, x.id DESC), '[]'::jsonb) FROM (
      SELECT l.created_at, l.id, jsonb_build_object('at', l.created_at, 'action', l.action,
        'entity', l.entity_id, 'actor', COALESCE(u.email, '')) AS item
      FROM public.cleo_audit_log l LEFT JOIN auth.users u ON u.id = l.actor_id
      WHERE l.business_id = p_business_id ORDER BY l.created_at DESC, l.id DESC LIMIT 40) x));
END;
$function$;

-- Suspend or restore an account. Superadmin only; the reason is kept.
CREATE FUNCTION public.cleo_admin_set_suspension(p_user_id uuid, p_suspended boolean, p_reason text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  reason text := btrim(COALESCE(p_reason, ''));
  target_email text;
  touched integer := 0;
BEGIN
  PERFORM public.cleo_require_admin(true);
  IF p_user_id IS NULL OR p_suspended IS NULL OR char_length(reason) > 500
     OR (p_suspended AND char_length(reason) < 3) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose an account and give a short reason.';
  END IF;
  IF p_user_id = actor THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'You cannot suspend your own account.';
  END IF;
  SELECT COALESCE(u.email, '') INTO target_email FROM auth.users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That account no longer exists.';
  END IF;
  IF p_suspended AND EXISTS (SELECT 1 FROM public.cleo_platform_admins a
      WHERE a.user_id = p_user_id AND a.revoked_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Remove this account''s admin access before suspending it.';
  END IF;
  IF p_suspended THEN
    INSERT INTO public.cleo_account_suspensions(user_id, reason, suspended_by) VALUES (p_user_id, reason, actor)
      ON CONFLICT (user_id) WHERE lifted_at IS NULL DO NOTHING;
  ELSE
    UPDATE public.cleo_account_suspensions SET lifted_at = now(), lifted_by = actor
      WHERE user_id = p_user_id AND lifted_at IS NULL;
  END IF;
  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched > 0 THEN
    PERFORM public.cleo_admin_log(CASE WHEN p_suspended THEN 'account.suspend' ELSE 'account.restore' END,
      'account', p_user_id::text, jsonb_build_object('email', target_email, 'reason', reason));
  END IF;
  RETURN jsonb_build_object('ok', true, 'userId', p_user_id, 'suspended', p_suspended, 'changed', touched > 0);
END;
$function$;

-- Revoke or restore one person's access to one business. Superadmin only. The business sees
-- the change in its own audit trail; the internal reason stays in the admin history.
CREATE FUNCTION public.cleo_admin_set_membership(p_user_id uuid, p_business_id uuid, p_revoked boolean, p_reason text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  reason text := btrim(COALESCE(p_reason, ''));
  member public.cleo_memberships%ROWTYPE;
  changed boolean := false;
BEGIN
  PERFORM public.cleo_require_admin(true);
  IF p_user_id IS NULL OR p_business_id IS NULL OR p_revoked IS NULL OR char_length(reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose a member and give a short reason.';
  END IF;
  -- The same lock every business write takes first, so this cannot interleave with one.
  PERFORM 1 FROM public.cleo_businesses b WHERE b.id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That business no longer exists.';
  END IF;
  SELECT * INTO member FROM public.cleo_memberships x
    WHERE x.user_id = p_user_id AND x.business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That membership no longer exists.';
  END IF;
  IF p_revoked AND member.revoked_at IS NULL THEN
    UPDATE public.cleo_memberships SET revoked_at = now()
      WHERE user_id = p_user_id AND business_id = p_business_id;
    changed := true;
  ELSIF NOT p_revoked AND member.revoked_at IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.cleo_memberships x WHERE x.user_id = p_user_id AND x.revoked_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'This account is already active in another business.';
    END IF;
    UPDATE public.cleo_memberships SET revoked_at = NULL
      WHERE user_id = p_user_id AND business_id = p_business_id;
    changed := true;
  END IF;
  IF changed THEN
    PERFORM public.cleo_admin_log(CASE WHEN p_revoked THEN 'membership.revoke' ELSE 'membership.restore' END,
      'membership', p_user_id::text,
      jsonb_build_object('businessId', p_business_id, 'role', member.role, 'reason', reason));
    PERFORM public.cleo_write_audit(p_business_id, NULL,
      CASE WHEN p_revoked THEN 'admin.membership.revoke' ELSE 'admin.membership.restore' END,
      p_user_id::text, NULL, jsonb_build_object('role', member.role, 'by', 'Cleo support'));
  END IF;
  RETURN jsonb_build_object('ok', true, 'userId', p_user_id, 'businessId', p_business_id,
    'revoked', p_revoked, 'changed', changed);
END;
$function$;

CREATE FUNCTION public.cleo_admin_audit_log(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.cleo_require_admin();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Check the page options.';
  END IF;
  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM public.cleo_admin_audit),
    'rows', (SELECT COALESCE(jsonb_agg(x.item ORDER BY x.id DESC), '[]'::jsonb) FROM (
      SELECT a.id, jsonb_build_object('id', a.id, 'at', a.created_at, 'admin', a.admin_email,
        'action', a.action, 'targetType', a.target_type, 'targetId', a.target_id, 'detail', a.detail) AS item
      FROM public.cleo_admin_audit a ORDER BY a.id DESC LIMIT p_limit OFFSET p_offset) x),
    'limit', p_limit, 'offset', p_offset);
END;
$function$;

-- A live self-check of the rules this schema depends on. Each check is true when the rule holds.
CREATE FUNCTION public.cleo_admin_security_report()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  checks jsonb := '[]'::jsonb;
  offenders text;
BEGIN
  PERFORM public.cleo_require_admin();

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO offenders
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'cleo\_%' AND NOT c.relrowsecurity;
  checks := checks || jsonb_build_object('id', 'rls', 'ok', offenders IS NULL,
    'label', 'Row-level security is on for every Cleo table', 'detail', COALESCE('Off for: ' || offenders, ''));

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO offenders
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'cleo\_%'
     AND has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE');
  checks := checks || jsonb_build_object('id', 'anon_tables', 'ok', offenders IS NULL,
    'label', 'Visitors who are not signed in cannot read or change any Cleo table',
    'detail', COALESCE('Open to visitors: ' || offenders, ''));

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO offenders
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'cleo\_%'
     AND has_table_privilege('authenticated', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE');
  checks := checks || jsonb_build_object('id', 'browser_writes', 'ok', offenders IS NULL,
    'label', 'Signed-in browsers cannot write a table directly; every change goes through a checked function',
    'detail', COALESCE('Writable from a browser: ' || offenders, ''));

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO offenders
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN ('cleo_platform_admins', 'cleo_account_suspensions', 'cleo_admin_audit', 'cleo_transfer_requests')
     AND has_table_privilege('authenticated', c.oid, 'SELECT');
  checks := checks || jsonb_build_object('id', 'private_tables', 'ok', offenders IS NULL,
    'label', 'Admin and internal tables cannot be read from a browser',
    'detail', COALESCE('Readable from a browser: ' || offenders, ''));

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO offenders
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname LIKE 'cleo\_%' AND has_function_privilege('anon', p.oid, 'EXECUTE');
  checks := checks || jsonb_build_object('id', 'anon_functions', 'ok', offenders IS NULL,
    'label', 'No Cleo function can be run without signing in',
    'detail', COALESCE('Open to visitors: ' || offenders, ''));

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO offenders
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname LIKE 'cleo\_%'
     AND (p.proconfig IS NULL OR NOT p.proconfig @> ARRAY['search_path=""']::text[]);
  checks := checks || jsonb_build_object('id', 'search_path', 'ok', offenders IS NULL,
    'label', 'Every Cleo function pins its search path',
    'detail', COALESCE('Not pinned: ' || offenders, ''));

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO offenders
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('cleo_require_admin', 'cleo_admin_log', 'cleo_account_blocked', 'cleo_require_actor',
       'cleo_write_audit', 'cleo_identity_bootstrap', 'cleo_refuse_change', 'cleo_validate_record',
       'cleo_register_verified_profile', 'cleo_guard_open_transfer_archive')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  checks := checks || jsonb_build_object('id', 'internal_functions', 'ok', offenders IS NULL,
    'label', 'Internal helper functions cannot be called from a browser',
    'detail', COALESCE('Callable from a browser: ' || offenders, ''));

  SELECT string_agg(COALESCE(u.email, a.user_id::text), ', ' ORDER BY u.email) INTO offenders
    FROM public.cleo_platform_admins a LEFT JOIN auth.users u ON u.id = a.user_id
   WHERE a.revoked_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = a.user_id AND f.status::text = 'verified');
  checks := checks || jsonb_build_object('id', 'admin_two_step', 'ok', offenders IS NULL,
    'label', 'Every admin has two-step verification set up',
    'detail', COALESCE('Not set up: ' || offenders, ''));

  RETURN jsonb_build_object(
    'checks', checks,
    'advice', jsonb_build_object(
      'ownersWithoutTwoStep', (SELECT count(*) FROM public.cleo_memberships m
        WHERE m.revoked_at IS NULL AND m.role = 'owner'
          AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = m.user_id AND f.status::text = 'verified')),
      'owners', (SELECT count(*) FROM public.cleo_memberships m WHERE m.revoked_at IS NULL AND m.role = 'owner'),
      'staleUnconfirmed', (SELECT count(*) FROM auth.users u
        WHERE u.email_confirmed_at IS NULL AND u.created_at < now() - interval '7 days'),
      'suspended', (SELECT count(*) FROM public.cleo_account_suspensions s WHERE s.lifted_at IS NULL)),
    'admins', (SELECT COALESCE(jsonb_agg(jsonb_build_object('email', COALESCE(u.email, ''), 'role', a.role,
        'since', a.created_at,
        'twoStep', EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = a.user_id AND f.status::text = 'verified'))
        ORDER BY a.created_at, a.user_id), '[]'::jsonb)
      FROM public.cleo_platform_admins a LEFT JOIN auth.users u ON u.id = a.user_id
      WHERE a.revoked_at IS NULL),
    'generatedAt', now());
END;
$function$;

-- Only signed-in callers reach the console's functions; each one then checks admin standing itself.
REVOKE ALL ON FUNCTION public.cleo_admin_context(), public.cleo_admin_session_start(), public.cleo_admin_overview(),
  public.cleo_admin_list_accounts(text, text, integer, integer),
  public.cleo_admin_list_businesses(text, integer, integer), public.cleo_admin_business(uuid),
  public.cleo_admin_set_suspension(uuid, boolean, text),
  public.cleo_admin_set_membership(uuid, uuid, boolean, text),
  public.cleo_admin_audit_log(integer, integer), public.cleo_admin_security_report()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_admin_context(), public.cleo_admin_session_start(), public.cleo_admin_overview(),
  public.cleo_admin_list_accounts(text, text, integer, integer),
  public.cleo_admin_list_businesses(text, integer, integer), public.cleo_admin_business(uuid),
  public.cleo_admin_set_suspension(uuid, boolean, text),
  public.cleo_admin_set_membership(uuid, uuid, boolean, text),
  public.cleo_admin_audit_log(integer, integer), public.cleo_admin_security_report()
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
