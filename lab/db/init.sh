#!/bin/sh
set -eu
# 처음 만든 실습 DB에만 적용합니다. 앱에는 관리자 계정을 주지 않습니다.
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 \
  --set app_password="$(cat /run/secrets/db_app_password)" <<'SQL'
CREATE ROLE lab_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE erp_lab OWNER lab_app;
\connect erp_lab
SET ROLE lab_app;
CREATE TABLE orders (id integer PRIMARY KEY, title text NOT NULL, status text NOT NULL);
INSERT INTO orders VALUES (1, '가상 구매 요청', 'pending'), (2, '가상 자산 지급', 'approved');
SQL
