import type { DesignMessage } from 'shared/types';

/**
 * Formats design session messages into a markdown document.
 * This can be used to sync design discussions to Dooray task body.
 */
export function formatDesignMessagesToMarkdown(messages: DesignMessage[]): string {
  if (!messages || messages.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('## Design Discussion');
  lines.push('');

  for (const message of messages) {
    const roleLabel = message.role === 'user' ? 'User' : 'Assistant';
    lines.push(`**[${roleLabel}]:** ${message.content}`);
    lines.push('');
  }

  lines.push('---');
  lines.push(`_Last synced: ${new Date().toLocaleString()}_`);

  return lines.join('\n');
}
