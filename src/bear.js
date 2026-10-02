// 곰곰이: 2D 리깅 캐릭터 + 버츄얼 유튜버(Live2D)식 얼굴 파라미터.
//
// 입력: createBear(그릴 요소, {mood, rank, label})
// 출력: {setMood(mood, rank), play(몸 동작), express(표정, 초), say(말), interact(만지기), destroy()}
//   몸 동작: hop·cheer·tap·stomp·pet·hug·belly·spin·yawn·startle·wave·dizzy
//   짧은 표정: laugh·wink·surprised·shy·love(하트 눈)·dizzy(소용돌이 눈)·yawn·pout·relieved
//   만지기: 머리 톡, 머리 쓰다듬기, 귀·배·발 톡, 길게 누르기(안기), 두 번 톡(빙글), 빠르게 여러 번(어지러움)
//
// 1) 뼈대(skeleton): 부모-자식으로 이어진 계층 뼈대입니다. 부모 뼈가 돌면 자식 뼈가 관절점째 따라 돕니다(FK).
//    root ─ hip ─ spine1 ─ spine2 ─ neck ─ head ─ earL, earR (+ 머리 안 face, muzzle)
//      │                    └ armL, armR
//      └ legL, legR
//    각 뼈의 월드 행렬 = 부모 행렬 · 이동 · 관절점 기준 회전 · 늘이기. 늘이기는 자식에게 위치로만 전해지고 모양은 안 늘어납니다.
//    몸통은 그룹이 아니라 '피부(mesh)'입니다. 몸통 윤곽점마다 hip·spine1·spine2 가중치가 있어(선형 블렌드 스키닝)
//    허리를 꺾으면 몸통이 휘어지며 이어집니다.
//    잡아끌기 = IK(CCD): 잡은 점이 손가락을 따라가도록 잡은 뼈에서 hip까지 관절 각도를 풉니다(관절마다 각도 제한).
//    뼈는 늘어나지 않습니다(말랑한 귀만 귀 끝 방향으로 최대 1.7배).
//    몸 전체는 강체 물리입니다(몸무게 4, 중력 2000px/s², 바닥 마찰, 회전 관성). 손가락과 잡은 점 사이는 용수철이라
//    멀리 당길수록 힘이 세지고 최대 힘(몸무게의 1.4배)에서 멈춥니다. 위로 당기는 힘이 몸무게보다 크면 떠오르고,
//    떠 있으면 잡은 점 아래로 매달려 진자처럼 흔들립니다. 놓으면 떨어져 착지하고 다시 똑바로 섭니다.
//    관절이 먼저 따라가고(팔은 어깨에서만 돌고, 귀는 늘어나고, 몸통은 조금만 휨), 관절로 닿지 않는 나머지만 몸에 힘으로 전해집니다.
//    무게는 사람 몸의 부위별 질량비(머리 8% · 몸통 50% · 팔 5% · 다리 16%)를 따릅니다. 무게중심·관성·관절 흔들림이 모두
//    이 비율로 계산돼, 무거운 몸통은 느리고 묵직하게, 가벼운 팔은 빠르게 흔들리며 팔이 흔들려도 몸은 거의 안 움직입니다.
// 2) 얼굴 파라미터: 표정을 그림으로 바꿔 끼우지 않고, 아래 값으로 매 프레임 눈·눈썹·입 모양을 새로 그립니다.
//    angleX/angleY(고개 좌우·상하, -1~1) · eyeOpenL/R(눈 뜸 0~1.2) · eyeSmile(-1 질끈 ∪ ~ +1 눈웃음 ∩)
//    eyeBallX/Y(시선) · browY/browAngle(-1 걱정 ~ +1 화남)/browAlpha · mouthOpen(0~1) · mouthForm(-1 시무룩 ~ +1 웃음)
//    기분이 바뀌면 이 값들이 목표값으로 부드럽게 옮겨가 표정이 자연스럽게 변합니다.
// 3) 2.5D: 고개를 돌리면 깊이에 따라 다르게 움직입니다(주둥이 10px > 눈 7px > 귀 -4px, 먼 쪽 귀는 좁아짐).
// 4) 시선 따라가기: 화면을 터치하거나 마우스를 움직이면 곰곰이가 그쪽을 봅니다. 2.5초 뒤 다시 두리번거립니다.
// 5) 물리: 귀는 스프링(관성)으로, 고개를 돌리거나 점프하면 출렁이다 멈춥니다.
// '동작 줄이기' 설정이면 움직이지 않고 기분에 맞는 표정만 보여 줍니다.

export const MOOD_LABEL = {
  sleepy: '졸려요', calm: '평온해요', happy: '기분 좋아요', proud: '뿌듯해요',
  waiting: '기다려요', worried: '걱정돼요', crying: '속상해요', angry: '삐졌어요',
};

const INK = '#2E1F17';
let serial = 0;
const PREFIX = `gg${Math.random().toString(36).slice(2, 7)}`;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const f = v => v.toFixed(2);

// 기분별 얼굴 파라미터 목표값
const FACE = {
  calm:    {eyeOpen: 1,    eyeSmile: 0,    browAlpha: 0, browAngle: 0,   browY: 0,  mouthOpen: 0,   mouthForm: .5},
  happy:   {eyeOpen: .85,  eyeSmile: .45,  browAlpha: 0, browAngle: 0,   browY: -.3, mouthOpen: .12, mouthForm: 1},
  proud:   {eyeOpen: .05,  eyeSmile: 1,    browAlpha: 0, browAngle: 0,   browY: -.4, mouthOpen: .75, mouthForm: 1},
  waiting: {eyeOpen: 1.18, eyeSmile: 0,    browAlpha: .7, browAngle: -.3, browY: -1, mouthOpen: .5,  mouthForm: 0},
  worried: {eyeOpen: .92,  eyeSmile: 0,    browAlpha: 1, browAngle: -1,  browY: 0,  mouthOpen: .05, mouthForm: -.45},
  crying:  {eyeOpen: .04,  eyeSmile: -1,   browAlpha: 1, browAngle: -1,  browY: .2, mouthOpen: .6,  mouthForm: -1},
  angry:   {eyeOpen: .82,  eyeSmile: 0,    browAlpha: 1, browAngle: 1,   browY: .4, mouthOpen: 0,   mouthForm: -.7},
  sleepy:  {eyeOpen: .02,  eyeSmile: .05,  browAlpha: 0, browAngle: 0,   browY: .3, mouthOpen: .06, mouthForm: .2},
};

