import {isValidSavedPosition} from './office-layout.js';
import {observedDiagnosticNextStep, observedNpcFollowup} from './diagnostic-guidance.js';
import {getDiagnosticCoach} from './diagnostic-coach.js';
import {makeDiagnosticAssessment,readDiagnosticAssessment,diagnosticStepLabel} from './diagnostic-assessment.js';
import {findLoginAuditEntry} from './login-audit.js';
import {incidentNarrative,pickIncidentVariant,INCIDENT_VARIANT_COUNT} from './incident-narratives.js';
/**
 * 고쳐라! v0.7 - 네트워크 상태를 단일 데이터 모델에서 관리합니다.
 * GUI와 추후 직접 입력할 가상 터미널은 이 로직을 공통으로 사용합니다.
 * 실제 운영체제나 네트워크 설정을 변경하지 않습니다.
 */
export const SCENARIOS = Object.freeze([
  { id:'INC-001', cause:'cable-unplugged', label:'랜선 분리', tip:'네트워크 문제는 PC에서 증상을 먼저 확인하고 물리적 연결을 점검하세요.', title:'인터넷이 갑자기 끊겼어요!', priority:'일반', npcId:'kim', npcName:'김대리', department:'영업팀', pcId:'pc-kim', port:1 },
  { id:'INC-002', cause:'dhcp-down', label:'DHCP 서비스 중단', tip:'유선 연결과 IP 주소 할당은 서로 다른 점검 단계입니다.', title:'IP 주소를 못 받아요!', priority:'주의', npcId:'lee', npcName:'이사원', department:'총무팀', pcId:'pc-lee', port:2 },
  { id:'INC-003', cause:'dns-wrong', label:'잘못된 DNS 설정', tip:'외부 IP 연결과 도메인 이름 해석을 따로 점검하세요.', title:'회사 사이트만 안 열려요!', priority:'일반', npcId:'park', npcName:'박과장', department:'관리팀', pcId:'pc-park', port:4 },
  { id:'INC-004', cause:'switch-port-disabled', label:'스위치 3번 포트 비활성화', tip:'케이블이 연결되어 있어도 스위치 포트 관리 상태가 내려가면 네트워크 링크가 끊길 수 있습니다.', title:'네트워크가 아예 연결되지 않아요!', priority:'주의', npcId:'choi', npcName:'최주임', department:'개발팀', pcId:'pc-choi', port:3 },
  { id:'INC-005', cause:'web-service-stopped', label:'사내 웹 서비스 중지', tip:'ping이 성공해도 HTTP 웹 서비스가 중단되면 홈페이지는 열리지 않습니다.', title:'사내 업무 사이트만 안 열려요!', priority:'주의', npcId:'jung', npcName:'정사원', department:'기획팀', pcId:'pc-jung', port:5 },
  { id:'INC-006', cause:'phishing-email', label:'사내 계정 탈취를 노린 피싱 메일', tip:'발신자·실제 링크를 확인하고 클릭하지 않은 채 신고·격리하는 것이 중요합니다.', title:'계정 확인 메일이 수상해요!', priority:'주의', npcId:'han', npcName:'한사원', department:'인사팀', pcId:'pc-han', port:6 },
  { id:'INC-007', cause:'anomalous-login', label:'낯선 IP의 의심 로그인 세션', tip:'평소와 다른 접속 기록은 근거를 확인하고 의심 세션을 해제한 후 계정을 보호하세요.', title:'새벽에 제 계정으로 접속했대요!', priority:'긴급', npcId:'song', npcName:'송대리', department:'재무팀', pcId:'pc-song', port:7 },
]);
export const NPCS = Object.freeze(SCENARIOS.map(({npcId,npcName,department,pcId})=>({npcId,npcName,department,pcId})));
export const TOTAL_CASES = SCENARIOS.length;
export const EVIDENCE = Object.freeze({
  symptom: { id:'symptom',label:'직원 신고 증상 확인' },
  onlyOne: { id:'onlyOne',label:'다른 직원도 같은 증상인지 질문함 (직접 장비 확인과는 별개)' },
  time: { id:'time',label:'문제 발생 시점과 증상을 직원에게 확인함' },
  pcPower: { id:'pcPower',label:'PC 전원 및 운영체제 정상' },
  lanDown: { id:'lanDown',label:'유선 네트워크 링크 연결 끊김' },
  linkUp: { id:'linkUp',label:'이더넷 물리 링크 연결 정상' },
  cableLoose: { id:'cableLoose',label:'PC 뒤 LAN 케이블 분리 상태 확인' },
  cableFixed: { id:'cableFixed',label:'LAN 케이블 다시 연결함' },
  adapterChecked: { id:'adapterChecked',label:'가상 PC 네트워크 어댑터 설정 확인' },
  pcPortChecked: { id:'pcPortChecked',label:'PC 본체 후면 LAN 포트 점검' },
  browserFailed: { id:'browserFailed',label:'사내 포털 웹 접속 실패 확인' },
  dhcpFail: { id:'dhcpFail',label:'DHCP 주소 할당 실패: APIPA(169.254.x.x) 확인' },
  dhcpStopped: { id:'dhcpStopped',label:'서버실 DHCP 서비스 중지 확인' },
  dhcpStarted: { id:'dhcpStarted',label:'DHCP 서비스 재시작' },
  leaseRenewed: { id:'leaseRenewed',label:'DHCP 임대 갱신으로 정상 IPv4 할당' },
  dnsBad: { id:'dnsBad',label:'PC DNS 주소가 사내 정상 설정과 다름' },
  dnsRestored: { id:'dnsRestored',label:'PC DNS 주소 정상 설정으로 복구' },
  gatewayBad: {id:'gatewayBad',label:'기본 게이트웨이 설정 이상 확인'},
  gatewayRestored: {id:'gatewayRestored',label:'기본 게이트웨이 주소 복구'},
  firewallBlocked: {id:'firewallBlocked',label:'사내 포털 차단 방화벽 규칙 확인'},
  firewallRestored: {id:'firewallRestored',label:'사내 포털 차단 방화벽 규칙 해제'},
  ipConflict: {id:'ipConflict',label:'직원 PC의 가상 IPv4 주소 충돌 확인'},
  ipRestored: {id:'ipRestored',label:'직원 PC의 IP 설정 정상화'},
  serverChecked: { id:'serverChecked',label:'서버실 장비 및 서비스 상태 확인' },
  tested: { id:'tested',label:'네트워크 및 웹 접속 정상화 검사 성공' },
  switchChecked: { id:'switchChecked',label:'서버실 스위치 포트별 상태 점검' },
  switchPortDown: { id:'switchPortDown',label:'담당 PC의 스위치 포트 관리 상태 비활성 확인' },
  switchPortFixed: { id:'switchPortFixed',label:'담당 PC의 스위치 포트 활성화' },
  webServiceChecked: { id:'webServiceChecked',label:'사내 웹 서비스 관리자에서 사이트 상태 조사' },
  webServiceStopped: { id:'webServiceStopped',label:'사내 웹 서비스 중지 확인' },
  webServiceStarted: { id:'webServiceStarted',label:'사내 웹 서비스 시작' },
  mailOpened: { id:'mailOpened',label:'수상한 메일의 발신자 및 본문을 확인함' },
  mailIndicators: { id:'mailIndicators',label:'발신자 도메인·링크 불일치 및 긴급한 로그인 유도 확인' },
  attachmentIndicators: { id:'attachmentIndicators',label:'발신자 주소 및 첨부파일 확장자·실행 유도 확인' },
  mailReported: { id:'mailReported',label:'의심 메일을 보안 담당자에게 신고함' },
  mailQuarantined: { id:'mailQuarantined',label:'피싱 의심 메일을 격리함' },
  loginLogChecked: { id:'loginLogChecked',label:'사용자 로그인 기록 조사' },
  suspiciousLogin: { id:'suspiciousLogin',label:'새벽 03:12, 외부 IP 203.0.113.42에서 접속 확인' },
  sessionRevoked: { id:'sessionRevoked',label:'의심 세션 강제 로그아웃' },
  accountSecured: { id:'accountSecured',label:'계정 비밀번호 초기화 및 재인증 요청' },
  securityVerified: { id:'securityVerified',label:'보안 사고 대응 결과 검증 성공' },
});
const GOOD_DNS = '192.168.10.10';
const BAD_DNS = '192.168.10.99';
const GOOD_IP = '192.168.10.27';

