// 곰곰이 브라우저 OCR: PaddleOCR PP-OCRv5(글자 영역 검출 mobile + 한국어 인식 mobile)를 onnxruntime-web으로 실행합니다.
// 사진은 기기 밖으로 나가지 않습니다. 처리 순서와 측정 근거는 README의 'OCR 엔진'을 참고하세요.
//
// 입력: 사진 File/Blob
// 출력: {text, lines: [{text, score}], orientation, engine: 'paddle'}
//   text는 표의 같은 행에 있는 칸들을 왼쪽부터 이어 붙인 줄 목록입니다. 예: '펠루비정 1.00 3 4'

const ORT_VERSION = '1.30.0';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const MODEL_BASE = new URL('../assets/models/ocr/', import.meta.url).href;
const WORK_MAX_SIDE = 2400;  // 큰 휴대폰 사진은 이 크기로 줄여서 다룹니다.
const DET = {maxSide: 1600, thresh: 0.3, boxThresh: 0.5, unclipRatio: 1.6, minSize: 3, maxCandidates: 1000};
const REC = {height: 48, minWidth: 320, maxWidth: 1600, minScore: 0.5};
// 줄 방향 판별기(textline orientation)는 쓰지 않습니다. 실제 약봉투 사진에서 약 이름 세 줄을 거꾸로 판단해 뒤집어 읽었기 때문입니다.
// 대신 사진 전체 방향을 0/90/180/270° 중에서 인식 점수로 고릅니다.
const GOOD_ENOUGH = 0.85;

let loading = null;

async function load(onProgress) {
  if (!loading) loading = (async () => {
    onProgress?.('OCR 모델을 준비하고 있어요… (처음 한 번 약 20MB를 내려받아요)');
    const ort = await import(`${ORT_BASE}ort.wasm.min.mjs`);
    ort.env.wasm.wasmPaths = ORT_BASE;
    const options = {executionProviders: ['wasm'], graphOptimizationLevel: 'all'};
    const [det, rec, dict] = await Promise.all([
      ort.InferenceSession.create(`${MODEL_BASE}ch_PP-OCRv5_det_mobile.onnx`, options),
      ort.InferenceSession.create(`${MODEL_BASE}korean_PP-OCRv5_rec_mobile.onnx`, options),
      fetch(`${MODEL_BASE}korean_PP-OCRv5_dict.txt`).then(r => { if (!r.ok) throw new Error('글자 목록을 불러오지 못했어요.'); return r.text(); })
    ]);
    // 인식 모델 출력 = [빈칸(blank), 글자 목록…, 공백]
    const chars = ['', ...dict.split('\n').filter((c, i, all) => !(i === all.length - 1 && c === '')), ' '];
    return {ort, det, rec, chars};
  })().catch(error => { loading = null; throw error; });
  return loading;
}

// ---- 이미지 준비 ----
// 사진 보정: 짧은 변이 1200px보다 작으면 2배로 키우고, CLAHE(8×8 구역별 대비 균일화, 클립 2.0)를 적용합니다.
// 망가뜨린 실제 약봉투 사진 8가지 조건에서 앱 결과 192칸 중 정답이 162 → 178로 늘었습니다(README 'OCR 엔진').
function enhance(bitmap) {
  const longSide = Math.max(bitmap.width, bitmap.height), shortSide = Math.min(bitmap.width, bitmap.height);
  const scale = Math.min(shortSide < 1200 ? 2 : 1, WORK_MAX_SIDE / longSide);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext('2d', {willReadFrequently: true}); g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const image = g.getImageData(0, 0, canvas.width, canvas.height);
  clahe(image.data, canvas.width, canvas.height);
  g.putImageData(image, 0, 0);
  return canvas;
}

