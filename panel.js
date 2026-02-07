const groupsEl = document.getElementById("groups");
const emptyEl = document.getElementById("empty");
const addGroupBtn = document.getElementById("add-group");
const toggleAllBtn = document.getElementById("toggle-all-groups");
const settingsBtn = document.getElementById("open-settings");
const BROWSING_GROUP_ID = "browsing-live";
// 纵向弹簧 + 两端木板：图标表示当前状态（收起=压缩/展开=舒展），两图统一尺寸避免布局跳动
const SPRING_VIEWBOX = "0 0 24 32";
const SPRING_ICON_SIZE = 'width="10" height="24"';
const SPRING_ICON_COMPRESSED =
  '<svg xmlns="http://www.w3.org/2000/svg" ' + SPRING_ICON_SIZE + ' viewBox="' + SPRING_VIEWBOX + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="4" rx="1" fill="currentColor"/><path d="M12,10 L8,12 L12,14 L8,16 L12,18 L8,20 L12,22"/><rect x="4" y="24" width="16" height="4" rx="1" fill="currentColor"/></svg>';
const SPRING_ICON_STRETCHED =
  '<svg xmlns="http://www.w3.org/2000/svg" ' + SPRING_ICON_SIZE + ' viewBox="' + SPRING_VIEWBOX + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="0" width="16" height="4" rx="1" fill="currentColor"/><path d="M12,6 L8,10 L12,14 L8,18 L12,22 L8,26 L12,26"/><rect x="4" y="28" width="16" height="4" rx="1" fill="currentColor"/></svg>';
const FALLBACK_ICON =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="%23d0d0d5"/><path d="M4 5h8v1H4zm0 3h8v1H4zm0 3h5v1H4z" fill="%238c8c94"/></svg>';
let contextMenu;
let dragState = null;
const collapsedGroups = new Set();

