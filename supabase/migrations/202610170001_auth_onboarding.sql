-- CleoPOS 1.2: authenticated account context and atomic business onboarding.
-- Apply once as the database owner through Supabase migrations or SQL Editor.
-- Deliberately does not change auth.users, existing app tables, auth triggers,
-- provider credentials, billing, product catalogs, or financial records.
BEGIN;

-- Fail closed on an existing integration rather than replacing unknown objects.
DO $guard$
DECLARE
  conflicts text;
BEGIN
  SELECT string_agg(n.nspname || '.' || c.relname, ', ' ORDER BY c.relname)
    INTO conflicts
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = ANY (ARRAY['cleo_profiles', 'cleo_businesses', 'cleo_branches',
                               'cleo_memberships', 'cleo_legal_acceptances']);
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Cleo onboarding migration stopped: existing objects require review: %', conflicts;
  END IF;
  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY p.proname)
    INTO conflicts
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = ANY (ARRAY['cleo_session_is_strong', 'cleo_auth_context',
                               'cleo_create_business', 'cleo_accept_legal', 'cleo_bootstrap']);
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Cleo onboarding migration stopped: existing functions require review: %', conflicts;
  END IF;
END;
$guard$;

CREATE TABLE public.cleo_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cleo_businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  modules text[] NOT NULL CHECK (cardinality(modules) BETWEEN 1 AND 3
    AND modules <@ ARRAY['fnb', 'retail', 'svc']::text[]),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cleo_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.cleo_businesses(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 20),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (business_id, code)
);

CREATE TABLE public.cleo_memberships (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.cleo_businesses(id) ON DELETE CASCADE,
  branch_id uuid,
  role text NOT NULL CHECK (role IN ('owner', 'hq', 'manager', 'cashier', 'kitchen', 'clerk', 'accountant')),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, business_id),
  FOREIGN KEY (business_id, branch_id) REFERENCES public.cleo_branches(business_id, id),
  CHECK (branch_id IS NOT NULL OR role IN ('owner', 'hq'))
);
-- This version has one active business per account; context resolution is unambiguous.
CREATE UNIQUE INDEX cleo_memberships_one_active_business ON public.cleo_memberships(user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX cleo_memberships_business ON public.cleo_memberships(business_id);

CREATE TABLE public.cleo_legal_acceptances (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version text NOT NULL CHECK (version = 'privacy 1.0, terms 1.0'),
  method text NOT NULL CHECK (method IN ('email', 'google', 'facebook', 'oauth')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version)
);

COMMENT ON TABLE public.cleo_legal_acceptances IS
  'First server-recorded agreement per account and bundled legal version. Browser email/timestamps are never trusted.';
COMMENT ON TABLE public.cleo_memberships IS
  'Authoritative tenant roles. Browsers have no direct membership write privilege.';

ALTER TABLE public.cleo_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_legal_acceptances ENABLE ROW LEVEL SECURITY;

-- This helper discloses only whether the caller has satisfied their enrolled MFA.
-- The definer is needed to read auth.mfa_factors without exposing it to clients.
CREATE FUNCTION public.cleo_session_is_strong()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    COALESCE(auth.jwt() ->> 'aal', '') = 'aal2'
    OR NOT EXISTS (
      SELECT 1 FROM auth.mfa_factors f
       WHERE f.user_id = auth.uid() AND f.status::text = 'verified'
    )
  );
$function$;

CREATE POLICY cleo_profiles_read_self ON public.cleo_profiles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.cleo_session_is_strong()));
CREATE POLICY cleo_memberships_read_self ON public.cleo_memberships
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND revoked_at IS NULL
    AND (SELECT public.cleo_session_is_strong()));
CREATE POLICY cleo_businesses_read_member ON public.cleo_businesses
  FOR SELECT TO authenticated
  USING ((SELECT public.cleo_session_is_strong()) AND EXISTS (
    SELECT 1 FROM public.cleo_memberships m
     WHERE m.business_id = cleo_businesses.id AND m.user_id = (SELECT auth.uid())
       AND m.revoked_at IS NULL
  ));
CREATE POLICY cleo_branches_read_member ON public.cleo_branches
  FOR SELECT TO authenticated
  USING ((SELECT public.cleo_session_is_strong()) AND EXISTS (
    SELECT 1 FROM public.cleo_memberships m
     WHERE m.business_id = cleo_branches.business_id AND m.user_id = (SELECT auth.uid())
       AND m.revoked_at IS NULL AND (m.branch_id IS NULL OR m.branch_id = cleo_branches.id)
  ));
