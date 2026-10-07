import type { Adapter, Binding } from './types';
import type { Kind, Platform } from '../shared/types';

const sensitive =
  'input,textarea,form,[contenteditable="true"],[role="textbox"],[data-sz-private]';
export function sensitiveRoute(url: URL): boolean {
  return /\/(messaging|messages|i\/chat|chat|direct|inbox|compose|drafts|settings|notifications)(\/|$)/i.test(
    url.pathname,
  );
}
function text(node: HTMLElement | null): string {
  if (!node) return '';
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const chunks: string[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const parent = current.parentElement;
    if (
      !parent ||
      parent.closest(
        `${sensitive},script,style,[data-slopzap-ui],[hidden],[aria-hidden="true"]`,
      )
    )
      continue;
    chunks.push(current.textContent ?? '');
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, 12_000);
}
function make(
  platform: Platform,
  hosts: string[],
  roots: string,
  candidates: string,
  bodies: string[],
  idAttributes: string[],
  defaultKind: Kind,
): Adapter {
  return {
    platform,
    roots,
    candidates,
    matches: (url) => hosts.includes(url.hostname) && !sensitiveRoute(url),
    parse(node): Binding | null {
      if (node.closest(sensitive) || node.closest('[data-slopzap-ui]'))
        return null;
      const body = bodies
        .map((selector) =>
          node.matches(selector)
            ? node
            : node.querySelector<HTMLElement>(selector),
        )
        .find(Boolean);
      if (!body || body.closest(sensitive)) return null;
      // Do not extract a nested unit as the container's own authored body.
      if (body.closest(candidates) !== node) return null;
      const authored = text(body);
      if (!authored) return null;
      const link = node.querySelector<HTMLAnchorElement>(
        'a[href*="/status/"],a[href*="/comments/"],a[href*="comment="]',
      );
      const id =
        idAttributes.map((attr) => node.getAttribute(attr)).find(Boolean) ??
        link?.pathname ??
        '';
      const parent =
        node.parentElement?.closest<HTMLElement>(candidates) ?? null;
      const parentBody = parent
        ? (bodies
            .map((selector) => parent.querySelector<HTMLElement>(selector))
            .find(Boolean) ?? null)
        : null;
      const parentId = parent
        ? (idAttributes
            .map((attr) => parent.getAttribute(attr))
            .find(Boolean) ?? null)
        : null;
      const quoted =
        platform === 'x'
          ? node.querySelector<HTMLElement>(
              '[data-testid="quoteTweet"],[data-sz-quote]',
            )
          : null;
      if (quoted?.contains(body)) return null;
      const kind: Kind =
        node.matches('shreddit-comment,[data-sz-kind="reply"]') || parent
          ? 'reply'
          : defaultKind;
      return {
        container: node,
        body,
        anchor: body,
        unit: {
          platform,
          kind,
          id,
          parentId,
          text: authored,
          parentText: text(parentBody).slice(0, 800),
          rootText: text(document.querySelector<HTMLElement>('h1')).slice(
            0,
            500,
          ),
          quotedText: text(quoted).slice(0, 600),
        },
      };
    },
  };
}
export const adapters: Adapter[] = [
  make(
    'reddit',
    ['www.reddit.com'],
    'main,shreddit-app',
    'shreddit-comment,shreddit-post,[data-testid="comment"],[data-sz-unit]',
    [
      '[slot="comment"]',
      '[slot="text-body"]',
      '[data-testid="comment-body"]',
      '[data-sz-body]',
    ],
    ['thingid', 'id', 'data-fullname', 'data-sz-id'],
    'post',
  ),
  make(
    'youtube',
    ['www.youtube.com'],
    'ytd-comments',
    'ytd-comment-thread-renderer,ytd-comment-view-model,ytd-comment-renderer',
    ['#content-text'],
    ['data-comment-id', 'id'],
    'comment',
  ),
  make(
    'linkedin',
    ['www.linkedin.com'],
    'main',
    '.feed-shared-update-v2,.comments-comment-item,.comments-comment-entity',
    [
      '.update-components-text',
      '.comments-comment-item__main-content',
      '.comments-comment-item-content-body',
      '.comments-comment-entity__content',
    ],
    ['data-urn', 'data-id', 'id'],
    'post',
  ),
  make(
    'x',
    ['x.com', 'twitter.com'],
    'main',
    'article[data-testid="tweet"]',
    ['[data-testid="tweetText"]'],
    ['data-tweet-id', 'id'],
    'post',
  ),
  make(
    'medium',
    ['medium.com'],
    'main,article',
    'article,[data-testid="response"]',
    [
      '[data-testid="storyContent"]',
      'section',
      '[data-testid="responseContent"]',
    ],
    ['data-post-id', 'id'],
    'article',
  ),
];
export function adapterFor(url: URL): Adapter | undefined {
  return adapters.find((adapter) => adapter.matches(url));
}
