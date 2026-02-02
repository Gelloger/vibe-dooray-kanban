import type { PatchTypeWithKey } from '@/hooks/useConversationHistory';
import type { PatchType, ExecutionProcess, NormalizedEntry } from 'shared/types';
import { streamJsonPatchEntries } from './streamJsonPatchEntries';
import { applyPatch } from 'rfc6902';

interface ConversationContent {
  conversationContent: string;
  summaryContent: string;
}

/**
 * Fetch normalized logs for a single execution process via WebSocket
 */
async function fetchExecutionProcessLogs(executionProcessId: string): Promise<PatchType[]> {
  const url = `/api/execution-processes/${executionProcessId}/normalized-logs/ws`;

  return new Promise<PatchType[]>((resolve) => {
    let resolved = false;

    const controller = streamJsonPatchEntries<PatchType>(url, {
      onFinished: (allEntries) => {
        if (!resolved) {
          resolved = true;
          controller.close();
          resolve(allEntries);
        }
      },
      onError: (err) => {
        console.warn(`Error loading entries for execution process ${executionProcessId}`, err);
        if (!resolved) {
          resolved = true;
          controller.close();
          resolve(controller.getEntries());
        }
      },
    });

    // Timeout after 30 seconds - resolve with whatever we have
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        const entries = controller.getEntries();
        controller.close();
        resolve(entries);
      }
    }, 30000);
  });
}

/**
 * Fetch execution processes for a session via WebSocket with JSON Patch
 */
async function fetchExecutionProcessesForSession(sessionId: string): Promise<ExecutionProcess[]> {
  const url = `/api/execution-processes/stream/session/ws?session_id=${sessionId}`;
  const wsUrl = url.replace(/^http/, 'ws');

  return new Promise<ExecutionProcess[]>((resolve) => {
    type ExecutionProcessState = {
      execution_processes: Record<string, ExecutionProcess>;
    };

    let resolved = false;
    const state: ExecutionProcessState = { execution_processes: {} };

    const ws = new WebSocket(wsUrl);

    const cleanup = () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Handle JsonPatch messages
        if (msg.JsonPatch) {
          applyPatch(state, msg.JsonPatch);
        }

        // Handle Ready messages - initial data has been sent
        if (msg.Ready) {
          // Once ready, we have all the execution processes
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve(Object.values(state.execution_processes));
          }
        }

        // Handle finished messages
        if (msg.finished !== undefined) {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve(Object.values(state.execution_processes));
          }
        }
      } catch (err) {
        console.warn('Error processing execution processes message:', err);
      }
    };

    ws.onerror = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve([]);
      }
    };

    ws.onclose = () => {
      if (!resolved) {
        resolved = true;
        resolve(Object.values(state.execution_processes));
      }
    };

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(Object.values(state.execution_processes));
      }
    }, 10000);
  });
}

/**
 * Fetch and summarize conversation for a session
 * This is used when the component is outside of EntriesProvider context
 */
