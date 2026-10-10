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

Current stage: authorization prepared, not yet owner-authorized or tested against
live private MCP tools. Automatic dispatch remains disabled. Free-plan limits
still apply. The callback requires refreshable bearer tokens; unexpected provider
responses fail without exposing credentials or claiming connection success.

Remaining work after authorization: verify the live MCP tool schemas and token
refresh, implement atomic delivery claims and persistent scheduler receipts,
reconcile existing posts before scheduling anything, and test an approved delivery
without duplicates. Character episode creation remains a separate workstream.

No new subscription was purchased. Existing Metricool queued posts are unchanged.
