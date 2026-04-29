export const hasChromeStorage = () => {
  return typeof chrome !== "undefined" && chrome.storage?.local;
};

const hasLocalStorage = () => {
  return typeof window !== "undefined"
    && typeof window.localStorage?.getItem === "function"
    && typeof window.localStorage?.setItem === "function"
    && typeof window.localStorage?.removeItem === "function";
};

const memoryStorage = new Map();

export async function storageGet(keys) {
  if (hasChromeStorage()) {
    return chrome.storage.local.get(keys);
  }

  const list = Array.isArray(keys) ? keys : [keys];
  const result = {};
  for (const key of list) {
    const raw = hasLocalStorage()
      ? window.localStorage.getItem(key)
      : memoryStorage.get(key);
    result[key] = raw ? JSON.parse(raw) : undefined;
  }
  return result;
}

export async function storageSet(values) {
  if (hasChromeStorage()) {
    return chrome.storage.local.set(values);
  }

  for (const [key, value] of Object.entries(values)) {
    const raw = JSON.stringify(value);
    if (hasLocalStorage()) {
      window.localStorage.setItem(key, raw);
    } else {
      memoryStorage.set(key, raw);
    }
  }
}

export async function storageRemove(keys) {
  if (hasChromeStorage()) {
    return chrome.storage.local.remove(keys);
  }

  for (const key of Array.isArray(keys) ? keys : [keys]) {
    if (hasLocalStorage()) {
      window.localStorage.removeItem(key);
    } else {
      memoryStorage.delete(key);
    }
  }
}
