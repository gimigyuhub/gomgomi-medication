// 공식 제품명(약가마스터 한글상품명)을 화면용으로 나눕니다.
// 입력: '세프다나캡슐100밀리그램(세프디니르)'
// 출력: {base: '세프다나캡슐', strength: '100mg', ingredient: '세프디니르'}
// 함량은 이름 끝에 붙은 숫자+단위만 뗍니다. '트라몰8시간서방정650밀리그람'의 '8시간'처럼 이름 중간 숫자는 그대로 둡니다.

const UNIT = '(?:마이크로그램|밀리그램|밀리그람|밀리리터|그램|퍼센트|mcg|μg|mg|mL|ml|g|%|IU|단위)';
const AMOUNT = `\\d[\\d.,]*\\s*${UNIT}?`;
// 예: 100밀리그램, 5/80밀리그램, 40/12.5mg, 0.05%, 250mg/5mL
const STRENGTH = new RegExp(`(${AMOUNT}(?:\\s*\\/\\s*${AMOUNT})*)\\s*$`);
const SHORT_UNIT = [['마이크로그램', 'mcg'], ['밀리그램', 'mg'], ['밀리그람', 'mg'], ['밀리리터', 'mL'], ['그램', 'g'], ['퍼센트', '%']];

export function splitDrugName(full = '') {
  // 바깥 괄호 단위로 나눕니다. '스티렌정(애엽95%에탄올연조엑스(20→1))' → ['애엽95%에탄올연조엑스(20→1)']
  const parens = []; let depth = 0, start = -1;
  for (let i = 0; i < full.length; i++) {
    if (full[i] === '(') { if (depth++ === 0) start = i + 1; }
    else if (full[i] === ')' && depth > 0 && --depth === 0) parens.push(full.slice(start, i).trim());
  }
  const ingredient = parens.find(p => !/수출|1회용|비매품|병|포장|소아|성인/.test(p)) || '';
  // 중첩·닫히지 않은 괄호까지 지운 이름 (supabase-drugs.sql의 drug_strip_parens와 같은 규칙)
  let name = full;
  for (let i = 0; i < 2; i++) name = name.replace(/\([^()]*\)/g, '');
  name = name.replace(/\(.*$/, '').replace(/\)/g, '').trim();
  const m = name.match(STRENGTH);
  // 숫자가 단위 없이 끝나면(예: '비타500') 함량으로 보지 않습니다.
  if (!m || !new RegExp(`${UNIT}`).test(m[1]) || m.index === 0) return {base: name, strength: '', ingredient};
  let strength = m[1].replace(/\s+/g, '');
  for (const [long, short] of SHORT_UNIT) strength = strength.split(long).join(short);
  return {base: name.slice(0, m.index).trim(), strength, ingredient};
}
