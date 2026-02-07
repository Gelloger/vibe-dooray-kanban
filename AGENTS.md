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

## Security & Config Tips
- Use `.env` for local overrides; never commit secrets. Key envs: `FRONTEND_PORT`, `BACKEND_PORT`, `HOST`
- Dev ports and assets are managed by `scripts/setup-dev-environment.js`.
