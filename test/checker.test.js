// 관측 함수 테스트 — 진짜 인터넷 대신 가짜 fetch를 넣어서 확인합니다.
// 왜? 테스트가 네트워크 상태에 따라 성공·실패가 바뀌면 믿을 수 없는 테스트가 되기 때문.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observe } from '../src/checker.js';

const monitor = { url: 'https://example.invalid/' };

test('응답이 오면 상태 코드·본문·응답 시간을 기록한다', async () => {
  let t = 1000;
  const fakeFetch = async () => {
    t += 250; // 응답에 250ms 걸린 것처럼
    return new Response('hello 고쳐라', { status: 200 });
  };
  const obs = await observe(monitor, { fetchFn: fakeFetch, now: () => t });

  assert.equal(obs.timedOut, false);
  assert.equal(obs.networkError, false);
  assert.equal(obs.statusCode, 200);
  assert.equal(obs.body, 'hello 고쳐라');
  assert.equal(obs.responseMs, 250);
});

test('제한 시간 안에 응답이 없으면 timedOut', async () => {
  // signal이 취소될 때까지 끝나지 않는 가짜 fetch (= 응답 없는 서버)
  const hangingFetch = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      // Node에서 AbortSignal.timeout의 타이머는 프로세스를 붙잡아 두지 않습니다(unref).
      // 그래서 할 일이 없다고 판단한 Node가 취소 전에 테스트를 끝내 버려요.
      // 진짜 서버라면 연결이 열려 있어 프로세스가 살아 있으니, 그 상황을 이 타이머로 흉내 냅니다.
      const keepAlive = setTimeout(() => {}, 5_000);
      signal.addEventListener('abort', () => {
        clearTimeout(keepAlive);
        reject(signal.reason);
      });
    });
  // 테스트가 10초씩 걸리지 않도록 제한 시간을 50ms로 줄입니다.
  const obs = await observe(monitor, { fetchFn: hangingFetch, timeoutMs: 50 });

  assert.equal(obs.timedOut, true);
  assert.equal(obs.networkError, false);
  assert.equal(obs.statusCode, null);
  assert.equal(obs.responseMs, null);
});

test('연결 자체가 실패하면 networkError', async () => {
  const brokenFetch = async () => {
    throw new TypeError('fetch failed'); // DNS 실패·연결 거부 등
  };
  const obs = await observe(monitor, { fetchFn: brokenFetch });

  assert.equal(obs.timedOut, false);
  assert.equal(obs.networkError, true);
  assert.match(obs.errorMessage, /fetch failed/);
});
