const parameters = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
export const experienceMode = parameters.get('experience') === '1';
export const handsOnExperience = experienceMode && parameters.get('case') === 'hands-on';
export const changeExperience = handsOnExperience || (experienceMode && parameters.get('case') === 'change');
const storage = () => experienceMode ? sessionStorage : localStorage;
const scope = handsOnExperience ? 'experience.hands-on.' : changeExperience ? 'experience.change.' : experienceMode ? 'experience.' : '';
const storageKey = (key) => `corevia.${scope}${key}.v1`;

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
