# Stage premiere staff acceptance

Laviche is the floor moderator, not a human account. The automated report lane suppresses only an exact standalone link posted at least three times by the same guest in a short window. Other reports, sensitive questions, and questions without a verified safe answer remain private for the scoped human fallback. The message row and audit record are retained. No AI has ban, account, access, or cross-room powers.

Ahnika can answer in the signed-in guest's private Stage text thread before and after her performance. The performance window blocks new Ahnika questions and suppresses an in-flight reply that crosses kickoff. Laviche remains available in text. Neither host volunteers AI or provider details; direct identity questions receive a truthful short answer, and direct production questions may explain the AI-assisted launch while live guests and dates are finalized.

The code PR and its isolated fixtures do not authorize activating `STAGE_PREMIERE_REPORTS_ENABLED` or `STAGE_PREMIERE_HOST_CHAT_ENABLED`. Rehearse against a protected preview with an authorized isolated database and its own server-only client configuration, exact tested build, verified schedule, distinct signed-in guest sessions and room-scoped fallback. Never reuse production credentials just to get a preview to run. Record independent receipts for:

- Before cue: Ahnika answers a normal follow-up and the second guest cannot see the first guest’s private exchange.
- During set: Ahnika is silent, including an in-flight question at kickoff; Laviche still answers in text.
- Moderation: a clear repeated-link report hides the target for both guests, while a normal reported message and a sensitive question go to the private scoped fallback queue. Verify denial for an ungranted reviewer.
- After set: Ahnika resumes conversation; direct AI questions are answered truthfully; normal venue answers do not mention AI. Verify closed-window requests fail and the authorized fallback can complete reviewed interactions.

If any required hosted receipt is missing, leave public activation off and report the actual blocker.
