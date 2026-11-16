# Café Sativa social connection

Metricool's official instructions describe OAuth MCP connections on any plan,
including Free: https://help.metricool.com/how-to-connect-metricools-mcp-eqp9h
Production metadata verified 10 October 2026 at
https://ai.metricool.com/.well-known/oauth-authorization-server and
https://ai.metricool.com/.well-known/oauth-protected-resource.
Public-client registration succeeded with HTTP 201. Its identifier is configured
in the production-only CS_METRICOOL_OAUTH_CLIENT_ID variable; no client secret was
issued. The website reuses this registration instead of creating one on each click.

The website has its own OAuth client and consent flow. It does not extract or
reuse ChatGPT's credentials. The administrator starts it from Website programming
using **Connect Metricool for website automation**. Production uses the fixed
www.cafe-sativa.com callback. PKCE, a ten-minute encrypted HttpOnly state cookie,
and the same authenticated administrator protect the callback.

Before saving tokens, a read-only MCP proof verifies brand 5373515, user 4174093,
Facebook 146219355471397 and Threads truskoolcorp. Other brands and mismatched
accounts are rejected. Dallasite on Tour TikTok is excluded from the allowed
destination list. No write tool is called by the connection flow.

Tokens are encrypted with AES-256-GCM under a dedicated production-only sensitive
environment key, CS_SOCIAL_ENCRYPTION_KEY. OAuth state and saved credentials use
different authenticated encryption contexts. The cs_social_connections table has
RLS enabled, no browser-role grants, and explicit service-role grants. Its schema
is recorded in METRICOOL_OAUTH_SCHEMA.sql and the remote migration history.

Owner authorization succeeded on 10 October 2026 at 04:35 UTC. The saved connection
verified the exact permitted brand and networks. Server-side refresh and the live scheduling-tool contracts were verified at
13:36 UTC. All three existing receipts reconciled without new posts. Dispatch is
now enabled for explicitly approved future clip deliveries; no new clip was
submitted during this verification.

SOCIAL_DELIVERY_SCHEMA.sql records the service-only delivery ledger and the atomic
connection lock. The server refreshes tokens without exposing credentials, checks
that the connection owner remains an administrator, and verifies tool schemas.
Only an explicit social-sharing checkbox on an approved website clip queues its
exact caption and release time for Facebook and Threads. Current media QA and
room canon are checked again before submission. Submission is atomically claimed;
an interrupted or ambiguous result is held for manual review, never retried
silently. Existing posts are imported as scheduler receipts without inventing a
new owner approval. Pending-queue disappearance never means publication success.

The administrator's Test connection action is read-only. The cron-authorized
social probe performs the same verification and receipt reconciliation while
dispatch is disabled. The temporary daily probe schedule was removed after successful validation.
The ordinary daily content cron then performs these checks.

No new subscription was purchased. Free-plan limits still apply. Character episode
creation and unapproved room references remain separate blockers. The actual
create-post transaction still needs an explicitly approved future clip to exercise
it end to end; no synthetic test post is created.
