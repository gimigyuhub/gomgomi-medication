// 곰곰이 표정 규칙: 오늘의 복용 상태와 최근 기록으로 곰곰이의 기분을 정합니다.
//
// 입력: profile = {meds: [{id, name, times, createdAt}], logs: {'YYYY-MM-DD': {'약id:시간대': true}}, completedDays}
//       now = 현재 시각(Date)
// 출력: bearMood() → {mood, title, detail, action, caution, slots, history}
//   mood: 'sleepy' | 'proud' | 'angry' | 'crying' | 'worried' | 'waiting' | 'happy' | 'calm'
//   action: 지금 체크하면 좋은 시간대 {time, label} (없으면 null)

// 시간대별 기준 시각(자정부터 분). '기타'는 정해진 시각이 없습니다.
import {splitDrugName} from './drug-name.js';

export const SLOT_MINUTES = {
  '아침 식전': 7 * 60 + 30, '아침': 8 * 60, '아침 식후': 8 * 60 + 30,
  '점심 식전': 12 * 60, '점심': 12 * 60 + 30, '점심 식후': 13 * 60,
  '저녁 식전': 18 * 60, '저녁': 18 * 60 + 30, '저녁 식후': 19 * 60,
  '취침 전': 22 * 60, '기타': null,
};
export const SLOT_ORDER = Object.keys(SLOT_MINUTES);
const DUE_BEFORE = 30;     // 기준 30분 전부터 '지금 먹을 시간'
const LATE_AFTER = 90;     // 기준 90분이 지나면 '늦음'
const MISSED_AFTER = 240;  // 기준 4시간이 지나면 '놓침'

export const dayKey = date => date.toLocaleDateString('sv-SE');
export const clockLabel = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const minutesOf = date => date.getHours() * 60 + date.getMinutes();
const isTaken = (profile, day, medId, time) => !!profile.logs?.[day]?.[`${medId}:${time}`];

// 그 날짜에 이미 등록돼 있던 약만 그날의 예정에 넣습니다.
function medsOn(profile, day) {
  return (profile.meds || []).filter(m => !m.createdAt || dayKey(new Date(m.createdAt)) <= day);
}

// 오늘 시간대별 상태. status: done | upcoming | due | late | missed | anytime
export function todaySlots(profile, now = new Date()) {
  const day = dayKey(now), current = minutesOf(now);
  const meds = medsOn(profile, day);
  return SLOT_ORDER.map(time => {
    const list = meds.filter(m => (m.times || []).includes(time));
    if (!list.length) return null;
    const takenCount = list.filter(m => isTaken(profile, day, m.id, time)).length;
    const at = SLOT_MINUTES[time];
    let status;
    if (takenCount === list.length) status = 'done';
    else if (at === null) status = 'anytime';
    else if (current < at - DUE_BEFORE) status = 'upcoming';
    else if (current <= at + LATE_AFTER) status = 'due';
    else if (current <= at + MISSED_AFTER) status = 'late';
    else status = 'missed';
    return {time, at, meds: list, taken: takenCount, total: list.length, status, overdueMinutes: at === null ? 0 : Math.max(0, current - at)};
  }).filter(Boolean);
}

// 어제부터 거슬러 올라간 최근 기록. 오늘은 아직 진행 중이라 넣지 않습니다.
export function recentHistory(profile, now = new Date(), days = 7) {
  const perDay = [];
  for (let back = 1; back <= days; back++) {
    const date = new Date(now); date.setDate(date.getDate() - back);
    const day = dayKey(date);
    let scheduled = 0, taken = 0;
    for (const m of medsOn(profile, day)) for (const time of m.times || []) {
      scheduled++;
      if (isTaken(profile, day, m.id, time)) taken++;
    }
    perDay.push({day, scheduled, taken});
  }
  const counted = perDay.filter(d => d.scheduled > 0);
  const scheduled = counted.reduce((n, d) => n + d.scheduled, 0), taken = counted.reduce((n, d) => n + d.taken, 0);
  let missStreak = 0;
  for (const d of perDay) { if (d.scheduled > 0 && d.taken === 0) missStreak++; else break; }
  const yesterday = perDay[0];
  return {perDay, rate: scheduled ? taken / scheduled : null, missStreak, missedYesterday: !!yesterday && yesterday.scheduled > 0 && yesterday.taken < yesterday.scheduled};
}

