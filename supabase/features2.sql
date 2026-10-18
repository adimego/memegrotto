-- MemeGrotto features, part 2: moderation (passphrase), hidden memes, leaderboards (vote log, creators),
-- meme battles (Elo), GIF/video submissions.
-- Run supabase/features.sql first (once). Then paste this whole file into Supabase → SQL Editor → Run.
-- Safe to re-run. The site detects it through public.mv_features2(); until then the new parts stay hidden.
--
-- AFTER running it, set the moderator passphrase with ONE line in the SQL editor (pick your own, 12+ characters):
--     select public.mod_set_passphrase('your long secret passphrase here');
-- Only the dashboard can run that (visitors can't call it). Run it again any time to change the passphrase.

create extension if not exists pgcrypto with schema extensions;

-- Rate-limit key: prefer Cloudflare's cf-connecting-ip (visitors can't fake it), then x-real-ip, then the first
-- x-forwarded-for entry. Stored only as an md5 hash. (Replaces the version from features.sql.)
create or replace function public.mv_client_key() returns text
language sql stable as $$
  select md5('memevault:' || coalesce(
    nullif((current_setting('request.headers', true))::json ->> 'cf-connecting-ip', ''),
    nullif((current_setting('request.headers', true))::json ->> 'x-real-ip', ''),
    nullif(split_part(coalesce((current_setting('request.headers', true))::json ->> 'x-forwarded-for', ''), ',', 1), ''),
    'unknown'))
$$;

-- ═════════════════════════════ 1. moderation ═════════════════════════════
-- Private tables: no grants and RLS on with no policies, so anon/authenticated can never read them.
create table if not exists public.mod_secret (
  id          int primary key default 1 check (id = 1),
  hash        text not null,
  updated_at  timestamptz not null default now()
);
alter table public.mod_secret enable row level security;
revoke all on public.mod_secret from anon, authenticated;

create table if not exists public.mod_attempts (
  id          bigint generated always as identity primary key,
  client_key  text,
  created_at  timestamptz not null default now()
);
create index if not exists mod_attempts_idx on public.mod_attempts (client_key, created_at desc);
alter table public.mod_attempts enable row level security;
revoke all on public.mod_attempts from anon, authenticated;

