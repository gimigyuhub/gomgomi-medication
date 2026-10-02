import {bearMood, todaySlots, recentHistory, completionStreak, clockLabel, SLOT_ORDER} from './mood.js';
import {createBear, MOOD_LABEL} from './bear.js';
import {splitDrugName} from './drug-name.js';
import {haptic, floatText, confetti, bearReact, celebrate} from './game.js';
const LEGACY_KEY = 'gomgomi-medication-v3'; // 로그인 도입 전 기기에 저장되던 기록 (첫 로그인 때 계정으로 옮김)
const ACTIVE_KEY = 'gomgomi-active-member';
const API_BASE = 'https://medikr.kr/api';
// 의약품안전나라 제품 상세(식약처 허가사항: 효능효과·용법용량·사용상의주의사항). 모든 품목기준코드에 있습니다.
const NEDRUG_ITEM = seq => `https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=${encodeURIComponent(seq)}`;
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toLocaleDateString('sv-SE');
// 가족 구성원 아바타: Material 아이콘 + 색. 저장값은 'a1'~'a8'(예전 이모지 값은 같은 순서의 키로 바꿉니다).
const AVATAR_SET = {
  a1: {icon: 'face', bg: '#F6DCC8', fg: '#8A4E2A'}, a2: {icon: 'face_3', bg: '#F8D6DF', fg: '#9A3B57'}, a3: {icon: 'face_6', bg: '#D8E6F6', fg: '#2F5E8F'},
  a4: {icon: 'child_care', bg: '#E0EFD6', fg: '#3E6E2E'}, a5: {icon: 'elderly', bg: '#E9E1F4', fg: '#5D3F86'}, a6: {icon: 'elderly_woman', bg: '#FAE8C8', fg: '#86560F'},
  a7: {icon: 'person', bg: '#D6ECE5', fg: '#2B6B5C'}, a8: {icon: 'pets', bg: '#EFE2D3', fg: '#6E4A2B'},
};
const AVATARS = Object.keys(AVATAR_SET);
const LEGACY_AVATARS = ['🐻','🐰','🐱','🐶','🦊','🐼','🐥','🐢'];
const avatarKey = v => AVATAR_SET[v] ? v : AVATARS[Math.max(0, LEGACY_AVATARS.indexOf(v))];
const mi = (name, cls = '') => `<span class="mi${cls ? ` ${cls}` : ''}" aria-hidden="true">${name}</span>`;
const avatarHtml = (key, cls = '') => { const a = AVATAR_SET[avatarKey(key)]; return `<span class="avatar-dot ${cls}" style="background:${a.bg};color:${a.fg}" aria-hidden="true">${mi(a.icon, 'filled')}</span>`; };
const GOOGLE_ICON = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 화면용 상태: 서버의 네 테이블(family_members, medications, dose_logs, completed_days)에서 만듭니다.
// store = {activeProfileId, profiles:[{id,name,avatar,meds,logs:{날짜:{'약id:시간':true}},history,completedDays}]}
let store = {activeProfileId: null, profiles: []};
let state = null;
let editingProfileId = null;
let pickedAvatar = AVATARS[0];
let recognized = [];
let ocrText = '';
let selectedFile = null;
let currentPage = 'home';
let supabaseClient = null;
let cloudUser = null;
let sessionHandled = false;
let writeQueue = Promise.resolve();
let stageBear = null, bootBearCtl = null;
const bootBear = () => (bootBearCtl ??= createBear(document.querySelector('#bootBear'), {mood: 'sleepy'}));

// 로그인 전(둘러보기)에는 저장하지 않는 빈 화면을 씁니다. 저장이 필요한 기능은 requireLogin()으로 막습니다.
const guestStore = () => ({activeProfileId: 'guest', profiles: [{id: 'guest', name: '나', avatar: AVATARS[0], meds: [], logs: {}, history: [], completedDays: {}}]});
function requireLogin() {
  if (cloudUser) return false;
  openModal('#authModal');
  return true;
}
function enterGuest(message = '') {
  store = guestStore(); state = activeProfile();
  updateAccountUi(); setView('app'); render();
  if (message) toast(message);
}
function updateAccountUi() {
  const label = cloudUser?.user_metadata?.full_name || cloudUser?.email || '내 계정';
  $('#accountName').textContent = cloudUser ? label : 'Google로 로그인';
  $('#accountStatus').textContent = cloudUser ? (cloudUser.email || '로그인됨') : '로그인하면 기록이 저장돼요';
  $('#authTitle').textContent = cloudUser ? '곰곰이 계정' : '로그인이 필요해요';
  $('#authGuest').classList.toggle('hidden', !!cloudUser);
  $('#authUser').classList.toggle('hidden', !cloudUser);
  $('#authStatus').textContent = cloudUser ? `${cloudUser.email || label} 계정으로 로그인했어요. 가족 구성원·약·복용 기록은 이 계정에 저장되어 어느 기기에서든 이어서 볼 수 있어요.` : '';
  $('#guestBanner').classList.toggle('hidden', !!cloudUser);
  $('#profileBar').classList.toggle('hidden', !cloudUser);
  updateSaveButton();
}
function updateSaveButton() {
  const button = $('#saveCandidates');
  button.disabled = !cloudUser || !recognized.length;
  button.textContent = cloudUser ? '확인한 약 등록' : 'Google 로그인 후 등록 가능';
}
function activeProfile() { return store.profiles.find(p => p.id === store.activeProfileId) || null; }
function readLocal(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeLocal(key, value) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {} }

function setView(view, message = '') {
  $('#bootView').classList.toggle('hidden', view !== 'boot');
  $('#appShell').classList.toggle('hidden', view !== 'app');
  if (view === 'boot') { $('#bootMessage').textContent = message || '곰곰이를 깨우는 중…'; $('#bootActions').classList.toggle('hidden', !message); bootBear().setMood(message ? 'worried' : 'sleepy'); }
}

// 서버 쓰기는 순서대로 보냅니다. 실패하면 화면을 서버의 실제 기록으로 되돌립니다.
function remote(request, failMessage = '서버에 저장하지 못했어요. 최신 기록을 다시 불러올게요.') {
  writeQueue = writeQueue.then(async () => {
    let error;
    try { ({error} = await request()); } catch (e) { error = e; }
    if (error) { console.error(error); toast(failMessage); await loadAccount(); }
  });
  return writeQueue;
}

async function fetchAll(table, ...orders) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let query = supabaseClient.from(table).select('*');
    for (const column of orders) query = query.order(column);
    const {data, error} = await query.range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

function buildStore(members, meds, logs, days) {
  const profiles = members.map(m => ({id:m.id, name:m.name, avatar:avatarKey(m.avatar), meds:[], logs:{}, history:[], completedDays:{}}));
  const byId = Object.fromEntries(profiles.map(p => [p.id, p]));
  for (const x of meds) byId[x.member_id]?.meds.push({id:x.id, name:x.name, dose:x.dose, times:x.times || [], itemSeq:x.item_seq, drugInfo:x.drug_info, createdAt:x.created_at});
  for (const x of logs) {
    const p = byId[x.member_id]; if (!p) continue;
    const key = `${x.medication_id || `deleted-${x.id}`}:${x.time_label}`;
    (p.logs[x.dose_date] ??= {})[key] = true;
    p.history.push({key:`${x.dose_date}:${key}`, name:x.med_name, timeLabel:x.time_label, at:new Date(x.taken_at).toLocaleString('ko-KR')});
  }
  for (const x of days) if (byId[x.member_id]) byId[x.member_id].completedDays[x.day] = true;
  const saved = readLocal(ACTIVE_KEY);
  return {activeProfileId: byId[saved] ? saved : profiles[0].id, profiles};
}

async function loadAccount() {
  try {
    let [members, meds, logs, days] = await Promise.all([
      fetchAll('family_members', 'created_at', 'id'), fetchAll('medications', 'created_at', 'id'),
      fetchAll('dose_logs', 'taken_at', 'id'), fetchAll('completed_days', 'day', 'member_id')
    ]);
    if (!members.length) {
      const {data, error} = await supabaseClient.from('family_members').insert({name:'나', avatar:AVATARS[0]}).select().single();
      if (error) throw error;
      members = [data];
    }
    store = buildStore(members, meds, logs, days); state = activeProfile();
    setView('app'); render();
    syncOfficialNames();
  } catch (error) {
    console.error(error);
    setView('boot', `계정 기록을 불러오지 못했어요. (${error.message || error})`);
  }
}

