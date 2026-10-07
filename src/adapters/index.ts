import { reddit } from './reddit';
import { youtube } from './youtube';
import { linkedin } from './linkedin';
import { x } from './x';
import { medium } from './medium';
import { synthetic } from './synthetic';
import type { Adapter } from './types';
export const adapters: Adapter[] = [
  reddit,
  youtube,
  linkedin,
  x,
  medium,
  synthetic,
];
export function adapterFor(url: URL): Adapter | undefined {
  return adapters.find((adapter) => adapter.matches(url));
}
