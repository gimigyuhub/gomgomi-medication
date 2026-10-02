-- 곰곰이 약 정보 DB: 건강보험심사평가원 약가마스터(의약품표준코드)에서 만든 제품명 사전.
-- scripts/load-drugs.py가 이 파일을 적용한 뒤 데이터를 채웁니다. 여러 번 실행해도 안전합니다.
-- 공공데이터라 로그인하지 않은 사용자도 검색할 수 있고, 쓰기는 적재 스크립트(데이터베이스 소유자)만 합니다.

-- 괄호 속 설명을 지웁니다. 중첩 괄호 '스티렌정(애엽…(20→1))'와 닫히지 않은 괄호도 처리합니다.
create or replace function public.drug_strip_parens(t text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(t, ''),
    '\([^()]*\)', '', 'g'), '\([^()]*\)', '', 'g'), '\(.*$', ''), '\)', '', 'g')
$$;

-- 비교용 키: 괄호(성분명·포장 설명)를 빼고, 단위를 통일하고, 공백과 기호를 지웁니다.
-- '카나브정30밀리그램(피마사르탄칼륨삼수화물)' → '카나브정30mg'
create or replace function public.drug_key(t text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(
    replace(replace(replace(replace(replace(replace(
      lower(public.drug_strip_parens(t)),
      '마이크로그램', 'mcg'), '밀리그램', 'mg'), '밀리그람', 'mg'), '밀리리터', 'ml'), '그램', 'g'), '퍼센트', '%'),
    '[^가-힣a-z0-9./%]', '', 'g')
$$;

-- 문자열을 n글자씩 겹쳐 자른 조각 목록
create or replace function public.drug_ngrams(t text, n int) returns text[]
language sql immutable parallel safe as $$
  select coalesce(array_agg(distinct substr(t, i, n)), '{}')
  from generate_series(1, greatest(char_length(t) - n + 1, 0)) as i
$$;

-- 검색용 조각 = 음절 2글자 조각 + 자모 3글자 조각('j' 접두어).
-- OCR은 '정'을 '졍'처럼 자모 하나만 틀리는 경우가 많아, 음절을 자모로 풀어(NFD) 비교하면 그런 오류에 강해집니다.
-- 시뮬레이션(제품 400개)에서 글자 2개 오인식 시 1순위 정확도 57% → 75%, 3순위 이내 74% → 89%.
create or replace function public.drug_key_grams(k text) returns text[]
language sql immutable parallel safe as $$
  select public.drug_ngrams(k, 2) || array(select 'j' || g from unnest(public.drug_ngrams(normalize(k, NFD), 3)) as g)
$$;

-- 화면에 보여줄 이름: 괄호만 빼고 단위를 짧게 씁니다. '카나브정30mg'
create or replace function public.drug_display(t text) returns text
language sql immutable parallel safe as $$
  select btrim(replace(replace(replace(replace(replace(
    public.drug_strip_parens(t),
    '마이크로그램', 'mcg'), '밀리그램', 'mg'), '밀리그람', 'mg'), '밀리리터', 'mL'), '그램', 'g'))
$$;

create table if not exists public.drugs (
  id bigint generated always as identity unique,
  item_seq text not null,               -- 품목기준코드 (식약처 품목 ID, medikr.kr /api/drug/{item_seq}.json과 같음)
  name text not null,                   -- 한글상품명 원문
  company text not null default '',
  ingredient text not null default '',  -- 상품명 괄호 속 성분명
  rx_type text not null default '',     -- 전문의약품 / 일반의약품
  form text not null default '',        -- 제형구분
  atc text not null default '',
  display_name text generated always as (public.drug_display(name)) stored,
  key text generated always as (public.drug_key(name)) stored,
  n_grams int generated always as (cardinality(public.drug_key_grams(public.drug_key(name)))) stored,
  is_primary boolean not null default false,  -- 품목의 대표 공식 이름(원본에서 가장 많이 쓰인 이름)
  primary key (item_seq, name)
);
alter table public.drugs add column if not exists is_primary boolean not null default false;  -- 이전 버전 테이블
create index if not exists drugs_primary_idx on public.drugs (item_seq) where is_primary;
create index if not exists drugs_key_idx on public.drugs (key);

-- 검색용 조각 → 제품 역색인. 조각 하나에 그 조각을 가진 제품 id 목록(와 제품별 조각 수)을 담습니다.
-- 조각×제품을 한 행씩 두면 120MB가 넘어서, 목록으로 묶어 크기를 줄였습니다.
create table if not exists public.drug_grams (
  gram text primary key,
  drug_ids bigint[] not null,
  n_grams int[] not null   -- drug_ids와 같은 순서의 제품명 조각 수(점수 계산용)
);

create or replace function public.refresh_drug_grams() returns void
language sql as $$
  truncate public.drug_grams;
  insert into public.drug_grams (gram, drug_ids, n_grams)
  select gram, array_agg(id order by id), array_agg(n_grams order by id)
  from (select distinct unnest(public.drug_key_grams(key)) as gram, id, n_grams from public.drugs) t
  group by gram;
  analyze public.drugs; analyze public.drug_grams;
$$;

create table if not exists public.drug_source (
  id int primary key default 1 check (id = 1),
  source text not null,
  loaded_at timestamptz not null default now(),
  rows int not null
);

alter table public.drugs enable row level security;
alter table public.drug_grams enable row level security;
alter table public.drug_source enable row level security;
revoke all on public.drugs, public.drug_grams, public.drug_source from anon, authenticated;
grant select on public.drugs, public.drug_grams, public.drug_source to anon, authenticated;
drop policy if exists "Public read" on public.drug_grams;
create policy "Public read" on public.drug_grams for select to anon, authenticated using (true);
drop policy if exists "Public read" on public.drugs;
create policy "Public read" on public.drugs for select to anon, authenticated using (true);
drop policy if exists "Public read" on public.drug_source;
create policy "Public read" on public.drug_source for select to anon, authenticated using (true);

-- OCR로 읽은 줄 여러 개를 받아, 줄마다 가장 비슷한 제품을 돌려줍니다.
-- score: 제품명 조각 중 그 줄에 들어 있는 비율(cover)과 두 조각 집합의 겹침 정도(dice)를 섞은 0~1 값.
create or replace function public.match_drugs(queries text[], max_per_query int default 3)
returns table (query_index int, item_seq text, display_name text, name text, company text, ingredient text, rx_type text, score real)
language sql stable parallel safe set search_path = public as $$
  -- materialized: 질의 조각을 한 번만 계산합니다(없으면 후보 행마다 다시 계산해 수십 배 느려짐).
  with q as materialized (
    select (ord - 1)::int as query_index, public.drug_key_grams(public.drug_key(query)) as grams
    from unnest(queries[1:30]) with ordinality as u(query, ord)
  )
  -- 어떤 이름 표기로 찾았든 결과에는 그 품목의 대표 공식 이름을 돌려줍니다.
  select r.query_index, r.item_seq, coalesce(p.display_name, r.display_name), coalesce(p.name, r.name), r.company, coalesce(nullif(p.ingredient, ''), r.ingredient), r.rx_type, r.score
  from (
    select b.*, row_number() over (partition by b.query_index order by b.score desc, char_length(b.key)) as rank
    from (
      -- 같은 품목의 이름 변형(포장·성분 표기 차이)은 가장 점수가 높은 하나만 남깁니다.
      select distinct on (q.query_index, d.item_seq) q.query_index, d.item_seq, d.display_name, d.name, d.company, d.ingredient, d.rx_type, d.key, m.score
      from q cross join lateral (
        select h.drug_id, (0.6 * h.common / h.n_grams + 0.4 * 2.0 * h.common / (h.n_grams + cardinality(q.grams)))::real as score
        from (select p.drug_id, p.n_grams, count(*)::float8 as common
              from public.drug_grams g cross join lateral unnest(g.drug_ids, g.n_grams) as p(drug_id, n_grams)
              where g.gram = any(q.grams) group by p.drug_id, p.n_grams) h
        where cardinality(q.grams) > 0
        order by score desc, h.n_grams
        limit 40
      ) m
      join public.drugs d on d.id = m.drug_id
      order by q.query_index, d.item_seq, m.score desc, char_length(d.name)
    ) b
  ) r
  left join public.drugs p on p.item_seq = r.item_seq and p.is_primary
  where r.rank <= least(greatest(max_per_query, 1), 10)
  order by r.query_index, r.rank
$$;
grant execute on function public.match_drugs(text[], int) to anon, authenticated;

drop function if exists public.drug_bigrams(text);  -- 이전 버전에서 쓰던 함수