// 약 이름은 공식 제품명(약가마스터 한글상품명)이어야 합니다. 예전에 줄인 이름('세프다나캡슐100mg')으로 저장된 약을
// 품목기준코드로 약 DB에서 다시 찾아 공식 이름('세프다나캡슐100밀리그램(세프디니르)')으로 고칩니다.
// 한 품목에 이름이 여러 개면(포장·표기 차이) 대표 공식 이름(drugs.is_primary, 원본에서 가장 많이 쓰인 이름)을 씁니다.
async function syncOfficialNames() {
  const meds = store.profiles.flatMap(p => p.meds).filter(m => m.itemSeq);
  const seqs = [...new Set(meds.map(m => m.itemSeq))];
  if (!seqs.length) return;
  try {
    const {data, error} = await supabaseClient.from('drugs').select('item_seq, name').eq('is_primary', true).in('item_seq', seqs);
    if (error) throw error;
    const official = Object.fromEntries((data || []).map(row => [row.item_seq, row.name]));
    const changed = meds.filter(m => official[m.itemSeq] && official[m.itemSeq] !== m.name);
    for (const med of changed) {
      med.name = official[med.itemSeq];
      remote(() => supabaseClient.from('medications').update({name: med.name}).eq('id', med.id));
    }
    if (changed.length) render();
  } catch (error) { console.warn('공식 약 이름을 확인하지 못했어요', error); }
}

// ---- 로그인 도입 전 기기 기록 → 계정으로 옮기기 ----
function normalizeLegacy(raw) {
  const profile = p => ({id: UUID.test(p.id) ? p.id : crypto.randomUUID(), name: String(p.name || '나').slice(0, 20), avatar: avatarKey(p.avatar), meds: (Array.isArray(p.meds) ? p.meds : []).map(m => ({...m, id: UUID.test(m.id) ? m.id : crypto.randomUUID(), oldId: m.id})), logs: p.logs || {}, history: Array.isArray(p.history) ? p.history : [], completedDays: p.completedDays || {}});
  if (raw && Array.isArray(raw.profiles)) return raw.profiles.map(profile);
  if (raw && Array.isArray(raw.meds)) return [profile({name:'나', ...raw})];
  return [];
}

async function importLegacy() {
  let profiles;
  try { profiles = normalizeLegacy(JSON.parse(readLocal(LEGACY_KEY))); } catch { profiles = []; }
  if (!profiles.some(p => p.meds.length || Object.keys(p.logs).length)) { writeLocal(LEGACY_KEY, null); return; }
  // 새로 만든 id를 먼저 기기에 저장해 두면, 옮기다 끊겨도 다음 로그인 때 같은 행으로 이어서 옮깁니다.
  writeLocal(LEGACY_KEY, JSON.stringify({profiles}));
  const {count} = await supabaseClient.from('family_members').select('id', {count:'exact', head:true});
  const medCount = profiles.reduce((n, p) => n + p.meds.length, 0);
  if (count && !confirm(`이 기기에 로그인 전에 저장한 기록(약 ${medCount}개)이 있어요. 계정에 추가할까요?\n취소하면 이 기기의 기록은 계정에 넣지 않고 지웁니다.`)) { writeLocal(LEGACY_KEY, null); return; }
  const members = [], meds = [], logs = [], days = [];
  for (const p of profiles) {
    members.push({id:p.id, name:p.name, avatar:p.avatar});
    const idMap = {};
    for (const m of p.meds) {
      idMap[m.oldId ?? m.id] = m;
      meds.push({id:m.id, member_id:p.id, name:String(m.name || '이름 없는 약').slice(0, 100), dose:String(m.dose || '복용량 확인').slice(0, 50), times:m.times || [], drug_info:m.drugInfo || null});
    }
    for (const [date, entries] of Object.entries(p.logs)) for (const [key, done] of Object.entries(entries)) {
      if (!done) continue;
      const split = key.indexOf(':'), med = idMap[key.slice(0, split)], time = key.slice(split + 1);
      const name = med?.name || p.history.find(h => h.key === `${date}:${key}`)?.name;
      if (name) logs.push({member_id:p.id, medication_id:med?.id || null, med_name:name, dose_date:date, time_label:time, taken_at:new Date(`${date}T12:00:00`).toISOString()});
    }
    for (const [day, done] of Object.entries(p.completedDays)) if (done) days.push({member_id:p.id, day});
  }
  const steps = [['family_members', members, 'id'], ['medications', meds, 'id'], ['dose_logs', logs, 'medication_id,dose_date,time_label'], ['completed_days', days, 'member_id,day']];
  for (const [table, rows, onConflict] of steps) {
    for (let i = 0; i < rows.length; i += 500) {
      const {error} = await supabaseClient.from(table).upsert(rows.slice(i, i + 500), {onConflict, ignoreDuplicates:true});
      if (error) { console.error(error); toast('이 기기의 이전 기록을 계정으로 옮기지 못했어요. 다음 로그인 때 다시 시도할게요.'); return; }
    }
  }
  writeLocal(LEGACY_KEY, null);
  toast(`이 기기에 있던 약 ${medCount}개와 복용 기록을 계정으로 옮겼어요.`);
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}

function streakDays() { return completionStreak(state); }
const RANKS = [{min: 0, name: '새싹 곰곰이'}, {min: 80, name: '꽃 곰곰이'}, {min: 200, name: '별 곰곰이'}, {min: 400, name: '왕관 곰곰이'}];
function rankInfo() {
  const doses = Object.values(state.logs).reduce((n, day) => n + Object.values(day).filter(Boolean).length, 0);
  const completions = Object.values(state.completedDays || {}).filter(Boolean).length;
  const streak = streakDays();
  const xp = doses * 10 + completions * 20 + streak * 5;
  const index = RANKS.findLastIndex(x => xp >= x.min);
  return {xp, index, level: RANKS[index], next: RANKS[index + 1], streak};
}

const STATUS_TEXT = {done: '다 먹었어요', upcoming: '곧', due: '지금 먹을 시간', late: '늦었어요', missed: '놓쳤어요', anytime: '시간 자유'};

function render() {
  if (!state) return;
  const name = cloudUser ? state.name : '';
  $('#greeting').textContent = name ? `${name}의 오늘 약` : '오늘 챙길 약';
  $('#dateLabel').textContent = new Date().toLocaleDateString('ko-KR', {month: 'long', day: 'numeric', weekday: 'long'});
  renderBear(); renderToday();
  const rank = rankInfo();
  $('#rankTitle').textContent = rank.level.name;
  $('#rankXp').textContent = rank.next ? `${rank.xp} / ${rank.next.min} XP` : `${rank.xp} XP · 최고 단계`;
  $('#rankBar').style.width = rank.next ? `${Math.min(100, (rank.xp - rank.level.min) / (rank.next.min - rank.level.min) * 100)}%` : '100%';
  renderProfiles(); renderHistory(); renderWeek();
  if (currentPage !== 'home') showPage(currentPage);
}

// 곰곰이 영역: mood.js의 규칙으로 표정·한마디·바로 체크할 시간대를 정합니다.
function renderBear() {
  const result = cloudUser ? bearMood(state, new Date()) : {mood: 'calm', title: '곰곰이와 오늘 약을 챙겨요', detail: '로그인하면 복용을 체크할수록 곰곰이의 표정이 바뀌고 함께 자라요.', slots: [], action: null, caution: null};
  const stage = $('#bearStage');
  stage.dataset.mood = result.mood;
  // 곰곰이는 한 번 만들어 두고 표정만 바꿉니다(움직임이 끊기지 않게).
  const rank = cloudUser ? rankInfo().index : 0;
  stageBear ??= createBear($('#bearArt'), {mood: result.mood, rank});
  if (stageBear.mood !== result.mood || renderBear.rank !== rank) stageBear.setMood(result.mood, rank);
  renderBear.rank = rank;
  $('#bearMoodLabel').textContent = `곰곰이가 ${MOOD_LABEL[result.mood]}`;
  $('#bearTitle').textContent = result.title;
  $('#bearDetail').textContent = result.detail || '';
  $('#bearCaution').textContent = result.caution || '';
  $('#bearCaution').classList.toggle('hidden', !result.caution);
  $('#bearActions').innerHTML = !cloudUser ? `<button class="google-btn" data-google-login type="button">${GOOGLE_ICON}Google로 로그인</button>`
    : result.action ? `<button class="primary big" data-take-slot="${esc(result.action.time)}" type="button">${esc(result.action.time)} 약 먹었어요</button>`
    : !state.meds.length ? '<button class="primary big" data-open-upload type="button">사진으로 약 등록</button>' : '';
  const prevTrack = renderBear.track || {};
  renderBear.track = Object.fromEntries(result.slots.map(s => [s.time, s.status]));
  $('#dayTrack').innerHTML = result.slots.map(s => `<li class="track-${s.status}${s.status === 'done' && prevTrack[s.time] && prevTrack[s.time] !== 'done' ? ' just-done' : ''}" title="${esc(s.time)} · ${STATUS_TEXT[s.status]}"><i aria-hidden="true"></i><span>${esc(s.time.replace(' 식전', '').replace(' 식후', ''))}</span><span class="sr-only">${STATUS_TEXT[s.status]}</span></li>`).join('');
}

