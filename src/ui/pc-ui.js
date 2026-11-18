/**
 * 고쳐라! 가상 PC의 화면 구성. 터미널은 게임 내부의 가상 명령만 처리합니다.
 * data-pc-action만 main.js가 해석하므로 UI와 게임 상태를 분리할 수 있습니다.
 */
import {renderTerminalLearning} from './terminal-learning-ui.js';
import {renderInspectionLearning} from './inspection-learning-ui.js';

const statusPill = (ok, good, bad) => `<span class="os-pill ${ok ? 'good' : 'bad'}">${ok ? good : bad}</span>`;
const appButton = (action, symbol, label, disabled = false, guided = false) => `
  <button type="button" class="desktop-app ${disabled ? 'future' : ''}${guided ? ' app-guided' : ''}" data-pc-action="${action}">
    <span class="desktop-app-icon">${symbol}</span><span>${label}</span>
    ${disabled ? '<small>추후 지원</small>' : ''}
  </button>`;

export function renderDesktop(snapshot, employee='김대리', cause='', {tutorial=false,tutorialStep=1,lesson=0,firstDayStep=null,dnsStep=null}={}) {
  const highlightNetwork=tutorial && (firstDayStep ? ['network','verify'].includes(firstDayStep) : dnsStep? [6,9].includes(dnsStep) : (lesson===0 || (lesson===2 && tutorialStep<=3)));
  const highlightBrowser=tutorial && !firstDayStep && lesson===2 && (dnsStep?[5,10].includes(dnsStep):tutorialStep>=4);
  const highlightTerminal=tutorial && (firstDayStep==='command'||lesson===2&&[7,8].includes(dnsStep));
  return `<div class="pc-frame" aria-label="가상 PC 바탕화면">
    <div class="pc-screen os-desktop">
      <div class="os-topline"><span class="os-top-label">${employee} PC <b>·</b> 가상 데스크톱</span>${statusPill(snapshot.connected, '● 이더넷 연결됨', '● 네트워크 연결 끊김')}</div>
      <div class="desktop-icons">
        ${appButton('network', '▦', '네트워크 설정', false, highlightNetwork)}
        ${appButton('browser', '◎', '웹 브라우저', false, highlightBrowser)}
        ${appButton('terminal', '›_', '명령 프롬프트',false,highlightTerminal)}
        ${['phishing-email','phishing-attachment'].includes(cause) ? appButton('mail','✉','이메일') : ''}
        ${cause==='anomalous-login' ? appButton('security','▣','계정 보안') : ''}
      </div>
      <div class="desktop-help">${tutorial ? firstDayStep==='command'?'🎯 명령 프롬프트를 열고 ipconfig를 입력해 IP 정보를 확인해 보세요.' : firstDayStep==='verify'?'🎯 이제 네트워크 설정을 열고 연결 상태 검사를 실행해 정상화 여부를 확인하세요.' : dnsStep===7?'🎯 명령 프롬프트에서 ping 8.8.8.8을 실행하세요.':dnsStep===8?'🎯 명령 프롬프트에서 nslookup portal.example.test를 실행하세요.':dnsStep===9?'🎯 네트워크 설정에서 DNS 주소를 수정해 보세요.': highlightBrowser ? '🎯 다음 단계: 웹 브라우저를 열고 페이지 접속을 검사해 보세요.' : '🎯 먼저 네트워크 설정에서 연결 상태를 확인해 보세요.' : '아이콘을 클릭해 PC를 직접 조사해 보세요.'}</div>
      <div class="os-taskbar"><span class="os-start">▦</span><span>${employee} · 업무용 PC</span><span class="os-taskbar-right">${snapshot.connected ? '◉' : '◌'} LAN</span></div>
    </div>
  </div>
  <p class="device-context">이 화면은 실제 Windows가 아닌, 게임 속 가상 운영체제입니다.</p>`;
}

