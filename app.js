const STORAGE_KEY = 'gomgomi-medication-v3';
const API_BASE = 'https://medikr.kr/api';
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toLocaleDateString('sv-SE');
const defaultState = {meds: [], logs: {}, history: [], completedDays: {}};
let state;
try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState; } catch { state = structuredClone(defaultState); }
if (!Array.isArray(state.meds)) state = structuredClone(defaultState);
let recognized = [];
let ocrText = '';
let selectedFile = null;
let currentPage = 'home';
let supabaseClient = null;
let cloudUser = null;
let cloudWriteTimer = null;

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (cloudUser && supabaseClient) {
    clearTimeout(cloudWriteTimer);
    cloudWriteTimer = setTimeout(async () => {
      const {error} = await supabaseClient.from('medication_state').upsert({user_id:cloudUser.id,payload:state,updated_at:new Date().toISOString()});
      if (error) toast('계정 동기화에 실패했어요. 데이터베이스 설정을 확인해 주세요.');
    }, 400);
  }
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}

function taken(id) { return !!state.logs[today()]?.[id]; }
function totalDoses() { return state.meds.reduce((n, m) => n + (m.times?.length || 0), 0); }
function doneDoses() { return state.meds.reduce((n, m) => n + (m.times || []).filter(t => taken(`${m.id}:${t}`)).length, 0); }
function streakDays() {
  let date = new Date();
  if (!state.completedDays?.[today()]) date.setDate(date.getDate() - 1);
  let count = 0;
  while (state.completedDays?.[date.toLocaleDateString('sv-SE')]) { count++; date.setDate(date.getDate() - 1); }
  return count;
}
function rankInfo() {
  const doses = Object.values(state.logs).reduce((n, day) => n + Object.values(day).filter(Boolean).length, 0);
  const completions = Object.values(state.completedDays || {}).filter(Boolean).length;
  const streak = streakDays();
  const xp = doses * 10 + completions * 20 + streak * 5;
  const ranks = [
    {min:0,name:'새싹 곰곰이',icon:'🐻'},
    {min:80,name:'산책 곰곰이',icon:'🐻🌱'},
    {min:200,name:'튼튼 곰곰이',icon:'🐻✨'},
    {min:400,name:'대장 곰곰이',icon:'🐻🏅'}
  ];
  const level = [...ranks].reverse().find(x => xp >= x.min);
  const next = ranks.find(x => x.min > xp);
  return {xp,level,next,streak};
}

function render() {
  const total = totalDoses();
  const done = doneDoses();
  $('#progressBar').style.width = `${total ? done / total * 100 : 0}%`;
  $('#progressText').textContent = `${done} / ${total} 완료`;
  $('#scheduleCount').textContent = `${total}회 예정`;
  $('#heroTitle').innerHTML = total && done === total ? '오늘 약속을 모두<br>채웠어요! ✨' : '오늘 약속을<br>하나씩 채워볼까요?';
  $('#heroSub').textContent = total && done === total ? '오늘도 나를 잘 돌봤어요.' : '작은 꾸준함이 건강한 내일을 만들어요.';
  const rank = rankInfo();
  $('#heroCharacter').childNodes[0].textContent = rank.level.icon;
  $('#miniCharacter').textContent = rank.level.icon;
  $('#characterLine').innerHTML = total && done === total ? '<strong>곰곰이가 씩씩해졌어요!</strong><br>오늘 완봉! 다음 단계로 한 걸음 더.' : '<strong>곰곰이가 기다리고 있어요!</strong><br>복용 체크와 완봉으로 성장해요.';
  $('#rankTitle').textContent = rank.level.name;
  $('#rankXp').textContent = rank.next ? `${rank.xp} / ${rank.next.min} XP` : `${rank.xp} XP · 최고 단계`;
  $('#rankBar').style.width = rank.next ? `${Math.min(100,(rank.xp-rank.level.min)/(rank.next.min-rank.level.min)*100)}%` : '100%';
  $('#todayList').innerHTML = state.meds.length ? state.meds.map(m => {
    const times = m.times || [];
    const completed = times.filter(t => taken(`${m.id}:${t}`)).length;
    return `<article class="med-card"><div class="pill-icon">💊</div><div class="med-info"><strong>${esc(m.name)} <span class="tag">${esc(m.dose || '복용량 확인')}</span></strong><small>${times.map(esc).join(' · ') || '복용 시간 확인'} · ${completed}/${times.length}회 체크</small></div><button class="take-btn" data-detail="${esc(m.id)}">정보 보기</button></article>`;
  }).join('') : '<div class="empty">아직 등록한 약이 없어요. 사진으로 등록해 볼까요?</div>';
  renderSchedule(); renderHistory(); renderWeek();
  if (currentPage !== 'home') showPage(currentPage);
}

