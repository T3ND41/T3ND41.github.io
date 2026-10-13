// Hanekom Innovations secure enquiry receiver
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const ALLOWED_ORIGINS = new Set([
  "https://t3nd41.github.io",
  "https://www.hanekom.co.zm",
  "https://hanekom.co.zm",
  "http://localhost:3000",
  "http://localhost:5173",
]);

const ALLOWED_TYPES = new Set(["general", "quotation", "message", "callback"]);
const MAX_BODY_BYTES = 50_000;

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/\u0000/g, "");
  return cleaned ? cleaned.slice(0, max) : undefined;
}

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://t3nd41.github.io";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: Record<string, unknown>, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders(req) });
    }

    if (req.method !== "POST") {
      return json(req, { ok: false, error: "Method not allowed" }, { status: 405 });
    }

    const origin = req.headers.get("origin");
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json(req, { ok: false, error: "Origin not allowed" }, { status: 403 });
    }

    try {
      const raw = await req.text();
      if (!raw || new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
        return json(req, { ok: false, error: "Invalid request size" }, { status: 413 });
      }

      const input = JSON.parse(raw);
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return json(req, { ok: false, error: "Invalid request" }, { status: 400 });
      }

      // Hidden website field: real customers leave this empty.
      if (cleanText(input.website, 200)) {
        return json(req, { ok: true, queued: true }, { status: 202 });
      }

      const inquiryType = cleanText(input.inquiry_type, 30) ?? "general";
      if (!ALLOWED_TYPES.has(inquiryType)) {
        return json(req, { ok: false, error: "Invalid inquiry type" }, { status: 400 });
      }

      const fullName = cleanText(input.full_name, 120);
      const email = cleanText(input.email, 254)?.toLowerCase();
      const phone = cleanText(input.phone, 40);
      const message = cleanText(input.message, 5_000);
      const company = cleanText(input.company_name, 160) ?? cleanText(input.company, 160);

      if (!fullName) {
        return json(req, { ok: false, error: "Name is required" }, { status: 400 });
      }
      if (!email && !phone) {
        return json(req, { ok: false, error: "Email or phone is required" }, { status: 400 });
      }
      if (inquiryType !== "quotation" && !message) {
        return json(req, { ok: false, error: "Message is required" }, { status: 400 });
      }

      const requestKey = cleanText(
        req.headers.get("x-request-key") ?? input.request_key,
        160,
      ) ?? crypto.randomUUID();

      const items = Array.isArray(input.items)
        ? input.items
        : Array.isArray(input.quotation_items)
          ? input.quotation_items
          : [];

      const payload = {
        ...input,
        website: undefined,
        request_key: undefined,
        source: "website",
        inquiry_type: inquiryType,
        full_name: fullName,
        email,
        phone,
        whatsapp_number: cleanText(input.whatsapp_number, 40) ?? phone,
        company_name: company,
        company,
        message,
        items,
        quotation_items: items,
        received_at: new Date().toISOString(),
      };

      const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
      const secretKey = secretKeys.default;
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      if (!supabaseUrl || !secretKey) throw new Error("Server configuration unavailable");

      const admin = createClient(supabaseUrl, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data, error: saveError } = await admin.rpc("process_website_inquiry", {
        p_payload: payload,
        p_request_key: requestKey,
      });
      if (saveError) throw saveError;
      const saved = Array.isArray(data) ? data[0] : data;
      if (!saved?.processed) throw new Error("Enquiry was not processed");

      return json(req, {
        ok: true, queued: true, processed: true,
        duplicate: Boolean(saved.duplicate),
        request_key: requestKey,
        reference_number: saved.reference_number,
        drive_backup: { ok: false, skipped: true, reason: "queued_for_backup" },
      }, { status: saved.duplicate ? 200 : 202 });
    } catch (error) {
      console.error("Enquiry receiver error", error instanceof Error ? error.message : "unknown");
      return json(req, { ok: false, error: "We could not save your enquiry. Please try again." }, { status: 500 });
    }
  }),
};
