import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newGame,selectIncident,talk,inspectAdapter,inspectCable,reconnectCable,verify,activatePending,
  getNetworkSnapshot,restoreDns,safeLoad} from '../src/game/logic.js';
import {executeTerminalCommand} from '../src/game/terminal.js';
import {getTutorialGoal} from '../src/game/onboarding.js';
import {getContextualHelp} from '../src/game/contextual-help.js';
import {renderDesktop,renderNetwork,renderBrowser,renderTerminal} from '../src/ui/pc-ui.js';
import {renderPcNavigation} from '../src/ui/pc-navigation-ui.js';
import {isDnsTutorialActive,getDnsTutorialStep,DNS_TUTORIAL_STEPS,advanceDnsTutorial,canDnsTutorialPerform,
  dnsTutorialCommandAllowed} from '../src/game/dns-tutorial.js';
const source=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');
const main=source('../src/main.js');
const stylesheet=source('../src/style.css');

function parkTutorial(){
  const state=newGame({mode:'tutorial'});
  talk(state,'intro'); inspectAdapter(state);inspectCable(state);reconnectCable(state);
  assert.equal(verify(state,'network').success,true);
  activatePending(state);selectIncident(state,'park');
  return state;
}
const events=[
  ['department-arrived',{department:'business'}],
  ['employee-near',{near:true}],
  ['dialogue-closed',{introHeard:true}],
  ['monitor-opened',{}],
  ['browser-failed',{failed:true}],
  ['network-opened',{}],
  ['ping-success',{command:'ping 8.8.8.8',reply:true}],
  ['dns-timeout',{command:'nslookup portal.example.test',timedOut:true}],
  ['dns-restored',{good:true}],
];
function advanceTo(state,step){
  for(let n=getDnsTutorialStep(state);n<step;n++){
    const [event,details]=events[n-1];assert.equal(advanceDnsTutorial(state,event,details),true);
  }
  return state;
}

test('박과장 10단계는 첫 사건이 완료된 후에만 활성화된다',()=>{
  const first=newGame({mode:'tutorial'});
  assert.equal(isDnsTutorialActive(first),false);
  const state=parkTutorial();
  assert.equal(isDnsTutorialActive(state),true);
  assert.equal(getDnsTutorialStep(state),1);
  assert.equal(DNS_TUTORIAL_STEPS.length,10);
  assert.deepEqual([...new Set(DNS_TUTORIAL_STEPS.map(item=>item.id))].length,10);
  assert.match(getTutorialGoal(state,2).description,/영업·관리팀/);
  assert.doesNotMatch(getTutorialGoal(state,2).description,/192\.168\.10\.10/);
});

test('실제 이벤트만 단계 진행: 부서·거리·대화·검사·명령 결과·복구 조건 검증',()=>{
  const state=parkTutorial();
  assert.equal(advanceDnsTutorial(state,'department-arrived',{department:'development'}),false);
  assert.equal(advanceDnsTutorial(state,'dialogue-closed',{introHeard:true}),false);
  assert.equal(advanceDnsTutorial(state,'department-arrived',{department:'business'}),true);
  assert.equal(advanceDnsTutorial(state,'employee-near',{near:false}),false);
  assert.equal(advanceDnsTutorial(state,'employee-near',{near:true}),true);
  assert.equal(advanceDnsTutorial(state,'dialogue-closed',{introHeard:false}),false);
  talk(state,'intro');
  assert.equal(advanceDnsTutorial(state,'dialogue-closed',{introHeard:true}),true);
  assert.equal(advanceDnsTutorial(state,'monitor-opened'),true);
  assert.equal(advanceDnsTutorial(state,'browser-failed',{failed:false}),false);
  assert.equal(advanceDnsTutorial(state,'browser-failed',{failed:true}),true);
  assert.equal(advanceDnsTutorial(state,'network-opened'),true);
  assert.equal(advanceDnsTutorial(state,'ping-success',{command:'ping portal.example.test',reply:true}),false);
  assert.equal(advanceDnsTutorial(state,'ping-success',{command:'ping 8.8.8.8',reply:false}),false);
  assert.equal(dnsTutorialCommandAllowed(state,'netsh interface set interface name="Ethernet 0" admin=disabled'),false);
  assert.equal(dnsTutorialCommandAllowed(state,' PING  8.8.8.8 '),true);
  const ping=executeTerminalCommand(state,'ping 8.8.8.8');
  assert.match(ping.output,/Reply from 8\.8\.8\.8/);
  assert.match(ping.output,/Lost = 0/);
  assert.equal(advanceDnsTutorial(state,'ping-success',{command:'ping 8.8.8.8',reply:/Lost = 0/.test(ping.output)}),true);
  assert.equal(dnsTutorialCommandAllowed(state,'ping 8.8.8.8'),false);
  assert.equal(dnsTutorialCommandAllowed(state,'nslookup portal.example.test'),true);
  const lookup=executeTerminalCommand(state,'nslookup portal.example.test');
  assert.match(lookup.output,/DNS request timed out/);
  assert.equal(advanceDnsTutorial(state,'dns-timeout',{command:'nslookup portal.example.test',timedOut:true}),true);
  assert.equal(advanceDnsTutorial(state,'dns-restored',{good:false}),false);
  assert.equal(dnsTutorialCommandAllowed(state,'netsh interface ipv4 set dnsservers name="Ethernet 0" static 192.168.10.10'),false);
  assert.equal(restoreDns(state).success,true);
  assert.equal(getNetworkSnapshot(state).dnsGood,true);
  assert.equal(advanceDnsTutorial(state,'dns-restored',{good:true}),true);
  assert.equal(canDnsTutorialPerform(state,'pc:test-browser'),true);
  assert.equal(canDnsTutorialPerform(state,'pc:test-network'),false);
  assert.equal(verify(state,'browser').success,true);
  assert.equal(getDnsTutorialStep(state),null);
});

