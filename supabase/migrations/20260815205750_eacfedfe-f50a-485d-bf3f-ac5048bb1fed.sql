
-- ROLES
CREATE TYPE public.app_role AS ENUM ('admin');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "own roles readable" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

-- first user becomes admin
CREATE OR REPLACE FUNCTION public.grant_first_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created_grant_admin
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.grant_first_admin();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- COUNTRIES
CREATE TABLE public.countries (
  code text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.countries TO authenticated;
GRANT ALL ON public.countries TO service_role;
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage countries" ON public.countries FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.countries (code, name) VALUES
 ('KW','Kuwait'),('AE','United Arab Emirates'),('QA','Qatar'),('SA','Saudi Arabia'),
 ('BH','Bahrain'),('OM','Oman'),('EG','Egypt'),('JO','Jordan'),('LB','Lebanon'),
 ('GB','United Kingdom'),('DE','Germany'),('FR','France'),('IT','Italy'),
 ('ES','Spain'),('NL','Netherlands'),('SE','Sweden'),('TR','Turkey'),('US','United States');

-- DATASETS
CREATE TABLE public.datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country_code text NOT NULL REFERENCES public.countries(code),
  source_filename text,
  status text NOT NULL DEFAULT 'pending',
  total_rows bigint NOT NULL DEFAULT 0,
  inserted_rows bigint NOT NULL DEFAULT 0,
  duplicate_rows bigint NOT NULL DEFAULT 0,
  error_message text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.datasets TO authenticated;
GRANT ALL ON public.datasets TO service_role;
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage datasets" ON public.datasets FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER datasets_touch BEFORE UPDATE ON public.datasets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX datasets_country_idx ON public.datasets (country_code);

-- LEADS
CREATE TABLE public.leads (
  id bigserial PRIMARY KEY,
  dataset_id uuid NOT NULL REFERENCES public.datasets(id) ON DELETE CASCADE,
  country_code text NOT NULL REFERENCES public.countries(code),
  full_name text,
  phone text,
  email text,
  city text,
  company text,
  job_title text,
  website text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage leads" ON public.leads FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER leads_touch BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX leads_country_idx ON public.leads (country_code);
CREATE INDEX leads_dataset_idx ON public.leads (dataset_id);
CREATE INDEX leads_updated_idx ON public.leads (updated_at);
CREATE UNIQUE INDEX leads_country_phone_uidx ON public.leads (country_code, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX leads_country_email_uidx ON public.leads (country_code, lower(email)) WHERE email IS NOT NULL;

-- API KEYS
CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  rate_limit_per_hour integer NOT NULL DEFAULT 1000,
  expires_at timestamptz,
  last_used_at timestamptz,
  request_count bigint NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage api keys" ON public.api_keys FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER api_keys_touch BEFORE UPDATE ON public.api_keys FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.api_key_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  country_code text REFERENCES public.countries(code) ON DELETE CASCADE,
  dataset_id uuid REFERENCES public.datasets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_key_scopes TO authenticated;
GRANT ALL ON public.api_key_scopes TO service_role;
ALTER TABLE public.api_key_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage scopes" ON public.api_key_scopes FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX api_key_scopes_key_idx ON public.api_key_scopes (api_key_id);

-- USAGE LOGS
CREATE TABLE public.api_usage_logs (
  id bigserial PRIMARY KEY,
  api_key_id uuid REFERENCES public.api_keys(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  query_params jsonb,
  status_code integer NOT NULL,
  rows_returned integer NOT NULL DEFAULT 0,
  response_ms integer,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_usage_logs TO authenticated;
GRANT ALL ON public.api_usage_logs TO service_role;
ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read logs" ON public.api_usage_logs FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX api_usage_logs_key_idx ON public.api_usage_logs (api_key_id, created_at DESC);
