/**
 * PC 내부 공통 내비게이션. 현재 화면, 바탕화면 복귀, 빠른 앱 이동,
 * PC 닫기를 혼동하지 않도록 버튼의 실제 동작과 명칭을 일치시킵니다.
 * 이 UI는 게임 상태를 변경하지 않으며 버튼은 main.js의 이벤트 위임으로 처리됩니다.
 */
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const APP_ROUTES=[
  {view:'network',action:'network',label:'네트워크 설정'},
  {view:'browser',action:'browser',label:'웹 브라우저'},
  {view:'terminal',action:'terminal',label:'명령 프롬프트'},
];
export function pcNavigationRoutes(cause='') {
  const routes=[...APP_ROUTES];
  if(['phishing-email','phishing-attachment'].includes(cause)) routes.push({view:'mail',action:'mail',label:'이메일'});
  if(cause==='anomalous-login') routes.push({view:'security',action:'security',label:'계정 보안'});
  return routes;
}
export function renderPcNavigation(employee,view='desktop',cause='',{tutorial=false,dnsStep=null}={}) {
  const routes=pcNavigationRoutes(cause);
  const current=view==='mail-detail'?'mail':view;
  const title=current==='front'?'책상 정면':current==='chassis'?'본체 포트':routes.find(r=>r.view===current)?.label||'바탕화면';
  const safeEmployee=escapeHtml(employee);
  const guidedTarget=dnsStep===5||dnsStep===10?'browser':dnsStep===6||dnsStep===9?'network':[7,8].includes(dnsStep)?'terminal':null;
  const tabs=routes.map(r=>`<button type="button" class="pc-nav-tab${r.view===current?' is-current':''}${r.view===guidedTarget?' dns-tutorial-focus':''}" data-pc-action="${r.action}" ${r.view===current?'aria-current="page"':''}>${escapeHtml(r.label)}</button>`).join('');
  return `<section class="pc-navigation" aria-label="PC 화면 내비게이션">
    <div class="pc-navigation-top"><div class="pc-path"><span>${safeEmployee} PC</span><span class="pc-path-chevron">›</span><strong>${title}</strong></div>
      <div class="pc-navigation-actions">${view!=='desktop'?'<button type="button" class="pc-nav-home" data-pc-action="desktop">← 바탕화면</button>':''}
        </div>
    </div>
    <div class="pc-nav-shortcuts" aria-label="PC 프로그램 바로가기"><span class="pc-nav-caption">모니터 프로그램</span>${tabs}</div>
    ${tutorial && view==='desktop'?'<div class="pc-nav-tutorial-note">먼저 필요한 프로그램을 선택해 보세요. PC를 닫으려면 화면 오른쪽 위의 <b>PC 닫기</b>를 누르세요.</div>':''}
  </section>`;
}
