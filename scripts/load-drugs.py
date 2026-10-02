#!/usr/bin/env python3
"""곰곰이 약 정보 DB 적재 스크립트.

입력: 건강보험심사평가원_약가마스터_의약품표준코드 CSV (공공데이터포털, 분기 갱신, 출처표시)
출력: Supabase public.drugs 테이블 (품목기준코드 × 상품명, 약 5만 행)과 검색용 역색인 public.drug_grams

사용법:
  DATABASE_URL='postgresql://...' python3 scripts/load-drugs.py            # 최신 CSV를 내려받아 적재
  DATABASE_URL='postgresql://...' python3 scripts/load-drugs.py --csv 파일.csv
  python3 scripts/load-drugs.py --dry-run                                  # DB 없이 정제 결과만 확인

DATABASE_URL은 Supabase 대시보드 상단 Connect → Session pooler 연결 문자열입니다.
표준 라이브러리와 psql만 사용합니다.
"""
import argparse, collections, csv, io, json, os, re, subprocess, sys, tempfile, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET = {'publicDataPk': '15067462', 'publicDataDetailPk': 'uddi:8116acc9-2f07-4a1f-bec0-ddc8047bec3e'}
KEEP_TYPES = {'전문의약품', '일반의약품', '전문,희귀'}
COLUMNS = ['item_seq', 'name', 'company', 'ingredient', 'rx_type', 'form', 'atc', 'is_primary']
STRENGTH = re.compile(r'\d[\d.,/]*\s*(밀리그램|밀리그람|마이크로그램|그램|밀리리터|mg|mcg|g|ml|mL|%)')


def download() -> tuple[bytes, str]:
    """공공데이터포털에서 현재 등록된 파일을 찾아 내려받습니다(분기마다 파일 ID가 바뀜)."""
    meta_url = 'https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?fileDetailSn=1&' + '&'.join(f'{k}={v}' for k, v in DATASET.items())
    with urllib.request.urlopen(meta_url, timeout=60) as r:
        meta = json.load(r)
    info = meta['fileDataRegistVO']
    print(f"내려받는 중: {info['orginlFileNm']} ({info['atchFileCo']}행)", file=sys.stderr)
    with urllib.request.urlopen(f"https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId={meta['atchFileId']}&fileDetailSn=1", timeout=600) as r:
        return r.read(), info['orginlFileNm']


def decode(raw: bytes) -> str:
    for encoding in ('utf-8-sig', 'cp949'):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            pass
    raise SystemExit('CSV 인코딩을 알 수 없습니다 (UTF-8/CP949 아님).')


def ingredient_of(name: str) -> str:
    for part in re.findall(r'\(([^()]*)', name):
        if not re.search(r'수출|1회용|병|포장|소아|성인', part):
            return part.strip()
    return ''


def build_rows(text: str) -> list[dict]:
    rows, seen = [], set()
    uses = collections.Counter()  # (품목, 이름)별 원본 행 수(포장 단위마다 한 행)
    for r in csv.DictReader(io.StringIO(text)):
        name, seq = r['한글상품명'].strip(), r['품목기준코드'].strip()
        if r['취소일자'].strip() or r['전문일반구분'].strip() not in KEEP_TYPES or '수출용' in name or not name or not seq:
            continue
        uses[(seq, name)] += 1
        if (seq, name) in seen:
            continue
        seen.add((seq, name))
        rows.append({'item_seq': seq, 'name': name, 'company': r['업체명'].strip(), 'ingredient': ingredient_of(name),
                     'rx_type': r['전문일반구분'].strip(), 'form': r['제형구분'].strip(), 'atc': r['국제표준코드(ATC코드)'].strip()})
    # 대표 공식 이름: 원본에서 가장 많이 쓰인 이름 → 함량이 적힌 이름 → 더 긴 이름.
    # 예: 세프다나 = '세프다나캡슐100밀리그램(세프디니르일수화물)'(3행), 함량 없는 옛 표기 '세프다나캡슐'(1행)이 아님.
    best = {}
    for row in rows:
        rank = (uses[(row['item_seq'], row['name'])], bool(STRENGTH.search(row['name'])), len(row['name']))
        if row['item_seq'] not in best or rank > best[row['item_seq']][0]:
            best[row['item_seq']] = (rank, row['name'])
    for row in rows:
        row['is_primary'] = 'true' if best[row['item_seq']][1] == row['name'] else 'false'
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--csv', help='이미 내려받은 약가마스터 CSV 경로')
    parser.add_argument('--dry-run', action='store_true', help='DB에 넣지 않고 정제 결과만 출력')
    parser.add_argument('--out', help='정제한 CSV를 이 경로에 저장')
    args = parser.parse_args()

    if args.csv:
        raw, source = Path(args.csv).read_bytes(), Path(args.csv).name
    else:
        raw, source = download()
    rows = build_rows(decode(raw))
    print(f'정제 완료: {len(rows):,}행, 품목 {len({r["item_seq"] for r in rows}):,}개 (원본 {source})', file=sys.stderr)

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(args.out) if args.out else Path(tmp) / 'drugs.csv'
        with out.open('w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=COLUMNS)
            writer.writeheader(); writer.writerows(rows)
        if args.dry_run:
            for r in rows[:5]:
                print(r)
            return
        url = os.environ.get('DATABASE_URL')
        if not url:
            raise SystemExit('DATABASE_URL 환경 변수가 필요합니다. (Supabase → Connect → Session pooler)')
        load = Path(tmp) / 'load.sql'
        load.write_text(
            f"\\i '{ROOT / 'supabase' / 'drugs.sql'}'\n"
            "truncate public.drug_grams; truncate public.drugs restart identity;\n"
            f"\\copy public.drugs ({', '.join(COLUMNS)}) from '{out}' with (format csv, header true, force_not_null ({', '.join(COLUMNS)}))\n"
            "select public.refresh_drug_grams();\n"
            "insert into public.drug_source (id, source, rows) values (1, :'source', (select count(*) from public.drugs))\n"
            "  on conflict (id) do update set source = excluded.source, rows = excluded.rows, loaded_at = now();\n"
            "select rows || '행 적재 완료 (' || source || ')' as result from public.drug_source;\n",
            encoding='utf-8')
        # -1: 전체를 한 트랜잭션으로 실행하므로 중간에 실패하면 기존 데이터가 그대로 남습니다.
        subprocess.run(['psql', url, '-1', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-v', f'source=건강보험심사평가원 {source}', '-f', str(load)], check=True)


if __name__ == '__main__':
    main()
