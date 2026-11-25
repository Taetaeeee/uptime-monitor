-- 0021: 첫 화면 변경의 종류 — '배포'와 '내용 변경' 구분 (27단계)
--
-- 빌드 도구(Vite·Next.js·CRA 등)는 새로 빌드할 때마다 스크립트·스타일 파일 이름 뒤 해시를 바꿉니다.
-- HTML 전체 지문(hash)과 따로 "해시 붙은 파일 이름 목록"의 지문(asset_hash, 빌드 지문)을 저장해 두고,
-- 변경을 확정할 때 빌드 지문이 바뀌었으면 'deploy', HTML만 바뀌었으면 'content', 비교할 빌드 지문이 없으면 'unknown'으로 남깁니다
-- (판정은 src/fingerprint.js changeKind, 파일 이름 자체는 저장하지 않음).
--
-- 모두 빈 값(NULL)을 허용하는 열 추가라 기존 행은 그대로입니다. 27단계 전의 변경 기록은 kind = 'unknown'.
-- 기존 기준 지문에는 빌드 지문이 없어서, 배포 뒤 첫 회차에 같은 내용이면 한 번만 채웁니다(서비스 대표 점검당 쓰기 1번).

ALTER TABLE content_fingerprints ADD COLUMN asset_hash TEXT;            -- 지금 기준의 빌드 지문 (해시 파일이 없는 사이트는 NULL)
ALTER TABLE content_fingerprints ADD COLUMN candidate_asset_hash TEXT;  -- 후보(확정 전)의 빌드 지문

ALTER TABLE content_changes ADD COLUMN old_asset_hash TEXT;
ALTER TABLE content_changes ADD COLUMN new_asset_hash TEXT;
ALTER TABLE content_changes ADD COLUMN kind TEXT NOT NULL DEFAULT 'unknown' CHECK (kind IN ('deploy', 'content', 'unknown'));
