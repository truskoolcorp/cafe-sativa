-- Scope the public audience window to the verified, approved Ahnika occurrence.
-- Existing identity, tier, soft-delete, and rehearsal policies still apply.
create policy stage_ahnika_audience_window on public.lounge_messages
as restrictive for all to authenticated
using (
  room_id is distinct from (select id from public.lounge_rooms where slug = 'ahnika-already-gone')
  or (select exists (
    select 1 from public.my_events_v e
    where e.slug = 'ahnika-already-gone'
      and e.starts_at = '2026-12-01T06:00:00Z'
      and e.presenter_name = 'Ahnika Merlot' and e.ticket_price_cents = 0
      and e.status in ('scheduled', 'live')
      and statement_timestamp() >= e.starts_at - interval '15 minutes 30 seconds'
      and statement_timestamp() < e.starts_at + interval '16 minutes 39.7 seconds'
  ) and coalesce(auth.jwt()->>'is_anonymous', 'false') = 'false')
)
with check (
  room_id is distinct from (select id from public.lounge_rooms where slug = 'ahnika-already-gone')
  or (
    (select exists (
      select 1 from public.my_events_v e
      where e.slug = 'ahnika-already-gone'
        and e.starts_at = '2026-12-01T06:00:00Z'
        and e.presenter_name = 'Ahnika Merlot' and e.ticket_price_cents = 0
        and e.status in ('scheduled', 'live')
        and statement_timestamp() >= e.starts_at - interval '15 minutes 30 seconds'
        and statement_timestamp() < e.starts_at + interval '16 minutes 39.7 seconds'
    ) and coalesce(auth.jwt()->>'is_anonymous', 'false') = 'false')
    and (content !~ '^\[Ask (ahnika|laviche)\] ' or statement_timestamp() >= '2026-12-01T05:59:30Z')
  )
);

-- The existing moderator grant applies to the final cue as well as the show.
alter policy stage_premiere_moderator_read_own on public.stage_premiere_reply_moderators
using (
  user_id = (select auth.uid()) and now() >= '2026-12-01T05:59:30Z' and now() < expires_at
);

alter policy stage_concierge_moderator_claim on public.stage_concierge_claims
with check (
  moderator_id = (select auth.uid())
  and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  and exists (
    select 1 from public.lounge_messages m join public.lounge_rooms r on r.id = m.room_id
    where m.id = stage_concierge_claims.message_id and m.deleted_at is null
      and m.content ~ '^\[Ask (ahnika|laviche)\] .'
      and (
        (r.id = '5cafe000-0000-4000-8000-000000000001'
          and exists (select 1 from public.stage_rehearsal_invites i
            where i.user_id = (select auth.uid()) and i.expires_at > now() and i.can_draft))
        or
        (r.id <> '5cafe000-0000-4000-8000-000000000001' and r.slug = 'ahnika-already-gone'
          and now() >= '2026-12-01T05:59:30Z' and now() < '2026-12-01T06:16:39.700Z'
          and (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and (p.is_staff or p.is_admin))
            or exists (select 1 from public.stage_premiere_reply_moderators g
              where g.user_id = (select auth.uid()) and g.room_id = r.id and g.expires_at > now())))
      )
  )
);

-- Enforce the baseline before storage and Realtime, including direct
-- database clients. This is not a substitute for reports and moderation.
create function public.guard_stage_audience_content()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  clean text;
begin
  if tg_op = 'UPDATE' and new.content is not distinct from old.content
      and new.room_id is not distinct from old.room_id then
    return new;
  end if;
  if not exists (select 1 from public.lounge_rooms r
    where r.id = new.room_id and r.slug = 'ahnika-already-gone') then
    return new;
  end if;
  clean := pg_catalog.lower(pg_catalog.translate(normalize(new.content, NFKC),
    pg_catalog.chr(8203) || pg_catalog.chr(8204) || pg_catalog.chr(8205) ||
    pg_catalog.chr(8238) || pg_catalog.chr(8288) || pg_catalog.chr(65279), ''));
  if clean ~ '(https?://|www\.|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,})'
    or clean ~ '(\m(dm|text|call|whatsapp)[[:space:]]+(me|us)\M|(^|[^[:digit:]])[+]?[[:digit:]][[:digit:]() .-]{7,}[[:digit:]]([^[:digit:]]|$))'
    or clean ~ '\m(kill yourself|i (will|am going to|m gonna) (kill|shoot|stab|rape) (you|him|her|them)|go die|death to (all|every)|everyone should kill)\M'
    or clean ~ '\m(child porn(ography)?|sex with (a )?(minor|child|kid)|send (me )?(your )?nudes?|rape (a|the|this) (kid|child|woman|girl|man|boy))\M'
    or clean ~ '\m(nigg(er|a)s?|faggots?|kikes?|chinks?|spics?|trann(y|ies)|retards?)\M'
    or clean ~ '\m(fuck you|you (are|re) (a )?(worthless|subhuman)|buy now|free crypto|guaranteed returns)\M' then
    raise exception using errcode = '23514', message = 'stage_audience_content_blocked';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_stage_audience_content() from public, anon, authenticated;
create trigger stage_audience_content_guard
before insert or update of content, room_id on public.lounge_messages
for each row execute function public.guard_stage_audience_content();
