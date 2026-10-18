-- MemeVault community features: submissions (+ storage bucket), reports, events/stats.
-- Paste the whole file into Supabase → SQL Editor → Run. Safe to re-run (idempotent).
-- The site detects these features through public.mv_features(); until this has been run they stay hidden.
-- Anonymous visitors (the publishable key = role "anon") can only INSERT rows that pass the checks below; they can
-- never update or delete anything, never read pending/rejected submissions, reports or raw events.

-- ───────────────────────────── helpers ─────────────────────────────
-- Hashed client key (from the X-Forwarded-For header PostgREST passes through) used only for rate limiting.
-- Raw IPs are never stored.
create or replace function public.mv_client_key() returns text
language sql stable as $$
  select md5('memevault:' || coalesce(
    split_part(coalesce((current_setting('request.headers', true))::json ->> 'x-forwarded-for', ''), ',', 1),
    (current_setting('request.headers', true))::json ->> 'x-real-ip', 'unknown'))
$$;

-- True when the statement comes from the public API as anon/authenticated (not from the dashboard / service key).
-- Read from the request GUC, so it also works inside SECURITY DEFINER functions (where current_user is the owner).
create or replace function public.mv_is_public_caller() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
                  nullif(current_setting('request.jwt.claim.role', true), ''), '') in ('anon', 'authenticated')
$$;

-- ───────────────────────────── (a) storage bucket ─────────────────────────────
-- Uploads go to submissions/pending/<random>.<ext>. The bucket is deliberately NOT a "public" bucket: Supabase serves
-- every object of a public bucket to anyone, which would make unmoderated uploads publicly hostable. Instead anon may
-- read (via short-lived signed URLs the site requests) only files whose submission row is approved.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 5242880, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

-- global flood guard for uploads (storage requests carry no client IP into SQL)
create or replace function public.mv_upload_ok() returns boolean
language sql stable security definer set search_path = public, storage as $$
  select (select count(*) from storage.objects
            where bucket_id = 'submissions' and created_at > now() - interval '10 minutes') < 60
     and (select count(*) from storage.objects
            where bucket_id = 'submissions' and name like 'pending/%') < 3000
$$;

drop policy if exists "mv submissions anon upload" on storage.objects;
create policy "mv submissions anon upload" on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'submissions'
  and name ~ '^pending/[A-Za-z0-9_-]{16,64}\.(png|jpg|jpeg|gif|webp)$'
  and public.mv_upload_ok()
);

-- ───────────────────────────── (b) submissions ─────────────────────────────
create table if not exists public.submissions (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  tags        text[] not null default '{}' check (cardinality(tags) <= 10 and array_to_string(tags, ',') !~ '[<>]'
                                                  and coalesce(char_length(array_to_string(tags, ',')), 0) <= 300),
  category    text check (category is null or char_length(category) <= 40),
  image_path  text not null unique check (image_path ~ '^pending/[A-Za-z0-9_-]{16,64}\.(png|jpg|jpeg|gif|webp)$'),
  kind        text not null default 'upload' check (kind in ('upload', 'creation')),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  client_key  text
);
create index if not exists submissions_status_idx on public.submissions (status, created_at desc);
create index if not exists submissions_client_idx on public.submissions (client_key, created_at desc);

create or replace function public.mv_submissions_guard() returns trigger
language plpgsql security definer set search_path = public, storage as $$
begin
  if public.mv_is_public_caller() then
    new.status := 'pending';                       -- forced, whatever the client sent
    new.created_at := now();
    new.client_key := public.mv_client_key();
    new.title := btrim(new.title);
    if not exists (select 1 from storage.objects o where o.bucket_id = 'submissions' and o.name = new.image_path) then
      raise exception 'upload the image first' using errcode = '22023';
    end if;
    if (select count(*) from public.submissions s
          where s.client_key = new.client_key and s.created_at > now() - interval '1 hour') >= 10 then
      raise exception 'too many submissions, try again later' using errcode = '54000';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists mv_submissions_guard on public.submissions;
create trigger mv_submissions_guard before insert on public.submissions
for each row execute function public.mv_submissions_guard();

alter table public.submissions enable row level security;
revoke all on public.submissions from anon, authenticated;
grant insert (title, tags, category, image_path, kind) on public.submissions to anon, authenticated;
grant select (id, title, tags, category, image_path, kind, status, created_at) on public.submissions to anon, authenticated;

