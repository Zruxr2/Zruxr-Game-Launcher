-- ============================================================================
-- Zruxr Friends: upgrade 2
-- Run this ONCE in Supabase (SQL Editor > New query > paste > Run), AFTER
-- friends-setup.sql. Safe to run again.
--
-- Adds: block list, invite to play, Busy/Invisible status, profile colour,
-- game library sharing (for profile card + compare games).
-- Same privacy rules as before: tables are locked, only these functions work,
-- and friends only ever see what you chose to share.
-- ============================================================================

alter table public.profiles add column if not exists status text not null default 'online';
alter table public.profiles add column if not exists avatar_color text;
alter table public.profiles add column if not exists library jsonb not null default '[]'::jsonb;
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('online', 'busy', 'invisible'));

create table if not exists public.friend_blocks (
  blocker uuid not null references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index if not exists friend_blocks_blocked_idx on public.friend_blocks (blocked);

create table if not exists public.friend_invites (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references auth.users (id) on delete cascade,
  recipient uuid not null references auth.users (id) on delete cascade,
  game text not null,
  created_at timestamptz not null default now()
);
create index if not exists friend_invites_recipient_idx on public.friend_invites (recipient);
create index if not exists friend_invites_sender_idx on public.friend_invites (sender, created_at);

alter table public.friend_blocks enable row level security;
alter table public.friend_invites enable row level security;
revoke all on table public.friend_blocks from anon, authenticated;
revoke all on table public.friend_invites from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Everything the Friends page needs (replaces the old version)
-- ---------------------------------------------------------------------------
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
  blk jsonb;
  inv jsonb;
begin
  if uid is null then raise exception 'not signed in'; end if;
  perform public.friends_ensure_profile();

  select jsonb_build_object('username', username, 'show_activity', show_activity, 'allow_requests', allow_requests,
                            'status', status, 'avatar_color', avatar_color)
    into me from public.profiles where user_id = uid;

  -- friends who chose Invisible look offline: no "playing", no last game
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'username', p.username,
      'status', case when p.status = 'invisible' then 'offline' else p.status end,
      'avatar_color', p.avatar_color,
      'playing', case when p.show_activity and p.status <> 'invisible' and p.now_playing is not null and p.now_playing_at > now() - interval '3 minutes' then p.now_playing end,
      'last_game', case when p.show_activity then p.last_game end,
      'last_played', case when p.show_activity and p.status <> 'invisible' then p.last_played end,
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

  select coalesce(jsonb_agg(jsonb_build_object('user_id', b.blocked, 'username', p.username) order by lower(p.username)), '[]'::jsonb)
    into blk
    from public.friend_blocks b join public.profiles p on p.user_id = b.blocked
   where b.blocker = uid;

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'from', p.username, 'game', i.game, 'at', i.created_at) order by i.created_at desc), '[]'::jsonb)
    into inv
    from public.friend_invites i join public.profiles p on p.user_id = i.sender
   where i.recipient = uid and i.created_at > now() - interval '1 day';

  return jsonb_build_object('me', me, 'friends', fr, 'incoming', inc, 'outgoing', outg, 'blocked', blk, 'invites', inv);
end;
$$;

-- ---------------------------------------------------------------------------
-- Send a request (replaces the old version): blocked people look like "not found"
-- ---------------------------------------------------------------------------
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

  -- they blocked me: same answer as "no such person"
  if exists (select 1 from public.friend_blocks where blocker = tid and blocked = uid) then return 'not_found'; end if;
  -- I blocked them: tell me so I can unblock
  if exists (select 1 from public.friend_blocks where blocker = uid and blocked = tid) then return 'you_blocked'; end if;

  select * into ex from public.friendships
   where least(requester, addressee) = least(uid, tid) and greatest(requester, addressee) = greatest(uid, tid);
  if found then
    if ex.status = 'accepted' then return 'already_friends'; end if;
    if ex.requester = uid then return 'already_sent'; end if;
    update public.friendships set status = 'accepted' where id = ex.id;
    return 'accepted';
  end if;

  if not (select allow_requests from public.profiles where user_id = tid) then return 'not_found'; end if;

  select count(*) into recent from public.friendships where requester = uid and created_at > now() - interval '1 hour';
  if recent >= 20 then return 'rate_limited'; end if;

  insert into public.friendships (requester, addressee) values (uid, tid);
  return 'sent';
end;
$$;

