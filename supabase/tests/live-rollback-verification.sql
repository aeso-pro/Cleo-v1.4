-- Execute once as postgres in Supabase SQL Editor after the migration.
-- No email, provider sign-in, or password is used. Every fixture and write rolls back.
-- Any failed assertion aborts the transaction; issue ROLLBACK if your client stops early.
BEGIN;
CREATE TEMP TABLE cleo_verification_actors(label text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE cleo_verification_results(check_name text, passed boolean NOT NULL) ON COMMIT DROP;
INSERT INTO cleo_verification_actors VALUES ('alice', gen_random_uuid()), ('bob', gen_random_uuid());
GRANT SELECT ON cleo_verification_actors TO authenticated;
GRANT INSERT, SELECT ON cleo_verification_results TO authenticated;

-- A fake display-metadata Owner must have no authority before onboarding.
INSERT INTO auth.users(id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
SELECT id, 'authenticated', 'authenticated', 'cleo-verify-' || id::text || '@example.invalid', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('name', 'Cleo rollback ' || label, 'role', 'Owner'), now(), now()
FROM cleo_verification_actors;

SELECT set_config('request.jwt.claims', jsonb_build_object('sub', id, 'role', 'authenticated', 'aal', 'aal1')::text, true),
       set_config('request.jwt.claim.sub', id::text, true)
FROM cleo_verification_actors WHERE label = 'alice';
SET LOCAL ROLE authenticated;
DO $test$
DECLARE c jsonb; first_id uuid; snapshot jsonb; first_acceptance jsonb; second_acceptance jsonb;
BEGIN
  c := public.cleo_auth_context();
  IF (c #>> '{account,needsBusiness}')::boolean IS DISTINCT FROM true
     OR c #>> '{account,role}' IS NOT NULL OR c -> 'business' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'FAIL: Auth metadata granted a business or role';
  END IF;
  INSERT INTO pg_temp.cleo_verification_results VALUES ('Metadata cannot assign tenant or owner role', true);

  BEGIN
    PERFORM public.cleo_create_business('{"name":"Rollback Alice"}', '["retail"]', '{"name":"Alice","role":"owner"}');
    RAISE EXCEPTION 'FAIL: client role field accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  INSERT INTO pg_temp.cleo_verification_results VALUES ('Client-supplied role rejected', true);

  c := public.cleo_create_business('{"name":"Rollback Alice"}', '["retail"]', '{"name":"Alice"}');
  first_id := (c #>> '{business,id}')::uuid;
  IF first_id IS NULL OR c #>> '{account,role}' IS DISTINCT FROM 'Owner'
     OR c #>> '{branch,name}' IS DISTINCT FROM 'Main branch' THEN
    RAISE EXCEPTION 'FAIL: business, branch, owner context not created';
  END IF;
  INSERT INTO pg_temp.cleo_verification_results VALUES ('Business and first branch created with caller owner membership', true);
  c := public.cleo_create_business('{"name":"Duplicate"}', '["fnb"]', '{"name":"Alice"}');
  IF (c #>> '{business,id}')::uuid IS DISTINCT FROM first_id
     OR c #>> '{business,name}' IS DISTINCT FROM 'Rollback Alice' THEN
    RAISE EXCEPTION 'FAIL: onboarding retry changed business';
  END IF;
  INSERT INTO pg_temp.cleo_verification_results VALUES ('Repeated onboarding returns original business', true);

  BEGIN
    PERFORM public.cleo_bootstrap();
    RAISE EXCEPTION 'FAIL: bootstrap allowed without legal acceptance';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  first_acceptance := public.cleo_accept_legal('privacy 1.0, terms 1.0', 'email');
  second_acceptance := public.cleo_accept_legal('privacy 1.0, terms 1.0', 'oauth');
  IF first_acceptance ->> 'at' IS NULL OR first_acceptance ->> 'at' IS DISTINCT FROM second_acceptance ->> 'at' THEN
    RAISE EXCEPTION 'FAIL: legal timestamp missing or changed on retry';
  END IF;
  snapshot := public.cleo_bootstrap();
  IF snapshot #>> '{data,biz,name}' IS DISTINCT FROM 'Rollback Alice'
     OR jsonb_array_length(snapshot #> '{data,branches}') <> 1
     OR snapshot #> '{data,products}' IS DISTINCT FROM '[]'::jsonb
     OR snapshot -> 'subscription' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'FAIL: bootstrap identity/catalog/subscription incorrect';
  END IF;
  INSERT INTO pg_temp.cleo_verification_results VALUES ('Current legal acceptance required and idempotent; safe bootstrap succeeds', true);

  BEGIN
    UPDATE public.cleo_memberships SET role = 'owner';
    RAISE EXCEPTION 'FAIL: browser direct membership update allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO pg_temp.cleo_verification_results VALUES ('Direct membership update denied', true);
END;
$test$;
RESET ROLE;

SELECT set_config('request.jwt.claims', jsonb_build_object('sub', id, 'role', 'authenticated', 'aal', 'aal1')::text, true),
       set_config('request.jwt.claim.sub', id::text, true)
FROM cleo_verification_actors WHERE label = 'bob';
SET LOCAL ROLE authenticated;
DO $test$
DECLARE c jsonb; n integer;
BEGIN
  c := public.cleo_auth_context();
  SELECT count(*) INTO n FROM public.cleo_businesses;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: Bob can see another tenant business'; END IF;
  SELECT count(*) INTO n FROM public.cleo_branches;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: Bob can see another tenant branch'; END IF;
  SELECT count(*) INTO n FROM public.cleo_profiles p
    WHERE p.user_id = (SELECT id FROM pg_temp.cleo_verification_actors WHERE label = 'alice');
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: Bob can see Alice profile'; END IF;
  INSERT INTO pg_temp.cleo_verification_results VALUES ('Second account cannot read first tenant business, branch, or profile', true);
  c := public.cleo_create_business('{"name":"Rollback Bob"}', '["svc"]', '{"name":"Bob"}');
  SELECT count(*) INTO n FROM public.cleo_businesses WHERE name = 'Rollback Bob';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: Bob cannot read own tenant'; END IF;
  SELECT count(*) INTO n FROM public.cleo_businesses WHERE name = 'Rollback Alice';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: Bob can see Alice after onboarding'; END IF;
  INSERT INTO pg_temp.cleo_verification_results VALUES ('Second account resolves only its own business after onboarding', true);
END;
$test$;
RESET ROLE;

DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace s ON s.oid = c.relnamespace
    WHERE s.nspname = 'public' AND c.relname IN ('cleo_profiles', 'cleo_businesses', 'cleo_branches',
      'cleo_memberships', 'cleo_legal_acceptances') AND c.relrowsecurity;
  IF n <> 5 THEN RAISE EXCEPTION 'FAIL: all five tables must enable RLS'; END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace s ON s.oid = p.pronamespace
    WHERE s.nspname = 'public' AND p.proname IN ('cleo_auth_context', 'cleo_create_business',
      'cleo_accept_legal', 'cleo_bootstrap', 'cleo_session_is_strong') AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF n <> 5 THEN RAISE EXCEPTION 'FAIL: function ACL/search_path is incorrect'; END IF;
  INSERT INTO pg_temp.cleo_verification_results VALUES ('All tables enable RLS; all five functions pin search_path and deny anon', true);
END;
$test$;

SELECT check_name, passed, 'All synthetic users and application rows are rolled back by the following ROLLBACK.' AS cleanup
FROM cleo_verification_results ORDER BY check_name;
ROLLBACK;