addGroupBtn.addEventListener("click", async () => {
  const newGroup = await send("addGroup", { name: "新建分组" });
  await load();
  // 创建后自动进入编辑状态
  requestAnimationFrame(() => {
    const groupEl = document.querySelector(`[data-group-id="${newGroup.id}"]`);
    if (groupEl) {
      const titleEl = groupEl.querySelector(".group-title");
      if (titleEl) {
        startEditGroupTitle(titleEl, newGroup.id);
      }
    }
  });
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

toggleAllBtn.addEventListener("click", () => {
  const groupEls = document.querySelectorAll(".group[data-group-id]");
  const nonBrowsingIds = Array.from(groupEls)
    .map((el) => el.dataset.groupId)
    .filter((id) => id && id !== BROWSING_GROUP_ID);
  if (nonBrowsingIds.length === 0) return;
  const allCollapsed = nonBrowsingIds.every((id) => collapsedGroups.has(id));
  if (allCollapsed) {
    nonBrowsingIds.forEach((id) => collapsedGroups.delete(id));
  } else {
    nonBrowsingIds.forEach((id) => collapsedGroups.add(id));
  }
  load();
  requestAnimationFrame(() => {
    adjustTabListHeights();
  });
});

async function load() {
  const currentWindow = await chrome.windows.getCurrent();
  const res = await send("getData", { windowId: currentWindow.id });
  applyTheme(res.settings?.theme);
  render(res.groups);
}

function render(groups) {
  groupsEl.innerHTML = "";
  if (!groups.length) {
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  groups.forEach((group, idx) => {
    const groupEl = document.createElement("div");
    groupEl.className = "group";
    groupEl.dataset.groupId = group.id;
    const isCollapsed = collapsedGroups.has(group.id);
    // 判断是否为默认分组
    const isDefaultGroup = group.id === "pinned-default" || group.id === "quick-default";
    const isBrowsingGroup = group.id === BROWSING_GROUP_ID;
    const header = document.createElement("div");
    header.className = "group-header";
    
    const groupLeft = document.createElement("div");
    groupLeft.className = "group-left";
    
    const collapseBtn = document.createElement("button");
    collapseBtn.className = "icon-btn collapse-btn";
    collapseBtn.title = "收起/展开";
    collapseBtn.setAttribute("data-group", group.id);
    const isPinnedGroup = group.name === "标签钉子户";
    if (isBrowsingGroup) {
      collapseBtn.textContent = "👀";
    } else {
      collapseBtn.textContent = isPinnedGroup ? "📌" : isCollapsed ? "📂" : "📁";
    }
    
    const groupTitle = document.createElement("div");
    groupTitle.className = `group-title ${group.persistent ? 'no-edit' : ''}`;
    groupTitle.title = group.name;
    groupTitle.contentEditable = "false";
    groupTitle.setAttribute("data-group-id", group.id);
    groupTitle.textContent = group.name;
    
    groupLeft.appendChild(collapseBtn);
    groupLeft.appendChild(groupTitle);
    
    const groupActions = document.createElement("div");
    groupActions.className = "group-actions";
    if (!isBrowsingGroup) {
      const restoreBtn = document.createElement("button");
      restoreBtn.setAttribute("data-action", "restore-group");
      restoreBtn.textContent = "全部打开";
      
      const clearBtn = document.createElement("button");
      clearBtn.setAttribute("data-action", "clear-group");
      clearBtn.textContent = "清空组";
      
      groupActions.appendChild(restoreBtn);
      groupActions.appendChild(clearBtn);
      
      // 只有用户创建的分组才显示删除按钮（默认分组不显示）
      if (!group.persistent && !isDefaultGroup) {
        const deleteBtn = document.createElement("button");
        deleteBtn.setAttribute("data-action", "delete-group");
        deleteBtn.textContent = "删除组";
        groupActions.appendChild(deleteBtn);
      }
    }
    
    header.appendChild(groupLeft);
    header.appendChild(groupActions);
    
    const tabList = document.createElement("div");
    tabList.className = "tab-list";
    
    groupEl.appendChild(header);
    groupEl.appendChild(tabList);

    if (isCollapsed) {
      tabList.classList.add("collapsed");
    }
    group.tabs.forEach((entry) => {
      if (isBrowsingGroup && entry.type === "split") {
        const row = document.createElement("div");
        row.className = "tab-row split-view-row";
        row.dataset.groupId = group.id;
        row.draggable = true;
        const tabsInSplit = entry.tabs || [];
        if (tabsInSplit.length) row.dataset.tabId = tabsInSplit[0].id;
        tabsInSplit.forEach((tab, idx) => {
          const cell = document.createElement("div");
          cell.className = "split-view-cell";
          if (tab.active) cell.classList.add("active");
          const title = tab.customTitle || tab.title || tab.url;
          const img = document.createElement("img");
          img.src = tab.favIconUrl || FALLBACK_ICON;
          img.alt = "";
          const titleSpan = document.createElement("span");
          titleSpan.className = "tab-title";
          titleSpan.title = title;
          titleSpan.textContent = title;
          const closeBtn = document.createElement("button");
          closeBtn.setAttribute("data-action", "close-live-tab");
          closeBtn.title = "关闭";
          closeBtn.textContent = "×";
          cell.appendChild(img);
          cell.appendChild(titleSpan);
          cell.appendChild(closeBtn);
          cell.addEventListener("click", async (e) => {
            if (e.target === closeBtn || closeBtn.contains(e.target)) return;
            document.activeElement?.blur();
            window.getSelection()?.removeAllRanges();
            await send("restoreTab", { groupId: group.id, tabId: tab.id, active: true });
            setTimeout(() => load(), 200);
          });
          closeBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!tab.liveTabId) return;
            try { await send("closeLiveTab", { tabId: tab.liveTabId }); } catch (err) { console.error(err); }
          });
          row.appendChild(cell);
          if (idx < tabsInSplit.length - 1) {
            const div = document.createElement("div");
            div.className = "split-view-divider";
            row.appendChild(div);
          }
        });
        row.addEventListener("dragstart", (e) => {
          dragState = { tabIds: tabsInSplit.map((t) => t.id), fromGroupId: group.id };
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", tabsInSplit.map((t) => t.id).join(","));
          row.classList.add("dragging");
        });
        row.addEventListener("dragend", () => {
          row.classList.remove("dragging");
          dragState = null;
          clearDropTargets();
        });
        tabList.appendChild(row);
        return;
      }

      const tab = entry;
      const row = document.createElement("div");
      row.className = "tab-row";
      if (isBrowsingGroup && tab.active) {
        row.classList.add("active");
      }
      const title = tab.customTitle || tab.title || tab.url;
      row.draggable = true;
      row.dataset.tabId = tab.id;
      row.dataset.groupId = group.id;
      const img = document.createElement("img");
      img.src = tab.favIconUrl || FALLBACK_ICON;
      img.alt = "";
      
      const titleDiv = document.createElement("div");
      titleDiv.className = "tab-title";
      titleDiv.title = title;
      titleDiv.contentEditable = "false";
      titleDiv.textContent = title;
      
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "tab-actions";
      
      if (isBrowsingGroup) {
        const closeBtn = document.createElement("button");
        closeBtn.setAttribute("data-action", "close-live-tab");
        closeBtn.title = "关闭";
        closeBtn.textContent = "×";
        actionsDiv.appendChild(closeBtn);
      } else {
        const renameBtn = document.createElement("button");
        renameBtn.setAttribute("data-action", "rename-tab");
        renameBtn.title = "重命名";
        renameBtn.textContent = "✎";
        
        const deleteBtn = document.createElement("button");
        deleteBtn.setAttribute("data-action", "delete-tab");
        deleteBtn.title = "删除";
        deleteBtn.textContent = "×";
        
        actionsDiv.appendChild(renameBtn);
        actionsDiv.appendChild(deleteBtn);
      }
      
      row.appendChild(img);
      row.appendChild(titleDiv);
      row.appendChild(actionsDiv);
      
      const tabTitleEl = titleDiv;
      
      // 点击整行打开/切换到对应标签（除按钮区域外）
      row.addEventListener("click", async (e) => {
        // 如果点击的是按钮或按钮区域，不执行打开逻辑
        if (e.target.closest('.tab-actions') || e.target.closest('button')) {
          return;
        }
        if (tabTitleEl.contentEditable === "true") return; // 编辑模式下不打开
        await send("restoreTab", { groupId: group.id, tabId: tab.id, active: true });
        await load();
      });

      if (!isBrowsingGroup) {
        // 双击或点击重命名按钮进入编辑
        tabTitleEl.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          startEditTabTitle(tabTitleEl, group.id, tab.id);
        });

        const renameBtn = actionsDiv.querySelector('[data-action="rename-tab"]');
        renameBtn?.addEventListener("click", (e) => {
          e.stopPropagation();
          startEditTabTitle(tabTitleEl, group.id, tab.id);
        });
      } else {
        const closeBtn = actionsDiv.querySelector('[data-action="close-live-tab"]');
        closeBtn?.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!tab.liveTabId) return;
          try {
            await send("closeLiveTab", { tabId: tab.liveTabId });
          } catch (err) {
            console.error(err);
          }
        });
      }

      if (!isBrowsingGroup) {
        const deleteBtn = actionsDiv.querySelector('[data-action="delete-tab"]');
        deleteBtn?.addEventListener("click", async (e) => {
          e.stopPropagation();
          await send("removeTab", { groupId: group.id, tabId: tab.id });
          await load();
        });
      }
      row.addEventListener("dragstart", (e) => {
        dragState = { tabId: tab.id, fromGroupId: group.id };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", tab.id);
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        dragState = null;
        clearDropTargets();
      });
      tabList.appendChild(row);
    });

    // 分组标题双击编辑（只有非固定组可以编辑）
    const groupTitleEl = groupEl.querySelector(".group-title");
    if (groupTitleEl && !group.persistent) {
      groupTitleEl.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        startEditGroupTitle(groupTitleEl, group.id);
      });
    }

    if (!isBrowsingGroup) {
      const restoreBtn = groupActions.querySelector('[data-action="restore-group"]');
      const clearBtn = groupActions.querySelector('[data-action="clear-group"]');
      restoreBtn?.addEventListener("click", async () => {
        await send("restoreGroup", { groupId: group.id });
        await load();
      });

      clearBtn?.addEventListener("click", async () => {
        if (!confirm(`确定要清空"${group.name}"中的所有标签吗？`)) return;
        await send("clearGroup", { groupId: group.id });
        await load();
      });
    }

    // 只有用户创建的分组才绑定删除事件（使用上面已声明的 isDefaultGroup）
    if (!group.persistent && !isDefaultGroup && !isBrowsingGroup) {
      const deleteGroupBtn = groupActions.querySelector('[data-action="delete-group"]');
      if (deleteGroupBtn) {
        deleteGroupBtn.addEventListener("click", async () => {
          if (!confirm(`确定要删除"${group.name}"吗？此操作不可恢复。`)) return;
          await send("removeGroup", { groupId: group.id });
          await load();
        });
      }
    }

    const dropZone = groupEl;
    ["dragover", "dragenter"].forEach((evt) =>
      dropZone.addEventListener(evt, (e) => {
        if (!dragState) return;
        e.preventDefault();
        dropZone.classList.add("drop-target");

        const targetRow = e.target.closest(".tab-row");
        clearInsertIndicators();
        if (targetRow) {
          const rect = targetRow.getBoundingClientRect();
          const midpoint = rect.top + rect.height / 2;
          if (e.clientY > midpoint) {
            targetRow.classList.add("drop-after");
          } else {
            targetRow.classList.add("drop-before");
          }
        }
      }),
    );

    ["dragleave", "drop"].forEach((evt) =>
      dropZone.addEventListener(evt, async (e) => {
        if (!dragState) return;
        e.preventDefault();
        dropZone.classList.remove("drop-target");
        if (evt === "drop") {
          const targetRow = e.target.closest(".tab-row");
          const targetTabId = targetRow?.dataset.tabId;
          let insertAfter = false;
          if (targetRow) {
            const rect = targetRow.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            insertAfter = e.clientY > midpoint;
          }

          const payload = {
            fromGroupId: dragState.fromGroupId,
            toGroupId: group.id,
            targetTabId,
            insertAfter,
          };
          if (dragState.tabIds) {
            payload.tabIds = dragState.tabIds;
          } else {
            payload.tabId = dragState.tabId;
          }
          const involvesBrowsing = dragState.fromGroupId === BROWSING_GROUP_ID || group.id === BROWSING_GROUP_ID;
          if (involvesBrowsing) {
            const win = await chrome.windows.getCurrent();
            payload.windowId = win?.id;
          }
          await send("moveTab", payload);

          dragState = null;
          clearInsertIndicators();
          await load();
        } else {
          clearInsertIndicators();
        }
      }),
    );

    collapseBtn.addEventListener("click", () => {
      if (collapsedGroups.has(group.id)) {
        collapsedGroups.delete(group.id);
      } else {
        collapsedGroups.add(group.id);
      }
      load();
      // 展开/收起后重新计算高度
      requestAnimationFrame(() => {
        adjustTabListHeights();
      });
    });

    groupsEl.appendChild(groupEl);
  });
  
  // 渲染完成后，动态计算每个分组的最大高度，并更新一键收起/展开按钮文字
  requestAnimationFrame(() => {
    adjustTabListHeights();
    updateToggleAllButtonText(groups);
  });
}