function renderToday() {
  const slots = cloudUser ? todaySlots(state, new Date()) : [];
  const total = slots.reduce((n, s) => n + s.total, 0), done = slots.reduce((n, s) => n + s.taken, 0);
  $('#todayCount').textContent = total ? `${done} / ${total} 체크` : '';
  if (!cloudUser) { $('#todayList').innerHTML = '<div class="empty-card"><strong>로그인하면 오늘 챙길 약이 여기에 보여요.</strong><p>지금은 사진으로 약 이름을 읽고 곰곰이 약 DB에서 약 정보를 찾아볼 수 있어요.</p><button class="secondary" data-open-upload type="button">사진으로 약 찾아보기</button></div>'; return; }
  if (!state.meds.length) { $('#todayList').innerHTML = '<div class="empty-card"><strong>아직 등록한 약이 없어요.</strong><p>약 봉투나 처방전 사진을 올리면 약 이름과 복용 시간을 찾아 채워 줘요.</p><button class="primary" data-open-upload type="button">사진으로 약 등록</button></div>'; return; }
  if (!slots.length) { $('#todayList').innerHTML = '<div class="empty-card"><strong>오늘 정해진 복용 시간이 없어요.</strong><p>약 보관함에서 복용 시간을 확인해 주세요.</p></div>'; return; }
  const day = today();
  $('#todayList').innerHTML = slots.map(s => {
    const remaining = s.total - s.taken;
    const when = s.at === null ? '시간 자유' : clockLabel(s.at);
    if (s.status === 'done') return `<details class="slot slot-done"><summary class="slot-head"><div><h3>${esc(s.time)}</h3><p><span class="clock">${when}</span><span class="chip chip-done">${s.total}개 다 먹었어요</span></p></div><span class="slot-toggle" aria-hidden="true"></span></summary><ul class="doses">${s.meds.map(m => `<li class="dose on"><button class="dose-check" data-take="${esc(m.id)}" data-time="${esc(s.time)}" type="button" aria-pressed="true" aria-label="${esc(shortName(m.name))} ${esc(s.time)} 체크 취소"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>${doseText(m)}<button class="dose-info" data-detail="${esc(m.id)}" type="button" aria-label="${esc(shortName(m.name))} 약 정보">정보</button></li>`).join('')}</ul></details>`;
    return `<article class="slot slot-${s.status}"><header class="slot-head"><div><h3>${esc(s.time)}</h3><p><span class="clock">${when}</span><span class="chip chip-${s.status}">${STATUS_TEXT[s.status]}</span></p></div>${remaining > 1 ? `<button class="slot-all" data-take-slot="${esc(s.time)}" type="button">${remaining}개 모두 먹었어요</button>` : ''}</header><ul class="doses">${s.meds.map(m => {
      const on = !!state.logs[day]?.[`${m.id}:${s.time}`];
      return `<li class="dose ${on ? 'on' : ''}"><button class="dose-check" data-take="${esc(m.id)}" data-time="${esc(s.time)}" type="button" aria-pressed="${on}" aria-label="${esc(shortName(m.name))} ${esc(s.time)} ${on ? '체크 취소' : '먹었어요'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>${doseText(m)}<button class="dose-info" data-detail="${esc(m.id)}" type="button" aria-label="${esc(shortName(m.name))} 약 정보">정보</button></li>`;
    }).join('')}</ul></article>`;
  }).join('');
}

// 약 이름은 곰곰이 약 DB의 제품명이어야 합니다. 연결되지 않은 약(로그인 전 기록에서 옮긴 약 등)은 표시하고, 상세 창에서 연결합니다.
function dbTag(m) { return m.itemSeq ? '' : ' <span class="tag warn">DB 미확인</span>'; }
// 공식 제품명 '세프다나캡슐100밀리그램(세프디니르)' → 화면 이름 '세프다나캡슐', 함량 '100mg'
const shortName = name => splitDrugName(name).base || name;
const nameWithStrength = name => { const {base, strength} = splitDrugName(name); return strength ? `${base} ${strength}` : (base || name); };
function doseText(m) {
  const {strength} = splitDrugName(m.name);
  return `<div class="dose-text"><b>${esc(shortName(m.name))}</b>${dbTag(m)}<small>${strength ? `${esc(strength)} · ` : ''}${esc(m.dose || '복용량 확인')}</small></div>`;
}
function optionLabel(x) {
  const {ingredient} = splitDrugName(x.name);
  return `<strong>${esc(nameWithStrength(x.name))}</strong><small>${esc(x.company)}${ingredient ? ` · ${esc(ingredient)}` : ''} · ${Math.round(x.score * 100)}%</small>`;
}

function renderProfiles() {
  $('#profileBar').innerHTML = store.profiles.map(p => {
    const active = p.id === store.activeProfileId;
    return `<button type="button" class="profile-chip ${active ? 'active' : ''}" data-profile="${esc(p.id)}" aria-pressed="${active}" title="${active ? '사용자 정보 수정' : `${esc(p.name)}의 약 보기`}">${avatarHtml(p.avatar)}${esc(p.name)}${active ? mi('edit', 'chip-edit') : ''}</button>`;
  }).join('') + '<button type="button" class="profile-chip add" data-add-profile>＋ 사용자 추가</button>';
}

function switchProfile(id) {
  if (requireLogin()) return;
  if (id === store.activeProfileId || !store.profiles.some(p => p.id === id)) return;
  store.activeProfileId = id; state = activeProfile(); writeLocal(ACTIVE_KEY, id);
  render(); toast(`${state.name}의 복약 기록으로 바꿨어요.`);
}

function openProfileModal(id) {
  if (requireLogin()) return;
  editingProfileId = id;
  const profile = store.profiles.find(p => p.id === id);
  pickedAvatar = profile?.avatar || AVATARS[store.profiles.length % AVATARS.length];
  $('#profileModalTitle').textContent = profile ? '사용자 정보 수정' : '사용자 추가';
  $('#profileName').value = profile?.name || '';
  $('#deleteProfile').classList.toggle('hidden', !profile || store.profiles.length < 2);
  renderAvatarPicker(); openModal('#profileModal'); $('#profileName').focus();
}

function renderAvatarPicker() {
  $('#avatarPicker').innerHTML = AVATARS.map(a => `<button type="button" class="${a === pickedAvatar ? 'selected' : ''}" data-avatar="${a}" aria-pressed="${a === pickedAvatar}" aria-label="아바타 ${a.slice(1)}">${avatarHtml(a)}</button>`).join('');
}

function saveProfile() {
  const name = $('#profileName').value.trim();
  if (!name) return toast('이름을 입력해 주세요.');
  if (store.profiles.some(p => p.id !== editingProfileId && p.name === name)) return toast('같은 이름의 사용자가 이미 있어요.');
  const profile = store.profiles.find(p => p.id === editingProfileId);
  if (profile) {
    Object.assign(profile, {name, avatar: pickedAvatar});
    remote(() => supabaseClient.from('family_members').update({name, avatar: pickedAvatar}).eq('id', profile.id));
  } else {
    const created = {id: crypto.randomUUID(), name, avatar: pickedAvatar, meds: [], logs: {}, history: [], completedDays: {}};
    store.profiles.push(created); store.activeProfileId = created.id; state = created; writeLocal(ACTIVE_KEY, created.id);
    remote(() => supabaseClient.from('family_members').insert({id: created.id, name, avatar: pickedAvatar}));
  }
  render(); closeModal('#profileModal');
  toast(profile ? '사용자 정보를 수정했어요.' : `'${name}' 사용자를 추가했어요. 이제 약을 등록해 보세요.`);
}

function deleteProfile() {
  const profile = store.profiles.find(p => p.id === editingProfileId);
  if (!profile || store.profiles.length < 2) return;
  if (!confirm(`${profile.name}의 약 보관함과 복용 기록을 모두 삭제할까요? 되돌릴 수 없어요.`)) return;
  store.profiles = store.profiles.filter(p => p.id !== profile.id);
  if (store.activeProfileId === profile.id) store.activeProfileId = store.profiles[0].id;
  state = activeProfile(); writeLocal(ACTIVE_KEY, state.id);
  remote(() => supabaseClient.from('family_members').delete().eq('id', profile.id));
  render(); closeModal('#profileModal'); toast(`'${profile.name}' 사용자를 삭제했어요.`);
}

function renderHistory() {
  const recent = state.history.slice(-4).reverse();
  $('#recentHistory').innerHTML = recent.length ? recent.map(x => `<div class="history-item"><span class="history-icon">${mi('check')}</span><span>${esc(shortName(x.name))} · ${esc(x.timeLabel)}</span><time>${esc(x.at)}</time></div>`).join('') : '<p class="muted">아직 복용 체크 기록이 없어요.</p>';
}

// 최근 7일(오늘 포함): 다 챙김 / 일부 / 놓침 / 예정 없음
function renderWeek() {
  const now = new Date(), history = cloudUser ? recentHistory(state, now, 6).perDay.reverse() : [];
  const slots = cloudUser ? todaySlots(state, now) : [];
  const todayEntry = {day: today(), scheduled: slots.reduce((n, s) => n + s.total, 0), taken: slots.reduce((n, s) => n + s.taken, 0), today: true};
  const days = cloudUser ? [...history, todayEntry] : [];
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  $('#weekDays').innerHTML = days.map(d => {
    const kind = !d.scheduled ? 'none' : d.taken === d.scheduled ? 'full' : d.taken ? 'part' : d.today ? 'none' : 'miss';
    const text = !d.scheduled ? '예정 없음' : `${d.taken}/${d.scheduled} 체크`;
    return `<li class="day day-${kind} ${d.today ? 'is-today' : ''}" title="${d.day} · ${text}"><span>${names[new Date(`${d.day}T12:00:00`).getDay()]}</span><i aria-hidden="true"></i><span class="sr-only">${text}</span></li>`;
  }).join('');
  const streak = cloudUser ? streakDays() : 0;
  $('#streakCount').textContent = streak;
  const chip = $('#streakChip');
  chip.classList.toggle('hidden', !cloudUser);
  chip.querySelector('b').textContent = streak;
  chip.setAttribute('aria-label', `${streak}일 연속 약을 다 챙겼어요`);
  if (renderWeek.last !== undefined && streak > renderWeek.last) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
  renderWeek.last = streak;
}

// 복용 체크 한 건을 기록하거나 취소합니다(화면 갱신·안내는 호출한 쪽에서).
function setTaken(med, time, value) {
  const key = `${med.id}:${time}`, day = today(), memberId = state.id;
  state.logs[day] ??= {};
  if (!!state.logs[day][key] === value) return false;
  if (value) {
    state.logs[day][key] = true;
    state.history.push({key: `${day}:${key}`, name: med.name, timeLabel: time, at: new Date().toLocaleString('ko-KR')});
    remote(() => supabaseClient.from('dose_logs').insert({member_id: memberId, medication_id: med.id, med_name: med.name, dose_date: day, time_label: time}));
  } else {
    delete state.logs[day][key];
    state.history = state.history.filter(x => x.key !== `${day}:${key}`);
    remote(() => supabaseClient.from('dose_logs').delete().eq('medication_id', med.id).eq('dose_date', day).eq('time_label', time));
  }
  return true;
}

// 오늘 예정된 약을 모두 체크했는지 반영합니다. 새로 다 챙겼으면 true.
function updateCompletion() {
  const day = today(), memberId = state.id, wasComplete = !!state.completedDays[day];
  const slots = todaySlots(state, new Date());
  const complete = slots.length > 0 && slots.every(s => s.taken === s.total);
  if (complete && !wasComplete) { state.completedDays[day] = true; remote(() => supabaseClient.from('completed_days').insert({member_id: memberId, day})); return true; }
  if (!complete && wasComplete) { delete state.completedDays[day]; remote(() => supabaseClient.from('completed_days').delete().eq('member_id', memberId).eq('day', day)); }
  return false;
}

// ---- 체크 순간의 게임 효과 ----
const PRAISE = ['잘했어요!', '꿀꺽! 최고예요', '좋아요!', '멋져요!', '오늘도 해냈어요!'];
const pick = list => list[Math.floor(Math.random() * list.length)];
const bearHolder = () => $('#bearArt');

// 체크한 버튼을 다시 그린 뒤에도 '톡' 튀는 효과가 보이게 같은 자리의 새 버튼에 표시합니다.
function popButton(selector) { const el = document.querySelector(selector); if (el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); } return el; }

async function afterProgress({completed, rankBefore, gainedXp}) {
  if (completed) {
    const slots = todaySlots(state, new Date()), doses = slots.reduce((n, s) => n + s.taken, 0);
    await celebrate({mood: 'proud', rank: rankInfo().index, title: '오늘 약을 다 챙겼어요!', text: `${state.name}의 하루 약 ${doses}번을 모두 체크했어요. 곰곰이가 아주 뿌듯해해요.`,
      stats: [{kind: 'xp', icon: 'bolt', value: doses * 10 + 20, label: '오늘 XP'}, {kind: 'streak', icon: 'local_fire_department', value: streakDays(), label: '일 연속'}, {kind: 'doses', icon: 'medication', value: doses, label: '번 체크'}]});
  }
  const rank = rankInfo();
  if (rank.index > rankBefore) {
    await celebrate({mood: 'proud', rank: rank.index, title: `${rank.level.name}로 자랐어요!`, text: '꾸준히 챙긴 덕분에 곰곰이 머리에 새 장식이 생겼어요.', stats: [{kind: 'xp', icon: 'bolt', value: rank.xp, label: '누적 XP'}], button: '좋아요'});
  }
}

function toggleTake(id, time, source) {
  if (requireLogin()) return;
  const med = state.meds.find(m => String(m.id) === String(id));
  if (!med) return;
  const rankBefore = rankInfo().index;
  const value = !state.logs[today()]?.[`${med.id}:${time}`];
  setTaken(med, time, value);
  const completed = updateCompletion();
  render();
  if (value) {
    haptic(18);
    floatText(popButton(`[data-take="${CSS.escape(String(id))}"][data-time="${CSS.escape(time)}"]`) || source, '+10 XP');
    if (!completed) bearReact(bearHolder(), 'hop', pick(PRAISE));
  } else toast('복용 체크를 취소했어요');
  afterProgress({completed, rankBefore});
}

function takeSlot(time, source) {
  if (requireLogin()) return;
  const rankBefore = rankInfo().index;
  const meds = state.meds.filter(m => (m.times || []).includes(time));
  const changed = meds.filter(m => setTaken(m, time, true)).length;
  const completed = updateCompletion();
  const rect = source?.getBoundingClientRect?.();
  render();
  if (!changed) return toast(`${time} 약은 이미 다 체크했어요`);
  haptic([18, 40, 18]);
  if (rect) { confetti({x: rect.left + rect.width / 2, y: rect.top, count: 50, spread: .8}); }
  floatText(document.querySelector(`[data-take-slot="${CSS.escape(time)}"]`) || bearHolder(), `+${changed * 10} XP`);
  if (!completed) bearReact(bearHolder(), 'cheer', `${time} 약 ${changed}개 꿀꺽!`, 'love');
  afterProgress({completed, rankBefore});
}

// 곰곰이를 만졌을 때의 반응(머리·귀·배·발 톡, 쓰다듬기, 안기 등)은 bear.js가 직접 처리합니다.


function showPage(page) {
  currentPage = page;
  $('#homePage').classList.toggle('hidden', page !== 'home');
  $('#otherPage').classList.toggle('hidden', page === 'home');
  document.querySelectorAll('[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  if (page === 'home') return;
  $('#otherTitle').textContent = {meds:'약 보관함', history:'복용 기록', report:'병원용 약 목록'}[page] + ` · ${state.name}`;
  const content = $('#otherContent');
  if (!cloudUser) {
    $('#otherTitle').textContent = {meds:'약 보관함', history:'복용 기록', report:'병원용 약 목록'}[page];
    content.innerHTML = `<div class="locked"><div>${mi('lock')}</div><h3>로그인하면 볼 수 있어요</h3><p>${{meds:'약 보관함은 등록한 약을 계정에 저장해 두는 곳이에요.', history:'복용 기록은 체크한 내용을 계정에 저장해 보여줘요.', report:'병원용 약 목록은 계정에 저장된 약으로 만들어요.'}[page]}<br>로그인하지 않아도 사진으로 약 이름을 읽고 의약품 정보를 검색할 수 있어요.</p><button class="google-btn" data-google-login type="button">${GOOGLE_ICON}Google로 로그인</button></div>`;
    return;
  }
  if (page === 'meds') content.innerHTML = `<div class="mini-head"><h3>등록한 약 ${state.meds.length}개</h3><button data-open-upload>＋ 약 추가</button></div>${state.meds.map(m => `<div class="med-card" style="margin-top:10px"><div class="pill-icon">${mi('medication')}</div><div class="med-info"><strong>${esc(shortName(m.name))}${dbTag(m)}</strong><small>${splitDrugName(m.name).strength ? `${esc(splitDrugName(m.name).strength)} · ` : ''}${esc(m.dose)} · ${(m.times || []).map(esc).join(', ')}</small></div><button class="take-btn" data-detail="${esc(m.id)}">상세</button><button class="take-btn" data-remove="${esc(m.id)}">삭제</button></div>`).join('') || '<div class="empty">등록된 약이 없어요.</div>'}`;
  if (page === 'history') content.innerHTML = `<div class="mini-head"><h3>내가 체크한 복용 기록</h3></div>${state.history.slice().reverse().map(x => `<div class="history-item"><span class="history-icon">${mi('check')}</span><span>${esc(shortName(x.name))} · ${esc(x.timeLabel)}</span><time>${esc(x.at)}</time></div>`).join('') || '<div class="empty">아직 복용 기록이 없어요.</div>'}<p class="disclaimer">사용자가 체크한 기록입니다. 실제 복용 사실을 확인한 의료 기록은 아닙니다.</p>`;
  if (page === 'report') content.innerHTML = `<div class="mini-head"><h3>진료 때 보여줄 약 목록</h3><button id="copyReport">목록 복사</button></div><p style="font-size:11px;color:#87978e">${new Date().toLocaleDateString('ko-KR')} 기준 · 사용자 입력 정보</p>${state.meds.map(m => `<div class="history-item"><span class="history-icon">${mi('medication')}</span><span><strong>${esc(nameWithStrength(m.name))}</strong>${splitDrugName(m.name).ingredient ? ` (${esc(splitDrugName(m.name).ingredient)})` : ''}　${esc(m.dose)} · ${(m.times || []).map(esc).join(', ')}</span></div>`).join('') || '<div class="empty">표시할 약이 없어요.</div>'}<p class="disclaimer">진료 시 처방전·약 봉투와 함께 확인해 주세요.</p>`;
}

function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

function globalSchedule(text) {
  const compact = text.replace(/\s+/g, ' ');
  const freqMatch = compact.match(/(?:1\s*일|하루|매일)\s*([1-4])\s*회/);
  const freq = freqMatch ? Number(freqMatch[1]) : 0;
  const meal = /식\s*전/.test(compact) ? '식전' : /식\s*후/.test(compact) ? '식후' : '';
  const named = ['아침','점심','저녁'].filter(word => compact.includes(word)).map(word => `${word} ${meal || '식후'}`);
  if (freq && named.length === freq) return named;
  if (freq === 1 && /취침|자기\s*전/.test(compact)) return ['취침 전'];
  if (freq === 1 && /아침/.test(compact)) return [`아침 ${meal || '식후'}`];
  if (freq === 2 && /아침/.test(compact) && /저녁/.test(compact)) return [`아침 ${meal || '식후'}`, `저녁 ${meal || '식후'}`];
  if (freq === 3 && meal) return ['아침','점심','저녁'].map(x => `${x} ${meal}`);
  return [];
}

function extractNames(text) {
  const skip = /(?:복약안내|조제약|약품명|성명|약국|의원|병원|처방|효능|작용|주의사항|용법|용량|연락처|원장|면허|전화|식후|식전)/;
  const pattern = /[가-힣A-Za-z]{2,24}(?:\s*[가-힣A-Za-z]{0,8})?(?:정|캡슐|시럽|현탁액|산|연질캡슐|주사|액)(?:\s*\d+(?:\.\d+)?\s*(?:mg|㎎|g|ml|mL|밀리그램))?/g;
  const found = [];
  for (const line of text.split(/\n/)) {
    if (skip.test(line)) continue;
    for (const raw of line.match(pattern) || []) {
      const name = raw.trim().replace(/\s+/g, ' ');
      if (name.length < 3 || found.some(x => x.replace(/\s/g,'') === name.replace(/\s/g,''))) continue;
      found.push(name);
    }
  }
  return found.slice(0, 15);
}

function frequencyForLine(text, line) {
  const local = line?.match(/(?:1\s*일\s*)?([1-4])\s*회/);
  const global = text.match(/(?:1\s*일|하루|매일)\s*([1-4])\s*회/);
  return Number(local?.[1] || global?.[1] || 0);
}

// 표 형식 약봉투: 머리글에 '1회 투약량 · 1일 투여횟수 · 투약일수'가 있고, 약 이름 줄 끝에 '1.00 3 4'처럼 숫자가 붙습니다.
const TABLE_HEADER = /투약량|투여\s*횟수|투약\s*일수/;
function tableNumbers(text, line) {
  if (!TABLE_HEADER.test(text)) return null;
  const m = line.match(/(\d+(?:\.\d+)?)\s+([1-6])(?:\s+(\d{1,3}))?\s*$/);
  if (!m || Number(m[1]) <= 0 || Number(m[1]) > 20) return null;
  return {amount: Number(m[1]), frequency: Number(m[2]), days: m[3] ? Number(m[3]) : null};
}
function doseUnit(name) {
  return /캡슐/.test(name) ? '캡슐' : /정/.test(name) ? '정' : /산|과립|포/.test(name) ? '포' : '';
}

// sourceLine: 약 이름이 나온 OCR 줄. DB로 이름을 고친 경우 고친 이름은 원문에 없으므로 줄을 직접 넘깁니다.
function inferCandidate(text, name, sourceLine) {
  const line = sourceLine ?? text.split(/\n/).find(part => part.replace(/\s+/g, '').includes(name.replace(/\s+/g, ''))) ?? '';
  const table = tableNumbers(text, line);
  const frequency = table?.frequency ?? frequencyForLine(text, line);
  const amount = line.match(/(?:1\s*회\s*)?(\d+(?:\.\d+)?)\s*(정|캡슐|포|mL|ml|밀리리터)\s*(?:씩)?/);
  const dose = table ? `1회 ${table.amount}${doseUnit(name)}` : amount ? `1회 ${amount[1]}${amount[2]}` : '';
  const meal = /식\s*전/.test(line) ? '식전' : /식\s*후/.test(line) ? '식후' : /식\s*전/.test(text) ? '식전' : /식\s*후/.test(text) ? '식후' : '';
  const labels = frequency === 1 ? ['아침'] : frequency === 2 ? ['아침','저녁'] : frequency === 3 ? ['아침','점심','저녁'] : frequency === 4 ? ['아침','점심','저녁','취침 전'] : [];
  // 약 줄에 적힌 시간대가 문서 전체 안내보다 우선합니다(약마다 시간이 다른 약봉투).
  const lineNamed = ['아침', '점심', '저녁'].filter(word => line.includes(word));
  const lineBedtime = /취침|자기\s*전/.test(line);
  const lineMeal = /식\s*전/.test(line) ? '식전' : /식\s*후/.test(line) ? '식후' : '';
  const fromLine = [...lineNamed.map(word => `${word}${(lineMeal || meal) ? ` ${lineMeal || meal}` : ''}`), ...(lineBedtime ? ['취침 전'] : [])];
  const global = globalSchedule(text);
  const times = fromLine.length && (!frequency || fromLine.length === frequency) ? fromLine
    : frequency && global.length === frequency ? global
    : labels.map(x => x === '취침 전' ? x : `${x}${meal ? ` ${meal}` : ''}`);
  return {name, dose, frequency, times, days: table?.days ?? null, drugInfo:null, itemSeq:null, match:null, options:[]};
}

// ---- 곰곰이 약 DB(Supabase drugs 테이블) 연결 ----
// OCR 줄마다 DB의 실제 제품명 중 가장 비슷한 것을 찾아 오인식을 바로잡습니다. score는 0~1입니다.
// 0.55: 시뮬레이션에서 약이 아닌 약봉투 문장(환자명·약국·복용법 등 30줄)을 하나도 약으로 잘못 채택하지 않은 가장 낮은 값.
// 이때 오인식이 섞인 약 줄의 81%를 바로 맞히고, 틀린 9%도 대부분 '다른 후보'에 정답이 함께 표시됩니다.
const MATCH_MIN_SCORE = 0.55;
function ocrLines(text) {
  return text.split(/\n/).map(line => line.trim().replace(/\s+/g, ' ')).filter(line => (line.match(/[가-힣]/g) || []).length >= 2 && line.length <= 80);
}
// 숫자 옆의 O·l·I는 OCR이 0·1을 잘못 읽은 경우가 많습니다. 예: '3Omg' → '30mg'
function fixOcrDigits(line) {
  return line.replace(/(?<=\d)[Oo]|[Oo](?=\d)/g, '0').replace(/(?<=\d)[lI|]|[lI|](?=\d)/g, '1');
}
async function matchDrugs(queries, perQuery = 3) {
  if (!supabaseClient || !queries.length) return null;
  try {
    const {data, error} = await supabaseClient.rpc('match_drugs', {queries: queries.slice(0, 30), max_per_query: perQuery});
    if (error) throw error;
    const byQuery = queries.slice(0, 30).map(() => []);
    for (const row of data || []) byQuery[row.query_index]?.push(row);
    return byQuery;
  } catch (error) { console.error('약 DB 검색 실패', error); return null; }
}
async function findCandidates(text) {
  const lines = ocrLines(text).slice(0, 30);
  const results = await matchDrugs(lines.map(fixOcrDigits));
  if (!results) return {candidates: extractNames(text).map(name => inferCandidate(text, name)), usedDb: false};
  const candidates = [], seen = new Set(), matchedLines = new Set();
  results.forEach((matches, i) => {
    const best = matches[0];
    if (!best || best.score < MATCH_MIN_SCORE) return;
    matchedLines.add(i);
    if (seen.has(best.item_seq)) return;
    seen.add(best.item_seq);
    candidates.push({...inferCandidate(text, best.name, lines[i]), itemSeq: best.item_seq, match: best, options: matches});
  });
  // 약 이름처럼 보이지만 DB에서 찾지 못한 줄도 보여 줍니다(직접 고쳐서 다시 검색).
  for (const name of extractNames(text)) {
    const at = lines.findIndex(line => line.replace(/\s+/g, '').includes(name.replace(/\s+/g, '')));
    if (at >= 0 && matchedLines.has(at)) continue;
    candidates.push(inferCandidate(text, name));
  }
  return {candidates: candidates.slice(0, 15), usedDb: true};
}
function applyMatch(index, row) {
  const m = recognized[index]; if (!m || !row) return;
  Object.assign(m, {name: row.name, itemSeq: row.item_seq, match: row, drugInfo: null});
  renderCandidates();
  selectDrug(index, row.item_seq);
}

function renderCandidates() {
  const box = $('#candidateList');
  box.innerHTML = recognized.map((m, index) => `<article class="candidate"><div class="candidate-head"><strong>약 ${index + 1}</strong><button type="button" class="secondary" data-remove-candidate="${index}">제외</button></div><div class="formgrid"><div class="field full"><label>약 이름 · 사진과 대조</label><input data-field="name" data-index="${index}" value="${esc(m.match ? shortName(m.name) : m.name)}" placeholder="약 이름">${matchNote(m, index)}</div><div class="field"><label>1회 복용량 · OCR 추정</label><input data-field="dose" data-index="${index}" value="${esc(m.dose || '')}" placeholder="예: 1회 1정"></div><div class="field"><label>하루 복용 횟수 · OCR 추정${m.days ? ` · ${m.days}일분` : ''}</label><select data-field="frequency" data-index="${index}"><option value="0" ${!m.frequency ? 'selected' : ''}>확인 필요</option>${[1,2,3,4].map(n => `<option value="${n}" ${m.frequency===n ? 'selected' : ''}>하루 ${n}회</option>`).join('')}</select></div><div class="field full"><span class="field-label" id="times-label-${index}">복용 시간 · 먹는 때를 모두 눌러 주세요</span><div class="time-chips" role="group" aria-labelledby="times-label-${index}">${SLOT_ORDER.map(t => `<button type="button" class="time-chip" data-time-chip="${t}" data-index="${index}" aria-pressed="${!!m.times?.includes(t)}">${t}</button>`).join('')}</div></div></div><div class="candidate-actions">${m.itemSeq ? `<button type="button" class="upload-btn" data-match="${index}" data-seq="${esc(m.itemSeq)}">약 정보 보기</button>` : ''}<button type="button" class="${m.itemSeq ? 'secondary' : 'upload-btn'}" data-lookup="${index}">약 DB에서 다시 찾기</button><small>약 이름은 곰곰이 약 DB에서 찾고, 쉬운 약 설명은 medikr.kr(e약은요)에서 불러와요.</small></div><div class="lookup-results" id="lookup-${index}">${m.drugInfo ? infoHtml(m.drugInfo) : ''}</div></article>`).join('');
  $('#candidateCount').textContent = `${recognized.length}개 약 후보`;
}

function matchNote(m, index) {
  if (m.match) {
    const others = (m.options || []).filter(o => o.item_seq !== m.itemSeq);
    return `<div class="match-note ok"><span>${mi('check_circle', 'filled')} 약 DB 일치 ${Math.round(m.match.score * 100)}%${splitDrugName(m.name).strength ? ` · ${esc(splitDrugName(m.name).strength)}` : ''} · ${esc(m.match.company || '')}${m.match.ingredient ? ` · ${esc(m.match.ingredient)}` : ''}</span>${others.length ? `<span class="alt-list">다른 후보: ${others.map(o => `<button type="button" class="alt-btn" data-pick="${index}" data-option="${esc(o.item_seq)}">${esc(nameWithStrength(o.name))}</button>`).join('')}</span>` : ''}</div>`;
  }
  return `<div class="match-note warn">${m.name ? '약 DB에서 찾지 못했어요.' : '약 이름을 입력하고'} '약 DB에서 다시 찾기'로 맞는 제품을 골라 주세요. 약 DB에서 고른 약만 등록할 수 있어요.</div>`;
}

function infoHtml(info) {
  if (info.missing) return `<div class="drug-info"><strong>${esc(info.name)} · ${esc(info.company || '제조사 미확인')}</strong>${info.ingredient ? `<p><b>성분</b> ${esc(info.ingredient)}</p>` : ''}${info.rxType ? `<p><b>구분</b> ${esc(info.rxType)}</p>` : ''}<p>이 제품의 쉬운 효능·부작용 안내(e약은요)는 아직 없어요. 전문의약품은 대부분 그래요. 식약처 허가사항에서 효능효과·용법용량·사용상의 주의사항을 확인할 수 있어요.</p><a href="${esc(info.source)}" target="_blank" rel="noopener noreferrer">의약품안전나라 허가사항 보기 ${mi('open_in_new', 'mi-sm')}</a></div>`;
  return `<div class="drug-info"><strong>${esc(info.name)} · ${esc(info.company || '제조사 미확인')}</strong><p><b>효능</b> ${esc(info.efficacy || '자료 없음')}</p><p><b>복용 안내</b> ${esc(info.use || '자료 없음')}</p><p><b>주의사항</b> ${esc(info.caution || '자료 없음')}</p><p><b>부작용</b> ${esc(info.sideEffect || '자료 없음')}</p><a href="${esc(info.source)}" target="_blank" rel="noopener noreferrer">의약품 원문 데이터 ${mi('open_in_new', 'mi-sm')}</a></div>`;
}

// OCR 엔진: PaddleOCR PP-OCRv5(ocr-paddle.js)를 먼저 쓰고, 그 브라우저에서 못 쓰면 Tesseract.js로 읽습니다.
async function paddleOcr(file) {
  const {recognizeImage} = await import('./ocr-paddle.js');
  const result = await recognizeImage(file, message => { $('#ocrStatus').textContent = message; });
  return result.text;
}

async function tesseractOcr(file) {
  if (!window.Tesseract) throw new Error('OCR 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
  const worker = await Tesseract.createWorker(['kor','eng'], 1, {logger: m => {
    if (m.status === 'recognizing text') $('#ocrStatus').textContent = `사진에서 글자를 읽는 중… ${Math.round(m.progress * 100)}%`;
  }});
  try { return (await worker.recognize(file)).data.text || ''; }
  finally { await worker.terminate(); }
}

async function runOcr(file) {
  $('#ocrStatus').textContent = 'OCR을 준비하고 있어요…';
  $('#ocrStatus').hidden = false;
  $('#saveCandidates').disabled = true;
  try {
    try { ocrText = await paddleOcr(file); }
    catch (error) {
      console.warn('PaddleOCR을 쓸 수 없어 Tesseract로 읽습니다.', error);
      $('#ocrStatus').textContent = '기본 OCR로 읽는 중…';
      ocrText = await tesseractOcr(file);
    }
    $('#ocrRaw').value = ocrText;
    await refreshCandidates();
  } catch (error) { $('#ocrStatus').textContent = error.message; }
}

async function refreshCandidates() {
  $('#ocrStatus').textContent = '곰곰이 약 DB에서 약 이름을 찾는 중…';
  const {candidates, usedDb} = await findCandidates(ocrText);
  recognized = candidates;
  renderCandidates();
  const matched = recognized.filter(m => m.match).length;
  $('#ocrStatus').textContent = !recognized.length ? '자동으로 약 이름을 찾지 못했어요. OCR 텍스트를 확인하고 약을 직접 추가해 주세요.'
    : usedDb ? `약 DB와 맞춰 ${matched}개 약을 찾았어요${recognized.length > matched ? `, ${recognized.length - matched}개는 확인이 필요해요` : ''}. 반드시 사진과 대조해 주세요.`
    : `${recognized.length}개 약 이름 후보를 찾았어요(약 DB 연결 안 됨). 반드시 사진과 대조해 주세요.`;
  updateSaveButton();
}

async function lookup(index) {
  const candidate = recognized[index];
  if (!candidate?.name.trim()) return toast('약 이름을 먼저 입력해 주세요.');
  const box = $(`#lookup-${index}`);
  box.textContent = '의약품 정보를 찾고 있어요…';
  const fromDb = await matchDrugs([fixOcrDigits(candidate.name.trim())], 6);
  if (fromDb) {
    candidate.options = fromDb[0];
    box.innerHTML = fromDb[0].length ? `<p class="lookup-hint">곰곰이 약 DB에서 비슷한 제품을 찾았어요. 사진과 비교해 맞는 항목을 고르세요.</p>${fromDb[0].map(x => `<button type="button" class="lookup-option" data-pick="${index}" data-option="${esc(x.item_seq)}">${optionLabel(x)}</button>`).join('')}` : '<p class="lookup-hint">일치하는 제품이 없어요. 제품명과 함량을 확인해 주세요.</p>';
    return;
  }
  try {
    const q = candidate.name.trim().replace(/\s+/g, '');
    const response = await fetch(`${API_BASE}/search.json?q=${encodeURIComponent(q)}&limit=6`);
    if (!response.ok) throw new Error('의약품 검색 서버에 연결할 수 없어요.');
    const data = await response.json();
    const matches = (data.results || []).filter(x => x.seq && x.name).slice(0, 6);
    box.innerHTML = matches.length ? `<p class="lookup-hint">제품명을 사진과 비교해 정확한 항목을 선택하세요.</p>${matches.map(x => `<button type="button" class="lookup-option" data-match="${index}" data-seq="${esc(x.seq)}"><strong>${esc(x.name)}</strong><small>${esc(x.entp || '')}</small></button>`).join('')}` : '<p class="lookup-hint">일치하는 의약품 정보가 없어요. 제품명과 함량을 확인해 주세요.</p>';
  } catch (error) { box.textContent = error.message; }
}

