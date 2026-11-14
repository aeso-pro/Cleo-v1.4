-- Cleo 006: plan payments and subscriptions. Apply AFTER 001 … 005, once, as the database owner.
--
-- How a plan gets paid for
--   1. The owner chooses a plan in Cleo. The browser calls the `billing` Edge Function, which calls
--      cleo_billing_start() AS THE OWNER. This function works out the price itself from
--      cleo_plan_prices; an amount sent by a browser is never used.
--   2. The Edge Function opens a hosted checkout page at the payment provider (PayMongo) for that
--      amount and sends the owner there. Card and wallet details are typed on the provider's page
--      and never reach Cleo.
--   3. The provider tells the `billing-webhook` Edge Function that the payment was made. That
--      function checks the message, asks the provider again for the truth, and calls
--      cleo_billing_confirm() with the service role. Only then does a subscription exist.
--
-- A browser can read its own business's payments and subscription (owner and HQ only) and can
-- write nothing. cleo_billing_attach / _confirm / _close answer the service role only.
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.cleo_admin_audit') IS NULL OR to_regprocedure('public.cleo_require_actor(text[],uuid)') IS NULL THEN
    RAISE EXCEPTION 'Cleo billing migration stopped: apply migrations 001 to 005 first.';
  END IF;
  IF to_regclass('public.cleo_payments') IS NOT NULL OR to_regclass('public.cleo_subscriptions') IS NOT NULL THEN
    RAISE EXCEPTION 'Cleo billing migration stopped: it has already been applied.';
  END IF;
END;
$guard$;

-- Prices in whole pesos, the same figures as content/plans.md. Changing a price is a new
-- migration, so the page and the server can never quietly disagree for long.
CREATE TABLE public.cleo_plan_prices (
  plan text PRIMARY KEY CHECK (plan IN ('free', 'basic', 'pro', 'max')),
  monthly integer NOT NULL CHECK (monthly >= 0),
  annual integer NOT NULL CHECK (annual >= 0),
  extra_monthly integer NOT NULL CHECK (extra_monthly >= 0),
  extra_annual integer NOT NULL CHECK (extra_annual >= 0),
  max_terminals integer NOT NULL CHECK (max_terminals >= 1),
  max_branches integer NOT NULL CHECK (max_branches >= 1)
);
INSERT INTO public.cleo_plan_prices VALUES
  ('free', 0, 0, 0, 0, 1, 1),
  ('basic', 1499, 14990, 499, 5988, 9999, 1),
  ('pro', 2999, 29990, 999, 11988, 9999, 1),
  ('max', 4999, 49990, 1499, 17988, 9999, 9999);

CREATE TABLE public.cleo_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.cleo_businesses(id),
  reference text NOT NULL UNIQUE CHECK (reference ~ '^CLEO-[0-9A-F]{16}$'),
  plan text NOT NULL REFERENCES public.cleo_plan_prices(plan),
  terminals integer NOT NULL CHECK (terminals BETWEEN 1 AND 9999),
  branches integer NOT NULL CHECK (branches >= 1),
  cycle text NOT NULL CHECK (cycle IN ('monthly', 'annual')),
  amount_centavos bigint NOT NULL CHECK (amount_centavos > 0),
  method text NOT NULL CHECK (method IN ('card', 'gcash', 'maya', 'gotyme')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  provider text NOT NULL DEFAULT 'paymongo' CHECK (provider = 'paymongo'),
  provider_session text,
  provider_payment text,
  livemode boolean,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  CHECK (branches <= terminals)
);
CREATE UNIQUE INDEX cleo_payments_session ON public.cleo_payments(provider_session) WHERE provider_session IS NOT NULL;
CREATE INDEX cleo_payments_business ON public.cleo_payments(business_id, created_at DESC);

