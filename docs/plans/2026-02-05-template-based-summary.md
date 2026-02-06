# Template-Based AI Summary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AI 요약 기능에서 Dooray 프로젝트 템플릿을 선택하여 템플릿 양식에 맞춰 요약을 생성하는 기능 추가

**Architecture:** 백엔드에 Dooray 템플릿 조회 API를 추가하고, 프론트엔드 AiSummaryPanel에 템플릿 선택 드롭다운을 추가. 선택한 템플릿의 body.content를 AI 프롬프트에 포함하여 해당 양식에 맞춘 요약 생성.

**Tech Stack:** Rust (Axum), TypeScript, React, TanStack Query

---

## Task 1: 백엔드 - Dooray 템플릿 타입 정의

**Files:**
- Modify: `crates/server/src/routes/dooray.rs:203-242` (기존 타입 정의 영역 근처)

**Step 1: 템플릿 관련 타입 추가**

`dooray.rs`의 타입 정의 영역(DoorayTask 정의 근처)에 추가:

```rust
// ============== Dooray Templates Types ==============

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct DoorayTemplate {
    pub id: String,
    #[serde(rename = "templateName")]
    pub template_name: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct DoorayTemplateDetail {
    pub id: String,
    #[serde(rename = "templateName")]
    pub template_name: String,
    pub body: Option<DoorayTaskBody>,
    pub guide: Option<DoorayTaskBody>,
    pub subject: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DoorayTemplatesApiResponse {
    result: Option<Vec<DoorayTemplate>>,
    #[serde(rename = "totalCount")]
    #[allow(dead_code)]
    total_count: Option<i64>,
    #[allow(dead_code)]
    header: DoorayApiHeader,
}

#[derive(Debug, Deserialize)]
struct DoorayTemplateDetailApiResponse {
    result: Option<DoorayTemplateDetail>,
    #[allow(dead_code)]
    header: DoorayApiHeader,
}
```

**Step 2: 빌드 확인**

Run: `cd /Users/nhn/project/vibe-dooray-kanban && cargo check -p server`
Expected: 컴파일 성공

---

## Task 2: 백엔드 - 템플릿 목록 조회 API

**Files:**
- Modify: `crates/server/src/routes/dooray.rs`

**Step 1: 라우터에 템플릿 엔드포인트 추가**

`router()` 함수에 추가 (line 22-37 근처):

```rust
.route("/dooray/projects/{dooray_project_id}/templates", get(get_dooray_templates))
.route("/dooray/projects/{dooray_project_id}/templates/{template_id}", get(get_dooray_template))
```

**Step 2: 템플릿 목록 조회 함수 추가**

파일 끝 부분 (helper functions 앞)에 추가:

```rust
// ============== Dooray Templates Endpoints ==============

async fn get_dooray_templates(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path(dooray_project_id): axum::extract::Path<String>,
) -> Result<ResponseJson<ApiResponse<Vec<DoorayTemplate>>>, ApiError> {
    let settings = get_required_settings(&deployment).await?;
    let client = create_dooray_client(&settings.dooray_token)?;

    let response = client
        .get(format!(
            "{}/project/v1/projects/{}/templates",
            DOORAY_API_BASE, dooray_project_id
        ))
        .query(&[("page", "0"), ("size", "100")])
        .send()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Dooray API error: {}", e)))?;

    if !response.status().is_success() {
        return Ok(ResponseJson(ApiResponse::error("Failed to fetch Dooray templates")));
    }

    let api_response: DoorayTemplatesApiResponse = response
        .json()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to parse Dooray response: {}", e)))?;

    let templates = api_response.result.unwrap_or_default();
    Ok(ResponseJson(ApiResponse::success(templates)))
}
```

**Step 3: 빌드 확인**

Run: `cd /Users/nhn/project/vibe-dooray-kanban && cargo check -p server`
Expected: 컴파일 성공

---

## Task 3: 백엔드 - 템플릿 상세 조회 API

**Files:**
- Modify: `crates/server/src/routes/dooray.rs`

**Step 1: 템플릿 상세 조회 함수 추가**

`get_dooray_templates` 함수 바로 아래에 추가:

```rust
async fn get_dooray_template(
    State(deployment): State<DeploymentImpl>,
    axum::extract::Path((dooray_project_id, template_id)): axum::extract::Path<(String, String)>,
) -> Result<ResponseJson<ApiResponse<DoorayTemplateDetail>>, ApiError> {
    let settings = get_required_settings(&deployment).await?;
    let client = create_dooray_client(&settings.dooray_token)?;

    let response = client
        .get(format!(
            "{}/project/v1/projects/{}/templates/{}",
            DOORAY_API_BASE, dooray_project_id, template_id
        ))
        .send()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Dooray API error: {}", e)))?;

    if !response.status().is_success() {
        return Ok(ResponseJson(ApiResponse::error("Failed to fetch Dooray template")));
    }

    let api_response: DoorayTemplateDetailApiResponse = response
        .json()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to parse Dooray response: {}", e)))?;

    match api_response.result {
        Some(template) => Ok(ResponseJson(ApiResponse::success(template))),
        None => Ok(ResponseJson(ApiResponse::error("Template not found"))),
    }
}
```