-- Dashboard-only: stores a bcrypt hash of the passphrase (the passphrase itself is never stored).
create or replace function public.mod_set_passphrase(p text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.mv_is_public_caller() then raise exception 'run this from the Supabase SQL editor' using errcode = '42501'; end if;
  if p is null or char_length(p) < 12 then raise exception 'use a passphrase of at least 12 characters'; end if;
  insert into public.mod_secret (id, hash) values (1, extensions.crypt(p, extensions.gen_salt('bf', 10)))
  on conflict (id) do update set hash = excluded.hash, updated_at = now();
  delete from public.mod_attempts;
  return 'moderator passphrase set';
end $$;
revoke all on function public.mod_set_passphrase(text) from public, anon, authenticated;

-- Internal check used by every mod_* function. Returns null when OK, otherwise an error text.
-- Failures are recorded (no exception, so the record is kept) and lock a client out after 5 failures per hour;
-- more than 60 failures per hour from everyone together locks all logins for the rest of that hour.
create or replace function public.mod_auth(p text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare k text := public.mv_client_key(); h text;
begin
  delete from public.mod_attempts where created_at < now() - interval '1 day';
  if (select count(*) from public.mod_attempts where client_key = k and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.mod_attempts where created_at > now() - interval '1 hour') >= 60 then
    return 'too many wrong passphrases, try again in an hour';
  end if;
  select hash into h from public.mod_secret where id = 1;
  if h is null then return 'moderation is not set up: run select public.mod_set_passphrase(...) in the SQL editor'; end if;
  if p is null or char_length(p) > 200 or extensions.crypt(p, h) <> h then
    perform pg_sleep(0.5);
    insert into public.mod_attempts (client_key) values (k);
    return 'wrong passphrase';
  end if;
  return null;
end $$;
revoke all on function public.mod_auth(text) from public, anon, authenticated;

-- Library or community memes hidden site-wide by a moderator (public list of ids; the site filters them out).
create table if not exists public.hidden_memes (
  meme_id    text primary key check (char_length(meme_id) between 1 and 100),
  reason     text check (reason is null or char_length(reason) <= 200),
  hidden_at  timestamptz not null default now()
);
alter table public.hidden_memes enable row level security;
revoke all on public.hidden_memes from anon, authenticated;
grant select (meme_id) on public.hidden_memes to anon, authenticated;
drop policy if exists "mv hidden memes public read" on public.hidden_memes;
create policy "mv hidden memes public read" on public.hidden_memes for select to anon, authenticated using (true);

-- reports can be dismissed by moderators
alter table public.reports add column if not exists dismissed_at timestamptz;

-- Pending-file previews: a moderator unlocks specific pending files for 2 minutes, during which the moderation page
-- asks Storage for a 10-minute signed URL. (Signed URLs can't be made inside SQL.)
create table if not exists public.mod_preview (
  path        text primary key,
  expires_at  timestamptz not null
);
alter table public.mod_preview enable row level security;
revoke all on public.mod_preview from anon, authenticated;

create or replace function public.mv_is_previewable(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mod_preview m where m.path = p and m.expires_at > now())
$$;
drop policy if exists "mv submissions read approved files" on storage.objects;
create policy "mv submissions read approved files" on storage.objects for select to anon, authenticated
using (bucket_id = 'submissions' and (public.mv_is_approved_path(name) or public.mv_is_previewable(name)));

create or replace function public.mod_login(p text) returns json
language plpgsql security definer set search_path = public as $$
declare e text := public.mod_auth(p);
begin
  if e is not null then return json_build_object('ok', false, 'error', e); end if;
  return json_build_object('ok', true,
    'pending', (select count(*) from public.submissions where status = 'pending'),
    'reports', (select count(distinct meme_id) from public.reports where dismissed_at is null));
end $$;

create or replace function public.mod_list_pending(p text, p_limit int default 100) returns json
language plpgsql security definer set search_path = public as $$
declare e text := public.mod_auth(p); rows json;
begin
  if e is not null then return json_build_object('ok', false, 'error', e); end if;
  delete from public.mod_preview where expires_at < now();
  insert into public.mod_preview (path, expires_at)
    select s.image_path, now() + interval '2 minutes' from public.submissions s where s.status = 'pending'
    order by s.created_at limit least(greatest(coalesce(p_limit, 100), 1), 200)
  on conflict (path) do update set expires_at = excluded.expires_at;
  select coalesce(json_agg(x order by x.created_at), '[]'::json) into rows from (
    select s.id, s.title, s.tags, s.category, s.kind, s.creator, s.image_path, s.created_at,
           (select count(*) from public.submissions o where o.client_key = s.client_key and o.status = 'rejected') as sender_rejected
    from public.submissions s where s.status = 'pending'
    order by s.created_at limit least(greatest(coalesce(p_limit, 100), 1), 200)) x;
  return json_build_object('ok', true, 'items', rows);
end $$;

-- also usable for already-approved/rejected files (e.g. to re-check one)
create or replace function public.mod_signed_url(p text, p_path text) returns json
language plpgsql security definer set search_path = public as $$
declare e text := public.mod_auth(p);
begin
  if e is not null then return json_build_object('ok', false, 'error', e); end if;
  if not exists (select 1 from public.submissions where image_path = p_path) then return json_build_object('ok', false, 'error', 'unknown file'); end if;
  insert into public.mod_preview (path, expires_at) values (p_path, now() + interval '2 minutes')
  on conflict (path) do update set expires_at = excluded.expires_at;
  return json_build_object('ok', true, 'path', p_path, 'sign_within_seconds', 120);
end $$;

create or replace function public.mod_set_status(p text, p_id uuid, p_status text) returns json
language plpgsql security definer set search_path = public as $$
declare e text := public.mod_auth(p); n int;
begin
  if e is not null then return json_build_object('ok', false, 'error', e); end if;
  if p_status not in ('pending', 'approved', 'rejected') then return json_build_object('ok', false, 'error', 'bad status'); end if;
  update public.submissions set status = p_status where id = p_id; get diagnostics n = row_count;
  delete from public.mod_preview where path in (select image_path from public.submissions where id = p_id) and p_status = 'approved';
  return json_build_object('ok', n = 1, 'error', case when n = 1 then null else 'not found' end);
end $$;

create or replace function public.mod_list_reports(p text, p_include_dismissed boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare e text := public.mod_auth(p); rows json;
begin
  if e is not null then return json_build_object('ok', false, 'error', e); end if;
  select coalesce(json_agg(x order by x.open_count desc, x.last_at desc), '[]'::json) into rows from (
    select r.meme_id,
           count(*) filter (where r.dismissed_at is null) as open_count,
           count(*) as total,
           array_agg(distinct r.reason) as reasons,
           (array_agg(r.note order by r.created_at desc) filter (where r.note is not null))[1:5] as notes,
           max(r.created_at) as last_at,
           exists (select 1 from public.hidden_memes h where h.meme_id = r.meme_id) as hidden
    from public.reports r
    group by r.meme_id
    having p_include_dismissed or count(*) filter (where r.dismissed_at is null) > 0
    limit 300) x;
  return json_build_object('ok', true, 'items', rows);
end $$;

create or replace function public.mod_dismiss_report(p text, p_meme_id text) returns json
language plpgsql security definer set search_path = public as $$
declare e text := public.mod_auth(p); n int;
begin
  if e is not null then return json_build_object('ok', false, 'error', e); end if;
  update public.reports set dismissed_at = now() where meme_id = p_meme_id and dismissed_at is null;
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'dismissed', n);
end $$;

create or replace function public.mod_hide_meme(p text, p_meme_id text, p_hide boolean default true, p_reason text default null) returns json
language plpgsql security definer set search_path = public as $$
declare e text := public.mod_auth(p);
begin
  if e is not null then return json_build_object('ok', false, 'error', e); end if;
  if p_meme_id is null or char_length(p_meme_id) not between 1 and 100 then return json_build_object('ok', false, 'error', 'bad id'); end if;
  if p_hide then
    insert into public.hidden_memes (meme_id, reason) values (p_meme_id, left(p_reason, 200)) on conflict (meme_id) do nothing;
    update public.reports set dismissed_at = now() where meme_id = p_meme_id and dismissed_at is null;
  else
    delete from public.hidden_memes where meme_id = p_meme_id;
  end if;
  return json_build_object('ok', true, 'hidden', p_hide);
end $$;

create or replace function public.mod_list_hidden(p text) returns json
language plpgsql security definer set search_path = public as $$
declare e text := public.mod_auth(p);
begin
  if e is not null then return json_build_object('ok', false, 'error', e); end if;
  return json_build_object('ok', true, 'items',
    (select coalesce(json_agg(h order by h.hidden_at desc), '[]'::json) from public.hidden_memes h));
end $$;

do $$ declare f text; begin
  foreach f in array array['mod_login(text)', 'mod_list_pending(text,integer)', 'mod_signed_url(text,text)',
    'mod_set_status(text,uuid,text)', 'mod_list_reports(text,boolean)', 'mod_dismiss_report(text,text)',
    'mod_hide_meme(text,text,boolean,text)', 'mod_list_hidden(text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- ═════════════════════════════ 2. leaderboards ═════════════════════════════
-- Every vote is logged with a timestamp by a trigger on the existing votes table (upvote() is unchanged).
create table if not exists public.vote_log (
  id          bigint generated always as identity primary key,
  meme_id     text not null,
  delta       int not null default 1,
  created_at  timestamptz not null default now()
);
create index if not exists vote_log_time_idx on public.vote_log (created_at desc, meme_id);
alter table public.vote_log enable row level security;
revoke all on public.vote_log from anon, authenticated;

create or replace function public.mv_vote_log_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare d int := case when tg_op = 'INSERT' then coalesce(new.count, 1) else coalesce(new.count, 0) - coalesce(old.count, 0) end;
begin
  if d > 0 then insert into public.vote_log (meme_id, delta) values (new.meme_id, d); end if;
  return new;
end $$;
drop trigger if exists mv_vote_log on public.votes;
create trigger mv_vote_log after insert or update of count on public.votes
for each row execute function public.mv_vote_log_trigger();

-- p_period: 'day' (last 24 h), 'week' (last 7 days) or 'all'
create or replace function public.leaderboard_votes(p_period text default 'all', p_limit int default 25)
returns table (meme_id text, votes bigint)
language sql stable security definer set search_path = public as $$
  select v.meme_id, v.count::bigint from public.votes v
  where coalesce(p_period, 'all') not in ('day', 'week') and v.count > 0 and v.meme_id not like '\_\_%'
  union all
  select l.meme_id, sum(l.delta)::bigint from public.vote_log l
  where p_period in ('day', 'week')
    and l.created_at > now() - case when p_period = 'day' then interval '1 day' else interval '7 days' end
  group by l.meme_id
  order by 2 desc, 1
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;

-- optional creator name on submissions (shown on leaderboards)
alter table public.submissions add column if not exists creator text;
alter table public.submissions drop constraint if exists submissions_creator_check;
alter table public.submissions add constraint submissions_creator_check
  check (creator is null or (char_length(btrim(creator)) between 1 and 40 and creator !~ '[<>]'));
grant insert (creator) on public.submissions to anon, authenticated;
grant select (creator) on public.submissions to anon, authenticated;

create or replace function public.leaderboard_creators(p_limit int default 25)
returns table (creator text, approved bigint, votes bigint)
language sql stable security definer set search_path = public as $$
  select s.creator, count(*)::bigint, coalesce(sum(v.count), 0)::bigint
  from public.submissions s left join public.votes v on v.meme_id = 'sub-' || s.id::text
  where s.status = 'approved' and s.creator is not null
  group by s.creator
  order by 3 desc, 2 desc, 1
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;

-- ═════════════════════════════ 4. battles (Elo) ═════════════════════════════
create table if not exists public.battle_ratings (
  meme_id     text primary key check (char_length(meme_id) between 1 and 100 and meme_id ~ '^[A-Za-z0-9_.~-]+$'),
  rating      double precision not null default 1000,
  wins        int not null default 0,
  losses      int not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.battle_ratings enable row level security;
revoke all on public.battle_ratings from anon, authenticated;
grant select on public.battle_ratings to anon, authenticated;
drop policy if exists "mv battle ratings public read" on public.battle_ratings;
create policy "mv battle ratings public read" on public.battle_ratings for select to anon, authenticated using (true);

create table if not exists public.battle_log (
  id          bigint generated always as identity primary key,
  winner      text not null,
  loser       text not null,
  client_key  text,
  created_at  timestamptz not null default now()
);
create index if not exists battle_log_client_idx on public.battle_log (client_key, created_at desc);
alter table public.battle_log enable row level security;
revoke all on public.battle_log from anon, authenticated;

-- Records one battle result and updates both Elo ratings (K = 24).
-- Limits per visitor: 300 battles per hour, and the same pair once per 10 minutes.
create or replace function public.battle_vote(p_winner text, p_loser text) returns json
language plpgsql security definer set search_path = public as $$
declare k text := public.mv_client_key(); rw double precision; rl double precision; ew double precision; kf constant double precision := 24;
begin
  if p_winner is null or p_loser is null or p_winner = p_loser
     or p_winner !~ '^[A-Za-z0-9_.~-]{1,100}$' or p_loser !~ '^[A-Za-z0-9_.~-]{1,100}$' then
    raise exception 'bad battle' using errcode = '22023';
  end if;
  if (select count(*) from public.battle_log where client_key = k and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'too many battles, take a break' using errcode = '54000';
  end if;
  if exists (select 1 from public.battle_log where client_key = k and created_at > now() - interval '10 minutes'
             and least(winner, loser) = least(p_winner, p_loser) and greatest(winner, loser) = greatest(p_winner, p_loser)) then
    raise exception 'already judged this pair' using errcode = '23505';
  end if;
  insert into public.battle_log (winner, loser, client_key) values (p_winner, p_loser, k);
  insert into public.battle_ratings (meme_id) values (p_winner), (p_loser) on conflict (meme_id) do nothing;
  select rating into rw from public.battle_ratings where meme_id = p_winner for update;
  select rating into rl from public.battle_ratings where meme_id = p_loser for update;
  ew := 1 / (1 + power(10, (rl - rw) / 400));
  update public.battle_ratings set rating = rw + kf * (1 - ew), wins = wins + 1, updated_at = now() where meme_id = p_winner;
  update public.battle_ratings set rating = rl - kf * (1 - ew), losses = losses + 1, updated_at = now() where meme_id = p_loser;
  return (select json_build_object('ok', true,
    'winner', (select row_to_json(b) from public.battle_ratings b where b.meme_id = p_winner),
    'loser',  (select row_to_json(b) from public.battle_ratings b where b.meme_id = p_loser)));
end $$;
revoke all on function public.battle_vote(text, text) from public;
grant execute on function public.battle_vote(text, text) to anon, authenticated;

create or replace function public.leaderboard_battles(p_limit int default 25, p_min_games int default 5)
returns table (meme_id text, rating double precision, wins int, losses int, win_rate double precision)
language sql stable security definer set search_path = public as $$
  select b.meme_id, round(b.rating::numeric, 1)::double precision, b.wins, b.losses,
         round((b.wins::numeric / nullif(b.wins + b.losses, 0)), 3)::double precision
  from public.battle_ratings b
  where b.wins + b.losses >= greatest(coalesce(p_min_games, 5), 1)
  order by b.rating desc, b.wins desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;

do $$ declare f text; begin
  foreach f in array array['leaderboard_votes(text,integer)', 'leaderboard_creators(integer)', 'leaderboard_battles(integer,integer)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- ═════════════════════════════ 3. GIF / video submissions ═════════════════════════════
-- Bucket accepts MP4/WebM too, up to 15 MB; images stay limited to 5 MB (checked in the submissions trigger).
update storage.buckets set file_size_limit = 15728640,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm']
where id = 'submissions';

drop policy if exists "mv submissions anon upload" on storage.objects;
create policy "mv submissions anon upload" on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'submissions'
  and name ~ '^pending/[A-Za-z0-9_-]{16,64}\.(png|jpg|jpeg|gif|webp|mp4|webm)$'
  and public.mv_upload_ok()
);

alter table public.submissions drop constraint if exists submissions_image_path_check;
alter table public.submissions add constraint submissions_image_path_check
  check (image_path ~ '^pending/[A-Za-z0-9_-]{16,64}\.(png|jpg|jpeg|gif|webp|mp4|webm)$');

create or replace function public.mv_submissions_guard() returns trigger
language plpgsql security definer set search_path = public, storage as $$
declare sz bigint; mt text;
begin
  if public.mv_is_public_caller() then
    new.status := 'pending';                       -- forced, whatever the client sent
    new.created_at := now();
    new.client_key := public.mv_client_key();
    new.title := btrim(new.title);
    new.creator := nullif(btrim(new.creator), '');
    select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype' into sz, mt
      from storage.objects o where o.bucket_id = 'submissions' and o.name = new.image_path;
    if not found then raise exception 'upload the image first' using errcode = '22023'; end if;
    if coalesce(mt, '') like 'image/%' and coalesce(sz, 0) > 5242880 then
      raise exception 'images must be under 5 MB' using errcode = '22023';
    end if;
    if (select count(*) from public.submissions s
          where s.client_key = new.client_key and s.created_at > now() - interval '1 hour') >= 10 then
      raise exception 'too many submissions, try again later' using errcode = '54000';
    end if;
  end if;
  return new;
end $$;

-- ═════════════════════════════ feature probe ═════════════════════════════
create or replace function public.mv_features2() returns json
language sql stable as $$
  select json_build_object('moderation', true, 'hidden', true, 'leaderboards', true, 'battles', true, 'video', true, 'version', 2)
$$;
grant execute on function public.mv_features2() to anon, authenticated;

notify pgrst, 'reload schema';
