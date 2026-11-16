# Positive publication receipts (dormant)

Observed live read-only Metricool `getScheduledPosts` response on November 16
returned posts with `id`, signed numeric-string `uuid`, local `publicationDate`,
`creatorUserId`, `draft`, `autoPublish`, and `providers` containing `network`,
`id`, `status`, `publicUrl`. Although its tool description says scheduled-only,
actual `PUBLISHED` rows were present. Code accepts only explicit positive results;
absence, future/scheduled, partial, errors, duplicate identities and missing URLs
never imply publication. Analytics returned empty and is not relied upon.

The finite server operation reads an existing scheduled *app attempt*, validates
the existing owner connection without refreshing/changing it, reads brand mapping
before and after exact provider status, and persists immutable positive evidence.
The provider surface exposes only brand/status reads, never publication/retry.
The operation is disabled unless the explicit reconciliation flag is true. It is
not a route or activation. Original network work must settle before admission is
released, including after cancellation or persistence uncertainty.

Three owner-scoped SQL functions read one scheduled attempt, record its positive
receipt, and prove both exact Café destination plans have receipts. Recording
is tied to existing plan/token/digest/Metricool ID/UUID/destination/schedule.
External old-intro dedup receipts cannot satisfy it. Unknown writes are not
retried. A later independently verified poll may differ only in observation time;
all attempt, destination and evidence fields must remain identical, and the original
stored observation is never overwritten. Context and writer runtime EXECUTE would be new capabilities; terminal
EXECUTE to character_production_owner would be an additional cross-owner path.
No grants, role membership, table access, positive data or installation is included.
Any service_role capability also exposes its known indirect Storage-admin path.

This prerequisite does not itself enroll a successor or retarget existing
scheduler/publication bindings. Serial preparation must wait for terminal truth
then use a separately reviewed atomic successor operation. Text/speech factories,
new production and publication enrollment, current planning/wallet evidence,
post-QA target selection and initial delivery-plan creation still require coherent
trusted composition. Nothing here proves a complete production run occurred.
