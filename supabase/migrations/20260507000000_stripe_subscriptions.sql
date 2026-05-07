-- Migration: Stripe subscription columns on rvn_profiles
-- Run this in Supabase Dashboard → SQL Editor

-- Create rvn_profiles if it doesn't exist yet
create table if not exists public.rvn_profiles (
  id                    uuid default gen_random_uuid() primary key,
  user_id               uuid references auth.users(id) on delete cascade,
  email                 text,
  name                  text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- Stripe / subscription columns
alter table public.rvn_profiles
  add column if not exists stripe_customer_id      text,
  add column if not exists stripe_subscription_id  text,
  add column if not exists subscription_status     text default 'free',
  add column if not exists subscription_tier       text default 'free',
  add column if not exists gym_id                  text,
  add column if not exists gym_name                text,
  add column if not exists gym_tier                text;

-- Unique constraints so webhook upserts work correctly
create unique index if not exists rvn_profiles_user_id_key
  on public.rvn_profiles (user_id)
  where user_id is not null;

create unique index if not exists rvn_profiles_email_key
  on public.rvn_profiles (email)
  where email is not null;

create unique index if not exists rvn_profiles_stripe_customer_id_key
  on public.rvn_profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- Row-level security: users can only read/write their own row
alter table public.rvn_profiles enable row level security;

create policy if not exists "Users can read own profile"
  on public.rvn_profiles for select
  using (auth.uid() = user_id);

create policy if not exists "Users can update own profile"
  on public.rvn_profiles for update
  using (auth.uid() = user_id);

create policy if not exists "Users can insert own profile"
  on public.rvn_profiles for insert
  with check (auth.uid() = user_id);

-- Service role bypasses RLS (webhook function uses service role key)
-- No extra policy needed — service role always bypasses RLS in Supabase.

-- Trigger: auto-update updated_at on every row change
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_rvn_profiles_updated on public.rvn_profiles;
create trigger on_rvn_profiles_updated
  before update on public.rvn_profiles
  for each row execute procedure public.handle_updated_at();
