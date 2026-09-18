-- ============================================================
-- VERYA — database schema
-- Run this once in Supabase: Project → SQL Editor → New query → paste → Run
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  background jsonb default '{}'::jsonb,   -- free-form: education, job, skills, etc.
  weekly_hours numeric,
  onboarding_complete boolean default false,
  created_at timestamptz default now()
);

-- ---------- goals (a user may have several; one can be the active "focus") ----------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  domain text,                             -- free text, e.g. "ML research", "novel writing" — never a fixed enum
  timeframe_weeks int,
  milestones jsonb default '[]'::jsonb,    -- [{title, description, week_target, done}]
  status text default 'active',
  is_focus boolean default true,
  created_at timestamptz default now()
);

-- ---------- time_logs (today's available time + what AI recommended) ----------
create table if not exists public.time_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete set null,
  minutes_available int,
  recommended_action text,
  recommended_why text,
  completed boolean default false,
  created_at timestamptz default now()
);

-- ---------- work_log (project/research entries + AI feedback) ----------
create table if not exists public.work_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete set null,
  entry text not null,
  ai_feedback text,
  created_at timestamptz default now()
);

-- ---------- chat_messages (mentor chat history) ----------
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz default now()
);

-- ============================================================
-- Row Level Security — every table is isolated per user
-- ============================================================
alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.time_logs enable row level security;
alter table public.work_log enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own goals" on public.goals;
create policy "own goals" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own time_logs" on public.time_logs;
create policy "own time_logs" on public.time_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own work_log" on public.work_log;
create policy "own work_log" on public.work_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own chat" on public.chat_messages;
create policy "own chat" on public.chat_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Auto-create a profile row the instant someone signs up
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- v2 additions — recall practice, understanding checks, digests
-- Safe to re-run: everything is "if not exists" / "or replace".
-- ============================================================

-- ---------- recall_cards (spaced repetition on the user's OWN work) ----------
create table if not exists public.recall_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  question text not null,
  answer_hint text,
  source_entry_id uuid references public.work_log(id) on delete set null,
  interval_days int default 1,
  due_at timestamptz default now(),
  last_verdict text,
  review_count int default 0,
  created_at timestamptz default now()
);

-- ---------- digests (weekly honest retrospectives) ----------
create table if not exists public.digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete set null,
  highlights text,
  honest_critique text,
  focus_next_week text,
  created_at timestamptz default now()
);

-- add the understanding-check column to work_log if it isn't there yet
alter table public.work_log add column if not exists is_understanding_check boolean default false;

alter table public.recall_cards enable row level security;
alter table public.digests enable row level security;

drop policy if exists "own recall_cards" on public.recall_cards;
create policy "own recall_cards" on public.recall_cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own digests" on public.digests;
create policy "own digests" on public.digests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists recall_due_idx on public.recall_cards(user_id, due_at);
create index if not exists worklog_user_idx on public.work_log(user_id, created_at desc);
create index if not exists chat_user_idx on public.chat_messages(user_id, created_at);