const START_POSITION = Object.freeze({x:.2,y:0,z:5.0});
// 본 게임의 네트워크 장애는 직원 4명에게 1회씩 배분합니다.
// 공유 서비스 장애를 동시에 2건 만들지 않도록 DHCP/스위치는 한 라운드에 한 건씩만 발생합니다.
export const NETWORK_CAUSES=Object.freeze(['cable-unplugged','dhcp-down','dns-wrong','switch-port-disabled']);
// 연속 근무는 7건을 유지하며, DHCP 계열 한 건과 피싱 계열 한 건의 원인을 교대 배정합니다.
export const NETWORK_CAUSE_POOL=Object.freeze([...NETWORK_CAUSES,'dhcp-lease-expired']);
// v1.6.0: 새 연속 근무에서만 직원 PC 심화 장애를 출제합니다. 구버전 저장의 기존 원인은 유지합니다.
export const EMPLOYEE_PC_EXPANDED_CAUSES=Object.freeze(['gateway-wrong','firewall-rule']);
const EXPANDED_NETWORK_CAUSE_POOL=Object.freeze([...NETWORK_CAUSE_POOL,...EMPLOYEE_PC_EXPANDED_CAUSES]);
export const MAIL_CAUSES=Object.freeze(['phishing-email','phishing-attachment']);
const NETWORK_TITLES=Object.freeze([
  '인터넷 연결에 문제가 생겼어요!',
  '업무 사이트에 접속이 안 돼요!',
  '네트워크 연결을 확인해 주세요!',
  '갑자기 네트워크가 끊겼어요!',
]);
export function caseCause(state,index=state.scenarioIndex){
  return state.incidents[index]?.rootCause ?? SCENARIOS[index]?.cause;
}
export function casePresentation(state,index=state.scenarioIndex){
  const scenario=SCENARIOS[index];
  if(!scenario)return null;
  const cause=caseCause(state,index);
  const generic=isContinuousRun(state)&&index<NETWORK_CAUSES.length;
  const narrative=isContinuousRun(state)?incidentNarrative(index,cause,state.incidents[index]?.presentationVariant):null;
  return {...scenario,cause,title:narrative?.title||(generic?NETWORK_TITLES[index]:scenario.title),
    // 접수 카드나 직원 대화에서 원인을 암시하지 않습니다.
    label:generic?'네트워크 접속 장애':cause==='phishing-attachment'?'메일 안전성 확인 요청':scenario.label,
    tip:generic?(SCENARIOS.find(s=>s.cause===cause)?.tip||scenario.tip):cause==='phishing-attachment'?'첨부파일을 실행하지 말고 발신자와 첨부파일 정보를 분석한 뒤 신고·격리하세요.':scenario.tip};
}
export function activeCauseOwner(state,cause){
  const index=SCENARIOS.findIndex((scenario,i)=>state.activeIds.includes(scenario.id) &&
    state.incidents[i]?.status!=='resolved'&&caseCause(state,i)===cause);
  return index<0?null:{index,scenario:SCENARIOS[index],incident:state.incidents[index]};
}
function incidentFor(index,cause=SCENARIOS[index].cause) {
  const scenario=SCENARIOS[index];
  return {
    id:scenario.id, npcId:scenario.npcId, pcId:scenario.pcId,
    rootCause:cause,status:'new',
    cableConnected:cause!=='cable-unplugged',dhcpRunning:cause!=='dhcp-down',leaseRenewed:!['dhcp-down','dhcp-lease-expired'].includes(cause),
    dnsServer:cause==='dns-wrong'?BAD_DNS:GOOD_DNS,
    pcConfig:{addressMode:'dhcp',staticIp:null,gateway:cause==='gateway-wrong'?'192.168.10.254':'192.168.10.1',
      portalBlockRule:cause==='firewall-rule'},
    pcWorkHistory:[],
    security:{mailReviewed:false,indicatorsReviewed:false,reported:false,quarantined:false,logReviewed:false,suspiciousSelected:false,sessionRevoked:false,accountSecured:false,normalSessionInterrupted:false,normalSessionRecovered:false,normalSessionMistakes:0},
    verified:false,evidence:[],actions:[],
  };
}
function bindCurrent(state) {
  state.incident = state.incidents[state.scenarioIndex];
  return state;
}
// v0.9: 사건 내용(원인/PC/복구 장비)은 한 묶음으로 유지하고 발생 순서만 섞습니다.
// 난수 생성기를 주입할 수 있어 동일 시드의 재현 테스트가 가능합니다.
const STORY_ORDER = Object.freeze(SCENARIOS.map((_,i)=>i));
export const TUTORIAL_ORDER = Object.freeze([0,2]); // LAN 연결 → DNS 설정
export const DIFFICULTIES = Object.freeze({
  easy: {label:'쉬움',hintPenalty:0,failedPenalty:0},
  normal: {label:'보통',hintPenalty:5,failedPenalty:0},
  hard: {label:'어려움',hintPenalty:10,failedPenalty:8},
});
function shuffledValues(values,random=Math.random){
  const list=[...values];
  for(let i=list.length-1;i>0;i--){
    const n=Number(random());
    const j=Math.min(i,Math.max(0,Math.floor((Number.isFinite(n)?n:.5)*(i+1))));
    [list[i],list[j]]=[list[j],list[i]];
  }
  return list;
}
function shuffledOrder(random=Math.random){return shuffledValues(STORY_ORDER,random);}
function networkAssignments(mode,continuous,random,expanded=false){
  if(mode!=='random'||!continuous)return NETWORK_CAUSES;
  // 동일 라운드에서 DHCP 서버 장애와 PC 임대 만료를 중복 발생시키지 않습니다.
  const causes=NETWORK_CAUSES.map(cause=>cause==='dhcp-down'&&random()<0.45?'dhcp-lease-expired':cause);
  // 첫 4건의 개수와 DHCP 단일 배정 규칙은 유지하고 PC 설정 원인만 교대합니다.
  if(expanded){const type=Math.min(2,Math.floor(Math.max(0,Number(random())||0)*3));
    causes[2]=['dns-wrong','gateway-wrong','firewall-rule'][type];}
  return shuffledValues(causes,random);
}
function validOrder(order,mode='story') {
  if(mode==='tutorial')return Array.isArray(order) && order.length===TUTORIAL_ORDER.length &&
    order.every((index,step)=>index===TUTORIAL_ORDER[step]);
  return Array.isArray(order)&&order.length===SCENARIOS.length&&
    order.every(x=>Number.isInteger(x)&&x>=0&&x<SCENARIOS.length)&&new Set(order).size===SCENARIOS.length;
}
const CONTINUOUS_CATEGORIES=Object.freeze(['network','network','network','network','server','security','security']);
function newContinuousStats(){
  return {total:0,scoreSum:0,byCategory:{network:{count:0,sum:0},server:{count:0,sum:0},security:{count:0,sum:0}},recent:[]};
}
function addContinuousResult(state,index,score){
  const stats=state.run.stats;
  const category=CONTINUOUS_CATEGORIES[index];
  const already=stats.recent.some(item=>item.round===state.run.round&&item.index===index);
  // 라운드가 끝날 때마다 새로운 직원 사건 인스턴스가 시작됩니다.
  if(already)return;
  stats.total++;stats.scoreSum+=score;
  stats.byCategory[category].count++;stats.byCategory[category].sum+=score;
  const assessment=readDiagnosticAssessment(state.incidents[index],caseCause(state,index));
  const points=getCaseScore(state,index);
  stats.recent.push({round:state.run.round,index,score,cause:caseCause(state,index),difficulty:difficultyForCase(state,index),
    ...(points?{scoreDetails:{investigation:points.investigation,diagnosis:points.diagnosis,action:points.action,
      validation:points.validation,hints:points.hints,failures:points.failures,normalSessionsRevoked:points.normalSessionsRevoked||0,deduction:points.deduction}}:{}),
    title:casePresentation(state,index)?.title||SCENARIOS[index].title,
    ...(assessment?{sequence:stats.total,reviewIds:assessment.reviewIds.slice(0,10)}:{})});
  if(stats.recent.length>35)stats.recent.splice(0,stats.recent.length-35);
}
function restoreContinuousStats(input){
  if(!input||typeof input!=='object')return newContinuousStats();
  const validInteger=(v,max=1000000000)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
  const byCategory={};
  for(const key of ['network','server','security']){
    const item=input.byCategory?.[key];
    if(!validInteger(item?.count)||!validInteger(item?.sum))return newContinuousStats();
    byCategory[key]={count:item.count,sum:item.sum};
  }
  if(!validInteger(input.total)||!validInteger(input.scoreSum)||
    Object.values(byCategory).reduce((n,c)=>n+c.count,0)!==input.total ||
    Object.values(byCategory).reduce((n,c)=>n+c.sum,0)!==input.scoreSum ||
    input.scoreSum>input.total*100)return newContinuousStats();
  const recent=Array.isArray(input.recent)?input.recent.slice(-35).filter(r=>
    Number.isInteger(r?.index)&&r.index>=0&&r.index<SCENARIOS.length&&
    validInteger(r?.round,1000000)&&r.round>=1&&validInteger(r?.score,100))
    .map(r=>({round:r.round,index:r.index,score:r.score,
      ...(DIFFICULTIES[r.difficulty]?{difficulty:r.difficulty}:{}),
      ...(typeof r.title==='string'&&r.title.length>0&&r.title.length<=140?{title:r.title}:{}),
      ...(r.scoreDetails&&['investigation','diagnosis','action','validation','hints','failures','deduction'].every(k=>
        validInteger(r.scoreDetails[k],k==='hints'?2:k==='failures'?10000:100))&&
        r.scoreDetails.investigation<=30&&r.scoreDetails.diagnosis<=25&&r.scoreDetails.action<=25&&
        r.scoreDetails.validation<=20&&r.scoreDetails.deduction<=30&&
        r.scoreDetails.investigation+r.scoreDetails.diagnosis+r.scoreDetails.action+r.scoreDetails.validation-r.scoreDetails.deduction===r.score
        ?{scoreDetails:{...Object.fromEntries(['investigation','diagnosis','action','validation','hints','failures','deduction']
          .map(k=>[k,r.scoreDetails[k]])),...(validInteger(r.scoreDetails.normalSessionsRevoked,10)?{normalSessionsRevoked:r.scoreDetails.normalSessionsRevoked}:{})}}:{}),
      ...(typeof r.cause==='string'&&[...EXPANDED_NETWORK_CAUSE_POOL,'web-service-stopped',...MAIL_CAUSES,'anomalous-login'].includes(r.cause)?{cause:r.cause}:{}),
      ...(validInteger(r.sequence)&&r.sequence>=1&&r.sequence<=input.total&&
        Array.isArray(r.reviewIds)&&r.reviewIds.length<=10&&r.reviewIds.every(id=>typeof id==='string'&&diagnosticStepLabel(id))
        ?{sequence:r.sequence,reviewIds:[...new Set(r.reviewIds)]}:{})})):[];
  return {total:input.total,scoreSum:input.scoreSum,byCategory,recent};
}
function initialRun(mode='story',difficulty='normal',random=Math.random,continuous=false,pcExpanded=false){
  return {mode:mode==='tutorial'?'tutorial':mode==='random'?'random':'story',
    ...(mode==='tutorial'?{dnsTutorialStep:1}:{}),
    difficulty:mode==='tutorial'?'easy':DIFFICULTIES[difficulty]?difficulty:'normal',
    order:mode==='tutorial'?[...TUTORIAL_ORDER]:mode==='random'?shuffledOrder(random):[...STORY_ORDER],
    hints:{},failures:{},diagnostics:{},evaluations:{},scoringVersion:2,
    ...(mode==='random'&&continuous?{continuous:true,round:1,stats:newContinuousStats(),pcExpanded:pcExpanded===true}:{})};
}
export function newGame({mode='story',difficulty='normal',random=Math.random,continuous=false,pcExpanded=false}={}) {
  const run=initialRun(mode,difficulty,random,continuous,pcExpanded);
  const assignments=networkAssignments(mode,continuous,random,run.pcExpanded===true);
  const mailCause=mode==='random'&&continuous&&random()<0.45?'phishing-attachment':'phishing-email';
  const incidents=SCENARIOS.map((scenario,index)=>{
    const incident=incidentFor(index,index<4?assignments[index]:index===5?mailCause:scenario.cause);
    // 연속 근무의 신규 사건만 변형 번호를 부여합니다. 튜토리얼과 예전 게임은 보존합니다.
    if(mode==='random'&&continuous)incident.presentationVariant=pickIncidentVariant(random);
    return incident;
  });
  const activeIds=run.order.slice(0,run.mode==='tutorial'||run.mode==='random'&&run.difficulty==='easy'?1:2).map(index=>SCENARIOS[index].id);
  // 난이도는 게임 설정이지만 감점은 사건이 접수된 시점의 난이도로 고정합니다.
  run.caseDifficulties=Object.fromEntries(activeIds.map(id=>[id,run.difficulty]));
  const infrastructure={switchPorts:{1:true,2:true,3:true,4:true,5:true,6:true,7:true,8:true},webServiceRunning:true};
  for(const [index,incident] of incidents.entries()){
    if(!activeIds.includes(incident.id))continue;
    if(incident.rootCause==='switch-port-disabled')infrastructure.switchPorts[SCENARIOS[index].port]=false;
    if(incident.rootCause==='web-service-stopped')infrastructure.webServiceRunning=false;
  }
  return bindCurrent({
    schemaVersion:6,scenarioIndex:run.order[0],completedIds:[],activeIds,
    infrastructure,incidents,
    player:{...START_POSITION},run,
  });
}
export const runMode = state => state.run?.mode==='tutorial'?'tutorial':state.run?.mode==='random'?'random':'story';
export const isTutorial = state => runMode(state)==='tutorial';
export const isContinuousRun = state => runMode(state)==='random'&&state.run?.continuous===true;
export function getContinuousSummary(state){
  if(!isContinuousRun(state))return null;
  const stats=state.run.stats;
  const categories=Object.entries(stats.byCategory).map(([id,{count,sum}])=>({
    id,label:{network:'네트워크 운영',server:'서버 운영',security:'정보보안 대응'}[id],
    count,average:count?Math.round(sum/count):null,
  }));
  return {round:state.run.round,difficulty:difficultyLabel(state),total:stats.total,
    average:stats.total?Math.round(stats.scoreSum/stats.total):null,
    currentCompleted:state.completedIds.length,categories,recent:[...stats.recent].reverse().map(item=>({
      ...item,difficultyLabel:difficultyName(item.difficulty),employee:SCENARIOS[item.index].npcName,
      title:item.title||(item.index<4?NETWORK_TITLES[item.index]:SCENARIOS[item.index].title),
    }))};
}
// 이전 랜덤 업무 데이터를 이어서 플레이할 수 있도록 누적 통계 형식으로 전환합니다.
// 기존 스토리 저장은 별도 키에 그대로 남겨둡니다.
export function enableContinuousRun(state){
  if(runMode(state)!=='random')return false;
  if(isContinuousRun(state))return false;
  state.run.continuous=true;state.run.round=1;state.run.stats=newContinuousStats();
  for(const index of orderedCaseIndices(state)){
    if(state.incidents[index]?.status!=='resolved')continue;
    const score=getCaseScore(state,index);
    if(score)addContinuousResult(state,index,score.total);
  }
  return true;
}
// 마지막 사건까지 해결했을 때만 새로운 랜덤 업무 묶음을 시작합니다.
// 같은 직원에게 동시에 두 가지 장애가 생기지 않도록 매 라운드는 중복 없는 7건입니다.
export function advanceContinuousRound(state,random=Math.random){
  if(!isContinuousRun(state)||activeCaseIndices(state).length||
    !SCENARIOS.every((_,i)=>state.incidents[i].status==='resolved'&&state.incidents[i].verified))return false;
  const last=state.run.stats.recent.at(-1)?.index;
  const completedRounds=state.run.round;
  const stats=state.run.stats;
  const next=newGame({mode:'random',difficulty:state.run.difficulty,random,continuous:true,pcExpanded:state.run.pcExpanded===true});
  // 같은 직원은 연속된 라운드에서 동일 신고 변형을 반복하지 않습니다.
  for(let index=0;index<SCENARIOS.length;index++){
    const previous=state.incidents[index]?.presentationVariant;
    if(Number.isInteger(previous)&&previous>=0&&previous<INCIDENT_VARIANT_COUNT&&
      next.incidents[index].presentationVariant===previous){
      next.incidents[index].presentationVariant=(previous+1)%INCIDENT_VARIANT_COUNT;
    }
  }
  // 라운드 경계에서 같은 직원 사건이 즉시 연속되지 않도록 간단히 회전합니다.
  if(next.run.order[0]===last){
    next.run.order.push(next.run.order.shift());
    next.activeIds=next.run.order.slice(0,state.run.difficulty==='easy'?1:2).map(i=>SCENARIOS[i].id);
    next.infrastructure={switchPorts:{1:true,2:true,3:true,4:true,5:true,6:true,7:true,8:true},webServiceRunning:true};
    for(const index of next.run.order){
      if(!next.activeIds.includes(SCENARIOS[index].id))continue;
      if(caseCause(next,index)==='switch-port-disabled')next.infrastructure.switchPorts[SCENARIOS[index].port]=false;
      if(caseCause(next,index)==='web-service-stopped')next.infrastructure.webServiceRunning=false;
    }
    next.scenarioIndex=next.run.order[0];bindCurrent(next);
  }
  // 라운드 시작 순서를 회전한 경우에도 새로 접수한 사건의 난이도 매핑이 정확해야 합니다.
  next.run.caseDifficulties=Object.fromEntries(next.activeIds.map(id=>[id,state.run.difficulty]));
  state.incidents=next.incidents;state.activeIds=next.activeIds;
  state.infrastructure=next.infrastructure;state.completedIds=[];
  state.run={...next.run,stats,round:completedRounds+1};
  state.scenarioIndex=next.scenarioIndex;bindCurrent(state);
  return true;
}

