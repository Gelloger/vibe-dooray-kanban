# Architecture Guide

## System Overview

```
+------------------+     +------------------+     +------------------+
|    Frontend      |     |   Rust Backend   |     |   External       |
|  (React + Vite)  | --> |  (Axum Server)   | --> |   Services       |
|                  |     |                  |     |  - Dooray API    |
|  TanStack Query  |     |  Deployment      |     |  - Docker        |
|  Zustand         |     |   trait          |     |  - Git (git2)    |
|  NiceModal       |     |                  |     |  - AI Agents     |
+------------------+     +------------------+     +------------------+
        |                        |
        v                        v
  shared/types.ts          SQLite (local)
  (ts-rs generated)        PostgreSQL (remote)
```

vibe-kanban은 Dooray 태스크를 칸반보드에서 관리하면서 AI 에이전트(Claude Code, Gemini CLI 등)로 코딩 작업을 자동화하는 도구다. local 배포(SQLite, 단일유저)가 주요 개발 대상이며, remote 배포(PostgreSQL, 멀티유저)는 부차적이다.

## Rust Backend

### Crate 의존성 구조

```
server ─── deployment (trait) ─── db
  │              │                  │
  │              ├── services       ├── utils
  │              ├── executors      └── executors (types only)
  │              ├── git
  │              └── utils
  │
  └── local-deployment (impl)
        ├── db, deployment, services
        ├── executors, git, utils
        └── portable-pty (터미널)
```

- `deployment`: `Deployment` trait 정의. local/remote 배포의 추상 인터페이스
- `local-deployment`: `LocalDeployment` 구현체. Docker 기반 컨테이너 실행
- `server`: 모든 API 라우트, MCP 서버, 메인 바이너리
- `db`: SQLx 모델 + 마이그레이션 (SQLite)
- `services`: 비즈니스 로직 (Git 호스트, 워크스페이스, 이벤트 등)
- `executors`: AI 에이전트 실행기 (Claude, Gemini, Codex, Amp 등)
- `git`: git2 wrapper
- `utils`: 공통 유틸리티 (로깅, JWT, 쉘 명령)

### Deployment Trait 패턴

모든 서비스 접근은 `Deployment` trait을 통해 이루어진다:
```rust
#[async_trait]
pub trait Deployment {
    fn db(&self) -> &DBService;
    fn container(&self) -> &impl ContainerService;
    fn git(&self) -> &GitService;
    // ... 11개 이상의 서비스 접근자
}
```

핸들러에서는 `State(deployment): State<DeploymentImpl>`로 주입받아 사용한다.

### API Handler 패턴

```rust
pub async fn handler_name(
    State(deployment): State<DeploymentImpl>,   // DI
    Extension(resource): Extension<Task>,        // 미들웨어에서 로딩
    Json(payload): Json<RequestType>,            // 요청 바디
) -> Result<ResponseJson<ApiResponse<T>>, ApiError>
```

- `State`: 의존성 주입 (deployment에서 DB, 서비스 등 접근)
- `Extension`: 미들웨어가 로딩한 리소스 (load_task_middleware 등)
- 반환 타입: 항상 `Result<ResponseJson<ApiResponse<T>>, ApiError>`

### Middleware 패턴

```rust
pub async fn load_task_middleware(
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<String>,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let task = Task::find_by_id(&deployment.db().pool, task_id).await?
        .ok_or(ApiError::BadRequest("Task not found"))?;
    request.extensions_mut().insert(task);
    Ok(next.run(request).await)
}
```

`from_fn_with_state`로 라우터에 적용하여 요청 전에 리소스를 로딩한다.

### DB 모델 패턴

```rust
#[derive(FromRow, Serialize, Deserialize, TS)]
pub struct Task {
    pub id: Uuid,
    pub title: String,
    pub status: TaskStatus,
    // ...
}

impl Task {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>> { ... }
    pub async fn create(pool: &SqlitePool, data: CreateTask) -> Result<Self> { ... }
}
```

- 각 모델은 `crates/db/src/models/`에 별도 파일
- DB 조작은 모델의 static method
- `sqlx::query_as!` 매크로로 컴파일 타임 쿼리 검증
- 트랜잭션: `pool.begin()` + `tx.commit()`

