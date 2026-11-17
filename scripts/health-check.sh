#!/usr/bin/env bash
# Hanekom 24/7 health monitor.
#
# Probes the LIVE data collection pipeline end-to-end:
#   1. Reads the live site's inquiry-submit.js to discover the exact sink
#      URLs and publishable keys the website is using right now (so it
#      always monitors the truth).
#   2. Confirms the website itself is serving traffic.
#   3. Probes BOTH sinks with idempotent healthcheck submissions whose
#      request keys start with "healthcheck-", which the backend processes
#      without touching customer records and deduplicates across runs:
#        - Primary:   direct REST insert into inquiry_queue on the new
#                     project (201 the first ever run, 409 after that;
#                     both prove the write path).
#        - Fallback:  the legacy receive-inquiry edge function
#                     (processed=true).
#
# Alerting: when GitHub Actions runs this (every 5 minutes, cron), a failure
# opens a labelled issue "[DOWN] ..." (email notification) and recovery closes
# it with a "RECOVERED" comment. While the new project's schema has not been
# applied yet, a separate "[SETUP] ..." issue reminds the owner once, then
# re-comments at most every 12 hours. When run locally without GITHUB_TOKEN it
# just prints the result.
#
# Exit codes: 0 = pipeline collecting data, 1 = data pipeline down,
#             2 = website down, 3 = could not even read the live configuration.
set -u

SITE="https://hanekom.co.zm"
REPO="T3ND41/T3ND41.github.io"
ALERT_LABEL="health-alert"
PIPELINE_TITLE_PREFIX="[DOWN] Data collection offline"
WEBSITE_TITLE_PREFIX="[DOWN] Website offline"
SETUP_TITLE_PREFIX="[SETUP] New Supabase project not initialised"
GH="gh"

probe_site_config() {
  local js
  js=$(curl -sS -m 20 -H "Cache-Control: no-cache" "$SITE/assets/js/inquiry-submit.js" 2>/dev/null) || return 3
  local primary_url primary_key fallback_url fallback_key
  primary_url=$(printf '%s' "$js" | sed -n "s/^  var PRIMARY_URL = '\(.*\)';$/\1/p" | head -1)
  primary_key=$(printf '%s' "$js" | sed -n "s/^  var PRIMARY_KEY = '\(.*\)';$/\1/p" | head -1)
  fallback_url=$(printf '%s' "$js" | sed -n "s/^  var FALLBACK_URL = '\(.*\)';$/\1/p" | head -1)
  fallback_key=$(printf '%s' "$js" | sed -n "s/^  var FALLBACK_KEY = '\(.*\)';$/\1/p" | head -1)
  [ -n "$primary_url" ] && [ -n "$primary_key" ] && [ -n "$fallback_url" ] && [ -n "$fallback_key" ] || return 3
  printf '%s\n%s\n%s\n%s\n' "$primary_url" "$primary_key" "$fallback_url" "$fallback_key"
}

probe_website() {
  local code
  code=$(curl -sS -m 20 -o /dev/null -w "%{http_code}" -H "Cache-Control: no-cache" "$SITE/" 2>/dev/null) || return 2
  [ "$code" = "200" ] && return 0
  return 2
}

# Primary sink: direct REST insert into inquiry_queue on the new project.
# Return codes: 0 = UP (201 created / 409 deduplicated), 10 = SETUP PENDING
# (table does not exist yet), 1 = DOWN.
probe_primary() {
  local url="$1" key="$2" http
  http=$(curl -sS -m 30 -o /tmp/hn-primary-probe.json -w "%{http_code}" -X POST "$url" \
    -H "apikey: $key" \
    -H "Authorization: Bearer $key" \
    -H "Content-Type: application/json" \
    -H "x-request-key: healthcheck-monitor-rest-0001" \
    -H "Prefer: return=representation" \
    -H "Origin: https://hanekom.co.zm" \
    -d '{"request_key":"healthcheck-monitor-rest-0001","source":"health-monitor","inquiry_type":"general","payload":{"source":"health-monitor","inquiry_type":"general","full_name":"SITE HEALTH CHECK (safe to delete)","email":"healthcheck@hanekom.co.zm","phone":"","message":"Automated 24/7 health probe. Safe to delete.","website":""}}' 2>/dev/null) || http="000"
  case "$http" in
    201|409) printf 'UP http=%s' "$http"; return 0 ;;
    404) printf 'PENDING http=%s' "$http"; return 10 ;;
    *) printf 'DOWN http=%s' "$http"; return 1 ;;
  esac
}

