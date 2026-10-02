-- Supabase SQL Editor에서 실행합니다. 의료 정보가 포함될 수 있으므로 RLS를 필수로 사용합니다.
create table if not exists public.medication_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint medication_state_payload_object check (jsonb_typeof(payload) = 'object')
);

alter table public.medication_state enable row level security;
revoke all on public.medication_state from anon;
grant select, insert, update, delete on public.medication_state to authenticated;

create policy "Read own medication state"
on public.medication_state for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Insert own medication state"
on public.medication_state for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Update own medication state"
on public.medication_state for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Delete own medication state"
on public.medication_state for delete to authenticated
using ((select auth.uid()) = user_id);