**Step 2: 빌드 확인**

Run: `cd /Users/nhn/project/vibe-dooray-kanban && cargo check -p server`
Expected: 컴파일 성공

**Step 3: 타입 생성**

Run: `cd /Users/nhn/project/vibe-dooray-kanban && pnpm run generate-types`
Expected: shared/types에 DoorayTemplate, DoorayTemplateDetail 타입 생성

---

## Task 4: 프론트엔드 - API 클라이언트 추가

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Step 1: doorayApi 객체에 템플릿 메서드 추가**

`doorayApi` 객체 내에 추가:

```typescript
getTemplates: async (projectId: string): Promise<DoorayTemplate[]> => {
  const response = await fetch(`/api/dooray/projects/${projectId}/templates`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch templates');
  return data.data;
},

getTemplate: async (projectId: string, templateId: string): Promise<DoorayTemplateDetail> => {
  const response = await fetch(`/api/dooray/projects/${projectId}/templates/${templateId}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch template');
  return data.data;
},
```

**Step 2: 타입 import 확인**

파일 상단 import에 `DoorayTemplate`, `DoorayTemplateDetail` 추가 필요시 추가.

---

## Task 5: 프론트엔드 - 템플릿 훅 추가

**Files:**
- Modify: `frontend/src/hooks/useDooray.ts`

**Step 1: Query key 추가**

`DOORAY_KEYS` 객체에 추가:

```typescript
templates: (projectId: string) => ['dooray', 'templates', projectId] as const,
template: (projectId: string, templateId: string) => ['dooray', 'template', projectId, templateId] as const,
```

**Step 2: useDoorayTemplates 훅 추가**

파일 끝에 추가:

```typescript
/**
 * Hook for fetching templates from a Dooray project
 */
export function useDoorayTemplates(doorayProjectId: string | null) {
  const {
    data: templates,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: doorayProjectId ? DOORAY_KEYS.templates(doorayProjectId) : ['dooray', 'templates', 'none'],
    queryFn: () => {
      if (!doorayProjectId) return Promise.resolve([]);
      return doorayApi.getTemplates(doorayProjectId);
    },
    enabled: Boolean(doorayProjectId),
    staleTime: 1000 * 60 * 5, // 5 minutes cache
  });

  return {
    templates: templates ?? [],
    isLoading,
    isError,
    error,
    refetch,
  };
}

/**
 * Hook for fetching a single template detail from a Dooray project
 */
export function useDoorayTemplate(doorayProjectId: string | null, templateId: string | null) {
  const {
    data: template,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: doorayProjectId && templateId
      ? DOORAY_KEYS.template(doorayProjectId, templateId)
      : ['dooray', 'template', 'none'],
    queryFn: () => {
      if (!doorayProjectId || !templateId) return Promise.resolve(null);
      return doorayApi.getTemplate(doorayProjectId, templateId);
    },
    enabled: Boolean(doorayProjectId) && Boolean(templateId),
    staleTime: 1000 * 60 * 5, // 5 minutes cache
  });

  return {
    template: template ?? null,
    isLoading,
    isError,
    error,
    refetch,
  };
}
```

**Step 3: 타입 export 추가**

파일 끝 export type에 추가:

```typescript
export type {
  // ... 기존 타입들
  DoorayTemplate,
  DoorayTemplateDetail,
};
```

---

## Task 6: AiSummaryPanel - 템플릿 선택 UI 추가

**Files:**
- Modify: `frontend/src/components/dialogs/dooray-ai/AiSummaryPanel.tsx`

**Step 1: import 추가**

```typescript
import { useDoorayTemplates, useDoorayTemplate } from '@/hooks/useDooray';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
```

**Step 2: Props에 doorayProjectId 추가**

```typescript
export interface AiSummaryPanelProps {
  taskId?: string;
  body: string;
  onApply: (summary: string, mode: SummaryApplyMode) => void;
  disabled?: boolean;
  doorayProjectId?: string | null;  // 추가
}
```

**Step 3: 컴포넌트 내부에 템플릿 상태 및 훅 추가**

함수 시작 부분에 추가:

```typescript
const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
const { templates, isLoading: isLoadingTemplates } = useDoorayTemplates(doorayProjectId ?? null);
const { template: selectedTemplate } = useDoorayTemplate(doorayProjectId ?? null, selectedTemplateId);
```

**Step 4: handleSummarize 함수에서 프롬프트 수정**

기존 프롬프트 부분을 조건부로 변경:

```typescript
let prompt: string;

