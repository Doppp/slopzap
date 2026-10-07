import type { Binding } from '../adapters/types';
import type { Result, Verdict, Mode } from '../shared/types';
import type { Presentation } from '../scoring/presentation';

export class Renderer {
  private ui: HTMLElement | undefined;
  private hidden = false;
  private reveal = false;
  private originalHidden: HTMLElement['hidden'];
  constructor(
    private binding: Binding,
    private feedback: (verdict: Verdict) => void,
  ) {
    this.originalHidden = binding.body.hidden;
  }
  render(
    presentation: Presentation,
    mode: Mode,
    result: Result | undefined,
    verdict: Verdict | undefined,
  ): void {
    this.removeUi();
    this.binding.body.hidden = this.originalHidden;
    this.hidden = false;
    if (mode === 'normal' || !result) return;
    // Hiding a body containing descendants would orphan the branch. Annotate instead.
    if (
      this.binding.body.querySelector(
        'shreddit-comment,ytd-comment-renderer,article,[data-sz-unit]',
      )
    )
      presentation = 'visible';
    const collapse = presentation !== 'visible' && !this.reveal;
    if (collapse) {
      this.binding.body.hidden = true;
      this.hidden = true;
    }
    const host = document.createElement('span');
    host.dataset.slopzapUi = 'true';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent =
      ':host{display:block;margin:4px 0;font:12px/1.5 system-ui;color:inherit}button{font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:6px;padding:2px 6px;cursor:pointer;margin-inline:3px}button:focus-visible{outline:2px solid #b87900;outline-offset:2px}span{opacity:.8}';
    shadow.append(style);
    const label = document.createElement('span');
    const value = verdict
      ? verdict === 'slop'
        ? 100
        : 0
      : Math.round(result.score * 100);
    label.textContent = collapse
      ? presentation === 'context'
        ? '⚡ Parent context'
        : `⚡ SlopZap hid this · ${value} Slop Score`
      : result.status === 'classified'
        ? `⚡ ${value}% Slop Score${verdict ? ' · locally corrected' : ' · provisional'}`
        : '⚡ Not enough evidence';
    label.title = `${result.reasons.join(' · ')}. Slop Score estimates low-information synthetic signals; it does not prove AI authorship.`;
    shadow.append(label);
    if (presentation !== 'visible' || this.reveal)
      shadow.append(
        this.button(this.reveal ? 'Hide' : 'Show', () => {
          this.reveal = !this.reveal;
          this.render(presentation, mode, result, verdict);
        }),
      );
    shadow.append(
      this.button('Not slop', () => this.feedback('not_slop')),
      this.button('Slop', () => this.feedback('slop')),
    );
    if (collapse) this.binding.body.before(host);
    else this.binding.body.after(host);
    this.ui = host;
  }
  private button(label: string, click: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-label', `SlopZap: ${label}`);
    button.addEventListener('click', click);
    return button;
  }
  private removeUi(): void {
    this.ui?.remove();
    this.ui = undefined;
  }
  resetReveal(): void {
    this.reveal = false;
  }
  cleanup(): void {
    this.removeUi();
    if (this.hidden) this.binding.body.hidden = this.originalHidden;
    this.hidden = false;
  }
}
