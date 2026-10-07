import type { Platform, Unit } from '../shared/types';

export interface Binding {
  container: HTMLElement;
  body: HTMLElement;
  anchor: HTMLElement;
  unit: Unit;
}
export interface Adapter {
  platform: Platform;
  roots: string;
  candidates: string;
  matches(url: URL): boolean;
  parse(node: HTMLElement): Binding | null;
}
