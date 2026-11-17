-- Plans enforced on the server, branches the owner adds, staff who sign in to a Terminal with a PIN,
-- registered terminals and uploaded sales. Apply after 001 to 007.
--
-- Every business now needs a plan (Free is one) before it can change anything, and each plan
-- opens only what content/plans.md and Cleo.licensing (index.html, licensing.js) say it does:
--   Free   one branch, one terminal, one cashier, up to 100 products; no stock, customers or transfers
--   Basic  stock tracking and receiving; any number of products and cashiers; terminals as paid for
--   Pro    stock adjustments and counts, customer profiles
--   Max    stock transfers, and as many branches as the subscription pays for
-- A business with no plan, or whose paid period ended more than 3 days ago, can still read its data.
--
-- Data stays per business: every new table carries business_id, browsers have no direct grants on it,
-- and every function resolves the business from the caller's own membership, never from its input.
BEGIN;

DO $guard$
DECLARE conflicts text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO conflicts FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('cleo_features', 'cleo_entitlement', 'cleo_require_feature', 'cleo_add_branch',
     'cleo_add_staff', 'cleo_set_staff_pin', 'cleo_remove_staff', 'cleo_check_pin', 'cleo_clock', 'cleo_register_terminal',
     'cleo_unregister_terminal', 'cleo_upload_sale', 'cleo_billing_bootstrap');
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Cleo migration 008 stopped: these functions already exist and need review: %', conflicts;
  END IF;
END;
$guard$;

/* ---------- 1. plans and features ---------- */

-- The feature matrix, the same rows as Cleo.licensing (licensing.js): the first tier that includes each.
-- Tiers: 0 Free, 1 Basic, 2 Pro, 3 Max. Enterprise is sold by quotation and set by Aeso.
CREATE FUNCTION public.cleo_features()
RETURNS TABLE (feature text, tier integer, label text)
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = ''
AS $$
  VALUES ('checkout', 0, 'Sales and checkout'), ('catalog', 0, 'Products and categories'), ('discounts', 0, 'Discounts and tax'),
    ('refunds', 0, 'Refunds and voids'), ('receipts', 0, 'Receipts'), ('shifts', 0, 'Cashiers and shifts'),
    ('salesReports', 0, 'Sales reports'), ('export', 0, 'Data export'), ('updates', 0, 'Software updates'),
    ('offline', 1, 'Offline sales with sync'), ('stock', 1, 'Stock tracking'), ('lowStock', 1, 'Low-stock notifications'),
    ('productReports', 1, 'Product sales reports'), ('permissions', 1, 'User roles and permissions'), ('backup', 1, 'Automated backup'),
    ('support', 1, 'Remote support'),
    ('adjustments', 2, 'Stock adjustments and counts'), ('suppliers', 2, 'Suppliers'), ('purchaseOrders', 2, 'Purchase orders'),
    ('profit', 2, 'Profit and margin reports'), ('analytics', 2, 'Advanced analytics'), ('customers', 2, 'Customer profiles'),
    ('loyalty', 2, 'Loyalty and rewards'), ('promotions', 2, 'Promotions and coupons'), ('audit', 2, 'Audit logs'),
    ('terminalSync', 2, 'Multi-terminal sync'), ('prioritySupport', 2, 'Priority support'),
    ('transfers', 3, 'Stock transfers between branches'), ('expiry', 3, 'Batch and expiry tracking'), ('forecasting', 3, 'Sales forecasting'),
    ('consolidation', 3, 'Consolidated branch reports'), ('segmentation', 3, 'Customer segmentation'),
    ('multiBranch', 3, 'Multi-branch management'), ('centralCatalog', 3, 'Central product and pricing controls'),
    ('integrations', 3, 'API and third-party integrations'), ('onboarding', 3, 'Onboarding assistance')
$$;
REVOKE ALL ON FUNCTION public.cleo_features() FROM PUBLIC, anon, authenticated;

