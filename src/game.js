// 곰곰이 게임 효과: 체크·완료 순간을 듀오링고처럼 바로 보여 줍니다.
//   floatText(대상, '+10 XP')  버튼에서 글자가 떠오름
//   confetti({x, y, count})    색종이 터뜨리기
//   bearReact(자리, kind, 말)  곰곰이 반응(bear.js 리깅 동작): 'hop'(점프) | 'cheer'(만세) | 'tap'(갸웃) | 'stomp'
//   celebrate({...})           전체 화면 축하(하루 완료, 성장)
//   haptic(패턴)               휴대폰 진동
// '동작 줄이기' 설정이면 움직이는 효과는 생략하고 결과만 보여 줍니다.

import {createBear} from './bear.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const COLORS = ['#F5B83A', '#58B272', '#F2836B', '#6FB3EA', '#F7A9BA', '#9C83E0'];

function layer() {
  let el = document.getElementById('fxLayer');
  if (!el) { el = document.createElement('div'); el.id = 'fxLayer'; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el); }
  return el;
}

export function haptic(pattern = 18) { try { navigator.vibrate?.(pattern); } catch {} }

export function floatText(target, text, kind = 'xp') {
  if (reduced() || !target?.getBoundingClientRect) return;
  const r = target.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = `fx-float-text fx-${kind}`; el.textContent = text;
  el.style.left = `${r.left + r.width / 2}px`; el.style.top = `${r.top}px`;
  layer().appendChild(el);
  el.animate([
    {transform: 'translate(-50%, 0) scale(.6)', opacity: 0},
    {transform: 'translate(-50%, -18px) scale(1.15)', opacity: 1, offset: .25},
    {transform: 'translate(-50%, -54px) scale(1)', opacity: 0},
  ], {duration: 1000, easing: 'cubic-bezier(.2,.8,.3,1)'}).onfinish = () => el.remove();
}

export function confetti({x = innerWidth / 2, y = innerHeight / 3, count = 60, spread = 1} = {}) {
  if (reduced()) return;
  const root = layer();
  for (let i = 0; i < count; i++) {
    const el = document.createElement('i');
    el.className = 'fx-confetti';
    el.style.background = COLORS[i % COLORS.length];
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    if (i % 3 === 0) el.style.borderRadius = '50%';
    root.appendChild(el);
    const angle = (Math.random() * Math.PI) + Math.PI, power = (160 + Math.random() * 260) * spread;
    const dx = Math.cos(angle) * power * (Math.random() < .5 ? -1 : 1), up = Math.sin(angle) * power;
    const fall = innerHeight * (0.45 + Math.random() * 0.4), spin = (Math.random() - .5) * 1440;
    el.animate([
      {transform: 'translate(0,0) rotate(0deg)', opacity: 1},
      {transform: `translate(${dx * .7}px, ${up}px) rotate(${spin * .4}deg)`, opacity: 1, offset: .3},
      {transform: `translate(${dx}px, ${fall}px) rotate(${spin}deg)`, opacity: 0},
    ], {duration: 1500 + Math.random() * 900, easing: 'cubic-bezier(.15,.7,.4,1)'}).onfinish = () => el.remove();
  }
}

// 곰곰이 반응: 몸 동작 + 짧은 표정 + 말풍선(말하는 동안 입이 움직임)
export function bearReact(holder, kind = 'hop', say = '', face = 'laugh') {
  const bear = holder?.__bear; if (!bear) return;
  bear.play(kind); bear.express(face, kind === 'cheer' ? 1.7 : 1.1); bear.say(say);
}

// 숫자가 올라가며 보이기
function countUp(el, to, duration = 900) {
  if (reduced()) { el.textContent = to; return; }
  const start = performance.now();
  const tick = now => { const t = Math.min(1, (now - start) / duration); el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3))); if (t < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

// 전체 화면 축하. 닫히면 Promise가 끝납니다.
export function celebrate({mood = 'proud', rank = 0, title, text = '', stats = [], button = '계속하기'}) {
  return new Promise(resolve => {
    const root = document.getElementById('celebrate');
    const bear = createBear(root.querySelector('.celebrate-bear'), {mood, rank});
    bear.express('love', 2);
    root.querySelector('#celebrateTitle').textContent = title;
    root.querySelector('#celebrateText').textContent = text;
    root.querySelector('.celebrate-stats').innerHTML = stats.map(s => `<div class="stat stat-${s.kind}"><span class="mi filled stat-icon" aria-hidden="true">${s.icon}</span><b data-to="${s.value}">${reduced() ? s.value : 0}</b><small>${s.label}</small></div>`).join('');
    const button$ = root.querySelector('#celebrateClose');
    button$.textContent = button;
    root.classList.remove('hidden'); root.classList.add('open');
    haptic([20, 60, 30]);
    setTimeout(() => {
      root.querySelectorAll('[data-to]').forEach((el, i) => setTimeout(() => countUp(el, Number(el.dataset.to)), 250 * i));
      const r = root.querySelector('.celebrate-bear').getBoundingClientRect();
      confetti({x: r.left + r.width / 2, y: r.top + r.height / 3, count: 90, spread: 1.2});
      bear.play('cheer'); bear.say('최고예요!');
    }, 180);
    const again = setInterval(() => { bear.play('cheer'); bear.express('laugh', 1.6); }, 2400);
    button$.focus();
    const close = () => { clearInterval(again); bear.destroy(); root.classList.remove('open'); root.classList.add('hidden'); button$.removeEventListener('click', close); document.removeEventListener('keydown', esc); resolve(); };
    const esc = e => { if (e.key === 'Escape') close(); };
    button$.addEventListener('click', close);
    document.addEventListener('keydown', esc);
  });
}
