# 설치와 배포

## Supabase 준비

1. Supabase 프로젝트의 SQL Editor에서 `supabase/schema.sql`을 실행해 테이블 4개와 사용자별 RLS 규칙을 만듭니다. 여러 번 실행해도 안전합니다.
2. Authentication의 URL Configuration에 배포할 GitHub Pages 주소를 Site URL과 Redirect URLs로 추가합니다.
3. 앱은 Google 로그인만 사용합니다. 다른 방법으로 계정이 만들어지지 않도록 Sign In / Providers에서 **Email** 공급자를 끕니다.
4. Google 로그인을 켭니다.
   - Google Cloud Console → API 및 서비스 → OAuth 동의 화면을 구성하고, 사용자 인증 정보에서 **웹 애플리케이션** 유형의 OAuth 클라이언트 ID를 만듭니다.
   - 승인된 JavaScript 원본에 GitHub Pages 주소(예: `https://<아이디>.github.io`)를, 승인된 리디렉션 URI에 Supabase 콜백 주소 `https://<프로젝트-ref>.supabase.co/auth/v1/callback`을 추가합니다.
   - Supabase → Authentication → CONFIGURATION의 **Sign In / Providers** → 아래쪽 Auth Providers 목록에서 **Google**을 열어 켜고, 클라이언트 ID와 클라이언트 보안 비밀을 입력합니다.
5. 약 정보 DB를 채웁니다. 아래 **약 정보 DB 적재**를 참고하세요.
6. GitHub 저장소 Secrets에 `SUPABASE_URL`과 `SUPABASE_PUBLISHABLE_KEY`를 설정합니다. Pages 워크플로가 배포 때 `src/supabase-config.js`를 생성합니다.

`SUPABASE_PUBLISHABLE_KEY`는 공개 브라우저에서 사용하도록 만들어진 키입니다. GitHub Secret에 넣어 저장소 소스에는 남기지 않지만, 배포된 웹 페이지에서 방문자가 볼 수 있습니다. 실제 복용 기록은 인증과 RLS로 보호합니다. 서비스 역할 키는 이 프로젝트에 넣지 마세요.

## 약 정보 DB 적재

| 단계 | 입력 → 출력 |
|---|---|
| 내려받기 | 공공데이터포털 `건강보험심사평가원_약가마스터_의약품표준코드` CSV (약 56MB, 약 30만 행, CP949) |
| 정제 | 취소된 품목·한약재·원료의약품·수출용 제외 → 품목기준코드 × 상품명 약 5.1만 행. 품목마다 대표 공식 이름 1개 표시(`is_primary`: 원본에서 가장 많이 쓰인 이름 → 함량이 적힌 이름 → 더 긴 이름) |
| 적재 | `public.drugs`(제품명 사전) + `public.drug_grams`(두 글자 조각 역색인) |
| 검색 | `match_drugs(OCR 줄 배열)` → 줄마다 비슷한 제품 상위 N개와 점수(0~1) |

Supabase 대시보드 상단 **Connect → Session pooler** 연결 문자열을 복사해 저장소 폴더에서 한 번 실행합니다(필요: Python 3, `psql`). 스키마 적용·데이터 교체가 한 트랜잭션으로 실행되어, 실패하면 기존 데이터가 그대로 남습니다. 약가마스터는 분기마다 갱신되므로 같은 명령으로 다시 적재하면 됩니다.

```bash
DATABASE_URL='postgresql://postgres.<프로젝트-ref>:<비밀번호>@<리전>.pooler.supabase.com:5432/postgres' python3 scripts/load-drugs.py
```

`--dry-run`으로 DB 없이 정제 결과만 확인할 수 있습니다.

## 로컬 실행

정적 웹 서버로 저장소 루트를 열면 됩니다(모듈 스크립트라 `file://`로는 열 수 없습니다).

```bash
cp src/supabase-config.example.js src/supabase-config.js   # 프로젝트 URL과 publishable key 입력
npm start                                                 # http://localhost:5174
```

Supabase Redirect URLs에 로컬 주소(예: `http://localhost:5174/**`)를 추가하세요. OCR 엔진(onnxruntime-web)과 의약품 검색에는 인터넷 연결이 필요합니다.

## 배포

`main` 브랜치에 푸시하면 `.github/workflows/pages.yml`이 `index.html`·`sw.js`·`manifest.webmanifest`·`src/`·`assets/`를 GitHub Pages로 배포하고, 저장소 Secrets로 `src/supabase-config.js`를 만듭니다.
