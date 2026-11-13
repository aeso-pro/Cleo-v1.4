-- Catalog, stock, settings and audit foundations. Apply after 001 and 002.
-- All writes go through validated RPCs; no browser role can write a table.
BEGIN;

CREATE TABLE public.cleo_records (
  business_id uuid NOT NULL REFERENCES public.cleo_businesses(id),
  kind text NOT NULL CHECK (kind IN ('products','ingredients','categories','modifiers','customers')),
  id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  archived boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, kind, id)
);
CREATE UNIQUE INDEX cleo_products_sku ON public.cleo_records
  (business_id, lower(NULLIF(btrim(data->>'sku'), '')))
  WHERE kind='products' AND NOT archived;
CREATE UNIQUE INDEX cleo_products_barcode ON public.cleo_records
  (business_id, NULLIF(btrim(data->>'barcode'), ''))
  WHERE kind='products' AND NOT archived;
CREATE UNIQUE INDEX cleo_customers_mobile ON public.cleo_records
  (business_id, NULLIF(data->>'mobile','')) WHERE kind='customers' AND NOT archived;

CREATE TABLE public.cleo_settings (
  business_id uuid PRIMARY KEY REFERENCES public.cleo_businesses(id),
  document jsonb NOT NULL DEFAULT '{"business":{},"limits":{}}'::jsonb,
  version integer NOT NULL DEFAULT 0
);
CREATE TABLE public.cleo_period_locks (
  business_id uuid NOT NULL REFERENCES public.cleo_businesses(id),
  month date NOT NULL CHECK (extract(day FROM month)=1),
  locked_at timestamptz NOT NULL DEFAULT now(),
  locked_by uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (business_id, month)
);
CREATE TABLE public.cleo_stock_balances (
  business_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  item_kind text NOT NULL DEFAULT 'ingredients' CHECK (item_kind='ingredients'),
  item_id text NOT NULL,
  quantity numeric(20,6) NOT NULL DEFAULT 0,
  unit_cost numeric(20,6) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  PRIMARY KEY (business_id, branch_id, item_id),
  FOREIGN KEY (business_id, branch_id) REFERENCES public.cleo_branches(business_id,id),
  FOREIGN KEY (business_id, item_kind, item_id) REFERENCES public.cleo_records(business_id,kind,id)
);
CREATE TABLE public.cleo_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  item_id text NOT NULL,
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  kind text NOT NULL CHECK (kind IN ('receive','adjust','count')),
  quantity numeric(20,6) NOT NULL,
  unit_cost numeric(20,6) NOT NULL CHECK (unit_cost>=0),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  request jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, request_id),
  FOREIGN KEY (business_id, branch_id, item_id)
    REFERENCES public.cleo_stock_balances(business_id,branch_id,item_id)
);
CREATE INDEX cleo_stock_history ON public.cleo_stock_movements(business_id,branch_id,item_id,created_at DESC);
CREATE TABLE public.cleo_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.cleo_businesses(id),
  branch_id uuid,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  entity_id text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, branch_id) REFERENCES public.cleo_branches(business_id,id)
);
CREATE INDEX cleo_audit_history ON public.cleo_audit_log(business_id,created_at DESC);

-- This helper is callable for RLS reads but cannot confer membership or a role.
CREATE FUNCTION public.cleo_can_access(p_business_id uuid, p_branch_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.cleo_session_is_strong()
    AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id=auth.uid()
      AND u.email_confirmed_at IS NOT NULL AND NULLIF(btrim(u.email),'') IS NOT NULL)
    AND EXISTS (SELECT 1 FROM public.cleo_legal_acceptances a WHERE a.user_id=auth.uid()
      AND a.version='privacy 1.0, terms 1.0')
    AND EXISTS (SELECT 1 FROM public.cleo_memberships m
      WHERE m.user_id=auth.uid() AND m.business_id=p_business_id AND m.revoked_at IS NULL
        AND (p_branch_id IS NULL OR m.branch_id IS NULL OR m.branch_id=p_branch_id));