// ---------- 그림 ----------
function defs(u) {
  return `<defs>
    <radialGradient id="fur${u}" cx="36%" cy="28%" r="78%"><stop offset="0" stop-color="#D9A574"/><stop offset=".6" stop-color="#B9845A"/><stop offset="1" stop-color="#93613D"/></radialGradient>
    <radialGradient id="body${u}" cx="40%" cy="20%" r="85%"><stop offset="0" stop-color="#C79468"/><stop offset="1" stop-color="#8E5D3B"/></radialGradient>
    <radialGradient id="ear${u}" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#F6D7B4"/><stop offset="1" stop-color="#D6A077"/></radialGradient>
    <radialGradient id="muz${u}" cx="42%" cy="30%" r="75%"><stop offset="0" stop-color="#FFF3E2"/><stop offset=".75" stop-color="#F1D6B4"/><stop offset="1" stop-color="#E0BA93"/></radialGradient>
    <radialGradient id="nose${u}" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="#6B4938"/><stop offset="1" stop-color="#22160F"/></radialGradient>
    <radialGradient id="eye${u}" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#4E362A"/><stop offset="1" stop-color="#140D09"/></radialGradient>
    <radialGradient id="blush${u}"><stop offset="0" stop-color="#F29486" stop-opacity=".8"/><stop offset="1" stop-color="#F29486" stop-opacity="0"/></radialGradient>
    <radialGradient id="gold${u}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#FCE29A"/><stop offset=".6" stop-color="#EDB13E"/><stop offset="1" stop-color="#C5852A"/></radialGradient>
    <linearGradient id="leaf${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A6D58E"/><stop offset="1" stop-color="#4F9656"/></linearGradient>
    <radialGradient id="tear${u}" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#E7F3FD"/><stop offset="1" stop-color="#6FA8DE"/></radialGradient>
    <filter id="soft${u}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
  </defs>`;
}
const drop = (u, x, y, s = 1) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 0 Q7 11 0 18 Q-7 11 0 0Z" fill="url(#tear${u})"/>`;
const spark = (u, x, y, s) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -10 L3 -3 10 0 3 3 0 10 -3 3 -10 0 -3 -3Z" fill="url(#gold${u})"/>`;
const FX = {
  proud: u => `<g class="fx-twinkle">${spark(u, 18, 56, 1.3)}${spark(u, 200, 44, 1)}${spark(u, 202, 128, .8)}</g>`,
  happy: u => `<g class="fx-twinkle">${spark(u, 200, 52, .9)}</g>`,
  crying: u => `<path d="M74 107 Q69 128 72 150 M146 107 Q151 128 148 150" fill="none" stroke="#A9D0F2" stroke-width="6" stroke-linecap="round" opacity=".7"/><g class="fx-tear">${drop(u, 78, 108)}</g><g class="fx-tear fx-late">${drop(u, 142, 108)}</g>`,
  worried: u => `<g class="fx-sweat">${drop(u, 166, 64, 1.1)}</g>`,
  angry: () => `<g transform="translate(160 56)"><g class="fx-throb" stroke="#D9473B" stroke-width="5" stroke-linecap="round" fill="none"><path d="M-9 -3 Q-3 -3 -3 -9 M3 -9 Q3 -3 9 -3 M9 3 Q3 3 3 9 M-3 9 Q-3 3 -9 3"/></g></g>`,
  sleepy: () => `<g class="fx-float" fill="#6F5A8C" font-family="Pretendard Variable, sans-serif" font-weight="700"><text x="168" y="54" font-size="26">Z</text><text x="190" y="32" font-size="18">z</text></g>`,
  waiting: () => `<g transform="translate(186 40)"><g class="fx-tick"><circle r="17" fill="#fff" stroke="#5B463A" stroke-width="3"/><path d="M0 -9 V0 L6 5" fill="none" stroke="#5B463A" stroke-width="3" stroke-linecap="round"/></g></g>`,
};
const CROWNS = [
  u => `<g transform="translate(110 40)"><path d="M0 8 V-10" stroke="#4F9656" stroke-width="4" stroke-linecap="round"/><path d="M0 -6 Q-16 -18 -20 -4 Q-8 0 0 -6 Z M0 -10 Q14 -24 20 -10 Q8 -4 0 -10 Z" fill="url(#leaf${u})"/></g>`,
  () => `<g transform="translate(110 38)">${[0, 72, 144, 216, 288].map(a => `<ellipse rx="6" ry="9" fill="#F4AABB" stroke="#E08EA2" stroke-width="1" transform="rotate(${a}) translate(0 -11)"/>`).join('')}<circle r="6.5" fill="#F3C65F"/></g>`,
  u => `<g transform="translate(110 36)"><path d="M0 -16 L5 -5 17 -4 8 4 11 16 0 10 -11 16 -8 4 -17 -4 -5 -5Z" fill="url(#gold${u})" stroke="#C5852A" stroke-width="1.5" stroke-linejoin="round"/></g>`,
  u => `<g transform="translate(110 40)"><path d="M-22 6 L-22 -12 -11 -2 0 -18 11 -2 22 -12 22 6 Z" fill="url(#gold${u})" stroke="#C5852A" stroke-width="2" stroke-linejoin="round"/><circle cx="0" cy="-2" r="3.5" fill="#E2717E"/></g>`,
];

function svgMarkup(u, label) {
  const ear = (side, x) => `<g data-bone="ear${side}"><g transform="translate(10 -6)"><circle cx="${x}" cy="58" r="25" fill="url(#fur${u})"/><circle cx="${x}" cy="59" r="13" fill="url(#ear${u})"/></g></g>`;
  // 눈: 흰자와 눈동자를 눈꺼풀 모양(clip)으로 잘라 그립니다. 눈동자가 흰자 안에서 움직여 시선이 보입니다.
  const eye = (side, cx) => `<clipPath id="clip${side}${u}"><path data-shape="clip${side}"/></clipPath>`
    + `<g clip-path="url(#clip${side}${u})" data-shape="ball${side}"><ellipse cx="${cx}" cy="100" rx="12" ry="13" fill="#FFFDF7"/><circle data-shape="iris${side}" r="6.6" fill="url(#eye${u})"/><circle data-shape="hiA${side}" r="2.2" fill="#fff"/><circle data-shape="hiB${side}" r="1" fill="#fff" opacity=".85"/></g>`
    + `<path data-shape="rim${side}" fill="none" stroke="#3A2618" stroke-width="1.8"/>`
    + `<path data-shape="lid${side}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`
    + `<path data-shape="heart${side}" d="M0 3.5 C-9 -2 -6 -10 0 -5.5 C6 -10 9 -2 0 3.5Z" fill="#E2546A" opacity="0"/>`
    + `<path data-shape="spiral${side}" d="M0 0 m0 -1.5 a1.5 1.5 0 1 1 -1.5 1.5 a3.5 3.5 0 1 1 3.5 3.5 a6 6 0 1 1 -6 -6 a8.5 8.5 0 1 1 8.5 8.5" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" opacity="0"/>`;
  return `<svg class="bear" viewBox="0 0 240 260" role="img" aria-label="${label}">${defs(u)}
  <g data-local="shadow" data-pivot="120 248"><ellipse cx="120" cy="248" rx="62" ry="9" fill="#26332B" opacity=".16"/></g>
  <g data-bone="legL"><ellipse cx="100" cy="232" rx="20" ry="16" fill="url(#body${u})"/><ellipse cx="100" cy="239" rx="10" ry="5.5" fill="url(#ear${u})"/></g>
  <g data-bone="legR"><ellipse cx="140" cy="232" rx="20" ry="16" fill="url(#body${u})"/><ellipse cx="140" cy="239" rx="10" ry="5.5" fill="url(#ear${u})"/></g>
  <path data-shape="torso" fill="url(#body${u})"/><path data-shape="belly" fill="url(#muz${u})" opacity=".9"/>
  <g data-bone="armL"><ellipse cx="71" cy="188" rx="15" ry="27" fill="url(#fur${u})" transform="rotate(20 71 188)"/><circle cx="64" cy="208" r="8" fill="url(#ear${u})"/></g>
  <g data-bone="armR"><ellipse cx="169" cy="188" rx="15" ry="27" fill="url(#fur${u})" transform="rotate(-20 169 188)"/><circle cx="176" cy="208" r="8" fill="url(#ear${u})"/></g>
  ${ear('L', 52)}${ear('R', 168)}
  <g data-bone="head"><g transform="translate(10 -6)">
    <ellipse cx="110" cy="108" rx="76" ry="68" fill="url(#fur${u})"/>
    <ellipse cx="84" cy="72" rx="30" ry="17" fill="#fff" opacity=".12" transform="rotate(-18 84 72)"/>
    <g data-local="face" data-pivot="110 100">
      <g data-part="cheeks"><ellipse cx="68" cy="125" rx="15" ry="9" fill="url(#blush${u})"/><ellipse cx="152" cy="125" rx="15" ry="9" fill="url(#blush${u})"/></g>
      ${eye('L', 82)}${eye('R', 138)}
      <path data-shape="brows" fill="none" stroke="#4E2F1E" stroke-width="5.5" stroke-linecap="round"/>
    </g>
    <g data-local="muzzle" data-pivot="110 134">
      <ellipse cx="110" cy="138" rx="37" ry="26" fill="#6E4428" opacity=".2" filter="url(#soft${u})"/>
      <ellipse cx="110" cy="134" rx="35" ry="26" fill="url(#muz${u})"/>
      <clipPath id="clipM${u}"><path data-shape="mouthClip"/></clipPath>
      <path data-shape="mouthFill" fill="#3A1F14" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <g clip-path="url(#clipM${u})"><ellipse data-shape="tongue" fill="#E7848A"/></g>
      <path data-shape="mouthLine" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
      <ellipse cx="110" cy="121" rx="12" ry="8.5" fill="url(#nose${u})"/><ellipse cx="106" cy="118" rx="4" ry="2.4" fill="#fff" opacity=".5"/>
      <path d="M110 129 V133" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
    </g>
    <g data-part="crown"></g>
    <g data-part="fx"></g>
  </g></g>
</svg>`;
}

// ---------- 얼굴 그리기(파라미터 → 모양) ----------
// 눈: 위 곡선 높이 = r×뜸, 아래 곡선은 눈웃음만큼 올라가 반달(∩)이 됩니다. 거의 감기면 선 하나로 바뀝니다.
// heart(하트 눈)·dizzy(소용돌이 눈)가 커지면 눈 대신 그 모양을 보여 줍니다.
function drawEye(sh, side, cx, cy, r, open, smile, ballX, ballY, heart, dizzy, t) {
  const plain = (1 - heart) * (1 - dizzy);
  const ht = r * 1.08 * Math.max(open, 0), hb = r * 1.08 * Math.max(open, 0) * (1 - .95 * Math.max(0, smile));
  const k = 1.33, filled = smooth(.12, .32, open);
  const d = `M${f(cx - r)} ${f(cy)} C${f(cx - r)} ${f(cy - ht * k)} ${f(cx + r)} ${f(cy - ht * k)} ${f(cx + r)} ${f(cy)} C${f(cx + r)} ${f(cy + hb * k)} ${f(cx - r)} ${f(cy + hb * k)} ${f(cx - r)} ${f(cy)}Z`;
  sh[`clip${side}`].setAttribute('d', d);
  sh[`rim${side}`].setAttribute('d', d);
  sh[`rim${side}`].setAttribute('opacity', f(filled * plain));
  sh[`ball${side}`].setAttribute('opacity', f(filled * plain));
  // 눈동자: 흰자 안에서 시선 방향으로 움직입니다(좌우 ±4.2, 상하 ±3.2).
  const ix = cx + 4.2 * ballX, iy = cy + 3.2 * ballY;
  sh[`iris${side}`].setAttribute('cx', f(ix)); sh[`iris${side}`].setAttribute('cy', f(iy));
  sh[`hiA${side}`].setAttribute('cx', f(ix + 2)); sh[`hiA${side}`].setAttribute('cy', f(iy - 2.4));
  sh[`hiB${side}`].setAttribute('cx', f(ix - 2.3)); sh[`hiB${side}`].setAttribute('cy', f(iy + 2.3));
  // 감은 눈 선: 눈웃음이면 ∩, 질끈(-)이면 ∪, 졸리면 살짝 ∪
  const bend = smile > .1 ? -r * 1.1 * smile : smile < -.1 ? r * 1.15 * -smile : r * .4;
  sh[`lid${side}`].setAttribute('d', `M${f(cx - r)} ${f(cy + 1)} Q${f(cx)} ${f(cy + 1 + bend)} ${f(cx + r)} ${f(cy + 1)}`);
  sh[`lid${side}`].setAttribute('opacity', f((1 - filled) * plain));
  const hs = 1.9 * (.92 + .1 * Math.sin(t * 9)) * (.6 + .4 * heart);
  sh[`heart${side}`].setAttribute('transform', `translate(${f(cx + 1.5 * ballX)} ${f(cy + ballY)}) scale(${f(hs)})`);
  sh[`heart${side}`].setAttribute('opacity', f(heart));
  sh[`spiral${side}`].setAttribute('transform', `translate(${f(cx)} ${f(cy)}) rotate(${f((t * 400) % 360 * (side === 'L' ? 1 : -1))})`);
  sh[`spiral${side}`].setAttribute('opacity', f(dizzy));
}
function drawBrows(sh, p) {
  const y = 84 + 5 * p.browY, inner = 6 * p.browAngle, outer = -3 * p.browAngle, dx = 1.8 * p.eyeBallX;
  sh.brows.setAttribute('d', `M${f(71 + dx)} ${f(y + outer)} L${f(91 + dx)} ${f(y + inner)} M${f(129 + dx)} ${f(y + inner)} L${f(149 + dx)} ${f(y + outer)}`);
  sh.brows.setAttribute('opacity', f(clamp(p.browAlpha, 0, 1)));
}
// 입: 다물면 인중 아래에서 갈라지는 ω(웃음) ~ ∩∩(시무룩), 벌리면 위가 평평하고 아래가 둥근 D 모양(놀람은 O)
function drawMouth(sh, open, form) {
  const cx = 110, top = 134, smile = Math.max(0, form), frown = Math.max(0, -form);
  const w = 9 + 3 * open + 3 * smile, corner = 136 - 3 * form;
  const closed = 1 - smooth(.08, .22, open);
  sh.mouthLine.setAttribute('d', `M${cx} ${top} Q${f(cx - w * .45)} ${f(136 + 5 * form)} ${f(cx - w)} ${f(corner)} M${cx} ${top} Q${f(cx + w * .45)} ${f(136 + 5 * form)} ${f(cx + w)} ${f(corner)}`);
  sh.mouthLine.setAttribute('opacity', f(closed));
  const round = 1 - Math.abs(form);  // 0에 가까울수록 O(놀람)
  const topCtrl = top - 1 - 9 * frown - 7 * open * round;  // 시무룩할수록 윗선이 둥글게 올라가 ∩(우는 입)
  const bottom = corner + (6 + 24 * open) * (1 - .45 * frown);
  const d = `M${f(cx - w)} ${f(corner)} Q${cx} ${f(topCtrl)} ${f(cx + w)} ${f(corner)} Q${f(cx + w * .9)} ${f(bottom)} ${cx} ${f(bottom)} Q${f(cx - w * .9)} ${f(bottom)} ${f(cx - w)} ${f(corner)}Z`;
  sh.mouthFill.setAttribute('d', d); sh.mouthClip.setAttribute('d', d);
  sh.mouthFill.setAttribute('opacity', f(1 - closed));
  sh.tongue.setAttribute('cx', cx); sh.tongue.setAttribute('cy', f(bottom - 2));
  sh.tongue.setAttribute('rx', f(w * .62)); sh.tongue.setAttribute('ry', f(3 + 6 * open));
  sh.tongue.setAttribute('opacity', f(smooth(.3, .55, open) * (1 - closed) * (1 - .6 * round) * (1 - .9 * frown)));
}

// ---------- 몸 동작(한 번) ----------
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function track(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) { const [t0, v0] = keys[i - 1]; return v0 + (v1 - v0) * easeInOut((t - t0) / (t1 - t0)); }
  }
  return keys[keys.length - 1][1];
}
const wave = (t, period, phase = 0) => Math.sin(2 * Math.PI * (t / period - phase));

