# Dooray 태스크 AI 요약 및 분할 기능 설계

> 작성일: 2026-02-02

## 개요

Dooray 태스크 생성 시 AI를 활용하여 본문 요약 및 태스크 분할 기능을 제공한다.

## 요구사항 정리

| 항목 | 내용 |
|------|------|
| **워크플로우** | 요약 → 분할 여부 결정 (순차적) |
| **AI 처리** | 연결된 AI 에이전트 활용 (Claude Code, Gemini 등) |
| **Dooray 연동** | MCP 서버로 태스크 생성 |
| **분할 방식** | AI 제안 + 사용자 조정 |
| **태스크 관계** | 하위 태스크(Subtask), 부모 없으면 부모 먼저 생성 |
| **요약 적용** | 미리보기 후 사용자가 적용 방식 선택 |
| **UI 위치** | 기존 CreateDoorayTaskDialog에 버튼 + 확장 패널 추가 |

## UI/UX 흐름

### 기본 흐름

```
[기존 CreateDoorayTaskDialog]
     │
     ├── 제목 입력
     ├── 본문 입력 (textarea)
     │
     └── [🤖 AI 요약/분할] 버튼  ← 새로 추가
              │
              ▼
        ┌─────────────────────────────┐
        │  확장 패널 (접힘/펼침)        │
        │                             │
        │  [요약 중...] 로딩 표시       │
        │         ▼                   │
        │  ┌─ 요약 결과 ─┐            │
        │  │ (미리보기)   │            │
        │  └─────────────┘            │
        │                             │
        │  적용 방식:                  │
        │  ○ 본문 대체                 │
        │  ○ 본문 상단에 추가           │
        │  ○ 제목으로 사용              │
        │  [적용] [취소]               │
        │                             │
        │  ─────────────────          │
        │  [📋 태스크 분할] 버튼        │
        │         ▼                   │
        │  ┌─ 분할 제안 ─┐            │
        │  │ □ 태스크 1 (수정 가능)    │
        │  │ □ 태스크 2 (수정 가능)    │
        │  │ □ 태스크 3 (수정 가능)    │
        │  │ [+ 추가] [🗑 선택 삭제]   │
        │  └─────────────┘            │
        └─────────────────────────────┘
              │
              ▼
     [생성] → 부모 태스크 + 하위 태스크 일괄 생성
```

### 핵심 인터랙션

- 요약과 분할은 **선택적** - 버튼을 누르지 않으면 기존 방식대로 단일 태스크 생성
- 분할된 각 태스크는 **인라인 편집** 가능
- 체크박스로 생성할 태스크 선택/해제

## 컴포넌트 구조

### 새로 생성할 컴포넌트

```
frontend/src/components/dialogs/
├── CreateDoorayTaskDialog.tsx        (기존 - 수정)
│
├── dooray-ai/                        (새 폴더)
│   ├── AiSummaryPanel.tsx            # 요약 UI 패널
│   ├── AiSplitPanel.tsx              # 분할 UI 패널
│   ├── SplitTaskItem.tsx             # 분할된 개별 태스크 항목
│   └── types.ts                      # 타입 정의
```

### 컴포넌트 역할

**AiSummaryPanel**
- AI 요약 요청 및 결과 표시
- 적용 방식 라디오 버튼 (대체/상단추가/제목)
- 적용/취소 버튼
- 로딩/에러 상태 처리

**AiSplitPanel**
- AI 분할 요청 및 제안 목록 표시
- 분할 태스크 추가/삭제 관리
- 전체 선택/해제 체크박스

**SplitTaskItem**
- 개별 분할 태스크의 체크박스 + 편집 UI
- 제목/설명 인라인 수정
- 삭제 버튼

### 상태 관리

```typescript
// CreateDoorayTaskDialog 내부 상태
interface DialogState {
  // 기존 상태
  title: string;
  body: string;

  // 새로 추가
  aiPanelOpen: boolean;
  summary: SummaryResult | null;
  summaryApplyMode: 'replace' | 'prepend' | 'title' | null;
  splitTasks: SplitTask[];
  selectedTaskIds: Set<string>;
}
```

## AI 에이전트 연동

### 연동 방식

Vibe Kanban에 연결된 AI 에이전트(Claude Code, Gemini 등)를 활용하여 요약/분할 요청을 처리한다.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Frontend   │────▶│  Vibe Kanban │────▶│  AI Agent       │
│  (Dialog)   │     │  Backend     │     │  (Claude Code)  │
└─────────────┘     └──────────────┘     └─────────────────┘
```

### 새로운 Backend API 엔드포인트

```rust
// crates/server/src/routes/dooray.rs에 추가

POST /dooray/ai/summarize
  Request:  { body: string, max_length?: number }
  Response: { summary: string, key_points: string[] }

