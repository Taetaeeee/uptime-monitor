// 글자 대비 테스트 (30단계) — KWCAG 2.2(WCAG 2.1 AA와 거의 같음) 본문 글자 기준 4.5:1
//
// 왜 필요한가: 대비 문제는 화면 파일 하나하나가 아니라 색 토큰 몇 개(--faint, 버튼 파랑, 밝은 화면 상태색)에서 나왔습니다.
// 그래서 CSS 파일에서 토큰 값을 직접 읽어 "글자로 쓰는 토큰 × 그 글자가 놓이는 배경"을 모두 계산합니다.
// 나중에 색을 바꾸다 기준 아래로 떨어지면 여기서 잡힙니다. 브라우저 없이 계산만 함 (실제 화면 확인은 impeccable detect로 따로)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

/** 선택자 블록 하나의 CSS 변수 { '--faint': '#7b8ba1', ... } (선택자는 줄 시작에서 정확히 찾음) */
function tokens(src, selector) {
  const start = src.indexOf(`${selector} {`);
  assert.ok(start >= 0, `선택자 없음: ${selector}`);
  const body = src.slice(start, src.indexOf('\n}', start));
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

// ── 색 계산 (WCAG 2.x 상대 휘도·대비 공식) ──
function parse(c) {
  if (c.startsWith('#')) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).concat(1);
  const m = c.match(/rgba?\(([^)]+)\)/);
  assert.ok(m, `색이 아님: ${c}`);
  const [r, g, b, a = '1'] = m[1].split(',').map((s) => s.trim());
  return [Number(r), Number(g), Number(b), Number(a)];
}
/** 반투명 색을 아래 색 위에 겹친 결과 (화면에 실제로 보이는 색) */
function over(top, under) {
  const [r, g, b, a] = parse(top);
  const [R, G, B] = parse(under);
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${hex(r * a + R * (1 - a))}${hex(g * a + G * (1 - a))}${hex(b * a + B * (1 - a))}`;
}
function luminance(c) {
  const [r, g, b] = parse(c).map((v, i) => {
    if (i === 3) return v;
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** 글자 토큰마다 모든 배경에서 4.5:1 이상인지 — 못 미치는 조합을 모두 모아서 한 번에 보여 줌 */
function expectReadable(label, text, backgrounds) {
  const fails = [];
  for (const [tName, tColor] of Object.entries(text)) {
    for (const [bName, bColor] of Object.entries(backgrounds)) {
      const r = contrast(tColor, bColor);
      if (r < 4.5) fails.push(`${tName} ${tColor} on ${bName} ${bColor} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(fails, [], `${label}: 4.5:1 미만`);
}

test('계산 확인: 흰색·검정 21:1, 같은 색 1:1, 반투명 겹치기', () => {
  assert.equal(contrast('#ffffff', '#000000').toFixed(1), '21.0');
  assert.equal(contrast('#64748b', '#64748b'), 1);
  assert.equal(over('rgba(255, 255, 255, 0.5)', '#000000'), '#808080');
  assert.equal(contrast('#64748b', '#15213a').toFixed(1), '3.4'); // 30단계 전 값 — 라이브 점검에서 잰 값과 같음
});

test('공용 화면(style.css) 어두운: 글자색이 바탕·패널·카드·칸 위에서 4.5:1 이상', () => {
  const t = tokens(css('style.css'), ':root');
  const bg = t['--bg'];
  const card = over(t['--surface-2'], bg);
  const backgrounds = {
    bg,
    panel: over('rgba(255, 255, 255, 0.03)', bg), // --surface = --ov-03
    card,
    cell: over(t['--surface-3'], card), // 카드 안의 작은 칸
    'surface-card': over(t['--surface-card'], bg),
    modal: t['--modal-bg'],
    input: over(t['--input-bg'], bg),
  };
  const text = Object.fromEntries(['--text', '--muted', '--faint', '--good', '--warn', '--bad', '--info', '--idle'].map((k) => [k, t[k]]));
  expectReadable('style.css 어두운', text, backgrounds);
});

test('공용 화면(style.css) 밝은: 글자색과 상태색이 바탕·카드·연한 상태 배경 위에서 4.5:1 이상', () => {
  const t = tokens(css('style.css'), ':root[data-theme="light"]');
  const white = t['--surface'];
  const backgrounds = { bg: t['--bg'], card: white, cell: t['--surface-3'] };
  const text = Object.fromEntries(['--text', '--muted', '--faint', '--good', '--warn', '--bad', '--info'].map((k) => [k, t[k]]));
  expectReadable('style.css 밝은', text, backgrounds);
  // 상태 알약: 상태색 글자가 자기 연한 배경 위에
  for (const s of ['good', 'warn', 'bad', 'info', 'idle']) { // idle = '점검 대기' 알약
    expectReadable(`style.css 밝은 ${s} 알약`, { [`--${s}`]: t[`--${s}`] }, { [`--${s}-bg on card`]: over(t[`--${s}-bg`], white), [`--${s}-bg on bg`]: over(t[`--${s}-bg`], t['--bg']) });
  }
});

for (const [theme, selector] of [['어두운', '.dash'], ['밝은', ':root[data-theme="light"] .dash']]) {
  test(`대시보드(dashboard.css) ${theme}: 글자색이 바탕·메뉴·패널·연한 상태 배경 위에서 4.5:1 이상, 파란 버튼 위 흰 글자도`, () => {
    const src = css('dashboard.css');
    const t = { ...tokens(src, '.dash'), ...(theme === '밝은' ? tokens(src, selector) : {}) };
    const backgrounds = { 'd-bg': t['--d-bg'], 'd-side': t['--d-side'], 'd-panel': t['--d-panel'], 'd-panel2': t['--d-panel2'] };
    const text = Object.fromEntries(
      ['--d-text', '--d-muted', '--d-faint', '--d-good-text', '--d-warn-text', '--d-bad-text', '--d-info-text'].map((k) => [k, t[k]])
    );
    expectReadable(`dashboard.css ${theme}`, text, backgrounds);
    // 상태 알약: 글자용 상태색이 연한 상태 배경(패널 위에 겹친 색) 위에
    for (const s of ['good', 'warn', 'bad']) {
      expectReadable(`dashboard.css ${theme} ${s} 알약`, { [`--d-${s}-text`]: t[`--d-${s}-text`] }, { [`--d-${s}-soft`]: over(t[`--d-${s}-soft`], t['--d-panel']) });
    }
    // 흰 글자를 얹는 파란 버튼 (칩 '전체', 추가, 본문으로 건너뛰기)
    expectReadable(`dashboard.css ${theme} 파란 버튼`, { white: '#ffffff' }, { 'd-blue-fill': t['--d-blue-fill'] });
  });
}

test('흰 글자 버튼은 --d-blue가 아니라 --d-blue-fill을 배경으로 쓴다', () => {
  const src = css('dashboard.css');
  for (const sel of ['.skip {', '.pilltab {', '.btn2--primary {']) {
    const line = src.slice(src.indexOf(sel), src.indexOf('}', src.indexOf(sel)));
    assert.match(line, /background: var\(--d-blue-fill\)/, sel);
  }
});
