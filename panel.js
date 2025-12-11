const groupsEl = document.getElementById("groups");
const emptyEl = document.getElementById("empty");
const addGroupBtn = document.getElementById("add-group");
const settingsBtn = document.getElementById("open-settings");
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

async function load() {
  const res = await send("getData");
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
    const header = document.createElement("div");
    header.className = "group-header";
    
    const groupLeft = document.createElement("div");
    groupLeft.className = "group-left";
    
    const collapseBtn = document.createElement("button");
    collapseBtn.className = "icon-btn collapse-btn";
    collapseBtn.title = "收起/展开";
    collapseBtn.setAttribute("data-group", group.id);
    const isPinnedGroup = group.name === "标签钉子户";
    collapseBtn.textContent = isPinnedGroup ? "📌" : isCollapsed ? "📂" : "📁";
    
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
    
    header.appendChild(groupLeft);
    header.appendChild(groupActions);
    
    const tabList = document.createElement("div");
    tabList.className = "tab-list";
    
    groupEl.appendChild(header);
    groupEl.appendChild(tabList);

    if (isCollapsed) {
      tabList.classList.add("collapsed");
    }
    group.tabs.forEach((tab) => {
      const row = document.createElement("div");
      row.className = "tab-row";
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
      
      row.appendChild(img);
      row.appendChild(titleDiv);
      row.appendChild(actionsDiv);
      
      const tabTitleEl = titleDiv;
      
      // 点击标题打开标签
      tabTitleEl.addEventListener("click", async (e) => {
        if (tabTitleEl.contentEditable === "true") return; // 编辑模式下不打开
        await send("restoreTab", { groupId: group.id, tabId: tab.id, active: true });
        await load();
      });

      // 双击或点击重命名按钮进入编辑
      tabTitleEl.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        startEditTabTitle(tabTitleEl, group.id, tab.id);
      });

      renameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        startEditTabTitle(tabTitleEl, group.id, tab.id);
      });

      // 移除右键菜单，改用hover按钮
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
      deleteBtn.addEventListener("click", async () => {
        await send("removeTab", { groupId: group.id, tabId: tab.id });
        await load();
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

    restoreBtn.addEventListener("click", async () => {
      await send("restoreGroup", { groupId: group.id });
      await load();
    });

    clearBtn.addEventListener("click", async () => {
      if (!confirm(`确定要清空"${group.name}"中的所有标签吗？`)) return;
      await send("clearGroup", { groupId: group.id });
      await load();
    });

    // 只有用户创建的分组才绑定删除事件（使用上面已声明的 isDefaultGroup）
    if (!group.persistent && !isDefaultGroup) {
      const deleteGroupBtn = groupActions.querySelector('[data-action="delete-group"]');
      if (deleteGroupBtn) {
        deleteGroupBtn.addEventListener("click", async () => {
          if (!confirm(`确定要删除"${group.name}"吗？此操作不可恢复。`)) return;
          await send("removeGroup", { groupId: group.id });
          await load();
        });
      }
    }

    const dropZone = tabList;
    ["dragover", "dragenter"].forEach((evt) =>
      dropZone.addEventListener(evt, (e) => {
        if (!dragState) return;
        e.preventDefault();
        dropZone.classList.add("drop-target");
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

          // 同组拖拽允许重新排序
          await send("moveTab", {
            fromGroupId: dragState.fromGroupId,
            toGroupId: group.id,
            tabId: dragState.tabId,
            targetTabId,
          });

          dragState = null;
          await load();
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
    });

    groupsEl.appendChild(groupEl);
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

load();

