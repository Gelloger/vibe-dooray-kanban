# Repository Guidelines

## Project Structure & Module Organization
- `crates/`: Rust workspace crates — `server` (API + bins), `db` (SQLx models/migrations), `executors`, `services`, `utils`, `deployment`, `local-deployment`, `remote`.
- `frontend/`: React + TypeScript app (Vite, Tailwind). Source in `frontend/src`.
- `frontend/src/components/dialogs`: Dialog components for the frontend.
- `remote-frontend/`: Remote deployment frontend.
- `shared/`: Generated TypeScript types (`shared/types.ts`). Do not edit directly.
- `assets/`, `dev_assets_seed/`, `dev_assets/`: Packaged and local dev assets.
- `npx-cli/`: Files published to the npm CLI package.
- `scripts/`: Dev helpers (ports, DB preparation).
- `docs/`: Documentation files.

## Managing Shared Types Between Rust and TypeScript

ts-rs allows you to derive TypeScript types from Rust structs/enums. By annotating your Rust types with #[derive(TS)] and related macros, ts-rs will generate .ts declaration files for those types.
When making changes to the types, you can regenerate them using `pnpm run generate-types`
Do not manually edit shared/types.ts, instead edit crates/server/src/bin/generate_types.rs

## Build, Test, and Development Commands
- Install: `pnpm i`
- Run dev (frontend + backend with ports auto-assigned): `pnpm run dev`
- Backend (watch): `pnpm run backend:dev:watch`
- Frontend (dev): `pnpm run frontend:dev`
- Type checks: `pnpm run check` (frontend) and `pnpm run backend:check` (Rust cargo check)
- Rust tests: `cargo test --workspace`
- Generate TS types from Rust: `pnpm run generate-types` (or `generate-types:check` in CI)
- Prepare SQLx (offline): `pnpm run prepare-db`
- Prepare SQLx (remote package, postgres): `pnpm run remote:prepare-db`
- Local NPX build: `pnpm run build:npx` then `pnpm pack` in `npx-cli/`

## Coding Style & Naming Conventions
- Rust: `rustfmt` enforced (`rustfmt.toml`); group imports by crate; snake_case modules, PascalCase types.
- TypeScript/React: ESLint + Prettier (2 spaces, single quotes, 80 cols). PascalCase components, camelCase vars/functions, kebab-case file names where practical.
- Keep functions small, add `Debug`/`Serialize`/`Deserialize` where useful.

## Testing Guidelines
- Rust: prefer unit tests alongside code (`#[cfg(test)]`), run `cargo test --workspace`. Add tests for new logic and edge cases.
- Frontend: ensure `pnpm run check` and `pnpm run lint` pass. If adding runtime logic, include lightweight tests (e.g., Vitest) in the same directory.

## Commit Guidelines

### Message Format
```
#[프로젝트코드]/[문서번호]: [모듈] 개발 내용
```
- 문서번호가 없는 경우 `noref` 사용: `#VK/noref: [SERVER] 컴파일 오류 수정`

### Module Names
변경된 파일이 속한 최상위 디렉토리/crate의 **대문자명**을 사용한다. 모듈이 없거나 루트 파일만 변경 시 생략 가능.

| 변경 파일 경로 | 모듈 |
|---|---|
| `crates/server/src/**` | `[SERVER]` |
| `crates/db/src/**` | `[DB]` |
| `crates/services/src/**` | `[SERVICES]` |
| `crates/git/src/**` | `[GIT]` |
| `crates/executors/src/**` | `[EXECUTORS]` |
| `crates/deployment/src/**` | `[DEPLOYMENT]` |
| `crates/local-deployment/src/**` | `[LOCAL-DEPLOYMENT]` |
| `crates/remote/src/**` | `[REMOTE]` |
| `crates/review/src/**` | `[REVIEW]` |
| `crates/utils/src/**` | `[UTILS]` |
| `frontend/src/**` | `[FRONTEND]` |
| `shared/**` | `[SHARED]` |

### Commit Unit
변경사항이 있는 **모듈별로 커밋을 분리**한다.

```
#VK/10543: [DB] workspace_count 필드 및 delete_all_by_task_id 추가
#VK/10543: [SERVER] reset_to_todo 핸들러 구현
#VK/10543: [FRONTEND] Reset to Todo 다이얼로그 및 칸반 인터셉트
```

## Architecture & Patterns

### Backend (Rust/Axum)
- **Deployment trait**: 모든 서비스 접근은 `Deployment` trait을 통해 이루어진다. local-deployment(SQLite)가 주요 개발 대상.
- **Handler 패턴**: `State(deployment)` + `Extension(resource)` + `Json(payload)` → `Result<ResponseJson<ApiResponse<T>>, ApiError>`
- **Middleware**: `load_task_middleware` 등으로 요청 전 리소스 로딩 후 `Extension`에 삽입.
- **DB 모델**: `crates/db/src/models/`에 모델별 파일. static method로 DB 조작. `sqlx::query_as!` 매크로 사용.
- **마이그레이션 추가 시**: SQL 작성 → `pnpm run prepare-db` → `.sqlx/` 변경사항 커밋 필수.

### Frontend (React/TypeScript)
- **서버 상태**: TanStack Query (`hooks/use*.ts`), **UI 상태**: Zustand (`stores/*.ts`)
- **Dialog**: 반드시 `@ebay/nice-modal-react`로 래핑. ESLint가 강제함.
- **ui-new 규칙**: `views/`는 프레젠테이션 전용 (useState, useEffect, API 호출 금지). `containers/`에 로직 배치.
- **API 클라이언트**: `frontend/src/lib/api.ts`의 네임스페이스 객체 (`tasksApi`, `doorayApi` 등)

## Key Development Rules
- **shared/types.ts 직접 수정 금지**: `pnpm run generate-types`로만 갱신. 소스는 `crates/server/src/bin/generate_types.rs`.
- **Dooray 연동**: 백엔드가 프록시 역할. 프론트에서 Dooray 토큰 직접 사용 금지. 상세는 [docs/dev/dooray-integration.md](docs/dev/dooray-integration.md) 참조.
- **Branch naming**: Dooray 태스크 연결 시 `feature/develop/{dooray_number}` 형식 자동 생성.
- **SQLx offline**: DB 스키마 변경 후 `pnpm run prepare-db` 실행 + `.sqlx/` 커밋 필수. 안 하면 CI 실패.

## Detailed Documentation
| 문서 | 내용 |
|------|------|
| [docs/dev/architecture.md](docs/dev/architecture.md) | 백엔드/프론트엔드 아키텍처 패턴, 도메인 모델, 핸들러/미들웨어 구조 |
| [docs/dev/dooray-integration.md](docs/dev/dooray-integration.md) | Dooray API 연동 구조, 동기화 흐름, 설정 관리, 설계 세션 |

## Security & Config Tips
- Use `.env` for local overrides; never commit secrets. Key envs: `FRONTEND_PORT`, `BACKEND_PORT`, `HOST`
- Dev ports and assets are managed by `scripts/setup-dev-environment.js`.