export async function fetchSessionConversationSummary(sessionId: string): Promise<ConversationContent> {
  try {
    // 1. Get execution processes for the session
    const executionProcesses = await fetchExecutionProcessesForSession(sessionId);

    // Filter to only coding agent processes (not setup scripts, etc.)
    const codingAgentProcesses = executionProcesses.filter(
      (ep) =>
        ep.executor_action.typ.type === 'CodingAgentInitialRequest' ||
        ep.executor_action.typ.type === 'CodingAgentFollowUpRequest' ||
        ep.executor_action.typ.type === 'ReviewRequest'
    );

    // Sort by created_at
    codingAgentProcesses.sort(
      (a, b) =>
        new Date(a.created_at as unknown as string).getTime() -
        new Date(b.created_at as unknown as string).getTime()
    );

    // 2. Fetch entries for each execution process
    const allEntries: PatchTypeWithKey[] = [];

    for (const ep of codingAgentProcesses) {
      // Add user message from executor action
      const actionType = ep.executor_action.typ;
      if ('prompt' in actionType) {
        const userEntry: NormalizedEntry = {
          entry_type: { type: 'user_message' },
          content: actionType.prompt as string,
          timestamp: null,
        };
        allEntries.push({
          type: 'NORMALIZED_ENTRY',
          content: userEntry,
          patchKey: `${ep.id}:user`,
          executionProcessId: ep.id,
        });
      }

      // Fetch and add assistant entries
      const entries = await fetchExecutionProcessLogs(ep.id);
      entries.forEach((entry, index) => {
        allEntries.push({
          ...entry,
          patchKey: `${ep.id}:${index}`,
          executionProcessId: ep.id,
        } as PatchTypeWithKey);
      });
    }

    // Debug logging
    console.log('[Dooray] Execution processes found:', codingAgentProcesses.length);
    console.log('[Dooray] Total entries collected:', allEntries.length);
    console.log('[Dooray] Entry types:', allEntries.map(e => e.type === 'NORMALIZED_ENTRY' ? e.content.entry_type.type : e.type));

    // 3. Extract summary
    return extractConversationFromEntries(allEntries);
  } catch (error) {
    console.error('Error fetching session conversation:', error);
    return {
      conversationContent: '',
      summaryContent: '_대화 내용을 불러올 수 없습니다._',
    };
  }
}

interface FileChange {
  path: string;
  action: 'write' | 'edit' | 'delete' | 'rename';
}

interface ToolUseEntry {
  toolName: string;
  filePath?: string;
  action?: string;
}

/**
 * Extract conversation content from entries for saving to Dooray
 */
export function extractConversationFromEntries(entries: PatchTypeWithKey[]): ConversationContent {
  const conversationLines: string[] = ['## 대화 내용\n'];
  const qaList: { question: string; answer: string }[] = [];
  const fileChanges: FileChange[] = [];
  const toolUses: ToolUseEntry[] = [];

  let currentQuestion = '';
  let lastAssistantMessage = '';

  for (const entry of entries) {
    if (entry.type !== 'NORMALIZED_ENTRY') continue;

    const entryType = entry.content.entry_type;

    if (entryType.type === 'user_message') {
      currentQuestion = entry.content.content || '';
      conversationLines.push(`### 사용자\n${currentQuestion}\n`);
    } else if (entryType.type === 'assistant_message') {
      const answer = entry.content.content || '';
      lastAssistantMessage = answer;
      conversationLines.push(`### Claude\n${answer}\n`);
      if (currentQuestion) {
        qaList.push({ question: currentQuestion, answer });
        currentQuestion = '';
      }
    } else if (entryType.type === 'tool_use') {
      const toolName = entryType.tool_name;
      const actionType = entryType.action_type;

      // Track file changes based on tool name
      if (actionType && 'file_path' in actionType) {
        const filePath = actionType.file_path as string;
        // Use tool name to determine action type
        if (toolName === 'Write') {
          fileChanges.push({ path: filePath, action: 'write' });
          toolUses.push({ toolName, filePath, action: 'write' });
        } else if (toolName === 'Edit') {
          fileChanges.push({ path: filePath, action: 'edit' });
          toolUses.push({ toolName, filePath, action: 'edit' });
        }
      }
    }
  }

  const conversationContent = conversationLines.join('\n');

  // Debug logging
  console.log('[Dooray] Q&A pairs found:', qaList.length);
  console.log('[Dooray] File changes found:', fileChanges.length);

  // Create enhanced summary
  const summaryLines: string[] = [];

  // 1. Title and overview
  summaryLines.push('## 작업 요약\n');

  // 2. Initial request (first question) - collapsible with full text
  if (qaList.length > 0) {
    const firstQuestion = qaList[0].question;
    const summaryTitle = firstQuestion.length > 80 ? firstQuestion.substring(0, 80) + '...' : firstQuestion;
    summaryLines.push(`### 초기 요청\n`);
    summaryLines.push(`<details>`);
    summaryLines.push(`<summary>${summaryTitle}</summary>\n`);
    summaryLines.push(firstQuestion);
    summaryLines.push(`</details>\n`);
  }

  // 3. Key Q&A exchanges (last 3 meaningful exchanges) - collapsible with full text
  if (qaList.length > 1) {
    summaryLines.push('### 주요 의사결정\n');
    // Get last 3 Q&A pairs (excluding the first one which is shown above)
    const recentQAs = qaList.slice(-3);
    for (let i = 0; i < recentQAs.length; i++) {
      const qa = recentQAs[i];
      // Truncate question for summary title only
      const summaryTitle = qa.question.length > 80 ? qa.question.substring(0, 80) + '...' : qa.question;

      summaryLines.push(`<details>`);
      summaryLines.push(`<summary><b>${i + 1}.</b> ${summaryTitle}</summary>\n`);
      summaryLines.push(`**🧑 사용자:**\n${qa.question}\n`);
      summaryLines.push(`**🤖 Claude:**\n${qa.answer}`);
      summaryLines.push(`</details>\n`);
    }
  }

  // 4. File changes summary
  if (fileChanges.length > 0) {
    summaryLines.push('### 변경된 파일\n');
    const uniqueFiles = [...new Set(fileChanges.map(f => f.path))];
    const displayFiles = uniqueFiles.slice(0, 15); // Show max 15 files
    for (const file of displayFiles) {
      const changes = fileChanges.filter(f => f.path === file);
      const actions = [...new Set(changes.map(c => c.action))];
      const actionStr = actions.map(a => a === 'write' ? '생성' : a === 'edit' ? '수정' : a).join('/');
      // Show just filename for readability, full path in code block
      const fileName = file.split('/').pop() || file;
      summaryLines.push(`- **${fileName}** (${actionStr})`);
      summaryLines.push(`  \`${file}\``);
    }
    if (uniqueFiles.length > 15) {
      summaryLines.push(`- ... 외 ${uniqueFiles.length - 15}개 파일`);
    }
    summaryLines.push('');
  }

  // 5. Final conclusion (last assistant message) - collapsible with full text
  if (lastAssistantMessage) {
    const summaryTitle = lastAssistantMessage.length > 80 ? lastAssistantMessage.substring(0, 80) + '...' : lastAssistantMessage;
    summaryLines.push('### 최종 결과\n');
    summaryLines.push(`<details>`);
    summaryLines.push(`<summary>${summaryTitle}</summary>\n`);
    summaryLines.push(lastAssistantMessage);
    summaryLines.push(`</details>\n`);
  }

  // 6. Stats
  summaryLines.push('---');
  summaryLines.push(`📊 **통계:** 총 ${qaList.length}회 대화, ${fileChanges.length}개 파일 변경`);

  const summaryContent = summaryLines.join('\n');

  return { conversationContent, summaryContent };
}

