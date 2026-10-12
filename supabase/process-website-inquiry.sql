alter table public.inquiry_queue add column if not exists processing_result jsonb;

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

revoke execute on function public.process_website_inquiry(jsonb,text) from public,anon,authenticated;
grant execute on function public.process_website_inquiry(jsonb,text) to service_role;
