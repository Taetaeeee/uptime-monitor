import * as THREE from 'three';
import { createWorld } from './game/world.js';
import {OFFICE_DESTINATIONS,findTravelDestination} from './game/office-fast-travel.js';
import {renderOfficeMap} from './ui/office-map-ui.js';
import {IT_ROOM,insideItRoom} from './game/it-room-layout.js';
import {renderItOperations} from './ui/it-operations-ui.js';
import {PRACTICE_PROGRESS_KEY,practiceForSession,newPracticeSession,inspectPractice,diagnosePractice,repairPractice,verifyPractice,executePracticeCommand,executeSwitchCommand,selectPracticePort,togglePracticeCableEnd,togglePracticeCablePower,measurePracticeCable,replacePracticeCable,wirePracticeCablePin,recrimpPracticeCable,selectPracticeWirePin,selectPracticeDiagnosis,confirmPracticeDiagnosis,togglePracticeSwitchCable,readPracticeProgress,completePracticeProgress} from './game/it-practice.js';
import {renderPracticeHub,renderPracticeSession} from './ui/it-practice-ui.js';
import {updatePracticeScreen} from './ui/it-lab-screen-update.js';
// 네트워크 토폴로지 실습은 시작 필수 모듈이 아닙니다. 실습을 열 때만 동적으로 로드합니다.
// 배포 중 신규 모듈이 누락되더라도 기존 3D 게임은 시작되어야 합니다.
import {IT_LAB_DIFFICULTY_KEY,readLabDifficulty,normalizeLabDifficulty,chooseLabPracticeScenario} from './game/it-lab-difficulty.js';
import {IT_LAB_REPORTS_KEY,readLabReports,appendLabReport,recordLabActivity,buildLabReport} from './game/it-lab-report.js';
import {renderLabReportHistory,renderLabReportDetail,labReportAsText} from './ui/it-lab-report-ui.js';
import {IT_LAB_DAILY_KEY,IT_LAB_STATS_KEY,localLabDay,readDailyLabTask,ensureDailyLabTask,startDailyLabAttempt,finishDailyLabTask,readLabLearningStats,mergeLabReportStats} from './game/it-lab-daily.js';
import {renderSpareShelf} from './ui/it-shelf-ui.js';
import {mountEquipmentViewer} from './ui/equipment-3d-viewer.js';
import {DEPARTMENT_ZONES,departmentAt,departmentTransition} from './game/department-layout.js';
import { isInsideServerRoom } from './game/office-layout.js';
import { restoreWalkablePosition } from './game/spawn.js';
import { normalizeCameraTurn, rotatePlanar, rotatedCameraOffset } from './game/camera-controls.js';
import { gameControlForKey,escapeMenuAction } from './game/control-keys.js';
import { EVIDENCE, SCENARIOS, TUTORIAL_ORDER, currentScenario, newGame, activeCaseIndices, activatePending, focusNextActive, selectIncident, npcHasActiveIncident, safeLoad, setPlayerPosition, talk, inspectPc, inspectCable, inspectAdapter, inspectBrowser, inspectServer, getDeviceInspectionAccess, getNetworkSnapshot, reconnectCable, startDhcp, renewLease, restoreDns, verify, getProgress, getSwitchPorts, inspectSwitch, setSwitchPort, inspectWebService, startWebService, inspectMail, inspectMailIndicators, reportPhishing, quarantineMail, inspectLoginLog, flagSuspiciousLogin, revokeSuspiciousSession, restoreNormalLoginSession, secureAccount, runMode, isTutorial, runCaseCount, hasFinishedTutorial, difficultyLabel, difficultyName, difficultyForCase, setRunDifficulty, revealHint, getCaseScore, getRunSummary, isContinuousRun, enableContinuousRun, advanceContinuousRound, startNextWorkShiftCases, getContinuousSummary, casePresentation, caseCause, activeCauseOwner, npcDialogueReply, caseQueueLabel } from './game/logic.js';
import { renderDesktop, renderNetwork, renderBrowser, renderTerminal, renderChassis } from './ui/pc-ui.js';
import { observedDiagnosticNextStep } from './game/diagnostic-guidance.js';
import { renderPcNavigation } from './ui/pc-navigation-ui.js';
import { renderPcFrontInspect } from './ui/pc-front-ui.js';
import { renderNpcDialogue, renderNpcHistory } from './ui/npc-dialogue-ui.js';
import { getResolutionDetails, renderResolutionLearning } from './game/resolution-report.js';
import { renderServer } from './ui/server-ui.js';
import {SERVER_LAB_PROGRESS_KEY,SERVER_LAB_SCENARIOS,newServerLabSession,executeServerLabCommand,readServerLabProgress,completeServerLabProgress} from './game/server-lab.js';
import {renderServerLabHub,renderServerLabSession} from './ui/server-lab-ui.js';
import {UNIFIED_DIFFICULTY_KEY,resolveUnifiedDifficulty,validUnifiedDifficulty} from './game/unified-difficulty.js';
import {SHARED_INFRASTRUCTURE_KEY,newSharedInfrastructure,readSharedInfrastructure,infrastructureStatus,applySwitchPracticeImpact,applyServerPracticeImpact,applyEmployeePcImpact,applyEmployeeAdapterImpact,inheritSharedSwitchState,inheritSharedServerState,sharedConnectivityFailure} from './game/shared-infrastructure.js';
import {renderSharedInfrastructure} from './ui/shared-infrastructure-ui.js';
import {LINKED_INCIDENTS_KEY,newLinkedIncidents,readLinkedIncidents,reconcileLinkedIncidents,linkedIncidentSummary,linkedIncidentsForEmployee,acknowledgeLinkedIncident,verifyLinkedIncident} from './game/linked-incidents.js';
import {renderLinkedQueue,renderLinkedNotice,renderLinkedDetail,renderLinkedReport} from './ui/linked-incidents-ui.js';
import {buildOperationsReport} from './game/operations-report.js';
import {renderOperationsReport,operationsReportAsText} from './ui/operations-report-ui.js';
import {linkedEmployeeFeedback} from './game/linked-npc-feedback.js';
import {employeeByPort,employeeAreaList,employeeFullName} from './game/employee-directory.js';
import {EMPLOYEE_PRESSURE_KEY,PRESSURE_LABELS,readEmployeePressure,newEmployeePressure,pressureStatus,advanceEmployeePressure,reassureEmployee,employeePressurePriority} from './game/employee-pressure.js';
import {dhcpInspectionFeedback,pcInspectionFeedback,switchInspectionFeedback,webInspectionFeedback} from './game/incident-learning-feedback.js';
import { renderEquipmentHub, renderSwitchManager, renderRouterManager, renderWebServerManager, renderPendingInspection } from './ui/infrastructure-ui.js';
import { renderJournal } from './ui/journal-ui.js';
import { hasFinishedDay } from './game/final-report.js';
import { renderFinalReport } from './ui/final-report-ui.js';
import { renderContinuousReport } from './ui/continuous-report-ui.js';
import { showMainStartForTutorial, renderTutorialNextStep } from './ui/tutorial-next-ui.js';
import { getTutorialGoal, renderTutorialGoal } from './game/onboarding.js';
import {isDnsTutorialActive,getDnsTutorialStep,getDnsTutorialTask,advanceDnsTutorial,canDnsTutorialPerform,dnsTutorialCommandAllowed} from './game/dns-tutorial.js';
import {FIRST_DAY_TOUR_KEY,newFirstDayTour,readFirstDayTour,currentFirstDayStep,isFirstDayTourActive,advanceFirstDayTour,needsFirstDayStepIntro,acknowledgeFirstDayStepIntro,employeeWalkTarget,reachedWalkTarget} from './game/first-day-tour.js';
import {canTutorialPerform,isGuidedWalkMove,buildTutorialWalkRoute} from './game/tutorial-input-guard.js';
import {renderFirstDayTourCard,renderFirstDayInlineGuide,renderFirstDayStartIntro,renderFirstDayStepIntro} from './ui/first-day-tour-ui.js';
import { getContextualHelp } from './game/contextual-help.js';
import { renderInbox, renderMailDetails, renderLoginAudit } from './ui/security-ui.js';
import { executeTerminalCommand } from './game/terminal.js';
import {setEmployeePcConfig} from './game/logic.js';
import { createAudioManager } from './audio/audio-manager.js';
import {chooseNearbyInteraction,nearestTower} from './game/interaction-targeting.js';
import {hasResumableRandomSave} from './game/save-entry.js';
import {SHIFT_STORAGE_KEY,newWorkShiftLedger,loadWorkShiftLedger,finishWorkShift,resumeWorkShift,resetWorkShift,workShiftIsClosed,workShiftSummary,workShiftHistory,recordWorkShiftDifficulty,workShiftDayLabel} from './game/work-shift.js';
import {renderWorkShiftReport,renderWorkShiftHistory} from './ui/work-shift-ui.js';
import {getWorkNavigation} from './game/work-navigation.js';
import {renderControlsGuide} from './ui/controls-guide-ui.js';
import {renderGameMenu} from './ui/game-menu-ui.js';
import {TIME_ATTACK_SESSION_KEY,TIME_ATTACK_STATE_KEY,TIME_ATTACK_RESULTS_KEY,newTimeAttack,restoreTimeAttack,advanceTimeAttack,setTimeAttackPaused,formatTimeAttack,makeTimeAttackResult,loadTimeAttackResults,appendTimeAttackResult} from './game/time-attack.js';
import {renderTimeAttackSetup,renderTimeAttackMenu,renderTimeAttackReport,renderTimeAttackHistory} from './ui/time-attack-ui.js';
import {TIME_ATTACK_BESTS_KEY,hydrateTimeAttackBests,recordTimeAttackBest} from './game/time-attack-ranks.js';
import {TIME_ATTACK_SUCCESS_HOLD_MS,intakeHoldMs,intakeDockMs,shouldAdvanceTimeAttack} from './game/time-attack-ux.js';
import {renderTimeAttackCaseResolved} from './ui/time-attack-ux-ui.js';
import {roundDifficultyLabel,concurrentCaseLimitLabel} from './ui/difficulty-status-ui.js';
import {createRecordBackup,parseRecordBackup,restoreRecordBackup,BACKUP_MAX_BYTES} from './game/record-backup.js';
import {buildIntakeNotice,renderIntakeNotice,observedServerRoute} from './ui/incident-intake-ui.js';
import {renderCaseStageTrack} from './ui/case-stage-ui.js';
import {getCaseNextAction} from './ui/next-action-ui.js';

// BGM은 최초 키/마우스 입력 후 시작합니다(브라우저 자동 재생 정책).
const audio = createAudioManager();
window.addEventListener('pointerdown', () => audio.unlock(), { once: true, capture: true });
window.addEventListener('keydown', () => audio.unlock(), { once: true, capture: true });
// 릴리스 버전은 화면별로 따로 작성하지 않고 여기서 공통으로 관리합니다.
const GAME_VERSION = 'v1.9.4.1'; // 릴리스 검증 스크립트에서 package.json·화면·README와 일치 확인
let linkedIncidents=newLinkedIncidents(); // HUD 최초 렌더 이전 기본값
let employeePressure=newEmployeePressure(); // 연속 근무 실전 직원 대기 상태
// 모드별 저장소를 분리해 기존 v0.8.1 스토리 진행 기록을 보존합니다.
const STORY_STORAGE_KEY = 'GOCHYEORA_V01';
const RANDOM_STORAGE_KEY = 'GOCHYEORA_RANDOM_V09';
const TUTORIAL_STORAGE_KEY = 'GOCHYEORA_TUTORIAL_V098';
const TUTORIAL_COMPLETE_KEY = 'GOCHYEORA_TUTORIAL_COMPLETE_V098';
const WELCOME_PENDING_KEY = 'GOCHYEORA_WELCOME_PENDING_V098';
const ACTIVE_MODE_KEY = 'GOCHYEORA_ACTIVE_MODE_V09';
const RANDOM_STARTED_KEY = 'GOCHYEORA_RANDOM_STARTED_V09913';
const SHIFT_HOME_PENDING_KEY = 'GOCHYEORA_SHIFT_HOME_PENDING_V09915';
function readSetting(key){try{return localStorage.getItem(key);}catch{return null;}}
// 구버전에는 처음 로딩 시 자동 생성된 빈 랜덤 저장도 있으므로 실제 업무 기록과 구별합니다.
function hasSavedRandomGame(){
  return hasResumableRandomSave(readSetting(RANDOM_STORAGE_KEY),readSetting(RANDOM_STARTED_KEY)==='1');
}
const needsOnboarding = !readSetting(TUTORIAL_STORAGE_KEY) && !hasSavedRandomGame();
const firstVisit = needsOnboarding || readSetting(WELCOME_PENDING_KEY)==='1';
// 첫 방문을 난이도 선택 없이 랜덤 업무로 자동 시작하지 않습니다.
if(needsOnboarding)try{localStorage.setItem(WELCOME_PENDING_KEY,'1');}catch{}
// 실제 랜덤 저장이 없으면 튜토리얼 상태로 시작해 가짜 랜덤 저장이 생기지 않게 합니다.
// v0.9.9.15는 근무 종료 시 튜토리얼로 강제 전환했습니다. 해당 기존 저장도
// 시작 화면에서는 랜덤 업무의 종료 상태를 우선 복원해 튜토리얼 완료창이 보이지 않게 합니다.
const hasClosedShiftPending=readSetting(SHIFT_HOME_PENDING_KEY)==='1'&&hasSavedRandomGame();
const cachedTimeAttack=restoreTimeAttack(readSetting(TIME_ATTACK_SESSION_KEY));
const cachedChallengeState=cachedTimeAttack?safeLoad(readSetting(TIME_ATTACK_STATE_KEY)):null;
// 도전 상태와 기존 랜덤 저장은 별도 키에 보관합니다. 새로고침 후에는 정지 상태로 복귀합니다.
const resumingTimeAttack=Boolean(cachedTimeAttack&&cachedChallengeState&&isContinuousRun(cachedChallengeState)&&cachedChallengeState.run.difficulty===cachedTimeAttack.difficulty);
let timeAttackSession=resumingTimeAttack?cachedTimeAttack:null;
let timeAttackLastStamp=null;
const preferredMode = resumingTimeAttack?'random':hasClosedShiftPending?'random':
  readSetting(ACTIVE_MODE_KEY)==='tutorial'||!hasSavedRandomGame()?'tutorial':'random';
function storageKeyForMode(mode){return mode==='tutorial'?TUTORIAL_STORAGE_KEY:mode==='random'?RANDOM_STORAGE_KEY:STORY_STORAGE_KEY;}
const storedSave = resumingTimeAttack?readSetting(TIME_ATTACK_STATE_KEY):readSetting(storageKeyForMode(preferredMode));
const $ = (selector) => document.querySelector(selector);
let storageWarningActive=false;
function showStorageWarning(context){
  storageWarningActive=true;
  const banner=$('#storage-warning');
  if(!banner)return;
  $('#storage-warning-text').textContent=`${context} 저장에 실패했어요. 이 상태에서는 새로고침하거나 탭을 닫으면 기록이 사라질 수 있습니다. 기록 백업을 권장해요.`;
  banner.hidden=false;
}
function hideStorageWarning(){
  storageWarningActive=false;
  const banner=$('#storage-warning');
  if(banner)banner.hidden=true;
}

const element = {
  game: $('#game'), backdrop: $('#modal-backdrop'), title: $('#modal-title'),
  kicker: $('#modal-kicker'), content: $('#modal-content'), actions: $('#modal-actions'),
  toast: $('#toast'), interaction: $('#interaction-wrap'), nearbyName: $('#nearby-name'),
  nearbyAction: $('#nearby-action'), towerButton: $('#nearby-tower-button'),
  towerButtonName: $('#nearby-tower-name'), modalFeedback: $('#modal-feedback'),
  dialoguePanel: $('#dialogue-panel'), dialogueKicker: $('#dialogue-kicker'), dialogueTitle: $('#dialogue-title'),
  dialogueContent: $('#dialogue-content'), dialogueActions: $('#dialogue-actions'),
  dialogueHistory: $('#dialogue-history'), dialogueHistoryContent: $('#dialogue-history-content'),
  dialogueHistoryButton: $('#dialogue-history-button'),
  targetSpotlight: $('#target-spotlight'), serverRoomLabel: $('#server-room-label'),
  departmentLabels: $('#department-room-labels'), departmentNotice: $('#department-entry-notice'),
  firstDayPcCue: $('#first-day-pc-world-cue'),
  itRoomLabel: $('#it-room-label'), itRoomNotice: $('#it-room-entry-notice'),
};
let state=storedSave?safeLoad(storedSave):newGame({mode:preferredMode,continuous:preferredMode==='random',pcExpanded:preferredMode==='random'});
if(runMode(state)!==preferredMode)state=newGame({mode:preferredMode,continuous:preferredMode==='random',pcExpanded:preferredMode==='random'});
let firstDayTour=readFirstDayTour(readSetting(FIRST_DAY_TOUR_KEY));
let tourIdleSeconds=0;
let tourIdlePhase=0; // 0: idle off, 1: focus after 3s, 2: '눌러보세요' after 6s
let findFocusUntil=0; // 위치 안내를 실제로 보여주기 전에는 3/9로 전환하지 않습니다.
let tourWalkingRoute=null;
let lastBlockedTutorialInput=0;
function firstDayAllows(action){return !isTutorial(state)||canTutorialPerform(firstDayTour,action);}
function blockFirstDayInput(action){
  if(firstDayAllows(action)&&canDnsTutorialPerform(state,action))return false;
  keys?.clear?.(); // 입력 제한 상태에 이동 키가 눌린 채 남지 않도록 함
  tourIdleSeconds=Math.max(tourIdleSeconds,6);tourIdlePhase=Math.max(tourIdlePhase,1);
  const now=performance.now();
  if(now-lastBlockedTutorialInput>2600){lastBlockedTutorialInput=now;toast(isDnsTutorialActive(state)?`🎓 현재 ${getDnsTutorialStep(state)}/10단계예요. 왼쪽 목표 카드의 안내부터 진행하세요. (ESC: 메뉴)`:'🎓 노란색으로 강조된 대상부터 조작해 보세요. (ESC: 메뉴)');}
  return true;
}

function dnsAction(event,details={}){
  if(!advanceDnsTutorial(state,event,details))return false;
  save(); // run.dnsTutorialStep은 기존 튜토리얼 저장 JSON에 포함됩니다.
  return true;
}
function showParkLocation(){
  if(overlayOpen())return;
  const target=world.interactables.find(item=>item.id==='npc:park');
  if(!target)return toast('박과장 위치를 찾지 못했어요.');
  highlightedDevice={id:'npc:park',index:2,npcId:'park',kind:'npc',position:target.position.clone(),focusUntil:performance.now()+SPOTLIGHT_FOCUS_MS};
  element.targetSpotlight.textContent='📍 박과장 · 표시된 위치까지 직접 걸어가세요 (WASD)';
  element.targetSpotlight.hidden=false;
  toast('박과장 위치가 표시됐어요. 가까이 가서 R로 대화할 수 있어요.');
}
function storeFirstDayTour(){try{localStorage.setItem(FIRST_DAY_TOUR_KEY,JSON.stringify(firstDayTour));}catch{showStorageWarning('첫 출근 조작 연습');}}
function tourAction(event,options={}){
  if(!isTutorial(state)||!isFirstDayTourActive(firstDayTour)||needsFirstDayStepIntro(firstDayTour))return false;
  const old=firstDayTour;firstDayTour=advanceFirstDayTour(firstDayTour,event,options);
  if(firstDayTour===old)return false;
  // 진행 이벤트가 실제로 성공한 경우에만 안내 타이머와 좌측 카드를 초기화합니다.
  tourIdleSeconds=0;tourIdlePhase=0;
  storeFirstDayTour();updateHud();
  const workspace=element.content?.querySelector('.pc-workspace');
  if(workspace)workspace.dataset.firstDayStep=currentFirstDayStep(firstDayTour)?.id||'';
  const inline=element.content?.querySelector('.first-day-inline-guide');
  if(inline){const next=renderFirstDayInlineGuide(firstDayTour);if(next)inline.outerHTML=next;else inline.remove();}
  if(currentFirstDayStep(firstDayTour)?.id!=='walk'&&currentFirstDayStep(firstDayTour)?.id!=='find')hideTourWalkMarker();
  if(firstDayTour.complete){hideTourWalkMarker();toast('🎓 조작 오리엔테이션 완료! 이제 김대리·박과장의 장애를 직접 해결해 보세요.');}
  else showFirstDayStepIntro(); // v1.9.4.1에서는 첫 부서 안내 외에는 팝업 없이 실제 대상 강조
  return true;
}
if(preferredMode==='random'){
  enableContinuousRun(state);
  // 이전 버전 저장의 진행 중 사건은 유지하고, 다음 근무부터 신규 PC 장애 출제.
  state.run.pcExpanded=true;
  advanceContinuousRound(state);
}
// 근무 결과는 기존 랜덤 업무 저장과 분리하여 기록합니다. 이전 버전의 누적 점수를 훼손하지 않습니다.
const previousRandom=resumingTimeAttack?(hasSavedRandomGame()?safeLoad(readSetting(RANDOM_STORAGE_KEY)):null):(runMode(state)==='random'?state:hasSavedRandomGame()?safeLoad(readSetting(RANDOM_STORAGE_KEY)):null);
if(previousRandom&&runMode(previousRandom)==='random')enableContinuousRun(previousRandom);
let workShiftLedger=previousRandom&&isContinuousRun(previousRandom)?
  loadWorkShiftLedger(readSetting(SHIFT_STORAGE_KEY),previousRandom):null;
function persistShiftLedger(){
  if(!workShiftLedger)return true;
  try{localStorage.setItem(SHIFT_STORAGE_KEY,JSON.stringify(workShiftLedger));return true;}
  catch{showStorageWarning('근무 이력');return false;}
}
persistShiftLedger();
const isShiftAwaitingNextDay=()=>!timeAttackSession&&isContinuousRun(state)&&workShiftIsClosed(workShiftLedger);
function refreshWorkButtons(){
  if(timeAttackSession){
    $('#btn-finish-shift').hidden=true;$('#btn-resume-work').hidden=true;
    return {ended:false,showFinish:false,showResume:false};
  }
  const navigation=getWorkNavigation({tutorial:isTutorial(state),continuous:isContinuousRun(state),
    closed:workShiftIsClosed(workShiftLedger),savedRandom:hasSavedRandomGame()});
  $('#btn-finish-shift').hidden=!navigation.showFinish;
  $('#btn-resume-work').hidden=!navigation.showResume;
  $('#btn-resume-work').textContent=navigation.resumeLabel;
  $('#btn-resume-work').title=navigation.resumeLabel;
  return navigation;
}
// 저장 형식 v5: 기존 진행 기록과 공유 네트워크 장비 상태를 함께 보존합니다.
let world=null;
const save = ({refreshHud=true}={}) => {
  if(world)setPlayerPosition(state,world.player.position);
  let success=true;
  try{
    if(timeAttackSession){
      localStorage.setItem(TIME_ATTACK_STATE_KEY,JSON.stringify(state));
      localStorage.setItem(TIME_ATTACK_SESSION_KEY,JSON.stringify(timeAttackSession));
    }else{
      localStorage.setItem(storageKeyForMode(runMode(state)),JSON.stringify(state));
      localStorage.setItem(ACTIVE_MODE_KEY,runMode(state));
      if(workShiftLedger)localStorage.setItem(SHIFT_STORAGE_KEY,JSON.stringify(workShiftLedger));
    }
  }catch{
    success=false;showStorageWarning('게임/근무 기록');
  }
  if(success&&storageWarningActive)hideStorageWarning();
  if(refreshHud)updateHud();
  return success;
};
// UI 이벤트 위임을 유지하고, 상태가 같은 프레임에서 사건 카드를 불필요하게 재구성하지 않습니다.
let lastCaseListMarkup=null;
function renderCaseListIfChanged(list,markup){
  if(markup===lastCaseListMarkup)return;
  list.innerHTML=markup;
  lastCaseListMarkup=markup;
}
function updateHud() {
  const navigation=refreshWorkButtons();
  const panel=$('#task-card');
  const list=$('#case-list');
  // 근무를 마친 상태에서는 남은 사건을 종료 이력에 보존하고 게임 안내 카드는 감춥니다.
  // 이전 버전처럼 튜토리얼 완료 카드를 재활용하지 않습니다.
  panel.hidden=navigation.ended;
  if(navigation.ended){
    $('#day-label').textContent=`🏁 ${workShiftDayLabel(workShiftLedger)} · 근무 종료`;
    const total=getContinuousSummary(state)?.total??0;
    $('#progress').textContent=`누적 ${total}건 · 다음 근무 대기`;
    $('#task-limit').textContent='근무 종료';
    if(lastCaseListMarkup!==null){list.replaceChildren();lastCaseListMarkup=null;}
    panel.querySelector('.case-queue-foot').hidden=true;
    element.interaction.hidden=true;
    return;
  }
  const completed=isTutorial(state)?TUTORIAL_ORDER.filter(index=>state.incidents[index].status==='resolved').length:state.completedIds.length;
  const active=activeCaseIndices(state);
  if(!isTutorial(state)&&!timeAttackSession&&isContinuousRun(state))active.sort((a,b)=>{
    const pa=SCENARIOS[a],pb=SCENARIOS[b];
    const aa=employeePressurePriority(pressureStatus(employeePressure,state.run?.round,pa),1,pa.priority);
    const bb=employeePressurePriority(pressureStatus(employeePressure,state.run?.round,pb),1,pb.priority);
    return bb-aa;
  });
  const continuous=getContinuousSummary(state);
  $('#progress').textContent=timeAttackSession?`도전 해결 ${continuous?.total??0}건 · 진행 ${active.length}`:continuous?`누적 ${continuous.total}건 · 진행 ${active.length}`:`완료 ${completed}/${runCaseCount(state)} · 진행 ${active.length}`;
  $('#day-label').textContent=timeAttackSession?`⏱ ${formatTimeAttack(timeAttackSession.remainingMs)} · 난이도: ${difficultyLabel(state)}`:roundDifficultyLabel(state,continuous?.round,isContinuousRun(state)?workShiftDayLabel(workShiftLedger):'');
  $('#task-limit').textContent=timeAttackSession?'10분 도전':concurrentCaseLimitLabel(state);
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hintCost=d=>({easy:0,normal:5,hard:10}[d]??5);
  if(isTutorial(state)&&isFirstDayTourActive(firstDayTour)){
    panel.querySelector('.case-queue-foot').hidden=true;
    renderCaseListIfChanged(list,renderFirstDayTourCard(firstDayTour));
    panel.classList.remove('task-archived');return;
  }
  if(!active.length) {
    const tutorialDone=showMainStartForTutorial(state);
    renderCaseListIfChanged(list,(tutorialDone?renderTutorialNextStep(state):'<div class="case-all-done">✓ 오늘의 업무 완료!<small>Tab 업무 수첩에서 해결 기록을 확인하세요.</small></div>')+(!isTutorial(state)&&!timeAttackSession?renderLinkedQueue(linkedIncidents):''));
    panel.querySelector('.case-queue-foot').hidden=tutorialDone;
    panel.classList.remove('task-archived');return;
  }
  panel.querySelector('.case-queue-foot').hidden=false;
  renderCaseListIfChanged(list,active.map(index=>{
    const scenario=casePresentation(state,index);
    const incident=state.incidents[index];
    const labels={new:'접수 대기',accepted:'접수 완료',investigating:'조사 중',action_taken:'검증 필요'};
    const p=getProgress(state,index);
    const snapshot=index===state.scenarioIndex?getNetworkSnapshot(state):null;
    const route=snapshot?observedServerRoute(incident,snapshot):null;
    const next=getCaseNextAction(incident,{employee:scenario.npcName,snapshot,route,
      tutorialGoal:isTutorial(state)?getTutorialGoal(state,index):null,security:index>=5});
    const cost=hintCost(difficultyForCase(state,index));
    const selected=state.scenarioIndex===index;
    const waiting=!isTutorial(state)&&!timeAttackSession&&difficultyForCase(state,index)==='hard'?pressureStatus(employeePressure,state.run?.round,scenario):null;
    const hardBrief=!isTutorial(state)&&difficultyForCase(state,index)==='hard';
    const caseDescription=hardBrief&&incident.status!=='new'?'증상과 장비 상태를 비교해 원인을 조사하세요.':next?.description||p.hint;
    const caseActionTitle=hardBrief?'필요한 조사 화면 열기':next?.title;
    const waitingText=waiting?`<span class="employee-waiting stage-${waiting.stage}" aria-label="장애 발생 후 대기 단계">${escape(waiting.stage===3&&waiting.selfActed?(index<5?'직원 임의 조치 시도':'관리자 추가 연락'):PRESSURE_LABELS[waiting.stage])} · 대기 ${Math.floor(waiting.elapsed/60)}분</span>`:'';
    return `<button type="button" class="case-queue-item${selected?' selected':''}${incident.status==='action_taken'?' needs-verification':''}" data-active-case="${index}" aria-pressed="${selected}">
      <span class="case-queue-meta"><span>${escape(caseQueueLabel(state,index))} · ${escape(scenario.department)} · ${escape(scenario.npcName)} · ${escape(scenario.priority)}</span><span class="case-queue-status">${labels[incident.status]??'진행 중'}</span></span>
      <strong>${escape(scenario.title)}</strong>${waitingText}
      <span class="case-queue-hint">${escape(caseDescription)}</span>
      ${renderCaseStageTrack(incident.status)}
      ${!isTutorial(state)&&next?`<span class="case-next-label">🎯 다음 행동 · ${escape(caseActionTitle)}</span>`:''}
      <span class="case-queue-track"><span style="width:${p.step*25}%"></span></span>
    </button>${isTutorial(state)?'':next?.target==='server'?`<button type="button" class="case-quick-action case-server-action" data-case-server="${index}">${escape(next.label)}</button>`:`<button type="button" class="case-quick-action" data-case-quick="${index}" data-next-target="${escape(next?.target||'pc')}">${escape(next?.label||'📍 PC 위치 보기')}</button>`}${isTutorial(state)?renderTutorialGoal(state,index):''}${runMode(state)==='random'?`<button class="case-hint-button" type="button" data-hint-case="${index}">💡 힌트 ${Math.min(2,state.run.hints[scenario.id]||0)}/2 · ${cost?`사용 시 -${cost}점`:'무료'}</button>`:''}`;
  }).join('')+(!isTutorial(state)&&!timeAttackSession?renderLinkedQueue(linkedIncidents):''));
  panel.classList.remove('task-archived');
}
// 저장 형식 v5: 각 직원 사건 활성 목록 + 위치 + 공유 인프라
updateHud();
$('#storage-retry').addEventListener('click',()=>{
  if(save())toast('현재 기록을 다시 저장했습니다.');
});
$('#storage-backup').addEventListener('click',()=>showBackupSettings());
$('#case-list').addEventListener('click',event=>{
  const linked=event.target.closest('button[data-linked-case]');
  if(linked){showLinkedIncidentDetail(linked.dataset.linkedCase);return;}
  if(event.target.closest('button[data-start-main-game]')){
    if(showMainStartForTutorial(state)){audio.play('ui');showDifficultyChoice();}
    return;
  }
  const tourButton=event.target.closest('button[data-first-day-action]');
  if(tourButton){handleFirstDayAction(tourButton.dataset.firstDayAction);return;}
  const tutorialAction=event.target.closest('button[data-tutorial-goal-action]');
  if(tutorialAction){
    const index=Number(tutorialAction.dataset.goalCase);
    if(!Number.isInteger(index)||!state.activeIds.includes(SCENARIOS[index]?.id))return;
    const kind=tutorialAction.dataset.tutorialGoalAction;
    if(kind==='department')showOfficeMap();
    else if(kind==='find-park')showParkLocation();
    else if(kind==='talk')showNpc(SCENARIOS[index].npcId);
    else guideToEmployeeDevice(index,kind==='tower'?'tower':'pc');
    return;
  }
  const quick=event.target.closest('button[data-case-quick]');
  if(quick){
    const index=Number(quick.dataset.caseQuick);
    if(!Number.isInteger(index)||!state.activeIds.includes(SCENARIOS[index]?.id))return;
    const target=quick.dataset.nextTarget;
    if(state.incidents[index].status==='new'||target==='talk')showNpc(SCENARIOS[index].npcId);
    else guideToEmployeeDevice(index,target==='tower'?'tower':'pc');
    return;
  }
  const server=event.target.closest('button[data-case-server]');
  if(server){
    const index=Number(server.dataset.caseServer);
    if(Number.isInteger(index) && state.activeIds.includes(SCENARIOS[index]?.id)){
      selectIncident(state,SCENARIOS[index].npcId);save();guideToServerRoom();
    }
    return;
  }
  const hint=event.target.closest('button[data-hint-case]');
  if(hint){confirmCaseHint(Number(hint.dataset.hintCase));return;}
  const button=event.target.closest('button[data-active-case]');
  if(!button)return;
  const index=Number(button.dataset.activeCase);
  if(!Number.isInteger(index) || !selectIncident(state,SCENARIOS[index]?.npcId))return;
  if(state.incidents[index].status==='new')return showNpc(SCENARIOS[index].npcId);
  guideToEmployeeDevice(index,'pc');
});