export function completionStreak(profile, now = new Date()) {
  const date = new Date(now);
  if (!profile.completedDays?.[dayKey(date)]) date.setDate(date.getDate() - 1);
  let count = 0;
  while (profile.completedDays?.[dayKey(date)]) { count++; date.setDate(date.getDate() - 1); }
  return count;
}

const namesOf = slot => {
  const left = slot.meds.filter(m => !m.takenToday).map(m => splitDrugName(m.name).base || m.name);
  return left.length > 2 ? `${left[0]} 외 ${left.length - 1}개` : left.join(', ');
};
const hoursAgo = minutes => minutes >= 60 ? `${Math.floor(minutes / 60)}시간${minutes % 60 >= 30 ? ' 반' : ''}` : `${minutes}분`;
const CAUTION = '놓친 약을 다음 번에 두 배로 먹지 마세요. 약마다 다르니 약사에게 물어보세요.';

export function bearMood(profile, now = new Date()) {
  const day = dayKey(now);
  const slots = todaySlots(profile, now).map(s => ({...s, meds: s.meds.map(m => ({...m, takenToday: isTaken(profile, day, m.id, s.time)}))}));
  const history = recentHistory(profile, now);
  const streak = completionStreak(profile, now);
  const base = {slots, history, streak, action: null, caution: null};

  if (!(profile.meds || []).length) return {...base, mood: 'sleepy', title: '약을 등록하면 곰곰이가 깨어나요', detail: '약 봉투나 처방전 사진을 올려 오늘 챙길 약을 채워 보세요.'};

  const open = slots.filter(s => s.status !== 'done');
  const missed = open.filter(s => s.status === 'missed'), late = open.filter(s => s.status === 'late'), due = open.filter(s => s.status === 'due');
  const takenToday = slots.reduce((n, s) => n + s.taken, 0);
  const actionOf = s => s && {time: s.time, label: s.time};
  const pct = history.rate === null ? null : Math.round(history.rate * 100);

  if (slots.length && !open.length) return {...base, mood: 'proud', title: '오늘 약을 다 챙겼어요!',
    detail: streak >= 2 ? `${streak}일 연속으로 하루 약을 모두 챙겼어요.` : history.missedYesterday ? '어제 놓친 날도 있었지만 오늘은 다 챙겼어요.' : '내일도 같이 챙겨요.'};

  if (missed.length >= 2 || (history.missStreak >= 2 && takenToday === 0)) return {...base, mood: 'angry', title: '곰곰이 삐졌어요!',
    detail: missed.length >= 2 ? `오늘 ${missed.map(s => s.time).join(', ')} 약을 아직 체크하지 않았어요.` : `${history.missStreak}일째 복용 체크가 없어요.`,
    action: actionOf(missed.at(-1) || late.at(-1) || due[0]), caution: missed.length ? CAUTION : null};

  if (missed.length === 1 || (pct !== null && pct < 50 && takenToday === 0)) return {...base, mood: 'crying', title: '약을 놓친 것 같아 속상해요',
    detail: missed.length ? `${missed[0].time} 약(${namesOf(missed[0])})을 체크하지 않았어요.` : `최근 7일 동안 약의 ${pct}%만 체크했어요.`,
    action: actionOf(missed[0] || late[0] || due[0]), caution: missed.length ? CAUTION : null};

  if (late.length) return {...base, mood: 'worried', title: '혹시 약 먹는 걸 잊었나요?',
    detail: `${late[0].time} 약 시간이 ${hoursAgo(late[0].overdueMinutes)} 지났어요. ${namesOf(late[0])}`, action: actionOf(late[0])};

  if (due.length) return {...base, mood: 'waiting', title: '지금 약 먹을 시간이에요!',
    detail: `${due[0].time} · ${namesOf(due[0])}`, action: actionOf(due[0])};

  if (history.missedYesterday || (pct !== null && pct < 80)) return {...base, mood: 'worried', title: '오늘은 꼭 같이 챙겨요',
    detail: history.missedYesterday ? '어제 체크하지 못한 약이 있었어요.' : `최근 7일 동안 약의 ${pct}%를 체크했어요.`};

  const next = open.find(s => s.status === 'upcoming');
  const nextText = next ? `다음은 ${next.time}(${clockLabel(next.at)}) 약이에요.` : open.some(s => s.status === 'anytime') ? '시간이 정해지지 않은 약이 남아 있어요.' : '';
  return streak >= 3
    ? {...base, mood: 'happy', title: `${streak}일째 꾸준해서 기분 좋아요`, detail: nextText}
    : {...base, mood: 'calm', title: '오늘도 차근차근 챙겨요', detail: nextText};
}
