// Maintainer-authored weak cues, not an authorship dictionary or learned model.
export const REFERENCE_VERSION = 'reference-guide-v1';
const patterns = [
  {
    family: 'generic',
    pattern:
      /\b(?:absolutely|well said|couldn['’]t agree more|spot on|so true)\b/i,
  },
  {
    family: 'generic',
    pattern: /\b(?:great insight|valuable perspective|game changer)\b/i,
  },
  { family: 'generic', pattern: /\bthank you for sharing\b/i },
  { family: 'formulaic', pattern: /\b(?:ever[- ]evolving|in today['’]s)\b/i },
  {
    family: 'formulaic',
    pattern:
      /\b(?:not just [^.!?\n]{1,120}\bbut\b|it['’]s not about [^.!?\n]{1,120}\bit['’]s about\b)/i,
  },
  {
    family: 'formulaic',
    pattern: /\b(?:in conclusion|unlocking [^.!?\n]{1,60}\bpotential)\b/i,
  },
] as const;

export function authoredProse(text: string): string {
  // Literal quotations and code are not evidence of the target author's style.
  // This is deliberately not a general-purpose quote or sarcasm parser.
  return text.replace(/```[\s\S]*?```|`[^`\n]*`|"[^"\n]*"|“[^”\n]*”/g, ' ');
}
export function phraseSignals(text: string) {
  const prose = authoredProse(text);
  const generic = patterns.filter(
    (rule) => rule.family === 'generic' && rule.pattern.test(prose),
  ).length;
  const formulaic = patterns.filter(
    (rule) => rule.family === 'formulaic' && rule.pattern.test(prose),
  ).length;
  return { generic, formulaic };
}
