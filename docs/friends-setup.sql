-- ============================================================================
-- Zruxr Friends: database setup
-- Run this ONCE in Supabase: open your project, go to SQL Editor, press
-- "New query", paste everything below, press Run. It is safe to run again.
--
-- How it stays private:
--  * Row Level Security is switched on and there are NO open policies, so the
--    public key in the app cannot read or change these tables directly.
--  * Everything goes through the functions at the bottom. Each one only ever
--    returns what the signed-in person is allowed to see (their own friends,
--    and only what those friends chose to share).
--  * People can't browse other users. The only way to find someone is to send
--    a request to their exact username, and the answer never says whether the
--    name exists but has requests turned off.
-- ============================================================================

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  show_activity boolean not null default true,   -- friends may see what I'm playing
  allow_requests boolean not null default true,  -- people may send me requests
  now_playing text,
  now_playing_at timestamptz,
  last_game text,
  last_played timestamptz,
  total_play_seconds bigint not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
-- one friendship per pair of people, whichever way round the request went
create unique index if not exists friendships_pair_key
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee_idx on public.friendships (addressee);
create index if not exists friendships_requester_idx on public.friendships (requester);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.friendships from anon, authenticated;
-- (no policies on purpose: only the functions below can touch these tables)

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Makes sure the signed-in person has a profile. The username is the part of their login before the "@".
create or replace function public.friends_ensure_profile()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  uname text;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select lower(split_part(email, '@', 1)) into uname from auth.users where id = uid;
  if uname is null or uname = '' then raise exception 'no username'; end if;
  insert into public.profiles (user_id, username) values (uid, uname)
  on conflict (user_id) do nothing;
end;
$$;

-- Everything the Friends page needs, in one call.
create or replace function public.friends_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  me jsonb;
  fr jsonb;
  inc jsonb;
  outg jsonb;
begin
  if uid is null then raise exception 'not signed in'; end if;
  perform public.friends_ensure_profile();

  select jsonb_build_object('username', username, 'show_activity', show_activity, 'allow_requests', allow_requests)
    into me from public.profiles where user_id = uid;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'username', p.username,
      -- "playing" only counts if the game reported itself in the last 3 minutes
      'playing', case when p.show_activity and p.now_playing is not null and p.now_playing_at > now() - interval '3 minutes' then p.now_playing end,
      'last_game', case when p.show_activity then p.last_game end,
      'last_played', case when p.show_activity then p.last_played end,
      'total_seconds', case when p.show_activity then p.total_play_seconds end
    ) order by lower(p.username)), '[]'::jsonb)
    into fr
    from public.friendships f
    join public.profiles p on p.user_id = case when f.requester = uid then f.addressee else f.requester end
   where f.status = 'accepted' and uid in (f.requester, f.addressee);

  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'username', p.username) order by f.created_at), '[]'::jsonb)
    into inc
    from public.friendships f join public.profiles p on p.user_id = f.requester
   where f.addressee = uid and f.status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'username', p.username) order by f.created_at), '[]'::jsonb)
    into outg
    from public.friendships f join public.profiles p on p.user_id = f.addressee
   where f.requester = uid and f.status = 'pending';

  return jsonb_build_object('me', me, 'friends', fr, 'incoming', inc, 'outgoing', outg);
end;
$$;

-- Send a friend request by exact username. Returns one word:
-- sent | accepted (they had already asked you) | already_friends | already_sent | self | not_found | rate_limited
create or replace function public.friends_send_request(target text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  tid uuid;
  ex public.friendships%rowtype;
  recent int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  perform public.friends_ensure_profile();
  target := lower(trim(coalesce(target, '')));
  if target = '' or length(target) > 40 then return 'not_found'; end if;

  select user_id into tid from public.profiles where lower(username) = target;
  if tid is null then return 'not_found'; end if;
  if tid = uid then return 'self'; end if;

  select * into ex from public.friendships
   where least(requester, addressee) = least(uid, tid) and greatest(requester, addressee) = greatest(uid, tid);
  if found then
    if ex.status = 'accepted' then return 'already_friends'; end if;
    if ex.requester = uid then return 'already_sent'; end if;
    update public.friendships set status = 'accepted' where id = ex.id; -- they asked first: that's a yes
    return 'accepted';
  end if;

  -- people who turned requests off look exactly like people who don't exist
  if not (select allow_requests from public.profiles where user_id = tid) then return 'not_found'; end if;

  select count(*) into recent from public.friendships where requester = uid and created_at > now() - interval '1 hour';
  if recent >= 20 then return 'rate_limited'; end if;

  insert into public.friendships (requester, addressee) values (uid, tid);
  return 'sent';
end;
$$;

-- Accept or decline a request somebody sent you.
create or replace function public.friends_respond(request_id uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  if accept then
    update public.friendships set status = 'accepted'
     where id = request_id and addressee = uid and status = 'pending';
  else
    delete from public.friendships where id = request_id and addressee = uid and status = 'pending';
  end if;
end;
$$;

-- Remove a friend, or cancel a request you sent. Either person can do it.
create or replace function public.friends_remove(friendship_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  delete from public.friendships where id = friendship_id and uid in (requester, addressee);
end;
$$;

-- Privacy switches.
create or replace function public.friends_set_privacy(p_show_activity boolean, p_allow_requests boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  perform public.friends_ensure_profile();
  update public.profiles
     set show_activity = coalesce(p_show_activity, show_activity),
         allow_requests = coalesce(p_allow_requests, allow_requests),
         -- turning activity off also wipes what was already shown
         now_playing = case when p_show_activity is false then null else now_playing end
   where user_id = uid;
end;
$$;

-- The app reports what you're playing (or that you stopped) and your total play time.
create or replace function public.friends_presence(p_game text, p_playing boolean, p_total bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  g text := nullif(left(trim(coalesce(p_game, '')), 100), '');
begin
  if uid is null then raise exception 'not signed in'; end if;
  perform public.friends_ensure_profile();
  update public.profiles set
    now_playing = case when p_playing and g is not null then g else null end,
    now_playing_at = case when p_playing and g is not null then now() else null end,
    last_game = coalesce(g, last_game),
    last_played = case when g is not null then now() else last_played end,
    total_play_seconds = least(greatest(coalesce(p_total, total_play_seconds), 0), 1000000000)
  where user_id = uid;
end;
$$;

-- Only signed-in people may call these (not the anonymous public key).
revoke all on function public.friends_ensure_profile() from public, anon;
revoke all on function public.friends_overview() from public, anon;
revoke all on function public.friends_send_request(text) from public, anon;
revoke all on function public.friends_respond(uuid, boolean) from public, anon;
revoke all on function public.friends_remove(uuid) from public, anon;
revoke all on function public.friends_set_privacy(boolean, boolean) from public, anon;
revoke all on function public.friends_presence(text, boolean, bigint) from public, anon;
grant execute on function public.friends_ensure_profile() to authenticated;
grant execute on function public.friends_overview() to authenticated;
grant execute on function public.friends_send_request(text) to authenticated;
grant execute on function public.friends_respond(uuid, boolean) to authenticated;
grant execute on function public.friends_remove(uuid) to authenticated;
grant execute on function public.friends_set_privacy(boolean, boolean) to authenticated;
grant execute on function public.friends_presence(text, boolean, bigint) to authenticated;

-- Tell Supabase's API to notice the new functions right away.
notify pgrst, 'reload schema';