if (selectedTemplate?.body?.content) {
  // 템플릿 기반 요약
  prompt = `다음 대화/텍스트 내용을 분석하여, 아래 템플릿 양식에 맞춰 요약해주세요.

## 템플릿 양식
\`\`\`
${selectedTemplate.body.content}
\`\`\`

## 요약할 내용
${truncatedBody}

## 출력 형식
JSON 형식으로 응답해주세요:
\`\`\`json
{
  "summary": "템플릿 양식에 맞춰 작성된 요약 내용 (마크다운)",
  "key_points": ["핵심 포인트 1", "핵심 포인트 2", ...]
}
\`\`\``;
} else {
  // 기본 요약 (기존 로직)
  prompt = `다음 텍스트를 요약해주세요. JSON 형식으로 응답해주세요:

\`\`\`json
{
  "summary": "요약된 내용 (1-2문장)",
  "key_points": ["핵심 포인트 1", "핵심 포인트 2", ...]
}
\`\`\`

요약할 텍스트:
${truncatedBody}`;
}
```

**Step 5: idle 상태 UI에 템플릿 선택 드롭다운 추가**

`if (state === 'idle')` 블록 내 return 문 수정:

```typescript
if (state === 'idle') {
  return (
    <div className="space-y-3">
      {/* 템플릿 선택 */}
      {doorayProjectId && (
        <div className="space-y-2">
          <Label className="text-sm">
            {t('dooray:ai.templateSelect', '템플릿 선택 (선택사항)')}
          </Label>
          <Select
            value={selectedTemplateId ?? 'none'}
            onValueChange={(value) => setSelectedTemplateId(value === 'none' ? null : value)}
            disabled={disabled || isLoadingTemplates}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('dooray:ai.selectTemplate', '템플릿 없음 (기본 요약)')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {t('dooray:ai.noTemplate', '템플릿 없음 (기본 요약)')}
              </SelectItem>
              {templates.map((tmpl) => (
                <SelectItem key={tmpl.id} value={tmpl.id}>
                  {tmpl.template_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleSummarize}
        disabled={disabled || !body.trim() || !taskId}
        className="w-full"
      >
        <Sparkles className="h-4 w-4 mr-2" />
        {selectedTemplateId
          ? t('dooray:ai.summarizeWithTemplate', '템플릿 기반 요약')
          : t('dooray:ai.summarize', 'AI 요약')}
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
```

---

## Task 7: CreateDoorayTaskDialog - AiSummaryPanel에 projectId 전달

**Files:**
- Modify: `frontend/src/components/dialogs/tasks/CreateDoorayTaskDialog.tsx`

**Step 1: AiSummaryPanel 호출 부분 수정**

line 544 근처의 AiSummaryPanel 컴포넌트에 doorayProjectId prop 추가:

```typescript
<AiSummaryPanel
  taskId={taskId}
  body={currentBody}
  onApply={handleApplySummary}
  disabled={isCreating}
  doorayProjectId={settings?.selected_project_id}  // 추가
/>
```

---

## Task 8: 번역 키 추가

**Files:**
- Modify: `frontend/src/locales/ko/dooray.json`

**Step 1: AI 관련 번역 키 추가**

`ai` 섹션에 추가:

```json
{
  "ai": {
    "templateSelect": "템플릿 선택 (선택사항)",
    "selectTemplate": "템플릿 없음 (기본 요약)",
    "noTemplate": "템플릿 없음 (기본 요약)",
    "summarizeWithTemplate": "템플릿 기반 요약"
  }
}
```

---

## Task 9: 테스트 및 확인

**Step 1: 백엔드 빌드**

Run: `cd /Users/nhn/project/vibe-dooray-kanban && cargo build -p server`
Expected: 빌드 성공

**Step 2: 타입 생성**

Run: `cd /Users/nhn/project/vibe-dooray-kanban && pnpm run generate-types`
Expected: 타입 생성 성공

**Step 3: 프론트엔드 타입 체크**

Run: `cd /Users/nhn/project/vibe-dooray-kanban && pnpm run typecheck`
Expected: 타입 체크 성공

**Step 4: 개발 서버 실행 및 수동 테스트**

Run: `cd /Users/nhn/project/vibe-dooray-kanban && pnpm run dev`

테스트 시나리오:
1. Dooray 연동된 상태에서 태스크 생성 다이얼로그 열기
2. AI 패널 확장
3. 템플릿 선택 드롭다운에서 템플릿 선택
4. "템플릿 기반 요약" 버튼 클릭
5. 템플릿 양식에 맞춰 요약이 생성되는지 확인

---

## Task 10: 커밋

**Step 1: 변경 파일 확인**

Run: `cd /Users/nhn/project/vibe-dooray-kanban && git status`

**Step 2: 커밋**

```bash
git add crates/server/src/routes/dooray.rs \
        frontend/src/lib/api.ts \
        frontend/src/hooks/useDooray.ts \
        frontend/src/components/dialogs/dooray-ai/AiSummaryPanel.tsx \
        frontend/src/components/dialogs/tasks/CreateDoorayTaskDialog.tsx \
        frontend/src/locales/ko/dooray.json

git commit -m "feat(dooray): add template-based AI summary feature

- Add Dooray template list/detail API endpoints (backend)
- Add useDoorayTemplates, useDoorayTemplate hooks (frontend)
- Add template selection dropdown to AiSummaryPanel
- Generate AI summary based on selected template format

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```