-- What a business may do now: its plan and limits, or NULL when it has no plan in force.
-- The same 3-day grace as cleo_subscription_view (migration 006).
CREATE FUNCTION public.cleo_entitlement(p_business uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object('plan', s.plan,
      'tier', CASE s.plan WHEN 'free' THEN 0 WHEN 'basic' THEN 1 WHEN 'pro' THEN 2 WHEN 'max' THEN 3 END,
      'terminals', s.terminals,
      'branches', CASE WHEN s.plan = 'max' THEN s.branches ELSE 1 END,
      'products', CASE WHEN s.plan = 'free' THEN 100 END,
      'staff', CASE WHEN s.plan = 'free' THEN 1 END)
    FROM public.cleo_subscriptions s
   WHERE s.business_id = p_business
     AND (s.current_period_end IS NULL OR s.current_period_end + interval '3 days' > now());
$$;
REVOKE ALL ON FUNCTION public.cleo_entitlement(uuid) FROM PUBLIC, anon, authenticated;

-- Internal: stop unless the business's plan includes a feature. Returns the entitlement.
CREATE FUNCTION public.cleo_require_feature(p_business uuid, p_feature text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  granted jsonb := public.cleo_entitlement(p_business);
  needed integer;
  feature_label text;
BEGIN
  SELECT f.tier, f.label INTO needed, feature_label FROM public.cleo_features() f WHERE f.feature = p_feature;
  IF needed IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unknown plan feature.';
  END IF;
  IF granted IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Choose a plan for your business first, in Settings › Plan and billing. Free is one of them.';
  END IF;
  IF (granted ->> 'tier')::integer < needed THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = format('%s %s on the %s plan and up. Upgrade in Settings › Plan and billing.',
      feature_label, CASE WHEN right(feature_label, 1) = 's' THEN 'are' ELSE 'is' END,
      (ARRAY['Free', 'Basic', 'Pro', 'Max'])[needed + 1]);
  END IF;
  RETURN granted;
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_require_feature(uuid, text) FROM PUBLIC, anon, authenticated;

-- Plan checks on the tables the existing functions write. They apply to requests made by a signed-in
-- account (every browser call); Aeso's own maintenance, which runs without one, is not stopped by them.
CREATE FUNCTION public.cleo_plan_guard_records()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE granted jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  granted := public.cleo_require_feature(NEW.business_id,
    CASE NEW.kind WHEN 'customers' THEN 'customers' WHEN 'ingredients' THEN 'stock' ELSE 'catalog' END);
  -- a new product (not a change to one: INSERT ... ON CONFLICT runs this first) counts against Free's 100
  IF TG_OP = 'INSERT' AND NEW.kind = 'products' AND granted ->> 'products' IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.cleo_records r WHERE r.business_id = NEW.business_id AND r.kind = 'products' AND r.id = NEW.id)
     AND (SELECT count(*) FROM public.cleo_records r WHERE r.business_id = NEW.business_id AND r.kind = 'products' AND NOT r.archived)
         >= (granted ->> 'products')::integer THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = format(
      'The Free plan holds up to %s products. Archive one, or upgrade to Basic for any number.', granted ->> 'products');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_plan_guard_records() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER cleo_plan_guard BEFORE INSERT OR UPDATE ON public.cleo_records
  FOR EACH ROW EXECUTE FUNCTION public.cleo_plan_guard_records();

CREATE FUNCTION public.cleo_plan_guard_stock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  -- receiving is stock tracking (Basic); adjusting and counting are Pro. Transfers check their own plan.
  PERFORM public.cleo_require_feature(NEW.business_id, CASE WHEN NEW.kind = 'receive' THEN 'stock' ELSE 'adjustments' END);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_plan_guard_stock() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER cleo_plan_guard BEFORE INSERT ON public.cleo_stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.cleo_plan_guard_stock();

CREATE FUNCTION public.cleo_plan_guard_transfers()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  PERFORM public.cleo_require_feature(NEW.business_id, 'transfers');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_plan_guard_transfers() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER cleo_plan_guard BEFORE INSERT ON public.cleo_transfers
  FOR EACH ROW EXECUTE FUNCTION public.cleo_plan_guard_transfers();

/* ---------- 2. branches ---------- */

-- The owner (or head office) adds a branch. Free, Basic and Pro are for one branch; Max covers as many
-- as its subscription pays for (Settings › Plan and billing adds more).
CREATE FUNCTION public.cleo_add_branch(p_name text, p_city text DEFAULT '', p_address text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  m public.cleo_memberships%ROWTYPE;
  granted jsonb;
  existing integer;
  new_name text := btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g'));
  new_city text := btrim(COALESCE(p_city, ''));
  new_address text := btrim(COALESCE(p_address, ''));
  new_code text;
  added public.cleo_branches%ROWTYPE;
  step integer := 0;
BEGIN
  m := public.cleo_require_actor(ARRAY['owner', 'hq']);
  PERFORM 1 FROM public.cleo_businesses WHERE id = m.business_id FOR UPDATE;
  granted := public.cleo_require_feature(m.business_id, 'catalog');
  IF char_length(new_name) NOT BETWEEN 1 AND 120 OR char_length(new_city) > 120 OR char_length(new_address) > 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Give the branch a name of up to 120 characters.';
  END IF;
  SELECT count(*) INTO existing FROM public.cleo_branches WHERE business_id = m.business_id;
  IF existing >= (granted ->> 'branches')::integer THEN
    IF granted ->> 'plan' = 'max' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = format(
        'Your Max subscription covers %s branch%s. Add a branch to it in Settings › Plan and billing first.',
        granted ->> 'branches', CASE WHEN (granted ->> 'branches')::integer = 1 THEN '' ELSE 'es' END);
    END IF;
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = format(
      'The %s plan is for one branch. Upgrade to Max in Settings › Plan and billing to add more.', initcap(granted ->> 'plan'));
  END IF;
  IF EXISTS (SELECT 1 FROM public.cleo_branches WHERE business_id = m.business_id AND lower(name) = lower(new_name)) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'You already have a branch with that name.';
  END IF;
  LOOP
    step := step + 1;
    new_code := 'B' || (existing + step);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.cleo_branches WHERE business_id = m.business_id AND code = new_code);
  END LOOP;
  INSERT INTO public.cleo_branches(business_id, code, name, address, city)
    VALUES (m.business_id, new_code, new_name, new_address, new_city) RETURNING * INTO added;
  PERFORM public.cleo_write_audit(m.business_id, added.id, 'branches.add', added.id::text, NULL,
    jsonb_build_object('name', added.name, 'code', added.code, 'city', added.city));
  RETURN jsonb_build_object('id', added.id, 'bcode', added.code, 'name', added.name, 'short', added.name, 'area', '',
    'city', added.city, 'addr', added.address, 'terminals', 0, 'online', 0, 'manager', '');
END;
$$;

/* ---------- 3. staff who sign in to a Terminal with a PIN ---------- */

-- Floor staff are not web accounts: the Terminal is signed in to the business's account, and each
-- cashier unlocks it with a 4-digit PIN. The PIN is kept only as a salted SHA-256; no browser role can
-- read this table, and three wrong PINs lock that person out for five minutes.
CREATE TABLE public.cleo_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.cleo_businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  role text NOT NULL CHECK (role IN ('cashier', 'kitchen', 'manager')),
  color text NOT NULL DEFAULT '#45454b' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  pin_salt text NOT NULL,
  pin_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  pin_changed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, branch_id) REFERENCES public.cleo_branches(business_id, id)
);
CREATE INDEX cleo_staff_branch ON public.cleo_staff(business_id, branch_id) WHERE removed_at IS NULL;