function renderSchedule() {
  const groups = ['아침','아침 식전','아침 식후','점심','점심 식전','점심 식후','저녁','저녁 식전','저녁 식후','취침 전','기타'];
  $('#scheduleList').innerHTML = groups.map((time, i) => {
    const meds = state.meds.filter(m => (m.times || []).includes(time));
    if (!meds.length) return '';
    return `<div class="time-group"><div class="time-head"><span class="time-dot" style="background:${['#f2a26a','#f2a26a','#f2a26a','#89b6a0','#89b6a0','#89b6a0','#819fc0','#819fc0','#819fc0','#b59dc3','#b59dc3'][i]}"></span>${time}</div>${meds.map(m => `<div class="time-entry"><span class="tiny-pill">💊</span><div><strong>${esc(m.name)}</strong><small>${esc(m.dose || '복용량 확인')}</small></div><button class="check ${taken(`${m.id}:${time}`) ? 'checked' : ''}" data-take="${esc(m.id)}" data-time="${esc(time)}" aria-label="${esc(m.name)} ${time} 복용 체크">${taken(`${m.id}:${time}`) ? '✓' : ''}</button></div>`).join('')}</div>`;
  }).join('') || '<div class="empty">등록한 약의 복용 일정이 여기에 표시돼요.</div>';
}

function renderHistory() {
  const recent = state.history.slice(-4).reverse();
  $('#recentHistory').innerHTML = recent.length ? recent.map(x => `<div class="history-item"><span class="history-icon">✓</span><span>${esc(x.name)} · ${esc(x.timeLabel)}</span><time>${esc(x.at)}</time></div>`).join('') : '<div class="history-item" style="color:#9aa69f">아직 복용 체크 기록이 없어요.</div>';
}

function renderWeek() {
  const labels = ['월','화','수','목','금','토','일'];
  const index = (new Date().getDay() + 6) % 7;
  $('#weekDays').innerHTML = labels.map((label, i) => `<div class="day ${i === index ? 'today' : ''}">${label}<span>${i === index ? '•' : '·'}</span></div>`).join('');
  $('#streakCount').textContent = streakDays();
}

function toggleTake(id, time) {
  const med = state.meds.find(m => String(m.id) === String(id));
  if (!med) return;
  const key = `${id}:${time}`;
  state.logs[today()] ??= {};
  if (state.logs[today()][key]) {
    delete state.logs[today()][key];
    state.history = state.history.filter(x => x.key !== `${today()}:${key}`);
    toast('복용 체크를 취소했어요.');
  } else {
    state.logs[today()][key] = true;
    state.history.push({key: `${today()}:${key}`, name: med.name, timeLabel: time, at: new Date().toLocaleString('ko-KR')});
    toast('복용을 기록했어요 🌱');
  }
  state.completedDays ??= {};
  if (totalDoses() > 0 && doneDoses() === totalDoses()) {
    if (!state.completedDays[today()]) toast('오늘 완봉! 곰곰이가 성장했어요 🐻');
    state.completedDays[today()] = true;
  } else delete state.completedDays[today()];
  persist(); render();
}

