import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import { reserveRun, settleRun, expireRuns } from '../src/rca-store.js';
import { createCallBudget, HARD_LIMITS, readRcaConfig } from '../rca/lib/budget.js';
const config = { reserveMicros: 100, dailyMicros: 150, concurrency: 1, limits: HARD_LIMITS };
const reserve = (db, id, key = id) => reserveRun(db, { id, key, now: 1000, day: 'day', config });
test('키·모델·가격·예산이 없으면 준비 완료가 아니다', () => {
  const c = readRcaConfig({}); assert.equal(c.ready, false); assert.ok(c.missing.includes('OPENAI_API_KEY'));
});
test('중복 요청·동시 실행이 이중 예약하지 않는다', async () => {
  const db = createFakeD1();
  assert.equal((await reserve(db, 'a', 'key')).accepted, true);
  assert.equal((await reserve(db, 'b', 'key')).duplicate, true);
  assert.equal((await reserve(db, 'c')).accepted, false);
  assert.equal((await db.prepare('SELECT * FROM rca_budget').first()).reserved_micros, 100);
  await settleRun(db, 'a', { run_status: 'completed' }, { usage_uncertain: false, spent_micros: 40 });
  await settleRun(db, 'a', { run_status: 'completed' }, { usage_uncertain: false, spent_micros: 40 });
  assert.deepEqual({ ...(await db.prepare('SELECT * FROM rca_budget').first()) }, { day: 'day', reserved_micros: 0, spent_micros: 40, active: 0 });
  assert.equal((await reserve(db, 'c')).accepted, true);
});
test('불확정 사용량과 중단 실행은 예약 전액을 보수적으로 유지한다', async () => {
  const db = createFakeD1(); await reserve(db, 'a');
  await expireRuns(db, 999999);
  const b = await db.prepare('SELECT * FROM rca_budget').first();
  assert.equal(b.active, 0); assert.equal(b.spent_micros, 100);
  assert.equal((await reserve(db, 'b')).accepted, false);
});
test('호출 전 입력 상한·회수 한도·재시도 없음', () => {
  const b = createCallBudget({ limits: { ...HARD_LIMITS, steps: 1 }, prices: { input: 1, output: 2 } });
  assert.throws(() => b.beforeCall(HARD_LIMITS.inputBytes + 1), /model_budget_limit/);
  b.beforeCall(100); assert.equal(b.snapshot().usage_uncertain, true);
  b.recordUsage({ input_tokens: 100, output_tokens: 10 });
  assert.equal(b.snapshot().usage_uncertain, false);
  assert.throws(() => b.beforeCall(100), /model_budget_limit/);
});
test('동시에 몰린 요청 중 하나만 원자적으로 예약한다', async () => {
  const db = createFakeD1();
  const results = await Promise.all(Array.from({ length: 10 }, (_, n) => reserve(db, `r${n}`)));
  assert.equal(results.filter(r => r.accepted).length, 1);
  assert.equal((await db.prepare('SELECT active FROM rca_budget').first()).active, 1);
});
test('UTC 날짜가 바뀌어도 전날 실행과 전역 동시성 한도를 공유한다', async () => {
  const db = createFakeD1(); await reserve(db, 'old');
  const r = await reserveRun(db, { id: 'new', key: 'new', now: 1001, day: 'next-day', config });
  assert.equal(r.accepted, false);
});
