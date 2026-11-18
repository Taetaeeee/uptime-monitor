/**
 * 상황별 도움말: 실제 장애의 정답을 미리 공개하지 않고 다음 조사 행동을 안내합니다.
 * 단순 조회이며 진행 상태, 평가 점수, 저장 데이터는 변경하지 않습니다.
 */
import {isTutorial, casePresentation, getProgress, SCENARIOS, difficultyForCase} from './logic.js';
import {getTutorialGoal} from './onboarding.js';
import {getDiagnosticCoach} from './diagnostic-coach.js';

export function getContextualHelp(state,index=state?.scenarioIndex){
  const incident=state?.incidents?.[index];
  const scenario=SCENARIOS[index];
  if(!incident||!scenario||!state.activeIds?.includes(incident.id)||incident.status==='resolved'){
    return {available:false,title:'도움말',levels:['현재 진행 중인 사건이 없어요. 왼쪽 업무 목록 또는 게임 메뉴를 확인해 보세요.'],tutorial:false};
  }
  const employee=casePresentation(state,index)?.npcName||scenario.npcName;
  if(isTutorial(state)){
    const goal=getTutorialGoal(state,index);
    if(!goal)return {available:false,title:'튜토리얼 도움말',levels:[],tutorial:true};
    const navigation=goal.kind==='department'?'왼쪽의 [관리팀 이동 지도 열기]를 누르고 영업·관리팀을 선택하세요.':goal.kind==='find-park'?'왼쪽 [박과장 위치 표시]를 누른 후 직접 가까이 걸어가세요.':goal.kind==='talk'
      ? `${employee}에게 먼저 말을 걸어 보세요. 왼쪽의 [${employee}와 대화하기] 버튼을 눌러도 됩니다.`
      : goal.kind==='tower'
        ? `왼쪽 [PC 본체 위치 보기]를 눌러 ${employee} PC의 본체를 찾아가세요.`
        : `왼쪽 [${employee} PC 위치 보기]를 눌러 PC 위치를 확인할 수 있어요.`;
    const specific=index===0?{
      1:'처음에는 직원의 증상과 발생 시점을 듣는 것이 중요해요. 대화창에서 질문도 눌러 보세요.',
      2:'PC를 열고 [네트워크 설정]에서 이더넷 연결 상태를 확인하세요.',
      3:'PC 창의 [PC 닫기]로 사무실로 나온 뒤 본체 근처에서 R을 누르거나, F로 바로 본체를 점검하세요.',
      4:'본체 뒷면의 LAN 포트 상태를 확인했다면 직접 연결 조치를 선택할 수 있어요.',
      5:'연결만 하는 것으로 끝나지 않아요. PC 네트워크 설정에서 [연결 상태 검사]를 해보세요.',
    }:{
      1:'영업·관리팀 이름표 또는 빠른 이동 지도에서 관리팀으로 이동하세요.',
      2:'위치 표시를 따라 박과장 가까이 걸어가야 대화할 수 있어요.',
      3:'박과장과 R로 대화하고 증상을 읽은 뒤 닫으세요.',
      4:'박과장 책상에서 PC 모니터를 열어보세요.',
      5:'웹 브라우저에서 페이지 접속 검사로 실패를 먼저 확인하세요.',
      6:'네트워크 설정에서 IPv4·게이트웨이·DNS 서버 항목을 관찰하세요.',
      7:'명령 프롬프트에 ping 8.8.8.8을 입력하여 IP 통신을 점검하세요.',
      8:'nslookup portal.example.test로 도메인 이름 해석 실패를 확인하세요.',
      9:'네트워크 설정에서 DNS 주소 수정 버튼으로 복구하세요.',
      10:'웹 브라우저에서 페이지 접속 검사를 다시 실행하세요.',
    };
    return {available:true,tutorial:true,title:goal.title,employee,goal,levels:[
      `${goal.description}`,
      navigation,
      specific[goal.step]||'현재 목표의 조사를 마친 뒤 정상화 여부를 확인하세요.',
    ]};
  }
  const status=incident.status;
  const family=index>=5?'security':'network';
  const first=status==='new'
    ? `${employee}의 신고가 접수 대기 중이에요. 왼쪽 사건 카드에서 [${employee}와 대화하기]를 눌러 증상을 들어보세요.`
    : status==='action_taken'
      ? `${employee}의 조치가 끝났어요. 담당 PC에서 정상화 검증을 진행해 보세요.`
      : `${employee}의 PC를 먼저 조사해 보세요. 왼쪽 사건 카드에서 PC 위치를 확인할 수 있어요.`;
  return {available:true,tutorial:false,title:getProgress(state,index).label,employee,
    levels:[first],family,coach:getDiagnosticCoach(incident,difficultyForCase(state,index),index)};
}
