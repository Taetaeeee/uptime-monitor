// 시각 계산 순수 함수 테스트 — 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCheckSlot, toIsoSeconds } from '../src/time.js';

// 모든 입력은 끝에 Z를 붙인 UTC로 만듭니다. (PC 시간대가 한국이어도 결과가 같아야 하기 때문)

test('초가 붙은 실행 시각은 5분 회차로 내림', () => {
  // 실제 배포에서 관측한 값
  assert.equal(toCheckSlot(new Date('2026-11-10T02:50:12Z')), '2026-11-10T02:50:00Z');
});

test('이미 회차 정각이면 그대로', () => {
  assert.equal(toCheckSlot(new Date('2026-11-10T02:55:00.000Z')), '2026-11-10T02:55:00Z');
});

test('다음 회차 직전(4분 59.999초 늦음)도 원래 회차로 묶임', () => {
  assert.equal(toCheckSlot(new Date('2026-11-10T02:54:59.999Z')), '2026-11-10T02:50:00Z');
});

test('자정 직전은 다음 날로 넘어가지 않음', () => {
  assert.equal(toCheckSlot(new Date('2026-11-10T23:59:59Z')), '2026-11-10T23:55:00Z');
});

test('결과 형식: 밀리초 없이 Z로 끝남', () => {
  const slot = toCheckSlot(new Date('2026-11-10T02:51:07.456Z'));
  assert.match(slot, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/);
});

test('toIsoSeconds는 내림 없이 밀리초만 버림 (로그용 실제 시각)', () => {
  assert.equal(toIsoSeconds(new Date('2026-11-10T02:50:12.345Z')), '2026-11-10T02:50:12Z');
});