async function selectDrug(index, seq) {
  // 응답을 기다리는 동안 후보 목록이 다시 그려질 수 있어, 쓸 때마다 상자를 새로 찾습니다.
  const box = () => $(`#lookup-${index}`) || document.createElement('div');
  box().textContent = '주의사항과 부작용을 불러오는 중…';
  try {
    // medikr는 e약은요(주로 일반의약품 약 4,700개)에만 상세가 있고, 없는 품목은 404를 늦게(최대 20초) 돌려줘 8초에서 끊습니다.
    const response = await fetch(`${API_BASE}/drug/${encodeURIComponent(seq)}.json`, {signal: AbortSignal.timeout(8000)}).catch(error => error.name === 'TimeoutError' ? {status: 404} : Promise.reject(error));
    if (!recognized[index]) return;
    if (response.status === 404) {
      const m = recognized[index].match?.item_seq === seq ? recognized[index].match : recognized[index].options?.find(o => o.item_seq === seq);
      recognized[index].drugInfo = {seq, missing: true, name: m?.name || recognized[index].name, company: m?.company || '', ingredient: m?.ingredient || '', rxType: m?.rx_type || '', source: NEDRUG_ITEM(seq)};
      box().innerHTML = infoHtml(recognized[index].drugInfo);
      return;
    }
    if (!response.ok) throw new Error('제품 상세정보를 불러오지 못했어요.');
    const data = await response.json();
    recognized[index].drugInfo = {seq, name:data.n || recognized[index].name, company:data.e || '', efficacy:data.efcy || '', use:data.use || '', caution:data.atpn || '', sideEffect:data.se || '', source:`${API_BASE}/drug/${seq}.json`};
    box().innerHTML = infoHtml(recognized[index].drugInfo);
  } catch (error) { box().textContent = error.message === 'Failed to fetch' ? '의약품 정보 서버(medikr.kr)에 연결할 수 없어요.' : error.message; }
}

