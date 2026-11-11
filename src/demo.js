// 데모(시드) 데이터 자동 갱신 — 하루 1회
//
// 왜 필요한가?
//   seed/sample.sql은 "넣은 시점 기준"으로 날짜를 만들고, 그 뒤로는 그대로입니다.
//   며칠 지나면 데모 카드의 마지막 점검이 오래전으로 밀리고, 진행 중 데모 장애의 시간이 계속 늘고,
//   30일 막대에서 데모 기록이 밀려나 '방치된 페이지'처럼 보입니다.
//   그래서 매일 새벽 4시(KST) 회차에 같은 시드를 다시 넣어 "오늘 기준"으로 맞춥니다.
//
// 왜 하루 1회인가? (매시간이 아니라)
//   D1 무료 한도(쓰기)는 계정 전체가 함께 쓰는 것으로 알고 있어서(→ 공식 문서에서 확인할 부분),
//   같은 계정의 다른 프로젝트에 부담을 주지 않으려고 합니다. 1회 약 750행.
//
// 실제 데이터는? 시드는 source = 'sample'인 것만 지우고 다시 넣으므로 실제 점검·시뮬레이터 기록은 그대로입니다.

// 다시 넣는 회차: 한국 시간 04:00 = UTC 19:00 (5분 회차 시각과 정확히 일치할 때만)
export const RESEED_SLOT_UTC = 'T19:00:00Z';

/** 이번 회차에 데모를 다시 넣어야 하나? (순수 함수) */
export function shouldReseed(checkedAtIso) {
  return typeof checkedAtIso === 'string' && checkedAtIso.endsWith(RESEED_SLOT_UTC);
}

/**
 * SQL 파일 내용을 문장 단위로 나눈다. (순수 함수)
 *   - '--' 주석은 버립니다 (따옴표 안의 '--'는 글자이므로 남김)
 *   - ';'로 문장을 나눕니다 (따옴표 안의 ';'는 글자이므로 나누지 않음)
 * 왜 직접 나누나? D1에서 여러 문장을 한 번에 실행하는 방법의 세부 동작(줄바꿈 처리, 트랜잭션)을
 * 확인하지 못해서, 문장을 나눠 batch로 실행합니다. batch는 한 묶음으로 실행돼 중간 실패 시 일부만 반영되지 않아요.
 */
export function splitSqlStatements(sql) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i];
    if (inQuote) {
      cur += c;
      if (c === "'") inQuote = false; // SQL의 '' (따옴표 이스케이프)는 닫고 다시 여는 것과 같아서 이 처리로 충분
      continue;
    }
    if (c === "'") {
      inQuote = true;
      cur += c;
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1; // 줄 끝까지 주석
      cur += '\n';
    } else if (c === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * 시드 SQL을 다시 실행한다.
 * @param {object} db   D1
 * @param {string} sql  seed/sample.sql 내용
 * @returns {Promise<number>} 실행한 문장 수
 */
export async function reseedDemo(db, sql) {
  const statements = splitSqlStatements(sql);
  await db.batch(statements.map((s) => db.prepare(s)));
  return statements.length;
}
