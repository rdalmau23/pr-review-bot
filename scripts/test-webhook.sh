#!/bin/bash
# =============================================================================
# Test webhook simulator
# Sends fake GitHub webhook payloads to your local server.
#
# Usage:
#   bash scripts/test-webhook.sh opened
#   bash scripts/test-webhook.sh review_requested
#   bash scripts/test-webhook.sh reviewed
#   bash scripts/test-webhook.sh closed
# =============================================================================

set -e

BASE_URL="${WEBHOOK_URL:-http://localhost:3000}"
ENDPOINT="$BASE_URL/webhooks/github"
WEBHOOK_SECRET="${GITHUB_WEBHOOK_SECRET:-test-secret}"

ACTION="${1:-opened}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Generate HMAC signature for the payload
sign_payload() {
  local payload="$1"
  echo -n "$payload" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print "sha256="$2}'
}

# Send a webhook request
send_webhook() {
  local event="$1"
  local payload="$2"
  local signature
  signature=$(sign_payload "$payload")

  echo -e "${BLUE}📤 Sending ${event} webhook (action: ${ACTION})...${NC}"

  response=$(curl -s -w "\n%{http_code}" -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "X-GitHub-Event: $event" \
    -H "X-Hub-Signature-256: $signature" \
    -d "$payload")

  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | head -1)

  if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✅ Response: $http_code — $body${NC}"
  else
    echo -e "${YELLOW}⚠️  Response: $http_code — $body${NC}"
  fi
  echo ""
}

# ─── Payloads ────────────────────────────────────────────────────────────────

PR_OPENED_PAYLOAD='{
  "action": "opened",
  "installation": { "id": 12345 },
  "repository": {
    "id": 100001,
    "full_name": "myorg/payment-service"
  },
  "pull_request": {
    "number": 999,
    "title": "Add retry logic to payment webhook",
    "user": { "login": "dev-sarah" },
    "state": "open",
    "draft": false,
    "changed_files": 5,
    "labels": [{ "name": "enhancement" }],
    "html_url": "https://github.com/myorg/payment-service/pull/999",
    "created_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "closed_at": null,
    "merged": false,
    "requested_reviewers": []
  }
}'

PR_REVIEW_REQUESTED_PAYLOAD='{
  "action": "review_requested",
  "installation": { "id": 12345 },
  "repository": {
    "id": 100001,
    "full_name": "myorg/payment-service"
  },
  "pull_request": {
    "number": 999,
    "title": "Add retry logic to payment webhook",
    "user": { "login": "dev-sarah" },
    "state": "open",
    "draft": false,
    "changed_files": 5,
    "labels": [{ "name": "enhancement" }],
    "html_url": "https://github.com/myorg/payment-service/pull/999",
    "created_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "closed_at": null,
    "merged": false,
    "requested_reviewers": [
      { "login": "dev-alex" },
      { "login": "dev-marta" }
    ]
  }
}'

PR_REVIEWED_PAYLOAD='{
  "action": "submitted",
  "installation": { "id": 12345 },
  "repository": {
    "id": 100001,
    "full_name": "myorg/payment-service"
  },
  "review": {
    "user": { "login": "dev-alex" },
    "state": "approved",
    "body": "LGTM! 🚀"
  },
  "pull_request": {
    "number": 999,
    "title": "Add retry logic to payment webhook",
    "user": { "login": "dev-sarah" },
    "state": "open"
  }
}'

PR_CLOSED_PAYLOAD='{
  "action": "closed",
  "installation": { "id": 12345 },
  "repository": {
    "id": 100001,
    "full_name": "myorg/payment-service"
  },
  "pull_request": {
    "number": 999,
    "title": "Add retry logic to payment webhook",
    "user": { "login": "dev-sarah" },
    "state": "closed",
    "draft": false,
    "changed_files": 5,
    "labels": [{ "name": "enhancement" }],
    "html_url": "https://github.com/myorg/payment-service/pull/999",
    "created_at": "2026-03-13T10:00:00Z",
    "closed_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "merged": true,
    "requested_reviewers": []
  }
}'

PR_URGENT_PAYLOAD='{
  "action": "opened",
  "installation": { "id": 12345 },
  "repository": {
    "id": 100002,
    "full_name": "myorg/frontend-ui"
  },
  "pull_request": {
    "number": 777,
    "title": "HOTFIX: Fix production login crash",
    "user": { "login": "dev-carlos" },
    "state": "open",
    "draft": false,
    "changed_files": 2,
    "labels": [{ "name": "urgent" }, { "name": "blocks-deployment" }],
    "html_url": "https://github.com/myorg/frontend-ui/pull/777",
    "created_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "closed_at": null,
    "merged": false,
    "requested_reviewers": [
      { "login": "dev-alex" }
    ]
  }
}'

# ─── Route to the right payload ──────────────────────────────────────────────

case "$ACTION" in
  opened)
    send_webhook "pull_request" "$PR_OPENED_PAYLOAD"
    ;;
  review_requested)
    send_webhook "pull_request" "$PR_REVIEW_REQUESTED_PAYLOAD"
    ;;
  reviewed)
    send_webhook "pull_request_review" "$PR_REVIEWED_PAYLOAD"
    ;;
  closed)
    send_webhook "pull_request" "$PR_CLOSED_PAYLOAD"
    ;;
  urgent)
    send_webhook "pull_request" "$PR_URGENT_PAYLOAD"
    ;;
  all)
    echo -e "${BLUE}🔄 Running full lifecycle test...${NC}\n"
    send_webhook "pull_request" "$PR_OPENED_PAYLOAD"
    sleep 1
    send_webhook "pull_request" "$PR_REVIEW_REQUESTED_PAYLOAD"
    sleep 1
    send_webhook "pull_request_review" "$PR_REVIEWED_PAYLOAD"
    sleep 1
    send_webhook "pull_request" "$PR_CLOSED_PAYLOAD"
    echo -e "${GREEN}🎉 Full lifecycle test complete!${NC}"
    ;;
  *)
    echo "Usage: bash scripts/test-webhook.sh <action>"
    echo ""
    echo "Actions:"
    echo "  opened            Simulate a new PR being opened"
    echo "  review_requested  Simulate a reviewer being assigned"
    echo "  reviewed          Simulate a review being submitted"
    echo "  closed            Simulate a PR being merged/closed"
    echo "  urgent            Simulate an urgent PR with blocking labels"
    echo "  all               Run full lifecycle (open → assign → review → close)"
    ;;
esac
