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
//
// 27단계 — '배포'와 '내용 변경' 구분:
//   빌드 도구(Vite·Next.js·CRA 등)는 새로 빌드할 때마다 스크립트·스타일 파일 이름 뒤 해시를 바꿉니다(/assets/index-DozjpUTx.js).
//   그래서 HTML 전체 지문과 별도로 "해시가 붙은 파일 이름 목록"의 지문(빌드 지문)을 같이 들고 다니다가, 변경을 확정할 때
//     빌드 지문이 바뀜 → 'deploy'(배포)      HTML만 바뀜 → 'content'(내용 변경)      빌드 지문이 없음 → 'unknown'(구별 불가)
//   로 남깁니다. 파일 이름 자체는 저장하지 않고 지문만 저장합니다.
//   (응답 헤더 Last-Modified는 쓰지 않음: 실측에서 캐시가 비었을 때 요청 시각 그대로 나오거나 2018년 날짜가 나와 배포 시각으로 믿을 수 없었음)

export const CONFIRM_COUNT = 2; // 같은 새 지문을 몇 번 연속 보면 확정할지
export const NOISY_PER_DAY = 6; // 24시간에 이만큼 이상 바뀌면 화면에 "자주 바뀜" 표시 (판정에는 영향 없음)

const encoder = new TextEncoder();

export const CHANGE_KIND = { DEPLOY: 'deploy', CONTENT: 'content', UNKNOWN: 'unknown' };

/**
 * HTML에서 '빌드 해시가 붙은' 스크립트·스타일 파일 경로만 뽑아 정렬한 목록 (순수 함수, 27단계).
 *   - Next.js: /_next/static/ 아래 파일 (빌드마다 chunk 이름이 바뀜)
 *   - 그 밖: 파일 이름 끝이 '-해시' 또는 '.해시'(8자 이상, 숫자가 있거나 대·소문자가 섞임)인 .js/.css/.mjs — Vite /assets/index-DozjpUTx.js, CRA main.6f1b2c3d.js
 *   - jquery-3.7.1.min.js·bootstrap.bundle.min.js 같은 버전·소문자 단어는 해시가 아니라서 뺌
 *   - 주소 뒤 ?v=… 같은 쿼리와 도메인은 떼고 비교 (서버가 요청마다 붙이는 값일 수 있어서)
 * @param {string} html
 * @returns {string[]}  중복 없이 정렬 (태그 순서가 바뀌어도 같은 빌드면 같은 목록)
 */
function looksHashed(file) {
  const m = /[-.]([A-Za-z0-9_]{8,})(?:\.chunk)?\.(?:m?js|css)$/.exec(file);
  if (!m) return false;
  const t = m[1];
  // 해시: 숫자가 있거나 대·소문자가 섞임 (Vite 'DozjpUTx', CRA '6f1b2c3d'). 'bootstrap'·'bundle' 같은 소문자 단어는 아님
  return /\d/.test(t) || (/[a-z]/.test(t) && /[A-Z]/.test(t));
}

export function buildAssetList(html) {
  const out = new Set();
  for (const m of String(html).matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const path = m[1].split(/[?#]/)[0].replace(/^(?:https?:)?\/\/[^/]+/i, '');
    if (!/\.(?:m?js|css)$/i.test(path)) continue;
    const file = path.split('/').pop();
    if (/\/_next\/static\//.test(path) || looksHashed(file)) out.add(path);
  }
  return [...out].sort();
}

/** 빌드 지문: 해시 붙은 파일 목록의 SHA-256 (없으면 null — 구별할 근거가 없는 사이트) */
export async function buildAssetHash(html) {
  const list = buildAssetList(html);
  return list.length ? sha256Hex(list.join('\n')) : null;
}

/**
 * 확정된 변경의 종류 (순수 함수, 27단계)
 *   이전·새 빌드 지문이 둘 다 있을 때만 판단합니다. 한쪽이라도 없으면(해시 파일이 없는 사이트, 27단계 전 기준) 'unknown'.
 */
export function changeKind(oldAssetHash, newAssetHash) {
  if (!oldAssetHash || !newAssetHash) return CHANGE_KIND.UNKNOWN;
  return oldAssetHash === newAssetHash ? CHANGE_KIND.CONTENT : CHANGE_KIND.DEPLOY;
}

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
 * @param {object|null} prev  이전 상태 { hash, sizeBytes, since, assetHash, candidateHash, candidateSize, candidateSince, candidateCount, candidateAssetHash } 또는 null(처음)
 * @param {string} hash       이번에 받은 본문의 지문
 * @param {number} sizeBytes  이번 본문 크기
 * @param {string} at         이번 회차 (UTC ISO)
 * @param {string|null} [assetHash]  이번 본문의 빌드 지문 (27단계, 없으면 null)
 * @returns {{ state: object, change: object|null, dirty: boolean }}
 *   dirty: 상태를 저장해야 하는지 (같은 지문이 계속되면 false → DB 쓰기 없음)
 */
export function nextFingerprint(prev, hash, sizeBytes, at, assetHash = null) {
  const empty = { candidateHash: null, candidateSize: null, candidateSince: null, candidateCount: 0, candidateAssetHash: null };
  // ① 처음
  if (!prev) {
    return { state: { hash, sizeBytes, since: at, assetHash, ...empty }, change: null, dirty: true };
  }
  // ② 기준과 같음
  if (hash === prev.hash) {
    // 27단계 전에 만든 기준에는 빌드 지문이 없음 → 같은 내용일 때 한 번만 채움 (그 뒤로는 쓰기 없음)
    const fillAsset = !prev.assetHash && Boolean(assetHash);
    if (!prev.candidateHash && !fillAsset) return { state: prev, change: null, dirty: false };
    return { state: { ...prev, ...(prev.candidateHash ? empty : {}), assetHash: prev.assetHash || assetHash || null }, change: null, dirty: true };
  }
  // ③ 기준과 다름: 후보 이어 세기 또는 새 후보
  const sameCandidate = prev.candidateHash === hash;
  const count = sameCandidate ? prev.candidateCount + 1 : 1;
  const candidateSince = sameCandidate ? prev.candidateSince : at;
  if (count >= CONFIRM_COUNT) {
    const oldAssetHash = prev.assetHash ?? null;
    return {
      state: { hash, sizeBytes, since: candidateSince, assetHash, ...empty },
      change: {
        firstSeenAt: candidateSince,
        confirmedAt: at,
        oldHash: prev.hash,
        newHash: hash,
        oldSize: prev.sizeBytes,
        newSize: sizeBytes,
        oldAssetHash,
        newAssetHash: assetHash,
        kind: changeKind(oldAssetHash, assetHash),
      },
      dirty: true,
    };
  }
  return {
    state: { ...prev, candidateHash: hash, candidateSize: sizeBytes, candidateSince, candidateCount: count, candidateAssetHash: assetHash },
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
    kind: c.kind ?? CHANGE_KIND.UNKNOWN, // 27단계: deploy(배포) · content(내용 변경) · unknown(구별 불가)
  };
}

/** 최근 24시간 변경 수가 NOISY_PER_DAY 이상인지 (동적 내용일 가능성 안내용) */
export function isNoisy(changes, now) {
  const from = now.getTime() - 24 * 3600_000;
  return changes.filter((c) => Date.parse(c.firstSeenAt) >= from).length >= NOISY_PER_DAY;
}