function clahe(d, W, H, tiles = 8, clip = 2.0) {
  const L = new Uint8Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) L[p] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  const tw = Math.ceil(W / tiles), th = Math.ceil(H / tiles), maps = [];
  for (let ty = 0; ty < tiles; ty++) for (let tx = 0; tx < tiles; tx++) {
    const hist = new Float64Array(256); let n = 0;
    for (let y = ty * th; y < Math.min(H, (ty + 1) * th); y++) for (let x = tx * tw; x < Math.min(W, (tx + 1) * tw); x++) { hist[L[y * W + x]]++; n++; }
    const limit = clip * n / 256; let excess = 0;
    for (let v = 0; v < 256; v++) if (hist[v] > limit) { excess += hist[v] - limit; hist[v] = limit; }
    const map = new Uint8Array(256); let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v] + excess / 256; map[v] = Math.min(255, Math.round(acc / Math.max(n, 1) * 255)); }
    maps.push(map);
  }
  for (let y = 0; y < H; y++) {
    const fy = Math.min(Math.max((y - th / 2) / th, 0), tiles - 1), y0 = Math.floor(fy), y1 = Math.min(y0 + 1, tiles - 1), ay = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(Math.max((x - tw / 2) / tw, 0), tiles - 1), x0 = Math.floor(fx), x1 = Math.min(x0 + 1, tiles - 1), ax = fx - x0;
      const p = y * W + x, v = L[p];
      const nv = (1 - ay) * ((1 - ax) * maps[y0 * tiles + x0][v] + ax * maps[y0 * tiles + x1][v]) + ay * ((1 - ax) * maps[y1 * tiles + x0][v] + ax * maps[y1 * tiles + x1][v]);
      const r = v > 0 ? nv / v : 1, i = p * 4;
      d[i] = Math.min(255, d[i] * r); d[i + 1] = Math.min(255, d[i + 1] * r); d[i + 2] = Math.min(255, d[i + 2] * r);
    }
  }
}

function orientedCanvas(bitmap, degrees) {
  const scale = Math.min(1, WORK_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const swap = degrees % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? h : w; canvas.height = swap ? w : h;
  const g = canvas.getContext('2d');
  g.translate(canvas.width / 2, canvas.height / 2);
  g.rotate(degrees * Math.PI / 180);
  g.drawImage(bitmap, -w / 2, -h / 2, w, h);
  return canvas;
}

// RGBA 픽셀 → [1, 3, H, W] BGR, (v/255 - 0.5) / 0.5. PaddleOCR은 OpenCV(BGR)로 학습했습니다.
function toTensor(ort, imageData, width, height, padWidth = width) {
  const {data} = imageData;
  const out = new Float32Array(3 * height * padWidth);
  const plane = height * padWidth;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4, o = y * padWidth + x;
    out[o] = data[p + 2] / 127.5 - 1;
    out[plane + o] = data[p + 1] / 127.5 - 1;
    out[2 * plane + o] = data[p] / 127.5 - 1;
  }
  return new ort.Tensor('float32', out, [1, 3, height, padWidth]);
}

// ---- 1단계: 글자 영역 검출 (DBNet 후처리) ----
async function detect(model, canvas) {
  const ratio = Math.min(1, DET.maxSide / Math.max(canvas.width, canvas.height));
  const W = Math.max(32, Math.round(canvas.width * ratio / 32) * 32), H = Math.max(32, Math.round(canvas.height * ratio / 32) * 32);
  const small = document.createElement('canvas'); small.width = W; small.height = H;
  const g = small.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(canvas, 0, 0, W, H);
  const input = toTensor(model.ort, g.getImageData(0, 0, W, H), W, H);
  const output = await model.det.run({[model.det.inputNames[0]]: input});
  const prob = output[model.det.outputNames[0]].data;  // [1, 1, H, W]

  // 확률 > 0.3 → 2×2 팽창
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (prob[i] > DET.thresh || (x > 0 && prob[i - 1] > DET.thresh) || (y > 0 && prob[i - W] > DET.thresh) || (x > 0 && y > 0 && prob[i - W - 1] > DET.thresh)) mask[i] = 1;
  }
  // 8방향 연결 요소 → 경계 픽셀 → 최소 회전 사각형
  const seen = new Uint8Array(W * H), boxes = [], stack = [];
  for (let start = 0; start < W * H && boxes.length < DET.maxCandidates; start++) {
    if (!mask[start] || seen[start]) continue;
    const edge = [];
    seen[start] = 1; stack.push(start);
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i - x) / W;
      let border = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { border = true; continue; }
        const j = ny * W + nx;
        if (!mask[j]) { border = true; continue; }
        if (!seen[j]) { seen[j] = 1; stack.push(j); }
      }
      if (border) edge.push([x, y]);
    }
    const rect = minAreaRect(convexHull(edge));
    if (!rect || Math.min(rect.w, rect.h) < DET.minSize) continue;
    const score = meanInside(prob, W, H, rect);
    if (score < DET.boxThresh) continue;
    const d = rect.w * rect.h * DET.unclipRatio / (2 * (rect.w + rect.h));  // 다각형 확장 거리(pyclipper unclip과 같은 식)
    const grown = {...rect, w: rect.w + 2 * d, h: rect.h + 2 * d};
    if (Math.min(grown.w, grown.h) < DET.minSize + 2) continue;
    const sx = canvas.width / W, sy = canvas.height / H;
    boxes.push({cx: grown.cx * sx, cy: grown.cy * sy, w: grown.w * sx, h: grown.h * sy, angle: grown.angle, score});
  }
  // 글자 방향 정리. 사각형의 가로에 가까운 변을 글자 방향으로 보고,
  // 세로가 가로의 1.5배 이상일 때만 세로 줄로 봅니다(PaddleOCR과 같은 기준). '3' 같은 한 글자 칸은 가로 줄입니다.
  return boxes.map(b => {
    let {w, h, angle} = b;
    angle = Math.atan2(Math.sin(angle), Math.cos(angle));
    if (Math.abs(Math.sin(angle)) > Math.SQRT1_2) { [w, h] = [h, w]; angle += Math.PI / 2; }  // w가 가로에 가까운 변
    if (angle > Math.PI / 2) angle -= Math.PI; else if (angle <= -Math.PI / 2) angle += Math.PI;
    if (Math.abs(angle) > Math.PI / 4) angle += angle > 0 ? -Math.PI / 2 : Math.PI / 2;
    return {cx: b.cx, cy: b.cy, len: w, thick: h, angle, horizontal: h < 1.5 * w, score: b.score};
  });
}