/**
 * Extract BMAD-generated output from conversation entries.
 * Looks for markdown headings in assistant messages to extract title and body.
 * Used for pre-filling the Create Dooray Task dialog.
 */
export function extractBmadOutput(entries: PatchTypeWithKey[]): {
  title: string;
  body: string;
} {
  // Find the last assistant message that contains BMAD-like content
  let lastAssistantContent = '';

  for (const entry of entries) {
    if (entry.type !== 'NORMALIZED_ENTRY') continue;

    const entryType = entry.content.entry_type;
    if (entryType.type === 'assistant_message') {
      const content = entry.content.content || '';
      // Look for BMAD-style content (has headings and structured format)
      if (content.includes('#') || content.includes('##')) {
        lastAssistantContent = content;
      }
    }
  }

  if (!lastAssistantContent) {
    return { title: '', body: '' };
  }

  // Extract title from the first heading (# or ##)
  const lines = lastAssistantContent.split('\n');
  let title = '';
  let bodyStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Match # heading or ## heading
    const headingMatch = line.match(/^#{1,2}\s+(.+)$/);
    if (headingMatch) {
      title = headingMatch[1].trim();
      bodyStartIndex = i + 1;
      break;
    }
  }

  // If no heading found, use first non-empty line as title
  if (!title) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        title = line.length > 100 ? line.substring(0, 100) + '...' : line;
        bodyStartIndex = i + 1;
        break;
      }
    }
  }

  // Rest of the content is the body
  const body = lines.slice(bodyStartIndex).join('\n').trim();

  return { title, body };
}
