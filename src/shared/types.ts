export type Platform =
  'linkedin' | 'x' | 'youtube' | 'reddit' | 'medium' | 'synthetic';
export type Mode = 'normal' | 'blocker' | 'only' | 'goggles';
export type Kind =
  | 'post'
  | 'comment'
  | 'reply'
  | 'quote_commentary'
  | 'article'
  | 'article_response';
export interface Settings {
  debug: boolean;
  onDevice: boolean;
  enabled: boolean;
  mode: Mode;
  blockerThreshold: number;
  onlyThreshold: number;
  sites: Record<Exclude<Platform, 'synthetic'>, boolean>;
}
export const DEFAULT_SETTINGS: Settings = {
  debug: false,
  onDevice: false,
  enabled: true,
  mode: 'goggles',
  blockerThreshold: 0.85,
  onlyThreshold: 0.7,
  sites: { linkedin: true, x: true, youtube: true, reddit: true, medium: true },
};
export interface Unit {
  platform: Platform;
  kind: Kind;
  id: string;
  parentId: string | null;
  text: string;
  parentText: string;
  rootText: string;
  quotedText: string;
}
export interface Result {
  fingerprint: string;
  status: 'classified' | 'insufficient_evidence';
  score: number;
  evidence: number;
  reasons: string[];
  version: string;
  automaticHide: boolean;
}
export interface Snapshot {
  analysed: number;
  pending: number;
  score: number | null;
  corrected: number;
}
export type Verdict = 'not_slop' | 'slop';
export const CLASSIFIER_VERSION = 'provisional-features-v4:reference-guide-v1';
export function parseSettings(value: unknown): Settings {
  const input =
    value && typeof value === 'object' ? (value as Partial<Settings>) : {};
  const threshold = (n: unknown, fallback: number, minimum: number) =>
    typeof n === 'number' && Number.isFinite(n)
      ? Math.min(0.95, Math.max(minimum, n))
      : fallback;
  return {
    debug: input.debug === true,
    onDevice: input.onDevice === true,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
    mode: ['normal', 'blocker', 'only', 'goggles'].includes(input.mode ?? '')
      ? input.mode!
      : 'goggles',
    blockerThreshold: threshold(input.blockerThreshold, 0.85, 0.75),
    onlyThreshold: threshold(input.onlyThreshold, 0.7, 0.5),
    sites: Object.fromEntries(
      Object.keys(DEFAULT_SETTINGS.sites).map((site) => [
        site,
        typeof input.sites?.[site as keyof Settings['sites']] === 'boolean'
          ? input.sites[site as keyof Settings['sites']]
          : true,
      ]),
    ) as Settings['sites'],
  };
}
