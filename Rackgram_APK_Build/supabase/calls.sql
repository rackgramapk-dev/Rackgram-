-- Rackgram calls: run once in Supabase Dashboard -> SQL Editor.
-- Only ADDS new objects. Existing tables are not touched.

create table if not exists public.calls (
  id          uuid primary key default gen_random_uuid(),
  caller_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind        text not null default 'audio' check (kind in ('audio','video')),
  status      text not null default 'ringing' check (status in ('ringing','active','ended','missed','declined')),
  created_at  timestamptz not null default now(),
  answered_at timestamptz,
  ended_at    timestamptz
);

create table if not exists public.call_participants (
  call_id     uuid not null references public.calls(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'invited' check (status in ('invited','joined','declined','left','missed')),
  invited_by  uuid not null default auth.uid(),
  updated_at  timestamptz not null default now(),
  primary key (call_id, user_id)
);

create index if not exists call_participants_user_idx on public.call_participants (user_id, status);
create index if not exists calls_created_idx on public.calls (created_at desc);

-- helper functions (security definer = no RLS recursion)
create or replace function public.is_call_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.call_participants where call_id = cid and user_id = auth.uid())
      or exists (select 1 from public.calls where id = cid and caller_id = auth.uid());
$$;

create or replace function public.is_blocked_by(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks where blocker_id = target and blocked_id = auth.uid());
$$;

alter table public.calls enable row level security;
alter table public.call_participants enable row level security;

drop policy if exists calls_select on public.calls;
drop policy if exists calls_insert on public.calls;
drop policy if exists calls_update on public.calls;
create policy calls_select on public.calls for select to authenticated
  using (public.is_call_member(id));
create policy calls_insert on public.calls for insert to authenticated
  with check (caller_id = auth.uid());
create policy calls_update on public.calls for update to authenticated
  using (public.is_call_member(id)) with check (public.is_call_member(id));

drop policy if exists cp_select on public.call_participants;
drop policy if exists cp_insert on public.call_participants;
drop policy if exists cp_update on public.call_participants;
create policy cp_select on public.call_participants for select to authenticated
  using (user_id = auth.uid() or public.is_call_member(call_id));
create policy cp_insert on public.call_participants for insert to authenticated
  with check (
    public.is_call_member(call_id)
    and invited_by = auth.uid()
    and (user_id = auth.uid() or not public.is_blocked_by(user_id))
  );
create policy cp_update on public.call_participants for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- realtime (incoming call ring + status changes)
do $$ begin
  begin alter publication supabase_realtime add table public.calls; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.call_participants; exception when duplicate_object then null; end;
end $$;
