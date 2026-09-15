/** Extract only assistant text blocks, never tool output or reasoning blocks. */
export function assistantText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const m = message as {role?: unknown; content?: unknown};
  if (m.role !== 'assistant') return '';
  if (typeof m.content === 'string') return boundedResponse(m.content);
  if (!Array.isArray(m.content)) return '';
  return boundedResponse(m.content.filter(p => p && p.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n'));
}
export function boundedResponse(value: unknown): string {
  return typeof value === 'string' ? Array.from(value.trim()).slice(0, 4000).join('') : '';
}