CREATE TABLE public.cleo_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('in', 'out')),
  at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  FOREIGN KEY (business_id, branch_id) REFERENCES public.cleo_branches(business_id, id),
  FOREIGN KEY (business_id, staff_id) REFERENCES public.cleo_staff(business_id, id) ON DELETE CASCADE
);
CREATE INDEX cleo_attendance_recent ON public.cleo_attendance(business_id, branch_id, at DESC);

CREATE FUNCTION public.cleo_pin_hash(p_salt text, p_pin text)
RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT encode(sha256(convert_to(p_salt || ':' || p_pin, 'UTF8')), 'hex') $$;
REVOKE ALL ON FUNCTION public.cleo_pin_hash(text, text) FROM PUBLIC, anon, authenticated;

-- One staff member as the app's records read them (Cleo.db 'users'; the Terminal's PIN screen).
CREATE FUNCTION public.cleo_staff_view(s public.cleo_staff)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object('id', 'u-' || s.id, 'staffId', s.id, 'name', s.name,
    'initials', (SELECT upper(string_agg(left(w, 1), '')) FROM (SELECT w FROM regexp_split_to_table(btrim(s.name), '\s+') w LIMIT 2) x),
    'color', s.color, 'email', '', 'mobile', '',
    'role', CASE s.role WHEN 'cashier' THEN 'Cashier' WHEN 'kitchen' THEN 'Server' ELSE 'Branch Manager' END,
    'roles', jsonb_build_object(s.branch_id::text, s.role), 'branch', s.branch_id, 'status', 'active', 'pin', true,
    'twoFactor', false, 'staff', true, 'pinChangedAt', floor(extract(epoch FROM s.pin_changed_at) * 1000));
$$;
REVOKE ALL ON FUNCTION public.cleo_staff_view(public.cleo_staff) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.cleo_valid_pin(p_pin text)
RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' OR p_pin = '0000' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Use a 4-digit PIN, but not 0000.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_valid_pin(text) FROM PUBLIC, anon, authenticated;

