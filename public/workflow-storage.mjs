export const experienceMode = typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('experience') === '1';
const storage = () => experienceMode ? sessionStorage : localStorage;
const storageKey = (key) => `corevia.${experienceMode ? 'experience.' : ''}${key}.v1`;

export function loadState(key) {
  try {
    return JSON.parse(storage().getItem(storageKey(key)));
  } catch {
    return null;
  }
}

export function saveState(key, value) {
  try {
    storage().setItem(storageKey(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