export function renderNetwork(snapshot, notice = '', employee='김대리', {finalEvaluation=false,tutorial=false,dnsStep=null,advanced=false,recoveryIssue=null,workHistory=[],learning=null,needsVerification=false,verificationCue=false}={}) {
  return `<div class="pc-frame"><div class="pc-screen os-workspace">
    <div class="window-toolbar"><span>▦　네트워크 설정</span><span class="pc-toolbar-hint">상단의 바탕화면으로 돌아갈 수 있어요</span></div>
    <div class="settings-layout">
      ${tutorial?'':`<aside class="settings-sidebar" aria-label="화면 도움말"><strong>연결 장치</strong><div class="settings-readonly">유선 네트워크</div><p class="settings-readonly-note">이곳은 메뉴가 아닌 상태 안내입니다. 오른쪽의 연결 상태와 어댑터 정보를 확인하세요.</p></aside>`}
      <div class="settings-content">
        <div class="settings-eyebrow">네트워크 및 인터넷</div>
        <h3>이더넷</h3>
        ${tutorial?`<p class="pc-step-hint">${dnsStep===6?'🎯 IPv4 주소·게이트웨이·DNS 서버를 비교하세요. 이제 명령 프롬프트에서 IP 통신을 검사해요.':dnsStep===7?'🎯 설정을 확인했어요. 명령 프롬프트로 이동해 ping 8.8.8.8을 실행하세요.':dnsStep===9?'🎯 ping은 성공했고 nslookup은 실패했어요. 이제 DNS 주소를 수정하세요.':dnsStep===10?'🎯 DNS 변경 완료! 웹 브라우저에서 접속 검사로 마무리하세요.':'🎯 연결 상태를 확인하고, 아래에서 실제로 필요한 조치를 선택해 보세요.'}</p>`:''}
        <div class="connection-banner ${snapshot.connected ? 'connected' : 'disconnected'}"><span class="connection-icon" aria-hidden="true">${snapshot.connected
          ? '<svg viewBox="0 0 24 24" fill="none"><path d="m5.5 12.5 4.5 4.5 8.5-9" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6 18 18 M18 6 6 18" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>'}</span>
          <div><strong>${snapshot.linkLabel}</strong><small>${snapshot.internet}</small></div></div>
        <div class="adapter-spec">
          <div><span>어댑터</span><b>${snapshot.adapter}</b></div>
          <div><span>IPv4 주소</span><b>${snapshot.ipv4}</b></div>
          <div><span>서브넷 마스크</span><b>${snapshot.mask}</b></div>
          <div><span>기본 게이트웨이</span><b>${snapshot.gateway}</b></div>
          <div><span>DNS 서버</span><b>${snapshot.dns}</b></div>
        </div>
        ${renderInspectionLearning(learning)}
        <div class="network-notice-slot${notice ? ' has-notice' : ''}" role="status" aria-live="polite">
          ${notice ? `<div class="${notice.startsWith('검사 성공')?'os-inline-success':'os-inline-error'}">${notice}</div>` : ''}
        </div>
        ${advanced&&!tutorial&&recoveryIssue?`<div class="pc-recovery-shortcut" role="status"><strong>⚠ 가상 네트워크 추가 장애가 감지됐습니다. ${recoveryIssue==='adapter'?'어댑터 상태를 명령 프롬프트에서 조사하세요.':'변경한 설정과 정상값을 비교하세요.'}</strong><button type="button" data-pc-action="${recoveryIssue==='adapter'?'terminal':'open-direct-settings'}">${recoveryIssue==='adapter'?'명령 프롬프트 열기':'직접 설정 열기'}</button></div>`:''}
        ${advanced&&!tutorial?`<details class="pc-advanced-settings ${recoveryIssue?'pc-advanced-important':''}" ${recoveryIssue&&recoveryIssue!=='adapter'?'open':''}><summary>🛠 IP·DNS·방화벽 직접 설정 (가상 PC)</summary>
          <p>조사한 값과 정상 환경을 비교한 뒤 필요한 항목만 직접 변경하세요. 잘못 바꾸면 새로운 장애가 발생합니다.</p>
          <div class="pc-advanced-grid">
            <form data-employee-pc-config="dns"><label>DNS 서버<input name="value" value="${snapshot.dns}" autocomplete="off" maxlength="15" aria-label="DNS 서버 IPv4"/></label><button type="submit">DNS 적용</button></form>
            <form data-employee-pc-config="gateway"><label>기본 게이트웨이<input name="value" value="${snapshot.gateway==='—'?'':snapshot.gateway}" autocomplete="off" maxlength="15" aria-label="게이트웨이 IPv4"/></label><button type="submit">게이트웨이 적용</button></form>
            <form data-employee-pc-config="ipv4"><label>정적 IPv4<input name="value" value="${snapshot.hasIp?snapshot.ipv4:''}" autocomplete="off" maxlength="15" aria-label="정적 IPv4"/></label><button type="submit">정적 IP 적용</button></form>
            <form data-employee-pc-config="dhcp"><span>주소 할당 방식: ${snapshot.addressMode==='dhcp'?'자동 (DHCP)':'수동 (정적)'}</span><button type="submit">자동 할당으로 전환</button></form>
            <form data-employee-pc-config="portal-rule"><span>사내 포털 차단 규칙: ${snapshot.portalBlockRule?'활성 (차단)':'비활성 (허용)'}</span><button type="submit" name="value" value="${snapshot.portalBlockRule?'off':'on'}">${snapshot.portalBlockRule?'차단 규칙 해제':'차단 규칙 활성화'}</button></form>
          </div>
          <p class="pc-advanced-note">실제 PC 설정은 변경하지 않습니다. 실습용 네트워크의 192.168.10.0/24만 적용됩니다.</p>
          ${workHistory.length?`<details><summary>최근 PC 작업 기록 ${workHistory.length}건</summary><ol class="pc-work-history">${workHistory.slice(-8).map(row=>`<li>${escapeTerminal(row.label)} · ${escapeTerminal(row.previous)} → ${escapeTerminal(row.next)} (${escapeTerminal(row.impact)})</li>`).join('')}</ol></details>`:''}
        </details>`:''}
        <div class="network-controls">
          ${snapshot.canRenew ? '<button class="os-secondary" type="button" data-pc-action="renew-lease">IP 주소 다시 받기 (DHCP)</button>' : ''}
          ${snapshot.canFixDns ? `<button class="os-secondary${dnsStep===9?' dns-tutorial-focus':''}" type="button" data-pc-action="fix-dns" ${dnsStep!==null&&dnsStep!==9?'disabled title="이전 진단 단계부터 진행하세요"':''}>DNS 주소 수정하기 (설정 변경)</button>` : ''}
          <button class="os-primary${verificationCue||needsVerification?' network-verify-focus':''}" type="button" data-pc-action="test-network">연결 상태 검사</button>
          ${verificationCue||needsVerification?'<p class="network-verify-guide">조치를 적용한 뒤에는 반드시 이 버튼을 <strong>한 번 더 눌러</strong> 정상화 여부를 확인하세요. 조치만으로는 사건이 완료되지 않습니다.</p>':''}
          ${finalEvaluation?'<button class="os-final-submit" type="button" data-pc-action="final-network" title="어려움 모드 최종 평가 제출">최종 평가 제출</button>':''}
        </div>
      </div>
    </div>
    <div class="os-taskbar"><span class="pc-taskbar-location">▦ 업무용 PC</span><span>네트워크 설정</span></div>
  </div></div>`;
}