function confirmCaseHint(index){
  if(!Number.isInteger(index)||!state.activeIds.includes(SCENARIOS[index]?.id))return;
  const cost=({easy:0,normal:5,hard:10}[difficultyForCase(state,index)]??5);
  const apply=()=>{
    const result=revealHint(state,index);
    if(!result.success){toast(result.message);return;}
    save();audio.play('ui');
    showModal('업무 지원 · 단계별 힌트',`${SCENARIOS[index].npcName} · 힌트 ${result.used}/2`,
      `<p>${result.message}</p><p class="modal-tip">${result.penalty>0?`이번 힌트로 평가 점수에서 ${result.penalty}점이 차감됐어요.`:'쉬움 난이도 · 감점 없음'}</p>`,
      [{label:'업무 계속하기',primary:true,onClick:closeModal}]);
  };
  if(!cost)return apply();
  showModal('💡 힌트 사용 확인',`힌트를 보면 ${cost}점이 차감돼요`,
    `<p>현재 사건의 힌트를 확인하면 <strong>평가 점수에서 ${cost}점</strong>이 차감돼요.</p><p class="modal-tip">무료로 다음 행동만 확인하려면 <b>H 진행 도움말</b>을 사용하세요.</p>`,[
      {label:'취소 · 감점 없음',onClick:closeModal},
      {label:`힌트 사용 (-${cost}점)`,primary:true,onClick:apply},
    ]);
}

// 사건 알림은 저장 데이터에 추가하지 않습니다. 다른 창과 겹치면 닫힌 뒤 한 번 안내합니다.
let intakeTimer=null;
let intakeDockTimer=null;
let intakeFocusTimer=null;
let intakeScheduleTimer=null;
let intakeVisible=false;
let pendingIntakeIndices=[];
let pendingLinkedIntake=[];
function hideIntake(){
  clearTimeout(intakeTimer);clearTimeout(intakeDockTimer);
  intakeTimer=null;intakeDockTimer=null;intakeVisible=false;
  const overlay=$('#case-intake-overlay');if(overlay)overlay.hidden=true;
  $('#case-intake-card')?.classList.remove('docking','time-attack-intake');
  const target=$('#task-card');target?.classList.remove('intake-target','intake-recent');
  clearTimeout(intakeFocusTimer);
  if(pendingIntakeIndices.length||pendingLinkedIntake.length)queueIntakeFlush(250);
}
function highlightCurrentCaseCard(){
  const target=$('#task-card');if(!target||target.hidden)return;
  target.classList.remove('intake-target');
  target.classList.add('intake-recent');
  clearTimeout(intakeFocusTimer);
  intakeFocusTimer=setTimeout(()=>target.classList.remove('intake-recent'),2000);
}
function skipIntakeNotice(){
  if(!intakeVisible)return false;
  if(!timeAttackSession){dockIntake();return true;}
  hideIntake();
  highlightCurrentCaseCard();
  return true;
}
function dockIntake(){
  const overlay=$('#case-intake-overlay');const card=$('#case-intake-card');
  if(!intakeVisible||!overlay||overlay.hidden)return;
  // A second click/keypress during the docking animation skips its remaining delay.
  if(card?.classList.contains('docking')){hideIntake();highlightCurrentCaseCard();return;}
  clearTimeout(intakeTimer);
  const target=$('#task-card');
  if(!target||target.hidden){hideIntake();return;}
  const from=card.getBoundingClientRect(),to=target.getBoundingClientRect();
  const dx=(to.left+to.width/2)-(from.left+from.width/2);
  const dy=(to.top+Math.min(to.height,150)/2)-(from.top+from.height/2);
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!reduced){
    card.style.setProperty('--intake-dx',`${dx}px`);card.style.setProperty('--intake-dy',`${dy}px`);
    card.classList.add('docking');
  }
  target.classList.add('intake-target');
  intakeDockTimer=setTimeout(()=>{
    hideIntake();
    target.classList.add('intake-recent');
    clearTimeout(intakeFocusTimer);
    intakeFocusTimer=setTimeout(()=>target.classList.remove('intake-recent'),3200);
  },reduced?100:intakeDockMs(Boolean(timeAttackSession)));
}
function showIntakeFor(indices){
  if(modalOpen||dialogueOpen||intakeVisible||isShiftAwaitingNextDay())return false;
  // 다른 화면을 거치는 동안 해결된 사건까지 새 접수로 다시 안내하지 않습니다.
  const cases=indices.filter(i=>Number.isInteger(i)&&state.activeIds.includes(state.incidents[i]?.id)&&state.incidents[i]?.status==='new')
    .map(i=>casePresentation(state,i));
  const notice=buildIntakeNotice(cases,{tutorial:isTutorial(state)});
  if(!notice)return true;
  const overlay=$('#case-intake-overlay'),card=$('#case-intake-card');
  card.classList.remove('docking');card.removeAttribute('style');
  card.innerHTML=renderIntakeNotice(notice);
  card.classList.toggle('time-attack-intake',Boolean(timeAttackSession));
  overlay.hidden=false;intakeVisible=true;
  clearTimeout(intakeFocusTimer);$('#task-card')?.classList.remove('intake-recent');
  audio.play('incident');
  intakeTimer=setTimeout(dockIntake,intakeHoldMs(Boolean(timeAttackSession)));
  return true;
}
function showLinkedIntake(){
  if(modalOpen||dialogueOpen||intakeVisible||timeAttackSession||isTutorial(state)||isShiftAwaitingNextDay())return false;
  const items=pendingLinkedIntake.map(id=>linkedIncidents.items.find(x=>x.id===id)).filter(x=>x&&x.verifiedAt===null);
  if(!items.length)return true;
  const overlay=$('#case-intake-overlay'),card=$('#case-intake-card');
  card.classList.remove('docking');card.removeAttribute('style');
  card.innerHTML=renderLinkedNotice(items);card.classList.remove('time-attack-intake');
  overlay.hidden=false;intakeVisible=true;audio.play('incident');
  intakeTimer=setTimeout(dockIntake,intakeHoldMs(false));
  return true;
}
function flushPendingIntake(){
  if(modalOpen||dialogueOpen||intakeVisible||isShiftAwaitingNextDay())return;
  // 기존 직원 신고가 우선이며, 같은 인프라 사건의 다수 신고는 한 번에 안내합니다.
  if(pendingIntakeIndices.length){
    const indices=pendingIntakeIndices;
    if(showIntakeFor(indices))pendingIntakeIndices=[];
    return;
  }
  if(pendingLinkedIntake.length&&showLinkedIntake())pendingLinkedIntake=[];
}
function queueIntakeFlush(delay=220){
  clearTimeout(intakeScheduleTimer);
  intakeScheduleTimer=setTimeout(flushPendingIntake,delay);
}
function scheduleIntake(indices){
  if(!Array.isArray(indices))return;
  pendingIntakeIndices=[...new Set([...pendingIntakeIndices,...indices])];
  // Time-attack does not wait an extra 220ms between the check effect and intake.
  queueIntakeFlush(timeAttackSession?0:220);
}
$('#case-intake-overlay').addEventListener('click',event=>{
  if(event.target.closest('button')||event.target.id==='case-intake-overlay')dockIntake();
});
let toastTimer;
function toast(message) {
  if(modalOpen){
    // 팝업이 열려 있으면 배경의 토스트 대신 해당 팝업 최상위에 알립니다.
    element.toast.classList.remove('visible');
    clearTimeout(toastTimer);
    element.modalFeedback.textContent=message;
    element.modalFeedback.hidden=false;
    return;
  }
  element.toast.textContent=message;
  element.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>element.toast.classList.remove('visible'),3500);
}
const keys=new Set();
let modalOpen=false;
let dialogueOpen=false;
let dialogueHistoryExpanded=false;
let currentDialogueNpcId=null;
let completionEffectPending=false;
// 타임어택에서는 버튼 대기뿐 아니라 해결 후 체크 애니메이션 동안도 시간이 흐르지 않습니다.
let completionTransitionActive=false;
let timeAttackSuccessTimer=null;
function clearTimeAttackSuccessTimer(){clearTimeout(timeAttackSuccessTimer);timeAttackSuccessTimer=null;}
let currentPcView='office';
const overlayOpen=()=>modalOpen||dialogueOpen||intakeVisible||Boolean(document.getElementById('first-day-step-overlay'));
// 각 직원 PC별로 별도 터미널 기록을 유지합니다. 사건과 증거의 영구 저장은 기존 저장 시스템이 담당합니다.
const terminalSessions=new Map();
function getTerminalSession(npcId){
  if(!terminalSessions.has(npcId))terminalSessions.set(npcId,{entries:[],history:[],historyIndex:0});
  return terminalSessions.get(npcId);
}
let releaseEquipmentViewer=()=>{};
let equipmentViewerVisible=false;
function showModal(kicker,title,html,buttons=[],options={}) {
  // 대화 중 게임 메뉴 등을 열면 두 패널이 겹치지 않게 대화를 먼저 닫습니다.
  if(dialogueOpen)closeDialogue();
  releaseEquipmentViewer();releaseEquipmentViewer=()=>{};equipmentViewerVisible=false;
  clearTimeAttackSuccessTimer();
  hideIntake();
  modalOpen=true; keys.clear();
  clearTimeout(toastTimer);
  element.toast.classList.remove('visible');
  element.modalFeedback.hidden=true;
  element.modalFeedback.textContent='';
  const modal=element.backdrop.querySelector('.modal');
  modal.classList.toggle('wide',!!options.wide);
  modal.classList.toggle('lab-workbench',!!options.labWorkbench);
  modal.classList.toggle('network-bench-modal',!!options.networkBench);
  modal.classList.toggle('journal',!!options.journal);
  modal.classList.toggle('pc-modal',!!options.pc);
  modal.classList.toggle('pc-workspace-mode',!!options.pc&&html.includes('class="pc-workspace"'));
  modal.classList.toggle('game-menu',!!options.menu);
  modal.classList.toggle('time-attack-success',!!options.timeAttackSuccess);
  const closeButton=$('#modal-close');
  closeButton.textContent=options.pc?'PC 닫기 ×':'×';
  closeButton.setAttribute('aria-label',options.pc?'PC 닫기 · 사무실로 돌아가기':'창 닫기');
  element.kicker.textContent=kicker;
  element.title.textContent=title;
  element.content.innerHTML=html;
  element.actions.replaceChildren();
  element.actions.hidden=buttons.length===0;
  buttons.forEach(item=>{
    const b=document.createElement('button');
    b.type='button'; b.textContent=item.label;
    b.className=`action-button ${item.primary?'primary':''} ${item.danger?'danger':''}`;
    b.addEventListener('click',()=>{audio.play('ui');item.onClick();});
    element.actions.appendChild(b);
  });
  element.backdrop.hidden=false;
  if(options.modelSession){
    releaseEquipmentViewer=mountEquipmentViewer(element.content,options.modelSession);
  }else if(options.modelKind){
    releaseEquipmentViewer=mountEquipmentViewer(element.content,{kind:options.modelKind});
  }
  equipmentViewerVisible=Boolean(element.content.querySelector('.it-lab-model-ready'));
  element.targetSpotlight.hidden=true;
  element.interaction.hidden=true;
  $('#modal-close').focus();
}
function closeModal() {
  clearTimeAttackSuccessTimer();
  releaseEquipmentViewer();releaseEquipmentViewer=()=>{};equipmentViewerVisible=false;
  // DNS 변경 확인에서 X/Esc를 눌러도 PC 조사를 잃지 않고 이전 설정 화면으로 복귀합니다.
  if(currentPcView==='dns-confirm')return showPcNetwork();
  if(currentPcView==='first-day-intro')currentPcView='office';
  // 마친 근무의 모달을 X/Esc/배경으로 닫아도 저장된 사건이 재활성화되지 않습니다.
  if(isShiftAwaitingNextDay()){showStartMenu();return;}
  if(timeAttackSession?.paused){timeAttackSession=setTimeAttackPaused(timeAttackSession,false);timeAttackLastStamp=null;save({refreshHud:false});}
  modalOpen=false;
  element.backdrop.hidden=true;
  element.modalFeedback.hidden=true;
  element.modalFeedback.textContent='';
  if(highlightedDevice)element.targetSpotlight.hidden=false;
  // 완료 모달 뒤에서 연출이 끝나는 일을 방지합니다.
  // 사용자가 사무실로 돌아올 때 체크 배지를 한 번만 보여줍니다.
  if (completionEffectPending) {
    completionEffectPending=false;
    world.beginCompletionEffect(state,{quick:Boolean(timeAttackSession)});
  }
  if(pendingIntakeIndices.length||pendingLinkedIntake.length)queueIntakeFlush();
}
function showDialogue(kicker,title,html,buttons=[],{npcId=null,historyHtml=''}={}) {
  hideIntake();
  // 다른 직원의 기록이 이전 직원 화면에 남지 않도록 분리합니다.
  if(npcId!==currentDialogueNpcId){dialogueHistoryExpanded=false;currentDialogueNpcId=npcId;}
  const wasOpen=dialogueOpen;
  dialogueOpen=true; keys.clear();
  clearTimeout(toastTimer);
  element.toast.classList.remove('visible');
  element.dialogueKicker.textContent=kicker;
  element.dialogueTitle.textContent=title;
  element.dialogueContent.innerHTML=html;
  element.dialogueActions.replaceChildren();
  buttons.forEach(item=>{
    const b=document.createElement('button');
    b.type='button'; b.textContent=item.label;
    b.className=`action-button ${item.primary?'primary':''} ${item.danger?'danger':''}`;
    b.addEventListener('click',()=>{audio.play('ui');item.onClick();});
    element.dialogueActions.appendChild(b);
  });
  element.dialogueHistoryContent.innerHTML=historyHtml;
  element.dialogueHistoryButton.hidden=!npcId;
  element.dialogueHistory.hidden=!dialogueHistoryExpanded||!npcId;
  element.dialogueHistoryButton.setAttribute('aria-expanded',String(dialogueHistoryExpanded&&!!npcId));
  element.targetSpotlight.hidden=true;
  element.dialoguePanel.hidden=false;
  document.body.classList.add('dialogue-active');
  element.interaction.hidden=true;
  // 질문을 연속 선택할 때 포커스가 매번 X로 뛰지 않게 합니다.
  if(!wasOpen)$('#dialogue-close').focus();
}
function closeDialogue() {
  const wasParkIntro=dialogueOpen&&currentDialogueNpcId==='park'&&getDnsTutorialStep(state)===3&&
    state.incidents[2].actions.includes('직원 대화: intro');
  // NPC 대화가 닫히는 순간에만 4/9를 완료합니다. 열자마자 다음 임무로 넘어가지 않습니다.
  const finishedKimConversation=dialogueOpen&&currentDialogueNpcId==='kim'&&
    isTutorial(state)&&currentFirstDayStep(firstDayTour)?.id==='talk'&&
    state.incidents?.[SCENARIOS.findIndex(item=>item.npcId==='kim')]?.actions?.includes('직원 대화: intro');
  dialogueOpen=false;
  dialogueHistoryExpanded=false;
  currentDialogueNpcId=null;
  element.dialoguePanel.hidden=true;
  element.dialogueHistory.hidden=true;
  document.body.classList.remove('dialogue-active');
  if(highlightedDevice)element.targetSpotlight.hidden=false;
  if(finishedKimConversation&&tourAction('talk'))guideToEmployeeDevice(SCENARIOS.findIndex(item=>item.npcId==='kim'),'pc');
  if(wasParkIntro)dnsAction('dialogue-closed',{introHeard:true});
  if(pendingIntakeIndices.length||pendingLinkedIntake.length)queueIntakeFlush();
}
element.dialogueHistoryButton.addEventListener('click',()=>{
  if(!dialogueOpen)return;
  dialogueHistoryExpanded=!dialogueHistoryExpanded;
  element.dialogueHistory.hidden=!dialogueHistoryExpanded;
  element.dialogueHistoryButton.setAttribute('aria-expanded',String(dialogueHistoryExpanded));
  audio.play('ui');
  if(dialogueHistoryExpanded)element.dialogueHistory.scrollTop=element.dialogueHistory.scrollHeight;
});
$('#modal-close').addEventListener('click',()=>{audio.play('ui');closeModal();});
$('#dialogue-close').addEventListener('click',()=>{audio.play('ui');closeDialogue();});
element.backdrop.addEventListener('pointerdown',e=>{if(e.target===element.backdrop)closeModal();});
const soundButton = $('#btn-sound');
function updateSoundButton() {
  const {enabled,musicVolume,effectsVolume} = audio.getSettings();
  const on=enabled && (musicVolume>0 || effectsVolume>0);
  soundButton.textContent=on?'🔊':'🔇';
  soundButton.classList.toggle('is-muted',!on);
  soundButton.setAttribute('aria-pressed',String(on));
  soundButton.setAttribute('aria-label',on?'게임 소리 끄기':'게임 소리 켜기');
  soundButton.title=on?'소리 끄기 (설정에서 음량 조절 가능)':'소리 켜기';
}
updateSoundButton();
soundButton.addEventListener('click',()=>{
  audio.toggleEnabled(); updateSoundButton();
  if(audio.getSettings().enabled) audio.play('ui');
  toast(audio.getSettings().enabled?'게임 소리를 켰어요.':'게임 소리를 껐어요.');
});
$('#btn-menu').addEventListener('click',()=>{audio.play('ui');showMenu();});
$('#btn-map').addEventListener('click',()=>{
  if(overlayOpen()||isShiftAwaitingNextDay()||completionTransitionActive||completionEffectPending||pendingIntakeIndices.length)return;
  audio.play('ui');showOfficeMap();
});
$('#btn-finish-shift').addEventListener('click',()=>{if(!isShiftAwaitingNextDay()&&isContinuousRun(state)){
  audio.play('ui');confirmFinishWorkShift();
}});
$('#btn-resume-work').addEventListener('click',()=>{
  if(!hasSavedRandomGame())return;
  audio.play('ui');setPlayMode('random',{reset:false});
});
window.addEventListener('keydown',event=>{
  const key=event.key.toLowerCase();
  const gameCommand=gameControlForKey(key,{dialogueOpen,overlayOpen:overlayOpen(),repeat:event.repeat});
  // 팝업 내부에서는 Tab/Space/방향키를 UI 조작에 사용할 수 있게 유지합니다.
  if (!overlayOpen() && ['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key)) event.preventDefault();
  if(gameCommand==='dialogue-close') {event.preventDefault();audio.play('ui');closeDialogue();return;}
  // 짧은 안내는 마우스 없이도 즉시 넘길 수 있습니다. 실제 점검/선택창은 제외합니다.
  if(!event.repeat&&(key==='enter'||key===' ')){
    if(intakeVisible){event.preventDefault();skipIntakeNotice();return;}
    if(timeAttackSession&&modalOpen&&currentPcView==='success'){
      event.preventDefault();skipTimeAttackCaseTransition();return;
    }
  }
  if(key==='escape') {
    event.preventDefault();
    if(event.repeat)return;
    if(timeAttackSession&&modalOpen&&currentPcView==='success'){skipTimeAttackCaseTransition();return;}
    if(intakeVisible){skipIntakeNotice();return;}
    const action=escapeMenuAction({dialogueOpen,modalOpen,currentPcView,shiftAwaitingNextDay:isShiftAwaitingNextDay()});
    if(action==='close-dialogue')closeDialogue();
    else if(action==='pc-desktop')showPc();
    else if(action==='pc-root')showPcFront();
    else if(action==='server-root')showServer();
    else if(action==='lab-hub')showPracticeHub();
    else if(action==='server-lab-hub')showServerLabHub();
    else if(action==='close-modal')closeModal();
    else if(action==='start-menu')showStartMenu();
    else if(action==='open-menu'){audio.play('ui');showMenu();}
    return;
  }
  // ESC는 언제든 안전하게 종료할 수 있지만, 다른 입력은 해당 실습의 허용 동작만 전달합니다.
  if(isTutorial(state)&&isFirstDayTourActive(firstDayTour)&&!overlayOpen()&&!['shift','control','alt','meta'].includes(key)){
    const action=['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)?'move':
      ['camera-left','camera-right','camera-reset'].includes(gameCommand)?'camera':
      gameCommand==='interact'?(closest?.id?.startsWith('npc:')?`npc:${closest.id.slice(4)}`:
        closest?.id?.startsWith('pc:')?`pc:${closest.id.slice(3)}`:'unknown'):
      gameCommand==='tower'?'pc:tower':gameCommand==='help'?'help':
      gameCommand==='map'?'world:map':key==='tab'?'unknown':null;
    if(action&&blockFirstDayInput(action)){event.preventDefault();return;}
  }
  if(isShiftAwaitingNextDay()){event.preventDefault();if(!modalOpen)showStartMenu();return;}
  if(timeAttackSession?.paused&&!modalOpen&&!dialogueOpen){event.preventDefault();showTimeAttackPause();return;}
  if(key==='tab') { if(!overlayOpen()) {event.preventDefault();showJournal();} return; }
  if(dialogueOpen&&['1','2','3'].includes(key)&&!event.repeat){
    event.preventDefault();
    element.dialogueActions.children[Number(key)-1]?.click();
    return;
  }
  if (overlayOpen()) return;
  if(gameCommand==='interact') {event.preventDefault();interact();return;}
  if(gameCommand==='tower') {event.preventDefault();interactTower();return;}
  if(gameCommand==='help') {event.preventDefault();showHelp();return;}
  if(gameCommand==='map') {event.preventDefault();audio.play('ui');showOfficeMap();return;}
  if(['camera-left','camera-right','camera-reset'].includes(gameCommand)){
    event.preventDefault();
    cameraQuarterTurn=gameCommand==='camera-reset'?0:normalizeCameraTurn(cameraQuarterTurn+(gameCommand==='camera-left'?-1:1));
    const next=rotatedCameraOffset(baseCameraOffset,cameraQuarterTurn);
    cameraOffset.set(next.x,next.y,next.z);
    audio.play('ui');
    toast(gameCommand==='camera-reset'?'기본 카메라 시점으로 돌아왔어요.':'시점이 회전했어요. C키로 기본 시점에 복귀할 수 있어요.');
    return;
  }
  keys.add(key);
});
window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
window.addEventListener('blur',()=>keys.clear());

const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.25;
element.game.appendChild(renderer.domElement);
const scene=new THREE.Scene();
world=createWorld(scene);
// 첫 출근 걷기 목표. 기존 게임 맵이나 충돌 판정에는 영향을 주지 않는 시각 마커.
const tourWalkMarker=new THREE.Mesh(new THREE.RingGeometry(.40,.57,40),new THREE.MeshBasicMaterial({color:0x2385dd,side:THREE.DoubleSide,transparent:true,opacity:.88,depthWrite:false}));
tourWalkMarker.rotation.x=-Math.PI/2;tourWalkMarker.renderOrder=9;scene.add(tourWalkMarker);
// 직원 대상은 화면 가장자리 텍스트보다 실제 3D 발밑에 강조 링을 둡니다.
const tourNpcMarker=new THREE.Mesh(new THREE.RingGeometry(.48,.67,48),new THREE.MeshBasicMaterial({color:0xffc44e,side:THREE.DoubleSide,transparent:true,opacity:.98,depthWrite:false,depthTest:false}));
tourNpcMarker.rotation.x=-Math.PI/2;tourNpcMarker.renderOrder=10;tourNpcMarker.visible=false;scene.add(tourNpcMarker);
const tourRouteLine=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:0xe8ad30,dashSize:.4,gapSize:.25,transparent:true,opacity:.9,depthTest:false}));
tourRouteLine.renderOrder=8;tourRouteLine.visible=false;scene.add(tourRouteLine);showTourWalkMarker();
for(const person of SCENARIOS){
  const stage=pressureStatus(employeePressure,state.run?.round,person).stage;
  if(stage>=1){const head=world.npcModels?.[person.npcId]?.userData?.head?.material;
    if(head)head.color.set(stage===3?'#ed948d':stage===2?'#f6b5ac':'#f9ddd0');}
}
// 이전 버전에서 저장한 캐릭터 좌표가 가구 안이라면 가까운 안전 위치로 옮깁니다.
// 진행 기록은 그대로 두고 좌표만 보정합니다.
const spawn=restoreWalkablePosition(state.player,world.isBlocked);
world.player.position.set(spawn.x,0,spawn.z);
world.updateServerAccess(spawn.x,spawn.z); // 기존 서버실 내부 저장 위치의 퇴실 경로 보장
save({refreshHud:false});

