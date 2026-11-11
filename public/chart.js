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
 */
function lineChart(o) {
  const { w, h, l, r, t, b } = BOX;
  const iw = w - l - r;
  const ih = h - t - b;
  const values = o.points.map((p) => p.v).filter((v) => v !== null && v !== undefined);
  const yMax = o.yMax ?? niceMax(Math.max(...values, o.threshold?.v ?? 0, 1) * 1.1);
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

  // 기준선 (점선)
  if (o.threshold) {
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