function updateToggleAllButtonText(groups) {
  if (!toggleAllBtn) return;
  const nonBrowsing = groups.filter((g) => g.id !== BROWSING_GROUP_ID);
  if (nonBrowsing.length === 0) {
    toggleAllBtn.style.display = "none";
    return;
  }
  toggleAllBtn.style.display = "";
  const allCollapsed = nonBrowsing.every((g) => collapsedGroups.has(g.id));
  // 图标表示当前状态：全部收起时显示压缩弹簧，有展开时显示舒展弹簧
  toggleAllBtn.innerHTML = allCollapsed ? SPRING_ICON_COMPRESSED : SPRING_ICON_STRETCHED;
  toggleAllBtn.title = allCollapsed ? "一键展开" : "一键收起";
}

function adjustTabListHeights() {
  const tabLists = document.querySelectorAll('.tab-list:not(.collapsed)');
  if (tabLists.length === 0) return;
  
  // 先移除所有 max-height，让分组自然展开
  tabLists.forEach((tabList) => {
    tabList.style.maxHeight = 'none';
  });
  
  // 等待一帧，让 DOM 更新完成
  requestAnimationFrame(() => {
    // 获取页面可用高度
    const bodyHeight = window.innerHeight;
    const mainHeader = document.querySelector('.main-header');
    const headerHeight = mainHeader ? mainHeader.offsetHeight + 12 : 0; // 12px 是 margin-bottom
    
    // 计算所有分组头部的高度总和
    let totalHeaderHeight = 0;
    const groups = document.querySelectorAll('.group');
    groups.forEach((group) => {
      const header = group.querySelector('.group-header');
      if (header) {
        totalHeaderHeight += header.offsetHeight;
      }
      // 分组之间的间距
      totalHeaderHeight += 12; // margin-bottom
    });
    
    // 计算所有分组标签列表的实际高度总和
    let totalTabListHeight = 0;
    tabLists.forEach((tabList) => {
      totalTabListHeight += tabList.scrollHeight;
    });
    
    // 计算剩余可用高度
    const usedHeight = headerHeight + totalHeaderHeight + 28; // 28px 是 body padding
    const availableHeight = bodyHeight - usedHeight;
    
    // 如果所有分组内容的总高度小于可用高度，说明底部还有空间，不需要组内滚动
    if (totalTabListHeight <= availableHeight) {
      // 底部还有空间，让所有分组自然展开
      tabLists.forEach((tabList) => {
        tabList.style.maxHeight = 'none';
      });
    } else {
      // 空间不足，需要组内滚动，按每个分组的实际内容高度比例分配
      tabLists.forEach((tabList) => {
        const ratio = tabList.scrollHeight / totalTabListHeight;
        const allocatedHeight = Math.floor(availableHeight * ratio);
        // 确保每个分组至少能显示一些内容，但不设置固定的最小值，避免突然跳变
        tabList.style.maxHeight = `${Math.max(allocatedHeight, 50)}px`;
      });
    }
  });
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.themeMode = theme || "system";
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (theme === "light") {
    root.dataset.theme = "light";
  } else if (theme === "dark") {
    root.dataset.theme = "dark";
  } else {
    root.dataset.theme = isDark ? "dark" : "light";
  }
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  applyTheme(document.documentElement.dataset.themeMode || "system");
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "reloadData") {
    load();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "settingsChanged") {
    applyTheme(msg.settings?.theme);
    load();
  }
});