function saveCandidates() {
  if (requireLogin()) return;
  const invalid = recognized.find(m => !m.name.trim() || !m.dose.trim() || !m.times?.length);
  if (invalid) return toast('각 약의 이름, 1회 복용량, 복용 시간을 확인해 주세요.');
  if (recognized.some(m => m.frequency && m.times.length !== m.frequency)) return toast('하루 복용 횟수와 선택한 시간이 다릅니다. 사진과 다시 대조해 주세요.');
  const unlinked = recognized.findIndex(m => !m.itemSeq);
  if (unlinked >= 0) {
    toast(`약 DB에서 찾은 이름으로 골라 주세요. 확인 안 된 약 ${recognized.filter(m => !m.itemSeq).length}개`);
    document.querySelectorAll('#candidateList .candidate')[unlinked]?.scrollIntoView({behavior: 'smooth', block: 'center'});
    lookup(unlinked);
    return;
  }
  const rows = recognized.map(item => ({id: crypto.randomUUID(), member_id: state.id, name: (item.match?.name || item.name).trim(), dose: item.dose.trim(), times: item.times, item_seq: item.itemSeq || null, drug_info: item.drugInfo || null}));
  state.meds.push(...rows.map(r => ({id: r.id, name: r.name, dose: r.dose, times: r.times, itemSeq: r.item_seq, drugInfo: r.drug_info, createdAt: new Date().toISOString()})));
  remote(() => supabaseClient.from('medications').insert(rows));
  render(); closeModal('#uploadModal');
  toast(`${recognized.length}개 약을 등록했어요`);
  resetUpload();
}

