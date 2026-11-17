-- ============================================================================
-- Hanekom Innovations - complete database setup for the customer data
-- collection project (Supabase project ref: kqcnyewlkludlvtocsze)
--
-- Safe to run more than once (idempotent). Run as the postgres role via the
-- Supabase Management API "database/query" endpoint or the dashboard SQL
-- editor.
--
-- What this installs:
--   1. Extensions (pg_cron, pg_net)
--   2. Core CRM tables: customers, leads, quotation_requests, quotation_items,
--      activities
--   3. Queue tables: inquiry_queue, google_drive_backup_queue,
--      google_drive_backup_rows, submission_rate_log
--   4. Functions: enqueue_inquiry, create_website_lead,
--      process_website_inquiry, enforce_submission_rate
--   5. Google Drive backup row unpacking trigger
--   6. Reporting views (owner-only)
--   7. Security lock-down: Row Level Security on every table, every direct
--      grant to anon/authenticated revoked, only service_role (the key used
--      server-side by the edge functions) may touch the data. The public
--      publishable key can therefore read or write NOTHING through the
--      REST API.
--   8. Daily-operation cron: flushes the Google Drive backup queue
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Extensions
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ----------------------------------------------------------------------------
-- 2) Core CRM tables
-- ----------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  company_name text,
  phone text,
  whatsapp_number text,
  email text,
  location text,
  industry text,
  preferred_channel text default 'whatsapp',
  consent_to_contact boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_contact_check check (
    (email is not null and length(email) > 0)
    or (phone is not null and length(phone) > 0)
    or (whatsapp_number is not null and length(whatsapp_number) > 0)
  )
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  source text not null default 'website',
  interest text,
  status text not null default 'new',
  priority text not null default 'normal',
  next_follow_up_at timestamptz,
  follow_up_frequency_days integer,
  conversation_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotation_requests (
  id uuid primary key default gen_random_uuid(),
  reference_number text unique,
  customer_id uuid references public.customers(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  delivery_location text,
  required_date date,
  customer_notes text,
  status text not null default 'received',
  currency text not null default 'ZMW',
  vat_rate numeric not null default 16.00,
  prices_include_vat boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_request_id uuid not null references public.quotation_requests(id) on delete cascade,
  product_code text,
  product_name text not null default 'Unspecified product',
  description text,
  quantity numeric not null default 1,
  unit text not null default 'each',
  selected_size text,
  selected_colour text,
  specifications text,
  product_url text,
  image_url text,
  unit_price_ex_vat numeric,
  line_total_ex_vat numeric
    generated always as (round(quantity * coalesce(unit_price_ex_vat, 0), 2)) stored,
  created_at timestamptz not null default now(),
  constraint quotation_items_quantity_check check (quantity >= 0)
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  activity_type text not null,
  description text,
  performed_by text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3) Queue tables
-- ----------------------------------------------------------------------------
create table if not exists public.inquiry_queue (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique,
  source text not null default 'website',
  inquiry_type text not null default 'general',
  status text not null default 'received',
  payload jsonb not null,
  processing_result jsonb,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_drive_backup_queue (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique,
  source text not null default 'website',
  inquiry_type text not null default 'general',
  quotation_request_id uuid,
  customer_id uuid,
  lead_id uuid,
  backup_status text not null default 'pending',
  backup_payload jsonb,
  attempts integer not null default 0,
  backed_up_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_drive_backup_rows (
  id uuid primary key default gen_random_uuid(),
  request_key text not null,
  line_number integer not null,
  quotation_reference text,
  quotation_status text,
  quotation_created_at timestamptz,
  company_name text,
  contact_person text,
  email text,
  phone text,
  whatsapp_number text,
  delivery_location text,
  preferred_channel text,
  customer_notes text,
  product_code text,
  product_name text,
  item_description text,
  quantity numeric,
  unit text,
  selected_size text,
  selected_colour text,
  specifications text,
  currency text,
  unit_price_ex_vat numeric,
  line_total_ex_vat numeric,
  created_at timestamptz not null default now(),
  unique (request_key, line_number)
);

-- Abuse protection: one row per accepted submission, keyed by client IP.
create table if not exists public.submission_rate_log (
  id bigint generated always as identity primary key,
  client_ip text not null,
  request_key text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4) Functions
-- ----------------------------------------------------------------------------

-- Helper: parse untrusted text as a number without ever raising.
create or replace function public.safe_numeric(v text)
returns numeric
language plpgsql
immutable
as $fn$
begin
  if v is null then return null; end if;
  begin
    return v::numeric;
  exception when others then
    return null;
  end;
end;
$fn$;

-- Queue a new enquiry, deduplicated by request key.
create or replace function public.enqueue_inquiry(
  p_payload jsonb,
  p_request_key text,
  p_source text,
  p_inquiry_type text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_id uuid;
  v_existing uuid;
begin
  if p_request_key is null or length(trim(p_request_key)) = 0 then
    p_request_key := 'auto-' || gen_random_uuid()::text;
  end if;

  select id into v_existing from public.inquiry_queue where request_key = p_request_key;
  if v_existing is not null then
    return jsonb_build_object('queue_id', v_existing, 'duplicate', true);
  end if;

  insert into public.inquiry_queue (request_key, source, inquiry_type, payload)
  values (p_request_key, coalesce(p_source, 'website'),
          coalesce(p_inquiry_type, 'general'), p_payload)
  on conflict (request_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_existing from public.inquiry_queue where request_key = p_request_key;
    return jsonb_build_object('queue_id', v_existing, 'duplicate', true);
  end if;

  return jsonb_build_object('queue_id', v_id, 'duplicate', false);
end;
$function$;

-- Turn a website enquiry payload into customer + lead (+ quotation) records.
create or replace function public.create_website_lead(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_customer_id uuid;
  v_lead_id uuid;
  v_quote_id uuid;
  v_reference text;
  v_name text := nullif(trim(p_payload->>'full_name'), '');
  v_phone text := nullif(trim(p_payload->>'phone'), '');
  v_whatsapp text := nullif(trim(p_payload->>'whatsapp_number'), '');
  v_email text := nullif(lower(trim(p_payload->>'email')), '');
  v_interest text := coalesce(nullif(trim(p_payload->>'interest'), ''), 'General procurement enquiry');
  v_message text := nullif(trim(p_payload->>'message'), '');
  v_item jsonb;
  v_items jsonb := coalesce(nullif(p_payload->'quotation_items', 'null'::jsonb), nullif(p_payload->'items', 'null'::jsonb), '[]'::jsonb);
begin
  if v_name is null then
    raise exception 'Customer name is required';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'A phone number or email address is required';
  end if;

  -- Serialize customer matching so simultaneous submissions cannot create duplicates.
  lock table public.customers in share row exclusive mode;
  select id into v_customer_id
  from public.customers
  where (v_email is not null and lower(trim(email)) = v_email)
     or (
       (v_email is null or nullif(lower(trim(email)), '') is null)
       and (
         (nullif(regexp_replace(v_phone, '[^0-9]', '', 'g'), '') is not null
          and regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(v_phone, '[^0-9]', '', 'g'))
         or (nullif(regexp_replace(v_whatsapp, '[^0-9]', '', 'g'), '') is not null
          and regexp_replace(whatsapp_number, '[^0-9]', '', 'g') = regexp_replace(v_whatsapp, '[^0-9]', '', 'g'))
       )
     )
  order by case when v_email is not null and lower(trim(email)) = v_email then 0 else 1 end, created_at
  limit 1;

  if v_customer_id is null then
    insert into public.customers (
      full_name, company_name, phone, whatsapp_number, email, location, industry,
      preferred_channel, consent_to_contact, notes
    ) values (
      v_name,
      nullif(trim(p_payload->>'company_name'), ''),
      v_phone,
      coalesce(v_whatsapp, v_phone),
      v_email,
      nullif(trim(p_payload->>'location'), ''),
      nullif(trim(p_payload->>'industry'), ''),
      coalesce(nullif(trim(p_payload->>'preferred_channel'), ''), 'whatsapp'),
      coalesce((p_payload->>'consent_to_contact')::boolean, false),
      'Created from website enquiry'
    ) returning id into v_customer_id;
  else
    update public.customers set
      full_name = coalesce(v_name, full_name),
      company_name = coalesce(nullif(trim(p_payload->>'company_name'), ''), company_name),
      phone = coalesce(v_phone, phone),
      whatsapp_number = coalesce(v_whatsapp, whatsapp_number),
      email = coalesce(v_email, email),
      location = coalesce(nullif(trim(p_payload->>'location'), ''), location),
      industry = coalesce(nullif(trim(p_payload->>'industry'), ''), industry),
      consent_to_contact = consent_to_contact or coalesce((p_payload->>'consent_to_contact')::boolean, false),
      updated_at = now()
    where id = v_customer_id;
  end if;

  insert into public.leads (
    customer_id, source, interest, status, priority, next_follow_up_at,
    follow_up_frequency_days, conversation_summary
  ) values (
    v_customer_id,
    coalesce(nullif(trim(p_payload->>'source'), ''), 'website'),
    v_interest,
    'new',
    case when jsonb_array_length(v_items) >= 5 then 'high' else 'normal' end,
    now() + interval '1 day',
    7,
    'New website enquiry: ' || v_interest
      || coalesce(chr(10) || chr(10) || 'Customer message: ' || left(v_message, 2000), '')
  ) returning id into v_lead_id;

  if p_payload->>'inquiry_type' = 'quotation' or jsonb_array_length(v_items) > 0 then
    v_reference := 'HIL-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    insert into public.quotation_requests (
      reference_number, customer_id, lead_id, delivery_location,
      required_date, customer_notes, status, currency, vat_rate,
      prices_include_vat
    ) values (
      v_reference,
      v_customer_id,
      v_lead_id,
      nullif(trim(p_payload->>'delivery_location'), ''),
      case when coalesce(p_payload->>'required_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
        then (p_payload->>'required_date')::date else null end,
      nullif(trim(p_payload->>'notes'), ''),
      'received',
      coalesce(nullif(trim(p_payload->>'currency'), ''), 'ZMW'),
      16.00,
      false
    ) returning id into v_quote_id;

    for v_item in select * from jsonb_array_elements(v_items)
    loop
      insert into public.quotation_items (
        quotation_request_id, product_code, product_name, description, quantity, unit,
        selected_size, selected_colour, specifications, product_url, image_url,
        unit_price_ex_vat
      ) values (
        v_quote_id,
        nullif(trim(v_item->>'product_code'), ''),
        coalesce(nullif(trim(v_item->>'product_name'), ''), 'Unspecified product'),
        nullif(trim(v_item->>'description'), ''),
        greatest(coalesce(safe_numeric(v_item->>'quantity'), 1), 1),
        coalesce(nullif(trim(v_item->>'unit'), ''), 'each'),
        coalesce(nullif(trim(v_item->>'selected_size'), ''), nullif(trim(v_item->>'size'), '')),
        coalesce(nullif(trim(v_item->>'selected_colour'), ''), nullif(trim(v_item->>'colour'), '')),
        nullif(trim(v_item->>'specifications'), ''),
        nullif(trim(v_item->>'product_url'), ''),
        nullif(trim(v_item->>'image_url'), ''),
        safe_numeric(v_item->>'unit_price_ex_vat')
      );
    end loop;

    update public.leads set status = 'quotation required' where id = v_lead_id;
  end if;

  insert into public.activities(customer_id, lead_id, activity_type, description, performed_by)
  values (v_customer_id, v_lead_id, 'website_enquiry_received', v_interest, 'website');

  return jsonb_build_object(
    'success', true,
    'customer_id', v_customer_id,
    'lead_id', v_lead_id,
    'quotation_id', v_quote_id,
    'reference_number', v_reference,
    'message', case when v_reference is null
      then 'Thank you. Hanekom Innovations has received your enquiry.'
      else 'Thank you. Hanekom Innovations has received quotation request ' || v_reference || '.' end
  );
end;
$function$;

-- Process a queued enquiry: dedupe, create the records, queue the backup.
create or replace function public.process_website_inquiry(p_payload jsonb, p_request_key text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_enqueue jsonb;
  v_queue public.inquiry_queue%rowtype;
  v_result jsonb;
  v_backup jsonb;
begin
  v_enqueue := public.enqueue_inquiry(p_payload, p_request_key, 'website',
    coalesce(p_payload->>'inquiry_type', 'general'));
  select * into strict v_queue from public.inquiry_queue
    where id = (v_enqueue->>'queue_id')::uuid for update;

  -- Lock the request and save the quotation and backup job in one transaction.
  if (v_queue.payload - 'received_at') is distinct from (p_payload - 'received_at') then
    raise exception 'Request key already belongs to a different enquiry';
  end if;
  if v_queue.status = 'completed' then
    if v_queue.processing_result is null then
      raise exception 'Legacy request already processed; contact sales for its reference';
    end if;
    return v_queue.processing_result || jsonb_build_object('duplicate', true);
  end if;

  v_result := public.create_website_lead(v_queue.payload);
  v_backup := v_queue.payload || jsonb_build_object(
    'request_key', v_queue.request_key,
    'customer_id', v_result->'customer_id',
    'lead_id', v_result->'lead_id',
    'quotation_id', v_result->'quotation_id',
    'reference_number', v_result->'reference_number');
  insert into public.google_drive_backup_queue
    (request_key, source, inquiry_type, quotation_request_id, customer_id,
     lead_id, backup_status, backup_payload)
  values (v_queue.request_key, 'website', v_queue.inquiry_type,
    (v_result->>'quotation_id')::uuid, (v_result->>'customer_id')::uuid,
    (v_result->>'lead_id')::uuid,
    case when v_queue.inquiry_type = 'quotation' then 'pending' else 'skipped' end,
    v_backup);

  v_result := jsonb_build_object(
    'ok', true, 'queued', true, 'processed', true, 'duplicate', false,
    'request_key', v_queue.request_key,
    'reference_number', v_result->'reference_number',
    'backup_payload', v_backup);
  update public.inquiry_queue set status = 'completed', processed_at = now(),
    updated_at = now(), last_error = null, processing_result = v_result
    where id = v_queue.id;
  return v_result;
end;
$function$;

-- Abuse protection: max 10 submissions per client IP per hour, 30 per day.
create or replace function public.enforce_submission_rate(p_client_ip text, p_request_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_hour integer;
  v_day integer;
begin
  if p_client_ip is null or length(trim(p_client_ip)) < 7 then
    return jsonb_build_object('allowed', true);
  end if;

  -- Housekeeping: rows older than 25 hours are useless.
  delete from public.submission_rate_log where created_at < now() - interval '25 hours';

  select count(*) into v_hour from public.submission_rate_log
    where client_ip = p_client_ip and created_at > now() - interval '1 hour';
  select count(*) into v_day from public.submission_rate_log
    where client_ip = p_client_ip and created_at > now() - interval '24 hours';

  insert into public.submission_rate_log (client_ip, request_key)
  values (p_client_ip, left(coalesce(p_request_key, ''), 160));

  if v_hour >= 10 or v_day >= 30 then
    return jsonb_build_object('allowed', false, 'reason', 'Too many submissions from this network');
  end if;
  return jsonb_build_object('allowed', true, 'hourly', v_hour + 1, 'daily', v_day + 1);
end;
$function$;

-- ----------------------------------------------------------------------------
-- 5) Google Drive backup row unpacking (queue row -> flat sheet rows)
-- ----------------------------------------------------------------------------
create or replace function public.unpack_google_drive_backup_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_item jsonb;
  v_line integer := 0;
  v_items jsonb;
begin
  if new.backup_payload is null then return new; end if;
  v_items := coalesce(nullif(new.backup_payload->'quotation_items', 'null'::jsonb),
                      nullif(new.backup_payload->'items', 'null'::jsonb), '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' then return new; end if;

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    v_line := v_line + 1;
    insert into public.google_drive_backup_rows (
      request_key, line_number, quotation_reference, quotation_status, quotation_created_at,
      company_name, contact_person, email, phone, whatsapp_number, delivery_location,
      preferred_channel, customer_notes, product_code, product_name, item_description,
      quantity, unit, selected_size, selected_colour, specifications, currency,
      unit_price_ex_vat, line_total_ex_vat
    ) values (
      new.request_key, v_line,
      nullif(new.backup_payload->>'reference_number', ''), 'received', new.created_at,
      nullif(new.backup_payload->>'company_name', ''),
      nullif(new.backup_payload->>'full_name', ''),
      nullif(new.backup_payload->>'email', ''),
      nullif(new.backup_payload->>'phone', ''),
      coalesce(nullif(new.backup_payload->>'whatsapp_number', ''), nullif(new.backup_payload->>'phone', '')),
      nullif(new.backup_payload->>'delivery_location', ''),
      nullif(new.backup_payload->>'preferred_channel', ''),
      coalesce(nullif(new.backup_payload->>'notes', ''), nullif(new.backup_payload->>'message', '')),
      nullif(v_item->>'product_code', ''),
      nullif(v_item->>'product_name', ''),
      nullif(v_item->>'description', ''),
      safe_numeric(v_item->>'quantity'),
      nullif(v_item->>'unit', ''),
      coalesce(nullif(v_item->>'selected_size', ''), nullif(v_item->>'size', '')),
      coalesce(nullif(v_item->>'selected_colour', ''), nullif(v_item->>'colour', '')),
      nullif(v_item->>'specifications', ''),
      coalesce(nullif(new.backup_payload->>'currency', ''), 'ZMW'),
      safe_numeric(v_item->>'unit_price_ex_vat'),
      safe_numeric(v_item->>'line_total_ex_vat')
    ) on conflict (request_key, line_number) do nothing;
  end loop;
  return new;
end;
$function$;

drop trigger if exists trg_gdrive_backup_unpack on public.google_drive_backup_queue;
create trigger trg_gdrive_backup_unpack
after insert on public.google_drive_backup_queue
for each row execute function public.unpack_google_drive_backup_row();

-- ----------------------------------------------------------------------------
-- 5b) Direct browser submission path (no edge function required)
--     The website inserts enquiry rows straight into inquiry_queue through
--     the REST gateway with the public publishable key. This security
--     definer trigger validates the payload, creates the customer, lead and
--     quotation records, queues the Google Drive backup and stamps the
--     result back onto the row so the visitor can read their reference.
--     - request keys starting with "healthcheck-" are no-op probes that
--       never touch customer records (used by the 24/7 monitors),
--     - inserts arriving as role "service_role" come from the edge function
--       path, which does its own processing (no double processing here),
--     - bots that fill the hidden honeypot field are parked as spam,
--     - a global flood cap protects the table from bursts (per-IP rate
--       limiting stays with the optional edge function).
-- ----------------------------------------------------------------------------
create or replace function public.handle_website_inquiry_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payload jsonb := new.payload;
  v_items jsonb;
  v_result jsonb;
  v_flood integer;
begin
  -- 1) Health probes: keep the CRM clean, answer with a processed result.
  if new.request_key like 'healthcheck-%' then
    new.status := 'healthcheck';
    new.processing_result := jsonb_build_object('ok', true, 'processed', true, 'healthcheck', true);
    new.processed_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- 2) Edge-function submissions: that path already processes the enquiry.
  if coalesce(current_setting('role', true), '') = 'service_role' then
    return new;
  end if;

  -- 3) Shape checks before anything else.
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'Invalid enquiry payload';
  end if;
  if pg_column_size(v_payload) > 60000 then
    raise exception 'Enquiry payload is too large';
  end if;

  -- 4) Honeypot: bots that filled the hidden field are parked, not deleted,
  --    so abuse patterns stay visible to the owner.
  if coalesce(v_payload->>'website', '') <> '' then
    new.status := 'spam';
    new.processing_result := jsonb_build_object('ok', true, 'processed', true, 'spam', true);
    new.processed_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- 5) Global flood cap.
  select count(*) into v_flood from public.inquiry_queue
    where status = 'completed' and created_at > now() - interval '1 hour';
  if v_flood >= 240 then
    raise exception 'Submission limit reached, please try again later';
  end if;

  -- 6) Validation mirrors the edge function exactly.
  if coalesce(trim(v_payload->>'full_name'), '') = '' then
    raise exception 'Name is required';
  end if;
  if coalesce(trim(v_payload->>'email'), '') = ''
     and coalesce(trim(v_payload->>'phone'), '') = '' then
    raise exception 'A phone number or email address is required';
  end if;
  if coalesce(v_payload->>'email', '') <> ''
     and v_payload->>'email' !~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
    raise exception 'Please provide a valid email address';
  end if;
  if coalesce(trim(v_payload->>'phone'), '') <> ''
     and trim(v_payload->>'phone') !~ '^[+()0-9\s-]{7,40}$' then
    raise exception 'Please provide a valid phone number';
  end if;
  v_items := coalesce(nullif(v_payload->'quotation_items', 'null'::jsonb),
                      nullif(v_payload->'items', 'null'::jsonb), '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Invalid enquiry items';
  end if;
  if jsonb_array_length(v_items) > 60 then
    raise exception 'Too many items in one enquiry';
  end if;
  if new.inquiry_type not in ('general', 'quotation', 'message', 'callback') then
    raise exception 'Invalid enquiry type';
  end if;

  -- 7) Create the customer/lead/quotation records and queue the backup.
  new.inquiry_type := coalesce(nullif(trim(new.inquiry_type), ''), 'general');
  new.source := coalesce(nullif(trim(new.source), ''), 'website');
  new.status := 'completed';
  new.processed_at := now();
  new.updated_at := now();

  v_result := public.create_website_lead(v_payload);

  insert into public.google_drive_backup_queue
    (request_key, source, inquiry_type, quotation_request_id, customer_id,
     lead_id, backup_status, backup_payload)
  values (
    new.request_key, new.source, new.inquiry_type,
    (v_result->>'quotation_id')::uuid,
    (v_result->>'customer_id')::uuid,
    (v_result->>'lead_id')::uuid,
    case when new.inquiry_type = 'quotation' then 'pending' else 'skipped' end,
    v_payload || jsonb_build_object(
      'request_key', new.request_key,
      'customer_id', v_result->'customer_id',
      'lead_id', v_result->'lead_id',
      'quotation_id', v_result->'quotation_id',
      'reference_number', v_result->'reference_number')
  ) on conflict (request_key) do nothing;

  new.processing_result := jsonb_build_object(
    'ok', true, 'queued', true, 'processed', true, 'duplicate', false,
    'request_key', new.request_key,
    'reference_number', v_result->'reference_number');

  return new;
end;
$function$;

drop trigger if exists trg_website_inquiry_insert on public.inquiry_queue;
create trigger trg_website_inquiry_insert
before insert on public.inquiry_queue
for each row execute function public.handle_website_inquiry_insert();

-- ----------------------------------------------------------------------------
-- 6) Reporting views (owner-only; security_invoker so RLS of callers applies)
-- ----------------------------------------------------------------------------
create index if not exists customers_email_lookup_idx on public.customers (lower(trim(email)));
create index if not exists customers_phone_digits_lookup_idx on public.customers (regexp_replace(phone, '[^0-9]', '', 'g'));
create index if not exists customers_whatsapp_digits_lookup_idx on public.customers (regexp_replace(whatsapp_number, '[^0-9]', '', 'g'));
create index if not exists quotation_requests_customer_lookup_idx on public.quotation_requests (customer_id, created_at);
create index if not exists quotation_items_quote_lookup_idx on public.quotation_items (quotation_request_id);
create index if not exists leads_customer_lookup_idx on public.leads (customer_id, created_at);
create index if not exists activities_customer_lookup_idx on public.activities (customer_id, created_at);
create index if not exists inquiry_queue_status_idx on public.inquiry_queue (status, created_at);
create index if not exists gdrive_queue_status_idx on public.google_drive_backup_queue (backup_status, created_at);
create index if not exists gdrive_rows_request_idx on public.google_drive_backup_rows (request_key, line_number);
create index if not exists submission_rate_ip_idx on public.submission_rate_log (client_ip, created_at);
create index if not exists submission_rate_cleanup_idx on public.submission_rate_log (created_at);

