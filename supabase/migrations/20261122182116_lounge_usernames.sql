-- Standalone chat namespace. It does not change logins, profiles, membership or staff grants.
create table public.lounge_usernames (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  generated_username text not null unique default ('guest-' || left(replace(gen_random_uuid()::text, '-', ''), 12)),
  custom_username text unique,
  constraint lounge_username_allowed check (
    custom_username is null or (
      length(custom_username) between 3 and 24
      and custom_username collate "C" ~ '^[a-z][a-z0-9]*([-_][a-z0-9]+)*$'
      and translate(replace(replace(custom_username, '-', ''), '_', ''), '013457', 'oieast')
        !~ '^(guest|member|admin|staff|moderat|mod[0-9]*$|official|support|concierge|laviche|ahnika|ginger|cafesativa|truskool)'
      and translate(replace(replace(custom_username, '-', ''), '_', ''), '013457', 'oieast')
        !~ '(fuck|fuk|fck|shit|shthead|bitch|btch|cunt|motherf|asshole|whore|slut|dickhead|nigg|fagg|fagot|kike|spic[0-9]*$|chink|wetback|retard|killall|kys$|naz[i1]|swastika|pedophil)'
    )
  )
);

alter table public.lounge_usernames enable row level security;
revoke all on public.lounge_usernames from public, anon, authenticated;
grant select on public.lounge_usernames to authenticated;
grant insert (custom_username), update (custom_username) on public.lounge_usernames to authenticated;

create policy lounge_username_read_own on public.lounge_usernames for select to authenticated
  using (user_id = (select auth.uid()) and not coalesce((select auth.jwt()->>'is_anonymous') = 'true', false));
create policy lounge_username_create_own on public.lounge_usernames for insert to authenticated
  with check (user_id = (select auth.uid()) and not coalesce((select auth.jwt()->>'is_anonymous') = 'true', false));
create policy lounge_username_update_own on public.lounge_usernames for update to authenticated
  using (user_id = (select auth.uid()) and not coalesce((select auth.jwt()->>'is_anonymous') = 'true', false))
  with check (user_id = (select auth.uid()) and not coalesce((select auth.jwt()->>'is_anonymous') = 'true', false));

create function public.save_lounge_username(p_username text default null)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  account_id uuid := auth.uid();
  active_name text;
begin
  if account_id is null or coalesce(auth.jwt()->>'is_anonymous' = 'true', false) then
    raise insufficient_privilege using message = 'Sign in to choose a chat username.';
  end if;

  if p_username is null then
    select coalesce(custom_username, generated_username) into active_name
      from public.lounge_usernames where user_id = account_id;
    if found then return active_name; end if;
    insert into public.lounge_usernames (custom_username) values (null)
      on conflict (user_id) do nothing;
    select coalesce(custom_username, generated_username) into active_name
      from public.lounge_usernames where user_id = account_id;
  else
    insert into public.lounge_usernames (custom_username) values (lower(trim(p_username)))
      on conflict (user_id) do update set custom_username = excluded.custom_username
      returning custom_username into active_name;
  end if;
  return active_name;
end;
$$;
revoke all on function public.save_lounge_username(text) from public, anon;
grant execute on function public.save_lounge_username(text) to authenticated;