-- The staff member, if the caller may manage them: owners and head office anywhere, a manager in their branch.
CREATE FUNCTION public.cleo_managed_staff(p_staff uuid)
RETURNS public.cleo_staff
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m public.cleo_memberships%ROWTYPE; s public.cleo_staff%ROWTYPE;
BEGIN
  m := public.cleo_require_actor(ARRAY['owner', 'hq', 'manager']);
  SELECT * INTO s FROM public.cleo_staff WHERE id = p_staff AND business_id = m.business_id AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND OR (m.branch_id IS NOT NULL AND m.branch_id <> s.branch_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That staff member isn’t on this branch anymore.';
  END IF;
  RETURN s;
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_managed_staff(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.cleo_add_staff(p_branch uuid, p_name text, p_role text, p_pin text, p_color text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  m public.cleo_memberships%ROWTYPE;
  granted jsonb;
  staff_count integer;
  new_name text := btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g'));
  salt text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  added public.cleo_staff%ROWTYPE;
BEGIN
  m := public.cleo_require_actor(ARRAY['owner', 'hq', 'manager'], p_branch);
  PERFORM 1 FROM public.cleo_businesses WHERE id = m.business_id FOR UPDATE;
  granted := public.cleo_require_feature(m.business_id, 'shifts');
  IF char_length(new_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Enter their name, up to 80 characters.';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('cashier', 'kitchen', 'manager') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose cashier, server or branch manager.';
  END IF;
  IF m.role = 'manager' AND p_role = 'manager' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only the owner adds branch managers.';
  END IF;
  PERFORM public.cleo_valid_pin(p_pin);
  IF p_color IS NOT NULL AND p_color !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid colour.';
  END IF;
  SELECT count(*) INTO staff_count FROM public.cleo_staff WHERE business_id = m.business_id AND removed_at IS NULL;
  IF granted ->> 'staff' IS NOT NULL AND staff_count >= (granted ->> 'staff')::integer THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'The Free plan is for one cashier. Upgrade to Basic in Settings › Plan and billing for any number of staff.';
  END IF;
  IF staff_count >= 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A business can have up to 500 staff with PINs.';
  END IF;
  INSERT INTO public.cleo_staff(business_id, branch_id, name, role, color, pin_salt, pin_hash, created_by)
    VALUES (m.business_id, p_branch, new_name, p_role, COALESCE(p_color, '#45454b'), salt, public.cleo_pin_hash(salt, p_pin), auth.uid())
    RETURNING * INTO added;
  PERFORM public.cleo_write_audit(m.business_id, p_branch, 'staff.add', added.id::text, NULL,
    jsonb_build_object('name', added.name, 'role', added.role));
  RETURN public.cleo_staff_view(added);
END;
$$;

CREATE FUNCTION public.cleo_set_staff_pin(p_staff uuid, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.cleo_staff%ROWTYPE; salt text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
BEGIN
  s := public.cleo_managed_staff(p_staff);
  PERFORM public.cleo_valid_pin(p_pin);
  UPDATE public.cleo_staff SET pin_salt = salt, pin_hash = public.cleo_pin_hash(salt, p_pin), failed_attempts = 0,
    locked_until = NULL, pin_changed_at = now() WHERE id = s.id RETURNING * INTO s;
  PERFORM public.cleo_write_audit(s.business_id, s.branch_id, 'staff.pin', s.id::text, NULL, NULL);
  RETURN public.cleo_staff_view(s);
END;
$$;

CREATE FUNCTION public.cleo_remove_staff(p_staff uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE s public.cleo_staff%ROWTYPE;
BEGIN
  s := public.cleo_managed_staff(p_staff);
  UPDATE public.cleo_staff SET removed_at = now() WHERE id = s.id;
  PERFORM public.cleo_write_audit(s.business_id, s.branch_id, 'staff.remove', s.id::text, jsonb_build_object('name', s.name, 'role', s.role), NULL);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Check a PIN on a Terminal signed in to the business. Answers instead of raising, so a wrong PIN is
-- counted even though the call "fails": { ok, staff } or { ok: false, code: wrong_pin | locked, left, until }.
CREATE FUNCTION public.cleo_check_pin(p_staff uuid, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m public.cleo_memberships%ROWTYPE; s public.cleo_staff%ROWTYPE; tries integer;
BEGIN
  m := public.cleo_require_actor(ARRAY['owner', 'hq', 'manager', 'cashier', 'kitchen']);
  SELECT * INTO s FROM public.cleo_staff WHERE id = p_staff AND business_id = m.business_id AND removed_at IS NULL FOR UPDATE;
  IF NOT FOUND OR (m.branch_id IS NOT NULL AND m.branch_id <> s.branch_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That staff member isn’t on this branch anymore.');
  END IF;
  IF s.locked_until IS NOT NULL AND s.locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'locked', 'left', 0, 'until', floor(extract(epoch FROM s.locked_until) * 1000));
  END IF;
  IF p_pin IS NOT NULL AND p_pin ~ '^[0-9]{4}$' AND public.cleo_pin_hash(s.pin_salt, p_pin) = s.pin_hash THEN
    UPDATE public.cleo_staff SET failed_attempts = 0, locked_until = NULL WHERE id = s.id;
    RETURN jsonb_build_object('ok', true, 'staff', jsonb_build_object('id', s.id, 'name', s.name, 'role', s.role, 'branch', s.branch_id));
  END IF;
  tries := s.failed_attempts + 1;
  IF tries >= 3 THEN
    UPDATE public.cleo_staff SET failed_attempts = 0, locked_until = now() + interval '5 minutes' WHERE id = s.id RETURNING * INTO s;
    PERFORM public.cleo_write_audit(s.business_id, s.branch_id, 'staff.locked', s.id::text, NULL, NULL);
    RETURN jsonb_build_object('ok', false, 'code', 'locked', 'left', 0, 'until', floor(extract(epoch FROM s.locked_until) * 1000));
  END IF;
  UPDATE public.cleo_staff SET failed_attempts = tries WHERE id = s.id;
  RETURN jsonb_build_object('ok', false, 'code', 'wrong_pin', 'left', 3 - tries);
END;
$$;

CREATE FUNCTION public.cleo_clock(p_staff uuid, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m public.cleo_memberships%ROWTYPE; s public.cleo_staff%ROWTYPE; entry public.cleo_attendance%ROWTYPE;
BEGIN
  m := public.cleo_require_actor(ARRAY['owner', 'hq', 'manager', 'cashier', 'kitchen']);
  IF p_kind IS NULL OR p_kind NOT IN ('in', 'out') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Clock in or out.';
  END IF;
  SELECT * INTO s FROM public.cleo_staff WHERE id = p_staff AND business_id = m.business_id AND removed_at IS NULL;
  IF NOT FOUND OR (m.branch_id IS NOT NULL AND m.branch_id <> s.branch_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That staff member isn’t on this branch anymore.';
  END IF;
  INSERT INTO public.cleo_attendance(business_id, branch_id, staff_id, kind, recorded_by)
    VALUES (s.business_id, s.branch_id, s.id, p_kind, auth.uid()) RETURNING * INTO entry;
  RETURN jsonb_build_object('id', entry.id, 'who', s.id, 'name', s.name, 'b', s.branch_id, 'kind', entry.kind,
    'at', floor(extract(epoch FROM entry.at) * 1000));
END;
$$;

/* ---------- 4. terminals ---------- */

CREATE TABLE public.cleo_terminals (
  business_id uuid NOT NULL REFERENCES public.cleo_businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  number integer NOT NULL CHECK (number BETWEEN 1 AND 999),
  registered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (business_id, branch_id, number),
  FOREIGN KEY (business_id, branch_id) REFERENCES public.cleo_branches(business_id, id)
);

-- Register a device as terminal N of a branch. The plan decides how many terminals the business has
-- (Free: one); registering a number already in use (a device that was reset) takes it over.
CREATE FUNCTION public.cleo_register_terminal(p_branch uuid, p_number integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m public.cleo_memberships%ROWTYPE; granted jsonb; in_use integer; registered public.cleo_terminals%ROWTYPE;
BEGIN
  m := public.cleo_require_actor(ARRAY['owner', 'hq', 'manager'], p_branch);
  PERFORM 1 FROM public.cleo_businesses WHERE id = m.business_id FOR UPDATE;
  granted := public.cleo_require_feature(m.business_id, 'checkout');
  IF p_number IS NULL OR p_number NOT BETWEEN 1 AND 999 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose a terminal number from 1 to 999.';
  END IF;
  SELECT count(*) INTO in_use FROM public.cleo_terminals
   WHERE business_id = m.business_id AND revoked_at IS NULL AND NOT (branch_id = p_branch AND number = p_number);
  IF in_use >= (granted ->> 'terminals')::integer THEN
    IF granted ->> 'plan' = 'free' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'The Free plan is for one terminal. Upgrade to Basic in Settings › Plan and billing to add more.';
    END IF;
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = format(
      'Your subscription covers %s terminal%s, and they are all registered. Add terminals in Settings › Plan and billing, or unregister one first.',
      granted ->> 'terminals', CASE WHEN (granted ->> 'terminals')::integer = 1 THEN '' ELSE 's' END);
  END IF;
  INSERT INTO public.cleo_terminals(business_id, branch_id, number, registered_by)
    VALUES (m.business_id, p_branch, p_number, auth.uid())
    ON CONFLICT (business_id, branch_id, number) DO UPDATE SET revoked_at = NULL, registered_by = EXCLUDED.registered_by, registered_at = now()
    RETURNING * INTO registered;
  PERFORM public.cleo_write_audit(m.business_id, p_branch, 'terminals.register', p_branch::text || '-t' || p_number, NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'branch', p_branch, 'term', p_number, 'at', floor(extract(epoch FROM registered.registered_at) * 1000));
END;
$$;

CREATE FUNCTION public.cleo_unregister_terminal(p_branch uuid, p_number integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m public.cleo_memberships%ROWTYPE;
BEGIN
  m := public.cleo_require_actor(ARRAY['owner', 'hq', 'manager'], p_branch);
  UPDATE public.cleo_terminals SET revoked_at = now()
   WHERE business_id = m.business_id AND branch_id = p_branch AND number = p_number AND revoked_at IS NULL;
  IF FOUND THEN
    PERFORM public.cleo_write_audit(m.business_id, p_branch, 'terminals.unregister', p_branch::text || '-t' || p_number, NULL, NULL);
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

/* ---------- 5. sales ---------- */

-- The summary of each issued sale, uploaded by the terminal that issued it, once. Keyed by
-- (branch, terminal, invoice number), so a retry from the terminal's outbox is harmless.
CREATE TABLE public.cleo_sales (
  business_id uuid NOT NULL REFERENCES public.cleo_businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  terminal integer NOT NULL CHECK (terminal BETWEEN 1 AND 999),
  invoice text NOT NULL CHECK (char_length(invoice) BETWEEN 1 AND 40),
  cashier text NOT NULL DEFAULT '' CHECK (char_length(cashier) <= 80),
  total numeric(14, 2) NOT NULL CHECK (total BETWEEN -100000000 AND 100000000),
  method text NOT NULL DEFAULT '' CHECK (char_length(method) <= 120),
  items jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(items) = 'array'),
  sold_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (business_id, branch_id, terminal, invoice),
  FOREIGN KEY (business_id, branch_id) REFERENCES public.cleo_branches(business_id, id)
);
CREATE INDEX cleo_sales_day ON public.cleo_sales(business_id, branch_id, sold_at DESC);

CREATE FUNCTION public.cleo_upload_sale(p_sale jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m public.cleo_memberships%ROWTYPE; target uuid; term integer; added integer;
BEGIN
  IF jsonb_typeof(p_sale) IS DISTINCT FROM 'object' OR octet_length(p_sale::text) > 32768
     OR p_sale ->> 'b' !~ '^[0-9a-fA-F-]{36}$' OR jsonb_typeof(p_sale -> 't') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_sale -> 'total') IS DISTINCT FROM 'number' OR jsonb_typeof(p_sale -> 'inv') IS DISTINCT FROM 'string'
     OR (p_sale ? 'items' AND (jsonb_typeof(p_sale -> 'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_sale -> 'items') > 300
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_sale -> 'items') i WHERE jsonb_typeof(i) IS DISTINCT FROM 'string' OR char_length(i #>> '{}') > 120))) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid sale.';
  END IF;
  target := (p_sale ->> 'b')::uuid;
  term := (p_sale ->> 't')::numeric::integer;
  m := public.cleo_require_actor(ARRAY['owner', 'hq', 'manager', 'cashier'], target);
  PERFORM public.cleo_require_feature(m.business_id, 'checkout');
  IF NOT EXISTS (SELECT 1 FROM public.cleo_terminals WHERE business_id = m.business_id AND branch_id = target AND number = term AND revoked_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This terminal isn’t registered anymore. Register it again in the Terminal.';
  END IF;
  INSERT INTO public.cleo_sales(business_id, branch_id, terminal, invoice, cashier, total, method, items, uploaded_by)
    VALUES (m.business_id, target, term, left(p_sale ->> 'inv', 40), left(COALESCE(p_sale ->> 'who', ''), 80),
      round((p_sale ->> 'total')::numeric, 2), left(COALESCE(p_sale ->> 'method', ''), 120), COALESCE(p_sale -> 'items', '[]'), auth.uid())
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS added = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'duplicate', added = 0);
END;
$$;

/* ---------- 6. business settings: every section the app's Settings screens save ---------- */

-- Replaces migration 003's version, which took only the business name, receipt texts and two limits, so
-- the Terminal's own settings (order types, tax, payments...) could not be saved. A section name and up to
-- four keys below it; strings up to 500 characters, numbers, true/false, or a small list or object.
-- Passing NULL as the expected version saves without the version check (one key at a time, last write wins).
CREATE OR REPLACE FUNCTION public.cleo_save_setting(p_path text, p_value jsonb, p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m public.cleo_memberships%ROWTYPE; s public.cleo_settings%ROWTYPE;
  parts text[]; kind text; i integer;
BEGIN
  m := public.cleo_require_actor(ARRAY['owner', 'hq']);
  PERFORM 1 FROM public.cleo_businesses WHERE id = m.business_id FOR UPDATE;
  parts := string_to_array(COALESCE(p_path, ''), '.');
  kind := jsonb_typeof(p_value);
  IF cardinality(parts) NOT BETWEEN 1 AND 5
     OR parts[1] NOT IN ('business', 'features', 'tax', 'limits', 'orderTypes', 'payments', 'notify', 'loyalty', 'invoice', 'brand',
       'regional', 'statutory', 'receipt', 'drawer', 'card', 'ui', 'scanner', 'inventory', 'alerts', 'menu', 'modules', 'integrations')
     OR EXISTS (SELECT 1 FROM unnest(parts) p WHERE p !~ '^[A-Za-z][A-Za-z0-9_]{0,40}$')
     OR kind IS NULL OR (cardinality(parts) = 1 AND kind <> 'object') OR octet_length(p_value::text) > 8192 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unsupported setting or incorrect value type.';
  END IF;
  IF (p_path IN ('limits.adjustApproval', 'limits.countVariance') AND kind <> 'number')
     OR (p_path IN ('business.name', 'business.legal', 'business.tin', 'business.style', 'business.receiptHeader', 'business.receiptFooter') AND kind <> 'string')
     OR (parts[1] = 'modules' AND kind <> 'boolean') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unsupported setting or incorrect value type.';
  END IF;
  IF (kind = 'number' AND (p_value #>> '{}')::numeric NOT BETWEEN -100000000 AND 100000000)
     OR (kind = 'string' AND char_length(p_value #>> '{}') > 500)
     OR (p_path = 'business.name' AND char_length(btrim(p_value #>> '{}')) NOT BETWEEN 1 AND 120)
     OR (p_path IN ('limits.adjustApproval', 'limits.countVariance') AND (p_value #>> '{}')::numeric < 0)
     OR (p_path = 'business.tin' AND (p_value #>> '{}') <> '' AND (p_value #>> '{}') !~ '^[0-9]{3}-?[0-9]{3}-?[0-9]{3}(-?[0-9]{3,5})?$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid business setting.';
  END IF;
  INSERT INTO public.cleo_settings(business_id) VALUES (m.business_id) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM public.cleo_settings WHERE business_id = m.business_id FOR UPDATE;
  IF p_expected_version IS NOT NULL AND s.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Settings changed. Refresh before saving.';
  END IF;
  -- jsonb_set only adds the last key: make each section above it an object first
  FOR i IN 1 .. cardinality(parts) - 1 LOOP
    IF jsonb_typeof(s.document #> parts[1:i]) IS DISTINCT FROM 'object' THEN
      s.document := jsonb_set(s.document, parts[1:i], '{}'::jsonb);
    END IF;
  END LOOP;
  IF octet_length(jsonb_set(s.document, parts, p_value)::text) > 65536 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Business settings are too large.';
  END IF;
  UPDATE public.cleo_settings SET document = jsonb_set(s.document, parts, p_value), version = version + 1 WHERE business_id = m.business_id;
  IF p_path = 'business.name' THEN
    UPDATE public.cleo_businesses SET name = btrim(p_value #>> '{}') WHERE id = m.business_id;
  END IF;
  PERFORM public.cleo_write_audit(m.business_id, NULL, 'settings.save', p_path, s.document #> parts, p_value);
  RETURN (SELECT jsonb_build_object('ok', true, 'config', document, 'version', version) FROM public.cleo_settings WHERE business_id = m.business_id);
END;
$$;

/* ---------- 7. what the app loads after sign-in ---------- */

ALTER FUNCTION public.cleo_bootstrap() RENAME TO cleo_billing_bootstrap;
REVOKE ALL ON FUNCTION public.cleo_billing_bootstrap() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.cleo_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  snapshot jsonb := public.cleo_billing_bootstrap();   -- every access check happens in here
  m public.cleo_memberships%ROWTYPE;
  branch_rows jsonb; staff_rows jsonb; cashier_rows jsonb; terminal_rows jsonb; attendance_rows jsonb;
BEGIN
  SELECT * INTO m FROM public.cleo_memberships WHERE user_id = auth.uid() AND revoked_at IS NULL;
  -- the real number of registered terminals in each branch the caller sees
  SELECT COALESCE(jsonb_agg(b.value || jsonb_build_object('terminals', (SELECT count(*) FROM public.cleo_terminals t
      WHERE t.business_id = m.business_id AND t.branch_id::text = b.value ->> 'id' AND t.revoked_at IS NULL)) ORDER BY b.ordinality), '[]')
    INTO branch_rows FROM jsonb_array_elements(snapshot #> '{data,branches}') WITH ORDINALITY AS b(value, ordinality);
  SELECT COALESCE(jsonb_agg(public.cleo_staff_view(s) ORDER BY s.created_at, s.id), '[]'),
         COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'initials', public.cleo_staff_view(s) ->> 'initials',
           'role', public.cleo_staff_view(s) ->> 'role', 'branch', s.branch_id, 'color', s.color) ORDER BY s.created_at, s.id), '[]')
    INTO staff_rows, cashier_rows
    FROM public.cleo_staff s
   WHERE s.business_id = m.business_id AND s.removed_at IS NULL AND (m.branch_id IS NULL OR s.branch_id = m.branch_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.branch_id::text || '-t' || t.number, 'b', t.branch_id, 't', t.number,
      'at', floor(extract(epoch FROM t.registered_at) * 1000)) ORDER BY t.branch_id, t.number), '[]')
    INTO terminal_rows FROM public.cleo_terminals t
   WHERE t.business_id = m.business_id AND t.revoked_at IS NULL AND (m.branch_id IS NULL OR t.branch_id = m.branch_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'who', a.staff_id, 'name', s.name, 'b', a.branch_id, 'kind', a.kind,
      'at', floor(extract(epoch FROM a.at) * 1000)) ORDER BY a.at DESC), '[]')
    INTO attendance_rows FROM public.cleo_attendance a JOIN public.cleo_staff s ON s.id = a.staff_id
   WHERE a.business_id = m.business_id AND a.at > now() - interval '36 hours' AND (m.branch_id IS NULL OR a.branch_id = m.branch_id);
  snapshot := jsonb_set(snapshot, '{data,branches}', branch_rows);
  snapshot := jsonb_set(snapshot, '{data,cashiers}', cashier_rows);
  snapshot := jsonb_set(snapshot, '{collections,users}', COALESCE(snapshot #> '{collections,users}', '[]') || staff_rows);
  snapshot := jsonb_set(snapshot, '{collections,terminals}', terminal_rows);
  snapshot := jsonb_set(snapshot, '{collections,attendance}', attendance_rows);
  RETURN snapshot || jsonb_build_object('businessId', m.business_id, 'entitlement', public.cleo_entitlement(m.business_id));
END;
$$;

/* ---------- 8. access ---------- */

ALTER TABLE public.cleo_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_terminals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cleo_staff, public.cleo_attendance, public.cleo_terminals, public.cleo_sales FROM PUBLIC, anon, authenticated;
-- sales and terminals are readable by the business's own managers; PIN hashes never leave the server
GRANT SELECT ON TABLE public.cleo_sales, public.cleo_terminals TO authenticated;
CREATE POLICY cleo_sales_read ON public.cleo_sales FOR SELECT TO authenticated
  USING (public.cleo_can_access(business_id, branch_id) AND EXISTS (SELECT 1 FROM public.cleo_memberships m
    WHERE m.user_id = auth.uid() AND m.business_id = cleo_sales.business_id AND m.revoked_at IS NULL
      AND m.role IN ('owner', 'hq', 'manager', 'accountant')));
CREATE POLICY cleo_terminals_read ON public.cleo_terminals FOR SELECT TO authenticated
  USING (public.cleo_can_access(business_id, branch_id));

REVOKE ALL ON FUNCTION public.cleo_add_branch(text, text, text), public.cleo_add_staff(uuid, text, text, text, text),
  public.cleo_set_staff_pin(uuid, text), public.cleo_remove_staff(uuid), public.cleo_check_pin(uuid, text), public.cleo_clock(uuid, text),
  public.cleo_register_terminal(uuid, integer), public.cleo_unregister_terminal(uuid, integer), public.cleo_upload_sale(jsonb),
  public.cleo_save_setting(text, jsonb, integer), public.cleo_bootstrap()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_add_branch(text, text, text), public.cleo_add_staff(uuid, text, text, text, text),
  public.cleo_set_staff_pin(uuid, text), public.cleo_remove_staff(uuid), public.cleo_check_pin(uuid, text), public.cleo_clock(uuid, text),
  public.cleo_register_terminal(uuid, integer), public.cleo_unregister_terminal(uuid, integer), public.cleo_upload_sale(jsonb),
  public.cleo_save_setting(text, jsonb, integer), public.cleo_bootstrap()
  TO authenticated;
REVOKE ALL ON FUNCTION public.cleo_managed_staff(uuid), public.cleo_plan_guard_records(), public.cleo_plan_guard_stock(),
  public.cleo_plan_guard_transfers() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