function showPage(page) {
  currentPage = page;
  $('#homePage').classList.toggle('hidden', page !== 'home');
  $('#otherPage').classList.toggle('hidden', page === 'home');
  document.querySelectorAll('[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  if (page === 'home') return;
  $('#otherTitle').textContent = {meds:'내 약 보관함', history:'복용 기록', report:'병원용 약 목록'}[page];
  const content = $('#otherContent');
  if (page === 'meds') content.innerHTML = `<div class="mini-head"><h3>등록한 약 ${state.meds.length}개</h3><button data-open-upload>＋ 약 추가</button></div>${state.meds.map(m => `<div class="med-card" style="margin-top:10px"><div class="pill-icon">💊</div><div class="med-info"><strong>${esc(m.name)}</strong><small>${esc(m.dose)} · ${(m.times || []).map(esc).join(', ')}</small></div><button class="take-btn" data-detail="${esc(m.id)}">상세</button><button class="take-btn" data-remove="${esc(m.id)}">삭제</button></div>`).join('') || '<div class="empty">등록된 약이 없어요.</div>'}`;
  if (page === 'history') content.innerHTML = `<div class="mini-head"><h3>내가 체크한 복용 기록</h3></div>${state.history.slice().reverse().map(x => `<div class="history-item"><span class="history-icon">✓</span><span>${esc(x.name)} · ${esc(x.timeLabel)}</span><time>${esc(x.at)}</time></div>`).join('') || '<div class="empty">아직 복용 기록이 없어요.</div>'}<p class="disclaimer">사용자가 체크한 기록입니다. 실제 복용 사실을 확인한 의료 기록은 아닙니다.</p>`;
  if (page === 'report') content.innerHTML = `<div class="mini-head"><h3>진료 때 보여줄 약 목록</h3><button id="copyReport">목록 복사</button></div><p style="font-size:11px;color:#87978e">${new Date().toLocaleDateString('ko-KR')} 기준 · 사용자 입력 정보</p>${state.meds.map(m => `<div class="history-item"><span class="history-icon">💊</span><span><strong>${esc(m.name)}</strong>　${esc(m.dose)} · ${(m.times || []).map(esc).join(', ')}</span></div>`).join('') || '<div class="empty">표시할 약이 없어요.</div>'}<p class="disclaimer">진료 시 처방전·약 봉투와 함께 확인해 주세요.</p>`;
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

function frequencyForName(text, name) {
  const normalized = name.replace(/\s+/g, '');
  const line = text.split(/\n/).find(part => part.replace(/\s+/g, '').includes(normalized));
  const local = line?.match(/(?:1\s*일\s*)?([1-4])\s*회/);
  const global = text.match(/(?:1\s*일|하루|매일)\s*([1-4])\s*회/);
  return Number(local?.[1] || global?.[1] || 0);
}

function inferCandidate(text, name) {
  const line = text.split(/\n/).find(part => part.replace(/\s+/g, '').includes(name.replace(/\s+/g, ''))) || '';
  const frequency = frequencyForName(text, name);
  const amount = line.match(/(?:1\s*회\s*)?(\d+(?:\.\d+)?)\s*(정|캡슐|포|mL|ml|밀리리터)\s*(?:씩)?/);
  const dose = amount ? `1회 ${amount[1]}${amount[2]}` : '';
  const meal = /식\s*전/.test(line) ? '식전' : /식\s*후/.test(line) ? '식후' : /식\s*전/.test(text) ? '식전' : /식\s*후/.test(text) ? '식후' : '';
  const labels = frequency === 1 ? ['아침'] : frequency === 2 ? ['아침','저녁'] : frequency === 3 ? ['아침','점심','저녁'] : frequency === 4 ? ['아침','점심','저녁','취침 전'] : [];
  const times = globalSchedule(text).length === frequency ? globalSchedule(text) : labels.map(x => x === '취침 전' ? x : `${x}${meal ? ` ${meal}` : ''}`);
  return {name, dose, frequency, times, drugInfo:null};
}

function renderCandidates() {
  const box = $('#candidateList');
  box.innerHTML = recognized.map((m, index) => `<article class="candidate"><div class="candidate-head"><strong>약 ${index + 1}</strong><button type="button" class="secondary" data-remove-candidate="${index}">제외</button></div><div class="formgrid"><div class="field full"><label>약 이름 · 사진과 대조</label><input data-field="name" data-index="${index}" value="${esc(m.name)}" placeholder="약 이름"></div><div class="field"><label>1회 복용량 · OCR 추정</label><input data-field="dose" data-index="${index}" value="${esc(m.dose || '')}" placeholder="예: 1회 1정"></div><div class="field"><label>하루 복용 횟수 · OCR 추정</label><select data-field="frequency" data-index="${index}"><option value="0" ${!m.frequency ? 'selected' : ''}>확인 필요</option>${[1,2,3,4].map(n => `<option value="${n}" ${m.frequency===n ? 'selected' : ''}>하루 ${n}회</option>`).join('')}</select></div><div class="field"><label>복용 시간 · 여러 항목 선택 가능</label><select data-field="times" data-index="${index}" multiple size="4">${['아침','아침 식전','아침 식후','점심','점심 식전','점심 식후','저녁','저녁 식전','저녁 식후','취침 전','기타'].map(t => `<option value="${t}" ${m.times?.includes(t) ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div><div class="candidate-actions"><button type="button" class="upload-btn" data-lookup="${index}">약 정보 검색</button><small>검색하면 약 이름이 medikr.kr로 전달됩니다.</small></div><div class="lookup-results" id="lookup-${index}">${m.drugInfo ? infoHtml(m.drugInfo) : ''}</div></article>`).join('');
  $('#candidateCount').textContent = `${recognized.length}개 약 후보`;
}

function infoHtml(info) {
  return `<div class="drug-info"><strong>${esc(info.name)} · ${esc(info.company || '제조사 미확인')}</strong><p><b>효능</b> ${esc(info.efficacy || '자료 없음')}</p><p><b>복용 안내</b> ${esc(info.use || '자료 없음')}</p><p><b>주의사항</b> ${esc(info.caution || '자료 없음')}</p><p><b>부작용</b> ${esc(info.sideEffect || '자료 없음')}</p><a href="${esc(info.source)}" target="_blank" rel="noopener noreferrer">의약품 원문 데이터 ↗</a></div>`;
}

async function runOcr(file) {
  $('#ocrStatus').textContent = '한글·영문 OCR을 준비하고 있어요…';
  $('#ocrStatus').hidden = false;
  $('#saveCandidates').disabled = true;
  try {
    if (!window.Tesseract) throw new Error('OCR 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
    const worker = await Tesseract.createWorker(['kor','eng'], 1, {logger: m => {
      if (m.status === 'recognizing text') $('#ocrStatus').textContent = `사진에서 글자를 읽는 중… ${Math.round(m.progress * 100)}%`;
    }});
    try { const result = await worker.recognize(file); ocrText = result.data.text || ''; }
    finally { await worker.terminate(); }
    $('#ocrRaw').value = ocrText;
    recognized = extractNames(ocrText).map(name => inferCandidate(ocrText,name));
    renderCandidates();
    $('#ocrStatus').textContent = recognized.length ? `${recognized.length}개 약 이름 후보를 찾았어요. 반드시 사진과 대조해 주세요.` : '자동으로 약 이름을 찾지 못했어요. OCR 텍스트를 확인하고 약을 직접 추가해 주세요.';
    $('#saveCandidates').disabled = !recognized.length;
  } catch (error) { $('#ocrStatus').textContent = error.message; }
}

async function lookup(index) {
  const candidate = recognized[index];
  if (!candidate?.name.trim()) return toast('약 이름을 먼저 입력해 주세요.');
  const box = $(`#lookup-${index}`);
  box.textContent = '의약품 정보를 찾고 있어요…';
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
  const box = $(`#lookup-${index}`); box.textContent = '주의사항과 부작용을 불러오는 중…';
  try {
    const response = await fetch(`${API_BASE}/drug/${encodeURIComponent(seq)}.json`);
    if (!response.ok) throw new Error('제품 상세정보를 불러오지 못했어요.');
    const data = await response.json();
    recognized[index].drugInfo = {seq, name:data.n || recognized[index].name, company:data.e || '', efficacy:data.efcy || '', use:data.use || '', caution:data.atpn || '', sideEffect:data.se || '', source:`${API_BASE}/drug/${seq}.json`};
    box.innerHTML = infoHtml(recognized[index].drugInfo);
  } catch (error) { box.textContent = error.message; }
}

function saveCandidates() {
  const invalid = recognized.find(m => !m.name.trim() || !m.dose.trim() || !m.times?.length);
  if (invalid) return toast('각 약의 이름, 1회 복용량, 복용 시간을 확인해 주세요.');
  if (recognized.some(m => m.frequency && m.times.length !== m.frequency)) return toast('하루 복용 횟수와 선택한 시간이 다릅니다. 사진과 다시 대조해 주세요.');
  for (const item of recognized) state.meds.push({id: crypto.randomUUID(), name:item.name.trim(), dose:item.dose.trim(), times:item.times, drugInfo:item.drugInfo || null, createdAt:new Date().toISOString()});
  persist(); render(); closeModal('#uploadModal');
  toast(`${recognized.length}개 약을 등록했어요 🌿`);
  resetUpload();
}

function resetUpload() {
  recognized=[]; ocrText=''; selectedFile=null;
  $('#photoInput').value=''; $('#preview').removeAttribute('src'); $('#preview').style.display='none';
  $('#ocrRaw').value=''; $('#candidateList').innerHTML=''; $('#candidateCount').textContent='';
  $('#ocrStatus').textContent=''; $('#saveCandidates').disabled=true;
}

function showDetail(id) {
  const med = state.meds.find(m => String(m.id) === String(id)); if (!med) return;
  $('#detailTitle').textContent = med.name;
  $('#detailBody').innerHTML = `<p><b>내 복용 안내</b><br>${esc(med.dose)} · ${(med.times || []).map(esc).join(', ')}</p>${med.drugInfo ? infoHtml(med.drugInfo) : '<p>연결된 제품 정보가 없어요. 제품명과 함량을 확인한 뒤 약 정보를 검색해 주세요.</p>'}<p class="modal-note">부작용은 모든 사람에게 생기지 않으며, 실제 복용법은 개인의 처방을 우선 확인해 주세요.</p>`;
  openModal('#detailModal');
}

async function initSupabase() {
  try {
    const configModule = await import('./supabase-config.js');
    const config = configModule.supabaseConfig;
    if (!config?.url || !config?.publishableKey || !window.supabase) return;
    supabaseClient = window.supabase.createClient(config.url, config.publishableKey);
    const {data:{session}} = await supabaseClient.auth.getSession();
    await handleSession(session);
    supabaseClient.auth.onAuthStateChange((_event, session) => { setTimeout(() => handleSession(session), 0); });
  } catch (error) { console.warn('Supabase configuration unavailable:', error); }
}

async function handleSession(session) {
  const user = session?.user || null;
  if (cloudUser?.id === user?.id) return;
  cloudUser = user;
  $('#accountStatus').textContent = user ? `${user.email || '로그인됨'} · 동기화됨` : '이 기기에 저장 중';
  $('#authStatus').textContent = user ? `${user.email || '로그인됨'} 계정과 동기화 중` : '이메일로 로그인 링크를 받아 여러 기기에서 기록을 동기화할 수 있어요.';
  $('#signOutButton').classList.toggle('hidden', !user);
  $('#sendMagicLink').classList.toggle('hidden', !!user);
  if (!user) return;
  const {data, error} = await supabaseClient.from('medication_state').select('payload').eq('user_id', user.id).maybeSingle();
  if (error) { toast('계정 동기화 테이블이나 접근 규칙을 확인해 주세요.'); return; }
  if (data?.payload) { state = data.payload; localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); render(); }
  else persist();
}

function accountAction() {
  if (!supabaseClient) return toast('Supabase 연결 설정을 불러오지 못했어요.');
  openModal('#authModal');
}

async function sendMagicLink() {
  const email = $('#accountEmail').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('이메일 주소를 확인해 주세요.');
  const {error} = await supabaseClient.auth.signInWithOtp({email,options:{emailRedirectTo:location.href.split('#')[0]}});
  $('#authStatus').textContent = error ? `로그인 링크를 보내지 못했어요: ${error.message}` : '이메일에 보낸 로그인 링크를 눌러 주세요.';
}

document.addEventListener('click', event => {
  const page = event.target.closest('[data-page]'); if (page) showPage(page.dataset.page);
  const take = event.target.closest('[data-take]'); if (take) toggleTake(take.dataset.take, take.dataset.time);
  const detail = event.target.closest('[data-detail]'); if (detail) showDetail(detail.dataset.detail);
  const upload = event.target.closest('[data-open-upload]'); if (upload) openModal('#uploadModal');
  const close = event.target.closest('[data-close]'); if (close) closeModal(close.dataset.close);
  const lookupButton = event.target.closest('[data-lookup]'); if (lookupButton) lookup(Number(lookupButton.dataset.lookup));
  const match = event.target.closest('[data-match]'); if (match) selectDrug(Number(match.dataset.match), match.dataset.seq);
  const removeCandidate = event.target.closest('[data-remove-candidate]'); if (removeCandidate) { recognized.splice(Number(removeCandidate.dataset.removeCandidate),1); renderCandidates(); }
  const remove = event.target.closest('[data-remove]'); if (remove) { state.meds=state.meds.filter(m => String(m.id)!==remove.dataset.remove); persist(); render(); toast('약을 보관함에서 삭제했어요.'); }
  if (event.target.id === 'copyReport') {
    const text='복용 중인 약 목록 (사용자 입력)\n'+state.meds.map(m => `${m.name} — ${m.dose}, ${(m.times || []).join(', ')}`).join('\n');
    navigator.clipboard.writeText(text).then(() => toast('약 목록을 복사했어요.')).catch(() => toast('복사할 수 없어요.'));
  }
});

document.addEventListener('change', event => {
  if (!event.target.matches('[data-field]')) return;
  const m=recognized[Number(event.target.dataset.index)]; if (!m) return;
  const field=event.target.dataset.field;
  if (field==='times') m.times=Array.from(event.target.selectedOptions).map(x=>x.value);
  else if (field==='frequency') m.frequency=Number(event.target.value);
  else { m[field]=event.target.value; if (field==='name') m.drugInfo=null; }
});

$('#openUpload').setAttribute('data-open-upload','');
$('#photoInput').addEventListener('change', event => {
  selectedFile=event.target.files?.[0]; if (!selectedFile) return;
  if (!selectedFile.type.startsWith('image/')) return toast('이미지 파일을 선택해 주세요.');
  const preview=$('#preview'); preview.src=URL.createObjectURL(selectedFile); preview.style.display='block';
  runOcr(selectedFile);
});
$('#rerunOcr').addEventListener('click', () => {
  ocrText=$('#ocrRaw').value;
  recognized=extractNames(ocrText).map(name=>inferCandidate(ocrText,name));
  renderCandidates(); $('#saveCandidates').disabled=!recognized.length;
});
$('#addCandidate').addEventListener('click', () => {
  recognized.push({name:'',dose:'',times:[],frequency:0,drugInfo:null}); renderCandidates(); $('#saveCandidates').disabled=false;
});
$('#saveCandidates').addEventListener('click', saveCandidates);
$('#accountButton').addEventListener('click', accountAction);
$('#accountButtonMobile').addEventListener('click', accountAction);
$('#sendMagicLink').addEventListener('click', sendMagicLink);
$('#signOutButton').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  state=structuredClone(defaultState);
  localStorage.removeItem(STORAGE_KEY);
  render(); closeModal('#authModal'); toast('로그아웃했어요.');
});
$('#reminderBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) return toast('이 브라우저에서는 알림을 지원하지 않아요.');
  const permission=await Notification.requestPermission();
  toast(permission==='granted' ? '알림 권한을 허용했어요. 지속 알림은 추후 연결 예정입니다.' : '알림 권한이 허용되지 않았어요.');
});
for (const modal of document.querySelectorAll('.modal-back')) modal.addEventListener('click', event => { if (event.target === modal) modal.classList.remove('open'); });
$('#dateLabel').textContent=new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'long'});
render(); initSupabase();
