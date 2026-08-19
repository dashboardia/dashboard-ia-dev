const STORAGE_KEY = "dashboardia.action-center.read.v1";
const MAX_READ_ITEMS = 250;

export function actionCenterItemKey(item) {
  return `${item.id}:${new Date(item.occurredAt).toISOString()}`;
}

export function readActionCenterKeys(storage) {
  if (!storage) return new Set();
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function unreadActionCenterData(data, storage) {
  const read = readActionCenterKeys(storage);
  const items = data.items.filter((item) => !read.has(actionCenterItemKey(item)));
  return { ...data, count: items.length, items };
}

export function markActionCenterItemRead(item, storage) {
  if (!storage) return;
  const read = readActionCenterKeys(storage);
  read.add(actionCenterItemKey(item));
  storage.setItem(STORAGE_KEY, JSON.stringify([...read].slice(-MAX_READ_ITEMS)));
}
