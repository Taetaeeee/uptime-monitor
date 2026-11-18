/** 박과장 DNS 장애 튜토리얼: 실제 플레이에서 발생한 이벤트만 단계로 인정합니다.
 * 저장은 기존 run 안의 작은 정수 하나로 관리하며, 첫 출근/다른 게임 모드는 건드리지 않습니다. */
export const DNS_TUTORIAL_STEPS = Object.freeze([
  {id:'department',title:'관리팀으로 이동',description:'3D 사무실의 「영업·관리팀」 이름표 또는 이동 지도에서 해당 부서를 선택하세요.',action:'관리팀 이동 지도 열기',kind:'department'},
  {id:'approach',title:'박과장 찾아가기',description:'관리팀에 도착했어요. 박과장 위치 표시를 따라 WASD로 직접 가까이 이동하세요.',action:'박과장 위치 표시',kind:'find-park'},
  {id:'talk',title:'박과장에게 증상 듣기',description:'박과장에게 가까이 가서 R로 대화하고, 증상을 읽은 뒤 대화를 닫으세요.',action:'박과장 위치 보기',kind:'find-park'},
  {id:'monitor',title:'박과장 PC 모니터 확인',description:'박과장 책상에 접근해 PC 모니터를 열어보세요. 다른 PC는 조사할 수 없어요.',action:'박과장 PC 위치 보기',kind:'pc'},
  {id:'browser-fail',title:'사이트 접속 실패 확인',description:'PC의 웹 브라우저를 열고 [페이지 접속 검사]를 눌러 현재 장애를 확인하세요.',action:'박과장 PC 위치 보기',kind:'pc'},
  {id:'network',title:'네트워크 설정 조사',description:'네트워크 설정에서 IPv4·게이트웨이·DNS 주소를 비교하세요. 아직 수정하지 마세요.',action:'박과장 PC 위치 보기',kind:'pc'},
  {id:'ping',title:'IP 통신 확인',description:'명령 프롬프트에서 ping 8.8.8.8을 직접 입력하고 Enter를 누르세요.',action:'박과장 PC 위치 보기',kind:'pc'},
  {id:'nslookup',title:'DNS 이름 해석 확인',description:'명령 프롬프트에서 nslookup portal.example.test를 입력해 DNS 응답을 확인하세요.',action:'박과장 PC 위치 보기',kind:'pc'},
  {id:'restore',title:'DNS 주소 수정',description:'이제 DNS 서버 설정을 정상 주소로 복구하세요. 네트워크 설정의 [DNS 주소 수정하기]를 사용하세요.',action:'박과장 PC 위치 보기',kind:'pc'},
  {id:'verify',title:'웹사이트 정상화 검증',description:'웹 브라우저에서 [페이지 접속 검사]를 다시 실행해 정상화됐는지 확인하세요.',action:'박과장 PC 위치 보기',kind:'pc'},
]);
const EVENTS=['department-arrived','employee-near','dialogue-closed','monitor-opened','browser-failed',
  'network-opened','ping-success','dns-timeout','dns-restored'];
export function isDnsTutorialActive(state){
  return state?.run?.mode==='tutorial' && state?.scenarioIndex===2 &&
    state?.activeIds?.includes('INC-003') && state?.incidents?.[2]?.status!=='resolved';
}
export function getDnsTutorialStep(state){
  if(!isDnsTutorialActive(state))return null;
  const step=state.run.dnsTutorialStep;
  return Number.isInteger(step)&&step>=1&&step<=10?step:1;
}
export function getDnsTutorialTask(state,index=state?.scenarioIndex){
  if(state?.run?.mode!=='tutorial'||index!==2||!state?.activeIds?.includes('INC-003')||state?.incidents?.[2]?.status==='resolved')return null;
  const step=Number.isInteger(state.run.dnsTutorialStep)&&state.run.dnsTutorialStep>=1&&state.run.dnsTutorialStep<=10?state.run.dnsTutorialStep:1;
  return {step,total:10,...DNS_TUTORIAL_STEPS[step-1]};
}
export function advanceDnsTutorial(state,event,details={}){
  const step=getDnsTutorialStep(state);
  if(!step||step>9||EVENTS[step-1]!==event)return false;
  if(step===1&&details.department!=='business')return false;
  if(step===2&&details.near!==true)return false;
  if(step===3&&details.introHeard!==true)return false;
  if(step===5&&details.failed!==true)return false;
  if(step===7&&details.command!=='ping 8.8.8.8'||step===7&&details.reply!==true)return false;
  if(step===8&&details.command!=='nslookup portal.example.test'||step===8&&details.timedOut!==true)return false;
  if(step===9&&details.good!==true)return false;
  state.run.dnsTutorialStep=step+1;
  return true;
}
const SYSTEM_ACTIONS=new Set(['system:menu','system:settings','system:restart','system:escape','system:sound','pc:close','pc:lesson-toggle','pc:lesson-close']);
const BASE_PC=['pc:park','pc:front','pc:monitor','pc:desktop','pc:close'];
const ALLOWED=Object.freeze({
  1:['world:map','world:business'],
  2:['move','camera'],
  3:['npc:park','dialogue','move','camera'],
  4:[...BASE_PC,'move','camera'],
  5:[...BASE_PC,'pc:browser','pc:test-browser','move','camera'],
  6:[...BASE_PC,'pc:browser','pc:network','move','camera'],
  7:[...BASE_PC,'pc:terminal','pc:command','pc:terminal-example','move','camera'],
  8:[...BASE_PC,'pc:terminal','pc:command','pc:terminal-example','move','camera'],
  9:[...BASE_PC,'pc:network','pc:terminal','pc:command','pc:fix-dns','move','camera'],
  10:[...BASE_PC,'pc:browser','pc:test-browser','move','camera'],
});
export function canDnsTutorialPerform(state,action){
  const step=getDnsTutorialStep(state);
  if(step===null)return true;
  return SYSTEM_ACTIONS.has(action)||(ALLOWED[step]||[]).includes(action);
}
/** 오타·다른 명령은 터미널에 안내만 표시하고 게임 상태를 바꾸지 않습니다. */
export function dnsTutorialCommandAllowed(state,raw){
  const step=getDnsTutorialStep(state);
  if(step===9||step===10)return false;
  if(step!==7&&step!==8)return true;
  const input=String(raw).trim().replace(/\s+/g,' ').toLowerCase();
  return step===7?input==='ping 8.8.8.8':input==='nslookup portal.example.test';
}