-- ---------------------------------------------------------------------------
-- Block list
-- ---------------------------------------------------------------------------
-- Block the other person in a friendship or request (removes the friendship too).
create or replace function public.friends_block(friendship_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  f public.friendships%rowtype;
  other uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into f from public.friendships where id = friendship_id and uid in (requester, addressee);
  if not found then return; end if;
  other := case when f.requester = uid then f.addressee else f.requester end;
  insert into public.friend_blocks (blocker, blocked) values (uid, other) on conflict do nothing;
  delete from public.friendships where id = f.id;
  delete from public.friend_invites where (sender = uid and recipient = other) or (sender = other and recipient = uid);
end;
$$;

create or replace function public.friends_unblock(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  delete from public.friend_blocks where blocker = uid and blocked = p_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invite to play
-- ---------------------------------------------------------------------------
-- Returns: sent | not_friends | rate_limited
create or replace function public.friends_invite(friendship_id uuid, p_game text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  f public.friendships%rowtype;
  other uuid;
  g text := nullif(left(trim(coalesce(p_game, '')), 100), '');
  recent int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if g is null then return 'not_friends'; end if;
  select * into f from public.friendships where id = friendship_id and uid in (requester, addressee) and status = 'accepted';
  if not found then return 'not_friends'; end if;
  other := case when f.requester = uid then f.addressee else f.requester end;
  if exists (select 1 from public.friend_blocks where blocker = other and blocked = uid) then return 'not_friends'; end if;

  select count(*) into recent from public.friend_invites where sender = uid and created_at > now() - interval '1 hour';
  if recent >= 15 then return 'rate_limited'; end if;

  -- one open invite per friend: a new one replaces the old one
  delete from public.friend_invites where sender = uid and recipient = other;
  insert into public.friend_invites (sender, recipient, game) values (uid, other, g);
  return 'sent';
end;
$$;

create or replace function public.friends_dismiss_invite(invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  delete from public.friend_invites where id = invite_id and recipient = uid;
  delete from public.friend_invites where created_at < now() - interval '2 days'; -- tidy up
end;
$$;

-- ---------------------------------------------------------------------------
-- Status + profile colour
-- ---------------------------------------------------------------------------
create or replace function public.friends_set_status(p_status text, p_color text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  perform public.friends_ensure_profile();
  if p_status is not null and p_status not in ('online', 'busy', 'invisible') then raise exception 'bad status'; end if;
  if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'bad colour'; end if;
  update public.profiles set
    status = coalesce(p_status, status),
    avatar_color = coalesce(p_color, avatar_color),
    now_playing = case when p_status = 'invisible' then null else now_playing end
  where user_id = uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Game library sharing: just names + seconds played, up to 300 games.
-- Only friends can see it, and only if "Show what I'm playing" is on.
-- ---------------------------------------------------------------------------
create or replace function public.friends_sync_library(p_library jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean jsonb;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_library is null or jsonb_typeof(p_library) <> 'array' then raise exception 'bad library'; end if;
  perform public.friends_ensure_profile();
  select coalesce(jsonb_agg(jsonb_build_object('n', n, 's', s)), '[]'::jsonb) into clean from (
    select left(trim(e ->> 'n'), 100) as n,
           least(greatest(coalesce((e ->> 's')::bigint, 0), 0), 100000000) as s
      from jsonb_array_elements(p_library) e
     where jsonb_typeof(e) = 'object' and coalesce(trim(e ->> 'n'), '') <> '' and (e ->> 's') ~ '^[0-9]{1,12}$'
     limit 300
  ) t;
  update public.profiles set library = clean where user_id = uid;
end;
$$;

-- A friend's profile card: top games and their game list (for "compare games").
create or replace function public.friends_profile(friendship_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  f public.friendships%rowtype;
  p public.profiles%rowtype;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into f from public.friendships where id = friendship_id and uid in (requester, addressee) and status = 'accepted';
  if not found then return null; end if;
  select * into p from public.profiles where user_id = case when f.requester = uid then f.addressee else f.requester end;
  if not found then return null; end if;
  return jsonb_build_object(
    'username', p.username,
    'avatar_color', p.avatar_color,
    'since', f.created_at,
    'shared', p.show_activity,
    'total_seconds', case when p.show_activity then p.total_play_seconds end,
    'library', case when p.show_activity then p.library else '[]'::jsonb end
  );
end;
$$;

-- Only signed-in people may call these.
revoke all on function public.friends_overview() from public, anon;
revoke all on function public.friends_send_request(text) from public, anon;
revoke all on function public.friends_block(uuid) from public, anon;
revoke all on function public.friends_unblock(uuid) from public, anon;
revoke all on function public.friends_invite(uuid, text) from public, anon;
revoke all on function public.friends_dismiss_invite(uuid) from public, anon;
revoke all on function public.friends_set_status(text, text) from public, anon;
revoke all on function public.friends_sync_library(jsonb) from public, anon;
revoke all on function public.friends_profile(uuid) from public, anon;
grant execute on function public.friends_overview() to authenticated;
grant execute on function public.friends_send_request(text) to authenticated;
grant execute on function public.friends_block(uuid) to authenticated;
grant execute on function public.friends_unblock(uuid) to authenticated;
grant execute on function public.friends_invite(uuid, text) to authenticated;
grant execute on function public.friends_dismiss_invite(uuid) to authenticated;
grant execute on function public.friends_set_status(text, text) to authenticated;
grant execute on function public.friends_sync_library(jsonb) to authenticated;
grant execute on function public.friends_profile(uuid) to authenticated;

notify pgrst, 'reload schema';