$$;
REVOKE ALL ON FUNCTION public.cleo_can_access(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_can_access(uuid,uuid) TO authenticated;

-- Internal helper; clients cannot supply a desired role to a public RPC.
CREATE FUNCTION public.cleo_require_actor(p_roles text[], p_branch_id uuid DEFAULT NULL)
RETURNS public.cleo_memberships LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m public.cleo_memberships%ROWTYPE;
BEGIN
  PERFORM public.cleo_auth_context();
  IF NOT public.cleo_session_is_strong() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Complete two-step verification.';
  END IF;
  SELECT * INTO m FROM public.cleo_memberships WHERE user_id=auth.uid() AND revoked_at IS NULL FOR SHARE;
  IF NOT FOUND OR NOT (m.role=ANY(p_roles)) OR NOT public.cleo_can_access(m.business_id,p_branch_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Your role or business access does not permit this operation.';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cleo_branches b
    WHERE b.business_id=m.business_id AND b.id=p_branch_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Branch access denied.';
  END IF;
  RETURN m;
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_require_actor(text[],uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.cleo_write_audit(p_business uuid,p_branch uuid,p_action text,p_entity text,p_before jsonb,p_after jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.cleo_audit_log(business_id,branch_id,actor_id,action,entity_id,before_value,after_value)
    VALUES(p_business,p_branch,auth.uid(),p_action,p_entity,p_before,p_after);
$$;
REVOKE ALL ON FUNCTION public.cleo_write_audit(uuid,uuid,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;

ALTER TABLE public.cleo_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_period_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY cleo_records_read ON public.cleo_records FOR SELECT TO authenticated
  USING (public.cleo_can_access(business_id) AND (kind<>'customers' OR EXISTS (
    SELECT 1 FROM public.cleo_memberships m WHERE m.user_id=auth.uid() AND m.business_id=cleo_records.business_id
      AND m.revoked_at IS NULL AND m.role IN ('owner','hq','manager','cashier'))));
CREATE POLICY cleo_settings_read ON public.cleo_settings FOR SELECT TO authenticated
  USING (public.cleo_can_access(business_id));
CREATE POLICY cleo_stock_balances_read ON public.cleo_stock_balances FOR SELECT TO authenticated
  USING (public.cleo_can_access(business_id,branch_id));
CREATE POLICY cleo_stock_movements_read ON public.cleo_stock_movements FOR SELECT TO authenticated
  USING (public.cleo_can_access(business_id,branch_id));
CREATE POLICY cleo_period_locks_read ON public.cleo_period_locks FOR SELECT TO authenticated
  USING (public.cleo_can_access(business_id));
CREATE POLICY cleo_audit_read ON public.cleo_audit_log FOR SELECT TO authenticated
  USING (public.cleo_can_access(business_id,branch_id) AND EXISTS (
    SELECT 1 FROM public.cleo_memberships m WHERE m.user_id=auth.uid()
      AND m.business_id=cleo_audit_log.business_id AND m.revoked_at IS NULL
      AND m.role IN ('owner','hq','manager','accountant')));
REVOKE ALL ON TABLE public.cleo_records,public.cleo_settings,public.cleo_stock_balances,
 public.cleo_stock_movements,public.cleo_audit_log,public.cleo_period_locks FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.cleo_records,public.cleo_settings,public.cleo_stock_balances,
 public.cleo_stock_movements,public.cleo_audit_log,public.cleo_period_locks TO authenticated;
REVOKE ALL ON SEQUENCE public.cleo_audit_log_id_seq FROM PUBLIC,anon,authenticated;

-- Atomic add/change/archive. _version is required when changing or archiving
-- an existing record. No client-supplied business, role, stock balance or cost.
CREATE FUNCTION public.cleo_apply_records(p_kind text,p_upserts jsonb DEFAULT '[]',p_archive jsonb DEFAULT '[]')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  m public.cleo_memberships%ROWTYPE;
  entry jsonb; previous public.cleo_records%ROWTYPE; payload jsonb;
  record_id text; allowed text[]; ingredient jsonb; archive_id text;
BEGIN
  IF p_kind NOT IN ('products','ingredients','categories','modifiers','customers') OR p_kind IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Unsupported record collection.';
  END IF;
  m:=public.cleo_require_actor(CASE WHEN p_kind='customers' THEN ARRAY['owner','hq','manager','cashier']
    ELSE ARRAY['owner','hq'] END);
  -- Serialize business mutations, including recipe/archive and period-lock races.
  PERFORM 1 FROM public.cleo_businesses WHERE id=m.business_id FOR UPDATE;
  IF jsonb_typeof(p_upserts) IS DISTINCT FROM 'array' OR jsonb_typeof(p_archive) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Record batches must be arrays.';
  END IF;
  IF jsonb_array_length(p_upserts)+jsonb_array_length(p_archive)>500
    OR octet_length(p_upserts::text)+octet_length(p_archive::text)>1048576 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Record batch is too large.';
  END IF;
  IF (SELECT count(*)<>count(DISTINCT value->>'id') FROM jsonb_array_elements(p_upserts))
    OR (SELECT count(*)<>count(DISTINCT value->>'id') FROM jsonb_array_elements(p_archive))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_upserts) u JOIN jsonb_array_elements(p_archive) a
      ON u->>'id'=a->>'id') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Each record may appear only once in a batch.';
  END IF;
  allowed:=CASE p_kind
    WHEN 'products' THEN ARRAY['id','_version','name','sku','cat','price','cost','station','barcode','sizes','variants','branchPrice','branchOff','mods','recipe','taxType','available']
    WHEN 'ingredients' THEN ARRAY['id','_version','name','unit','grp','rp','supplier','exp']
    WHEN 'categories' THEN ARRAY['id','_version','name','icon']
    WHEN 'modifiers' THEN ARRAY['id','_version','name','pick','def','opts']
    WHEN 'customers' THEN ARRAY['id','_version','name','mobile','email','birthday','tin','address','consentAt'] END;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_upserts) LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Each record must be an object.';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(entry) k WHERE NOT k=ANY(allowed)) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Unsupported or server-owned record field.';
    END IF;
    record_id:=entry->>'id';
    IF jsonb_typeof(entry->'id') IS DISTINCT FROM 'string' OR record_id !~ '^[A-Za-z0-9_-]{1,80}$' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='A valid record id is required.';
    END IF;
    SELECT * INTO previous FROM public.cleo_records WHERE business_id=m.business_id AND kind=p_kind AND id=record_id FOR UPDATE;
    IF FOUND THEN
      IF previous.archived OR entry->'_version' IS DISTINCT FROM to_jsonb(previous.version) THEN
        RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Record changed. Refresh before saving.';
      END IF;
    ELSIF entry ? '_version' AND entry->'_version'<>'0'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Record changed. Refresh before saving.';
    END IF;
    payload:=COALESCE(previous.data,'{}'::jsonb)||(entry-ARRAY['id','_version']);
    IF jsonb_typeof(payload->'name') IS DISTINCT FROM 'string' OR char_length(btrim(payload->>'name')) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='A name of 1 to 120 characters is required.';
    END IF;
    IF p_kind='products' THEN
      IF jsonb_typeof(payload->'price') IS DISTINCT FROM 'number' OR (payload->>'price')::numeric NOT BETWEEN 0 AND 100000000
        OR round((payload->>'price')::numeric,2)<>(payload->>'price')::numeric THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Product price must be a nonnegative amount with at most two decimals.';
      END IF;
      IF payload ? 'recipe' THEN
        IF jsonb_typeof(payload->'recipe') IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Recipe must be an array.';
        END IF;
        FOR ingredient IN SELECT value FROM jsonb_array_elements(payload->'recipe') LOOP
          IF jsonb_typeof(ingredient) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid recipe ingredient.';
          END IF;
          IF jsonb_array_length(ingredient)<>2 OR jsonb_typeof(ingredient->0) IS DISTINCT FROM 'string'
            OR jsonb_typeof(ingredient->1) IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid recipe ingredient.';
          END IF;
          IF (ingredient->>1)::numeric<=0 OR (ingredient->>1)::numeric>100000000
            OR NOT EXISTS (SELECT 1 FROM public.cleo_records WHERE business_id=m.business_id
              AND kind='ingredients' AND id=ingredient->>0 AND NOT archived) THEN
            RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Recipe needs an active stock item and positive quantity.';
          END IF;
        END LOOP;
      END IF;
    ELSIF p_kind='ingredients' THEN
      IF jsonb_typeof(payload->'unit') IS DISTINCT FROM 'string' OR char_length(btrim(payload->>'unit')) NOT BETWEEN 1 AND 20
        OR (payload ? 'rp' AND (jsonb_typeof(payload->'rp') IS DISTINCT FROM 'number')) THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Stock item needs a unit and numeric reorder point.';
      END IF;
      IF payload ? 'rp' AND (payload->>'rp')::numeric NOT BETWEEN 0 AND 100000000 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid reorder point.';
      END IF;
      IF previous.data->>'unit' IS DISTINCT FROM payload->>'unit'
        AND EXISTS (SELECT 1 FROM public.cleo_stock_movements WHERE business_id=m.business_id AND item_id=record_id) THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Stock units cannot change after movements exist.';
      END IF;
    ELSIF p_kind='customers' THEN
      IF jsonb_typeof(payload->'mobile') IS DISTINCT FROM 'string' OR payload->>'mobile' !~ '^\+639[0-9]{9}$' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Use a normalized Philippine mobile number (+639 followed by nine digits).';
      END IF;
    END IF;
    INSERT INTO public.cleo_records(business_id,kind,id,data) VALUES(m.business_id,p_kind,record_id,payload)
      ON CONFLICT (business_id,kind,id) DO UPDATE SET data=EXCLUDED.data,
        version=cleo_records.version+1,updated_at=now();
    PERFORM public.cleo_write_audit(m.business_id,NULL,p_kind||'.save',record_id,
      CASE WHEN p_kind='customers' THEN NULL ELSE previous.data END,
      CASE WHEN p_kind='customers' THEN NULL ELSE payload END);
  END LOOP;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_archive) LOOP
    archive_id:=entry->>'id';
    SELECT * INTO previous FROM public.cleo_records WHERE business_id=m.business_id AND kind=p_kind AND id=archive_id FOR UPDATE;
    IF NOT FOUND OR previous.archived OR entry->'_version' IS DISTINCT FROM to_jsonb(previous.version) THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Record changed. Refresh before removing.';
    END IF;
    IF p_kind='ingredients' THEN
      IF EXISTS (SELECT 1 FROM public.cleo_records r, LATERAL jsonb_array_elements(COALESCE(r.data->'recipe','[]')) part
        WHERE r.business_id=m.business_id AND r.kind='products' AND NOT r.archived AND part->>0=archive_id)
        OR EXISTS (SELECT 1 FROM public.cleo_stock_balances WHERE business_id=m.business_id AND item_id=archive_id AND quantity<>0) THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Stock item is still used by a recipe or has stock on hand.';
      END IF;
    END IF;
    IF p_kind='customers' THEN
      DELETE FROM public.cleo_records WHERE business_id=m.business_id AND kind=p_kind AND id=archive_id;
      -- Customer personal data is never copied into audit snapshots.
      PERFORM public.cleo_write_audit(m.business_id,NULL,'customers.erase',archive_id,NULL,NULL);
    ELSE
      UPDATE public.cleo_records SET archived=true,version=version+1,updated_at=now()
        WHERE business_id=m.business_id AND kind=p_kind AND id=archive_id;
      PERFORM public.cleo_write_audit(m.business_id,NULL,p_kind||'.archive',archive_id,previous.data,NULL);
    END IF;
  END LOOP;
  RETURN (SELECT COALESCE(jsonb_agg(data||jsonb_build_object('id',id,'_version',version) ORDER BY id),'[]')
    FROM public.cleo_records WHERE business_id=m.business_id AND kind=p_kind AND NOT archived);
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_apply_records(text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_apply_records(text,jsonb,jsonb) TO authenticated;

CREATE FUNCTION public.cleo_save_setting(p_path text,p_value jsonb,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m public.cleo_memberships%ROWTYPE; s public.cleo_settings%ROWTYPE;
  parts text[]; expected_type text;
BEGIN
  m:=public.cleo_require_actor(ARRAY['owner','hq']);
  PERFORM 1 FROM public.cleo_businesses WHERE id=m.business_id FOR UPDATE;
  expected_type:=CASE
    WHEN p_path IN ('business.name','business.legal','business.tin','business.style','business.receiptHeader','business.receiptFooter') THEN 'string'
    WHEN p_path IN ('limits.adjustApproval','limits.countVariance') THEN 'number'
    ELSE NULL END;
  IF expected_type IS NULL OR jsonb_typeof(p_value) IS DISTINCT FROM expected_type THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Unsupported setting or incorrect value type.';
  END IF;
  IF expected_type='number' THEN
    IF (p_value#>>'{}')::numeric NOT BETWEEN 0 AND 100000000 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Setting value is out of range.';
    END IF;
  ELSE
    IF char_length(p_value#>>'{}')>500 OR (p_path='business.name' AND char_length(btrim(p_value#>>'{}')) NOT BETWEEN 1 AND 120)
      OR (p_path='business.tin' AND (p_value#>>'{}')<>'' AND (p_value#>>'{}') !~ '^[0-9]{3}-?[0-9]{3}-?[0-9]{3}(-?[0-9]{3,5})?$') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid business setting.';
    END IF;
  END IF;
  INSERT INTO public.cleo_settings(business_id) VALUES(m.business_id) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM public.cleo_settings WHERE business_id=m.business_id FOR UPDATE;
  IF s.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Settings changed. Refresh before saving.';
  END IF;
  parts:=string_to_array(p_path,'.');
  UPDATE public.cleo_settings SET document=jsonb_set(document,parts,p_value),version=version+1 WHERE business_id=m.business_id;
  IF p_path='business.name' THEN
    UPDATE public.cleo_businesses SET name=btrim(p_value#>>'{}') WHERE id=m.business_id;
  END IF;
  PERFORM public.cleo_write_audit(m.business_id,NULL,'settings.save',p_path,s.document#>parts,p_value);
  RETURN (SELECT jsonb_build_object('ok',true,'config',document,'version',version) FROM public.cleo_settings WHERE business_id=m.business_id);
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_save_setting(text,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_save_setting(text,jsonb,integer) TO authenticated;

CREATE FUNCTION public.cleo_lock_period(p_month date,p_locked boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m public.cleo_memberships%ROWTYPE;
BEGIN
  m:=public.cleo_require_actor(ARRAY['owner','hq']);
  IF p_month IS NULL OR extract(day FROM p_month)<>1 OR p_locked IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Use the first day of a month and a lock state.';
  END IF;
  PERFORM 1 FROM public.cleo_businesses WHERE id=m.business_id FOR UPDATE;
  IF p_locked THEN
    INSERT INTO public.cleo_period_locks(business_id,month,locked_by) VALUES(m.business_id,p_month,auth.uid()) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.cleo_period_locks WHERE business_id=m.business_id AND month=p_month;
  END IF;
  PERFORM public.cleo_write_audit(m.business_id,NULL,CASE WHEN p_locked THEN 'period.lock' ELSE 'period.reopen' END,
    p_month::text,NULL,to_jsonb(p_locked));
  RETURN jsonb_build_object('ok',true,'month',p_month,'locked',p_locked);
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_lock_period(date,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_lock_period(date,boolean) TO authenticated;

-- p_quantity is a signed delta for adjust; a positive delivery for receive;
-- the physical on-hand target for count. Unlike the demo, never trust `role`,
-- `by`, client-computed variance, or client-computed weighted costs.
CREATE FUNCTION public.cleo_post_stock(p_branch_id uuid,p_item_id text,p_kind text,p_quantity numeric,
  p_unit_cost numeric,p_reason text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m public.cleo_memberships%ROWTYPE; balance public.cleo_stock_balances%ROWTYPE;
  previous public.cleo_stock_movements%ROWTYPE; item public.cleo_records%ROWTYPE;
  payload jsonb; result jsonb; delta numeric; new_cost numeric; threshold numeric;
BEGIN
  m:=public.cleo_require_actor(ARRAY['owner','hq','manager','clerk'],p_branch_id);
  IF p_branch_id IS NULL OR p_request_id IS NULL OR p_item_id IS NULL OR p_kind IS NULL
    OR p_kind NOT IN ('receive','adjust','count') OR p_quantity IS NULL
    OR abs(p_quantity)>100000000 OR round(p_quantity,6)<>p_quantity
    OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid stock movement.';
  END IF;
  IF (p_kind='receive' AND (p_quantity<=0 OR p_unit_cost IS NULL OR p_unit_cost NOT BETWEEN 0 AND 100000000 OR round(p_unit_cost,6)<>p_unit_cost))
    OR (p_kind<>'receive' AND p_unit_cost IS NOT NULL) OR (p_kind='count' AND p_quantity<0)
    OR (p_kind='adjust' AND p_quantity=0) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid movement quantity or cost.';
  END IF;
  PERFORM 1 FROM public.cleo_businesses WHERE id=m.business_id FOR UPDATE;
  payload:=jsonb_build_object('branch',p_branch_id,'item',p_item_id,'kind',p_kind,'quantity',p_quantity,
    'unitCost',p_unit_cost,'reason',btrim(p_reason),'actor',auth.uid());
  SELECT * INTO previous FROM public.cleo_stock_movements WHERE business_id=m.business_id AND request_id=p_request_id;
  IF FOUND THEN
    IF previous.request<>payload THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Request id already used for a different movement.';
    END IF;
    RETURN previous.result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.cleo_period_locks WHERE business_id=m.business_id
    AND month=date_trunc('month',now() AT TIME ZONE 'Asia/Manila')::date) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='This accounting period is locked.';
  END IF;
  SELECT * INTO item FROM public.cleo_records WHERE business_id=m.business_id AND kind='ingredients' AND id=p_item_id AND NOT archived;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Stock item not found.'; END IF;
  INSERT INTO public.cleo_stock_balances(business_id,branch_id,item_id) VALUES(m.business_id,p_branch_id,p_item_id) ON CONFLICT DO NOTHING;
  SELECT * INTO balance FROM public.cleo_stock_balances WHERE business_id=m.business_id AND branch_id=p_branch_id AND item_id=p_item_id FOR UPDATE;
  delta:=CASE WHEN p_kind='count' THEN p_quantity-balance.quantity ELSE p_quantity END;
  IF p_kind<>'receive' THEN
    SELECT COALESCE((document#>>ARRAY['limits',CASE WHEN p_kind='count' THEN 'countVariance' ELSE 'adjustApproval' END])::numeric,1000)
      INTO threshold FROM public.cleo_settings WHERE business_id=m.business_id;
    threshold:=COALESCE(threshold,1000);
    IF abs(delta)*balance.unit_cost>threshold AND m.role NOT IN ('owner','hq') THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='This stock variance needs owner or HQ approval.';
    END IF;
  END IF;
  new_cost:=CASE WHEN p_kind='receive' THEN round((greatest(balance.quantity,0)*balance.unit_cost+p_quantity*p_unit_cost)
    /(greatest(balance.quantity,0)+p_quantity),6) ELSE balance.unit_cost END;
  UPDATE public.cleo_stock_balances SET quantity=quantity+delta,unit_cost=new_cost
    WHERE business_id=m.business_id AND branch_id=p_branch_id AND item_id=p_item_id;
  result:=jsonb_build_object('ok',true,'approved',true,'needsApproval',false,'movementId',gen_random_uuid(),
    'item',item.data||jsonb_build_object('id',p_item_id,'_version',item.version,'cost',new_cost,
      'oh',(SELECT jsonb_object_agg(branch_id::text,quantity) FROM public.cleo_stock_balances
        WHERE business_id=m.business_id AND item_id=p_item_id AND (m.branch_id IS NULL OR branch_id=m.branch_id))),
    'branch',p_branch_id,'quantity',balance.quantity+delta,'unitCost',new_cost);
  INSERT INTO public.cleo_stock_movements(id,business_id,branch_id,item_id,request_id,actor_id,kind,quantity,unit_cost,reason,request,result)
    VALUES((result->>'movementId')::uuid,m.business_id,p_branch_id,p_item_id,p_request_id,auth.uid(),p_kind,delta,
      CASE WHEN p_kind='receive' THEN p_unit_cost ELSE balance.unit_cost END,btrim(p_reason),payload,result);
  PERFORM public.cleo_write_audit(m.business_id,p_branch_id,'stock.'||p_kind,p_item_id,
    jsonb_build_object('quantity',balance.quantity,'unitCost',balance.unit_cost),
    jsonb_build_object('quantity',balance.quantity+delta,'unitCost',new_cost));
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_post_stock(uuid,text,text,numeric,numeric,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_post_stock(uuid,text,text,numeric,numeric,text,uuid) TO authenticated;

-- Add the operational data without changing auth/business/plan semantics.
-- The previous implementation is retained internally for its verified identity contract.
ALTER FUNCTION public.cleo_bootstrap() RENAME TO cleo_identity_bootstrap;
REVOKE ALL ON FUNCTION public.cleo_identity_bootstrap() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.cleo_bootstrap()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE snapshot jsonb; m public.cleo_memberships%ROWTYPE; rows jsonb; category text; settings jsonb; settings_version integer;
BEGIN
  m:=public.cleo_require_actor(ARRAY['owner','hq','manager','cashier','kitchen','clerk','accountant']);
  snapshot:=public.cleo_identity_bootstrap();
  FOR category IN SELECT unnest(ARRAY['products','ingredients','categories','modifiers','customers']) LOOP
    SELECT COALESCE(jsonb_agg(r.data||jsonb_build_object('id',r.id,'_version',r.version)||
      CASE WHEN category='ingredients' THEN jsonb_build_object(
        'oh',COALESCE((SELECT jsonb_object_agg(b.branch_id::text,b.quantity) FROM public.cleo_stock_balances b
          WHERE b.business_id=m.business_id AND b.item_id=r.id AND (m.branch_id IS NULL OR m.branch_id=b.branch_id)),'{}'),
        'cost',COALESCE((SELECT b.unit_cost FROM public.cleo_stock_balances b
          WHERE b.business_id=m.business_id AND b.item_id=r.id AND (m.branch_id IS NULL OR m.branch_id=b.branch_id)
          ORDER BY b.branch_id LIMIT 1),0),
        '_branchCosts',COALESCE((SELECT jsonb_object_agg(b.branch_id::text,b.unit_cost) FROM public.cleo_stock_balances b
          WHERE b.business_id=m.business_id AND b.item_id=r.id AND (m.branch_id IS NULL OR m.branch_id=b.branch_id)),'{}'))
      ELSE '{}'::jsonb END ORDER BY r.id),'[]') INTO rows
      FROM public.cleo_records r WHERE r.business_id=m.business_id AND r.kind=category AND NOT r.archived;
    IF category='customers' THEN
      IF m.role NOT IN ('owner','hq','manager','cashier') THEN rows:='[]'; END IF;
      snapshot:=jsonb_set(snapshot,ARRAY['collections',category],rows);
    ELSE snapshot:=jsonb_set(snapshot,ARRAY['data',category],rows); END IF;
  END LOOP;
  SELECT document,version INTO settings,settings_version FROM public.cleo_settings WHERE business_id=m.business_id;
  IF settings IS NOT NULL THEN
    snapshot:=jsonb_set(snapshot,'{config}',(snapshot->'config')||settings);
    snapshot:=jsonb_set(snapshot,'{config,business}',jsonb_build_object('name',snapshot#>>'{data,biz,name}')||(settings->'business'));
    snapshot:=jsonb_set(snapshot,'{data,biz}',(snapshot#>'{data,biz}')||(settings->'business'));
  END IF;
  RETURN snapshot||jsonb_build_object('settingsVersion',COALESCE(settings_version,0));
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_bootstrap() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_bootstrap() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
