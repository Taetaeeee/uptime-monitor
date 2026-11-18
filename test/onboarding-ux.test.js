import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newGame,safeLoad,selectIncident,talk,inspectPc,inspectAdapter,inspectCable,reconnectCable,verify,activatePending,restoreDns} from '../src/game/logic.js';
import {getTutorialGoal,renderTutorialGoal} from '../src/game/onboarding.js';
import {advanceDnsTutorial} from '../src/game/dns-tutorial.js';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const main=read('../src/main.js');
const html=read('../index.html');
const css=read('../src/style.css');

test('튜토리얼 첫 목표는 김대리와 바로 대화하기, 대화 전 원인 미공개',()=>{
  const s=newGame({mode:'tutorial'});
  assert.deepEqual(getTutorialGoal(s,0).step,1);
  assert.equal(getTutorialGoal(s,0).kind,'talk');
  assert.match(renderTutorialGoal(s,0),/김대리와 대화하기/);
  assert.doesNotMatch(renderTutorialGoal(s,0),/케이블이 빠짐|랜선이 빠짐/);
});
test('실제 조사가 기록되면 LAN 목표가 다음 단계로 자동 변한다',()=>{
  const s=newGame({mode:'tutorial'});
  selectIncident(s,'kim');talk(s);
  assert.equal(getTutorialGoal(s,0).step,2);
  inspectPc(s);inspectAdapter(s);
  assert.equal(getTutorialGoal(s,0).step,3);
  assert.equal(getTutorialGoal(s,0).kind,'tower');
  inspectCable(s);
  assert.equal(getTutorialGoal(s,0).step,4);
  assert.equal(reconnectCable(s).success,true);
  assert.equal(getTutorialGoal(s,0).step,5);
  assert.equal(verify(s,'network').success,true);
  assert.equal(getTutorialGoal(s,0),null);
});
test('DNS 튜토리얼 목표는 10단계이며 단계별 이벤트와 저장 복원을 사용한다',()=>{
  const s=newGame({mode:'tutorial'});
  selectIncident(s,'kim');talk(s);inspectAdapter(s);inspectCable(s);reconnectCable(s);verify(s,'network');
  activatePending(s);
  assert.equal(getTutorialGoal(s,2).step,1);
  selectIncident(s,'park');
  assert.equal(advanceDnsTutorial(s,'department-arrived',{department:'business'}),true);
  assert.equal(advanceDnsTutorial(s,'employee-near',{near:true}),true);
  talk(s);
  assert.equal(advanceDnsTutorial(s,'dialogue-closed',{introHeard:true}),true);
  assert.equal(advanceDnsTutorial(s,'monitor-opened'),true);
  assert.equal(getTutorialGoal(s,2).step,5);
  assert.equal(advanceDnsTutorial(s,'browser-failed',{failed:true}),true);
  inspectAdapter(s);assert.equal(advanceDnsTutorial(s,'network-opened'),true);
  assert.equal(getTutorialGoal(s,2).step,7);
  assert.equal(advanceDnsTutorial(s,'ping-success',{command:'ping 8.8.8.8',reply:true}),true);
  assert.equal(advanceDnsTutorial(s,'dns-timeout',{command:'nslookup portal.example.test',timedOut:true}),true);
  assert.equal(getTutorialGoal(safeLoad(JSON.stringify(s)),2).step,9);
  assert.equal(restoreDns(s).success,true);
  assert.equal(advanceDnsTutorial(s,'dns-restored',{good:true}),true);
  assert.equal(getTutorialGoal(s,2).step,10);
  assert.equal(verify(s,'browser').success,true);
  assert.equal(getTutorialGoal(s,2),null);
});

test('본 게임에는 튜토리얼 퀘스트를 표시하지 않는다',()=>{
  const s=newGame({mode:'random',continuous:true});
  assert.equal(getTutorialGoal(s),null);
  assert.equal(renderTutorialGoal(s),'');
});
test('사건 카드의 직접 대화와 PC 위치 보기 버튼이 연결되어 있다',()=>{
  assert.match(main,/data-case-quick/);
  assert.match(main,/data-tutorial-goal-action/);
  assert.match(main,/state\.incidents\[index\]\.status==='new'\|\|target==='talk'/);
  assert.match(main,/target==='tower'\?'tower':'pc'/);
  assert.match(main,/function guideToEmployeeDevice/);
  assert.match(main,/world\.interactables\.find\(item=>item\.id===id\)/);
  assert.match(main,/if\(manualMove&&highlightedDevice&&!findFocusUntil\)highlightedDevice\.focusUntil=0/);
  assert.match(main,/guideToEmployeeDevice\(index,'pc'\)/);
});
test('담당 PC 안내에는 머리위 느낌표 대신 눈에 보이는 3D 연동을 사용',()=>{
  assert.match(html,/id="target-spotlight"/);
  assert.match(css,/\.target-spotlight\s*\{/);
  assert.match(main,/spotlightMarker\.copy\(highlightedDevice\.position\)/);
  assert.match(main,/world\.updateVisuals\(state,elapsed,delta,overlayOpen\(\)\?null:\(highlightedDevice\?\.id\|\|closest\?\.id\),equipmentNearbyId\)/);
  assert.match(main,/왼쪽 사건 카드의 <strong>/);
});
test('튜토리얼 미접수 상태에 민감한 원인을 공개하지 않는다',()=>{
  const s=newGame({mode:'tutorial'});
  const mark=renderTutorialGoal(s,0);
  assert.doesNotMatch(mark,/192\.168|169\.254|랜선 분리|DNS 오류/);
});
