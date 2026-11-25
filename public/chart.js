// 서비스 상세 팝업 그래프 — SVG를 직접 그린다 (차트 라이브러리 없음: 빌드 도구 없는 HTML/CSS/JS 규칙)
//
// 원칙
//   - 기록이 없는 구간은 0으로 그리지 않고 선을 끊습니다. (0으로 그리면 "0ms로 빨라졌다"로 잘못 읽힘)
//   - 실패한 회차(응답이 없음)는 선 대신 아래쪽에 빨간 표시, '느림'은 노란 점으로 따로 보여 줍니다.
//   - 마우스를 올리면 <title>로 시각과 값을 보여 줍니다. (브라우저 기본 툴팁 — 키보드·터치에서도 안전)
// 공용 도우미(el, formatKst)는 common.js에 있습니다.

const SVG = 'http://www.w3.org/2000/svg';
const BOX = { w: 640, h: 190, l: 46, r: 14, t: 12, b: 26 }; // 그림 크기와 여백 (viewBox 기준)

function svgEl(tag, attrs = {}, title) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (title) {
    const t = document.createElementNS(SVG, 'title');
    t.textContent = title;
    node.append(t);
  }
  return node;
}

/** 축 최댓값을 보기 좋은 숫자로 올림 (예: 437 → 500, 1830 → 2000) */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

const kstTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
const kstDate = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' });

/**
 * 시간 축 선 그래프
 * @param {object} o
 * @param {Array<{t:number, v:number|null, fail?:boolean, slow?:boolean, maint?:boolean, tip:string}>} o.points  시간순
 * @param {number} o.xMin, o.xMax   x축 범위(ms)
 * @param {number} o.gapMs          이보다 벌어진 점끼리는 선을 잇지 않음 (기록 빠짐)
 * @param {string} o.unit           y축 단위 (ms, %, 일)
 * @param {{v:number, label:string}} [o.threshold]  기준선 (느림 기준, 디스크 90% 등)
 * @param {number} [o.yMax]         고정 최댓값 (디스크 % = 100)
 * @param {'time'|'date'} [o.xFormat]
 * @param {string} o.label          화면 낭독기용 설명
 * @param {{w?:number,h?:number,l?:number}} [o.box]  그림 크기 (기본 640×190)
 */
