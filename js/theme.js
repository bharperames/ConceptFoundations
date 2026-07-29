import { Store } from './store.js';

function prefersDark(){
  return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
}
function effectiveDark(){
  // dark is the app default (fresh installs / after erasing data); the OS
  // preference is ignored — only an explicit dashboard toggle goes light
  const s = Store.settings();
  return typeof s.darkMode === 'boolean' ? s.darkMode : true;
}
function applyTheme(){
  const root = document.documentElement;
  // always pin data-theme: unset would fall back to the prefers-color-scheme
  // CSS branches and flip a fresh install light on light-OS devices
  root.dataset.theme = effectiveDark() ? 'dark' : 'light';
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', effectiveDark() ? '#0E1A28' : '#F2F7FB');
}

export { prefersDark, effectiveDark, applyTheme };
