import { browser } from 'wxt/browser';
import { Runtime } from '../../src/content/runtime';
import './style.css';

const feed = document.querySelector<HTMLElement>('[data-sz-feed]')!;
let count = 0,
  thread = 1;
function load(amount = 20) {
  const fragment = document.createDocumentFragment();
  for (let n = 0; n < amount; n++) {
    const id = count++;
    const comment = document.createElement('article');
    comment.dataset.szUnit = 'true';
    comment.dataset.szId = `${thread}-${id}`;
    const body = document.createElement('p');
    body.dataset.szBody = 'true';
    body.textContent =
      id % 3
        ? `I tested this configuration yesterday. The measured cache latency was ${id + 20} milliseconds and the cold run took twice as long.`
        : 'Absolutely, great insight! Thank you for sharing this valuable perspective in today’s ever-evolving landscape. It is not just about tools but about people.';
    comment.append(body);
    if (id % 5 === 0) {
      const reply = document.createElement('article');
      reply.dataset.szUnit = 'true';
      reply.dataset.szId = `${thread}-${id}-reply`;
      const text = document.createElement('p');
      text.dataset.szBody = 'true';
      text.textContent =
        'My team measured the same behavior yesterday because the cache was cold on the first run.';
      reply.append(text);
      comment.append(reply);
    }
    fragment.append(comment);
  }
  feed.append(fragment);
}
for (const mode of ['normal', 'goggles', 'blocker', 'only'] as const) {
  const button = document.createElement('button');
  button.textContent = mode;
  button.onclick = () => {
    void browser.runtime
      .sendMessage({ type: 'SETTINGS_GET' })
      .then((settings) =>
        browser.runtime.sendMessage({
          type: 'SETTINGS_SET',
          settings: { ...settings, mode },
        }),
      );
  };
  document.querySelector('#controls')!.append(button);
}
document.querySelector('#load')!.addEventListener('click', () => load(100));
document
  .querySelector('#clear')!
  .addEventListener('click', () => feed.replaceChildren());
document.querySelector('#navigate')!.addEventListener('click', () => {
  thread++;
  count = 0;
  history.pushState({}, '', `?thread=${thread}`);
  feed.replaceChildren();
  load();
});
load();
const runtime = new Runtime();
void runtime.start();