drop policy if exists "mv submissions insert" on public.submissions;
create policy "mv submissions insert" on public.submissions for insert to anon, authenticated
with check (status = 'pending');
drop policy if exists "mv submissions read approved" on public.submissions;
create policy "mv submissions read approved" on public.submissions for select to anon, authenticated
using (status = 'approved');

-- anon can read (sign URLs for) an uploaded file only once its submission is approved
create or replace function public.mv_is_approved_path(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.submissions s where s.image_path = p and s.status = 'approved')
$$;
drop policy if exists "mv submissions read approved files" on storage.objects;
create policy "mv submissions read approved files" on storage.objects for select to anon, authenticated
using (bucket_id = 'submissions' and public.mv_is_approved_path(name));

-- ───────────────────────────── (c) reports ─────────────────────────────
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  meme_id     text not null check (char_length(meme_id) between 1 and 100 and meme_id ~ '^[A-Za-z0-9_.~-]+$'),
  reason      text not null check (reason in ('offensive', 'hateful', 'sexual', 'spam', 'copyright', 'broken', 'other')),
  note        text check (note is null or char_length(note) <= 500),
  created_at  timestamptz not null default now(),
  client_key  text
);
create index if not exists reports_meme_idx on public.reports (meme_id);
create index if not exists reports_client_idx on public.reports (client_key, created_at desc);

create or replace function public.mv_reports_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.mv_is_public_caller() then
    new.created_at := now(); new.client_key := public.mv_client_key();
    if (select count(*) from public.reports r
          where r.client_key = new.client_key and r.created_at > now() - interval '1 hour') >= 20 then
      raise exception 'too many reports, try again later' using errcode = '54000';
    end if;
    if exists (select 1 from public.reports r where r.client_key = new.client_key and r.meme_id = new.meme_id
                 and r.created_at > now() - interval '1 day') then
      raise exception 'already reported' using errcode = '23505';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists mv_reports_guard on public.reports;
create trigger mv_reports_guard before insert on public.reports
for each row execute function public.mv_reports_guard();

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant insert (meme_id, reason, note) on public.reports to anon, authenticated;
drop policy if exists "mv reports insert" on public.reports;
create policy "mv reports insert" on public.reports for insert to anon, authenticated with check (true);
-- no select policy: reports are only visible in the dashboard / with the service key

-- ───────────────────────────── (d) events + public aggregates ─────────────────────────────
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  meme_id     text not null check (char_length(meme_id) between 1 and 100 and meme_id ~ '^[A-Za-z0-9_.~-]+$'),
  kind        text not null check (kind in ('view', 'share', 'caption', 'download')),
  created_at  timestamptz not null default now(),
  client_key  text
);
create index if not exists events_meme_kind_idx on public.events (kind, meme_id);
create index if not exists events_client_idx on public.events (client_key, created_at desc);

create or replace function public.mv_events_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.mv_is_public_caller() then
    new.created_at := now(); new.client_key := public.mv_client_key();
    if (select count(*) from public.events e
          where e.client_key = new.client_key and e.created_at > now() - interval '1 hour') >= 600 then
      return null;                                  -- silently drop floods instead of erroring
    end if;
  end if;
  return new;
end $$;
drop trigger if exists mv_events_guard on public.events;
create trigger mv_events_guard before insert on public.events
for each row execute function public.mv_events_guard();

alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
grant insert (meme_id, kind) on public.events to anon, authenticated;
drop policy if exists "mv events insert" on public.events;
create policy "mv events insert" on public.events for insert to anon, authenticated with check (true);

-- Aggregated counts only (no raw rows): top memes for one kind, or every kind when p_kind is null.
create or replace function public.meme_stats(p_kind text default null, p_limit int default 50)
returns table (meme_id text, kind text, count bigint)
language sql stable security definer set search_path = public as $$
  select e.meme_id, e.kind, count(*)::bigint
  from public.events e
  where p_kind is null or e.kind = p_kind
  group by e.meme_id, e.kind
  order by count(*) desc, e.meme_id
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
$$;
revoke all on function public.meme_stats(text, int) from public;
grant execute on function public.meme_stats(text, int) to anon, authenticated;

-- ───────────────────────────── feature probe used by the site ─────────────────────────────
create or replace function public.mv_features() returns json
language sql stable as $$
  select json_build_object('submissions', true, 'reports', true, 'events', true, 'stats', true, 'version', 1)
$$;
grant execute on function public.mv_features() to anon, authenticated;

-- (e) gallery votes reuse the existing public.upvote(p_meme_id) with ids like 'sub-<submission uuid>'.

-- Ask PostgREST to pick up the new tables/functions right away
notify pgrst, 'reload schema';