function convexHull(points) {
  if (points.length < 3) return points;
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// 회전 캘리퍼스: 볼록 껍질의 각 변 방향마다 감싸는 사각형 넓이를 재서 가장 작은 것
function minAreaRect(hull) {
  if (!hull.length) return null;
  if (hull.length < 3) {
    const xs = hull.map(p => p[0]), ys = hull.map(p => p[1]);
    return {cx: (Math.min(...xs) + Math.max(...xs)) / 2 + 0.5, cy: (Math.min(...ys) + Math.max(...ys)) / 2 + 0.5, w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1, angle: 0};
  }
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i], [x2, y2] = hull[(i + 1) % hull.length];
    const angle = Math.atan2(y2 - y1, x2 - x1), c = Math.cos(angle), s = Math.sin(angle);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, y] of hull) { const u = x * c + y * s, v = -x * s + y * c; minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      const u = (minU + maxU) / 2, v = (minV + maxV) / 2;
      // 픽셀 중심 좌표 → 픽셀 영역을 덮도록 1px 보정
      best = {area, cx: u * c - v * s + 0.5, cy: u * s + v * c + 0.5, w: maxU - minU + 1, h: maxV - minV + 1, angle};
    }
  }
  return best;
}

function meanInside(prob, W, H, r) {
  const c = Math.cos(r.angle), s = Math.sin(r.angle), hw = r.w / 2, hh = r.h / 2;
  const ext = Math.abs(hw * c) + Math.abs(hh * s), eyt = Math.abs(hw * s) + Math.abs(hh * c);
  let sum = 0, n = 0;
  for (let y = Math.max(0, Math.floor(r.cy - eyt)); y <= Math.min(H - 1, Math.ceil(r.cy + eyt)); y++)
    for (let x = Math.max(0, Math.floor(r.cx - ext)); x <= Math.min(W - 1, Math.ceil(r.cx + ext)); x++) {
      const dx = x + 0.5 - r.cx, dy = y + 0.5 - r.cy;
      if (Math.abs(dx * c + dy * s) <= hw && Math.abs(-dx * s + dy * c) <= hh) { sum += prob[y * W + x]; n++; }
    }
  return n ? sum / n : 0;
}

// ---- 2단계: 줄마다 글자 인식 (CTC) ----
async function recognize(model, canvas, box) {
  const targetW = Math.min(REC.maxWidth, Math.max(1, Math.ceil(REC.height * box.len / box.thick)));
  const padW = Math.max(REC.minWidth, targetW);
  const crop = document.createElement('canvas'); crop.width = targetW; crop.height = REC.height;
  const g = crop.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.scale(targetW / box.len, REC.height / box.thick);
  g.translate(box.len / 2, box.thick / 2);
  g.rotate(-box.angle);
  g.drawImage(canvas, -box.cx, -box.cy);
  const input = toTensor(model.ort, g.getImageData(0, 0, targetW, REC.height), targetW, REC.height, padW);
  const output = await model.rec.run({[model.rec.inputNames[0]]: input});
  const t = output[model.rec.outputNames[0]], [, steps, classes] = t.dims, p = t.data;
  let text = '', sum = 0, count = 0, prev = -1;
  for (let i = 0; i < steps; i++) {
    let best = 0, bestP = -1;
    for (let k = 0; k < classes; k++) { const v = p[i * classes + k]; if (v > bestP) { bestP = v; best = k; } }
    if (best !== 0 && best !== prev) { text += model.chars[best] ?? ''; sum += bestP; count++; }
    prev = best;
  }
  return {text: text.trim(), score: count ? sum / count : 0};
}