/**
 * 다음 근무일은 이전의 미해결 사건을 이어받지 않습니다.
 * 종료된 근무의 미해결 요약은 work-shift ledger에 이미 보관되었고,
 * 이번 함수는 새 근무의 사건/공유 장비 상태만 다시 생성합니다.
 * 누적 점수, 분야별 실적, 최근 해결 기록과 난이도는 그대로 유지합니다.
 */
export function startNextWorkShiftCases(state,random=Math.random){
  if(!isContinuousRun(state))return false;
  const next=newGame({mode:'random',continuous:true,difficulty:state.run.difficulty,random,pcExpanded:state.run.pcExpanded===true});
  const previousStats=state.run.stats;
  const previousRound=state.run.round;
  const previousPlayer={...state.player};
  // 새 근무 시작 직후 전날 접수됐던 동일 직원의 신고가 다시 뜨지 않게 합니다.
  // 해당 직원에게도 이번 근무 후반에는 새로운 사건이 발생할 수 있습니다.
  const previousActive=new Set(activeCaseIndices(state).map(index=>SCENARIOS[index].id));
  if(previousActive.size){
    next.run.order=[...next.run.order.filter(index=>!previousActive.has(SCENARIOS[index].id)),
      ...next.run.order.filter(index=>previousActive.has(SCENARIOS[index].id))];
    next.activeIds=next.run.order.slice(0,state.run.difficulty==='easy'?1:2).map(index=>SCENARIOS[index].id);
    next.run.caseDifficulties=Object.fromEntries(next.activeIds.map(id=>[id,state.run.difficulty]));
    next.scenarioIndex=next.run.order[0];
    next.infrastructure={switchPorts:{1:true,2:true,3:true,4:true,5:true,6:true,7:true,8:true},webServiceRunning:true};
    for(const index of next.run.order){
      if(!next.activeIds.includes(SCENARIOS[index].id))continue;
      if(caseCause(next,index)==='switch-port-disabled')next.infrastructure.switchPorts[SCENARIOS[index].port]=false;
      if(caseCause(next,index)==='web-service-stopped')next.infrastructure.webServiceRunning=false;
    }
  }
  state.incidents=next.incidents;
  state.activeIds=next.activeIds;
  state.infrastructure=next.infrastructure;
  state.completedIds=[];
  state.run={...next.run,round:previousRound+1,stats:previousStats};
  state.scenarioIndex=next.scenarioIndex;
  state.player=previousPlayer;
  bindCurrent(state);
  return true;
}

export const runCaseCount = state => isTutorial(state)?TUTORIAL_ORDER.length:SCENARIOS.length;
export const hasFinishedTutorial = state => isTutorial(state) && TUTORIAL_ORDER.every(index=>state.incidents[index]?.status==='resolved' && state.incidents[index]?.verified===true);
export const orderedCaseIndices = state => validOrder(state.run?.order,runMode(state))?state.run.order:[...STORY_ORDER];
export const difficultyLabel = state => DIFFICULTIES[state.run?.difficulty]?.label||'보통';
export const difficultyName = value => DIFFICULTIES[value]?.label||'확인 필요';
// 구버전 저장은 당시 난이도 설정이 고정이었으므로 활성 사건을 로드할 때 최초 1회 복원합니다.
export function difficultyForCase(state,index=state.scenarioIndex){
  const id=SCENARIOS[index]?.id;
  return id&&DIFFICULTIES[state.run?.caseDifficulties?.[id]]
    ?state.run.caseDifficulties[id]:state.run?.difficulty||'normal';
}
export function setRunDifficulty(state,difficulty){
  if(!isContinuousRun(state)||!DIFFICULTIES[difficulty])return false;
  if(state.run.difficulty===difficulty)return false;
  // 기존 사건을 수정하지 않습니다. 다음에 새로 활성화하는 사건에만 새 설정이 찍힙니다.
  state.run.difficulty=difficulty;
  return true;
}
/** 화면의 업무 순서: 내부 사건 식별자 INC-003과 화면상의 발생 순서를 구별합니다. */
export function caseQueueLabel(state,index){
  if(isTutorial(state))return `연습 ${TUTORIAL_ORDER.indexOf(index)+1}/2`;
  const order=orderedCaseIndices(state);
  const position=order.indexOf(index);
  return `${isContinuousRun(state)?`${state.run.round}R · `:''}업무 ${position>=0?position+1:index+1}/${order.length}`;
}
export const currentScenario = state => SCENARIOS[state.scenarioIndex];
export const activeNpcId = state => currentScenario(state).npcId;
export const currentPcId = state => currentScenario(state).pcId;
export const scenarioForNpc = (npcId) => SCENARIOS.find(s=>s.npcId===npcId);
export const activeCaseIndices = state => orderedCaseIndices(state).filter(i =>
  state.activeIds.includes(SCENARIOS[i].id) && state.incidents[i].status !== 'resolved');
