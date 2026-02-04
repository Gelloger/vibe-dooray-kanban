import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Split, Plus, AlertCircle, RotateCcw } from 'lucide-react';
import WYSIWYGEditor from '@/components/ui/wysiwyg';
import { SplitTaskItem } from './SplitTaskItem';
import { useDesignChatStream } from '@/hooks/useDesignSession';
import type { SplitTask, AiPanelState } from './types';

export interface AiSplitPanelProps {
  taskId?: string;
  title: string;
  body: string;
  splitTasks: SplitTask[];
  onSplitTasksChange: (tasks: SplitTask[]) => void;
  onParentTitleChange?: (title: string) => void;
  disabled?: boolean;
}

// Parse split response from AI
function parseSplitResponse(content: string): { parentTitle?: string; tasks: Array<{ title: string; description: string }> } | null {
  try {
    // Find the last ```json block by searching from the end
    // We need to handle nested code blocks inside JSON (e.g., ```java inside description)
    const lastJsonStart = content.lastIndexOf('```json');
    if (lastJsonStart !== -1) {
      // Find the matching closing ``` by using balanced brace matching
      const afterJsonTag = content.slice(lastJsonStart + 7); // Skip "```json"

      // Find where the JSON object starts
      const jsonObjStart = afterJsonTag.indexOf('{');
      if (jsonObjStart !== -1) {
        const jsonStartPos = lastJsonStart + 7 + jsonObjStart;
        const extracted = extractJsonFromPosition(content, jsonStartPos);
        if (extracted) {
          return extracted;
        }
      }
    }

    // Fallback: Try to find JSON object pattern with balanced braces
    const jsonStartIndex = content.lastIndexOf('{"parent_title"');
    if (jsonStartIndex !== -1) {
      return extractJsonFromPosition(content, jsonStartIndex);
    }

    // Try alternative key
    const altStart = content.lastIndexOf('{"tasks"');
    if (altStart !== -1) {
      return extractJsonFromPosition(content, altStart);
    }

    return null;
  } catch (err) {
    console.error('Failed to parse split response:', err, content);
    return null;
  }
}

// Extract JSON from a specific position with balanced brace matching
function extractJsonFromPosition(content: string, startIndex: number): { parentTitle?: string; tasks: Array<{ title: string; description: string }> } | null {
  let braceCount = 0;
  let endIndex = startIndex;
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') braceCount++;
      if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIndex = i;
          break;
        }
      }
    }
  }

  if (braceCount !== 0) return null;

  const jsonStr = content.slice(startIndex, endIndex + 1);
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      parentTitle: parsed.parent_title || parsed.parentTitle,
      tasks: parsed.tasks || [],
    };
  } catch {
    return null;
  }
}

