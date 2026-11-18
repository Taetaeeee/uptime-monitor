/**
 * 베타테스터 UX 1차 개선: 실제 사건의 증거/조치 기록으로 튜토리얼 목표를 도출합니다.
 * UI 전용 순수 함수로 저장 데이터와 사건 판정에는 영향을 주지 않습니다.
 */
import {isTutorial, TUTORIAL_ORDER, casePresentation} from './logic.js';
import {getDnsTutorialTask} from './dns-tutorial.js';

const goal=(step,total,title,description,action,kind)=>({step,total,title,description,action,kind});
export function getTutorialGoal(state,index=state?.scenarioIndex){
  if(!state || !isTutorial(state) || !TUTORIAL_ORDER.includes(index))return null;
  if(!state.activeIds.includes(state.incidents[index]?.id))return null;
  const incident=state.incidents[index];
  if(incident.status==='resolved')return null;
  const evidence=new Set(incident.evidence||[]);
  const person=casePresentation(state,index)?.npcName||'직원';
  const accepted=incident.status!=='new';
  if(index===TUTORIAL_ORDER[0]){
    if(!accepted)return goal(1,5,'직원에게 증상 듣기',`${person}가 겪는 문제를 먼저 들어보세요. 직접 찾아가지 않아도 대화할 수 있어요.`,`${person}와 대화하기`,'talk');
    if(!evidence.has('adapterChecked'))return goal(2,5,'네트워크 연결 상태 확인',`${person} PC의 바탕화면에서 [네트워크 설정]을 열어 연결 상태를 확인해 보세요.`,`${person} PC 위치 보기`,'pc');
    if(!evidence.has('cableLoose'))return goal(3,5,'PC 본체 뒤쪽 조사',`유선 연결에 문제가 있어요. PC 화면을 닫고 ${person} PC 본체의 LAN 포트를 조사해 보세요.`,'PC 본체 위치 보기','tower');
    if(!evidence.has('cableFixed'))return goal(4,5,'물리 연결 복구',`본체 뒤쪽의 LAN 케이블 상태를 확인했어요. 연결을 복구해 보세요.`,'PC 본체 위치 보기','tower');
    return goal(5,5,'복구 여부 확인',`조치가 끝났어요. ${person} PC의 네트워크 설정에서 [연결 상태 검사]를 눌러 확인해 보세요.`,`${person} PC 위치 보기`,'pc');
  }
  return getDnsTutorialTask(state,index);
}

export function renderTutorialGoal(state,index=state?.scenarioIndex){
  const task=getTutorialGoal(state,index);
  if(!task)return '';
  const safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<section class="onboarding-goal" aria-label="현재 튜토리얼 목표" aria-live="polite">
    <div class="onboarding-goal-meta"><span>🎯 지금 할 일</span><span>STEP ${task.step}/${task.total}</span></div>
    <div class="onboarding-goal-track"><span style="width:${100*task.step/task.total}%"></span></div>
    <strong>${safe(task.title)}</strong><p>${safe(task.description)}</p>
    <button type="button" class="onboarding-goal-action" data-tutorial-goal-action="${task.kind}" data-goal-case="${index}">${safe(task.action)}</button>
  </section>`;
}
