#!/usr/bin/env bash
# Hanekom 24/7 health monitor.
#
# Probes the LIVE data collection pipeline end-to-end:
#   1. Reads the live site's inquiry-submit.js to discover which Supabase
#      endpoint the site is actually using (so it always monitors the truth).
#   2. Confirms the website itself is serving traffic.
#   3. Posts an idempotent healthcheck enquiry through the receive-inquiry
#      edge function (request_key starts with "healthcheck-", so it is
#      deduplicated by the backend and never rate-limited). processed=true
#      proves function + auth + database + RPC all work.
#
# Alerting: when GitHub Actions runs this (every 5 minutes, cron), a failure
# opens a labelled issue "[DOWN] ..." (email notification) and recovery closes
# it with a "RECOVERED" comment. When run locally without GITHUB_TOKEN it just
# prints the result.
#
# Exit codes: 0 = everything up, 1 = data pipeline down, 2 = website down,
#             3 = could not even read the live configuration.
set -u

SITE="https://hanekom.co.zm"
REPO="T3ND41/T3ND41.github.io"
ALERT_LABEL="health-alert"
PIPELINE_TITLE_PREFIX="[DOWN] Data collection offline"
WEBSITE_TITLE_PREFIX="[DOWN] Website offline"
GH="gh"

probe_site_config() {
  local js
  js=$(curl -sS -m 20 -H "Cache-Control: no-cache" "$SITE/assets/js/inquiry-submit.js" 2>/dev/null) || return 3
  local endpoint key
  endpoint=$(printf '%s' "$js" | sed -n "s/^  var ENDPOINT = '\(.*\)';$/\1/p" | head -1)
  key=$(printf '%s' "$js" | sed -n "s/^  var PUBLISHABLE_KEY = '\(.*\)';$/\1/p" | head -1)
  [ -n "$endpoint" ] && [ -n "$key" ] || return 3
  printf '%s\n%s\n' "$endpoint" "$key"
}

probe_website() {
  local code
  code=$(curl -sS -m 20 -o /dev/null -w "%{http_code}" -H "Cache-Control: no-cache" "$SITE/" 2>/dev/null) || return 2
  [ "$code" = "200" ] && return 0
  return 2
}

probe_pipeline() {
  local endpoint="$1" key="$2" attempt http body processed
  # Idempotent healthcheck enquiry; the backend deduplicates by request_key.
  local payload='{"source":"health-monitor","inquiry_type":"general","full_name":"SITE HEALTH CHECK (safe to delete)","email":"healthcheck@hanekom.co.zm","phone":"","message":"Automated 24/7 health probe. This idempotent enquiry is safe to delete.","request_key":"healthcheck-monitor-0001","website":""}'
  for attempt in 1 2 3; do
    http=$(curl -sS -m 30 -o /tmp/hn-health-probe.json -w "%{http_code}" -X POST \
      "$endpoint" \
      -H "apikey: $key" \
      -H "Content-Type: application/json" \
      -H "Origin: https://hanekom.co.zm" \
      -d "$payload" 2>/dev/null) || http="000"
    processed=$(jq -r '.processed // false' /tmp/hn-health-probe.json 2>/dev/null || echo false)
    if { [ "$http" = "200" ] || [ "$http" = "202" ]; } && [ "$processed" = "true" ]; then
      printf 'UP http=%s' "$http"
      return 0
    fi
    [ "$attempt" = "3" ] || sleep 20
  done
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

open_alert() {
  local title_prefix="$1" detail="$2"
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
    if [ "$age" -ge 45 ]; then
      "$GH" issue comment "$number" --body "Still down at $stamp.$detail" >/dev/null 2>&1 || true
    fi
  else
    "$GH" issue create \
      --title "$title_prefix — detected at $stamp" \
      --label "$ALERT_LABEL" \
      --body "Automated 24/7 monitor detected a failure at **$stamp**.

$detail

This issue closes itself automatically when the monitor sees a healthy probe again. Recovery will be announced with a RECOVERED comment." >/dev/null 2>&1 || true
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

ENDPOINT=$(printf '%s' "$config" | sed -n '1p')
KEY=$(printf '%s' "$config" | sed -n '2p')
echo "Live collector: $ENDPOINT"

pipeline_state=$(probe_pipeline "$ENDPOINT" "$KEY") ; pipeline_rc=$?
if [ "$pipeline_rc" -eq 0 ]; then
  echo "RESULT: data collection pipeline $pipeline_state; website $( { [ "$website_rc" -eq 0 ] && echo UP; } || echo DOWN )"
  close_alert "$PIPELINE_TITLE_PREFIX" "Pipeline probe succeeded ($pipeline_state, endpoint $ENDPOINT)."
  close_alert "$WEBSITE_TITLE_PREFIX" "Website responded 200 again."
  echo "up" > "$STATE_FILE"
  if [ "$website_rc" -ne 0 ]; then
    open_alert "$WEBSITE_TITLE_PREFIX" "GET $SITE/ did not return 200. The form may still submit, but customers may not reach the site at all."
    exit 2
  fi
  exit 0
fi

echo "RESULT: data collection pipeline $pipeline_state (endpoint $ENDPOINT); website $( { [ "$website_rc" -eq 0 ] && echo UP; } || echo DOWN )"
open_alert "$PIPELINE_TITLE_PREFIX" "The end-to-end probe failed ($pipeline_state).

Probe: POST $ENDPOINT with the publishable key and an idempotent healthcheck enquiry.
Verified: function reachability, publishable-key auth, database write via the process_website_inquiry RPC.
A failure here means **customer enquiries are not being saved to Supabase**. The website's offline backup routes (email / WhatsApp buttons) still hand enquiries to sales, but the database path needs fixing."

echo "down" > "$STATE_FILE"
exit 1
