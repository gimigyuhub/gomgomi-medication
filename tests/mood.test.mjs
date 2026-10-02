// 실행: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {bearMood, todaySlots, recentHistory} from '../src/mood.js';

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m);  // 2026-10-d h:m (현지 시각)
const key = d => `2026-10-${String(d).padStart(2, '0')}`;
const med = (id, times, createdDay = 1) => ({id, name: `${id}약`, times, createdAt: at(createdDay, 0).toISOString()});
const THREE = ['아침 식후', '점심 식후', '저녁 식후'];
// 과거 날짜 전체 복용 체크
const fullDays = (meds, days) => Object.fromEntries(days.map(d => [key(d), Object.fromEntries(meds.flatMap(m => m.times.map(t => [`${m.id}:${t}`, true])))]));

test('약이 없으면 졸림', () => {
  assert.equal(bearMood({meds: [], logs: {}}, at(3, 9)).mood, 'sleepy');
});

test('아침 식후 기준 시각 전후로 곧 → 지금 → 늦음 → 놓침', () => {
  const p = {meds: [med('a', ['아침 식후'])], logs: fullDays([med('a', ['아침 식후'])], [1, 2])};
  const status = (h, m) => todaySlots(p, at(3, h, m))[0].status;
  assert.equal(status(7, 30), 'upcoming');
  assert.equal(status(8, 10), 'due');
  assert.equal(status(10, 30), 'late');
  assert.equal(status(13, 0), 'missed');
});

test('지금 먹을 시간이면 재촉, 체크할 시간대를 알려 줌', () => {
  const meds = [med('a', THREE)];
  const r = bearMood({meds, logs: fullDays(meds, [1, 2])}, at(3, 8, 40));
  assert.equal(r.mood, 'waiting');
  assert.equal(r.action.time, '아침 식후');
});

test('늦으면 걱정, 한 번 놓치면 울음 + 안전 안내, 두 번 놓치면 삐짐', () => {
  const meds = [med('a', THREE)];
  const logs = fullDays(meds, [1, 2]);
  assert.equal(bearMood({meds, logs}, at(3, 10, 30)).mood, 'worried');
  const crying = bearMood({meds, logs}, at(3, 13, 0));   // 아침 식후 4시간 30분 지남
  assert.equal(crying.mood, 'crying');
  assert.match(crying.caution, /두 배/);
  assert.equal(bearMood({meds, logs}, at(3, 17, 30)).mood, 'angry'); // 아침·점심 모두 놓침
});

test('오늘 모두 체크하면 뿌듯, 어제를 놓쳤어도 오늘 다 하면 뿌듯', () => {
  const meds = [med('a', ['아침 식후', '저녁 식후'])];
  const logs = {...fullDays(meds, [1]), [key(3)]: {'a:아침 식후': true, 'a:저녁 식후': true}};
  const r = bearMood({meds, logs, completedDays: {[key(1)]: true, [key(3)]: true}}, at(3, 21));
  assert.equal(r.mood, 'proud');
  assert.match(r.detail, /어제/);
});

test('이틀 연속 체크가 하나도 없고 오늘도 없으면 아침이라도 삐짐', () => {
  const meds = [med('a', THREE)];
  const r = bearMood({meds, logs: {}}, at(3, 7, 0));
  assert.equal(r.mood, 'angry');
  assert.equal(recentHistory({meds, logs: {}}, at(3, 7)).missStreak, 2);
});

test('오늘 등록한 약은 지난날 기록에 넣지 않음', () => {
  const meds = [med('a', THREE, 3)];
  const h = recentHistory({meds, logs: {}}, at(3, 7));
  assert.equal(h.rate, null);
  assert.equal(bearMood({meds, logs: {}}, at(3, 7)).mood, 'calm');
});

test('연속 완봉 2일이면 평온, 3일이면 기쁨 (다음 약을 기다리는 중)', () => {
  const meds = [med('a', ['저녁 식후'], 1)];
  const logs = fullDays(meds, [1, 2]);
  assert.equal(bearMood({meds, logs, completedDays: {[key(1)]: true, [key(2)]: true}}, at(3, 9)).mood, 'calm');
  const happy = bearMood({meds, logs, completedDays: {'2026-09-30': true, [key(1)]: true, [key(2)]: true}}, at(3, 9));
  assert.equal(happy.mood, 'happy');
  assert.match(happy.detail, /저녁 식후\(19:00\)/);
});

test('시간이 정해지지 않은 약(기타)은 놓침으로 보지 않음', () => {
  const meds = [med('a', ['기타'])];
  const r = bearMood({meds, logs: fullDays(meds, [1, 2])}, at(3, 23));
  assert.equal(todaySlots({meds, logs: {}}, at(3, 23))[0].status, 'anytime');
  assert.notEqual(r.mood, 'crying');
});
