const DEFAULT_SETTINGS = { theme: "dark", viewMode: "side", showBrowsingTabs: false };
const STORAGE_KEYS = { groups: "groups", settings: "settings" };
const PINNED_GROUP_ID = "pinned-default";
const QUICK_GROUP_ID = "quick-default";
const BROWSING_GROUP_ID = "browsing-live";

// 缓存设置，避免在用户手势中读取存储
let cachedSettings = DEFAULT_SETTINGS;

// 立即加载设置到缓存
(async () => {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.settings]);
    if (stored[STORAGE_KEYS.settings]) {
      cachedSettings = { ...DEFAULT_SETTINGS, ...stored[STORAGE_KEYS.settings] };
    }
  } catch (e) {
    // 忽略错误，使用默认值
  }
})();

// 监听设置变化
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEYS.settings]) {
    cachedSettings = { ...DEFAULT_SETTINGS, ...changes[STORAGE_KEYS.settings].newValue };
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get([STORAGE_KEYS.settings]);
  if (!current[STORAGE_KEYS.settings]) {
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: DEFAULT_SETTINGS });
    cachedSettings = DEFAULT_SETTINGS;
  } else {
    cachedSettings = { ...DEFAULT_SETTINGS, ...current[STORAGE_KEYS.settings] };
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  // 使用缓存的设置，避免异步操作导致手势上下文丢失
  const viewMode = cachedSettings.viewMode || "side";

  if (viewMode === "tab") {
    // 标签页模式：直接打开或激活标签页
    try {
      const existing = await chrome.tabs.query({ url: chrome.runtime.getURL("panel.html") });
      if (existing.length) {
        await chrome.tabs.update(existing[0].id, { active: true });
        return;
      }
      await chrome.tabs.create({ url: "panel.html", active: true });
    } catch (e) {
      console.error("Failed to open tab", e);
    }
    return;
  }

  // Side panel 模式：必须立即调用，确保在用户手势上下文中
  // tab.windowId 应该总是可用的，如果不可用，尝试获取当前窗口
  const windowId = tab?.windowId;
  if (windowId) {
    // 有 windowId，立即调用
    try {
      await chrome.sidePanel.open({ windowId });
      // 关闭可能存在的 panel.html 标签页（不阻塞）
      chrome.tabs.query({ url: chrome.runtime.getURL("panel.html") })
        .then((tabs) => {
          if (tabs.length > 0) {
            chrome.tabs.remove(tabs.map((t) => t.id)).catch(() => {});
          }
        })
        .catch(() => {});
    } catch (e) {
      console.error("sidePanel.open failed", e);
    }
  } else {
    // 没有 windowId，尝试获取当前窗口（可能会丢失手势上下文）
    try {
      const currentWindow = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: currentWindow.id });
      chrome.tabs.query({ url: chrome.runtime.getURL("panel.html") })
        .then((tabs) => {
          if (tabs.length > 0) {
            chrome.tabs.remove(tabs.map((t) => t.id)).catch(() => {});
          }
        })
        .catch(() => {});
    } catch (e) {
      console.error("sidePanel.open failed", e);
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = messageHandlers[message.type];
  if (!handler) return;
  handler(message, _sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => {
      console.error(error);
      sendResponse({ ok: false, message: error?.message || "未知错误" });
    });
  return true;
});