function lineChart(o) {
  // o.box로 그림 크기를 바꿀 수 있음: 작은 칸에서는 작은 viewBox로 그려야 글자가 너무 작아지지 않음
  const { w, h, l, r, t, b } = { ...BOX, ...(o.box ?? {}) };
  const iw = w - l - r;
  const ih = h - t - b;
  const values = o.points.map((p) => p.v).filter((v) => v !== null && v !== undefined);
  const dataMax = Math.max(...values, 1);
  // 기준선이 실제 값보다 훨씬 위(2배 초과)면 축에 넣지 않음: 넣으면 축이 커져서 실제 값의 변화가 바닥에 깔려 안 보임
  // (예: 느림 기준 3000ms인데 실제 300~600ms). 그때는 선 대신 위쪽에 글자로만 알려 줍니다.
  const thresholdInAxis = Boolean(o.threshold) && (o.yMax !== undefined || o.threshold.v <= dataMax * 2);
  const yMax = o.yMax ?? niceMax(Math.max(dataMax, thresholdInAxis ? o.threshold.v : 0) * 1.15);
  const x = (ms) => l + ((ms - o.xMin) / Math.max(1, o.xMax - o.xMin)) * iw;
  const y = (v) => t + ih - (Math.min(v, yMax) / yMax) * ih;

  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img', 'aria-label': o.label });

  // 계획 작업 구간 (파란 띠)
  for (const p of o.points.filter((q) => q.maint)) {
    svg.append(svgEl('rect', { x: x(p.t) - 3, y: t, width: 6, height: ih, class: 'chart__maint' }, `${p.tip} · 계획 작업 중`));
  }

  // 눈금선과 y축 숫자 (0, 1/4, 1/2, 3/4, 최댓값)
  for (let i = 0; i <= 4; i += 1) {
    const v = (yMax * i) / 4;
    svg.append(svgEl('line', { x1: l, x2: w - r, y1: y(v), y2: y(v), class: 'chart__grid' }));
    const label = svgEl('text', { x: l - 6, y: y(v) + 4, class: 'chart__axis', 'text-anchor': 'end' });
    label.textContent = `${Math.round(v * 10) / 10}${i === 4 ? o.unit : ''}`;
    svg.append(label);
  }

  // x축 시각 (5칸)
  for (let i = 0; i <= 4; i += 1) {
    const ms = o.xMin + ((o.xMax - o.xMin) * i) / 4;
    const label = svgEl('text', { x: x(ms), y: h - 6, class: 'chart__axis', 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' });
    label.textContent = (o.xFormat === 'date' ? kstDate : kstTime).format(new Date(ms));
    svg.append(label);
  }

  // 축 밖 기준선 안내
  if (o.threshold && !thresholdInAxis) {
    const note = svgEl('text', { x: l + 6, y: t + 12, class: 'chart__threshold-label' });
    note.textContent = `${o.threshold.label} (현재 값보다 훨씬 높아 그래프 위쪽 밖)`;
    svg.append(note);
  }

  // 기준선 (점선)
  if (o.threshold && thresholdInAxis) {
    const ty = y(o.threshold.v);
    svg.append(svgEl('line', { x1: l, x2: w - r, y1: ty, y2: ty, class: 'chart__threshold' }));
    // 이름은 왼쪽 끝에 (최근 값이 모이는 오른쪽 끝에 두면 선과 겹침)
    const label = svgEl('text', { x: l + 6, y: ty - 4, class: 'chart__threshold-label', 'text-anchor': 'start' });
    label.textContent = o.threshold.label;
    svg.append(label);
  }

  // 선과 면: 값이 있고 간격이 gapMs 이내인 점끼리만 이어서 '구간'을 만듦
  const segments = [];
  let cur = [];
  for (const p of o.points) {
    const ok = p.v !== null && p.v !== undefined;
    const prev = cur[cur.length - 1];
    if (ok && prev && p.t - prev.t <= o.gapMs) cur.push(p);
    else {
      if (cur.length) segments.push(cur);
      cur = ok ? [p] : [];
    }
  }
  if (cur.length) segments.push(cur);
  for (const seg of segments) {
    const line = seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    if (seg.length > 1) {
      const area = `${line} L${x(seg[seg.length - 1].t).toFixed(1)},${t + ih} L${x(seg[0].t).toFixed(1)},${t + ih} Z`;
      svg.append(svgEl('path', { d: area, class: 'chart__area' }));
    }
    svg.append(svgEl('path', { d: line, class: 'chart__line' }));
    if (seg.length === 1) svg.append(svgEl('circle', { cx: x(seg[0].t), cy: y(seg[0].v), r: 2.5, class: 'chart__dot' }));
  }

  // 실패(아래쪽 빨간 막대)·느림(노란 점)·마우스 올리면 보이는 값(투명 원)
  for (const p of o.points) {
    const hasValue = p.v !== null && p.v !== undefined;
    if (p.fail && !hasValue) {
      // 응답 자체가 없는 실패(시간 초과 등): 값이 없으니 아래쪽에 빨간 막대로 표시
      svg.append(svgEl('rect', { x: x(p.t) - 2, y: t + ih - 14, width: 4, height: 14, rx: 1, class: 'chart__fail' }, p.tip));
      continue;
    }
    if (!hasValue) continue;
    // 값이 있는 실패(디스크 92% 등): 선은 그대로 잇고 그 점만 빨간 점
    if (p.fail) svg.append(svgEl('circle', { cx: x(p.t), cy: y(p.v), r: 3.5, class: 'chart__fail' }));
    else if (p.slow) svg.append(svgEl('circle', { cx: x(p.t), cy: y(p.v), r: 3.5, class: 'chart__slow' }));
    svg.append(svgEl('circle', { cx: x(p.t), cy: y(p.v), r: 7, class: 'chart__hit' }, p.tip));
  }
  return svg;
}

/**
 * 실행/중지 띠 (Windows 서비스처럼 '값'이 없는 점검) — 회차마다 초록/빨강 칸
 */
function statusStrip({ points, xMin, xMax, label }) {
  const { w, l, r } = BOX;
  const h = 56;
  const iw = w - l - r;
  const x = (ms) => l + ((ms - xMin) / Math.max(1, xMax - xMin)) * iw;
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart chart--strip', role: 'img', 'aria-label': label });
  svg.append(svgEl('rect', { x: l, y: 8, width: iw, height: 22, rx: 4, class: 'chart__strip-bg' }));
  const slot = Math.max(3, (5 * 60 * 1000 / Math.max(1, xMax - xMin)) * iw);
  for (const p of points) {
    svg.append(svgEl('rect', { x: x(p.t) - slot / 2, y: 8, width: slot, height: 22, class: p.fail ? 'chart__fail' : p.maint ? 'chart__maint' : 'chart__ok' }, p.tip));
  }
  for (let i = 0; i <= 4; i += 1) {
    const ms = xMin + ((xMax - xMin) * i) / 4;
    const label = svgEl('text', { x: x(ms), y: h - 6, class: 'chart__axis', 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' });
    label.textContent = kstTime.format(new Date(ms));
    svg.append(label);
  }
  return svg;
}

// ─────────────────────────────────────────────
// 대시보드용 작은 그래프 (S2)
// ─────────────────────────────────────────────

/**
 * 날짜 축 여러 줄 선 그래프 (점검·서비스마다 한 줄).
 * 색은 CSS 클래스 chart__series--1~4가 정합니다 (밝은/어두운 화면에서 다르게 하려고 SVG에 색을 박지 않음).
 * 값이 없는 날(null)은 0으로 그리지 않고 선을 끊습니다.
 * @param {object} o
 * @param {Array<{name:string, points:Array<{day:string, v:number|null}>}>} o.series
 * @param {string} o.unit     y축 단위
 * @param {number} [o.yMin]   y축 최솟값 (기본 0). 가동률처럼 위쪽에 몰린 값은 95 등으로 올려서 차이를 보이게
 * @param {number} [o.yMax]   y축 최댓값 (없으면 값에 맞춰 올림)
 * @param {string} o.label    화면 낭독기용 설명
 * @param {string[]} [o.classes] 줄마다 색 클래스 (없으면 chart__series--1~4)
 * @param {{w?:number,h?:number,l?:number}} [o.box]
 */
function multiLineChart(o) {
  const { w, h, l, r, t, b } = { ...BOX, h: 150, ...(o.box ?? {}) };
  const iw = w - l - r;
  const ih = h - t - b;
  const days = o.series[0]?.points.map((p) => p.day) ?? [];
  const values = o.series.flatMap((s) => s.points.map((p) => p.v)).filter((v) => v !== null && v !== undefined);
  const yMin = o.yMin ?? 0;
  const yMax = o.yMax ?? niceMax(Math.max(...values, 1) * 1.15);
  const x = (i) => l + (days.length > 1 ? (i / (days.length - 1)) * iw : iw / 2);
  // yMin보다 낮은 값은 바닥에 붙입니다 (축을 넘어 그림 밖으로 나가지 않게)
  const y = (v) => t + ih - ((Math.min(Math.max(v, yMin), yMax) - yMin) / Math.max(1e-9, yMax - yMin)) * ih;

  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img', 'aria-label': o.label });
  // 눈금선은 바닥·가운데·위 3개만 (작은 칸에서 덜 복잡하게)
  for (let i = 0; i <= 2; i += 1) {
    const v = yMin + ((yMax - yMin) * i) / 2;
    svg.append(svgEl('line', { x1: l, x2: w - r, y1: y(v), y2: y(v), class: `chart__grid${i ? ' chart__grid--dash' : ''}` }));
    const label = svgEl('text', { x: l - 6, y: y(v) + 4, class: 'chart__axis', 'text-anchor': 'end' });
    label.textContent = `${Math.round(v * 10) / 10}${o.unit}`;
    svg.append(label);
  }
  if (days.length) {
    for (const [i, anchor] of [[0, 'start'], [days.length - 1, 'end']]) {
      const label = svgEl('text', { x: x(i), y: h - 6, class: 'chart__axis', 'text-anchor': anchor });
      label.textContent = days[i].slice(5).replace('-', '/');
      svg.append(label);
    }
  }

  o.series.forEach((s, k) => {
    // o.classes로 줄마다 색 클래스를 정할 수 있음 (예: HTTP는 파랑·보라, DNS는 청록·주황 — 시안과 같은 색 짝)
    const cls = o.classes?.[k] ?? `chart__series--${(k % 4) + 1}`;
    let d = '';
    let open = false;
    s.points.forEach((p, i) => {
      if (p.v === null || p.v === undefined) { open = false; return; }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)} `;
      open = true;
    });
    if (d) svg.append(svgEl('path', { d: d.trim(), class: `chart__mline ${cls}` }));
    s.points.forEach((p, i) => {
      if (p.v === null || p.v === undefined) return;
      svg.append(svgEl('circle', { cx: x(i), cy: y(p.v), r: 2.2, class: `chart__mdot ${cls}` }));
      svg.append(svgEl('circle', { cx: x(i), cy: y(p.v), r: 6, class: 'chart__hit' }, `${p.day} · ${s.name} ${p.v}${o.unit}`));
    });
  });
  return svg;
}

/**
 * 날짜별 개수 막대 (최근 장애 수). 0인 날은 막대를 그리지 않습니다.
 * @param {object} o
 * @param {string[]} o.days
 * @param {number[]} o.values
 * @param {string} o.label
 */
function dayBarChart(o) {
  const { w, h, l, r, t, b } = { ...BOX, h: 110, ...(o.box ?? {}) };
  const iw = w - l - r;
  const ih = h - t - b;
  const max = Math.max(2, ...o.values);
  const bw = iw / Math.max(1, o.values.length);
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img', 'aria-label': o.label });
  for (const v of [0, max]) {
    const yy = t + ih - (v / max) * ih;
    svg.append(svgEl('line', { x1: l, x2: w - r, y1: yy, y2: yy, class: 'chart__grid' }));
    const label = svgEl('text', { x: l - 6, y: yy + 4, class: 'chart__axis', 'text-anchor': 'end' });
    label.textContent = String(v);
    svg.append(label);
  }
  o.values.forEach((v, i) => {
    const tip = `${o.days[i]} · 장애 ${v}건`;
    if (v > 0) {
      const bh = (v / max) * ih;
      svg.append(svgEl('rect', { x: l + i * bw + 1, y: t + ih - bh, width: Math.max(2, bw - 2), height: bh, rx: 1, class: 'chart__fail' }, tip));
    } else {
      svg.append(svgEl('rect', { x: l + i * bw, y: t, width: bw, height: ih, class: 'chart__hitbar' }, tip));
    }
  });
  if (o.days.length) {
    for (const [i, anchor, xx] of [[0, 'start', l], [o.days.length - 1, 'end', w - r]]) {
      const label = svgEl('text', { x: xx, y: h - 6, class: 'chart__axis', 'text-anchor': anchor });
      label.textContent = o.days[i].slice(5).replace('-', '/');
      svg.append(label);
    }
  }
  return svg;
}

// ─────────────────────────────────────────────
// 서비스가 10개가 넘어도 읽히는 운영 지표 (서비스별 고유색 · 순위 막대 · 서비스별 미니 그래프)
// 색은 dashboard.css의 --sc-1 ~ --sc-10 (어두운/밝은 화면 각각)이 정하고, 여기서는 번호만 클래스로 붙입니다.
// ─────────────────────────────────────────────

/** 서비스 고유색 클래스: { n: 3, dashed: false } → 'sc-3' (10개를 넘어 색을 다시 쓰면 ' sc-dash'로 점선). 색 정보가 없으면 회색 'sc-0' */
function colorClass(c) {
  return c ? `sc-${c.n}${c.dashed ? ' sc-dash' : ''}` : 'sc-0';
}

/**
 * 작은 선 그래프 (운영 지표 숫자 타일용, 22단계): 축·눈금 글자 없이 선만. 좁은 타일(약 190px)에는 축 글자가 들어갈 자리가 없어서.
 * 정확한 값은 점에 마우스를 올리면 보이고(title), 자세한 그래프는 칸을 눌러 팝업에서 봅니다.
 *   - 세로 범위: yMin·yMax를 주지 않으면 0부터 최댓값보다 조금 위까지. 값 범위에 딱 맞추면(자동 확대)
 *     20ms → 24ms 같은 작은 흔들림도 큰 오르내림처럼 보여서, 응답 시간은 0을 바닥으로 둡니다.
 *   - 값이 없는 날(null)은 선을 끊습니다. 마지막 점은 조금 크게 (지금 값이 어디쯤인지).
 * @param {object} o
 * @param {Array<{name:string, cls?:string, points:Array<{day:string, v:number|null}>}>} o.series  cls: 색 클래스 (없으면 기본 파랑)
 * @param {string} o.unit
 * @param {string} o.label  화면 낭독기용 설명
 * @param {number} [o.yMin]
 * @param {number} [o.yMax]
 */
function sparkLine(o) {
  const w = 200, h = 46, pad = 4;
  const values = o.series.flatMap((s) => s.points.map((p) => p.v)).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const lo = o.yMin ?? 0;
  const hi = o.yMax ?? Math.max(...values, 1) * 1.15;
  const n = o.series[0]?.points.length ?? 0;
  const x = (i) => pad + (n > 1 ? (i / (n - 1)) * (w - pad * 2) : (w - pad * 2) / 2);
  const y = (v) => h - pad - ((Math.min(Math.max(v, lo), hi) - lo) / Math.max(1e-9, hi - lo)) * (h - pad * 2);
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: 'spark', role: 'img', 'aria-label': o.label });
  for (const s of o.series) {
    const cls = s.cls ?? '';
    let d = '';
    let open = false;
    let last = -1;
    s.points.forEach((p, i) => {
      if (typeof p.v !== 'number') { open = false; return; }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)} `;
      open = true;
      last = i;
    });
    if (d) svg.append(svgEl('path', { d: d.trim(), class: `spark__line ${cls}` }));
    if (last >= 0) svg.append(svgEl('circle', { cx: x(last), cy: y(s.points[last].v), r: 2.6, class: `spark__dot ${cls}` }));
    s.points.forEach((p, i) => {
      if (typeof p.v !== 'number') return;
      svg.append(svgEl('circle', { cx: x(i), cy: y(p.v), r: 5, class: 'chart__hit' }, `${p.day} · ${s.name} ${p.v}${o.unit}`));
    });
  }
  return svg;
}

/**
 * 작은 막대 (운영 지표 '최근 장애 수' 타일용): 축 글자 없이 날짜별 막대만. 0인 날은 그리지 않고 바닥선만.
 * 막대 높이는 그 구간에서 가장 많은 날 기준 (최소 2건 높이 — 1건이 칸을 꽉 채워 커 보이지 않게).
 * @param {{days:string[], values:number[], label:string}} o
 */
function sparkBars(o) {
  const w = 200, h = 46, pad = 4;
  const n = o.days.length;
  const max = Math.max(2, ...o.values);
  const slot = (w - pad * 2) / Math.max(1, n);
  const bw = Math.max(2, Math.min(10, slot * 0.6));
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: 'spark', role: 'img', 'aria-label': o.label });
  svg.append(svgEl('line', { x1: pad, x2: w - pad, y1: h - pad, y2: h - pad, class: 'spark__base' }));
  o.values.forEach((v, i) => {
    if (!v) return;
    const bh = (v / max) * (h - pad * 2);
    svg.append(svgEl('rect', { x: pad + slot * i + (slot - bw) / 2, y: h - pad - bh, width: bw, height: bh, rx: 1.5, class: 'spark__bar' }, `${o.days[i]} · ${v}건`));
  });
  return svg;
}

/**
 * 가로 막대 순위: 한 줄 = 서비스(점검) 하나. 이름이 막대 바로 옆에 붙어서 범례가 필요 없습니다.
 * 색만으로 구별하지 않게 값도 글자로 함께 적습니다 (색을 못 보는 사람·화면 낭독기도 읽을 수 있게).
 * @param {object} o
 * @param {Array<{name:string, value:number|null, color?:{n:number,dashed:boolean}}>} o.rows  위에서부터 그릴 순서
 * @param {number} o.max     막대 100%에 해당하는 값 (전체 중 최댓값 — 작은 칸과 팝업에서 같은 비율로 보이게)
 * @param {string} o.unit    값 뒤에 붙일 단위 (ms)
 */
function barRank(o) {
  const list = el('ol', 'brank');
  for (const r of o.rows) {
    const li = el('li', 'brank__row');
    const name = el('span', 'brank__name', r.name);
    name.title = r.name; // 이름이 길어 잘렸을 때 전체를 볼 수 있게
    const track = el('span', 'brank__track');
    track.setAttribute('aria-hidden', 'true'); // 값은 글자로 읽히므로 막대는 장식
    const fill = el('i', `brank__fill ${colorClass(r.color)}`);
    const has = r.value !== null && r.value !== undefined && o.max > 0;
    fill.style.width = has ? `${Math.max(3, Math.round((r.value / o.max) * 100))}%` : '0';
    track.append(fill);
    li.append(name, track, el('b', 'brank__val', has ? `${r.value.toLocaleString('ko-KR')}${o.unit}` : '기록 없음'));
    list.append(li);
  }
  return list;
}

/** 줄 자료의 가장 최근 값 (null 건너뜀) */
function seriesLastValue(points) {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const v = points[i].v;
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/**
 * 서비스별 미니 그래프 격자: 서비스마다 자기 칸·자기 색. 줄 10개가 겹치지 않아서 하나하나 읽을 수 있습니다.
 * 세로축은 칸마다 따로 잡습니다(응답 시간) — 서비스끼리 값 크기가 달라도 각자의 변화가 보이게.
 * 가동률처럼 같은 눈금으로 비교해야 하면 yMin·yMax를 넘기면 모든 칸이 같은 눈금을 씁니다.
 * @param {object} o
 * @param {Array<{name:string, key?:string, points:Array<{day:string, v:number|null}>}>} o.series
 * @param {(s:object)=>({n:number,dashed:boolean}|undefined)} o.colorOf
 * @param {string} o.unit, o.label
 * @param {number} [o.yMin], [o.yMax]
 */
function seriesGrid(o) {
  const grid = el('div', 'sgrid');
  for (const s of o.series) {
    const color = o.colorOf(s);
    const cell = el('div', 'sgrid__cell');
    const head = el('div', 'sgrid__head');
    head.append(el('i', `sgrid__dot ${colorClass(color)}`), el('span', 'sgrid__name', s.name));
    head.querySelector('.sgrid__name').title = s.name;
    const latest = seriesLastValue(s.points);
    head.append(el('b', 'sgrid__val', latest === null ? '기록 없음' : `${latest.toLocaleString('ko-KR')}${o.unit}`));
    cell.append(
      head,
      multiLineChart({
        series: [s], classes: [colorClass(color)], unit: o.unit, yMin: o.yMin, yMax: o.yMax,
        label: `${s.name} ${o.label}`, box: { w: 300, h: 110, l: 40 },
      })
    );
    grid.append(cell);
  }
  return grid;
}

/**
 * 겹쳐 보기: 한 그래프에 줄을 모두 그리고, 범례 버튼으로 줄을 켜고 끕니다 (눌린 상태는 aria-pressed).
 * 꺼진 서비스 목록(hidden: Set<number>)은 호출한 쪽이 들고 있어서, 60초마다 다시 그려도 고른 상태가 유지됩니다.
 * @param {object} o  seriesGrid의 o에 더해: hidden(Set), box
 */
function seriesOverlay(o) {
  const wrap = el('div', 'soverlay');
  const chartBox = el('div');
  const legend = el('div', 'mlegend mlegend--btn');
  const draw = () => {
    const shown = o.series.map((s, i) => ({ s, i })).filter(({ i }) => !o.hidden.has(i));
    chartBox.replaceChildren(
      shown.length
        ? multiLineChart({
            series: shown.map((x) => x.s), classes: shown.map((x) => colorClass(o.colorOf(x.s))), unit: o.unit,
            yMin: o.yMin, yMax: o.yMax, label: o.label, box: o.box,
          })
        : el('p', 'sd-empty', '아래에서 보고 싶은 서비스를 눌러 주세요.')
    );
  };
  o.series.forEach((s, i) => {
    const btn = el('button', 'mleg-btn');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(!o.hidden.has(i)));
    btn.append(el('i', colorClass(o.colorOf(s))), document.createTextNode(s.name));
    btn.addEventListener('click', () => {
      if (o.hidden.has(i)) o.hidden.delete(i);
      else o.hidden.add(i);
      btn.setAttribute('aria-pressed', String(!o.hidden.has(i)));
      draw();
    });
    legend.append(btn);
  });
  draw();
  wrap.append(chartBox, legend);
  return wrap;
}

/**
 * 탭 묶음: [{ label, build() }] — 고른 탭만 그립니다. 고른 탭 번호는 호출한 쪽이 기억합니다(onPick).
 * 60초마다 팝업을 다시 그려도 보던 탭으로 돌아오게 하려는 것입니다.
 */
function metricTabs(panels, selected = 0, onPick = () => {}) {
  const wrap = el('div', 'mtabs');
  const bar = el('div', 'mtabs__bar');
  bar.setAttribute('role', 'tablist');
  const body = el('div', 'mtabs__body');
  const buttons = panels.map((p, i) => {
    const b = el('button', 'mtab', p.label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => show(i));
    bar.append(b);
    return b;
  });
  function show(i) {
    buttons.forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
    body.replaceChildren(panels[i].build());
    onPick(i);
  }
  show(Math.min(selected, panels.length - 1));
  wrap.append(bar, body);
  return wrap;
}
