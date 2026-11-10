// 도메인 만료 판정 테스트 — 내 도메인이 없으므로 가짜 날짜로 판정 로직만 검증 (CLAUDE.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeDomainExpiry, DOMAIN_FAILURE, DOMAIN_DEFAULT_THRESHOLD_DAYS } from '../src/judge.js';

const NOW = new Date('2026-11-10T00:00:00Z');
const after = (days, hours = 0) => new Date(NOW.getTime() + (days * 24 + hours) * 3600_000).toISOString();

test('기본 기준은 30일', () => {
  assert.equal(DOMAIN_DEFAULT_THRESHOLD_DAYS, 30);
});

test('여유 있음: 41일 남음 → 성공', () => {
  assert.deepEqual(judgeDomainExpiry(after(41), NOW), { isSuccess: true, isSlow: false, failureReason: null, daysLeft: 41 });
});

test('경계: 정확히 30일 남음은 성공, 29일 23시간은 만료 임박', () => {
  assert.equal(judgeDomainExpiry(after(30), NOW).isSuccess, true);
  const r = judgeDomainExpiry(after(29, 23), NOW);
  assert.equal(r.failureReason, DOMAIN_FAILURE.EXPIRING);
  assert.equal(r.daysLeft, 29); // 남은 '완전한' 날 수 (내림)
});

test('하루가 안 남음 → 0일, 만료 임박', () => {
  const r = judgeDomainExpiry(after(0, 5), NOW);
  assert.deepEqual([r.daysLeft, r.failureReason], [0, DOMAIN_FAILURE.EXPIRING]);
});

test('만료 시각이 지났거나 바로 지금 → 만료', () => {
  assert.equal(judgeDomainExpiry(after(0), NOW).failureReason, DOMAIN_FAILURE.EXPIRED);
  const r = judgeDomainExpiry(after(-3), NOW);
  assert.deepEqual([r.daysLeft, r.failureReason, r.isSlow], [-3, DOMAIN_FAILURE.EXPIRED, false]);
});

test('기준을 바꿀 수 있음 (예: 60일 전부터 경고)', () => {
  assert.equal(judgeDomainExpiry(after(41), NOW, 60).failureReason, DOMAIN_FAILURE.EXPIRING);
});