function ensureContextMenu() {
  if (contextMenu) return contextMenu;
  contextMenu = document.createElement("div");
  contextMenu.className = "context-menu";
  contextMenu.innerHTML = `<button id="ctx-rename">重命名</button>`;
  document.body.appendChild(contextMenu);
  document.addEventListener("click", () => hideContextMenu());
  return contextMenu;
}

function showContextMenu(x, y, onRename) {
  const menu = ensureContextMenu();
  menu.style.display = "block";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const renameBtn = menu.querySelector("#ctx-rename");
  renameBtn.onclick = () => {
    hideContextMenu();
    onRename?.();
  };
}

function hideContextMenu() {
  if (contextMenu) contextMenu.style.display = "none";
}

function clearDropTargets() {
  document.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
  clearInsertIndicators();
}

function clearInsertIndicators() {
  document.querySelectorAll(".tab-row.drop-before, .tab-row.drop-after").forEach((el) => {
    el.classList.remove("drop-before", "drop-after");
  });
}

function startEditTabTitle(titleEl, groupId, tabId) {
  const currentText = titleEl.textContent;
  titleEl.contentEditable = "true";
  titleEl.focus();
  
  // 选中所有文本
  const range = document.createRange();
  range.selectNodeContents(titleEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finishEdit = async () => {
    const newText = titleEl.textContent.trim();
    if (newText && newText !== currentText) {
      await send("renameTab", { groupId, tabId, title: newText });
      await load();
    } else {
      titleEl.textContent = currentText;
      titleEl.contentEditable = "false";
    }
  };

  titleEl.addEventListener("blur", finishEdit, { once: true });
  titleEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finishEdit();
    } else if (e.key === "Escape") {
      titleEl.textContent = currentText;
      titleEl.contentEditable = "false";
      titleEl.blur();
    }
  });
}

