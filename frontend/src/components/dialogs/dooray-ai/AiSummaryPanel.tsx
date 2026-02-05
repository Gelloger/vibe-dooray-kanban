import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Sparkles, AlertCircle, RotateCcw } from 'lucide-react';
import { useDesignChatStream } from '@/hooks/useDesignSession';
import { useDoorayTemplates, useDoorayTemplate } from '@/hooks/useDooray';
import type { SummaryResult, SummaryApplyMode, AiPanelState } from './types';

export interface AiSummaryPanelProps {
  taskId?: string;
  body: string;
  onApply: (summary: string, mode: SummaryApplyMode) => void;
  disabled?: boolean;
  doorayProjectId?: string | null;
}

// Parse summary response from AI
function parseSummaryResponse(content: string): SummaryResult | null {
  try {
    // Try to find JSON in the response
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      return {
        summary: parsed.summary || '',
        keyPoints: parsed.key_points || parsed.keyPoints || [],
      };
    }

    // Try direct JSON parse
    const jsonStartIndex = content.indexOf('{');
    const jsonEndIndex = content.lastIndexOf('}');
    if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
      const jsonStr = content.slice(jsonStartIndex, jsonEndIndex + 1);
      const parsed = JSON.parse(jsonStr);
      return {
        summary: parsed.summary || '',
        keyPoints: parsed.key_points || parsed.keyPoints || [],
      };
    }

    // Fallback: use the entire response as summary
    return {
      summary: content.trim(),
      keyPoints: [],
    };
  } catch {
    // If parsing fails, use content as summary
    return {
      summary: content.trim(),
      keyPoints: [],
    };
  }
}

export function AiSummaryPanel({
  taskId,
  body,
  onApply,
  disabled = false,
  doorayProjectId,
}: AiSummaryPanelProps) {
  const { t } = useTranslation(['dooray', 'common']);
  const [state, setState] = useState<AiPanelState>('idle');
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [applyMode, setApplyMode] = useState<SummaryApplyMode>('replace');
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const { sendStreamingChat, isStreaming, streamingContent, error: streamError } = useDesignChatStream(taskId);
  const { templates, isLoading: isLoadingTemplates } = useDoorayTemplates(doorayProjectId ?? null);
  const { template: selectedTemplate } = useDoorayTemplate(doorayProjectId ?? null, selectedTemplateId);

  const handleSummarize = useCallback(async () => {
    if (!body.trim() || body.trim().length < 20) {
      setError(t('dooray:ai.bodyTooShort', '본문이 너무 짧습니다.'));
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
      let prompt: string;

      if (selectedTemplate?.body?.content) {
        // 템플릿 기반 요약
        prompt = `당신은 문서 작성 전문가입니다. 아래 원본 내용을 분석하여 주어진 템플릿의 각 항목을 채워주세요.

## 작성해야 할 템플릿
\`\`\`
${selectedTemplate.body.content}
\`\`\`

## 원본 내용 (이 내용을 기반으로 템플릿을 작성)
${truncatedBody}

## 작성 지침
1. 템플릿의 구조와 형식을 그대로 유지하세요
2. 템플릿의 각 섹션/항목을 원본 내용에서 추출한 정보로 채우세요
3. 원본에 해당 정보가 없는 항목은 "[정보 없음]"으로 표시하세요
4. 마크다운 형식을 유지하세요
5. **Todo/할일 항목 작성 시 추상화 규칙**:
   - 구체적인 메소드명, 쿼리문, 코드 스니펫은 포함하지 마세요
   - "~기능 구현", "~처리 로직 추가", "~API 연동" 등 기능 단위로 추상화하세요
   - 예시) ❌ "getUserById() 메소드 구현" → ✅ "사용자 조회 기능 구현"
   - 예시) ❌ "SELECT * FROM users WHERE..." → ✅ "사용자 데이터 조회 쿼리 작성"

## 출력 형식
JSON 형식으로 응답해주세요:
\`\`\`json
{
  "summary": "템플릿 구조를 유지하면서 내용이 채워진 완성된 문서 (마크다운)",
  "key_points": ["원본에서 추출한 핵심 포인트 1", "핵심 포인트 2", ...]
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

      const result = await sendStreamingChat(prompt);

      if (!result) {
        // Use stream error message if available, otherwise use default
        throw new Error(streamError || t('dooray:ai.noResponse', 'AI 응답이 없습니다.'));
      }

      const parsed = parseSummaryResponse(result.assistantMessage.content);
      if (!parsed || !parsed.summary) {
        throw new Error(t('dooray:ai.parseError', '응답을 파싱할 수 없습니다.'));
      }

      setSummary(parsed);
      setState('success');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [body, taskId, sendStreamingChat, t, selectedTemplate]);

  const handleApply = useCallback(() => {
    if (!summary) return;
    onApply(summary.summary, applyMode);
  }, [summary, applyMode, onApply]);

  const handleRetry = useCallback(() => {
    setState('idle');
    setSummary(null);
    setError(null);
  }, []);

  // 아직 요약 시작 안 함
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
                    {tmpl.templateName}
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

  // 로딩 중
  if (state === 'loading' || isStreaming) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-center py-4 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          {t('dooray:ai.summarizing', '본문을 분석하고 있습니다...')}
        </div>
        {streamingContent && (
          <div className="p-3 border rounded-md bg-muted/30 text-sm max-h-[200px] overflow-y-auto">
            <pre className="whitespace-pre-wrap select-text">{streamingContent}</pre>
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

  // 성공 - 결과 표시
  return (
    <div className="space-y-4">
      {/* 요약 결과 미리보기 */}
      <div className="p-3 border rounded-md bg-muted/30 max-h-[300px] overflow-y-auto">
        <Label className="text-sm font-medium mb-2 block">
          {t('dooray:ai.summaryResult', '요약 결과')}
        </Label>
        <p className="text-sm whitespace-pre-wrap select-text">{summary?.summary}</p>

        {summary?.keyPoints && summary.keyPoints.length > 0 && (
          <div className="mt-3">
            <Label className="text-xs text-muted-foreground mb-1 block">
              {t('dooray:ai.keyPoints', '핵심 포인트')}
            </Label>
            <ul className="text-sm list-disc list-inside space-y-1">
              {summary.keyPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 적용 방식 선택 */}
      <div className="space-y-2">
        <Label className="text-sm">{t('dooray:ai.applyMode', '적용 방식')}</Label>
        <RadioGroup
          value={applyMode}
          onValueChange={(v: string) => setApplyMode(v as SummaryApplyMode)}
          className="space-y-1"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="replace" id="apply-replace" />
            <Label htmlFor="apply-replace" className="text-sm font-normal cursor-pointer">
              {t('dooray:ai.applyReplace', '본문 대체')}
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="prepend" id="apply-prepend" />
            <Label htmlFor="apply-prepend" className="text-sm font-normal cursor-pointer">
              {t('dooray:ai.applyPrepend', '본문 상단에 추가')}
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="title" id="apply-title" />
            <Label htmlFor="apply-title" className="text-sm font-normal cursor-pointer">
              {t('dooray:ai.applyTitle', '제목으로 사용')}
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* 버튼 */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRetry}
          className="flex-1"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          {t('dooray:ai.reSummarize', '다시 요약')}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleApply}
          className="flex-1"
        >
          {t('common:apply', '적용')}
        </Button>
      </div>
    </div>
  );
}