### Error Handling

```rust
#[derive(Debug, Error)]
pub enum ApiError {
    #[error(transparent)]
    Project(#[from] ProjectError),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("Bad request: {0}")]
    BadRequest(String),
}
```

`IntoResponse` 구현으로 HTTP 상태코드 + JSON 에러 응답 자동 변환.

## Frontend

### 상태 관리

| 목적 | 도구 | 위치 |
|------|------|------|
| 서버 상태 (API 데이터) | TanStack Query | `hooks/use*.ts` |
| 클라이언트 상태 (UI) | Zustand | `stores/*.ts` |
| 앱 전역 설정 | React Context | `contexts/*.tsx` |

### React Query 패턴

```typescript
export const taskKeys = {
  all: ['tasks'] as const,
  byId: (taskId: string) => ['tasks', taskId] as const,
};

export function useTask(taskId?: string) {
  return useQuery<Task>({
    queryKey: taskKeys.byId(taskId),
    queryFn: () => tasksApi.getById(taskId!),
    enabled: !!taskId,
  });
}
```

### Dialog (Modal) 패턴 - NiceModal

```typescript
// 정의
const MyDialog = NiceModal.create<Props>(({ taskId }) => {
  const modal = useModal();
  return (
    <Dialog open={modal.visible} onOpenChange={modal.hide}>
      {/* content */}
    </Dialog>
  );
});

// 사용
const result = await NiceModal.show(MyDialog, { taskId: '123' });
```

ESLint가 모든 Dialog를 NiceModal 래퍼로 감싸도록 강제한다.

### API Client 패턴

```typescript
// frontend/src/lib/api.ts
export const tasksApi = {
  create: (data: CreateTask) => makeRequest('/api/tasks', { method: 'POST', body: JSON.stringify(data) }),
  // SSE 스트리밍
  sendDesignChatStream: async function* (taskId, message) { ... yield event; }
};
```

### 컴포넌트 디렉토리 구조

| 디렉토리 | 역할 | 제약사항 |
|----------|------|---------|
| `components/ui/` | 기존 shadcn/ui (Radix) | kebab-case 파일명 |
| `components/ui-new/views/` | 프레젠테이션 컴포넌트 | state/side-effect 금지 |
| `components/ui-new/containers/` | 스마트 컴포넌트 | 로직 포함 |
| `components/ui-new/primitives/` | 기본 UI 요소 | |
| `components/ui-new/hooks/` | 로직 훅 | JSX 금지 |
| `components/dialogs/` | 모달 다이얼로그 | NiceModal 필수 |
| `components/tasks/` | 태스크/칸반 관련 | |

ESLint가 views/ 내 컴포넌트에서 useState, useEffect, API 호출을 금지한다.

## 핵심 도메인 모델

### Task Lifecycle

```
Todo ──(워크스페이스 생성)──> InProgress ──(PR 생성)──> InReview ──> Done
  ^                                                                    |
  └────────────── reset_to_todo (워크스페이스 정리) ──────────────────┘
                                                    ──> Cancelled
```

### Workspace Model

Task에 대해 여러 Workspace(작업 환경)를 생성할 수 있다:
- Workspace = Git worktree + Docker container + AI agent session
- Branch naming: Dooray 태스크면 `feature/develop/{dooray_number}`, 아니면 자동 생성
- Session: Workspace 내 개별 AI 실행 단위

### Parent-Child Task 관계

워크스페이스에서 하위 태스크를 생성할 수 있다:
- `parent_workspace_id`로 연결
- 반복적 개발: 초기 태스크 -> 워크스페이스 -> 하위 태스크 발견 -> 하위 태스크 생성

## SQLx 마이그레이션 워크플로

1. `sqlx migrate add <name>` - 새 마이그레이션 생성
2. 마이그레이션 SQL 작성 (`crates/db/migrations/`)
3. `pnpm run prepare-db` - SQLx 오프라인 메타데이터 갱신
4. `.sqlx/` 디렉토리 변경사항 커밋
5. CI에서 `pnpm run prepare-db:check`로 검증
