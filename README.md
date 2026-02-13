<p align="center">
  <picture>
    <source srcset="frontend/public/vibe-kanban-logo-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="frontend/public/vibe-kanban-logo.svg" media="(prefers-color-scheme: light)">
    <img src="frontend/public/vibe-kanban-logo.svg" alt="Vibe Kanban Logo" width="240">
  </picture>
</p>

<h3 align="center">Vibe Kanban + Dooray</h3>
<p align="center">Dooray 프로젝트 관리와 AI 코딩 에이전트를 연결하는 칸반 보드</p>

---

## Overview

[Vibe Kanban](https://github.com/BloopAI/vibe-kanban) 기반의 Dooray 통합 버전입니다. Dooray의 태스크를 칸반 보드에서 관리하고, Claude Code 등 AI 코딩 에이전트로 작업을 수행할 수 있습니다.

### 주요 기능

- **Dooray 태스크 동기화** — Dooray 프로젝트의 태스크를 자동으로 가져오고 상태를 동기화
- **태스크 생성 & 임포트** — 칸반 보드에서 Dooray 태스크 직접 생성, 번호/URL로 개별 임포트
- **AI 요약 & 분할** — Claude를 활용해 태스크 설명을 요약하거나 하위 태스크로 자동 분할
- **템플릿 기반 요약** — Dooray 템플릿을 선택해 AI 요약의 포맷을 지정
- **댓글 연동** — Dooray 태스크 댓글 조회 및 작성
- **태그 필터링** — 태그 그룹별 필터로 동기화할 태스크 범위 지정
- **멀티 에이전트 지원** — Claude Code, Gemini CLI, Codex, Amp, Copilot 등 다양한 코딩 에이전트 연동
- **병렬 실행** — 여러 코딩 에이전트를 동시에 실행하고 진행 상황 추적
- **Dooray MCP 서버** — MCP 프로토콜을 통한 Dooray 데이터 접근
- **다국어 지원** — 한국어, 영어, 일본어, 중국어(간체/번체), 스페인어, 프랑스어

## 시작하기

### 사전 준비

1. **Dooray 계정** — 프로젝트 접근 권한이 있는 Dooray 계정
2. **API 토큰** — Dooray API 인증용 토큰
3. **코딩 에이전트** — Claude Code, Gemini CLI 등 하나 이상의 에이전트가 설치 및 인증된 상태

### Dooray API 토큰 발급

1. Dooray에 로그인
2. 우측 상단 프로필 아이콘 클릭
3. **설정** → **API 토큰**
4. **토큰 생성** 클릭 후 토큰 복사

> **보안 주의**: API 토큰을 버전 관리에 커밋하거나 공유하지 마세요.

### 설치 & 실행

```bash
git clone <this-repo-url>
cd vibe-dooray-kanban
pnpm i
pnpm run dev
```

또는 로컬 빌드 후 실행할 수도 있습니다:

```bash
./local-build.sh
npx vibe-kanban
```

> `local-build.sh`가 `npx-cli/dist/`에 바이너리를 생성하면, CLI가 자동으로 로컬 빌드를 감지(local dev mode)합니다.

### Dooray 연동 설정

1. 좌측 네비게이션의 **Settings** (⚙️) 클릭
2. **Dooray** 탭으로 이동
3. 도메인 입력 (예: `your-company` — `your-company.dooray.com`에서 서브도메인 부분)
4. API 토큰 붙여넣기 후 **Save**
5. 프로젝트 목록에서 연동할 프로젝트 선택
6. (선택) 태그 필터를 설정해 동기화 범위 지정

## 사용법

### 태스크 동기화

태스크 패널에서 **Sync** 버튼을 클릭하면 Dooray 프로젝트의 태스크를 가져옵니다. 태스크 상태가 자동으로 매핑됩니다:

| Dooray 상태 | 칸반 상태 |
|-------------|----------|
| 진행 중 (working) | In Progress |
| 등록 (registered) | Todo |
| 대기 (backlog) | Todo |

### 태스크 생성

1. **Create Dooray Task** 클릭
2. 제목과 설명 입력
3. 필수 태그 선택 (태그 그룹에 필수 설정이 있는 경우)
4. (선택) **AI Summary** 로 설명 요약 또는 **AI Split** 으로 하위 태스크 자동 분할
5. **Create** 클릭

### 태스크 임포트

개별 태스크를 번호 또는 URL로 임포트할 수 있습니다:

- 태스크 번호: `PROJECT/123`
- Dooray URL: `https://your-company.dooray.com/project/task/12345678`

### AI 기능

| 기능 | 설명 |
|------|------|
| **AI 요약** | 긴 태스크 설명을 간결하게 요약 |
| **템플릿 기반 요약** | Dooray 템플릿 포맷에 맞춰 요약 생성 |
| **AI 분할** | 큰 태스크를 하위 태스크로 자동 분할 |

연결된 AI 에이전트(Claude Code, Gemini 등)를 활용하여 처리됩니다.

### 댓글

Dooray 태스크의 댓글을 조회하고, 칸반 보드에서 바로 댓글을 작성할 수 있습니다.

## 트러블슈팅

| 문제 | 해결 방법 |
|------|----------|
| "Invalid API Token" | Dooray 설정에서 토큰 재발급 |
| "Project not found" | 도메인과 프로젝트 접근 권한 확인 |
| "Failed to sync" | 네트워크 연결 및 API 토큰 권한 확인 |
| 태스크가 안 보임 | 태그 필터 설정 확인 후 다시 동기화 |

## 개발

### 사전 요구사항

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) (>=18)
- [pnpm](https://pnpm.io/) (>=8)

```bash
cargo install cargo-watch
cargo install sqlx-cli
pnpm i
```

### 개발 서버 실행

```bash
pnpm run dev
```

프론트엔드와 백엔드가 함께 실행됩니다. 빈 DB가 `dev_assets_seed` 폴더에서 복사됩니다.

### 주요 명령어

| 명령어 | 설명 |
|--------|------|
| `pnpm run dev` | 프론트엔드 + 백엔드 개발 서버 |
| `pnpm run check` | 프론트엔드 TypeScript 타입 체크 |
| `pnpm run backend:check` | Rust cargo check |
| `pnpm run generate-types` | Rust → TypeScript 타입 생성 |
| `pnpm run prepare-db` | SQLx 오프라인 준비 |
| `cargo test --workspace` | Rust 테스트 실행 |

### 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | 자동 할당 | 서버 포트 |
| `BACKEND_PORT` | `0` (자동) | 백엔드 포트 (개발 모드) |
| `FRONTEND_PORT` | `3000` | 프론트엔드 포트 (개발 모드) |
| `HOST` | `127.0.0.1` | 백엔드 호스트 |
| `VK_ALLOWED_ORIGINS` | 미설정 | 허용할 오리진 (리버스 프록시 사용 시) |

### 프로젝트 구조

```
├── crates/           # Rust workspace
│   ├── server/       # API 서버 + Dooray 라우트
│   ├── db/           # SQLx 모델 + 마이그레이션
│   ├── executors/    # 코딩 에이전트 실행기
│   ├── services/     # Git 호스트, AI 서비스
│   └── utils/        # 유틸리티
├── frontend/         # React + TypeScript (Vite, Tailwind)
├── shared/           # 생성된 TypeScript 타입 (직접 수정 금지)
└── scripts/          # 개발 헬퍼 스크립트
```

## 원본 프로젝트

이 프로젝트는 [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban)을 기반으로 합니다. 원본 문서는 [vibekanban.com/docs](https://vibekanban.com/docs)에서 확인할 수 있습니다.
