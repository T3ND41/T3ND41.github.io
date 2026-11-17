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
const ALLOWED_CHANNELS = new Set(["whatsapp", "phone", "email", "callback", "any"]);
const SITE_ORIGIN = "https://hanekom.co.zm";
const MAX_BODY_BYTES = 50_000;
const MAX_ITEMS = 60;
const MAX_ITEM_QUANTITY = 100_000;

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  return cleaned ? cleaned.slice(0, max) : undefined;
}

// Only allow URLs that point back at the Hanekom site (relative links are
// resolved against the canonical origin). Anything else is dropped so the
// stored records and their backup sheet can never carry attacker links.
function safeSiteUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = value.trim();
  if (!url) return undefined;
  if (url.startsWith("/")) return SITE_ORIGIN + url.slice(0, 500);
  if (url.startsWith(SITE_ORIGIN + "/")) return url.slice(0, 500);
  return undefined;
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function validPhone(phone: string): boolean {
  return /^[+()0-9\s-]{7,40}$/.test(phone);
}

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://hanekom.co.zm";
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

function clientIp(req: Request): string | null {
  const direct = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
  if (direct) return direct.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded ? forwarded.split(",")[0].trim() : "";
  return first || null;
}

// Reduce each basket line to a strict whitelist of known fields with hard
// length and numeric bounds.
function cleanItems(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ITEMS).map((entry) => {
    const item = (entry && typeof entry === "object" && !Array.isArray(entry))
      ? entry as Record<string, unknown> : {};
    const quantityRaw = Number(item.quantity);
    const quantity = Number.isFinite(quantityRaw)
      ? Math.min(Math.max(Math.round(quantityRaw), 1), MAX_ITEM_QUANTITY)
      : 1;
    const cleaned: Record<string, unknown> = {
      product_code: cleanText(item.product_code, 60) ?? "",
      product_name: cleanText(item.product_name, 200) ?? "",
      description: cleanText(item.description, 400) ?? "",
      quantity,
      unit: cleanText(item.unit, 40) ?? "each",
      size: cleanText(item.size, 80) ?? "",
      colour: cleanText(item.colour, 80) ?? "",
      selected_size: cleanText(item.selected_size, 80) ?? "",
      selected_colour: cleanText(item.selected_colour, 80) ?? "",
      specifications: cleanText(item.specifications, 400) ?? "",
      product_url: safeSiteUrl(item.product_url) ?? "",
      image_url: safeSiteUrl(item.image_url) ?? "",
    };
    return cleaned;
  });
}

function preferredChannel(value: unknown): string {
  const raw = (typeof value === "string" ? value : "").trim().toLowerCase().slice(0, 30);
  if (ALLOWED_CHANNELS.has(raw)) return raw;
  if (raw.includes("whatsapp")) return "whatsapp";
  if (raw.includes("phone") || raw.includes("call")) return "phone";
  if (raw.includes("email")) return "email";
  return "whatsapp";
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
      const whatsapp = cleanText(input.whatsapp_number, 40);

      if (!fullName) {
        return json(req, { ok: false, error: "Name is required" }, { status: 400 });
      }
      if (!email && !phone) {
        return json(req, { ok: false, error: "Email or phone is required" }, { status: 400 });
      }
      if (email && !validEmail(email)) {
        return json(req, { ok: false, error: "Please provide a valid email address" }, { status: 400 });
      }
      if (phone && !validPhone(phone)) {
        return json(req, { ok: false, error: "Please provide a valid phone number" }, { status: 400 });
      }
      if (inquiryType !== "quotation" && !message) {
        return json(req, { ok: false, error: "Message is required" }, { status: 400 });
      }

      const requestKey = cleanText(
        req.headers.get("x-request-key") ?? input.request_key,
        160,
      ) ?? crypto.randomUUID();

      const items = cleanItems(Array.isArray(input.items)
        ? input.items
        : Array.isArray(input.quotation_items)
          ? input.quotation_items
          : []);

      const payload = {
        ...input,
        website: undefined,
        request_key: undefined,
        source: cleanText(input.source, 40) ?? "website",
        inquiry_type: inquiryType,
        full_name: fullName,
        email,
        phone,
        whatsapp_number: whatsapp ?? phone,
        company_name: company,
        company,
        location: cleanText(input.location, 120),
        delivery_location: cleanText(input.delivery_location, 120),
        industry: cleanText(input.industry, 120),
        preferred_channel: preferredChannel(input.preferred_channel),
        consent_to_contact: input.consent_to_contact === true,
        interest: cleanText(input.interest, 300),
        message,
        notes: cleanText(input.notes, 5_000),
        items,
        quotation_items: items,
        currency: cleanText(input.currency, 8) ?? "ZMW",
        notification_email: cleanText(input.notification_email, 254),
        notification_whatsapp: cleanText(input.notification_whatsapp, 40),
        website_origin: cleanText(input.website_origin, 120),
        page_url: cleanText(input.page_url, 500),
        received_at: new Date().toISOString(),
      };

      const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
      const secretKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      if (!supabaseUrl || !secretKey) throw new Error("Server configuration unavailable");

      const admin = createClient(supabaseUrl, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // Abuse protection. The 24/7 health monitor probes with a fixed
      // healthcheck- request key, so never rate-limit that. Availability
      // comes first: if the rate limiter itself fails, accept the enquiry.
      if (!requestKey.startsWith("healthcheck-")) {
        try {
          const { data: rate, error: rateError } = await admin.rpc("enforce_submission_rate", {
            p_client_ip: clientIp(req),
            p_request_key: requestKey,
          });
          if (!rateError && rate && rate.allowed === false) {
            return json(req, {
              ok: false,
              error: "Too many requests from your network. Please try again shortly.",
            }, { status: 429 });
          }
        } catch (rateFailure) {
          console.error("Rate limiter unavailable", rateFailure instanceof Error ? rateFailure.message : "unknown");
        }
      }

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
