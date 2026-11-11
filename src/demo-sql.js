// seed/sample.sql 내용을 Worker 안에서 글자(문자열)로 쓰기 위한 모듈
//
// wrangler.jsonc의 rules 설정으로 .sql 파일을 '글자'로 가져옵니다. (→ 공식 문서에서 확인할 부분: Text 모듈 규칙)
// 시드 내용은 seed/sample.sql 한 곳에서만 관리합니다. (JS로 다시 쓰면 두 벌이 어긋나기 쉬움)
//
// 이 파일은 Cron의 데모 갱신 때만 동적으로 불러옵니다(index.js의 import()).
// Node 테스트는 .sql을 모듈로 불러올 수 없어서, 테스트에서는 파일을 직접 읽어 reseedDemo에 넘깁니다.
import SAMPLE_SQL from '../seed/sample.sql';

export default SAMPLE_SQL;
