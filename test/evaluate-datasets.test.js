// 판정 규칙 평가(scripts/evaluate-rules/datasets.mjs)의 원본 파서 테스트
// (원래 test/prepare-datasets.test.js에 있던 것 중 평가가 쓰는 함수의 테스트만 옮김)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  quantile, parseSmdRows, parseLabelLines, parseInterpretation, segmentsOf, parseNabCsv, parseNabWindows, labelByWindows,
} from '../scripts/evaluate-rules/datasets.mjs';

test('parseSmdRows: 숫자 표를 읽고, 열 개수가 다르거나 숫자가 아니면 거부', () => {
  assert.deepEqual(parseSmdRows('0.1,0.2\n0.3,0.4\n'), [[0.1, 0.2], [0.3, 0.4]]);
  assert.throws(() => parseSmdRows('0.1,0.2\n0.3\n'), TypeError);
  assert.throws(() => parseSmdRows('0.1,abc\n'), TypeError);
});

test('parseLabelLines / parseInterpretation / segmentsOf', () => {
  assert.deepEqual(parseLabelLines('0\n1\n1\n0\n1\n'), [0, 1, 1, 0, 1]);
  assert.throws(() => parseLabelLines('0\n2\n'), TypeError);
  assert.deepEqual(parseInterpretation('15849-16368:1,9,10\n16963-17517:2\n'), [
    { start: 15849, end: 16368, dims: [1, 9, 10] },
    { start: 16963, end: 17517, dims: [2] },
  ]);
  assert.throws(() => parseInterpretation('abc\n'), TypeError);
  assert.deepEqual(segmentsOf([0, 1, 1, 0, 0, 1, 0, 1]), [[1, 2], [5, 5], [7, 7]]);
  assert.deepEqual(segmentsOf([0, 0]), []);
});

test('quantile', () => {
  assert.equal(quantile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4], 1), 4);
  assert.throws(() => quantile([], 0.5), RangeError);
});

test('parseNabCsv / parseNabWindows / labelByWindows', () => {
  const pts = parseNabCsv('timestamp,value\n2013-12-10 06:00:00,70.5\n2013-12-10 06:05:00,71\n2013-12-10 06:10:00,3\n2013-12-10 06:15:00,72\n');
  assert.equal(pts.length, 4);
  assert.deepEqual(pts[0], { ts: '2013-12-10 06:00:00', value: 70.5 });
  assert.throws(() => parseNabCsv('time,val\n'), TypeError);
  assert.throws(() => parseNabCsv('timestamp,value\nbad,1\n'), TypeError);

  const w = parseNabWindows({ 'a.csv': [['2013-12-10 06:05:00.000000', '2013-12-10 06:10:00.000000']] }, 'a.csv');
  assert.deepEqual(w, [['2013-12-10 06:05:00', '2013-12-10 06:10:00']]);
  assert.throws(() => parseNabWindows({}, 'a.csv'), RangeError);

  const lab = labelByWindows(pts, w);
  assert.deepEqual(lab.map((p) => p.anomaly), [0, 1, 1, 0]); // 창 양 끝 포함
});