# Fallback sink: the legacy receive-inquiry edge function.
probe_fallback() {
  local url="$1" key="$2" http processed
  local payload='{"source":"health-monitor","inquiry_type":"general","full_name":"SITE HEALTH CHECK (safe to delete)","email":"healthcheck@hanekom.co.zm","phone":"","message":"Automated 24/7 health probe. This idempotent enquiry is safe to delete.","request_key":"healthcheck-monitor-0001","website":""}'
  http=$(curl -sS -m 30 -o /tmp/hn-fallback-probe.json -w "%{http_code}" -X POST \
    "$url" \
    -H "apikey: $key" \
    -H "Content-Type: application/json" \
    -H "Origin: https://hanekom.co.zm" \
    -d "$payload" 2>/dev/null) || http="000"
  processed=$(jq -r '.processed // false' /tmp/hn-fallback-probe.json 2>/dev/null || echo false)
  if { [ "$http" = "200" ] || [ "$http" = "202" ]; } && [ "$processed" = "true" ]; then
    printf 'UP http=%s' "$http"
    return 0
  fi
  printf 'DOWN http=%s processed=%s' "$http" "$processed"
  return 1
}

issue_exists() {
  local title_prefix="$1"
  "$GH" api "repos/$REPO/issues?state=open&labels=$ALERT_LABEL&per_page=50" \
    --jq "[.[] | select(.title | startswith(\"$title_prefix\"))][0].number" 2>/dev/null
}

comment_age_minutes() {
  local number="$1"
  local last
  last=$("$GH" api "repos/$REPO/issues/$number/comments" --jq '.[-1].created_at' 2>/dev/null) || { echo 9999; return; }
  [ -n "$last" ] || { echo 9999; return; }
  local now epoch_last
  epoch_last=$(date -d "$last" +%s 2>/dev/null || echo 0)
  now=$(date +%s)
  echo $(( (now - epoch_last) / 60 ))
}

ensure_label() {
  command -v "$GH" >/dev/null 2>&1 || return 0
  [ -n "${GITHUB_TOKEN:-}" ] || return 0
  "$GH" label list --limit 100 --json name --jq '.[].name' 2>/dev/null | grep -qx "$ALERT_LABEL" && return 0
  "$GH" label create "$ALERT_LABEL" --color D93F0B --description "Automated 24/7 health monitor alerts" >/dev/null 2>&1 || true
}

# open_alert <title_prefix> <detail> [recomment_throttle_minutes]
open_alert() {
  local title_prefix="$1" detail="$2" throttle="${3:-45}"
  command -v "$GH" >/dev/null 2>&1 || return 0
  [ -n "${GITHUB_TOKEN:-}" ] || return 0
  ensure_label
  local number
  number=$(issue_exists "$title_prefix")
  local stamp
  stamp="$(date -u '+%Y-%m-%d %H:%M UTC')"
  if [ -n "$number" ] && [ "$number" != "null" ]; then
    local age
    age=$(comment_age_minutes "$number")
    if [ "$age" -ge "$throttle" ]; then
      "$GH" issue comment "$number" --body "Still unresolved at $stamp.$detail" >/dev/null 2>&1 || true
    fi
  else
    "$GH" issue create \
      --title "$title_prefix — detected at $stamp" \
      --label "$ALERT_LABEL" \
      --body "Automated 24/7 monitor detected this at **$stamp**.

$detail

This issue updates itself automatically while the condition persists and closes with a RECOVERED comment once healthy." >/dev/null 2>&1 || true
  fi
}

