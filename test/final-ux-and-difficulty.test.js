import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newGame,safeLoad,talk,inspectAdapter,inspectCable,reconnectCable,verify,activatePending,restoreDns,selectIncident} from '../src/game/logic.js';
import {getContextualHelp} from '../src/game/contextual-help.js';
import {advanceDnsTutorial} from '../src/game/dns-tutorial.js';
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const main=source('../src/main.js');
const css=source('../src/style.css');
const html=source('../index.html');

test('튜토리얼 도움말은 첫 단계에서 정답을 미리 공개하지 않는다',()=>{
  const state=newGame({mode:'tutorial'});
  const data=getContextualHelp(state);
  assert.equal(data.tutorial,true);
  assert.equal(data.levels.length,3);
  assert.match(data.levels[0],/들어보세요/);
  assert.doesNotMatch(data.levels.join(' '),/랜선이 빠|케이블 분리|DNS가 잘못/);
});
test('튜토리얼 단계는 실제 조사 기록에 따라 다르게 안내한다',()=>{
  const state=newGame({mode:'tutorial'});
  talk(state);
  assert.match(getContextualHelp(state).title,/네트워크 연결/);
  inspectAdapter(state);
  assert.match(getContextualHelp(state).title,/본체/);
  assert.match(getContextualHelp(state).levels[2],/PC 닫기/);
  inspectCable(state);reconnectCable(state);
  assert.match(getContextualHelp(state).title,/복구 여부/);
  verify(state,'network');activatePending(state);
  selectIncident(state,'park');
  assert.match(getContextualHelp(state).title,/관리팀/);
  advanceDnsTutorial(state,'department-arrived',{department:'business'});
  advanceDnsTutorial(state,'employee-near',{near:true});talk(state);
  advanceDnsTutorial(state,'dialogue-closed',{introHeard:true});
  advanceDnsTutorial(state,'monitor-opened');
  assert.match(getContextualHelp(state).title,/사이트/);
  advanceDnsTutorial(state,'browser-failed',{failed:true});
  inspectAdapter(state);advanceDnsTutorial(state,'network-opened');
  assert.match(getContextualHelp(state).title,/IP 통신/);
  const restored=safeLoad(JSON.stringify(state));
  assert.deepEqual(getContextualHelp(restored),getContextualHelp(state));
});
test('랜덤 모드는 사건 원인을 사전 공개하지 않고 힌트 사용은 별도 판단을 유지한다',()=>{
  const state=newGame({mode:'random',continuous:true,difficulty:'hard',random:()=>0.777});
  const prev=JSON.stringify(state);
  const data=getContextualHelp(state);
  assert.equal(data.tutorial,false);
  assert.equal(data.levels.length,1);
  assert.doesNotMatch(data.levels[0],/랜선 분리|DHCP 서비스 중단|스위치 포트 비활성/);
  assert.equal(JSON.stringify(state),prev);
});
test('난이도 카드 3개 중 하나 선택 후 시작하기 하나로 진행한다',()=>{
  const difficulty=main.slice(main.indexOf('function showDifficultyChoice(){'),main.indexOf('function showModeMenu(){'));
  assert.match(difficulty,/DIFFICULTY_OPTIONS\.map/);
  assert.match(difficulty,/type=\"radio\" name=\"difficulty-option\"/);
  assert.match(difficulty,/label:'시작하기',primary:true,onClick:\(\)=>confirmNewRandom\(selectedDifficulty\)/);
  assert.match(main,/selectedDifficulty=event\.target\.value/);
  assert.doesNotMatch(difficulty,/label:'쉬움 시작'|label:'보통 시작'|label:'어려움 시작'/);
  assert.doesNotMatch(difficulty,/label:'기존 업무 이어하기'|label:'이전 업무 이어하기'/);
  assert.match(difficulty,/새 게임 · 난이도 선택/);
  assert.match(main,/id='btn-resume-work'|btn-resume-work/);
  assert.match(main,/기존 랜덤 업무 기록을 덮어쓸까요/);
  assert.match(css,/difficulty-option:has\(input:checked\)/);
});
test('담당 PC 위치는 시간 만료가 아니라 목적지 도착 또는 사건 변경으로 종료한다',()=>{
  assert.match(main,/focusUntil:now\+SPOTLIGHT_FOCUS_MS/);
  assert.doesNotMatch(main,/SPOTLIGHT_LABEL_MS|highlightedDevice\.hideAt/);
  assert.match(main,/world\.player\.position\.distanceTo\(nearby\.position\)<=nearby\.radius/);
  assert.match(main,/incident\.status==='resolved'\|\|state\.scenarioIndex!==highlightedDevice\.index/);
  assert.match(main,/if\(manualMove&&highlightedDevice&&!findFocusUntil\)highlightedDevice\.focusUntil=0/);
});
test('메뉴 버전과 랜덤 장애 원인 설명을 최신화한다',()=>{
  assert.match(html,/GOCHYEORA · v1\.9\.4\.1/);
  assert.match(main,/const GAME_VERSION = 'v1\.9\.4\.1'/);
  assert.match(main,/showModal\(`고쳐라! · \$\{GAME_VERSION\}`/);
  assert.match(main,/네트워크 장애 원인과 사건 순서가 라운드마다 달라져요/);
  assert.doesNotMatch(main,/7종류의 사건이 순서만 바뀌며 계속 반복/);
});
