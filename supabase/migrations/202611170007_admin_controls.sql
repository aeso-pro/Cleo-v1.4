-- Cleo 007: admin controls, so the owner manages people, businesses, plans and admins from /admin
-- instead of editing code or the database. Apply AFTER 001 … 006, once, as the database owner.
--
-- Every function here starts with cleo_require_admin(): an active platform admin with a confirmed
-- email and a session that passed two-step verification (aal2). Anything that changes data needs a
-- superadmin and writes a line to cleo_admin_audit; a change to a business is also written to that
-- business's own audit trail, so its owner can see that Cleo support made it.
--
-- New in this migration: superadmins can add, change and remove other admins from the console.
-- Guards: nobody changes their own admin level, and at least one superadmin with two-step
-- verification set up always remains.
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.cleo_subscriptions') IS NULL OR to_regprocedure('public.cleo_require_admin(boolean)') IS NULL THEN
    RAISE EXCEPTION 'Cleo admin controls migration stopped: apply migrations 001 to 006 first.';
  END IF;
  IF to_regprocedure('public.cleo_admin_account(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Cleo admin controls migration stopped: it has already been applied.';
  END IF;
END;
$guard$;

-- Internal: a reason is required for every change, and kept.
CREATE FUNCTION public.cleo_admin_reason(p_reason text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF char_length(reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Give a short reason (3 to 500 characters). It is kept in the admin history.';
  END IF;
  RETURN reason;
END;
$function$;
REVOKE ALL ON FUNCTION public.cleo_admin_reason(text) FROM PUBLIC, anon, authenticated;

-- One account, everything an admin needs to help it. Never returns passwords, tokens or secrets.
CREATE FUNCTION public.cleo_admin_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  u record;
BEGIN
  PERFORM public.cleo_require_admin();
  SELECT x.id, x.email, x.email_confirmed_at, x.created_at, x.last_sign_in_at, x.banned_until,
      COALESCE(NULLIF(x.raw_app_meta_data ->> 'provider', ''), 'email') AS provider,
      COALESCE(x.raw_app_meta_data -> 'providers', '[]'::jsonb) AS providers
    INTO u FROM auth.users x WHERE x.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That account no longer exists.';
  END IF;
  RETURN jsonb_build_object(
    'id', u.id, 'email', COALESCE(u.email, ''),
    'name', COALESCE((SELECT p.display_name FROM public.cleo_profiles p WHERE p.user_id = u.id), ''),
    'provider', u.provider, 'providers', u.providers,
    'confirmed', u.email_confirmed_at IS NOT NULL, 'confirmedAt', u.email_confirmed_at,
    'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at,
    'banned', u.banned_until IS NOT NULL AND u.banned_until > now(),
    'twoStep', EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = u.id AND f.status::text = 'verified'),
    'adminRole', (SELECT a.role FROM public.cleo_platform_admins a WHERE a.user_id = u.id AND a.revoked_at IS NULL),
    'legal', (SELECT jsonb_build_object('version', l.version, 'at', l.accepted_at, 'method', l.method)
      FROM public.cleo_legal_acceptances l WHERE l.user_id = u.id ORDER BY l.accepted_at DESC LIMIT 1),
    'suspension', (SELECT jsonb_build_object('reason', s.reason, 'at', s.suspended_at)
      FROM public.cleo_account_suspensions s WHERE s.user_id = u.id AND s.lifted_at IS NULL),
    'suspensions', (SELECT COALESCE(jsonb_agg(jsonb_build_object('reason', s.reason, 'at', s.suspended_at, 'liftedAt', s.lifted_at)
      ORDER BY s.suspended_at DESC), '[]'::jsonb) FROM public.cleo_account_suspensions s WHERE s.user_id = u.id),
    'memberships', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'businessId', m.business_id, 'business', b.name, 'role', m.role, 'branchId', m.branch_id,
        'branch', COALESCE(br.name, ''), 'since', m.created_at, 'revoked', m.revoked_at IS NOT NULL, 'revokedAt', m.revoked_at)
        ORDER BY (m.revoked_at IS NULL) DESC, m.created_at DESC), '[]'::jsonb)
      FROM public.cleo_memberships m JOIN public.cleo_businesses b ON b.id = m.business_id
      LEFT JOIN public.cleo_branches br ON br.id = m.branch_id WHERE m.user_id = u.id),
    'activity', (SELECT COALESCE(jsonb_agg(x.item ORDER BY x.created_at DESC, x.id DESC), '[]'::jsonb) FROM (
      SELECT l.created_at, l.id, jsonb_build_object('at', l.created_at, 'action', l.action, 'entity', l.entity_id,
        'business', COALESCE(b.name, '')) AS item
      FROM public.cleo_audit_log l LEFT JOIN public.cleo_businesses b ON b.id = l.business_id
      WHERE l.actor_id = u.id ORDER BY l.created_at DESC, l.id DESC LIMIT 20) x));
