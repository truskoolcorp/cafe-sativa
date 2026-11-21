alter policy stage_concierge_moderator_claim on public.stage_concierge_claims
with check (
  moderator_id = (select auth.uid())
  and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.is_staff or p.is_admin))
  and exists (
    select 1 from public.lounge_messages m join public.lounge_rooms r on r.id = m.room_id
    where m.id = stage_concierge_claims.message_id and m.deleted_at is null
      and (r.slug = 'ahnika-already-gone' or (
        r.id = '5cafe000-0000-4000-8000-000000000001'
        and exists (select 1 from public.stage_rehearsal_invites i where i.user_id = (select auth.uid()))
      ))
      and m.content ~ '^\[Ask (ahnika|laviche)\] .'
  )
);
