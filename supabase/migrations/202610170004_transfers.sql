-- Transfer state machine: request -> approve -> dispatch -> receive, or reject
-- before dispatch. Quantities, branch authorization and costs are server-owned.
BEGIN;
ALTER TABLE public.cleo_stock_movements DROP CONSTRAINT cleo_stock_movements_kind_check;
ALTER TABLE public.cleo_stock_movements ADD CONSTRAINT cleo_stock_movements_kind_check
  CHECK (kind IN ('receive','adjust','count','transfer_out','transfer_in'));
CREATE TABLE public.cleo_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  source_branch uuid NOT NULL,
  target_branch uuid NOT NULL,
  item_kind text NOT NULL DEFAULT 'ingredients' CHECK (item_kind='ingredients'),
  item_id text NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity>0),
  received_quantity numeric(20,6),
  unit_cost numeric(20,6),
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','dispatched','received','rejected')),
  version integer NOT NULL DEFAULT 1,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  dispatched_by uuid REFERENCES auth.users(id),
  received_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(source_branch<>target_branch),
  FOREIGN KEY (business_id,source_branch) REFERENCES public.cleo_branches(business_id,id),
  FOREIGN KEY (business_id,target_branch) REFERENCES public.cleo_branches(business_id,id),
  FOREIGN KEY (business_id,item_kind,item_id) REFERENCES public.cleo_records(business_id,kind,id)
);
CREATE TABLE public.cleo_transfer_requests (
  business_id uuid NOT NULL REFERENCES public.cleo_businesses(id),
  request_id uuid NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY(business_id,request_id)
);
ALTER TABLE public.cleo_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleo_transfer_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY cleo_transfer_read ON public.cleo_transfers FOR SELECT TO authenticated
 USING(public.cleo_can_access(business_id,source_branch) OR public.cleo_can_access(business_id,target_branch));
REVOKE ALL ON TABLE public.cleo_transfers,public.cleo_transfer_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.cleo_transfers TO authenticated;