// 같은 행에 있는 칸들을 한 줄로 (표의 행 복원).
// 사진이 기울면 오른쪽 칸의 높이가 어긋나므로, 글자 줄들의 중간 기울기에 수직인 방향의 위치로 행을 나눕니다.
function joinRows(items) {
  const angles = items.filter(it => it.text.length >= 4).map(it => it.angle).sort((a, b) => a - b);
  const tilt = angles.length ? angles[Math.floor(angles.length / 2)] : 0;
  const c = Math.cos(tilt), s = Math.sin(tilt);
  const placed = items.map(it => ({...it, v: -it.cx * s + it.cy * c, u: it.cx * c + it.cy * s}));
  const rows = [];
  for (const it of placed.sort((a, b) => a.v - b.v)) {
    const row = rows.find(r => Math.abs(r.v - it.v) < 0.5 * Math.min(r.thick, it.thick));
    if (row) { row.items.push(it); row.v = (row.v * (row.items.length - 1) + it.v) / row.items.length; }
    else rows.push({v: it.v, thick: it.thick, items: [it]});
  }
  return rows.sort((a, b) => a.v - b.v).map(r => {
    const cells = r.items.sort((a, b) => a.u - b.u);
    const chars = cells.reduce((n, c) => n + c.text.length, 0);
    return {text: cells.map(c => c.text).join(' '), score: cells.reduce((s, c) => s + c.score * c.text.length, 0) / Math.max(chars, 1)};
  });
}

async function readOrientation(model, bitmap, degrees, boxes, onProgress) {
  const canvas = orientedCanvas(bitmap, degrees);
  boxes ??= await detect(model, canvas);
  const horizontal = boxes.filter(b => b.horizontal);
  const items = [];
  for (const [i, box] of horizontal.entries()) {
    if (i % 5 === 0) onProgress?.(`사진에서 글자를 읽는 중… ${Math.round(i / horizontal.length * 100)}%`);
    const r = await recognize(model, canvas, box);
    if (r.text && r.score >= REC.minScore) items.push({...r, cx: box.cx, cy: box.cy, thick: box.thick, angle: box.angle});
  }
  const chars = items.reduce((n, it) => n + it.text.length, 0);
  const quality = items.reduce((s, it) => s + it.score * it.text.length, 0) / Math.max(chars, 1);
  return {degrees, items, quality, hangul: items.reduce((n, it) => n + (it.text.match(/[가-힣]/g) || []).length, 0)};
}

export async function recognizeImage(file, onProgress) {
  const model = await load(onProgress);
  const photo = await createImageBitmap(file, {imageOrientation: 'from-image'});
  onProgress?.('사진을 보정하는 중…');
  const bitmap = enhance(photo);
  photo.close?.();
  try {
    onProgress?.('글자 영역을 찾는 중…');
    const upright = orientedCanvas(bitmap, 0);
    const boxes0 = await detect(model, upright);
    // 세로로 긴 영역이 더 길게 많으면 사진이 옆으로 누운 것: 270°/90°부터, 아니면 0°/180°부터 시도합니다.
    // 짧은 숫자 칸보다 긴 글자 줄이 방향을 잘 나타내므로, 개수 대신 긴 변 길이의 합으로 비교합니다.
    const extent = list => list.reduce((n, b) => n + Math.max(b.len, b.thick), 0);
    const vertical = extent(boxes0.filter(b => !b.horizontal)) > extent(boxes0.filter(b => b.horizontal));
    const order = vertical ? [270, 90] : [0, 180];
    const tries = [];
    for (const degrees of order) {
      const result = await readOrientation(model, bitmap, degrees, degrees === 0 ? boxes0 : null, onProgress);
      tries.push(result);
      if (result.quality >= GOOD_ENOUGH && result.hangul >= 4) break;
      onProgress?.('사진 방향을 바꿔 다시 읽는 중…');
    }
    const best = tries.reduce((a, b) => (b.hangul * b.quality > a.hangul * a.quality ? b : a));
    const lines = joinRows(best.items);
    return {text: lines.map(l => l.text).join('\n'), lines, orientation: best.degrees, quality: best.quality, engine: 'paddle'};
  } finally { bitmap.width = bitmap.height = 0; }
}
