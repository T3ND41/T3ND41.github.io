# Hanekom quotation backup

Quotations reach the existing Hanekom `Quotations` Google Sheet through two
independent paths:

1. **Website relay (active for every submission once the web app is live).**
   The site JS POSTs the full enquiry to the Apps Script web app, which
   emails it to sales@hanekom.co.zm and hanekominnovationsltd@gmail.com and
   appends one row per requested item to the sheet, even when both Supabase
   projects are unreachable.
2. **Supabase sync worker (scheduled).** Quotations saved in Supabase are
   copied to the sheet by a scheduled Supabase worker. The worker retries
   failures with backoff and the Google script ignores repeated
   `request_key` + line pairs, so a quotation stored by path 1 is never
   stored twice by path 2.

Rows written by the website relay carry `direct` in the Backup Status
column and empty Unit Price / Line Total columns (prices are only known
after quoting); sync-worker rows carry `synced`.

## Activation

1. In the Hanekom Google account, create an Apps Script project with `Code.gs`.
   Set script properties `SPREADSHEET_ID` to
   `1gHSMBEIO0HYa98h59gz3QIawUojpV-PJ_rGOco7lzdA`, `BACKUP_TOKEN` to a
   random secret of at least 32 bytes, and `EMAIL_RELAY_TOKEN` to a separate
   random secret (this one is safe to put in the public website JS - the
   relay is rate-limited to 20 requests/hour and can only send enquiry
   emails and append enquiry rows to the sheet).
   Deploy as a web app executing as the Hanekom owner, accessible to anyone.
   The request body token is required; never put `BACKUP_TOKEN` in the URL,
   the site JS or Git.
   When the deployment is live, the same web app emails every website
   enquiry to sales@hanekom.co.zm and hanekominnovationsltd@gmail.com with
   reply-to set to the customer, and stores it in the Quotations sheet.
2. Give the web app `/exec` URL and the `EMAIL_RELAY_TOKEN` value to the
   site maintainer so they can be set as `APPS_SCRIPT_URL` and
   `APPS_SCRIPT_TOKEN` in `assets/js/inquiry-submit.js` (the two constants
   are empty while the relay is dormant).
3. In Supabase Edge Function secrets, save `GOOGLE_DRIVE_BACKUP_WEBHOOK_URL`
   as the web app `/exec` URL and `GOOGLE_DRIVE_BACKUP_TOKEN` as that same
   random secret. Save a separate random `DRIVE_SYNC_CRON_TOKEN` there.
4. Deploy `receive-inquiry` and `sync-google-drive-backups` from this repo.
   The latter must have JWT verification disabled because it validates the
   private cron token itself. The public receiver keeps its existing
   publishable-key authentication and origin checks.
5. Save `DRIVE_SYNC_CRON_TOKEN` in Supabase Vault under the name
   `drive_sync_cron_token`, then apply `supabase/google-drive-backup-schedule.sql`.
6. Submit a test quotation, verify its item row(s) in the Sheet, and check that
   the matching `google_drive_backup_queue` row becomes `synced` with
   `backed_up_at` set. Test a failed Google response and recovery as well.

This is a cloud backup, not a replacement for database backups. When Google is
unavailable, Supabase retains the pending quotation and retries. Persistent
failure remains visible in `google_drive_backup_queue.last_error` and should
be monitored. The local desktop heartbeat is not required for this workflow.
