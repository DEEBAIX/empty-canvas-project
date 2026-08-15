
CREATE OR REPLACE FUNCTION public.ingest_leads(_dataset_id uuid, _rows jsonb)
RETURNS TABLE(inserted integer, duplicates integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _country text; _total int; _ins int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT country_code INTO _country FROM public.datasets WHERE id = _dataset_id;
  IF _country IS NULL THEN RAISE EXCEPTION 'dataset not found'; END IF;
  _total := jsonb_array_length(_rows);

  WITH src AS (
    SELECT * FROM jsonb_to_recordset(_rows) AS x(
      full_name text, phone text, email text, city text,
      company text, job_title text, website text, extra jsonb)
  ), ins AS (
    INSERT INTO public.leads (dataset_id, country_code, full_name, phone, email, city, company, job_title, website, extra)
    SELECT _dataset_id, _country,
      nullif(btrim(full_name),''), nullif(btrim(phone),''), nullif(lower(btrim(email)),''),
      nullif(btrim(city),''), nullif(btrim(company),''), nullif(btrim(job_title),''),
      nullif(btrim(website),''), coalesce(extra, '{}'::jsonb)
    FROM src
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO _ins FROM ins;

  UPDATE public.datasets
     SET total_rows = total_rows + _total,
         inserted_rows = inserted_rows + _ins,
         duplicate_rows = duplicate_rows + (_total - _ins),
         status = 'processing'
   WHERE id = _dataset_id;

  RETURN QUERY SELECT _ins, _total - _ins;
END $$;

REVOKE ALL ON FUNCTION public.ingest_leads(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ingest_leads(uuid, jsonb) TO authenticated;