export const npcHasActiveIncident = (state,npcId) => {
  const index=SCENARIOS.findIndex(s=>s.npcId===npcId);
  return index>=0 && state.activeIds.includes(SCENARIOS[index].id) && state.incidents[index].status!=='resolved';
};
// 서버실 화면의 표시 권한만 판정합니다. 실제 네트워크/장비 상태는 변경하지 않습니다.
// 미접수 장애의 상세 원인, 로그, 조작 버튼은 접수 전 노출하지 않습니다.
export function getDeviceInspectionAccess(state,npcId) {
  const index=SCENARIOS.findIndex(s=>s.npcId===npcId);
  if(index<0 || !npcHasActiveIncident(state,npcId))return 'idle';
  return state.incidents[index].status==='new'?'unaccepted':'ready';
}
// 화면에서 조작할 사건만 바꿉니다. 사건별 증거·장비 상태는 각각 incidents 안에 보존됩니다.
export function selectIncident(state,npcId) {
  if(!npcHasActiveIncident(state,npcId))return false;
  const index=SCENARIOS.findIndex(s=>s.npcId===npcId);
  state.scenarioIndex=index;
  bindCurrent(state);
  return true;
}
// 활성 사건은 최대 2개. 완료된 사건 이후 대기 중이던 사건이 나타납니다.
export function activatePending(state) {
  const unresolved=activeCaseIndices(state);
  const limit=isTutorial(state)||runMode(state)==='random' && state.run.difficulty==='easy'?1:2;
  if(unresolved.length>=limit)return null;
  const pendingIndex=orderedCaseIndices(state).find(i=>!state.activeIds.includes(SCENARIOS[i].id) &&
    state.incidents[i].status!=='resolved')??-1;
  if(pendingIndex<0)return null;
  const scenario=SCENARIOS[pendingIndex];
  state.activeIds.push(scenario.id);
  if(!state.run.caseDifficulties)state.run.caseDifficulties={};
  state.run.caseDifficulties[scenario.id]=state.run.difficulty;
  // 장애는 해당 사건이 실제 발생할 때 공유 장비에 적용합니다.
  if(caseCause(state,pendingIndex)==='switch-port-disabled')state.infrastructure.switchPorts[scenario.port]=false;
  if(caseCause(state,pendingIndex)==='web-service-stopped')state.infrastructure.webServiceRunning=false;
  return scenario;
}
export function focusNextActive(state) {
  const next=activeCaseIndices(state)[0];
  if(next===undefined)return null;
  state.scenarioIndex=next; bindCurrent(state);
  return SCENARIOS[next];
}
export function setPlayerPosition(state, position) {
  const x=Number(position?.x), z=Number(position?.z);
  if(isValidSavedPosition({x,z})){
    state.player={x,y:0,z}; return true;
  }
  return false;
}
// 이전 순차 진행 코드/테스트와의 호환용. v0.5 게임에서는 완료 애니메이션 뒤에 activatePending()을 사용합니다.
export function nextScenario(state) {
  if(state.incident.status!=='resolved')return {success:false,message:'현재 사건을 먼저 해결하세요.'};
  activatePending(state);
  const next=focusNextActive(state);
  if(!next)return {success:false,message:'오늘의 사건을 모두 해결했습니다.'};
  return {success:true,message:`${next.department} ${next.npcName} 사건을 확인해 주세요.`};
}
function note(state,key) {
  const item=EVIDENCE[key];
  if(item && !state.incident.evidence.includes(item.id)) state.incident.evidence.push(item.id);
}
function record(state,message) {state.incident.actions.push(message);}
function ensureInvestigation(state) {
  if(state.incident.status==='new') return false;
  if(state.incident.status==='accepted') state.incident.status='investigating';
  return true;
}
// 직원의 대답은 직원/질문/사건 모드에 따라 고정됩니다. 반복 질문도 같은 답을 돌려줍니다.
// 화면을 다시 열었을 때 이전 질문의 응답을 복원하는 데에도 동일한 함수를 사용합니다.
const NPC_DIALOGUE_LINES = Object.freeze([
  {intro:'인터넷이 갑자기 안 돼요. 아까까지 잘 됐는데요!',time:'책상 주변을 정리한 뒤부터 접속이 안 됐어요.',others:'다른 직원 PC는 제가 직접 확인해 보지 못했어요.'},
  {intro:'업무를 보려는데 PC 인터넷이 안 돼요. 확인해 주시겠어요?',time:'아침에 업무를 시작할 때쯤 발견했어요.',others:'다른 부서도 그런지는 모르겠어요. 확인이 필요해요.'},
  {intro:'사이트에 접속이 안 돼요. 어디가 문제인지 모르겠네요.',time:'조금 전 업무 사이트에 들어가려다 발견했어요.',others:'옆자리 직원은 제가 아직 물어보지 못했어요.'},
  {intro:'업무용 PC의 네트워크가 갑자기 끊겼어요. 도와주세요.',time:'오전에 작업하다가 갑자기 안 되기 시작했어요.',others:'다른 팀 PC까지 같은 상황인지는 확인하지 못했어요.'},
  {intro:'사내 업무 사이트에만 접속할 수 없어요. 다른 인터넷은 잘 되는데요.',time:'회의 후 접속하려니 갑자기 열리지 않아요.',others:'같은 사이트를 이용하는 다른 직원도 접속이 안 된다고 해요.'},
  {intro:'회사 계정을 다시 확인하라는 메일이 왔어요. 링크를 누르기 전에 확인해 주세요.',time:'점심 무렵에 왔어요. 오늘 안에 로그인하라는 내용이에요.',others:'저에게만 온 것 같아요. 아직 링크는 누르지 않았어요.'},
  {intro:'오늘 새벽에 제 계정으로 접속했다는 알림을 받았어요. 저는 로그인한 적이 없어요.',time:'03시 12분이라고 적혀 있어요. 저는 그때 집에서 자고 있었어요.',others:'다른 동료들은 비슷한 알림을 못 받았대요.'},
]);
const CONTINUOUS_NETWORK_LINES=Object.freeze([
  {intro:['제가 쓰는 PC가 인터넷에 연결되지 않네요. 한번 봐주시겠어요?','업무 중에 사이트가 갑자기 안 열려요. 도와주세요.'],time:'자리에서 업무를 보던 중 갑자기 접속이 안 됐어요.',others:'다른 직원의 컴퓨터는 아직 확인해 보지 못했어요.'},
  {intro:['PC로 업무를 시작하려는데 인터넷이 안 되네요.','인터넷에 연결할 수 없다는 메시지가 떠요. 확인 부탁드려요.'],time:'업무 시작 후 처음 사이트에 접속하려다가 발견했어요.',others:'여러 컴퓨터가 같은 증상인지 아직 모르겠어요.'},
  {intro:['회사 사이트에 접속하려는데 열리지 않아요.','인터넷 사용에 문제가 생긴 것 같아요. PC를 확인해 주세요.'],time:'조금 전 업무 페이지를 열려다가 알게 됐어요.',others:'주변 PC 상태는 직접 확인해 주시면 좋겠어요.'},
  {intro:['제 컴퓨터가 네트워크 연결이 안 된다고 나와요.','갑자기 인터넷을 쓸 수가 없네요. 도와주세요.'],time:'오늘 PC를 사용하던 중 발견했어요.',others:'다른 부서는 괜찮은지 제가 아직 확인하지 못했어요.'},
]);
// 이 문장은 직원이 직접 관찰할 수 있는 증상만 말합니다. 원인(케이블/DHCP 등)을 먼저 알리지 않습니다.
function continuousIntro(state,index){
  const cause=caseCause(state,index);
  const family=cause==='dns-wrong'?'name':'general';
  const variant=((state.run?.round||1)+index)%2;
  const generic=CONTINUOUS_NETWORK_LINES[index].intro[variant];
  if(family==='name')return variant===0?'회사 사이트 이름을 입력해도 페이지가 열리지 않아요.':'회사 사이트 주소를 입력해도 열리지 않아요. 확인 부탁드려요.';
  return generic;
}
// 이전 버전은 질문만 저장했습니다. 과거 사건에 남아 있는 실제 당시 대사를 유지합니다.
const PREVIOUS_STORY_LINES=Object.freeze([
  {intro:'인터넷이 갑자기 안 돼요. 아까까지 잘 됐는데요!',time:'책상 아래를 정리한 뒤부터 웹사이트가 열리지 않아요.',others:'다른 직원들은 인터넷이 잘 된다고 하네요.'},
  {intro:'컴퓨터를 켰는데 IP 주소를 제대로 못 받아서 네트워크가 안 돼요!',time:'오늘 아침 PC를 켠 이후로 이런 상태예요.',others:'저만이 아니라 몇몇 PC도 비슷한 증상이 있는 것 같아요.'},
  {intro:'다른 기능은 괜찮은 것 같은데 회사 사이트가 안 열려요!',time:'조금 전부터 사이트 이름으로 접속이 안 돼요.',others:'옆자리 직원은 다른 PC에서 접속이 된다고 하네요.'},
  {intro:'제 PC가 네트워크에 연결되지 않는다고 나와요. 케이블은 꽂혀 있는데 왜 그럴까요?',time:'오전에 자리를 옮기고 나서부터 인터넷이 안 돼요.',others:'다른 부서 PC는 잘 되는 것 같아요.'},
  {intro:'사내 업무 사이트에만 접속할 수 없어요. 다른 인터넷은 잘 되는데요.',time:'회의 후 접속하려니 갑자기 열리지 않아요.',others:'같은 사이트를 이용하는 다른 직원도 접속이 안 된다고 해요.'},
  {intro:'회사 계정을 다시 확인하라는 메일이 왔어요. 링크를 누르기 전에 확인해 주세요.',time:'점심 무렵에 왔어요. 오늘 안에 로그인하라는 내용이에요.',others:'저에게만 온 것 같아요. 아직 링크는 누르지 않았어요.'},
  {intro:'오늘 새벽에 제 계정으로 접속했다는 알림을 받았어요. 저는 로그인한 적이 없어요.',time:'03시 12분이라고 적혀 있어요. 저는 그때 집에서 자고 있었어요.',others:'다른 동료들은 비슷한 알림을 못 받았대요.'},
]);
const PREVIOUS_RANDOM_LINES=Object.freeze({
  intro:'업무 사이트 접속이 계속 실패해요. 네트워크 문제인지 잘 모르겠어요.',
  time:'조금 전부터 접속이 안 돼요. 정확한 원인은 아직 모르겠어요.',
  others:'주변 PC도 문제가 있는지는 확인하지 못했어요. 조사해 주세요.',
});
export function legacyNpcDialogueReply(state,index,topic='intro'){
  if(!Number.isInteger(index)||index<0||index>=SCENARIOS.length)return '';
  if(topic==='status')return index<5?'PC에서도 문제가 확인됐군요. 원인은 아직 모르겠지만, 연결과 장비 상태를 차근차근 확인해 주세요.':'기록을 확인하셨군요. 확인하신 근거에 맞게 안전하게 조치해 주세요.';
  const lines=isContinuousRun(state)&&index<4?PREVIOUS_RANDOM_LINES:PREVIOUS_STORY_LINES[index];
  return lines[topic]||lines.intro;
}
export function npcDialogueReply(state,index,topic='intro') {
  if(!Number.isInteger(index)||index<0||index>=SCENARIOS.length)return '';
  const isGeneric=isContinuousRun(state)&&index<4;
  const lines=isGeneric?CONTINUOUS_NETWORK_LINES[index]:NPC_DIALOGUE_LINES[index];
  if(topic==='status'&&index<4&&state.incidents[index].pcWorkHistory?.some(row=>row.impact==='추가 장애 발생')&&
     !getNetworkSnapshot({...state,scenarioIndex:index,incident:state.incidents[index]}).reachable)
    return '아까보다 접속 상태가 더 나빠졌어요. 방금 변경한 설정과 작업 기록도 확인해 주세요.';
  if(topic==='status')return index<4?observedNpcFollowup(state.incidents[index]):index===4
    ? 'PC에서도 문제가 확인됐군요. 연결뿐 아니라 서비스 상태도 살펴봐 주세요.'
    : '기록을 확인하셨군요. 확인하신 근거에 맞게 안전하게 조치해 주세요.';
  const narrative=isContinuousRun(state)?
    incidentNarrative(index,caseCause(state,index),state.incidents[index]?.presentationVariant):null;
  if(narrative&&Object.hasOwn(narrative,topic))return narrative[topic];
  if(isGeneric&&topic==='intro')return continuousIntro(state,index);
  return lines[topic]||lines.intro;
}
export function talk(state,topic='intro') {
  const caseId=state.scenarioIndex;
  if(state.incident.status==='resolved') return '이제 정상으로 돌아왔어요. 도와주셔서 감사합니다!';
  if(state.incident.status==='new') state.incident.status='accepted';
  note(state,'symptom');
  if(topic==='time')note(state,'time');
  if(topic==='others')note(state,'onlyOne');
  const reply=npcDialogueReply(state,caseId,topic);
  record(state,`직원 대화: ${topic}`);
  record(state,`직원 응답: ${topic} | ${reply}`);
  return reply;
}
/** 직원 PC에서만 사용하는 가상 IPv4·게이트웨이·포털 방화벽 구성. 실제 장비에는 접근하지 않습니다. */
export const EMPLOYEE_PC_GOOD_DNS=GOOD_DNS;
export const EMPLOYEE_PC_GOOD_GATEWAY='192.168.10.1';
export const EMPLOYEE_PC_FIREWALL_RULE='BlockCompanyPortal';
const PC_DEFAULT_ADDRESSES=Object.freeze(['192.168.10.27','192.168.10.38','192.168.10.46','192.168.10.51','192.168.10.52','192.168.10.53','192.168.10.54']);
export const isVirtualIPv4=value=>/^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(value))&&
  String(value).split('.').every(part=>Number(part)>=0&&Number(part)<=255);
function pcConfigFor(incident){return incident.pcConfig||{addressMode:'dhcp',staticIp:null,gateway:EMPLOYEE_PC_GOOD_GATEWAY,portalBlockRule:false};}
function conflictAddress(value,index){
  return ['192.168.10.1','192.168.10.2','192.168.10.10','192.168.10.20','192.168.10.30',
    ...PC_DEFAULT_ADDRESSES.filter((_,i)=>i!==index)].includes(value);
}
export function getNetworkSnapshot(state) {
  const i=state.incident,config=pcConfigFor(i);
  const scenario=currentScenario(state);
  const switchEnabled=state.infrastructure.switchPorts[scenario.port]!==false;
  const connected=i.cableConnected && switchEnabled;
  const staticMode=config.addressMode==='static';
  const chosenIp=staticMode?config.staticIp:PC_DEFAULT_ADDRESSES[state.scenarioIndex];
  const ipConflict=staticMode&&conflictAddress(chosenIp,state.scenarioIndex);
  const hasIp=connected&&(staticMode?isVirtualIPv4(chosenIp):i.dhcpRunning&&i.leaseRenewed);
  const gateway=hasIp?config.gateway:'—';
  const gatewayGood=hasIp&&gateway===EMPLOYEE_PC_GOOD_GATEWAY;
  const dnsGood=i.dnsServer===GOOD_DNS;
  const portalAllowed=config.portalBlockRule!==true;
  const localReachable=connected&&hasIp&&!ipConflict;
  const routed=localReachable&&gatewayGood;
  const networkReachable=routed&&dnsGood&&portalAllowed;
  const serviceRunning=i.rootCause==='web-service-stopped'?state.infrastructure.webServiceRunning:true;
  const reachable=networkReachable&&serviceRunning;
  let internet;
  if(i.verified)internet='검증 완료 · 정상';
  else if(!connected)internet='연결 안 됨';
  else if(!hasIp)internet='IP 주소 할당 실패';
  else if(ipConflict)internet='IP 주소 충돌 의심';
  else if(!gatewayGood)internet='게이트웨이 설정 이상';
  else if(!dnsGood)internet='DNS 이름 해석 실패';
  else if(!portalAllowed)internet='사내 포털 방화벽 차단';
  else if(!serviceRunning)internet='웹 서비스에 연결할 수 없음';
  else internet='연결 검사 필요';
  return {
    adapter:'Ethernet 0',connected,
    linkLabel:connected?'연결됨 (1.0 Gbps)':i.cableConnected?'이더넷 링크 연결 끊김':'네트워크 케이블 연결 안 됨',
    ipv4:!connected?'—':hasIp?chosenIp:'169.254.12.8',
    mask:!connected?'—':hasIp?'255.255.255.0':'255.255.0.0',
    gateway,dns:connected?i.dnsServer:'—',
    internet,hasIp,dnsGood,gatewayGood,ipConflict,portalAllowed,routed,localReachable,
    addressMode:staticMode?'static':'dhcp',portalBlockRule:config.portalBlockRule===true,
    reachable,networkReachable,serviceRunning,dhcpServiceRunning:i.dhcpRunning,
    targetHost:i.rootCause==='web-service-stopped'?'intranet.example.test':'portal.example.test',
    scenario:i.rootCause,
    canRenew:['dhcp-down','dhcp-lease-expired'].includes(i.rootCause)&&!i.leaseRenewed,
    canFixDns:i.rootCause==='dns-wrong'&&!dnsGood,
  };
}
/** 설정값은 문자열이 아닌 검증된 IPv4/토글만 적용합니다. 그 결과는 저장되는 사건 상태에만 반영됩니다. */
export function setEmployeePcConfig(state,field,value){
  if(!state.run?.pcExpanded)return {success:false,message:'이 모드에서는 직원 PC 직접 설정 실습을 사용할 수 없습니다.'};
  if(!ensureInvestigation(state))return {success:false,message:'먼저 직원에게 사건을 접수해 주세요.'};
  if(state.scenarioIndex>=4)return {success:false,message:'네트워크 장애가 접수된 직원 PC에서만 이 설정을 변경할 수 있습니다.'};
  if(!['dns','gateway','ipv4','dhcp','portal-rule'].includes(field))return {success:false,message:'지원하지 않는 설정입니다.'};
  if(field==='dns'||field==='gateway'||field==='ipv4'){
    if(!isVirtualIPv4(value))return {success:false,message:'IPv4 주소 형식이 올바르지 않습니다.'};
    if(field==='ipv4'&&(['0','255'].includes(String(value).split('.').at(-1))||!String(value).startsWith('192.168.10.')))
      return {success:false,message:'이 가상 실습은 192.168.10.0/24 네트워크만 지원합니다.'};
  }
  if(field==='portal-rule'&&typeof value!=='boolean')return {success:false,message:'방화벽 규칙은 활성/비활성만 설정할 수 있습니다.'};
  const config={...pcConfigFor(state.incident)};
  const before=getNetworkSnapshot(state);
  const previous=field==='dns'?state.incident.dnsServer:field==='gateway'?config.gateway:field==='ipv4'?before.ipv4:
    field==='dhcp'?config.addressMode:config.portalBlockRule;
  if(field==='dns')state.incident.dnsServer=String(value);
  if(field==='gateway')config.gateway=String(value);
  if(field==='ipv4'){config.addressMode='static';config.staticIp=String(value);}
  if(field==='dhcp'){config.addressMode='dhcp';config.staticIp=null;}
  if(field==='portal-rule')config.portalBlockRule=value;
  state.incident.pcConfig=config;
  const after=getNetworkSnapshot(state);
  const changed=field==='dns'?previous!==state.incident.dnsServer:
    field==='gateway'?previous!==config.gateway:
    field==='ipv4'?before.addressMode!=='static'||previous!==config.staticIp:
    field==='dhcp'?previous!=='dhcp':previous!==config.portalBlockRule;
  if(!changed)return {success:false,message:'이미 동일한 설정이 적용돼 있습니다.',changed:false};
  const label={dns:'DNS 서버',gateway:'기본 게이트웨이',ipv4:'IPv4 주소',dhcp:'DHCP 자동 할당',
    'portal-rule':'사내 포털 차단 규칙'}[field];
  const faults=n=>new Set([...(n.hasIp&&n.ipConflict?['ip-conflict']:[]),
    ...(n.hasIp&&!n.gatewayGood?['gateway']:[]),...(!n.dnsGood?['dns']:[]),
    ...(!n.portalAllowed?['firewall']:[]),...(n.connected&&!n.hasIp?['address']:[])]);
  const oldFaults=faults(before),newFaults=faults(after);
  const additional=[...newFaults].some(fault=>!oldFaults.has(fault));
  const recovered=[...oldFaults].some(fault=>!newFaults.has(fault));
  const impact=additional?'추가 장애 발생':!before.reachable&&after.reachable?'통신 복구':
    recovered?'장애 일부 복구':before.internet!==after.internet?'네트워크 상태 변경':'변경 후 상태 유지';
  state.incident.pcWorkHistory??=[];
  state.incident.pcWorkHistory.push({field,label,previous:String(previous),next:String(value),impact});
  if(state.incident.pcWorkHistory.length>40)state.incident.pcWorkHistory.splice(0,state.incident.pcWorkHistory.length-40);
  if(state.incident.status!=='resolved')state.incident.status='action_taken';
  record(state,`직원 PC 설정 변경: ${label} ${String(previous)} → ${String(value)} (${impact})`);
  if(!after.dnsGood)note(state,'dnsBad');
  else if(field==='dns')note(state,'dnsRestored');
  if(!after.gatewayGood&&after.hasIp)note(state,'gatewayBad');
  else if(field==='gateway'&&after.gatewayGood)note(state,'gatewayRestored');
  if(!after.portalAllowed)note(state,'firewallBlocked');
  else if(field==='portal-rule'&&after.portalAllowed)note(state,'firewallRestored');
  if(after.ipConflict)note(state,'ipConflict');
  else if(field==='ipv4'||field==='dhcp')note(state,'ipRestored');
  return {success:true,changed:true,impact,message:`${label} 설정 적용 · ${impact}. 연결을 다시 검사하세요.`,snapshot:after};
}