export function renderBrowser(snapshot, browserResult, notice = '', {finalEvaluation=false,tutorial=false,dnsStep=null}={}) {
  const isGood = snapshot.reachable && snapshot.internet.startsWith('검증 완료');
  return `<div class="pc-frame"><div class="pc-screen browser-window">
    <div class="browser-bar">
      <div class="browser-address"><span>🔒</span> ${snapshot.targetHost} <small>(게임 속 가상 사이트)</small></div>
      </div>
    <div class="browser-page ${snapshot.reachable ? 'online' : 'offline'}">
      <div class="browser-emblem">${snapshot.reachable ? '◎' : '☁'}</div>
      <h3>${snapshot.reachable ? '사내 포털 연결 준비됨' : '이 페이지에 연결할 수 없습니다'}</h3>
      <p>${snapshot.reachable ? '접속 가능한 상태입니다. 페이지 접속 검사로 정상화를 확인하세요.' : snapshot.networkReachable ? '네트워크 통신은 정상입니다. 사내 웹 서비스 상태를 확인해 보세요.' : 'LAN, IPv4, 게이트웨이, DNS, 방화벽 규칙을 차례대로 확인해 주세요.'}</p>
      <div class="browser-notice-slot${notice || isGood ? ' has-notice' : ''}" role="status" aria-live="polite">
        ${notice ? `<div class="${notice.startsWith('검사 성공')?'os-inline-success':'os-inline-error'}">${notice}</div>` : isGood ? '<div class="os-inline-success">✓ 인터넷 연결 확인 완료</div>' : ''}
      </div>
      ${tutorial?`<p class="pc-step-hint">${dnsStep===5?'🎯 지금은 왜 사이트가 열리지 않는지 확인할 차례예요. 접속 검사 버튼을 누르세요.':dnsStep===6?'🎯 웹 접속 실패를 확인했어요. 네트워크 설정에서 IP와 DNS를 비교해 보세요.':dnsStep===10?'🎯 DNS 주소를 수정했어요. 페이지 접속 검사를 다시 눌러 복구를 확인하세요.':'🎯 현재 상태를 확인했다면 [페이지 접속 검사]로 정상 동작을 확인해 보세요.'}</p>`:''}
      <button class="os-primary${[5,10].includes(dnsStep)?' dns-tutorial-focus':''}" type="button" data-pc-action="test-browser" ${dnsStep!==null&&![5,10].includes(dnsStep)?'disabled title="해당 단계에서 실행하세요"':''}>↻ 페이지 접속 검사</button>
      ${finalEvaluation?'<button class="os-final-submit" type="button" data-pc-action="final-browser" title="어려움 모드 최종 평가 제출">최종 평가 제출</button>':''}
    </div>
    <div class="os-taskbar"><span class="pc-taskbar-location">▦ 업무용 PC</span><span>가상 웹 브라우저</span></div>
  </div></div>`;
}

