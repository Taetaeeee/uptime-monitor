// 장애 이력·계획 작업 순수 함수 테스트 (B-5) — 실행: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toUtcIso,
  validateMaintenance,
  isInMaintenance,
  validateIncidentReport,
  incidentMetrics,
  MAX_REPORT_FIELD_LENGTH,
} from '../src/incident.js';
import { maintenanceState } from '../src/record.js';

const NOW = new Date('2026-11-10T05:00:00Z');

test('시간대가 붙은 시각만 UTC로 바꾸고, 시간대 없는 값은 거부', () => {
  assert.equal(toUtcIso('2026-11-12T22:00:00+09:00'), '2026-11-12T13:00:00Z');
  assert.equal(toUtcIso('2026-11-12T13:00Z'), '2026-11-12T13:00:00Z');
  assert.equal(toUtcIso('2026-11-12T22:00:00'), null); // 한국 시간인지 UTC인지 모호
  assert.equal(toUtcIso('내일 밤 10시'), null);
});

test('계획 작업 검증: 정상 입력', () => {
  const v = validateMaintenance(
    { monitor_id: 3, title: ' 그룹웨어 패치 ', starts_at: '2026-11-12T22:00:00+09:00', ends_at: '2026-11-12T23:30:00+09:00' },
    NOW
  );
  assert.deepEqual(v, {
    ok: true,
    value: { monitorId: 3, title: '그룹웨어 패치', startsAt: '2026-11-12T13:00:00Z', endsAt: '2026-11-12T14:30:00Z' },
  });
  // monitor_id가 없으면 모든 대상(null)
  assert.equal(validateMaintenance({ title: '전체 점검', starts_at: '2026-11-11T00:00:00Z', ends_at: '2026-11-11T01:00:00Z' }, NOW).value.monitorId, null);
});

test('계획 작업 검증: 거부 사례', () => {
  const base = { title: 't', starts_at: '2026-11-11T00:00:00Z', ends_at: '2026-11-11T01:00:00Z' };
  const cases = [
    [{ ...base, monitor_id: 'abc' }, 'invalid_monitor_id'],
    [{ ...base, title: '' }, 'invalid_title'],
    [{ ...base, starts_at: '2026-11-11T00:00:00' }, 'invalid_time'],
    [{ ...base, ends_at: '2026-11-10T23:00:00Z' }, 'ends_before_starts'],
    [{ ...base, ends_at: '2026-11-12T00:00:01Z' }, 'too_long'],            // 24시간 초과
    [{ ...base, starts_at: '2026-11-09T00:00:00Z', ends_at: '2026-11-09T01:00:00Z' }, 'ends_in_past'],
    [{ ...base, starts_at: '2028-01-01T00:00:00Z', ends_at: '2028-01-01T01:00:00Z' }, 'too_far_ahead'],
  ];
  for (const [body, error] of cases) assert.deepEqual(validateMaintenance(body, NOW), { ok: false, error }, error);
});

test('작업 시간 판단: 대상별·전체, 끝 시각은 포함하지 않음', () => {
  const windows = [
    { monitorId: 2, startsAt: '2026-11-10T05:00:00Z', endsAt: '2026-11-10T06:00:00Z' },
    { monitorId: null, startsAt: '2026-11-11T00:00:00Z', endsAt: '2026-11-11T01:00:00Z' },
  ];
  assert.equal(isInMaintenance(windows, 2, '2026-11-10T05:00:00Z'), true);  // 시작 시각 포함
  assert.equal(isInMaintenance(windows, 2, '2026-11-10T06:00:00Z'), false); // 끝 시각 미포함
  assert.equal(isInMaintenance(windows, 3, '2026-11-10T05:30:00Z'), false); // 다른 대상
  assert.equal(isInMaintenance(windows, 99, '2026-11-11T00:30:00Z'), true); // 전체 작업
});

test('보고서 검증: 보낸 항목만, null은 비우기, 모르는 항목·너무 긴 값은 거부', () => {
  assert.deepEqual(validateIncidentReport({ summary: ' 요약 ', prevention: null }), {
    ok: true,
    value: { report_summary: '요약', report_prevention: null },
  });
  assert.equal(validateIncidentReport({}).error, 'empty_report');
  assert.equal(validateIncidentReport({ sumary: 'x' }).error, 'unknown_field:sumary'); // 오타
  assert.equal(validateIncidentReport({ impact: 'x'.repeat(MAX_REPORT_FIELD_LENGTH + 1) }).error, 'invalid_field:impact');
  assert.equal(validateIncidentReport({ action: 3 }).error, 'invalid_field:action');
});

test('장애 지표: 지속 시간은 첫 실패부터, 감지 시간은 첫 실패 → 판정', () => {
  const done = { startedAt: '2026-11-10T03:00:00Z', detectedAt: '2026-11-10T03:05:00Z', resolvedAt: '2026-11-10T04:05:00Z' };
  assert.deepEqual(incidentMetrics(done, NOW), { ongoing: false, durationMinutes: 65, detectMinutes: 5 });
  const ongoing = { ...done, resolvedAt: null };
  assert.deepEqual(incidentMetrics(ongoing, NOW), { ongoing: true, durationMinutes: 120, detectMinutes: 5 });
});

test('작업 중 상태: 상태는 유지, 연속 횟수·실패 시작은 비움', () => {
  const prev = { state: 'down', consecutiveFailures: 4, consecutiveSuccesses: 0, failingSince: 'x', changedAt: 'c' };
  assert.deepEqual(maintenanceState(prev, 'T'), {
    state: 'down', consecutiveFailures: 0, consecutiveSuccesses: 0, failingSince: null, changedAt: 'c', lastCheckedAt: 'T',
  });
});