const messageHandlers = {
  async captureWindow() {
    return captureCurrentWindow();
  },
  async getData(message) {
    const { groups, settings } = await loadState(message.windowId);
    return { groups, settings };
  },
  async setSettings(message) {
    const current = await chrome.storage.local.get(STORAGE_KEYS.settings);
    const merged = { ...(current[STORAGE_KEYS.settings] || DEFAULT_SETTINGS), ...message.settings };
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: merged });
    cachedSettings = merged; // 更新缓存
    try {
      await chrome.runtime.sendMessage({ type: "settingsChanged", settings: merged });
    } catch (_e) {
      // ignore if panel not open
    }
    return merged;
  },
  async renameGroup(message) {
    if (message.groupId === BROWSING_GROUP_ID) throw new Error("实时分组不支持重命名");
    const { groups } = await loadState();
    const group = groups.find((g) => g.id === message.groupId);
    if (!group) throw new Error("未找到分组");
    group.name = message.name || group.name;
    await chrome.storage.local.set({ [STORAGE_KEYS.groups]: groups });
    return group;
  },
  async renameTab(message) {
    if (message.groupId === BROWSING_GROUP_ID) throw new Error("实时分组不支持重命名");
    const { groups } = await loadState();
    const group = groups.find((g) => g.id === message.groupId);
    if (!group) throw new Error("未找到分组");
    const tab = group.tabs.find((t) => t.id === message.tabId);
    if (!tab) throw new Error("未找到标签");
    tab.customTitle = message.title || tab.customTitle;
    await chrome.storage.local.set({ [STORAGE_KEYS.groups]: groups });
    return tab;
  },
  async removeTab(message) {
    if (message.groupId === BROWSING_GROUP_ID) throw new Error("实时分组不支持删除");
    const { groups } = await loadState();
    const group = groups.find((g) => g.id === message.groupId);
    if (!group) throw new Error("未找到分组");
    group.tabs = group.tabs.filter((t) => t.id !== message.tabId);
    await persistGroups(groups);
    return true;
  },
  async clearGroup(message) {
    if (message.groupId === BROWSING_GROUP_ID) throw new Error("实时分组不支持清空");
    const { groups } = await loadState();
    const group = groups.find((g) => g.id === message.groupId);
    if (!group) throw new Error("未找到分组");
    group.tabs = [];
    await persistGroups(groups);
    return true;
  },
  async removeGroup(message) {
    if (message.groupId === BROWSING_GROUP_ID) throw new Error("实时分组不支持删除");
    const { groups } = await loadState();
    const group = groups.find((g) => g.id === message.groupId);
    if (!group) throw new Error("未找到分组");
    // 保护默认分组，不允许删除
    if (group.id === PINNED_GROUP_ID || group.id === QUICK_GROUP_ID) {
      throw new Error("不能删除默认分组");
    }
    if (group.persistent) throw new Error("不能删除固定分组");
    const next = groups.filter((g) => g.id !== message.groupId);
    await persistGroups(next);
    return true;
  },
  async restoreTab(message) {
    const { groups } = await loadState();
    const group = groups.find((g) => g.id === message.groupId);
    if (!group) throw new Error("未找到分组");
    let tab = null;
    if (group.id === BROWSING_GROUP_ID) {
      for (const entry of group.tabs) {
        if (entry.type === "split" && entry.tabs) {
          tab = entry.tabs.find((t) => t.id === message.tabId);
          if (tab) break;
        } else if (entry.id === message.tabId) {
          tab = entry;
          break;
        }
      }
    } else {
      tab = group.tabs.find((t) => t.id === message.tabId);
    }
    if (!tab) throw new Error("未找到标签");
    if (group.id === BROWSING_GROUP_ID) {
      if (!tab.liveTabId) throw new Error("该标签已关闭");
      return new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            await chrome.tabs.update(tab.liveTabId, { active: message.active });
            resolve(true);
          } catch (_e) {
            reject(new Error("该标签已关闭"));
          }
        }, 0);
      });
    }
    await chrome.tabs.create({ url: tab.url, active: message.active });
    if (!group.persistent) {
      group.tabs = group.tabs.filter((t) => t.id !== message.tabId);
    }
    await persistGroups(groups);
    return true;
  },
  async restoreGroup(message) {
    const { groups } = await loadState();
    const group = groups.find((g) => g.id === message.groupId);
    if (!group) throw new Error("未找到分组");
    for (const tab of group.tabs) {
      await chrome.tabs.create({ url: tab.url, active: false });
    }
    // 恢复后，如果是非持久组，清空标签但保留组
    if (!group.persistent) {
      group.tabs = [];
    }
    await persistGroups(groups);
    return true;
  },
  async addGroup(message) {
    const { groups } = await loadState();
    const group = {
      id: createId("group"),
      name: message.name || `新建分组`,
      createdAt: Date.now(),
      tabs: [],
      persistent: false, // 用户新建的组默认不是持久组
    };
    await persistGroups([group, ...groups]);
    return group;
  },
  async moveTab(message) {
    const { fromGroupId, toGroupId, tabId, tabIds, targetTabId, insertAfter, windowId } = message;
    const idsToMove = tabIds && tabIds.length ? tabIds : tabId ? [tabId] : [];
    if (!idsToMove.length) throw new Error("缺少标签 ID");
    const needBrowsingState = fromGroupId === BROWSING_GROUP_ID || toGroupId === BROWSING_GROUP_ID;
    const { groups } = await loadState(needBrowsingState ? windowId : undefined);
    const from = groups.find((g) => g.id === fromGroupId);
    const to = groups.find((g) => g.id === toGroupId);
    if (!from || !to) throw new Error("目标分组不存在");

    if (fromGroupId === BROWSING_GROUP_ID && toGroupId !== BROWSING_GROUP_ID) {
      const browsingTabs = getBrowsingTabsById(from, idsToMove);
      if (!browsingTabs.length) throw new Error("未找到标签");
      const newTabs = [];
      for (const t of browsingTabs) {
        if (!t.liveTabId) continue;
        let info;
        try {
          info = await chrome.tabs.get(t.liveTabId);
        } catch (_e) {
          continue;
        }
        newTabs.push({
          id: createId("tab"),
          url: info.url || "",
          title: info.title || "",
          customTitle: "",
          favIconUrl: info.favIconUrl || "",
        });
      }
      if (!newTabs.length) throw new Error("该标签已关闭");
      let targetIdx = to.tabs.length;
      if (targetTabId) {
        const i = to.tabs.findIndex((t) => t.id === targetTabId);
        if (i >= 0) targetIdx = insertAfter ? i + 1 : i;
      }
      to.tabs.splice(targetIdx, 0, ...newTabs);
      await persistGroups(groups);
      const liveIdsToClose = browsingTabs.map((t) => t.liveTabId).filter(Boolean);
      if (liveIdsToClose.length) await chrome.tabs.remove(liveIdsToClose);
      return true;
    }

    // 从其他分组拖到「正在浏览中」：在新标签页打开
    if (fromGroupId !== BROWSING_GROUP_ID && toGroupId === BROWSING_GROUP_ID) {
      const tab = from.tabs.find((t) => t.id === idsToMove[0]);
      if (!tab) throw new Error("未找到标签");
      const createProps = { url: tab.url, active: false };
      if (windowId) createProps.windowId = windowId;
      await chrome.tabs.create(createProps);
      if (!from.persistent) {
        from.tabs = from.tabs.filter((t) => t.id !== idsToMove[0]);
        await persistGroups(groups);
      }
      return true;
    }

    // 在「正在浏览中」内拖拽排序：移动真实标签顺序
    if (fromGroupId === BROWSING_GROUP_ID && toGroupId === BROWSING_GROUP_ID) {
      const browsingTabs = getBrowsingTabsById(from, idsToMove);
      if (!browsingTabs.length) throw new Error("未找到标签");
      const liveIds = browsingTabs.map((t) => t.liveTabId).filter(Boolean);
      if (!liveIds.length) throw new Error("该标签已关闭");
      const windowIdForMove = browsingTabs[0].windowId;
      const allTabs = await chrome.tabs.query({ windowId: windowIdForMove });
      let targetIndex = allTabs.length;
      if (targetTabId) {
        const targetTabs = getBrowsingTabsById(from, [targetTabId]);
        const targetLiveId = targetTabs[0]?.liveTabId;
        if (targetLiveId) {
          const idx = allTabs.findIndex((t) => t.id === targetLiveId);
          if (idx >= 0) targetIndex = insertAfter ? idx + 1 : idx;
        }
      }
      await chrome.tabs.move(liveIds, { index: targetIndex });
      return true;
    }

    // 普通分组间 / 组内拖拽
    if (idsToMove.length > 1) throw new Error("仅支持单标签拖拽");
    const singleId = idsToMove[0];
    if (from.id === to.id && singleId === targetTabId) return true;
    let targetIdxInSameGroup = -1;
    if (from.id === to.id && targetTabId) {
      targetIdxInSameGroup = to.tabs.findIndex((t) => t.id === targetTabId);
    }
    const idx = from.tabs.findIndex((t) => t.id === singleId);
    if (idx < 0) throw new Error("未找到标签");
    const [tab] = from.tabs.splice(idx, 1);

    if (from.id === to.id) {
      if (targetTabId && targetIdxInSameGroup >= 0) {
        let adjustedIdx = idx < targetIdxInSameGroup ? targetIdxInSameGroup - 1 : targetIdxInSameGroup;
        if (insertAfter) adjustedIdx += 1;
        if (adjustedIdx < 0) adjustedIdx = 0;
        if (adjustedIdx > to.tabs.length) adjustedIdx = to.tabs.length;
        to.tabs.splice(adjustedIdx, 0, tab);
      } else {
        to.tabs.push(tab);
      }
      await persistGroups(groups);
      return true;
    }

    if (targetTabId) {
      const targetIdx = to.tabs.findIndex((t) => t.id === targetTabId);
      if (targetIdx >= 0) {
        let adjustedIdx = insertAfter ? targetIdx + 1 : targetIdx;
        if (adjustedIdx < 0) adjustedIdx = 0;
        if (adjustedIdx > to.tabs.length) adjustedIdx = to.tabs.length;
        to.tabs.splice(adjustedIdx, 0, tab);
      } else {
        to.tabs.push(tab);
      }
    } else {
      to.tabs.push(tab);
    }
    await persistGroups(groups);
    return true;
  },
  async getUserGroups() {
    const { groups } = await loadState();
    const userGroups = groups.filter(
      (g) => g.id !== PINNED_GROUP_ID && g.id !== QUICK_GROUP_ID && g.id !== BROWSING_GROUP_ID,
    );
    return userGroups.map((g) => ({ id: g.id, name: g.name, persistent: g.persistent || false }));
  },
  async closeLiveTab(message) {
    if (!message.tabId) throw new Error("缺少标签 ID");
    try {
      await chrome.tabs.remove(message.tabId);
    } catch (_e) {
      throw new Error("标签已关闭");
    }
    return true;
  },
  async setGroupPersistent(message) {
    if (message.groupId === BROWSING_GROUP_ID) throw new Error("实时分组不支持修改");
    const { groups } = await loadState();
    const group = groups.find((g) => g.id === message.groupId);
    if (!group) throw new Error("未找到分组");
    if (group.id === PINNED_GROUP_ID || group.id === QUICK_GROUP_ID) {
      throw new Error("固定分组不能修改");
    }
    group.persistent = message.persistent;
    await persistGroups(groups);
    return group;
  },
};