function resetUpload() {
  recognized=[]; ocrText=''; selectedFile=null;
  $('#photoInput').value=''; $('#preview').removeAttribute('src'); $('#preview').style.display='none';
  $('#ocrRaw').value=''; $('#candidateList').innerHTML=''; $('#candidateCount').textContent='';
  $('#ocrStatus').textContent=''; updateSaveButton();
}

function showDetail(id) {
  const med = state.meds.find(m => String(m.id) === String(id)); if (!med) return;
  $('#detailTitle').textContent = shortName(med.name);
  const parts = splitDrugName(med.name);
  const relink = med.itemSeq ? '' : `<div class="match-note warn">이 약은 곰곰이 약 DB와 연결되지 않았어요. 맞는 제품을 골라 연결해 주세요.</div><div class="candidate-actions"><button type="button" class="upload-btn" data-relink="${esc(med.id)}">약 DB에서 찾기</button></div><div class="lookup-results" id="relinkResults"></div>`;
  $('#detailBody').innerHTML = `<p><b>내 복용 안내</b><br>${parts.strength ? `${esc(parts.strength)} · ` : ''}${esc(med.dose)} · ${(med.times || []).map(esc).join(', ')}</p>${med.itemSeq ? `<p class="official-name"><b>공식 제품명</b><br>${esc(med.name)}</p>` : ''}${relink}${med.drugInfo ? infoHtml(med.drugInfo) : med.itemSeq ? `<p><a href="${esc(NEDRUG_ITEM(med.itemSeq))}" target="_blank" rel="noopener noreferrer">의약품안전나라 허가사항 보기 ${mi('open_in_new', 'mi-sm')}</a></p>` : '<p>연결된 제품 정보가 없어요. 제품명과 함량을 확인한 뒤 약 정보를 검색해 주세요.</p>'}<p class="modal-note">부작용은 모든 사람에게 생기지 않으며, 실제 복용법은 개인의 처방을 우선 확인해 주세요.</p>`;
  openModal('#detailModal');
}