function startEditGroupTitle(titleEl, groupId) {
  if (!titleEl) return;
  const currentText = titleEl.textContent || "";
  titleEl.contentEditable = "true";
  titleEl.focus();
  
  const range = document.createRange();
  range.selectNodeContents(titleEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finishEdit = async () => {
    if (!titleEl) return;
    const newText = titleEl.textContent.trim();
    if (newText && newText !== currentText) {
      await send("renameGroup", { groupId, name: newText });
      await load();
    } else {
      titleEl.textContent = currentText;
      titleEl.contentEditable = "false";
    }
  };

  const handleBlur = () => {
    finishEdit();
    titleEl.removeEventListener("blur", handleBlur);
  };
  
  const handleKeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      titleEl.removeEventListener("keydown", handleKeydown);
      finishEdit();
    } else if (e.key === "Escape") {
      if (titleEl) {
        titleEl.textContent = currentText;
        titleEl.contentEditable = "false";
        titleEl.blur();
      }
      titleEl.removeEventListener("keydown", handleKeydown);
    }
  };

  titleEl.addEventListener("blur", handleBlur, { once: true });
  titleEl.addEventListener("keydown", handleKeydown);
}

async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res?.ok) {
    throw new Error(res?.message || "操作失败");
  }
  return res.result;
}

// 窗口大小变化时重新计算分组高度
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    adjustTabListHeights();
  }, 100);
});

load();

