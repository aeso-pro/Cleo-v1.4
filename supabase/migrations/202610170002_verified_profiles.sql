-- Verified email/OAuth accounts receive a Cleo profile automatically.
-- No role, membership, business or legal acceptance is inferred from metadata.
-- Apply AFTER 202610170001. Existing Auth triggers and unrelated profiles remain intact.
BEGIN;

CREATE FUNCTION public.cleo_register_verified_profile()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND NULLIF(btrim(NEW.email), '') IS NOT NULL THEN
    INSERT INTO public.cleo_profiles(user_id, display_name)
    VALUES (NEW.id, left(COALESCE(NULLIF(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
      NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''), split_part(NEW.email, '@', 1)), 120))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.cleo_register_verified_profile() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER cleo_register_verified_profile
  AFTER INSERT OR UPDATE OF email_confirmed_at, email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.cleo_register_verified_profile();

-- Backfill existing confirmed accounts without changing their names or memberships.
INSERT INTO public.cleo_profiles(user_id, display_name)
SELECT u.id, left(COALESCE(NULLIF(btrim(u.raw_user_meta_data ->> 'name'), ''),
  NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1)), 120)
FROM auth.users u WHERE u.email_confirmed_at IS NOT NULL AND NULLIF(btrim(u.email), '') IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

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

CREATE OR REPLACE FUNCTION public.cleo_accept_legal(p_version text, p_method text DEFAULT 'email')
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
  -- A JWT subject without a confirmed email must not record legal acceptance.
  PERFORM public.cleo_auth_context();
  INSERT INTO public.cleo_legal_acceptances(user_id, version, method) VALUES (actor, p_version, p_method)
    ON CONFLICT (user_id, version) DO NOTHING;
  SELECT a.accepted_at INTO accepted FROM public.cleo_legal_acceptances a
    WHERE a.user_id = actor AND a.version = p_version;
  RETURN jsonb_build_object('ok', true, 'version', p_version, 'at', accepted);
END;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