async function captureCurrentWindow() {
  const currentWindow = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ windowId: currentWindow.id });
  const normalTabs = tabs.filter((t) => !t.pinned && t.url);

  if (!normalTabs.length) throw new Error("当前窗口没有可收纳的标签");

  const { groups } = await loadState();
  const groupId = createId("group");
  const group = {
    id: groupId,
    name: `收纳 ${new Date().toLocaleString()}`,
    createdAt: Date.now(),
    tabs: normalTabs.map((tab) => ({
      id: createId("tab"),
      url: tab.url,
      title: tab.title,
      customTitle: "",
      favIconUrl: tab.favIconUrl || "",
    })),
  };

  await persistGroups([group, ...groups]);
  await chrome.tabs.remove(normalTabs.map((t) => t.id));
  return group;
}

async function captureActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || !activeTab.url) throw new Error("当前无可收纳标签");
  const { groups } = await loadState();
  const quick = ensureQuickGroup(groups);
  quick.tabs.unshift({
    id: createId("tab"),
    url: activeTab.url,
    title: activeTab.title,
    customTitle: "",
    favIconUrl: activeTab.favIconUrl || "",
  });
  await persistGroups(groups);
  await chrome.tabs.remove(activeTab.id);
  try {
    await chrome.runtime.sendMessage({ type: "reloadData" });
  } catch (_e) {
    // 若侧栏未打开，忽略
  }
  // 注意：快捷键命令上下文不支持 sidePanel.open()，所以不在这里自动打开
  // 用户需要手动点击扩展图标打开侧栏查看收纳的标签
}

