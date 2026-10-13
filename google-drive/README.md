# Hanekom quotation backup

Quotations are saved in Supabase first. A scheduled Supabase worker copies one
row per quotation item to the existing Hanekom `Quotations` Google Sheet. The
worker retries failures with backoff and the Google script ignores repeated
`request_key` + line pairs.

## Activation

1. In the Hanekom Google account, create an Apps Script project with `Code.gs`.
   Set script properties `SPREADSHEET_ID` to
   `1gHSMBEIO0HYa98h59gz3QIawUojpV-PJ_rGOco7lzdA` and `BACKUP_TOKEN` to a
   random secret of at least 32 bytes. Deploy as a web app executing as the
   Hanekom owner, accessible to anyone. The request body token is required;
   never put it in the URL or in Git.
2. In Supabase Edge Function secrets, save `GOOGLE_DRIVE_BACKUP_WEBHOOK_URL`
   as the web app `/exec` URL and `GOOGLE_DRIVE_BACKUP_TOKEN` as that same
   random secret. Save a separate random `DRIVE_SYNC_CRON_TOKEN` there.
3. Deploy `receive-inquiry` and `sync-google-drive-backups` from this repo.
   The latter must have JWT verification disabled because it validates the
   private cron token itself. The public receiver keeps its existing
   publishable-key authentication and origin checks.
4. Save `DRIVE_SYNC_CRON_TOKEN` in Supabase Vault under the name
   `drive_sync_cron_token`, then apply `supabase/google-drive-backup-schedule.sql`.
5. Submit a test quotation, verify its item row(s) in the Sheet, and check that
   the matching `google_drive_backup_queue` row becomes `synced` with
   `backed_up_at` set. Test a failed Google response and recovery as well.

This is a cloud backup, not a replacement for database backups. When Google is
unavailable, Supabase retains the pending quotation and retries. Persistent
failure remains visible in `google_drive_backup_queue.last_error` and should
be monitored. The local desktop heartbeat is not required for this workflow.
