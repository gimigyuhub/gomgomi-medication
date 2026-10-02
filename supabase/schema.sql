-- Supabase SQL Editor에서 한 번 실행합니다. 의료 정보가 포함될 수 있으므로 모든 테이블에 RLS를 사용합니다.
-- 모든 행에는 owner_id(로그인한 계정)가 있고, 계정 주인만 자기 행을 읽고 쓸 수 있습니다.
-- 복합 외래 키 (…, owner_id)로 다른 계정의 가족 구성원·약에 기록을 붙일 수 없게 막습니다.

-- 가족 구성원: 한 계정이 여러 사람의 약을 관리합니다.
create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  avatar text not null default 'a1' check (char_length(avatar) <= 8),
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

-- 약 보관함
create table if not exists public.medications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  member_id uuid not null,
  name text not null check (char_length(name) between 1 and 100),
  dose text not null check (char_length(dose) between 1 and 50),
  times text[] not null default '{}',
  item_seq text,          -- 곰곰이 약 DB(public.drugs)의 품목기준코드. 직접 입력한 약은 비어 있음
  drug_info jsonb,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (member_id, owner_id) references public.family_members (id, owner_id) on delete cascade
);

-- 복용 체크: 체크 한 번이 한 행입니다. 약을 지워도 복용 기록은 약 이름과 함께 남습니다.
create table if not exists public.dose_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  member_id uuid not null,
  medication_id uuid,
  med_name text not null,
  dose_date date not null,
  time_label text not null,
  taken_at timestamptz not null default now(),
  unique (medication_id, dose_date, time_label),
  foreign key (member_id, owner_id) references public.family_members (id, owner_id) on delete cascade,
  foreign key (medication_id, owner_id) references public.medications (id, owner_id) on delete set null (medication_id)
);

-- 하루 완봉: 그날 예정된 복용을 모두 체크한 날
create table if not exists public.completed_days (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  member_id uuid not null,
  day date not null,
  primary key (member_id, day),
  foreign key (member_id, owner_id) references public.family_members (id, owner_id) on delete cascade
);

alter table public.medications add column if not exists item_seq text;  -- 이전 버전 스키마를 이미 실행한 경우

create index if not exists medications_owner_idx on public.medications (owner_id);
create index if not exists dose_logs_owner_idx on public.dose_logs (owner_id, taken_at);
create index if not exists completed_days_owner_idx on public.completed_days (owner_id);

do $$
declare t text;
begin
  foreach t in array array['family_members','medications','dose_logs','completed_days'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "Own rows" on public.%I', t);
    execute format('create policy "Own rows" on public.%I for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)', t);
  end loop;
end $$;