CREATE FUNCTION public.cleo_create_transfer(p_from uuid,p_to uuid,p_item_id text,p_quantity numeric,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m public.cleo_memberships%ROWTYPE; transfer public.cleo_transfers%ROWTYPE;
 payload jsonb; previous public.cleo_transfer_requests%ROWTYPE; result jsonb;
BEGIN
 m:=public.cleo_require_actor(ARRAY['owner','hq','manager','clerk']);
 IF p_from IS NULL OR p_to IS NULL OR p_from=p_to OR p_item_id IS NULL OR p_request_id IS NULL
   OR p_quantity IS NULL OR p_quantity NOT BETWEEN 0.000001 AND 100000000 OR round(p_quantity,6)<>p_quantity THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Choose different branches, an item and a positive quantity.';
 END IF;
 IF NOT (public.cleo_can_access(m.business_id,p_from) OR public.cleo_can_access(m.business_id,p_to))
   OR (SELECT count(*) FROM public.cleo_branches WHERE business_id=m.business_id AND id IN(p_from,p_to))<>2 THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Branch access denied.';
 END IF;
 PERFORM 1 FROM public.cleo_businesses WHERE id=m.business_id FOR UPDATE;
 payload:=jsonb_build_object('action','create','from',p_from,'to',p_to,'item',p_item_id,'quantity',p_quantity,'actor',auth.uid());
 SELECT * INTO previous FROM public.cleo_transfer_requests WHERE business_id=m.business_id AND request_id=p_request_id;
 IF FOUND THEN
   IF previous.payload<>payload THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Request id already used.'; END IF;
   RETURN previous.result;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.cleo_records WHERE business_id=m.business_id AND kind='ingredients' AND id=p_item_id AND NOT archived) THEN
   RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Stock item not found.';
 END IF;
 INSERT INTO public.cleo_transfers(business_id,source_branch,target_branch,item_id,quantity,requested_by)
   VALUES(m.business_id,p_from,p_to,p_item_id,p_quantity,auth.uid()) RETURNING * INTO transfer;
 result:=jsonb_build_object('ok',true,'transfer',to_jsonb(transfer));
 INSERT INTO public.cleo_transfer_requests VALUES(m.business_id,p_request_id,payload,result);
 PERFORM public.cleo_write_audit(m.business_id,p_from,'transfer.request',transfer.id::text,NULL,
   jsonb_build_object('target',p_to,'item',p_item_id,'quantity',p_quantity));
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_create_transfer(uuid,uuid,text,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_create_transfer(uuid,uuid,text,numeric,uuid) TO authenticated;

CREATE FUNCTION public.cleo_advance_transfer(p_id uuid,p_action text,p_expected_version integer,p_request_id uuid,p_received numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE m public.cleo_memberships%ROWTYPE; transfer public.cleo_transfers%ROWTYPE;
 payload jsonb; previous public.cleo_transfer_requests%ROWTYPE; result jsonb;
 stock public.cleo_stock_balances%ROWTYPE; destination public.cleo_stock_balances%ROWTYPE;
 delta numeric; accepted numeric; new_cost numeric; next_status text; branch uuid;
BEGIN
 m:=public.cleo_require_actor(ARRAY['owner','hq','manager','clerk']);
 IF p_id IS NULL OR p_request_id IS NULL OR p_action IS NULL OR p_action NOT IN('approve','dispatch','receive','reject') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid transfer action.';
 END IF;
 PERFORM 1 FROM public.cleo_businesses WHERE id=m.business_id FOR UPDATE;
 payload:=jsonb_build_object('action',p_action,'id',p_id,'version',p_expected_version,'received',p_received,'actor',auth.uid());
 SELECT * INTO transfer FROM public.cleo_transfers WHERE business_id=m.business_id AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Transfer not found.'; END IF;
 branch:=CASE WHEN p_action='receive' THEN transfer.target_branch ELSE transfer.source_branch END;
 IF NOT public.cleo_can_access(m.business_id,branch) OR (p_action IN('approve','reject') AND m.role NOT IN('owner','hq','manager')) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Your role or branch cannot perform this transfer action.';
 END IF;
 SELECT * INTO previous FROM public.cleo_transfer_requests WHERE business_id=m.business_id AND request_id=p_request_id;
 IF FOUND THEN
   IF previous.payload<>payload THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Request id already used.'; END IF;
   RETURN previous.result;
 END IF;
 IF transfer.version IS DISTINCT FROM p_expected_version THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Transfer changed. Refresh before continuing.';
 END IF;
 IF (p_action='approve' AND transfer.status<>'requested') OR (p_action='dispatch' AND transfer.status<>'approved')
   OR (p_action='receive' AND transfer.status<>'dispatched') OR (p_action='reject' AND transfer.status NOT IN('requested','approved')) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid transfer state transition.';
 END IF;
 IF p_action<>'receive' AND p_received IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Received quantity is only valid when receiving.';
 END IF;
 IF p_action IN('dispatch','receive') THEN
   IF EXISTS (SELECT 1 FROM public.cleo_period_locks WHERE business_id=m.business_id
     AND month=date_trunc('month',now() AT TIME ZONE 'Asia/Manila')::date) THEN
     RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='This accounting period is locked.';
   END IF;
   IF p_action='dispatch' THEN
     SELECT * INTO stock FROM public.cleo_stock_balances WHERE business_id=m.business_id
       AND branch_id=transfer.source_branch AND item_id=transfer.item_id FOR UPDATE;
     IF NOT FOUND OR stock.quantity<transfer.quantity THEN
       RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Insufficient stock for dispatch.';
     END IF;
     UPDATE public.cleo_stock_balances SET quantity=quantity-transfer.quantity
       WHERE business_id=m.business_id AND branch_id=transfer.source_branch AND item_id=transfer.item_id;
     transfer.unit_cost:=stock.unit_cost;
     delta:=-transfer.quantity;
   ELSE
     accepted:=COALESCE(p_received,transfer.quantity);
     IF accepted NOT BETWEEN 0 AND transfer.quantity OR round(accepted,6)<>accepted THEN
       RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Received quantity must be between zero and dispatched quantity.';
     END IF;
     IF accepted<>transfer.quantity AND m.role NOT IN('owner','hq','manager') THEN
       RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='A manager must accept a transfer shortage.';
     END IF;
     INSERT INTO public.cleo_stock_balances(business_id,branch_id,item_id) VALUES(m.business_id,branch,transfer.item_id) ON CONFLICT DO NOTHING;
     SELECT * INTO destination FROM public.cleo_stock_balances WHERE business_id=m.business_id AND branch_id=branch AND item_id=transfer.item_id FOR UPDATE;
     new_cost:=CASE WHEN accepted=0 THEN destination.unit_cost ELSE round((greatest(destination.quantity,0)*destination.unit_cost
       +accepted*transfer.unit_cost)/(greatest(destination.quantity,0)+accepted),6) END;
     UPDATE public.cleo_stock_balances SET quantity=quantity+accepted,unit_cost=new_cost
       WHERE business_id=m.business_id AND branch_id=branch AND item_id=transfer.item_id;
     transfer.received_quantity:=accepted;
     delta:=accepted;
   END IF;
   INSERT INTO public.cleo_stock_movements(business_id,branch_id,item_id,request_id,actor_id,kind,quantity,unit_cost,reason,request,result)
     VALUES(m.business_id,branch,transfer.item_id,p_request_id,auth.uid(),CASE WHEN p_action='dispatch' THEN 'transfer_out' ELSE 'transfer_in' END,
       delta,transfer.unit_cost,'Transfer '||transfer.id::text,payload,jsonb_build_object('ok',true,'transferId',transfer.id));
 END IF;
 next_status:=CASE p_action WHEN 'approve' THEN 'approved' WHEN 'dispatch' THEN 'dispatched' WHEN 'receive' THEN 'received' ELSE 'rejected' END;
 UPDATE public.cleo_transfers SET status=next_status,version=version+1,updated_at=now(),
   approved_by=CASE WHEN p_action='approve' THEN auth.uid() ELSE approved_by END,
   dispatched_by=CASE WHEN p_action='dispatch' THEN auth.uid() ELSE dispatched_by END,
   received_by=CASE WHEN p_action='receive' THEN auth.uid() ELSE received_by END,
   unit_cost=transfer.unit_cost,received_quantity=transfer.received_quantity
   WHERE id=p_id RETURNING * INTO transfer;
 result:=jsonb_build_object('ok',true,'transfer',to_jsonb(transfer));
 INSERT INTO public.cleo_transfer_requests VALUES(m.business_id,p_request_id,payload,result);
 PERFORM public.cleo_write_audit(m.business_id,branch,'transfer.'||p_action,p_id::text,
   jsonb_build_object('version',p_expected_version),to_jsonb(transfer));
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_advance_transfer(uuid,text,integer,uuid,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleo_advance_transfer(uuid,text,integer,uuid,numeric) TO authenticated;

-- Do not archive an item referenced by an open transfer. All record/transfer
-- mutations lock the same business row, so creation cannot race with archive.
CREATE FUNCTION public.cleo_guard_open_transfer_archive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
 IF NEW.kind='ingredients' AND NEW.archived AND NOT OLD.archived AND EXISTS (
   SELECT 1 FROM public.cleo_transfers WHERE business_id=NEW.business_id AND item_id=NEW.id AND status IN('requested','approved','dispatched')) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Stock item is on an open transfer.';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.cleo_guard_open_transfer_archive() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER cleo_open_transfer_archive BEFORE UPDATE OF archived ON public.cleo_records
 FOR EACH ROW EXECUTE FUNCTION public.cleo_guard_open_transfer_archive();
NOTIFY pgrst,'reload schema';
COMMIT;
