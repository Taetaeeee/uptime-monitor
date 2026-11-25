// '배포'와 '내용 변경' 구분 (27단계) 테스트
//   빌드 지문 = 해시 붙은 스크립트·스타일 파일 이름 목록의 지문. 바뀌면 배포, HTML만 바뀌면 내용 변경, 없으면 구별 불가
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './helpers/fake-d1.js';
import { buildAssetList, buildAssetHash, changeKind, nextFingerprint, CHANGE_KIND } from '../src/fingerprint.js';
import { runContentChanges } from '../src/change-run.js';
import { buildServices } from '../src/api.js';

test('buildAssetList: 빌드 해시가 붙은 파일만, 정렬·중복 없이, 쿼리와 도메인은 뗌', () => {
  // Vite (해시에 숫자가 없어도 대·소문자가 섞이면 해시로 봄)
  assert.deepEqual(
    buildAssetList('<script type="module" crossorigin src="/assets/index-DozjpUTx.js"></script><link rel="stylesheet" href="/assets/index-3iswh3_y.css">'),
    ['/assets/index-3iswh3_y.css', '/assets/index-DozjpUTx.js']
  );
  // Next.js(/_next/static/ 아래 전부), CRA(main.해시.js / .chunk.css), 다른 도메인·쿼리
  assert.deepEqual(
    buildAssetList(
      '<script src="/chats/_next/static/immutable/chunks/30fndxkmfrpb2.js" async></script>' +
        '<script src="https://cdn.example/static/js/main.6f1b2c3d.js?x=1"></script>' +
        '<link href="/static/css/main.ab12cd34.chunk.css" rel="stylesheet">'
    ),
    ['/chats/_next/static/immutable/chunks/30fndxkmfrpb2.js', '/static/css/main.ab12cd34.chunk.css', '/static/js/main.6f1b2c3d.js']
  );
  // 버전 번호·소문자 단어·해시 없는 파일·캐시 버스터 쿼리는 해시가 아님 → 빈 목록 (이런 사이트는 '구별 불가')
  assert.deepEqual(
    buildAssetList('<script src="/js/jquery-3.7.1.min.js"></script><script src="bootstrap.bundle.min.js"></script><link href="/style.css?v=20261120" rel="stylesheet"><script src="/app.js"></script>'),
    []
  );
  // 이미지·a 태그는 무시
  assert.deepEqual(buildAssetList('<img src="/assets/logo-AbC12345.png"><a href="/assets/x-AbC12345.js">x</a>'), []);
});

test('buildAssetHash: 태그 순서가 달라도 같은 빌드면 같은 지문, 해시 파일이 없으면 null', async () => {
  const a = await buildAssetHash('<script src="/assets/a-AbC12345.js"></script><link href="/assets/b-XyZ98765.css">');
  const b = await buildAssetHash('<link href="/assets/b-XyZ98765.css"><p>다른 내용</p><script src="/assets/a-AbC12345.js"></script>');
  const c = await buildAssetHash('<script src="/assets/a-QwE45678.js"></script><link href="/assets/b-XyZ98765.css">');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(await buildAssetHash('<p>정적 페이지</p><script src="/app.js"></script>'), null);
});

test('changeKind: 빌드 지문이 바뀌면 배포, 같으면 내용 변경, 한쪽이라도 없으면 구별 불가', () => {
  assert.equal(changeKind('a', 'b'), CHANGE_KIND.DEPLOY);
  assert.equal(changeKind('a', 'a'), CHANGE_KIND.CONTENT);
  assert.equal(changeKind(null, 'a'), CHANGE_KIND.UNKNOWN); // 27단계 전 기준 (비교할 것이 없음)
  assert.equal(changeKind('a', null), CHANGE_KIND.UNKNOWN); // 해시 파일이 사라짐 (오류 페이지일 수도 있어 단정 안 함)
  assert.equal(changeKind(null, null), CHANGE_KIND.UNKNOWN);
});

const T = (m) => `2026-11-25T01:${String(m).padStart(2, '0')}:00Z`;