async function loadState(targetWindowId) {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.groups, STORAGE_KEYS.settings]);
  const groups = (stored[STORAGE_KEYS.groups] || []).filter((g) => g.id !== BROWSING_GROUP_ID);
  const pinnedGroup = ensurePinnedGroup(groups);
  const quickGroup = ensureQuickGroup(groups);
  const middle = groups.filter((g) => g.id !== PINNED_GROUP_ID && g.id !== QUICK_GROUP_ID);
  const settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.settings] || {}) };
  let finalGroups = [pinnedGroup, ...middle, quickGroup];
  if (settings.showBrowsingTabs) {
    const browsing = await buildBrowsingGroup(targetWindowId);
    finalGroups = [...finalGroups, browsing];
  }
  return { groups: finalGroups, settings };
}

const SPLIT_VIEW_ID_NONE = -1;

function getBrowsingTabsById(browsingGroup, tabIds) {
  if (!browsingGroup || browsingGroup.id !== BROWSING_GROUP_ID || !tabIds?.length) return [];
  const result = [];
  for (const id of tabIds) {
    for (const entry of browsingGroup.tabs) {
      if (entry.type === "split" && entry.tabs) {
        const t = entry.tabs.find((x) => x.id === id);
        if (t) {
          result.push(t);
          break;
        }
      } else if (entry.id === id) {
        result.push(entry);
        break;
      }
    }
  }
  return result;
}