END;
$function$;

-- Mark an email address as confirmed, for a person who can prove it is theirs but whose
-- confirmation email never arrived.
CREATE FUNCTION public.cleo_admin_confirm_email(p_user_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  reason text;
  target_email text;
BEGIN
  PERFORM public.cleo_require_admin(true);
  reason := public.cleo_admin_reason(p_reason);
  SELECT u.email INTO target_email FROM auth.users u WHERE u.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That account no longer exists.';
  END IF;
  IF NULLIF(btrim(target_email), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'This account has no email address to confirm.';
  END IF;
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = p_user_id AND email_confirmed_at IS NULL;
  IF FOUND THEN
    PERFORM public.cleo_admin_log('account.confirm_email', 'account', p_user_id::text,
      jsonb_build_object('email', target_email, 'reason', reason));
  END IF;
  RETURN jsonb_build_object('ok', true, 'changed', FOUND);
END;
$function$;

-- Correct the name a person is shown under.
CREATE FUNCTION public.cleo_admin_set_name(p_user_id uuid, p_name text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  reason text;
  new_name text := btrim(COALESCE(p_name, ''));
  before text;
BEGIN
  PERFORM public.cleo_require_admin(true);
  reason := public.cleo_admin_reason(p_reason);
  IF char_length(new_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A name has 1 to 120 characters.';
  END IF;
  SELECT p.display_name INTO before FROM public.cleo_profiles p WHERE p.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That account no longer exists.';
    END IF;
    INSERT INTO public.cleo_profiles(user_id, display_name) VALUES (p_user_id, new_name);
  ELSE
    UPDATE public.cleo_profiles SET display_name = new_name, updated_at = now() WHERE user_id = p_user_id;
  END IF;
  PERFORM public.cleo_admin_log('account.rename', 'account', p_user_id::text,
    jsonb_build_object('before', COALESCE(before, ''), 'after', new_name, 'reason', reason));
  RETURN jsonb_build_object('ok', true, 'name', new_name);
END;
$function$;

-- Change what a person may do in a business: their role and, for branch roles, their branch.
-- Also adds an account that has no business yet to one.
CREATE FUNCTION public.cleo_admin_set_member(p_user_id uuid, p_business_id uuid, p_role text, p_branch_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  reason text;
  member public.cleo_memberships%ROWTYPE;
  branch uuid := p_branch_id;
  business_name text;
  target_email text;
  added boolean := false;
BEGIN
  PERFORM public.cleo_require_admin(true);
  reason := public.cleo_admin_reason(p_reason);
  IF p_role IS NULL OR p_role NOT IN ('owner', 'hq', 'manager', 'cashier', 'kitchen', 'clerk', 'accountant') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose a role: owner, HQ, manager, cashier, kitchen, clerk or accountant.';
  END IF;
  SELECT b.name INTO business_name FROM public.cleo_businesses b WHERE b.id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That business no longer exists.';
  END IF;
  SELECT u.email INTO target_email FROM auth.users u WHERE u.id = p_user_id AND u.email_confirmed_at IS NOT NULL
    AND NULLIF(btrim(u.email), '') IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Only an account with a confirmed email can join a business.';
  END IF;
  -- Owner and HQ see every branch; every other role works in one.
  IF p_role IN ('owner', 'hq') THEN
    branch := NULL;
  ELSIF branch IS NULL THEN
    SELECT br.id INTO branch FROM public.cleo_branches br WHERE br.business_id = p_business_id ORDER BY br.created_at, br.id LIMIT 1;
  END IF;
  IF branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cleo_branches br WHERE br.id = branch AND br.business_id = p_business_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'That branch is not part of this business.';
  END IF;
  SELECT * INTO member FROM public.cleo_memberships m WHERE m.user_id = p_user_id AND m.business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.cleo_memberships m WHERE m.user_id = p_user_id AND m.revoked_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'This account already belongs to another business. Revoke that access first.';
    END IF;
    INSERT INTO public.cleo_memberships(user_id, business_id, branch_id, role) VALUES (p_user_id, p_business_id, branch, p_role);
    added := true;
  ELSE
    -- a business must keep someone who can manage it
    IF member.role = 'owner' AND p_role <> 'owner' AND member.revoked_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.cleo_memberships m WHERE m.business_id = p_business_id AND m.role = 'owner'
          AND m.revoked_at IS NULL AND m.user_id <> p_user_id) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'This is the business''s only owner. Make someone else owner first.';
    END IF;
    UPDATE public.cleo_memberships SET role = p_role, branch_id = branch WHERE user_id = p_user_id AND business_id = p_business_id;
  END IF;
  PERFORM public.cleo_admin_log(CASE WHEN added THEN 'membership.add' ELSE 'membership.role' END, 'membership', p_user_id::text,
    jsonb_build_object('email', target_email, 'business', business_name, 'businessId', p_business_id,
      'before', member.role, 'role', p_role, 'reason', reason));
  PERFORM public.cleo_write_audit(p_business_id, NULL, CASE WHEN added THEN 'admin.membership.add' ELSE 'admin.membership.role' END,
    p_user_id::text, CASE WHEN added THEN NULL ELSE jsonb_build_object('role', member.role) END,
    jsonb_build_object('role', p_role, 'by', 'Cleo support'));
  RETURN jsonb_build_object('ok', true, 'added', added, 'role', p_role, 'branchId', branch);
END;
$function$;

CREATE FUNCTION public.cleo_admin_rename_business(p_business_id uuid, p_name text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  reason text;
  new_name text := btrim(COALESCE(p_name, ''));
  before text;
BEGIN
  PERFORM public.cleo_require_admin(true);
  reason := public.cleo_admin_reason(p_reason);
  IF char_length(new_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A business name has 1 to 120 characters.';
  END IF;
  SELECT b.name INTO before FROM public.cleo_businesses b WHERE b.id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That business no longer exists.';
  END IF;
  UPDATE public.cleo_businesses SET name = new_name WHERE id = p_business_id;
  -- the business's own settings carry the name too (cleo_save_setting keeps them in step)
  UPDATE public.cleo_settings SET document = jsonb_set(document, '{business,name}', to_jsonb(new_name)), version = version + 1
    WHERE business_id = p_business_id AND document ? 'business';
  PERFORM public.cleo_admin_log('business.rename', 'business', p_business_id::text,
    jsonb_build_object('before', before, 'after', new_name, 'reason', reason));
  PERFORM public.cleo_write_audit(p_business_id, NULL, 'admin.business.rename', p_business_id::text,
    jsonb_build_object('name', before), jsonb_build_object('name', new_name, 'by', 'Cleo support'));
  RETURN jsonb_build_object('ok', true, 'name', new_name);
END;
$function$;

-- A business's plan, its payments, and what it can be changed to.
CREATE FUNCTION public.cleo_admin_business_billing(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.cleo_require_admin();
  IF NOT EXISTS (SELECT 1 FROM public.cleo_businesses b WHERE b.id = p_business_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That business no longer exists.';
  END IF;
  RETURN jsonb_build_object(
    'subscription', (SELECT jsonb_build_object('plan', s.plan, 'terminals', s.terminals, 'branches', s.branches, 'cycle', s.cycle,
        'total', s.total_centavos / 100.0, 'method', s.method, 'since', s.since, 'periodEnd', s.current_period_end,
        'active', s.current_period_end IS NULL OR s.current_period_end + interval '3 days' > now())
      FROM public.cleo_subscriptions s WHERE s.business_id = p_business_id),
    'payments', (SELECT COALESCE(jsonb_agg(x.item ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
      SELECT p.created_at, jsonb_build_object('reference', p.reference, 'plan', p.plan, 'terminals', p.terminals,
        'cycle', p.cycle, 'amount', p.amount_centavos / 100.0, 'method', p.method, 'status', p.status,
        'createdAt', p.created_at, 'paidAt', p.paid_at, 'live', p.livemode) AS item
      FROM public.cleo_payments p WHERE p.business_id = p_business_id ORDER BY p.created_at DESC LIMIT 30) x),
    'branches', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', br.id, 'name', br.name, 'code', br.code)
      ORDER BY br.created_at, br.id), '[]'::jsonb) FROM public.cleo_branches br WHERE br.business_id = p_business_id),
    'prices', (SELECT jsonb_object_agg(pp.plan, jsonb_build_object('monthly', pp.monthly, 'annual', pp.annual,
      'extraMonthly', pp.extra_monthly, 'extraAnnual', pp.extra_annual, 'maxTerminals', pp.max_terminals,
      'maxBranches', pp.max_branches)) FROM public.cleo_plan_prices pp));
END;
$function$;

-- Give, change, extend or end a business's plan without a payment: a trial, a correction, a
-- plan agreed with sales, or a refund made in the payment provider's dashboard.
-- p_plan 'none' ends the plan at once. p_until is the last day it runs (Manila time); NULL for Free.
CREATE FUNCTION public.cleo_admin_set_plan(p_business_id uuid, p_plan text, p_terminals integer, p_branches integer,
  p_cycle text, p_until date, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  reason text;
  before jsonb;
  ends timestamptz;
  total bigint := 0;
BEGIN
  PERFORM public.cleo_require_admin(true);
  reason := public.cleo_admin_reason(p_reason);
  PERFORM 1 FROM public.cleo_businesses b WHERE b.id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That business no longer exists.';
  END IF;
  SELECT to_jsonb(s) - 'business_id' INTO before FROM public.cleo_subscriptions s WHERE s.business_id = p_business_id FOR UPDATE;
  IF p_plan = 'none' THEN
    DELETE FROM public.cleo_subscriptions WHERE business_id = p_business_id;
  ELSE
    -- the same limits a paying owner meets; also refuses an unknown plan
    total := public.cleo_billing_price(p_plan, p_terminals, p_branches, COALESCE(p_cycle, 'monthly'));
    IF p_plan = 'free' THEN
      ends := NULL;
    ELSIF p_until IS NULL OR p_until < (now() AT TIME ZONE 'Asia/Manila')::date OR p_until > (now() AT TIME ZONE 'Asia/Manila')::date + 3660 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose the last day of the plan: today or later, within ten years.';
    ELSE
      -- the end of that day in Manila
      ends := ((p_until + 1)::timestamp AT TIME ZONE 'Asia/Manila');
    END IF;
    INSERT INTO public.cleo_subscriptions(business_id, plan, terminals, branches, cycle, total_centavos, method, current_period_end)
      VALUES (p_business_id, p_plan, p_terminals, p_branches, COALESCE(p_cycle, 'monthly'), total, '', ends)
      ON CONFLICT (business_id) DO UPDATE SET plan = EXCLUDED.plan, terminals = EXCLUDED.terminals, branches = EXCLUDED.branches,
        cycle = EXCLUDED.cycle, total_centavos = EXCLUDED.total_centavos, method = '', current_period_end = EXCLUDED.current_period_end,
        updated_at = now();
  END IF;
  PERFORM public.cleo_admin_log(CASE WHEN p_plan = 'none' THEN 'plan.end' ELSE 'plan.set' END, 'business', p_business_id::text,
    jsonb_build_object('plan', p_plan, 'terminals', p_terminals, 'branches', p_branches, 'cycle', p_cycle, 'until', p_until,
      'before', before ->> 'plan', 'reason', reason));
  PERFORM public.cleo_write_audit(p_business_id, NULL, CASE WHEN p_plan = 'none' THEN 'admin.plan.end' ELSE 'admin.plan.set' END,
    p_business_id::text, CASE WHEN before IS NULL THEN NULL ELSE jsonb_build_object('plan', before ->> 'plan') END,
    jsonb_build_object('plan', p_plan, 'until', p_until, 'by', 'Cleo support'));
  RETURN jsonb_build_object('ok', true, 'subscription', public.cleo_subscription_view(p_business_id));
END;
$function$;

-- Every payment, newest first, for the Payments section.
CREATE FUNCTION public.cleo_admin_payments(p_status text DEFAULT 'all', p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.cleo_require_admin();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000
     OR COALESCE(p_status, '') NOT IN ('all', 'pending', 'paid', 'failed', 'expired') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Check the filter and page options.';
  END IF;
  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM public.cleo_payments p WHERE p_status = 'all' OR p.status = p_status),
    'rows', (SELECT COALESCE(jsonb_agg(x.item ORDER BY x.created_at DESC, x.reference), '[]'::jsonb) FROM (
      SELECT p.created_at, p.reference, jsonb_build_object('reference', p.reference, 'businessId', p.business_id,
        'business', b.name, 'by', COALESCE(u.email, ''), 'plan', p.plan, 'terminals', p.terminals, 'branches', p.branches,
        'cycle', p.cycle, 'amount', p.amount_centavos / 100.0, 'method', p.method, 'status', p.status, 'live', p.livemode,
        'createdAt', p.created_at, 'paidAt', p.paid_at, 'periodEnd', p.period_end) AS item
      FROM public.cleo_payments p JOIN public.cleo_businesses b ON b.id = p.business_id
      LEFT JOIN auth.users u ON u.id = p.created_by
      WHERE p_status = 'all' OR p.status = p_status
      ORDER BY p.created_at DESC, p.reference LIMIT p_limit OFFSET p_offset) x),
    'summary', jsonb_build_object(
      'paidThisMonth', (SELECT COALESCE(sum(p.amount_centavos), 0) / 100.0 FROM public.cleo_payments p WHERE p.status = 'paid'
        AND p.livemode IS TRUE AND p.paid_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila'),
      'paidTotal', (SELECT COALESCE(sum(p.amount_centavos), 0) / 100.0 FROM public.cleo_payments p WHERE p.status = 'paid' AND p.livemode IS TRUE),
      'testPaid', (SELECT count(*) FROM public.cleo_payments p WHERE p.status = 'paid' AND p.livemode IS NOT TRUE),
      'activePlans', (SELECT jsonb_object_agg(x.plan, x.n) FROM (SELECT s.plan, count(*) AS n FROM public.cleo_subscriptions s
        WHERE s.current_period_end IS NULL OR s.current_period_end + interval '3 days' > now() GROUP BY s.plan) x),
      'endingSoon', (SELECT count(*) FROM public.cleo_subscriptions s WHERE s.current_period_end BETWEEN now() AND now() + interval '7 days')),
    'limit', p_limit, 'offset', p_offset);
END;
$function$;

-- Who can open the console. Superadmins only, because it names every admin.
CREATE FUNCTION public.cleo_admin_admins()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.cleo_require_admin(true);
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('userId', a.user_id, 'email', COALESCE(u.email, ''),
      'name', COALESCE(p.display_name, ''), 'role', a.role, 'note', a.note, 'since', a.created_at,
      'revoked', a.revoked_at IS NOT NULL, 'revokedAt', a.revoked_at, 'lastSignInAt', u.last_sign_in_at,
      'twoStep', EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = a.user_id AND f.status::text = 'verified'),
      'you', a.user_id = auth.uid())
    ORDER BY (a.revoked_at IS NULL) DESC, a.created_at, u.email), '[]'::jsonb)
    FROM public.cleo_platform_admins a LEFT JOIN auth.users u ON u.id = a.user_id
    LEFT JOIN public.cleo_profiles p ON p.user_id = a.user_id);
END;
$function$;

-- Add an admin by email, change their level, or remove them (p_role 'none').
CREATE FUNCTION public.cleo_admin_set_admin(p_email text, p_role text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  reason text;
  target uuid;
  target_email text;
  existing_role text;
BEGIN
  PERFORM public.cleo_require_admin(true);
  reason := public.cleo_admin_reason(p_reason);
  IF p_role IS NULL OR p_role NOT IN ('superadmin', 'support', 'none') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose superadmin, support, or remove.';
  END IF;
  SELECT u.id, u.email INTO target, target_email FROM auth.users u
    WHERE lower(u.email) = lower(btrim(COALESCE(p_email, ''))) AND u.email_confirmed_at IS NOT NULL;
  IF target IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'No confirmed Cleo account has that email. The person signs up first.';
  END IF;
  IF target = auth.uid() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'You cannot change your own admin access. Ask another superadmin.';
  END IF;
  IF public.cleo_account_blocked(target) AND p_role <> 'none' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Restore this account before making it an admin.';
  END IF;
  -- serialise admin changes, so two superadmins cannot remove each other at the same moment
  PERFORM pg_advisory_xact_lock(hashtext('cleo_platform_admins'));
  SELECT a.role INTO existing_role FROM public.cleo_platform_admins a WHERE a.user_id = target AND a.revoked_at IS NULL;
  IF existing_role = 'superadmin' AND p_role <> 'superadmin' AND NOT EXISTS (
      SELECT 1 FROM public.cleo_platform_admins a WHERE a.role = 'superadmin' AND a.revoked_at IS NULL AND a.user_id <> target
        AND EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = a.user_id AND f.status::text = 'verified')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Cleo must keep at least one superadmin with two-step verification.';
  END IF;
  IF p_role = 'none' THEN
    UPDATE public.cleo_platform_admins SET revoked_at = now() WHERE user_id = target AND revoked_at IS NULL;
  ELSE
    INSERT INTO public.cleo_platform_admins(user_id, role, note) VALUES (target, p_role, left(reason, 200))
      ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, note = EXCLUDED.note, revoked_at = NULL;
  END IF;
  PERFORM public.cleo_admin_log(CASE WHEN p_role = 'none' THEN 'admin.remove' WHEN existing_role IS NULL THEN 'admin.add' ELSE 'admin.change' END,
    'account', target::text, jsonb_build_object('email', target_email, 'before', existing_role, 'role', p_role, 'reason', reason));
  RETURN jsonb_build_object('ok', true, 'email', target_email, 'role', p_role, 'before', existing_role);
END;
$function$;

-- The overview gains the money side.
CREATE FUNCTION public.cleo_admin_billing_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.cleo_require_admin();
  RETURN jsonb_build_object(
    'activePaid', (SELECT count(*) FROM public.cleo_subscriptions s WHERE s.plan <> 'free' AND s.current_period_end + interval '3 days' > now()),
    'activeFree', (SELECT count(*) FROM public.cleo_subscriptions s WHERE s.plan = 'free'),
    'noPlan', (SELECT count(*) FROM public.cleo_businesses b WHERE public.cleo_subscription_view(b.id) IS NULL),
    'endingSoon', (SELECT count(*) FROM public.cleo_subscriptions s WHERE s.current_period_end BETWEEN now() AND now() + interval '7 days'),
    'paidThisMonth', (SELECT COALESCE(sum(p.amount_centavos), 0) / 100.0 FROM public.cleo_payments p WHERE p.status = 'paid'
      AND p.livemode IS TRUE AND p.paid_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila'),
    'pendingPayments', (SELECT count(*) FROM public.cleo_payments p WHERE p.status = 'pending' AND p.created_at > now() - interval '1 day'));
END;
$function$;

-- The business list also says which plan each business is on.
CREATE FUNCTION public.cleo_admin_business_plans()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.cleo_require_admin();
  RETURN (SELECT COALESCE(jsonb_object_agg(s.business_id::text, jsonb_build_object('plan', s.plan, 'periodEnd', s.current_period_end,
      'active', s.current_period_end IS NULL OR s.current_period_end + interval '3 days' > now())), '{}'::jsonb)
    FROM public.cleo_subscriptions s);
END;
$function$;

REVOKE ALL ON FUNCTION public.cleo_admin_account(uuid), public.cleo_admin_confirm_email(uuid, text),
  public.cleo_admin_set_name(uuid, text, text), public.cleo_admin_set_member(uuid, uuid, text, uuid, text),
  public.cleo_admin_rename_business(uuid, text, text), public.cleo_admin_business_billing(uuid),
  public.cleo_admin_set_plan(uuid, text, integer, integer, text, date, text), public.cleo_admin_payments(text, integer, integer),
  public.cleo_admin_admins(), public.cleo_admin_set_admin(text, text, text), public.cleo_admin_billing_overview(),
  public.cleo_admin_business_plans()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_admin_account(uuid), public.cleo_admin_confirm_email(uuid, text),
  public.cleo_admin_set_name(uuid, text, text), public.cleo_admin_set_member(uuid, uuid, text, uuid, text),
  public.cleo_admin_rename_business(uuid, text, text), public.cleo_admin_business_billing(uuid),
  public.cleo_admin_set_plan(uuid, text, integer, integer, text, date, text), public.cleo_admin_payments(text, integer, integer),
  public.cleo_admin_admins(), public.cleo_admin_set_admin(text, text, text), public.cleo_admin_billing_overview(),
  public.cleo_admin_business_plans()
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