const camera=new THREE.OrthographicCamera(-10,10,7,-7,.1,100);
const baseCameraOffset=new THREE.Vector3(12,16,18);
const cameraOffset=baseCameraOffset.clone();
const currentCameraOffset=baseCameraOffset.clone();
let cameraQuarterTurn=0;
const focus=new THREE.Vector3();
const cameraTarget=new THREE.Vector3();
const spotlightMarker=new THREE.Vector3();
let highlightedDevice=null;
const SPOTLIGHT_FOCUS_MS=3500;
// PC 이름표는 일회성 타이머가 아니라 현재 목표가 유지되는 동안 표시합니다.
function clearDeviceGuide(){
  highlightedDevice=null;
  element.targetSpotlight.hidden=true;
}
function guideToEmployeeDevice(index,kind='pc'){
  if(overlayOpen())return;
  const scenario=SCENARIOS[index];
  if(!scenario || !state.activeIds.includes(scenario.id))return;
  if(state.incidents[index].status==='new')return showNpc(scenario.npcId);
  selectIncident(state,scenario.npcId);save();audio.play('inspect');
  const id=`${kind==='tower'?'cable':'pc'}:${scenario.npcId}`;
  const target=world.interactables.find(item=>item.id===id);
  if(!target)return;
  const dist=world.player.position.distanceTo(target.position);
  // 근거리에서는 미션 대상의 PC를 바로 열 수 있습니다. 물리적 케이블 조작은 현장에서만 가능.
  if(dist<=target.radius){
    if(kind==='tower')showChassis(scenario.npcId);
    else showPcFront(scenario.npcId);
    return;
  }
  const now=performance.now();
  highlightedDevice={id,index,npcId:scenario.npcId,kind,position:target.position.clone(),focusUntil:now+SPOTLIGHT_FOCUS_MS};
  element.targetSpotlight.textContent=kind==='tower'?`🔧 ${scenario.npcName} PC 본체 · 파란 링 위치 (F로 조사)`:`📍 ${scenario.npcName} PC 책상 · 파란 표시를 따라 이동하세요`;
  element.targetSpotlight.hidden=false;
  toast(kind==='tower'?`${scenario.npcName} PC 본체 위치예요. 가까이 가서 F를 누르거나 본체를 클릭하세요.`:`${scenario.npcName} PC 책상 위치예요. 가까이 가서 R을 누르면 모니터와 본체를 한 번에 선택할 수 있어요.`);
}
/** 첫 시작에만 중앙 안내. 이후에는 실제 대상 강조와 지연 문구로 진행합니다. */
function showFirstDayStepIntro(){
  if(!isTutorial(state)||!needsFirstDayStepIntro(firstDayTour))return;
  let overlay=document.getElementById('first-day-step-overlay');
  if(overlay?.dataset.step===String(firstDayTour.step))return;
  overlay?.remove();
  overlay=document.createElement('div');
  overlay.id='first-day-step-overlay';
  overlay.className='first-day-step-overlay';
  overlay.dataset.step=String(firstDayTour.step);
  overlay.innerHTML=`<div class="first-day-step-dialog" role="dialog" aria-modal="true" aria-labelledby="first-day-step-title">
    ${renderFirstDayStepIntro(firstDayTour)}
    <div class="first-day-step-footer"><button type="button" class="first-day-step-ack" data-first-day-step-ack>알겠어요 · 직접 해보기</button></div>
  </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('first-day-step-intro-active');
  keys.clear();tourIdleSeconds=0;tourIdlePhase=0;
  const button=overlay.querySelector('[data-first-day-step-ack]');
  const dismiss=()=>{
    if(!overlay.isConnected)return;
    if(isTutorial(state)&&String(firstDayTour.step)===overlay.dataset.step){
      firstDayTour=acknowledgeFirstDayStepIntro(firstDayTour);
      storeFirstDayTour();
    }
    overlay.remove();document.body.classList.remove('first-day-step-intro-active');
    if(modalOpen)element.content.querySelector('button:enabled, input:not([disabled])')?.focus();
    else if(dialogueOpen)element.dialogueActions.querySelector('button')?.focus();
    else document.activeElement?.blur?.();
  };
  button.addEventListener('click',()=>{audio.play('ui');dismiss();});
  overlay.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismiss();}
    else if(event.key==='Tab'){event.preventDefault();event.stopPropagation();button.focus();}
    else event.stopPropagation();
  });
  // PC의 showModal()이 뒤이어 닫기 버튼을 포커스해도 안내 팝업이 포커스를 되찾습니다.
  queueMicrotask(()=>{if(overlay.isConnected)button.focus();});
}
function showFirstDayStartIntro(){
  if(!isTutorial(state)||currentFirstDayStep(firstDayTour)?.id!=='map')return;
  showFirstDayStepIntro();
}
/** 실제 입력이 멈췄을 때만 힌트를 가볍게 보여줍니다. 진행 단계 자체는 변경하지 않습니다. */
function updateFirstDayIdleCue(activeDelta){
  const step=isTutorial(state)?currentFirstDayStep(firstDayTour):null;
  const workspace=element.content?.querySelector('.pc-workspace');
  const practicingInPc=modalOpen&&Boolean(workspace)&&['monitor','network','tower','command','hint'].includes(step?.id);
  // 튜토리얼 PC 자체가 열린 경우만 시간 누적을 허용하고, 그 외 모달/대화/숨김 탭은 일시정지합니다.
  if(!step||document.hidden||dialogueOpen||intakeVisible||document.getElementById('first-day-step-overlay')||(modalOpen&&!practicingInPc))tourIdleSeconds=0;
  else tourIdleSeconds=Math.min(30,tourIdleSeconds+Math.min(Math.max(activeDelta,0),1));
  const phase=tourIdleSeconds>=6?2:tourIdleSeconds>=3?1:0;
  tourIdlePhase=phase;
  const card=document.querySelector('.first-day-tour-card');
  if(card&&card.dataset.tourIdle!==String(phase))card.dataset.tourIdle=String(phase);
  if(workspace&&workspace.dataset.tourIdle!==String(phase))workspace.dataset.tourIdle=String(phase);
}
function handleFirstDayAction(action){
  if(!isTutorial(state)||!isFirstDayTourActive(firstDayTour))return;
  const step=currentFirstDayStep(firstDayTour)?.id;
  if(action==='restart'){
    showModal('튜토리얼 · 다시 안내','조작 연습을 처음부터 다시 시작할까요?',
      '<p>튜토리얼 2건의 진행 상태도 처음부터 다시 시작합니다. 본 게임의 업무 기록은 유지됩니다.</p>',[
        {label:'취소',onClick:closeModal},
        {label:'조작 연습 다시 시작',primary:true,onClick:()=>setPlayMode('tutorial',{reset:true})},
      ]);return;
  }
  // 부서명은 3D 공간에서 직접 클릭해야 합니다. 튜토리얼 버튼으로 단계를 건너뛰지 않습니다.
  if(action==='find'&&step==='find'){
    if(findFocusUntil)return;
    const target=world.interactables.find(item=>item.id==='npc:kim')||world.interactables.find(item=>item.id==='pc:kim');
    if(!target)return toast('김대리 위치를 찾지 못했어요.');
    // 카메라가 실제 김대리 좌표를 비추는 동안 2/9를 유지합니다.
    const origin={x:world.player.position.x,z:world.player.position.z};
    firstDayTour={...firstDayTour,walkStart:origin,walkTarget:employeeWalkTarget(target.position),walkDistance:0};
    tourWalkingRoute=buildTutorialWalkRoute(origin,firstDayTour.walkTarget,world.isBlocked);
    findFocusUntil=performance.now()+2300;
    highlightedDevice={id:target.id,index:0,npcId:'kim',kind:'find',position:target.position.clone(),focusUntil:findFocusUntil+500};
    element.targetSpotlight.textContent='📍 김대리 · 여기서 직접 걸어가세요';element.targetSpotlight.hidden=false;
    storeFirstDayTour();showTourWalkMarker();updateHud();
    const findButton=document.querySelector('[data-first-day-action="find"]');
    if(findButton){findButton.disabled=true;findButton.textContent='김대리 위치 확인 중…';}
    toast('김대리 위치를 보여드릴게요. 표시된 직원의 위치를 확인하세요.');return;
  }
  if(action==='talk'&&step==='talk')return showNpc('kim');
  if(action==='pc'&&step==='monitor'){
    if(modalOpen&&currentPcView==='pc-root'){
      const monitor=element.content.querySelector('[data-pc-front-action="monitor"]');
      monitor?.focus();monitor?.scrollIntoView({block:'nearest'});return;
    }
    return guideToEmployeeDevice(0,'pc');
  }
  if(action==='tower'&&step==='tower'){
    if(modalOpen&&['pc-root','desktop','network','browser','terminal'].includes(currentPcView))return showPcFront('kim');
    const target=world.interactables.find(item=>item.id==='pc:kim');
    if(target&&world.player.position.distanceTo(target.position)<=target.radius)return showPcFront('kim');
    return guideToEmployeeDevice(0,'pc');
  }
  if(action==='terminal'&&step==='command'){
    if(modalOpen&&['pc-root','desktop','network','browser','chassis'].includes(currentPcView))return showPcTerminal();
    return guideToEmployeeDevice(0,'pc');
  }
  if(action==='hint'&&step==='verify')return showHelp();
}
function showTourWalkMarker(){
  if(!tourWalkMarker)return;
  const target=isTutorial(state)&&['find','walk'].includes(currentFirstDayStep(firstDayTour)?.id)?firstDayTour.walkTarget:null;
  tourWalkMarker.visible=Boolean(target);
  if(target)tourWalkMarker.position.set(target.x,.065,target.z);
  if(target){
    if(!tourWalkingRoute)tourWalkingRoute=buildTutorialWalkRoute(firstDayTour.walkStart,target,world.isBlocked);
    const points=tourWalkingRoute;
    if(points?.length>1){
      tourRouteLine.geometry.dispose();
      tourRouteLine.geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(p.x,.045,p.z)));
      tourRouteLine.computeLineDistances();tourRouteLine.visible=true;
    }else tourRouteLine.visible=false;
  }else tourRouteLine.visible=false;
}
function hideTourWalkMarker(){if(tourWalkMarker)tourWalkMarker.visible=false;tourRouteLine.visible=false;tourWalkingRoute=null;}
function checkFirstDayWalking(){
  if(!isTutorial(state)||currentFirstDayStep(firstDayTour)?.id!=='walk')return;
  if(!firstDayTour.walkStart){
    const origin={x:world.player.position.x,z:world.player.position.z};
    const npc=world.interactables.find(item=>item.id==='npc:kim');
    firstDayTour={...firstDayTour,walkStart:origin,walkTarget:employeeWalkTarget(npc?.position),walkDistance:0};
    storeFirstDayTour();showTourWalkMarker();return;
  }
  if(reachedWalkTarget(firstDayTour,world.player.position)){
    // 실제 단계 전환 이벤트는 'walked'입니다. 성공한 경우에만 목표 원을 지웁니다.
    const advanced=tourAction('walked');
    if(advanced&&currentFirstDayStep(firstDayTour)?.id!=='walk'){
      hideTourWalkMarker();
      toast('김대리에게 도착했어요! 이제 직원과 대화해 증상을 접수해 보세요.');
    }else showTourWalkMarker();
  }
}
function guideToServerRoom(){
  if(modalOpen){modalOpen=false;element.backdrop.hidden=true;}
  currentPcView='office';
  const target=world.interactables.find(item=>item.id==='server');
  if(!target){toast('서버실 위치를 찾지 못했어요.');return;}
  if(world.player.position.distanceTo(target.position)<=target.radius){showServer();return;}
  const now=performance.now();
  highlightedDevice={id:'server',index:state.scenarioIndex,npcId:employee().npcId,
    kind:'server',position:target.position.clone(),focusUntil:now+SPOTLIGHT_FOCUS_MS};
  element.targetSpotlight.textContent='🖧 서버실 · 파란 표시를 따라 이동하세요 (R로 장비 점검)';
  element.targetSpotlight.hidden=false;
  toast('서버실 위치를 표시했어요. 가까이 이동해 R로 장비를 조사하세요.');
}

function showItConsole(){
  currentPcView='it-console';audio.play('inspect');
  showModal('🛠 전산실 · 내 PC','전산 운영 콘솔',renderItOperations(state,practiceProgress,labReports)+infrastructurePane('it')+'<button type="button" class="it-lab-option" data-linked-report-open>통합 장애 신고·사고 이력 보기</button>',[
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true,pc:true});
}
// 실습 성적은 별도 저장하고, 보통·어려움의 실제 조작 영향만 공유 가상 인프라에 전달합니다.
let practiceProgress=readPracticeProgress(readSetting(PRACTICE_PROGRESS_KEY));
// v1.7.0: 사용자가 선택하는 하나의 난이도를 게임·전산실·서버실이 공유합니다.
// 기존 저장값은 처음 한 번 이전하며, 이미 접수된 사건·오늘의 과제는 변경하지 않습니다.
let unifiedDifficulty=resolveUnifiedDifficulty({saved:readSetting(UNIFIED_DIFFICULTY_KEY),
  game:hasSavedRandomGame()?safeLoad(readSetting(RANDOM_STORAGE_KEY)).run.difficulty:null,
  lab:readSetting(IT_LAB_DIFFICULTY_KEY)});
let labDifficulty=unifiedDifficulty;
let sharedInfrastructure=readSharedInfrastructure(readSetting(SHARED_INFRASTRUCTURE_KEY));
// 최초 업그레이드 시 기존에 발생했던 장애를 새 신고로 소급 생성하지 않습니다.
linkedIncidents=readLinkedIncidents(readSetting(LINKED_INCIDENTS_KEY),sharedInfrastructure.revision);
employeePressure=readEmployeePressure(readSetting(EMPLOYEE_PRESSURE_KEY));
function persistEmployeePressure(){try{localStorage.setItem(EMPLOYEE_PRESSURE_KEY,JSON.stringify(employeePressure));}
  catch{showStorageWarning('직원 대기 상태');}}
// 활성 플레이 시간만 누적. 숨김 탭, 튜토리얼, 타임어택, 근무 종료, 독립 실습은 중지합니다.
let pressureSecondAccumulator=0,pressureSaveAccumulator=0,pressureHudAccumulator=0;
function tickEmployeePressure(delta){
  const activeWorkViews=['pc-root','desktop','network','browser','terminal','chassis','switch','dhcp','web','serverhub','security','mail','mail-detail','linked-incident','router','dns-confirm','it-console','journal','office-map'];
  if(document.hidden||timeAttackSession||!isContinuousRun(state)||isShiftAwaitingNextDay()||
    (modalOpen&&!activeWorkViews.includes(currentPcView)))return;
  pressureSecondAccumulator+=delta;
  if(pressureSecondAccumulator<1)return;
  const seconds=Math.min(pressureSecondAccumulator,3);pressureSecondAccumulator=0;
  const current=activeCaseIndices(state).map(i=>({...SCENARIOS[i],status:state.incidents[i]?.status,
    difficulty:difficultyForCase(state,i),network:i<5}));
  const result=advanceEmployeePressure(employeePressure,current,{round:state.run?.round,deltaSeconds:seconds});
  employeePressure=result.ledger;pressureSaveAccumulator+=seconds;pressureHudAccumulator+=seconds;
  // 접수 대기 사건도 발생 시점부터 대기를 누적하고 카드에 실시간 표시합니다.
  if(pressureHudAccumulator>=20){updateHud();pressureHudAccumulator=0;}
  if(pressureSaveAccumulator>=15){persistEmployeePressure();pressureSaveAccumulator=0;}
  if(result.events.length){
    for(const ev of result.events){
      const staff=SCENARIOS.find(x=>x.id===ev.id);if(!staff)continue;
      const mood=world?.npcModels?.[staff.npcId]?.userData?.head?.material;
      if(mood)mood.color.set(ev.stage===3?'#ed948d':ev.stage===2?'#f6b5ac':ev.stage===1?'#f9ddd0':'#fff7ef');
      if(ev.type==='self-action'&&ev.port){
        const available=infrastructureStatus(sharedInfrastructure).employees[ev.port-1]?.link;
        if(available){
          syncSharedInfrastructure(applyEmployeeAdapterImpact(sharedInfrastructure,ev.port,false));
          toast(`${staff.department} ${staff.npcName}: 오래 기다린 뒤 PC 어댑터를 직접 껐습니다. 기존 장애와 추가 장애를 함께 점검하세요.`);
        }else toast(`${staff.department} ${staff.npcName}: 직원의 임의 조치 시도가 기록됐습니다. 현재 네트워크 상태부터 확인하세요.`);
      }else if(ev.type==='escalation')toast(`${staff.department} ${staff.npcName}: 대기가 길어져 관리 담당자에게 추가 연락했습니다.`);
      else if(ev.stage>=2&&ev.stage>ev.previousStage)toast(`${staff.department} ${staff.npcName}이(가) 처리가 늦어져 불만을 표시합니다.`);
    }
    persistEmployeePressure();updateHud();
  }
}
updateHud();
function persistLinkedIncidents(){
  try{localStorage.setItem(LINKED_INCIDENTS_KEY,JSON.stringify(linkedIncidents));}
  catch{showStorageWarning('연동 장애 신고');}
}
function refreshLinkedIncidents(){
  persistLinkedIncidents();
  if(!timeAttackSession&&!isTutorial(state))updateHud();
}
function persistSharedInfrastructure(){
  try{localStorage.setItem(SHARED_INFRASTRUCTURE_KEY,JSON.stringify(sharedInfrastructure));}
  catch{showStorageWarning('가상 인프라 상태');}
}
function syncSharedInfrastructure(next){
  if(next.revision===sharedInfrastructure.revision)return;
  const before=sharedInfrastructure;
  const changes=reconcileLinkedIncidents(linkedIncidents,before,next,{difficulty:unifiedDifficulty,
    source:next.events.at(-1)?.area||'unknown'});
  sharedInfrastructure=next;persistSharedInfrastructure();
  linkedIncidents=changes.ledger;
  if(changes.created.length){
    pendingLinkedIntake=[...new Set([...pendingLinkedIntake,...changes.created.map(x=>x.id)])];
    queueIntakeFlush();
  }
  if(changes.created.length||changes.recovered.length){refreshLinkedIncidents();}
}
function setUnifiedDifficulty(choice){
  if(!validUnifiedDifficulty(choice))return false;
  unifiedDifficulty=choice;labDifficulty=choice;
  try{localStorage.setItem(UNIFIED_DIFFICULTY_KEY,choice);localStorage.setItem(IT_LAB_DIFFICULTY_KEY,choice);}
  catch{showStorageWarning('통합 난이도');}
  if(isContinuousRun(state)&&!timeAttackSession&&setRunDifficulty(state,choice)){
    if(!workShiftLedger)workShiftLedger=newWorkShiftLedger(state);
    workShiftLedger=recordWorkShiftDifficulty(workShiftLedger,choice);
    persistShiftLedger();save();
  }
  return true;
}
function showLinkedIncidentDetail(id){
  const item=linkedIncidents.items.find(x=>x.id===id);
  if(!item){toast('연동 장애 신고를 찾을 수 없습니다.');return;}
  currentPcView='linked-incident';
  showModal('고쳐라! · 통합 장애 신고','직원 연동 사건',renderLinkedDetail(item,{shared:sharedInfrastructure}),[
    ...(item.acceptedAt===null&&item.verifiedAt===null?[{label:'관련 직원과 대화·신고 접수',onClick:()=>{
      const owner=SCENARIOS.find(x=>x.port===item.ports[0]);
      closeModal();if(owner)showNpc(owner.npcId);
    }}]:[]),
    {label:'통합 사고 이력',onClick:showLinkedIncidentReport},
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true});
}
function showLinkedIncidentReport(){
  currentPcView='linked-report';
  showModal('고쳐라! · 통합 인프라','연관 사고 보고서',renderLinkedReport(linkedIncidents),[
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true});
}
function acceptEmployeeLinkedReports(port){
  const tickets=linkedIncidentsForEmployee(linkedIncidents,port);
  const pending=tickets.filter(item=>item.acceptedAt===null);
  // 이미 접수한 신고를 다시 읽을 때는 localStorage 저장과 HUD 재생성을 건너뜁니다.
  if(!pending.length)return tickets;
  for(const item of pending)linkedIncidents=acknowledgeLinkedIncident(linkedIncidents,item.id,{port}).ledger;
  refreshLinkedIncidents();
  return linkedIncidentsForEmployee(linkedIncidents,port);
}
// 신고 접수·재검증 버튼은 실제 상태만 읽으며, 원래 직원 사건/점수는 변경하지 않습니다.
element.content.addEventListener('click',event=>{
  const report=event.target.closest('button[data-linked-report-open]');
  if(report){showLinkedIncidentReport();return;}
  const selected=event.target.closest('button[data-linked-case]');
  if(selected){showLinkedIncidentDetail(selected.dataset.linkedCase);return;}
  const verifyButton=event.target.closest('button[data-linked-verify]');
  if(verifyButton){
    const result=verifyLinkedIncident(linkedIncidents,verifyButton.dataset.linkedVerify,sharedInfrastructure);
    linkedIncidents=result.ledger;
    if(result.success){refreshLinkedIncidents();audio.play('success');showLinkedIncidentDetail(verifyButton.dataset.linkedVerify);}
    else toast(result.message);
  }
});
const infrastructurePane=(area='all',compact=false)=>renderSharedInfrastructure(sharedInfrastructure,{difficulty:unifiedDifficulty,area,compact});
const employeePort=()=>SCENARIOS[state.scenarioIndex]?.port??1;
const sharedPcFailure=(portal=false)=>timeAttackSession?'':sharedConnectivityFailure(sharedInfrastructure,employeePort(),{portal});
function employeeSharedSnapshot(snapshot){
  const linkError=sharedPcFailure(false),portalError=sharedPcFailure(true);
  if(!portalError)return snapshot;
  if(linkError)return {...snapshot,connected:false,networkReachable:false,reachable:false,
    linkLabel:'공용 스위치 포트 연결 끊김',internet:'공용 인프라에서 유선 링크가 끊겼습니다.'};
  return {...snapshot,reachable:false,serviceRunning:false,
    internet:'공용 웹 서비스 장애 · 서버실 상태를 확인하세요.'};
}
function syncEmployeeSharedStatus(){
  if(timeAttackSession||isTutorial(state))return;
  const n=getNetworkSnapshot(state);
  syncSharedInfrastructure(applyEmployeePcImpact(sharedInfrastructure,employeePort(),Boolean(n.connected&&n.hasIp&&!n.ipConflict&&n.gatewayGood),{difficulty:unifiedDifficulty}));
}
let labReports=readLabReports(readSetting(IT_LAB_REPORTS_KEY));
let labDaily=readDailyLabTask(readSetting(IT_LAB_DAILY_KEY));
let labStats=readLabLearningStats(readSetting(IT_LAB_STATS_KEY));
function persistLabDaily(){
  try{localStorage.setItem(IT_LAB_DAILY_KEY,JSON.stringify(labDaily));}
  catch{showStorageWarning('오늘의 전산실 과제');}
}
function persistLabStats(){
  try{localStorage.setItem(IT_LAB_STATS_KEY,JSON.stringify(labStats));}
  catch{showStorageWarning('전산실 학습 기록');}
}
/** 모달을 다시 열 때 날짜를 확인하며 이미 출제된 같은 날 문제는 변경하지 않습니다. */
function refreshDailyLabTask(){
  const fresh=ensureDailyLabTask(labDaily,localLabDay(),labDifficulty);
  if(JSON.stringify(fresh)!==JSON.stringify(labDaily)){
    labDaily=fresh;persistLabDaily();
  }
  const merged=mergeLabReportStats(labStats,labReports);
  if(JSON.stringify(merged)!==JSON.stringify(labStats)){
    labStats=merged;persistLabStats();
  }
}
// 독립 샌드박스: 기존 직원 사건·공용 인프라·평가 점수에 절대 반영하지 않습니다.
const NETWORK_BENCH_KEY='GOCHYEORA_NETWORK_BENCH_V194';
let networkBench=null;
let benchLoadPromise=null;
let renderNetworkBench=null;
let newNetworkBench=null,selectNetworkDevice=null,selectNetworkPort=null;
let disconnectNetworkLink=null,moveNetworkNode=null,executeNetworkCommand=null;
function loadNetworkBench(){
  if(benchLoadPromise)return benchLoadPromise;
  // 정적 import로 불러오면 실습 모듈 하나만 누락돼도 사무실 전체가 열리지 않습니다.
  benchLoadPromise=Promise.all([
    import('./game/network-bench.js'),
    import('./ui/network-bench-ui.js'),
  ]).then(([engine,view])=>{
    newNetworkBench=engine.newNetworkBench;
    selectNetworkDevice=engine.selectNetworkDevice;
    selectNetworkPort=engine.selectNetworkPort;
    disconnectNetworkLink=engine.disconnectNetworkLink;
    moveNetworkNode=engine.moveNetworkNode;
    executeNetworkCommand=engine.executeNetworkCommand;
    renderNetworkBench=view.renderNetworkBench;
    networkBench=engine.readNetworkBench(readSetting(NETWORK_BENCH_KEY));
    return true;
  }).catch(error=>{
    benchLoadPromise=null; // 배포가 복구되면 같은 페이지에서 다시 시도할 수 있어야 합니다.
    console.error('[고쳐라!] 네트워크 시뮬레이터 로드 실패:',error);
    throw error;
  });
  return benchLoadPromise;
}
function persistNetworkBench(){
  if(!networkBench)return;
  try{localStorage.setItem(NETWORK_BENCH_KEY,JSON.stringify(networkBench));}
  catch{showStorageWarning('네트워크 시뮬레이터');}
}
async function showNetworkBench(){
  if(timeAttackSession){toast('타임어택 중에는 자유 네트워크 실습을 시작할 수 없습니다.');return;}
  try{await loadNetworkBench();}
  catch{
    currentPcView='network-bench-error';
    showModal('🛠 전산실 · 네트워크 실습','시뮬레이터 파일을 불러오지 못했습니다',
      '<p>3D 게임은 계속 이용할 수 있습니다. 배포된 <code>src/game/network-bench.js</code>와 <code>src/ui/network-bench-ui.js</code> 파일이 있는지 확인해 주세요.</p><p>배포 파일을 보완한 뒤 새로고침하고 다시 실행하면 됩니다. 기존 저장 기록은 유지됩니다.</p>',[
        {label:'전산실 실습 목록',onClick:showPracticeHub},
        {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
      ],{wide:true});
    return;
  }
  currentPcView='network-bench';audio.play('inspect');
  showModal('🛠 전산실 · 독립 가상 네트워크','네트워크 토폴로지 시뮬레이터',renderNetworkBench(networkBench),[
    {label:'전산실 실습 목록',onClick:showPracticeHub},
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true,networkBench:true});
}
function updateNetworkBench(next,{focusCommand=false}={}){
  networkBench=next;persistNetworkBench();
  if(currentPcView!=='network-bench')return;
  const panel=element.content.querySelector('.net-bench');
  if(!panel)return;
  const scroll=element.content.scrollTop;
  panel.outerHTML=renderNetworkBench(networkBench);
  element.content.scrollTop=scroll;
  if(focusCommand){
    const input=element.content.querySelector('[data-net-command-form] input');
    input?.focus();
    const log=element.content.querySelector('.net-bench-terminal-history');
    if(log)log.scrollTop=log.scrollHeight;
  }
}
// 드래그는 장비 배치만 바꿉니다. 케이블은 기기 좌표에 맞춰 자동 재배치합니다.
let networkBenchDrag=null;
let ignoreNetworkBenchClick=false;
element.content.addEventListener('pointerdown',event=>{
  if(currentPcView!=='network-bench'||event.button!==0)return;
  const handle=event.target.closest('.net-bench-node-head');
  const board=handle?.closest('[data-net-board]');
  if(!handle||!board)return;
  networkBenchDrag={pointerId:event.pointerId,id:handle.dataset.netDevice,handle,board,x:event.clientX,y:event.clientY,moved:false};
  try{handle.setPointerCapture(event.pointerId);}catch{}
});
element.content.addEventListener('pointermove',event=>{
  const drag=networkBenchDrag;
  if(!drag||event.pointerId!==drag.pointerId)return;
  if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>6)drag.moved=true;
  if(!drag.moved)return;
  const rect=drag.board.getBoundingClientRect();
  const x=Math.max(18,Math.min(82,(event.clientX-rect.left)/rect.width*100));
  const y=Math.max(14,Math.min(86,(event.clientY-rect.top)/rect.height*100));
  const node=drag.handle.closest('.net-bench-node');
  if(node){node.style.left=`${x}%`;node.style.top=`${y}%`;}
  drag.position=[x,y];
  const positions={...networkBench.positions,[drag.id]:[x,y]};
  drag.board.querySelectorAll('.net-bench-cable').forEach((group,i)=>{
    const link=networkBench.links[i],line=group.querySelector('line');
    if(!line||!link)return;
    line.setAttribute('x1',String(positions[link.a][0]*10));
    line.setAttribute('y1',String(positions[link.a][1]*6));
    line.setAttribute('x2',String(positions[link.b][0]*10));
    line.setAttribute('y2',String(positions[link.b][1]*6));
  });
});
function endNetworkBenchDrag(event){
  const drag=networkBenchDrag;
  if(!drag||event.pointerId!==drag.pointerId)return;
  networkBenchDrag=null;
  if(!drag.moved||!drag.position)return;
  ignoreNetworkBenchClick=true;
  setTimeout(()=>{ignoreNetworkBenchClick=false;},0);
  updateNetworkBench(moveNetworkNode(networkBench,drag.id,...drag.position));
}
element.content.addEventListener('pointerup',endNetworkBenchDrag);
element.content.addEventListener('pointercancel',event=>{
  if(networkBenchDrag?.pointerId===event.pointerId)networkBenchDrag=null;
});
element.content.addEventListener('click',event=>{
  if(currentPcView!=='network-bench')return;
  const clickable=event.target.closest('[data-net-open],[data-net-reset],[data-net-device],[data-net-port],[data-net-disconnect],[data-net-example]');
  if(!clickable)return;
  if(ignoreNetworkBenchClick){ignoreNetworkBenchClick=false;return;}
  if(clickable.hasAttribute('data-net-reset')){
    if(window.confirm('이 자유 실습의 케이블·설정·터미널 기록을 초기화할까요? 게임 사건과 학습 기록은 그대로 유지됩니다.'))updateNetworkBench(newNetworkBench());
    return;
  }
  if(clickable.hasAttribute('data-net-device')){updateNetworkBench(selectNetworkDevice(networkBench,clickable.dataset.netDevice));return;}
  if(clickable.hasAttribute('data-net-port')){updateNetworkBench(selectNetworkPort(networkBench,clickable.dataset.netPortDevice,clickable.dataset.netPort));return;}
  if(clickable.hasAttribute('data-net-disconnect')){updateNetworkBench(disconnectNetworkLink(networkBench,clickable.dataset.netDisconnect));return;}
  if(clickable.hasAttribute('data-net-example')){
    const input=element.content.querySelector('[data-net-command-form] input');
    if(input){input.value=clickable.dataset.netExample;input.focus();}return;
  }
});
element.content.addEventListener('submit',event=>{
  if(currentPcView!=='network-bench'||!event.target.matches('[data-net-command-form]'))return;
  event.preventDefault();
  const command=event.target.elements.namedItem('command')?.value??'';
  updateNetworkBench(executeNetworkCommand(networkBench,command),{focusCommand:true});
});
let currentLabReport=null;
let reportReturnView='it-lab-hub';
let practiceSession=null;
const previousPracticeCases=Object.create(null);
function showPracticeHub(){
  if(timeAttackSession){toast('타임어택 중에는 전산실 실습을 시작할 수 없습니다.');return;}
  refreshDailyLabTask();
  currentPcView='it-lab-hub';audio.play('inspect');
  showModal('🛠 전산실 · 장비 점검 작업대','실습 선택',renderPracticeHub(practiceProgress,{difficulty:labDifficulty,reports:labReports,daily:labDaily,stats:labStats})+infrastructurePane('it'),[
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true});
}
/** 최근 30개의 가상 실습 평가 이력. 복귀 시 작업대 세션 상태를 변경하지 않습니다. */
function returnFromLabReports(){
  if(reportReturnView==='it-console')showItConsole();
  else if(reportReturnView==='it-lab'&&practiceSession)refreshPracticeScreen();
  else showPracticeHub();
}
function showLabReports(){
  if(!['it-lab-reports','it-lab-report-detail'].includes(currentPcView))reportReturnView=currentPcView;
  currentPcView='it-lab-reports';audio.play('inspect');
  showModal('🛠 전산실 · 실습 평가','결과 보고서 목록',renderLabReportHistory(labReports),[
    {label:'이전 화면으로',onClick:returnFromLabReports},
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true});
}
function showLabReportDetail(id){
  if(!['it-lab-reports','it-lab-report-detail'].includes(currentPcView))reportReturnView=currentPcView;
  const record=labReports.items.find(item=>item.id===id);
  if(!record){toast('보고서가 없거나 오래된 기록입니다.');showLabReports();return;}
  currentPcView='it-lab-report-detail';audio.play('inspect');
  showModal('🛠 전산실 · 실습 평가',`${record.kind} 결과 보고서`,renderLabReportDetail(record),[
    {label:'보고서 목록으로',onClick:showLabReports},
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true});
}
function exportLabReport(id){
  const report=labReports.items.find(item=>item.id===id);
  if(!report){toast('저장할 보고서를 찾지 못했습니다.');return;}
  const blob=new Blob(['\ufeff',labReportAsText(report)],{type:'text/plain;charset=utf-8'});
  const href=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=href;anchor.download=`GOCHYEORA_IT_LAB_${report.kind}_${report.id.replace(/[^a-zA-Z0-9-]/g,'')}.txt`;
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  // 다운로드 클릭 이후 URL 자원을 정리합니다.
  setTimeout(()=>URL.revokeObjectURL(href),1000);
}
function showPracticeSession(kind){
  if(timeAttackSession){toast('타임어택 중 실습은 비활성화됩니다.');return;}
  const scenarioId=chooseLabPracticeScenario(kind,labDifficulty,previousPracticeCases[kind]);
  previousPracticeCases[kind]=scenarioId;
  practiceSession=newPracticeSession(kind,{scenarioId,difficulty:labDifficulty});
  if(kind==='switch'&&labDifficulty==='easy'&&readSetting('GOCHYEORA_SWITCH_FIRST_GUIDE_V1821')!=='done')practiceSession.tourStep=0;
  if(labDifficulty!=='easy')practiceSession=inheritSharedSwitchState(practiceSession,sharedInfrastructure);
  practiceSession.labMode='free';
  currentLabReport=null;
  refreshPracticeScreen();
}
function startDailyPractice({review=false}={}){
  if(timeAttackSession){toast('타임어택 중 실습은 비활성화됩니다.');return;}
  const previouslyIssued=labDaily?.date;
  refreshDailyLabTask();
  if(previouslyIssued!==labDaily?.date){showPracticeHub();return;}
  if(!labDaily||(review?!labDaily.completed:labDaily.completed)){showPracticeHub();return;}
  if(!review){labDaily=startDailyLabAttempt(labDaily);persistLabDaily();}
  practiceSession=newPracticeSession(labDaily.kind,{scenarioId:labDaily.scenarioId,difficulty:labDaily.difficulty});
  if(labDaily.kind==='switch'&&labDaily.difficulty==='easy'&&readSetting('GOCHYEORA_SWITCH_FIRST_GUIDE_V1821')!=='done')practiceSession.tourStep=0;
  if(labDaily.difficulty!=='easy')practiceSession=inheritSharedSwitchState(practiceSession,sharedInfrastructure);
  practiceSession.labMode=review?'daily-review':'daily';
  practiceSession.dailyDate=labDaily.date;
  currentLabReport=null;
  refreshPracticeScreen();
}
function refreshPracticeScreen(){
  if(!practiceSession)return;
  currentPcView='it-lab';
  const title=practiceSession.kind==='cable'?'LAN 케이블 진단':practiceSession.kind==='switch'?'스위치 포트 진단':'테스트 PC 진단';
  showModal('🛠 전산실 · 네트워크 실습',title,renderPracticeSession(practiceSession,{difficulty:practiceSession.difficulty,report:currentLabReport,shared:sharedInfrastructure}),[
    {label:'실습 목록으로',onClick:()=>showPracticeHub()},
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true,labWorkbench:true});
}
function updatePracticeSession(next,{focus=null,audit=null}={}){
  if(!practiceSession)return;
  const before=practiceSession;
  const wasComplete=practiceSession.phase==='complete';
  if(audit)next=recordLabActivity(before,next,audit);
  const oldDeviceScroll=element.content.querySelector('.it-lab-device-area')?.scrollTop??0;
  const oldBodyScroll=element.content.scrollTop;
  practiceSession=next;
  if(before.kind==='switch')syncSharedInfrastructure(applySwitchPracticeImpact(sharedInfrastructure,before,practiceSession,{difficulty:practiceSession.difficulty}));
  if(!wasComplete&&practiceSession.phase==='complete'){
    currentLabReport=buildLabReport(practiceSession);
    labReports=appendLabReport(labReports,currentLabReport);
    try{localStorage.setItem(IT_LAB_REPORTS_KEY,JSON.stringify(labReports));}
    catch{showStorageWarning('전산실 평가 기록');}
    practiceProgress=completePracticeProgress(practiceProgress,practiceSession);
    try{localStorage.setItem(PRACTICE_PROGRESS_KEY,JSON.stringify(practiceProgress));}
    catch{toast('실습은 완료했지만 복습 기록 저장에 실패했습니다.');}
    // 이미 발급된 일일 과제와 날짜/난이도/시나리오가 동일할 때만 완료 처리합니다.
    if(practiceSession.labMode==='daily'){
      refreshDailyLabTask();
      if(practiceSession.dailyDate===labDaily?.date){
        const finished=finishDailyLabTask(labDaily,practiceSession,currentLabReport);
        if(finished&&finished.completed&&!labDaily.completed){labDaily=finished;persistLabDaily();}
      }
    }
    const merged=mergeLabReportStats(labStats,labReports);
    if(JSON.stringify(merged)!==JSON.stringify(labStats)){
      labStats=merged;persistLabStats();
    }
    audio.play('success');
  }else audio.play('ui');
  const updated=updatePracticeScreen(element.content,renderPracticeSession(practiceSession,{difficulty:practiceSession.difficulty,report:currentLabReport,shared:sharedInfrastructure}),before,practiceSession);
  if(!updated)refreshPracticeScreen();
  element.content.scrollTop=oldBodyScroll;
  const deviceArea=element.content.querySelector('.it-lab-device-area');
  if(deviceArea)deviceArea.scrollTop=oldDeviceScroll;
  const terminalLog=element.content.querySelector('.it-lab-terminal-log');
  if(terminalLog)terminalLog.scrollTop=terminalLog.scrollHeight;
  // 모달이 교체돼도 사용자가 고른 포트/터미널에 키보드 포커스를 복원합니다.
  if(focus==='port'&&Number.isInteger(practiceSession.selectedPort))
    element.content.querySelector(`[data-lab-port="${practiceSession.selectedPort}"]`)?.focus();
  else if(focus==='terminal')element.content.querySelector('form[data-lab-terminal-form] input')?.focus();
  else if(focus?.startsWith('cable:'))element.content.querySelector(`[data-lab-cable-end="${focus.slice(6)}"]`)?.focus();
  else if(focus==='power')element.content.querySelector('button[data-lab-cable-power]')?.focus();
  else if(focus==='measure')element.content.querySelector('button[data-lab-cable-measure]')?.focus();
  else if(focus==='replace')element.content.querySelector('button[data-lab-cable-replace]')?.focus();
  else if(focus==='port-cable')element.content.querySelector('button[data-lab-switch-cable]')?.focus();
}
function showSpareShelf(selected='cable'){
  currentPcView='it-shelf';audio.play('inspect');
  showModal('📦 전산실 · 예비 장비 선반','장비 보관 및 용도 확인',renderSpareShelf(selected),[
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true,modelKind:selected});
}
function showItEquipment(kind){
  if(kind==='bench')showPracticeHub();
  else if(kind==='shelf')showSpareShelf();
}
function guideToPracticeBench(){
  closeModal();
  const target=world.interactables.find(item=>item.id==='it-bench');
  if(!target){toast('장비 작업대 위치를 찾지 못했어요.');return;}
  if(world.player.position.distanceTo(target.position)<=target.radius){
    toast('현재 장비 점검 작업대 근처입니다. 가까이 가서 R키를 눌러 실습을 시작하세요.');return;
  }
  highlightedDevice={id:'it-bench',kind:'it-bench',index:null,npcId:null,
    position:target.position.clone(),focusUntil:performance.now()+SPOTLIGHT_FOCUS_MS};
  element.targetSpotlight.textContent='🛠 장비 점검 작업대 · 파란 표시를 따라 이동하세요 (R)';
  element.targetSpotlight.hidden=false;
  toast('실습은 장비 점검 작업대에서 시작할 수 있어요.');
}
element.content.addEventListener('click',event=>{
  const reportsLink=event.target.closest('button[data-lab-reports]');
  if(reportsLink){showLabReports();return;}
  const reportLink=event.target.closest('button[data-lab-report-open]');
  if(reportLink){showLabReportDetail(reportLink.dataset.labReportOpen);return;}
  const reportExport=event.target.closest('button[data-lab-report-export]');
  if(reportExport){exportLabReport(reportExport.dataset.labReportExport);return;}
  const button=event.target.closest('button[data-it-action]');
  if(button&&currentPcView==='it-console'){
    const action=button.dataset.itAction;
    if(action==='journal')showJournal();
    else if(action==='report')showFinalReport();
    else if(action==='bench-location')guideToPracticeBench();
    else if(action==='map'){closeModal();showOfficeMap();}
    return;
  }
  const shelfItem=event.target.closest('button[data-shelf-item]');
  if(shelfItem&&currentPcView==='it-shelf'){showSpareShelf(shelfItem.dataset.shelfItem);return;}
  if(event.target.closest('button[data-net-open]')&&['it-lab-hub','it-console'].includes(currentPcView)){showNetworkBench();return;}
  const labLevel=event.target.closest('button[data-lab-difficulty]');
  if(labLevel&&currentPcView==='it-lab-hub'){
    const choice=normalizeLabDifficulty(labLevel.dataset.labDifficulty);
    if(choice!==labLevel.dataset.labDifficulty)return;
    setUnifiedDifficulty(choice);
    showPracticeHub();
    return;
  }
  if(event.target.closest('button[data-lab-daily-start]')&&currentPcView==='it-lab-hub'){startDailyPractice();return;}
  if(event.target.closest('button[data-lab-daily-review]')&&currentPcView==='it-lab-hub'){startDailyPractice({review:true});return;}
  const topic=event.target.closest('button[data-lab-topic]');
  if(topic&&currentPcView==='it-lab-hub'){
    showPracticeSession(topic.dataset.labTopic);return;
  }
  if(currentPcView!=='it-lab'||!practiceSession)return;
  if(event.target.closest('[data-lab-tour-next]')){
    const step=Number(practiceSession.tourStep??0);
    if(step>=2){practiceSession={...practiceSession,tourStep:null};try{localStorage.setItem('GOCHYEORA_SWITCH_FIRST_GUIDE_V1821','done');}catch{}}
    else practiceSession={...practiceSession,tourStep:step+1};
    updatePracticeSession(practiceSession);return;
  }
  if(event.target.closest('[data-lab-tour-dismiss]')){
    practiceSession={...practiceSession,tourStep:null};try{localStorage.setItem('GOCHYEORA_SWITCH_FIRST_GUIDE_V1821','done');}catch{}
    updatePracticeSession(practiceSession);return;
  }
  const wirePin=event.target.closest('[data-lab-wire-pin]');
  if(wirePin){updatePracticeSession(selectPracticeWirePin(practiceSession,wirePin.dataset.wireSide,wirePin.dataset.labWirePin));return;}
  const port=event.target.closest('[data-lab-port]');
  if(port){updatePracticeSession(selectPracticePort(practiceSession,Number(port.dataset.labPort)),{focus:'port',audit:{type:'inspection',label:`포트 Gi0/${port.dataset.labPort} 관찰`}});return;}
  const cableEnd=event.target.closest('[data-lab-cable-end]');
  if(cableEnd){updatePracticeSession(togglePracticeCableEnd(practiceSession,cableEnd.dataset.labCableEnd),{focus:`cable:${cableEnd.dataset.labCableEnd}`,audit:{type:'operation',label:`${cableEnd.dataset.labCableEnd} 커넥터 연결 변경`}});return;}
  if(event.target.closest('button[data-lab-cable-power]')){updatePracticeSession(togglePracticeCablePower(practiceSession),{focus:'power',audit:{type:'operation',label:'케이블 테스터 전원 전환'}});return;}
  if(event.target.closest('button[data-lab-cable-measure]')){updatePracticeSession(measurePracticeCable(practiceSession),{focus:'measure',audit:{type:'inspection',label:'케이블 도통 측정'}});return;}
  if(event.target.closest('button[data-lab-cable-replace]')){updatePracticeSession(replacePracticeCable(practiceSession),{focus:'replace',audit:{type:'operation',label:'정상 LAN 케이블 교체'}});return;}
  if(event.target.closest('button[data-lab-cable-recrimp]')){updatePracticeSession(recrimpPracticeCable(practiceSession),{audit:{type:'operation',label:'RJ45 커넥터 재압착'}});return;}
  if(event.target.closest('button[data-lab-switch-cable]')){updatePracticeSession(togglePracticeSwitchCable(practiceSession),{focus:'port-cable',audit:{type:'operation',label:`Gi0/${practiceSession.selectedPort} 케이블 연결 변경`}});return;}
  const diagnose=event.target.closest('button[data-lab-diagnose]');
  if(diagnose){updatePracticeSession(selectPracticeDiagnosis(practiceSession,diagnose.dataset.labDiagnose));return;}
  if(event.target.closest('button[data-lab-diagnose-confirm]')){
    const label=practiceForSession(practiceSession).diagnoses.find(c=>c.id===practiceSession.pendingDiagnosis)?.label||'선택 전';
    updatePracticeSession(confirmPracticeDiagnosis(practiceSession),{audit:{type:'diagnosis',label:`원인 확정: ${label}`}});return;
  }
  const restart=event.target.closest('button[data-lab-restart]');
  if(restart){showPracticeSession(restart.dataset.labRestart);return;}
});
// 포트와 RJ45 커넥터는 마우스와 키보드(Enter/Space)에서 동일한 상태 전이를 사용합니다.
element.content.addEventListener('keydown',event=>{
  if(currentPcView!=='it-lab'||!practiceSession)return;
  if(event.key!=='Enter'&&event.key!==' ')return;
  const port=event.target.closest('[data-lab-port]');
  const connector=event.target.closest('[data-lab-cable-end]');
  if(!port&&!connector)return;
  event.preventDefault();
  if(port)updatePracticeSession(selectPracticePort(practiceSession,Number(port.dataset.labPort)),{focus:'port',audit:{type:'inspection',label:`포트 Gi0/${port.dataset.labPort} 관찰`}});
  else updatePracticeSession(togglePracticeCableEnd(practiceSession,connector.dataset.labCableEnd),{focus:`cable:${connector.dataset.labCableEnd}`,audit:{type:'operation',label:`${connector.dataset.labCableEnd} 커넥터 연결 변경`}});
});
element.content.addEventListener('submit',event=>{
  const wiring=event.target.closest('form[data-lab-wire-form]');
  if(wiring&&currentPcView==='it-lab'&&practiceSession){
    event.preventDefault();
    const from=wiring.elements.namedItem('from')?.value;
    const to=wiring.elements.namedItem('to')?.value;
    updatePracticeSession(wirePracticeCablePin(practiceSession,from,to),{audit:{type:'operation',label:`RJ45 결선 ${from}번 → ${to}번`}});
    return;
  }
  const form=event.target.closest('form[data-lab-terminal-form]');
  if(!form||currentPcView!=='it-lab'||!practiceSession)return;
  event.preventDefault();
  const command=form.elements.namedItem('command')?.value??'';
  // 부분 갱신에서는 입력 폼을 유지하므로, 실행한 명령은 명시적으로 비웁니다.
  form.reset();
  updatePracticeSession(practiceSession.kind==='switch'?executeSwitchCommand(practiceSession,command):
    executePracticeCommand(practiceSession,command),{focus:'terminal',audit:{type:'command',label:`콘솔 입력: ${command.slice(0,120)}`}});
});
// 전산실 내부에서는 월드 이름표를 숨기고 최초 입장 시에만 2.1초 안내합니다.
let itRoomWasInside=false, itRoomNoticeUntil=0;
function updateItRoomLabel(stamp){
  const inside=insideItRoom(world.player.position.x,world.player.position.z);
  if(inside!==itRoomWasInside){
    itRoomWasInside=inside;
    itRoomNoticeUntil=inside?stamp+2100:0;
  }
  element.itRoomNotice.hidden=overlayOpen()||!inside||stamp>=itRoomNoticeUntil;
  if(inside||overlayOpen()){element.itRoomLabel.hidden=true;return;}
  const anchor=world.worldAnchors.itRoomLabel;
  spotlightMarker.copy(anchor).project(camera);
  if(spotlightMarker.z< -1||spotlightMarker.z>1||Math.abs(spotlightMarker.x)>1||Math.abs(spotlightMarker.y)>1){
    element.itRoomLabel.hidden=true;return;
  }
  element.itRoomLabel.style.left=`${Math.max(72,Math.min(window.innerWidth-72,(spotlightMarker.x+1)*window.innerWidth/2))}px`;
  element.itRoomLabel.style.top=`${Math.max(92,Math.min(window.innerHeight-80,(1-spotlightMarker.y)*window.innerHeight/2))}px`;
  element.itRoomLabel.hidden=false;
}

function showOfficeMap(){
  if(blockFirstDayInput('world:map'))return;
  if(overlayOpen()||isShiftAwaitingNextDay()||completionTransitionActive||completionEffectPending||pendingIntakeIndices.length)return;
  currentPcView='office-map';
  showModal('🗺 사무실 이동','빠른 이동 지도',renderOfficeMap(),[
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true});
}
function fastTravelTo(id,{fromWorldLabel=false}={}){
  if(blockFirstDayInput(isDnsTutorialActive(state)?`world:${id}`:fromWorldLabel?`world:${id}`:'world:map'))return;
  if(fromWorldLabel){if(overlayOpen()||isShiftAwaitingNextDay())return;}
  else if(!modalOpen||currentPcView!=='office-map')return;
  const destination=findTravelDestination(id,world.isBlocked);
  if(!destination){toast('이동할 수 없는 위치입니다. 다른 구역을 선택해 주세요.');return;}
  clearDeviceGuide();keys.clear();
  world.player.position.set(destination.x,0,destination.z);
  if(isTutorial(state)&&currentFirstDayStep(firstDayTour)?.id==='walk'){
    firstDayTour={...firstDayTour,walkStart:{x:destination.x,z:destination.z},walkDistance:0};
    storeFirstDayTour();
  }
  world.updateServerAccess(destination.x,destination.z);
  focus.copy(world.player.position).add(new THREE.Vector3(-.9,0,-1.5));
  cameraTarget.copy(focus); // 구역 이동 직후 카메라가 이전 위치를 비추지 않게 합니다.
  save({refreshHud:false});
  if(!fromWorldLabel){currentPcView='office';closeModal();}
  dnsAction('department-arrived',{department:id});
  // 일반 T키 지도 클릭은 최초 3D 이름표 실습의 완료로 인정하지 않습니다.
  if(fromWorldLabel&&tourAction('travel',{destination:id,source:'world-label'})){
    hideTourWalkMarker();
    toast('부서 이동 성공! 왼쪽 카드의 김대리 위치 찾기 버튼을 눌러보세요.');
    return;
  }
  toast(destination.restricted?'서버실 문 앞에 도착했어요. 리더에 다가가 R로 사원증을 태그하세요.':`${destination.name} 통로에 도착했어요.`);
}
element.content.addEventListener('click',event=>{
  const coach=event.target.closest('button[data-first-day-action]');
  if(coach){handleFirstDayAction(coach.dataset.firstDayAction);return;}
  const button=event.target.closest('button[data-office-travel]');
  if(button)fastTravelTo(button.dataset.officeTravel);
});

// 3D 세계에 고정된 부서 이름표: 해당 부서 안에서는 숨기고 상단 진입 알림을 잠깐 표시합니다.
const departmentLabelNodes=new Map(DEPARTMENT_ZONES.map(zone=>{
  const label=document.createElement('button');
  label.type='button';label.dataset.worldTravel=zone.id;
  label.className='world-room-label department-room-label';
  label.textContent=zone.label;
  label.setAttribute('aria-label',`${zone.label}으로 빠른 이동`);
  label.title=`${zone.label} 구역 입구로 이동`;
  label.hidden=true;
  label.style.setProperty('--dept-accent',zone.color);
  element.departmentLabels.appendChild(label);
  return [zone.id,label];
}));
element.departmentLabels.addEventListener('click',event=>{
  const label=event.target.closest('button[data-world-travel]');
  if(label&&!label.hidden)fastTravelTo(label.dataset.worldTravel,{fromWorldLabel:true});
});
element.serverRoomLabel.addEventListener('click',()=>fastTravelTo('server',{fromWorldLabel:true}));
element.itRoomLabel.addEventListener('click',()=>fastTravelTo('it-room',{fromWorldLabel:true}));
// The monitor tutorial cue is attached to the actual 3D employee PC, not the left objective card.
element.firstDayPcCue.addEventListener('click',()=>{
  if(!isTutorial(state)||currentFirstDayStep(firstDayTour)?.id!=='monitor'||overlayOpen())return;
  const target=world.interactables.find(item=>item.id==='pc:kim');
  if(!target)return;
  if(world.player.position.distanceTo(target.position)<=target.radius+.6)showPcFront('kim');
  else guideToEmployeeDevice(0,'pc');
});
function updateFirstDayPcWorldCue(){
  const cue=element.firstDayPcCue;
  const step=isTutorial(state)?currentFirstDayStep(firstDayTour)?.id:null;
  if(step!=='monitor'||overlayOpen()) {cue.hidden=true;return;}
  const target=world.interactables.find(item=>item.id==='pc:kim');
  if(!target){cue.hidden=true;return;}
  spotlightMarker.copy(target.position).add(new THREE.Vector3(0,2.25,0)).project(camera);
  if(spotlightMarker.z< -1||spotlightMarker.z>1||Math.abs(spotlightMarker.x)>1||Math.abs(spotlightMarker.y)>1){cue.hidden=true;return;}
  const x=(spotlightMarker.x+1)*window.innerWidth/2;
  const y=(1-spotlightMarker.y)*window.innerHeight/2;
  cue.style.left=`${Math.max(110,Math.min(window.innerWidth-110,x))}px`;
  cue.style.top=`${Math.max(88,Math.min(window.innerHeight-90,y-18))}px`;
  cue.dataset.tourIdle=String(tourIdlePhase);
  cue.hidden=false;
}

let currentDepartmentId=null;
let departmentNoticeUntil=0;
function updateDepartmentLabels(stamp){
  const area=departmentAt(world.player.position.x,world.player.position.z);
  const id=area?.id||null;
  if(id!==currentDepartmentId){
    const entered=departmentTransition(currentDepartmentId,id);
    currentDepartmentId=id;
    departmentNoticeUntil=entered?stamp+2100:0;
    if(entered)element.departmentNotice.textContent=`현재 위치 · ${entered.label}`;
  }
  element.departmentNotice.hidden=overlayOpen()||!departmentNoticeUntil||stamp>=departmentNoticeUntil;
  for(const zone of DEPARTMENT_ZONES){
    const label=departmentLabelNodes.get(zone.id);
    const mapTutorial=isTutorial(state)&&currentFirstDayStep(firstDayTour)?.id==='map';
    const tutorialTarget=mapTutorial&&zone.id==='business';
    label.classList.toggle('first-day-world-target',tutorialTarget);
    label.classList.toggle('first-day-idle-focus',tutorialTarget&&tourIdlePhase>=1);
    label.classList.toggle('first-day-idle-prompt',tutorialTarget&&tourIdlePhase>=2);
    if(overlayOpen()||(id===zone.id&&!tutorialTarget)||(mapTutorial&&!tutorialTarget)){label.hidden=true;continue;}
    const anchor=world.worldAnchors.departments[zone.id];
    spotlightMarker.copy(anchor).project(camera);
    if(spotlightMarker.z< -1||spotlightMarker.z>1||Math.abs(spotlightMarker.x)>1||Math.abs(spotlightMarker.y)>1){
      label.hidden=true;continue;
    }
    label.style.left=`${Math.max(70,Math.min(window.innerWidth-70,(spotlightMarker.x+1)*window.innerWidth/2))}px`;
    label.style.top=`${Math.max(95,Math.min(window.innerHeight-75,(1-spotlightMarker.y)*window.innerHeight/2))}px`;
    label.hidden=false;
  }
}

function updateServerRoomLabel(){
  const label=element.serverRoomLabel;
  const anchor=world?.worldAnchors?.serverRoomLabel;
  if(!label||!anchor)return;
  const inside=isInsideServerRoom(world.player.position.x,world.player.position.z);
  if(overlayOpen()||inside){label.hidden=true;return;}
  spotlightMarker.copy(anchor).project(camera);
  const visible=spotlightMarker.z>=-1&&spotlightMarker.z<=1&&Math.abs(spotlightMarker.x)<=1.15&&Math.abs(spotlightMarker.y)<=1.15;
  if(!visible){label.hidden=true;return;}
  const x=(spotlightMarker.x+1)*window.innerWidth/2;
  const y=(1-spotlightMarker.y)*window.innerHeight/2;
  label.style.left=`${Math.max(72,Math.min(window.innerWidth-72,x))}px`;
  label.style.top=`${Math.max(94,Math.min(window.innerHeight-88,y))}px`;
  label.hidden=false;
}

function updateDeviceGuide(now){
  if(!highlightedDevice)return;
  if(highlightedDevice.kind==='it-bench'){
    if(now>highlightedDevice.focusUntil){clearDeviceGuide();return;}
  }else{
    const incident=state.incidents[highlightedDevice.index];
    if(!incident||!state.activeIds.includes(incident.id)||incident.status==='resolved'||state.scenarioIndex!==highlightedDevice.index){
      clearDeviceGuide();return;
    }
  }
  const nearby=world.interactables.find(item=>item.id===highlightedDevice.id);
  if(nearby&&world.player.position.distanceTo(nearby.position)<=nearby.radius&&highlightedDevice.kind!=='find'){
    clearDeviceGuide();return;
  }
  spotlightMarker.copy(highlightedDevice.position).add(new THREE.Vector3(0,2.7,0)).project(camera);
  const visible=spotlightMarker.z>=-1&&spotlightMarker.z<=1;
  const x=Math.min(window.innerWidth-125,Math.max(125,(spotlightMarker.x+1)*window.innerWidth/2));
  const y=Math.min(window.innerHeight-140,Math.max(110,(1-spotlightMarker.y)*window.innerHeight/2-38));
  element.targetSpotlight.style.left=`${x}px`;
  element.targetSpotlight.style.top=`${y}px`;
  element.targetSpotlight.classList.toggle('is-offscreen',!visible||Math.abs(spotlightMarker.x)>1||Math.abs(spotlightMarker.y)>1);
}

function resize(){
  const w=window.innerWidth,h=window.innerHeight;
  const viewHeight=Math.max(12.8, window.innerWidth<760?16.5:14.8);
  const aspect=w/Math.max(1,h);
  camera.left=-viewHeight*aspect/2;camera.right=viewHeight*aspect/2;
  camera.top=viewHeight/2;camera.bottom=-viewHeight/2;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
  renderer.setSize(w,h,false);
}
window.addEventListener('resize',resize);
resize();
focus.copy(world.player.position).add(new THREE.Vector3(-1,0,-2.3));
camera.position.copy(focus).add(currentCameraOffset);
camera.lookAt(focus.x,focus.y+.65,focus.z);
let closest=null;
const tmp2=new THREE.Vector3();
function updateNearby(){
  // 동일 책상의 모니터와 본체가 겹쳐 선택되는 문제: 정확한 장비 좌표로 판정.
  // 본체 위치를 안내 중이라면 해당 본체를 R키의 우선 대상으로 삼습니다.
  const {primary,secondaryTower}=chooseNearbyInteraction(world.interactables,world.player.position,highlightedDevice?.id);
  closest=primary;
  const tower=secondaryTower || (primary?.id.startsWith('cable:') ? primary : null);
  element.towerButton.hidden=!tower;
  if(tower){element.towerButton.dataset.towerId=tower.npcId;element.towerButtonName.textContent=`${tower.name} 확인`;}
  if(overlayOpen() || isShiftAwaitingNextDay() || !primary) {element.interaction.hidden=true;return;}
  element.nearbyName.textContent=primary.name;
  element.nearbyAction.textContent=primary.action;
  element.interaction.hidden=false;
}
function interactTower(){
  if(blockFirstDayInput('pc:tower'))return;
  const tower=nearestTower(world.interactables,world.player.position);
  if(!tower)return;
  showChassis(tower.npcId);
}
element.towerButton.addEventListener('click',()=>{if(!overlayOpen())interactTower();});
$('#nearby-interact-button')?.addEventListener('click',()=>{if(!overlayOpen()&&!isShiftAwaitingNextDay())interact();});
// 튜토리얼 중에는 안내 대상이 아닌 버튼을 다른 경로로 눌러도 실행되지 않습니다.
// 현재 단계를 벗어나지 못하게 캡처 단계에서 차단합니다.
document.addEventListener('click',event=>{
  if(!isTutorial(state)||!isFirstDayTourActive(firstDayTour)&&!isDnsTutorialActive(state))return;
  if(dialogueOpen){
    if(currentFirstDayStep(firstDayTour)?.id==='talk'||getDnsTutorialStep(state)===3)return; // 질문/대화 종료만 허용
    event.preventDefault();event.stopImmediatePropagation();return;
  }
  if(modalOpen&&!element.backdrop.querySelector('.pc-modal'))return; // 메뉴/설정/환영 화면은 종료 가능
  const button=event.target.closest('button');
  if(!button)return;
  let action=null;
  if(button.matches('[data-world-travel]'))action=`world:${button.dataset.worldTravel}`;
  else if(button.matches('[data-office-travel]'))action=isDnsTutorialActive(state)?`world:${button.dataset.officeTravel}`:'world:map';
  else if(button.matches('[data-first-day-action]'))action=button.dataset.firstDayAction==='restart'?'system:restart':
    button.dataset.firstDayAction==='find'?'find:kim':button.dataset.firstDayAction==='talk'?'npc:kim':
    button.dataset.firstDayAction==='hint'?'help':'unknown';
  // 명령 프롬프트의 '실행'은 일반 PC 버튼이 아니라 현재 단계에서 허용된 명령 실행입니다.
  // 이 분기가 없으면 아래 .pc-workspace의 unknown 처리에 걸려 submit 자체가 취소됩니다.
  else if(button.matches('button[type="submit"]')&&button.closest('form[data-terminal-form]'))action='pc:command';
  else if(button.matches('[data-tutorial-goal-action]'))action=button.dataset.tutorialGoalAction==='department'?'world:map':
    button.dataset.tutorialGoalAction==='find-park'?'move':button.dataset.tutorialGoalAction==='talk'?'npc:park':'pc:park';
  else if(button.matches('[data-terminal-example]'))action='pc:terminal-example';
  else if(button.matches('[data-terminal-lesson-toggle]'))action='pc:lesson-toggle';
  else if(button.matches('[data-terminal-lesson-close]'))action='pc:lesson-close';
  else if(button.matches('[data-pc-action]'))action=`pc:${button.dataset.pcAction}`;
  else if(button.matches('[data-pc-inspection]'))action=button.dataset.pcInspection==='tower'?'pc:tower':
    button.dataset.pcInspection==='monitor'?'pc:monitor':'pc:front';
  else if(button.matches('[data-pc-front-action]'))action=`pc:${button.dataset.pcFrontAction}`;
  else if(button.matches('#btn-menu'))action='system:menu';
  else if(button.matches('#btn-sound'))action='system:sound';
  else if(button.matches('#modal-close'))action='pc:close';
  else if(button.matches('#btn-map'))action='world:map';
  else if(button.matches('#nearby-interact-button'))action=closest?.id?.startsWith('npc:')?`npc:${closest.id.slice(4)}`:
    closest?.id?.startsWith('pc:')?`pc:${closest.id.slice(3)}`:'unknown';
  else if(button.matches('#nearby-tower-button'))action='pc:tower';
  else if(button.matches('[data-first-day-step-ack]'))action='system:settings';
  else if(button.matches('[data-start-main-game]'))action='system:menu';
  else if(button.closest('#case-list,#task-card'))action='unknown';
  else if(button.closest('.pc-workspace'))action='unknown';
  if(action&&blockFirstDayInput(action)){event.preventDefault();event.stopImmediatePropagation();}
},true);

// PC 모니터와 본체는 마우스로 직접 선택할 수도 있습니다. (R 키도 지원)
const raycaster=new THREE.Raycaster();
const pointer=new THREE.Vector2();
renderer.domElement.addEventListener('click',event=>{
  if(overlayOpen() || isShiftAwaitingNextDay() || event.button!==0)return;
  const rect=renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(pointer,camera);
  const hits=raycaster.intersectObjects(world.pickables.map(item=>item.mesh),false);
  if(!hits.length)return;
  const match=world.pickables.find(item=>item.mesh===hits[0].object);
  const target=world.interactables.find(item=>item.id===match?.id);
  if(!target)return;
  if(blockFirstDayInput(match.id.startsWith('npc:')?`npc:${match.id.slice(4)}`:match.id.startsWith('pc:')?`pc:${match.id.slice(3)}`:match.id.startsWith('cable:')?'pc:tower':'unknown'))return;
  if(world.player.position.distanceTo(target.position)>target.radius+.6){
    toast('장비 근처로 이동한 다음 선택해 주세요.');
    return;
  }
  if(match.id.startsWith('pc:'))showPcFront(match.id.slice(3));
  else if(match.id.startsWith('cable:'))showChassis(match.id.slice(6));
  else if(match.id.startsWith('npc:'))showNpc(match.id.slice(4));
  else if(match.id==='it-pc')showItConsole();
  else if(match.id==='it-board')showJournal();
  else if(match.id==='it-bench')showItEquipment('bench');
  else if(match.id==='it-shelf')showItEquipment('shelf');
});
// 클릭 가능한 3D 오브젝트에만 포인터 커서를 표시합니다.
renderer.domElement.addEventListener('pointermove',event=>{
  if(overlayOpen() || isShiftAwaitingNextDay()){renderer.domElement.style.cursor='default';return;}
  const rect=renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(pointer,camera);
  const hit=raycaster.intersectObjects(world.pickables.map(item=>item.mesh),false)[0];
  const candidate=world.pickables.find(item=>item.mesh===hit?.object);
  const target=world.interactables.find(item=>item.id===candidate?.id);
  renderer.domElement.style.cursor=target&&world.player.position.distanceTo(target.position)<=target.radius+.6?'pointer':'default';
});
function interact() {
  if(!closest)return;
  if(blockFirstDayInput(closest.id.startsWith('npc:')?`npc:${closest.id.slice(4)}`:
    closest.id.startsWith('pc:')?`pc:${closest.id.slice(3)}`:closest.id.startsWith('cable:')?'pc:tower':'unknown'))return;
  const [type,npcId]=closest.id.split(':');
  switch(type){
    case 'npc':showNpc(npcId,'intro');break;
    case 'pc':showPcFront(npcId);break;
    case 'cable':showChassis(npcId);break;
    case 'server':showServer();break;
    case 'keycard':{
      const result=world.authorizeServerRoom();
      audio.play('ui');toast(result.message);break;
    }
    case 'printer':showUpcoming('공용 복합기','복합기 장애 사건은 이후 업데이트에서 추가할 예정입니다.');break;
    case 'it-pc':showItConsole();break;
    case 'it-board':showJournal();break;
    case 'it-bench':showItEquipment('bench');break;
    case 'it-shelf':showItEquipment('shelf');break;
  }
}
function employee(){return currentScenario(state);}
function isCurrentNpc(npcId){return currentScenario(state).npcId===npcId;}
function showNpc(npcId,topic='intro') {
  if(npcId==='park'&&isDnsTutorialActive(state)&&getDnsTutorialStep(state)!==3)return void blockFirstDayInput('npc:park');
  if(npcId==='park'&&getDnsTutorialStep(state)===3){
    const npc=world.interactables.find(item=>item.id==='npc:park');
    if(!npc||world.player.position.distanceTo(npc.position)>npc.radius+.6){showParkLocation();return;}
  }
  if(blockFirstDayInput(`npc:${npcId}`))return;
  if(highlightedDevice&&highlightedDevice.npcId!==npcId)clearDeviceGuide();
  currentPcView='office';
  const index=SCENARIOS.findIndex(s=>s.npcId===npcId);
  const own=index>=0?casePresentation(state,index):null;
  if(!own)return;
  const incident=state.incidents[index];
  const history=()=>renderNpcHistory(state,index);
  const linkedReports=!timeAttackSession&&!isTutorial(state)?acceptEmployeeLinkedReports(SCENARIOS[index].port):[];
  const linkedUpdate=linkedEmployeeFeedback(linkedReports,sharedInfrastructure,SCENARIOS[index].port);
  const linkedLead=linkedUpdate?`추가 장애 (${linkedUpdate.stage}): ${linkedUpdate.text} ${linkedUpdate.suggestion}`:'';
  const patience=!timeAttackSession&&!isTutorial(state)&&difficultyForCase(state,index)==='hard'?pressureStatus(employeePressure,state.run?.round,own):null;
  const moodText=patience?.stage===3?(index<5?'오래 기다려서 제 PC 연결 설정을 직접 만졌어요. 네트워크 상태도 다시 확인해 주세요.':'업무가 계속 지연돼서 관리자에게 추가 연락을 했어요.') :patience?.stage===2?'업무가 계속 멈춰 있어요. 현재 진행 상황을 알려주실 수 있나요?':patience?.stage===1?'언제쯤 확인이 끝날까요?':' ';
  if(!npcHasActiveIncident(state,npcId)) {
    const done=incident.status==='resolved';
    const reply=linkedLead|| (done?(getResolutionDetails(state,index)?.employeeReply||'지난번 문제가 해결됐어요. 이제 업무가 잘 돼요. 감사합니다!'):'현재는 별다른 문제가 없어요.');
    showDialogue(`${own.department} · ${own.npcName}`,linkedLead?'추가 장애 신고':done?'해결 후 대화':'직원과 대화',
      renderNpcDialogue(npcId,own.npcName,reply+(patience?.stage?'\n'+moodText:''),{department:own.department,mood:patience?.stage||0}),
      [...(linkedReports.length?[{label:'연동 장애 확인',onClick:()=>{closeDialogue();showLinkedIncidentDetail(linkedReports[0].id);}}]:[]),{label:'닫기',primary:true,onClick:closeDialogue}],{npcId,historyHtml:history()});
    return;
  }
  selectIncident(state,npcId);
  audio.play('inspect');
  const hasIntro=incident.actions.includes('직원 대화: intro');
  const inspected=incident.evidence.includes('adapterChecked')||incident.evidence.includes('securityLog')||incident.evidence.includes('mailReviewed');
  // 이미 접수한 사건을 다시 열 때는 첫 질문을 중복 저장하지 않습니다.
  // PC 상태를 점검한 뒤에는 직원이 일반적인 후속 안내로 반응합니다.
  const actualTopic=topic==='intro'&&hasIntro&&inspected?'status':topic;
  let response;
  if(topic==='intro'&&hasIntro){
    const seen=incident.actions.includes(`직원 대화: ${actualTopic}`);
    if(actualTopic==='status'){
      const latestResponse=npcDialogueReply(state,index,'status');
      const previous=incident.actions.filter(action=>action.startsWith('직원 응답: status | ')).at(-1)?.slice('직원 응답: status | '.length);
      if(!seen || previous!==latestResponse){response=talk(state,actualTopic);save();}
      else response=latestResponse;
    }else response=npcDialogueReply(state,index,actualTopic);
  }else{response=talk(state,actualTopic);save();}
  const buttons=[
    {label:'① 언제부터인가요?',onClick:()=>showNpc(npcId,'time')},
    {label:'② 다른 직원도 그런가요?',onClick:()=>showNpc(npcId,'others')},
    {label:`③ ${own.npcName} PC 위치 보기`,primary:true,onClick:()=>{const wasTourTalk=isTutorial(state)&&npcId==='kim'&&currentFirstDayStep(firstDayTour)?.id==='talk';closeDialogue();if(!wasTourTalk)guideToEmployeeDevice(index,'pc');}},
    ...(patience?.stage>=1?[{label:'조사 진행 상황 설명',onClick:()=>{
      const result=reassureEmployee(employeePressure,{round:state.run?.round,id:own.id,evidenceCount:incident.evidence.length});
      employeePressure=result.ledger;if(result.success){persistEmployeePressure();updateHud();}toast(result.message);showNpc(npcId,'status');
    }}]:[]),
    ...(linkedReports.length?[{label:'연동 장애 확인',onClick:()=>{closeDialogue();showLinkedIncidentDetail(linkedReports[0].id);}}]:[]),
  ];
  // 대화 종료(X/ESC/PC 위치 보기)를 유일한 완료 기준으로 사용해 중복 확인 버튼을 없앱니다.
  if(linkedLead)response+=`\n${linkedLead}`;
  if(patience?.stage)response+=`\n${moodText}`;
  if(incident.security?.normalSessionInterrupted&&!incident.security.normalSessionRecovered)response+='\n정상 업무 세션까지 로그아웃되어 작업이 중단됐어요. 재인증이 필요합니다.';
  showDialogue(`${own.department} · ${own.npcName}`,own.title,
    renderNpcDialogue(npcId,own.npcName,response,{department:own.department,mood:patience?.stage||0}),buttons,{npcId,historyHtml:history()});
}
function needAccept() {
  if(state.incident.status==='new'){
    const s=employee();
    showModal('사건 접수 안내',`${s.npcName}에게 먼저 증상을 물어보세요`,
      `<p>왼쪽 사건 카드의 <strong>${s.npcName}와 대화하기</strong>를 누르면 바로 대화할 수 있어요. 직원에게 직접 다가가 <strong>R</strong>로 말 걸어도 됩니다.</p>`,
      [{label:`${s.npcName}와 바로 대화하기`,primary:true,onClick:()=>{closeModal();showNpc(s.npcId);}}]);return true;
  }
  return false;
}
function checkTarget(npcId){
  const scenario=SCENARIOS.find(s=>s.npcId===npcId);
  if(!scenario)return false;
  if(npcHasActiveIncident(state,npcId)){
    selectIncident(state,npcId);save();return true;
  }
  const last=state.incidents[SCENARIOS.indexOf(scenario)];
  showModal(`${scenario.department} · ${scenario.npcName}`,last.status==='resolved'?'정상 PC':'현재 조사 대상 아님',
    `<p>${last.status==='resolved'?'이 PC의 장애는 이미 해결됐어요.':'이 PC에는 아직 접수된 사건이 없어요.'}</p>`,
    [{label:'사무실로 돌아가기',primary:true,onClick:closeModal}]);return false;
}
function showPcScreen(kicker,title,html,view,buttons=[]) {
  return showModal(`${employee().department} · ${kicker}`,title,
    renderPcWorkspace(view,html),buttons,{wide:true,pc:true});
}

// v1.9.2: PC를 조작하는 동안 왼쪽 이동 메뉴는 고정하고 작업 화면만 스크롤합니다.
// 기존 data-pc-action / data-pc-inspection 이벤트는 그대로 위임하여 저장 스키마를 변경하지 않습니다.
function renderDnsInlineGuide(task){
  return task?`<div class="dns-step-inline" role="status"><span>🎓 박과장 DNS 실습 ${task.step}/10</span><strong>${task.title}</strong><p>${task.description}</p></div>`:'';
}
function renderPcWorkspace(view,html){
  const cause=state.incident.rootCause;
  const navigation=renderPcInspectionBar(view)+renderPcNavigation(employee().npcName,view,cause,{tutorial:isTutorial(state),dnsStep:getDnsTutorialStep(state)});
  return `<div class="pc-workspace" data-pc-workspace="${view}" data-first-day-step="${isTutorial(state)?currentFirstDayStep(firstDayTour)?.id||'':''}" data-final-verification="${state.incident.status==='action_taken'&&(!isTutorial(state)||currentFirstDayStep(firstDayTour)?.id==='verify'||!isFirstDayTourActive(firstDayTour))?'true':'false'}" data-tutorial-mode="${isTutorial(state)?'true':'false'}">
    <aside class="pc-workspace-sidebar" aria-label="PC 점검 메뉴">${navigation}</aside>
    <section class="pc-workspace-main" aria-label="현재 PC 작업 화면">${isTutorial(state)?renderFirstDayInlineGuide(firstDayTour):''}${isDnsTutorialActive(state)?renderDnsInlineGuide(getDnsTutorialTask(state)):''}${html}</section>
  </div>`;
}
function renderPcInspectionBar(view){
  return `<nav class="pc-inspection-bar" aria-label="PC 점검 화면 이동">
    <span class="pc-menu-label">장비 점검</span>
    <button type="button" data-pc-inspection="front" ${view==='front'?'aria-current="page"':''}>↶ 책상 정면</button>
    <button type="button" data-pc-inspection="monitor" ${view!=='front'&&view!=='chassis'?'aria-current="page"':''}>🖥 모니터</button>
    <button type="button" data-pc-inspection="tower" ${view==='chassis'?'aria-current="page"':''}>🔧 본체</button>
  </nav>`;
}
function showPcFront(npcId=employee().npcId){
  if(blockFirstDayInput(npcId==='kim'?(firstDayAllows('pc:front')?'pc:front':'pc:kim'):npcId==='park'?'pc:front':'unknown'))return;
  if(highlightedDevice?.npcId===npcId)clearDeviceGuide();
  if(!checkTarget(npcId)||needAccept())return;
  audio.play('inspect');
  currentPcView='pc-root';
  showModal(`${employee().department} · ${employee().npcName} PC 책상 · 정면 점검`,'PC 점검',renderPcWorkspace('front',renderPcFrontInspect(`${employee().department} · ${employee().npcName}`)),[],{wide:true,pc:true});
}

function showPc(npcId=employee().npcId){
  if(isDnsTutorialActive(state)&&blockFirstDayInput('pc:monitor'))return;
  if(highlightedDevice?.npcId===npcId)clearDeviceGuide();
  if(!checkTarget(npcId)||needAccept())return;
  audio.play('inspect');
  currentPcView='desktop';
  inspectPc(state);
  if(employee().npcId==='park')dnsAction('monitor-opened');
  save();
  showPcScreen(`${employee().npcName} PC · 가상 데스크톱`,'PC 화면 조작',renderDesktop(employeeSharedSnapshot(getNetworkSnapshot(state)),employee().npcName,state.incident.rootCause,{tutorial:isTutorial(state),tutorialStep:getTutorialGoal(state)?.step,lesson:state.scenarioIndex,dnsStep:getDnsTutorialStep(state),firstDayStep:isTutorial(state)?currentFirstDayStep(firstDayTour)?.id:null}), 'desktop');
  if(employee().npcId==='kim')tourAction('monitor');
}
function showPcNetwork(notice=''){
  if(blockFirstDayInput('pc:network')&&isDnsTutorialActive(state))return;
  if(needAccept())return;
  // 직접 설정 후에도 입력 위치·열린 설정 패널을 유지합니다.
  const wasNetwork=currentPcView==='network';
  const settingsOpen=wasNetwork&&element.content.querySelector('.pc-advanced-settings')?.open===true;
  const previousScroll=wasNetwork?element.content.querySelector('.pc-workspace-main')?.scrollTop||0:0;
  currentPcView='network';
  const snapshot=inspectAdapter(state);
  if(employee().npcId==='park')dnsAction('network-opened');
  save();
  if(!notice&&state.incident.status==='action_taken'&&(!isTutorial(state)||currentFirstDayStep(firstDayTour)?.id==='verify'||!isFirstDayTourActive(firstDayTour)))notice='조치가 적용됐습니다. 아직 해결 완료가 아니에요. 아래 [연결 상태 검사]를 눌러 정상 여부를 확인하세요.';
  const visibleSnapshot=employeeSharedSnapshot(snapshot);
  const adapterDisabled=sharedInfrastructure.adapterDisabled?.[employee().port]===true;
  const hasUnresolvedConfigIssue=visibleSnapshot.ipConflict||!visibleSnapshot.gatewayGood||!visibleSnapshot.dnsGood||!visibleSnapshot.portalAllowed;
  const recoveryIssue=adapterDisabled?'adapter':hasUnresolvedConfigIssue&&state.incident.pcWorkHistory?.some(row=>String(row.impact||'').includes('장애'))?'settings':null;
  showPcScreen(`${employee().npcName} PC · 네트워크 관리`,'네트워크 설정',renderNetwork(visibleSnapshot,notice,employee().npcName,{finalEvaluation:isHardEvaluation()&&['cable-unplugged','dhcp-down','dhcp-lease-expired','dns-wrong','switch-port-disabled'].includes(state.incident.rootCause),tutorial:isTutorial(state),dnsStep:getDnsTutorialStep(state),advanced:!isTutorial(state)&&state.run?.pcExpanded===true,recoveryIssue,workHistory:state.incident.pcWorkHistory||[],learning:pcInspectionFeedback({snapshot:visibleSnapshot,notice,difficulty:difficultyForCase(state,state.scenarioIndex)}),verificationCue:isTutorial(state)?['network','verify'].includes(currentFirstDayStep(firstDayTour)?.id):false,needsVerification:state.incident.status==='action_taken'&&(!isTutorial(state)||currentFirstDayStep(firstDayTour)?.id==='verify'||!isFirstDayTourActive(firstDayTour))}), 'network');
  const settings=element.content.querySelector('.pc-advanced-settings');
  if(settings&&settingsOpen)settings.open=true;
  if(wasNetwork){const mainPane=element.content.querySelector('.pc-workspace-main');if(mainPane)mainPane.scrollTop=previousScroll;}
}
function showPcBrowser(notice=''){
  if(blockFirstDayInput('pc:browser')&&isDnsTutorialActive(state))return;
  if(needAccept())return;
  currentPcView='browser';
  const result=inspectBrowser(state);save();
  if(!notice&&state.incident.status==='action_taken')notice='조치는 완료됐지만 아직 검증 전이에요. [페이지 접속 검사]로 정상화를 확인하세요.';
  showPcScreen(`${employee().npcName} PC · 웹 브라우저`,'회사 포털 접속',renderBrowser(employeeSharedSnapshot(getNetworkSnapshot(state)),result,notice,{finalEvaluation:isHardEvaluation()&&state.incident.rootCause==='web-service-stopped',tutorial:isTutorial(state),dnsStep:getDnsTutorialStep(state)}), 'browser');
}
function showDhcpServer(notice='',outcome=null){
  audio.play('inspect');
  const owner=activeCauseOwner(state,'dhcp-down')||activeCauseOwner(state,'dhcp-lease-expired');
  if(!owner) {
    showModal('서버실 · DHCP','서비스 상태 조회','<p>현재 DHCP 점검이 필요한 사건은 없습니다. 서버실 장비 목록으로 돌아가 주세요.</p>',[{label:'장비 목록',primary:true,onClick:()=>showServer()}]);return;
  }
  const npcId=owner.scenario.npcId;
  if(getDeviceInspectionAccess(state,npcId)==='unaccepted'){
    currentPcView='dhcp';
    showModal('서버실 · 네트워크 서비스','서버 장비 점검',renderPendingInspection('DHCP / DNS 서버',owner.scenario.npcName),[
      {label:'장비 목록',onClick:()=>showServer()},
      {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
    ],{wide:true});return;
  }
  selectIncident(state,npcId);
  currentPcView='dhcp';
  const status=inspectServer(state);save();
  showModal('서버실 · 네트워크 서비스','서버 장비 점검',renderServer(status,notice,{outcome,learning:dhcpInspectionFeedback({server:status,incident:state.incident,difficulty:difficultyForCase(state,state.scenarioIndex)})}),[
    {label:'장비 목록',onClick:()=>showServer()},
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true});
}
// 서버실 실습의 완료 기록은 별도 보관하지만, 조작에 따른 공유 인프라 영향은 난이도에 맞춰 전파합니다.
let serverLabProgress=readServerLabProgress(readSetting(SERVER_LAB_PROGRESS_KEY));
let serverLabSession=null;
function showServerLabHub(){
  if(timeAttackSession){toast('타임어택 중에는 서버실 운영 실습을 시작할 수 없습니다.');return;}
  currentPcView='server-lab-hub';audio.play('inspect');
  showModal('서버실 · 학습용 가상 서버','서버 운영 실습',renderServerLabHub(serverLabProgress,{difficulty:unifiedDifficulty})+infrastructurePane('server'),[
    {label:'서버실 장비 목록',onClick:showServer},
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true});
}
function showServerLab(kind){
  if(timeAttackSession){toast('타임어택 중에는 서버실 운영 실습을 시작할 수 없습니다.');return;}
  if(!SERVER_LAB_SCENARIOS[kind])return;
  serverLabSession=newServerLabSession(kind,{difficulty:unifiedDifficulty});
  if(unifiedDifficulty!=='easy')serverLabSession=inheritSharedServerState(serverLabSession,sharedInfrastructure);
  currentPcView='server-lab';audio.play('inspect');
  showModal('서버실 · 학습용 가상 Linux','서버 장애 진단',renderServerLabSession(serverLabSession,{shared:sharedInfrastructure}),[
    {label:'실습 목록',onClick:showServerLabHub},
    {label:'서버실 장비 목록',primary:true,onClick:showServer},
  ],{wide:true});
  element.content.querySelector('#server-lab-command-input')?.focus();
}
function refreshServerLabScreen(){
  const panel=element.content.querySelector('.server-lab-session');
  if(!panel||!serverLabSession)return;
  panel.outerHTML=renderServerLabSession(serverLabSession,{shared:sharedInfrastructure});
  const log=element.content.querySelector('.server-lab-logs');
  if(log)log.scrollTop=log.scrollHeight;
  element.content.querySelector('#server-lab-command-input')?.focus();
}
function showServer() {
  audio.play('inspect');currentPcView='serverhub';
  const dhcpOwner=activeCauseOwner(state,'dhcp-down')||activeCauseOwner(state,'dhcp-lease-expired');
  const switchOwner=activeCauseOwner(state,'switch-port-disabled');
  showModal('서버실 · 장비 관리','서버실 장비 목록',renderEquipmentHub({
    dhcpRunning:!dhcpOwner||dhcpOwner.incident.dhcpRunning,
    webServiceRunning:state.infrastructure.webServiceRunning,
    disabledPorts:getSwitchPorts(state).filter(port=>!port.adminUp).length,
    switchAwaitingIntake:!!switchOwner&&getDeviceInspectionAccess(state,switchOwner.scenario.npcId)==='unaccepted',
    dhcpAwaitingIntake:!!dhcpOwner&&getDeviceInspectionAccess(state,dhcpOwner.scenario.npcId)==='unaccepted',
    webAwaitingIntake:getDeviceInspectionAccess(state,'jung')==='unaccepted',
  })+infrastructurePane('server'),[{label:'사무실로 돌아가기',primary:true,onClick:closeModal}],{wide:true});
}
function showSwitchManager(port=null,notice='',outcome=null) {
  currentPcView='switch';
  const owner=activeCauseOwner(state,'switch-port-disabled');
  if(owner&&getDeviceInspectionAccess(state,owner.scenario.npcId)==='ready')selectIncident(state,owner.scenario.npcId);
  const targetPort=port??owner?.scenario.port??3;
  const data=inspectSwitch(state,targetPort);
  save();
  showModal('서버실 · 스위치 관리','스위치 포트 점검',renderSwitchManager(data,notice,{outcome,learning:switchInspectionFeedback({data,difficulty:unifiedDifficulty})}),[
    {label:'장비 목록',onClick:()=>showServer()},
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true});
}
function showRouterManager() {
  currentPcView='router';
  showModal('서버실 · 라우터','라우터 상태 조회',renderRouterManager(),[
    {label:'장비 목록',onClick:()=>showServer()},
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true});
}
function showWebManager(notice='',outcome=null) {
  currentPcView='web';
  if(getDeviceInspectionAccess(state,'jung')==='ready')selectIncident(state,'jung');
  const info=inspectWebService(state);save();
  showModal('서버실 · 웹 서비스 관리','사내 웹 서버',renderWebServerManager(info,notice,{outcome,learning:webInspectionFeedback({data:info,difficulty:unifiedDifficulty})}),[
    {label:'장비 목록',onClick:()=>showServer()},
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true});
}
// 서버실 장비를 바꿔도 직원별 사건은 따로 보존합니다.
element.content.addEventListener('click',event=>{
  const button=event.target.closest('button[data-device-action]');
  if(!button)return;
  const action=button.dataset.deviceAction;
  if(action==='hub')return showServer();
  if(action==='switch')return showSwitchManager();
  if(action==='router')return showRouterManager();
  if(action==='dhcp')return showDhcpServer();
  if(action==='web')return showWebManager();
  if(action==='lab')return showServerLabHub();
  if(action==='pending-talk'){
    const owner=SCENARIOS.find(s=>s.npcName===button.dataset.staff&&npcHasActiveIncident(state,s.npcId));
    if(owner){closeModal();showNpc(owner.npcId);}
    else toast('현재 접수 대기 중인 담당 직원이 없습니다.');
    return;
  }
  if(action==='switch-port')return showSwitchManager(Number(button.dataset.port));
  if(action==='switch-enable') {
    const repairPort=activeCauseOwner(state,'switch-port-disabled')?.scenario.port;
    const result=setSwitchPort(state,repairPort,true);
    audio.play(result.success?'cable':'error');save();showSwitchManager(repairPort,result.message,result);
    return;
  }
  if(action==='web-start') {
    const result=startWebService(state);
    audio.play(result.success?'cable':'error');save();showWebManager(result.message,result);
  }
});
// 직접 명령을 입력해야 하며, 예시 버튼은 자동 실행하지 않습니다.
element.content.addEventListener('click',event=>{
  const start=event.target.closest('button[data-server-lab-start]');
  if(start&&currentPcView==='server-lab-hub'){showServerLab(start.dataset.serverLabStart);return;}
  const restart=event.target.closest('button[data-server-lab-restart]');
  if(restart&&currentPcView==='server-lab'){showServerLab(restart.dataset.serverLabRestart);return;}
  const example=event.target.closest('button[data-server-lab-example]');
  if(example&&currentPcView==='server-lab'){
    const input=element.content.querySelector('#server-lab-command-input');
    if(input){input.value=example.dataset.serverLabExample;input.focus();}
  }
});
element.content.addEventListener('submit',event=>{
  const form=event.target.closest('form[data-server-lab-command]');
  if(!form||currentPcView!=='server-lab'||!serverLabSession)return;
  event.preventDefault();
  const raw=form.elements.namedItem('command')?.value||'';
  if(!raw.trim())return;
  const wasComplete=serverLabSession.complete;
  const previousServer=serverLabSession;
  serverLabSession=executeServerLabCommand(serverLabSession,raw);
  syncSharedInfrastructure(applyServerPracticeImpact(sharedInfrastructure,previousServer,serverLabSession,{difficulty:serverLabSession.difficulty}));
  if(!wasComplete&&serverLabSession.complete){
    serverLabProgress=completeServerLabProgress(serverLabProgress,serverLabSession);
    try{localStorage.setItem(SERVER_LAB_PROGRESS_KEY,JSON.stringify(serverLabProgress));}
    catch{toast('실습은 완료했지만 서버실 결과 기록을 저장하지 못했습니다.');}
    audio.play('success');
  }else audio.play('terminal');
  refreshServerLabScreen();
});
function showPcTerminal(){
  if(blockFirstDayInput('pc:terminal')&&isDnsTutorialActive(state))return;
  if(needAccept())return;
  currentPcView='terminal';
  const session=getTerminalSession(employee().npcId);
  const guidedInterpretation=isTutorial(state)&&employee().npcId==='kim'&&currentFirstDayStep(firstDayTour)?.id==='verify';
  showPcScreen(`${employee().npcName} PC · 가상 터미널`,'명령 프롬프트',renderTerminal(employee().npcName,session.entries,{guidedInterpretation,dnsStep:getDnsTutorialStep(state)}), 'terminal');
  const log=element.content.querySelector('#terminal-history');
  if(log)log.scrollTop=log.scrollHeight;
  element.content.querySelector('#terminal-command')?.focus();
}
// Enter 제출만 실행하며 실제 셸/인터넷 요청으로 전달하지 않습니다.
element.content.addEventListener('submit',event=>{ 
  const form=event.target.closest('form[data-terminal-form]');
  if(!form || currentPcView!=='terminal')return;
  event.preventDefault();
  const raw=form.querySelector('#terminal-command')?.value.trim()||'';
  if(!raw)return;
  audio.play('terminal');
  const session=getTerminalSession(employee().npcId);
  // 직원의 임의 조치로 끊긴 가상 어댑터를 CLI에서 직접 활성화할 수 있습니다.
  const adapterCmd=raw.match(/^netsh interface set interface name="Ethernet 0" admin=(enabled|disabled)$/i);
  let result;
  if(!dnsTutorialCommandAllowed(state,raw)) {
    result={success:false,output:getDnsTutorialStep(state)===9?'🎓 DNS 진단을 마쳤어요. 네트워크 설정에서 DNS 주소를 수정하세요.':`🎓 현재 단계에서 입력할 명령어: ${getDnsTutorialStep(state)===7?'ping 8.8.8.8':'nslookup portal.example.test'}\n올바른 명령어를 입력한 뒤 Enter를 누르세요.`};
  }else if(adapterCmd){
    const desired=adapterCmd[1].toLowerCase()==='enabled';
    const changed=applyEmployeeAdapterImpact(sharedInfrastructure,employee().port,desired);
    if(changed.revision!==sharedInfrastructure.revision)syncSharedInfrastructure(changed);
    result={success:true,output:`Ethernet 0 가상 어댑터 ${desired?'활성화':'비활성화'} 완료. ipconfig와 ping으로 정상화 여부를 확인하세요.`};
  }else result=executeTerminalCommand(state,raw);
  if(result.changed)syncEmployeeSharedStatus();
  // ipconfig는 로컬 NIC 구성 조회이므로 공유망 장애가 있어도 자체 실행/출력은 허용합니다.
  const connectivityError=/^(?:ping|nslookup)(?:\s|$)/i.test(raw)?sharedPcFailure(false):'';
  if(connectivityError){result.output=`공유 가상 인프라 통신 실패: ${connectivityError}\n현재 PC의 가상 어댑터·스위치 상태를 확인하세요.`;result.success=false;}
  session.history.push(raw);
  if(session.history.length>40)session.history.shift();
  session.historyIndex=session.history.length;
  if(result.clear){session.entries=[];}
  else if(result.close){showPc();return;}
  else {
    session.entries.push({kind:'command',text:'C:\\Users\\'+employee().npcName+'> '+raw});
    session.entries.push({kind:'output',text:result.output});
    if(session.entries.length>40)session.entries.splice(0,session.entries.length-40);
  }
  if(result.success&&employee().npcId==='kim')tourAction('command',{command:raw});
  if(result.success&&employee().npcId==='park') {
    const command=raw.trim().replace(/\s+/g,' ').toLowerCase();
    if(command==='ping 8.8.8.8')dnsAction('ping-success',{command,reply:/Reply from 8\.8\.8\.8/.test(result.output)&&/Lost = 0/.test(result.output)});
    if(command==='nslookup portal.example.test')dnsAction('dns-timeout',{command,timedOut:/DNS request timed out|timed-out/i.test(result.output)});
  }
  save();
  showPcTerminal();
});
// 직원 PC 직접 설정 변경: 실행 값과 결과는 가상 사건 상태에만 반영됩니다.
element.content.addEventListener('submit',event=>{
  const form=event.target.closest('form[data-employee-pc-config]');
  if(!form||currentPcView!=='network')return;
  event.preventDefault();
  if(!state.run?.pcExpanded)return;
  const field=form.dataset.employeePcConfig;
  let value=form.elements.namedItem('value')?.value||'';
  if(field==='portal-rule')value=!getNetworkSnapshot(state).portalBlockRule;
  const result=setEmployeePcConfig(state,field,value);
  if(result.changed)syncEmployeeSharedStatus();
  audio.play(result.success?'cable':'error');
  save();showPcNetwork(result.message);
});
// 결과 해설은 터미널 아래의 독립 패널만 열고 닫습니다. 출력·입력 영역을 가리지 않습니다.
element.content.addEventListener('click',event=>{
  if(currentPcView!=='terminal')return;
  const toggle=event.target.closest('button[data-terminal-lesson-toggle]');
  const close=event.target.closest('button[data-terminal-lesson-close]');
  if(!toggle&&!close)return;
  const panel=element.content.querySelector('#terminal-lesson-panel');
  const button=element.content.querySelector('[data-terminal-lesson-toggle]');
  if(!panel||!button)return;
  const expand=!!toggle&&panel.hidden;
  panel.hidden=!expand;
  button.setAttribute('aria-expanded',String(expand));
  button.setAttribute('aria-label',expand?'명령어 결과 해설 닫기':'명령어 결과 해설 열기');
  if(expand)panel.scrollIntoView({block:'nearest'});
  if(close)button.focus();
});
// 입력 예시는 입력칸을 채우기만 하며 자동 실행하지 않습니다.
element.content.addEventListener('click',event=>{
  const example=event.target.closest('button[data-terminal-example]');
  if(!example || currentPcView!=='terminal')return;
  const input=element.content.querySelector('#terminal-command');
  if(input){input.value=example.dataset.terminalExample;input.focus();}
});
element.content.addEventListener('keydown',event=>{
  if(currentPcView!=='terminal' || event.target.id!=='terminal-command')return;
  if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;
  const session=getTerminalSession(employee().npcId);
  if(!session.history.length)return;
  event.preventDefault();
  session.historyIndex=Math.max(0,Math.min(session.history.length,
    session.historyIndex+(event.key==='ArrowUp'?-1:1)));
  event.target.value=session.history[session.historyIndex]||'';
});
function showChassis(npcId=employee().npcId){
  if(highlightedDevice?.npcId===npcId)clearDeviceGuide();
  if(!checkTarget(npcId)||needAccept())return;
  audio.play('inspect');
  // 첫 튜토리얼은 PC의 이더넷 연결 끊김을 실제로 발견한 다음 본체 조치 가능.
  if(state.incident.rootCause==='cable-unplugged'&&!state.incident.evidence.includes('adapterChecked')) {
    currentPcView='guide';
    showModal('조사 순서','먼저 PC의 연결 상태를 확인해 주세요',
      '<p>PC의 <strong>네트워크 설정</strong>에서 어떤 문제가 있는지 확인한 뒤 본체를 점검해 보세요.</p>',
      [{label:'모니터 화면 확인하기',primary:true,onClick:()=>showPc()},{label:'책상 정면으로',onClick:()=>showPcFront()}]);
    return;
  }
  currentPcView='chassis';
  const result=inspectCable(state);save();
  if(!result)return;
  // 본체를 열기만 해서는 완료되지 않습니다. 물리 LAN 포트를 선택해야 합니다.
  showModal(`${employee().npcName} PC 본체 · 후면`,'LAN 포트 점검',
    renderPcWorkspace('chassis',renderChassis(result.connected,employee().npcName,{wasRepaired:state.incident.evidence.includes('cableFixed'),linkUp:getNetworkSnapshot(state).connected,diagnostic:observedDiagnosticNextStep(state.incident,{linkUp:getNetworkSnapshot(state).connected}),tutorial:isTutorial(state)})),[
    {label:'책상 정면으로 돌아가기',primary:true,onClick:()=>showPcFront()},
    {label:'모니터 화면 보기',onClick:()=>showPc()},
  ],{wide:true,pc:true});
}
function isHardEvaluation(){
  return runMode(state)==='random'&&difficultyForCase(state)==='hard';
}
function runNetworkTest(from,{finalSubmission=false}={}){
  if(blockFirstDayInput(from==='network'?'pc:test-network':'pc:test-browser'))return;
  if(from==='network'&&employee().npcId==='kim')tourAction('network');
  // 일반 검사는 여러 번 실패해도 감점되지 않습니다.
  const sharedError=sharedPcFailure(from==='browser');
  if(sharedError){
    audio.play('error');
    if(from==='browser')showPcBrowser(`공용 인프라 장애 · ${sharedError}`);
    else showPcNetwork(`공용 인프라 장애 · ${sharedError}`);
    return;
  }
  const result=verify(state,from,{diagnostic:!finalSubmission});
  if(from==='browser'&&employee().npcId==='park'&&!result.success)
    dnsAction('browser-failed',{failed:!getNetworkSnapshot(state).dnsGood});
  save();
  if(result.success&&result.completed!==false){
    if(from==='network'&&employee().npcId==='kim')tourAction('verify');
    showSuccess();return;
  }
  audio.play(result.success?'ui':'error');
  if(from==='browser')showPcBrowser(result.message);
  else showPcNetwork(result.message);
  // 서버 관련 오류는 PC 안에 다음 이동 장소를 직접 표시합니다.
  const tested=getNetworkSnapshot(state);
  const hint=element.content.querySelector('.network-notice-slot,.browser-notice-slot');
  if(!result.success && hint && !tested.connected && difficultyForCase(state)!=='hard'){
    hint.insertAdjacentHTML('beforeend','<div class="next-action-note">🔧 다음 단계: PC 화면을 닫고 담당 PC의 <strong>본체 후면(F)</strong>에서 LAN 케이블을 확인하세요. 튜토리얼에서는 왼쪽의 <b>PC 본체 위치 보기</b>를 누를 수 있어요.</div>');
  }else if(!result.success && hint && difficultyForCase(state)!=='hard' && tested.networkReachable && tested.dnsGood && !tested.serviceRunning){
    hint.insertAdjacentHTML('beforeend','<div class="next-action-note">🖧 다음 단계: PC 창을 닫고 <strong>서버실</strong>로 이동하세요. <button type="button" class="next-action-button" data-pc-action="go-server">🖧 PC 닫고 서버실 위치 보기</button></div>');
  }else if(!result.success && hint && difficultyForCase(state)==='hard' && tested.networkReachable && !tested.serviceRunning){
    hint.insertAdjacentHTML('beforeend','<div class="next-action-note">접속 결과를 분석하고 서비스 경로를 추가 조사하세요. <button type="button" class="next-action-button" data-pc-action="go-server">서버실 위치 보기</button></div>');
  }
}
element.content.addEventListener('click',event=>{
  const button=event.target.closest('button[data-pc-inspection]');
  if(!button || !['pc-root','desktop','network','browser','terminal','mail','mail-detail','security','chassis'].includes(currentPcView))return;
  const action=button.dataset.pcInspection;
  if(action==='front')showPcFront();
  else if(action==='monitor')showPc();
  else if(action==='tower')showChassis(employee().npcId);
});
element.content.addEventListener('click',e=>{
  const button=e.target.closest('[data-pc-front-action]');
  if(!button || currentPcView!=='pc-root')return;
  if(button.dataset.pcFrontAction==='monitor')showPc();
  else if(button.dataset.pcFrontAction==='tower')showChassis(employee().npcId);
});
// 가상 PC 내부 UI의 조작은 이벤트 위임으로 처리하여 모달 전환 후에도 동작합니다.
element.content.addEventListener('click', e=>{
  const button=e.target.closest('button[data-pc-action]');
  if(!button)return;
  const actions={
    'close-pc':()=>closeModal(),
    desktop:()=>showPc(),network:()=>showPcNetwork(),browser:()=>showPcBrowser(),terminal:()=>showPcTerminal(),
    mail:()=>showMailInbox(), security:()=>showLoginConsole(),
    'test-network':()=>runNetworkTest('network'),
    'test-browser':()=>runNetworkTest('browser'),
    'final-network':()=>runNetworkTest('network',{finalSubmission:true}),
    'final-browser':()=>runNetworkTest('browser',{finalSubmission:true}),
    'restart-dhcp':()=>{const r=startDhcp(state);audio.play(r.success?'cable':'error');save();showDhcpServer(r.message,r);},
    'renew-lease':()=>{const r=renewLease(state);audio.play(r.success?'cable':'error');save();showPcNetwork(r.message);},
    'fix-dns':()=>confirmDnsChange(),
    'go-server':()=>guideToServerRoom(),
    'open-direct-settings':()=>{const panel=element.content.querySelector('.pc-advanced-settings');if(panel){panel.open=true;panel.scrollIntoView({block:'nearest',behavior:'smooth'});}},
    'connect-cable':()=>{
      const result=reconnectCable(state);audio.play(result.success?'cable':'error');save();
      showChassis(employee().npcId);
      if(result.success&&employee().npcId==='kim')tourAction('tower');
      toast(result.success&&isTutorial(state)&&currentFirstDayStep(firstDayTour)?.id==='command'
        ?'LAN 연결 완료! 명령 프롬프트에서 ipconfig를 실행해 IP 주소를 먼저 확인하세요.':result.message);
    },
    'port-info':()=>{
      const result=observedDiagnosticNextStep(state.incident,{linkUp:getNetworkSnapshot(state).connected});
      showChassis(employee().npcId);
      if(employee().npcId==='kim'&&getNetworkSnapshot(state).connected)tourAction('tower');
      const message=result.description;
      const feedback=element.content.querySelector('.rear-diagnostic');
      if(feedback){feedback.setAttribute('role','status');}else toast(message);
    },
  };
  actions[button.dataset.pcAction]?.();
});
function confirmDnsChange(){
  const current=getNetworkSnapshot(state);
  if(!current.canFixDns)return showPcNetwork('현재 DNS 주소에 변경할 사항이 없습니다.');
  currentPcView='dns-confirm';
  showModal('PC · 네트워크 설정','DNS 주소를 변경할까요?',
    `<p><b>현재 DNS 설정: ${current.dns}</b></p><p>주소가 정상인지 살펴본 뒤 수정 여부를 결정하세요.</p><p>이 버튼은 단순 조회가 아니라 실제 <strong>가상 PC의 DNS 주소 설정을 정상값으로 수정하는 조치</strong>예요.</p><p class="modal-tip">변경 후에도 해결 완료가 아니에요. 웹 브라우저로 돌아가 <b>페이지 접속 검사</b>를 진행해야 합니다.</p>`,[
      {label:'취소 · 변경 안 함',onClick:()=>showPcNetwork()},
      {label:'DNS 주소 수정 적용',primary:true,onClick:()=>{
        if(blockFirstDayInput('pc:fix-dns'))return;
        const r=restoreDns(state);
        if(r.success&&employee().npcId==='park')dnsAction('dns-restored',{good:getNetworkSnapshot(state).dnsGood});
        audio.play(r.success?'cable':'error');save();
        if(r.success&&getDnsTutorialStep(state)===10)showPcBrowser(r.message);
        else showPcNetwork(r.message);
      }},
    ]);
}
// v0.8 - 조사와 복구가 분리된 보안 대응 화면.
function showMailInbox(notice='') {
  if(needAccept())return;
  currentPcView='mail';
  const sec=state.incident.security;
  showPcScreen('한사원 PC · 가상 메일함','이메일 확인',renderInbox(sec,notice,{cause:state.incident.rootCause}), 'mail');
}
function showMailDetail(notice='') {
  if(needAccept())return;
  currentPcView='mail-detail';
  const result=inspectMail(state);
  if(!result.success){toast(result.message);return;}
  save();
  showPcScreen('한사원 PC · 메일 상세','의심 메일 점검',renderMailDetails(state.incident.security,notice,{finalEvaluation:isHardEvaluation(),cause:state.incident.rootCause}), 'mail-detail',[{label:'← 받은 편지함',onClick:()=>showMailInbox()}]);
}
let selectedLoginAuditEntryId=null,selectedLoginAuditCase=null;
function showLoginConsole(notice='',analyzedEntryId=null) {
  const currentCase=`${state.run?.round||1}:${state.incident?.id||''}`;
  if(selectedLoginAuditCase!==currentCase){selectedLoginAuditEntryId=null;selectedLoginAuditCase=currentCase;}
  if(analyzedEntryId)selectedLoginAuditEntryId=analyzedEntryId;
  if(needAccept())return;
  currentPcView='security';
  const result=inspectLoginLog(state);
  if(!result.success){toast(result.message);return;}
  save();
  showPcScreen('송대리 PC · 계정 보안','로그인 감사 로그',renderLoginAudit(state.incident.security,notice,{finalEvaluation:isHardEvaluation(),analyzedEntryId:selectedLoginAuditEntryId}), 'security');
}
// 실제 외부 사이트 접속이나 계정 변경 없이 로컬 가상 사건에만 적용합니다.
element.content.addEventListener('click',event=>{
  const button=event.target.closest('button[data-security-action]');
  if(!button)return;
  const action=button.dataset.securityAction;
  if(action==='desktop')return showPc();
  if(action==='mail-inbox')return showMailInbox();
  if(action==='mail-open')return showMailDetail();
  const changes={
    'mail-analyze':()=>inspectMailIndicators(state),
    'mail-report':()=>reportPhishing(state),
    'mail-quarantine':()=>quarantineMail(state),
    'log-analyze':()=>flagSuspiciousLogin(state,button.dataset.entryId),
    'log-revoke':()=>revokeSuspiciousSession(state,selectedLoginAuditEntryId),
    'log-restore-normal':()=>restoreNormalLoginSession(state),
    'log-secure':()=>secureAccount(state),
    'security-verify':()=>verify(state,'security',{diagnostic:true}),
    'security-final':()=>verify(state,'security',{diagnostic:false}),
  };
  const op=changes[action];if(!op)return;
  const result=op();
  audio.play(result.success&&!result.mistake?'ui':'error');save();
  if(result.success && result.completed!==false && (action==='security-verify'||action==='security-final'))return showSuccess();
  if(currentPcView==='security')showLoginConsole(result.message,action==='log-analyze'?button.dataset.entryId:null);
  else if(currentPcView==='mail-detail')showMailDetail(result.message);
  else showMailInbox(result.message);
});
function skipTimeAttackCaseTransition(){
  if(!timeAttackSession||!modalOpen||currentPcView!=='success')return false;
  clearTimeAttackSuccessTimer();
  completionEffectPending=false;
  pendingIntakeIndices=[];clearTimeout(intakeScheduleTimer);intakeScheduleTimer=null;
  // One click/key skips both the result popup and the 3D check animation.
  closeModal();
  world.resetCompletionEffect();
  finishCompletedCase({fastForward:true});
  return true;
}
function showSuccess(){
  if(timeAttackSession)pauseCurrentTimeAttack();
  // 사건을 해결한 직원의 불만 표정은 바로 정상으로 되돌립니다.
  const restoredNpc=world?.npcModels?.[employee()?.npcId];
  if(restoredNpc)restoredNpc.userData.head.material.color.set('#fff7ef');
  audio.play('success');
  currentPcView='success';
  completionEffectPending=true;
  completionTransitionActive=Boolean(timeAttackSession);
  const scenario=casePresentation(state);
  const score=getCaseScore(state);
  // 타임어택은 학습 팝업을 강제로 읽게 하지 않습니다. 기존 기록과 평가는 그대로 저장됩니다.
  if(timeAttackSession){
    const summary=getContinuousSummary(state);
    showModal('⏱ 타임어택 · 사건 해결',`${scenario.npcName} 문제 해결!`,
      renderTimeAttackCaseResolved({npcName:scenario.npcName,score:score?.total,solved:summary?.total??0}),
      [{label:'다음 업무 즉시 진행',primary:true,onClick:skipTimeAttackCaseTransition}],{timeAttackSuccess:true});
    timeAttackSuccessTimer=setTimeout(()=>{
      if(timeAttackSession&&modalOpen&&currentPcView==='success')closeModal();
    },TIME_ATTACK_SUCCESS_HOLD_MS);
    return;
  }
  const scoreMarkup=score?`<div class="evaluation-brief"><strong>업무 평가 ${score.total}점 / 100점</strong><span>증거 ${score.investigation}/30 · 원인 ${score.diagnosis}/25 · 조치 ${score.action}/25 · 검증 ${score.validation}/20 · 감점 ${score.deduction}${score.diagnostics?' · 일반 검사 실패 '+score.diagnostics+'회':''}</span></div>`:'';
  const tutorialStep=TUTORIAL_ORDER.indexOf(state.scenarioIndex);
  const nextInstruction=isTutorial(state)?tutorialStep===0
    ? '다음 연습은 박과장의 DNS 장애예요. 돌아가면 새 업무가 접수되고 왼쪽 카드에서 바로 확인할 수 있어요.'
    : '연습 2건을 모두 마쳤어요. 이어서 난이도를 선택하면 본 게임으로 넘어갈 수 있어요.'
    : '사무실로 돌아가면 다음 사건을 안내해요. 왼쪽 사건 카드의 [다음 행동] 버튼을 따라 진행하세요.';
  showModal(isTutorial(state)?`연습 ${tutorialStep+1}/2 완료`:`사건 #${String(state.scenarioIndex+1).padStart(3,'0')} 완료`,`${scenario.npcName} 문제를 해결했어요! 🎉`,
    `<div class="learning-success-lead"><span class="learning-success-icon" aria-hidden="true">✓</span><div><strong>정상화 검사 통과 · 사건 해결 완료</strong><p>조사 → 조치 → 검증을 마쳤어요. 어떤 증거로 해결했는지 돌아볼까요?</p></div></div>${scoreMarkup}${renderResolutionLearning(state,state.scenarioIndex,{expandReview:true})}<p class="next-case-notice">🎯 ${nextInstruction}</p>`,
    [{label:'업무 수첩 보기',onClick:showJournal},{label:isTutorial(state)?tutorialStep===0?'다음 연습으로 이동':'튜토리얼 완료 확인하기':'다음 업무 확인하기',primary:true,onClick:closeModal}],{wide:true});
}
function buildCurrentOperationsReport(){
  return buildOperationsReport({state,linked:linkedIncidents,shared:sharedInfrastructure,labReports,serverLabProgress});
}
function showOperationsReport(){
  if(timeAttackSession){toast('타임어택 중에는 통합 운영 보고서를 열 수 없습니다.');return;}
  currentPcView='operations-report';
  showModal('GOCHYEORA · 통합 운영','통합 운영 보고서',renderOperationsReport(buildCurrentOperationsReport()),[
    {label:'업무 수첩',onClick:()=>showJournal()},
    {label:'사무실로 돌아가기',primary:true,onClick:closeModal},
  ],{wide:true});
}
function exportOperationsReport(){
  if(timeAttackSession)return;
  const blob=new Blob(['\ufeff',operationsReportAsText(buildCurrentOperationsReport())],{type:'text/plain;charset=utf-8'});
  const href=URL.createObjectURL(blob);
  const anchor=document.createElement('a');anchor.href=href;
  anchor.download='GOCHYEORA_OPERATIONS_REPORT_v1.9.4.txt';
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(href),1000);
}
element.content.addEventListener('click',event=>{
  if(event.target.closest('button[data-ops-report-open]')){showOperationsReport();return;}
  if(currentPcView!=='operations-report')return;
  if(event.target.closest('button[data-ops-report-export]')){exportOperationsReport();return;}
  const button=event.target.closest('button[data-ops-go]');
  if(button){
    if(button.dataset.opsGo==='linked')showLinkedIncidentReport();
    else if(button.dataset.opsGo==='lab')showLabReports();
    else if(button.dataset.opsGo==='server')showServerLabHub();
    else if(button.dataset.opsGo==='journal')showJournal();
  }
});
function showFinalReport(){
  if(!isContinuousRun(state)&&!hasFinishedDay(state)){
    toast('아직 진행 중인 사건이 있어요. 모든 사건을 해결한 뒤 성적표를 확인할 수 있어요.');
    return;
  }
  // 완료 직후 수첩/메뉴에서 수동 열람했다면 연출 종료 시 자동으로 중복 표시하지 않습니다.
  dayCompleteShown=true;
  currentPcView='report';
  showModal('GOCHYEORA · 업무 기록',isContinuousRun(state)?'누적 업무 실적 조회':'오늘의 업무 성적표',(!timeAttackSession&&!isTutorial(state)?'<div class="ops-report-shortcut"><button type="button" data-ops-report-open>📋 통합 운영 보고서 보기</button></div>':'')+(isContinuousRun(state)?renderContinuousReport(state,workShiftLedger):renderFinalReport(state))+(!timeAttackSession&&!isTutorial(state)?renderLinkedReport(linkedIncidents):''),[
    {label:'업무 수첩 보기',onClick:()=>showJournal()},
    ...(isContinuousRun(state)?[
      {label:'게임 계속하기',onClick:closeModal},
      {label:'🏁 오늘 업무 마치기',primary:true,onClick:confirmFinishWorkShift},
    ]:[{label:'새 랜덤 업무 시작',primary:true,onClick:showDifficultyChoice}]),
  ],{wide:true});
}
function showJournal(selectedIndex=state.scenarioIndex){
  currentPcView='journal';
  const buttons=[];
  if(hasFinishedDay(state))buttons.push({label:'최종 성적표',onClick:showFinalReport});
  else if(isContinuousRun(state))buttons.push({label:'누적 실적',onClick:showFinalReport});
  buttons.push({label:'닫기',primary:true,onClick:closeModal});
  showModal('Tab · 업무 수첩','사건별 해결 기록',(!isTutorial(state)&&!timeAttackSession?'<div class="ops-report-shortcut"><button type="button" data-ops-report-open>📋 통합 운영 보고서 보기</button></div>':'')+renderJournal(state,selectedIndex),buttons,{journal:true});
}
// 사건을 선택해도 진행 중인 게임 상태는 변경되지 않습니다.
element.content.addEventListener('click',event=>{
  const entry=event.target.closest('button[data-journal-case]');
  if(!entry)return;
  showJournal(Number(entry.dataset.journalCase));
});
function showUpcoming(title,message){
  currentPcView='office';
  showModal('다음 업데이트에서 만나요',title,`<p>${message}</p><p class="modal-tip">프린터 장애는 이후 업데이트에서 추가할 예정입니다.</p>`,[{label:'확인',primary:true,onClick:closeModal}]);
}
function showHelp(level=0){
  if(blockFirstDayInput('help'))return;
  currentPcView='help';
  let context=getContextualHelp(state);
  if(isTutorial(state)&&currentFirstDayStep(firstDayTour)?.id==='verify'){
    context={...context,available:true,tutorial:true,title:'김대리 PC 연결 장애 · 진단 근거',levels:[
      '① 상태 관찰: 이더넷 연결 안 됨과 IPv4·게이트웨이·DNS 정보가 비어 있는지 먼저 확인하세요. 주소를 바꾸기 전에 물리 링크 상태를 의심할 근거입니다.',
      '② 원인 추론: LAN 케이블이 빠지거나 링크가 끊기면 DHCP 주소를 받을 수 없습니다. PC 본체의 RJ45 포트와 케이블 체결 상태를 비교해 보세요.',
      '③ 조치와 검증: 본체 LAN 케이블을 정상 연결한 뒤 PC 네트워크 설정으로 돌아가 연결 상태 검사를 다시 실행하세요. 조치와 정상화 확인은 다른 단계입니다.',
    ]};
  }
  const safe=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const next=Math.max(0,Math.min(context.levels.length-1,level));
  const used=state.run?.hints?.[state.incident?.id]||0;
  const penalty={easy:0,normal:5,hard:10}[difficultyForCase(state)]??5;
  let body=`<div class="contextual-help"><div class="help-level"><span>${context.tutorial?'🎓 튜토리얼 · 무료 도움말':'🧭 현재 진행 단계'}</span><strong>${safe(context.title)}</strong></div>
    <p class="help-current-line">${safe(context.levels[next]||'현재 진행 중인 사건을 선택해 주세요.')}</p>`;
  if(context.tutorial&&context.available){
    body+=`<div class="help-progress">${context.levels.map((_,i)=>`<span class="${i<=next?'on':''}"></span>`).join('')}</div><p class="help-explain">도움말 ${next+1}/3 · 튜토리얼에는 감점이 없어요.</p>`;
  } else if(context.available){
    body+=`<p class="help-explain">더 구체적인 실마리가 필요하면 힌트를 사용할 수 있어요. 현재 사건에서 ${used}/2개 확인했어요.${penalty?' 힌트 사용 시 '+penalty+'점 감점.':' 쉬움은 힌트 감점 없음.'}</p>`;
  }
  if(!context.tutorial&&context.available&&context.coach){
    const coach=context.coach;
    const label=coach.difficulty==='easy'?'순서 안내':coach.difficulty==='normal'?'진단 관점':'판단 질문';
    body+=`<section class="diagnostic-coach" aria-label="${safe(coach.title)}">
      <div class="diagnostic-coach-heading"><strong>${safe(coach.title)}</strong><span>${label}</span></div>
      <p class="diagnostic-coach-focus">${safe(coach.focus)}</p>`;
    if(coach.difficulty==='easy'){
      body+=`<ol class="diagnostic-coach-steps">${coach.checkpoints.map(step=>`<li class="${step.done?'complete':''}"><span aria-hidden="true">${step.done?'✓':'○'}</span>${safe(step.label)}</li>`).join('')}</ol>`;
    }else{
      body+=`<p class="diagnostic-coach-note">${coach.difficulty==='normal'
        ?'실제 조사에서 확인한 자료를 서로 비교하세요. 필요한 경우에만 단계별 힌트를 이용할 수 있습니다.'
        :'원인은 표시하지 않습니다. 조사 결과로 가설을 세운 뒤, 일반 검사를 통해 가설을 확인하세요.'}</p>`;
    }
    body+='</section>';
  }
  body+='</div>';
  const buttons=[];
  if(context.tutorial&&context.available&&currentFirstDayStep(firstDayTour)?.id==='verify'){
    buttons.push({label:'체험용 힌트 보기 (무료)',primary:true,onClick:()=>{
      showModal('🎓 힌트 사용 체험','힌트를 확인했어요',
        `<p>${safe(context.levels[Math.min(1,context.levels.length-1)]||'조사한 내용을 다시 살펴보세요.')}</p><p class="modal-tip">튜토리얼에서 확인한 힌트는 감점이 없어요. 실제 게임은 난이도와 사건에 따라 힌트 횟수·점수가 달라집니다.</p>`,
        [{label:'기본 연습 이어하기',primary:true,onClick:closeModal}]);
    }});
  }
  if(context.tutorial&&context.available&&next>0)buttons.push({label:'이전 안내',onClick:()=>showHelp(next-1)});
  if(context.tutorial&&context.available&&next<context.levels.length-1)buttons.push({label:'다음 안내',primary:true,onClick:()=>showHelp(next+1)});
  if(!context.tutorial&&context.available&&used<2)buttons.push({label:`단계별 힌트 ${used+1} 보기${penalty?' (-'+penalty+'점)':''}`,onClick:()=>{
    const result=revealHint(state,state.scenarioIndex);
    if(!result.success){toast(result.message);return;}
    save();audio.play('ui');
    showModal('💡 사건별 힌트',`${context.employee} · ${result.used}/2단계`,
      `<p class="message warning">${safe(result.message)}</p><p class="modal-tip">${result.penalty?'힌트 사용으로 '+result.penalty+'점 감점됩니다.':'쉬움 난이도에서는 감점되지 않습니다.'}</p>`,
      [{label:'계속 조사하기',primary:true,onClick:closeModal},{label:'다른 도움말',onClick:()=>showHelp()}]);
  }});
  buttons.push({label:'조작 방법',onClick:showControls});
  buttons.push({label:'닫기',primary:buttons.length===1,onClick:closeModal});
  showModal('H · 진행 도움말','지금 무엇을 할까요?',body,buttons);
}
function showControls(){
  currentPcView='controls';
  // '조작 방법' 메뉴는 H 상황별 도움말을 거치지 않고 키 설명을 바로 보여 줍니다.
  showModal('게임 설정 · 조작','조작 방법',renderControlsGuide(),[
    {label:'닫기',primary:true,onClick:closeModal},
  ]);
}
function showAudioSettings(){
  currentPcView='audio';
  const config=audio.getSettings();
  const percent=v=>Math.round(v*100);
  showModal('게임 설정 · 오디오','소리 설정',`<div class="audio-settings">
    <label class="audio-master"><input type="checkbox" id="audio-master" ${config.enabled?'checked':''}> 게임 소리 사용</label>
    <div class="audio-slider"><div class="audio-slider-head"><label for="audio-bgm">🎵 배경 음악 (BGM)</label><output id="audio-bgm-value">${percent(config.musicVolume)}%</output></div>
      <input id="audio-bgm" type="range" min="0" max="100" step="1" value="${percent(config.musicVolume)}" aria-label="배경 음악 음량">
      <small>조용한 사무실 분위기의 반복 음악입니다.</small></div>
    <div class="audio-slider"><div class="audio-slider-head"><label for="audio-effects">🔔 효과음</label><output id="audio-effects-value">${percent(config.effectsVolume)}%</output></div>
      <input id="audio-effects" type="range" min="0" max="100" step="1" value="${percent(config.effectsVolume)}" aria-label="효과음 음량">
      <small>사건 알림, 장비 조사, 케이블 연결, 성공·실패, 터미널 입력에 적용됩니다.</small></div>
    <p class="audio-settings-note">브라우저 정책에 따라 처음 마우스를 클릭하거나 키를 누른 뒤 음악이 시작됩니다. 음량 설정은 이 브라우저에 저장돼요.</p>
  </div>`,[{label:'게임 메뉴로',primary:true,onClick:showMenu}]);
}
element.content.addEventListener('change', event=>{
  if(event.target.id!=='audio-master')return;
  audio.setEnabled(event.target.checked); updateSoundButton();
  if(event.target.checked)audio.play('ui');
});
element.content.addEventListener('input',event=>{
  if(event.target.id==='audio-bgm') {
    audio.setMusicVolume(Number(event.target.value)/100);
    element.content.querySelector('#audio-bgm-value').textContent=event.target.value+'%';
  } else if(event.target.id==='audio-effects') {
    audio.setEffectsVolume(Number(event.target.value)/100);
    element.content.querySelector('#audio-effects-value').textContent=event.target.value+'%';
  } else return;
  updateSoundButton();
});
function setPlayMode(mode,{difficulty='normal',reset=false,silent=false}={}){
  document.getElementById('first-day-step-overlay')?.remove();
  document.body.classList.remove('first-day-step-intro-active');
  if(timeAttackSession){toast('타임어택은 먼저 종료해야 합니다.');return;}
  save();
  let nextDay=false;
  if(reset){state=newGame({mode,difficulty,continuous:mode==='random',pcExpanded:mode==='random'});employeePressure=newEmployeePressure();persistEmployeePressure();
    for(const model of Object.values(world?.npcModels||{}))model.userData.head.material.color.set('#fff7ef');}
  else {
    const previous=readSetting(storageKeyForMode(mode));
    state=previous?safeLoad(previous):newGame({mode,difficulty,continuous:mode==='random',pcExpanded:mode==='random'});
    if(runMode(state)!==mode)state=newGame({mode,difficulty,continuous:mode==='random',pcExpanded:mode==='random'});
    if(mode==='random'){
      enableContinuousRun(state);
      state.run.pcExpanded=true; // 구버전 사건 보존, 다음 새 근무부터 직원 PC 고도화 적용
      // 종료된 근무에서는 새 근무 생성 전에 자동 라운드 갱신을 실행하지 않습니다.
      // 전날 7건을 모두 해결했더라도 라운드 번호가 두 번 증가하지 않도록 합니다.
      const savedShift=loadWorkShiftLedger(readSetting(SHIFT_STORAGE_KEY),state);
      if(!workShiftIsClosed(savedShift))advanceContinuousRound(state);
    }
  }
  // 다음 근무 시작: 이전 근무의 미해결 사건은 결과 이력에 남기고 새 사건을 배정합니다.
  // 진행 중인 근무의 '이어서 근무하기'는 기존 사건을 그대로 복원합니다.
  if(mode==='random'){
    const previousLedger=reset?null:loadWorkShiftLedger(readSetting(SHIFT_STORAGE_KEY),state);
    nextDay=!reset&&workShiftIsClosed(previousLedger);
    const closedState=nextDay?readSetting(RANDOM_STORAGE_KEY):null;
    const closedLedger=nextDay?readSetting(SHIFT_STORAGE_KEY):null;
    if(nextDay)startNextWorkShiftCases(state);
    workShiftLedger=reset?resetWorkShift(state,workShiftLedger):resumeWorkShift(state,previousLedger);
    // 새 근무 상태와 근무일을 먼저 저장합니다. 실패하면 종료 대기 상태로 복구합니다.
    if(nextDay&&!save({refreshHud:false})){
      // 양쪽 키를 복원하고 화면도 종료 대기 상태로 되돌립니다.
      try{if(closedState!==null)localStorage.setItem(RANDOM_STORAGE_KEY,closedState);
        if(closedLedger!==null)localStorage.setItem(SHIFT_STORAGE_KEY,closedLedger);}catch{}
      state=safeLoad(closedState);
      workShiftLedger=previousLedger;
      showStorageWarning('다음 근무 시작');
      return;
    }
    try{localStorage.removeItem(SHIFT_HOME_PENDING_KEY);}catch{}
    persistShiftLedger();
    try{localStorage.setItem(RANDOM_STARTED_KEY,'1');localStorage.removeItem(WELCOME_PENDING_KEY);}catch{}
  }
  if(mode==='random'&&reset){
    // 새 게임은 가상 장비의 현재 상태만 초기화합니다. 일일 과제·학습 보고서·근무 이력은 보존합니다.
    sharedInfrastructure=newSharedInfrastructure();persistSharedInfrastructure();
    linkedIncidents=newLinkedIncidents(sharedInfrastructure.revision);persistLinkedIncidents();pendingLinkedIntake=[];
    setUnifiedDifficulty(difficulty);
  }
  if(mode==='tutorial'&&reset){
    firstDayTour=newFirstDayTour();storeFirstDayTour();
    tourIdleSeconds=0;tourIdlePhase=0;
    try{localStorage.removeItem(SHIFT_HOME_PENDING_KEY);}catch{}
  }
  findFocusUntil=0;hideTourWalkMarker();clearDeviceGuide();
  pendingIntakeIndices=[];clearTimeout(intakeScheduleTimer);hideIntake();
  terminalSessions.clear();completionEffectPending=false;completionTransitionActive=false;clearTimeAttackSuccessTimer();dayCompleteShown=false;
  world.resetCompletionEffect();
  const nextSpawn=restoreWalkablePosition(state.player,world.isBlocked);
  world.player.position.set(nextSpawn.x,0,nextSpawn.z);
  save();closeModal();
  showTourWalkMarker();
  // 신규 튜토리얼 시작 시 설명만 중앙에서 보여주고, 실제 클릭 연습은 3D 사무실에서 진행합니다.
  // 시작 버튼은 첫 단계를 완료시키지 않습니다. 닫은 뒤 좌측 카드로 안내가 이어집니다.
  if(mode==='tutorial'&&!silent&&isFirstDayTourActive(firstDayTour))showFirstDayStepIntro();
  const active=activeCaseIndices(state).map(i=>SCENARIOS[i].npcName).join(' · ');
  if(!silent)toast(`${mode==='tutorial'?'🎓 튜토리얼':'🎲 연속 랜덤 업무'} ${nextDay?'새 근무 시작':reset?'시작':'불러오기'} · ${active||'완료한 사건 없음'}`);
  if((reset||nextDay)&&!silent&&!(mode==='tutorial'&&isFirstDayTourActive(firstDayTour)))scheduleIntake(activeCaseIndices(state));
  if(!silent && (mode==='random'||mode==='tutorial') && (reset||nextDay))audio.play('incident');
}
function startMainFromTutorial(){
  try{if(hasFinishedTutorial(state))localStorage.setItem(TUTORIAL_COMPLETE_KEY,'1');}catch{}
  // 튜토리얼 건너뛰기·완료 후에는 반드시 새 게임 난이도를 먼저 선택합니다.
  showDifficultyChoice();
}
function showTutorialWelcome(){
  currentPcView='tutorial-welcome';
  showModal('고쳐라! · 첫 출근','전체 맵부터 직접 익혀볼까요?',
    `<div class="tutorial-welcome"><p>첫 출근 오리엔테이션에서는 <strong>전체 맵 → 부서 클릭 이동 → 걷기 → 위치 찾기 → 직원 대화 → PC 모니터·본체 → 명령어 → 힌트</strong>를 실제로 체험합니다. 그다음 기존 장애 2건을 해결합니다.</p>
    <div class="tutorial-step"><b>① 김대리 · 랜선 연결</b><span>PC 네트워크 상태 → 본체 뒷면 → 랜선 연결 → 검사</span></div>
    <div class="tutorial-step"><b>② 박과장 · DNS 이름 해석 진단</b><span>직원 대화 → 웹 접속 실패 → 설정 조사 → ping → nslookup → DNS 복구 → 웹 재검사</span></div>
    <p class="modal-tip">튜토리얼은 별도 저장돼요. 자유롭게 건너뛰거나 ⚙ 메뉴에서 다시 시작할 수 있습니다.</p></div>`,[
      {label:'튜토리얼 건너뛰고 난이도 선택',onClick:startMainFromTutorial},
      {label:'맵부터 튜토리얼 시작',primary:true,onClick:()=>{try{localStorage.removeItem(WELCOME_PENDING_KEY);}catch{}setPlayMode('tutorial',{reset:true});}},
    ]);
}
function showTutorialComplete(){
  try{localStorage.setItem(TUTORIAL_COMPLETE_KEY,'1');localStorage.removeItem(WELCOME_PENDING_KEY);}catch{}
  currentPcView='tutorial-complete';
  showModal('고쳐라! · 튜토리얼','첫 출근 연습을 마쳤어요! 🎉',
    `<div class="success-icon">✓</div><p class="success-lead">지도 이동·PC 모니터·본체·명령어·힌트 사용과 LAN 케이블·DNS 복구, 정상화 검사까지 완료했어요.</p>
    <div class="tutorial-finish-path"><strong>다음은 본 게임이에요</strong><p>① 난이도 선택 → ② 첫 사건 접수 → ③ 직원과 대화 → ④ 조사·조치·검증</p></div>
    <p class="modal-tip">랜덤 사건이 시작되지만 기존 근무 기록은 유지되고, 튜토리얼 기록도 별도로 보존돼요.</p>`,[
      {label:'업무 수첩 보기',onClick:()=>showJournal()},
      {label:'나중에 시작하기',onClick:closeModal},
      {label:'본 게임 시작하기',primary:true,onClick:showDifficultyChoice},
    ]);
}
function confirmRestartTutorial(){
  if(!readSetting(TUTORIAL_STORAGE_KEY))return setPlayMode('tutorial',{reset:true});
  showModal('튜토리얼 다시 시작','이전 튜토리얼 기록을 초기화할까요?',
    '<p>지도·걷기·PC 점검·명령어·힌트 조작 연습 9단계와 튜토리얼 2건을 다시 시작합니다. 기존 스토리·랜덤 기록은 그대로 남아요.</p>',[
      {label:'취소',onClick:showMenu},
      {label:'튜토리얼 다시 시작',primary:true,onClick:()=>setPlayMode('tutorial',{reset:true})},
    ]);
}
let selectedDifficulty=unifiedDifficulty;
const DIFFICULTY_OPTIONS=[
  {value:'easy',icon:'🟢',name:'쉬움 · 학습',desc:'전산실·직원 PC·서버실 공통 · 단계별 안내 · 실습 영향 격리'},
  {value:'normal',icon:'🔵',name:'보통 · 실습',desc:'3개 공간 공통 · 직접 진단 · 네트워크 상태 영향'},
  {value:'hard',icon:'🟠',name:'어려움 · 실전',desc:'3개 공간 공통 · 연쇄 서비스 장애 · 가상 데이터 손실 가능'},
];
/** 기존 게임을 초기화하지 않고 현재 설정만 변경합니다. */
function showChangeDifficulty(){
  if(!isContinuousRun(state))return showDifficultyChoice();
  selectedDifficulty=state.run.difficulty;
  currentPcView='difficulty-settings';
  showModal('게임 설정 · 난이도','난이도 변경',`<div class="mode-explainer">
    <p>현재 난이도: <strong>${difficultyLabel(state)}</strong></p>
    <fieldset class="mode-difficulty-grid" aria-label="변경할 난이도 선택"><legend class="difficulty-legend">변경할 난이도를 선택하세요</legend>
      ${DIFFICULTY_OPTIONS.map(item=>`<label class="difficulty-option"><input type="radio" name="setting-difficulty" value="${item.value}" ${selectedDifficulty===item.value?'checked':''}>
        <span class="difficulty-option-body"><strong>${item.icon} ${item.name}</strong><span>${item.desc}</span></span><span class="difficulty-select-indicator" aria-hidden="true"></span></label>`).join('')}
    </fieldset>
    <p class="modal-tip">직원 PC·전산실·서버실이 하나의 난이도를 사용합니다. 현재 사건과 진행 중 실습 및 오늘의 과제 난이도는 고정되며 새 사건·새 실습부터 변경됩니다. 기존 기록을 삭제하지 않습니다.</p>
  </div>`,[
    {label:'취소',onClick:showMenu},
    {label:'난이도 변경 적용',primary:true,onClick:applyChangeDifficulty},
  ]);
}
function applyChangeDifficulty(){
  if(!isContinuousRun(state)||!DIFFICULTY_OPTIONS.some(item=>item.value===selectedDifficulty))return showMenu();
  const before=state.run.difficulty;
  if(!setRunDifficulty(state,selectedDifficulty)&&unifiedDifficulty===selectedDifficulty)return showMenu();
  setUnifiedDifficulty(selectedDifficulty);
  if(!workShiftLedger)workShiftLedger=newWorkShiftLedger(state);
  workShiftLedger=recordWorkShiftDifficulty(workShiftLedger,selectedDifficulty);
  // 보통/어려움으로 올릴 때 새 빈 슬롯이 있다면 새 기준으로 사건을 접수합니다.
  const next=activatePending(state);
  persistShiftLedger();
  save();
  showModal('설정 저장 완료','난이도를 변경했어요',
    `<p><strong>${difficultyName(before)} → ${difficultyLabel(state)}</strong></p><p>누적 기록은 그대로이며, 새 사건부터 변경된 난이도로 진행해요.${next?` ${next.npcName}의 새 업무도 접수되었습니다.`:''}</p>`,[
    {label:'업무 계속하기',primary:true,onClick:closeModal},
    {label:'게임 설정으로',onClick:showMenu},
  ]);
}
function showDifficultyChoice(){
  currentPcView='mode';
  // 이 화면은 첫 게임 또는 명시적인 새 게임 시작 전용입니다. 설정 난이도 변경은 별도 화면입니다.
  showModal('🎲 연속 랜덤 업무','새 게임 · 난이도 선택',`<div class="mode-explainer">
    <p><strong>네트워크 장애 원인과 사건 순서가 라운드마다 달라져요.</strong> 난이도에 따라 한 번에 1~2건의 사건이 진행됩니다. 쉬움은 최대 1건, 보통·어려움은 최대 2건입니다. 7종 사건을 해결하면 다음 라운드가 자동으로 시작됩니다.</p>
    <fieldset class="mode-difficulty-grid" aria-label="게임 난이도 선택"><legend class="difficulty-legend">원하는 난이도를 선택하세요</legend>
      ${DIFFICULTY_OPTIONS.map(item=>`<label class="difficulty-option"><input type="radio" name="difficulty-option" value="${item.value}" ${selectedDifficulty===item.value?'checked':''}>
        <span class="difficulty-option-body"><strong>${item.icon} ${item.name}</strong><span>${item.desc}</span></span><span class="difficulty-select-indicator" aria-hidden="true"></span></label>`).join('')}
    </fieldset>
    <p class="modal-tip">${hasSavedRandomGame()?'이미 진행 중인 게임이 있다면, 새 게임 시작 시 기존 기록을 초기화할지 다시 확인합니다.':'튜토리얼 기록은 별도로 보관되며, 본 게임을 시작해도 사라지지 않습니다.'}</p>
  </div>`,[
    {label:'뒤로',onClick:showMenu},
    {label:'시작하기',primary:true,onClick:()=>confirmNewRandom(selectedDifficulty)},
  ]);
}
element.content.addEventListener('change',event=>{
  if(event.target.matches('input[name="difficulty-option"], input[name="setting-difficulty"], input[name="time-attack-difficulty"]'))selectedDifficulty=event.target.value;
});
function confirmNewRandom(difficulty){
  if(!hasSavedRandomGame())return setPlayMode('random',{difficulty,reset:true});
  showModal('🎲 랜덤 업무 새로 시작','기존 랜덤 업무 기록을 덮어쓸까요?',
    '<p>현재 랜덤 업무의 누적 점수, 해결 기록, 진행 중인 사건과 공용 가상 인프라의 현재 장애 상태가 초기화됩니다.</p><p class="modal-tip">완료한 근무 요약과 오늘의 전산실 과제·학습 기록·실습 보고서는 유지됩니다. 이전 스토리 기록도 삭제하지 않습니다.</p>',[
      {label:'취소',onClick:showDifficultyChoice},
      {label:'랜덤 업무 시작',danger:true,onClick:()=>setPlayMode('random',{difficulty,reset:true})},
    ]);
}
function showModeMenu(){
  // 구 버전 테스트/메뉴 호출 호환용. 실제 모드는 랜덤 업무 하나만 제공합니다.
  currentPcView='mode';
  const summary=getContinuousSummary(state);
  showModal('고쳐라! · 연속 랜덤 업무','업무 이어하기',`<div class="mode-explainer">
    <p>난이도에 따라 한 번에 1~2건의 사건이 진행됩니다. 쉬움은 최대 1건, 보통·어려움은 최대 2건입니다. 7종류 사건이 매 라운드 새로운 순서로 계속 등장해요. <strong>스토리 모드 선택은 더 이상 필요하지 않습니다.</strong></p>
    <p class="modal-tip">현재 ${summary?.round||1}라운드 · 누적 해결 ${summary?.total||0}건 · 난이도: ${difficultyLabel(state)} · ${concurrentCaseLimitLabel(state)}</p>
  </div>`,[
    {label:'누적 실적',onClick:showFinalReport},
    {label:'난이도 변경 (기록 유지)',onClick:showChangeDifficulty},
    {label:'업무 계속하기',primary:true,onClick:closeModal},
  ]);
}
/** 기록 백업은 브라우저 파일로 내려받고, 복원은 반드시 검증+교체 확인 후 수행합니다. */
function showBackupSettings(){
  currentPcView='record-backup';
  showModal('게임 설정 · 기록','게임 기록 백업·복원',`<div class="record-backup-pane">
    <p>이 브라우저의 <strong>튜토리얼·랜덤 업무·누적 점수·난이도·근무일 및 지난 성적표</strong>를 JSON 파일로 보관할 수 있습니다.</p>
    <p class="modal-tip">백업에는 브라우저의 게임 진행 정보가 저장됩니다. 다른 사람에게 파일을 공유하지 마세요. 소리 설정과 아직 저장하지 않은 터미널 화면은 제외됩니다.</p>
    <label class="record-backup-picker" for="record-backup-input">📂 백업 파일 선택 (JSON)</label>
    <input id="record-backup-input" type="file" accept=".json,application/json" aria-label="고쳐라 게임 기록 JSON 파일 선택">
    <p class="record-backup-help">복원할 파일을 선택하면 먼저 검사합니다. <strong>기록 교체 확인 전에는 기존 데이터를 변경하지 않습니다.</strong></p>
  </div>`,[
    {label:'💾 기록 내보내기',primary:true,onClick:downloadRecordBackup},
    {label:'게임 메뉴로',onClick:showMenu},
  ]);
}
function downloadRecordBackup(){
  try{
    if(world)setPlayerPosition(state,world.player.position);
    const content=createRecordBackup(localStorage,{currentState:timeAttackSession?null:state,shiftLedger:workShiftLedger});
    const blob=new Blob([content],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    try{
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download=`GOCHYEORA_게임기록_${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(anchor);anchor.click();anchor.remove();
    }finally{setTimeout(()=>URL.revokeObjectURL(url),3000);}
    showModal('게임 기록','백업 파일을 준비했어요',
      '<p>브라우저의 다운로드 목록에서 JSON 파일이 저장됐는지 확인해 주세요.</p><p class="modal-tip">다운로드를 완료하기 전에는 백업이 완료된 것으로 간주하지 마세요.</p>',[
        {label:'기록 관리로',primary:true,onClick:showBackupSettings},
      ]);
  }catch(error){
    showModal('게임 기록','백업할 수 없습니다',`<p>${escapeBackupText(error.message)}</p><p class="modal-tip">브라우저 저장 권한과 여유 공간을 확인한 뒤 다시 시도하세요.</p>`,[
      {label:'다시 시도',primary:true,onClick:showBackupSettings},
    ]);
  }
}
function escapeBackupText(value){
  return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
element.content.addEventListener('change',async event=>{
  if(event.target.id!=='record-backup-input')return;
  const file=event.target.files?.[0];
  if(!file)return;
  try{
    if(file.size>BACKUP_MAX_BYTES)throw new Error('5MB 이하의 백업 파일만 복원할 수 있습니다.');
    const parsed=parseRecordBackup(await file.text());
    const records=parsed.records;
    const random=records[RANDOM_STORAGE_KEY]?JSON.parse(records[RANDOM_STORAGE_KEY]):null;
    const old=records[SHIFT_STORAGE_KEY]?JSON.parse(records[SHIFT_STORAGE_KEY]):null;
    const count=random?.run?.stats?.total??0;
    const day=old?.current?.dayNumber??'확인 필요';
    showModal('게임 기록 · 복원 확인','현재 기록을 교체할까요?',
      `<div class="record-backup-confirm"><p>선택한 파일: <strong>${escapeBackupText(file.name)}</strong></p><p>백업 시각: ${escapeBackupText(parsed.createdAt)}</p><p>누적 해결: ${count}건 · 근무일: ${day}</p><p class="message warning"><strong>현재 브라우저의 게임 기록이 백업 파일의 내용으로 교체됩니다.</strong> 되돌리려면 먼저 현재 기록을 내보내세요.</p></div>`,[
        {label:'취소',onClick:showBackupSettings},
        {label:'기록 복원 및 재시작',danger:true,onClick:()=>{
          try{restoreRecordBackup(localStorage,parsed);window.location.reload();}
          catch(error){showModal('게임 기록','복원에 실패했어요',
            `<p>${escapeBackupText(error.message)}</p><p class="modal-tip">현재 화면을 닫지 말고 브라우저 저장 상태를 확인해 주세요.</p>`,[
              {label:'기록 관리로',primary:true,onClick:showBackupSettings},
            ]);}
        }},
      ]);
  }catch(error){
    showModal('게임 기록','백업 파일을 확인할 수 없어요',
      `<p>${escapeBackupText(error.message)}</p><p class="modal-tip">게임에서 만든 JSON 백업 파일만 선택해 주세요. 기존 기록은 변경되지 않았습니다.</p>`,[
        {label:'다른 파일 선택',primary:true,onClick:showBackupSettings},
      ]);
  }
});
/** v1.0: 도전 시작/종료 시 기존 랜덤 업무 저장 키는 쓰지 않습니다. */
function persistTimeAttack(){
  if(!timeAttackSession)return true;
  try{
    localStorage.setItem(TIME_ATTACK_SESSION_KEY,JSON.stringify(timeAttackSession));
    localStorage.setItem(TIME_ATTACK_STATE_KEY,JSON.stringify(state));
    return true;
  }catch{showStorageWarning('타임어택');return false;}
}
function pauseCurrentTimeAttack(){
  if(!timeAttackSession)return;
  timeAttackSession=setTimeAttackPaused(timeAttackSession,true);
  timeAttackLastStamp=null;
  persistTimeAttack();
}
function showTimeAttackSetup(){
  if(timeAttackSession)return showTimeAttackPause();
  selectedDifficulty=isContinuousRun(state)?state.run.difficulty:'normal';
  currentPcView='time-attack-setup';
  showModal(`고쳐라! · ${GAME_VERSION}`,'타임어택 · 10분 도전',renderTimeAttackSetup(selectedDifficulty,hydrateTimeAttackBests(readSetting(TIME_ATTACK_BESTS_KEY),readSetting(TIME_ATTACK_RESULTS_KEY))),[
    {label:'뒤로',onClick:showMenu},
    {label:'최근 기록',onClick:showTimeAttackHistory},
    {label:'도전 시작',primary:true,onClick:()=>startTimeAttack(selectedDifficulty)},
  ],{wide:true});
}
function startTimeAttack(difficulty){
  if(timeAttackSession||!DIFFICULTY_OPTIONS.some(item=>item.value===difficulty))return;
  // 일반 업무를 먼저 저장해 원래 진행 중이던 사건을 온전히 보존합니다.
  if(!save({refreshHud:false})){
    toast('기존 근무 기록 저장이 실패해 도전을 시작하지 않았습니다.');return;
  }
  const candidate=newGame({mode:'random',difficulty,continuous:true,pcExpanded:true});
  const candidateSession={...newTimeAttack(difficulty),returnMode:runMode(state)};
  try{
    localStorage.setItem(TIME_ATTACK_SESSION_KEY,JSON.stringify(candidateSession));
    localStorage.setItem(TIME_ATTACK_STATE_KEY,JSON.stringify(candidate));
  }catch{
    showStorageWarning('타임어택 시작');
    toast('도전 기록 저장 실패로 시작하지 않았습니다.');return;
  }
  state=candidate;timeAttackSession=candidateSession;timeAttackLastStamp=null;
  clearDeviceGuide();pendingIntakeIndices=[];clearTimeout(intakeScheduleTimer);hideIntake();
  terminalSessions.clear();completionEffectPending=false;completionTransitionActive=false;clearTimeAttackSuccessTimer();dayCompleteShown=false;
  world.resetCompletionEffect();
  const pos=restoreWalkablePosition(state.player,world.isBlocked);
  world.player.position.set(pos.x,0,pos.z);
  closeModal();updateHud();audio.play('incident');
  toast(`⏱ 10분 타임어택 시작 · ${difficultyName(difficulty)} · 일반 근무 기록은 별도 보존됩니다.`);
  scheduleIntake(activeCaseIndices(state));
}
function showTimeAttackPause(){
  if(!timeAttackSession)return showMenu();
  pauseCurrentTimeAttack();currentPcView='time-attack-paused';
  showModal(`고쳐라! · ${GAME_VERSION}`,'타임어택 일시정지',renderTimeAttackMenu(timeAttackSession,state.run.stats.total,state.run.stats.scoreSum),[
    {label:'도전 포기',danger:true,onClick:confirmAbandonTimeAttack},
    {label:'도전 계속하기',primary:true,onClick:closeModal},
  ]);
}
function confirmAbandonTimeAttack(){
  if(!timeAttackSession)return;
  pauseCurrentTimeAttack();
  showModal('타임어택','도전을 중단할까요?',
    '<p>도전을 중단해도 일반 근무 기록은 변경되지 않습니다. 이번 도전은 중단 기록으로만 남고 최고 기록에는 포함되지 않습니다.</p>',[
      {label:'취소 · 돌아가기',onClick:showTimeAttackPause},
      {label:'도전 중단',danger:true,onClick:()=>finishTimeAttack('abandoned')},
    ]);
}
function restoreNormalFromTimeAttack(returnMode){
  timeAttackSession=null;timeAttackLastStamp=null;
  const mode=returnMode==='tutorial'?'tutorial':'random';
  const saved=readSetting(storageKeyForMode(mode));
  state=saved?safeLoad(saved):newGame({mode:'tutorial'});
  if(runMode(state)!==mode)state=newGame({mode:'tutorial'});
  if(isContinuousRun(state)){
    workShiftLedger=loadWorkShiftLedger(readSetting(SHIFT_STORAGE_KEY),state);
  }
  clearDeviceGuide();pendingIntakeIndices=[];clearTimeout(intakeScheduleTimer);hideIntake();
  terminalSessions.clear();completionEffectPending=false;completionTransitionActive=false;clearTimeAttackSuccessTimer();dayCompleteShown=false;
  world.resetCompletionEffect();
  const pos=restoreWalkablePosition(state.player,world.isBlocked);
  world.player.position.set(pos.x,0,pos.z);
  save();updateHud();
}
function finishTimeAttack(reason='time-up'){
  if(!timeAttackSession)return;
  const challenge=timeAttackSession;
  if(reason==='time-up')timeAttackSession={...challenge,remainingMs:0,paused:true};
  const result=makeTimeAttackResult(timeAttackSession,state,Date.now(),reason);
  let history=loadTimeAttackResults(readSetting(TIME_ATTACK_RESULTS_KEY));
  const priorResults=readSetting(TIME_ATTACK_RESULTS_KEY);
  const priorBests=readSetting(TIME_ATTACK_BESTS_KEY);
  const previousBests=hydrateTimeAttackBests(priorBests,priorResults);
  let bests=previousBests;
  let resultSaved=false;
  try{
    history=appendTimeAttackResult(history,result);
    bests=recordTimeAttackBest(previousBests,result);
    localStorage.setItem(TIME_ATTACK_RESULTS_KEY,JSON.stringify(history));
    localStorage.setItem(TIME_ATTACK_BESTS_KEY,JSON.stringify(bests));
    resultSaved=true;
  }catch{
    // 두 기록 중 하나라도 저장하지 못하면 모두 되돌리고 도전 상태를 보존합니다.
    try{
      if(priorResults===null)localStorage.removeItem(TIME_ATTACK_RESULTS_KEY);
      else localStorage.setItem(TIME_ATTACK_RESULTS_KEY,priorResults);
      if(priorBests===null)localStorage.removeItem(TIME_ATTACK_BESTS_KEY);
      else localStorage.setItem(TIME_ATTACK_BESTS_KEY,priorBests);
    }catch{showStorageWarning('타임어택 기록 롤백');}
    showStorageWarning('타임어택 결과');
  }
  // 정상 기록 보존을 위해, 결과 저장에 실패했다면 도전 상태도 제거하지 않습니다.
  if(!resultSaved){
    pauseCurrentTimeAttack();
    showModal('타임어택','결과 저장 실패',
      '<p>저장 공간을 확인해 주세요. 저장에 성공할 때까지 현재 도전 데이터를 보존합니다.</p>',[
        {label:'결과 저장 재시도',primary:true,onClick:()=>finishTimeAttack(reason)},
      ]);return;
  }
  try{localStorage.removeItem(TIME_ATTACK_SESSION_KEY);localStorage.removeItem(TIME_ATTACK_STATE_KEY);}catch{}
  restoreNormalFromTimeAttack(challenge.returnMode);
  audio.play('success');
  showModal(`고쳐라! · ${GAME_VERSION}`,'타임어택 결과',renderTimeAttackReport(result,history,bests,bests.records[result.difficulty]===result),[
    {label:'최근 도전 기록',onClick:showTimeAttackHistory},
    {label:'다시 도전',onClick:showTimeAttackSetup},
    {label:'일반 근무로 돌아가기',primary:true,onClick:()=>isShiftAwaitingNextDay()?showShiftLanding():closeModal()},
  ],{wide:true});
}
function showTimeAttackHistory(){
  const history=loadTimeAttackResults(readSetting(TIME_ATTACK_RESULTS_KEY));
  const bests=hydrateTimeAttackBests(readSetting(TIME_ATTACK_BESTS_KEY),readSetting(TIME_ATTACK_RESULTS_KEY));
  currentPcView='time-attack-history';
  showModal('고쳐라! · 도전 기록','최근 타임어택 결과',renderTimeAttackHistory(history,bests),[
    {label:'돌아가기',primary:true,onClick:()=>timeAttackSession?showTimeAttackPause():showTimeAttackSetup()},
  ],{wide:true});
}
function showMenu(){
  if(timeAttackSession)return showTimeAttackPause();
  currentPcView='office';
  if(isShiftAwaitingNextDay()){
    showStartMenu();return;
  }
  if(isTutorial(state)){
    showModal(`고쳐라! · ${GAME_VERSION}`,'튜토리얼 메뉴',
      `<p>현재 첫 출근 연습을 진행 중입니다. <strong>${TUTORIAL_ORDER.filter(index=>state.incidents[index].status==='resolved').length}/2건</strong> 완료했어요.</p><p class="modal-tip">튜토리얼과 본 게임 기록은 따로 저장됩니다.</p>`,[
        {label:'처음부터 연습',onClick:confirmRestartTutorial},
        ...(workShiftHistory(workShiftLedger).length?[{label:'📋 지난 근무 결과',onClick:showShiftHistory}]:[]),
        {label:hasFinishedTutorial(state)?'본 게임 시작하기':'본 게임으로 이동',primary:hasFinishedTutorial(state),onClick:startMainFromTutorial},
        {label:'💾 기록 백업·복원',onClick:showBackupSettings},
        {label:'⏱ 타임어택 도전',onClick:showTimeAttackSetup},
        {label:'🔊 소리 설정',onClick:showAudioSettings},
        {label:'조작 방법',onClick:showControls},
        {label:'게임 계속하기',primary:true,onClick:closeModal},
      ]);
    return;
  }
  const summary=getContinuousSummary(state);
  // v0.9.9.23: 화면 본문에 3개의 메뉴 그룹을 만들고 하단에는 돌아가기만 배치합니다.
  // 기존 동작 함수는 재사용하며, 새 게임 시작 시 확인창도 그대로 유지됩니다.
  const menuActions=[
    {label:'📊 누적 실적',onClick:showFinalReport,id:'stats'},
    ...(workShiftHistory(workShiftLedger).length?[{label:'📋 지난 근무 결과',onClick:showShiftHistory,id:'history'}]:[]),
    {label:'🎚 난이도 변경',onClick:showChangeDifficulty,id:'difficulty'},
    {label:'🎮 새 게임 시작 (기록 초기화)',onClick:showDifficultyChoice,id:'new-game'},
    {label:'🎓 튜토리얼 다시 하기',onClick:confirmRestartTutorial,id:'tutorial'},
    {label:'💾 기록 백업·복원',onClick:showBackupSettings,id:'backup'},
    {label:'🔊 소리 설정',onClick:showAudioSettings,id:'audio'},
    {label:'조작 방법',onClick:showControls,id:'controls'},
    {label:'⏱ 타임어택',onClick:showTimeAttackSetup,id:'time-attack'},
  ];
  showModal(`고쳐라! · ${GAME_VERSION}`,'게임 메뉴',
    renderGameMenu({
      round:summary?.round||1,
      workday:workShiftDayLabel(workShiftLedger),
      difficulty:difficultyLabel(state),
      total:summary?.total||0,
      concurrency:concurrentCaseLimitLabel(state),
      hasHistory:workShiftHistory(workShiftLedger).length>0,
    }),[
      {label:'게임 계속하기',primary:true,onClick:closeModal},
    ],{menu:true});
  // 메뉴 전용 요소에만 이벤트를 연결합니다. 다른 모달의 버튼 동작은 그대로입니다.
  const actionMap=new Map(menuActions.map(action=>[action.id,action.onClick]));
  element.content.querySelectorAll('[data-game-menu-action]').forEach(button=>{
    button.addEventListener('click',()=>{
      const handler=actionMap.get(button.dataset.gameMenuAction);
      if(!handler)return;
      audio.play('ui');handler();
    });
  });
}
function showStartMenu(){
  if(typeof timeAttackSession!=='undefined'&&timeAttackSession)return showTimeAttackPause();
  currentPcView='start-menu';
  const ended=isShiftAwaitingNextDay();
  const continueLabel=ended?'📅 다음 근무 시작':'▶ 이어서 근무하기';
  showModal(`고쳐라! · ${GAME_VERSION}`,'시작 메뉴',
    `<p>${ended?'오늘 근무를 마쳤습니다.':'이전 업무가 저장돼 있습니다.'} <strong>${ended?'저장된 난이도 그대로 다음 근무를 시작할 수 있어요.':'진행 중인 업무를 이어서 할 수 있어요.'}</strong></p>
    <p class="modal-tip">다음 근무는 새로운 사건으로 시작합니다. 이전 근무의 미해결 사건은 지난 근무 기록에 남고, 누적 점수·해결 기록·난이도는 유지됩니다.</p>`,[
      ...(hasSavedRandomGame()?[{label:continueLabel,primary:true,onClick:()=>setPlayMode('random',{reset:false})}]:[]),
      {label:'🎮 새 게임 시작 (기록 초기화)',onClick:showDifficultyChoice},
      {label:'⏱ 타임어택 도전',onClick:showTimeAttackSetup},
      ...(workShiftHistory(workShiftLedger).length?[{label:'📋 지난 근무 결과',onClick:showShiftHistory}]:[]),
      {label:'🎓 튜토리얼 다시 시작',onClick:confirmRestartTutorial},
      {label:'💾 기록 백업·복원',onClick:showBackupSettings},
      {label:'조작 방법',onClick:showControls},
      ...(!ended?[{label:'게임 화면 보기',onClick:closeModal}]:[]),
    ]);
}
/** '오늘 업무 마치기'는 누적 랜덤 진행을 끝내지 않고, 한 번의 근무 결과만 확정합니다. */
function confirmFinishWorkShift(){
  if(timeAttackSession||!isContinuousRun(state))return;
  if(!workShiftLedger)workShiftLedger=newWorkShiftLedger(state);
  const summary=workShiftSummary(state,workShiftLedger.current);
  if(workShiftIsClosed(workShiftLedger))return showShiftLanding();
  currentPcView='shift-end-confirm';
  showModal('🏁 오늘 업무 마치기','이번 근무를 종료할까요?',
    `<div class="shift-confirm"><strong>이번 근무 해결 ${summary.completed}건 · 평균 ${summary.average??'—'}${summary.average===null?'':'점'}</strong>
      <p>현재 미해결 사건 ${summary.pending.length}건의 상태와 이번 근무 성적은 <b>지난 근무 기록으로 자동 저장</b>됩니다.</p>
      <p class="modal-tip">다음 근무를 시작하면 기존 미해결 사건은 다시 나타나지 않고 새로운 사건을 배정합니다. 누적 점수·해결 실적은 유지됩니다.</p></div>`,[
      {label:'취소 · 게임 계속하기',onClick:closeModal},
      {label:'오늘 업무 마치기',primary:true,onClick:finishCurrentWorkShift},
    ]);
}
function finishCurrentWorkShift(){
  if(!isContinuousRun(state))return;
  // 실패했는데 근무를 완료했다고 표시하지 않도록 저장 성공 후에만 확정합니다.
  if(!save({refreshHud:false})){
    toast('게임 기록 저장에 실패했습니다. 근무 종료 전에 다시 저장하거나 백업해 주세요.');
    return;
  }
  const beforeLedger=workShiftLedger;
  workShiftLedger=finishWorkShift(state,workShiftLedger);
  if(!persistShiftLedger()){
    workShiftLedger=beforeLedger;
    toast('근무 성적표 저장에 실패했습니다. 종료되지 않았습니다.');
    return;
  }
  try{localStorage.setItem(SHIFT_HOME_PENDING_KEY,'1');}
  catch{
    workShiftLedger=beforeLedger;
    persistShiftLedger();showStorageWarning('근무 종료 상태');
    toast('근무 종료 상태를 저장할 수 없어 종료하지 않았습니다.');
    return;
  }
  const report=workShiftSummary(state,workShiftLedger.current);
  const history=workShiftHistory(workShiftLedger).slice(1).map(session=>workShiftSummary(null,session));
  // v0.9.9.16: 튜토리얼로 전환하지 않습니다. 랜덤 업무 상태는 저장된 채로 일시 중단합니다.
  // 게임 플레이는 화면 종료 후에도 workShiftIsClosed로 차단합니다.
  clearDeviceGuide();
  updateHud();
  audio.play('success');
  showModal('GOCHYEORA · 오늘 업무 종료','근무 결과',renderWorkShiftReport(report,{history}),[
    {label:'📅 다음 근무 시작',onClick:()=>setPlayMode('random',{reset:false})},
    {label:'시작 메뉴로',primary:true,onClick:showStartMenu},
  ],{wide:true});
}
function showShiftHistory(){
  currentPcView='shift-history';
  showModal('GOCHYEORA · 업무 기록','지난 근무 결과',renderWorkShiftHistory(workShiftLedger),[
    {label:'게임 메뉴로',primary:true,onClick:showMenu},
  ],{wide:true});
}
function showShiftLanding(){
  if(!workShiftIsClosed(workShiftLedger))return showMenu();
  currentPcView='shift-landing';
  const summary=workShiftSummary(null,workShiftLedger.current);
  showModal('GOCHYEORA · 복귀 안내','지난 근무를 마쳤어요',
    `<div class="shift-landing"><strong>지난 근무 ${summary.completed}건 해결 · 평균 ${summary.average??'—'}${summary.average===null?'':'점'}</strong>
      <p>지난 근무에서 미해결로 종료한 사건 ${summary.pending.length}건은 지난 근무 기록에 남아요. 다음 근무에서는 새로운 사건이 발생하며 누적 실적과 난이도는 유지돼요.</p></div>`,[
      {label:'📅 다음 근무 시작',primary:true,onClick:()=>setPlayMode('random',{reset:false})},
      {label:'시작 메뉴로',onClick:showStartMenu},
    ]);
}
function finishCompletedCase({fastForward=false}={}){
  completionTransitionActive=false;
  world.resetCompletionEffect();
  const next=activatePending(state);
  if(!npcHasActiveIncident(state,currentScenario(state).npcId))focusNextActive(state);
  if(next){
    save();audio.play('incident');
    toast(`${next.department} ${next.npcName}에게 새로운 장애가 발생했습니다!`);
    if(fastForward&&timeAttackSession)highlightCurrentCaseCard();
    else scheduleIntake(activeCaseIndices(state).filter(i=>state.incidents[i].status==='new'));
    return;
  }
  if(hasFinishedTutorial(state) && !dayCompleteShown){
    save();dayCompleteShown=true;audio.play('success');showTutorialComplete();return;
  }
  // 7건이 완료돼도 게임이 끝나지 않습니다. 자동으로 다음 라운드를 시작합니다.
  if(isContinuousRun(state)&&advanceContinuousRound(state)){
    terminalSessions.clear();dayCompleteShown=false;
    save();audio.play('incident');
    toast(`🎲 ${state.run.round}라운드 시작! 새로운 사건이 접수됐습니다. · 누적 ${state.run.stats.total}건`);
    if(fastForward&&timeAttackSession)highlightCurrentCaseCard();
    else scheduleIntake(activeCaseIndices(state));
    return;
  }
  if(hasFinishedDay(state) && !dayCompleteShown){
    dayCompleteShown=true;save();audio.play('success');showFinalReport();
  }else if(activeCaseIndices(state).length){
    save();toast('다른 직원의 미해결 사건을 계속 조사할 수 있어요.');
  }else save();
}

const clock=new THREE.Clock();
const direction=new THREE.Vector3();
let positionSaveElapsed=0;
let dayCompleteShown=false;
window.addEventListener('pagehide',()=>{pauseCurrentTimeAttack();persistEmployeePressure();save({refreshHud:false});});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){pauseCurrentTimeAttack();save({refreshHud:false});}
  else if(timeAttackSession?.paused&&!modalOpen&&!dialogueOpen)showTimeAttackPause();
  audio.handleVisibilityChange();
});
function frame(){
  const stamp=performance.now();
  if(timeAttackSession){
    if(shouldAdvanceTimeAttack({session:timeAttackSession,hidden:document.hidden,intakeVisible,intakePending:pendingIntakeIndices.length>0,completionTransitionActive})){
      if(timeAttackLastStamp!==null){
        timeAttackSession=advanceTimeAttack(timeAttackSession,stamp-timeAttackLastStamp);
        const label=$('#day-label');
        if(label)label.textContent=`⏱ ${formatTimeAttack(timeAttackSession.remainingMs)} · 난이도: ${difficultyLabel(state)}`;
        if(timeAttackSession.remainingMs===0)finishTimeAttack('time-up');
      }
      timeAttackLastStamp=stamp;
    }else timeAttackLastStamp=null;
  }
  const activeDelta=clock.getDelta();
  const delta=Math.min(activeDelta,.055);
  // 물리 이동은 짧게 보정하되, 직원 대기는 실제 활성 경과 시간으로 계산합니다.
  tickEmployeePressure(Math.min(activeDelta,1));
  const elapsed=clock.elapsedTime;
  // 실습 모달은 자체 2D 장비로 동작하므로 가려진 3D 사무실의 물리/렌더 업데이트를 중단합니다.
  // raf와 시계는 유지하여 모달 종료 시 정상 복귀합니다.
  if(modalOpen&&['it-lab','it-lab-hub','server-lab','server-lab-hub'].includes(currentPcView)){
    window.requestAnimationFrame(frame);return;
  }
  if(!overlayOpen() && !isShiftAwaitingNextDay()&&firstDayAllows('move')){
    direction.set(0,0,0);
    if(keys.has('w')||keys.has('arrowup'))direction.z-=1;
    if(keys.has('s')||keys.has('arrowdown'))direction.z+=1;
    if(keys.has('a')||keys.has('arrowleft'))direction.x-=1;
    if(keys.has('d')||keys.has('arrowright'))direction.x+=1;
    if(direction.lengthSq()>0){
      direction.normalize();
      const rotated=rotatePlanar(direction.x,direction.z,cameraQuarterTurn);
      direction.set(rotated.x,0,rotated.z).multiplyScalar(delta*4.15);
      const beforeX=world.player.position.x,beforeZ=world.player.position.z;
      const nextX=world.player.position.x+direction.x;
      const nextZ=world.player.position.z+direction.z;
      const guidedWalk=currentFirstDayStep(firstDayTour)?.id==='walk'&&isTutorial(state);
      const guidedStart=firstDayTour.walkStart,guidedTarget=firstDayTour.walkTarget;
      if(!world.isBlocked(nextX,world.player.position.z)&&(!guidedWalk||isGuidedWalkMove(guidedStart,guidedTarget,
        {x:beforeX,z:beforeZ},{x:nextX,z:world.player.position.z},{path:tourWalkingRoute,corridorWidth:2.3})))world.player.position.x=nextX;
      if(!world.isBlocked(world.player.position.x,nextZ)&&(!guidedWalk||isGuidedWalkMove(guidedStart,guidedTarget,
        {x:world.player.position.x,z:beforeZ},{x:world.player.position.x,z:nextZ},{path:tourWalkingRoute,corridorWidth:2.3})))world.player.position.z=nextZ;
      if(isTutorial(state)&&currentFirstDayStep(firstDayTour)?.id==='walk'){
        const moved=Math.hypot(world.player.position.x-beforeX,world.player.position.z-beforeZ);
        if(moved>0)firstDayTour.walkDistance=Math.min(500,(firstDayTour.walkDistance||0)+moved);
      }
      world.player.rotation.y= Math.atan2(direction.x,direction.z);
      world.player.userData.body.position.y=.78+Math.sin(elapsed*12)*.034;
    }else world.player.userData.body.position.y=.78;
  }
  world.updateServerAccess(world.player.position.x,world.player.position.z);
  if(getDnsTutorialStep(state)===2&&!overlayOpen()){
    const npc=world.interactables.find(item=>item.id==='npc:park');
    if(npc&&world.player.position.distanceTo(npc.position)<=npc.radius+.6){
      if(dnsAction('employee-near',{near:true})){clearDeviceGuide();toast('박과장에게 도착했어요. R키로 대화해 보세요.');}
    }
  }
  if(findFocusUntil && stamp>=findFocusUntil){
    findFocusUntil=0;
    if(currentFirstDayStep(firstDayTour)?.id==='find'){
      const advanced=tourAction('find');
      if(advanced){showTourWalkMarker();toast('이제 W/A/S/D로 파란 원을 향해 직접 걸어가세요.');}
    }
  }
  if(!overlayOpen())checkFirstDayWalking();
  // 초보자가 조작 중일 때는 지연 안내를 띄우지 않습니다.
  const tourMoving=['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].some(key=>keys.has(key));
  if(tourMoving&&currentFirstDayStep(firstDayTour)?.id==='walk')tourIdleSeconds=0;
  updateFirstDayIdleCue(activeDelta);
  positionSaveElapsed+=delta;
  // 이동한 경우에만 위치를 저장합니다. 업무 카드 DOM을 매번 다시 만들지 않습니다.
  if(positionSaveElapsed>=2){
    positionSaveElapsed=0;
    const p=world.player.position;
    if(Math.hypot(p.x-state.player.x,p.z-state.player.z)>.05)save({refreshHud:false});
  }
  // 대상 PC 위치 안내 버튼을 누르면 잠시 해당 책상을 보여줍니다.
  // 이동 키를 누르면 카메라가 즉시 플레이어 추적으로 돌아옵니다.
  const now=performance.now();
  const manualMove=keys.has('w')||keys.has('a')||keys.has('s')||keys.has('d')||
    keys.has('arrowup')||keys.has('arrowdown')||keys.has('arrowleft')||keys.has('arrowright');
  if(manualMove&&highlightedDevice&&!findFocusUntil)highlightedDevice.focusUntil=0;
  const firstDayMapAnchor=isTutorial(state)&&currentFirstDayStep(firstDayTour)?.id==='map'?
    world.worldAnchors.departments.business:null;
  if(firstDayMapAnchor&&!overlayOpen())cameraTarget.copy(firstDayMapAnchor);
  else if(highlightedDevice&&!overlayOpen()&&now<highlightedDevice.focusUntil)
    cameraTarget.copy(highlightedDevice.position).add(new THREE.Vector3(-.9,0,-1.5));
  else cameraTarget.copy(world.player.position).add(new THREE.Vector3(-.9,0,-1.5));
  focus.lerp(cameraTarget,1-Math.exp(-4.2*delta));
  currentCameraOffset.lerp(cameraOffset,1-Math.exp(-7.0*delta));
  camera.position.copy(focus).add(currentCameraOffset);
  camera.lookAt(tmp2.copy(focus).add(new THREE.Vector3(0,.8,0)));
  updateNearby();
  const equipmentNearbyId=overlayOpen()||isShiftAwaitingNextDay()?null:closest?.id;
  const visuals = world.updateVisuals(state,elapsed,delta,overlayOpen()?null:(highlightedDevice?.id||closest?.id),equipmentNearbyId);
  if(highlightedDevice&&!overlayOpen())updateDeviceGuide(now);
  updateServerRoomLabel();
  updateFirstDayPcWorldCue();
  const kimPosition=world.interactables.find(item=>item.id==='npc:kim')?.position;
  const pointingToKim=isTutorial(state)&&currentFirstDayStep(firstDayTour)?.id==='talk'&&!overlayOpen();
  tourNpcMarker.visible=Boolean(pointingToKim&&kimPosition);
  if(tourNpcMarker.visible){tourNpcMarker.position.set(kimPosition.x,.07,kimPosition.z);tourNpcMarker.scale.setScalar(1+.07*Math.sin(elapsed*3.5));}
  updateDepartmentLabels(stamp);
  updateItRoomLabel(stamp);
  // 완료 체크 페이드아웃 한 번만 처리하고, 남은 활성 사건을 유지합니다.
  if(visuals.completionFinished)finishCompletedCase();
  // 3D 실습 모달에 자체 뷰어가 표시되는 동안 배경 사무실의 WebGL 렌더는 생략한다.
  // 타이머·상태 갱신과 다음 프레임 예약은 그대로 유지한다.
  if(!modalOpen||!equipmentViewerVisible)renderer.render(scene,camera);
  window.requestAnimationFrame(frame);
}
window.__GOCHYEORA_READY__=true;
$('#loading-screen').classList.add('ready');
setTimeout(()=>$('#loading-screen')?.remove(),450);
clock.start();frame();
if(timeAttackSession)setTimeout(showTimeAttackPause,650);
else if(isShiftAwaitingNextDay())setTimeout(showShiftLanding,650);
else if(firstVisit)setTimeout(()=>showTutorialWelcome(),650);
else if(isTutorial(state)&&needsFirstDayStepIntro(firstDayTour))setTimeout(showFirstDayStepIntro,700);
else if(activeCaseIndices(state).length)setTimeout(()=>toast(isTutorial(state)?'🎓 왼쪽 목표 카드의 현재 조작 단계를 따라가 보세요.':'직원 머리 위의 느낌표(!)를 찾아 원하는 사건부터 조사해 보세요.'),700);
