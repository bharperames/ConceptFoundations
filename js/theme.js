import { Store } from './store.js';

function prefersDark(){
  return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
}
function effectiveDark(){
  const s = Store.settings();
  return typeof s.darkMode === 'boolean' ? s.darkMode : prefersDark();
}
function applyTheme(){
  const s = Store.settings();
  const root = document.documentElement;
  if (typeof s.darkMode === 'boolean') root.dataset.theme = s.darkMode ? 'dark' : 'light';
  else delete root.dataset.theme;
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', effectiveDark() ? '#0E1A28' : '#F2F7FB');
}

export { prefersDark, effectiveDark, applyTheme };