const escapeTerminal = value => String(value).replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[char]));

export function renderTerminal(employee='김대리', entries=[], {guidedInterpretation=false,dnsStep=null}={}) {
  const prompt=`C:\\Users\\${employee}>`;
  const consoleEntries=entries.slice(-32).map(entry=>{
    const kind=entry.kind==='command'?'command':'output';
    return `<div class="terminal-line ${kind}">${escapeTerminal(entry.text)}</div>`;
  }).join('');
  return `<div class="pc-frame"><div class="pc-screen os-workspace terminal-workspace">
    <div class="window-toolbar terminal-window-toolbar">
      <span class="terminal-window-title">›_　${escapeTerminal(employee)} PC · 명령 프롬프트</span>
      <div class="terminal-toolbar-actions">
        <span class="pc-toolbar-hint">명령 실행: Enter</span>
        <button type="button" class="terminal-lesson-toggle" data-terminal-lesson-toggle aria-controls="terminal-lesson-panel" aria-expanded="false" aria-label="명령어 결과 해설 열기">
          <span class="terminal-toggle-closed">${guidedInterpretation?'📘 ipconfig 해설':'📖 결과 해설'} 보기</span>
          <span class="terminal-toggle-open">✕ 해설 닫기</span>
        </button>
      </div>
    </div>
    <div class="terminal-console">
      <div class="terminal-history" id="terminal-history" role="log" aria-label="명령 프롬프트 실행 기록">
        <div class="terminal-intro">고쳐라! 네트워크 시뮬레이터 [가상 환경]<br>실제 PC에서 명령을 실행하지 않습니다. 도움말: help</div>
        ${consoleEntries}
      </div>
      <form class="terminal-form" data-terminal-form autocomplete="off">
        <label class="terminal-prompt" for="terminal-command">${escapeTerminal(prompt)}</label>
        <input id="terminal-command" name="command" type="text" inputmode="text" spellcheck="false" autocorrect="off" autocapitalize="off" maxlength="160" aria-label="가상 터미널 명령어" placeholder="명령어 입력 후 Enter" />
        <button type="submit" aria-label="명령 실행">실행 ↵</button>
      </form>
    </div>
    ${dnsStep===7||dnsStep===8?`<div class="dns-terminal-command-guide">🎯 ${dnsStep===7?'ping 8.8.8.8':'nslookup portal.example.test'} 를 입력하고 Enter를 누르세요.</div>`:dnsStep===9?'<div class="dns-terminal-command-guide">✓ DNS 응답 실패를 확인했어요. 왼쪽의 네트워크 설정으로 이동해 복구하세요.</div>':''}
    <div class="terminal-examples" aria-label="명령어 입력 예시">
      <span>입력 예시</span>
      <button type="button" data-terminal-example="ipconfig">ipconfig</button>
      <button type="button" data-terminal-example="ping 192.168.10.1">ping</button>
      <button type="button" data-terminal-example="nslookup portal.example.test">nslookup</button>
      <span class="terminal-help">↑ ↓ 명령 기록 · Enter 실행 · help에서 netsh 명령 확인</span>
    </div>
    <div class="os-taskbar"><span class="pc-taskbar-location">▦ 업무용 PC</span><span>가상 명령 프롬프트</span><span class="os-taskbar-right">로컬 시뮬레이션</span></div>
  </div>
  <section class="terminal-explainer terminal-lesson-panel${guidedInterpretation?' first-day-ipconfig-lesson':''}" id="terminal-lesson-panel" aria-label="명령어 결과 해설" hidden>
    <div class="terminal-lesson-heading">
      <strong>${guidedInterpretation?'ipconfig 결과 해설':'최근 명령어 결과 해설'}</strong>
      <button type="button" class="terminal-lesson-close" data-terminal-lesson-close aria-label="해설 닫기">✕ 닫기</button>
    </div>
    <div class="terminal-lesson-content">
      ${renderTerminalLearning(entries)}
      <small>${guidedInterpretation?'다음 단계: 왼쪽 네트워크 설정을 누른 다음 연결 상태 검사를 실행하세요.':'명령어 결과는 조사 증거이며 힌트 감점 없이 살펴볼 수 있어요.'}</small>
    </div>
  </section>
  </div>`;
}