CREATE POLICY cleo_legal_read_self ON public.cleo_legal_acceptances
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.cleo_session_is_strong()));

-- Profile creation is lazy, after authentication. OAuth registration therefore
-- cannot fail because an application trigger on auth.users is broken or absent.
CREATE FUNCTION public.cleo_auth_context()
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
  SELECT u.email, left(btrim(COALESCE(NULLIF(u.raw_user_meta_data ->> 'name', ''),
    NULLIF(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1), '')), 120)
    INTO actor_email, actor_name FROM auth.users u
    WHERE u.id = actor AND u.email_confirmed_at IS NOT NULL;
  IF NOT FOUND OR actor_email IS NULL THEN
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

CREATE FUNCTION public.cleo_create_business(
  p_business jsonb, p_modules jsonb DEFAULT '[]'::jsonb, p_owner jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  context jsonb;
  business_name text;
  owner_name text;
  modules text[];
  new_business_id uuid;
BEGIN
  IF actor IS NULL OR NOT public.cleo_session_is_strong() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in and complete two-step verification to continue.';
  END IF;
  context := public.cleo_auth_context();
  -- The profile row serializes duplicate submissions from the same account.
  PERFORM 1 FROM public.cleo_profiles p WHERE p.user_id = actor FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.cleo_memberships m WHERE m.user_id = actor AND m.revoked_at IS NULL) THEN
    RETURN public.cleo_auth_context();
  END IF;
  -- A revoked membership requires an administrator; re-onboarding cannot bypass it.
  IF EXISTS (SELECT 1 FROM public.cleo_memberships m WHERE m.user_id = actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This account needs its business access restored. Contact the business owner.';
  END IF;
  IF jsonb_typeof(p_business) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_owner) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_modules) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Check the business details and try again.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_business) AS keys(key) WHERE key <> 'name')
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_owner) AS keys(key) WHERE key <> 'name')
    OR jsonb_typeof(p_business -> 'name') IS DISTINCT FROM 'string'
    OR (p_owner ? 'name' AND jsonb_typeof(p_owner -> 'name') IS DISTINCT FROM 'string') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Check the business and owner names.';
  END IF;
  business_name := btrim(p_business ->> 'name');
  owner_name := btrim(COALESCE(NULLIF(p_owner ->> 'name', ''), context #>> '{profile,name}', ''));
  IF char_length(business_name) NOT BETWEEN 1 AND 120 OR char_length(owner_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Business and owner names must have 1 to 120 characters.';
  END IF;
  IF jsonb_array_length(p_modules) NOT BETWEEN 1 AND 3
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_modules) AS elems(value)
      WHERE jsonb_typeof(value) <> 'string' OR value #>> '{}' NOT IN ('fnb', 'retail', 'svc')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose food and drinks, retail goods, or services.';
  END IF;
  SELECT array_agg(DISTINCT value ORDER BY value) INTO modules FROM jsonb_array_elements_text(p_modules);
  IF cardinality(modules) <> jsonb_array_length(p_modules) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose each business type once.';
  END IF;
  UPDATE public.cleo_profiles SET display_name = owner_name, updated_at = now() WHERE user_id = actor;
  INSERT INTO public.cleo_businesses(name, modules, created_by) VALUES (business_name, modules, actor)
    RETURNING id INTO new_business_id;
  INSERT INTO public.cleo_branches(business_id, code, name) VALUES (new_business_id, 'MAIN', 'Main branch');
  INSERT INTO public.cleo_memberships(user_id, business_id, branch_id, role)
    VALUES (actor, new_business_id, NULL, 'owner');
  RETURN public.cleo_auth_context();
END;
$function$;

CREATE FUNCTION public.cleo_accept_legal(p_version text, p_method text DEFAULT 'email')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  accepted timestamptz;
BEGIN
  IF actor IS NULL OR NOT public.cleo_session_is_strong() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in and complete two-step verification to continue.';
  END IF;
  IF p_version IS DISTINCT FROM 'privacy 1.0, terms 1.0'
    OR p_method IS NULL OR p_method NOT IN ('email', 'google', 'facebook', 'oauth') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Reload Cleo to accept the current Terms and Privacy Policy.';
  END IF;
  INSERT INTO public.cleo_legal_acceptances(user_id, version, method) VALUES (actor, p_version, p_method)
    ON CONFLICT (user_id, version) DO NOTHING;
  SELECT a.accepted_at INTO accepted FROM public.cleo_legal_acceptances a
    WHERE a.user_id = actor AND a.version = p_version;
  RETURN jsonb_build_object('ok', true, 'version', p_version, 'at', accepted);
END;
$function$;

CREATE FUNCTION public.cleo_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  context jsonb;
  actor uuid := auth.uid();
  actor_business_id uuid;
  member_branch uuid;
  branch_rows jsonb;
  user_rows jsonb;
  modules jsonb;
  business_name text;
BEGIN
  IF actor IS NULL OR NOT public.cleo_session_is_strong() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in and complete two-step verification to continue.';
  END IF;
  context := public.cleo_auth_context();
  actor_business_id := (context #>> '{account,businessId}')::uuid;
  IF actor_business_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Finish setting up your business to continue.';
  END IF;
  IF context -> 'legal' = 'null'::jsonb OR context -> 'legal' IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Accept the current Terms and Privacy Policy to continue.';
  END IF;
  SELECT m.branch_id INTO member_branch FROM public.cleo_memberships m
    WHERE m.user_id = actor AND m.business_id = actor_business_id AND m.revoked_at IS NULL;
  business_name := context #>> '{business,name}';
  modules := context #> '{business,modules}';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', b.id, 'bcode', b.code, 'name', b.name,
    'short', b.name, 'area', '', 'city', b.city, 'addr', b.address, 'terminals', 1,
    'online', 0, 'manager', '') ORDER BY b.created_at, b.id), '[]'::jsonb)
    INTO branch_rows FROM public.cleo_branches b
    WHERE b.business_id = actor_business_id AND (member_branch IS NULL OR b.id = member_branch);
  user_rows := jsonb_build_array(jsonb_build_object('id', actor, 'name', context #>> '{account,name}',
    'email', context #>> '{account,email}', 'mobile', '',
    'initials', upper(left(context #>> '{account,name}', 1)), 'color', '#45454b',
    'role', context #>> '{account,role}',
    'roles', CASE WHEN member_branch IS NULL THEN jsonb_build_object('all', context ->> 'role')
      ELSE jsonb_build_object(member_branch::text, context ->> 'role') END,
    'status', 'Active', 'twoFactor', EXISTS (SELECT 1 FROM auth.mfa_factors f
      WHERE f.user_id = actor AND f.status::text = 'verified')));
  RETURN jsonb_build_object(
    'data', jsonb_build_object('biz', jsonb_build_object('name', business_name, 'legal', '',
      'style', '', 'tin', '', 'vat', ''), 'branches', branch_rows, 'cashiers', '[]'::jsonb,
      'people', jsonb_build_object('owner', CASE WHEN context ->> 'role' = 'owner'
        THEN context #>> '{account,name}' ELSE '' END),
      'categories', '[]'::jsonb, 'products', '[]'::jsonb, 'modifiers', '[]'::jsonb,
      'ingredients', '[]'::jsonb, 'peripherals', '[]'::jsonb),
    'config', jsonb_build_object('business', jsonb_build_object('name', business_name),
      'modules', jsonb_build_object('fnb', modules ? 'fnb', 'retail', modules ? 'retail', 'svc', modules ? 'svc'),
      'integrations', jsonb_build_object('grab', jsonb_build_object('on', false),
        'foodpanda', jsonb_build_object('on', false))),
    'collections', jsonb_build_object('users', user_rows, 'customers', '[]'::jsonb, 'promos', '[]'::jsonb,
      'expenses', '[]'::jsonb, 'terminals', '[]'::jsonb, 'ejournal', '[]'::jsonb,
      'approvals', '[]'::jsonb, 'tickets', '[]'::jsonb, 'attendance', '[]'::jsonb,
      'appointments', '[]'::jsonb, 'deliveries', '[]'::jsonb),
    'plan', NULL, 'subscription', NULL);
END;
$function$;

-- No anonymous reads; no browser may write rows directly or choose a role.
REVOKE ALL ON TABLE public.cleo_profiles, public.cleo_businesses, public.cleo_branches,
  public.cleo_memberships, public.cleo_legal_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cleo_profiles, public.cleo_businesses, public.cleo_branches,
  public.cleo_memberships, public.cleo_legal_acceptances TO authenticated;

REVOKE ALL ON FUNCTION public.cleo_session_is_strong(), public.cleo_auth_context(),
  public.cleo_create_business(jsonb, jsonb, jsonb), public.cleo_accept_legal(text, text),
  public.cleo_bootstrap() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_session_is_strong(), public.cleo_auth_context(),
  public.cleo_create_business(jsonb, jsonb, jsonb), public.cleo_accept_legal(text, text),
  public.cleo_bootstrap() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
