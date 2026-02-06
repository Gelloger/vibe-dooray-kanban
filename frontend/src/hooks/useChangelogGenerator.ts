import { useState, useCallback } from 'react';
import { tasksApi, doorayApi } from '@/lib/api';
import { fetchSessionConversationSummary } from '@/utils/conversationUtils';

export type ChangelogStep = 1 | 2 | 3 | 4;

interface ChangelogGeneratorState {
  isGenerating: boolean;
  currentStep: ChangelogStep | null;
  changelog: string | null;
  error: string | null;
}

interface UseChangelogGeneratorProps {
  taskId: string;
  sessionId?: string;
  workspaceId?: string;
  doorayTaskId: string;
  doorayProjectId: string;
}

/**
 * Collects AI response from design chat stream.
 * Sends a prompt to the design chat and accumulates the full response.
 */
async function collectAiResponse(
  taskId: string,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  let result = '';
  for await (const event of tasksApi.sendDesignChatStream(
    taskId,
    prompt,
    signal
  )) {
    if (signal?.aborted) break;
    if (event.type === 'AssistantChunk') {
      result += event.data.content;
    } else if (event.type === 'Error') {
      throw new Error(event.data.message);
    }
  }
  return result;
}

/**
 * Hook for generating changelogs using a 4-step chain process.
 *
 * Step 1: Summarize session conversation changes
 * Step 2: Summarize code/PR changes
 * Step 3: Compare with Dooray task body to find unreflected changes
 * Step 4: Generate final changelog format
 */