export function renderChassis(connected, employee='김대리', {wasRepaired = false,linkUp=connected,diagnostic=null,tutorial=false} = {}) {
  const restored = connected && wasRepaired;
  const linkActive=!!connected && !!linkUp;
  const advisory = diagnostic && connected && !restored ? `<div class="rear-diagnostic" role="status"><strong>${escapeTerminal(diagnostic.title)}</strong><p>${escapeTerminal(diagnostic.description)}</p></div>`:'';
  return `<div class="rear-scene${tutorial?' tour-rear-scene':''}">
    <div class="rear-instruction"><strong>${employee} PC 본체 · 후면 점검</strong><small>포트와 케이블 상태를 직접 확인하세요. ${tutorial?'랜선을 연결했다면 먼저 명령 프롬프트에서 ipconfig를 실행하세요. 연결 상태 검사는 그다음 단계입니다.':'LAN이 끊겨 있으면 랜선을 연결한 뒤 PC 화면에서 정상화 검사를 진행합니다.'}</small></div>
    <div class="computer-case detailed-case">
      <div class="case-screw top-left"></div><div class="case-screw top-right"></div><div class="case-screw bottom-left"></div><div class="case-screw bottom-right"></div>
      <div class="case-fan"><div class="fan-core" aria-hidden="true">
        <svg class="fan-rotor" viewBox="0 0 64 64" focusable="false" aria-hidden="true">
          <g stroke="currentColor" stroke-width="3.4" stroke-linecap="round">
            <path d="M32 11V25 M32 39V53 M11 32H25 M39 32H53 M17.2 17.2L27.1 27.1 M36.9 36.9L46.8 46.8 M46.8 17.2L36.9 27.1 M27.1 36.9L17.2 46.8"/>
          </g><circle cx="32" cy="32" r="4.5" fill="currentColor"/>
        </svg>
      </div></div>
      <div class="case-io-panel">
        <div class="io-header"><span>메인보드 I/O 패널</span><small>후면 포트</small></div>
        <div class="io-grid">
          <div class="io-row"><span class="io-name">USB</span><span class="usb-slot"></span><span class="usb-slot"></span><span class="usb-slot dark"></span><span class="usb-slot dark"></span></div>
          <div class="io-row"><span class="io-name">DP</span><span class="mini-slot"></span><span class="io-name alt">HDMI</span><span class="hdmi-slot"></span></div>
          <div class="io-row"><span class="io-name">AUDIO</span><span class="audio-port green"></span><span class="audio-port pink"></span><span class="audio-port blue"></span></div>
          <div class="lan-port-block"><span class="lan-label">LAN / RJ45</span>
            <button type="button" class="lan-jack ${connected ? 'connected' : 'unplugged'} ${linkActive ? 'link-up' : 'link-down'}" data-pc-action="${connected ? 'port-info' : 'connect-cable'}"
            aria-label="${!connected ? 'LAN 케이블 분리, 링크 LED 꺼짐, 연결하기' : linkActive ? 'LAN 케이블 연결됨, 링크 LED 켜짐, 상태 확인' : 'LAN 케이블 연결됨, 링크 LED 꺼짐, 스위치 상태 확인'}">
              <span class="lan-pins">▥▥▥▥</span><span class="lan-led"></span>
            </button>
            <div class="cable-assembly ${connected ? 'attached' : 'detached'}" aria-hidden="true"><div class="cable-end">▥</div><div class="cable-wire"></div></div>
          </div>
        </div>
      </div>
      <div class="case-expansion">
        <div class="expansion-label">확장 슬롯</div>
        <span></span><span></span><span></span><span></span>
      </div>
      <div class="power-supply">
        <div class="psu-fan"></div>
        <div class="psu-switch">I / O</div>
        <div class="power-socket"></div>
      </div>
      <div class="case-footnote"><span>◉ <b>PC 전원 정상</b></span><small>${connected ? 'LAN 케이블이 꽂혀 있습니다.' : 'LAN 케이블 연결이 필요합니다.'}</small></div>
    </div>
    <div class="rear-status"><span class="led-dot ${linkActive ? 'active' : ''}"></span><strong>${linkActive ? '링크 LED: 켜짐' : '링크 LED: 꺼짐'}</strong><span>${!connected ? 'LAN 포트에 케이블이 연결되어 있지 않습니다.' : restored ? '케이블 재연결 완료 · PC 화면으로 돌아가 정상화 검증을 진행하세요.' : !linkActive?'LAN 케이블은 꽂혀 있으나 통신 링크가 비활성입니다. 스위치 상태를 확인해 보세요.':'LAN 케이블 정상 · IP·DNS 또는 서비스 상태를 더 확인해 보세요.'}</span></div>
    ${advisory}
    <div class="rear-cta">${!connected ? '<button class="os-primary" type="button" data-pc-action="connect-cable">LAN 케이블 연결하기</button>' : restored ? '<span class="status-good">✓ 물리적 연결이 복구됐습니다.</span>' : !linkActive ? '<span class="status-neutral">케이블 연결 정상 · 서버실 스위치 링크 상태 추가 점검 필요</span>' : '<span class="status-neutral">LAN 케이블·링크 정상 · 필요시 IP·DNS 조사</span>'}</div>
  </div>`;
}
