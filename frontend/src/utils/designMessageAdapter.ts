import type {
  DesignMessage,
  NormalizedEntry,
  NormalizedEntryType,
  ToolStatus,
} from 'shared/types';

export interface ToolEvent {
  type: 'tool_use' | 'tool_result';
  toolName: string;
  content: string;
}

/**
 * Convert DesignMessage to NormalizedEntry for use with DisplayConversationEntry
 */
export function designMessageToNormalizedEntry(
  message: DesignMessage
): NormalizedEntry {
  const entryType: NormalizedEntryType =
    message.role === 'user'
      ? { type: 'user_message' }
      : { type: 'assistant_message' };

  return {
    timestamp: message.created_at,
    entry_type: entryType,
    content: message.content,
  };
}

/**
 * Format tool input for human-readable display
 */
function formatToolInput(toolName: string, input: string): string {
  try {
    const args = JSON.parse(input || '{}');

    // Format based on common tool patterns
    if (toolName === 'Read' && args.file_path) {
      return `📖 ${args.file_path}`;
    }
    if (toolName === 'Glob' && args.pattern) {
      return `🔍 ${args.pattern}${args.path ? ` in ${args.path}` : ''}`;
    }
    if (toolName === 'Grep' && args.pattern) {
      return `🔎 "${args.pattern}"${args.path ? ` in ${args.path}` : ''}`;
    }
    if (toolName === 'LS' || toolName === 'ListDir') {
      return `📁 ${args.path || args.directory || '.'}`;
    }
    if (toolName === 'LSP') {
      return `🔗 ${args.operation || 'operation'}: ${args.filePath || ''}`;
    }

    // Default: show tool name with first meaningful arg
    const firstValue = Object.values(args)[0];
    if (typeof firstValue === 'string' && firstValue.length < 100) {
      return `${toolName}: ${firstValue}`;
    }
    return toolName;
  } catch {
    return toolName;
  }
}

/**
 * Create a NormalizedEntry for tool use start
 */
export function createToolUseEntry(
  toolName: string,
  input: string
): NormalizedEntry {
  const displayText = formatToolInput(toolName, input);

  return {
    timestamp: new Date().toISOString(),
    entry_type: {
      type: 'tool_use',
      tool_name: toolName,
      action_type: {
        action: 'tool',
        tool_name: toolName,
        arguments: JSON.parse(input || '{}'),
        result: null,
      },
      status: { status: 'created' } as ToolStatus,
    },
    content: displayText,
  };
}

/**
 * Format tool output for display (truncate if too long)
 */
function formatToolOutput(output: string, maxLength: number = 500): string {
  const trimmed = output.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return trimmed.slice(0, maxLength) + '\n... (truncated)';
}

/**
 * Create a NormalizedEntry for tool result
 */
export function createToolResultEntry(
  toolName: string,
  output: string
): NormalizedEntry {
  const displayOutput = formatToolOutput(output);

  return {
    timestamp: new Date().toISOString(),
    entry_type: {
      type: 'tool_use',
      tool_name: toolName,
      action_type: {
        action: 'tool',
        tool_name: toolName,
        arguments: null,
        result: {
          type: { type: 'markdown' },
          value: displayOutput,
        },
      },
      status: { status: 'success' } as ToolStatus,
    },
    content: `✓ ${toolName} completed`,
  };
}

/**
 * Create a NormalizedEntry for streaming content (assistant response in progress)
 */
export function createStreamingEntry(content: string): NormalizedEntry {
  return {
    timestamp: new Date().toISOString(),
    entry_type: { type: 'assistant_message' },
    content: content,
  };
}

/**
 * Create a loading indicator entry
 */
export function createLoadingEntry(): NormalizedEntry {
  return {
    timestamp: new Date().toISOString(),
    entry_type: { type: 'loading' },
    content: '',
  };
}