POST /dooray/ai/split
  Request:  { title: string, body: string, context?: string }
  Response: {
    parent_title: string,
    tasks: [{ title: string, description: string }]
  }
```

### 프롬프트 템플릿

```
[요약 프롬프트]
다음 태스크 본문을 간결하게 요약해주세요.
핵심 포인트를 불릿으로 정리해주세요.
---
{body}

[분할 프롬프트]
다음 태스크를 논리적인 단위로 분할해주세요.
각 하위 태스크는 독립적으로 수행 가능해야 합니다.
---
제목: {title}
본문: {body}
```

## Dooray MCP 연동

### create_task 파라미터

```typescript
{
  subject: string,              // 태스크 제목 (필수)
  body: {
    mime_type: "text/x-markdown" | "text/html",
    content: string             // 본문 내용
  },
  parent_post_id?: string,      // 하위 태스크 생성 시 부모 ID
  users?: {
    to: MemberRef[],            // 담당자
    cc: MemberRef[]             // 참조자
  },
  due_date?: string,            // ISO8601 형식
  milestone_id?: string,
  tag_ids?: string[],
  priority?: "none" | "highest" | "high" | "normal" | "low" | "lowest"
}
```

### 생성 흐름

```
[생성 버튼 클릭]
     │
     ▼
┌────────────────────────────────────────────┐
│  1. 부모 태스크 생성                        │
│                                            │
│  dooray-mcp: create_task({                 │
│    subject: "부모 태스크 제목",             │
│    body: {                                 │
│      mime_type: "text/x-markdown",         │
│      content: "요약된 본문 + 원본(선택)"    │
│    },                                      │
│    tag_ids: [...],                         │
│    priority: "normal"                      │
│  })                                        │
│  → 반환: { id: "parent_task_id", ... }     │
│                                            │
├────────────────────────────────────────────┤
│  2. 하위 태스크들 순차 생성                  │
│                                            │
│  for each splitTask:                       │
│    dooray-mcp: create_task({               │
│      subject: splitTask.title,             │
│      body: {                               │
│        mime_type: "text/x-markdown",       │
│        content: splitTask.description      │
│      },                                    │
│      parent_post_id: "parent_task_id"      │
│    })                                      │
│                                            │
└────────────────────────────────────────────┘
```

### 추가 옵션

```typescript
interface CreateOptions {
  inheritAssignees: boolean;   // 부모 담당자를 하위에도 적용
  inheritTags: boolean;        // 부모 태그를 하위에도 적용
  inheritPriority: boolean;    // 부모 우선순위 상속
}
```

## 에러 처리

### 에러 시나리오별 처리

| 시나리오 | 처리 방식 |
|----------|-----------|
| AI 에이전트 미연결 | "AI 에이전트를 먼저 연결해주세요" 메시지 + 버튼 비활성화 |
| 요약 요청 실패 | 재시도 버튼 표시, 원본 본문 유지 |
| 분할 요청 실패 | 재시도 버튼 표시, 수동 분할 옵션 제공 |
| 부모 태스크 생성 실패 | 전체 생성 중단, 에러 메시지 표시 |
| 하위 태스크 일부 실패 | 성공한 태스크 목록 표시 + 실패 항목 재시도 옵션 |
| 본문이 너무 짧음 | "요약할 내용이 충분하지 않습니다" 안내 |
| Dooray API 권한 오류 | 프로젝트 권한 확인 안내 |

### 로딩 상태 UI

```
[요약 중]     ──▶  "본문을 분석하고 있습니다..." (스피너)
[분할 중]     ──▶  "태스크를 분할하고 있습니다..." (스피너)
[생성 중]     ──▶  "태스크 생성 중... (2/5)" (진행률 표시)
```

### 엣지 케이스

- **빈 본문으로 요약 시도**: 요약 버튼 비활성화 (본문 최소 길이 체크)
- **분할 결과가 1개인 경우**: "분할할 내용이 없습니다. 단일 태스크로 생성할까요?" 확인
- **사용자가 모든 분할 태스크 체크 해제**: 생성 버튼 비활성화 + "최소 1개 이상 선택해주세요" 안내
- **요약 적용 후 다시 요약 요청**: 이전 요약 덮어쓰기 전 확인 모달

## 구현 범위

### Phase 1: 기본 기능
- [ ] AiSummaryPanel 컴포넌트
- [ ] AiSplitPanel 컴포넌트
- [ ] CreateDoorayTaskDialog 수정
- [ ] Backend API 엔드포인트 추가
- [ ] AI 에이전트 연동

### Phase 2: 고급 기능
- [ ] 담당자/태그 상속 옵션
- [ ] 기존 태스크 임포트 시 요약/분할
- [ ] 분할 히스토리 저장
