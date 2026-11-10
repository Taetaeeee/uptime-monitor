// 'log' 알림 채널: 알림을 D1 notifications 테이블에 기록한다.
//
// 외부 메신저 없이도 "언제 무슨 알림이 나갔는지"를 남기고,
// 상태 페이지의 '최근 알림'(B-3)에서 이 기록을 그대로 보여 줍니다.
// SQL은 db.js에 모아 두기로 했으므로 여기서는 db.js 함수만 부릅니다.

import { insertNotification } from '../db.js';

export const logChannel = {
  name: 'log',

  /**
   * @param {object} event  notify.js가 message까지 붙여서 넘겨준 이벤트
   * @param {object} ctx    { db } — D1 데이터베이스
   */
  async send(event, ctx) {
    await insertNotification(ctx.db, {
      monitorId: event.monitorId,
      event: event.type,
      channel: 'log',
      message: event.message,
      failureReason: event.failureReason,
      createdAt: event.occurredAt,
      source: event.source,
    });
  },
};