test('nextFingerprint: 확정할 때 종류를 정하고, 옛 기준의 빌드 지문은 한 번만 채운다', () => {
  // 27단계 전 기준 (빌드 지문 없음) → 같은 내용이면 이번에 한 번 채움(dirty), 그다음부터는 쓰기 없음
  const old = { hash: 'H1', sizeBytes: 100, since: T(0), candidateHash: null, candidateSize: null, candidateSince: null, candidateCount: 0 };
  const filled = nextFingerprint(old, 'H1', 100, T(5), 'A1');
  assert.equal(filled.dirty, true);
  assert.equal(filled.state.assetHash, 'A1');
  assert.equal(nextFingerprint(filled.state, 'H1', 100, T(10), 'A1').dirty, false);
  // 해시 파일이 없는 사이트는 채울 것도 없음 → 쓰기 없음
  assert.equal(nextFingerprint(old, 'H1', 100, T(5), null).dirty, false);

  // 빌드 지문이 바뀐 새 HTML이 2회 연속 → 배포
  const c1 = nextFingerprint(filled.state, 'H2', 120, T(10), 'A2');
  const c2 = nextFingerprint(c1.state, 'H2', 120, T(15), 'A2');
  assert.deepEqual([c2.change.kind, c2.change.oldAssetHash, c2.change.newAssetHash, c2.change.firstSeenAt], ['deploy', 'A1', 'A2', T(10)]);
  assert.equal(c2.state.assetHash, 'A2');

  // 빌드 지문은 같고 HTML만 바뀜 → 내용 변경
  const d1 = nextFingerprint(c2.state, 'H3', 125, T(20), 'A2');
  const d2 = nextFingerprint(d1.state, 'H3', 125, T(25), 'A2');
  assert.equal(d2.change.kind, 'content');
});

test('Cron 경로: HTML만 바뀌면 content, 빌드 파일이 바뀌면 deploy로 저장되고 API에 배포 횟수가 나온다', async () => {
  const db = createFakeD1();
  db.sqlite.exec('UPDATE monitors SET is_active = 1 WHERE service_id IS NOT NULL'); // 변경 감지는 켜진 서비스 대표 주소만
  const id = db.sqlite.prepare("SELECT id FROM monitors WHERE url = 'https://gochyeora.pages.dev'").get().id;
  const page = (asset, text) => [{ monitorId: id, isSuccess: true, body: `<script src="/assets/index-${asset}.js"></script><p>${text}</p>` }];
  const run = (body, m) => runContentChanges(db, body, `2026-11-25T0${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:00Z`);
  const quiet = console.log;
  console.log = () => {};
  try {
    await run(page('AbC12345', '처음'), 0); // 기준
    await run(page('AbC12345', '문구 수정'), 5);
    await run(page('AbC12345', '문구 수정'), 10); // → content 확정
    await run(page('QwE98765', '문구 수정'), 15);
    await run(page('QwE98765', '문구 수정'), 20); // → deploy 확정
  } finally {
    console.log = quiet;
  }
  const kinds = db.sqlite.prepare('SELECT kind FROM content_changes ORDER BY first_seen_at').all().map((r) => r.kind);
  assert.deepEqual(kinds, ['content', 'deploy']);

  const body = await buildServices(db, new Date('2026-11-25T02:00:00Z'));
  assert.deepEqual(body.recentChanges.map((c) => c.kind), ['deploy', 'content']); // 최신 순
  const count = body.changeCounts.find((c) => c.serviceKey === 'gochyeora');
  assert.deepEqual({ ...count }, { serviceKey: 'gochyeora', day: 2, week: 2, deployDay: 1, deployWeek: 1 });
});

test('0021 이전 변경 기록은 종류가 unknown으로 읽힌다', () => {
  const db = createFakeD1();
  const id = db.sqlite.prepare("SELECT id FROM monitors WHERE url = 'https://gochyeora.pages.dev'").get().id;
  db.sqlite
    .prepare("INSERT INTO content_changes (monitor_id, first_seen_at, confirmed_at, old_hash, new_hash, old_size, new_size) VALUES (?, ?, ?, 'a', 'b', 1, 2)")
    .run(id, T(0), T(5));
  assert.equal(db.sqlite.prepare('SELECT kind FROM content_changes').get().kind, 'unknown');
  assert.throws(() => db.sqlite.exec("UPDATE content_changes SET kind = 'oops'")); // CHECK
});