export function AiSplitPanel({
  taskId,
  title,
  body,
  splitTasks,
  onSplitTasksChange,
  onParentTitleChange,
  disabled = false,
}: AiSplitPanelProps) {
  const { t } = useTranslation(['dooray', 'common']);
  const [state, setState] = useState<AiPanelState>('idle');
  const [error, setError] = useState<string | null>(null);

  const { sendStreamingChat, isStreaming, streamingContent, error: streamError } = useDesignChatStream(taskId);

  // 전체 선택/해제
  const allSelected = splitTasks.length > 0 && splitTasks.every((t) => t.selected);
  const someSelected = splitTasks.some((t) => t.selected);

  const handleSelectAll = useCallback(() => {
    const newSelected = !allSelected;
    onSplitTasksChange(splitTasks.map((t) => ({ ...t, selected: newSelected })));
  }, [allSelected, splitTasks, onSplitTasksChange]);

  const handleToggle = useCallback(
    (id: string) => {
      onSplitTasksChange(
        splitTasks.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t))
      );
    },
    [splitTasks, onSplitTasksChange]
  );

  const handleUpdate = useCallback(
    (id: string, updates: Partial<Pick<SplitTask, 'title' | 'description'>>) => {
      onSplitTasksChange(
        splitTasks.map((t) => (t.id === id ? { ...t, ...updates } : t))
      );
    },
    [splitTasks, onSplitTasksChange]
  );

  const handleDelete = useCallback(
    (id: string) => {
      onSplitTasksChange(splitTasks.filter((t) => t.id !== id));
    },
    [splitTasks, onSplitTasksChange]
  );

  const handleAdd = useCallback(() => {
    const newTask: SplitTask = {
      id: `new-${Date.now()}`,
      title: '',
      description: '',
      selected: true,
    };
    onSplitTasksChange([...splitTasks, newTask]);
  }, [splitTasks, onSplitTasksChange]);

  const handleSplit = useCallback(async () => {
    if (!title.trim() && !body.trim()) {
      setError(t('dooray:ai.noContentToSplit', '분할할 내용이 없습니다.'));
      return;
    }

    if (!taskId) {
      setError(t('dooray:ai.noTaskId', 'AI 기능을 사용할 수 없습니다.'));
      return;
    }

    setState('loading');
    setError(null);

    // Limit body length to prevent request size issues
    const MAX_BODY_LENGTH = 8000;
    const truncatedBody = body.length > MAX_BODY_LENGTH
      ? body.slice(0, MAX_BODY_LENGTH) + '\n\n... (내용이 너무 길어 일부만 포함됨)'
      : body;

    try {
      const prompt = `다음 태스크를 여러 개의 서브태스크로 분할해주세요.

## 분할할 태스크
- **제목**: ${title}
- **본문**: ${truncatedBody}

## 응답 형식
먼저 분석 내용을 마크다운으로 작성하고, 마지막에 JSON 데이터를 제공해주세요.

### 1단계: 분석 (마크다운)
태스크를 분석하고 어떻게 분할할지 설명해주세요:
- 전체 태스크의 목표
- 분할 기준과 이유
- 각 서브태스크 요약 (번호 목록으로)

### 2단계: 구조화된 데이터 (JSON)
분석이 끝나면 아래 형식의 JSON을 코드 블록으로 제공해주세요:

\`\`\`json
{
  "parent_title": "상위 태스크 제목",
  "tasks": [
    { "title": "서브태스크 제목", "description": "마크다운 형식의 상세 설명" }
  ]
}
\`\`\`

## 분할 규칙
1. 각 서브태스크는 독립적으로 수행 가능해야 합니다
2. 2-7개의 서브태스크로 분할
3. **각 서브태스크의 description은 마크다운 형식으로 작성**:
   - 목표/개요를 먼저 작성
   - 구체적인 작업 항목은 bullet point(\`-\`)로 나열
   - 필요시 코드 예시나 참고사항 포함
4. 원본 본문의 관련 내용을 각 서브태스크에 적절히 분배`;

      const result = await sendStreamingChat(prompt);

      if (!result) {
        // Use stream error message if available, otherwise use default
        throw new Error(streamError || t('dooray:ai.noResponse', 'AI 응답이 없습니다.'));
      }

      // Debug: log AI response
      console.log('AI Split Response:', result.assistantMessage.content);

      const parsed = parseSplitResponse(result.assistantMessage.content);
      if (!parsed) {
        console.error('Failed to parse split response, content:', result.assistantMessage.content);
        throw new Error(t('dooray:ai.parseError', '응답을 파싱할 수 없습니다. JSON 형식을 찾을 수 없습니다.'));
      }

      // 부모 제목 업데이트
      if (parsed.parentTitle && onParentTitleChange) {
        onParentTitleChange(parsed.parentTitle);
      }

      // 분할 태스크 설정
      const newTasks: SplitTask[] = (parsed.tasks || []).map((task, index) => ({
        id: `split-${Date.now()}-${index}`,
        title: task.title,
        description: task.description,
        selected: true,
      }));

      if (newTasks.length === 0) {
        console.error('No tasks in parsed result:', parsed);
        throw new Error(t('dooray:ai.noSplitResult', '분할 결과가 없습니다. AI 응답에서 tasks를 찾을 수 없습니다.'));
      }

      if (newTasks.length === 1) {
        setError(t('dooray:ai.onlyOneTask', '분할할 내용이 없습니다. 단일 태스크로 생성하세요.'));
        setState('idle');
        return;
      }

      onSplitTasksChange(newTasks);
      setState('success');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [title, body, taskId, sendStreamingChat, onParentTitleChange, onSplitTasksChange, t]);

  const handleRetry = useCallback(() => {
    setState('idle');
    onSplitTasksChange([]);
    setError(null);
  }, [onSplitTasksChange]);

  // 아직 분할 시작 안 함
  if (state === 'idle' && splitTasks.length === 0) {
    return (
      <div className="space-y-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSplit}
          disabled={disabled || (!title.trim() && !body.trim()) || !taskId}
          className="w-full"
        >
          <Split className="h-4 w-4 mr-2" />
          {t('dooray:ai.split', '태스크 분할')}
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

  // 로딩 중
  if (state === 'loading' || isStreaming) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-center py-4 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          {t('dooray:ai.splitting', '태스크를 분할하고 있습니다...')}
        </div>
        {streamingContent && (
          <div className="p-3 border rounded-md bg-muted/30 text-sm max-h-[300px] overflow-auto">
            <WYSIWYGEditor
              value={streamingContent}
              disabled
              className="whitespace-pre-wrap break-words"
            />
          </div>
        )}
      </div>
    );
  }

  // 에러
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRetry}
          className="w-full"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          {t('common:retry', '다시 시도')}
        </Button>
      </div>
    );
  }

  // 성공 - 분할 태스크 목록
  const selectedCount = splitTasks.filter((t) => t.selected).length;

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Checkbox
            id="select-all"
            checked={allSelected}
            onCheckedChange={handleSelectAll}
            disabled={disabled}
            className={someSelected && !allSelected ? 'data-[state=checked]:bg-muted' : ''}
          />
          <Label htmlFor="select-all" className="text-sm cursor-pointer">
            {t('dooray:ai.selectAll', '전체 선택')}
            <span className="ml-2 text-muted-foreground">
              ({selectedCount}/{splitTasks.length})
            </span>
          </Label>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleRetry}
          disabled={disabled}
        >
          <RotateCcw className="h-4 w-4 mr-1" />
          {t('dooray:ai.reSplit', '다시 분할')}
        </Button>
      </div>

      {/* 태스크 목록 */}
      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {splitTasks.map((task) => (
          <SplitTaskItem
            key={task.id}
            task={task}
            onToggle={handleToggle}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            disabled={disabled}
          />
        ))}
      </div>

      {/* 추가 버튼 */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAdd}
        disabled={disabled}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        {t('dooray:ai.addTask', '태스크 추가')}
      </Button>

      {/* 선택된 태스크 없음 경고 */}
      {selectedCount === 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t('dooray:ai.noTaskSelected', '최소 1개 이상의 태스크를 선택해주세요.')}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