let relinkOptions = [];
async function relinkSearch(id) {
  const med = state.meds.find(m => String(m.id) === String(id)); if (!med) return;
  const box = $('#relinkResults'); box.textContent = '곰곰이 약 DB에서 찾는 중…';
  const found = await matchDrugs([fixOcrDigits(med.name)], 6);
  if (!found) { box.textContent = '약 DB에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'; return; }
  relinkOptions = found[0];
  box.innerHTML = relinkOptions.length ? `<p class="lookup-hint">사진·약 봉투와 비교해 맞는 제품을 고르세요.</p>${relinkOptions.map(x => `<button type="button" class="lookup-option" data-relink-pick="${esc(med.id)}" data-option="${esc(x.item_seq)}">${optionLabel(x)}</button>`).join('')}` : '<p class="lookup-hint">비슷한 제품이 없어요.</p>';
}
function relinkPick(id, seq) {
  const med = state.meds.find(m => String(m.id) === String(id)), row = relinkOptions.find(o => o.item_seq === seq);
  if (!med || !row || requireLogin()) return;
  Object.assign(med, {name: row.name, itemSeq: row.item_seq, drugInfo: null});
  remote(() => supabaseClient.from('medications').update({name: row.name, item_seq: row.item_seq, drug_info: null}).eq('id', med.id));
  render(); showDetail(med.id); toast(`약 DB의 '${nameWithStrength(row.name)}' 제품과 연결했어요.`);
}

async function boot() {
  try {
    const {supabaseConfig: config} = await import('./supabase-config.js');
    if (!config?.url || !config?.publishableKey || !window.supabase) throw new Error('missing config');
    supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
  } catch (error) {
    console.error(error);
    return enterGuest();
  }
  const authError = new URLSearchParams(location.hash.slice(1)).get('error_description') || new URLSearchParams(location.search).get('error_description');
  const {data: {session}} = await supabaseClient.auth.getSession();
  await handleSession(session, authError ? `로그인하지 못했어요: ${authError}` : '');
  supabaseClient.auth.onAuthStateChange((_event, session) => { setTimeout(() => handleSession(session), 0); });
}

async function handleSession(session, loginMessage = '') {
  const user = session?.user || null;
  if (sessionHandled && cloudUser?.id === user?.id) return;
  sessionHandled = true;
  cloudUser = user;
  closeModal('#authModal');
  if (!user) return enterGuest(loginMessage);
  updateAccountUi();
  setView('boot');
  try { await importLegacy(); } catch (error) { console.error(error); }
  await loadAccount();
}

async function signInWithGoogle() {
  if (!supabaseClient) return toast('서버 연결 설정(supabase-config.js)을 불러오지 못했어요.');
  const {error} = await supabaseClient.auth.signInWithOAuth({provider:'google', options:{redirectTo:location.href.split('#')[0]}});
  if (error) toast(`Google 로그인을 시작하지 못했어요: ${error.message}`);
}