function toBrowsingTab(tab) {
  return {
    id: `live-${tab.id}`,
    liveTabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title,
    customTitle: tab.title || tab.url,
    favIconUrl: tab.favIconUrl || "",
    active: tab.active || false,
  };
}

async function buildBrowsingGroup(targetWindowId) {
  let windowId = targetWindowId;
  if (!windowId) {
    try {
      const current = await chrome.windows.getCurrent();
      windowId = current?.id;
    } catch (_e) {
      windowId = undefined;
    }
  }
  const tabs = await chrome.tabs.query(windowId ? { windowId } : {});
  const filtered = tabs.filter(
    (t) =>
      t.url &&
      !t.url.startsWith("chrome://") &&
      !t.url.startsWith(`chrome-extension://${chrome.runtime.id}`),
  );
  const displayEntries = [];
  const splitViewIdNone = chrome.tabs?.SPLIT_VIEW_ID_NONE ?? SPLIT_VIEW_ID_NONE;
  const bySplit = new Map();
  for (const tab of filtered) {
    const svId = tab.splitViewId;
    if (svId != null && svId !== splitViewIdNone) {
      if (!bySplit.has(svId)) bySplit.set(svId, []);
      bySplit.get(svId).push(tab);
    }
  }
  const emittedSplits = new Set();
  const sorted = [...filtered].sort((a, b) => a.index - b.index);
  for (const tab of sorted) {
    const svId = tab.splitViewId;
    if (svId != null && svId !== splitViewIdNone) {
      if (!emittedSplits.has(svId)) {
        emittedSplits.add(svId);
        const group = bySplit.get(svId) || [];
        if (group.length >= 1) {
          displayEntries.push({
            type: "split",
            id: `split-${svId}`,
            tabs: group.map(toBrowsingTab),
          });
        }
      }
      continue;
    }
    displayEntries.push(toBrowsingTab(tab));
  }
  return {
    id: BROWSING_GROUP_ID,
    name: "正在浏览中",
    createdAt: Number.MAX_SAFE_INTEGER,
    persistent: true,
    type: "browsing",
    tabs: displayEntries,
  };
}

