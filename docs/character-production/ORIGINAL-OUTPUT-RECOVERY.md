# Exact manual original-output recovery

This is not an automated-render success claim. It imports only already-paid
completed HeyGen task c8246007ce21cee14e38f409b4492967, exact SHA256
018615557e88f67a26ee97136376bfdde215fe2cd2ca6e274c6d48825c116658,
4023955 bytes, into private storage. No provider call, new claim, budget increase,
counter reset or publication occurs.

The admin-only POST accepts raw video/mp4, no query parameters or job identifiers.
The existing administrator session is checked before body consumption and again
before upload and attestation. The original job token is server-only and never
returned. A bounded insert-only write is followed by full exact hash readback and
an explicit fixed-scope pending_qa CAS. Uncertain upload is reconciled by readback,
not by overwriting. QA approval/publication remain false.

Separate recovery authority lasts only November14 18:30–20:30UTC. Original slot,
authorization expiry, task, token, digest and budget remain unchanged. Two new
fixed RPCs provide exact job authority and exact output CAS, rather than extending
the expired general broker authority. They grant no new rendering authority.
The installer preserves all existing role memberships/ACLs, adding only execute
on these two exact functions to the existing backend role. SQL is review-only.

Deploy/apply only after the canary flag is verified false in the live production
deployment, independent review and actual PostgreSQL17 tests. There is no approval
for extending the finite recovery window. Private media fixture is deliberately
not committed to GitHub: local positive integration uses RECOVERY_TEST_MP4 with
the already verified original file; CI tests negative HTTP cases and real PG
positive/negative/idempotent CAS and expiry behavior.
