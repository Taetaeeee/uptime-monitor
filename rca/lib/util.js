// RCA 공용 작은 도구 — 순수 함수만 모아 둔다.
//
// 왜 따로 두나?
// - 깊은 복사·동결·정렬된 JSON 비교는 스키마·도구·러너·기준선이 모두 쓴다.
//   한 곳에 두면 "비교 방식이 파일마다 다른" 실수를 막을 수 있다.
// - 이 폴더(rca/)는 파일·네트워크를 쓰지 않는다. 입력은 이미 읽어 둔 객체뿐이다.

/** JSON으로 표현 가능한 값을 깊게 복사한다 (원본 변조가 안쪽으로 번지지 않게). */
export function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * 객체를 안쪽까지 얼린다.
 * 왜? 예측(분석 결과)을 먼저 얼린 뒤 채점하면, 채점 코드가 예측을 몰래 고쳐서
 * 정답에 맞추는 일이 구조적으로 불가능해진다.
 */
export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/** 키 순서와 상관없이 같은 값이면 같은 문자열이 되는 JSON (객체 동일성 비교용). */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/** 두 값이 (키 순서 무관하게) 완전히 같은지. */
export function sameValue(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

/** 일반 객체(배열·null 제외)인지. */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 0 이상의 정수인지 (상대 초, 개수 검사용). */
export function isNonNegInt(value) {
  return Number.isInteger(value) && value >= 0;
}