CREATE TABLE public.cleo_subscriptions (
  business_id uuid PRIMARY KEY REFERENCES public.cleo_businesses(id),
  plan text NOT NULL REFERENCES public.cleo_plan_prices(plan),
  terminals integer NOT NULL CHECK (terminals BETWEEN 1 AND 9999),
  branches integer NOT NULL CHECK (branches >= 1),
  cycle text NOT NULL CHECK (cycle IN ('monthly', 'annual')),
  total_centavos bigint NOT NULL CHECK (total_centavos >= 0),
  method text NOT NULL DEFAULT '' CHECK (method IN ('', 'card', 'gcash', 'maya', 'gotyme')),
  since timestamptz NOT NULL DEFAULT now(),
  -- NULL for Free, which has nothing to renew. Paid plans stay open for 3 days after this.
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cleo_plan_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cleo_plan_prices, public.cleo_payments, public.cleo_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cleo_payments, public.cleo_subscriptions TO authenticated;
CREATE POLICY cleo_payments_read ON public.cleo_payments FOR SELECT TO authenticated
  USING (public.cleo_can_access(business_id) AND EXISTS (
    SELECT 1 FROM public.cleo_memberships m WHERE m.user_id = auth.uid() AND m.business_id = cleo_payments.business_id
      AND m.revoked_at IS NULL AND m.role IN ('owner', 'hq')));
CREATE POLICY cleo_subscriptions_read ON public.cleo_subscriptions FOR SELECT TO authenticated
  USING (public.cleo_can_access(business_id));

-- Internal: the price of a plan for a number of terminals and branches. The same sum as
-- Cleo.licensing.quote in the app: each branch's first terminal at the plan rate, every other
-- terminal at the additional rate; an annual extra is twelve monthly fees.
CREATE FUNCTION public.cleo_billing_price(p_plan text, p_terminals integer, p_branches integer, p_cycle text)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  price public.cleo_plan_prices%ROWTYPE;
BEGIN
  SELECT * INTO price FROM public.cleo_plan_prices p WHERE p.plan = p_plan;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose Free, Basic, Pro or Max. Other plans are arranged with sales.';
  END IF;
  IF p_cycle IS NULL OR p_cycle NOT IN ('monthly', 'annual') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose monthly or annual billing.';
  END IF;
  IF p_terminals IS NULL OR p_branches IS NULL OR p_terminals NOT BETWEEN 1 AND 9999
     OR p_branches < 1 OR p_branches > p_terminals THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Each branch needs at least one terminal.';
  END IF;
  IF p_terminals > price.max_terminals OR p_branches > price.max_branches THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'This plan does not cover that number of terminals or branches.';
  END IF;
  RETURN 100::bigint * (
    CASE p_cycle WHEN 'annual' THEN price.annual ELSE price.monthly END::bigint * p_branches
    + CASE p_cycle WHEN 'annual' THEN price.extra_annual ELSE price.extra_monthly END::bigint * (p_terminals - p_branches));
END;
$function$;
REVOKE ALL ON FUNCTION public.cleo_billing_price(text, integer, integer, text) FROM PUBLIC, anon, authenticated;

-- Internal: only the Edge Functions' service role may settle a payment.
CREATE FUNCTION public.cleo_require_service()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This operation is not available.';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.cleo_require_service() FROM PUBLIC, anon, authenticated;

-- Internal: the subscription as the app reads it, or NULL when there is none in force.
CREATE FUNCTION public.cleo_subscription_view(p_business uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT jsonb_build_object('plan', s.plan, 'terminals', s.terminals, 'branches', s.branches, 'cycle', s.cycle,
      'total', s.total_centavos / 100.0, 'since', s.since, 'periodEnd', s.current_period_end, 'method', s.method)
    FROM public.cleo_subscriptions s
   WHERE s.business_id = p_business
     AND (s.current_period_end IS NULL OR s.current_period_end + interval '3 days' > now());
$function$;
REVOKE ALL ON FUNCTION public.cleo_subscription_view(uuid) FROM PUBLIC, anon, authenticated;

-- Start a plan. Owner only. Free starts at once; a paid plan gets a pending payment whose
-- amount this function decides. Called by the `billing` Edge Function with the owner's own token.
CREATE FUNCTION public.cleo_billing_start(p_plan text, p_terminals integer, p_branches integer, p_cycle text, p_method text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  m public.cleo_memberships%ROWTYPE;
  amount bigint;
  payment public.cleo_payments%ROWTYPE;
  business_name text;
  owner_email text;
BEGIN
  m := public.cleo_require_actor(ARRAY['owner']);
  amount := public.cleo_billing_price(p_plan, p_terminals, p_branches, p_cycle);
  SELECT b.name INTO business_name FROM public.cleo_businesses b WHERE b.id = m.business_id FOR UPDATE;
  IF amount = 0 THEN
    IF EXISTS (SELECT 1 FROM public.cleo_subscriptions s WHERE s.business_id = m.business_id
        AND s.plan <> 'free' AND s.current_period_end > now()) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Your paid plan is still running. Free can start when it ends.';
    END IF;
    INSERT INTO public.cleo_subscriptions(business_id, plan, terminals, branches, cycle, total_centavos, method, current_period_end)
      VALUES (m.business_id, p_plan, p_terminals, p_branches, p_cycle, 0, '', NULL)
      ON CONFLICT (business_id) DO UPDATE SET plan = EXCLUDED.plan, terminals = EXCLUDED.terminals, branches = EXCLUDED.branches,
        cycle = EXCLUDED.cycle, total_centavos = 0, method = '', current_period_end = NULL, updated_at = now();
    PERFORM public.cleo_write_audit(m.business_id, NULL, 'billing.plan', p_plan, NULL, jsonb_build_object('plan', p_plan, 'total', 0));
    RETURN jsonb_build_object('ok', true, 'free', true, 'subscription', public.cleo_subscription_view(m.business_id));
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('card', 'gcash', 'maya', 'gotyme') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Choose how to pay: card, GCash, Maya or GoTyme Bank.';
  END IF;
  -- A stop on runaway retries; a person paying normally never reaches it.
  IF (SELECT count(*) FROM public.cleo_payments p WHERE p.business_id = m.business_id
        AND p.created_at > now() - interval '1 hour') >= 12 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Too many payment attempts. Wait an hour, then try again.';
  END IF;
  UPDATE public.cleo_payments SET status = 'expired'
    WHERE business_id = m.business_id AND status = 'pending' AND created_at < now() - interval '1 day';
  INSERT INTO public.cleo_payments(business_id, reference, plan, terminals, branches, cycle, amount_centavos, method, created_by)
    VALUES (m.business_id, 'CLEO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
      p_plan, p_terminals, p_branches, p_cycle, amount, p_method, auth.uid())
    RETURNING * INTO payment;
  SELECT u.email INTO owner_email FROM auth.users u WHERE u.id = auth.uid();
  RETURN jsonb_build_object('ok', true, 'free', false, 'reference', payment.reference, 'amountCentavos', payment.amount_centavos,
    'plan', payment.plan, 'terminals', payment.terminals, 'branches', payment.branches, 'cycle', payment.cycle,
    'method', payment.method, 'business', business_name, 'email', owner_email);
END;
$function$;

-- Service role: remember which checkout page belongs to a pending payment.
CREATE FUNCTION public.cleo_billing_attach(p_reference text, p_session text, p_livemode boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.cleo_require_service();
  IF p_session IS NULL OR char_length(p_session) NOT BETWEEN 4 AND 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A checkout session is required.';
  END IF;
  UPDATE public.cleo_payments SET provider_session = p_session, livemode = p_livemode
    WHERE reference = p_reference AND status = 'pending' AND provider_session IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That payment is not waiting for a checkout page.';
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- Service role: the provider confirmed the money. Safe to call twice: the second call changes
-- nothing. The session and the amount must be the ones this database issued.
CREATE FUNCTION public.cleo_billing_confirm(p_reference text, p_session text, p_payment text, p_amount_centavos bigint, p_livemode boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  payment public.cleo_payments%ROWTYPE;
  current public.cleo_subscriptions%ROWTYPE;
  starts timestamptz := now();
  ends timestamptz;
BEGIN
  PERFORM public.cleo_require_service();
  SELECT * INTO payment FROM public.cleo_payments p WHERE p.reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'No payment has that reference.';
  END IF;
  IF payment.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'subscription', public.cleo_subscription_view(payment.business_id));
  END IF;
  IF payment.provider_session IS DISTINCT FROM p_session THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'That checkout page does not belong to this payment.';
  END IF;
  IF p_amount_centavos IS DISTINCT FROM payment.amount_centavos THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The amount paid does not match the amount due.';
  END IF;
  IF payment.livemode IS DISTINCT FROM p_livemode THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'A test payment cannot settle a live one, or the reverse.';
  END IF;
  PERFORM 1 FROM public.cleo_businesses b WHERE b.id = payment.business_id FOR UPDATE;
  SELECT * INTO current FROM public.cleo_subscriptions s WHERE s.business_id = payment.business_id FOR UPDATE;
  -- Paying again for the same plan before it ends adds to it rather than losing the days left.
  IF FOUND AND current.plan = payment.plan AND current.cycle = payment.cycle AND current.current_period_end > now() THEN
    starts := current.current_period_end;
  END IF;
  ends := starts + CASE payment.cycle WHEN 'annual' THEN interval '1 year' ELSE interval '1 month' END;
  UPDATE public.cleo_payments SET status = 'paid', paid_at = now(), provider_payment = left(COALESCE(p_payment, ''), 120),
      period_start = starts, period_end = ends
    WHERE id = payment.id;
  INSERT INTO public.cleo_subscriptions(business_id, plan, terminals, branches, cycle, total_centavos, method, current_period_end)
    VALUES (payment.business_id, payment.plan, payment.terminals, payment.branches, payment.cycle, payment.amount_centavos, payment.method, ends)
    ON CONFLICT (business_id) DO UPDATE SET plan = EXCLUDED.plan, terminals = EXCLUDED.terminals, branches = EXCLUDED.branches,
      cycle = EXCLUDED.cycle, total_centavos = EXCLUDED.total_centavos, method = EXCLUDED.method,
      current_period_end = EXCLUDED.current_period_end, updated_at = now();
  INSERT INTO public.cleo_audit_log(business_id, branch_id, actor_id, action, entity_id, before_value, after_value)
    VALUES (payment.business_id, NULL, payment.created_by, 'billing.paid', payment.reference, NULL,
      jsonb_build_object('plan', payment.plan, 'terminals', payment.terminals, 'branches', payment.branches,
        'cycle', payment.cycle, 'total', payment.amount_centavos / 100.0, 'method', payment.method, 'until', ends));
  RETURN jsonb_build_object('ok', true, 'already', false, 'subscription', public.cleo_subscription_view(payment.business_id));
END;
$function$;

-- Service role: a checkout that failed or was abandoned.
CREATE FUNCTION public.cleo_billing_close(p_reference text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM public.cleo_require_service();
  IF p_status IS NULL OR p_status NOT IN ('failed', 'expired') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A payment closes as failed or expired.';
  END IF;
  UPDATE public.cleo_payments SET status = p_status WHERE reference = p_reference AND status = 'pending';
  RETURN jsonb_build_object('ok', true, 'changed', FOUND);
END;
$function$;

-- Where one of the caller's own payments stands. Owner and HQ only.
CREATE FUNCTION public.cleo_billing_status(p_reference text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  m public.cleo_memberships%ROWTYPE;
  payment public.cleo_payments%ROWTYPE;
BEGIN
  m := public.cleo_require_actor(ARRAY['owner', 'hq']);
  SELECT * INTO payment FROM public.cleo_payments p WHERE p.reference = p_reference AND p.business_id = m.business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'That payment is not on this business.';
  END IF;
  RETURN jsonb_build_object('ok', true, 'reference', payment.reference, 'status', payment.status,
    'session', payment.provider_session, 'subscription', public.cleo_subscription_view(m.business_id));
END;
$function$;

-- The bootstrap now carries the plan. Everything else is exactly what migration 003 returns.
ALTER FUNCTION public.cleo_bootstrap() RENAME TO cleo_operations_bootstrap;
REVOKE ALL ON FUNCTION public.cleo_operations_bootstrap() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.cleo_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  snapshot jsonb := public.cleo_operations_bootstrap();   -- every access check happens in here
  business uuid;
  member_role text;
  subscription jsonb;
  label text;
BEGIN
  SELECT m.business_id, m.role INTO business, member_role FROM public.cleo_memberships m
    WHERE m.user_id = auth.uid() AND m.revoked_at IS NULL;
  subscription := public.cleo_subscription_view(business);
  IF subscription IS NULL THEN
    RETURN snapshot || jsonb_build_object('plan', NULL, 'subscription', NULL, 'billingMethod', NULL, 'invoices', '[]'::jsonb);
  END IF;
  label := CASE subscription ->> 'method' WHEN 'card' THEN 'Card' WHEN 'gcash' THEN 'GCash' WHEN 'maya' THEN 'Maya'
    WHEN 'gotyme' THEN 'GoTyme Bank (QR Ph)' ELSE '' END;
  RETURN snapshot || jsonb_build_object(
    'plan', subscription ->> 'plan',
    'subscription', subscription,
    'billingMethod', CASE WHEN label = '' OR member_role NOT IN ('owner', 'hq') THEN NULL ELSE
      jsonb_build_object('kind', 'card', 'label', label, 'sub', 'Paid on the payment provider''s secure page') END,
    'invoices', '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.cleo_billing_start(text, integer, integer, text, text),
  public.cleo_billing_attach(text, text, boolean), public.cleo_billing_confirm(text, text, text, bigint, boolean),
  public.cleo_billing_close(text, text), public.cleo_billing_status(text), public.cleo_bootstrap()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_billing_start(text, integer, integer, text, text),
  public.cleo_billing_status(text), public.cleo_bootstrap() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_billing_attach(text, text, boolean),
  public.cleo_billing_confirm(text, text, text, bigint, boolean), public.cleo_billing_close(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
