import type { Adapter, Binding } from './types';
import type { Kind, Platform } from '../shared/types';

export const SENSITIVE =
  'input,textarea,form,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[data-sz-private],[data-slopzap-ui]';
export function sensitiveRoute(url: URL): boolean {
  if (
    url.hostname === 'www.linkedin.com' &&
    /^\/jobs(\/|$)/i.test(url.pathname)
  )
    return true;
  return /\/(messaging|message|messages|i\/chat|i\/communities|communities|chat|direct|inbox|compose|drafts|settings|notifications|groups|mod)(\/|$)/i.test(
    url.pathname,
  );
}
export function authoredText(node: HTMLElement | null, excluded = ''): string {
  if (!node) return '';
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const chunks: string[] = [];
  let characters = 0;
  let visited = 0;
  let current: Node | null,
    block: Element | null = null;
  while ((current = walker.nextNode())) {
    if (++visited > 2000 || characters >= 12_000) break;
    const parent = current.parentElement;
    if (
      !parent ||
      parent.closest(
        `${SENSITIVE},script,style,aside,nav,[hidden],[aria-hidden="true"]`,
      )
    )
      continue;
    if (excluded && parent.closest(excluded)) continue;
    const nextBlock = parent.closest('p,div,li,pre,blockquote,h1,h2,h3');
    if (block && block !== nextBlock) chunks.push('\n');
    const value = current.textContent
      ?.slice(0, 12_000 - characters)
      .replace(/[\t\r\n ]+/g, ' ')
      .trim();
    if (value) {
      chunks.push(value);
      characters += value.length;
    }
    block = nextBlock;
  }
  return chunks
    .join(' ')
    .replace(/ *\n */g, '\n')
    .trim()
    .slice(0, 12_000);
}
export function attributeId(node: HTMLElement | null, names: string[]): string {
  return node
    ? (names.map((name) => node.getAttribute(name)).find(Boolean) ?? '')
    : '';
}
interface Config {
  platform: Platform;
  hosts: string[];
  roots: string;
  candidates: string;
  bodies: string[];
  kind: (node: HTMLElement, parent: HTMLElement | null) => Kind;
  identity: (node: HTMLElement) => string;
  parent?: (node: HTMLElement) => HTMLElement | null;
  quote?: string;
  sensitiveRoots?: string;
  rootTitle?: string;
}
export function createAdapter(config: Config): Adapter {
  const bodyOf = (node: HTMLElement | null): HTMLElement | null => {
    if (!node) return null;
    for (const selector of config.bodies) {
      const bodies = Array.from(
        node.querySelectorAll<HTMLElement>(selector),
      ).filter(
        (body) =>
          body.closest(config.candidates) === node &&
          !body.closest(SENSITIVE) &&
          !(config.quote && body.closest(config.quote)),
      );
      // A fallback is a selector variant, not permission to guess between authors.
      if (bodies.length > 1) return null;
      if (bodies.length === 1) {
        const body = bodies[0]!;
        // A wrapper containing another unit cannot safely identify one author's body.
        return body.querySelector(config.candidates) ? null : body;
      }
    }
    return null;
  };
  return {
    platform: config.platform,
    roots: config.roots,
    candidates: config.candidates,
    matches: (url) =>
      config.hosts.includes(url.hostname) && !sensitiveRoute(url),
    isSensitive: (node) =>
      !!node.closest(SENSITIVE) ||
      !!(config.sensitiveRoots && node.closest(config.sensitiveRoots)),
    routeKey: (url) =>
      `${url.origin}${url.pathname}${config.platform === 'youtube' && url.searchParams.get('v') ? `?v=${encodeURIComponent(url.searchParams.get('v')!)}` : ''}`,
    parse(node): Binding | null {
      if (
        node.closest(SENSITIVE) ||
        (config.sensitiveRoots && node.closest(config.sensitiveRoots)) ||
        (config.quote && node.closest(config.quote))
      )
        return null;
      const body = bodyOf(node);
      if (!body) return null;
      const authored = authoredText(body, config.sensitiveRoots);
      if (!authored) return null;
      const parent = config.parent
        ? config.parent(node)
        : (node.parentElement?.closest<HTMLElement>(config.candidates) ?? null);
      const quote = config.quote
        ? node.querySelector<HTMLElement>(config.quote)
        : null;
      return {
        container: node,
        body,
        anchor: body,
        parentContainer: parent,
        unit: {
          platform: config.platform,
          kind: config.kind(node, parent),
          id: config.identity(node),
          parentId: parent ? config.identity(parent) || null : null,
          text: authored,
          parentText: authoredText(bodyOf(parent), config.sensitiveRoots).slice(
            0,
            800,
          ),
          rootText: config.rootTitle
            ? authoredText(
                document.querySelector<HTMLElement>(config.rootTitle),
                config.sensitiveRoots,
              ).slice(0, 500)
            : '',
          quotedText: authoredText(quote, config.sensitiveRoots).slice(0, 600),
        },
      };
    },
  };
}
