import type { Platform, Unit } from '../shared/types';

export interface Binding {
  container: HTMLElement;
  body: HTMLElement;
  anchor: HTMLElement;
  parentContainer: HTMLElement | null;
  unit: Unit;
}
export interface Adapter {
  platform: Platform;
  roots: string;
  candidates: string;
  matches(url: URL): boolean;
  routeKey(url: URL): string;
  parse(node: HTMLElement): Binding | null;
}