// ---------- 뼈대 ----------
// 이름: [부모, 관절점 x, y(쉬는 자세의 화면 좌표)] — 부모가 먼저 오도록 적습니다.
const ROOT_PIVOT = [120, 246];
const SKELETON = {
  hip: ['root', 120, 236], spine1: ['hip', 120, 206], spine2: ['spine1', 120, 178], neck: ['spine2', 120, 164], head: ['neck', 120, 152],
  earL: ['head', 76, 70], earR: ['head', 164, 70],
  armL: ['spine2', 80, 164], armR: ['spine2', 160, 164], legL: ['root', 100, 216], legR: ['root', 140, 216],
};
// 늘어나는 뼈와 늘어나는 방향(관절점 → 끝). 뼈는 단단해서 늘지 않고, 말랑한 귀만 귀 끝 방향으로 늘어납니다.
const AXIS = {earL: [-14, -18], earR: [14, -18]};
for (const b in AXIS) { const [x, y] = AXIS[b], n = Math.hypot(x, y); AXIS[b] = [x / n, y / n]; }
const along = ([x, y], k) => [1 + (k - 1) * x * x, (k - 1) * x * y, (k - 1) * x * y, 1 + (k - 1) * y * y, 0, 0];
// 머리 안의 작은 뼈(머리 좌표 기준 관절점은 data-pivot): 귀·눈·주둥이. body는 동작 정의용 별칭(→ hip·spine1·spine2).
const LOCAL = ['shadow', 'face', 'muzzle'];
const BONES = ['root', 'body', ...Object.keys(SKELETON), ...LOCAL];
const blank = () => Object.fromEntries(BONES.map(b => [b, {x: 0, y: 0, r: 0, sx: 1, sy: 1}]));
const DEG = Math.PI / 180;

