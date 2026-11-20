// 첫 화면 변경 감지 실행 (17단계) — Cron 점검 직후, 받은 본문으로
//
//   대상 고르기(서비스 대표 주소의 HTTP 점검, 이번에 성공한 것만) → 지문 계산 → 이전 상태와 비교(순수 함수)
//   → 달라진 것만 저장 (같은 지문이 계속되면 DB 쓰기 없음)
//
// 본문은 메모리에서 해시만 만들고 버립니다 (저장하지 않음).
// 이 단계가 실패해도 점검 기록은 이미 저장된 뒤라 영향이 없습니다 (index.js에서 try/catch).

import { getHomePageMonitorIds, getFingerprints, saveFingerprints } from './db.js';
import { sha256Hex, byteSize, nextFingerprint } from './fingerprint.js';

/**
 * @param {object} db
 * @param {Array<{monitorId:number, isSuccess:boolean, body:string}>} pages  이번 회차 HTTP 점검의 응답 본문
 * @param {string} checkedAt  이번 회차 (UTC ISO)
 * @returns {Promise<Array>}  이번에 확정된 변경 목록 (로그·테스트용)
 */
export async function runContentChanges(db, pages, checkedAt, source = 'real') {
  const homeIds = new Set(await getHomePageMonitorIds(db));
  // 실패한 응답(오류 페이지, 시간 초과)은 '내용 변경'이 아니라 장애라서 지문에 넣지 않습니다
  const targets = pages.filter((p) => homeIds.has(p.monitorId) && p.isSuccess && typeof p.body === 'string');
  if (targets.length === 0) return [];

  const prev = await getFingerprints(db, targets.map((p) => p.monitorId));
  const items = [];
  for (const p of targets) {
    const next = nextFingerprint(prev.get(p.monitorId) ?? null, await sha256Hex(p.body), byteSize(p.body), checkedAt);
    if (next.dirty) items.push({ monitorId: p.monitorId, ...next });
  }
  await saveFingerprints(db, items, checkedAt, source);

  const changes = items.filter((i) => i.change).map((i) => ({ monitorId: i.monitorId, ...i.change }));
  for (const c of changes) {
    console.log(`[변경] 점검 ${c.monitorId}: 첫 화면 내용이 바뀜 (${c.oldSize} → ${c.newSize} bytes, 처음 본 회차 ${c.firstSeenAt})`);
  }
  return changes;
}
