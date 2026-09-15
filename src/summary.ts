export interface Summary {topic: string; subtitle: string}

/** Accept only the public, structured output of the presence-writing prompt. */
export function parseSummary(value: unknown): Summary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a summary object');
  const s = value as Record<string, unknown>;
  if (Object.keys(s).some(key => key !== 'topic' && key !== 'subtitle')) throw new Error('Unknown summary field');
  if (typeof s.topic !== 'string' || typeof s.subtitle !== 'string') throw new Error('Summary requires topic and subtitle strings');
  const topic = s.topic.replace(/\s+/gu, ' ').trim();
  let subtitle = s.subtitle.replace(/\s+/gu, ' ').trim();
  if (Array.from(topic).length < 2 || Array.from(topic).length > 120 || Array.from(subtitle).length > 120) {
    throw new Error('Summary topic must be 2–120 characters; subtitle at most 120');
  }
  if (/[\u0000-\u001f\u007f]/u.test(topic + subtitle)) throw new Error('Summary contains control characters');
  if (topic.toLocaleLowerCase() === subtitle.toLocaleLowerCase()) subtitle = '';
  return {topic, subtitle};
}
