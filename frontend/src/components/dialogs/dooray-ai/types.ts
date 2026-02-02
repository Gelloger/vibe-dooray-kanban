// AI 요약 관련 타입
export interface SummaryResult {
  summary: string;
  keyPoints: string[];
}

export type SummaryApplyMode = 'replace' | 'prepend' | 'title';

// AI 분할 관련 타입
export interface SplitTask {
  id: string;
  title: string;
  description: string;
  selected: boolean;
}

export interface SplitResult {
  parentTitle: string;
  tasks: Omit<SplitTask, 'id' | 'selected'>[];
}

// AI 패널 상태
export type AiPanelState = 'idle' | 'loading' | 'success' | 'error';

// 컴포넌트 Props
export interface AiSummaryPanelProps {
  body: string;
  onApply: (summary: string, mode: SummaryApplyMode) => void;
  onCancel: () => void;
  disabled?: boolean;
}

export interface AiSplitPanelProps {
  title: string;
  body: string;
  splitTasks: SplitTask[];
  onSplitTasksChange: (tasks: SplitTask[]) => void;
  onRequestSplit: () => void;
  isLoading: boolean;
  disabled?: boolean;
}

export interface SplitTaskItemProps {
  task: SplitTask;
  onToggle: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Pick<SplitTask, 'title' | 'description'>>) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
}

// AI 프롬프트 템플릿
export const AI_PROMPTS = {
  summarize: (body: string, maxLength?: number) => `다음 태스크 본문을 간결하게 요약해주세요.
핵심 포인트를 불릿으로 정리해주세요.
${maxLength ? `최대 ${maxLength}자 이내로 요약해주세요.` : ''}

---
${body}

응답 형식 (JSON):
{
  "summary": "요약된 내용",
  "keyPoints": ["핵심 포인트 1", "핵심 포인트 2", ...]
}`,

  split: (title: string, body: string) => `다음 태스크를 논리적인 단위로 분할해주세요.
각 하위 태스크는 독립적으로 수행 가능해야 합니다.

---
제목: ${title}
본문: ${body}

응답 형식 (JSON):
{
  "parentTitle": "부모 태스크 제목 (원본 또는 수정된 제목)",
  "tasks": [
    { "title": "하위 태스크 1 제목", "description": "설명" },
    { "title": "하위 태스크 2 제목", "description": "설명" },
    ...
  ]
}`,
} as const;