close_alert() {
  local title_prefix="$1" detail="$2"
  command -v "$GH" >/dev/null 2>&1 || return 0
  [ -n "${GITHUB_TOKEN:-}" ] || return 0
  local number stamp
  number=$(issue_exists "$title_prefix")
  [ -n "$number" ] && [ "$number" != "null" ] || return 0
  stamp="$(date -u '+%Y-%m-%d %H:%M UTC')"
  "$GH" issue comment "$number" --body "RECOVERED at **$stamp**. $detail" >/dev/null 2>&1 || true
  "$GH" issue close "$number" >/dev/null 2>&1 || true
}

STATE_FILE="/tmp/hn-health-last-state.txt"

config=$(probe_site_config) ; config_rc=$?
website_rc=0
probe_website || website_rc=$?

if [ "$config_rc" -ne 0 ]; then
  echo "RESULT: cannot read live configuration (site JS unreadable)."
  open_alert "$PIPELINE_TITLE_PREFIX" "Could not read the live inquiry-submit.js configuration from $SITE — the website may be down or its JavaScript broken, so customer submissions cannot reach the database."
  echo "unknown" > "$STATE_FILE"
  exit 3
fi

PRIMARY_URL=$(printf '%s' "$config" | sed -n '1p')
PRIMARY_KEY=$(printf '%s' "$config" | sed -n '2p')
FALLBACK_URL=$(printf '%s' "$config" | sed -n '3p')
FALLBACK_KEY=$(printf '%s' "$config" | sed -n '4p')

primary_state=$(probe_primary "$PRIMARY_URL" "$PRIMARY_KEY") ; primary_rc=$?
fallback_state=$(probe_fallback "$FALLBACK_URL" "$FALLBACK_KEY") ; fallback_rc=$?

echo "Primary (new project REST):  $primary_state"
echo "Fallback (legacy function):  $fallback_state"
echo "Website:                     $( { [ "$website_rc" -eq 0 ] && echo UP; } || echo DOWN )"

# Setup reminder while the new project's schema has not been applied yet.
if [ "$primary_rc" -eq 10 ]; then
  open_alert "$SETUP_TITLE_PREFIX" "The website now submits to the NEW Supabase project first (kqcnyewlkludlvtocsze), but its database schema is not applied yet, so the primary sink reports: $primary_state. Enquiries are safely captured by the legacy queue in the meantime.

To finish the migration, run \`supabase/full-schema.sql\` from this repository in the Supabase dashboard SQL editor (https://supabase.com/dashboard/project/kqcnyewlkludlvtocsze/sql/new)." 720
else
  close_alert "$SETUP_TITLE_PREFIX" "Primary sink responds ($primary_state)."
fi

if [ "$primary_rc" -eq 0 ] || [ "$fallback_rc" -eq 0 ]; then
  echo "RESULT: data collection pipeline UP (primary: $primary_state; fallback: $fallback_state; website $( { [ "$website_rc" -eq 0 ] && echo UP; } || echo DOWN ))"
  close_alert "$PIPELINE_TITLE_PREFIX" "Pipeline probe succeeded (primary: $primary_state; fallback: $fallback_state)."
  close_alert "$WEBSITE_TITLE_PREFIX" "Website responded 200 again."
  echo "up" > "$STATE_FILE"
  if [ "$website_rc" -ne 0 ]; then
    open_alert "$WEBSITE_TITLE_PREFIX" "GET $SITE/ did not return 200. The form may still submit, but customers may not reach the site at all."
    exit 2
  fi
  exit 0
fi

echo "RESULT: data collection pipeline DOWN (primary: $primary_state; fallback: $fallback_state; website $( { [ "$website_rc" -eq 0 ] && echo UP; } || echo DOWN ))"
open_alert "$PIPELINE_TITLE_PREFIX" "Both data sinks failed their end-to-end probes at the same time.

Primary (new project REST insert): $primary_state
Fallback (legacy edge function):   $fallback_state

Verified: website reachability, publishable-key auth, and the database write path. A failure here means **customer enquiries are not being saved to Supabase**. The website's offline backup routes (email / WhatsApp buttons) still hand enquiries to sales, but the database path needs fixing."

echo "down" > "$STATE_FILE"
if [ "$website_rc" -ne 0 ]; then
  open_alert "$WEBSITE_TITLE_PREFIX" "GET $SITE/ did not return 200."
  exit 2
fi
exit 1