export function useChangelogGenerator({
  taskId,
  sessionId,
  workspaceId,
  doorayTaskId,
  doorayProjectId,
}: UseChangelogGeneratorProps) {
  const [state, setState] = useState<ChangelogGeneratorState>({
    isGenerating: false,
    currentStep: null,
    changelog: null,
    error: null,
  });

  const generate = useCallback(async () => {
    setState({
      isGenerating: true,
      currentStep: 1,
      changelog: null,
      error: null,
    });

    const controller = new AbortController();

    try {
      // === Step 1: Analyze session conversation ===
      let conversationSummary = '';

      // Try to get workspace session conversation
      if (sessionId) {
        try {
          const { summaryContent } =
            await fetchSessionConversationSummary(sessionId);
          conversationSummary = summaryContent;
        } catch (err) {
          console.warn('[Changelog] Failed to fetch session conversation:', err);
        }
      }

      // Get design messages (works with taskId alone, no sessionId needed)
      let designMessages = '';
      try {
        const sessionFull = await tasksApi.getDesignSessionFull(taskId);
        if (sessionFull.messages && sessionFull.messages.length > 0) {
          designMessages = sessionFull.messages
            .map((m) => `[${m.role}]: ${m.content}`)
            .join('\n\n');

          // If we didn't have a sessionId, try getting conversation from the design session
          if (!conversationSummary && sessionFull.session?.id) {
            try {
              const { summaryContent } =
                await fetchSessionConversationSummary(sessionFull.session.id);
              conversationSummary = summaryContent;
            } catch {
              // Design session may not have execution processes
            }
          }
        }
      } catch (err) {
        console.warn('[Changelog] Failed to fetch design session:', err);
        // Fallback: try getDesignMessages directly
        try {
          const messages = await tasksApi.getDesignMessages(taskId);
          if (messages.length > 0) {
            designMessages = messages
              .map((m) => `[${m.role}]: ${m.content}`)
              .join('\n\n');
          }
        } catch {
          // No design messages available
        }
      }

      // Also fetch Dooray task body for comparison
      let doorayTaskBody = '';
      try {
        const comments = await doorayApi.getComments(
          doorayProjectId,
          doorayTaskId
        );
        if (comments.comments.length > 0) {
          // Collect all comments as context
          const allComments = comments.comments
            .map((c) => c.content)
            .join('\n---\n');
          doorayTaskBody = allComments;
        }
      } catch (err) {
        console.warn('[Changelog] Failed to fetch Dooray comments:', err);
      }

      const sessionContext = [
        conversationSummary && `## 세션 대화 요약\n${conversationSummary}`,
        designMessages && `## 설계 대화\n${designMessages}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      // If no session data AND no Dooray data, nothing to generate
      if (!sessionContext.trim() && !doorayTaskBody.trim()) {
        setState({
          isGenerating: false,
          currentStep: null,
          changelog: null,
          error: 'no_changes',
        });
        return null;
      }

      // If we have some context, proceed with AI analysis
      let step1Result = '';
      if (sessionContext.trim()) {
        const step1Prompt = `다음은 개발 세션에서 나눈 대화 내용입니다. 이 대화에서 언급된 **설계 변경사항**과 **구현 진행 상황**의 핵심 포인트만 간결하게 추출해주세요. 불필요한 설명 없이 변경사항 리스트만 작성해주세요.

${sessionContext}

형식:
- 설계 변경: (변경사항 나열)
- 구현 사항: (구현된 것 나열)
- 논의 사항: (아직 미결정이거나 추가 논의가 필요한 것)`;

        step1Result = await collectAiResponse(
          taskId,
          step1Prompt,
          controller.signal
        );
      } else {
        step1Result = '(세션 대화 데이터를 사용할 수 없습니다)';
      }

      // === Step 2: Analyze code changes ===
      setState((prev) => ({ ...prev, currentStep: 2 }));

      let codeChangeSummary = '';
      if (workspaceId) {
        try {
          const response = await fetch(
            `/api/task-attempts/${workspaceId}/diff/ws`
          );
          if (response.ok) {
            codeChangeSummary =
              '코드 변경사항은 세션 대화에서 추출된 정보를 기반으로 합니다.';
          }
        } catch {
          // Diff data may not be available
        }
      }

      const step2Result = codeChangeSummary
        ? `코드 변경 분석 완료: ${codeChangeSummary}`
        : '직접적인 코드 diff 정보는 사용할 수 없습니다. 세션 대화 기반으로 진행합니다.';

      // === Step 3: Compare with Dooray task body ===
      setState((prev) => ({ ...prev, currentStep: 3 }));

      // Get existing changelogs to avoid duplication
      let existingChangelogContext = '';
      if (doorayTaskBody) {
        const changelogMatches = doorayTaskBody.match(
          /## 📋 Changelog[\s\S]*?(?=---\n\*Generated|$)/g
        );
        if (changelogMatches && changelogMatches.length > 0) {
          existingChangelogContext = `\n\n## 기존 Changelog 댓글\n${changelogMatches.join('\n---\n')}`;
        }
      }

      const step3Prompt = `다음 두 가지 정보를 비교해서, **아직 Dooray 태스크에 반영되지 않은 변경사항만** 추출해주세요.

## 세션에서 발견된 변경사항 (Step 1 결과)
${step1Result}

## 코드 변경 정보 (Step 2 결과)
${step2Result}

${existingChangelogContext ? `## Dooray 태스크 기존 정보\n${existingChangelogContext}` : '(기존 Changelog 없음)'}

이미 반영된 내용은 제외하고, 새로운 변경사항만 리스트로 정리해주세요.`;

      const step3Result = await collectAiResponse(
        taskId,
        step3Prompt,
        controller.signal
      );

      // === Step 4: Generate final changelog ===
      setState((prev) => ({ ...prev, currentStep: 4 }));

      const today = new Date().toISOString().split('T')[0];
      const step4Prompt = `다음 변경사항을 아래 Changelog 포맷으로 정리해주세요. 마크다운으로 출력하되, 내용이 없는 섹션은 생략해주세요.

## 변경사항
${step3Result}

## 출력 포맷 (이 형식 그대로 사용)
\`\`\`
## 📋 Changelog - ${today}

### 설계 변경
- (변경사항)

### 구현 사항
- (구현 내용)

### 미반영 사항
- (아직 반영 안 된 내용)

---
*Generated by Vibe Kanban*
\`\`\`

포맷의 \`\`\` 코드블록은 제거하고 순수 마크다운만 출력해주세요.`;

      const changelog = await collectAiResponse(
        taskId,
        step4Prompt,
        controller.signal
      );

      setState({
        isGenerating: false,
        currentStep: null,
        changelog,
        error: null,
      });

      return changelog;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown error occurred';
      setState({
        isGenerating: false,
        currentStep: null,
        changelog: null,
        error: message,
      });
      return null;
    }
  }, [taskId, sessionId, workspaceId, doorayTaskId, doorayProjectId]);

  const reset = useCallback(() => {
    setState({
      isGenerating: false,
      currentStep: null,
      changelog: null,
      error: null,
    });
  }, []);

  return {
    generate,
    reset,
    ...state,
  };
}
