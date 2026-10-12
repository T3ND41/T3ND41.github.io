CREATE OR REPLACE FUNCTION public.create_website_lead(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
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
      full_name, company_name, phone, whatsapp_number, email, location,
      preferred_channel, consent_to_contact, notes
    ) values (
      v_name,
      nullif(trim(p_payload->>'company_name'), ''),
      v_phone,
      coalesce(v_whatsapp, v_phone),
      v_email,
      nullif(trim(p_payload->>'location'), ''),
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
  ) returning id into v_lead_id;

  if jsonb_array_length(v_items) > 0 then
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
        quotation_request_id, product_name, description, quantity, unit,
        selected_size, selected_colour, specifications, unit_price_ex_vat
      ) values (
        v_quote_id,
        coalesce(nullif(trim(v_item->>'product_name'), ''), 'Unspecified product'),
        nullif(trim(v_item->>'description'), ''),
        greatest(coalesce((v_item->>'quantity')::numeric, 1), 1),
        coalesce(nullif(trim(v_item->>'unit'), ''), 'each'),
        coalesce(nullif(trim(v_item->>'selected_size'), ''), nullif(trim(v_item->>'size'), '')),
        coalesce(nullif(trim(v_item->>'selected_colour'), ''), nullif(trim(v_item->>'colour'), '')),
        nullif(trim(v_item->>'specifications'), ''),
        case when coalesce(v_item->>'unit_price_ex_vat', '') ~ '^\d+(\.\d+)?$'
          then (v_item->>'unit_price_ex_vat')::numeric else null end
      );
    end loop;

    update public.leads set status = 'quotation required' where id = v_lead_id;
  end if;

  insert into public.activities(customer_id, lead_id, activity_type, description, performed_by)
  values (v_customer_id, v_lead_id, 'website_enquiry_received', v_interest, 'n8n');

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
$function$
;
revoke execute on function public.create_website_lead(jsonb) from public, anon, authenticated;
grant execute on function public.create_website_lead(jsonb) to service_role;
create index if not exists customers_email_lookup_idx on public.customers (lower(trim(email)));
create index if not exists customers_phone_digits_lookup_idx on public.customers (regexp_replace(phone, '[^0-9]', '', 'g'));
create index if not exists customers_whatsapp_digits_lookup_idx on public.customers (regexp_replace(whatsapp_number, '[^0-9]', '', 'g'));
create index if not exists quotation_requests_customer_lookup_idx on public.quotation_requests (customer_id, created_at);
create or replace view public.customer_quotation_history with (security_invoker=true) as
select c.id as customer_id,c.full_name,c.company_name,c.email,c.phone,
 q.id as quotation_id,q.reference_number as quote_ref,q.status,q.created_at as submitted_at,
 q.delivery_location,q.required_date,q.customer_notes,q.currency,
 count(i.id) as item_count,
 coalesce(jsonb_agg(jsonb_build_object('product_name',i.product_name,'description',i.description,
 'quantity',i.quantity,'unit',i.unit,'size',i.selected_size,'colour',i.selected_colour,
 'specifications',i.specifications,'unit_price_ex_vat',i.unit_price_ex_vat,'line_total_ex_vat',i.line_total_ex_vat)
 order by i.created_at,i.id) filter (where i.id is not null),'[]'::jsonb) as items
from public.customers c join public.quotation_requests q on q.customer_id=c.id
left join public.quotation_items i on i.quotation_request_id=q.id
group by c.id,q.id;
create or replace view public.customer_quotation_summary with (security_invoker=true) as
select c.id as customer_id,c.full_name,c.company_name,c.email,c.phone,c.location,
 count(q.id) as quotation_count,min(q.created_at) as first_quotation_at,max(q.created_at) as latest_quotation_at
from public.customers c left join public.quotation_requests q on q.customer_id=c.id group by c.id;
revoke all on public.customer_quotation_history, public.customer_quotation_summary from anon,authenticated;
grant select on public.customer_quotation_history,public.customer_quotation_summary to service_role;
