-- Apply after the Hanekom Apps Script web app is deployed and the same strong
-- DRIVE_SYNC_CRON_TOKEN is saved in Edge Function secrets and Supabase Vault.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

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
  where name = 'drive_sync_cron_token';

  if v_token is null or length(v_token) < 32 then
    raise exception 'Google Drive backup cron token is not configured';
  end if;

  perform net.http_post(
    url := 'https://vpjqzatzzbbzdvlkkugg.supabase.co/functions/v1/sync-google-drive-backups',
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

select cron.schedule(
  'hanekom-google-drive-quotation-backup',
  '* * * * *',
  'select private.invoke_google_drive_backup_sync()'
);
