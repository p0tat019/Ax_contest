export function loadState(key) {
  try {
    return JSON.parse(localStorage.getItem(`corevia.${key}.v1`));
  } catch {
    return null;
  }
}

export function saveState(key, value) {
  try {
    localStorage.setItem(`corevia.${key}.v1`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