async function signOut() {
  await supabaseClient.auth.signOut();
  await handleSession(null, '로그아웃했어요.');
}

document.addEventListener('click', event => {
  const page = event.target.closest('[data-page]'); if (page) showPage(page.dataset.page);
  const profile = event.target.closest('[data-profile]'); if (profile) profile.dataset.profile === store.activeProfileId ? openProfileModal(profile.dataset.profile) : switchProfile(profile.dataset.profile);
  if (event.target.closest('[data-add-profile]')) openProfileModal(null);
  if (event.target.closest('[data-google-login]')) signInWithGoogle();
  const avatar = event.target.closest('[data-avatar]'); if (avatar) { pickedAvatar = avatar.dataset.avatar; renderAvatarPicker(); }
  const take = event.target.closest('[data-take]'); if (take) toggleTake(take.dataset.take, take.dataset.time, take);
  const takeAll = event.target.closest('[data-take-slot]'); if (takeAll) takeSlot(takeAll.dataset.takeSlot, takeAll);
  const detail = event.target.closest('[data-detail]'); if (detail) showDetail(detail.dataset.detail);
  const upload = event.target.closest('[data-open-upload]'); if (upload) openModal('#uploadModal');
  const close = event.target.closest('[data-close]'); if (close) closeModal(close.dataset.close);
  const lookupButton = event.target.closest('[data-lookup]'); if (lookupButton) lookup(Number(lookupButton.dataset.lookup));
  const match = event.target.closest('[data-match]'); if (match) selectDrug(Number(match.dataset.match), match.dataset.seq);
  const relinkBtn = event.target.closest('[data-relink]'); if (relinkBtn) relinkSearch(relinkBtn.dataset.relink);
  const relinkChoice = event.target.closest('[data-relink-pick]'); if (relinkChoice) relinkPick(relinkChoice.dataset.relinkPick, relinkChoice.dataset.option);
  const pick = event.target.closest('[data-pick]'); if (pick) { const m = recognized[Number(pick.dataset.pick)]; applyMatch(Number(pick.dataset.pick), m?.options?.find(o => o.item_seq === pick.dataset.option)); }
  const chip = event.target.closest('[data-time-chip]');
  if (chip) {
    const m = recognized[Number(chip.dataset.index)], time = chip.dataset.timeChip;
    if (m) { m.times = m.times?.includes(time) ? m.times.filter(t => t !== time) : SLOT_ORDER.filter(t => t === time || m.times?.includes(t)); chip.setAttribute('aria-pressed', String(m.times.includes(time))); }
  }
  const removeCandidate = event.target.closest('[data-remove-candidate]'); if (removeCandidate) { recognized.splice(Number(removeCandidate.dataset.removeCandidate),1); renderCandidates(); }
  const remove = event.target.closest('[data-remove]'); if (remove && !requireLogin()) { const id=remove.dataset.remove; state.meds=state.meds.filter(m => String(m.id)!==id); remote(() => supabaseClient.from('medications').delete().eq('id', id)); render(); toast('약을 보관함에서 삭제했어요.'); }
  if (event.target.id === 'copyReport') {
    const text=`${state.name} 복용 중인 약 목록 (사용자 입력)\n`+state.meds.map(m => `${m.name} — ${m.dose}, ${(m.times || []).join(', ')}`).join('\n');
    navigator.clipboard.writeText(text).then(() => toast('약 목록을 복사했어요.')).catch(() => toast('복사할 수 없어요.'));
  }
});

document.addEventListener('change', event => {
  if (!event.target.matches('[data-field]')) return;
  const m=recognized[Number(event.target.dataset.index)]; if (!m) return;
  const field=event.target.dataset.field;
  if (field==='times') m.times=Array.from(event.target.selectedOptions).map(x=>x.value);
  else if (field==='frequency') m.frequency=Number(event.target.value);
  else { m[field]=event.target.value; if (field==='name') { Object.assign(m, {drugInfo:null, itemSeq:null, match:null, options:[]}); renderCandidates(); } }
});

$('#openUpload').setAttribute('data-open-upload','');
$('#photoInput').addEventListener('change', event => {
  selectedFile=event.target.files?.[0]; if (!selectedFile) return;
  if (!selectedFile.type.startsWith('image/')) return toast('이미지 파일을 선택해 주세요.');
  const preview=$('#preview'); preview.src=URL.createObjectURL(selectedFile); preview.style.display='block';
  runOcr(selectedFile);
});
$('#rerunOcr').addEventListener('click', () => { ocrText=$('#ocrRaw').value; refreshCandidates(); });
$('#addCandidate').addEventListener('click', () => {
  recognized.push({name:'',dose:'',times:[],frequency:0,drugInfo:null,itemSeq:null,match:null,options:[]}); renderCandidates(); updateSaveButton();
});
$('#saveCandidates').addEventListener('click', saveCandidates);
$('#accountButton').addEventListener('click', () => openModal('#authModal'));
$('#accountButtonMobile').addEventListener('click', () => openModal('#authModal'));
$('#saveProfile').addEventListener('click', saveProfile);
$('#deleteProfile').addEventListener('click', deleteProfile);
$('#profileName').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) saveProfile(); });
$('#signOutButton').addEventListener('click', signOut);
$('#bootSignOut').addEventListener('click', signOut);
$('#bootRetry').addEventListener('click', () => { setView('boot'); loadAccount(); });
// 복용 시간 알림: 곰곰이가 열려 있는 동안(다른 탭에 있어도) 시간대가 '지금 먹을 시간'이 되면 알립니다.
// 앱을 완전히 닫았을 때 오는 알림은 서버 푸시가 필요해 아직 없습니다.
const NOTIFIED_KEY = 'gomgomi-notified';
function reminderOn() { return 'Notification' in window && Notification.permission === 'granted' && readLocal('gomgomi-reminder') === 'on'; }
function updateReminderButton() {
  const on = reminderOn();
  $('#reminderBtn').classList.toggle('on', on);
  $('#reminderBtn').innerHTML = mi(on ? 'notifications_active' : 'notifications', on ? 'filled' : '');
  $('#reminderBtn').setAttribute('aria-label', on ? '복용 시간 알림 끄기' : '복용 시간 알림 켜기');
  $('#reminderBtn').title = on ? '복용 시간 알림 켜짐' : '복용 시간 알림 꺼짐';
}
async function notifyDueSlots() {
  if (!reminderOn() || !cloudUser || !state) return;
  const day = today();
  let sent; try { sent = JSON.parse(readLocal(NOTIFIED_KEY)) || {}; } catch { sent = {}; }
  if (sent.day !== day) sent = {day, keys: []};
  for (const s of todaySlots(state, new Date()).filter(x => x.status === 'due')) {
    const key = `${state.id}:${s.time}`;
    if (sent.keys.includes(key)) continue;
    sent.keys.push(key);
    const body = `${s.meds.filter(m => !state.logs[day]?.[`${m.id}:${s.time}`]).map(m => shortName(m.name)).slice(0, 3).join(', ')}${s.total - s.taken > 3 ? ' 외' : ''}`;
    const options = {body, tag: `gomgomi-${key}`, icon: './assets/icons/icon-192.png', badge: './assets/icons/icon-192.png'};
    try { const reg = await navigator.serviceWorker?.getRegistration(); reg ? reg.showNotification(`${state.name}, ${s.time} 약 먹을 시간이에요`, options) : new Notification(`${state.name}, ${s.time} 약 먹을 시간이에요`, options); } catch (error) { console.warn('알림을 보내지 못했어요', error); }
  }
  writeLocal(NOTIFIED_KEY, JSON.stringify(sent));
}
$('#reminderBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) return toast('이 브라우저에서는 알림을 쓸 수 없어요.');
  if (reminderOn()) { writeLocal('gomgomi-reminder', 'off'); updateReminderButton(); return toast('복용 시간 알림을 껐어요.'); }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return toast('브라우저 설정에서 곰곰이 알림을 허용해 주세요.');
  writeLocal('gomgomi-reminder', 'on'); updateReminderButton(); notifyDueSlots();
  toast('복용 시간 알림을 켰어요. 곰곰이가 열려 있을 때 시간이 되면 알려 드려요.');
});
updateReminderButton();
$('#bearArt').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); stageBear?.interact('head'); } });
// 시간이 흐르면 표정과 시간대 상태가 바뀌므로 1분마다, 그리고 화면으로 돌아올 때 다시 그립니다.
setInterval(() => { if (state && !document.hidden && currentPage === 'home') { renderBear(); renderToday(); } notifyDueSlots(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state) render(); });
for (const modal of document.querySelectorAll('.modal-back')) modal.addEventListener('click', event => { if (event.target === modal) modal.classList.remove('open'); });

// 홈 화면 설치·빠른 재방문을 위한 서비스 워커(sw.js). 실패해도 앱은 그대로 동작합니다.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(error => console.warn('서비스 워커를 등록하지 못했어요', error));
bootBear();
boot();