create or replace view public.customer_quotation_history with (security_invoker=true) as
select c.id as customer_id,c.full_name,c.company_name,c.email,c.phone,
 q.id as quotation_id,q.reference_number as quote_ref,q.status,q.created_at as submitted_at,
 q.delivery_location,q.required_date,q.customer_notes,q.currency,
 count(i.id) as item_count,
 coalesce(jsonb_agg(jsonb_build_object('product_code',i.product_code,'product_name',i.product_name,'description',i.description,
 'quantity',i.quantity,'unit',i.unit,'size',i.selected_size,'colour',i.selected_colour,
 'specifications',i.specifications,'unit_price_ex_vat',i.unit_price_ex_vat,'line_total_ex_vat',i.line_total_ex_vat)
 order by i.created_at,i.id) filter (where i.id is not null),'[]'::jsonb) as items
from public.customers c join public.quotation_requests q on q.customer_id=c.id
left join public.quotation_items i on i.quotation_request_id=q.id
group by c.id,q.id;

create or replace view public.customer_quotation_summary with (security_invoker=true) as
select c.id as customer_id,c.full_name,c.company_name,c.email,c.phone,c.location,c.industry,
 count(q.id) as quotation_count,min(q.created_at) as first_quotation_at,max(q.created_at) as latest_quotation_at
