import { defineContentScript } from 'wxt/utils/define-content-script';
import { Runtime } from '../src/content/runtime';

export default defineContentScript({
  matches: [
    'https://www.reddit.com/*',
    'https://www.youtube.com/*',
    'https://www.linkedin.com/*',
    'https://x.com/*',
    'https://twitter.com/*',
    'https://medium.com/*',
  ],
  runAt: 'document_idle',
  main(ctx) {
    const runtime = new Runtime();
    void runtime.start();
    ctx.onInvalidated(runtime.stop);
  },
});
