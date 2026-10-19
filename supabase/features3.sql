-- MemeGrotto features, part 3: emoji reactions (😂 💀 🔥 😭 ❤️ 👎) on every meme, clip and community submission.
-- Paste this whole file into Supabase → SQL Editor → Run. Safe to re-run (idempotent). Needs features.sql (for
-- mv_client_key / mv_is_public_caller); features2.sql is recommended (better client key) but not required.
-- The site detects it through public.mv_features3(); until then the reactions UI stays hidden.
--
-- Visitors can only READ public.reactions. All writes go through react() / unreact() (security definer), which
-- validate the id and emoji, keep counts >= 0 and rate-limit per hashed client key via public.reaction_log.

-- The allowed set lives in ONE place (also mirrored in reactions.js).
create or replace function public.mv_reaction_emojis() returns text[]
language sql immutable as $$ select array['😂', '💀', '🔥', '😭', '❤️', '👎']::text[] $$;

create table if not exists public.reactions (
  meme_id  text not null check (char_length(meme_id) between 1 and 100 and meme_id ~ '^[A-Za-z0-9_.~-]+$'),
  emoji    text not null,
  count    int  not null default 0 check (count >= 0),
  primary key (meme_id, emoji)
);
-- (re)create the emoji constraint so editing the set above + re-running updates it
alter table public.reactions drop constraint if exists reactions_emoji_check;
alter table public.reactions add constraint reactions_emoji_check check (emoji = any (public.mv_reaction_emojis()));
create index if not exists reactions_emoji_count_idx on public.reactions (emoji, count desc);

alter table public.reactions enable row level security;
revoke all on public.reactions from anon, authenticated;
grant select on public.reactions to anon, authenticated;
drop policy if exists "mv reactions public read" on public.reactions;
create policy "mv reactions public read" on public.reactions for select to anon, authenticated using (true);

-- Private log for abuse limiting (like vote_log / battle_log): never readable by visitors.
create table if not exists public.reaction_log (
  id          bigint generated always as identity primary key,
  meme_id     text not null,
  emoji       text not null,
  delta       int  not null check (delta in (-1, 1)),
  client_key  text,
  created_at  timestamptz not null default now()
);
create index if not exists reaction_log_client_idx on public.reaction_log (client_key, created_at desc);
create index if not exists reaction_log_pair_idx on public.reaction_log (client_key, meme_id, emoji);
alter table public.reaction_log enable row level security;
revoke all on public.reaction_log from anon, authenticated;

-- Shared validation + limits. Limits per hashed client key (shared IPs/NAT get some headroom):
--   * 300 reaction changes per hour, and 3000 per hour site-wide (flood guard)
--   * net reactions on one meme+emoji capped at 3 per client key (one per browser, a few browsers per network)
--   * unreact only when that client key has a net positive reaction on that meme+emoji
create or replace function public.mv_reaction_change(p_meme_id text, p_emoji text, p_delta int) returns int
language plpgsql security definer set search_path = public as $$
declare k text := public.mv_client_key(); net int; n int;
begin
  if p_meme_id is null or p_meme_id !~ '^[A-Za-z0-9_.~-]{1,100}$' then raise exception 'bad meme id' using errcode = '22023'; end if;
  if p_emoji is null or not (p_emoji = any (public.mv_reaction_emojis())) then raise exception 'bad emoji' using errcode = '22023'; end if;
  if p_delta not in (-1, 1) then raise exception 'bad delta' using errcode = '22023'; end if;
  -- serialize changes from one client on one pair so the net check can't be raced
  perform pg_advisory_xact_lock(hashtext(k || '|' || p_meme_id || '|' || p_emoji));
  if (select count(*) from public.reaction_log where client_key = k and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'too many reactions, take a break' using errcode = '54000';
  end if;
  if (select count(*) from public.reaction_log where created_at > now() - interval '1 hour') >= 3000 then
    raise exception 'reactions are busy, try again later' using errcode = '54000';
  end if;
  select coalesce(sum(delta), 0) into net from public.reaction_log where client_key = k and meme_id = p_meme_id and emoji = p_emoji;
  if p_delta = 1 and net >= 3 then raise exception 'already reacted' using errcode = '23505'; end if;
  if p_delta = -1 and net <= 0 then
    -- nothing of ours to remove: report the current count instead of failing (keeps the client in sync)
    return coalesce((select count from public.reactions where meme_id = p_meme_id and emoji = p_emoji), 0);
  end if;
  insert into public.reaction_log (meme_id, emoji, delta, client_key) values (p_meme_id, p_emoji, p_delta, k);
  if p_delta = 1 then
    insert into public.reactions as r (meme_id, emoji, count) values (p_meme_id, p_emoji, 1)
    on conflict (meme_id, emoji) do update set count = r.count + 1
    returning r.count into n;
  else
    update public.reactions set count = greatest(count - 1, 0) where meme_id = p_meme_id and emoji = p_emoji
    returning count into n;
  end if;
  return coalesce(n, 0);
end $$;
revoke all on function public.mv_reaction_change(text, text, int) from public, anon, authenticated;

create or replace function public.react(p_meme_id text, p_emoji text) returns int
language sql security definer set search_path = public as $$ select public.mv_reaction_change(p_meme_id, p_emoji, 1) $$;
create or replace function public.unreact(p_meme_id text, p_emoji text) returns int
language sql security definer set search_path = public as $$ select public.mv_reaction_change(p_meme_id, p_emoji, -1) $$;

-- Top memes for one emoji ("Most 😂")
create or replace function public.leaderboard_reactions(p_emoji text, p_limit int default 10)
returns table (meme_id text, count int)
language sql stable security definer set search_path = public as $$
  select r.meme_id, r.count from public.reactions r
  where r.emoji = p_emoji and r.count > 0
  order by r.count desc, r.meme_id
  limit least(greatest(coalesce(p_limit, 10), 1), 100)
$$;

do $$ declare f text; begin
  foreach f in array array['react(text,text)', 'unreact(text,text)', 'leaderboard_reactions(text,integer)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;


-- ═════════════════════════════ feature probe ═════════════════════════════
create or replace function public.mv_features3() returns json
language sql stable as $$
  select json_build_object('reactions', true, 'emojis', public.mv_reaction_emojis(), 'version', 3)
$$;
grant execute on function public.mv_features3() to anon, authenticated;

notify pgrst, 'reload schema';