from public.customers c left join public.quotation_requests q on q.customer_id=c.id group by c.id;

-- ----------------------------------------------------------------------------
-- 7) SECURITY LOCK-DOWN
--    RLS on: deny-by-default (no policies => zero access through the REST API
--    with the public publishable key). Direct grants removed from
--    anon/authenticated. Only service_role may read/write.
-- ----------------------------------------------------------------------------
alter table public.customers                 enable row level security;
alter table public.leads                     enable row level security;
alter table public.quotation_requests        enable row level security;
alter table public.quotation_items           enable row level security;
alter table public.activities                enable row level security;
alter table public.inquiry_queue             enable row level security;
alter table public.google_drive_backup_queue enable row level security;
alter table public.google_drive_backup_rows  enable row level security;
alter table public.submission_rate_log       enable row level security;

revoke all on public.customers, public.leads, public.quotation_requests,
  public.quotation_items, public.activities, public.inquiry_queue,
  public.google_drive_backup_queue, public.google_drive_backup_rows,
  public.submission_rate_log
  from anon, authenticated;

revoke all on public.customer_quotation_history, public.customer_quotation_summary
  from anon, authenticated;
grant select on public.customer_quotation_history, public.customer_quotation_summary
  to service_role;

revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

revoke execute on function public.process_website_inquiry(jsonb,text) from public, anon, authenticated;
grant execute on function public.process_website_inquiry(jsonb,text) to service_role;
revoke execute on function public.create_website_lead(jsonb) from public, anon, authenticated;
grant execute on function public.create_website_lead(jsonb) to service_role;
revoke execute on function public.enqueue_inquiry(jsonb,text,text,text) from public, anon, authenticated;
grant execute on function public.enqueue_inquiry(jsonb,text,text,text) to service_role;
revoke execute on function public.enforce_submission_rate(text,text) from public, anon, authenticated;
grant execute on function public.enforce_submission_rate(text,text) to service_role;
revoke execute on function public.safe_numeric(text) from public, anon, authenticated;
revoke all on function public.unpack_google_drive_backup_row() from public, anon, authenticated;

