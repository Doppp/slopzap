import type { Unit } from './types';

export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export async function fingerprint(unit: Unit, route: string): Promise<string> {
  // Context affects classification: parent edits must invalidate child results too.
  const fields = [
    'slopzap-fp-v2',
    unit.platform,
    unit.kind,
    unit.id,
    unit.parentId ?? '',
    route,
    normalize(unit.text),
    normalize(unit.parentText),
    normalize(unit.rootText),
    normalize(unit.quotedText),
  ];
  const bytes = new TextEncoder().encode(JSON.stringify(fields));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