test('단계별 버튼·우회 경로 차단: DNS 복구와 연결 상태 검사는 진단 전 금지',()=>{
  const state=parkTutorial();
  assert.equal(canDnsTutorialPerform(state,'world:business'),true);
  assert.equal(canDnsTutorialPerform(state,'world:support'),false);
  assert.equal(canDnsTutorialPerform(state,'npc:park'),false);
  advanceTo(state,2);
  assert.equal(canDnsTutorialPerform(state,'npc:park'),false);
  assert.equal(canDnsTutorialPerform(state,'move'),true);
  advanceTo(state,3);
  assert.equal(canDnsTutorialPerform(state,'npc:park'),true);
  advanceTo(state,5);
  assert.equal(canDnsTutorialPerform(state,'pc:test-browser'),true);
  assert.equal(canDnsTutorialPerform(state,'pc:fix-dns'),false);
  advanceTo(state,6);
  assert.equal(canDnsTutorialPerform(state,'pc:test-browser'),false);
  assert.equal(canDnsTutorialPerform(state,'pc:network'),true);
  advanceTo(state,7);
  assert.equal(canDnsTutorialPerform(state,'pc:network'),false);
  assert.equal(canDnsTutorialPerform(state,'pc:terminal'),true);
  advanceTo(state,8);
  assert.equal(canDnsTutorialPerform(state,'pc:fix-dns'),false);
  advanceTo(state,9);
  assert.equal(canDnsTutorialPerform(state,'pc:fix-dns'),true);
  assert.equal(canDnsTutorialPerform(state,'pc:test-network'),false);
  assert.equal(dnsTutorialCommandAllowed(state,'netsh interface set interface name="Ethernet 0" admin=disabled'),false);
  assert.equal(canDnsTutorialPerform(state,'system:escape'),true);
  assert.equal(canDnsTutorialPerform(state,'system:menu'),true);
});

test('중간 저장 복원과 구버전 저장 호환: 진행 단계 유지, 잘못된 단계 무시',()=>{
  const state=advanceTo(parkTutorial(),8);
  assert.equal(getDnsTutorialStep(safeLoad(JSON.stringify(state))),8);
  state.run.dnsTutorialStep=900;
  assert.equal(getDnsTutorialStep(safeLoad(JSON.stringify(state))),1);
  delete state.run.dnsTutorialStep;
  assert.equal(getDnsTutorialStep(safeLoad(JSON.stringify(state))),1);
  talk(state,'intro');
  assert.equal(restoreDns(state).success,true);
  assert.equal(getDnsTutorialStep(safeLoad(JSON.stringify(state))),10);
});

test('스토리·랜덤 모드는 제한 없음, 첫 번째 김대리 튜토리얼도 기존대로 유지',()=>{
  for(const mode of ['story','random']){
    const state=newGame({mode});
    assert.equal(canDnsTutorialPerform(state,'pc:fix-dns'),true);
    assert.equal(advanceDnsTutorial(state,'department-arrived',{department:'business'}),false);
  }
  const first=newGame({mode:'tutorial'});
  assert.equal(canDnsTutorialPerform(first,'pc:test-network'),true);
  assert.equal(getTutorialGoal(first,0).step,1);
});

test('단계별 PC 화면과 내비게이션은 지금 누를 버튼만 강조한다',()=>{
  const state=parkTutorial(),n=getNetworkSnapshot(state);
  const desktop=renderDesktop(n,'박과장','dns-wrong',{tutorial:true,lesson:2,dnsStep:7});
  assert.match(desktop,/명령 프롬프트/);
  assert.match(desktop,/app-guided/);
  const nav=renderPcNavigation('박과장','terminal','dns-wrong',{tutorial:true,dnsStep:8});
  assert.match(nav,/dns-tutorial-focus/);
  const browser=renderBrowser(n,{reachable:false},'',{tutorial:true,dnsStep:5});
  assert.match(browser,/페이지 접속 검사/);
  assert.match(browser,/dns-tutorial-focus/);
  const network=renderNetwork(n,'','박과장',{tutorial:true,dnsStep:9});
  assert.match(network,/DNS 주소 수정하기/);
  assert.match(network,/dns-tutorial-focus/);
  const terminal=renderTerminal('박과장',[],{dnsStep:8});
  assert.match(terminal,/nslookup portal\.example\.test/);
  assert.match(stylesheet,/\.dns-step-inline/);
  assert.match(stylesheet,/\.dns-tutorial-focus/);
});

test('이벤트 연결과 실제 UI 차단은 main 핸들러에도 존재한다',()=>{
  for(const phrase of ["dnsAction('department-arrived'","dnsAction('employee-near'","dnsAction('dialogue-closed'",
    "dnsAction('monitor-opened'","dnsAction('browser-failed'","dnsAction('network-opened'",
    "dnsAction('ping-success'","dnsAction('dns-timeout'","dnsAction('dns-restored'"])assert.ok(main.includes(phrase),phrase);
  assert.match(main,/dnsTutorialCommandAllowed\(state,raw\)/);
  assert.match(main,/canDnsTutorialPerform\(state,action\)/);
  assert.match(main,/function confirmDnsChange/);
  assert.match(main,/function showParkLocation/);
  assert.match(main,/renderDnsInlineGuide/);
  const help=getContextualHelp(advanceTo(parkTutorial(),8));
  assert.match(help.levels.join(' '),/nslookup/);
});
