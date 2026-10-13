import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const MAX_JOBS = 10;
const SHEET_COLUMNS = 26;

type BackupJob = {
  id: string;
  request_key: string;
  backup_status: string;
  attempts: number;
  updated_at: string;
};

type BackupRow = Record<string, unknown>;

function value(row: BackupRow, key: string): string | number {
  const item = row[key];
  return typeof item === "number" || typeof item === "string" ? item : "";
}

function sheetRow(row: BackupRow, backedUpAt: string): (string | number)[] {
  const columns = [
    "synced", backedUpAt, value(row, "request_key"),
    value(row, "quotation_reference"), value(row, "quotation_status"),
    value(row, "quotation_created_at"), value(row, "company_name"),
    value(row, "contact_person"), value(row, "email"), value(row, "phone"),
    value(row, "whatsapp_number"), value(row, "delivery_location"),
    value(row, "preferred_channel"), value(row, "customer_notes"),
    value(row, "line_number"), value(row, "product_code"),
    value(row, "product_name"), value(row, "item_description"),
    value(row, "quantity"), value(row, "unit"), value(row, "selected_size"),
    value(row, "selected_colour"), value(row, "specifications"),
    value(row, "currency"), value(row, "unit_price_ex_vat"),
    value(row, "line_total_ex_vat"),
  ];
  if (columns.length !== SHEET_COLUMNS) throw new Error("Backup column mismatch");
  return columns;
}

function retryDue(job: BackupJob, now: number): boolean {
  if (job.backup_status === "pending") return true;
  const attempts = Number(job.attempts) || 0;
  const delayMs = Math.min(60, 2 ** Math.min(attempts, 6)) * 60_000;
  return now - Date.parse(job.updated_at) >= delayMs;
}

async function postToGoogle(url: string, token: string, requestKey: string, rows: (string | number)[][]) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, request_key: requestKey, rows }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Google backup HTTP ${response.status}`);
  const result = await response.json();
  if (result?.ok !== true || result?.request_key !== requestKey) {
    throw new Error(`Google backup rejected: ${String(result?.error ?? "invalid response").slice(0, 160)}`);
  }
}

Deno.serve(async (req) => {
  const cronToken = Deno.env.get("DRIVE_SYNC_CRON_TOKEN");
  if (req.method !== "POST" || !cronToken || req.headers.get("x-drive-sync-token") !== cronToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const webhookUrl = Deno.env.get("GOOGLE_DRIVE_BACKUP_WEBHOOK_URL");
  const webhookToken = Deno.env.get("GOOGLE_DRIVE_BACKUP_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  if (!webhookUrl || !webhookToken || !supabaseUrl || !secretKeys.default) {
    return Response.json({ ok: false, error: "Backup configuration incomplete" }, { status: 503 });
  }

  const admin = createClient(supabaseUrl, secretKeys.default, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: pending, error: pendingError } = await admin.from("google_drive_backup_queue")
    .select("id,request_key,backup_status,attempts,updated_at")
    .eq("inquiry_type", "quotation")
    .eq("backup_status", "pending")
    .order("created_at", { ascending: true })
    .limit(MAX_JOBS);
  if (pendingError) return Response.json({ ok: false, error: "Backup queue unavailable" }, { status: 503 });

  const remaining = MAX_JOBS - (pending?.length ?? 0);
  let retryJobs: BackupJob[] = [];
  if (remaining > 0) {
    const { data: failedJobs, error: failedError } = await admin.from("google_drive_backup_queue")
      .select("id,request_key,backup_status,attempts,updated_at")
      .eq("inquiry_type", "quotation")
      .eq("backup_status", "failed")
      .order("updated_at", { ascending: true })
      .limit(100);
    if (failedError) return Response.json({ ok: false, error: "Backup queue unavailable" }, { status: 503 });
    retryJobs = (failedJobs as BackupJob[]).filter((item) => retryDue(item, Date.now())).slice(0, remaining);
  }

  let synced = 0;
  let failed = 0;
  for (const job of [...(pending as BackupJob[]), ...retryJobs]) {
    try {
      const { data: records, error: rowsError } = await admin.from("google_drive_backup_rows")
        .select("*").eq("request_key", job.request_key).order("line_number", { ascending: true });
      if (rowsError) throw rowsError;
      if (!records?.length) throw new Error("Quotation has no backup rows");

      const backedUpAt = new Date().toISOString();
      await postToGoogle(webhookUrl, webhookToken, job.request_key,
        records.map((record: BackupRow) => sheetRow(record, backedUpAt)));

      const { error: updateError } = await admin.from("google_drive_backup_queue")
        .update({ backup_status: "synced", backed_up_at: backedUpAt, last_error: null,
          updated_at: backedUpAt })
        .eq("id", job.id).neq("backup_status", "synced");
      if (updateError) throw updateError;
      synced++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : "Unknown backup failure";
      console.error("Google Drive backup failed", job.request_key, message);
      await admin.from("google_drive_backup_queue").update({
        backup_status: "failed", attempts: (Number(job.attempts) || 0) + 1,
        last_error: message.slice(0, 500), updated_at: new Date().toISOString(),
      }).eq("id", job.id).neq("backup_status", "synced");
    }
  }

  return Response.json({ ok: failed === 0, synced, failed }, { status: failed ? 207 : 200 });
});
