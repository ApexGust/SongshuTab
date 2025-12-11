const themeSelect = document.getElementById("theme");
const viewModeSelect = document.getElementById("view-mode");
const userGroupsEl = document.getElementById("user-groups");
const openShortcutsBtn = document.getElementById("open-shortcuts");

// 设置页面图标和 favicon
function setupIcons() {
  // 设置 favicon
  const existingFavicon = document.querySelector('link[rel="icon"]');
  if (!existingFavicon) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    link.href = chrome.runtime.getURL("icon.png");
    document.head.appendChild(link);
  }
  
  // 设置页面标题旁的图标
  const headerIcon = document.getElementById("header-icon");
  if (headerIcon) {
    headerIcon.src = chrome.runtime.getURL("icon.png");
  }
}

async function init() {
  const stored = await chrome.storage.local.get("settings");
  const theme = stored.settings?.theme || "dark";
  const viewMode = stored.settings?.viewMode || "side";
  themeSelect.value = theme;
  viewModeSelect.value = viewMode;
  await loadUserGroups();
}

async function updateSettings(patch) {
  await chrome.runtime.sendMessage({ type: "setSettings", settings: patch });
}

async function loadUserGroups() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "getUserGroups" });
    if (!res?.ok) throw new Error(res?.message || "加载失败");
    const groups = res.result || [];
    renderUserGroups(groups);
  } catch (err) {
    console.error("加载用户分组失败", err);
    userGroupsEl.innerHTML = '<div class="empty-groups">加载失败</div>';
  }
}

function renderUserGroups(groups) {
  if (groups.length === 0) {
    userGroupsEl.innerHTML = '<div class="empty-groups">暂无用户分组</div>';
    return;
  }
  userGroupsEl.innerHTML = groups
    .map(
      (g) => `
    <div class="group-item">
      <span class="group-name">${escapeHtml(g.name)}</span>
      <div class="switch-container">
        <span class="switch-label switch-label-left">不保留</span>
        <label class="switch">
          <input type="checkbox" data-group-id="${g.id}" ${g.persistent ? "checked" : ""} />
          <span class="slider"></span>
        </label>
        <span class="switch-label switch-label-right">保留</span>
      </div>
    </div>
  `
    )
    .join("");
  userGroupsEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    const updateLabelStyle = (checked) => {
      const container = cb.closest(".switch-container");
      const leftLabel = container?.querySelector(".switch-label-left");
      const rightLabel = container?.querySelector(".switch-label-right");
      if (checked) {
        leftLabel?.classList.remove("active");
        rightLabel?.classList.add("active");
      } else {
        leftLabel?.classList.add("active");
        rightLabel?.classList.remove("active");
      }
    };
    
    // 初始化样式
    updateLabelStyle(cb.checked);
    
    cb.addEventListener("change", async (e) => {
      const groupId = e.target.dataset.groupId;
      const persistent = e.target.checked;
      updateLabelStyle(persistent);
      
      try {
        const res = await chrome.runtime.sendMessage({
          type: "setGroupPersistent",
          groupId,
          persistent,
        });
        if (!res?.ok) throw new Error(res?.message || "更新失败");
      } catch (err) {
        console.error("更新失败", err);
        e.target.checked = !persistent;
        updateLabelStyle(!persistent);
        alert("更新失败: " + (err?.message || "未知错误"));
      }
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

themeSelect.addEventListener("change", async (e) => {
  const val = e.target.value;
  await updateSettings({ theme: val });
});

viewModeSelect.addEventListener("change", async (e) => {
  const val = e.target.value === "tab" ? "tab" : "side";
  await updateSettings({ viewMode: val });
});

openShortcutsBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

// 初始化
setupIcons();
init();

