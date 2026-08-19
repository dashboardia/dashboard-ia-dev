import { describe, expect, it } from "vitest";

import { actionCenterItemKey, markActionCenterItemRead, unreadActionCenterData } from "./action-center-read";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("action center read state", () => {
  it("remove do contador uma notificação já aberta", () => {
    const storage = createStorage();
    const item = { id: "execution-failed-1", occurredAt: "2026-08-19T12:00:00.000Z" };
    markActionCenterItemRead(item, storage);

    expect(unreadActionCenterData({ count: 1, items: [item] }, storage)).toEqual({ count: 0, items: [] });
  });

  it("considera uma atualização do mesmo item como nova", () => {
    const storage = createStorage();
    const previous = { id: "project-health-1", occurredAt: "2026-08-19T12:00:00.000Z" };
    const updated = { ...previous, occurredAt: "2026-08-19T12:10:00.000Z" };
    markActionCenterItemRead(previous, storage);

    expect(actionCenterItemKey(previous)).not.toBe(actionCenterItemKey(updated));
    expect(unreadActionCenterData({ count: 1, items: [updated] }, storage).count).toBe(1);
  });
});
