// 운영 근거 화면 — 데이터 보존 정리 결과 (25단계)
// 정책(무엇을 얼마나 남기는지)은 HTML에 글로 적고, 바뀌는 값(마지막 정리 결과)만 /api/retention에서 불러옵니다.
// 정리는 하루 한 번(KST 04:00)이라 실패해도 정책 표는 그대로 보이고, 결과 줄만 안내로 바뀝니다.
(async function () {
  const out = document.getElementById('retention-last');
  try {
    const data = await fetchJson('/api/retention');
    document.getElementById('retention-days').textContent = `${data.policy.rawRetentionDays}일`;
    const run = data.lastRun;
    if (!run) {
      out.textContent = '아직 정리를 한 번도 실행하지 않았습니다 (다음 KST 04:00 회차에 처음 실행).';
      return;
    }
    const parts = [`마지막 정리: ${formatKst(run.runAt)}`, `${run.firstKeptDay} 이전 원본 ${run.deletedRows.toLocaleString('ko-KR')}행 삭제`];
    if (run.deletedRows === 0) parts[1] = `${run.firstKeptDay} 이전 원본 없음 (지울 것 0행)`;
    if (run.keptOldRows > 0) parts.push(`기준보다 오래됐지만 남긴 행 ${run.keptOldRows.toLocaleString('ko-KR')} (집계가 없는 날이거나 다음 날로 미룸)`);
    if (!run.ok) parts.push('중간에 오류가 있어 다음 날 이어서 정리합니다');
    out.textContent = parts.join(' · ');
  } catch (err) {
    console.error(err);
    out.textContent = '마지막 정리 결과를 불러오지 못했습니다.';
  }
})();