// 2×3 행렬 [a b c d e f] (SVG matrix 순서)
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const inv = m => { const d = m[0] * m[3] - m[1] * m[2]; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
const T = (x, y) => [1, 0, 0, 1, x, y];
const R = a => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
const S = (x, y) => [x, 0, 0, y, 0, 0];

// 자세(뼈마다 x·y·r·sx·sy) → 뼈마다 월드 행렬 M, 월드 각 a(라디안), 관절점 위치(px, py)
function solveWorld(L) {
  const r = L.root, [rx, ry] = ROOT_PIVOT;
  const M0 = mul(T(rx + r.x, ry + r.y), mul(R(r.r * DEG), mul(S(r.sx, r.sy), T(-rx, -ry))));
  const lin = [M0[0], M0[1], M0[2], M0[3], 0, 0];
  const W = {root: {M: M0, a: 0, px: M0[4] + rx * M0[0] + ry * M0[2], py: M0[5] + rx * M0[1] + ry * M0[3]}, det: Math.sign(M0[0] * M0[3] - M0[1] * M0[2]) || 1};
  for (const name in SKELETON) {
    const [parent, x0, y0] = SKELETON[name], P = W[parent], l = L[name], a = P.a + l.r * DEG;
    const [ox, oy] = ap(mul(lin, R(P.a)), l.x, l.y), [wx, wy] = ap(P.M, x0, y0);
    const own = l.k && l.k !== 1 ? mul(S(l.sx, l.sy), along(AXIS[name], l.k)) : S(l.sx, l.sy);
    W[name] = {M: mul(T(wx + ox, wy + oy), mul(lin, mul(R(a), mul(own, T(-x0, -y0))))), a, px: wx + ox, py: wy + oy};
  }
  return W;
}

// 몸통 피부: 윤곽점마다 뼈 가중치(위 spine2 → 가운데 spine1 → 아래 hip)
function torsoWeights(y) {
  const a = smooth(166, 198, y), b = smooth(198, 226, y);
  return [['spine2', 1 - a], ['spine1', a - b], ['hip', b]].filter(([, k]) => k > 1e-4);
}
const ring = (cx, cy, rx, ry, n) => Array.from({length: n}, (_, i) => { const t = 2 * Math.PI * i / n, x = cx + rx * Math.cos(t), y = cy + ry * Math.sin(t); return [x, y, torsoWeights(y)]; });
const TORSO = ring(120, 190, 56, 52, 32), BELLY = ring(120, 201, 33, 31, 20);
const skin = (W, pts) => pts.map(([x, y, w]) => { let X = 0, Y = 0; for (const [b, k] of w) { const [px, py] = ap(W[b].M, x, y); X += px * k; Y += py * k; } return [X, Y]; });
// 닫힌 Catmull-Rom 곡선 → 베지어 경로
function smoothPath(P) {
  const n = P.length; let d = `M${f(P[0][0])} ${f(P[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + 'Z';
}

// IK: 잡은 뼈 → 뿌리까지의 사슬. 무거운 몸통은 조금만 꺾이고 천천히 따라오며, 가벼운 귀·팔은 혼자 잘 움직입니다.
const IK_CHAIN = {
  head: ['head', 'neck', 'spine2', 'spine1', 'hip'], spine2: ['spine2', 'spine1', 'hip'], spine1: ['spine1', 'hip'], hip: ['hip'],
  earL: ['earL', 'head', 'neck'], earR: ['earR', 'head', 'neck'],
  armL: ['armL'], armR: ['armR'],  // 팔은 어깨에서 혼자 돕니다 legL: ['legL'], legR: ['legR'],
};
// 물리: 질량 1 기준. 힘의 단위는 px/s².
// 몸무게 BODY_MASS: 클수록 같은 힘에 덜 움직임(사람보다 훨씬 묵직하게 4배). 질량비는 이 무게를 부위별로 나눈 비율입니다.
const GRAVITY = 2000, BODY_MASS = 4, WEIGHT = BODY_MASS * GRAVITY, PULL_K = 120, PULL_C = 25, FRICTION = 1.2;
// 잡은 부위가 견딜 수 있는 최대 힘: 귀는 몸무게보다 작아 귀로는 들어 올릴 수 없습니다.
// 바닥 충돌용 몸 윤곽점(쉬는 자세): 머리 위·옆, 몸 옆, 발바닥. 바닥 높이 = 248
const HULL = [[120, 34], [60, 70], [180, 70], [44, 104], [196, 104], [62, 190], [178, 190], [86, 248], [154, 248]], FLOOR = 248;
const FMAX = b => (b === 'earL' || b === 'earR' ? .4 : 1.4) * WEIGHT;
const IK_LIMIT = {root: 15, hip: 3, spine1: 5, spine2: 6, neck: 15, head: 15, earL: 40, earR: 40, armL: 170, armR: 170, legL: 30, legR: 30};
// 한 번에 돌리는 비율: 가벼운 끝 관절이 먼저·많이, 무거운 몸통은 조금만
const IK_GAIN = {root: .4, hip: .12, spine1: .18, spine2: .22, neck: .3, head: .25, earL: .8, earR: .8, armL: .8, armR: .8, legL: .8, legR: .8};
const CHAIN_GAIN = {earL: {head: .1, neck: .06}, earR: {head: .1, neck: .06}};  // 귀를 당기면 귀가 늘고 머리는 살짝만
// 덜 꺾인 자세 선호(반복마다 0 쪽으로 당김): 무거운 몸통일수록 강하게. 척추와 목이 반대로 꺾여 S자로 꼬이는 것을 막습니다.
const IK_REST = {hip: .1, spine1: .1, spine2: .1, neck: .05, head: .04};
const STRETCH = {earL: ['earL'], earR: ['earR']};
const STRETCH_MAX = 1.7;
const SPINE = ['hip', 'spine1', 'spine2'];
// 잡고 있을 때 관절이 IK 풀이를 따라가는 스프링 [강성, 감쇠]: 무거운 몸통일수록 느리게(묵직하게)
const HOLD = {root: [150, 25], hip: [90, 19], spine1: [90, 19], spine2: [90, 19], neck: [220, 30], head: [220, 30], earL: [500, 45], earR: [500, 45], armL: [260, 32], armR: [260, 32], legL: [220, 30], legR: [220, 30]};
// 놓은 뒤 스프링: 몸통은 무겁게 천천히 한두 번만, 머리·팔은 출렁, 귀는 통통 튕기며 돌아옵니다.
const RELEASE = {root: [150, 16], hip: [140, 14], spine1: [130, 12], spine2: [120, 11], neck: [150, 7], head: [130, 6], earL: [230, 5], earR: [230, 5], armL: [110, 8], armR: [110, 8], legL: [120, 7], legR: [120, 7]};

// ---------- 사람 몸 질량비 ----------
// 부위별 질량비는 생체역학 표준값(Winter, Biomechanics and Motor Control of Human Movement — Dempster 자료)입니다.
// 머리·목 8.1% · 가슴 21.6% · 배 13.9% · 골반 14.2% · 팔 하나 5.0%(위팔 2.8 + 아래팔 1.6 + 손 0.6)
// · 다리 하나 16.1%(허벅지 10.0 + 종아리 4.65 + 발 1.45). 귀는 사람에게 없으니 아주 가볍게(0.1%).
// 뼈: [질량비, 그 부위 무게중심 x, y(쉬는 자세), 회전반경 px]
const SEG = {
  head: [.081, 120, 102, 45], earL: [.001, 62, 52, 10], earR: [.001, 178, 52, 10],
  spine2: [.216, 120, 168, 30], spine1: [.139, 120, 200, 26], hip: [.142, 120, 228, 24],
  armL: [.05, 70, 190, 16], armR: [.05, 170, 190, 16], legL: [.161, 100, 230, 12], legR: [.161, 140, 230, 12],
};
{ const sum = Object.values(SEG).reduce((a, v) => a + v[0], 0); for (const b in SEG) SEG[b][0] /= sum; }
const CHILDREN = {}; for (const b in SKELETON) (CHILDREN[SKELETON[b][0]] ||= []).push(b);
const subtree = b => [b, ...(CHILDREN[b] || []).flatMap(subtree)];
const SUBTREE = Object.fromEntries(Object.keys(SKELETON).map(b => [b, subtree(b)]));
// 관절 j에 매달린(먼 쪽) 질량 M, 그 무게중심까지의 벡터 r, 관절 기준 관성 I
function distal(W, j) {
  const px = W[j].px, py = W[j].py; let M = 0, cx = 0, cy = 0, I = 0;
  for (const b of SUBTREE[j]) {
    const sg = SEG[b]; if (!sg) continue;
    const [m, x, y, rg] = sg, [wx, wy] = ap(W[b].M, x, y);
    M += m; cx += m * wx; cy += m * wy; I += m * ((wx - px) ** 2 + (wy - py) ** 2 + rg * rg);
  }
  return {M, r: [cx / M - px, cy / M - py], I};
}
// 몸 전체 무게중심과 기준점 둘레 관성(질량 합 1)
function wholeBody(W, ref) {
  let cx = 0, cy = 0, I = 0;
  for (const b in SEG) { const [m, x, y, rg] = SEG[b], [wx, wy] = ap(W[b].M, x, y); cx += m * wx; cy += m * wy; I += m * ((wx - ref[0]) ** 2 + (wy - ref[1]) ** 2 + rg * rg); }
  return {c: [cx, cy], I};
}
const REST_W = solveWorld(blank());
const COM = wholeBody(REST_W, [0, 0]).c, INERTIA = wholeBody(REST_W, COM).I;
// 관절 근육: 강성 K = κ × (매달린 무게) × g × (그 무게중심까지 거리). κ가 클수록 중력에 덜 처지고, ζ는 감쇠비.
// 몸통·목은 단단히 버티고(κ 4~6), 팔은 힘을 빼고 늘어뜨린 상태(κ 0.35), 다리는 공중에서만 늘어집니다.
// 같은 근육 비율이어도 매달린 질량·길이가 달라 몸통은 느리고 묵직하게, 팔·머리는 빠르게 흔들립니다.
const JOINTS = ['hip', 'spine1', 'spine2', 'neck', 'head', 'armL', 'armR', 'legL', 'legR'];
const KAPPA = {hip: 18, spine1: 18, spine2: 18, neck: 12, head: 12, armL: 1.2, armR: 1.2, legL: 1.5, legR: 1.5};
const ZETA = {hip: .7, spine1: .7, spine2: .7, neck: .55, head: .5, armL: .6, armR: .6, legL: .6, legR: .6};
const JLIM = {hip: 25, spine1: 25, spine2: 25, neck: 40, head: 40, armL: 150, armR: 150, legL: 110, legR: 110};
const JOINT = Object.fromEntries(JOINTS.map(j => {
  const {M, r, I} = distal(REST_W, j), K = KAPPA[j] * M * GRAVITY * Math.hypot(...r);
  return [j, {M, I, K, C: 2 * ZETA[j] * Math.sqrt(K * I)}];
}));
const squash = (p, sy) => { p.body.sy *= sy; p.body.sx *= 2 - sy; };

// apply(진행 초, 자세, 얼굴, 방향) — 자세에 더하거나 곱합니다.
const CLIPS = {
  hop: {duration: .9, apply(t, p) {
    p.root.y += track(t, [[0, 0], [.14, 5], [.4, -40], [.62, 0], [.75, 3], [.9, 0]]);
    squash(p, track(t, [[0, 1], [.14, .86], [.38, 1.1], [.62, .88], [.78, 1.03], [.9, 1]]));
    const arm = track(t, [[0, 0], [.14, -12], [.4, 45], [.62, -8], [.9, 0]]); p.armL.r += arm; p.armR.r -= arm;
    p.legL.r += track(t, [[0, 0], [.4, 12], [.62, 0]]); p.legR.r -= track(t, [[0, 0], [.4, 12], [.62, 0]]);
    const s = track(t, [[0, 1], [.4, .62], [.62, 1]]); p.shadow.sx *= s; p.shadow.sy *= s;
  }},
  cheer: {duration: 1.7, apply(t, p) {
    CLIPS.hop.apply(t % .85 * (.9 / .85), p);
    const up = track(t, [[0, 0], [.18, 1], [1.45, 1], [1.7, 0]]);
    p.armL.r += up * (150 + 14 * wave(t, .35)); p.armR.r -= up * (150 + 14 * wave(t, .35, .5));
    p.head.r += up * 4 * wave(t, .85);
  }},
  tap: {duration: .9, apply(t, p) {
    p.head.r += track(t, [[0, 0], [.12, -9], [.3, 8], [.5, -5], [.68, 2], [.8, 0]]);
    squash(p, track(t, [[0, 1], [.1, .93], [.26, 1.04], [.45, 1]]));
  }},
  stomp: {duration: .65, apply(t, p) {
    p.legR.y += track(t, [[0, 0], [.16, -12], [.3, 0]]); p.legR.r += track(t, [[0, 0], [.16, -12], [.3, 0]]);
    squash(p, track(t, [[.28, 1], [.34, .9], [.5, 1]]));
    p.root.y += track(t, [[.28, 0], [.34, 3], [.5, 0]]);
    p.head.r += track(t, [[.3, 0], [.38, -4], [.46, 4], [.56, 0]]);
  }},
  // 쓰다듬기: 손 쪽으로 머리를 기대고 몸을 살랑
  pet: {duration: 1.6, apply(t, p, dir = 1) {
    const lean = track(t, [[0, 0], [.25, 1], [1.2, 1], [1.6, 0]]);
    p.head.r += lean * (9 * dir + 2.5 * wave(t, .8)); p.head.x += lean * 3 * dir; p.body.r += lean * 2 * dir;
    p.armL.r -= lean * 14; p.armR.r += lean * 14;
  }},
  // 꼭 안기: 팔로 몸을 감싸고 꼬옥
  hug: {duration: 1.5, apply(t, p) {
    const k = track(t, [[0, 0], [.25, 1], [1.15, 1], [1.5, 0]]);
    p.armL.r -= k * 72; p.armR.r += k * 72;
    squash(p, 1 - .06 * k + .015 * k * wave(t, .5));
    p.head.r += k * 3 * wave(t, 1); p.head.y += k * 3;
  }},
  // 배 콕: 배가 출렁
  belly: {duration: .9, apply(t, p) {
    squash(p, track(t, [[0, 1], [.1, .88], [.25, 1.07], [.42, .95], [.6, 1.03], [.9, 1]]));
    const a = track(t, [[0, 0], [.1, 25], [.5, 15], [.9, 0]]); p.armL.r += a; p.armR.r -= a;
    p.root.y += track(t, [[0, 0], [.1, 4], [.3, 0]]);
  }},
  // 빙글: 좌우를 뒤집어 한 바퀴 도는 것처럼(2.5D)
  spin: {duration: 1, apply(t, p) {
    p.root.sx *= track(t, [[0, 1], [.25, -.05], [.5, -1], [.75, .05], [1, 1]]) || .05;
    p.root.y += track(t, [[0, 0], [.15, 3], [.45, -22], [.75, 0], [.85, 2], [1, 0]]);
    squash(p, track(t, [[0, 1], [.15, .9], [.45, 1.06], [.75, .92], [1, 1]]));
  }},
  // 하품·기지개: 팔을 위로 쭉, 고개를 젖힘
  yawn: {duration: 2.4, apply(t, p) {
    const k = track(t, [[0, 0], [.6, 1], [1.7, 1], [2.4, 0]]);
    p.armL.r += k * 150; p.armR.r -= k * 150; squash(p, 1 + .07 * k); p.head.r += k * 2 * wave(t, 1.2); p.head.y -= 4 * k;
  }},
  // 깜짝: 살짝 뛰며 팔을 벌림
  startle: {duration: .7, apply(t, p) {
    p.root.y += track(t, [[0, 0], [.12, -18], [.35, 0]]);
    const a = track(t, [[0, 0], [.12, 55], [.5, 30], [.7, 0]]); p.armL.r += a; p.armR.r -= a;
    squash(p, track(t, [[0, 1], [.12, 1.08], [.35, .92], [.55, 1]]));
  }},
  // 손 흔들기(오른팔)
  wave: {duration: 1.8, apply(t, p) {
    const k = track(t, [[0, 0], [.3, 1], [1.45, 1], [1.8, 0]]);
    p.armR.r -= k * (140 + 18 * wave(t, .4)); p.head.r += k * 5; p.body.r += k * 1.5;
  }},
  // 착지: 쿵 눌렸다 튀어 오름
  land: {duration: .55, apply(t, p) {
    squash(p, track(t, [[0, .82], [.12, 1.08], [.26, .96], [.4, 1.01], [.55, 1]]));
    const a = track(t, [[0, 40], [.3, -6], [.55, 0]]); p.armL.r += a; p.armR.r -= a;
  }},
  // 어지러움: 머리가 빙글빙글, 몸이 휘청
  dizzy: {duration: 2.2, apply(t, p) {
    const k = track(t, [[0, 0], [.3, 1], [1.8, 1], [2.2, 0]]);
    p.head.r += k * 8 * Math.sin(t * 9); p.head.x += k * 4 * Math.cos(t * 9); p.body.r += k * 3 * Math.sin(t * 4.5); p.root.x += k * 3 * Math.sin(t * 4.5);
  }},
};

// 짧은 표정(기분 표정 위에 잠깐 겹침)
const EXPR = {
  laugh: {eyeOpen: 0, eyeSmile: 1, mouthOpen: .9, mouthForm: 1, blush: 1.2},
  wink: {eyeOpen: 1, winkL: 1, eyeSmile: 0, mouthOpen: .12, mouthForm: 1},
  surprised: {eyeOpen: 1.3, eyeSmile: 0, browAlpha: .8, browAngle: -.3, browY: -1.4, mouthOpen: .55, mouthForm: 0},
  shy: {eyeOpen: .7, eyeSmile: .5, mouthOpen: 0, mouthForm: .6, blush: 1.9, lookX: -.65, lookY: .4},
  love: {heart: 1, eyeOpen: 1, mouthOpen: .35, mouthForm: 1, blush: 1.6},
  dizzy: {dizzy: 1, eyeOpen: 1, eyeSmile: 0, mouthOpen: .3, mouthForm: -.25, browAlpha: .6, browAngle: -.6},
  yawn: {eyeOpen: 0, eyeSmile: -.25, mouthOpen: 1, mouthForm: -.1, browAlpha: .5, browAngle: -.5, lookY: -.5},
  pout: {eyeOpen: .8, eyeSmile: 0, browAlpha: 1, browAngle: .6, mouthOpen: 0, mouthForm: -.9, blush: 1.3, lookX: -.65},
  relieved: {eyeOpen: 0, eyeSmile: .85, mouthOpen: .08, mouthForm: .85, blush: 1.4},
};
const BASE = {winkL: 0, heart: 0, dizzy: 0, blush: 1};

// 만졌을 때 반응: [몸 동작, 표정, 표정 시간(초), 말] — 기분에 따라 다르게
const pick = list => list[Math.floor(Math.random() * list.length)];
function reaction(kind, mood) {
  if (kind === 'head') {
    if (mood === 'angry') return ['stomp', 'pout', 1.6, pick(['흥! 약부터 챙겨요', '체크해 주면 풀릴지도…'])];
    if (mood === 'sleepy') return ['startle', 'surprised', 1.2, '어…? 깼어요!'];
    if (mood === 'crying') return ['pet', 'relieved', 1.6, '훌쩍… 고마워요'];
    return ['tap', pick(['laugh', 'wink']), 1.1, pick(['헤헤, 간지러워요', '왜요? 헤헤', '같이 약 챙겨요!'])];
  }
  if (kind === 'pet') {
    if (mood === 'angry') return ['pet', 'shy', 1.8, '…조금 풀렸어요'];
    if (mood === 'crying' || mood === 'worried') return ['pet', 'relieved', 1.8, '위로해 줘서 고마워요'];
    return ['pet', pick(['relieved', 'shy']), 1.8, pick(['기분 좋아요…', '더 쓰다듬어 줘요'])];
  }
  if (kind === 'ear') return ['startle', 'surprised', .9, pick(['귀가 쫑긋!', '앗, 귀는 예민해요'])];
  if (kind === 'belly') return ['belly', 'laugh', 1.1, pick(['배는 간지러워요! 하하', '꿀렁꿀렁!'])];
  if (kind === 'arm') return ['wave', 'laugh', 1.2, pick(['하이파이브!', '손 잡아 줄래요?'])];
  if (kind === 'foot') return ['stomp', 'pout', 1, '발 밟지 마요~'];
  if (kind === 'hug') return ['hug', 'love', 1.8, pick(['꼬옥!', '따뜻해요'])];
  if (kind === 'double') return ['spin', 'laugh', 1.1, '빙글!'];
  if (kind === 'rapid') return ['dizzy', 'dizzy', 2.2, '어지러워요…'];
  return ['tap', 'laugh', 1, ''];
}

export function createBear(container, {mood = 'calm', rank = 0, label = '', interactive = true} = {}) {
  const u = `${PREFIX}-${++serial}`;
  container.innerHTML = svgMarkup(u, label || `곰곰이가 ${MOOD_LABEL[mood] || ''}`);
  const svg = container.querySelector('svg');
  const bones = {}, locals = {}, sh = {};
  for (const el of svg.querySelectorAll('[data-bone]')) bones[el.dataset.bone] = el;
  for (const el of svg.querySelectorAll('[data-local]')) { const [px, py] = el.dataset.pivot.split(' ').map(Number); locals[el.dataset.local] = {el, px, py}; }
  for (const el of svg.querySelectorAll('[data-shape]')) sh[el.dataset.shape] = el;
  const part = name => svg.querySelector(`[data-part="${name}"]`);
  const now = () => (performance.now() - (st?.start ?? performance.now())) / 1000;
  const st = {
    mood, rank, clips: [], start: performance.now(), last: 0, raf: 0,
    face: {...BASE, ...FACE[mood] || FACE.calm, eyeOpenL: 1, eyeOpenR: 1, eyeBallX: 0, eyeBallY: 0, angleX: 0, angleY: 0},
    expr: null, look: {x: 0, y: 0, until: 0, nextIdle: 1.5}, blinkAt: 1.2 + Math.random() * 2, blinkDouble: false, talkUntil: 0, nextAuto: 3,
    ears: {L: {a: 0, v: 0}, R: {a: 0, v: 0}}, prevHead: null, lastTouch: 0, nextIdleAct: 9 + Math.random() * 5,
    gesture: null, taps: [], W: solveWorld(blank()),
    // 잡아끌기 상태: 잡은 뼈·그 뼈 기준 잡은 점(lx, ly)·목표점(tx, ty), IK 풀이(sol), 관절 스프링(ang), 늘이기(s), 몸 위치(rx, ry)
    drag: {active: false, bone: 'head', lx: 0, ly: 0, tx: 0, ty: 0, peak: 0, sol: {}, solS: 1},
    rig: {ang: Object.fromEntries(Object.keys(RELEASE).map(b => [b, {a: 0, v: 0}])), s: {a: 1, v: 0}, sBones: [],
      body: {x: 0, y: 0, vx: 0, vy: 0, th: 0, w: 0, air: false}, prev: null, acc: {}, reactBody: 0},
  };

  function setMood(nextMood = st.mood, nextRank = st.rank) {
    st.mood = FACE[nextMood] ? nextMood : 'calm'; st.rank = nextRank;
    part('crown').innerHTML = CROWNS[Math.max(0, Math.min(3, nextRank))](u);
    part('fx').innerHTML = FX[st.mood] ? FX[st.mood](u) : '';
    svg.setAttribute('aria-label', `곰곰이가 ${MOOD_LABEL[st.mood]}`);
    st.nextAuto = 0;
    if (reducedMotion()) { Object.assign(st.face, BASE, FACE[st.mood]); render(0, 0); }
  }
  function play(name, dir = 1) {
    if (!CLIPS[name] || reducedMotion()) return;
    st.clips = st.clips.filter(c => c.name !== name);
    st.clips.push({name, at: now(), dir});
  }
  function express(name, seconds = 1.2) { if (EXPR[name]) st.expr = {name, until: now() + seconds}; }
  function talk(seconds = 1.2) { st.talkUntil = now() + seconds; }
  // 말풍선 + 입 뻥끗거리기
  let bubbleTimer = 0;
  function say(text, seconds) {
    if (!text) return;
    let bubble = container.querySelector('.bear-bubble');
    if (!bubble) { bubble = document.createElement('div'); bubble.className = 'bear-bubble'; bubble.setAttribute('aria-live', 'polite'); container.appendChild(bubble); }
    bubble.textContent = text; bubble.classList.remove('show'); void bubble.offsetWidth; bubble.classList.add('show');
    const dur = seconds ?? Math.min(2.2, .5 + text.length * .09);
    talk(dur * .8);
    clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 1300);
  }
  // 만지기 반응
  function interact(kind, dir = 1) {
    const [clip, face, secs, line] = reaction(kind, st.mood);
    play(clip, dir); express(face, secs); say(line);
    st.lastTouch = now(); st.nextIdleAct = st.lastTouch + 10 + Math.random() * 6;
    try { navigator.vibrate?.(kind === 'hug' ? [15, 40, 15] : 12); } catch {}
  }

  // ---- 시선 따라가기 + 만지기(제스처) ----
  const toSvg = e => { const m = svg.getScreenCTM(); if (!m) return null; const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()); return {x: pt.x, y: pt.y}; };
  const inEllipse = (p, cx, cy, rx, ry) => ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1;
  // 어디를 잡았나: 화면 점을 각 뼈의 쉬는 자세 좌표로 되돌려 검사합니다(몸이 휘어 있어도 정확).
  function hit(p) {
    if (!p) return null;
    const loc = b => { const [x, y] = ap(inv(st.W[b].M), p.x, p.y); return {x, y}; };
    const ARM = {armL: 69, armR: 171};
    const arm = b => { const a = loc(b); return inEllipse(a, ARM[b], 192, 18, 29) ? {where: 'arm', bone: b, ...a} : null; };
    // 그려진 순서의 역순(앞에 있는 것부터): 잡혀서 앞으로 나온 팔 → 머리 → 귀 → 팔 → 발 → 몸통
    const front = st.front && arm(st.front); if (front) return front;
    const h = loc('head');
    if (inEllipse(h, 120, 102, 77, 69)) return {where: 'head', bone: 'head', ...h};
    for (const b of ['earL', 'earR']) { const e = loc(b); if (inEllipse(e, b === 'earL' ? 62 : 178, 52, 26, 26)) return {where: 'ear', bone: b, ...e}; }
    for (const b of ['armL', 'armR']) { const a = arm(b); if (a) return a; }
    for (const [b, x] of [['legL', 100], ['legR', 140]]) { const l = loc(b); if (inEllipse(l, x, 232, 21, 17)) return {where: 'foot', bone: b, ...l}; }
    const s = loc('spine1');
    if (inEllipse(s, 120, 190, 62, 56)) { const bone = s.y < 186 ? 'spine2' : s.y < 214 ? 'spine1' : 'hip'; return {where: 'belly', bone, ...loc(bone)}; }
    return null;
  }
  // 잡은 팔은 머리보다 앞으로 꺼내 그립니다(손을 얼굴 쪽으로 끌어도 손이 얼굴 위에 보이도록).
  let frontTimer = 0;
  function bringFront(b) {
    clearTimeout(frontTimer);
    if (st.front && st.front !== b) svg.insertBefore(bones[st.front], bones.earL);
    st.front = b; if (b) svg.appendChild(bones[b]);
  }
  const onLook = e => {
    const r = svg.getBoundingClientRect(); if (!r.width) return;
    st.look.x = clamp((e.clientX - (r.left + r.width * .5)) / Math.max(260, r.width * 1.6));
    st.look.y = clamp((e.clientY - (r.top + r.height * .38)) / Math.max(260, r.height * 1.6));
    st.look.until = now() + 2.5;
  };
  const onDown = e => {
    const p = toSvg(e), h = hit(p); if (!h) return;
    st.gesture = {where: h.where, hit: h, last: p, rub: 0, x: e.clientX, y: e.clientY, at: performance.now(), moved: 0, petted: false, lastX: e.clientX, start: p};
    st.gesture.timer = setTimeout(() => { if (st.gesture && !st.gesture.petted && st.gesture.moved < 12) { st.gesture.held = true; interact('hug'); } }, 550);
  };
  const onMove = e => {
    onLook(e);
    const g = st.gesture; if (!g) return;
    const cur = toSvg(e); if (!cur) return;
    const dx = cur.x - g.last.x, dy = cur.y - g.last.y; g.last = cur;
    g.moved += Math.abs(dx) + Math.abs(dy); g.rub += Math.abs(dx);
    const off = {x: cur.x - g.start.x, y: cur.y - g.start.y}, dist = Math.hypot(off.x, off.y);
    // 머리: 포인터가 머리 위에 머문 채 옆으로 문지르면 쓰다듬기, 위아래로 당기거나 머리 밖으로 나가면 잡아끌기(쓰다듬다가도 전환)
    const onHead = (() => { const [x, y] = ap(inv(st.W.head.M), cur.x, cur.y); return inEllipse({x, y}, 120, 102, 77, 69); })();
    const wantDrag = g.where === 'head' ? Math.abs(off.y) > 14 || !onHead || dist > 70 : dist > 14;
    if (!g.dragging && wantDrag) {
      g.petted = false;
      g.dragging = true; clearTimeout(g.timer);
      Object.assign(st.drag, {active: true, peak: 0, bone: g.hit.bone, lx: g.hit.x, ly: g.hit.y, sol: {}, solS: 1});
      for (const b of IK_CHAIN[g.hit.bone]) st.drag.sol[b] = 0;
      st.rig.sBones = STRETCH[g.hit.bone] || [];
      if (g.hit.where === 'arm') bringFront(g.hit.bone);
      express('surprised', 30); say(pick(['으앗!', '어어?', '어디 가요?'])); st.lastTouch = now();
    }
    if (g.dragging) {
      st.drag.tx = cur.x; st.drag.ty = cur.y; st.drag.peak = Math.max(st.drag.peak, dist);
      st.lastTouch = now(); st.nextIdleAct = st.lastTouch + 10;
      return;
    }
    if (g.where === 'head' && onHead && g.rub > 40 && !g.petted) { g.petted = true; g.rub = 0; clearTimeout(g.timer); interact('pet', dx >= 0 ? 1 : -1); }
    if (g.petted && g.rub > 120) { g.rub = 0; play('pet', dx >= 0 ? 1 : -1); express('relieved', 1.6); st.lastTouch = now(); }
  };
  const onUp = () => {
    const g = st.gesture; st.gesture = null; if (!g) return;
    clearTimeout(g.timer);
    if (g.dragging) {  // 놓기: 스프링으로 돌아가며 출렁
      st.drag.active = false; st.rig.releasedAt = now();
      if (st.front) { const b = st.front; frontTimer = setTimeout(() => { svg.insertBefore(bones[b], bones.earL); if (st.front === b) st.front = null; }, 900); }
      const big = st.drag.peak > 110;
      express(big ? 'dizzy' : 'laugh', big ? 1.6 : 1); say(big ? '휴… 어지러워요' : pick(['헤헤, 제자리!', '놀랐잖아요~']));
      try { navigator.vibrate?.(14); } catch {}
      return;
    }
    if (g.petted || g.held || performance.now() - g.at > 500) return;
    const t = performance.now();
    st.taps = st.taps.filter(x => t - x < 2500); st.taps.push(t);
    if (st.taps.length >= 5) { st.taps = []; return interact('rapid'); }
    const prev = st.taps[st.taps.length - 2];
    if (prev && t - prev < 300) { clearTimeout(st.tapTimer); return interact('double'); }
    clearTimeout(st.tapTimer); st.tapTimer = setTimeout(() => interact(g.where), 220);
  };
  window.addEventListener('pointermove', onMove, {passive: true});
  window.addEventListener('pointerup', onUp, {passive: true});
  window.addEventListener('pointercancel', onUp, {passive: true});
  if (interactive) svg.addEventListener('pointerdown', e => { onLook(e); onDown(e); });
  svg.style.touchAction = interactive ? 'none' : '';

  // ---- 기본 자세 ----
  function pose(t) {
    const p = blank(), m = st.mood, breath = wave(t, 3.2);
    p.body.sy = 1 + .018 * breath; p.body.sx = 1 - .01 * breath;
    p.head.y = -1.6 * wave(t, 3.2, .08);
    p.armL.r = 2 * breath; p.armR.r = -2 * breath;
    if (m === 'happy') p.root.y -= 3 * Math.abs(Math.sin(Math.PI * t / .9));
    if (m === 'proud') { p.body.sy *= 1.02; p.head.r -= 3; p.armL.r += 18; p.armR.r -= 18; }
    if (m === 'waiting') { const tap = Math.max(0, wave(t, .7)); p.legR.r -= 9 * tap; p.legR.y -= 3 * tap; }
    if (m === 'worried') { p.head.y += 3; p.head.r += 3 * wave(t, 2.8); p.body.x += 1.5 * wave(t, 2.8); p.armL.r -= 26; p.armR.r += 26; }
    if (m === 'crying') {
      const sob = Math.pow(Math.max(0, wave(t, .9)), 2);
      p.head.y += 6; p.head.r -= 3; p.body.sy *= 1 + .025 * sob; p.root.x += .9 * wave(t, .14) * sob;
      p.armL.r -= 70 + 8 * sob; p.armR.r += 70 + 8 * Math.pow(Math.max(0, wave(t, .9, .5)), 2);
    }
    if (m === 'angry') { p.armL.r -= 55; p.armR.r += 55; p.body.sx *= 1.03; }
    if (m === 'sleepy') { p.head.y += 5; p.head.r += 6 * wave(t, 4); p.body.sy *= 1 + .012 * breath; }
    return p;
  }

  // ---- 얼굴 파라미터: 목표값으로 부드럽게 + 시선·깜빡임·말하기 ----
  function faceParams(t, dt) {
    if (st.expr && t > st.expr.until) st.expr = null;
    const ex = st.expr ? EXPR[st.expr.name] : null;
    const q = st.face, target = {...BASE, ...FACE[st.mood], ...(ex || {})}, k = dt ? 1 - Math.pow(.0015, dt) : 1;
    for (const key of Object.keys(BASE).concat(Object.keys(FACE.calm))) q[key] += ((target[key] ?? 0) - q[key]) * k;
    let gx, gy;
    if (ex && ex.lookX !== undefined) { gx = ex.lookX; gy = ex.lookY ?? 0; }
    else if (ex && ex.lookY !== undefined) { gx = 0; gy = ex.lookY; }
    else if (t < st.look.until && !['sleepy', 'crying'].includes(st.mood)) { gx = st.look.x; gy = st.look.y; }
    else if (st.mood === 'waiting') { gx = .7; gy = -.35; }
    else if (st.mood === 'crying' || st.mood === 'sleepy') { gx = 0; gy = .5; }
    else if (st.mood === 'angry') { gx = -.45; gy = .1; }
    else {
      if (t > st.look.nextIdle) { st.look.ix = Math.random() < .35 ? 0 : Math.random() * 1.4 - .7; st.look.iy = Math.random() * .6 - .3; st.look.nextIdle = t + 2.5 + Math.random() * 3.5; }
      gx = st.look.ix || 0; gy = st.look.iy || 0;
    }
    const ke = dt ? 1 - Math.pow(.00005, dt) : 1, kh = dt ? 1 - Math.pow(.004, dt) : 1;
    q.eyeBallX += (gx - q.eyeBallX) * ke; q.eyeBallY += (gy - q.eyeBallY) * ke;
    q.angleX += (gx * .75 - q.angleX) * kh; q.angleY += (gy * .6 - q.angleY) * kh;
    let blink = 1;
    if (t > st.blinkAt) {
      const s = (t - st.blinkAt) / .15;
      blink = s < 1 ? Math.abs(1 - 2 * s) : 1;
      if (s >= 1) { if (!st.blinkDouble && Math.random() < .25) { st.blinkDouble = true; st.blinkAt = t + .12; } else { st.blinkDouble = false; st.blinkAt = t + 2.2 + Math.random() * 3.8; } }
    }
    q.eyeOpenL = q.eyeOpen * blink * (1 - q.winkL); q.eyeOpenR = q.eyeOpen * blink;
    if (st.mood === 'angry' && !ex) q.eyeOpenR *= .9;
    q.talk = t < st.talkUntil ? Math.max(0, Math.sin(t * 17) * .5 + Math.sin(t * 9) * .25) : 0;
    return q;
  }

  // ---- 귀 물리(스프링) ----
  function earPhysics(p, W, dt) {
    const head = {y: W.head.py, r: W.head.a / DEG, x: W.head.px};
    const prev = st.prevHead || head; st.prevHead = head;
    if (!dt) return;
    const vy = (head.y - prev.y) / dt, vr = (head.r - prev.r) / dt, vx = (head.x - prev.x) / dt;
    for (const side of ['L', 'R']) {
      const e = st.ears[side], dir = side === 'L' ? 1 : -1;
      e.v += (-140 * e.a - 9 * e.v + (-.9 * vy * dir - .35 * vr - .5 * vx)) * dt;
      e.a = clamp(e.a + e.v * dt, -28, 28);
    }
    const m = st.mood, droop = m === 'crying' ? 18 : m === 'worried' ? 10 : m === 'angry' ? -10 : 0;
    p.earL.r += st.ears.L.a - droop; p.earR.r += st.ears.R.a + droop;
  }

  // body(동작 정의용) → 척추 세 뼈. 같은 배율을 세 뼈에 주면 hip 관절 기준으로 한 번 늘인 것과 같고, 머리·팔은 위치만 따라갑니다.
  function bodyToSpine(p) {
    p.hip.x += p.body.x; p.hip.y += p.body.y; p.hip.r += p.body.r;
    for (const b of SPINE) { p[b].sx *= p.body.sx; p[b].sy *= p.body.sy; }
  }

  // CCD IK: 사슬 끝(잡은 뼈)부터 뿌리 쪽으로, 각 관절을 '잡은 점 → 목표점' 방향으로 돌립니다. 반복 사이에 척추를 늘입니다.
  function solveIK(base, tx, ty) {
    const d = st.drag, chain = IK_CHAIN[d.bone], sBones = STRETCH[d.bone] || [], gain = CHAIN_GAIN[d.bone] || {};
    const L = {}; for (const b in base) L[b] = {...base[b]};
    const build = () => {
      for (const b of chain) L[b].r = base[b].r + d.sol[b];
      for (const b of sBones) L[b].k = d.solS;
      return solveWorld(L);
    };
    let W, e;
    for (let it = 0; it < 10; it++) {
      for (const b of chain) d.sol[b] *= 1 - (IK_REST[b] || 0);
      for (const b of chain) {
        W = build(); e = ap(W[d.bone].M, d.lx, d.ly);
        const px = W[b].px, py = W[b].py;
        if (Math.hypot(e[0] - px, e[1] - py) < 4) continue;
        let da = Math.atan2(ty - py, tx - px) - Math.atan2(e[1] - py, e[0] - px);
        da = Math.atan2(Math.sin(da), Math.cos(da)) / DEG * (gain[b] ?? IK_GAIN[b]) * (b === 'root' ? 1 : W.det);
        d.sol[b] = clamp(d.sol[b] + da, -IK_LIMIT[b], IK_LIMIT[b]);
      }
      W = build(); e = ap(W[d.bone].M, d.lx, d.ly);
      if (!sBones.length) continue;
      const b0 = W[sBones[0]], want = Math.hypot(tx - b0.px, ty - b0.py), have = Math.hypot(e[0] - b0.px, e[1] - b0.py);
      if (have > 1) d.solS = clamp(d.solS * (1 + (want / have - 1) * .7), .9, STRETCH_MAX);
    }
    W = build();
    return ap(W[d.bone].M, d.lx, d.ly);  // 관절로 갈 수 있는 데까지 간 잡은 점
  }

  const spring = (s, target, k, c, dt) => { s.v += (k * (target - s.a) - c * s.v) * dt; s.a += s.v * dt; };
  // 몸 윤곽점 중 가장 낮은 점이 바닥보다 얼마나 아래인지(+면 파고듦)
  function sink(b) {
    const c = Math.cos(b.th), sn = Math.sin(b.th);
    return Math.max(...HULL.map(([x, y]) => COM[1] + b.y + sn * (x - COM[0]) + c * (y - COM[1]))) - FLOOR;
  }
  // 몸 전체(강체) 물리 + 관절(IK·스프링) + 팔다리 진자
  function rig(p, t, dt) {
    const d = st.drag, g = st.rig, b = g.body;
    // 1) 강체 상태(무게중심 이동 x·y, 회전 th) → root 자세. 회전은 무게중심을 축으로 합니다.
    const cx = COM[0] + b.x, cy = COM[1] + b.y, c = Math.cos(b.th), sn = Math.sin(b.th);
    const place = (x, y) => [cx + c * (x - COM[0]) - sn * (y - COM[1]), cy + sn * (x - COM[0]) + c * (y - COM[1])];
    const [ox, oy] = place(...ROOT_PIVOT);
    p.root.x += ox - ROOT_PIVOT[0]; p.root.y += oy - ROOT_PIVOT[1]; p.root.r += b.th / DEG;

    // 2) 먼저 관절(IK)이 손가락을 따라가고, 관절로 닿지 않는 거리만 용수철 힘으로 몸에 전해집니다.
    //    (팔을 옆으로 움직이면 팔만 돌고, 팔이 다 뻗어도 모자라면 그때 몸이 끌려옴) 멀수록 세고, 최대 힘에서 멈춥니다.
    let F = [0, 0], r = [0, 0], e = null;
    if (d.active) {
      e = solveIK(p, d.tx, d.ty);
      r = [e[0] - cx, e[1] - cy];
      F = [(d.tx - e[0]) * PULL_K, (d.ty - e[1]) * PULL_K];
      const n = Math.hypot(F[0], F[1]), cap = FMAX(d.bone); if (n > cap) F = [F[0] * cap / n, F[1] * cap / n];
      F[0] -= PULL_C * (b.vx - b.w * r[1]); F[1] -= PULL_C * (b.vy + b.w * r[0]);  // 잡은 점 속도 감쇠
    }

    // 3) 강체 운동
    if (dt) {
      if (!b.air && -F[1] > WEIGHT) b.air = true;  // 위로 당기는 힘 > 몸무게 → 떠오름
      if (b.air) {
        b.vx += (F[0] / BODY_MASS - 3 * b.vx) * dt; b.vy += (F[1] / BODY_MASS + GRAVITY - 3 * b.vy) * dt;
        // 돌림힘 = 지렛대 × 당기는 힘 + (실제 무게중심이 기준점에서 벗어난 만큼) 중력 + 관절이 흔들린 반작용
        const tg = (wholeBody(st.W, [cx, cy]).c[0] - cx) * GRAVITY;
        b.w += (((r[0] * F[1] - r[1] * F[0]) / BODY_MASS + tg + g.reactBody) / INERTIA - 6 * b.w) * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.th += b.w * dt;
        const pen = sink(b);
        if (pen > 0 && b.vy < 0) b.y -= pen;  // 올라가는 중엔 바닥 밖으로만 밀어냄
        else if (pen >= 0) {  // 몸의 가장 낮은 점이 바닥에 닿음 → 착지
          b.y -= pen; b.vx *= .5;
          if (b.vy > 350) { play('land'); try { navigator.vibrate?.(10); } catch {} }
          if (b.vy > 600) b.vy *= -.18; else { b.vy = 0; b.air = false; }
        }
      } else {
        b.vy = 0;
        const N = Math.max(0, WEIGHT + F[1]);  // 바닥이 받치는 힘(위로 당기면 줄어듦)
        if (Math.abs(b.vx) < 4 && Math.abs(F[0]) <= FRICTION * N) b.vx = 0;  // 정지 마찰: 안 미끄러짐
        else {
          const v0 = b.vx; b.vx += (F[0] - Math.sign(b.vx || F[0]) * FRICTION * .8 * N) / BODY_MASS * dt;
          if (v0 && Math.sign(v0) !== Math.sign(b.vx) && Math.abs(F[0]) <= FRICTION * N) b.vx = 0;
        }
        b.x += b.vx * dt;
        // 놓은 지 1초가 지나면 아장아장 걸어서 제자리로(최대 70px/s)
        if (!d.active && !b.vx && Math.abs(b.x) > 1 && now() - (g.releasedAt ?? 0) > 1) {
          const step = Math.sign(b.x) * Math.min(Math.abs(b.x), 70 * dt); b.x -= step;
          p.root.r += 4 * Math.sin(t * 13); p.root.y -= 3 * Math.abs(Math.sin(t * 13));
        }
        b.th = Math.atan2(Math.sin(b.th), Math.cos(b.th));  // 바닥에서는 똑바로 서려는 복원
        b.w += (-70 * b.th - 11 * b.w) * dt; b.th += b.w * dt;  // 넘어졌으면 천천히 굴러 일어남
        b.y -= sink(b);  // 구르며 일어나는 동안에도 가장 낮은 점이 바닥에 붙어 있게
      }
      b.x = clamp(b.x, -150, 150); if (b.y < -230) { b.y = -230; b.vy = Math.max(0, b.vy); }
    }

    // 4) 관절: 잡힌 사슬은 IK 풀이를 스프링으로 따라가고, 나머지 관절은 질량비대로 움직입니다.
    //    매달린 질량에 걸리는 중력(몸이 기운 만큼) + 관절점이 가속할 때의 관성력 + 그 아래를 잡아당기는 힘 + 근육(K, C) + 자식 관절의 반작용
    if (dt) {
      const chain = d.active ? IK_CHAIN[d.bone] : [], react = {root: 0};
      for (const k of ['root', 'earL', 'earR']) { const held = chain.includes(k), [ks, cs] = held ? HOLD[k] : RELEASE[k]; spring(g.ang[k], held ? d.sol[k] : 0, ks, cs, dt); }
      spring(g.s, d.active ? d.solS : 1, d.active ? 700 : 240, d.active ? 48 : 5, dt);  // 귀: 놓으면 통통
      for (const j of [...JOINTS].reverse()) {  // 끝(팔·다리·머리)부터 몸쪽으로: 반작용을 부모에 넘기려고
        const q = g.ang[j], J = JOINT[j], v0 = q.v;
        if (chain.includes(j)) spring(q, d.sol[j], ...HOLD[j], dt);
        else if (j[0] === 'l' && !b.air) spring(q, 0, 400, 40, dt);  // 서 있으면 다리는 몸을 받침
        else {
          const {M, r} = distal(st.W, j), a = g.acc[j] || [0, 0];
          let phi = b.th; for (let k = j; k !== 'root'; k = SKELETON[k][0]) phi += g.ang[k].a * DEG;
          const rx0 = Math.cos(phi) * r[0] + Math.sin(phi) * r[1];  // 원래 자세(몸이 안 기울었을 때)의 r.x
          let tau = M * GRAVITY * (r[0] - rx0) - M * (r[0] * a[1] - r[1] * a[0]) + (react[j] || 0);
          // 잡힌 점이 이 관절 아래쪽에 있으면 당기는 힘도 돌림힘이 됩니다(손으로 들면 손이 몸무게를 받침).
          if (e && SUBTREE[j].includes(d.bone)) tau += ((e[0] - st.W[j].px) * F[1] - (e[1] - st.W[j].py) * F[0]) / BODY_MASS;
          const ang = q.a * DEG, w = q.v * DEG, alpha = (tau - J.K * ang - J.C * w) / J.I;
          q.v = (w + alpha * dt) / DEG; q.a = clamp(q.a + q.v * dt, -JLIM[j], JLIM[j]);
        }
        const parent = SKELETON[j][0];
        react[parent] = (react[parent] || 0) - J.I * (q.v - v0) * DEG / dt;
      }
      g.reactBody = b.air ? react.root : 0;
    }
    for (const k in g.ang) p[k].r += g.ang[k].a;
    for (const k of g.sBones) p[k].k = g.s.a;
    const lift = clamp(1 + b.y / 160, .45, 1); p.shadow.sx *= lift; p.shadow.sy *= lift; p.shadow.x += b.x;
  }
  // 관절점마다 가속도(다음 프레임 관성력에 씀)
  function trackAccel(W, dt) {
    const g = st.rig, pos = Object.fromEntries(JOINTS.map(j => [j, [W[j].px, W[j].py]]));
    if (g.prev && dt) {
      g.vel ||= {};
      for (const j of JOINTS) {
        const v = [(pos[j][0] - g.prev[j][0]) / dt, (pos[j][1] - g.prev[j][1]) / dt], v0 = g.vel[j] || v;
        g.vel[j] = v; g.acc[j] = [clamp((v[0] - v0[0]) / dt, -8000, 8000), clamp((v[1] - v0[1]) / dt, -8000, 8000)];
      }
    }
    g.prev = pos;
  }

  function render(t, dt) {
    const p = pose(t), q = faceParams(t, dt);
    st.clips = st.clips.filter(c => t - c.at < CLIPS[c.name].duration);
    for (const c of st.clips) CLIPS[c.name].apply(t - c.at, p, c.dir);
    const ax = q.angleX, ay = q.angleY;
    p.face.x += 7 * ax; p.face.y += 5 * ay;
    p.muzzle.x += 10 * ax; p.muzzle.y += 7 * ay; p.muzzle.sy *= 1 - .05 * Math.abs(ay);
    p.earL.x -= 4 * ax; p.earR.x -= 4 * ax; p.earL.y -= 3 * ay; p.earR.y -= 3 * ay;
    p.earR.sx *= 1 - .22 * Math.max(0, ax); p.earL.sx *= 1 - .22 * Math.max(0, -ax);
    p.head.r += 3 * ax;
    bodyToSpine(p);
    earPhysics(p, st.W, dt);
    rig(p, t, dt);
    const W = st.W = solveWorld(p);
    trackAccel(W, dt);
    for (const name in bones) bones[name].setAttribute('transform', `matrix(${W[name].M.map(v => v.toFixed(3)).join(' ')})`);
    sh.torso.setAttribute('d', smoothPath(skin(W, TORSO)));
    sh.belly.setAttribute('d', smoothPath(skin(W, BELLY)));
    for (const name of LOCAL) {
      const b = locals[name], v = p[name];
      b.el.setAttribute('transform', `translate(${f(v.x)} ${f(v.y)}) rotate(${f(v.r)} ${b.px} ${b.py}) translate(${b.px} ${b.py}) scale(${v.sx.toFixed(3)} ${v.sy.toFixed(3)}) translate(${-b.px} ${-b.py})`);
    }
    const smileL = q.winkL > .5 ? Math.max(q.eyeSmile, q.winkL) : q.eyeSmile;
    drawEye(sh, 'L', 82, 100, 9, q.eyeOpenL, smileL, q.eyeBallX, q.eyeBallY, q.heart, q.dizzy, t);
    drawEye(sh, 'R', 138, 100, 9, q.eyeOpenR, q.eyeSmile, q.eyeBallX, q.eyeBallY, q.heart, q.dizzy, t);
    drawBrows(sh, q);
    drawMouth(sh, clamp(q.mouthOpen + q.talk, 0, 1), q.mouthForm);
    part('cheeks').setAttribute('opacity', f(clamp(.75 * q.blush * (st.mood === 'sleepy' ? 0 : 1), 0, 1.4)));
  }

  // 한동안 만지지 않으면 혼자 노는 동작
  function idleAct(t) {
    const m = st.mood;
    const acts = m === 'sleepy' ? [['yawn', 'yawn', 2.2]] : m === 'crying' ? [['pet', 'relieved', .6]] : m === 'angry' ? [['stomp', 'pout', 1.2]]
      : m === 'waiting' ? [['wave', 'surprised', 1]] : [['wave', 'laugh', 1.2], ['yawn', 'yawn', 2.2], [null, 'wink', .8], ['hop', 'laugh', .9]];
    const [clip, face, secs] = pick(acts);
    if (clip) play(clip); express(face, secs);
    st.nextIdleAct = t + 9 + Math.random() * 7;
  }

  function frame(time) {
    if (!svg.isConnected) { stop(); return; }
    const t = (time - st.start) / 1000, dt = Math.min(.05, st.last ? t - st.last : 0); st.last = t;
    if (t > st.nextAuto) {
      if (st.mood === 'proud' && st.nextAuto) play('hop');
      if (st.mood === 'angry' && st.nextAuto) play('stomp');
      st.nextAuto = t + (st.mood === 'angry' ? 2.4 : 3.6);
    }
    if (interactive && t > st.nextIdleAct && !st.clips.length) idleAct(t);
    render(t, dt);
    st.raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(st.raf); clearTimeout(bubbleTimer); clearTimeout(st.tapTimer);
    window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
  }

  setMood(mood, rank);
  render(0, 0);
  if (!reducedMotion()) st.raf = requestAnimationFrame(frame);
  const controller = {setMood, play, express, talk, say, interact, destroy() { stop(); container.innerHTML = ''; }, get mood() { return st.mood; }};
  container.__bear = controller;
  return controller;
}