grant all on public.customers, public.leads, public.quotation_requests,
  public.quotation_items, public.activities, public.inquiry_queue,
  public.google_drive_backup_queue, public.google_drive_backup_rows,
  public.submission_rate_log
  to service_role;

-- ----------------------------------------------------------------------------
-- 7b) Browser (anon) access to the submission queue
--     INSERT-only. Visitors may submit enquiries and read back ONLY the row
--     they just posted (matched against their unguessable x-request-key
--     request header). No updates, no deletes, no listing, no reading of
--     anyone else's submissions. Every other table stays service-role-only.
-- ----------------------------------------------------------------------------
grant insert (request_key, source, inquiry_type, payload)
  on public.inquiry_queue to anon;
grant select on public.inquiry_queue to anon;

drop policy if exists "website_visitors_may_submit_enquiries" on public.inquiry_queue;
create policy "website_visitors_may_submit_enquiries"
  on public.inquiry_queue
  for insert
  to anon
  with check (true);

drop policy if exists "website_visitors_read_own_enquiry" on public.inquiry_queue;
create policy "website_visitors_read_own_enquiry"
  on public.inquiry_queue
  for select
  to anon
  using (
    request_key = coalesce(
      case
        when jsonb_typeof(coalesce(current_setting('request.headers', true)::jsonb, 'null'::jsonb)) = 'object'
          then coalesce(current_setting('request.headers', true)::jsonb->>'x-request-key', '')
        when jsonb_typeof(coalesce(current_setting('request.headers', true)::jsonb, 'null'::jsonb)) = 'array'
          then coalesce(
            (select h->>'value' from jsonb_array_elements(current_setting('request.headers', true)::jsonb) h
             where lower(coalesce(h->>'name', '')) = 'x-request-key' limit 1),
            '')
        else ''
      end,
      ''
    )
  );

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- ----------------------------------------------------------------------------
-- 8) Google Drive backup cron (every minute; silently waits until the vault
--    token is configured by the setup workflow)
-- ----------------------------------------------------------------------------
create schema if not exists private;

create or replace function private.invoke_google_drive_backup_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'drive_sync_cron_token'
  order by id desc
  limit 1;

  if v_token is null or length(v_token) < 32 then
    return; -- token not configured yet; stay silent instead of spamming logs
  end if;

  perform net.http_post(
    url := 'https://kqcnyewlkludlvtocsze.supabase.co/functions/v1/sync-google-drive-backups',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-drive-sync-token', v_token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function private.invoke_google_drive_backup_sync() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'hanekom-google-drive-quotation-backup';
select cron.schedule(
  'hanekom-google-drive-quotation-backup',
  '* * * * *',
  'select private.invoke_google_drive_backup_sync()'
);
