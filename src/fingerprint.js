// 첫 화면 변경 감지 — 지문 계산과 판정 (17단계)
//
//   sha256Hex(text)          본문 → SHA-256 16진수 (Web Crypto: Workers와 Node 모두 있음)
//   nextFingerprint(...)     이전 지문 상태 + 이번 지문 → 다음 상태 + (확정된) 변경
//
// 판정 규칙 (장애 판정과 같은 "2회 연속" 원칙):
//   ① 처음 본 지문은 '기준'으로만 저장하고 변경으로 세지 않습니다 (비교할 이전 값이 없으니까요).
//   ② 기준과 같으면 아무 일도 없습니다. 후보가 있었다면 지웁니다 (잠깐 다른 응답이 섞였던 것).
//   ③ 기준과 다르면 '후보'로 둡니다. 같은 후보가 2회 연속 나오면 변경으로 확정하고 기준을 바꿉니다.
//      후보와도 다르면 새 후보로 1부터 다시 셉니다 (응답이 계속 바뀌는 페이지에서 매번 변경을 찍지 않게).
// 점검이 실패한 응답(오류 페이지 등)은 이 함수까지 오지 않습니다 — 그건 장애이지 '내용 변경'이 아니라서요.

export const CONFIRM_COUNT = 2; // 같은 새 지문을 몇 번 연속 보면 확정할지
export const NOISY_PER_DAY = 6; // 24시간에 이만큼 이상 바뀌면 화면에 "자주 바뀜" 표시 (판정에는 영향 없음)

const encoder = new TextEncoder();

/** 문자열의 UTF-8 바이트 수 */
export function byteSize(text) {
  return encoder.encode(text).length;
}

/** SHA-256 16진수 문자열 */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {object|null} prev  이전 상태 { hash, sizeBytes, since, candidateHash, candidateSize, candidateSince, candidateCount } 또는 null(처음)
 * @param {string} hash       이번에 받은 본문의 지문
 * @param {number} sizeBytes  이번 본문 크기
 * @param {string} at         이번 회차 (UTC ISO)
 * @returns {{ state: object, change: object|null, dirty: boolean }}
 *   dirty: 상태를 저장해야 하는지 (같은 지문이 계속되면 false → DB 쓰기 없음)
 */
export function nextFingerprint(prev, hash, sizeBytes, at) {
  const empty = { candidateHash: null, candidateSize: null, candidateSince: null, candidateCount: 0 };
  // ① 처음
  if (!prev) {
    return { state: { hash, sizeBytes, since: at, ...empty }, change: null, dirty: true };
  }
  // ② 기준과 같음
  if (hash === prev.hash) {
    if (!prev.candidateHash) return { state: prev, change: null, dirty: false };
    return { state: { ...prev, ...empty }, change: null, dirty: true };
  }
  // ③ 기준과 다름: 후보 이어 세기 또는 새 후보
  const sameCandidate = prev.candidateHash === hash;
  const count = sameCandidate ? prev.candidateCount + 1 : 1;
  const candidateSince = sameCandidate ? prev.candidateSince : at;
  if (count >= CONFIRM_COUNT) {
    return {
      state: { hash, sizeBytes, since: candidateSince, ...empty },
      change: {
        firstSeenAt: candidateSince,
        confirmedAt: at,
        oldHash: prev.hash,
        newHash: hash,
        oldSize: prev.sizeBytes,
        newSize: sizeBytes,
      },
      dirty: true,
    };
  }
  return {
    state: { ...prev, candidateHash: hash, candidateSize: sizeBytes, candidateSince, candidateCount: count },
    change: null,
    dirty: true,
  };
}

/**
 * 화면용 변경 1건 (지문은 앞 8자리만 — 비교용 표시로 충분하고 길면 읽기 어려움)
 */
export function changeView(c) {
  return {
    id: c.id,
    monitorId: c.monitorId,
    monitorName: c.monitorName,
    firstSeenAt: c.firstSeenAt,
    confirmedAt: c.confirmedAt,
    oldHash: c.oldHash.slice(0, 8),
    newHash: c.newHash.slice(0, 8),
    oldSize: c.oldSize,
    newSize: c.newSize,
    source: c.source,
  };
}

/** 최근 24시간 변경 수가 NOISY_PER_DAY 이상인지 (동적 내용일 가능성 안내용) */
export function isNoisy(changes, now) {
  const from = now.getTime() - 24 * 3600_000;
  return changes.filter((c) => Date.parse(c.firstSeenAt) >= from).length >= NOISY_PER_DAY;
}
