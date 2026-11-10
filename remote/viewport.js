// iOS Safari keeps a fixed full-height layout behind the keyboard and can leave the page shifted after it closes.
// While a text field has focus, the app is fitted to the part of the screen above the keyboard; afterwards it snaps back.
const KEYBOARD_CLASS = 'kb';
const SETTLE_MS = 60; // focus moving between two fields shouldn't snap the layout back in between

const vv = window.visualViewport;
const html = document.documentElement;
const editing = () => !!document.activeElement?.matches('input, textarea');

function fit() {
  if (!editing()) {
    html.classList.remove(KEYBOARD_CLASS);
    return;
  }
  html.style.setProperty('--app-top', `${Math.max(0, vv.offsetTop)}px`);
  html.style.setProperty('--app-h', `${vv.height}px`);
  html.classList.add(KEYBOARD_CLASS);
}

export function fitToKeyboard() {
  if (!vv) return;
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  document.addEventListener('focusin', fit);
  document.addEventListener('focusout', () => setTimeout(() => {
    if (editing()) return;
    window.scrollTo(0, 0);
    fit();
  }, SETTLE_MS));
}
