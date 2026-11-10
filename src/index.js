// Worker 진입점
// 여기에는 "흐름"만 둡니다: 대상 조회 → 동시 점검 → 판정 → 저장
// 세부 동작은 checker.js(네트워크), judge.js(판정), db.js(저장)가 맡습니다.

import { observe } from './checker.js';
import { judgeCheck, FAILURE_REASON } from './judge.js';
import { getActiveMonitors, saveCheckResults } from './db.js';
import { toCheckSlot, toIsoSeconds } from './time.js';

/**
 * 예약 실행 1회분: 활성 대상을 모두 점검하고 결과를 저장한다.
 * @param {object} env       Worker 환경 (env.DB = D1)
 * @param {Date}   runTime   이번 실행의 기준 시각
 */
export async function runChecks(env, runTime) {
  const monitors = await getActiveMonitors(env.DB);

  // DB에 저장하는 시각은 '회차' 시각(5분 단위 내림), 로그에는 실제 실행 시각도 함께 남깁니다.
  // 한 번의 실행에서 나온 결과는 모두 같은 checked_at을 써서 "02:50 회차"로 묶을 수 있어요.
  const checkedAt = toCheckSlot(runTime);
  const ranAt = toIsoSeconds(runTime);
  const when = `회차 ${checkedAt} (실행 ${ranAt})`;

  // 활성 대상이 없으면 점검·저장할 것이 없으므로 바로 끝냅니다.
  // 로그를 남기는 이유: 아무것도 안 찍히면 "Cron이 안 돈 것"과 "돌았는데 대상이 없는 것"을
  // `wrangler tail`에서 구분할 수 없기 때문이에요.
  if (monitors.length === 0) {
    console.log(`[점검] ${when} 활성 대상 없음`);
    return [];
  }

  // 동시에 점검. allSettled는 하나가 예외로 터져도 나머지 결과를 모두 기다려 줍니다.
  // (Promise.all은 하나만 실패해도 전체가 실패로 끝나요)
  const settled = await Promise.allSettled(monitors.map((m) => observe(m)));

  const rows = settled.map((outcome, i) => {
    const monitor = monitors[i];

    // observe는 내부에서 예외를 잡도록 만들었지만, 예상 못 한 예외에도 대비합니다.
    // 이 경우도 '응답을 못 받음'이므로 네트워크 오류로 기록해요.
    if (outcome.status === 'rejected') {
      console.error(`[점검 예외] ${monitor.name}:`, outcome.reason);
      return {
        monitorId: monitor.id,
        checkedAt,
        isSuccess: false,
        isSlow: false,
        statusCode: null,
        responseMs: null,
        failureReason: FAILURE_REASON.NETWORK_ERROR,
      };
    }

    const observation = outcome.value;
    const verdict = judgeCheck(monitor, observation);
    return {
      monitorId: monitor.id,
      checkedAt,
      isSuccess: verdict.isSuccess,
      isSlow: verdict.isSlow,
      statusCode: observation.statusCode,
      responseMs: observation.responseMs,
      failureReason: verdict.failureReason,
    };
  });

  await saveCheckResults(env.DB, rows);

  // wrangler dev 터미널이나 `wrangler tail`에서 보이는 로그
  for (const r of rows) {
    const name = monitors.find((m) => m.id === r.monitorId)?.name;
    const state = r.isSuccess ? (r.isSlow ? '느림' : '정상') : `실패(${r.failureReason})`;
    console.log(`[점검] ${when} ${name}: ${state} / ${r.statusCode ?? '-'} / ${r.responseMs ?? '-'}ms`);
  }
  return rows;
}

export default {
  // Cron이 5분마다 호출하는 함수
  async scheduled(controller, env, ctx) {
    // controller.scheduledTime: 이번 실행 시각(ms).
    // 정각(:00초)이 아닐 수 있어서(실제로 02:50:12가 들어옴) runChecks 안에서 회차로 내림합니다.
    await runChecks(env, new Date(controller.scheduledTime));
  },

  // 브라우저로 Worker 주소를 열었을 때의 응답.
  // B-1에서는 배포 확인용 한 줄만 돌려주고, 점검 데이터는 공개하지 않습니다 (공개 API는 B-3).
  async fetch() {
    return new Response('status-monitor 동작 중입니다. (점검 결과 공개는 아직 준비 중)', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