async function persistGroups(groups) {
  const toSave = (groups || []).filter((g) => g.id !== BROWSING_GROUP_ID);
  await chrome.storage.local.set({ [STORAGE_KEYS.groups]: toSave });
}

function createId(prefix) {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureQuickGroup(groups) {
  let quick = groups.find((g) => g.id === QUICK_GROUP_ID);
  if (!quick) {
    quick = {
      id: QUICK_GROUP_ID,
      name: "待领养标签",
      createdAt: 0,
      persistent: false, // 分组内的标签点击后会被删除（不保留）
      tabs: [],
    };
    groups.push(quick);
  } else {
    quick.name = "待领养标签";
    quick.persistent = false; // 分组内的标签点击后会被删除（不保留）
  }
  return quick;
}

function ensurePinnedGroup(groups) {
  let pinned = groups.find((g) => g.id === PINNED_GROUP_ID);
  if (!pinned) {
    pinned = {
      id: PINNED_GROUP_ID,
      name: "标签钉子户",
      createdAt: 0,
      persistent: true,
      tabs: [],
    };
    groups.unshift(pinned);
  } else {
    pinned.name = "标签钉子户";
    pinned.persistent = true;
  }
  return pinned;
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "quick-capture-active") {
    try {
      await captureActiveTab();
    } catch (e) {
      console.error(e);
    }
  }
});

function broadcastBrowsingRefresh() {
  if (!cachedSettings.showBrowsingTabs) return;
  try {
    chrome.runtime.sendMessage({ type: "reloadData" }).catch(() => {});
  } catch (_e) {
    // ignore
  }
}

chrome.tabs.onCreated.addListener(() => broadcastBrowsingRefresh());
chrome.tabs.onRemoved.addListener(() => broadcastBrowsingRefresh());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.title) {
    broadcastBrowsingRefresh();
  }
});
chrome.tabs.onActivated.addListener(() => broadcastBrowsingRefresh());

async function openUI(windowId) {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.settings]);
  const settings = stored[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
  const viewMode = settings.viewMode || "side";

  if (viewMode === "tab") {
    // 尝试找到已打开的 panel.html Tab 并激活
    const existing = await chrome.tabs.query({ url: chrome.runtime.getURL("panel.html") });
    if (existing.length) {
      await chrome.tabs.update(existing[0].id, { active: true });
      return;
    }
    await chrome.tabs.create({ url: "panel.html", active: true });
    return;
  }

  // 默认 side panel - 先关闭可能存在的 panel.html 标签页
  try {
    const existingTabs = await chrome.tabs.query({ url: chrome.runtime.getURL("panel.html") });
    if (existingTabs.length > 0) {
      await chrome.tabs.remove(existingTabs.map((t) => t.id));
    }
  } catch (e) {
    // 忽略关闭标签页的错误
  }

  // 打开 side panel
  try {
    let targetWindowId = windowId;
    if (!targetWindowId) {
      const currentWindow = await chrome.windows.getCurrent();
      targetWindowId = currentWindow.id;
    }
    if (targetWindowId) {
      await chrome.sidePanel.open({ windowId: targetWindowId });
    }
  } catch (e) {
    console.error("sidePanel.open failed", e);
  }
}

