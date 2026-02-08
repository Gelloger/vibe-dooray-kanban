# Dooray Integration Guide

## Overview

vibe-kanban은 Dooray REST API를 통해 프로젝트/태스크/댓글을 양방향 동기화한다.
백엔드가 Dooray API 프록시 역할을 하여 프론트엔드에서 토큰이 노출되지 않는다.

## Architecture

```
Frontend (React)          Backend (Rust)              Dooray API
─────────────────        ─────────────────           ──────────────
doorayApi.*()  ────>  /api/dooray/*  ────reqwest───>  api.dooray.com
                      dooray_settings                /project/v1/*
                      (SQLite)
```

## Dooray Settings

단일 레코드(id="default")로 설정 관리:

| 필드 | 설명 |
|------|------|
| `dooray_token` | API 토큰 (`dooray-api {token}` 형식) |
| `selected_project_id` | 연동 대상 Dooray 프로젝트 ID |
| `selected_project_name` | 프로젝트 표시명 |
| `selected_tag_ids` | 동기화 대상 태그 ID 목록 (JSON 배열) |
| `dooray_domain` | Dooray 도메인 (코멘트 링크 생성에 사용) |

응답에서 토큰은 마스킹 처리 (앞 4자리 + 뒤 4자리만 표시).

## API Endpoints (Backend -> Dooray)

### 프로젝트
- `GET /project/v1/projects?member=me` - 내 프로젝트 목록

### 태스크 (Posts)
- `GET /project/v1/projects/{projectId}/posts` - 목록 (필터: workflowClasses, tagIds)
- `GET /project/v1/projects/{projectId}/posts/{postId}` - 상세
- `POST /project/v1/projects/{projectId}/posts` - 생성
- `PUT /project/v1/projects/{projectId}/posts/{postId}` - 수정

### 태그
- `GET /project/v1/projects/{projectId}/tags` - 태그 목록 (그룹 포함)

### 댓글 (Logs)
- `GET /project/v1/projects/{projectId}/posts/{postId}/logs` - 댓글 목록
- `POST /project/v1/projects/{projectId}/posts/{postId}/logs` - 댓글 작성

### 멤버
- `GET /project/v1/projects/{projectId}/members` - 멤버 목록 (댓글 작성자 이름 매핑)

### 템플릿
- `GET /project/v1/projects/{projectId}/templates` - 템플릿 목록
- `GET /project/v1/projects/{projectId}/templates/{templateId}` - 템플릿 상세

## Task 동기화 흐름

### Bulk Sync (`sync_dooray_tasks`)
1. Dooray에서 태스크 목록 조회 (태그 필터 적용)
2. 각 태스크에 대해:
   - `dooray_task_id`로 로컬 DB 검색
   - 존재하면 업데이트, 없으면 생성
3. 로컬 Task에 `dooray_task_id`, `dooray_project_id`, `dooray_task_number` 저장

### Single Import (`import_by_number` / `import_by_id`)
- Dooray 태스크 번호 또는 ID로 단건 가져오기
- 동일 로직으로 로컬 Task 생성/업데이트

### Task 생성 (`create_dooray_task`)
- 로컬 Task 생성 + Dooray에도 동시 생성
- Dooray 응답의 ID를 로컬 Task에 저장

## Branch Naming Convention

Dooray 태스크와 연결된 워크스페이스 생성 시:
```
feature/develop/{dooray_task_number}
```
예: Dooray 태스크 번호가 `PROJECT/123`이면 → `feature/develop/123`

## Frontend Hooks

| Hook | 역할 |
|------|------|
| `useDooray()` | Dooray 설정 및 연동 상태 |
| `useDoorayProjects()` | Dooray 프로젝트 목록 |
| `useDoorayTags()` | Dooray 태그 목록 |
| `useDoorayComments()` | 태스크 댓글 조회 |
| `useSyncDoorayTasks()` | 동기화 mutation |

## Design Session

태스크의 구현 전 AI(Claude)와의 사전 설계 대화 기능:
- SSE 스트리밍으로 실시간 응답
- `design_messages` 테이블에 대화 저장
- 워크스페이스 생성 시 설계 내용을 컨텍스트로 전달

## 주의사항

- Dooray API 인증 토큰은 사용자가 Settings에서 직접 입력
- 토큰 유효성은 프로젝트 목록 조회로 검증
- 동기화는 수동 트리거 (자동 polling 없음)
- Dooray의 workflowClass (backlog, registered, working)를 로컬 TaskStatus로 매핑