export function inspectPc(state) {
  if(!ensureInvestigation(state))return null;
  const n=getNetworkSnapshot(state);
  note(state,'pcPower');
  note(state,n.connected?'linkUp':'lanDown');
  if(n.connected&&!n.hasIp)note(state,'dhcpFail');
  if(n.hasIp&&!n.dnsGood)note(state,'dnsBad');
  if(n.hasIp&&!n.gatewayGood)note(state,'gatewayBad');
  if(n.ipConflict)note(state,'ipConflict');
  if(!n.portalAllowed)note(state,'firewallBlocked');
  record(state,'PC 네트워크 상태 조사');
  return {power:'정상',lan:n.connected?'연결됨':'연결 끊김',internet:n.internet};
}
export function inspectAdapter(state) {
  if(!ensureInvestigation(state))return null;
  const n=getNetworkSnapshot(state);
  note(state,'adapterChecked');
  note(state,n.connected?'linkUp':'lanDown');
  if(n.connected&&!n.hasIp)note(state,'dhcpFail');
  if(n.hasIp&&!n.dnsGood)note(state,'dnsBad');
  if(n.hasIp&&!n.gatewayGood)note(state,'gatewayBad');
  if(n.ipConflict)note(state,'ipConflict');
  if(!n.portalAllowed)note(state,'firewallBlocked');
  record(state,'가상 PC · 네트워크 설정 열람');
  return n;
}
// 가상 터미널의 진단 명령도 GUI와 동일한 증거/장비 상태를 참조합니다.
// 새로운 터미널 명령을 위한 별도 가상 네트워크 복제본은 만들지 않습니다.
export function inspectTerminal(state,command) {
  if(!ensureInvestigation(state))return null;
  const n=getNetworkSnapshot(state);
  note(state,'pcPower');
  note(state,n.connected?'linkUp':'lanDown');
  if(n.connected&&!n.hasIp)note(state,'dhcpFail');
  if(n.hasIp&&!n.dnsGood)note(state,'dnsBad');
  if(n.hasIp&&!n.gatewayGood)note(state,'gatewayBad');
  if(n.ipConflict)note(state,'ipConflict');
  if(!n.portalAllowed)note(state,'firewallBlocked');
  if(command.toLowerCase().startsWith('ipconfig'))note(state,'adapterChecked');
  // 과도한 반복 입력으로 로컬 저장소가 불필요하게 커지지 않도록 최근 명령만 기록합니다.
  const commandRecords=state.incident.actions.filter(action=>action.startsWith('가상 터미널:')).length;
  if(commandRecords<60)record(state,`가상 터미널: ${command.slice(0,160)}`);
  return n;
}
export function inspectBrowser(state) {
  if(!ensureInvestigation(state))return null;
  const n=getNetworkSnapshot(state);
  if(!n.reachable)note(state,'browserFailed');
  record(state,'가상 브라우저 · 사내 포털 접속 상태 확인');
  return {reachable:n.reachable,url:`https://${n.targetHost}`};
}
export function inspectCable(state) {
  if(!ensureInvestigation(state))return null;
  if(state.incident.rootCause==='cable-unplugged'&&!state.incident.evidence.includes('adapterChecked'))return null;
  if(!state.incident.cableConnected)note(state,'cableLoose');
  note(state,'pcPortChecked');
  record(state,'PC 본체 뒷면 · LAN 포트 조사');
  return {connected:state.incident.cableConnected};
}
export function inspectServer(state) {
  if(!ensureInvestigation(state))return null;
  note(state,'serverChecked');
  if(!state.incident.dhcpRunning)note(state,'dhcpStopped');
  record(state,'서버실 · DHCP/DNS 서비스 확인');
  return {dhcpRunning:state.incident.dhcpRunning,dnsRunning:true,dhcpAddress:'192.168.10.2',dnsAddress:GOOD_DNS};
}
/** 서버실 장비 상태는 현재 조사 중인 PC와 별개로 하나의 공유 모델에서 관리합니다. */
export function getSwitchPorts(state) {
  return Array.from({length:8},(_,i)=>{
    const port=i+1;
    const attached=SCENARIOS.find(s=>s.port===port);
    const deviceIncident=attached?state.incidents[SCENARIOS.indexOf(attached)]:null;
    // 미발생 사건의 초기 장애는 실제 발생 전까지 서버실 현황에 노출하지 않습니다.
    const isPending=attached && !state.activeIds.includes(attached.id) && deviceIncident?.status!=='resolved';
    const cableConnected=isPending?true:deviceIncident?.cableConnected;
    return {port,adminUp:state.infrastructure.switchPorts[port]!==false,
      device:attached ? `${attached.npcName} PC` : '예비 포트',pcId:attached?.pcId||null,
      linkUp:state.infrastructure.switchPorts[port]!==false&&!!cableConnected};
  });
}
export function inspectSwitch(state,port=3) {
  const owner=activeCauseOwner(state,'switch-port-disabled');
  if(owner&&getDeviceInspectionAccess(state,owner.scenario.npcId)==='unaccepted')
    return {access:'unaccepted',staff:owner.scenario.npcName,ports:[],selected:null};
  const ports=getSwitchPorts(state).map(entry=>{
    const target=SCENARIOS.find(s=>s.port===entry.port);
    // 다른 미접수 직원의 링크 상태도 스위치에서 미리 확인할 수 없게 합니다.
    return target && getDeviceInspectionAccess(state,target.npcId)==='unaccepted'
      ? {...entry,adminUp:null,linkUp:null,access:'unaccepted'} : entry;
  });
  const selected=ports.find(p=>p.port===Number(port));
  if(!selected)return null;
  const repairPort=owner?.scenario.port??null;
  if(owner&&state.scenarioIndex===owner.index&&ensureInvestigation(state)) {
    note(state,'switchChecked');
    if(selected.adminUp===false&&selected.port===repairPort)note(state,'switchPortDown');
    record(state,`서버실 스위치 ${selected.port}번 포트 상태 점검`);
  }
  return {access:'ready',ports,selected,repairPort};
}
export function setSwitchPort(state,port,up) {
  const owner=activeCauseOwner(state,'switch-port-disabled');
  const repairPort=owner?.scenario.port;
  if(!owner||Number(port)!==repairPort||up!==true)
    return {success:false,message:'현재 접수된 장애 PC에 연결된 포트만 복구할 수 있습니다.'};
  if(state.scenarioIndex!==owner.index || !ensureInvestigation(state))
    return {success:false,message:`${owner.scenario.npcName} 사건을 접수하고 스위치 포트를 조사하세요.`};
  if(!state.incident.evidence.includes('switchPortDown'))
    return {success:false,message:`${repairPort}번 포트 상태를 먼저 확인해 주세요.`};
  if(state.infrastructure.switchPorts[repairPort])
    return {success:false,message:`이미 ${repairPort}번 포트가 활성 상태입니다.`};
  state.infrastructure.switchPorts[repairPort]=true;state.incident.status='action_taken';
  note(state,'switchPortFixed');record(state,`스위치 ${repairPort}번 포트 관리 상태 활성화`);
  return {success:true,message:`${repairPort}번 포트를 활성화했습니다. ${owner.scenario.npcName} PC에서 링크와 통신 상태를 검증하세요.`};
}
export function inspectWebService(state) {
  const access=getDeviceInspectionAccess(state,'jung');
  if(access==='unaccepted')return {access,running:null,host:'intranet.example.test',ip:'192.168.10.30'};
  if(state.scenarioIndex===4&&access==='ready'&&ensureInvestigation(state)) {
    note(state,'webServiceChecked');
    if(!state.infrastructure.webServiceRunning)note(state,'webServiceStopped');
    record(state,'서버실 · 사내 웹 서비스 상태 조사');
  }
  return {access,running:state.infrastructure.webServiceRunning,host:'intranet.example.test',ip:'192.168.10.30'};
}
export function startWebService(state) {
  if(state.scenarioIndex!==4 || !npcHasActiveIncident(state,'jung') || !ensureInvestigation(state))
    return {success:false,message:'정사원 사건을 먼저 접수한 뒤 웹 서버를 점검하세요.'};
  if(!state.incident.evidence.includes('webServiceChecked'))return {success:false,message:'웹 서비스 상태를 먼저 확인해 주세요.'};
  if(state.infrastructure.webServiceRunning)return {success:false,message:'웹 서비스가 이미 실행 중입니다.'};
  state.infrastructure.webServiceRunning=true;state.incident.status='action_taken';
  note(state,'webServiceStarted');record(state,'사내 웹 서비스 시작');
  return {success:true,message:'사내 웹 서비스를 시작했습니다. 정사원 PC에서 사이트 접속을 확인하세요.'};
}
export function reconnectCable(state) {
  if(!ensureInvestigation(state))return {success:false,message:'먼저 직원에게 사건을 접수하세요.'};
  if(state.incident.rootCause==='cable-unplugged'&&!state.incident.evidence.includes('adapterChecked'))return {success:false,message:'PC의 네트워크 설정에서 연결 끊김을 먼저 확인해 보세요.'};
  if(state.incident.cableConnected)return {success:false,message:'이미 LAN 케이블이 연결돼 있습니다.'};
  state.incident.cableConnected=true;
  state.incident.status='action_taken';
  note(state,'cableFixed');record(state,'LAN 케이블 재연결');
  return {success:true,message:'랜선을 연결했어요. PC 화면에서 통신을 확인해 주세요.'};
}
export function startDhcp(state) {
  if(!ensureInvestigation(state))return {success:false,message:'먼저 사건을 접수하세요.'};
  if(state.incident.dhcpRunning)return {success:false,message:'DHCP 서비스가 이미 실행 중입니다.'};
  state.incident.dhcpRunning=true;
  state.incident.status='action_taken';
  note(state,'dhcpStarted');record(state,'서버실 DHCP 서비스 재시작');
  return {success:true,message:'DHCP 서비스를 다시 시작했습니다. PC에서 IP 임대를 갱신하세요.'};
}
export function renewLease(state) {
  if(!ensureInvestigation(state))return {success:false,message:'먼저 사건을 접수하세요.'};
  if(!state.incident.cableConnected)return {success:false,message:'유선 네트워크 연결이 끊겨 있습니다.'};
  if(!state.incident.dhcpRunning)return {success:false,message:'DHCP 서버에서 응답이 없습니다. 서버실을 확인하세요.'};
  if(pcConfigFor(state.incident).addressMode==='static')return {success:false,message:'정적 IP 사용 중입니다. 먼저 DHCP 자동 할당으로 전환하세요.'};
  if(state.incident.leaseRenewed)return {success:false,message:'이미 정상 IPv4 주소가 할당돼 있습니다.'};
  if(state.incident.rootCause==='dhcp-lease-expired'&&!state.incident.evidence.includes('serverChecked'))
    return {success:false,message:'DHCP 서버가 정상 응답 중인지 먼저 확인하세요. 서버실 점검 결과를 남겨야 합니다.'};
  state.incident.leaseRenewed=true;state.incident.status='action_taken';
  note(state,'leaseRenewed');record(state,'PC DHCP 주소 재할당');
  return {success:true,message:`정상 IPv4 주소 ${getNetworkSnapshot(state).ipv4}를 다시 받았습니다. 연결 상태를 검증하세요.`};
}
export function restoreDns(state) {
  if(!ensureInvestigation(state))return {success:false,message:'먼저 사건을 접수하세요.'};
  if(state.incident.dnsServer===GOOD_DNS)return {success:false,message:'DNS 서버 설정이 이미 정상입니다.'};
  if(state.run?.pcExpanded)setEmployeePcConfig(state,'dns',GOOD_DNS);
  else {state.incident.dnsServer=GOOD_DNS;state.incident.status='action_taken';}
  note(state,'dnsRestored');record(state,'PC DNS 서버 설정 복구');
  return {success:true,message:'DNS 서버를 정상 주소로 설정했습니다. 도메인 접속을 검증하세요.'};
}
/** v0.8: 보안 사건은 네트워크 설정과 분리된 하나의 사건 모델을 사용합니다. */
function securityGuard(state,cause) {
  if(!(Array.isArray(cause)?cause.includes(state.incident.rootCause):state.incident.rootCause===cause) || !ensureInvestigation(state))
    return {success:false,message:'해당 직원의 보안 사건을 먼저 접수해 주세요.'};
  return null;
}
export function inspectMail(state) {
  const failure=securityGuard(state,MAIL_CAUSES);if(failure)return failure;
  if(!state.incident.security.mailReviewed){
    state.incident.security.mailReviewed=true;
    note(state,'mailOpened');record(state,'가상 이메일 · 의심 메일 열람');
  }
  return {success:true,message:'메일 본문과 발신자 정보를 확인했습니다.'};
}
export function inspectMailIndicators(state) {
  const failure=securityGuard(state,MAIL_CAUSES);if(failure)return failure;
  if(!state.incident.security.mailReviewed)return {success:false,message:'메일을 먼저 열어 확인하세요.'};
  state.incident.security.indicatorsReviewed=true;
  const attachment=state.incident.rootCause==='phishing-attachment';
  note(state,attachment?'attachmentIndicators':'mailIndicators');
  record(state,attachment?'메일 발신자·첨부파일 이름 및 확장자 분석':'메일 헤더와 표시 링크의 실제 주소 확인');
  return {success:true,message:attachment?'발신자 주소가 내부 담당자와 일치하지 않고 첨부파일이 실행 파일로 위장돼 있습니다. 실행하지 말고 신고하세요.':'발신자 도메인과 로그인 링크가 사내 공식 주소와 다릅니다.'};
}
export function reportPhishing(state) {
  const failure=securityGuard(state,MAIL_CAUSES);if(failure)return failure;
  if(!state.incident.security.indicatorsReviewed)return {success:false,message:'발신자·의심 내용을 먼저 분석해 근거를 확보하세요.'};
  if(state.incident.security.reported)return {success:false,message:'이미 보안 신고를 접수했습니다.'};
  state.incident.security.reported=true;
  note(state,'mailReported');record(state,'피싱 의심 메일 보안 신고');
  return {success:true,message:'신고가 접수됐습니다. 메일도 격리해야 합니다.'};
}
export function quarantineMail(state) {
  const failure=securityGuard(state,MAIL_CAUSES);if(failure)return failure;
  if(!state.incident.security.reported)return {success:false,message:'근거를 확인하고 보안 신고부터 진행하세요.'};
  if(state.incident.security.quarantined)return {success:false,message:'이미 메일을 격리했습니다.'};
  state.incident.security.quarantined=true;state.incident.status='action_taken';
  note(state,'mailQuarantined');record(state,'피싱 의심 메일 격리');
  return {success:true,message:'메일을 격리했습니다. 보안 처리 결과를 검증하세요.'};
}
export function inspectLoginLog(state) {
  const failure=securityGuard(state,'anomalous-login');if(failure)return failure;
  if(!state.incident.security.logReviewed){
    state.incident.security.logReviewed=true;
    note(state,'loginLogChecked');record(state,'계정 보안 콘솔 · 로그인 감사 로그 열람');
  }
  return {success:true,message:'접속 기록을 확인했습니다.'};
}
export function flagSuspiciousLogin(state,entryId) {
  const failure=securityGuard(state,'anomalous-login');if(failure)return failure;
  if(!state.incident.security.logReviewed)return {success:false,message:'로그 목록을 먼저 확인하세요.'};
  const entry=findLoginAuditEntry(entryId);
  if(!entry)return {success:false,message:'존재하지 않는 로그인 기록입니다.'};
  if(!entry.suspicious){
    record(state,`정상 로그인 분석: ${entry.time} · ${entry.ip}`);
    return {success:true,identified:false,message:`${entry.time} · ${entry.ip}: 등록된 사내 PC와 업무 시간대에 일치합니다. 정상 접속 가능성이 높으며, 다른 기록도 비교해 보세요.`};
  }
  state.incident.security.suspiciousSelected=true;
  note(state,'suspiciousLogin');record(state,`의심 로그인 식별: ${entry.time} · ${entry.ip}`);
  return {success:true,identified:true,message:`${entry.time} · ${entry.ip}: 등록되지 않은 장치, 비업무 시간대, 사용자 진술을 종합해 의심 접속으로 식별했습니다. 세션을 종료하고 계정을 보호하세요.`};
}
export function revokeSuspiciousSession(state,selectedEntryId=null) {
  const failure=securityGuard(state,'anomalous-login');if(failure)return failure;
  const selected=selectedEntryId===null?null:findLoginAuditEntry(selectedEntryId);
  if(selectedEntryId!==null&&!selected)return {success:false,message:'먼저 접속 기록을 선택해 분석하세요.'};
  if(selected&&!selected.suspicious){
    if(difficultyForCase(state)!=='hard')return {success:false,message:'선택한 기록은 정상 업무 접속입니다. 의심 세션으로 판단한 근거를 다시 확인하세요.'};
    const s=state.incident.security;
    if(s.normalSessionInterrupted&&!s.normalSessionRecovered)return {success:false,message:'이미 정상 업무 세션이 중단됐습니다. 먼저 재인증을 진행하세요.'};
    s.normalSessionInterrupted=true;s.normalSessionRecovered=false;
    s.normalSessionMistakes=Math.min(10,(s.normalSessionMistakes||0)+1);
    record(state,`정상 업무 세션 오종료: ${selected.time} · ${selected.ip}`);
    return {success:true,mistake:true,message:'선택한 정상 업무 세션이 강제 로그아웃됐습니다. 업무 접속이 중단됐으므로 정상 세션 재인증을 진행해야 합니다.'};
  }
  if(!state.incident.security.suspiciousSelected)return {success:false,message:selected?'선택한 기록의 의심 근거를 먼저 확인하세요.':'접속 기록을 분석하고 의심 세션을 선택하세요.'};
  if(state.incident.security.sessionRevoked)return {success:false,message:'의심 세션은 이미 종료됐습니다.'};
  state.incident.security.sessionRevoked=true;
  note(state,'sessionRevoked');record(state,'의심 세션 종료 및 기존 인증 해제');
  return {success:true,message:'의심 세션을 종료했습니다. 계정 보호 조치도 필요합니다.'};
}
/** 잘못 종료한 정상 직원 세션의 가상 재인증. 실제 계정에는 접근하지 않습니다. */
export function restoreNormalLoginSession(state){
  const failure=securityGuard(state,'anomalous-login');if(failure)return failure;
  const s=state.incident.security;
  if(!s.normalSessionInterrupted||s.normalSessionRecovered)return {success:false,message:'재인증이 필요한 정상 세션이 없습니다.'};
  s.normalSessionRecovered=true;record(state,'정상 직원 업무 세션 재인증 복구');
  return {success:true,message:'정상 직원 세션 재인증이 완료됐습니다. 의심 접속 처리도 마무리하세요.'};
}
export function secureAccount(state) {
  const failure=securityGuard(state,'anomalous-login');if(failure)return failure;
  if(!state.incident.security.sessionRevoked)return {success:false,message:'의심 세션부터 종료하세요.'};
  if(state.incident.security.accountSecured)return {success:false,message:'계정 보호 조치를 이미 수행했습니다.'};
  state.incident.security.accountSecured=true;state.incident.status='action_taken';
  note(state,'accountSecured');record(state,'계정 비밀번호 초기화 및 재인증 요구');
  return {success:true,message:'계정 보호 조치를 적용했습니다. 대응 결과를 검증하세요.'};
}
// 점수는 정답 암기가 아닌 증거·조치·검증 행동에 기반합니다.
// 사건을 해결한 뒤 계산 결과를 영구 고정하므로 다른 화면을 조사해도 점수가 바뀌지 않습니다.
const SCORE_KEYS=Object.freeze({
  'cable-unplugged':{investigate:'adapterChecked',diagnosis:'cableLoose',action:['cableFixed']},
  'dhcp-down':{investigate:'dhcpFail',diagnosis:'dhcpStopped',action:['dhcpStarted','leaseRenewed']},
  'dhcp-lease-expired':{investigate:'dhcpFail',diagnosis:'serverChecked',action:['leaseRenewed']},
  'dns-wrong':{investigate:'adapterChecked',diagnosis:'dnsBad',action:['dnsRestored']},
  'gateway-wrong':{investigate:'adapterChecked',diagnosis:'gatewayBad',action:['gatewayRestored']},
  'firewall-rule':{investigate:'adapterChecked',diagnosis:'firewallBlocked',action:['firewallRestored']},
  'switch-port-disabled':{investigate:'lanDown',diagnosis:'switchPortDown',action:['switchPortFixed']},
  'web-service-stopped':{investigate:'browserFailed',diagnosis:'webServiceStopped',action:['webServiceStarted']},
  'phishing-email':{investigate:'mailOpened',diagnosis:'mailIndicators',action:['mailReported','mailQuarantined']},
  'phishing-attachment':{investigate:'mailOpened',diagnosis:'attachmentIndicators',action:['mailReported','mailQuarantined']},
  'anomalous-login':{investigate:'loginLogChecked',diagnosis:'suspiciousLogin',action:['sessionRevoked','accountSecured']},
});
export function getCaseScore(state,index=state.scenarioIndex) {
  const scenario=SCENARIOS[index], i=state.incidents[index];
  if(!scenario||!i||i.status!=='resolved')return null;
  const recorded=state.run?.evaluations?.[scenario.id];
  if(recorded && [
    ['investigation',30],['diagnosis',25],['action',25],['validation',20],
    ['hints',2],['failures',10000],['deduction',30],['total',100],
  ].every(([field,max])=>Number.isInteger(recorded[field])&&recorded[field]>=0&&recorded[field]<=max))return recorded;
  const keys=SCORE_KEYS[i.rootCause];
  const evidence=new Set(i.evidence);
  const investigation=(evidence.has('symptom')?15:0)+(evidence.has(keys.investigate)?15:0);
  const diagnosis=evidence.has(keys.diagnosis)?25:0;
  const action=keys.action.every(k=>evidence.has(k))?25:0;
  const validation=i.verified?20:0;
  const safeCount=value=>{const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(10000,Math.floor(n))):0;};
  const hints=safeCount(state.run?.hints?.[scenario.id]||0);
  const failures=safeCount(state.run?.failures?.[scenario.id]||0);
  const diagnostics=safeCount(state.run?.diagnostics?.[scenario.id]||0);
  const caseDifficulty=difficultyForCase(state,index);
  const diff=DIFFICULTIES[caseDifficulty]||DIFFICULTIES.normal;
  const normalSessionsRevoked=safeCount(i.security?.normalSessionMistakes||0);
  const sessionPenalty=runMode(state)==='random'&&caseDifficulty==='hard'?normalSessionsRevoked*5:0;
  const deduction=Math.min(30,(runMode(state)==='story'?0:hints*diff.hintPenalty)+(runMode(state)==='random'&&caseDifficulty==='hard'?failures*diff.failedPenalty:0)+sessionPenalty);
  return {investigation,diagnosis,action,validation,hints,failures,diagnostics,normalSessionsRevoked,sessionPenalty,deduction,
    total:Math.max(0,investigation+diagnosis+action+validation-deduction)};
}
function finishEvaluation(state) {
  if(!state.run)return;
  const id=state.incident.id;
  if(!state.run.evaluations[id]){
    const score=getCaseScore(state);
    // 새로 완료한 사건만 학습 피드백 스냅샷을 저장합니다. 이전 버전 사건을 소급 평가하지 않습니다.
    const feedback=makeDiagnosticAssessment(state.incident,caseCause(state),difficultyForCase(state));
    if(feedback)state.incident.diagnosticAssessment=feedback;
    state.run.evaluations[id]=score;
    if(isContinuousRun(state))addContinuousResult(state,state.scenarioIndex,score.total);
  }
}
// 일반 점검은 진단 기록으로만 남깁니다.
// 감점 대상은 랜덤 · 어려움에서 명시적으로 제출한 최종 평가가 실패한 경우뿐입니다.
function countFailedVerification(state,{diagnostic=false}={}){
  if(!state.run)return false;
  const id=state.incident.id;
  const penalized=!diagnostic&&runMode(state)==='random'&&difficultyForCase(state)==='hard';
  const key=penalized?'failures':'diagnostics';
  if(!state.run[key])state.run[key]={};
  state.run[key][id]=(state.run[key][id]||0)+1;
  return penalized;
}
const HINTS=Object.freeze([
  ['PC의 네트워크 연결 상태부터 확인하세요.','케이블을 분리한 흔적이 있는지 PC 본체 뒤 LAN 포트를 조사하세요.'],
  ['PC의 IPv4 주소가 정상 대역인지 확인하세요.','169.254 주소라면 서버실 DHCP 서비스를 확인하고 IP를 갱신하세요.'],
  ['IP 통신과 이름 해석 문제를 구분하세요.','네트워크 설정의 DNS 서버 주소를 정상 주소와 비교해 보세요.'],
  ['케이블 연결과 스위치 포트 활성 상태는 별개입니다.','서버실 SW-01의 3번 포트 관리 상태를 확인하세요.'],
  ['IP 연결이 정상이어도 웹사이트가 열리지 않을 수 있어요.','WEB-01의 웹 서비스 상태를 확인하고 브라우저에서 다시 검사하세요.'],
  ['메일 링크는 누르지 말고 발신자와 실제 주소를 확인하세요.','가상 메일함의 분석 메뉴에서 도메인 불일치를 확인하고 신고·격리하세요.'],
  ['로그인 시간·주소·사용자 진술을 함께 비교하세요.','새벽 03:12의 외부 IP 로그를 찾아 세션을 끝내고 계정을 보호하세요.'],
]);
export function revealHint(state,index=state.scenarioIndex) {
  const scenario=SCENARIOS[index];
  if(!scenario || !state.activeIds.includes(scenario.id) || state.incidents[index].status==='resolved')
    return {success:false,message:'현재 진행 중인 사건에만 힌트를 사용할 수 있습니다.'};
  if(!state.run)state.run=initialRun();
  const previous=state.run.hints[scenario.id]||0;
  if(previous>=2)return {success:false,message:'이 사건의 힌트 2개를 모두 확인했어요.',used:2};
  const used=previous+1;
  state.run.hints[scenario.id]=used;
  const cause=caseCause(state,index);
  const hintIndex=cause==='dhcp-lease-expired'?1:cause==='phishing-attachment'?5:SCENARIOS.findIndex(s=>s.cause===cause);
  const port=SCENARIOS[index].port;
  const alt=cause==='gateway-wrong'?['외부 IP와 기본 게이트웨이까지의 연결을 따로 비교해 보세요.','PC의 기본 게이트웨이 설정이 현재 사내 네트워크와 일치하는지 확인하세요.']
    :cause==='firewall-rule'?['IP·DNS가 정상인데 특정 사이트만 안 열린다면 PC의 보안 규칙도 확인하세요.','가상 netsh에서 사내 포털을 차단하는 방화벽 규칙이 활성화되어 있는지 조사하세요.']
    :cause==='dhcp-lease-expired'
    ?['169.254 주소가 나온다면 서버의 DHCP 상태도 점검하세요.','DHCP 서버가 정상이라면 PC의 IP 주소 임대를 다시 받아 보세요.']
    :cause==='phishing-attachment'
      ?['첨부파일을 실행하지 말고 메일 발신자와 파일의 실제 확장자를 확인하세요.','파일을 내려받지 않고 분석한 근거로 보안 신고 후 격리하세요.']
      :null;
  const message=(alt?alt[previous]:HINTS[hintIndex]?.[previous]||'실제 점검 기록과 네트워크 설정을 비교하세요.').replace('3번 포트',`${port}번 포트`);
  return {success:true,message,used,penalty:DIFFICULTIES[difficultyForCase(state,index)].hintPenalty};
}
export function getRunSummary(state){
  if(isContinuousRun(state)){
    const stats=state.run.stats;
    return {mode:'random',difficulty:difficultyLabel(state),completed:stats.total,
      average:stats.total?Math.round(stats.scoreSum/stats.total):null};
  }
  const scores=Object.values(state.run?.evaluations||{}).filter(x=>x && Number.isInteger(x.total) && x.total>=0 && x.total<=100);
  return {mode:runMode(state),difficulty:difficultyLabel(state),completed:scores.length,
    average:scores.length?Math.round(scores.reduce((sum,s)=>sum+s.total,0)/scores.length):null};
}
// diagnostic=true: 복구 전후에 반복하는 증상 확인. 미완료 상태도 감점하지 않습니다.
// 기본 호출은 기존 테스트/시나리오와 호환되며, 어려움 모드 UI만 최종 평가를 별도 버튼으로 제출합니다.
export function verify(state,source='network',{diagnostic=false}={}) {
  const hardMode=runMode(state)==='random'&&difficultyForCase(state)==='hard';
  const finalSubmission=hardMode&&!diagnostic;
  const failed=(message)=>{
    const penalized=countFailedVerification(state,{diagnostic});
    record(state,penalized?'최종 평가 제출 실패':'진단 검사: 추가 조치 필요');
    return {success:false,completed:false,message:message.replace(/^검증 실패:/,'점검 결과:')};
  };
  if(!ensureInvestigation(state))return failed('먼저 직원과 대화해 주세요.');
  const cause=state.incident.rootCause;
  if(MAIL_CAUSES.includes(cause)||cause==='anomalous-login'){
    record(state,finalSubmission?'보안 대응 최종 평가 제출':'보안 대응 상태 점검');
    const secure=state.incident.security;
    const ready=MAIL_CAUSES.includes(cause)?(secure.indicatorsReviewed&&secure.reported&&secure.quarantined):(secure.suspiciousSelected&&secure.sessionRevoked&&secure.accountSecured&&(!secure.normalSessionInterrupted||secure.normalSessionRecovered));
    if(!ready)return failed(MAIL_CAUSES.includes(cause)?'의심 메일의 근거 확인·신고·격리를 모두 완료하세요.':secure.normalSessionInterrupted&&!secure.normalSessionRecovered?'정상 업무 세션이 중단돼 있습니다. 재인증 복구도 완료하세요.':'의심 접속 식별·세션 종료·계정 보호가 필요합니다.');
    if(source!=='security')return failed('보안 콘솔의 대응 결과 검사로 확인해 주세요.');
    if(hardMode&&diagnostic)return {success:true,completed:false,message:'검사 성공! 대응 조치가 정상입니다. 「최종 평가 제출」로 사건을 완료하세요.'};
    state.incident.verified=true;state.incident.status='resolved';
    if(!state.completedIds.includes(state.incident.id))state.completedIds.push(state.incident.id);
    note(state,'securityVerified');finishEvaluation(state);return {success:true,completed:true,message:'보안 사고의 대응 항목을 모두 확인했습니다.'};
  }
  record(state,finalSubmission?'네트워크 최종 평가 제출':'네트워크 연결 상태 점검');
  const n=getNetworkSnapshot(state);
  if(!n.connected)return failed('이더넷 링크가 끊겨 있습니다. 케이블과 스위치 포트를 확인하세요.');
  if(!n.hasIp)return failed('정상 IPv4 주소가 없습니다. DHCP와 주소 할당 상태를 확인하세요.');
  if(n.ipConflict)return failed('IP 주소 충돌이 발생했습니다. 해당 PC의 IPv4 설정을 확인하세요.');
  if(!n.gatewayGood)return failed('기본 게이트웨이 설정이 잘못되어 있습니다.');
  if(!n.portalAllowed)return failed('사내 포털 접근을 차단하는 방화벽 규칙이 남아 있습니다.');
  if(!n.dnsGood)return failed('도메인 이름 해석에 문제가 있습니다. DNS 설정을 확인하세요.');
  if(!n.serviceRunning)return failed('사내 웹 서비스가 중지되어 있습니다. 서버 상태를 확인하세요.');
  if(cause==='web-service-stopped'&&source!=='browser')return failed('이 사건은 웹 브라우저에서 사이트 접속 검사까지 완료해야 합니다.');
  if(hardMode&&diagnostic)return {success:true,completed:false,message:'검사 성공! 통신 정상입니다. 「최종 평가 제출」로 사건을 완료하세요.'};
  state.incident.verified=true;state.incident.status='resolved';
  if(!state.completedIds.includes(state.incident.id))state.completedIds.push(state.incident.id);
  note(state,'tested');finishEvaluation(state);
  return {success:true,completed:true,message:'통신 정상! 모든 네트워크 검증을 통과했습니다.'};
}
export function getProgress(state,index=state.scenarioIndex) {
  const i=state.incidents[index];
  const scenario=SCENARIOS[index];
  const investigateHint=isContinuousRun(state)&&index<4
    ?'케이블·IP 주소·DNS·스위치·DHCP 서버 상태를 비교해 원인을 찾아보세요.'
    :[
    'PC에서 먼저 네트워크 연결 상태를 확인해 보세요.',
    '이사원 PC의 IPv4 주소를 확인하고 서버실 DHCP 상태를 조사하세요.',
    '박과장 PC에서 주소와 DNS 설정을 확인하세요.',
    '최주임 PC의 연결 상태와 서버실 스위치 포트를 확인하세요.',
    '정사원 PC의 웹 접속 결과와 서버실 웹 서비스 상태를 확인하세요.',
    '한사원 PC의 가상 메일함에서 발신자와 링크를 확인하세요.',
    '송대리 PC의 보안 콘솔에서 로그인 기록을 확인하세요.',
  ][index];
  const steps={
    new:[0,'접수 대기 중',`${scenario.department} ${scenario.npcName}에게 가서 상황을 들어보세요.`],
    accepted:[1,'사건 접수 완료',`해당 직원 PC를 열어 ${index>=5?'보안 증거':'네트워크 상태'}를 확인하세요.`],
    investigating:[2,'조사 진행 중',investigateHint],
    action_taken:[3,'조치 완료 · 검증 필요',`${scenario.npcName} PC에서 ${index>=5?'보안 조치 결과':'정상화'}를 검증하세요.`],
    resolved:[4,'사건 해결 완료',`${scenario.npcName} PC의 문제를 해결하고 정상화 검증을 마쳤습니다.`],
  };
  const [step,label,initialHint]=steps[i.status]||steps.new;
  const difficulty=difficultyForCase(state,index);
  const hiddenHint=step===2 || step===3;
  const hint=runMode(state)==='random' && hiddenHint && difficulty!=='easy'
    ? difficulty==='hard'?'증거를 수집하고 조치 후 정상화 여부를 검증하세요.':'PC·장비·로그를 조사하세요. 필요하면 사건 카드에서 힌트를 볼 수 있어요.'
    : initialHint;
  // PC 본체/네트워크를 실제 조사한 경우에만 다음 진단 방향을 보여줍니다.
  const observed=observedDiagnosticNextStep(i);
  const verifiedNext=step===2 && i.evidence.includes('pcPortChecked') && i.cableConnected &&
    ['switch','dhcp','dns','other'].includes(observed.kind);
  const preciseHint=verifiedNext
    ?(difficulty==='hard'?'LAN 케이블 연결은 정상입니다. 기록된 링크·주소·장비 상태를 비교해 원인을 찾으세요.':observed.description)
    :hint;
  // 쉬움은 이미 관찰한 사실을 따라 다음 조사를 제안합니다. 보통·어려움의 기존 정보 제한은 유지합니다.
  const guidedHint=runMode(state)==='random'&&difficulty==='easy'&&(step===2||step===3)
    ?getDiagnosticCoach(i,difficulty,index).focus:preciseHint;
  return {step,label,hint:guidedHint};
}
function validIncident(i,index,allowRandom=false,expanded=false) {
  const expected=allowRandom&&index<4?(expanded?EXPANDED_NETWORK_CAUSE_POOL:NETWORK_CAUSE_POOL):allowRandom&&index===5?MAIL_CAUSES:[SCENARIOS[index].cause];
  return !!i && i.id===SCENARIOS[index].id && expected.includes(i.rootCause) &&
    ['new','accepted','investigating','action_taken','resolved'].includes(i.status) &&
    ['cableConnected','dhcpRunning','leaseRenewed','verified'].every(k=>typeof i[k]==='boolean') &&
    typeof i.dnsServer==='string' && Array.isArray(i.evidence) && Array.isArray(i.actions);
}
function restoredIncident(old,index,allowRandom=false,expanded=false) {
  const allowed=allowRandom&&index<4?(expanded?EXPANDED_NETWORK_CAUSE_POOL:NETWORK_CAUSE_POOL):allowRandom&&index===5?MAIL_CAUSES:[SCENARIOS[index].cause];
  const cause=allowed.includes(old.rootCause)?old.rootCause:SCENARIOS[index].cause;
  const variant=old.presentationVariant;
  const safeVariant=Number.isInteger(variant)&&variant>=0&&variant<INCIDENT_VARIANT_COUNT?variant:null;
  const incident={...incidentFor(index,cause),...old,security:{...incidentFor(index,cause).security,...(old.security||{})},
    id:SCENARIOS[index].id,rootCause:cause,
    npcId:SCENARIOS[index].npcId,pcId:SCENARIOS[index].pcId,
    evidence:[...old.evidence],actions:[...old.actions]};
  const defaults=incidentFor(index,cause).pcConfig;
  const settings=old.pcConfig;
  incident.pcConfig=settings&&typeof settings==='object'&&
    ['static','dhcp'].includes(settings.addressMode)&&
    (settings.staticIp===null||isVirtualIPv4(settings.staticIp))&&
    isVirtualIPv4(settings.gateway)&&typeof settings.portalBlockRule==='boolean'
    ?{addressMode:settings.addressMode,staticIp:settings.staticIp,gateway:settings.gateway,portalBlockRule:settings.portalBlockRule}
    :defaults;
  incident.pcWorkHistory=Array.isArray(old.pcWorkHistory)?old.pcWorkHistory.slice(-40).filter(row=>
    row&&['dns','gateway','ipv4','dhcp','portal-rule'].includes(row.field)&&
    ['추가 장애 발생','통신 복구','장애 일부 복구','네트워크 상태 변경','변경 후 상태 유지'].includes(row.impact)&&
    ['label','previous','next'].every(key=>typeof row[key]==='string'&&row[key].length<=120))
    .map(row=>({field:row.field,label:row.label,previous:row.previous,next:row.next,impact:row.impact})):[];
  if(safeVariant===null)delete incident.presentationVariant;
  else incident.presentationVariant=safeVariant;
  return incident;
}
function validPosition(player) {
  return isValidSavedPosition(player);
}
export function safeLoad(jsonString) {
  try {
    if(!jsonString)return newGame();
    const old=JSON.parse(jsonString);
    const next=newGame({mode:old?.schemaVersion===6&&old?.run?.mode==='tutorial'?'tutorial':'story'});
    if([6,5,4].includes(old?.schemaVersion)) {
      const legacy=old.schemaVersion===4;
      const expected=legacy?3:old.schemaVersion===5?5:SCENARIOS.length;
      if(!Number.isInteger(old.scenarioIndex) || old.scenarioIndex<0 || old.scenarioIndex>=expected ||
        !Array.isArray(old.incidents) || old.incidents.length!==expected ||
        !old.incidents.every((incident,index)=>validIncident(incident,index,
          old.schemaVersion===6&&old.run?.mode==='random'&&old.run?.continuous===true,
          old.run?.pcExpanded===true)) ||
        // 연속 업무는 원인 4종이 직원별로 중복 없이 할당돼야 합니다.
        (old.schemaVersion===6&&old.run?.mode==='random'&&old.run?.continuous===true&&
          new Set(old.incidents.slice(0,4).map(i=>i.rootCause)).size!==4) ||
        !Array.isArray(old.activeIds) || old.activeIds.some(id=>!SCENARIOS.some(s=>s.id===id)) ||
        new Set(old.activeIds).size!==old.activeIds.length) return newGame();
      next.incidents=SCENARIOS.map((_,index)=>index<expected?restoredIncident(old.incidents[index],index,
        old.schemaVersion===6&&old.run?.mode==='random'&&old.run?.continuous===true,
        old.run?.pcExpanded===true):incidentFor(index));
      next.activeIds=[...old.activeIds];
      if(old.schemaVersion===6 && old.run && ['story','random','tutorial'].includes(old.run.mode) &&
        DIFFICULTIES[old.run.difficulty] && validOrder(old.run.order,old.run.mode)) {
        const isPlainMap=value=>value && typeof value==='object' && !Array.isArray(value);
        const modern=old.run.scoringVersion===2;
        const previousFailures=isPlainMap(old.run.failures)?{...old.run.failures}:{};
        const previousDiagnostics=isPlainMap(old.run.diagnostics)?{...old.run.diagnostics}:{};
        // v0.9의 검증 실패는 일반 진단이므로 감점을 소급 취소합니다.
        if(!modern)for(const [id,value] of Object.entries(previousFailures)){
          const count=Number.isInteger(value)&&value>0?value:0;
          previousDiagnostics[id]=(previousDiagnostics[id]||0)+count;
        }
        const loadedCaseDifficulties=isPlainMap(old.run.caseDifficulties)?Object.fromEntries(
          Object.entries(old.run.caseDifficulties).filter(([id,difficulty])=>SCENARIOS.some(s=>s.id===id)&&DIFFICULTIES[difficulty])):{};
        // v0.9.9.16에서는 근무 전체의 난이도가 고정되어 있었으므로 당시 활성 사건을 안전하게 복원할 수 있습니다.
        for(const id of next.activeIds)if(!loadedCaseDifficulties[id])loadedCaseDifficulties[id]=old.run.difficulty;
        next.run={mode:old.run.mode,difficulty:old.run.difficulty,order:[...old.run.order],
          caseDifficulties:loadedCaseDifficulties,
          hints:isPlainMap(old.run.hints)?{...old.run.hints}:{},
          failures:modern?previousFailures:{}, diagnostics:previousDiagnostics,
          evaluations:modern&&isPlainMap(old.run.evaluations)?{...old.run.evaluations}:{},
          scoringVersion:2,
          ...(old.run.mode==='tutorial'?{dnsTutorialStep:Number.isInteger(old.run.dnsTutorialStep)&&old.run.dnsTutorialStep>=1&&old.run.dnsTutorialStep<=10
            ?old.run.dnsTutorialStep:old.incidents[2]?.evidence?.includes('dnsRestored')?10:1}:{}),
          ...(old.run.mode==='random'&&old.run.continuous===true?{pcExpanded:old.run.pcExpanded===true}:{})};
        if(old.run.mode==='random'&&old.run.continuous===true){
          next.run.continuous=true;
          next.run.round=Number.isInteger(old.run.round)&&old.run.round>0&&old.run.round<1000000?old.run.round:1;
          next.run.stats=restoreContinuousStats(old.run.stats);
        }
        // 이전 평가의 검증 실패 감점만 환급하고 힌트 감점은 유지합니다.
        // 점수는 아래에서 incident를 복원한 뒤 기존 증거로 다시 계산됩니다.
      }
      if(!legacy){
        const infra=old.infrastructure;
        if(!infra || typeof infra.webServiceRunning!=='boolean' || !infra.switchPorts ||
          ![1,2,3,4,5,6,7,8].every(port=>typeof infra.switchPorts[port]==='boolean'))return newGame();
        next.infrastructure={switchPorts:{...infra.switchPorts},webServiceRunning:infra.webServiceRunning};
      }
      next.completedIds=SCENARIOS.filter((_,i)=>next.incidents[i].status==='resolved').map(s=>s.id);
      if(old.schemaVersion===6 && old.run && old.run.scoringVersion!==2){
        for(const id of next.completedIds){
          const index=SCENARIOS.findIndex(s=>s.id===id);
          next.run.evaluations[id]=getCaseScore(next,index);
        }
      }
      next.scenarioIndex=old.scenarioIndex;
      next.player=validPosition(old.player)?{x:old.player.x,y:0,z:old.player.z}:{...START_POSITION};
      const activeLimit=isTutorial(next)||runMode(next)==='random'&&next.run.difficulty==='easy'?1:2;
      // 난이도를 쉬움으로 내린 뒤에도 이전에 접수된 두 사건을 강제로 닫지 않습니다.
      while(activeCaseIndices(next).length<activeLimit && next.completedIds.length>0 && activatePending(next)){}
      if(!npcHasActiveIncident(next,SCENARIOS[next.scenarioIndex].npcId))focusNextActive(next);
      // 저장된 기록에서 모든 사건이 완료된 경우 마지막 사건을 볼 수 있게 유지
      return bindCurrent(next);
    }
    if(old?.schemaVersion===3) {
      if(!Number.isInteger(old.scenarioIndex) || old.scenarioIndex<0 || old.scenarioIndex>=3 ||
         !Array.isArray(old.incidents) || old.incidents.length!==3 ||
         !old.incidents.every((incident,index)=>validIncident(incident,index)))return newGame();
      next.incidents=SCENARIOS.map((_,index)=>index<3?restoredIncident(old.incidents[index],index):incidentFor(index));
      next.completedIds=SCENARIOS.filter((_,i)=>next.incidents[i].status==='resolved').map(s=>s.id);
      next.activeIds=SCENARIOS.filter((s,i)=>next.incidents[i].status==='resolved' || i<=old.scenarioIndex).map(s=>s.id);
      // 기존 진행 중인 사건은 활성 상태로 보존하고 남은 슬롯을 채웁니다.
      while(activeCaseIndices(next).length<2 && activatePending(next)){}
      next.scenarioIndex=old.scenarioIndex;
      next.player=validPosition(old.player)?{x:old.player.x,y:0,z:old.player.z}:{...START_POSITION};
      if(!npcHasActiveIncident(next,SCENARIOS[next.scenarioIndex].npcId))focusNextActive(next);
      return bindCurrent(next);
    }
    if(old?.schemaVersion===1 && old.incident?.id==='INC-001' && old.incident?.rootCause==='cable-unplugged' &&
      ['new','accepted','investigating','action_taken','resolved'].includes(old.incident.status) &&
      typeof old.incident.cableConnected==='boolean' && typeof old.incident.verified==='boolean' &&
      Array.isArray(old.incident.evidence) && Array.isArray(old.incident.actions)) {
      next.incidents[0]=restoredIncident({...old.incident,dhcpRunning:true,leaseRenewed:true,dnsServer:GOOD_DNS},0);
      next.completedIds=old.incident.status==='resolved'?['INC-001']:[];
      if(old.incident.status==='resolved') {activatePending(next);focusNextActive(next);}
      return bindCurrent(next);
    }
    if(old?.schemaVersion===2 && Number.isInteger(old.scenarioIndex) && old.scenarioIndex>=0 &&
       old.scenarioIndex<3 && validIncident(old.incident,old.scenarioIndex)) {
      for(let index=0;index<old.scenarioIndex;index++) {
        const done=incidentFor(index);done.status='resolved';done.verified=true;done.cableConnected=true;
        done.dhcpRunning=true;done.leaseRenewed=true;done.dnsServer=GOOD_DNS;
        next.incidents[index]=done;
      }
      next.incidents[old.scenarioIndex]=restoredIncident(old.incident,old.scenarioIndex);
      next.completedIds=SCENARIOS.filter((_,i)=>next.incidents[i].status==='resolved').map(s=>s.id);
      next.activeIds=SCENARIOS.filter((s,i)=>i<=old.scenarioIndex).map(s=>s.id);
      while(activeCaseIndices(next).length<2 && activatePending(next)){}
      next.scenarioIndex=old.scenarioIndex;
      if(!npcHasActiveIncident(next,SCENARIOS[next.scenarioIndex].npcId))focusNextActive(next);
      return bindCurrent(next);
    }
    return newGame();
  }catch{return newGame();}
}
