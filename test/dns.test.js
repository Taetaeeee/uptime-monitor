// DNS 점검 테스트 — 대상 해석, DoH 응답 해석, 판정, Cron 흐름 (실제 네트워크 사용 안 함)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDnsTarget, parseDohResponse, observeDns } from '../src/dns.js';
import { judgeDns, DNS_FAILURE } from '../src/judge.js';
import { createFakeD1 } from './helpers/fake-d1.js';
import { runChecks } from '../src/index.js';

// 실제로 1.1.1.1에서 받은 응답 형식 (2026-11-10, curl.exe로 확인)
const DOH_OK = {
  Status: 0, TC: false, RD: true, RA: true, AD: false, CD: false,
  Question: [{ name: 'gochyeora.pages.dev', type: 1 }],
  Answer: [
    { name: 'gochyeora.pages.dev', type: 1, TTL: 300, data: '172.66.44.133' },
    { name: 'gochyeora.pages.dev', type: 1, TTL: 300, data: '172.66.47.123' },
  ],
};
const DOH_NXDOMAIN = {
  Status: 3, TC: false, RD: true, RA: true, AD: true, CD: false,
  Question: [{ name: 'no-such-host-xyz.invalid', type: 1 }],
  Authority: [{ name: '', type: 6, TTL: 86400, data: 'a.root-servers.net. nstld.verisign-grs.com. 2026110902 1800 900 604800 86400' }],
};

test('대상 해석: 기본 A, ?type=로 종류 지정, 잘못된 형식은 null', () => {
  assert.deepEqual(parseDnsTarget('dns://GoChyeora.pages.dev'), { host: 'gochyeora.pages.dev', type: 'A' });
  assert.deepEqual(parseDnsTarget('dns://example.invalid?type=aaaa'), { host: 'example.invalid', type: 'AAAA' });
  assert.equal(parseDnsTarget('https://gochyeora.pages.dev'), null);
  assert.equal(parseDnsTarget('dns://bad host'), null);
  assert.equal(parseDnsTarget('dns://example.invalid?type=SOA'), null); // 지원하지 않는 종류
});

test('DoH 응답 해석: 물어본 종류의 레코드만, NXDOMAIN은 Answer 없음', () => {
  assert.deepEqual(parseDohResponse(DOH_OK, 'A'), { rcode: 0, answers: ['172.66.44.133', '172.66.47.123'] });
  assert.deepEqual(parseDohResponse(DOH_NXDOMAIN, 'A'), { rcode: 3, answers: [] });
  // CNAME이 섞여 와도 A만 골라 냄
  const withCname = { Status: 0, Answer: [{ type: 5, data: 'x.example.' }, { type: 1, data: '10.0.0.1' }] };
  assert.deepEqual(parseDohResponse(withCname, 'A').answers, ['10.0.0.1']);
  assert.deepEqual(parseDohResponse(null, 'A'), { rcode: -1, answers: [] });
});

const monitor = { keyword: null, maxResponseMs: 1000 };
const obs = (o) => ({ timedOut: false, networkError: false, configError: false, rcode: 0, answers: ['1.2.3.4'], responseMs: 20, ...o });

test('DNS 판정', () => {
  assert.deepEqual(judgeDns(monitor, obs({})), { isSuccess: true, isSlow: false, failureReason: null });
  assert.equal(judgeDns(monitor, obs({ responseMs: 1500 })).isSlow, true);
  assert.equal(judgeDns(monitor, obs({ rcode: 3, answers: [] })).failureReason, DNS_FAILURE.NXDOMAIN);
  assert.equal(judgeDns(monitor, obs({ rcode: 2, answers: [] })).failureReason, DNS_FAILURE.ERROR);
  assert.equal(judgeDns(monitor, obs({ answers: [] })).failureReason, DNS_FAILURE.NO_ANSWER);
  assert.equal(judgeDns({ ...monitor, keyword: '172.66.' }, obs({})).failureReason, DNS_FAILURE.MISMATCH);
  assert.equal(judgeDns({ ...monitor, keyword: '1.2.3' }, obs({})).isSuccess, true);
  assert.equal(judgeDns(monitor, obs({ timedOut: true })).failureReason, 'timeout');
  assert.equal(judgeDns(monitor, obs({ networkError: true })).failureReason, 'network_error');
  assert.equal(judgeDns(monitor, obs({ configError: true })).failureReason, DNS_FAILURE.CONFIG);
});

test('observeDns: DoH 주소·헤더로 요청하고 응답을 해석 (가짜 fetch)', async () => {
  let called;
  const fetchFn = async (url, init) => {
    called = { url, accept: init.headers.accept };
    return new Response(JSON.stringify(DOH_OK), { headers: { 'content-type': 'application/dns-json' } });
  };
  const r = await observeDns({ url: 'dns://gochyeora.pages.dev' }, { fetchFn });
  assert.equal(called.url, 'https://cloudflare-dns.com/dns-query?name=gochyeora.pages.dev&type=A');
  assert.equal(called.accept, 'application/dns-json');
  assert.equal(r.rcode, 0);
  assert.equal(r.answers.length, 2);

  // DoH 서버 오류(HTTP 500)는 네트워크 오류로
  const bad = await observeDns({ url: 'dns://x.invalid' }, { fetchFn: async () => new Response('', { status: 500 }) });
  assert.equal(bad.networkError, true);
  // 잘못된 대상은 요청하지 않고 설정 오류로
  const cfg = await observeDns({ url: 'dns://bad host' }, { fetchFn: async () => assert.fail('요청하면 안 됨') });
  assert.equal(cfg.configError, true);
});

test('Cron 흐름: DNS 대상도 점검·기록·장애 판정 (HTTP와 같은 경로)', async () => {
  const db = createFakeD1();
  db.sqlite.exec(`INSERT INTO monitors (name, kind, url, max_response_ms, is_active, source)
                  VALUES ('테스트 DNS', 'dns', 'dns://test.invalid', 1000, 1, 'sample')`);
  const responses = [DOH_OK, DOH_NXDOMAIN, DOH_NXDOMAIN];
  const log = console.log;
  console.log = () => {};
  try {
    for (const [i, body] of responses.entries()) {
      await runChecks({ DB: db }, new Date(Date.UTC(2026, 10, 10, 3, i * 5, 12)), {
        fetchFn: async () => new Response(JSON.stringify(body)),
      });
    }
  } finally {
    console.log = log;
  }
  const rows = db.sqlite.prepare('SELECT is_success, value, failure_reason, status_code FROM check_results ORDER BY id').all();
  assert.deepEqual(rows.map((r) => [r.is_success, r.value, r.failure_reason, r.status_code]), [
    [1, 2, null, null],             // 레코드 2개
    [0, 0, 'dns_nxdomain', null],
    [0, 0, 'dns_nxdomain', null],
  ]);
  const note = db.sqlite.prepare('SELECT event, message FROM notifications').get();
  assert.equal(note.event, 'down');
  assert.match(note.message, /DNS 이름 없음/);
});
