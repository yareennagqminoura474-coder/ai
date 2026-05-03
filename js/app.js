(function (window, document) {
  "use strict";

  var pageIds = [
    "homeScreen",
    "wechatScreen",
    "characterListScreen",
    "createCharacterScreen",
    "chatScreen",
    "groupListScreen",
    "createGroupScreen",
    "groupChatScreen",
    "offlineScreen",
    "themeScreen",
    "photoScreen",
    "notebookScreen",
    "settingsScreen",
    "privateChatSettingsScreen",
    "groupSettingsScreen",
    "walletScreen",
    "walletBillScreen",
    "familyCardScreen",
    "shopScreen",
    "worldBookScreen",
    "diaryScreen",
    "characterSpaceScreen",
    "thoughtsScreen",
    "watchListScreen",
    "watchSetupScreen",
    "watchScreen",
    "outingScreen"
  ];
  var activePage = "homeScreen";
  var currentMessageAction = null;
  var emojiSendCallback = null;
  var imageSendCallback = null;
  var diaryTab = "character";
  var shopTab = "food";
  var shopMallCategory = "all";
  var shopGenerating = false;
  var walletBillFilter = "all";
  var diaryCharacterId = "";
  var characterSpaceId = "";
  var thoughtsReturnPage = "homeScreen";
  var thoughtsState = {
    title: "心声",
    characterIds: [],
    chatId: "",
    characterFilter: "all",
    sourceFilter: "all",
    moodFilter: "all",
    origin: ""
  };
  var thoughtsDrawerState = {
    title: "心声",
    characterIds: [],
    chatId: "",
    characterFilter: "all",
    mode: "latest",
    open: false,
    origin: ""
  };
  var DEFAULT_BODY_STATE_PARTS = ["手心", "臀部", "臀腿", "大腿", "大腿内侧", "腰背", "肩颈", "膝盖", "屁眼"];
  var noteSearchKeyword = "";
  var expandedWorldBookIds = {};
  var expandedWorldEntryIds = {};
  var collapsedChatWorldBookGroups = {};
  var apiJobResumeRetryTimer = null;
  var currentThemeId = "default";
  var currentDesktopPage = 0;
  var desktopTouchStartX = 0;
  var desktopTouchDeltaX = 0;
  var wechatChildReturnTab = "";
  var desktopApps = [
    { id: "wechat", name: "微信", icon: "微", className: "desktop-wechat", action: "wechat" },
    { id: "photo", name: "相册", icon: "相", className: "desktop-photo", action: "photo" },
    { id: "watch", name: "观看", icon: "眼", className: "desktop-watch", action: "watch" },
    { id: "worldbook", name: "世界书", icon: "世", className: "desktop-worldbook", action: "worldbook" },
    { id: "diary", name: "日记", icon: "日", className: "desktop-diary", action: "diary" },
    { id: "theme", name: "美化", icon: "美", className: "desktop-theme", action: "theme" },
    { id: "settings", name: "设置", icon: "设", className: "desktop-setting", action: "settings" },
    { id: "shop", name: "购物", icon: "购", className: "desktop-shop", action: "shop" },
    { id: "outing", name: "出去玩", icon: "🧭", className: "desktop-outing", action: "outing" }
  ];
  var desktopPageSize = 12;
  var themePresets = [
    { id: "default", name: "默认浅色", bg: "#f6f7f4", surface: "#ffffff", text: "#1d2521", muted: "#73817a", blue: "#5b9fe6", green: "#68bea3" },
    { id: "pink", name: "粉色", bg: "#fff5f8", surface: "#ffffff", text: "#2b2025", muted: "#8d6f7b", blue: "#7aa7ea", green: "#69bda3" },
    { id: "blue", name: "蓝色", bg: "#f3f8ff", surface: "#ffffff", text: "#1e2835", muted: "#6f7f93", blue: "#4d8fe8", green: "#55bfa0" },
    { id: "green", name: "绿色", bg: "#f2faf5", surface: "#ffffff", text: "#1f2b23", muted: "#6f8376", blue: "#5e9de4", green: "#4fb782" },
    { id: "dark", name: "深色", bg: "#151916", surface: "#202620", text: "#eef5ef", muted: "#9eaa9f", blue: "#78aef0", green: "#7ac9a4" }
  ];
  var defaultEmojis = ["😀", "😭", "😍", "🤔", "😡", "👍", "❤️", "🎉"];
  var presetLocations = [
    { name: "家", address: "常去的地方", lat: null, lng: null },
    { name: "学校", address: "常去的地方", lat: null, lng: null },
    { name: "教室", address: "常去的地方", lat: null, lng: null },
    { name: "图书馆", address: "常去的地方", lat: null, lng: null },
    { name: "宿舍", address: "常去的地方", lat: null, lng: null },
    { name: "食堂", address: "常去的地方", lat: null, lng: null },
    { name: "操场", address: "常去的地方", lat: null, lng: null },
    { name: "公司", address: "常去的地方", lat: null, lng: null },
    { name: "咖啡店", address: "常去的地方", lat: null, lng: null },
    { name: "商场", address: "常去的地方", lat: null, lng: null },
    { name: "医院", address: "常去的地方", lat: null, lng: null },
    { name: "车站", address: "常去的地方", lat: null, lng: null }
  ];

  function getElement(id) {
    return document.getElementById(id);
  }

  function addClick(id, handler) {
    var element = getElement(id);
    if (element) {
      element.addEventListener("click", handler);
    }
  }

  function showToast(message, isError) {
    var toast = getElement("appToast");
    var host = document.querySelector(".phone") || document.body;

    if (!toast) {
      toast = document.createElement("div");
      toast.id = "appToast";
      toast.className = "app-toast hidden";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      host.appendChild(toast);
    }

    toast.textContent = String(message || "");
    toast.classList.toggle("error", Boolean(isError));
    toast.classList.remove("hidden");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () {
      toast.classList.add("hidden");
      toast.classList.remove("error");
    }, 2200);
  }

  function renderSoftEmpty(icon, title, description, actionLabel, actionAttrs) {
    return [
      '<div class="soft-empty soft-empty-card">',
      '  <span class="soft-empty-icon" aria-hidden="true">' + escapeHtml(icon || "·") + "</span>",
      '  <strong>' + escapeHtml(title || "暂无内容") + "</strong>",
      description ? '  <em>' + escapeHtml(description) + "</em>" : "",
      actionLabel ? '  <button type="button" class="soft-empty-action" ' + (actionAttrs || "") + ">" + escapeHtml(actionLabel) + "</button>" : "",
      "</div>"
    ].join("");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function canOpenPrivateChatScreen() {
    var id = window.CharacterManager && window.CharacterManager.getActiveCharacterId
      ? window.CharacterManager.getActiveCharacterId()
      : "";
    if (!id) return false;
    return (window.AppStorage.getCharacters() || []).some(function (c) {
      return c && String(c.id) === String(id);
    });
  }

  function canOpenGroupChatScreen() {
    var id = window.GroupManager && window.GroupManager.getActiveGroupId
      ? window.GroupManager.getActiveGroupId()
      : "";
    if (!id) return false;
    return (window.AppStorage.getGroups() || []).some(function (g) {
      return g && String(g.id) === String(id);
    });
  }

  function setActivePage(pageId) {
    if (pageIds.indexOf(pageId) === -1) {
      return;
    }

    if (pageId === "chatScreen" && !canOpenPrivateChatScreen()) {
      setWechatTab("wechat");
      pageId = "wechatScreen";
    }

    if (pageId === "groupChatScreen" && !canOpenGroupChatScreen()) {
      setWechatTab("wechat");
      pageId = "wechatScreen";
    }

    if (window.CharacterManager && window.CharacterManager.closeAllMenus) {
      window.CharacterManager.closeAllMenus();
    }

    if (window.GroupManager && window.GroupManager.closeAllMenus) {
      window.GroupManager.closeAllMenus();
    }

    if (window.WeChatTools && window.WeChatTools.close) {
      window.WeChatTools.close();
    }

    activePage = pageId;
    pageIds.forEach(function (id) {
      var screen = getElement(id);
      if (!screen) {
        return;
      }

      var active = id === pageId;
      screen.classList.toggle("active", active);
      screen.setAttribute("aria-hidden", active ? "false" : "true");
      screen.style.display = active ? "flex" : "none";
    });

    updateDockState(pageId);

    if (pageId === "homeScreen") {
      refreshHomeSummary();
      renderDesktop();
    }

    if (pageId === "wechatScreen") {
      renderWechatScreen();
    }

    if (pageId === "walletScreen") {
      renderWalletScreen();
    }

    if (pageId === "walletBillScreen") {
      renderWalletBillScreen();
    }

    if (pageId === "familyCardScreen") {
      renderFamilyCardScreen();
    }

    if (pageId === "shopScreen") {
      renderShopScreen();
    }

    if (pageId === "characterListScreen") {
      window.CharacterManager.renderCharacterList();
    }

    if (pageId === "groupListScreen") {
      window.GroupManager.renderGroupList();
    }

    if (pageId === "offlineScreen") {
      window.OfflineManager.renderOfflineMessages();
    }

    if (pageId === "watchListScreen") {
      if (window.WatchManager && window.WatchManager.renderSessionList) {
        window.WatchManager.renderSessionList();
      }
    }

    if (pageId === "themeScreen") {
      renderThemeScreen();
    }

    if (pageId === "photoScreen") {
      renderPhotoScreen();
    }

    if (pageId === "notebookScreen") {
      renderNotebookScreen();
    }

    if (pageId === "settingsScreen") {
      loadSettingsIntoForm();
    }

    if (pageId === "worldBookScreen") {
      renderWorldBookScreen();
    }

    if (pageId === "diaryScreen") {
      renderDiaryScreen();
    }

    if (pageId === "characterSpaceScreen") {
      renderCharacterSpaceScreen();
    }

    if (pageId === "outingScreen") {
      renderOutingScreen();
    }

    if (pageId === "chatScreen" && !canOpenPrivateChatScreen()) {
      setWechatTab("wechat");
      return setActivePage("wechatScreen");
    }

    if (pageId === "groupChatScreen" && !canOpenGroupChatScreen()) {
      setWechatTab("wechat");
      return setActivePage("wechatScreen");
    }
  }

  function goHome() {
    setActivePage("homeScreen");
  }

  function getActivePage() {
    return activePage;
  }

  function updateDockState(pageId) {
    var dockHome = getElement("dockHome");
    var dockChat = getElement("dockChat");
    var dockTheme = getElement("dockTheme");
    var dockSettings = getElement("dockSettings");

    if (!dockHome || !dockChat || !dockSettings) {
      return;
    }

    dockHome.classList.toggle("active", pageId === "homeScreen" || pageId === "wechatScreen");
    dockChat.classList.toggle("active", pageId === "characterListScreen" || pageId === "chatScreen" || pageId === "groupListScreen" || pageId === "groupChatScreen" || pageId === "privateChatSettingsScreen" || pageId === "groupSettingsScreen" || pageId === "characterSpaceScreen" || pageId === "diaryScreen");
    if (dockTheme) {
      dockTheme.classList.toggle("active", pageId === "photoScreen");
    }
    dockSettings.classList.toggle("active", pageId === "settingsScreen" || pageId === "worldBookScreen" || pageId === "themeScreen" || pageId === "walletScreen" || pageId === "walletBillScreen" || pageId === "familyCardScreen" || pageId === "shopScreen");
  }

  function refreshHomeSummary() {
    var characters = window.AppStorage.getCharacters();
    var groups = window.AppStorage.getGroups ? window.AppStorage.getGroups() : [];
    var countText = getElement("homeCharacterCount");
    var summary = getElement("homeCharacterSummary");
    var count = characters.length;
    var groupCount = groups.length;

    if (countText) {
      countText.textContent = count + " 个角色 · " + groupCount + " 个群聊";
    }

    if (summary) {
      summary.textContent = count === 0 && groupCount === 0
        ? "还没有角色，先创建你的第一个角色。"
        : "已经创建 " + count + " 个角色和 " + groupCount + " 个群聊，继续你的故事。";
    }
  }

  function renderDesktop() {
    var viewport = getElement("desktopPagesViewport");
    var dots = getElement("desktopPageDots");
    var state = window.AppStorage.getDesktopState ? window.AppStorage.getDesktopState() : { currentPage: 0 };
    var pages = getDesktopPages();

    if (!viewport || !dots) {
      return;
    }

    currentDesktopPage = Math.max(0, Math.min(Number(state.currentPage) || 0, pages.length - 1));
    viewport.innerHTML = pages.map(function (pageApps, pageIndex) {
      return [
        '<div class="desktop-page" data-desktop-page="' + pageIndex + '">',
        '  <div class="desktop-app-grid">',
        pageApps.map(renderDesktopApp).join(""),
        "  </div>",
        "</div>"
      ].join("");
    }).join("");
    viewport.style.transform = "translateX(-" + (currentDesktopPage * 100) + "%)";

    viewport.classList.toggle("single-page", pages.length <= 1);
    dots.classList.toggle("hidden", pages.length <= 1);
    dots.innerHTML = pages.length > 1 ? pages.map(function (pageApps, pageIndex) {
      return '<button type="button" data-desktop-dot="' + pageIndex + '" class="' + (pageIndex === currentDesktopPage ? "active" : "") + '" aria-label="第 ' + (pageIndex + 1) + ' 页"></button>';
    }).join("") : "";

    bindDesktopPageActions(viewport, dots);
  }

  function getDesktopPages() {
    var pages = [];
    var index;

    for (index = 0; index < desktopApps.length; index += desktopPageSize) {
      pages.push(desktopApps.slice(index, index + desktopPageSize));
    }

    return pages.length ? pages : [[]];
  }

  function renderDesktopApp(app) {
    return [
      '<button class="desktop-app-icon" type="button" data-desktop-action="' + escapeHtml(app.action) + '">',
      '  <span class="desktop-icon-symbol ' + escapeHtml(app.className) + '" aria-hidden="true">' + escapeHtml(app.icon) + "</span>",
      "  <span>" + escapeHtml(app.name) + "</span>",
      "</button>"
    ].join("");
  }

  function bindDesktopPageActions(viewport, dots) {
    Array.prototype.forEach.call(viewport.querySelectorAll("[data-desktop-action]"), function (button) {
      button.addEventListener("click", function () {
        handleDesktopAction(button.dataset.desktopAction);
      });
    });

    Array.prototype.forEach.call(dots.querySelectorAll("[data-desktop-dot]"), function (button) {
      button.addEventListener("click", function () {
        setDesktopPage(Number(button.dataset.desktopDot));
      });
    });
  }

  function bindDesktopSwipe() {
    var viewport = getElement("desktopPagesViewport");

    if (!viewport) {
      return;
    }

    viewport.addEventListener("touchstart", function (event) {
      desktopTouchStartX = event.touches && event.touches[0] ? event.touches[0].clientX : 0;
      desktopTouchDeltaX = 0;
    }, { passive: true });

    viewport.addEventListener("touchmove", function (event) {
      var currentX = event.touches && event.touches[0] ? event.touches[0].clientX : desktopTouchStartX;
      desktopTouchDeltaX = currentX - desktopTouchStartX;
    }, { passive: true });

    viewport.addEventListener("touchend", function () {
      if (Math.abs(desktopTouchDeltaX) > 46) {
        setDesktopPage(currentDesktopPage + (desktopTouchDeltaX < 0 ? 1 : -1));
      }
      desktopTouchStartX = 0;
      desktopTouchDeltaX = 0;
    }, { passive: true });
  }

  function setDesktopPage(pageIndex) {
    var pages = getDesktopPages();
    var nextPage = Math.max(0, Math.min(Number(pageIndex) || 0, pages.length - 1));
    currentDesktopPage = nextPage;
    if (window.AppStorage.updateDesktopState) {
      window.AppStorage.updateDesktopState({ currentPage: nextPage });
    }
    renderDesktop();
  }

  function handleDesktopAction(action) {
    if (action === "wechat") {
      setWechatTab("wechat");
      setActivePage("wechatScreen");
      return;
    }
    if (action === "photo") {
      setActivePage("photoScreen");
      return;
    }
    if (action === "notebook") {
      setActivePage("notebookScreen");
      return;
    }
    if (action === "settings") {
      setActivePage("settingsScreen");
      return;
    }
    if (action === "shop") {
      setActivePage("shopScreen");
      return;
    }
    if (action === "worldbook") {
      setActivePage("worldBookScreen");
      return;
    }
    if (action === "diary") {
      openDiaryScreen();
      return;
    }
    if (action === "space") {
      openCharacterSpaceScreen();
      return;
    }
    if (action === "backup") {
      setActivePage("settingsScreen");
      return;
    }
    if (action === "theme") {
      setActivePage("themeScreen");
      return;
    }
    if (action === "wallet") {
      setActivePage("walletScreen");
      return;
    }
    if (action === "contacts") {
      setActivePage("characterListScreen");
      return;
    }
    if (action === "thoughts") {
      renderThoughtsScreen("全部心声", window.AppStorage.getCharacters().map(function (character) {
        return character.id;
      }), "", "global");
      setActivePage("thoughtsScreen");
      return;
    }
    if (action === "me") {
      setWechatTab("me");
      setActivePage("wechatScreen");
      return;
    }
    if (action === "watch") {
      openWatchListScreen();
      return;
    }
    if (action === "emoji") {
      window.alert("表情包图库在聊天表情面板里导入和使用。");
    }
    if (action === "outing") {
      openOutingScreen();
    }
  }

  function openWatchListScreen() {
    setActivePage("watchListScreen");
    if (window.WatchManager && window.WatchManager.renderSessionList) {
      window.WatchManager.renderSessionList();
    }
  }

  /* ===== 出去玩模块 ===== */

  var outingStep = "home"; // home | npc-setup | character-pick | place-pick | active | history
  var outingPendingCompanion = null;
  var outingSelectedPlaceId = "";
  var outingPendingMemorySource = { type: "auto", groupId: "" };
  var outingInputMode = "speech";
  var outingDraft = { companion: null, selectedPlaceId: "", memorySource: { type: "auto", groupId: "" } };

  /* ---- 持久化草稿 ---- */
  var OUTING_DRAFT_KEY = "myAiApp.outingDraft";

  function createEmptyOutingDraft() {
    return { step: "home", companion: null, selectedPlaceId: "", memorySource: { type: "auto", groupId: "" }, updatedAt: Date.now() };
  }

  function readOutingDraft() {
    var raw, parsed, fb = createEmptyOutingDraft();
    try {
      raw = sessionStorage.getItem(OUTING_DRAFT_KEY) || localStorage.getItem(OUTING_DRAFT_KEY);
      if (!raw) return fb;
      parsed = JSON.parse(raw);
    } catch (e) { return fb; }
    if (!parsed || typeof parsed !== "object") return fb;
    parsed.step = parsed.step || "home";
    parsed.companion = parsed.companion || null;
    parsed.selectedPlaceId = String(parsed.selectedPlaceId || "");
    parsed.memorySource = parsed.memorySource || { type: "auto", groupId: "" };
    parsed.memorySource.type = parsed.memorySource.type || "auto";
    parsed.memorySource.groupId = String(parsed.memorySource.groupId || "");
    parsed.updatedAt = Number(parsed.updatedAt) || Date.now();
    return parsed;
  }

  function saveOutingDraft(draft) {
    var next = Object.assign(createEmptyOutingDraft(), draft || {}, { updatedAt: Date.now() });
    next.selectedPlaceId = String(next.selectedPlaceId || "");
    next.memorySource = next.memorySource || { type: "auto", groupId: "" };
    try { sessionStorage.setItem(OUTING_DRAFT_KEY, JSON.stringify(next)); } catch (e) {}
    try { localStorage.setItem(OUTING_DRAFT_KEY, JSON.stringify(next)); } catch (e) {}
    return next;
  }

  function patchOutingDraft(patch) {
    return saveOutingDraft(Object.assign({}, readOutingDraft(), patch || {}));
  }

  function clearOutingDraft() {
    try { sessionStorage.removeItem(OUTING_DRAFT_KEY); } catch (e) {}
    try { localStorage.removeItem(OUTING_DRAFT_KEY); } catch (e) {}
    return createEmptyOutingDraft();
  }

  /* ---- 兼容旧调用 + 同步散变量 ---- */
  function syncLegacyFromStoredOutingDraft() {
    var draft = readOutingDraft();
    outingPendingCompanion = draft.companion || null;
    outingSelectedPlaceId = String(draft.selectedPlaceId || "");
    outingPendingMemorySource = draft.memorySource || { type: "auto", groupId: "" };
    outingDraft = { companion: outingPendingCompanion, selectedPlaceId: outingSelectedPlaceId, memorySource: outingPendingMemorySource };
    return draft;
  }

  function saveCurrentOutingDraftToStorage(patch) {
    var next = patchOutingDraft(Object.assign({
      step: outingStep || "home",
      companion: outingPendingCompanion || null,
      selectedPlaceId: String(outingSelectedPlaceId || ""),
      memorySource: outingPendingMemorySource || { type: "auto", groupId: "" }
    }, patch || {}));
    syncLegacyFromStoredOutingDraft();
    return next;
  }

  // 保留旧函数名，内部改为走持久化
  function syncOutingDraftFromLegacy() { return saveCurrentOutingDraftToStorage(); }
  function syncLegacyFromOutingDraft() { return syncLegacyFromStoredOutingDraft(); }

  function resetOutingDraftState() {
    clearOutingDraft();
    outingDraft = { companion: null, selectedPlaceId: "", memorySource: { type: "auto", groupId: "" } };
    outingPendingCompanion = null;
    outingSelectedPlaceId = "";
    outingPendingMemorySource = { type: "auto", groupId: "" };
  }

  function debugOutingDraft(label) {
    try {
      if (!localStorage.getItem("myAiApp.debugOuting")) return;
      console.debug("[OutingDraftDebug]", label, {
        step: outingStep,
        storedDraft: readOutingDraft(),
        legacyCompanion: outingPendingCompanion,
        legacyPlaceId: outingSelectedPlaceId
      });
    } catch (e) {}
  }

  function openOutingScreen() {
    var outing = window.AppStorage.getCurrentOuting();
    if (outing && outing.status === "active") {
      outingStep = "active";
      setActivePage("outingScreen");
      renderOutingActiveView(outing);
      return;
    }
    // 从首页入口打开：清草稿，回首页
    resetOutingDraftState();
    outingStep = "home";
    setActivePage("outingScreen");
    renderOutingHomeView();
  }

  function renderOutingScreen() {
    var outing = window.AppStorage.getCurrentOuting();
    var draft = readOutingDraft();
    if (outing && outing.status === "active") {
      outingStep = "active";
      renderOutingActiveView(outing);
      return;
    }
    if (outingStep === "history") {
      renderOutingHistoryView();
      return;
    }
    // 允许用持久化 draft 恢复地点选择流程
    if ((outingStep === "place-pick" || draft.step === "place-pick") && draft.companion) {
      outingStep = "place-pick";
      syncLegacyFromStoredOutingDraft();
      renderOutingPlacePickView();
      return;
    }
    if (outingStep === "character-pick") {
      renderOutingCharacterPickView();
      return;
    }
    if (outingStep === "npc-setup") {
      renderOutingNpcSetupView();
      return;
    }
    outingStep = "home";
    renderOutingHomeView();
  }

  function renderOutingHomeView() {
    var content = getElement("outingContent");
    if (!content) return;
    content.innerHTML = [
      '<div class="outing-pick-section">',
      '  <h3>你想和谁出去玩？</h3>',
      '  <div class="outing-pick-buttons">',
      '    <button class="outing-pick-btn" id="outingPickNpc">',
      '      <span class="outing-pick-icon">🧍</span>',
      '      <span class="outing-pick-label">和 NPC 出去玩</span>',
      '      <span class="outing-pick-desc">临时陪玩，不会影响角色聊天记忆</span>',
      '    </button>',
      '    <button class="outing-pick-btn" id="outingPickCharacter">',
      '      <span class="outing-pick-icon">👤</span>',
      '      <span class="outing-pick-label">和角色出去玩</span>',
      '      <span class="outing-pick-desc">出行后角色会记得这段经历</span>',
      '    </button>',
      '  </div>',
      '</div>'
    ].join("");

    var npcBtn = getElement("outingPickNpc");
    var charBtn = getElement("outingPickCharacter");
    if (npcBtn) {
      npcBtn.addEventListener("click", function () {
        outingStep = "npc-setup";
        renderOutingNpcSetupView();
      });
    }
    if (charBtn) {
      charBtn.addEventListener("click", function () {
        outingStep = "character-pick";
        renderOutingCharacterPickView();
      });
    }
  }

  function renderOutingNpcSetupView() {
    var content = getElement("outingContent");
    if (!content) return;
    content.innerHTML = [
      '<div class="outing-back-row"><button id="outingNpcBack">← 返回</button></div>',
      '<div class="outing-form-section">',
      '  <h3>设置 NPC</h3>',
      '  <div class="outing-field">',
      '    <label>NPC 名称</label>',
      '    <input id="outingNpcName" type="text" value="路人朋友" maxlength="20">',
      '  </div>',
      '  <div class="outing-field">',
      '    <label>NPC 类型</label>',
      '    <select id="outingNpcType">',
      '      <option value="普通朋友">普通朋友</option>',
      '      <option value="店员/服务员">店员/服务员</option>',
      '      <option value="同学">同学</option>',
      '      <option value="临时旅伴">临时旅伴</option>',
      '      <option value="陌生人">陌生人</option>',
      '    </select>',
      '  </div>',
      '  <div class="outing-field">',
      '    <label>性格（可留空）</label>',
      '    <textarea id="outingNpcPersona" placeholder="简单描述 NPC 的性格"></textarea>',
      '  </div>',
      '</div>',
      '<button class="outing-depart-btn" id="outingNpcNext">选择地点 →</button>'
    ].join("");

    var backBtn = getElement("outingNpcBack");
    var nextBtn = getElement("outingNpcNext");
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        outingStep = "home";
        renderOutingHomeView();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        var name = (getElement("outingNpcName") && getElement("outingNpcName").value.trim()) || "路人朋友";
        var type = (getElement("outingNpcType") && getElement("outingNpcType").value) || "普通朋友";
        var persona = (getElement("outingNpcPersona") && getElement("outingNpcPersona").value.trim()) || "";
        var companion = { type: "npc", id: "npc_" + Date.now(), name: name, npcType: type, persona: persona };
        outingStep = "place-pick";
        outingPendingCompanion = companion;
        outingSelectedPlaceId = "";
        outingPendingMemorySource = { type: "auto", groupId: "" };
        saveOutingDraft({ step: "place-pick", companion: companion, selectedPlaceId: "", memorySource: { type: "auto", groupId: "" } });
        syncLegacyFromStoredOutingDraft();
        debugOutingDraft("npc-selected");
        renderOutingPlacePickView();
      });
    }
  }

  function renderOutingCharacterPickView() {
    var content = getElement("outingContent");
    if (!content) return;
    var characters = window.AppStorage.getCharacters();

    var listHtml = characters.length === 0
      ? renderSoftEmpty("👤", "还没有角色", "先创建一个角色再来出去玩吧", "创建角色", 'data-empty-action="create-character"')
      : characters.map(function (c) {
          var avatarHtml = c.avatar
            ? '<img src="' + escapeHtml(c.avatar) + '" alt="">'
            : escapeHtml((c.name || "?").slice(0, 1));
          var persona = String(c.personality || c.persona || "").slice(0, 30);
          return [
            '<button class="outing-character-item" data-outing-char-id="' + escapeHtml(c.id) + '">',
            '  <span class="outing-character-avatar">' + avatarHtml + '</span>',
            '  <span class="outing-character-info">',
            '    <span class="outing-character-name">' + escapeHtml(c.name || "未命名") + '</span>',
            persona ? '    <span class="outing-character-persona">' + escapeHtml(persona) + '</span>' : '',
            '  </span>',
            '</button>'
          ].join("");
        }).join("");

    content.innerHTML = [
      '<div class="outing-back-row"><button id="outingCharBack">← 返回</button></div>',
      '<p class="outing-section-title">选择同行角色</p>',
      '<div class="outing-character-list">' + listHtml + '</div>'
    ].join("");

    var backBtn = getElement("outingCharBack");
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        outingStep = "home";
        renderOutingHomeView();
      });
    }

    Array.prototype.forEach.call(content.querySelectorAll("[data-outing-char-id]"), function (btn) {
      btn.addEventListener("click", function () {
        var charId = btn.dataset.outingCharId;
        var character = characters.find(function (c) { return String(c.id) === String(charId); });
        if (!character) return;
        var companion = {
          type: "character",
          id: character.id,
          name: character.name,
          avatar: character.avatar || "",
          persona: character.personality || character.persona || "",
          characterId: character.id
        };
        outingStep = "place-pick";
        outingPendingCompanion = companion;
        outingSelectedPlaceId = "";
        outingPendingMemorySource = { type: "auto", groupId: "" };
        saveOutingDraft({ step: "place-pick", companion: companion, selectedPlaceId: "", memorySource: { type: "auto", groupId: "" } });
        syncLegacyFromStoredOutingDraft();
        debugOutingDraft("character-selected");
        renderOutingPlacePickView();
      });
    });

    var emptyAction = content.querySelector("[data-empty-action='create-character']");
    if (emptyAction) {
      emptyAction.addEventListener("click", function () {
        setActivePage("createCharacterScreen");
      });
    }
  }

  function renderOutingPlacePickView() {
    var content = getElement("outingContent");
    if (!content) return;

    // 从持久化草稿读取，散变量作备用
    var draft = readOutingDraft();
    var companion = draft.companion || outingPendingCompanion || null;
    var selectedPlaceId = String(draft.selectedPlaceId || outingSelectedPlaceId || "");
    var memorySource = draft.memorySource || outingPendingMemorySource || { type: "auto", groupId: "" };

    // companion 丢失：静默回首页，不弹 toast（toast 只在出发时弹）
    if (!companion) {
      outingStep = "home";
      resetOutingDraftState();
      renderOutingHomeView();
      return;
    }

    // 同步散变量，确保 doStartOuting 读到最新值
    outingPendingCompanion = companion;
    outingSelectedPlaceId = selectedPlaceId;
    outingPendingMemorySource = memorySource;

    var places = window.AppStorage.getOutingPlaces();
    var groups = window.AppStorage.getGroups ? window.AppStorage.getGroups() : [];
    var priceSymbols = ["", "¥", "¥¥", "¥¥¥", "¥¥¥¥"];
    var selectedPlace = places.find(function (p) { return String(p.id) === selectedPlaceId; }) || null;
    var startBtnClass = selectedPlaceId ? "outing-depart-btn ready" : "outing-depart-btn";

    var placeCards = places.map(function (place) {
      var price = priceSymbols[place.priceLevel] || "¥";
      var isSelected = selectedPlace && String(selectedPlace.id) === String(place.id);
      var activeClass = isSelected ? " active" : "";
      var badge = isSelected ? '<span class="outing-place-selected-badge">✓ 已选</span>' : "";
      var activitiesText = (place.activities || []).slice(0, 3).join("、");
      return [
        '<button type="button" class="outing-place-card' + activeClass + '" data-outing-place-id="' + escapeHtml(String(place.id)) + '">',
        '  <div class="outing-place-card-header">',
        '    <span class="outing-place-name">' + escapeHtml(place.name) + '</span>',
        badge,
        '  </div>',
        '  <span class="outing-place-desc">' + escapeHtml(String(place.description || "").slice(0, 60)) + '</span>',
        '  <div class="outing-place-meta">',
        '    <span>' + escapeHtml(place.openingHours || "自定义") + '</span>',
        '    <span>' + price + '</span>',
        '  </div>',
        activitiesText ? '<span class="outing-place-activities">可做：' + escapeHtml(activitiesText) + '</span>' : "",
        '</button>'
      ].join("");
    }).join("");

    var memorySourceHtml = "";
    if (companion.type === "character") {
      memorySourceHtml = [
        '<div class="outing-memory-source">',
        '  <div class="outing-field-label">记忆来源</div>',
        '  <div class="outing-memory-options">',
        '    <button type="button" class="outing-memory-btn' + (memorySource.type === "auto" ? " active" : "") + '" data-memory-source="auto">自动</button>',
        '    <button type="button" class="outing-memory-btn' + (memorySource.type === "private" ? " active" : "") + '" data-memory-source="private">只读私聊</button>',
        '    <button type="button" class="outing-memory-btn' + (memorySource.type === "group" ? " active" : "") + '" data-memory-source="group">指定群聊</button>',
        '  </div>',
        memorySource.type === "group" ? renderOutingMemoryGroupSelect(groups, companion.characterId, memorySource.groupId) : "",
        '</div>'
      ].join("");
    }

    content.innerHTML = [
      '<div class="outing-back-row"><button type="button" id="outingPlaceBack">← 返回</button></div>',
      '<p class="outing-section-title">和 ' + escapeHtml(companion.name) + ' 去哪里？</p>',
      memorySourceHtml,
      '<div class="outing-place-list">' + placeCards + '</div>',
      '<div class="outing-place-confirm-row">',
      '  <button type="button" class="' + startBtnClass + '" id="outingPlaceStartBtn">出发</button>',
      '  <button type="button" class="outing-secondary-btn" id="outingCustomPlaceBtn">自定义地点</button>',
      '</div>'
    ].join("");

    var backBtn = getElement("outingPlaceBack");
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        var d = readOutingDraft();
        var c = d.companion || outingPendingCompanion;
        if (c && c.type === "npc") {
          outingStep = "npc-setup";
          renderOutingNpcSetupView();
        } else {
          outingStep = "character-pick";
          renderOutingCharacterPickView();
        }
      });
    }

    Array.prototype.forEach.call(content.querySelectorAll("[data-outing-place-id]"), function (btn) {
      btn.addEventListener("click", function () {
        var d = readOutingDraft();
        var pid = String(btn.dataset.outingPlaceId || "");
        saveOutingDraft(Object.assign({}, d, { step: "place-pick", selectedPlaceId: pid }));
        syncLegacyFromStoredOutingDraft();
        debugOutingDraft("place-clicked");
        renderOutingPlacePickView();
      });
    });

    Array.prototype.forEach.call(content.querySelectorAll("[data-memory-source]"), function (btn) {
      btn.addEventListener("click", function () {
        var d = readOutingDraft();
        var ms = Object.assign({}, d.memorySource || { type: "auto", groupId: "" });
        ms.type = btn.dataset.memorySource;
        if (ms.type !== "group") ms.groupId = "";
        saveOutingDraft(Object.assign({}, d, { step: "place-pick", memorySource: ms }));
        syncLegacyFromStoredOutingDraft();
        debugOutingDraft("memory-source-changed");
        renderOutingPlacePickView();
      });
    });

    var groupSelect = getElement("outingMemoryGroupSelect");
    if (groupSelect) {
      groupSelect.addEventListener("change", function () {
        var d = readOutingDraft();
        var ms = Object.assign({}, d.memorySource || { type: "group", groupId: "" });
        ms.type = "group";
        ms.groupId = groupSelect.value;
        saveOutingDraft(Object.assign({}, d, { step: "place-pick", memorySource: ms }));
        syncLegacyFromStoredOutingDraft();
        debugOutingDraft("memory-group-changed");
      });
    }

    var startBtn = getElement("outingPlaceStartBtn");
    if (startBtn) {
      startBtn.addEventListener("click", function () {
        var d = readOutingDraft();
        var finalCompanion = d.companion || outingPendingCompanion || null;
        var finalPlaceId = String(d.selectedPlaceId || outingSelectedPlaceId || "");
        // 兜底：从 DOM 激活卡片取
        if (!finalPlaceId) {
          var activeCard = content.querySelector(".outing-place-card.active");
          if (activeCard) finalPlaceId = String(activeCard.dataset.outingPlaceId || "");
        }
        debugOutingDraft("depart-clicked");
        if (!finalCompanion) {
          showToast("出行对象丢失，请重新选择同行对象。");
          outingStep = "home";
          resetOutingDraftState();
          renderOutingHomeView();
          return;
        }
        if (!finalPlaceId) {
          showToast("先选一个地方。");
          return;
        }
        saveOutingDraft(Object.assign({}, d, { step: "place-pick", companion: finalCompanion, selectedPlaceId: finalPlaceId }));
        syncLegacyFromStoredOutingDraft();
        doStartOuting(finalPlaceId);
      });
    }

    var customBtn = getElement("outingCustomPlaceBtn");
    if (customBtn) {
      customBtn.addEventListener("click", function () {
        openOutingCustomPlaceModal();
      });
    }
  }

  function renderOutingMemoryGroupSelect(groups, characterId, selectedGroupId) {
    var relatedGroups = (groups || []).filter(function (group) {
      return group && Array.isArray(group.memberIds) && group.memberIds.indexOf(characterId) !== -1;
    });
    if (!relatedGroups.length) {
      return '<div class="outing-memory-hint">该角色当前没有可用群聊。</div>';
    }
    return [
      '<div class="outing-field">',
      '  <label>指定群聊</label>',
      '  <select id="outingMemoryGroupSelect">',
      relatedGroups.map(function (group) {
        return '<option value="' + escapeHtml(group.id) + '"' + (String(group.id) === String(selectedGroupId) ? ' selected' : '') + '>' + escapeHtml(group.name || group.id) + '</option>';
      }).join(""),
      '  </select>',
      '</div>'
    ].join("");
  }

  function renderSelectedPlaceDetail(place) {
    if (!place) return "";
    var priceSymbols = ["", "¥", "¥¥", "¥¥¥", "¥¥¥¥"];
    return [
      '<div class="outing-place-detail">',
      '  <h4>' + escapeHtml(place.name) + '</h4>',
      '  <p class="outing-place-detail-desc">' + escapeHtml(place.description || "") + '</p>',
      '  <div class="outing-place-detail-meta">',
      '    <span>营业时间：' + escapeHtml(place.openingHours || "自定义") + '</span>',
      '    <span>消费等级：' + escapeHtml(priceSymbols[place.priceLevel] || "¥") + '</span>',
      '  </div>',
      '  <div class="outing-place-detail-activities">可做的事：' + escapeHtml((place.activities || []).join("、") || "无") + '</div>',
      '</div>'
    ].join("");
  }

  function doStartOuting(placeId) {
    var draft = readOutingDraft();
    debugOutingDraft("doStartOuting-enter");

    var companion = draft.companion || outingPendingCompanion || null;
    var finalPlaceId = String(placeId || draft.selectedPlaceId || outingSelectedPlaceId || "");
    var memorySource = draft.memorySource || outingPendingMemorySource || { type: "auto", groupId: "" };

    if (!companion) {
      showToast("出行对象丢失，请重新选择同行对象。");
      outingStep = "home";
      resetOutingDraftState();
      renderOutingHomeView();
      return;
    }

    if (!finalPlaceId) {
      showToast("先选一个地方。");
      return;
    }

    var mode = companion.type === "character" ? "character" : "npc";
    var outing = window.AppStorage.startOuting(mode, companion, finalPlaceId, { memorySource: memorySource });

    if (!outing) {
      showToast("出发失败，请重新选择地点。");
      return;
    }

    outingStep = "active";
    clearOutingDraft();
    resetOutingDraftState();

    window.AppStorage.addOutingEvent({
      type: "system",
      content: "你和" + outing.companion.name + "来到了" + outing.placeName + "。"
    });
    renderOutingActiveView(window.AppStorage.getCurrentOuting());
    triggerOutingAI("到达" + outing.placeName + "，刚进入");
  }

  function openOutingCustomPlaceModal() {
    var sheetHtml = [
      '<div class="outing-custom-sheet">',
      '  <h3>添加自定义地点</h3>',
      '  <div class="outing-field">',
      '    <label>地点名称</label>',
      '    <input id="outingCustomPlaceName" type="text" placeholder="例如：湖边公园">',
      '  </div>',
      '  <div class="outing-field">',
      '    <label>描述</label>',
      '    <textarea id="outingCustomPlaceDescription" placeholder="写一点地点特点"></textarea>',
      '  </div>',
      '  <div class="outing-field">',
      '    <label>消费等级</label>',
      '    <select id="outingCustomPlacePrice">',
      '      <option value="1">¥</option>',
      '      <option value="2">¥¥</option>',
      '      <option value="3">¥¥¥</option>',
      '      <option value="4">¥¥¥¥</option>',
      '    </select>',
      '  </div>',
      '  <div class="outing-field">',
      '    <label>可做的活动（逗号分隔）</label>',
      '    <input id="outingCustomPlaceActivities" type="text" placeholder="例如：散步, 喝咖啡">',
      '  </div>',
      '  <div class="outing-action-row">',
      '    <button type="button" id="outingCustomPlaceSaveBtn" class="outing-depart-btn">保存地点</button>',
      '    <button type="button" id="outingCustomPlaceCancelBtn" class="outing-secondary-btn">取消</button>',
      '  </div>',
      '</div>'
    ].join("");

    showWeChatSheet(sheetHtml, function (sheet) {
      var saveBtn = sheet.querySelector("#outingCustomPlaceSaveBtn");
      var cancelBtn = sheet.querySelector("#outingCustomPlaceCancelBtn");
      if (saveBtn) {
        saveBtn.addEventListener("click", function () {
          var name = (sheet.querySelector("#outingCustomPlaceName") || {}).value || "";
          var description = (sheet.querySelector("#outingCustomPlaceDescription") || {}).value || "";
          var price = Number((sheet.querySelector("#outingCustomPlacePrice") || {}).value) || 1;
          var activities = ((sheet.querySelector("#outingCustomPlaceActivities") || {}).value || "").split(/[,，]/).map(function (item) {
            return item.trim();
          }).filter(Boolean);
          if (!name.trim()) {
            showToast("请填写地点名称");
            return;
          }
          var place = window.AppStorage.addCustomOutingPlace({
            name: name.trim(),
            description: description.trim(),
            priceLevel: price,
            activities: activities,
            openingHours: "自定义"
          });
          var d = readOutingDraft();
          saveOutingDraft(Object.assign({}, d, { step: "place-pick", selectedPlaceId: String(place.id) }));
          syncLegacyFromStoredOutingDraft();
          closeWeChatSheet();
          debugOutingDraft("custom-place-saved");
          renderOutingPlacePickView();
        });
      }
      if (cancelBtn) {
        cancelBtn.addEventListener("click", function () {
          closeWeChatSheet();
        });
      }
    });
  }

  function openOutingCustomActivityModal() {
    var sheetHtml = [
      '<div class="outing-custom-sheet">',
      '  <h3>添加自定义活动</h3>',
      '  <div class="outing-field">',
      '    <label>动作描述</label>',
      '    <input id="outingCustomActivityName" type="text" placeholder="例如：一起看夜景">',
      '  </div>',
      '  <div class="outing-action-row">',
      '    <button type="button" id="outingCustomActivitySaveBtn" class="outing-depart-btn">添加活动</button>',
      '    <button type="button" id="outingCustomActivityCancelBtn" class="outing-secondary-btn">取消</button>',
      '  </div>',
      '</div>'
    ].join("");

    showWeChatSheet(sheetHtml, function (sheet) {
      var saveBtn = sheet.querySelector("#outingCustomActivitySaveBtn");
      var cancelBtn = sheet.querySelector("#outingCustomActivityCancelBtn");
      if (saveBtn) {
        saveBtn.addEventListener("click", function () {
          var activity = ((sheet.querySelector("#outingCustomActivityName") || {}).value || "").trim();
          if (!activity) {
            showToast("请输入活动内容");
            return;
          }
          doOutingActivity(activity);
          closeWeChatSheet();
        });
      }
      if (cancelBtn) {
        cancelBtn.addEventListener("click", function () {
          closeWeChatSheet();
        });
      }
    });
  }

  function openOutingCustomPurchaseModal() {
    var sheetHtml = [
      '<div class="outing-custom-sheet">',
      '  <h3>记录自定义消费</h3>',
      '  <div class="outing-field">',
      '    <label>消费项目</label>',
      '    <input id="outingCustomPurchaseName" type="text" placeholder="例如：棉花糖">',
      '  </div>',
      '  <div class="outing-field">',
      '    <label>价格</label>',
      '    <input id="outingCustomPurchasePrice" type="number" min="0" step="0.01" placeholder="0.00">',
      '  </div>',
      '  <div class="outing-action-row">',
      '    <button type="button" id="outingCustomPurchaseSaveBtn" class="outing-depart-btn">记录消费</button>',
      '    <button type="button" id="outingCustomPurchaseCancelBtn" class="outing-secondary-btn">取消</button>',
      '  </div>',
      '</div>'
    ].join("");

    showWeChatSheet(sheetHtml, function (sheet) {
      var saveBtn = sheet.querySelector("#outingCustomPurchaseSaveBtn");
      var cancelBtn = sheet.querySelector("#outingCustomPurchaseCancelBtn");
      if (saveBtn) {
        saveBtn.addEventListener("click", function () {
          var itemName = ((sheet.querySelector("#outingCustomPurchaseName") || {}).value || "").trim();
          var price = Number((sheet.querySelector("#outingCustomPurchasePrice") || {}).value) || 0;
          if (!itemName) {
            showToast("请输入消费项目");
            return;
          }
          if (price <= 0) {
            showToast("请输入有效价格");
            return;
          }
          var outing = window.AppStorage.getCurrentOuting();
          if (!outing) {
            showToast("当前没有出行");
            return;
          }
          window.AppStorage.addWalletLedger({
            type: "outing",
            direction: "expense",
            amount: price,
            title: "自定义消费",
            note: outing.placeName + " - " + itemName,
            sourceType: "outing",
            sourceId: outing.id,
            createdAt: Date.now()
          });
          window.AppStorage.addOutingPurchase({
            itemName: itemName,
            price: price,
            placeId: outing.placeId,
            placeName: outing.placeName
          });
          window.AppStorage.addOutingEvent({
            type: "purchase",
            content: "你记录了消费：" + itemName + "，花了 ¥" + price.toFixed(2) + "。"
          });
          closeWeChatSheet();
          renderOutingActiveView(window.AppStorage.getCurrentOuting());
          triggerOutingAI("记录了消费" + itemName);
        });
      }
      if (cancelBtn) {
        cancelBtn.addEventListener("click", function () {
          closeWeChatSheet();
        });
      }
    });
  }

  function doOutingUserInput() {
    var input = getElement("outingInput");
    if (!input) return;
    var value = (input.value || "").trim();
    if (!value) {
      showToast("请输入你想说的话或动作");
      return;
    }
    var outing = window.AppStorage.getCurrentOuting();
    if (!outing) return;
    var eventType = outingInputMode === "action" ? "action" : "speech";
    var content = value;
    if (eventType === "action" && !/^[\(（].*[\)）]$/.test(value)) {
      content = "（" + value + "）";
    }
    var evt = window.AppStorage.addOutingEvent({
      type: eventType,
      content: content
    });
    if (evt) appendOutingEvent(evt);
    input.value = "";
    triggerOutingAI(content, outingInputMode);
  }

  function doEditOuting(outingId) {
    var outing = window.AppStorage.getOutingById(outingId);
    if (!outing) return;
    var sheetHtml = [
      '<div class="outing-custom-sheet">',
      '  <h3>编辑出行</h3>',
      '  <p>地点：' + escapeHtml(outing.placeName || "") + '</p>',
      '  <div class="outing-action-row">',
      '    <button type="button" id="outingDeleteBtn" class="outing-secondary-btn">删除出行</button>',
      '    <button type="button" id="outingCloseEditBtn" class="outing-depart-btn">关闭</button>',
      '  </div>',
      '</div>'
    ].join("");
    showWeChatSheet(sheetHtml, function (sheet) {
      var deleteBtn = sheet.querySelector("#outingDeleteBtn");
      var closeBtn = sheet.querySelector("#outingCloseEditBtn");
      if (deleteBtn) {
        deleteBtn.addEventListener("click", function () {
          window.AppStorage.deleteOutingHistoryItem(outingId);
          window.AppStorage.removeSyncedOutingMemory(outingId);
          closeWeChatSheet();
          outingStep = "home";
          renderOutingHomeView();
          showToast("已删除该出行记录");
        });
      }
      if (closeBtn) {
        closeBtn.addEventListener("click", function () {
          closeWeChatSheet();
        });
      }
    });
  }

  function doEditOutingEvent(outingId, eventId) {
    var outing = window.AppStorage.getOutingById(outingId);
    if (!outing) return;
    var evt = (outing.events || []).find(function (item) { return String(item.id) === String(eventId); });
    if (!evt) return;
    var sheetHtml = [
      '<div class="outing-custom-sheet">',
      '  <h3>编辑事件</h3>',
      '  <div class="outing-field">',
      '    <textarea id="outingEditEventContent">' + escapeHtml(evt.content || "") + '</textarea>',
      '  </div>',
      '  <div class="outing-action-row">',
      '    <button type="button" id="outingEditEventSaveBtn" class="outing-depart-btn">保存</button>',
      '    <button type="button" id="outingEditEventDeleteBtn" class="outing-secondary-btn">删除事件</button>',
      '  </div>',
      '</div>'
    ].join("");
    showWeChatSheet(sheetHtml, function (sheet) {
      var saveBtn = sheet.querySelector("#outingEditEventSaveBtn");
      var deleteBtn = sheet.querySelector("#outingEditEventDeleteBtn");
      if (saveBtn) {
        saveBtn.addEventListener("click", function () {
          var content = ((sheet.querySelector("#outingEditEventContent") || {}).value || "").trim();
          if (!content) {
            showToast("请输入事件内容");
            return;
          }
          window.AppStorage.updateOutingEvent(outingId, eventId, { content: content });
          closeWeChatSheet();
          renderOutingActiveView(window.AppStorage.getOutingById(outingId));
        });
      }
      if (deleteBtn) {
        deleteBtn.addEventListener("click", function () {
          window.AppStorage.deleteOutingEvent(outingId, eventId);
          window.AppStorage.resyncOutingMemoryIfNeeded(outingId);
          closeWeChatSheet();
          renderOutingActiveView(window.AppStorage.getOutingById(outingId));
        });
      }
    });
  }

  function doEditOutingPurchase(purchaseId) {
    var outing = window.AppStorage.getCurrentOuting();
    if (!outing) return;
    var purchase = (outing.purchases || []).find(function (item) { return String(item.id) === String(purchaseId); });
    if (!purchase) return;
    var sheetHtml = [
      '<div class="outing-custom-sheet">',
      '  <h3>编辑消费</h3>',
      '  <div class="outing-field">',
      '    <label>项目</label>',
      '    <input id="outingEditPurchaseName" type="text" value="' + escapeHtml(purchase.itemName || "") + '">',
      '  </div>',
      '  <div class="outing-field">',
      '    <label>价格</label>',
      '    <input id="outingEditPurchasePrice" type="number" min="0" step="0.01" value="' + Number(purchase.price || 0).toFixed(2) + '">',
      '  </div>',
      '  <div class="outing-action-row">',
      '    <button type="button" id="outingEditPurchaseSaveBtn" class="outing-depart-btn">保存</button>',
      '    <button type="button" id="outingEditPurchaseDeleteBtn" class="outing-secondary-btn">删除消费</button>',
      '  </div>',
      '</div>'
    ].join("");
    showWeChatSheet(sheetHtml, function (sheet) {
      var saveBtn = sheet.querySelector("#outingEditPurchaseSaveBtn");
      var deleteBtn = sheet.querySelector("#outingEditPurchaseDeleteBtn");
      if (saveBtn) {
        saveBtn.addEventListener("click", function () {
          var itemName = ((sheet.querySelector("#outingEditPurchaseName") || {}).value || "").trim();
          var price = Number((sheet.querySelector("#outingEditPurchasePrice") || {}).value) || 0;
          if (!itemName) {
            showToast("请输入消费项目");
            return;
          }
          if (price <= 0) {
            showToast("请输入有效价格");
            return;
          }
          window.AppStorage.updateOutingPurchase(purchaseId, {
            itemName: itemName,
            price: price
          });
          closeWeChatSheet();
          renderOutingActiveView(window.AppStorage.getCurrentOuting());
        });
      }
      if (deleteBtn) {
        deleteBtn.addEventListener("click", function () {
          window.AppStorage.deleteOutingPurchase(purchaseId);
          window.AppStorage.resyncOutingMemoryIfNeeded(outing.id);
          closeWeChatSheet();
          renderOutingActiveView(window.AppStorage.getCurrentOuting());
        });
      }
    });
  }

  var outingAiPending = false;
  var outingAiPendingAt = 0;
  var outingGenerationToken = "";
  var OUTING_STUCK_RETRY_MS = 120 * 1000;

  function triggerOutingAI(trigger, inputMode) {
    if (outingAiPending) {
      if (Date.now() - outingAiPendingAt < OUTING_STUCK_RETRY_MS) {
        showToast("正在生成中，请稍等。");
        return;
      }
      outingAiPending = false;
      outingGenerationToken = "";
      setOutingLoading(false);
      showToast("上一轮卡住了，已重新生成。");
    }

    var outing = window.AppStorage.getCurrentOuting();
    if (!outing) return;

    outingAiPending = true;
    outingAiPendingAt = Date.now();
    setOutingLoading(true);

    if (!window.AIService || !window.AIService.sendOutingRequest) {
      outingAiPending = false;
      setOutingLoading(false);
      return;
    }

    var memoryContext = window.AppStorage.getOutingCompanionMemoryContext
      ? window.AppStorage.getOutingCompanionMemoryContext(outing, {
          memorySource: outing.memorySource || { type: "auto", groupId: "" }
        })
      : {};

    var token = "outing_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    outingGenerationToken = token;

    var context = {
      outing: outing,
      trigger: trigger,
      latestUserInput: trigger,
      latestUserInputMode: inputMode || outingInputMode,
      memorySource: outing.memorySource || { type: "auto", groupId: "" },
      memoryContext: memoryContext
    };

    window.AIService.sendOutingRequest(context).then(function (result) {
      if (token !== outingGenerationToken) {
        return;
      }

      if (!result) {
        return;
      }

      var currentOuting = window.AppStorage.getCurrentOuting();
      if (!currentOuting) {
        return;
      }

      var eventsToAdd = Array.isArray(result.events) ? result.events : [];
      eventsToAdd.forEach(function (evt) {
        if (!evt || !evt.content) {
          return;
        }

        window.AppStorage.addOutingEvent({
          type: evt.type || "action",
          speakerId: evt.speakerId || "",
          speakerName: evt.speakerName || "",
          content: evt.content || ""
        });
      });

      if (Array.isArray(result.memories) && result.memories.length) {
        currentOuting = window.AppStorage.getCurrentOuting();
        if (currentOuting) {
          currentOuting.aiMemories = Array.isArray(currentOuting.aiMemories) ? currentOuting.aiMemories : [];
          result.memories.forEach(function (mem) {
            if (!mem || !mem.content) {
              return;
            }

            currentOuting.aiMemories.push({
              characterId: mem.characterId || (currentOuting.companion && currentOuting.companion.characterId) || "",
              content: String(mem.content || ""),
              createdAt: Date.now()
            });
          });
          window.AppStorage.setCurrentOuting(currentOuting);
        }
      }

      renderOutingActiveView(window.AppStorage.getCurrentOuting());
    }).catch(function (err) {
      if (token !== outingGenerationToken) {
        return;
      }
      showToast(err && err.message ? String(err.message) : "出行 AI 生成失败，请重试。", true);
    }).finally(function () {
      if (token === outingGenerationToken) {
        outingAiPending = false;
        outingAiPendingAt = 0;
        setOutingLoading(false);
      }
    });
  }

  function scrollOutingStreamToBottom() {
    var stream = getElement("outingEventStream");
    if (stream) {
      stream.scrollTop = stream.scrollHeight;
    }
    var content = getElement("outingContent");
    if (content) {
      content.scrollTop = content.scrollHeight;
    }
  }

  function appendOutingEvent(evt) {
    var stream = getElement("outingEventStream");
    if (!stream) return;
    var loading = getElement("outingLoadingIndicator");
    var bubble = document.createElement("div");
    var typeClass = "type-" + (evt.type || "action");
    bubble.className = "outing-event-bubble " + typeClass;
    if (evt.type === "speech" && evt.speakerName) {
      var speaker = document.createElement("div");
      speaker.className = "outing-event-speaker";
      speaker.textContent = evt.speakerName;
      bubble.appendChild(speaker);
    }
    var text = document.createTextNode(evt.content || "");
    bubble.appendChild(text);
    if (loading) {
      stream.insertBefore(bubble, loading);
    } else {
      stream.appendChild(bubble);
    }
    scrollOutingStreamToBottom();
  }

  function setOutingLoading(loading) {
    var indicator = getElement("outingLoadingIndicator");
    if (indicator) {
      indicator.classList.toggle("hidden", !loading);
    }
  }

  function doOutingActivity(activityName) {
    var outing = window.AppStorage.getCurrentOuting();
    if (!outing) return;
    var evt = window.AppStorage.addOutingEvent({
      type: "activity",
      activity: activityName,
      content: "你和" + (outing.companion && outing.companion.name || "") + "在" + outing.placeName + activityName + "。"
    });
    if (evt) appendOutingEvent(evt);
    triggerOutingAI(activityName);
  }

  function renderOutingShopModal(shopId) {
    var shops = window.AppStorage.getOutingShops();
    var shop = shops[shopId];
    if (!shop) return;
    var outing = window.AppStorage.getCurrentOuting();
    if (!outing) return;

    var wallet = window.AppStorage.getWallet();
    var balance = wallet ? Number(wallet.balance) || 0 : 0;

    var itemsHtml = shop.items.map(function (item) {
      return [
        '<div class="outing-shop-item">',
        '  <span class="outing-shop-item-name">' + escapeHtml(item.name) + '</span>',
        '  <span class="outing-shop-item-price">¥' + Number(item.price).toFixed(2) + '</span>',
        '  <button class="outing-buy-btn" data-shop-item-id="' + escapeHtml(item.id) + '" data-shop-id="' + escapeHtml(shopId) + '">购买</button>',
        '</div>'
      ].join("");
    }).join("");

    var sheet = getElement("wechatSheet");
    var mask = getElement("wechatModalMask");
    if (!sheet || !mask) { showToast("无法打开商店"); return; }

    sheet.innerHTML = [
      '<div class="outing-shop-modal">',
      '  <h3>' + escapeHtml(shop.name) + '</h3>',
      '  <p style="font-size:12px;color:var(--color-muted);margin:0 0 12px;">余额：¥' + balance.toFixed(2) + '</p>',
      itemsHtml,
      '  <div style="padding-top:12px;text-align:center;"><button id="outingShopCloseBtn" style="background:none;border:none;color:var(--color-muted);font-size:14px;cursor:pointer;">关闭</button></div>',
      '</div>'
    ].join("");

    mask.classList.remove("hidden");

    var closeBtn = getElement("outingShopCloseBtn");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () { mask.classList.add("hidden"); });
    }

    mask.addEventListener("click", function handler(e) {
      if (e.target === mask) {
        mask.classList.add("hidden");
        mask.removeEventListener("click", handler);
      }
    });

    Array.prototype.forEach.call(sheet.querySelectorAll("[data-shop-item-id]"), function (btn) {
      btn.addEventListener("click", function () {
        var itemId = btn.dataset.shopItemId;
        var sId = btn.dataset.shopId;
        doOutingBuy(sId, itemId);
        mask.classList.add("hidden");
      });
    });
  }

  function doOutingBuy(shopId, itemId) {
    var shops = window.AppStorage.getOutingShops();
    var shop = shops[shopId];
    if (!shop) return;
    var item = shop.items.find(function (i) { return i.id === itemId; });
    if (!item) return;

    var wallet = window.AppStorage.getWallet();
    var balance = wallet ? Number(wallet.balance) || 0 : 0;
    if (balance < item.price) {
      showToast("余额不足，买不了这个。", true);
      return;
    }

    var outing = window.AppStorage.getCurrentOuting();
    if (!outing) return;

    window.AppStorage.addWalletLedger({
      type: "outing",
      direction: "expense",
      amount: item.price,
      title: "出去玩消费",
      note: outing.placeName + " - " + item.name,
      sourceType: "outing",
      sourceId: outing.id,
      createdAt: Date.now()
    });

    var purchase = window.AppStorage.addOutingPurchase({
      itemId: item.id,
      itemName: item.name,
      shopId: shopId,
      shopName: shop.name,
      price: item.price,
      placeId: outing.placeId,
      placeName: outing.placeName
    });

    var buyEvt = window.AppStorage.addOutingEvent({
      type: "purchase",
      content: "你买了" + item.name + "，花了 ¥" + item.price.toFixed(2) + "。"
    });

    if (buyEvt) appendOutingEvent(buyEvt);

    var updatedOuting = window.AppStorage.getCurrentOuting();
    var metaSpent = getElement("outingContent") && getElement("outingContent").querySelector(".outing-active-meta span:last-child");
    if (metaSpent && updatedOuting) {
      metaSpent.textContent = "¥" + Number(updatedOuting.spentTotal || 0).toFixed(2);
    }

    triggerOutingAI("买了" + item.name);
  }

  function doEndOuting() {
    var outing = window.AppStorage.endOuting();
    if (!outing) return;

    if (outing.mode === "character") {
      window.AppStorage.syncOutingMemoryToCharacter(outing);
    }

    var content = getElement("outingContent");
    if (content) {
      content.innerHTML = [
        '<div style="padding:32px 16px;text-align:center;">',
        '  <div style="font-size:40px;margin-bottom:16px;">🏠</div>',
        '  <strong style="display:block;font-size:18px;margin-bottom:8px;">这次出行结束了</strong>',
        '  <p style="color:var(--color-muted);font-size:14px;margin-bottom:24px;">',
        '    去了 ' + escapeHtml(outing.placeName) + '，和 ' + escapeHtml((outing.companion && outing.companion.name) || "") +
        ' 花了 ¥' + Number(outing.spentTotal || 0).toFixed(2),
        '  </p>',
        outing.mode === "character" ? '<p style="color:var(--color-green);font-size:13px;margin-bottom:20px;">📝 记忆已同步到角色</p>' : '',
        '  <button id="outingDoneGoHomeBtn" class="outing-depart-btn" style="margin:0 auto;max-width:200px;display:block;">回到首页</button>',
        '</div>'
      ].join("");

      var homeBtn = getElement("outingDoneGoHomeBtn");
      if (homeBtn) {
        homeBtn.addEventListener("click", function () {
          outingStep = "home";
          goHome();
        });
      }
    }
  }

  function renderOutingHistoryView() {
    var content = getElement("outingContent");
    if (!content) return;
    outingStep = "history";
    var history = window.AppStorage.getOutingHistory();

    var listHtml = history.length === 0
      ? renderSoftEmpty("🧭", "还没有出行记录", "出去玩一次之后会留下记录")
      : history.slice(0, 10).map(function (outing, idx) {
          var date = outing.startedAt ? new Date(outing.startedAt).toLocaleDateString("zh-CN") : "";
          var eventsPreview = (outing.events || []).slice(0, 5).map(function (e) {
            return '<div style="margin-bottom:3px;">' + escapeHtml(e.content || "") + '</div>';
          }).join("");
          return [
            '<div class="outing-history-item">',
            '  <div class="outing-history-item-header">',
            '    <span class="outing-history-place">' + escapeHtml(outing.placeName || "") + '</span>',
            '    <span class="outing-history-time">' + escapeHtml(date) + '</span>',
            '  </div>',
            '  <div class="outing-history-meta">',
            '    <span>' + escapeHtml((outing.companion && outing.companion.name) || "") + '</span>',
            '    <span>¥' + Number(outing.spentTotal || 0).toFixed(2) + '</span>',
            '  </div>',
            eventsPreview ? [
              '  <button class="outing-history-toggle" data-outing-history-toggle="' + idx + '">展开过程</button>',
              '  <div class="outing-history-events" id="outingHistoryEvents' + idx + '">' + eventsPreview + '</div>'
            ].join("") : '',
            '</div>'
          ].join("");
        }).join("");

    content.innerHTML = [
      '<div class="outing-back-row"><button id="outingHistoryBack">← 返回</button></div>',
      '<p class="outing-section-title">出行历史</p>',
      '<div class="outing-history-list">' + listHtml + '</div>'
    ].join("");

    var backBtn = getElement("outingHistoryBack");
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        var d = readOutingDraft();
        if (d && d.step === "place-pick" && d.companion) {
          outingStep = "place-pick";
          syncLegacyFromStoredOutingDraft();
          renderOutingPlacePickView();
          return;
        }
        outingStep = "home";
        renderOutingHomeView();
      });
    }

    Array.prototype.forEach.call(content.querySelectorAll("[data-outing-history-toggle]"), function (btn) {
      btn.addEventListener("click", function () {
        var idx = btn.dataset.outingHistoryToggle;
        var panel = getElement("outingHistoryEvents" + idx);
        if (panel) {
          panel.classList.toggle("expanded");
          btn.textContent = panel.classList.contains("expanded") ? "收起" : "展开过程";
        }
      });
    });
  }

  /* ===== 出去玩模块结束 ===== */

  function normalizeWechatTab(tab) {
    var nextTab = String(tab || "wechat");

    if (nextTab === "discover") {
      return "moments";
    }

    if (nextTab === "spirit") {
      return "wechat";
    }

    return ["wechat", "moments", "me"].indexOf(nextTab) === -1 ? "wechat" : nextTab;
  }

  function setWechatTab(tab) {
    var nextTab = normalizeWechatTab(tab);

    if (window.AppStorage.updateWechatState) {
      window.AppStorage.updateWechatState({ tab: nextTab });
    }
    renderWechatScreen();
  }

  function renderWechatScreen() {
    var content = getElement("wechatTabContent");
    var state = window.AppStorage.getWechatState ? window.AppStorage.getWechatState() : { tab: "wechat" };
    var tab = normalizeWechatTab(state.tab || "wechat");

    if (!content) {
      return;
    }

    if (state.tab !== tab && window.AppStorage.updateWechatState) {
      window.AppStorage.updateWechatState({ tab: tab });
    }

    renderWechatTabbar(tab);

    if (tab === "moments") {
      renderWechatMomentsTab(content);
      return;
    }

    if (tab === "me") {
      renderWechatMeTab(content);
      return;
    }

    renderWechatChatsTab(content);
  }

  function renderWechatTabbar(activeTab) {
    var tab = normalizeWechatTab(activeTab);

    Array.prototype.forEach.call(document.querySelectorAll("[data-wechat-tab]"), function (button) {
      button.classList.toggle("active", button.dataset.wechatTab === tab);
    });
  }

  function renderWechatChatsTab(content) {
    var recentItems = getRecentChats();

    content.innerHTML = [
      '<section class="wechat-list-panel chat-list-only" aria-label="聊天列表">',
      '  <div id="wechatRecentList" class="recent-chat-list">',
      recentItems.length ? recentItems.map(renderRecentChatItem).join("") : renderSoftEmpty("微", "还没有会话", "创建角色或群聊后，会直接出现在微信列表里。", "创建角色", 'data-wechat-entry="new-character"'),
      "  </div>",
      "</section>"
    ].join("");

    bindWechatEntryActions(content);

    Array.prototype.forEach.call(content.querySelectorAll("[data-recent-open]"), function (item) {
      item.addEventListener("click", function () {
        if (item.dataset.recentType === "private") {
          window.CharacterManager.openChatScreen(item.dataset.recentId);
        } else {
          window.GroupManager.openGroupChatScreen(item.dataset.recentId);
        }
      });
    });

    Array.prototype.forEach.call(content.querySelectorAll("[data-recent-action]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        handleRecentAction(button.dataset.recentAction, button.dataset.recentType, button.dataset.recentId, Number(button.dataset.recentTime) || Date.now());
      });
    });
  }

  function bindWechatEntryActions(content) {
    Array.prototype.forEach.call(content.querySelectorAll("[data-wechat-entry]"), function (button) {
      button.addEventListener("click", function () {
        handleWechatEntryAction(button.dataset.wechatEntry);
      });
    });
  }

  function toggleWechatAddMenu() {
    var menu = getElement("wechatAddMenu");

    if (!menu) {
      return;
    }

    menu.classList.toggle("hidden");
  }

  function closeWechatAddMenu() {
    var menu = getElement("wechatAddMenu");

    if (menu) {
      menu.classList.add("hidden");
    }
  }

  function bindWechatAddMenu() {
    var menu = getElement("wechatAddMenu");

    if (!menu) {
      return;
    }

    menu.addEventListener("click", function (event) {
      var button = event.target.closest("[data-wechat-add-action]");
      event.stopPropagation();

      if (!button) {
        return;
      }

      handleWechatAddAction(button.dataset.wechatAddAction);
      closeWechatAddMenu();
    });
  }

  function handleWechatAddAction(action) {
    if (action === "private") {
      setActivePage("characterListScreen");
      return;
    }

    if (action === "group") {
      window.GroupManager.openCreateGroupScreen();
      return;
    }

    if (action === "watch") {
      if (window.WatchManager && window.WatchManager.openSetup) {
        window.WatchManager.openSetup("wechatScreen");
      }
      return;
    }

    if (action === "character") {
      window.CharacterManager.openCreateCharacterScreen();
      return;
    }

    if (action === "import-character") {
      var input = getElement("characterImportInput");
      if (input) {
        input.value = "";
        input.click();
      }
    }
  }

  function handleWechatEntryAction(action) {
    if (action === "private" || action === "contacts") {
      setActivePage("characterListScreen");
      return;
    }
    if (action === "group") {
      setActivePage("groupListScreen");
      return;
    }
    if (action === "new-character") {
      window.CharacterManager.openCreateCharacterScreen();
      return;
    }
    if (action === "new-group") {
      window.GroupManager.openCreateGroupScreen();
      return;
    }
    if (action === "wallet") {
      setActivePage("walletScreen");
      return;
    }
    if (action === "photo") {
      setActivePage("photoScreen");
      return;
    }
    if (action === "diary") {
      openDiaryScreen();
      return;
    }
    if (action === "worldbook") {
      setActivePage("worldBookScreen");
      return;
    }
    if (action === "space") {
      openCharacterSpaceScreen();
      return;
    }
    if (action === "theme") {
      setActivePage("themeScreen");
      return;
    }
    if (action === "backup") {
      setActivePage("settingsScreen");
    }
  }

  function renderWechatMomentsTab(content) {
    var moments = renderMomentFeed();

    content.innerHTML = [
      '<section class="moments-page">',
      '  <div class="moments-toolbar">',
      '    <div><strong>朋友圈</strong><em>所有人的近况都在这里</em></div>',
      '    <button type="button" data-moment-action="open-publish">发朋友圈</button>',
      '    <button type="button" data-moment-action="character-update">角色更新</button>',
      "  </div>",
      '  <section class="moments-feed" aria-label="朋友圈列表">',
      moments.length ? moments.map(renderMomentItem).join("") : renderEmptyMoments(),
      "  </section>",
      "</section>"
    ].join("");

    bindMomentsActions(content);
    maybeGenerateCharacterMomentOnOpen();
  }

  function renderMomentFeed() {
    var moments = window.AppStorage.getMoments ? window.AppStorage.getMoments() : [];

    return moments.slice().sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function renderEmptyMoments() {
    return renderSoftEmpty("友", "还没有朋友圈", "先发一条文字动态，角色也会慢慢参与进来。", "发朋友圈", 'data-moment-action="open-publish"');
  }

  function renderMomentItem(moment) {
    var source = moment || {};
    var profile = window.AppStorage.getUserProfile();
    var character = source.authorType === "character" && source.authorId ? getCharacterById(source.authorId) : null;
    var author = character || {
      name: source.authorName || profile.name || "林澈",
      avatar: source.authorAvatar || profile.avatar || ""
    };
    var userLikeKey = getMomentUserLikeKey();
    var liked = (source.likes || []).indexOf(userLikeKey) !== -1;
    var comments = source.comments || [];
    var collapsed = comments.length > 3;

    return [
      '<article class="moment-card" data-moment-id="' + escapeHtml(source.id) + '">',
      renderSmallAvatar(author, "moment-avatar"),
      '  <div class="moment-main">',
      '    <div class="moment-meta"><strong>' + escapeHtml(author.name || "林澈") + '</strong><time>' + escapeHtml(formatDateTime(source.createdAt)) + "</time></div>",
      '    <p>' + escapeHtml(source.content || "") + "</p>",
      renderMomentImages(source.images || []),
      '    <div class="moment-actions"><button type="button" class="' + (liked ? "active" : "") + '" data-moment-action="like">' + (liked ? "已赞" : "赞") + ((source.likes || []).length ? " " + (source.likes || []).length : "") + '</button><button type="button" data-moment-action="comment">评论</button><button type="button" data-moment-action="delete">删除</button></div>',
      comments.length ? '<div class="moment-comments' + (collapsed ? " collapsed" : "") + '">' + comments.map(renderMomentComment).join("") + (collapsed ? '<button type="button" data-moment-action="expand-comments">展开全部评论</button>' : "") + "</div>" : "",
      "  </div>",
      "</article>"
    ].join("");
  }

  function renderMomentImages(images) {
    if (!images || !images.length) {
      return "";
    }

    return '<div class="moment-images">' + images.slice(0, 9).map(function (image) {
      if (image.src) {
        return '<img src="' + escapeHtml(image.src) + '" alt="' + escapeHtml(image.description || "朋友圈图片") + '">';
      }
      return '<span>' + escapeHtml(image.description || "图片") + "</span>";
    }).join("") + "</div>";
  }

  function renderMomentComment(comment) {
    return '<span><strong>' + escapeHtml(comment.authorName || "我") + '：</strong>' + escapeHtml(comment.content || "") + "</span>";
  }

  function getMomentUserLikeKey() {
    var profile = window.AppStorage.getUserProfile ? window.AppStorage.getUserProfile() : {};
    return "user:" + (profile.wxid || "me");
  }

  function bindMomentsActions(content) {
    Array.prototype.forEach.call(content.querySelectorAll("[data-moment-action]"), function (button) {
      button.addEventListener("click", function () {
        handleMomentAction(button.dataset.momentAction, button.closest(".moment-card"), content);
      });
    });
  }

  function handleMomentAction(action, card, content) {
    var momentId = card ? card.dataset.momentId : "";

    if (action === "open-publish") {
      openMomentPublishSheet();
      return;
    }

    if (action === "character-update") {
      openCharacterMomentPicker();
      return;
    }

    if (!momentId) {
      return;
    }

    if (action === "like") {
      toggleMomentLike(momentId);
      renderWechatMomentsTab(content);
      return;
    }

    if (action === "comment") {
      openMomentCommentSheet(momentId);
      return;
    }

    if (action === "delete" && window.confirm("删除这条朋友圈吗？")) {
      window.AppStorage.deleteMoment(momentId);
      renderWechatMomentsTab(content);
      return;
    }

    if (action === "expand-comments") {
      card.querySelector(".moment-comments").classList.remove("collapsed");
      card.querySelector("[data-moment-action='expand-comments']").remove();
    }
  }

  function toggleMomentLike(momentId) {
    var moment = getMomentById(momentId);
    var likeKey = getMomentUserLikeKey();
    var likes;

    if (!moment || !window.AppStorage.updateMoment) {
      return;
    }

    likes = (moment.likes || []).slice();
    if (likes.indexOf(likeKey) === -1) {
      likes.push(likeKey);
    } else {
      likes = likes.filter(function (item) {
        return item !== likeKey;
      });
    }
    window.AppStorage.updateMoment(momentId, { likes: likes });
  }

  function getMomentById(momentId) {
    return (window.AppStorage.getMoments ? window.AppStorage.getMoments() : []).find(function (moment) {
      return moment.id === momentId;
    }) || null;
  }

  function openMomentPublishSheet() {
    var author = getDefaultUserPersonaForDisplay();

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>发朋友圈</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<form id="momentPublishForm" class="wechat-sheet-form moment-publish-form" autocomplete="off">',
      '  <div class="moment-publish-author">' + renderProfileAvatar(author) + '<span><strong>' + escapeHtml(author.name || "我") + '</strong><em>发布到统一朋友圈</em></span></div>',
      '  <label class="wechat-sheet-field"><span>内容</span><textarea id="momentPublishText" maxlength="500" placeholder="写点此刻想留下的话"></textarea></label>',
      '  <label class="wechat-sheet-field"><span>图片</span><input id="momentPublishImage" type="file" accept="image/*"></label>',
      '  <div id="momentPublishPreview" class="moment-publish-preview hidden"></div>',
      '  <p id="momentPublishError" class="sheet-error" role="alert"></p>',
      '  <div class="wechat-sheet-actions"><button type="button" class="outline-button" data-close-sheet>取消</button><button id="momentPublishSubmit" type="submit" class="full-button">发布</button></div>',
      "</form>"
    ].join(""), function (sheet) {
      var form = sheet.querySelector("#momentPublishForm");
      var fileInput = sheet.querySelector("#momentPublishImage");
      var preview = sheet.querySelector("#momentPublishPreview");
      var imageData = "";

      bindSheetCloseButtons(sheet);

      fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) {
          imageData = "";
          preview.classList.add("hidden");
          preview.innerHTML = "";
          return;
        }

        readFileAsDataUrl(file).then(function (dataUrl) {
          imageData = dataUrl;
          preview.classList.remove("hidden");
          preview.innerHTML = '<img src="' + escapeHtml(dataUrl) + '" alt="">';
        }).catch(function () {
          sheet.querySelector("#momentPublishError").textContent = "图片读取失败，请重新选择。";
        });
      });

      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        await publishUserMoment(sheet, imageData);
      });
    });
  }

  async function publishUserMoment(sheet, imageData) {
    var text = sheet.querySelector("#momentPublishText").value.trim();
    var error = sheet.querySelector("#momentPublishError");
    var submit = sheet.querySelector("#momentPublishSubmit");
    var profile = window.AppStorage.getUserProfile();
    var author = getDefaultUserPersonaForDisplay();
    var comments = [];
    var aiResult;
    var moment;

    if (!text && !imageData) {
      error.textContent = "先写一点内容，或添加一张图片。";
      return;
    }

    submit.disabled = true;
    submit.textContent = "发布中";

    if (isApiConfigured() && profile.momentsAutoReview) {
      try {
        aiResult = await generateMomentWithComments({
          author: {
            authorType: "user",
            id: profile.wxid || "me",
            name: author.name || profile.name || "我",
            avatar: author.avatar || profile.avatar || "",
            personality: author.extra || profile.persona || ""
          },
          prompt: text,
          relatedCharacters: getRelatedCharactersForMoment(""),
          reason: "用户发布朋友圈",
          memories: window.AppStorage.getMemoriesForCharacters(window.AppStorage.getCharacters().map(function (character) {
            return character.id;
          }))
        });
        comments = buildMomentComments(aiResult.comments || []);
      } catch (apiError) {
        comments = [];
      }
    }

    moment = window.AppStorage.addMoment({
      authorType: "user",
      authorId: profile.wxid || "me",
      authorName: author.name || profile.name || "我",
      authorAvatar: author.avatar || profile.avatar || "",
      content: text || "分享了一张图片",
      images: imageData ? [{ src: imageData, description: "用户上传的朋友圈图片" }] : [],
      comments: comments,
      source: "manual",
      visibility: "all"
    });
    writeMomentInteractionMemory(moment);
    closeWeChatSheet();
    renderWechatScreen();
  }

  function openMomentCommentSheet(momentId) {
    var moment = getMomentById(momentId);
    var profile = window.AppStorage.getUserProfile();
    var author = getDefaultUserPersonaForDisplay();

    if (!moment) {
      return;
    }

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>评论朋友圈</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<form id="momentCommentForm" class="wechat-sheet-form" autocomplete="off">',
      '  <label class="wechat-sheet-field"><span>评论</span><textarea id="momentCommentText" maxlength="160" placeholder="写一句评论"></textarea></label>',
      '  <p id="momentCommentError" class="sheet-error" role="alert"></p>',
      '  <div class="wechat-sheet-actions"><button type="button" class="outline-button" data-close-sheet>取消</button><button type="submit" class="full-button">发送</button></div>',
      "</form>"
    ].join(""), function (sheet) {
      bindSheetCloseButtons(sheet);
      sheet.querySelector("#momentCommentForm").addEventListener("submit", function (event) {
        var text = sheet.querySelector("#momentCommentText").value.trim();
        event.preventDefault();

        if (!text) {
          sheet.querySelector("#momentCommentError").textContent = "先写一句评论。";
          return;
        }

        addMomentComment(momentId, {
          authorType: "user",
          authorId: profile.wxid || "me",
          authorName: author.name || profile.name || "我",
          authorAvatar: author.avatar || profile.avatar || "",
          content: text,
          createdAt: Date.now()
        });
        closeWeChatSheet();
        renderWechatScreen();
      });
    });
  }

  function addMomentComment(momentId, comment) {
    var added = window.AppStorage.addMomentComment ? window.AppStorage.addMomentComment(momentId, comment) : null;
    var moment = getMomentById(momentId);

    if (added && moment && comment && comment.authorType === "user" && moment.authorType === "character" && moment.authorId) {
      window.AppStorage.addCharacterMemory(moment.authorId, {
        content: "用户评论了我的朋友圈：" + comment.content,
        source: "moments",
        createdAt: Date.now()
      });
    }

    return added;
  }

  function openCharacterMomentPicker() {
    var characters = window.AppStorage.getCharacters().filter(function (character) {
      return getCharacterMomentSettings(character).autoPostEnabled;
    });

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>让角色更新朋友圈</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<div class="wechat-sheet-form moment-character-picker">',
      characters.length ? characters.map(function (character) {
        return '<button type="button" data-character-moment="' + escapeHtml(character.id) + '">' + renderSmallAvatar(character, "moment-picker-avatar") + '<span><strong>' + escapeHtml(character.name || "角色") + '</strong><em>' + escapeHtml(buildCharacterPersonaText(character) || "允许主动发朋友圈") + "</em></span></button>";
      }).join("") : '<div class="soft-empty">还没有开启主动朋友圈的角色。</div>',
      '  <p id="characterMomentError" class="sheet-error" role="alert"></p>',
      "</div>"
    ].join(""), function (sheet) {
      bindSheetCloseButtons(sheet);
      Array.prototype.forEach.call(sheet.querySelectorAll("[data-character-moment]"), function (button) {
        button.addEventListener("click", async function () {
          var error = sheet.querySelector("#characterMomentError");
          button.disabled = true;
          error.textContent = "正在生成朋友圈...";
          try {
            await generateCharacterMoment(button.dataset.characterMoment);
            closeWeChatSheet();
            renderWechatScreen();
          } catch (generateError) {
            error.textContent = generateError && generateError.message ? generateError.message : "生成失败。";
            button.disabled = false;
          }
        });
      });
    });
  }

  function getCharacterMomentSettings(character) {
    var source = character && character.momentSettings || {};
    var frequency = ["low", "normal", "high"].indexOf(source.frequency) === -1 ? "normal" : source.frequency;

    return {
      autoPostEnabled: source.autoPostEnabled !== false,
      frequency: frequency,
      allowRelatedCharacterComments: source.allowRelatedCharacterComments !== false,
      lastGeneratedAt: Number(source.lastGeneratedAt) || 0
    };
  }

  function getCharacterDiarySettings(character) {
    var source = character && character.diarySettings || {};
    var frequency = ["daily", "often", "low"].indexOf(source.frequency) === -1 ? "daily" : source.frequency;

    return {
      autoDiaryEnabled: source.autoDiaryEnabled !== false,
      frequency: frequency,
      allowUseChatHistory: source.allowUseChatHistory !== false,
      allowUseThoughts: source.allowUseThoughts !== false
    };
  }

  function getRelatedCharactersForMoment(authorCharacterId) {
    var characters = window.AppStorage.getCharacters();
    var groups = window.AppStorage.getGroups ? window.AppStorage.getGroups() : [];
    var author = authorCharacterId ? getCharacterById(authorCharacterId) : null;
    var relatedIds = {};
    var authorText = author ? [author.name, buildCharacterPersonaText(author)].join(" ") : "";

    if (!authorCharacterId) {
      return characters.slice(0, 8);
    }

    groups.forEach(function (group) {
      if ((group.memberIds || []).indexOf(authorCharacterId) === -1) {
        return;
      }
      (group.memberIds || []).forEach(function (memberId) {
        if (memberId !== authorCharacterId) {
          relatedIds[memberId] = true;
        }
      });
    });

    characters.forEach(function (character) {
      var text = [character.name, buildCharacterPersonaText(character)].join(" ");
      if (character.id !== authorCharacterId && author && (text.indexOf(author.name) !== -1 || authorText.indexOf(character.name) !== -1)) {
        relatedIds[character.id] = true;
      }
    });

    return characters.filter(function (character) {
      return relatedIds[character.id];
    }).slice(0, 8);
  }

  async function generateCharacterMoment(characterId) {
    var character = getCharacterById(characterId);
    var settings = getCharacterMomentSettings(character);
    var relatedCharacters;
    var aiResult;
    var moment;

    if (!character) {
      throw new Error("没有找到角色。");
    }

    if (!settings.autoPostEnabled) {
      throw new Error("这个角色没有开启主动发朋友圈。");
    }

    if (!isApiConfigured()) {
      throw new Error("请先在设置页填写 API 地址、API Key 和模型名称。");
    }

    relatedCharacters = settings.allowRelatedCharacterComments ? getRelatedCharactersForMoment(characterId) : [];
    aiResult = await generateMomentWithComments({
      author: Object.assign({ authorType: "character" }, character),
      prompt: character.name + " 想更新一条朋友圈。",
      reason: "角色主动发朋友圈",
      recentText: collectMomentRecentText(characterId),
      relatedCharacters: relatedCharacters,
      userSettings: character.chatSettings || {},
      memories: window.AppStorage.getMemoriesForCharacters([characterId].concat(relatedCharacters.map(function (item) {
        return item.id;
      })))
    });

    moment = window.AppStorage.addMoment({
      authorType: "character",
      authorId: character.id,
      authorName: character.name,
      authorAvatar: character.avatar || "",
      content: aiResult.moment.content || "今天也在心屿空间里留了一点痕迹。",
      images: aiResult.moment.images || [],
      comments: buildMomentComments(aiResult.comments || []),
      source: "ai",
      visibility: "all"
    });
    writeMomentInteractionMemory(moment, aiResult.memories || []);
    window.AppStorage.updateCharacter(character.id, {
      momentSettings: Object.assign({}, settings, {
        lastGeneratedAt: Date.now()
      })
    });
    return moment;
  }

  async function generateMomentWithComments(context) {
    if (!window.AIService || !window.AIService.generateMomentWithComments) {
      return { moment: { content: "" }, comments: [], memories: [] };
    }

    return window.AIService.generateMomentWithComments(context || {});
  }

  function buildMomentComments(comments) {
    return (comments || []).map(function (comment) {
      var character = getCharacterById(comment.characterId);
      if (!character || !comment.content) {
        return null;
      }
      return {
        authorType: "character",
        authorId: character.id,
        authorName: character.name,
        authorAvatar: character.avatar || "",
        content: comment.content,
        createdAt: Date.now()
      };
    }).filter(Boolean).slice(0, 5);
  }

  function writeMomentInteractionMemory(moment, memories) {
    if (!moment) {
      return;
    }

    if (moment.authorType === "character" && moment.authorId) {
      window.AppStorage.addCharacterMemory(moment.authorId, {
        content: "我发了一条朋友圈：" + moment.content,
        source: "moments",
        createdAt: moment.createdAt || Date.now()
      });
    }

    (moment.comments || []).forEach(function (comment) {
      if (comment.authorType === "character" && comment.authorId) {
        window.AppStorage.addCharacterMemory(comment.authorId, {
          content: "我评论了" + (moment.authorName || "别人") + "的朋友圈：" + comment.content,
          source: "moments",
          createdAt: comment.createdAt || Date.now()
        });
      }
    });

    (memories || []).forEach(function (memory) {
      if (memory.characterId && memory.content) {
        window.AppStorage.addCharacterMemory(memory.characterId, {
          content: memory.content,
          source: "moments",
          createdAt: Date.now()
        });
      }
    });
  }

  function collectMomentRecentText(characterId) {
    var privateText = window.AppStorage.getChatHistory(characterId).slice(-8).map(formatMessageForDiary).join("\n");
    var memoryText = window.AppStorage.getCharacterMemory(characterId).slice(-8).map(function (memory) {
      return memory.content;
    }).join("\n");
    var thoughtText = window.AppStorage.getRecentThoughts(characterId, 3).map(function (thought) {
      return thought.visibleSummary || thought.content;
    }).join("\n");

    return [privateText, memoryText, thoughtText].filter(Boolean).join("\n");
  }

  function isApiConfigured() {
    var settings = window.AppStorage.getSettings ? window.AppStorage.getSettings() : {};
    return Boolean(settings.apiUrl && settings.apiKey && settings.modelName);
  }

  function maybeGenerateCharacterMomentOnOpen() {
    var characters;
    var candidate;

    if (!isApiConfigured() || maybeGenerateCharacterMomentOnOpen.running) {
      return;
    }

    characters = window.AppStorage.getCharacters().filter(shouldAutoGenerateMoment);
    if (!characters.length) {
      return;
    }

    candidate = characters[Math.floor(Math.random() * characters.length)];
    maybeGenerateCharacterMomentOnOpen.running = true;
    generateCharacterMoment(candidate.id).then(function () {
      if (getActivePage() === "wechatScreen") {
        renderWechatScreen();
      }
    }).catch(function () {
      // Silent: opening朋友圈 should never be blocked by an optional AI update.
    }).finally(function () {
      maybeGenerateCharacterMomentOnOpen.running = false;
    });
  }

  function shouldAutoGenerateMoment(character) {
    var settings = getCharacterMomentSettings(character);
    var intervalMap = {
      low: 36 * 60 * 60 * 1000,
      normal: 18 * 60 * 60 * 1000,
      high: 8 * 60 * 60 * 1000
    };
    var chanceMap = {
      low: 0.08,
      normal: 0.16,
      high: 0.28
    };

    if (!settings.autoPostEnabled) {
      return false;
    }

    if (Date.now() - settings.lastGeneratedAt < intervalMap[settings.frequency]) {
      return false;
    }

    return Math.random() < chanceMap[settings.frequency];
  }

  function renderWechatDiscoverTab(content) {
    content.innerHTML = [
      '<section class="discover-grid">',
      renderDiscoverCard("photo", "相册", "照片和图片消息", "相"),
      renderDiscoverCard("diary", "日记", "角色日记与我的日记", "日"),
      renderDiscoverCard("worldbook", "世界书", "共享设定与关键词", "世"),
      renderDiscoverCard("theme", "主题", "桌面和聊天外观", "题"),
      renderDiscoverCard("backup", "备份", "导入导出全部数据", "备"),
      renderDiscoverCard("contacts", "联系人", "角色列表", "录"),
      "</section>"
    ].join("");
    bindWechatEntryActions(content);
    Array.prototype.forEach.call(content.querySelectorAll("[data-character-space-id]"), function (button) {
      button.addEventListener("click", function () {
        openCharacterSpaceScreen(button.dataset.characterSpaceId);
      });
    });
  }

  function renderDiscoverCard(action, title, subtitle, icon) {
    return [
      '<button class="discover-card" type="button" data-wechat-entry="' + escapeHtml(action) + '">',
      '  <span class="discover-icon">' + escapeHtml(icon) + "</span>",
      "  <strong>" + escapeHtml(title) + "</strong>",
      "  <em>" + escapeHtml(subtitle) + "</em>",
      "</button>"
    ].join("");
  }

  function renderWechatMeTab(content) {
    var profile = window.AppStorage.getUserProfile();
    var wallet = window.AppStorage.getWallet ? window.AppStorage.getWallet() : { balance: 0, ledger: [], familyCards: [] };
    var personas = window.AppStorage.getUserPersonas ? window.AppStorage.getUserPersonas() : [];
    var activePersona = window.AppStorage.resolveUserPersona && profile.activePersonaId ? window.AppStorage.resolveUserPersona(profile.activePersonaId) : null;
    var listItems = [
      ["我的人设", "persona", "管理 " + personas.length + " 个我的预设", activePersona],
      ["联系人分组", "layers", "管理角色关系"],
      ["表情包图库", "emoji", "导入与发送表情"]
    ];

    content.innerHTML = [
      '<section class="me-page">',
      '  <div class="me-section-label">账户</div>',
      '  <button class="me-profile-card me-profile-compact" type="button" data-me-action="profile">',
      '    <span class="me-profile-main"><strong>' + escapeHtml(profile.name || "林澈") + "</strong><em>微信号：" + escapeHtml(profile.wxid) + " · 简洁资料</em></span>",
      '    <span class="me-arrow">›</span>',
      "  </button>",
      '  <button class="me-wallet-entry" type="button" data-me-action="wallet"><span>▣</span><strong>钱包</strong><em>余额 ¥' + formatMoney(wallet.balance) + "</em><i>›</i></button>",
      '  <div class="me-section-label">互动</div>',
      '  <label class="me-switch-card"><span>朋友圈智能互评</span><input id="momentsAutoReviewToggle" type="checkbox"' + (profile.momentsAutoReview ? " checked" : "") + "><i></i></label>",
      '  <div class="me-section-label">工具</div>',
      '  <section class="me-list-card">',
      listItems.map(function (item) {
        return renderMeListItem(item);
      }).join(""),
      "  </section>",
      "</section>"
    ].join("");
    bindMeActions(content);
  }

  function renderMeListItem(item) {
    var persona = item[3] || null;
    var icon = persona && persona.avatar
      ? '<img src="' + escapeHtml(persona.avatar) + '" alt="">'
      : escapeHtml(item[0].slice(0, 1));

    return '<button type="button" data-me-action="' + item[1] + '"><span>' + icon + '</span><strong>' + escapeHtml(item[0]) + '</strong><em>' + escapeHtml(item[2]) + '</em><i>›</i></button>';
  }

  function renderProfileAvatar(profile) {
    if (profile.avatar) {
      return '<img class="me-avatar" src="' + escapeHtml(profile.avatar) + '" alt="">';
    }

    return '<span class="me-avatar" aria-hidden="true">' + escapeHtml((profile.name || "我").slice(0, 1)) + "</span>";
  }

  function addUserPersonaPart(parts, seen, label, value) {
    var text = String(value || "").trim();
    var key;

    if (!text) {
      return;
    }

    key = text.toLowerCase();
    if (seen[key]) {
      return;
    }

    seen[key] = true;
    parts.push(label ? label + "：" + text : text);
  }

  function buildUserPersonaText(persona) {
    var source = persona || {};
    var parts = [];
    var seen = {};

    addUserPersonaPart(parts, seen, "", source.personality || source.persona);
    addUserPersonaPart(parts, seen, "身份/关系", source.identity || source.relationship);
    addUserPersonaPart(parts, seen, "说话方式", source.speakingStyle);
    addUserPersonaPart(parts, seen, "补充", source.extra || source.background);
    addUserPersonaPart(parts, seen, "性别", source.gender);
    addUserPersonaPart(parts, seen, "年龄", source.age);

    return parts.join("\n\n");
  }

  function buildCharacterPersonaText(character) {
    var source = character || {};
    var parts = [];
    var seen = {};

    addUserPersonaPart(parts, seen, "", source.personality);
    addUserPersonaPart(parts, seen, "身份", source.identity);
    addUserPersonaPart(parts, seen, "关系", source.relationship);
    addUserPersonaPart(parts, seen, "说话方式", source.speakingStyle);
    addUserPersonaPart(parts, seen, "背景", source.background);
    addUserPersonaPart(parts, seen, "性别", source.gender);

    return parts.join("\n\n");
  }

  function renderAvatarCircleButton(source, buttonId, imageId, textId) {
    var avatar = source && source.avatar || "";
    var name = source && source.name || "我";

    return [
      '<div class="avatar-field persona-avatar-field">',
      '  <button id="' + buttonId + '" class="avatar-picker round-avatar-picker persona-avatar-picker" type="button" aria-label="选择头像">',
      '    <span class="avatar-preview" aria-hidden="true">',
      avatar ? '      <img id="' + imageId + '" class="avatar-preview-img" src="' + escapeHtml(avatar) + '" alt="">' : '      <img id="' + imageId + '" class="avatar-preview-img hidden" src="" alt="">',
      '      <span id="' + textId + '"' + (avatar ? ' class="hidden"' : "") + ">" + escapeHtml(name ? name.slice(0, 1) : "+") + "</span>",
      "    </span>",
      "  </button>",
      "</div>"
    ].join("");
  }

  function getDefaultUserPersonaForDisplay() {
    var profile = window.AppStorage.getUserProfile();

    if (window.AppStorage.resolveUserPersona && profile.activePersonaId) {
      return window.AppStorage.resolveUserPersona(profile.activePersonaId);
    }

    return profile;
  }

  function bindMeActions(content) {
    Array.prototype.forEach.call(content.querySelectorAll("[data-me-action]"), function (button) {
      button.addEventListener("click", function () {
        handleMeAction(button.dataset.meAction);
      });
    });

    var toggle = content.querySelector("#momentsAutoReviewToggle");
    if (toggle) {
      toggle.addEventListener("change", function () {
        var profile = window.AppStorage.getUserProfile();
        profile.momentsAutoReview = toggle.checked;
        window.AppStorage.saveUserProfile(profile);
      });
    }
  }

  function handleMeAction(action) {
    if (action === "wallet") {
      rememberWechatMeReturn();
      setActivePage("walletScreen");
      return;
    }

    if (action === "profile") {
      openUserProfileSheet();
      return;
    }

    if (action === "avatar") {
      openUserAvatarSheet();
      return;
    }

    if (action === "layers") {
      openContactGroupManagerSheet();
      return;
    }

    if (action === "emoji") {
      window.alert("表情包图库可在聊天输入栏的表情面板中导入使用。");
      return;
    }

    if (action === "persona") {
      openUserPersonaManagerSheet();
      return;
    }

    window.alert("这个入口已保留，后续可以继续扩展。");
  }

  function rememberWechatMeReturn() {
    wechatChildReturnTab = "me";
  }

  function returnFromWechatChild(fallback) {
    if (wechatChildReturnTab === "me") {
      wechatChildReturnTab = "";
      setWechatTab("me");
      setActivePage("wechatScreen");
      return;
    }

    if (fallback === "wechat") {
      setWechatTab("wechat");
      setActivePage("wechatScreen");
      return;
    }

    if (fallback === "me") {
      setWechatTab("me");
      setActivePage("wechatScreen");
      return;
    }

    goHome();
  }

  function openUserProfileSheet() {
    var profile = window.AppStorage.getUserProfile();

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>我的资料</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<form id="userProfileForm" class="wechat-sheet-form" autocomplete="off">',
      '  <label class="wechat-sheet-field"><span>昵称</span><input id="profileNameInput" type="text" maxlength="30" value="' + escapeHtml(profile.name || "") + '"></label>',
      '  <label class="wechat-sheet-field"><span>微信号 / ID</span><input id="profileWxidInput" type="text" maxlength="40" value="' + escapeHtml(profile.wxid || "") + '"></label>',
      '  <label class="wechat-sheet-field"><span>补充资料</span><textarea id="profilePersonaInput" maxlength="400">' + escapeHtml(profile.persona || "") + "</textarea></label>",
      '  <p id="userProfileError" class="sheet-error" role="alert"></p>',
      '  <div class="wechat-sheet-actions"><button type="button" class="outline-button" data-close-sheet>取消</button><button type="submit" class="full-button">保存资料</button></div>',
      "</form>"
    ].join(""), function (sheet) {
      bindSheetCloseButtons(sheet);
      sheet.querySelector("#userProfileForm").addEventListener("submit", function (event) {
        var name = sheet.querySelector("#profileNameInput").value.trim();
        var wxid = sheet.querySelector("#profileWxidInput").value.trim();
        event.preventDefault();

        if (!name) {
          sheet.querySelector("#userProfileError").textContent = "昵称不能为空。";
          return;
        }

        profile.name = name;
        profile.wxid = wxid || profile.wxid;
        profile.persona = sheet.querySelector("#profilePersonaInput").value.trim();
        window.AppStorage.saveUserProfile(profile);
        closeWeChatSheet();
        renderWechatScreen();
      });
    });
  }

  function openUserAvatarSheet() {
    var profile = window.AppStorage.getUserProfile();

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>默认头像</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<div class="wechat-sheet-form avatar-sheet-form">',
      renderAvatarCircleButton(profile, "profileAvatarPicker", "profileAvatarPreviewImg", "profileAvatarPreviewText"),
      '  <input id="profileAvatarValue" type="hidden" value="' + escapeHtml(profile.avatar || "") + '">',
      '  <input id="profileAvatarFile" class="visually-hidden" type="file" accept="image/*">',
      '  <div class="wechat-sheet-actions"><button type="button" class="outline-button" data-close-sheet>取消</button><button id="saveProfileAvatarBtn" type="button" class="full-button">保存头像</button></div>',
      "</div>"
    ].join(""), function (sheet) {
      bindSheetCloseButtons(sheet);
      sheet.querySelector("#profileAvatarPicker").addEventListener("click", function () {
        sheet.querySelector("#profileAvatarFile").click();
      });
      sheet.querySelector("#profileAvatarFile").addEventListener("change", function (event) {
        var file = event.target.files && event.target.files[0];
        var image = sheet.querySelector("#profileAvatarPreviewImg");
        var text = sheet.querySelector("#profileAvatarPreviewText");
        if (!file) {
          return;
        }
        readFileAsDataUrl(file).then(function (dataUrl) {
          sheet.querySelector("#profileAvatarValue").value = dataUrl;
          if (image && text) {
            image.src = dataUrl;
            image.classList.remove("hidden");
            text.classList.add("hidden");
          }
          event.target.value = "";
        });
      });
      sheet.querySelector("#saveProfileAvatarBtn").addEventListener("click", function () {
        profile.avatar = sheet.querySelector("#profileAvatarValue").value.trim();
        window.AppStorage.saveUserProfile(profile);
        closeWeChatSheet();
        renderWechatScreen();
      });
    });
  }

  function openUserPersonaManagerSheet(editPersonaId) {
    var personas = window.AppStorage.getUserPersonas ? window.AppStorage.getUserPersonas() : [];
    var profile = window.AppStorage.getUserProfile();
    var editing = editPersonaId ? personas.find(function (persona) { return persona.id === editPersonaId; }) : null;

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>我的人设</h3>",
      '  <button type="button" data-close-sheet>关闭</button>',
      "</div>",
      '<div class="persona-manager">',
      '  <section class="persona-list-section">',
      personas.length ? personas.map(function (persona) {
        var isActive = profile.activePersonaId === persona.id;
        return [
          '<article class="persona-item' + (isActive ? " active" : "") + '">',
          renderProfileAvatar(persona),
          '  <div class="persona-item-main">',
          '    <div class="persona-item-title"><strong>' + escapeHtml(persona.name) + "</strong>" + (isActive ? "<b>默认</b>" : "") + "</div>",
          '    <em>' + escapeHtml(buildUserPersonaText(persona) || "未写人设") + "</em>",
          '    <div class="persona-item-actions"><button type="button" data-persona-default="' + escapeHtml(persona.id) + '">设为默认</button><button type="button" data-persona-edit="' + escapeHtml(persona.id) + '">编辑</button><button class="danger" type="button" data-persona-delete="' + escapeHtml(persona.id) + '">删除</button></div>',
          "  </div>",
          "</article>"
        ].join("");
      }).join("") : '<div class="soft-empty">还没有我的预设，先创建一个。</div>',
      "  </section>",
      '<form id="personaEditorForm" class="wechat-sheet-form persona-editor-form" autocomplete="off">',
      '  <div class="section-title-row"><h3>' + (editing ? "编辑预设" : "新建预设") + '</h3><span>聊天里的我</span></div>',
      '  <input id="personaIdInput" type="hidden" value="' + escapeHtml(editing && editing.id || "") + '">',
      renderAvatarCircleButton(editing || {}, "personaAvatarPicker", "personaAvatarPreviewImg", "personaAvatarPreviewText"),
      '  <input id="personaAvatarInput" type="hidden" value="' + escapeHtml(editing && editing.avatar || "") + '">',
      '  <input id="personaAvatarFile" class="visually-hidden" type="file" accept="image/*">',
      '  <label class="wechat-sheet-field"><span>名称</span><input id="personaNameInput" type="text" maxlength="30" value="' + escapeHtml(editing && editing.name || "") + '"></label>',
      '  <label class="wechat-sheet-field"><span>人设</span><textarea id="personaPersonalityInput" class="persona-textarea" maxlength="1600">' + escapeHtml(buildUserPersonaText(editing)) + '</textarea></label>',
      '  <p id="personaEditorError" class="sheet-error" role="alert"></p>',
      '  <div class="wechat-sheet-actions"><button type="button" class="outline-button" data-close-sheet>取消</button><button type="submit" class="full-button">' + (editing ? "保存预设" : "创建预设") + "</button></div>",
      "</form>",
      "</div>"
    ].join(""), function (sheet) {
      bindSheetCloseButtons(sheet);
      bindPersonaManagerActions(sheet);
    });
  }

  function bindPersonaManagerActions(sheet) {
    var form = sheet.querySelector("#personaEditorForm");
    var fileInput = sheet.querySelector("#personaAvatarFile");
    var avatarPicker = sheet.querySelector("#personaAvatarPicker");
    var avatarInput = sheet.querySelector("#personaAvatarInput");

    function updatePersonaAvatarPreview(value) {
      var image = sheet.querySelector("#personaAvatarPreviewImg");
      var text = sheet.querySelector("#personaAvatarPreviewText");
      var nameInput = sheet.querySelector("#personaNameInput");
      var name = nameInput && nameInput.value.trim() || "我";

      if (!image || !text) {
        return;
      }

      if (value) {
        image.src = value;
        image.classList.remove("hidden");
        text.classList.add("hidden");
        return;
      }

      image.removeAttribute("src");
      image.classList.add("hidden");
      text.textContent = name ? name.slice(0, 1) : "+";
      text.classList.remove("hidden");
    }

    Array.prototype.forEach.call(sheet.querySelectorAll("[data-persona-edit]"), function (button) {
      button.addEventListener("click", function () {
        openUserPersonaManagerSheet(button.dataset.personaEdit);
      });
    });

    Array.prototype.forEach.call(sheet.querySelectorAll("[data-persona-delete]"), function (button) {
      button.addEventListener("click", function () {
        if (window.confirm("确定删除这个我的预设吗？")) {
          window.AppStorage.deleteUserPersona(button.dataset.personaDelete);
          openUserPersonaManagerSheet();
        }
      });
    });

    Array.prototype.forEach.call(sheet.querySelectorAll("[data-persona-default]"), function (button) {
      button.addEventListener("click", function () {
        var profile = window.AppStorage.getUserProfile();
        profile.activePersonaId = button.dataset.personaDefault;
        window.AppStorage.saveUserProfile(profile);
        openUserPersonaManagerSheet();
      });
    });

    if (avatarPicker && fileInput) {
      avatarPicker.addEventListener("click", function () {
        fileInput.click();
      });
    }

    if (fileInput && avatarInput) {
      fileInput.addEventListener("change", function (event) {
        var file = event.target.files && event.target.files[0];
        if (!file) {
          return;
        }
        readFileAsDataUrl(file).then(function (dataUrl) {
          avatarInput.value = dataUrl;
          updatePersonaAvatarPreview(dataUrl);
          fileInput.value = "";
        });
      });
    }

    if (form) {
      form.addEventListener("submit", function (event) {
        var id = sheet.querySelector("#personaIdInput").value.trim();
        var name = sheet.querySelector("#personaNameInput").value.trim();
        var payload;
        event.preventDefault();

        if (!name) {
          sheet.querySelector("#personaEditorError").textContent = "预设名称不能为空。";
          return;
        }

        payload = {
          name: name,
          avatar: sheet.querySelector("#personaAvatarInput").value.trim(),
          personality: sheet.querySelector("#personaPersonalityInput").value.trim(),
          gender: "",
          age: "",
          identity: "",
          speakingStyle: "",
          extra: ""
        };

        if (id) {
          window.AppStorage.updateUserPersona(id, payload);
        } else {
          window.AppStorage.addUserPersona(payload);
        }

        openUserPersonaManagerSheet();
      });
    }
  }

  function openContactGroupManagerSheet(editGroupId) {
    var groups = window.AppStorage.getContactGroups ? window.AppStorage.getContactGroups() : [];
    var characters = window.AppStorage.getCharacters ? window.AppStorage.getCharacters() : [];
    var editing = editGroupId ? groups.find(function (group) {
      return group.id === editGroupId;
    }) : null;
    var memberIds = editing && editing.memberIds || [];

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      '  <button type="button" data-contact-group-create>新建</button>',
      "  <h3>联系人分组</h3>",
      '  <button type="button" data-close-sheet>关闭</button>',
      "</div>",
      '<div class="contact-group-manager">',
      '  <section class="contact-group-list">',
      groups.length ? groups.map(function (group) {
        return renderContactGroupCard(group, characters, editing && editing.id === group.id);
      }).join("") : '<div class="soft-empty">还没有分组，先新建一个。</div>',
      "  </section>",
      '  <form id="contactGroupForm" class="wechat-sheet-form contact-group-editor" autocomplete="off">',
      '    <div class="section-title-row"><h3>' + (editing ? "编辑分组" : "新建分组") + '</h3><span>' + characters.length + " 个角色</span></div>",
      '    <input id="contactGroupIdInput" type="hidden" value="' + escapeHtml(editing && editing.id || "") + '">',
      '    <label class="wechat-sheet-field"><span>分组名称</span><input id="contactGroupNameInput" type="text" maxlength="30" value="' + escapeHtml(editing && editing.name || "") + '" placeholder="例如：同学、家人、同事"></label>',
      '    <div class="member-select-list contact-member-select">',
      characters.length ? characters.map(function (character) {
        return renderContactGroupMemberOption(character, memberIds);
      }).join("") : '<div class="soft-empty">还没有角色。</div>',
      "    </div>",
      '    <p id="contactGroupError" class="sheet-error" role="alert"></p>',
      '    <div class="wechat-sheet-actions"><button type="button" class="outline-button" data-close-sheet>取消</button><button type="submit" class="full-button">' + (editing ? "保存分组" : "创建分组") + "</button></div>",
      "  </form>",
      "</div>"
    ].join(""), function (sheet) {
      bindSheetCloseButtons(sheet);
      bindContactGroupManagerActions(sheet);
    });
  }

  function renderContactGroupCard(group, characters, active) {
    var memberNames = (group.memberIds || []).map(function (memberId) {
      var character = characters.find(function (item) {
        return item.id === memberId;
      });
      return character && character.name || "";
    }).filter(Boolean);

    return [
      '<article class="contact-group-card' + (active ? " active" : "") + '">',
      '  <div class="contact-group-card-main">',
      '    <strong>' + escapeHtml(group.name || "未命名分组") + "</strong>",
      '    <em>' + escapeHtml(memberNames.length ? memberNames.join("、") : "暂无成员") + "</em>",
      "  </div>",
      '  <div class="contact-group-card-actions">',
      '    <button type="button" data-contact-group-edit="' + escapeHtml(group.id) + '">编辑</button>',
      '    <button class="danger" type="button" data-contact-group-delete="' + escapeHtml(group.id) + '">删除</button>',
      "  </div>",
      "</article>"
    ].join("");
  }

  function renderContactGroupMemberOption(character, memberIds) {
    var checked = memberIds.indexOf(character.id) !== -1;

    return [
      '<label class="member-option ' + (checked ? "active" : "") + '">',
      '  <input class="visually-hidden" type="checkbox" data-contact-member-id="' + escapeHtml(character.id) + '"' + (checked ? " checked" : "") + ">",
      renderSmallAvatar(character, "member-option-avatar"),
      '  <span class="member-option-text"><strong>' + escapeHtml(character.name || "未命名角色") + '</strong><em>' + escapeHtml(buildCharacterPersonaText(character) || "未写人设") + "</em></span>",
      '  <span class="member-check">✓</span>',
      "</label>"
    ].join("");
  }

  function bindContactGroupManagerActions(sheet) {
    var form = sheet.querySelector("#contactGroupForm");

    Array.prototype.forEach.call(sheet.querySelectorAll("[data-contact-group-edit]"), function (button) {
      button.addEventListener("click", function () {
        openContactGroupManagerSheet(button.dataset.contactGroupEdit);
      });
    });

    Array.prototype.forEach.call(sheet.querySelectorAll("[data-contact-group-delete]"), function (button) {
      button.addEventListener("click", function () {
        if (window.confirm("删除这个联系人分组吗？")) {
          window.AppStorage.deleteContactGroup(button.dataset.contactGroupDelete);
          openContactGroupManagerSheet();
        }
      });
    });

    Array.prototype.forEach.call(sheet.querySelectorAll("[data-contact-group-create]"), function (button) {
      button.addEventListener("click", function () {
        openContactGroupManagerSheet();
      });
    });

    Array.prototype.forEach.call(sheet.querySelectorAll("[data-contact-member-id]"), function (input) {
      input.addEventListener("change", function () {
        var option = input.closest(".member-option");
        if (option) {
          option.classList.toggle("active", input.checked);
        }
      });
    });

    if (!form) {
      return;
    }

    form.addEventListener("submit", function (event) {
      var id = sheet.querySelector("#contactGroupIdInput").value.trim();
      var name = sheet.querySelector("#contactGroupNameInput").value.trim();
      var memberIds = Array.prototype.map.call(sheet.querySelectorAll("[data-contact-member-id]:checked"), function (input) {
        return input.dataset.contactMemberId;
      });
      var payload;

      event.preventDefault();

      if (!name) {
        sheet.querySelector("#contactGroupError").textContent = "分组名称不能为空。";
        return;
      }

      payload = {
        name: name,
        memberIds: memberIds
      };

      if (id) {
        window.AppStorage.updateContactGroup(id, payload);
      } else {
        window.AppStorage.addContactGroup(payload);
      }

      showToast("分组已保存");
      openContactGroupManagerSheet(id || "");
    });
  }

  function renderWechatSpiritTab(content) {
    var characters = window.AppStorage.getCharacters();
    var groups = window.AppStorage.getGroups ? window.AppStorage.getGroups() : [];

    content.innerHTML = [
      '<section class="spirit-summary">',
      '  <strong>' + characters.length + "</strong><span>个角色</span>",
      '  <strong>' + groups.length + "</strong><span>个群聊</span>",
      "</section>",
      '<section class="wechat-list-panel">',
      '  <div class="section-title-row"><h3>角色空间</h3><span>角色管理</span></div>',
      '  <div class="spirit-actions">',
      '    <button type="button" data-wechat-entry="space">角色空间</button>',
      '    <button type="button" data-wechat-entry="contacts">联系人</button>',
      '    <button type="button" data-wechat-entry="new-character">创建角色</button>',
      '    <button type="button" data-wechat-entry="new-group">创建群聊</button>',
      "  </div>",
      characters.length ? characters.slice(0, 6).map(renderSpiritCharacter).join("") : '<div class="soft-empty">还没有角色，先创建一个角色吧。</div>',
      "</section>"
    ].join("");
    bindWechatEntryActions(content);
  }

  function renderSpiritCharacter(character) {
    return [
      '<button class="spirit-character-row" type="button" data-character-space-id="' + escapeHtml(character.id) + '">',
      renderSmallAvatar(character, "spirit-avatar"),
      '  <span><strong>' + escapeHtml(character.name || "未命名角色") + "</strong><em>" + escapeHtml(buildCharacterPersonaText(character) || "未写人设") + "</em></span>",
      "</button>"
    ].join("");
  }

  function getRecentChats() {
    var characters = window.AppStorage.getCharacters();
    var groups = window.AppStorage.getGroups ? window.AppStorage.getGroups() : [];
    var privateItems = characters.map(function (character) {
      var history = window.AppStorage.getChatHistory(character.id);
      var last = getLastRecentMessage(history);
      var chatSettings = character.chatSettings || {};

      return {
        type: "private",
        id: character.id,
        title: chatSettings.remarkName || character.name,
        originalTitle: character.name,
        avatar: character.avatar,
        fallback: character.name ? character.name.slice(0, 1) : "心",
        preview: last ? formatRecentPreview(last) : "开始和 TA 聊天",
        time: last ? last.createdAt : 0,
        createdAt: Number(character.createdAt) || 0,
        hasHistory: Boolean(last),
        unread: window.AppStorage.getUnreadThoughtCount ? window.AppStorage.getUnreadThoughtCount([character.id], character.id) : 0,
        pinned: Boolean(chatSettings.pinned)
      };
    });
    var groupItems = groups.map(function (group) {
      var history = window.AppStorage.getGroupChatHistory(group.id);
      var last = getLastRecentMessage(history);
      var groupSettings = group.settings || {};

      return {
        type: "group",
        id: group.id,
        title: group.name,
        memberIds: group.memberIds || [],
        avatar: group.settings && group.settings.avatar || "",
        fallback: group.name ? group.name.slice(0, 1) : "群",
        preview: last ? formatRecentPreview(last) : "进入群聊",
        time: last ? last.createdAt : 0,
        createdAt: Number(group.createdAt) || 0,
        hasHistory: Boolean(last),
        unread: window.AppStorage.getUnreadThoughtCount ? window.AppStorage.getUnreadThoughtCount(group.memberIds || [], group.id) : 0,
        pinned: Boolean(groupSettings.pinned)
      };
    });

    return privateItems.concat(groupItems).filter(function (item) {
      var hiddenAt = window.AppStorage.getRecentHiddenAt ? window.AppStorage.getRecentHiddenAt(item.type, item.id) : 0;
      return !hiddenAt || (item.time && item.time > hiddenAt);
    }).sort(function (a, b) {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      if (a.hasHistory !== b.hasHistory) {
        return a.hasHistory ? -1 : 1;
      }
      if (a.hasHistory && b.hasHistory) {
        return b.time - a.time;
      }
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function handleRecentAction(action, type, id, time) {
    if (action === "hide") {
      if (window.AppStorage.hideRecentChat) {
        window.AppStorage.hideRecentChat(type, id, time);
      }
      renderWechatScreen();
      return;
    }

    if (action === "pin") {
      setRecentPinned(type, id, true);
      return;
    }

    if (action === "unpin") {
      setRecentPinned(type, id, false);
    }
  }

  function setRecentPinned(type, id, pinned) {
    var character;
    var group;

    if (type === "private") {
      character = getCharacterById(id);
      if (character) {
        window.AppStorage.updateCharacter(id, {
          chatSettings: Object.assign({}, character.chatSettings || {}, { pinned: Boolean(pinned) })
        });
      }
    } else {
      group = (window.AppStorage.getGroups ? window.AppStorage.getGroups() : []).find(function (item) {
        return item.id === id;
      });
      if (group) {
        window.AppStorage.updateGroup(id, {
          settings: Object.assign({}, group.settings || {}, { pinned: Boolean(pinned) })
        });
      }
    }

    renderWechatScreen();
  }

  function getLastRecentMessage(history) {
    var messages = Array.isArray(history) ? history : [];
    var index;

    for (index = messages.length - 1; index >= 0; index -= 1) {
      if (!isIgnoredRecentMessage(messages[index])) {
        return messages[index];
      }
    }

    return null;
  }

  function isIgnoredRecentMessage(message) {
    if (!message) {
      return true;
    }

    return message.role === "system" || message.type === "loading" || message.type === "pat";
  }

  function formatRecentPreview(message) {
    var content = formatTypedPreview(message);

    if (message.role === "user") {
      return "我：" + content;
    }

    if (message.characterName) {
      return message.characterName + "：" + content;
    }

    return content;
  }

  function formatTypedPreview(message) {
    if (message.type === "image") {
      return "[图片]";
    }
    if (message.type === "voice") {
      return "[语音]";
    }
    if (message.type === "redPacket") {
      return "[红包] " + (message.content || "恭喜发财，大吉大利");
    }
    if (message.type === "transfer") {
      var transferAmount = normalizeMoneyAmount(message.amount);
      return "[转账] " + (transferAmount ? "¥" + transferAmount : "");
    }
    if (message.type === "location") {
      return "[位置] " + (message.location && message.location.name ? message.location.name : message.content || "");
    }
    if (message.type === "offlineUserAction") {
      return message.content || "";
    }
    if (message.type === "offlineAction") {
      return "[线下旁白] " + (message.content || "");
    }
    if (message.type === "offlineSpeech") {
      return "[线下发言] " + (message.content || "");
    }
    if (message.type === "emoji") {
      return message.emoji && message.emoji.type === "text" ? message.emoji.value : "[表情]";
    }
    return message.content || "暂无内容";
  }

  function formatRecentTime(timestamp) {
    var date;
    var now;

    if (!timestamp) {
      return "";
    }

    date = new Date(timestamp);
    now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
    }

    return String(date.getMonth() + 1).padStart(2, "0") + "/" + String(date.getDate()).padStart(2, "0");
  }

  function formatMoney(value) {
    var amount = Number(value);
    if (!Number.isFinite(amount)) {
      amount = 0;
    }
    return amount.toFixed(2);
  }

  function normalizeMoneyAmount(value) {
    if (window.AppStorage && window.AppStorage.normalizeMoneyAmount) {
      return window.AppStorage.normalizeMoneyAmount(value);
    }

    var text = String(value === undefined || value === null ? "" : value).trim();
    var amount;

    if (!text) {
      return "";
    }

    amount = Number(text);
    if (!Number.isFinite(amount) || amount < 0.01) {
      return "";
    }

    return amount.toFixed(2);
  }

  function renderRecentChatItem(item) {
    return [
      '<article class="recent-chat-item' + (item.pinned ? " pinned" : "") + '">',
      '  <button class="recent-open" type="button" data-recent-open data-recent-type="' + escapeHtml(item.type) + '" data-recent-id="' + escapeHtml(item.id) + '">',
      item.type === "group" ? renderRecentGroupAvatar(item.memberIds) : renderRecentSingleAvatar(item),
      '    <span class="recent-chat-main">',
      '      <strong>' + (item.pinned ? '<i>置顶</i>' : "") + escapeHtml(item.title) + (item.type === "group" ? '<b aria-label="群聊">♟</b>' : "") + '<time>' + escapeHtml(formatRecentTime(item.time)) + "</time></strong>",
      item.originalTitle && item.originalTitle !== item.title ? '      <small>原名：' + escapeHtml(item.originalTitle) + "</small>" : "",
      "      <em>" + escapeHtml(item.preview) + "</em>",
      "    </span>",
      item.unread ? '    <span class="recent-unread-badge">' + escapeHtml(item.unread > 99 ? "99+" : item.unread) + "</span>" : "",
      "  </button>",
      '  <div class="recent-actions">',
      '    <button type="button" data-recent-action="' + (item.pinned ? "unpin" : "pin") + '" data-recent-type="' + escapeHtml(item.type) + '" data-recent-id="' + escapeHtml(item.id) + '" data-recent-time="' + escapeHtml(item.time) + '">' + (item.pinned ? "取消置顶" : "置顶") + "</button>",
      '    <button type="button" data-recent-action="hide" data-recent-type="' + escapeHtml(item.type) + '" data-recent-id="' + escapeHtml(item.id) + '" data-recent-time="' + escapeHtml(item.time) + '">移除</button>',
      "  </div>",
      "</article>"
    ].join("");
  }

  function renderRecentSingleAvatar(item) {
    if (item.avatar) {
      return '<img class="recent-chat-avatar" src="' + escapeHtml(item.avatar) + '" alt="">';
    }

    return '<span class="recent-chat-avatar" aria-hidden="true">' + escapeHtml(item.fallback || "心") + "</span>";
  }

  function renderRecentGroupAvatar(memberIds) {
    var characters = (memberIds || []).map(function (memberId) {
      return window.AppStorage.getCharacters().find(function (character) {
        return character.id === memberId;
      });
    }).filter(Boolean);

    return [
      '<span class="recent-group-avatar" aria-hidden="true">',
      characters.slice(0, 3).map(function (character) {
        if (character.avatar) {
          return '<img src="' + escapeHtml(character.avatar) + '" alt="">';
        }

        return '<i>' + escapeHtml(character.name ? character.name.slice(0, 1) : "心") + "</i>";
      }).join(""),
      "</span>"
    ].join("");
  }

  function bindHomeActions() {
    bindDesktopSwipe();

    Array.prototype.forEach.call(document.querySelectorAll(".desktop-coming"), function (button) {
      button.addEventListener("click", function () {
        window.alert("功能开发中");
      });
    });

    addClick("dockHome", function () {
      setWechatTab("wechat");
      setActivePage("wechatScreen");
    });
    addClick("dockChat", function () {
      setActivePage("characterListScreen");
    });
    addClick("dockTheme", function () {
      setActivePage("photoScreen");
    });
    addClick("dockSettings", function () {
      setActivePage("settingsScreen");
    });
  }

  function bindNavigationActions() {
    getElement("characterListBack").addEventListener("click", function () {
      returnFromWechatChild("wechat");
    });
    getElement("newCharacterBtn").addEventListener("click", window.CharacterManager.openCreateCharacterScreen);
    getElement("characterBatchSelectBtn").addEventListener("click", window.CharacterManager.toggleCharacterSelectionMode);
    getElement("createBackBtn").addEventListener("click", window.CharacterManager.closeCreateCharacterScreen);
    getElement("chatBackBtn").addEventListener("click", function () {
      setWechatTab("wechat");
      setActivePage("wechatScreen");
    });
    getElement("groupListBack").addEventListener("click", function () {
      setActivePage("wechatScreen");
    });
    getElement("newGroupBtn").addEventListener("click", window.GroupManager.openCreateGroupScreen);
    getElement("groupBatchSelectBtn").addEventListener("click", window.GroupManager.toggleGroupSelectionMode);
    getElement("createGroupBackBtn").addEventListener("click", function () {
      setWechatTab("wechat");
      setActivePage("wechatScreen");
    });
    getElement("groupChatBackBtn").addEventListener("click", function () {
      setWechatTab("wechat");
      setActivePage("wechatScreen");
    });
    getElement("offlineBackBtn").addEventListener("click", window.OfflineManager.goBack);
    getElement("wechatBackBtn").addEventListener("click", goHome);
    getElement("wechatAddBtn").addEventListener("click", function (event) {
      event.stopPropagation();
      toggleWechatAddMenu();
    });
    getElement("walletBackBtn").addEventListener("click", function () {
      returnFromWechatChild("me");
    });
    getElement("walletBillBackBtn").addEventListener("click", function () {
      setActivePage("walletScreen");
    });
    getElement("familyCardBackBtn").addEventListener("click", function () {
      setActivePage("walletScreen");
    });
    getElement("shopBackBtn").addEventListener("click", goHome);
    getElement("newFamilyCardBtn").addEventListener("click", openFamilyCardEditor);
    getElement("settingsBackBtn").addEventListener("click", function () {
      returnFromWechatChild();
    });
    getElement("privateChatSettingsBackBtn").addEventListener("click", function () {
      if (canOpenPrivateChatScreen()) {
        setActivePage("chatScreen");
      } else {
        setWechatTab("wechat");
        setActivePage("wechatScreen");
      }
    });
    getElement("groupSettingsBackBtn").addEventListener("click", function () {
      if (canOpenGroupChatScreen()) {
        setActivePage("groupChatScreen");
      } else {
        setWechatTab("wechat");
        setActivePage("wechatScreen");
      }
    });
    getElement("worldBookBackBtn").addEventListener("click", goHome);
    getElement("diaryBackBtn").addEventListener("click", function () {
      returnFromWechatChild();
    });
    getElement("characterSpaceBackBtn").addEventListener("click", goHome);
    getElement("themeBackBtn").addEventListener("click", goHome);
    getElement("photoBackBtn").addEventListener("click", goHome);
    getElement("notebookBackBtn").addEventListener("click", goHome);
    getElement("thoughtsBackBtn").addEventListener("click", function () {
      setActivePage(thoughtsReturnPage || "homeScreen");
    });
    getElement("watchListBackBtn").addEventListener("click", goHome);
    getElement("outingBackBtn").addEventListener("click", goHome);
    getElement("outingHistoryBtn").addEventListener("click", function () {
      outingStep = "history";
      renderOutingHistoryView();
    });
  }

  function bindForms() {
    getElement("saveCharacterBtn").addEventListener("click", window.CharacterManager.saveCharacterFromForm);

    getElement("createCharacterForm").addEventListener("submit", function (event) {
      event.preventDefault();
      window.CharacterManager.saveCharacterFromForm();
    });

    getElement("avatarPicker").addEventListener("click", function () {
      getElement("avatarInput").click();
    });

    getElement("avatarInput").addEventListener("change", window.CharacterManager.handleAvatarFileChange);

    getElement("chatComposer").addEventListener("submit", function (event) {
      event.preventDefault();
      window.CharacterManager.sendUserMessage();
    });

    getElement("chatInput").addEventListener("input", function () {
      if (window.CharacterManager && window.CharacterManager.handlePrivateInputDraftChange) {
        window.CharacterManager.handlePrivateInputDraftChange();
      }
    });

    getElement("chatPlusBtn").addEventListener("click", function (event) {
      event.stopPropagation();
      if (window.GroupManager && window.GroupManager.closeToolPanel) {
        window.GroupManager.closeToolPanel();
      }
      window.CharacterManager.toggleToolPanel();
    });

    addClick("privateBracketBtn", function () {
      insertBracketIntoInput(getElement("chatInput"));
    });

    Array.prototype.forEach.call(document.querySelectorAll("#chatToolPanel [data-message-type]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        window.CharacterManager.sendToolMessage(button.dataset.messageType);
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll("#chatToolPanel [data-tool-action]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        if (button.dataset.toolAction === "body-state") {
          window.CharacterManager.openActiveBodyState();
        }
        if (button.dataset.toolAction === "regenerate") {
          window.CharacterManager.openActiveRegenerateReply();
        }
      });
    });

    getElement("replyButton").addEventListener("click", function () {
      window.CharacterManager.handleComposerAction();
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-wechat-tab]"), function (button) {
      button.addEventListener("click", function () {
        setWechatTab(button.dataset.wechatTab);
      });
    });

    getElement("saveGroupBtn").addEventListener("click", window.GroupManager.saveGroupFromForm);

    getElement("createGroupForm").addEventListener("submit", function (event) {
      event.preventDefault();
      window.GroupManager.saveGroupFromForm();
    });

    getElement("groupChatComposer").addEventListener("submit", function (event) {
      event.preventDefault();
      window.GroupManager.sendGroupUserMessage();
    });

    getElement("groupChatInput").addEventListener("input", function () {
      if (window.GroupManager && window.GroupManager.handleGroupInputDraftChange) {
        window.GroupManager.handleGroupInputDraftChange();
      }
    });

    getElement("groupPlusBtn").addEventListener("click", function (event) {
      event.stopPropagation();
      if (window.CharacterManager && window.CharacterManager.closeToolPanel) {
        window.CharacterManager.closeToolPanel();
      }
      window.GroupManager.toggleToolPanel();
    });

    addClick("groupBracketBtn", function () {
      insertBracketIntoInput(getElement("groupChatInput"));
    });

    Array.prototype.forEach.call(document.querySelectorAll("#groupToolPanel [data-message-type]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        window.GroupManager.sendToolMessage(button.dataset.messageType);
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll("#groupToolPanel [data-tool-action]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        if (button.dataset.toolAction === "body-state") {
          window.GroupManager.openActiveGroupBodyState();
        }
        if (button.dataset.toolAction === "regenerate") {
          window.GroupManager.openActiveGroupRegenerateReply();
        }
      });
    });

    getElement("groupReplyButton").addEventListener("click", function () {
      window.GroupManager.handleComposerAction();
    });

    getElement("offlineComposer").addEventListener("submit", function (event) {
      event.preventDefault();
      window.OfflineManager.sendOfflineUserInput();
    });

    getElement("offlineAdvanceBtn").addEventListener("click", function () {
      window.OfflineManager.advanceOffline();
    });

    addClick("offlineBracketBtn", function () {
      insertBracketIntoInput(getElement("offlineInput"));
    });

    getElement("settingsForm").addEventListener("submit", function (event) {
      event.preventDefault();
      saveSettingsFromForm();
    });

    getElement("privateChatSettingsForm").addEventListener("submit", function (event) {
      event.preventDefault();
      window.CharacterManager.savePrivateChatSettings();
    });

    getElement("savePrivateChatSettingsBtn").addEventListener("click", function () {
      window.CharacterManager.savePrivateChatSettings();
    });

    getElement("groupSettingsForm").addEventListener("submit", function (event) {
      event.preventDefault();
      window.GroupManager.saveGroupSettings();
    });

    getElement("saveGroupSettingsBtn").addEventListener("click", function () {
      window.GroupManager.saveGroupSettings();
    });
  }

  function insertBracketIntoInput(inputElement) {
    var input = inputElement;
    var start;
    var end;
    var before;
    var selected;
    var after;
    var nextValue;
    var nextCursor;
    var maxLength;

    if (!input) {
      return;
    }

    input.focus();
    start = input.selectionStart === null || input.selectionStart === undefined ? input.value.length : input.selectionStart;
    end = input.selectionEnd === null || input.selectionEnd === undefined ? start : input.selectionEnd;
    before = input.value.slice(0, start);
    selected = input.value.slice(start, end);
    after = input.value.slice(end);
    nextValue = selected ? before + "（" + selected + "）" + after : before + "（）" + after;
    maxLength = Number(input.getAttribute("maxlength")) || 0;

    if (maxLength && nextValue.length > maxLength) {
      nextValue = nextValue.slice(0, maxLength);
    }

    input.value = nextValue;
    nextCursor = selected ? Math.min(maxLength || nextValue.length, end + 2) : Math.min(maxLength || nextValue.length, start + 1);

    if (input.setSelectionRange) {
      input.setSelectionRange(nextCursor, nextCursor);
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function bindChatMenuActions() {
    var chatMenu = getElement("chatActionMenu");

    getElement("chatMoreBtn").addEventListener("click", function (event) {
      event.stopPropagation();
      closeWechatAddMenu();
      window.CharacterManager.toggleChatActionMenu();
    });

    addClick("chatThoughtsHeartBtn", function (event) {
      event.stopPropagation();
      window.CharacterManager.openActiveCharacterThoughtsDrawer();
    });

    if (chatMenu) {
      chatMenu.addEventListener("click", function (event) {
        event.stopPropagation();
      });
    }

    getElement("chatSettingsBtn").addEventListener("click", window.CharacterManager.openActivePrivateSettings);
    addClick("chatWorldBookBtn", window.CharacterManager.openActiveChatWorldBookSelector);
    getElement("chatMemoryBtn").addEventListener("click", window.CharacterManager.openActiveChatMemory);
    getElement("chatSearchBtn").addEventListener("click", window.CharacterManager.openActiveChatSearch);
    getElement("chatBatchSelectBtn").addEventListener("click", window.CharacterManager.openPrivateMessageSelectionMode);
    getElement("chatOfflineBtn").addEventListener("click", window.CharacterManager.openActiveCharacterOffline);
    addClick("chatBlockBtn", function (event) {
      event.preventDefault();
      event.stopPropagation();
      window.CharacterManager.toggleActiveCharacterBlock();
    });
    getElement("privateOfflineExitBtn").addEventListener("click", function () {
      window.OfflineManager.disableInlineOffline();
    });
    getElement("clearChatHistoryBtn").addEventListener("click", window.CharacterManager.clearActiveChatHistory);
    getElement("chatDeleteCharacterBtn").addEventListener("click", window.CharacterManager.deleteActiveCharacter);
  }

  function bindGroupMenuActions() {
    var groupMenu = getElement("groupChatActionMenu");

    getElement("groupChatMoreBtn").addEventListener("click", function (event) {
      event.stopPropagation();
      closeWechatAddMenu();
      window.GroupManager.toggleGroupActionMenu();
    });

    addClick("groupThoughtsHeartBtn", function (event) {
      event.stopPropagation();
      window.GroupManager.openActiveGroupThoughtsDrawer();
    });

    if (groupMenu) {
      groupMenu.addEventListener("click", function (event) {
        event.stopPropagation();
      });
    }

    getElement("groupSettingsBtn").addEventListener("click", window.GroupManager.openActiveGroupSettings);
    addClick("groupWorldBookBtn", window.GroupManager.openActiveGroupWorldBookSelector);
    getElement("groupMemoryBtn").addEventListener("click", window.GroupManager.openActiveGroupMemory);
    getElement("groupClearChatHistoryBtn").addEventListener("click", window.GroupManager.clearActiveGroupChatHistory);
    getElement("groupSearchBtn").addEventListener("click", window.GroupManager.openActiveGroupSearch);
    getElement("groupBatchMessageSelectBtn").addEventListener("click", window.GroupManager.openGroupMessageSelectionMode);
    getElement("groupOfflineBtn").addEventListener("click", window.GroupManager.openActiveGroupOffline);
    getElement("groupOfflineExitBtn").addEventListener("click", function () {
      window.OfflineManager.disableInlineOffline();
    });

    addClick("offlineThoughtsHeartBtn", function (event) {
      event.stopPropagation();
      if (window.OfflineManager && window.OfflineManager.openActiveOfflineThoughtsDrawer) {
        window.OfflineManager.openActiveOfflineThoughtsDrawer();
      }
    });
  }

  function bindDataManagementActions() {
    getElement("fetchModelsBtn").addEventListener("click", fetchModelsFromSettings);
    getElement("apiProfileSelect").addEventListener("change", function (event) {
      switchApiProfile(event.target.value);
    });
    getElement("newApiProfileBtn").addEventListener("click", createApiProfile);
    getElement("deleteApiProfileBtn").addEventListener("click", deleteActiveApiProfile);
    getElement("refreshShopProductsBtn").addEventListener("click", function () {
      refreshShopProducts(true);
    });
    getElement("exportDataBtn").addEventListener("click", exportAllData);
    getElement("clearPrivateChatMemoriesBtn").addEventListener("click", function () {
      if (window.confirm("确定清空全部私聊记忆吗？")) {
        window.AppStorage.clearAllChatMemoriesByType("private");
        showSettingsTip("已清空全部私聊记忆");
      }
    });
    getElement("clearGroupChatMemoriesBtn").addEventListener("click", function () {
      if (window.confirm("确定清空全部群聊记忆吗？")) {
        window.AppStorage.clearAllChatMemoriesByType("group");
        showSettingsTip("已清空全部群聊记忆");
      }
    });
    getElement("clearAllBodyStatesBtn").addEventListener("click", function () {
      if (window.confirm("确定清空全部身体状态吗？")) {
        window.AppStorage.clearAllBodyStates();
        showSettingsTip("已清空身体状态");
      }
    });
    getElement("newWorldBookBtn").addEventListener("click", createWorldBook);
    getElement("importWorldBookBtn").addEventListener("click", function () {
      getElement("worldBookImportInput").click();
    });
    getElement("importPhotoBtn").addEventListener("click", function () {
      getElement("photoImportInput").click();
    });
    getElement("photoImportInput").addEventListener("change", importPhotoFiles);
    getElement("newNoteBtn").addEventListener("click", createNote);
    getElement("worldBookImportInput").addEventListener("change", importWorldBookFromFile);
    getElement("importDataBtn").addEventListener("click", function () {
      getElement("importDataInput").click();
    });
    getElement("importDataInput").addEventListener("change", importDataFromFile);
    getElement("characterImportInput").addEventListener("change", importCharacterFromFile);
    getElement("clearAllDataBtn").addEventListener("click", clearAllData);
  }

  function bindGlobalActions() {
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".action-menu") && !event.target.closest(".card-more") && event.target.id !== "chatMoreBtn" && event.target.id !== "groupChatMoreBtn" && event.target.id !== "wechatAddBtn") {
        window.CharacterManager.closeAllMenus();
        if (window.GroupManager) {
          window.GroupManager.closeAllMenus();
        }
        closeWechatAddMenu();
      }
    });
  }

  function bindMessageActionSheet() {
    var sheet = getElement("messageActionSheet");
    var panel = sheet ? sheet.querySelector(".message-action-panel") : null;

    if (!sheet || !panel) {
      return;
    }

    sheet.addEventListener("click", function (event) {
      var button = event.target.closest("[data-action]");
      var action = button ? button.dataset.action : "cancel";
      var handler = currentMessageAction && currentMessageAction.onAction;

      if (action !== "cancel" && typeof handler === "function") {
        handler(action);
      }

      closeMessageActionMenu();
    });

    panel.addEventListener("click", function (event) {
      event.stopPropagation();
    });

    Array.prototype.forEach.call(panel.querySelectorAll("[data-action]"), function (button) {
      button.addEventListener("click", function (event) {
        var action = button.dataset.action;
        var handler = currentMessageAction && currentMessageAction.onAction;

        event.stopPropagation();

        if (action !== "cancel" && typeof handler === "function") {
          handler(action);
        }

        closeMessageActionMenu();
      });
    });
  }

  function bindWeChatModal() {
    var mask = getElement("wechatModalMask");
    var sheet = getElement("wechatSheet");
    var emojiInput = getElement("emojiImportInput");
    var imageInput = getElement("messageImageInput");

    if (mask) {
      mask.addEventListener("click", function (event) {
        if (event.target === mask) {
          closeWeChatSheet();
        }
      });
    }

    if (sheet) {
      sheet.addEventListener("click", function (event) {
        event.stopPropagation();
      });
    }

    if (emojiInput) {
      emojiInput.addEventListener("change", importEmojiFile);
    }

    if (imageInput) {
      imageInput.addEventListener("change", importImageFile);
    }
  }

  function openMessageActionMenu(options) {
    var sheet = getElement("messageActionSheet");
    var regenerateButton = sheet ? sheet.querySelector('[data-action="regenerate"]') : null;
    var editButton = sheet ? sheet.querySelector('[data-action="edit"]') : null;

    if (!sheet) {
      return;
    }

    currentMessageAction = options || null;

    if (regenerateButton) {
      regenerateButton.classList.toggle("hidden", Boolean(options && options.canRegenerate === false));
    }

    if (editButton) {
      editButton.classList.toggle("hidden", !options || options.canEdit !== true);
    }

    sheet.classList.remove("hidden");
  }

  function closeMessageActionMenu() {
    var sheet = getElement("messageActionSheet");

    currentMessageAction = null;

    if (sheet) {
      sheet.classList.add("hidden");
    }
  }

  function showWeChatSheet(html, afterRender) {
    var mask = getElement("wechatModalMask");
    var sheet = getElement("wechatSheet");

    if (!mask || !sheet) {
      return;
    }

    sheet.innerHTML = html;
    mask.classList.remove("hidden");

    if (typeof afterRender === "function") {
      afterRender(sheet);
    }
  }

  function closeWeChatSheet() {
    var mask = getElement("wechatModalMask");
    var sheet = getElement("wechatSheet");

    if (mask) {
      mask.classList.add("hidden");
    }

    if (sheet) {
      sheet.innerHTML = "";
    }

    emojiSendCallback = null;
    imageSendCallback = null;
  }

  function openMessageEditSheet(message, onSave) {
    var source = message || {};
    var original = String(source.content || "");

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      '  <span></span>',
      "  <h3>编辑消息</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<form id="messageEditForm" class="wechat-sheet-form" autocomplete="off">',
      '  <label class="wechat-sheet-field"><span>内容</span><textarea id="messageEditContent" maxlength="4000">' + escapeHtml(original) + "</textarea></label>",
      '  <p id="messageEditError" class="sheet-error" role="alert"></p>',
      '  <div class="wechat-sheet-actions"><button type="button" class="outline-button" data-close-sheet>取消</button><button type="submit" class="full-button">保存</button></div>',
      "</form>"
    ].join(""), function (sheet) {
      var form = sheet.querySelector("#messageEditForm");
      var textarea = sheet.querySelector("#messageEditContent");
      var error = sheet.querySelector("#messageEditError");

      bindSheetCloseButtons(sheet);

      requestAnimationFrame(function () {
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
      });

      form.addEventListener("submit", function (event) {
        var nextContent = textarea.value.trim();
        var saved;

        event.preventDefault();

        if (!nextContent) {
          error.textContent = "内容不能为空。";
          return;
        }

        if (typeof onSave === "function") {
          saved = onSave(nextContent);
          if (saved === false) {
            return;
          }
        }

        closeWeChatSheet();
      });
    });
  }

  function openChatSearchSheet(options) {
    var source = options || {};
    var messages = (source.messages || []).filter(function (message) {
      return message && message.type !== "loading" && message.content;
    });

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      '  <span></span>',
      "  <h3>" + escapeHtml(source.title || "搜索聊天记录") + "</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<div class="wechat-sheet-form chat-search-panel">',
      '  <label class="wechat-sheet-field">',
      "    <span>关键词</span>",
      '    <input id="chatSearchInput" type="search" placeholder="输入消息内容、发送者或日期" maxlength="40">',
      "  </label>",
      '  <div id="chatSearchResults" class="chat-search-results"></div>',
      "</div>"
    ].join(""), function (sheet) {
      var input = sheet.querySelector("#chatSearchInput");
      var results = sheet.querySelector("#chatSearchResults");

      bindSheetCloseButtons(sheet);

      function getSender(message) {
        if (typeof source.sender === "function") {
          return source.sender(message);
        }
        if (message.role === "user") {
          return "我";
        }
        if (message.role === "system") {
          return "系统";
        }
        return message.characterName || "角色";
      }

      function renderResults() {
        var keyword = input.value.trim().toLowerCase();
        var matches = messages.filter(function (message) {
          var haystack = [
            message.content || "",
            formatTypedPreview(message),
            getSender(message),
            formatDateTime(message.createdAt)
          ].join(" ").toLowerCase();
          return keyword && haystack.indexOf(keyword) !== -1;
        }).slice(0, 80);

        if (!keyword) {
          results.innerHTML = '<div class="soft-empty">输入关键词后显示聊天记录结果</div>';
          return;
        }

        if (!matches.length) {
          results.innerHTML = '<div class="soft-empty">没有找到匹配消息</div>';
          return;
        }

        results.innerHTML = matches.map(function (message) {
          return [
            '<button type="button" class="chat-search-result" data-search-message-id="' + escapeHtml(message.id || "") + '">',
            '  <strong>' + escapeHtml(getSender(message)) + "</strong>",
            '  <span>' + escapeHtml(formatTypedPreview(message)) + "</span>",
            '  <em>' + escapeHtml(formatDateTime(message.createdAt)) + "</em>",
            "</button>"
          ].join("");
        }).join("");

        Array.prototype.forEach.call(results.querySelectorAll("[data-search-message-id]"), function (button) {
          button.addEventListener("click", function () {
            var messageId = button.dataset.searchMessageId;
            closeWeChatSheet();
            if (typeof source.onJump === "function") {
              source.onJump(messageId);
            }
          });
        });
      }

      input.addEventListener("input", renderResults);
      renderResults();
      window.setTimeout(function () {
        input.focus();
      }, 50);
    });
  }

  function openRegenerateReplySheet(options) {
    var source = options || {};

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      '  <span></span>',
      "  <h3>重新生成回复</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<form id="regenerateReplyForm" class="wechat-sheet-form regenerate-reply-form" autocomplete="off">',
      '  <label class="wechat-sheet-field"><span>重回要求（可选）</span><textarea id="regenerateRequirementInput" maxlength="300" placeholder="例如：语气更克制一点，别跳过刚才的问题"></textarea></label>',
      '  <div class="wechat-sheet-actions"><button type="button" class="outline-button" data-close-sheet>取消</button><button type="submit" class="full-button">确认重回</button></div>',
      "</form>"
    ].join(""), function (sheet) {
      var form = sheet.querySelector("#regenerateReplyForm");
      var input = sheet.querySelector("#regenerateRequirementInput");

      bindSheetCloseButtons(sheet);

      if (input) {
        window.setTimeout(function () {
          input.focus();
        }, 50);
      }

      if (form) {
        form.addEventListener("submit", function (event) {
          var requirement = input ? input.value.trim() : "";

          event.preventDefault();
          closeWeChatSheet();

          if (typeof source.onConfirm === "function") {
            source.onConfirm(requirement);
          }
        });
      }
    });
  }

  function openOfflineSceneSheet(onSelect) {
    var scenes = [
      { name: "学校", description: "走廊、教室和课间氛围都可以自然出现" },
      { name: "图书馆", description: "安静、书架和低声交谈的空间" },
      { name: "咖啡店", description: "有饮品香气、靠窗座位和轻松谈话" },
      { name: "雨天街道", description: "雨声、伞、街灯和临时避雨的情绪" },
      { name: "商场", description: "人流、橱窗、店铺和一起闲逛的节奏" }
    ];

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      '  <span></span>',
      "  <h3>选择线下场景</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<div class="wechat-sheet-form offline-scene-panel">',
      '  <div class="scene-preset-grid">',
      scenes.map(function (scene, index) {
        return [
          '<button type="button" class="scene-preset" data-scene-index="' + index + '">',
          "  <strong>" + escapeHtml(scene.name) + "</strong>",
          "  <span>" + escapeHtml(scene.description) + "</span>",
          "</button>"
        ].join("");
      }).join(""),
      "  </div>",
      '  <label class="wechat-sheet-field">',
      "    <span>自定义场景名称</span>",
      '    <input id="customSceneName" type="text" placeholder="例如：天台、练习室" maxlength="30">',
      "  </label>",
      '  <label class="wechat-sheet-field">',
      "    <span>自定义场景描述</span>",
      '    <textarea id="customSceneDescription" placeholder="写下地点氛围、正在发生的事或你想要的剧情基调" maxlength="220"></textarea>',
      "  </label>",
      '  <p id="sceneToolError" class="sheet-error" role="alert"></p>',
      '  <div class="wechat-sheet-actions">',
      '    <button type="button" class="outline-button" data-close-sheet>取消</button>',
      '    <button id="useCustomSceneBtn" type="button" class="full-button">使用自定义场景</button>',
      "  </div>",
      "</div>"
    ].join(""), function (sheet) {
      bindSheetCloseButtons(sheet);

      function choose(scene) {
        closeWeChatSheet();
        if (typeof onSelect === "function") {
          onSelect(scene);
        }
      }

      Array.prototype.forEach.call(sheet.querySelectorAll("[data-scene-index]"), function (button) {
        button.addEventListener("click", function () {
          choose(scenes[Number(button.dataset.sceneIndex)]);
        });
      });

      sheet.querySelector("#useCustomSceneBtn").addEventListener("click", function () {
        var name = sheet.querySelector("#customSceneName").value.trim();
        var description = sheet.querySelector("#customSceneDescription").value.trim();
        var error = sheet.querySelector("#sceneToolError");

        if (!name) {
          error.textContent = "请输入自定义场景名称。";
          return;
        }

        choose({
          name: name,
          description: description || "用户自定义的线下互动场景"
        });
      });
    });
  }

  function openRedPacketSheet(onSend) {
    openMoneySheet({
      title: "发红包",
      amountPlaceholder: "请输入金额",
      textLabel: "祝福语",
      textPlaceholder: "恭喜发财，大吉大利",
      textDefault: "恭喜发财，大吉大利",
      submitText: "塞钱进红包",
      onSubmit: function (amount, text) {
        onSend({
          type: "redPacket",
          content: text || "恭喜发财，大吉大利",
          amount: amount,
          status: "pending"
        });
      }
    });
  }

  function openTransferSheet(onSend) {
    openMoneySheet({
      title: "转账",
      amountPlaceholder: "请输入转账金额",
      textLabel: "备注",
      textPlaceholder: "添加转账说明",
      textDefault: "",
      submitText: "确认转账",
      onSubmit: function (amount, text) {
        onSend({
          type: "transfer",
          content: "转账",
          amount: amount,
          note: text,
          status: "pending"
        });
      }
    });
  }

  function openMoneySheet(config) {
    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>" + escapeHtml(config.title) + "</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<form id="moneyToolForm" class="wechat-sheet-form" autocomplete="off">',
      '  <label class="wechat-sheet-field">',
      "    <span>金额</span>",
      '    <input id="moneyAmount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="' + escapeHtml(config.amountPlaceholder) + '">',
      "  </label>",
      '  <label class="wechat-sheet-field">',
      "    <span>" + escapeHtml(config.textLabel) + "</span>",
      '    <input id="moneyText" type="text" maxlength="40" placeholder="' + escapeHtml(config.textPlaceholder) + '" value="' + escapeHtml(config.textDefault) + '">',
      "  </label>",
      '  <p id="moneyToolError" class="sheet-error" role="alert"></p>',
      '  <div class="wechat-sheet-actions">',
      '    <button type="button" class="outline-button" data-close-sheet>取消</button>',
      '    <button type="submit" class="full-button">' + escapeHtml(config.submitText) + "</button>",
      "  </div>",
      "</form>"
    ].join(""), function (sheet) {
      var form = sheet.querySelector("#moneyToolForm");

      bindSheetCloseButtons(sheet);
      form.addEventListener("submit", function (event) {
        var error = sheet.querySelector("#moneyToolError");
        var amountInput = sheet.querySelector("#moneyAmount");
        var textInput = sheet.querySelector("#moneyText");
        var amount;

        event.preventDefault();

        try {
          amount = normalizeAmount(amountInput.value);
        } catch (amountError) {
          error.textContent = amountError.message;
          return;
        }

        if (window.AppStorage.getWallet && window.AppStorage.getWallet().balance < Number(amount)) {
          error.textContent = "余额不足，请先充值。";
          return;
        }

        config.onSubmit(amount, textInput.value.trim());
        closeWeChatSheet();
      });
    });
  }

  function normalizeAmount(value) {
    var text = String(value || "").trim();
    var amount;

    if (!text) {
      throw new Error("请输入金额。");
    }

    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      throw new Error("金额最多保留两位小数。");
    }

    amount = Number(text);

    if (!amount || amount <= 0) {
      throw new Error("金额必须大于 0。");
    }

    return amount.toFixed(2);
  }

  function openLocationSheet(onSend) {
    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>选择位置</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<div class="wechat-sheet-form">',
      '  <label class="wechat-sheet-field">',
      "    <span>地点名称</span>",
      '    <input id="locationNameInput" type="text" placeholder="搜索或输入地点名称" maxlength="30">',
      "  </label>",
      '  <label class="wechat-sheet-field">',
      "    <span>备注 / 简短描述</span>",
      '    <input id="locationAddressInput" type="text" placeholder="例如：常去的地方" maxlength="60">',
      "  </label>",
      '  <div class="location-preset-list">',
      presetLocations.map(function (location, index) {
        return [
          '<button type="button" class="location-preset-item" data-location-index="' + index + '">',
          "  <strong>" + escapeHtml(location.name) + "</strong>",
          "  <span>" + escapeHtml(location.address) + "</span>",
          "</button>"
        ].join("");
      }).join(""),
      "  </div>",
      '  <p id="locationToolError" class="sheet-error" role="alert"></p>',
      '  <div class="wechat-sheet-actions">',
      '    <button type="button" class="outline-button" data-close-sheet>取消</button>',
      '    <button id="sendCustomLocationBtn" type="button" class="full-button">发送自定义位置</button>',
      "  </div>",
      "</div>"
    ].join(""), function (sheet) {
      bindSheetCloseButtons(sheet);

      Array.prototype.forEach.call(sheet.querySelectorAll("[data-location-index]"), function (button) {
        button.addEventListener("click", function () {
          sendLocation(onSend, presetLocations[Number(button.dataset.locationIndex)]);
        });
      });

      sheet.querySelector("#sendCustomLocationBtn").addEventListener("click", function () {
        var name = sheet.querySelector("#locationNameInput").value.trim();
        var address = sheet.querySelector("#locationAddressInput").value.trim();
        var error = sheet.querySelector("#locationToolError");

        if (!name) {
          error.textContent = "请输入地点名称。";
          return;
        }

        sendLocation(onSend, {
          name: name,
          address: address || "常去的地方",
          lat: null,
          lng: null
        });
      });
    });
  }

  function sendLocation(onSend, location) {
    onSend({
      type: "location",
      content: location.name,
      location: {
        name: location.name,
        address: location.address || "常去的地方",
        lat: null,
        lng: null
      }
    });
    closeWeChatSheet();
  }

  function openEmojiSheet(onSend) {
    var importedEmojis = window.AppStorage.getEmojiPacks ? window.AppStorage.getEmojiPacks() : [];

    emojiSendCallback = onSend;

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>表情</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<div class="emoji-panel">',
      '  <div class="emoji-grid">',
      defaultEmojis.map(function (emoji) {
        return '<button type="button" class="emoji-item emoji-text-item" data-default-emoji="' + escapeHtml(emoji) + '">' + escapeHtml(emoji) + "</button>";
      }).join(""),
      "  </div>",
      '  <div class="emoji-panel-title">已导入表情</div>',
      '  <div class="emoji-grid imported-emoji-grid">',
      importedEmojis.length ? importedEmojis.map(function (emoji) {
        return '<button type="button" class="emoji-item" data-imported-emoji="' + escapeHtml(emoji.id) + '"><img src="' + escapeHtml(emoji.src) + '" alt="' + escapeHtml(emoji.name) + '"></button>';
      }).join("") : '<div class="soft-empty">还没有导入表情</div>',
      "  </div>",
      '  <div class="wechat-sheet-actions">',
      '    <button id="importEmojiBtn" type="button" class="outline-button">导入表情</button>',
      '    <button type="button" class="outline-button" data-close-sheet>取消</button>',
      "  </div>",
      "</div>"
    ].join(""), function (sheet) {
      bindSheetCloseButtons(sheet);

      Array.prototype.forEach.call(sheet.querySelectorAll("[data-default-emoji]"), function (button) {
        button.addEventListener("click", function () {
          onSend({
            type: "emoji",
            content: button.dataset.defaultEmoji,
            emoji: {
              type: "text",
              value: button.dataset.defaultEmoji
            }
          });
          closeWeChatSheet();
        });
      });

      Array.prototype.forEach.call(sheet.querySelectorAll("[data-imported-emoji]"), function (button) {
        button.addEventListener("click", function () {
          var emoji = importedEmojis.find(function (item) {
            return item.id === button.dataset.importedEmoji;
          });

          if (!emoji) {
            return;
          }

          onSend({
            type: "emoji",
            content: "[表情]",
            emoji: {
              type: "image",
              src: emoji.src
            }
          });
          closeWeChatSheet();
        });
      });

      sheet.querySelector("#importEmojiBtn").addEventListener("click", function () {
        getElement("emojiImportInput").click();
      });
    });
  }

  function openImagePicker(onSend) {
    var input = getElement("messageImageInput");

    imageSendCallback = onSend;

    if (input) {
      input.value = "";
      input.click();
    }
  }

  function openVoiceSheet(onSend) {
    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>发送语音消息</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<form id="voiceToolForm" class="wechat-sheet-form" autocomplete="off">',
      '  <label class="wechat-sheet-field">',
      "    <span>语音内容</span>",
      '    <textarea id="voiceTextInput" rows="4" placeholder="输入你想模拟成语音发送的内容" maxlength="240"></textarea>',
      "  </label>",
      '  <p id="voiceToolError" class="sheet-error" role="alert"></p>',
      '  <div class="wechat-sheet-actions">',
      '    <button type="button" class="outline-button" data-close-sheet>取消</button>',
      '    <button type="submit" class="full-button">发送语音</button>',
      "  </div>",
      "</form>"
    ].join(""), function (sheet) {
      var form = sheet.querySelector("#voiceToolForm");

      bindSheetCloseButtons(sheet);
      form.addEventListener("submit", function (event) {
        var text = sheet.querySelector("#voiceTextInput").value.trim();
        var error = sheet.querySelector("#voiceToolError");

        event.preventDefault();

        if (!text) {
          error.textContent = "请输入语音内容。";
          return;
        }

        onSend({
          type: "voice",
          content: text,
          voice: {
            text: text,
            duration: estimateVoiceDuration(text)
          }
        });
        closeWeChatSheet();
      });
    });
  }

  function importEmojiFile(event) {
    var input = event.target;
    var file = input.files && input.files[0];
    var reader;

    if (!file) {
      return;
    }

    reader = new FileReader();
    reader.onload = function () {
      window.AppStorage.addEmoji({
        id: String(Date.now()),
        name: file.name || "表情",
        type: "image",
        src: String(reader.result || ""),
        createdAt: Date.now()
      });

      input.value = "";

      if (emojiSendCallback) {
        openEmojiSheet(emojiSendCallback);
      }
    };
    reader.onerror = function () {
      input.value = "";
      window.alert("表情导入失败，请重新选择图片。");
    };
    reader.readAsDataURL(file);
  }

  function importImageFile(event) {
    var input = event.target;
    var file = input.files && input.files[0];
    var reader;

    if (!file || !imageSendCallback) {
      input.value = "";
      return;
    }

    reader = new FileReader();
    reader.onload = function () {
      imageSendCallback({
        type: "image",
        content: "[图片]",
        image: {
          src: String(reader.result || ""),
          name: file.name || "图片",
          size: Number(file.size) || 0
        }
      });
      input.value = "";
      imageSendCallback = null;
    };
    reader.onerror = function () {
      input.value = "";
      imageSendCallback = null;
      window.alert("图片读取失败，请重新选择。");
    };
    reader.readAsDataURL(file);
  }

  function showMessageDetail(message) {
    if (!message) {
      return;
    }

    if (message.type === "image") {
      if (message.image && message.image.src) {
        showImagePreview(message.image);
      } else {
        showImageDescription(message.image || { description: message.content || "图片" });
      }
      return;
    }

    if (message.type === "voice") {
      showVoiceTextModal(message.voice || { text: message.content || "", duration: estimateVoiceDuration(message.content) });
      return;
    }

    if (message.type === "redPacket") {
      showMoneyDetail("红包详情", message.content || "恭喜发财，大吉大利", formatMoneyDetailAmount(message.amount), getMoneyMessageStatusText(message));
      return;
    }

    if (message.type === "transfer") {
      showMoneyDetail("转账详情", message.note || "转账", formatMoneyDetailAmount(message.amount), getMoneyMessageStatusText(message));
      return;
    }

    if (message.type === "location") {
      showLocationDetail(message.location || { name: message.content || "位置", address: "常去的地方" });
    }
  }

  function showMoneyDetail(title, subtitle, amount, status) {
    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>" + escapeHtml(title) + "</h3>",
      '  <button type="button" data-close-sheet>关闭</button>',
      "</div>",
      '<div class="money-detail-modal">',
      "  <strong>" + escapeHtml(amount) + "</strong>",
      "  <span>" + escapeHtml(subtitle) + "</span>",
      "  <em>" + escapeHtml(status) + "</em>",
      '  <button type="button" class="full-button" data-close-sheet>关闭</button>',
      "</div>"
    ].join(""), bindSheetCloseButtons);
  }

  function formatMoneyDetailAmount(amount) {
    var normalized = normalizeMoneyAmount(amount);
    return normalized ? "¥" + normalized : "金额无效";
  }

  function getMoneyMessageStatusText(message) {
    var status = message && message.status ? String(message.status) : "";
    if (status === "accepted") {
      return "已收款";
    }
    if (status === "received") {
      return "已领取";
    }
    if (status === "returned" || status === "rejected" || status === "refunded") {
      return "已退回";
    }
    if (message && message.role === "character" && (message.received || message.walletRecorded || message.walletLedgerId)) {
      return message.type === "redPacket" ? "已领取" : "已收款";
    }
    if (message && message.role === "user") {
      return message.type === "redPacket" ? "待对方领取" : "待对方收款";
    }
    return message && message.type === "redPacket" ? "待领取" : "待收款";
  }

  function showLocationDetail(location) {
    location = location || {};
    var address = getSafeLocationAddress(location);

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>位置详情</h3>",
      '  <button type="button" data-close-sheet>关闭</button>',
      "</div>",
      '<div class="location-detail-modal">',
      "  <strong>" + escapeHtml(location.name || "位置") + "</strong>",
      "  <span>" + escapeHtml(address) + "</span>",
      renderFakeMap(),
      '  <button type="button" class="full-button" data-close-sheet>关闭</button>',
      "</div>"
    ].join(""), bindSheetCloseButtons);
  }

  function getSafeLocationAddress(location) {
    if (!location) {
      return "常去的地方";
    }

    if (location.lat !== null && location.lat !== undefined) {
      return "常去的地方";
    }

    if (location.lng !== null && location.lng !== undefined) {
      return "常去的地方";
    }

    return location.address || "常去的地方";
  }

  function renderFakeMap() {
    return '<div class="fake-map" aria-hidden="true"><span></span></div>';
  }

  function showImagePreview(image) {
    showWeChatSheet([
      '<div class="image-preview-mask">',
      '  <div class="image-preview-content">',
      '    <button type="button" class="nav-text-button" data-close-sheet>关闭</button>',
      '    <img src="' + escapeHtml(image.src || "") + '" alt="' + escapeHtml(image.name || "图片") + '">',
      "    <span>" + escapeHtml(image.name || "图片") + "</span>",
      "  </div>",
      "</div>"
    ].join(""), bindSheetCloseButtons);
  }

  function showImageDescription(image) {
    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>图片详情</h3>",
      '  <button type="button" data-close-sheet>关闭</button>',
      "</div>",
      '<div class="voice-text-modal">',
      "  <strong>图片描述</strong>",
      "  <p>" + escapeHtml(image.description || "图片") + "</p>",
      '  <button type="button" class="full-button" data-close-sheet>关闭</button>',
      "</div>"
    ].join(""), bindSheetCloseButtons);
  }

  function showVoiceTextModal(voice) {
    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>语音转写</h3>",
      '  <button type="button" data-close-sheet>关闭</button>',
      "</div>",
      '<div class="voice-text-modal">',
      "  <strong>" + escapeHtml(String(voice.duration || 0)) + "''</strong>",
      "  <p>" + escapeHtml(voice.text || "") + "</p>",
      '  <button type="button" class="full-button" data-close-sheet>关闭</button>',
      "</div>"
    ].join(""), bindSheetCloseButtons);
  }

  function bindSheetCloseButtons(sheet) {
    Array.prototype.forEach.call(sheet.querySelectorAll("[data-close-sheet]"), function (button) {
      button.addEventListener("click", closeWeChatSheet);
    });
  }

  function estimateVoiceDuration(text) {
    return Math.min(60, Math.max(2, Math.ceil(String(text || "").length / 4)));
  }

  function getCharacterById(characterId) {
    return window.AppStorage.getCharacters().find(function (character) {
      return character.id === characterId;
    }) || null;
  }

  function getLocalDateString(date) {
    var value = date || new Date();
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0")
    ].join("-");
  }

  function formatDateTime(timestamp) {
    var date = new Date(timestamp || Date.now());
    return getLocalDateString(date) + " " + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  }

  function renderSmallAvatar(character, className) {
    if (character && character.avatar) {
      return '<img class="' + className + ' has-image" src="' + escapeHtml(character.avatar) + '" alt="' + escapeHtml(character.name || "角色") + '头像">';
    }

    return '<span class="' + className + '" aria-hidden="true">' + escapeHtml(character && character.name ? character.name.slice(0, 1) : "心") + "</span>";
  }

  function createWorldBook() {
    var now = Date.now();
    var book = window.AppStorage.addWorldBook({
      id: String(now),
      name: "未命名世界书",
      description: "",
      entries: [{
        id: String(now + 1),
        title: "新条目",
        keyword: "",
        keywords: [],
        content: "",
        insertPosition: "before",
        group: "未分组",
        enabled: true,
        priority: 10,
        createdAt: now,
        updatedAt: now
      }],
      enabled: true,
      scope: "global",
      targetIds: [],
      createdAt: now,
      updatedAt: now
    });
    expandedWorldBookIds[book.id] = true;
    if (book.entries && book.entries[0]) {
      expandedWorldEntryIds[getWorldEntryUiKey(book.id, book.entries[0].id)] = true;
    }
    renderWorldBookScreen();
  }

  function renderWorldBookScreen() {
    var content = getElement("worldBookContent");
    var books = window.AppStorage.getWorldBooks ? window.AppStorage.getWorldBooks() : [];

    if (!content) {
      return;
    }

    if (!books.length) {
      content.innerHTML = [
        renderWorldBookTopBar(books),
        '<div class="empty-state compact-empty">',
        '  <div class="empty-visual" aria-hidden="true"><span class="empty-dot"></span></div>',
        "  <h3>世界书还是空的</h3>",
        "  <p>把世界观、地点、规则和长期设定整理成资料卡，角色回复时会按关键词引用。</p>",
        "</div>"
      ].join("");
      bindWorldBookActions(content);
      return;
    }

    content.innerHTML = [
      renderWorldBookTopBar(books),
      '<div class="notebook-list world-book-list">',
      books.map(renderWorldBookCard).join(""),
      "</div>"
    ].join("");
    bindWorldBookActions(content);
  }

  function renderWorldBookTopBar(books) {
    var entryCount = (books || []).reduce(function (total, book) {
      return total + (book.entries || []).length;
    }, 0);

    return [
      '<section class="world-book-toolbar">',
      '  <div><strong>世界书</strong><span>' + escapeHtml((books || []).length + " 本 / " + entryCount + " 条") + "</span></div>",
      '  <div class="world-book-toolbar-actions">',
      '    <button class="outline-button" type="button" data-world-action="create">新建世界书</button>',
      '    <button class="outline-button" type="button" data-world-action="import-json">导入 JSON</button>',
      "  </div>",
      "</section>"
    ].join("");
  }

  function renderWorldBookCard(book) {
    var scopeText = getWorldBookScopeLabel(book);
    var expanded = Boolean(expandedWorldBookIds[book.id]);
    var entries = book.entries || [];
    var groups = groupWorldBookEntries(entries);
    var summary = book.description || getWorldBookAutoSummary(book);

    return [
      '<article class="world-book-card app-fold-card' + (expanded ? " expanded" : "") + '" data-book-id="' + escapeHtml(book.id) + '">',
      '  <div class="world-book-card-head">',
      '    <button class="world-book-title-button" type="button" data-world-action="toggle-book">',
      '      <span class="fold-chevron" aria-hidden="true">' + (expanded ? "⌄" : "›") + "</span>",
      "      <strong>" + escapeHtml(book.name || "未命名世界书") + "</strong>",
      "    </button>",
      '    <span class="' + (book.enabled ? "enabled" : "disabled") + '">' + (book.enabled ? "启用" : "停用") + "</span>",
      "  </div>",
      '  <p class="world-book-summary">' + escapeHtml(summary || "暂无描述") + "</p>",
      '  <div class="world-book-meta"><span>范围：' + escapeHtml(scopeText) + '</span><span>条目：' + entries.length + '</span><span>分组：' + groups.length + "</span></div>",
      '  <div class="world-book-actions compact">',
      '    <button class="outline-button" type="button" data-world-action="toggle-book">' + (expanded ? "收起" : "展开") + "</button>",
      expanded ? '    <button class="outline-button" type="button" data-world-action="save-book">保存</button>' : '    <button class="outline-button" type="button" data-world-action="add-entry">新条目</button>',
      expanded ? '    <button class="outline-button" type="button" data-world-action="duplicate-book">复制</button>' : "",
      expanded ? '    <button class="outline-button" type="button" data-world-action="export-book">导出</button>' : "",
      expanded ? '    <button class="outline-button danger" type="button" data-world-action="delete-book">删除</button>' : "",
      "  </div>",
      expanded ? renderWorldBookExpanded(book, groups) : renderWorldBookCollapsedGroups(book, groups),
      "</article>"
    ].join("");
  }

  function getWorldBookAutoSummary(book) {
    var entries = book && Array.isArray(book.entries) ? book.entries : [];
    var first = entries.find(function (entry) {
      return entry && (entry.summary || entry.content);
    });

    return first ? getWorldEntrySummary(first) : "暂无描述";
  }

  function getWorldBookScopeLabel(book) {
    var scope = book && book.scope || "global";
    var targetCount = book && Array.isArray(book.targetIds) ? book.targetIds.length : 0;

    if (scope === "private") {
      return targetCount ? "指定私聊 " + targetCount + " 个" : "全部私聊";
    }

    if (scope === "group") {
      return targetCount ? "指定群聊 " + targetCount + " 个" : "全部群聊";
    }

    return "全局";
  }

  function renderWorldBookEditor(bookId) {
    expandedWorldBookIds[bookId] = true;
    renderWorldBookScreen();
  }

  function renderWorldBookExpanded(book, groups) {
    return [
      '<div class="world-book-expanded">',
      '  <div class="world-book-detail-grid">',
      '  <div class="field-group">',
      '    <label>名称</label>',
      '    <input data-book-field="name" type="text" value="' + escapeHtml(book.name) + '" maxlength="40">',
      "  </div>",
      '  <div class="field-group">',
      '    <label>描述</label>',
      '    <textarea data-book-field="description">' + escapeHtml(book.description) + "</textarea>",
      "  </div>",
      '  <div class="settings-inline-grid">',
      '    <label class="switch-row"><input data-book-field="enabled" type="checkbox"' + (book.enabled ? " checked" : "") + ">启用</label>",
      '    <label><span>范围</span><select data-book-field="scope">' + renderScopeOptions(book.scope) + "</select></label>",
      "  </div>",
      '  <div class="field-group">',
      '    <label>指定目标 ID</label>',
      '    <input data-book-field="targetIds" type="text" value="' + escapeHtml((book.targetIds || []).join(", ")) + '" placeholder="私聊角色ID或群聊ID，留空表示该范围全部生效">',
      "  </div>",
      "  </div>",
      '  <div class="world-book-entry-top">',
      '    <strong>条目</strong>',
      '    <button class="outline-button" type="button" data-world-action="add-entry">新建条目</button>',
      "  </div>",
      '  <div class="world-entry-list">',
      groups.length ? groups.map(function (group) {
        return renderWorldEntryGroup(book, group);
      }).join("") : '<div class="soft-empty">这本世界书还没有条目。</div>',
      "  </div>",
      "</div>"
    ].join("");
  }

  function renderScopeOptions(scope) {
    return [
      '<option value="global"' + (scope === "global" ? " selected" : "") + ">全局</option>",
      '<option value="private"' + (scope === "private" ? " selected" : "") + ">指定私聊</option>",
      '<option value="group"' + (scope === "group" ? " selected" : "") + ">指定群聊</option>"
    ].join("");
  }

  function groupWorldBookEntries(entries) {
    var map = {};

    (entries || []).forEach(function (entry) {
      var groupName = entry.group || "未分组";
      if (!map[groupName]) {
        map[groupName] = [];
      }
      map[groupName].push(entry);
    });

    return Object.keys(map).sort(function (a, b) {
      if (a === "未分组") {
        return -1;
      }
      if (b === "未分组") {
        return 1;
      }
      return a.localeCompare(b, "zh-CN");
    }).map(function (groupName) {
      return {
        name: groupName,
        entries: map[groupName]
      };
    });
  }

  function renderWorldEntryGroup(book, group) {
    return [
      '<section class="world-entry-group">',
      '  <div class="world-entry-group-title">' + escapeHtml(group.name || "未分组") + "（" + group.entries.length + "）</div>",
      group.entries.map(function (entry) {
        return renderWorldBookEntry(book, entry);
      }).join(""),
      "</section>"
    ].join("");
  }

  function renderWorldBookCollapsedGroups(book, groups) {
    if (!groups.length) {
      return '<div class="soft-empty">这本世界书还没有条目。</div>';
    }

    return [
      '<div class="world-entry-list collapsed-entry-list">',
      groups.map(function (group) {
        return [
          '<section class="world-entry-group">',
          '  <div class="world-entry-group-title">' + escapeHtml(group.name || "未分组") + "（" + group.entries.length + "）</div>",
          group.entries.map(function (entry) {
            return renderWorldBookEntry(book, entry, { forceCollapsed: true });
          }).join(""),
          "</section>"
        ].join("");
      }).join(""),
      "</div>"
    ].join("");
  }

  function getWorldEntryUiKey(bookId, entryId) {
    return String(bookId || "") + ":" + String(entryId || "");
  }

  function getWorldEntrySummary(entry) {
    var text = String(entry && (entry.summary || entry.content) || "").replace(/\s+/g, " ").trim();
    return text || "暂无内容";
  }

  function renderInsertPositionOptions(value) {
    var position = value === "after" ? "after" : "before";

    return [
      '<option value="before"' + (position === "before" ? " selected" : "") + ">前</option>",
      '<option value="after"' + (position === "after" ? " selected" : "") + ">后</option>"
    ].join("");
  }

  function renderWorldBookEntry(book, entry, options) {
    var expanded = !options || !options.forceCollapsed
      ? Boolean(expandedWorldEntryIds[getWorldEntryUiKey(book.id, entry.id)])
      : false;
    var summary = getWorldEntrySummary(entry);
    var keywordText = entry.keyword || (entry.keywords || []).join(", ");
    var insertLabel = entry.insertPosition === "after" ? "后" : "前";

    return [
      '<section class="world-entry-card app-fold-card' + (expanded ? " expanded" : "") + '" data-entry-id="' + escapeHtml(entry.id) + '">',
      '  <div class="world-entry-overview">',
      '    <button class="world-entry-title-button" type="button" data-world-action="toggle-entry"><span class="fold-chevron" aria-hidden="true">' + (expanded ? "⌄" : "›") + '</span><strong>' + escapeHtml(entry.title || "未命名条目") + "</strong></button>",
      '    <span class="' + (entry.enabled ? "enabled" : "disabled") + '">' + (entry.enabled ? "启用" : "停用") + "</span>",
      "  </div>",
      '  <p class="world-entry-summary">' + escapeHtml(summary) + "</p>",
      '  <div class="world-book-meta world-entry-tags">',
      '    <span>关键词：' + escapeHtml(keywordText || "无") + "</span>",
      '    <span>插入：' + escapeHtml(insertLabel) + "</span>",
      '    <span>分组：' + escapeHtml(entry.group || "未分组") + "</span>",
      "  </div>",
      '  <div class="world-entry-actions compact">',
      '    <button class="outline-button" type="button" data-world-action="toggle-entry">' + (expanded ? "收起" : "展开") + "</button>",
      '    <button class="outline-button" type="button" data-world-action="toggle-entry">编辑</button>',
      '    <button class="outline-button danger" type="button" data-world-action="delete-entry">删除</button>',
      '    <button class="outline-button" type="button" data-world-action="duplicate-entry">更多</button>',
      "  </div>",
      expanded ? [
      '  <div class="world-entry-detail">',
      '  <div class="settings-inline-grid">',
      '    <label><span>标题</span><input data-entry-field="title" type="text" value="' + escapeHtml(entry.title) + '" maxlength="60"></label>',
      '    <label><span>关键词</span><input data-entry-field="keywords" type="text" value="' + escapeHtml(keywordText) + '" placeholder="学校, 图书馆, 宿舍"></label>',
      "  </div>",
      '  <div class="settings-inline-grid">',
      '    <label><span>插入位置</span><select data-entry-field="insertPosition">' + renderInsertPositionOptions(entry.insertPosition) + "</select></label>",
      '    <label><span>分组</span><input data-entry-field="group" type="text" value="' + escapeHtml(entry.group || "未分组") + '" maxlength="30"></label>',
      "  </div>",
      '  <div class="settings-inline-grid">',
      '    <label><span>优先级</span><input data-entry-field="priority" type="number" value="' + escapeHtml(entry.priority || 0) + '"></label>',
      '    <label class="switch-row"><input data-entry-field="enabled" type="checkbox"' + (entry.enabled ? " checked" : "") + ">启用条目</label>",
      "  </div>",
      '  <div class="field-group">',
      '    <label>摘要</label>',
      '    <input data-entry-field="summary" type="text" value="' + escapeHtml(entry.summary || "") + '" placeholder="留空则从内容自动截断生成">',
      "  </div>",
      '  <div class="field-group">',
      '    <label>内容</label>',
      '    <textarea data-entry-field="content">' + escapeHtml(entry.content) + "</textarea>",
      "  </div>",
      '  <div class="settings-action-row compact-action-row world-entry-actions">',
      '    <button class="outline-button" type="button" data-world-action="entry-up">上移</button>',
      '    <button class="outline-button" type="button" data-world-action="entry-down">下移</button>',
      '    <button class="outline-button" type="button" data-world-action="save-book">保存修改</button>',
      "  </div>",
      "  </div>",
      ].join("") : "",
      "</section>"
    ].join("");
  }

  function bindWorldBookActions(content) {
    content.onclick = function (event) {
      var button = event.target.closest("[data-world-action]");
      var card;
      var bookId;
      var book;

      if (!button) {
        return;
      }

      card = button.closest(".world-book-card");
      bookId = card ? card.dataset.bookId : "";
      book = bookId ? window.AppStorage.getWorldBooks().find(function (item) { return item.id === bookId; }) : null;

      if (button.dataset.worldAction === "create") {
        createWorldBook();
        return;
      }

      if (button.dataset.worldAction === "import-json") {
        getElement("worldBookImportInput").click();
        return;
      }

      if (!book) {
        return;
      }

      if (button.dataset.worldAction === "toggle-book" || button.dataset.worldAction === "edit-book") {
        expandedWorldBookIds[bookId] = !expandedWorldBookIds[bookId];
        renderWorldBookScreen();
        return;
      }

      if (button.dataset.worldAction === "toggle-entry") {
        expandedWorldBookIds[bookId] = true;
        expandedWorldEntryIds[getWorldEntryUiKey(bookId, button.closest(".world-entry-card").dataset.entryId)] = !expandedWorldEntryIds[getWorldEntryUiKey(bookId, button.closest(".world-entry-card").dataset.entryId)];
        renderWorldBookScreen();
        return;
      }

      if (button.dataset.worldAction === "save-book") {
        window.AppStorage.updateWorldBook(bookId, collectWorldBookFromCard(card, book));
        renderWorldBookScreen();
        return;
      }

      if (button.dataset.worldAction === "add-entry") {
        expandedWorldBookIds[bookId] = true;
        window.AppStorage.updateWorldBook(bookId, collectWorldBookFromCard(card, book, {
          addEntry: true
        }));
        renderWorldBookScreen();
        return;
      }

      if (button.dataset.worldAction === "duplicate-book") {
        duplicateWorldBook(card, book);
        return;
      }

      if (button.dataset.worldAction === "export-book") {
        exportWorldBook(collectWorldBookFromCard(card, book));
        return;
      }

      if (button.dataset.worldAction === "duplicate-entry") {
        window.AppStorage.updateWorldBook(bookId, collectWorldBookFromCard(card, book, {
          duplicateEntryId: button.closest(".world-entry-card").dataset.entryId
        }));
        renderWorldBookScreen();
        return;
      }

      if (button.dataset.worldAction === "entry-up" || button.dataset.worldAction === "entry-down") {
        window.AppStorage.updateWorldBook(bookId, collectWorldBookFromCard(card, book, {
          moveEntryId: button.closest(".world-entry-card").dataset.entryId,
          moveDirection: button.dataset.worldAction === "entry-up" ? -1 : 1
        }));
        renderWorldBookScreen();
        return;
      }

      if (button.dataset.worldAction === "delete-entry") {
        window.AppStorage.updateWorldBook(bookId, collectWorldBookFromCard(card, book, {
          deleteEntryId: button.closest(".world-entry-card").dataset.entryId
        }));
        renderWorldBookScreen();
        return;
      }

      if (button.dataset.worldAction === "delete-book" && window.confirm("确定删除这本世界书吗？")) {
        window.AppStorage.deleteWorldBook(bookId);
        delete expandedWorldBookIds[bookId];
        renderWorldBookScreen();
      }
    };
  }

  function collectWorldBookFromCard(card, book, options) {
    var enabledField = card.querySelector("[data-book-field='enabled']");
    var entryCards = Array.prototype.slice.call(card.querySelectorAll(".world-entry-card"));
    var next = {
      name: getScopedFieldValue(card, "[data-book-field='name']") || book.name || "未命名世界书",
      description: getScopedFieldValue(card, "[data-book-field='description']") || book.description || "",
      enabled: enabledField ? Boolean(enabledField.checked) : book.enabled !== false,
      scope: getScopedFieldValue(card, "[data-book-field='scope']") || book.scope || "global",
      targetIds: (getScopedFieldValue(card, "[data-book-field='targetIds']") || (book.targetIds || []).join(", ")).split(/[,，\s]+/).map(function (id) { return id.trim(); }).filter(Boolean),
      entries: []
    };

    if (!entryCards.length) {
      next.entries = (book.entries || []).slice();
    }

    entryCards.forEach(function (entryCard) {
      var existing;
      var enabledEntryField;
      var keywordText;
      var entry;

      if (options && options.deleteEntryId === entryCard.dataset.entryId) {
        return;
      }

      existing = (book.entries || []).find(function (item) { return item.id === entryCard.dataset.entryId; });
      existing = existing || {};
      enabledEntryField = entryCard.querySelector("[data-entry-field='enabled']");
      keywordText = getScopedFieldValue(entryCard, "[data-entry-field='keywords']") || existing.keyword || (existing.keywords || []).join(", ");
      entry = {
        id: entryCard.dataset.entryId,
        title: getScopedFieldValue(entryCard, "[data-entry-field='title']") || existing.title || "未命名条目",
        keyword: keywordText.split(/[,，\s]+/).map(function (keyword) { return keyword.trim(); }).filter(Boolean)[0] || "",
        keywords: keywordText.split(/[,，\s]+/).map(function (keyword) { return keyword.trim(); }).filter(Boolean),
        content: getScopedFieldValue(entryCard, "[data-entry-field='content']") || existing.content || "",
        insertPosition: getScopedFieldValue(entryCard, "[data-entry-field='insertPosition']") === "after" ? "after" : (existing.insertPosition === "after" ? "after" : "before"),
        group: getScopedFieldValue(entryCard, "[data-entry-field='group']") || existing.group || "未分组",
        enabled: enabledEntryField ? Boolean(enabledEntryField.checked) : existing.enabled !== false,
        summary: getScopedFieldValue(entryCard, "[data-entry-field='summary']") || existing.summary || "",
        priority: Number(getScopedFieldValue(entryCard, "[data-entry-field='priority']") || existing.priority) || 0,
        createdAt: existing && existing.createdAt || Date.now(),
        updatedAt: Date.now()
      };
      if (!entry.summary && entry.content) {
        entry.summary = entry.content.replace(/\s+/g, " ").trim().slice(0, 90);
      }
      next.entries.push(entry);

      if (options && options.duplicateEntryId === entryCard.dataset.entryId) {
        next.entries.push(Object.assign({}, entry, {
          id: String(Date.now() + Math.random()),
          title: entry.title + " 副本",
          createdAt: Date.now(),
          updatedAt: Date.now()
        }));
      }
    });

    if (options && options.addEntry) {
      next.entries.push({
        id: String(Date.now()),
        title: "新条目",
        keyword: "",
        keywords: [],
        content: "",
        insertPosition: "before",
        group: "未分组",
        summary: "",
        enabled: true,
        priority: 10,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }

    if (options && options.moveEntryId) {
      moveWorldBookEntry(next.entries, options.moveEntryId, options.moveDirection);
    }

    return next;
  }

  function moveWorldBookEntry(entries, entryId, direction) {
    var index = entries.findIndex(function (entry) {
      return entry.id === entryId;
    });
    var target = index + direction;
    var item;

    if (index === -1 || target < 0 || target >= entries.length) {
      return;
    }

    item = entries[index];
    entries[index] = entries[target];
    entries[target] = item;
  }

  function duplicateWorldBook(card, book) {
    var copy = collectWorldBookFromCard(card, book);
    copy.id = String(Date.now());
    copy.name = copy.name + " 副本";
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    copy.entries = (copy.entries || []).map(function (entry, index) {
      return Object.assign({}, entry, {
        id: String(Date.now() + index + Math.random()),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    });
    window.AppStorage.addWorldBook(copy);
    renderWorldBookScreen();
  }

  function exportWorldBook(book) {
    var json = JSON.stringify(book, null, 2);
    var blob = new Blob([json], { type: "application/json;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");

    link.href = url;
    link.download = "world-book-" + (book.name || "book") + "-" + Date.now() + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 0);
  }

  function importWorldBookFromFile(event) {
    var input = event.target;
    var file = input.files && input.files[0];
    var reader;

    if (!file) {
      return;
    }

    reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result || ""));
        window.AppStorage.addWorldBook(data);
        renderWorldBookScreen();
      } catch (error) {
        window.alert("世界书导入失败，请检查 JSON 文件。");
      } finally {
        input.value = "";
      }
    };
    reader.readAsText(file);
  }

  function openChatWorldBookSelector(targetType, targetId) {
    var type = targetType === "group" ? "group" : "private";
    var id = String(targetId || "");
    var checkedIds = window.AppStorage && window.AppStorage.getChatWorldBookIds
      ? window.AppStorage.getChatWorldBookIds(type, id)
      : [];
    var searchText = "";

    if (!id || !window.AppStorage || !window.AppStorage.getWorldBooks) {
      return;
    }

    function syncCheckedIds(sheet) {
      var inputs = Array.prototype.slice.call(sheet.querySelectorAll("[data-chat-world-book-id]"));
      var visibleIds = inputs.map(function (input) {
        return input.dataset.chatWorldBookId;
      }).filter(Boolean);
      var next = checkedIds.filter(function (id) {
        return visibleIds.indexOf(id) === -1;
      });

      inputs.forEach(function (input) {
        var id = input.dataset.chatWorldBookId;
        if (id && input.checked && next.indexOf(id) === -1) {
          next.push(id);
        }
      });

      checkedIds = next;
    }

    function renderSelectorBody(sheet) {
      var body = sheet.querySelector("#chatWorldBookSelectorBody");
      var counter = sheet.querySelector("#chatWorldBookSelectedCount");
      var notice = sheet.querySelector("#chatWorldBookEmptyNotice");
      var books = window.AppStorage.getWorldBooks().filter(function (book) {
        return book && book.enabled !== false;
      });
      var filtered = filterChatWorldBooks(books, searchText);
      var groups = groupChatWorldBooksByScope(filtered);

      if (counter) {
        counter.textContent = "已选 " + checkedIds.length + " 本";
      }

      if (notice) {
        notice.textContent = checkedIds.length
          ? "AI 只会读取本聊天已勾选的世界书。"
          : "未绑定世界书，AI 不会读取世界书。";
        notice.classList.toggle("is-empty", !checkedIds.length);
      }

      if (!body) {
        return;
      }

      if (!books.length) {
        body.innerHTML = '<div class="soft-empty">还没有启用的世界书。</div>';
        return;
      }

      if (!filtered.length) {
        body.innerHTML = '<div class="soft-empty">没有匹配的世界书。</div>';
        return;
      }

      body.innerHTML = groups.map(function (group) {
        var key = type + ":" + id + ":" + group.key;
        var collapsed = Boolean(collapsedChatWorldBookGroups[key]);

        return [
          '<section class="chat-world-book-group" data-chat-world-group="' + escapeHtml(group.key) + '">',
          '  <button class="chat-world-book-group-head" type="button" data-chat-world-action="toggle-group">',
          '    <span><i aria-hidden="true">' + (collapsed ? "›" : "⌄") + '</i><strong>' + escapeHtml(group.label) + '</strong></span>',
          '    <em>' + group.books.length + " 本</em>",
          "  </button>",
          collapsed ? "" : '<div class="chat-world-book-list">' + group.books.map(function (book) {
            return renderChatWorldBookOption(book, checkedIds);
          }).join("") + "</div>",
          "</section>"
        ].join("");
      }).join("");
    }

    showWeChatSheet([
      '<div class="wechat-sheet-header chat-world-book-header">',
      '  <span></span>',
      "  <h3>当前聊天的世界书</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<div class="wechat-sheet-form chat-world-book-selector">',
      '  <div class="chat-world-book-status">',
      '    <strong id="chatWorldBookSelectedCount">已选 ' + checkedIds.length + " 本</strong>",
      '    <span id="chatWorldBookEmptyNotice" class="' + (checkedIds.length ? "" : "is-empty") + '">' + (checkedIds.length ? "AI 只会读取本聊天已勾选的世界书。" : "未绑定世界书，AI 不会读取世界书。") + "</span>",
      "  </div>",
      '  <label class="wechat-sheet-field chat-world-book-search"><span>搜索</span><input id="chatWorldBookSearchInput" type="search" placeholder="搜索名称、简介、条目或分组" maxlength="40"></label>',
      '  <div id="chatWorldBookSelectorBody" class="chat-world-book-selector-body"></div>',
      '  <div class="wechat-sheet-actions chat-world-book-actions"><button type="button" class="outline-button" data-close-sheet>取消</button><button id="saveChatWorldBooksBtn" type="button" class="full-button">保存</button></div>',
      "</div>"
    ].join(""), function (sheet) {
      var input = sheet.querySelector("#chatWorldBookSearchInput");

      bindSheetCloseButtons(sheet);
      renderSelectorBody(sheet);

      if (input) {
        input.addEventListener("input", function () {
          syncCheckedIds(sheet);
          searchText = input.value.trim().toLowerCase();
          renderSelectorBody(sheet);
          input = sheet.querySelector("#chatWorldBookSearchInput");
          if (input) {
            input.value = searchText;
            input.focus();
          }
        });
      }

      sheet.addEventListener("change", function (event) {
        if (event.target && event.target.matches("[data-chat-world-book-id]")) {
          syncCheckedIds(sheet);
          renderSelectorBody(sheet);
        }
      });

      sheet.addEventListener("click", function (event) {
        var button = event.target.closest("[data-chat-world-action]");
        var section;
        var key;

        if (button && button.dataset.chatWorldAction === "toggle-group") {
          section = button.closest("[data-chat-world-group]");
          key = section ? type + ":" + id + ":" + section.dataset.chatWorldGroup : "";
          if (key) {
            syncCheckedIds(sheet);
            collapsedChatWorldBookGroups[key] = !collapsedChatWorldBookGroups[key];
            renderSelectorBody(sheet);
          }
          return;
        }

        if (event.target && event.target.id === "saveChatWorldBooksBtn") {
          syncCheckedIds(sheet);
          window.AppStorage.setChatWorldBookIds(type, id, checkedIds);
          closeWeChatSheet();
          showToast("世界书绑定已保存");
        }
      });
    });
  }

  function filterChatWorldBooks(books, keyword) {
    var word = String(keyword || "").trim().toLowerCase();

    if (!word) {
      return books;
    }

    return books.filter(function (book) {
      var entries = Array.isArray(book.entries) ? book.entries : [];
      var haystack = [
        book.name,
        book.description,
        getWorldBookScopeLabel(book),
        entries.map(function (entry) {
          return [entry.title, entry.summary, entry.content, entry.group, entry.keyword, (entry.keywords || []).join(" ")].join(" ");
        }).join(" ")
      ].join(" ").toLowerCase();

      return haystack.indexOf(word) !== -1;
    });
  }

  function groupChatWorldBooksByScope(books) {
    var map = {};

    (books || []).forEach(function (book) {
      var key = book.scope || "global";

      if (!map[key]) {
        map[key] = {
          key: key,
          label: key === "global" ? "全局 / all" : (key === "group" ? "群聊范围" : "私聊范围"),
          books: []
        };
      }

      map[key].books.push(book);
    });

    return ["global", "private", "group"].filter(function (key) {
      return map[key];
    }).map(function (key) {
      return map[key];
    });
  }

  function renderChatWorldBookOption(book, checkedIds) {
    var entries = Array.isArray(book.entries) ? book.entries : [];
    var groups = groupWorldBookEntries(entries);
    var checked = checkedIds.indexOf(book.id) !== -1;
    var description = book.description || getWorldBookAutoSummary(book);

    return [
      '<label class="chat-world-book-option' + (checked ? " selected" : "") + '">',
      '  <input type="checkbox" data-chat-world-book-id="' + escapeHtml(book.id) + '"' + (checked ? " checked" : "") + ">",
      '  <span class="chat-world-book-check" aria-hidden="true"></span>',
      '  <span class="chat-world-book-main">',
      '    <strong>' + escapeHtml(book.name || "未命名世界书") + "</strong>",
      '    <em>' + escapeHtml(description || "暂无简介") + "</em>",
      '    <span class="chat-world-book-meta">',
      '      <i>' + entries.length + " 条</i>",
      '      <i>' + escapeHtml(getWorldBookScopeLabel(book)) + "</i>",
      groups.length ? '      <i>' + escapeHtml(groups.map(function (group) { return group.name; }).join(" / ")) + "</i>" : "",
      "    </span>",
      "  </span>",
      "</label>"
    ].join("");
  }

  function applySavedTheme() {
    var saved = window.AppStorage.getTheme ? window.AppStorage.getTheme() : { active: "default" };
    applyTheme(saved.active || "default", false);
  }

  function getThemePreset(themeId) {
    return themePresets.find(function (theme) {
      return theme.id === themeId;
    }) || themePresets[0];
  }

  function applyTheme(themeId, persist) {
    var theme = getThemePreset(themeId);
    var root = document.documentElement;

    currentThemeId = theme.id;
    root.style.setProperty("--bg", theme.bg);
    root.style.setProperty("--surface", theme.surface);
    root.style.setProperty("--surface-soft", theme.id === "dark" ? "#2a312b" : "#edf5f1");
    root.style.setProperty("--text", theme.text);
    root.style.setProperty("--muted", theme.muted);
    root.style.setProperty("--blue", theme.blue);
    root.style.setProperty("--green", theme.green);
    root.style.setProperty("--blue-dark", theme.id === "dark" ? "#a8cbff" : "#2f78bd");
    root.style.setProperty("--green-dark", theme.id === "dark" ? "#a7e0c2" : "#327f67");
    root.dataset.theme = theme.id;

    if (persist !== false && window.AppStorage.saveTheme) {
      window.AppStorage.saveTheme({ active: theme.id });
    }
  }

  function renderThemeScreen() {
    var content = getElement("themeContent");

    if (!content) {
      return;
    }

    content.innerHTML = [
      '<section class="theme-grid">',
      themePresets.map(function (theme) {
        return [
          '<button type="button" class="theme-card' + (currentThemeId === theme.id ? " active" : "") + '" data-theme-id="' + escapeHtml(theme.id) + '">',
          '  <span class="theme-swatch" style="--swatch-bg:' + escapeHtml(theme.bg) + ';--swatch-surface:' + escapeHtml(theme.surface) + ';--swatch-blue:' + escapeHtml(theme.blue) + ';--swatch-green:' + escapeHtml(theme.green) + '"></span>',
          "  <strong>" + escapeHtml(theme.name) + "</strong>",
          "  <em>" + (currentThemeId === theme.id ? "已应用" : "点击预览") + "</em>",
          "</button>"
        ].join("");
      }).join(""),
      "</section>"
    ].join("");

    Array.prototype.forEach.call(content.querySelectorAll("[data-theme-id]"), function (button) {
      button.addEventListener("click", function () {
        applyTheme(button.dataset.themeId, true);
        renderThemeScreen();
      });
    });
  }

  function renderPhotoScreen() {
    var content = getElement("photoContent");
    var photos = window.AppStorage.getPhotos ? window.AppStorage.getPhotos() : [];

    if (!content) {
      return;
    }

    if (!photos.length) {
      content.innerHTML = '<div class="soft-empty">还没有图片，点击右上角导入</div>';
      return;
    }

    content.innerHTML = [
      '<div class="photo-grid">',
      photos.map(function (photo) {
        return [
          '<article class="photo-card" data-photo-id="' + escapeHtml(photo.id) + '">',
          '  <button type="button" data-photo-action="preview"><img src="' + escapeHtml(photo.src) + '" alt="' + escapeHtml(photo.name) + '"></button>',
          '  <div><strong>' + escapeHtml(photo.name) + '</strong><button type="button" data-photo-action="delete">删除</button></div>',
          "</article>"
        ].join("");
      }).join(""),
      "</div>"
    ].join("");

    content.onclick = function (event) {
      var button = event.target.closest("[data-photo-action]");
      var card = button ? button.closest(".photo-card") : null;
      var photo = card ? photos.find(function (item) { return item.id === card.dataset.photoId; }) : null;

      if (!button || !photo) {
        return;
      }

      if (button.dataset.photoAction === "preview") {
        showWeChatSheet([
          '<div class="wechat-sheet-header">',
          '  <span></span>',
          "  <h3>" + escapeHtml(photo.name) + "</h3>",
          '  <button type="button" data-close-sheet>关闭</button>',
          "</div>",
          '<div class="photo-preview-panel"><img src="' + escapeHtml(photo.src) + '" alt="' + escapeHtml(photo.name) + '"></div>'
        ].join(""), bindSheetCloseButtons);
      }

      if (button.dataset.photoAction === "delete" && window.confirm("确定删除这张图片吗？")) {
        window.AppStorage.deletePhoto(photo.id);
        renderPhotoScreen();
      }
    };
  }

  function importPhotoFiles(event) {
    var input = event.target;
    var files = Array.prototype.slice.call(input.files || []);

    if (!files.length || !window.AppStorage.addPhoto) {
      return;
    }

    Promise.all(files.map(function (file) {
      return readFileAsDataUrl(file).then(function (dataUrl) {
        window.AppStorage.addPhoto({
          id: String(Date.now() + Math.random()),
          name: file.name || "图片",
          src: dataUrl,
          createdAt: Date.now()
        });
      });
    })).then(function () {
      input.value = "";
      renderPhotoScreen();
    }).catch(function () {
      input.value = "";
      window.alert("图片导入失败。");
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function createNote() {
    window.AppStorage.addNote({
      id: String(Date.now()),
      title: "新笔记",
      content: "",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    setActivePage("notebookScreen");
  }

  function renderNotebookScreen() {
    var content = getElement("notebookContent");
    var notes = window.AppStorage.getNotes ? window.AppStorage.getNotes() : [];
    var keyword = noteSearchKeyword.toLowerCase();
    var visibleNotes = notes.filter(function (note) {
      return !keyword || [note.title, note.content].join("\n").toLowerCase().indexOf(keyword) !== -1;
    });

    if (!content) {
      return;
    }

    content.innerHTML = [
      '<section class="form-section notebook-search-section">',
      '  <div class="field-group"><label>搜索笔记</label><input data-note-search type="search" value="' + escapeHtml(noteSearchKeyword) + '" placeholder="输入标题或正文"></div>',
      "</section>",
      visibleNotes.length ? [
        '<div class="note-list">',
        visibleNotes.map(renderNoteCard).join(""),
        "</div>"
      ].join("") : '<div class="soft-empty">还没有匹配的笔记</div>'
    ].join("");

    bindNotebookActions(content);
  }

  function renderNoteCard(note) {
    return [
      '<article class="note-card" data-note-id="' + escapeHtml(note.id) + '">',
      '  <input data-note-field="title" type="text" value="' + escapeHtml(note.title) + '" placeholder="标题">',
      '  <textarea data-note-field="content" placeholder="写点什么">' + escapeHtml(note.content) + "</textarea>",
      '  <small>' + escapeHtml(formatDateTime(note.updatedAt || note.createdAt)) + "</small>",
      '  <div class="settings-action-row">',
      '    <button class="outline-button" type="button" data-note-action="save">保存</button>',
      '    <button class="outline-button" type="button" data-note-action="worldbook">写入世界书</button>',
      '    <button class="outline-button" type="button" data-note-action="memory">写入记忆</button>',
      '    <button class="outline-button danger" type="button" data-note-action="delete">删除</button>',
      "  </div>",
      "</article>"
    ].join("");
  }

  function bindNotebookActions(content) {
    var search = content.querySelector("[data-note-search]");

    if (search) {
      search.addEventListener("input", function () {
        noteSearchKeyword = search.value.trim();
        renderNotebookScreen();
      });
    }

    content.onclick = function (event) {
      var button = event.target.closest("[data-note-action]");
      var card = button ? button.closest(".note-card") : null;
      var noteId = card ? card.dataset.noteId : "";
      var note;

      if (!button || !noteId) {
        return;
      }

      note = collectNoteFromCard(card);

      if (button.dataset.noteAction === "save") {
        window.AppStorage.updateNote(noteId, note);
        renderNotebookScreen();
        return;
      }

      if (button.dataset.noteAction === "delete" && window.confirm("确定删除这条笔记吗？")) {
        window.AppStorage.deleteNote(noteId);
        renderNotebookScreen();
        return;
      }

      if (button.dataset.noteAction === "worldbook") {
        writeNoteToWorldBook(note);
        return;
      }

      if (button.dataset.noteAction === "memory") {
        writeNoteToMemory(note);
      }
    };
  }

  function collectNoteFromCard(card) {
    return {
      title: getScopedFieldValue(card, "[data-note-field='title']") || "未命名笔记",
      content: getScopedFieldValue(card, "[data-note-field='content']"),
      updatedAt: Date.now()
    };
  }

  function writeNoteToWorldBook(note) {
    if (!note.content) {
      window.alert("笔记正文为空，暂时不能写入世界书。");
      return;
    }

    window.AppStorage.addWorldBook({
      name: "笔记：" + note.title,
      description: "从记事本写入的资料",
      enabled: true,
      scope: "global",
      targetIds: [],
      entries: [{
        id: String(Date.now()),
        title: note.title,
        keywords: note.title.split(/[,，\s]+/).filter(Boolean),
        content: note.content,
        enabled: true,
        priority: 5,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }]
    });
    window.alert("已写入世界书。");
  }

  function writeNoteToMemory(note) {
    var characters = window.AppStorage.getCharacters();

    if (!note.content || !characters.length) {
      window.alert("没有可写入的正文或角色。");
      return;
    }

    characters.forEach(function (character) {
      window.AppStorage.addCharacterMemory(character.id, {
        content: "用户笔记：" + note.title + " - " + note.content,
        source: "private",
        createdAt: Date.now()
      });
    });
    window.alert("已写入所有角色记忆。");
  }

  function getScopedFieldValue(scope, selector) {
    var field = scope.querySelector(selector);
    return field ? String(field.value || "").trim() : "";
  }

  function openDiaryScreen() {
    var characters = window.AppStorage.getCharacters();
    if (!diaryCharacterId && characters.length) {
      diaryCharacterId = characters[0].id;
    }
    setActivePage("diaryScreen");
  }

  function renderDiaryScreen() {
    var content = getElement("diaryContent");
    var characters = window.AppStorage.getCharacters();

    if (!content) {
      return;
    }

    content.innerHTML = [
      '<div class="segmented-tabs">',
      '  <button class="' + (diaryTab === "character" ? "active" : "") + '" type="button" data-diary-action="tab" data-tab="character">TA 的日记</button>',
      '  <button class="' + (diaryTab === "mine" ? "active" : "") + '" type="button" data-diary-action="tab" data-tab="mine">我的日记</button>',
      "</div>",
      diaryTab === "character" ? renderCharacterDiaryPane(characters) : renderMineDiaryPane()
    ].join("");
    bindDiaryActions(content);
  }

  function renderCharacterDiaryPane(characters) {
    var selected = getCharacterById(diaryCharacterId) || characters[0] || null;
    var diaries = selected ? window.AppStorage.getDiariesByCharacter(selected.id) : [];
    var autoCharacters = characters.filter(function (character) {
      return getCharacterDiarySettings(character).autoDiaryEnabled;
    });
    var selectedDiarySettings = getCharacterDiarySettings(selected);

    if (selected && diaryCharacterId !== selected.id) {
      diaryCharacterId = selected.id;
    }

    return [
      '<section class="form-section diary-book-section">',
      '  <div class="field-group">',
      "    <label>选择角色</label>",
      '    <select data-diary-field="characterId">' + characters.map(function (character) {
        return '<option value="' + escapeHtml(character.id) + '"' + (selected && selected.id === character.id ? " selected" : "") + ">" + escapeHtml(character.name) + "</option>";
      }).join("") + "</select>",
      "  </div>",
      selected ? '<div class="diary-auto-summary"><strong>' + (selectedDiarySettings.autoDiaryEnabled ? "已允许自动写日记" : "未开启自动写日记") + '</strong><span>当前允许自动写日记：' + escapeHtml(autoCharacters.map(function (character) { return character.name; }).join("、") || "暂无") + "</span></div>" : "",
      '  <button class="full-button" type="button" data-diary-action="generate"' + (!selected ? " disabled" : "") + ">生成今日日记</button>",
      "</section>",
      selected ? renderDiaryList(diaries, "character") : '<div class="soft-empty">请先创建角色</div>'
    ].join("");
  }

  function renderMineDiaryPane() {
    var diaries = window.AppStorage.getDiaries().filter(function (diary) {
      return diary.type === "mine";
    });

    return [
      '<section class="form-section diary-book-section">',
      '  <div class="field-group"><label>日期</label><input data-mine-diary-field="date" type="date" value="' + getLocalDateString() + '"></div>',
      '  <div class="field-group"><label>天气</label><input data-mine-diary-field="weather" type="text" placeholder="晴"></div>',
      '  <div class="field-group"><label>标题</label><input data-mine-diary-field="title" type="text" placeholder="今天的小事"></div>',
      '  <div class="field-group"><label>正文</label><textarea data-mine-diary-field="content" placeholder="写下今天想留下的内容"></textarea></div>',
      '  <div class="field-group"><label>今日心情</label><input data-mine-diary-field="mood" type="text" placeholder="平静"></div>',
      '  <div class="field-group"><label>一句话小结</label><input data-mine-diary-field="summary" type="text"></div>',
      '  <label class="switch-row"><input data-mine-diary-field="writeMemory" type="checkbox">写入所有角色记忆</label>',
      '  <button class="full-button" type="button" data-diary-action="save-mine">保存我的日记</button>',
      "</section>",
      renderDiaryList(diaries, "mine")
    ].join("");
  }

  function renderDiaryList(diaries, type) {
    if (!diaries.length) {
      return '<div class="soft-empty">还没有日记</div>';
    }

    return [
      '<div class="diary-list">',
      diaries.map(function (diary) {
        return [
          '<article class="diary-card" data-diary-id="' + escapeHtml(diary.id) + '">',
          '  <div class="diary-date">' + escapeHtml(diary.date) + " · " + escapeHtml(diary.weather || "未记录") + "</div>",
          '  <input data-diary-edit="title" type="text" value="' + escapeHtml(diary.title) + '" placeholder="标题">',
          '  <textarea data-diary-edit="content">' + escapeHtml(diary.content) + "</textarea>",
          '  <div class="settings-inline-grid">',
          '    <label><span>心情</span><input data-diary-edit="mood" type="text" value="' + escapeHtml(diary.mood) + '"></label>',
          '    <label><span>小结</span><input data-diary-edit="summary" type="text" value="' + escapeHtml(diary.summary) + '"></label>',
          "  </div>",
          '  <div class="settings-action-row">',
          '    <button class="outline-button" type="button" data-diary-action="detail">详情</button>',
          '    <button class="outline-button" type="button" data-diary-action="save-diary" data-diary-type="' + type + '">保存</button>',
          '    <button class="outline-button" type="button" data-diary-action="memory">写入记忆</button>',
          '    <button class="outline-button danger" type="button" data-diary-action="delete-diary">删除</button>',
          "  </div>",
          "</article>"
        ].join("");
      }).join(""),
      "</div>"
    ].join("");
  }

  function bindDiaryActions(content) {
    content.onchange = function (event) {
      if (event.target.matches("[data-diary-field='characterId']")) {
        diaryCharacterId = event.target.value;
        renderDiaryScreen();
      }
    };

    content.onclick = function (event) {
      var button = event.target.closest("[data-diary-action]");
      var diaryCard;
      var diaryId;

      if (!button) {
        return;
      }

      if (button.dataset.diaryAction === "tab") {
        diaryTab = button.dataset.tab || "character";
        renderDiaryScreen();
        return;
      }

      if (button.dataset.diaryAction === "generate") {
        generateTodayDiary(button);
        return;
      }

      if (button.dataset.diaryAction === "save-mine") {
        saveMineDiary(content);
        return;
      }

      diaryCard = button.closest(".diary-card");
      diaryId = diaryCard ? diaryCard.dataset.diaryId : "";

      if (button.dataset.diaryAction === "save-diary" && diaryId) {
        window.AppStorage.updateDiary(diaryId, {
          title: getScopedFieldValue(diaryCard, "[data-diary-edit='title']"),
          content: getScopedFieldValue(diaryCard, "[data-diary-edit='content']"),
          mood: getScopedFieldValue(diaryCard, "[data-diary-edit='mood']"),
          summary: getScopedFieldValue(diaryCard, "[data-diary-edit='summary']")
        });
        renderDiaryScreen();
        return;
      }

      if (button.dataset.diaryAction === "detail" && diaryId) {
        openDiaryDetail(diaryId);
        return;
      }

      if (button.dataset.diaryAction === "memory" && diaryId) {
        writeDiaryToMemory(diaryId);
        return;
      }

      if (button.dataset.diaryAction === "delete-diary" && diaryId && window.confirm("确定删除这篇日记吗？")) {
        window.AppStorage.deleteDiary(diaryId);
        renderDiaryScreen();
      }
    };
  }

  function openDiaryDetail(diaryId) {
    var diary = window.AppStorage.getDiaries().find(function (item) {
      return item.id === diaryId;
    });

    if (!diary) {
      return;
    }

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      '  <span></span>',
      "  <h3>日记详情</h3>",
      '  <button type="button" data-close-sheet>关闭</button>',
      "</div>",
      '<article class="diary-detail-book">',
      '  <div class="diary-date">' + escapeHtml(diary.date) + " · " + escapeHtml(diary.weather || "未记录") + "</div>",
      "  <h3>" + escapeHtml(diary.title || "无题") + "</h3>",
      '  <p class="diary-detail-content">' + escapeHtml(diary.content || "暂无正文") + "</p>",
      '  <div class="thought-meta"><span>今日心情：' + escapeHtml(diary.mood || "未记录") + "</span></div>",
      '  <p class="thought-summary">' + escapeHtml(diary.summary || "还没有一句话小结") + "</p>",
      "</article>"
    ].join(""), bindSheetCloseButtons);
  }

  function writeDiaryToMemory(diaryId) {
    var diary = window.AppStorage.getDiaries().find(function (item) {
      return item.id === diaryId;
    });
    var characters = window.AppStorage.getCharacters();

    if (!diary) {
      return;
    }

    if (diary.type === "character" && diary.characterId) {
      window.AppStorage.addCharacterMemory(diary.characterId, {
        content: "日记记忆：" + diary.date + "《" + (diary.title || "无题") + "》" + (diary.summary || diary.content),
        source: "private",
        createdAt: Date.now()
      });
    } else {
      characters.forEach(function (character) {
        window.AppStorage.addCharacterMemory(character.id, {
          content: "我的日记：" + diary.date + "《" + (diary.title || "无题") + "》" + (diary.summary || diary.content),
          source: "private",
          createdAt: Date.now()
        });
      });
    }

    window.alert("已写入记忆。");
  }

  async function generateTodayDiary(button) {
    var character = getCharacterById(diaryCharacterId);
    var today = getLocalDateString();
    var existing = character ? window.AppStorage.getTodayDiary(character.id) : null;
    var diary;

    if (!character) {
      return;
    }

    if (existing && !window.confirm("今天已经有一篇日记了，要重新生成吗？")) {
      return;
    }

    button.disabled = true;
    button.textContent = "生成中";

    try {
      diary = await window.AIService.generateCharacterDiary(character, collectCharacterDiaryContext(character, today));
      diary = Object.assign({}, diary, {
        type: "character",
        characterId: character.id,
        date: today,
        createdAt: existing ? existing.createdAt : Date.now(),
        updatedAt: Date.now()
      });

      if (existing) {
        window.AppStorage.updateDiary(existing.id, diary);
      } else {
        window.AppStorage.addDiary(diary);
      }
    } catch (error) {
      window.alert(error && error.message ? error.message : "日记生成失败");
    } finally {
      button.disabled = false;
      button.textContent = "生成今日日记";
      renderDiaryScreen();
    }
  }

  function collectCharacterDiaryContext(character, date) {
    var diarySettings = getCharacterDiarySettings(character);
    var chatText = window.AppStorage.getChatHistory(character.id).filter(function (message) {
      return formatMessageDate(message.createdAt) === date;
    }).map(function (message) {
      return (message.role === "user" ? "我：" : character.name + "：") + (message.content || "");
    }).join("\n");
    var groupText = window.AppStorage.getGroups().filter(function (group) {
      return (group.memberIds || []).indexOf(character.id) !== -1;
    }).map(function (group) {
      return window.AppStorage.getGroupChatHistory(group.id).filter(function (message) {
        return formatMessageDate(message.createdAt) === date && (message.role === "user" || message.characterId === character.id);
      }).map(function (message) {
        return "群聊《" + group.name + "》" + (message.role === "user" ? "我：" : character.name + "：") + (message.content || "");
      }).join("\n");
    }).join("\n");
    var offlineText = Object.keys(window.AppStorage.getAllOfflineSessions()).map(function (sessionId) {
      var session = window.AppStorage.getAllOfflineSessions()[sessionId];
      return (session.history || []).filter(function (event) {
        return formatMessageDate(event.createdAt) === date && (!event.characterId || event.characterId === character.id || event.role === "user");
      }).map(function (event) {
        return event.content || "";
      }).join("\n");
    }).join("\n");
    var thoughtText = window.AppStorage.getRecentThoughts(character.id, 30).map(function (thought) {
      return "心声：" + thought.content;
    }).join("\n");
    var memoryText = window.AppStorage.getCharacterMemory(character.id).slice(-30).map(function (memory) {
      return "记忆：" + memory.content;
    }).join("\n");

    return {
      date: date,
      chatText: diarySettings.allowUseChatHistory ? chatText : "",
      groupText: diarySettings.allowUseChatHistory ? groupText : "",
      offlineText: diarySettings.allowUseChatHistory ? offlineText : "",
      thoughtText: diarySettings.allowUseThoughts ? thoughtText : "",
      memoryText: memoryText
    };
  }

  function formatMessageDate(timestamp) {
    return getLocalDateString(new Date(timestamp || Date.now()));
  }

  function saveMineDiary(content) {
    var diary = {
      type: "mine",
      characterId: "",
      date: getScopedFieldValue(content, "[data-mine-diary-field='date']") || getLocalDateString(),
      weather: getScopedFieldValue(content, "[data-mine-diary-field='weather']"),
      title: getScopedFieldValue(content, "[data-mine-diary-field='title']") || "我的日记",
      content: getScopedFieldValue(content, "[data-mine-diary-field='content']"),
      mood: getScopedFieldValue(content, "[data-mine-diary-field='mood']"),
      summary: getScopedFieldValue(content, "[data-mine-diary-field='summary']"),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    if (!diary.content) {
      window.alert("先写一点正文吧。");
      return;
    }

    window.AppStorage.addDiary(diary);

    if (content.querySelector("[data-mine-diary-field='writeMemory']").checked) {
      window.AppStorage.getCharacters().forEach(function (character) {
        window.AppStorage.addCharacterMemory(character.id, {
          content: "用户写了一篇日记：" + (diary.summary || diary.title),
          source: "private",
          createdAt: Date.now()
        });
      });
    }

    renderDiaryScreen();
  }

  function openCharacterSpaceScreen(characterId) {
    var characters = window.AppStorage.getCharacters();
    characterSpaceId = characterId || characterSpaceId || (characters[0] && characters[0].id) || "";
    setActivePage("characterSpaceScreen");
  }

  function renderCharacterSpaceScreen() {
    var content = getElement("characterSpaceContent");
    var characters = window.AppStorage.getCharacters();
    var selected = getCharacterById(characterSpaceId) || characters[0] || null;

    if (!content) {
      return;
    }

    if (selected && characterSpaceId !== selected.id) {
      characterSpaceId = selected.id;
    }

    if (!characters.length) {
      content.innerHTML = '<div class="soft-empty">请先创建角色</div>';
      return;
    }

    content.innerHTML = [
      '<section class="form-section">',
      '  <div class="field-group"><label>角色</label><select data-space-field="characterId">' + characters.map(function (character) {
        return '<option value="' + escapeHtml(character.id) + '"' + (selected && selected.id === character.id ? " selected" : "") + ">" + escapeHtml(character.name) + "</option>";
      }).join("") + "</select></div>",
      "</section>",
      renderCharacterSpaceDetail(selected)
    ].join("");
    bindCharacterSpaceActions(content);
  }

  function renderCharacterSpaceDetail(character) {
    var memories = window.AppStorage.getCharacterMemory(character.id);
    var thoughts = window.AppStorage.getCharacterThoughts(character.id);
    var diaries = window.AppStorage.getDiariesByCharacter(character.id);
    var wallet = window.AppStorage.getWallet ? window.AppStorage.getWallet() : { ledger: [], familyCards: [] };
    var relatedLedger = wallet.ledger.filter(function (record) {
      return record.characterId === character.id;
    }).slice(0, 5);
    var familyCards = wallet.familyCards.filter(function (card) {
      return card.targetCharacterId === character.id;
    });
    var groups = window.AppStorage.getGroups().filter(function (group) {
      return (group.memberIds || []).indexOf(character.id) !== -1;
    });

    return [
      '<article class="space-profile-card">',
      renderSmallAvatar(character, "space-avatar"),
      '  <div><h3>' + escapeHtml(character.name) + "</h3><p>" + escapeHtml(buildCharacterPersonaText(character) || "未写人设") + "</p></div>",
      "</article>",
      '<section class="form-section"><div class="section-title-row"><h3>角色资料</h3><span>Profile</span></div>',
      '<p class="space-copy">' + escapeHtml(buildCharacterPersonaText(character) || "暂无人设") + "</p>",
      '<div class="settings-action-row"><button class="outline-button" type="button" data-space-action="open-chat">和 TA 私聊</button><button class="outline-button" type="button" data-space-action="edit-character">编辑角色</button></div></section>',
      '<section class="form-section"><div class="section-title-row"><h3>角色记忆</h3><span>' + memories.length + " 条</span></div>" + renderSimpleList(memories.map(function (memory) { return memory.content; }), "暂无记忆") + '<button class="outline-button danger" type="button" data-space-action="clear-memory">清空记忆</button></section>',
      '<section class="form-section"><div class="section-title-row"><h3>角色心声</h3><span>' + thoughts.length + " 条</span></div>" + renderSimpleList(thoughts.slice(0, 5).map(function (thought) { return thought.visibleSummary || thought.content; }), "暂无心声") + '<div class="settings-action-row"><button class="outline-button" type="button" data-space-action="open-thoughts">查看全部心声</button><button class="outline-button danger" type="button" data-space-action="clear-thoughts">清空心声</button></div></section>',
      '<section class="form-section"><div class="section-title-row"><h3>钱包关联</h3><span>' + relatedLedger.length + " 条账单</span></div>" + renderSimpleList(familyCards.map(function (card) { return card.name + "：剩余 ¥" + formatMoney(Math.max(0, card.totalLimit - card.usedAmount)); }), "未绑定亲属卡") + renderSimpleList(relatedLedger.map(function (record) { return getLedgerTypeName(record.type) + " " + (record.direction === "income" ? "+" : "-") + "¥" + formatMoney(record.amount); }), "暂无相关账单") + "</section>",
      '<section class="form-section"><div class="section-title-row"><h3>角色日记</h3><span>' + diaries.length + " 篇</span></div>" + renderSimpleList(diaries.slice(0, 5).map(function (diary) { return diary.date + " · " + diary.title; }), "暂无日记") + "</section>",
      '<section class="form-section"><div class="section-title-row"><h3>参与群聊</h3><span>' + groups.length + " 个</span></div>" + (groups.length ? '<div class="simple-list">' + groups.map(function (group) { return '<button type="button" data-space-group-id="' + escapeHtml(group.id) + '">' + escapeHtml(group.name) + "</button>"; }).join("") + "</div>" : '<div class="soft-empty">还没有参与群聊</div>') + "</section>"
    ].join("");
  }

  function renderSimpleList(items, emptyText) {
    if (!items.length) {
      return '<div class="soft-empty">' + escapeHtml(emptyText) + "</div>";
    }

    return '<div class="simple-list">' + items.map(function (item) {
      return "<span>" + escapeHtml(item) + "</span>";
    }).join("") + "</div>";
  }

  function bindCharacterSpaceActions(content) {
    content.onchange = function (event) {
      if (event.target.matches("[data-space-field='characterId']")) {
        characterSpaceId = event.target.value;
        renderCharacterSpaceScreen();
      }
    };

    content.onclick = function (event) {
      var button = event.target.closest("[data-space-action]");
      var groupButton = event.target.closest("[data-space-group-id]");

      if (groupButton) {
        window.GroupManager.openGroupChatScreen(groupButton.dataset.spaceGroupId);
        return;
      }

      if (!button || !characterSpaceId) {
        return;
      }

      if (button.dataset.spaceAction === "open-chat") {
        window.CharacterManager.openChatScreen(characterSpaceId);
        return;
      }

      if (button.dataset.spaceAction === "edit-character") {
        window.CharacterManager.openEditCharacterScreen(characterSpaceId);
        return;
      }

      if (button.dataset.spaceAction === "open-thoughts") {
        openThoughtsForCharacter(characterSpaceId, "characterSpaceScreen");
        return;
      }

      if (button.dataset.spaceAction === "clear-memory" && window.confirm("确定清空该角色记忆吗？")) {
        window.AppStorage.resetPrivateCharacterState(characterSpaceId);
        renderCharacterSpaceScreen();
        return;
      }

      if (button.dataset.spaceAction === "clear-thoughts" && window.confirm("确定清空该角色心声吗？")) {
        window.AppStorage.clearCharacterThoughts(characterSpaceId);
        renderCharacterSpaceScreen();
      }
    };
  }

  function openThoughtsForCharacter(characterId, returnPage) {
    var character = getCharacterById(characterId);
    thoughtsReturnPage = returnPage || getActivePage() || "homeScreen";
    renderThoughtsScreen(character ? character.name + "的心声" : "心声", characterId ? [characterId] : [], characterId, "private");
    setActivePage("thoughtsScreen");
  }

  function openThoughtsForGroup(groupId, returnPage) {
    var group = window.AppStorage.getGroups().find(function (item) {
      return item.id === groupId;
    });
    thoughtsReturnPage = returnPage || getActivePage() || "homeScreen";
    renderThoughtsScreen(group ? group.name + " · 成员心声" : "成员心声", group ? group.memberIds || [] : [], groupId, "group");
    setActivePage("thoughtsScreen");
  }

  function renderThoughtsScreen(title, characterIds, chatId, origin) {
    var titleNode = getElement("thoughtsTitle");
    var content = getElement("thoughtsContent");
    var items = [];
    var sourceMap = { private: "私聊", group: "群聊", offline: "线下" };
    var availableMoods;
    var visibleItems;

    if (arguments.length) {
      thoughtsState.title = title || "心声";
      thoughtsState.characterIds = (characterIds || []).slice();
      thoughtsState.chatId = chatId || "";
      thoughtsState.characterFilter = "all";
      thoughtsState.sourceFilter = "all";
      thoughtsState.moodFilter = "all";
      thoughtsState.origin = String(origin || "");
    }

    if (thoughtsState.characterIds.length > 1 && thoughtsState.characterFilter === "all"
      && (String(thoughtsState.origin || "").indexOf("group") === 0 || String(thoughtsState.origin || "").indexOf("offline") === 0)) {
      thoughtsState.characterFilter = thoughtsState.characterIds[0] || "all";
    }

    if (titleNode) {
      titleNode.textContent = thoughtsState.title || "心声";
    }

    if (!content) {
      return;
    }

    (thoughtsState.characterIds || []).forEach(function (characterId) {
      var character = getCharacterById(characterId);
      window.AppStorage.getCharacterThoughts(characterId).forEach(function (thought) {
        if (thoughtsState.chatId && thought.chatId !== thoughtsState.chatId) {
          return;
        }
        items.push(Object.assign({}, thought, {
          characterId: characterId,
          characterName: character ? character.name : "角色"
        }));
      });
    });

    items.sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    availableMoods = Array.from(new Set(items.map(function (thought) {
      return thought.mood || "未记录";
    }))).sort();
    visibleItems = items.filter(function (thought) {
      return (thoughtsState.characterFilter === "all" || thought.characterId === thoughtsState.characterFilter)
        && (thoughtsState.sourceFilter === "all" || thought.source === thoughtsState.sourceFilter)
        && (thoughtsState.moodFilter === "all" || (thought.mood || "未记录") === thoughtsState.moodFilter);
    });

    content.innerHTML = [
      '<section class="thought-filter-bar">',
      '  <label><span>角色</span><select data-thought-filter="character">' + (String(thoughtsState.origin || "").indexOf("group") === 0 || String(thoughtsState.origin || "").indexOf("offline") === 0 ? "" : '<option value="all">全部角色</option>') + (thoughtsState.characterIds || []).map(function (characterId) {
        var character = getCharacterById(characterId);
        return '<option value="' + escapeHtml(characterId) + '"' + (thoughtsState.characterFilter === characterId ? " selected" : "") + ">" + escapeHtml(character ? character.name : "角色") + "</option>";
      }).join("") + "</select></label>",
      '  <label><span>来源</span><select data-thought-filter="source"><option value="all">全部来源</option>' + Object.keys(sourceMap).map(function (source) {
        return '<option value="' + source + '"' + (thoughtsState.sourceFilter === source ? " selected" : "") + ">" + sourceMap[source] + "</option>";
      }).join("") + "</select></label>",
      '  <label><span>情绪</span><select data-thought-filter="mood"><option value="all">全部情绪</option>' + availableMoods.map(function (mood) {
        return '<option value="' + escapeHtml(mood) + '"' + (thoughtsState.moodFilter === mood ? " selected" : "") + ">" + escapeHtml(mood) + "</option>";
      }).join("") + "</select></label>",
      '  <button class="outline-button danger" type="button" data-thought-action="clear-character">清空当前角色心声</button>',
      "</section>",
      visibleItems.length ? visibleItems.map(renderThoughtCard).join("") : '<div class="soft-empty">还没有心声</div>'
    ].join("");
    bindThoughtActions(content);
  }

  function renderThoughtCard(thought) {
    var sourceMap = { private: "私聊", group: "群聊", offline: "线下" };
    return [
      '<article class="thought-card" data-thought-id="' + escapeHtml(thought.id) + '" data-character-id="' + escapeHtml(thought.characterId) + '">',
      '  <div class="thought-card-top"><strong>' + escapeHtml(thought.characterName) + "</strong><span>" + escapeHtml(formatDateTime(thought.createdAt)) + "</span></div>",
      '  <div class="thought-meta"><span>' + escapeHtml(sourceMap[thought.source] || thought.source || "私聊") + "</span><span>" + escapeHtml(thought.mood || "未记录") + "</span></div>",
      thought.visibleSummary ? '  <p class="thought-summary">' + escapeHtml(thought.visibleSummary) + "</p>" : "",
      '  <p class="thought-content">' + escapeHtml(thought.content) + "</p>",
      '  <div class="settings-action-row">',
      '    <button class="outline-button" type="button" data-thought-action="memory">写入记忆</button>',
      '    <button class="outline-button danger" type="button" data-thought-action="delete">删除</button>',
      "  </div>",
      "</article>"
    ].join("");
  }

  function bindThoughtActions(content) {
    content.onchange = function (event) {
      var field = event.target.closest("[data-thought-filter]");
      if (!field) {
        return;
      }

      if (field.dataset.thoughtFilter === "character") {
        thoughtsState.characterFilter = field.value;
        if ((String(thoughtsState.origin || "").indexOf("group") === 0 || String(thoughtsState.origin || "").indexOf("offline") === 0)
          && thoughtsState.characterFilter === "all") {
          thoughtsState.characterFilter = thoughtsState.characterIds[0] || "all";
        }
      }
      if (field.dataset.thoughtFilter === "source") {
        thoughtsState.sourceFilter = field.value;
      }
      if (field.dataset.thoughtFilter === "mood") {
        thoughtsState.moodFilter = field.value;
      }
      renderThoughtsScreen();
    };

    content.onclick = function (event) {
      var button = event.target.closest("[data-thought-action]");
      var card = button ? button.closest(".thought-card") : null;
      var characterId = card ? card.dataset.characterId : "";
      var thoughtId = card ? card.dataset.thoughtId : "";
      var thought;

      if (!button) {
        return;
      }

      if (button.dataset.thoughtAction === "clear-character") {
        characterId = thoughtsState.characterFilter !== "all"
          ? thoughtsState.characterFilter
          : (thoughtsState.characterIds[0] || "");
        if (characterId && window.confirm("确定清空这个角色的心声吗？")) {
          window.AppStorage.clearCharacterThoughts(characterId);
          renderThoughtsScreen();
        }
        return;
      }

      if (!characterId || !thoughtId) {
        return;
      }

      thought = window.AppStorage.getCharacterThoughts(characterId).find(function (item) {
        return item.id === thoughtId;
      });

      if (button.dataset.thoughtAction === "delete" && window.confirm("确定删除这条心声吗？")) {
        window.AppStorage.deleteCharacterThought(characterId, thoughtId);
        renderThoughtsScreen();
        return;
      }

      if (button.dataset.thoughtAction === "memory" && thought) {
        window.AppStorage.addCharacterMemory(characterId, {
          content: "心声写入记忆：" + (thought.visibleSummary || thought.content),
          source: thought.source || "private",
          createdAt: Date.now()
        });
        window.alert("已写入记忆。");
      }
    };
  }

  function clampPercent(value) {
    var number = Number(value);

    if (!Number.isFinite(number)) {
      number = 0;
    }

    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function getThoughtTextBundle(thought) {
    var source = thought || {};
    return [
      source.mood || "",
      source.visibleSummary || "",
      source.summary || "",
      source.content || ""
    ].join(" ");
  }

  function hasAnyKeyword(text, keywords) {
    return keywords.some(function (keyword) {
      return text.indexOf(keyword) !== -1;
    });
  }

  function estimateConcernValue(thought) {
    var text = getThoughtTextBundle(thought);
    var value = 54;

    if (hasAnyKeyword(text, ["在意", "喜欢", "想你", "心动", "担心", "牵挂", "靠近", "舍不得", "吃醋", "嫉妒"])) {
      value += 22;
    }

    if (hasAnyKeyword(text, ["生气", "委屈", "不安", "紧张", "慌", "怕", "难过"])) {
      value += 10;
    }

    if (hasAnyKeyword(text, ["平静", "冷静", "普通", "没事", "无所谓"])) {
      value -= 16;
    }

    if (String(thought && thought.content || "").length > 48) {
      value += 6;
    }

    return clampPercent(value);
  }

  function estimateMoodWaveValue(thought) {
    var text = getThoughtTextBundle(thought);
    var value = 42;

    if (hasAnyKeyword(text, ["生气", "爆炸", "烦", "委屈", "难过", "慌", "不安", "焦虑", "紧张", "乱"])) {
      value += 28;
    }

    if (hasAnyKeyword(text, ["开心", "高兴", "期待", "害羞", "心动", "甜"])) {
      value += 14;
    }

    if (hasAnyKeyword(text, ["平静", "冷静", "安稳", "放松", "普通"])) {
      value -= 18;
    }

    if (String(thought && thought.content || "").length > 80) {
      value += 8;
    }

    return clampPercent(value);
  }

  function formatThoughtModalTime(timestamp) {
    var date = new Date(timestamp || Date.now());
    return (date.getMonth() + 1) + "/" + date.getDate() + " "
      + String(date.getHours()).padStart(2, "0") + ":"
      + String(date.getMinutes()).padStart(2, "0") + " 的内心独白";
  }

  function buildThoughtDisplayData(thought, character) {
    var source = thought || {};
    var speaker = character || {};
    var currentMood = source.mood || source.visibleSummary || "嘴上不说，其实有点在意。";
    var deletedDraft = source.deletedDraft || source.draft || source.visibleSummary || "刚刚差点发出去，又被他/她删掉了。";
    var realThought = source.content || source.visibleSummary || "这条心声还没有写下完整内容。";

    return {
      title: (speaker.name || source.characterName || "角色") + "的心声",
      timeText: formatThoughtModalTime(source.createdAt),
      concernValue: estimateConcernValue(source),
      moodWaveValue: estimateMoodWaveValue(source),
      currentMood: currentMood,
      deletedDraft: deletedDraft,
      realThought: realThought
    };
  }

  function openThoughtsDrawer(options) {
    var source = options || {};
    var characterIds = Array.isArray(source.characterIds) ? source.characterIds.filter(Boolean) : [];
    var chatId = String(source.chatId || "");
    var origin = String(source.origin || "");
    var mask = getElement("thoughtsDrawerMask");

    thoughtsDrawerState = {
      title: source.title || "心声",
      characterIds: characterIds,
      chatId: chatId,
      characterFilter: source.characterFilter || "all",
      mode: source.mode === "history" ? "history" : "latest",
      open: true,
      origin: origin
    };

    if (characterIds.length > 1 && thoughtsDrawerState.characterFilter === "all"
      && (origin.indexOf("group") === 0 || origin.indexOf("offline") === 0)) {
      thoughtsDrawerState.characterFilter = characterIds[0];
    }

    markThoughtsRead(characterIds, chatId);
    renderThoughtsDrawer();

    if (mask) {
      mask.classList.add("thought-modal-mask");
      mask.classList.remove("hidden");
    }

    updateThoughtHeartButtons();
  }

  function closeThoughtsDrawer() {
    var mask = getElement("thoughtsDrawerMask");
    var drawer = getElement("thoughtsDrawer");

    thoughtsDrawerState.open = false;
    thoughtsDrawerState.origin = "";
    thoughtsDrawerState.mode = "latest";

    if (mask) {
      mask.classList.add("hidden");
    }

    if (drawer) {
      drawer.innerHTML = "";
      drawer.className = "thoughts-drawer";
    }

    updateThoughtHeartButtons();
  }

  function renderThoughtsDrawer() {
    var drawer = getElement("thoughtsDrawer");
    var items = collectThoughtDrawerItems();
    var visibleItems = items.filter(function (thought) {
      return thoughtsDrawerState.characterFilter === "all" || thought.characterId === thoughtsDrawerState.characterFilter;
    });

    if (!drawer) {
      return;
    }

    drawer.className = "thought-modal-card" + (thoughtsDrawerState.mode === "history" ? " thought-modal-history" : "");

    if (thoughtsDrawerState.mode === "history") {
      drawer.innerHTML = renderThoughtHistoryModal(items, visibleItems);
      return;
    }

    drawer.innerHTML = renderLatestThoughtModal(items, visibleItems);
  }

  function renderLatestThoughtModal(items, visibleItems) {
    var thought = visibleItems[0] || null;
    var character = thought ? {
      name: thought.characterName,
      avatar: thought.characterAvatar
    } : null;
    var data = buildThoughtDisplayData(thought, character);

    if (!thought) {
      return [
        '<div class="thought-modal-header">',
        '  <div><div class="thought-modal-title" id="thoughtsDrawerTitle"><span aria-hidden="true">♥</span><strong>' + escapeHtml(thoughtsDrawerState.title || "心声") + '</strong></div><p class="thought-modal-subtitle">还没有新的心声</p></div>',
        '  <button class="nav-button thoughts-drawer-close thought-modal-close" type="button" data-thought-drawer-close aria-label="关闭">×</button>',
        "</div>",
        renderThoughtDrawerTabs(items),
        '<div class="thought-modal-empty">还没有新的心声</div>',
        '<div class="thought-modal-footer"><button class="thought-record-button" type="button" data-thought-record>心声记录</button></div>'
      ].join("");
    }

    return [
      '<div class="thought-modal-header">',
      '  <div><div class="thought-modal-title" id="thoughtsDrawerTitle"><span aria-hidden="true">♥</span><strong>' + escapeHtml(data.title) + '</strong></div><p class="thought-modal-subtitle">' + escapeHtml(data.timeText) + '</p></div>',
      '  <button class="nav-button thoughts-drawer-close thought-modal-close" type="button" data-thought-drawer-close aria-label="关闭">×</button>',
      "</div>",
      renderThoughtDrawerTabs(items),
      '<div class="thought-modal-body">',
      '  <section class="thought-status-card" aria-label="心声状态">',
      renderThoughtMeterRow("💗", "在意值", data.concernValue),
      renderThoughtMeterRow("🌙", "情绪波动", data.moodWaveValue),
      "  </section>",
      '  <section class="thought-current-card"><h4>当前心情</h4><p>' + escapeHtml(data.currentMood) + "</p></section>",
      '  <section class="thought-draft-card"><h4>没说出口的话</h4><p>' + escapeHtml(data.deletedDraft) + "</p></section>",
      '  <section class="thought-real-card"><h4>内心真实想法</h4><p>' + escapeHtml(data.realThought) + "</p></section>",
      "</div>",
      '<div class="thought-modal-footer"><button class="thought-record-button" type="button" data-thought-record>心声记录</button><button class="thought-delete-button" type="button" data-thought-delete data-character-id="' + escapeHtml(thought.characterId || "") + '" data-thought-id="' + escapeHtml(thought.id || "") + '">删除</button></div>'
    ].join("");
  }

  function renderThoughtMeterRow(icon, label, value) {
    var percent = clampPercent(value);

    return [
      '<div class="thought-meter-row">',
      '  <span class="thought-meter-label"><i aria-hidden="true">' + icon + '</i><strong>' + escapeHtml(label) + "</strong></span>",
      '  <div class="thought-meter-track" aria-hidden="true"><span class="thought-meter-fill" style="width: ' + percent + '%"></span></div>',
      '  <b>' + percent + "%</b>",
      "</div>"
    ].join("");
  }

  function renderThoughtHistoryModal(items, visibleItems) {
    return [
      '<div class="thought-modal-header">',
      '  <div><div class="thought-modal-title" id="thoughtsDrawerTitle"><span aria-hidden="true">♥</span><strong>心声记录</strong></div><p class="thought-modal-subtitle">' + escapeHtml(thoughtsDrawerState.title || "心声") + " · " + items.length + ' 条</p></div>',
      '  <button class="nav-button thoughts-drawer-close thought-modal-close" type="button" data-thought-drawer-close aria-label="关闭">×</button>',
      "</div>",
      renderThoughtDrawerTabs(items),
      '<div class="thoughts-drawer-list thought-modal-record-list">',
      visibleItems.length ? visibleItems.map(renderThoughtDrawerCard).join("") : '<div class="thoughts-drawer-empty">还没有新的心声</div>',
      "</div>",
      '<div class="thought-modal-footer"><button class="thought-record-button" type="button" data-thought-record>返回最新心声</button></div>'
    ].join("");
  }

  function collectThoughtDrawerItems() {
    var items = [];

    (thoughtsDrawerState.characterIds || []).forEach(function (characterId) {
      var character = getCharacterById(characterId);
      window.AppStorage.getCharacterThoughts(characterId).forEach(function (thought) {
        if (thoughtsDrawerState.chatId && String(thought.chatId || "") !== thoughtsDrawerState.chatId) {
          return;
        }

        items.push(Object.assign({}, thought, {
          characterId: characterId,
          characterName: character ? character.name : "角色",
          characterAvatar: character ? character.avatar : ""
        }));
      });
    });

    return items.sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function renderThoughtDrawerTabs(items) {
    var ids = thoughtsDrawerState.characterIds || [];
    var isGroupOrOffline = String(thoughtsDrawerState.origin || "").indexOf("group") === 0
      || String(thoughtsDrawerState.origin || "").indexOf("offline") === 0;

    if (ids.length <= 1) {
      return '<div class="thoughts-drawer-count">' + items.length + " 条心声</div>";
    }

    return [
      '<div class="thoughts-drawer-tabs" aria-label="按角色筛选心声">',
      isGroupOrOffline ? "" : '<button type="button" data-drawer-character="all" class="' + (thoughtsDrawerState.characterFilter === "all" ? "active" : "") + '">全部</button>',
      ids.map(function (characterId) {
        var character = getCharacterById(characterId);
        return '<button type="button" data-drawer-character="' + escapeHtml(characterId) + '" class="' + (thoughtsDrawerState.characterFilter === characterId ? "active" : "") + '">' + escapeHtml(character ? character.name : "角色") + "</button>";
      }).join(""),
      "</div>"
    ].join("");
  }

  function renderThoughtDrawerCard(thought) {
    var sourceMap = { private: "私聊", group: "群聊", offline: "线下" };
    var character = {
      name: thought.characterName,
      avatar: thought.characterAvatar
    };

    return [
      '<article class="thought-drawer-card" data-character-id="' + escapeHtml(thought.characterId || "") + '" data-thought-id="' + escapeHtml(thought.id || "") + '">',
      '  <div class="thought-drawer-card-head">',
      renderSmallAvatar(character, "thought-drawer-avatar"),
      '    <span><strong>' + escapeHtml(thought.characterName || "角色") + "</strong><em>" + escapeHtml(formatDateTime(thought.createdAt)) + "</em></span>",
      "  </div>",
      '  <div class="thought-drawer-meta"><span>' + escapeHtml(thought.mood || "未记录") + "</span><span>" + escapeHtml(sourceMap[thought.source] || thought.source || "私聊") + "</span></div>",
      thought.visibleSummary ? '  <p class="thought-drawer-summary">' + escapeHtml(thought.visibleSummary) + "</p>" : "",
      '  <p class="thought-drawer-content">' + escapeHtml(thought.content || "") + "</p>",
      '  <button class="thought-card-delete" type="button" data-thought-delete>删除</button>',
      "</article>"
    ].join("");
  }

  function bindThoughtsDrawer() {
    var mask = getElement("thoughtsDrawerMask");

    if (!mask) {
      return;
    }

    mask.addEventListener("click", function (event) {
      var filter = event.target.closest("[data-drawer-character]");
      var recordButton = event.target.closest("[data-thought-record]");
      var deleteButton = event.target.closest("[data-thought-delete]");
      var thoughtCard = deleteButton ? deleteButton.closest("[data-thought-id]") : null;

      if (event.target === mask || event.target.closest("[data-thought-drawer-close]")) {
        closeThoughtsDrawer();
        return;
      }

      if (deleteButton) {
        var deleteCharacterId = deleteButton.dataset.characterId || (thoughtCard && thoughtCard.dataset.characterId) || "";
        var deleteThoughtId = deleteButton.dataset.thoughtId || (thoughtCard && thoughtCard.dataset.thoughtId) || "";
        if (deleteCharacterId && deleteThoughtId && window.confirm("确定删除这条心声吗？")) {
          window.AppStorage.deleteCharacterThought(deleteCharacterId, deleteThoughtId);
          renderThoughtsDrawer();
          updateThoughtHeartButtons();
        }
        return;
      }

      if (recordButton) {
        thoughtsDrawerState.mode = thoughtsDrawerState.mode === "history" ? "latest" : "history";
        renderThoughtsDrawer();
        return;
      }

      if (filter) {
        var nextFilter = filter.dataset.drawerCharacter || "all";
        var isGroupOrOffline = String(thoughtsDrawerState.origin || "").indexOf("group") === 0
          || String(thoughtsDrawerState.origin || "").indexOf("offline") === 0;
        if (!isGroupOrOffline || nextFilter !== "all") {
          thoughtsDrawerState.characterFilter = nextFilter;
          thoughtsDrawerState.mode = "latest";
          renderThoughtsDrawer();
        }
      }
    });
  }

  function markThoughtsRead(characterIds, chatId) {
    if (window.AppStorage && window.AppStorage.markThoughtsRead) {
      window.AppStorage.markThoughtsRead(characterIds || [], chatId || "");
    }
  }

  function getUnreadThoughtCount(characterIds, chatId) {
    if (!window.AppStorage || !window.AppStorage.getUnreadThoughtCount) {
      return 0;
    }

    return window.AppStorage.getUnreadThoughtCount(characterIds || [], chatId || "");
  }

  function updateThoughtButton(buttonId, count, active) {
    var button = getElement(buttonId);
    var badge = button ? button.querySelector(".thought-badge") : null;
    var glyph = button ? button.querySelector(".heart-glyph") : null;
    var unreadCount = Number(count) || 0;
    var settings = window.AppStorage && window.AppStorage.getSettings ? window.AppStorage.getSettings() : {};
    var showBadge = settings.showThoughtUnreadBadge !== false;

    if (!button) {
      return;
    }

    button.classList.toggle("active", Boolean(active));
    button.classList.toggle("has-unread", showBadge && unreadCount > 0);

    if (glyph) {
      glyph.textContent = active ? "♥" : "♡";
    }

    if (badge) {
      badge.textContent = showBadge ? (unreadCount > 99 ? "99+" : String(unreadCount)) : "";
      badge.classList.toggle("hidden", !showBadge || unreadCount <= 0);
    }
  }

  function updateThoughtHeartBadge(buttonId, count, active) {
    updateThoughtButton(buttonId, count, active);
  }

  function updatePrivateThoughtsButton(characterId) {
    var origin = characterId ? "private:" + characterId : "";
    var count = characterId ? getUnreadThoughtCount([characterId], characterId) : 0;
    updateThoughtButton("chatThoughtsHeartBtn", count, thoughtsDrawerState.open && thoughtsDrawerState.origin === origin);
  }

  function updateGroupThoughtsButton(groupId) {
    var group = groupId && window.AppStorage.getGroups ? window.AppStorage.getGroups().find(function (item) {
      return item.id === groupId;
    }) : null;
    var origin = groupId ? "group:" + groupId : "";
    var count = group ? getUnreadThoughtCount(group.memberIds || [], group.id) : 0;
    updateThoughtButton("groupThoughtsHeartBtn", count, thoughtsDrawerState.open && thoughtsDrawerState.origin === origin);
  }

  function updateOfflineThoughtsButton(session) {
    var source = session || {};
    var origin = source.id ? "offline:" + source.id : "";
    var count = source.id ? getUnreadThoughtCount(source.participantIds || [], source.id) : 0;
    updateThoughtButton("offlineThoughtsHeartBtn", count, thoughtsDrawerState.open && thoughtsDrawerState.origin === origin);
  }

  function updateThoughtHeartButtons() {
    if (window.CharacterManager && window.CharacterManager.getActiveCharacterId) {
      updatePrivateThoughtsButton(window.CharacterManager.getActiveCharacterId());
    }

    if (window.GroupManager && window.GroupManager.getActiveGroupId) {
      updateGroupThoughtsButton(window.GroupManager.getActiveGroupId());
    }

    if (window.OfflineManager && window.OfflineManager.getCurrentSession) {
      updateOfflineThoughtsButton(window.OfflineManager.getCurrentSession());
    }
  }

  function openThoughtsDrawerForCharacter(characterId) {
    var character = getCharacterById(characterId);

    if (!characterId) {
      return;
    }

    openThoughtsDrawer({
      title: character ? character.name + "的心声" : "心声",
      characterIds: [characterId],
      chatId: characterId,
      origin: "private:" + characterId
    });
  }

  function openThoughtsDrawerForGroup(groupId) {
    var group = groupId && window.AppStorage.getGroups ? window.AppStorage.getGroups().find(function (item) {
      return item.id === groupId;
    }) : null;

    if (!group) {
      return;
    }

    openThoughtsDrawer({
      title: group.name + " · 成员心声",
      characterIds: group.memberIds || [],
      chatId: group.id,
      origin: "group:" + group.id
    });
  }

  function openThoughtsDrawerForOfflineSession(session) {
    if (!session) {
      return;
    }

    openThoughtsDrawer({
      title: (session.title || "线下模式") + " · 心声",
      characterIds: session.participantIds || [],
      chatId: session.id,
      origin: "offline:" + session.id
    });
  }

  function renderShopScreen() {
    var content = getElement("shopContent");
    var refreshButton = getElement("refreshShopProductsBtn");
    var shop = window.AppStorage.getShop ? window.AppStorage.getShop() : { foodShops: [], mallProducts: [], cart: [], orders: [] };

    if (!content) {
      return;
    }

    if (refreshButton) {
      refreshButton.disabled = shopGenerating;
      refreshButton.textContent = shopGenerating ? "生成中" : "刷新商品";
    }

    content.innerHTML = [
      '<section class="shop-tabs" aria-label="购物分类">',
      renderShopTabButton("food", "外卖"),
      renderShopTabButton("mall", "网购"),
      renderShopTabButton("cart", "购物车" + (shop.cart.length ? " · " + shop.cart.length : "")),
      renderShopTabButton("orders", "订单"),
      "</section>",
      shopGenerating ? '<div class="shop-loading">正在生成商品，请稍等一下。</div>' : "",
      '<section class="shop-panel">',
      renderShopActivePanel(shop),
      "</section>"
    ].join("");

    bindShopActions(content);
    ensureShopProducts();
  }

  function renderShopTabButton(tab, label) {
    return '<button type="button" data-shop-tab="' + tab + '" class="' + (shopTab === tab ? "active" : "") + '">' + escapeHtml(label) + "</button>";
  }

  function renderShopActivePanel(shop) {
    if (shopTab === "mall") {
      return renderShopMall(shop);
    }
    if (shopTab === "cart") {
      return renderShopCart(shop);
    }
    if (shopTab === "orders") {
      return renderShopOrders(shop);
    }
    return renderShopFood(shop);
  }

  function shopHasProducts(shop) {
    return Boolean(shop && ((shop.foodShops || []).length || (shop.mallProducts || []).length));
  }

  function ensureShopProducts() {
    var shop = window.AppStorage.getShop ? window.AppStorage.getShop() : null;

    if (!shopGenerating && !shopHasProducts(shop)) {
      refreshShopProducts(false);
    }
  }

  async function refreshShopProducts(force) {
    var current = window.AppStorage.getShop();
    var generated;
    var next;

    if (shopGenerating || (!force && shopHasProducts(current))) {
      return;
    }

    shopGenerating = true;
    renderShopScreen();

    try {
      if (!window.AIService || !window.AIService.generateShopProducts) {
        throw new Error("AI shop generator unavailable");
      }
      generated = await window.AIService.generateShopProducts();
      if (!isValidGeneratedShop(generated)) {
        throw new Error("Generated shop data is incomplete");
      }
      next = {
        productsGeneratedAt: Date.now(),
        foodShops: generated.foodShops,
        mallProducts: generated.mallProducts,
        cart: force ? [] : current.cart,
        orders: current.orders
      };
    } catch (error) {
      next = window.AppStorage.getDefaultShopProducts();
      next.cart = force ? [] : current.cart;
      next.orders = current.orders;
      showToast("商品生成失败，已先使用默认商品。", true);
    } finally {
      window.AppStorage.saveShop(next);
      shopGenerating = false;
      renderShopScreen();
    }
  }

  function isValidGeneratedShop(shop) {
    var foodCount = shop && Array.isArray(shop.foodShops) ? shop.foodShops.length : 0;
    var mallCount = shop && Array.isArray(shop.mallProducts) ? shop.mallProducts.length : 0;
    var foodOk = foodCount >= 4 && shop.foodShops.every(function (item) {
      return item && Array.isArray(item.products) && item.products.length >= 5;
    });

    return foodOk && mallCount >= 20;
  }

  function renderShopFood(shop) {
    if (!shopHasProducts(shop)) {
      return renderSoftEmpty("购", "商品准备中", "首次进入会自动生成一次商品，失败时会使用默认商品。");
    }

    return (shop.foodShops || []).map(function (foodShop) {
      return [
        '<article class="food-shop-card">',
        '  <div class="shop-section-title"><strong>' + escapeHtml(foodShop.name) + '</strong><em>' + escapeHtml(foodShop.description || "今日可点") + "</em></div>",
        '  <div class="product-grid">',
        (foodShop.products || []).map(function (product) {
          return renderProductCard(product, "food", foodShop.id);
        }).join(""),
        "  </div>",
        "</article>"
      ].join("");
    }).join("");
  }

  function renderShopMall(shop) {
    var categories = getMallCategories(shop.mallProducts || []);
    var products = (shop.mallProducts || []).filter(function (product) {
      return shopMallCategory === "all" || product.category === shopMallCategory;
    });

    if (!shopHasProducts(shop)) {
      return renderSoftEmpty("购", "商品准备中", "首次进入会自动生成一次商品，失败时会使用默认商品。");
    }

    return [
      '<div class="shop-category-row">',
      categories.map(function (category) {
        return '<button type="button" data-shop-category="' + escapeHtml(category) + '" class="' + (shopMallCategory === category ? "active" : "") + '">' + escapeHtml(category === "all" ? "全部" : category) + "</button>";
      }).join(""),
      "</div>",
      '<div class="product-grid">',
      products.map(function (product) {
        return renderProductCard(product, "mall", "");
      }).join(""),
      "</div>"
    ].join("");
  }

  function getMallCategories(products) {
    var seen = { all: true };
    var categories = ["all"];

    (products || []).forEach(function (product) {
      var category = product.category || "生活";
      if (!seen[category]) {
        seen[category] = true;
        categories.push(category);
      }
    });

    return categories;
  }

  function renderProductCard(product, sourceType, shopId) {
    return [
      '<article class="product-card">',
      '  <div class="product-card-main">',
      '    <strong>' + escapeHtml(product.name) + "</strong>",
      '    <p>' + escapeHtml(product.description || "适合小手机日常互动的小物") + "</p>",
      '    <em>' + escapeHtml(product.category || "生活") + "</em>",
      "  </div>",
      '  <div class="product-card-bottom"><span>¥' + escapeHtml(formatMoney(product.price)) + '</span><button type="button" data-shop-add="' + escapeHtml(product.id) + '" data-shop-source="' + escapeHtml(sourceType) + '" data-shop-id="' + escapeHtml(shopId || "") + '">加入</button></div>',
      "</article>"
    ].join("");
  }

  function renderShopCart(shop) {
    var total = getShopCartTotal(shop.cart);
    var cards = window.AppStorage.getFamilyCards ? window.AppStorage.getFamilyCards().filter(function (card) {
      return card.enabled && card.usedAmount < card.totalLimit;
    }) : [];

    if (!shop.cart.length) {
      return renderSoftEmpty("车", "购物车是空的", "去外卖或网购里挑一点喜欢的东西吧。", "去逛外卖", 'data-shop-tab="food"');
    }

    return [
      '<div class="cart-list">',
      shop.cart.map(renderCartItem).join(""),
      "</div>",
      '<section class="cart-checkout">',
      '  <strong>合计 ¥' + escapeHtml(formatMoney(total)) + "</strong>",
      '  <label><span>支付方式</span><select id="shopPayMethod"><option value="wallet">钱包余额</option><option value="familyCard">亲属卡</option></select></label>',
      '  <label><span>亲属卡</span><select id="shopFamilyCardId">' + cards.map(function (card) {
        return '<option value="' + escapeHtml(card.id) + '">' + escapeHtml(card.name) + " · 剩余 ¥" + escapeHtml(formatMoney(card.totalLimit - card.usedAmount)) + "</option>";
      }).join("") + "</select></label>",
      '  <button type="button" class="full-button" data-shop-checkout>结算</button>',
      "</section>"
    ].join("");
  }

  function renderCartItem(item) {
    return [
      '<article class="cart-item">',
      '  <div><strong>' + escapeHtml(item.name) + "</strong><em>¥" + escapeHtml(formatMoney(item.price)) + " × " + escapeHtml(item.quantity) + "</em></div>",
      '  <span>¥' + escapeHtml(formatMoney(item.price * item.quantity)) + "</span>",
      '  <div class="cart-item-actions">',
      '    <button type="button" data-shop-qty="' + escapeHtml(item.id) + '" data-shop-delta="-1">-</button>',
      '    <button type="button" data-shop-qty="' + escapeHtml(item.id) + '" data-shop-delta="1">+</button>',
      '    <button type="button" data-shop-remove="' + escapeHtml(item.id) + '">删除</button>',
      "  </div>",
      "</article>"
    ].join("");
  }

  function renderShopOrders(shop) {
    if (!shop.orders.length) {
      return renderSoftEmpty("单", "还没有订单", "结算成功后，订单会按时间保存在这里。", "去购物车", 'data-shop-tab="cart"');
    }

    return '<div class="order-list">' + shop.orders.map(function (order) {
      return [
        '<article class="order-card">',
        '  <div><strong>¥' + escapeHtml(formatMoney(order.totalAmount)) + "</strong><em>" + escapeHtml(order.payMethod === "familyCard" ? "亲属卡支付" : "余额支付") + "</em></div>",
        '  <p>' + escapeHtml(order.items.map(function (item) { return item.name + "×" + item.quantity; }).join("，")) + "</p>",
        '  <small>' + escapeHtml(formatDateTime(order.createdAt)) + "</small>",
        "</article>"
      ].join("");
    }).join("") + "</div>";
  }

  function bindShopActions(content) {
    Array.prototype.forEach.call(content.querySelectorAll("[data-shop-tab]"), function (button) {
      button.addEventListener("click", function () {
        shopTab = button.dataset.shopTab;
        renderShopScreen();
      });
    });

    Array.prototype.forEach.call(content.querySelectorAll("[data-shop-category]"), function (button) {
      button.addEventListener("click", function () {
        shopMallCategory = button.dataset.shopCategory;
        renderShopScreen();
      });
    });

    Array.prototype.forEach.call(content.querySelectorAll("[data-shop-add]"), function (button) {
      button.addEventListener("click", function () {
        addProductToCart(button.dataset.shopAdd, button.dataset.shopSource, button.dataset.shopId);
      });
    });

    Array.prototype.forEach.call(content.querySelectorAll("[data-shop-qty]"), function (button) {
      button.addEventListener("click", function () {
        updateCartQuantity(button.dataset.shopQty, Number(button.dataset.shopDelta) || 0);
      });
    });

    Array.prototype.forEach.call(content.querySelectorAll("[data-shop-remove]"), function (button) {
      button.addEventListener("click", function () {
        removeCartItem(button.dataset.shopRemove);
      });
    });

    Array.prototype.forEach.call(content.querySelectorAll("[data-shop-checkout]"), function (button) {
      button.addEventListener("click", checkoutShopCart);
    });
  }

  function findShopProduct(productId, sourceType, shopId) {
    var shop = window.AppStorage.getShop();
    var foodShop;

    if (sourceType === "food") {
      foodShop = (shop.foodShops || []).find(function (item) {
        return item.id === shopId;
      });
      return foodShop ? (foodShop.products || []).find(function (product) {
        return product.id === productId;
      }) : null;
    }

    return (shop.mallProducts || []).find(function (product) {
      return product.id === productId;
    }) || null;
  }

  function addProductToCart(productId, sourceType, shopId) {
    var shop = window.AppStorage.getShop();
    var product = findShopProduct(productId, sourceType, shopId);
    var existing;

    if (!product) {
      return;
    }

    existing = shop.cart.find(function (item) {
      return item.productId === product.id && item.sourceType === sourceType && item.shopId === (shopId || "");
    });

    if (existing) {
      existing.quantity = Math.min(99, existing.quantity + 1);
    } else {
      shop.cart.push({
        id: "cart_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        productId: product.id,
        sourceType: sourceType === "food" ? "food" : "mall",
        shopId: shopId || "",
        name: product.name,
        price: product.price,
        quantity: 1
      });
    }

    window.AppStorage.saveShop(shop);
    renderShopScreen();
    showToast("已加入购物车");
  }

  function updateCartQuantity(cartId, delta) {
    var shop = window.AppStorage.getShop();
    shop.cart = shop.cart.map(function (item) {
      if (item.id === cartId) {
        item.quantity = Math.max(1, Math.min(99, item.quantity + delta));
      }
      return item;
    });
    window.AppStorage.saveShop(shop);
    renderShopScreen();
  }

  function removeCartItem(cartId) {
    var shop = window.AppStorage.getShop();
    shop.cart = shop.cart.filter(function (item) {
      return item.id !== cartId;
    });
    window.AppStorage.saveShop(shop);
    renderShopScreen();
  }

  function getShopCartTotal(cart) {
    return (cart || []).reduce(function (sum, item) {
      return sum + Number(item.price || 0) * Number(item.quantity || 1);
    }, 0);
  }

  function checkoutShopCart() {
    var shop = window.AppStorage.getShop();
    var total = Math.round(getShopCartTotal(shop.cart) * 100) / 100;
    var payMethod = getElement("shopPayMethod") ? getElement("shopPayMethod").value : "wallet";
    var familyCardId = getElement("shopFamilyCardId") ? getElement("shopFamilyCardId").value : "";
    var ledger;
    var order;

    if (!shop.cart.length || !total) {
      showToast("购物车是空的。", true);
      return;
    }

    if (payMethod === "familyCard") {
      if (!familyCardId) {
        showToast("没有可用亲属卡。", true);
        return;
      }
      ledger = window.AppStorage.spendFamilyCard(familyCardId, total, {
        sourceType: "shop",
        sourceId: "shop",
        note: "亲属卡购物消费"
      });
      if (!ledger) {
        showToast("亲属卡额度不足。", true);
        return;
      }
    } else {
      ledger = window.AppStorage.addWalletLedger({
        type: "shopping",
        direction: "expense",
        amount: total,
        sourceType: "shop",
        sourceId: "shop",
        note: "购物消费",
        createdAt: Date.now()
      }, {
        preventOverdraft: true
      });
      if (!ledger) {
        showToast("余额不足，请充值或使用亲属卡。", true);
        return;
      }
    }

    order = {
      id: "order_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      items: shop.cart.slice(),
      totalAmount: total,
      payMethod: payMethod === "familyCard" ? "familyCard" : "wallet",
      familyCardId: payMethod === "familyCard" ? familyCardId : "",
      createdAt: Date.now()
    };
    shop.orders.unshift(order);
    shop.cart = [];
    window.AppStorage.saveShop(shop);
    shopTab = "orders";
    renderShopScreen();
    renderWalletScreen();
    showToast("支付成功，订单已生成。");
  }

  function renderWalletScreen() {
    var content = getElement("walletContent");
    var wallet = window.AppStorage.getWallet ? window.AppStorage.getWallet() : { balance: 0, ledger: [], familyCards: [] };
    var profile = window.AppStorage.getUserProfile();
    var activeCards = wallet.familyCards.filter(function (card) {
      return card.enabled;
    });

    if (!content) {
      return;
    }

    content.innerHTML = [
      '<section class="wallet-card">',
      '  <div class="wallet-chip" aria-hidden="true"></div>',
      '  <strong>心屿 PAY</strong>',
      '  <span>账户余额</span>',
      '  <em>¥ ' + escapeHtml(formatMoney(wallet.balance)) + "</em>",
      '  <div><b>' + escapeHtml(profile.name || "林澈") + "</b><i>**** **** **** " + escapeHtml(getWalletCardTail(profile.wxid)) + "</i></div>",
      "</section>",
      '<button id="walletRechargeBtn" class="wallet-recharge-button" type="button"><span>+</span>充值</button>',
      '<section class="wallet-menu-list">',
      '  <button type="button" data-wallet-action="bill"><span>▤</span><strong>账单</strong><em>共 ' + wallet.ledger.length + ' 条记录</em><i>›</i></button>',
      '  <button type="button" data-wallet-action="family"><span>☷</span><strong>亲属卡</strong><em>' + activeCards.length + ' 张有效亲属卡</em><i>›</i></button>',
      "</section>"
    ].join("");

    addClick("walletRechargeBtn", openRechargeSheet);
    Array.prototype.forEach.call(content.querySelectorAll("[data-wallet-action]"), function (button) {
      button.addEventListener("click", function () {
        if (button.dataset.walletAction === "bill") {
          setActivePage("walletBillScreen");
        } else {
          setActivePage("familyCardScreen");
        }
      });
    });
  }

  function getWalletCardTail(seed) {
    var text = String(seed || "0816").replace(/\D/g, "");
    if (text.length < 4) {
      text = (text + "0816").slice(0, 4);
    }
    return text.slice(-4);
  }

  function openRechargeSheet() {
    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>钱包充值</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<form id="walletRechargeForm" class="wechat-sheet-form" autocomplete="off">',
      '  <label class="wechat-sheet-field"><span>充值金额</span><input id="walletRechargeAmount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="请输入金额"></label>',
      '  <label class="wechat-sheet-field"><span>备注</span><input id="walletRechargeNote" type="text" maxlength="40" placeholder="钱包充值"></label>',
      '  <p id="walletRechargeError" class="sheet-error" role="alert"></p>',
      '  <div class="wechat-sheet-actions"><button type="button" class="outline-button" data-close-sheet>取消</button><button type="submit" class="full-button">确认充值</button></div>',
      "</form>"
    ].join(""), function (sheet) {
      var form = sheet.querySelector("#walletRechargeForm");
      bindSheetCloseButtons(sheet);
      form.addEventListener("submit", function (event) {
        var error = sheet.querySelector("#walletRechargeError");
        var amount;
        event.preventDefault();
        try {
          amount = normalizeAmount(sheet.querySelector("#walletRechargeAmount").value);
        } catch (amountError) {
          error.textContent = amountError.message;
          return;
        }
        window.AppStorage.rechargeWallet(amount, sheet.querySelector("#walletRechargeNote").value.trim() || "钱包充值");
        closeWeChatSheet();
        renderWalletScreen();
      });
    });
  }

  function renderWalletBillScreen() {
    var content = getElement("walletBillContent");
    var wallet = window.AppStorage.getWallet ? window.AppStorage.getWallet() : { ledger: [] };
    var records = (wallet.ledger || []).filter(function (record) {
      return walletBillFilter === "all" || record.direction === walletBillFilter;
    });

    if (!content) {
      return;
    }

    content.innerHTML = [
      '<section class="bill-summary"><strong>' + wallet.ledger.length + "</strong><span>条账单记录</span><em>余额 ¥" + escapeHtml(formatMoney(wallet.balance)) + "</em></section>",
      '<section class="bill-filter-row" aria-label="账单筛选">',
      renderBillFilterButton("all", "全部"),
      renderBillFilterButton("income", "收入"),
      renderBillFilterButton("expense", "支出"),
      '  <button type="button" class="bill-clear-button" data-bill-action="clear">清空账单</button>',
      '  <button type="button" class="bill-dedupe-button" data-bill-action="dedupe">修复重复账单</button>',
      "</section>",
      '<section class="bill-list">',
      records.length ? records.map(renderLedgerRecord).join("") : renderSoftEmpty("账", wallet.ledger.length ? "没有符合筛选的账单" : "暂无账单", "红包、转账、充值和购物消费会出现在这里。"),
      "</section>"
    ].join("");

    Array.prototype.forEach.call(content.querySelectorAll("[data-bill-filter]"), function (button) {
      button.addEventListener("click", function () {
        walletBillFilter = button.dataset.billFilter;
        renderWalletBillScreen();
      });
    });

    Array.prototype.forEach.call(content.querySelectorAll("[data-bill-action='clear']"), function (button) {
      button.addEventListener("click", clearWalletLedger);
    });

    Array.prototype.forEach.call(content.querySelectorAll("[data-bill-action='dedupe']"), function (button) {
      button.addEventListener("click", function () {
        if (!window.AppStorage.dedupeWalletLedger) return;
        var result = window.AppStorage.dedupeWalletLedger({ adjustBalance: true });
        renderWalletBillScreen();
        renderWalletScreen();
        showToast("已修复 " + result.removedCount + " 条重复账单，余额已同步修正。");
      });
    });

    Array.prototype.forEach.call(content.querySelectorAll("[data-ledger-action='delete']"), function (button) {
      button.addEventListener("click", function () {
        var id = button.dataset.ledgerId;
        if (!id || !window.AppStorage.deleteWalletLedger) return;
        if (!window.confirm("删除这条账单后会同步修正余额，确定删除吗？")) return;
        window.AppStorage.deleteWalletLedger(id);
        renderWalletBillScreen();
        renderWalletScreen();
        showToast("账单已删除，余额已同步修正。");
      });
    });

    Array.prototype.forEach.call(content.querySelectorAll("[data-ledger-action='edit']"), function (button) {
      button.addEventListener("click", function () {
        var id = button.dataset.ledgerId;
        if (!id) return;
        openLedgerEditSheet(id);
      });
    });
  }

  function openLedgerEditSheet(recordId) {
    if (!window.AppStorage.getWallet || !window.AppStorage.updateWalletLedger) return;
    var wallet = window.AppStorage.getWallet();
    var record = (wallet.ledger || []).find(function (r) { return String(r.id) === String(recordId); });
    if (!record) return;

    var sheet = getElement("ledgerEditSheet");
    if (!sheet) {
      var sheetHtml = [
        '<div id="ledgerEditSheet" class="bottom-sheet" role="dialog" aria-modal="true">',
        '  <div class="bottom-sheet-inner">',
        '    <div class="sheet-handle"></div>',
        '    <div class="sheet-header"><span class="sheet-title">编辑账单</span><button type="button" class="sheet-close-btn" id="ledgerEditSheetClose">✕</button></div>',
        '    <div class="sheet-body">',
        '      <label>方向<select id="ledgerEditDirection"><option value="income">收入</option><option value="expense">支出</option></select></label>',
        '      <label>金额<input type="number" id="ledgerEditAmount" step="0.01" min="0.01"></label>',
        '      <label>备注<input type="text" id="ledgerEditNote" maxlength="100"></label>',
        '    </div>',
        '    <button type="button" class="sheet-save-btn" id="ledgerEditSave">保存</button>',
        '  </div>',
        '</div>'
      ].join("");
      document.body.insertAdjacentHTML("beforeend", sheetHtml);
      sheet = getElement("ledgerEditSheet");
    }

    getElement("ledgerEditDirection").value = record.direction === "expense" ? "expense" : "income";
    getElement("ledgerEditAmount").value = record.amount || "";
    getElement("ledgerEditNote").value = record.note || "";
    sheet.dataset.ledgerId = recordId;
    sheet.classList.add("open");

    getElement("ledgerEditSheetClose").onclick = function () {
      sheet.classList.remove("open");
    };

    getElement("ledgerEditSave").onclick = function () {
      var direction = getElement("ledgerEditDirection").value;
      var amount = parseFloat(getElement("ledgerEditAmount").value);
      var note = getElement("ledgerEditNote").value;
      if (!amount || amount < 0.01) { showToast("请输入有效金额。"); return; }
      window.AppStorage.updateWalletLedger(sheet.dataset.ledgerId, {
        direction: direction,
        amount: amount,
        note: note
      });
      sheet.classList.remove("open");
      renderWalletBillScreen();
      renderWalletScreen();
      showToast("账单已更新，余额已同步修正。");
    };
  }

  function renderBillFilterButton(value, label) {
    return '<button type="button" data-bill-filter="' + escapeHtml(value) + '" class="' + (walletBillFilter === value ? "active" : "") + '">' + escapeHtml(label) + "</button>";
  }

  function clearWalletLedger() {
    var wallet = window.AppStorage.getWallet ? window.AppStorage.getWallet() : null;

    if (!wallet || !wallet.ledger || !wallet.ledger.length) {
      showToast("现在没有账单可清空。");
      return;
    }

    if (!window.confirm("确定清空所有账单吗？系统会按账单记录反向调整余额：收入会扣回，支出会退回。")) {
      return;
    }

    if (!window.confirm("再次确认：清空后无法恢复账单记录。")) {
      return;
    }

    if (window.AppStorage.reverseLedgerEffect) {
      wallet.ledger.forEach(function (record) {
        window.AppStorage.reverseLedgerEffect(wallet, record);
      });
    }
    wallet.ledger = [];
    window.AppStorage.saveWallet(wallet);
    renderWalletBillScreen();
    renderWalletScreen();
    showToast("账单已清空，余额已同步修正。");
  }

  function renderLedgerRecord(record) {
    var income = record.direction === "income";
    var sourceName = getLedgerSourceName(record);
    return [
      '<article class="bill-record ' + (income ? "income" : "expense") + '" data-ledger-id="' + escapeHtml(record.id) + '">',
      '  <span class="bill-icon">' + escapeHtml(getLedgerTypeIcon(record.type)) + "</span>",
      '  <div class="bill-main"><strong>' + escapeHtml(getLedgerTypeName(record.type)) + "</strong><em>" + escapeHtml(sourceName) + (record.note ? " · " + escapeHtml(record.note) : "") + "</em><small>" + escapeHtml(formatDateTime(record.createdAt)) + "</small></div>",
      '  <b>' + (income ? "+" : "-") + "¥" + escapeHtml(formatMoney(record.amount)) + "</b>",
      '  <div class="bill-actions">',
      '    <button type="button" class="bill-edit-btn" data-ledger-action="edit" data-ledger-id="' + escapeHtml(record.id) + '">编辑</button>',
      '    <button type="button" class="bill-delete-btn" data-ledger-action="delete" data-ledger-id="' + escapeHtml(record.id) + '">删除</button>',
      '  </div>',
      "</article>"
    ].join("");
  }

  function getLedgerTypeIcon(type) {
    var map = {
      recharge: "+",
      transfer_in: "转",
      transfer_out: "转",
      transfer_refund: "退",
      transfer_return: "退",
      redpacket_in: "福",
      redpacket_out: "福",
      redpacket_refund: "退",
      redpacket_return: "退",
      familycard_pay: "亲",
      shopping: "购",
      gift: "礼",
      outing: "游",
      system: "账"
    };
    return map[type] || "账";
  }

  function getLedgerTypeName(type) {
    var map = {
      recharge: "充值",
      transfer_in: "收到转账",
      transfer_out: "转账支出",
      transfer_refund: "转账退款",
      transfer_return: "转账退回",
      redpacket_in: "收到红包",
      redpacket_out: "红包支出",
      redpacket_refund: "红包退款",
      redpacket_return: "红包退回",
      familycard_pay: "亲属卡支付",
      shopping: "购物消费",
      gift: "礼物",
      outing: "出去玩消费",
      system: "系统记录"
    };
    return map[type] || type || "账单";
  }

  function getLedgerSourceName(record) {
    var character;
    var group;

    if (record.characterId) {
      character = getCharacterById(record.characterId);
      if (character) {
        return character.name;
      }
    }

    if (record.groupId) {
      group = (window.AppStorage.getGroups ? window.AppStorage.getGroups() : []).find(function (item) {
        return item.id === record.groupId;
      });
      if (group) {
        return group.name;
      }
    }

    if (record.sourceType === "group") {
      return "群聊";
    }

    if (record.sourceType === "offline") {
      return "线下模式";
    }

    if (record.sourceType === "shop") {
      return "购物";
    }

    return "系统";
  }

  function renderFamilyCardScreen() {
    var content = getElement("familyCardContent");
    var cards = window.AppStorage.getFamilyCards ? window.AppStorage.getFamilyCards() : [];

    if (!content) {
      return;
    }

    content.innerHTML = [
      '<section class="family-card-list">',
      cards.length ? cards.map(renderFamilyCard).join("") : '<div class="soft-empty">还没有亲属卡，点右上角新增一张。</div>',
      "</section>"
    ].join("");

    Array.prototype.forEach.call(content.querySelectorAll("[data-family-card-action]"), function (button) {
      button.addEventListener("click", function () {
        var action = button.dataset.familyCardAction;
        var cardId = button.dataset.familyCardId;

        if (action === "edit") {
          openFamilyCardEditor(cardId);
        } else if (action === "delete" && window.confirm("确定删除这张亲属卡吗？")) {
          window.AppStorage.deleteFamilyCard(cardId);
          renderFamilyCardScreen();
        }
      });
    });
  }

  function renderFamilyCard(card) {
    var character = getCharacterById(card.targetCharacterId);
    var left = Math.max(0, Number(card.totalLimit || 0) - Number(card.usedAmount || 0));
    var percent = card.totalLimit ? Math.min(100, Math.round(card.usedAmount / card.totalLimit * 100)) : 0;

    return [
      '<article class="family-card-item ' + (card.enabled ? "" : "disabled") + '">',
      '  <div class="family-card-top"><strong>' + escapeHtml(card.name) + "</strong><span>" + (card.enabled ? "启用中" : "已停用") + "</span></div>",
      '  <p>关联角色：' + escapeHtml(character ? character.name : "未绑定") + "</p>",
      '  <div class="family-progress"><i style="width:' + percent + '%"></i></div>',
      '  <div class="family-card-meta"><span>总额度 ¥' + escapeHtml(formatMoney(card.totalLimit)) + "</span><span>已用 ¥" + escapeHtml(formatMoney(card.usedAmount)) + "</span><span>剩余 ¥" + escapeHtml(formatMoney(left)) + "</span></div>",
      '  <div class="settings-action-row"><button class="outline-button" type="button" data-family-card-action="edit" data-family-card-id="' + escapeHtml(card.id) + '">修改额度</button><button class="outline-button danger" type="button" data-family-card-action="delete" data-family-card-id="' + escapeHtml(card.id) + '">删除</button></div>',
      "</article>"
    ].join("");
  }

  function openFamilyCardEditor(cardId) {
    var card = cardId && window.AppStorage.getFamilyCardById ? window.AppStorage.getFamilyCardById(cardId) : null;
    var characters = window.AppStorage.getCharacters();

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      "  <h3>" + (card ? "修改亲属卡" : "新增亲属卡") + "</h3>",
      '  <button type="button" data-close-sheet>取消</button>',
      "</div>",
      '<form id="familyCardForm" class="wechat-sheet-form" autocomplete="off">',
      '  <label class="wechat-sheet-field"><span>卡名</span><input id="familyCardName" type="text" maxlength="24" value="' + escapeHtml(card ? card.name : "亲属卡") + '"></label>',
      '  <label class="wechat-sheet-field"><span>关联角色</span><select id="familyCardCharacter">' + characters.map(function (character) {
        return '<option value="' + escapeHtml(character.id) + '"' + (card && card.targetCharacterId === character.id ? " selected" : "") + ">" + escapeHtml(character.name || "未命名角色") + "</option>";
      }).join("") + "</select></label>",
      '  <label class="wechat-sheet-field"><span>总额度</span><input id="familyCardLimit" type="number" inputmode="decimal" step="0.01" min="0" value="' + escapeHtml(card ? card.totalLimit : 1000) + '"></label>',
      '  <label class="switch-row family-sheet-switch"><input id="familyCardEnabled" type="checkbox"' + (!card || card.enabled ? " checked" : "") + '>启用亲属卡</label>',
      '  <p id="familyCardError" class="sheet-error" role="alert"></p>',
      '  <div class="wechat-sheet-actions"><button type="button" class="outline-button" data-close-sheet>取消</button><button type="submit" class="full-button">保存</button></div>',
      "</form>"
    ].join(""), function (sheet) {
      var form = sheet.querySelector("#familyCardForm");
      bindSheetCloseButtons(sheet);
      form.addEventListener("submit", function (event) {
        var error = sheet.querySelector("#familyCardError");
        var totalLimit = Number(sheet.querySelector("#familyCardLimit").value);
        event.preventDefault();

        if (!characters.length) {
          error.textContent = "请先创建角色。";
          return;
        }

        if (!totalLimit || totalLimit <= 0) {
          error.textContent = "请输入有效额度。";
          return;
        }

        if (card) {
          window.AppStorage.updateFamilyCard(card.id, {
            name: sheet.querySelector("#familyCardName").value.trim() || "亲属卡",
            targetCharacterId: sheet.querySelector("#familyCardCharacter").value,
            totalLimit: totalLimit,
            enabled: sheet.querySelector("#familyCardEnabled").checked
          });
        } else {
          window.AppStorage.addFamilyCard({
            name: sheet.querySelector("#familyCardName").value.trim() || "亲属卡",
            targetCharacterId: sheet.querySelector("#familyCardCharacter").value,
            totalLimit: totalLimit,
            enabled: sheet.querySelector("#familyCardEnabled").checked
          });
        }

        closeWeChatSheet();
        renderFamilyCardScreen();
      });
    });
  }

  function loadSettingsIntoForm() {
    var settings = window.AppStorage.getSettings();
    var savedTip = getElement("settingsSavedTip");

    renderApiProfileSelect(settings);
    getElement("apiProfileName").value = settings.activeApiProfile.name || "";
    getElement("apiUrl").value = settings.apiUrl;
    getElement("apiKey").value = settings.apiKey;
    getElement("modelName").value = settings.modelName;
    getElement("apiTemperature").value = settings.temperature;
    getElement("autoMemorySummaryEnabled").checked = settings.autoMemorySummaryEnabled !== false;
    getElement("autoMemorySummaryRounds").value = String(settings.autoMemorySummaryRounds || 10);
    getElement("bodyStateEnabled").checked = settings.bodyStateEnabled !== false;
    getElement("showThoughtUnreadBadge").checked = settings.showThoughtUnreadBadge !== false;

    if (savedTip) {
      savedTip.textContent = "";
      savedTip.classList.remove("error");
    }
  }

  function renderApiProfileSelect(settings) {
    var select = getElement("apiProfileSelect");
    var current = settings || window.AppStorage.getSettings();

    if (!select) {
      return;
    }

    select.innerHTML = current.apiProfiles.map(function (profile) {
      return '<option value="' + escapeHtml(profile.id) + '"' + (profile.id === current.activeApiProfileId ? " selected" : "") + ">" + escapeHtml(profile.name || "API 预设") + "</option>";
    }).join("");
  }

  function saveSettingsFromForm() {
    window.AppStorage.saveSettings(getSettingsFromForm());
    loadSettingsIntoForm();
    showSettingsTip("设置已保存");
  }

  function getSettingsFromForm() {
    var current = window.AppStorage.getSettings();
    var activeId = getElement("apiProfileSelect").value || current.activeApiProfileId;
    var profiles = current.apiProfiles.map(function (profile) {
      if (profile.id !== activeId) {
        return profile;
      }

      return Object.assign({}, profile, {
        name: getElement("apiProfileName").value.trim() || "API 预设",
        apiUrl: getElement("apiUrl").value.trim(),
        apiKey: getElement("apiKey").value.trim(),
        modelName: getElement("modelName").value.trim(),
        temperature: normalizeTemperatureInput(getElement("apiTemperature").value),
        updatedAt: Date.now()
      });
    });

    return {
      activeApiProfileId: activeId,
      apiProfiles: profiles,
      apiUrl: getElement("apiUrl").value.trim(),
      apiKey: getElement("apiKey").value.trim(),
      modelName: getElement("modelName").value.trim(),
      temperature: normalizeTemperatureInput(getElement("apiTemperature").value),
      autoMemorySummaryEnabled: getElement("autoMemorySummaryEnabled").checked,
      autoMemorySummaryRounds: Math.max(5, Math.min(50, Number(getElement("autoMemorySummaryRounds").value) || 10)),
      bodyStateEnabled: getElement("bodyStateEnabled").checked,
      showThoughtUnreadBadge: getElement("showThoughtUnreadBadge").checked
    };
  }

  function normalizeTemperatureInput(value) {
    var temperature = Number(value);

    if (!Number.isFinite(temperature)) {
      return 0.8;
    }

    return Math.max(0, Math.min(2, Math.round(temperature * 100) / 100));
  }

  function switchApiProfile(profileId) {
    var current = window.AppStorage.getSettings();
    var settings;
    var profile;

    settings = {
      activeApiProfileId: profileId,
      autoMemorySummaryEnabled: current.autoMemorySummaryEnabled !== false,
      autoMemorySummaryRounds: current.autoMemorySummaryRounds || 10,
      bodyStateEnabled: current.bodyStateEnabled !== false,
      showThoughtUnreadBadge: current.showThoughtUnreadBadge !== false,
      apiProfiles: current.apiProfiles.map(function (item) {
        if (item.id !== current.activeApiProfileId) {
          return item;
        }
        return Object.assign({}, item, {
          name: getElement("apiProfileName").value.trim() || "API 预设",
          apiUrl: getElement("apiUrl").value.trim(),
          apiKey: getElement("apiKey").value.trim(),
          modelName: getElement("modelName").value.trim(),
          temperature: normalizeTemperatureInput(getElement("apiTemperature").value),
          updatedAt: Date.now()
        });
      })
    };

    profile = settings.apiProfiles.find(function (item) {
      return item.id === profileId;
    });

    if (!profile) {
      return;
    }

    window.AppStorage.saveSettings(settings);
    loadSettingsIntoForm();
    showModelFetchTip("");
  }

  function createApiProfile() {
    var settings = getSettingsFromForm();
    var now = Date.now();
    var profile = {
      id: "api_" + now + "_" + Math.random().toString(36).slice(2, 7),
      name: "新预设",
      apiUrl: "",
      apiKey: "",
      modelName: "",
      temperature: 0.8,
      createdAt: now,
      updatedAt: now
    };

    settings.apiProfiles.push(profile);
    settings.activeApiProfileId = profile.id;
    window.AppStorage.saveSettings(settings);
    loadSettingsIntoForm();
    showSettingsTip("已新增 API 预设");
  }

  function deleteActiveApiProfile() {
    var current = window.AppStorage.getSettings();
    var activeId = current.activeApiProfileId;
    var profiles;

    if (current.apiProfiles.length <= 1) {
      showSettingsTip("至少保留一个 API 预设", true);
      return;
    }

    if (!window.confirm("确定删除当前 API 预设吗？")) {
      return;
    }

    profiles = current.apiProfiles.filter(function (profile) {
      return profile.id !== activeId;
    });
    window.AppStorage.saveSettings({
      activeApiProfileId: profiles[0].id,
      apiProfiles: profiles,
      autoMemorySummaryEnabled: current.autoMemorySummaryEnabled !== false,
      autoMemorySummaryRounds: current.autoMemorySummaryRounds || 10,
      bodyStateEnabled: current.bodyStateEnabled !== false,
      showThoughtUnreadBadge: current.showThoughtUnreadBadge !== false
    });
    loadSettingsIntoForm();
    showSettingsTip("已删除 API 预设");
  }

  async function fetchModelsFromSettings() {
    var button = getElement("fetchModelsBtn");
    var listBox = getElement("modelListBox");
    var settings = getSettingsFromForm();
    var models;

    window.AppStorage.saveSettings(settings);

    if (button) {
      button.disabled = true;
      button.textContent = "拉取中";
    }

    if (listBox) {
      listBox.classList.add("hidden");
      listBox.innerHTML = "";
    }

    showModelFetchTip("正在拉取模型列表...");

    try {
      models = await window.AIService.fetchModels(settings.apiUrl, settings.apiKey);
      renderModelList(models);
      showModelFetchTip("成功拉取 " + models.length + " 个模型");
    } catch (error) {
      showModelFetchTip("拉取失败：" + (error && error.message ? error.message : "未知错误"), true);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "拉取模型列表";
      }
    }
  }

  function renderModelList(models) {
    var listBox = getElement("modelListBox");
    var selectedModel = getElement("modelName").value.trim();

    if (!listBox) {
      return;
    }

    listBox.innerHTML = "";

    models.forEach(function (model) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "model-item" + (model.id === selectedModel ? " active" : "");
      button.dataset.modelId = model.id;
      button.innerHTML = "<span>" + escapeHtml(model.id) + "</span>";
      button.addEventListener("click", function () {
        selectModel(model.id);
      });
      listBox.appendChild(button);
    });

    listBox.classList.toggle("hidden", models.length === 0);
  }

  function selectModel(modelId) {
    var items = document.querySelectorAll(".model-item");

    getElement("modelName").value = modelId;
    window.AppStorage.saveSettings(getSettingsFromForm());

    Array.prototype.forEach.call(items, function (item) {
      item.classList.toggle("active", item.dataset.modelId === modelId);
    });

    showModelFetchTip("已选择模型：" + modelId);
  }

  function showModelFetchTip(message, isError) {
    var tip = getElement("modelFetchTip");

    if (!tip) {
      return;
    }

    tip.textContent = message || "";
    tip.classList.toggle("error", Boolean(isError));
  }

  function exportAllData() {
    var backup = window.AppStorage.exportAllData();
    var json = JSON.stringify(backup, null, 2);
    var blob = new Blob([json], { type: "application/json;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");

    link.href = url;
    link.download = "xinyu-backup-" + Date.now() + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 0);

    showSettingsTip("全部数据已导出");
  }

  function importDataFromFile(event) {
    var input = event.target;
    var file = input.files && input.files[0];
    var reader;

    if (!file) {
      return;
    }

    reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result || ""));
        window.AppStorage.importAllData(data);
        window.CharacterManager.resetState();
        window.CharacterManager.renderCharacterList();
        window.GroupManager.renderGroupList();
        renderWechatScreen();
        renderThemeScreen();
        renderPhotoScreen();
        renderNotebookScreen();
        renderCharacterSpaceScreen();
        refreshHomeSummary();
        applySavedTheme();
        loadSettingsIntoForm();
        resumeAppApiJobsWhenReady();
        showSettingsTip("数据导入成功");
      } catch (error) {
        showSettingsTip(error.message || "导入失败，请检查 JSON 文件格式", true);
      } finally {
        input.value = "";
      }
    };
    reader.onerror = function () {
      showSettingsTip("读取文件失败，请重新选择", true);
      input.value = "";
    };
    reader.readAsText(file);
  }

  function importCharacterFromFile(event) {
    var input = event.target;
    var file = input.files && input.files[0];
    var reader;

    if (!file) {
      return;
    }

    reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result || ""));
        var source = Array.isArray(data) ? data[0] : (data.character || data);
        var now = Date.now();
        var character;

        if (!source || typeof source !== "object" || !String(source.name || "").trim()) {
          throw new Error("没有找到可导入的角色名称。");
        }

        character = {
          id: "character_" + now + "_" + Math.random().toString(36).slice(2, 8),
          name: String(source.name || "").trim(),
          avatar: String(source.avatar || ""),
          gender: String(source.gender || "未设定"),
          identity: String(source.identity || ""),
          personality: String(source.personality || ""),
          background: String(source.background || ""),
          speakingStyle: String(source.speakingStyle || ""),
          relationship: String(source.relationship || ""),
          openingMessage: String(source.openingMessage || ""),
          chatSettings: source.chatSettings && typeof source.chatSettings === "object" ? source.chatSettings : {},
          createdAt: now
        };

        window.AppStorage.addCharacter(character);
        window.CharacterManager.renderCharacterList();
        renderWechatScreen();
        refreshHomeSummary();
        window.alert("已导入角色：" + character.name);
      } catch (error) {
        window.alert(error.message || "导入角色失败，请检查 JSON 文件。");
      } finally {
        input.value = "";
      }
    };
    reader.onerror = function () {
      window.alert("读取角色文件失败，请重新选择。");
      input.value = "";
    };
    reader.readAsText(file);
  }

  function clearAllData() {
    if (!window.confirm("确定要清空全部数据吗？")) {
      return;
    }

    if (!window.confirm("请再次确认：清空后无法恢复。")) {
      return;
    }

    window.AppStorage.clearAllData();
    window.CharacterManager.resetState();
    window.CharacterManager.renderCharacterList();
    window.GroupManager.renderGroupList();
    loadSettingsIntoForm();
    refreshHomeSummary();
    setActivePage("homeScreen");
    resumeAppApiJobsWhenReady();
  }

  function showSettingsTip(message, isError) {
    var savedTip = getElement("settingsSavedTip");

    if (!savedTip) {
      return;
    }

    savedTip.textContent = message;
    savedTip.classList.toggle("error", Boolean(isError));
    window.clearTimeout(showSettingsTip.tipTimer);
    showSettingsTip.tipTimer = window.setTimeout(function () {
      savedTip.textContent = "";
      savedTip.classList.remove("error");
    }, 2200);
  }

  function areAppApiJobHandlersReady() {
    var requiredHandlers = [
      ["private", "chat"],
      ["private", "inlineOffline"],
      ["private", "regenerate"],
      ["private", "blockReaction"],
      ["group", "chat"],
      ["group", "inlineOffline"],
      ["group", "regenerate"],
      ["offline", "offline"]
    ];

    if (!window.AppApiJobs || !window.AppApiJobs.resumeInterruptedJobs) {
      return false;
    }

    if (!window.CharacterManager || !window.GroupManager || !window.OfflineManager) {
      return false;
    }

    if (!window.AppApiJobs.hasHandler) {
      return true;
    }

    return requiredHandlers.every(function (item) {
      return window.AppApiJobs.hasHandler(item[0], item[1]);
    });
  }

  function resumeAppApiJobsWhenReady(attempt) {
    var retry = Number(attempt) || 0;

    window.clearTimeout(apiJobResumeRetryTimer);

    if (areAppApiJobHandlersReady()) {
      window.AppApiJobs.resumeInterruptedJobs();
      return;
    }

    if (retry < 12) {
      apiJobResumeRetryTimer = window.setTimeout(function () {
        resumeAppApiJobsWhenReady(retry + 1);
      }, 50);
    }
  }

  function summarizeMessageForMemorySource(message, participants) {
    var source = message || {};
    var role = String(source.role || "").toLowerCase();
    var type = String(source.type || "").toLowerCase();
    var name = "";

    if (role === "user" || type === "user" || type === "offlineuseraction") {
      name = "用户";
    } else if (source.characterName) {
      name = source.characterName;
    } else if (source.characterId && participants && participants[source.characterId]) {
      name = participants[source.characterId];
    } else if (role === "character" || role === "assistant") {
      name = "角色";
    } else {
      name = "系统";
    }

    if (type === "redPacket") {
      return name + "：[红包] " + (source.content || source.note || "");
    }
    if (type === "transfer") {
      return name + "：[转账] " + (source.amount ? "¥" + source.amount : "") + " " + (source.content || source.note || "");
    }
    if (type === "image") {
      return name + "：[图片] " + ((source.image && (source.image.description || source.image.name)) || source.content || "");
    }
    if (type === "voice") {
      return name + "：[语音] " + ((source.voice && source.voice.text) || source.content || "");
    }
    if (type === "location") {
      return name + "：[位置] " + ((source.location && source.location.name) || source.content || "");
    }
    if (type === "offlineAction") {
      return "旁白：" + (source.content || "");
    }
    if (type === "offlineSpeech") {
      return name + "：" + (source.content || "");
    }

    return name + "：" + (source.content || "");
  }

  function buildMemorySummarySourceText(targetType, targetId, rounds) {
    var limitRounds = Math.max(5, Math.min(50, Number(rounds) || 20));
    var history = [];
    var participants = {};
    var result = [];
    var userTurns = 0;
    var index;
    var group;
    var characters;
    var session;

    if (targetType === "group" && window.AppStorage.getGroupChatHistory) {
      history = window.AppStorage.getGroupChatHistory(targetId) || [];
      if (window.AppStorage.getGroups && window.AppStorage.getCharacters) {
        group = (window.AppStorage.getGroups() || []).find(function (item) {
          return item && item.id === targetId;
        });
        characters = window.AppStorage.getCharacters() || [];
        if (group && Array.isArray(group.memberIds)) {
          group.memberIds.forEach(function (memberId) {
            var c = characters.find(function (item) { return item && item.id === memberId; });
            if (c) {
              participants[memberId] = c.name || "角色";
            }
          });
        }
      }
    } else if (targetType === "private" && window.AppStorage.getChatHistory) {
      history = window.AppStorage.getChatHistory(targetId) || [];
      if (window.AppStorage.getCharacters) {
        var character = (window.AppStorage.getCharacters() || []).find(function (item) {
          return item && item.id === targetId;
        });
        if (character) {
          participants[targetId] = character.name || "角色";
        }
      }
    } else if (targetType === "offline" && window.AppStorage.getOfflineSession) {
      session = window.AppStorage.getOfflineSession(targetId);
      history = session && Array.isArray(session.history) ? session.history
        : (session && Array.isArray(session.messages) ? session.messages : []);
    }

    history = history.filter(function (message) {
      return message
        && message.content
        && message.type !== "loading"
        && message.type !== "error"
        && message.type !== "system"
        && message.role !== "system";
    });

    for (index = history.length - 1; index >= 0; index -= 1) {
      var message = history[index];
      result.unshift(message);

      var messageType = String(message.type || "").toLowerCase();
      if (message.role === "user" || messageType === "user" || messageType === "offlineuseraction") {
        userTurns += 1;
        if (userTurns >= limitRounds) {
          break;
        }
      }
    }

    return result.map(function (message, i) {
      return (i + 1) + ". " + summarizeMessageForMemorySource(message, participants);
    }).join("\n");
  }

  // ── 连续记忆包 ──────────────────────────────────────────────────────────────

  function getHistoryForMemoryContext(targetType, targetId) {
    if (targetType === "group" && window.AppStorage.getGroupChatHistory) {
      return window.AppStorage.getGroupChatHistory(targetId) || [];
    }
    if (targetType === "offline" && window.AppStorage.getOfflineSession) {
      var session = window.AppStorage.getOfflineSession(targetId);
      return session && Array.isArray(session.history) ? session.history : [];
    }
    if (window.AppStorage.getChatHistory) {
      return window.AppStorage.getChatHistory(targetId) || [];
    }
    return [];
  }

  function filterMemoryContextMessages(history) {
    return (Array.isArray(history) ? history : []).filter(function (message) {
      return message
        && message.content
        && message.type !== "loading"
        && message.type !== "error"
        && message.type !== "system"
        && message.role !== "system"
        && message.type !== "pat";
    });
  }

  function getMediumRangeMessagesByUserTurns(history, maxUserTurns) {
    var result = [];
    var userTurns = 0;
    var index;

    for (index = history.length - 1; index >= 0; index -= 1) {
      result.unshift(history[index]);
      if (history[index].role === "user" || history[index].type === "user" || history[index].type === "offlineUserAction") {
        userTurns += 1;
        if (userTurns >= maxUserTurns) {
          break;
        }
      }
    }

    return result;
  }

  function extractRecallKeywords(text) {
    var compact = String(text || "").replace(/\s+/g, "");
    var matches = compact.match(/[一-龥A-Za-z0-9_]{2,12}/g) || [];
    var stop = {
      "什么": true, "为什么": true, "怎么": true, "这个": true, "那个": true,
      "就是": true, "然后": true, "所以": true, "但是": true, "不是": true,
      "知道": true, "记得": true
    };
    return matches.filter(function (word) {
      return word && !stop[word];
    }).slice(0, 20);
  }

  function hasRecallIntent(text) {
    return /刚才|之前|前面|上次|还记得|记不记得|你不是说|我不是说|那个|这件事|刚刚|后来|继续|接着|别忘了|我们说到哪/.test(String(text || ""));
  }

  function retrieveRelevantOldMessages(history, latestUserInput, options) {
    var source = options || {};
    var excludeRecentCount = Number(source.excludeRecentCount) || 36;
    var limit = Number(source.limit) || 12;
    var keywords = extractRecallKeywords(latestUserInput);
    var recallIntent = hasRecallIntent(latestUserInput);
    var oldMessages = history.slice(0, Math.max(0, history.length - excludeRecentCount));
    var scored = [];

    oldMessages.forEach(function (message, index) {
      var text = String(message.content || "");
      var score = 0;

      keywords.forEach(function (keyword) {
        if (keyword && text.indexOf(keyword) !== -1) {
          score += 3;
        }
      });

      if (/承诺|答应|约好|记得|喜欢|讨厌|生气|吵架|红包|转账|世界书|设定|师门|身体|疼|难受|见面|线下|拉黑|拒收/.test(text)) {
        score += 1.5;
      }

      if (recallIntent) {
        score += 0.5;
      }

      if (score > 0) {
        scored.push({ message: message, index: index, score: score });
      }
    });

    scored.sort(function (a, b) {
      return b.score - a.score || b.index - a.index;
    });

    return scored.slice(0, recallIntent ? Math.max(limit, 18) : limit).map(function (item) {
      return item.message;
    }).sort(function (a, b) {
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  function retrieveRelevantChatMemories(memories, latestUserInput, options) {
    var source = options || {};
    var limit = Number(source.limit) || 12;
    var keywords = extractRecallKeywords(latestUserInput);
    var recallIntent = hasRecallIntent(latestUserInput);
    var scored = [];

    (Array.isArray(memories) ? memories : []).forEach(function (memory, index) {
      var text = [
        memory.title || "",
        memory.content || "",
        memory.visibleSummary || "",
        memory.mood || ""
      ].join("\n");
      var score = 0;

      keywords.forEach(function (keyword) {
        if (keyword && text.indexOf(keyword) !== -1) {
          score += 4;
        }
      });

      if (memory.type === "manual" || memory.pinned || memory.important) {
        score += 5;
      }

      if (/承诺|答应|约定|关系|冲突|误会|喜欢|讨厌|边界|身体|红包|转账|世界书|师门|设定|拉黑|拒收/.test(text)) {
        score += 2;
      }

      score += Math.max(0, 2 - index * 0.02);

      if (score > 0 || recallIntent) {
        scored.push({ memory: memory, score: score, index: index });
      }
    });

    scored.sort(function (a, b) {
      return b.score - a.score || b.index - a.index;
    });

    return scored.slice(0, recallIntent ? Math.max(limit, 18) : limit).map(function (item) {
      return item.memory;
    });
  }

  function isSimilarMemoryContent(a, b) {
    var x = String(a || "").replace(/\s+/g, "");
    var y = String(b || "").replace(/\s+/g, "");
    if (!x || !y) {
      return false;
    }
    if (x === y) {
      return true;
    }
    return x.indexOf(y) !== -1 || y.indexOf(x) !== -1;
  }

  function buildContinuityState(targetType, targetId, history, memories, options) {
    var recentText = history.slice(-80).map(function (message) {
      return String(message.content || "");
    }).join("\n");
    var memoryText = (Array.isArray(memories) ? memories : []).map(function (memory) {
      return [memory.title, memory.content].filter(Boolean).join("：");
    }).join("\n");
    var combined = [memoryText, recentText].join("\n");
    var parts = [];

    if (/吵架|生气|冷战|不理|拉黑|拒收/.test(combined)) {
      parts.push("关系余波：最近存在冲突/冷战/拒收/拉黑痕迹，本轮不能像第一次聊天一样重置关系。");
    }
    if (/答应|约好|承诺|说好|下次|明天|等你|回来/.test(combined)) {
      parts.push("未完成承诺：存在约定或承诺，角色需要默认记得，除非用户主动撤销。");
    }
    if (/红包|转账|收款|退回|退款|钱|账/.test(combined)) {
      parts.push("金钱余波：最近有红包/转账/账目相关事件，角色态度要承接，不要当没发生。");
    }
    if (/疼|难受|不舒服|身体|状态|手心|大腿|腰背|肩颈/.test(combined)) {
      parts.push("身体状态余波：用户身体状态或不适需要连续，不要下一轮突然忘掉。");
    }
    if (/世界书|设定|师门|门规|规则|禁忌/.test(combined)) {
      parts.push("设定/世界书余波：前文提过设定、师门或规则相关内容，用户再提时优先承接，不要装作第一次听见。");
    }
    if (/喜欢|想你|在意|吃醋|占有|亲近|抱|陪/.test(combined)) {
      parts.push("亲密关系余波：关系中有在意、靠近或占有痕迹，本轮不能退回普通陌生聊天。");
    }

    return parts.length
      ? parts.join("\n")
      : "暂无明显未解决事项；仍需承接最近上下文，不要重置关系。";
  }

  function formatMemoryContextMessages(messages) {
    return (Array.isArray(messages) ? messages : []).map(function (message, index) {
      return (index + 1) + ". " + summarizeMessageForMemorySource(message);
    }).join("\n");
  }

  function formatMemoryContextMemories(memories) {
    return (Array.isArray(memories) ? memories : []).map(function (memory, index) {
      return [
        (index + 1) + ". " + (memory.title || "记忆"),
        memory.content || "",
        memory.type ? "类型：" + memory.type : "",
        memory.source ? "来源：" + memory.source : ""
      ].filter(Boolean).join("；");
    }).join("\n");
  }

  function compressMediumRangeMessages(messages, maxLength) {
    var text = formatMemoryContextMessages(messages);
    var limit = Number(maxLength) || 1600;

    if (text.length <= limit) {
      return text;
    }

    return text.slice(0, Math.floor(limit * 0.45))
      + "\n...\n"
      + text.slice(-Math.floor(limit * 0.55));
  }

  function buildMemoryContextPack(targetType, targetId, options) {
    var source = options || {};
    var latestUserInput = String(source.latestUserInput || "").trim();
    var history = getHistoryForMemoryContext(targetType, targetId);
    var visibleHistory = filterMemoryContextMessages(history);
    var recentFullMessages = visibleHistory.slice(-36);
    var mediumMessages = getMediumRangeMessagesByUserTurns(visibleHistory, 80);
    var relevantOldMessages = retrieveRelevantOldMessages(visibleHistory, latestUserInput, {
      excludeRecentCount: 36,
      limit: 12
    });
    var chatMemories = window.AppStorage.getChatMemories
      ? window.AppStorage.getChatMemories(targetType, targetId) || []
      : [];
    var relevantMemories = retrieveRelevantChatMemories(chatMemories, latestUserInput, {
      limit: 12
    });
    var continuityState = buildContinuityState(targetType, targetId, visibleHistory, chatMemories, source);

    return {
      targetType: targetType,
      targetId: targetId,
      latestUserInput: latestUserInput,
      recentFullText: formatMemoryContextMessages(recentFullMessages),
      mediumSummaryText: compressMediumRangeMessages(mediumMessages, 1600),
      relevantOldText: formatMemoryContextMessages(relevantOldMessages),
      relevantMemoryText: formatMemoryContextMemories(relevantMemories),
      continuityStateText: continuityState,
      counts: {
        fullHistory: visibleHistory.length,
        recentFull: recentFullMessages.length,
        medium: mediumMessages.length,
        relevantOld: relevantOldMessages.length,
        relevantMemories: relevantMemories.length,
        hasRecallIntent: hasRecallIntent(latestUserInput)
      }
    };
  }

  function formatMemoryContextPack(pack) {
    var source = pack || {};

    return [
      "【连续记忆包 memoryContextPack】",
      "本段不是可见回复，不要复述来源；它代表角色真实经历过的连续上下文。",
      "目标：防止忘记前文、未解决事项、承诺、关系余波和相关旧内容。",
      "",
      "1. 最近完整时间线：",
      source.recentFullText || "暂无",
      "",
      "2. 中期压缩时间线：",
      source.mediumSummaryText || "暂无",
      "",
      "3. 和本轮输入相关的旧消息召回：",
      source.relevantOldText || "暂无",
      "",
      "4. 相关长期/自动/手动记忆：",
      source.relevantMemoryText || "暂无",
      "",
      "5. 连续状态锚点：",
      source.continuityStateText || "暂无",
      "",
      "使用要求：",
      "- 用户说'刚才/之前/上次/那个/还记得'时，优先查第 3 和第 4 部分。",
      "- 如果连续状态锚点里有冲突、承诺、身体状态、金钱、世界书余波，本轮必须承接。",
      "- 不要在可见回复里说'记忆包显示''记录里''根据上下文'。",
      "- 把这些内容变成角色的默认记得、态度、称呼、沉默、追问、回避或继续。"
    ].join("\n");
  }

  // ────────────────────────────────────────────────────────────────────────────

  function buildChatGenerationContext(targetType, targetId, extras) {
    var extraOptions = extras || {};
    var settings = window.AppStorage.getSettings ? window.AppStorage.getSettings() : {};
    var autoEnabled = settings.autoMemorySummaryEnabled !== false;
    var interval = Math.max(5, Math.min(50, Number(settings.autoMemorySummaryRounds) || 10));
    var currentRound = window.AppStorage.getChatRoundCounter ? window.AppStorage.getChatRoundCounter(targetType, targetId) : 0;
    var nextRound = autoEnabled && !extraOptions.regenerateRequest ? currentRound + 1 : currentRound;
    var bodyEnabled = settings.bodyStateEnabled !== false;
    var memorySummaryDue = autoEnabled && !extraOptions.regenerateRequest && nextRound >= interval;
    var memorySummarySourceText = memorySummaryDue ? buildMemorySummarySourceText(targetType, targetId, interval) : "";
    var latestUserInput = String(extraOptions.latestUserInput || extraOptions.userInput || "").trim();
    var memoryContextPack = buildMemoryContextPack(targetType, targetId, {
      latestUserInput: latestUserInput,
      regenerateRequest: extraOptions.regenerateRequest
    });
    var memoryContextText = formatMemoryContextPack(memoryContextPack);

    if (localStorage.getItem("myAiApp.debugMemoryContext") === "1") {
      var _counts = memoryContextPack.counts || {};
      console.debug("[MemoryContext]", {
        targetType: targetType,
        targetId: targetId,
        latestUserInput: latestUserInput.slice(0, 60),
        fullHistoryCount: _counts.fullHistory,
        recentFullCount: _counts.recentFull,
        mediumCount: _counts.medium,
        relevantOldCount: _counts.relevantOld,
        relevantMemoriesCount: _counts.relevantMemories,
        hasRecallIntent: _counts.hasRecallIntent,
        continuityStatePreview: (memoryContextPack.continuityStateText || "").slice(0, 80),
        memoryContextTextLength: memoryContextText.length,
        memorySummaryDue: memorySummaryDue,
        memorySummarySourceTextLength: memorySummarySourceText.length
      });
    }

    return Object.assign({
      targetType: targetType,
      targetId: targetId,
      selectedWorldBookIds: window.AppStorage.getChatWorldBookIds ? window.AppStorage.getChatWorldBookIds(targetType, targetId) : [],
      chatMemories: window.AppStorage.getChatMemories ? window.AppStorage.getChatMemories(targetType, targetId) : [],
      bodyStateEnabled: bodyEnabled,
      bodyState: bodyEnabled && window.AppStorage.getBodyState ? window.AppStorage.getBodyState(targetType, targetId) : null,
      autoMemorySummaryEnabled: autoEnabled,
      memorySummaryDue: memorySummaryDue,
      memorySummaryRounds: interval,
      memorySummarySourceText: memorySummarySourceText,
      currentRound: nextRound,
      memoryContextPack: memoryContextPack,
      memoryContextText: memoryContextText
    }, extraOptions);
  }

  function finalizeChatGenerationContext(context, result) {
    var summary = result && result.memorySummary;
    var savedSummary = false;

    if (!context || !context.targetId) {
      return;
    }

    if (context.autoMemorySummaryEnabled && window.AppStorage.setChatRoundCounter) {
      if (context.memorySummaryDue && summary && summary.content && window.AppStorage.addChatMemory) {
        window.AppStorage.addChatMemory(context.targetType, context.targetId, {
          title: summary.title || "自动记忆总结",
          content: summary.content,
          sourceTime: Date.now(),
          type: "auto",
          source: context.targetType === "group" ? "group" : (context.targetType === "offline" ? "offline" : "private"),
          generationId: context.generationId || "",
          sourceGenerationId: context.generationId || "",
          createdAt: Date.now()
        });
        savedSummary = true;
      }

      window.AppStorage.setChatRoundCounter(
        context.targetType,
        context.targetId,
        context.memorySummaryDue ? (savedSummary ? 0 : Math.max(0, context.memorySummaryRounds - 1)) : context.currentRound
      );

      if (context.targetType === "group" && savedSummary && summary && summary.content && window.AppStorage.getGroups) {
        var group = (window.AppStorage.getGroups() || []).find(function (item) {
          return item && item.id === context.targetId;
        });

        if (group && group.settings && group.settings.memorySharingEnabled === false) {
          // Group memory sharing is disabled, do not sync summary into individual memories.
        } else if (group && Array.isArray(group.memberIds)) {
          group.memberIds.forEach(function (memberId) {
            window.AppStorage.addCharacterMemory(memberId, {
              content: "群聊《" + (group.name || "群聊") + "》中的总结：" + summary.content,
              source: "group",
              generationId: context.generationId || "",
              sourceGenerationId: context.generationId || "",
              targetType: "group",
              targetId: context.targetId,
              createdAt: Date.now()
            });
          });
        }
      }
    }

    if (result && Array.isArray(result.memories) && result.memories.length && window.AppStorage.addChatMemory && window.AppStorage.getChatMemories) {
      var existingChatMems = window.AppStorage.getChatMemories(context.targetType, context.targetId) || [];
      var now = Date.now();
      result.memories.forEach(function (memory) {
        if (!memory || !memory.content) {
          return;
        }
        var recentMems = existingChatMems.slice(0, 30);
        var isDuplicate = recentMems.some(function (existing) {
          return isSimilarMemoryContent(existing.content, memory.content);
        });
        if (!isDuplicate) {
          var saved = window.AppStorage.addChatMemory(context.targetType, context.targetId, {
            title: memory.title || String(memory.content).slice(0, 20),
            content: memory.content,
            sourceTime: now,
            type: "auto",
            source: context.targetType === "group" ? "group" : (context.targetType === "offline" ? "offline" : "private"),
            generationId: context.generationId || "",
            sourceGenerationId: context.generationId || "",
            createdAt: now
          });
          if (saved) {
            existingChatMems.unshift({ content: memory.content });
          }
        }
      });
    }

    if (context.bodyStateEnabled && result && result.bodyState && window.AppStorage.saveBodyState) {
      if (context.generationId && window.AppStorage.saveBodyStateSnapshot) {
        window.AppStorage.saveBodyStateSnapshot(context.generationId, context.targetType, context.targetId, context.bodyState || {});
      }

      var normalizedBodyState = result.bodyState;
      if (window.AIService && window.AIService.normalizeBodyStateWithContext) {
        var recentMsgs = [];
        if (context.targetType === "group" && window.AppStorage.getGroupChatHistory) {
          recentMsgs = window.AppStorage.getGroupChatHistory(context.targetId).slice(-12);
        } else if (window.AppStorage.getChatHistory) {
          recentMsgs = window.AppStorage.getChatHistory(context.targetId).slice(-12);
        }
        normalizedBodyState = window.AIService.normalizeBodyStateWithContext(result.bodyState, context.bodyState || {}, recentMsgs);
      }

      window.AppStorage.saveBodyState(context.targetType, context.targetId, Object.assign({}, normalizedBodyState, {
        generationId: context.generationId || "",
        targetType: context.targetType,
        targetId: context.targetId
      }));
    }
  }

  function openChatMemoryPanel(targetType, targetId, title) {
    renderChatMemoryPanel(targetType, targetId, title || "聊天记忆");
  }

  function renderChatMemoryPanel(targetType, targetId, title) {
    var memories = window.AppStorage.getChatMemories ? window.AppStorage.getChatMemories(targetType, targetId) : [];

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      '  <button type="button" data-memory-action="add">新增</button>',
      "  <h3>" + escapeHtml(title || "聊天记忆") + "</h3>",
      '  <button type="button" data-close-sheet>关闭</button>',
      "</div>",
      '<div class="wechat-sheet-form memory-panel">',
      memories.length ? memories.map(renderMemoryPanelCard).join("") : '<div class="soft-empty">还没有记忆，可以手动新增，也可以等待自动总结生成。</div>',
      "</div>"
    ].join(""), function (sheet) {
      bindSheetCloseButtons(sheet);
      sheet.addEventListener("click", function (event) {
        var button = event.target.closest("[data-memory-action]");
        var card = button ? button.closest("[data-memory-id]") : null;
        var memoryId = card ? card.dataset.memoryId : "";

        if (!button) {
          return;
        }

        if (button.dataset.memoryAction === "add") {
          renderChatMemoryEditor(targetType, targetId, title, null);
        }

        if (button.dataset.memoryAction === "edit") {
          renderChatMemoryEditor(targetType, targetId, title, memories.find(function (memory) {
            return memory.id === memoryId;
          }));
        }

        if (button.dataset.memoryAction === "delete" && window.confirm("确定删除这条记忆吗？")) {
          window.AppStorage.deleteChatMemory(targetType, targetId, memoryId);
          renderChatMemoryPanel(targetType, targetId, title);
        }
      });
    });
  }

  function renderMemoryPanelCard(memory) {
    return [
      '<article class="memory-panel-card" data-memory-id="' + escapeHtml(memory.id) + '">',
      '  <div class="memory-panel-top"><strong>' + escapeHtml(memory.title || "记忆") + '</strong><span>' + escapeHtml(memory.type === "auto" ? "自动总结" : "手动添加") + "</span></div>",
      '  <p>' + escapeHtml(memory.content || "") + "</p>",
      '  <small>来源时间：' + escapeHtml(formatDateTime(memory.sourceTime)) + " · 创建：" + escapeHtml(formatDateTime(memory.createdAt)) + "</small>",
      '  <div class="settings-action-row compact-action-row">',
      '    <button class="outline-button" type="button" data-memory-action="edit">编辑</button>',
      '    <button class="outline-button danger" type="button" data-memory-action="delete">删除</button>',
      "  </div>",
      "</article>"
    ].join("");
  }

  function renderChatMemoryEditor(targetType, targetId, title, memory) {
    var source = memory || {};

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      '  <button type="button" data-memory-edit-cancel>返回</button>',
      "  <h3>" + escapeHtml(memory ? "编辑记忆" : "新增记忆") + "</h3>",
      '  <button type="button" data-memory-edit-save>保存</button>',
      "</div>",
      '<div class="wechat-sheet-form memory-editor">',
      '  <label class="wechat-sheet-field"><span>标题</span><input id="memoryTitleInput" type="text" maxlength="40" value="' + escapeHtml(source.title || "") + '"></label>',
      '  <label class="wechat-sheet-field"><span>正文</span><textarea id="memoryContentInput" maxlength="1200">' + escapeHtml(source.content || "") + "</textarea></label>",
      '  <label class="wechat-sheet-field"><span>来源时间</span><input id="memorySourceTimeInput" type="datetime-local" value="' + escapeHtml(formatDateTimeInput(source.sourceTime || Date.now())) + '"></label>',
      '  <label class="wechat-sheet-field"><span>类型</span><select id="memoryTypeInput"><option value="manual"' + (source.type !== "auto" ? " selected" : "") + '>手动添加</option><option value="auto"' + (source.type === "auto" ? " selected" : "") + ">自动总结</option></select></label>",
      "</div>"
    ].join(""), function (sheet) {
      bindSheetCloseButtons(sheet);
      sheet.querySelector("[data-memory-edit-cancel]").addEventListener("click", function () {
        renderChatMemoryPanel(targetType, targetId, title);
      });
      sheet.querySelector("[data-memory-edit-save]").addEventListener("click", function () {
        var payload = {
          title: sheet.querySelector("#memoryTitleInput").value.trim() || "聊天记忆",
          content: sheet.querySelector("#memoryContentInput").value.trim(),
          sourceTime: new Date(sheet.querySelector("#memorySourceTimeInput").value || Date.now()).getTime(),
          type: sheet.querySelector("#memoryTypeInput").value,
          source: targetType === "group" ? "group" : (targetType === "offline" ? "offline" : "private")
        };

        if (!payload.content) {
          showToast("记忆正文不能为空", true);
          return;
        }

        if (memory && memory.id) {
          window.AppStorage.updateChatMemory(targetType, targetId, memory.id, payload);
        } else {
          window.AppStorage.addChatMemory(targetType, targetId, payload);
        }

        renderChatMemoryPanel(targetType, targetId, title);
      });
    });
  }

  function formatDateTimeInput(timestamp) {
    var date = new Date(timestamp || Date.now());
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-") + "T" + [
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0")
    ].join(":");
  }

  function openBodyStatePanel(targetType, targetId, title) {
    var settings = window.AppStorage.getSettings ? window.AppStorage.getSettings() : {};
    var enabled = settings.bodyStateEnabled !== false;
    var state = window.AppStorage.getBodyState ? window.AppStorage.getBodyState(targetType, targetId) : {};
    var showAllParts = false;

    function renderBodyStatePanel(sheet) {
      var content = sheet.querySelector(".body-state-panel");
      if (!content) {
        return;
      }

      content.innerHTML = enabled
        ? renderBodyStatePanelContent(state, showAllParts) + '<div class="settings-action-row compact-action-row"><button class="outline-button" type="button" data-body-action="export">导出文本</button><button class="outline-button danger" type="button" data-body-action="reset">重置状态</button></div>'
        : '<div class="soft-empty">身体状态系统已关闭，可在设置里开启。</div>';
    }

    showWeChatSheet([
      '<div class="wechat-sheet-header">',
      '  <span></span>',
      "  <h3>" + escapeHtml(title || "你的身体状态") + "</h3>",
      '  <button type="button" data-close-sheet>关闭</button>',
      "</div>",
      '<div class="wechat-sheet-form body-state-panel">',
      enabled ? renderBodyStatePanelContent(state, showAllParts) : '<div class="soft-empty">身体状态系统已关闭，可在设置里开启。</div>',
      enabled ? '<div class="settings-action-row compact-action-row"><button class="outline-button" type="button" data-body-action="export">导出文本</button><button class="outline-button danger" type="button" data-body-action="reset">重置状态</button></div>' : "",
      "</div>"
    ].join(""), function (sheet) {
      bindSheetCloseButtons(sheet);
      sheet.addEventListener("click", function (event) {
        var button = event.target.closest("[data-body-action]");
        var text;

        if (!button) {
          return;
        }

        if (button.dataset.bodyAction === "toggleParts") {
          showAllParts = !showAllParts;
          renderBodyStatePanel(sheet);
          return;
        }

        if (button.dataset.bodyAction === "reset" && window.confirm("确定重置当前身体状态吗？")) {
          window.AppStorage.clearBodyState(targetType, targetId);
          openBodyStatePanel(targetType, targetId, title);
          return;
        }

        if (button.dataset.bodyAction === "export") {
          text = formatBodyStateText(state);
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
              showToast("身体状态文本已复制");
            }).catch(function () {
              window.prompt("复制身体状态文本", text);
            });
          } else {
            window.prompt("复制身体状态文本", text);
          }
        }
      });
    });
  }

  function renderBodyStatePanelContent(state, showAll) {
    var parts = state.parts || {};
    var isNormal = (state.sorenessLevel || 0) === 0 && (state.painLevel || 0) === 0 && (state.rednessLevel || 0) === 0 && !state.restNeeded;
    var orderedParts = DEFAULT_BODY_STATE_PARTS.concat(Object.keys(parts).filter(function (partName) {
      return DEFAULT_BODY_STATE_PARTS.indexOf(partName) === -1;
    })).filter(function (value, index, self) {
      return self.indexOf(value) === index;
    });

    var abnormalParts = orderedParts.filter(function (partName) {
      var part = parts[partName] || {};
      return (part.status && part.status !== "正常") || (part.soreness || 0) > 0 || (part.pain || 0) > 0 || (part.redness || 0) > 0;
    });

    var metricsHtml = isNormal
      ? [renderBodyMetric("精力", state.energy + "/100"), renderBodyMetric("体温", state.bodyTemperature || "正常")].join("")
      : [
          renderBodyMetric("精力", state.energy + "/100"),
          renderBodyMetric("酸痛", state.sorenessLevel + "/100"),
          renderBodyMetric("疼痛", state.painLevel + "/100"),
          renderBodyMetric("泛红", state.rednessLevel + "/100"),
          renderBodyMetric("体温", state.bodyTemperature || "正常"),
          renderBodyMetric("需休息", state.restNeeded ? "是" : "否")
        ].join("");

    var partsHtml = "";
    if (showAll) {
      partsHtml = orderedParts.map(function (partName) {
        var part = parts[partName] || {};
        var isAbnormal = (part.status && part.status !== "正常") || (part.soreness || 0) > 0 || (part.pain || 0) > 0 || (part.redness || 0) > 0;
        return [
          '<article class="body-part-card ' + (isAbnormal ? "body-part-abnormal" : "body-part-normal") + '">',
          '  <div><strong>' + escapeHtml(partName) + '</strong><span>' + escapeHtml(part.status || "正常") + "</span></div>",
          part.notes ? '<div class="body-part-notes">' + escapeHtml(part.notes) + "</div>" : "",
          "</article>"
        ].join("");
      }).join("");
    } else if (abnormalParts.length === 0) {
      partsHtml = '<p class="body-state-normal-hint">当前无明显不适</p>';
    } else {
      partsHtml = abnormalParts.map(function (partName) {
        var part = parts[partName] || {};
        return [
          '<article class="body-part-card body-part-abnormal">',
          '  <div><strong>' + escapeHtml(partName) + '</strong><span>' + escapeHtml(part.status || "正常") + "</span></div>",
          part.notes ? '<div class="body-part-notes">' + escapeHtml(part.notes) + "</div>" : "",
          "</article>"
        ].join("");
      }).join("");
    }

    var suggestion = state.recoverySuggestion || "暂无特别需要。";
    var toggleLabel = showAll ? "收起正常部位" : "查看全部部位";

    return [
      '<section class="body-state-summary">',
      '  <strong>' + escapeHtml(state.overallCondition || "正常") + "</strong>",
      '  <p>' + escapeHtml(state.currentNote || "当前无明显不适") + "</p>",
      '  <div class="body-state-grid">',
      metricsHtml,
      "  </div>",
      '  <small>最近更新：' + escapeHtml(formatDateTime(state.updatedAt)) + "</small>",
      "</section>",
      '<section class="body-part-list">',
      partsHtml,
      "</section>",
      '<div class="settings-action-row compact-action-row body-state-toggle-row"><button class="outline-button" type="button" data-body-action="toggleParts">' + escapeHtml(toggleLabel) + '</button></div>',
      '<section class="body-recovery-card"><strong>参考建议</strong><p>' + escapeHtml(suggestion) + "</p></section>"
    ].join("");
  }

  function renderBodyMetric(label, value) {
    return '<span><em>' + escapeHtml(label) + '</em><b>' + escapeHtml(value) + "</b></span>";
  }

  function formatBodyStateText(state) {
    var parts = state.parts || {};
    var orderedParts = DEFAULT_BODY_STATE_PARTS.concat(Object.keys(parts).filter(function (partName) {
      return DEFAULT_BODY_STATE_PARTS.indexOf(partName) === -1;
    })).filter(function (value, index, self) {
      return self.indexOf(value) === index;
    });

    return [
      "用户身体状态：" + (state.overallCondition || "正常"),
      "说明：" + (state.currentNote || "当前无明显异常"),
      "精力：" + (state.energy || 0) + "/100",
      "酸痛/疼痛/泛红：" + (state.sorenessLevel || 0) + "/" + (state.painLevel || 0) + "/" + (state.rednessLevel || 0),
      "体温：" + (state.bodyTemperature || "正常") + "，发热风险：" + (state.feverRisk || "低"),
      "恢复建议：" + (state.recoverySuggestion || "无"),
      "部位：",
      orderedParts.map(function (partName) {
        var part = parts[partName] || {};
        return "- " + partName + "：" + (part.status || "正常") + "，酸痛 " + (part.soreness || 0) + "，疼痛 " + (part.pain || 0) + "，泛红 " + (part.redness || 0) + (part.notes ? "，" + part.notes : "");
      }).join("\n")
    ].join("\n");
  }

  function appendMessagesWithStreamEffect(options) {
    var settings = options || {};
    var messages = Array.isArray(settings.messages) ? settings.messages : [];
    var index = 0;

    return new Promise(function (resolve) {
      function appendNext() {
        var delay;

        if (index >= messages.length) {
          if (typeof settings.onDone === "function") {
            settings.onDone();
          }
          resolve();
          return;
        }

        if (typeof settings.renderOne === "function") {
          settings.renderOne(messages[index], index);
        }

        index += 1;
        delay = 300 + Math.floor(Math.random() * 401);
        window.setTimeout(appendNext, delay);
      }

      appendNext();
    });
  }

  function updateStatusTime() {
    var statusTime = getElement("statusTime");
    var now = new Date();
    var hours = String(now.getHours()).padStart(2, "0");
    var minutes = String(now.getMinutes()).padStart(2, "0");

    if (statusTime) {
      statusTime.textContent = hours + ":" + minutes;
    }
  }

  function forceSafeStartupPage() {
    var activeScreens = Array.prototype.slice.call(document.querySelectorAll(".screen.active"));
    var shouldReset = activeScreens.length !== 1 || activeScreens.some(function (screen) {
      return screen && (screen.id === "chatScreen" || screen.id === "groupChatScreen");
    });

    if (shouldReset) {
      pageIds.forEach(function (id) {
        var screen = getElement(id);
        if (screen) {
          screen.classList.remove("active");
          screen.setAttribute("aria-hidden", "true");
        }
      });
      var home = getElement("homeScreen");
      if (home) {
        home.classList.add("active");
        home.setAttribute("aria-hidden", "false");
      }
      activePage = "homeScreen";
    }
  }

  function initApp() {
    console.debug("[Startup Debug] initApp running", {
      version: "2026050515",
      activeScreens: Array.prototype.map.call(document.querySelectorAll(".screen.active"), function (el) { return el.id; })
    });
    forceSafeStartupPage();
    document.title = "心屿空间";
    applySavedTheme();
    bindHomeActions();
    bindNavigationActions();
    bindForms();
    bindWechatAddMenu();
    bindChatMenuActions();
    bindGroupMenuActions();
    bindDataManagementActions();
    bindGlobalActions();
    bindMessageActionSheet();
    bindWeChatModal();
    bindThoughtsDrawer();
    updateStatusTime();
    window.setInterval(updateStatusTime, 30000);
    window.CharacterManager.renderCharacterList();
    window.GroupManager.renderGroupList();
    loadSettingsIntoForm();
    refreshHomeSummary();
    setActivePage("homeScreen");
    resumeAppApiJobsWhenReady();
    console.debug("[Startup Debug] initApp finished", {
      activePage: activePage,
      activeScreens: Array.prototype.map.call(document.querySelectorAll(".screen.active"), function (el) { return el.id; }),
      screens: Array.prototype.map.call(document.querySelectorAll(".screen"), function (el) {
        return {
          id: el.id,
          active: el.classList.contains("active"),
          display: getComputedStyle(el).display,
          visibility: getComputedStyle(el).visibility,
          position: getComputedStyle(el).position,
          zIndex: getComputedStyle(el).zIndex
        };
      })
    });
  }

  window.setActivePage = setActivePage;
  window.setWechatTab = setWechatTab;
  window.goHome = goHome;
  window.initApp = initApp;
  window.MessageActionMenu = {
    open: openMessageActionMenu,
    close: closeMessageActionMenu
  };
  window.WeChatTools = {
    openRedPacketSheet: openRedPacketSheet,
    openTransferSheet: openTransferSheet,
    openLocationSheet: openLocationSheet,
    openEmojiSheet: openEmojiSheet,
    openImagePicker: openImagePicker,
    openVoiceSheet: openVoiceSheet,
    showMessageDetail: showMessageDetail,
    openMessageEditSheet: openMessageEditSheet,
    openChatSearchSheet: openChatSearchSheet,
    openChatWorldBookSelector: openChatWorldBookSelector,
    openOfflineSceneSheet: openOfflineSceneSheet,
    showSheet: showWeChatSheet,
    close: closeWeChatSheet
  };
  window.AppNavigation = {
    getActivePage: getActivePage,
    refreshHomeSummary: refreshHomeSummary
  };
  window.AppStream = {
    appendMessagesWithStreamEffect: appendMessagesWithStreamEffect
  };
  window.AppExtras = {
    openThoughtsForCharacter: openThoughtsForCharacter,
    openThoughtsForGroup: openThoughtsForGroup,
    buildThoughtDisplayData: buildThoughtDisplayData,
    openThoughtsDrawer: openThoughtsDrawer,
    closeThoughtsDrawer: closeThoughtsDrawer,
    renderThoughtsDrawer: renderThoughtsDrawer,
    markThoughtsRead: markThoughtsRead,
    updateThoughtHeartBadge: updateThoughtHeartBadge,
    openThoughtsDrawerForCharacter: openThoughtsDrawerForCharacter,
    openThoughtsDrawerForGroup: openThoughtsDrawerForGroup,
    openThoughtsDrawerForOfflineSession: openThoughtsDrawerForOfflineSession,
    updatePrivateThoughtsButton: updatePrivateThoughtsButton,
    updateGroupThoughtsButton: updateGroupThoughtsButton,
    updateOfflineThoughtsButton: updateOfflineThoughtsButton,
    updateThoughtHeartButtons: updateThoughtHeartButtons,
    buildChatGenerationContext: buildChatGenerationContext,
    finalizeChatGenerationContext: finalizeChatGenerationContext,
    buildMemoryContextPack: buildMemoryContextPack,
    formatMemoryContextPack: formatMemoryContextPack,
    openChatMemoryPanel: openChatMemoryPanel,
    openChatWorldBookSelector: openChatWorldBookSelector,
    openBodyStatePanel: openBodyStatePanel,
    openRegenerateReplySheet: openRegenerateReplySheet,
    insertBracketIntoInput: insertBracketIntoInput,
    openCharacterSpaceScreen: openCharacterSpaceScreen,
    openDiaryScreen: openDiaryScreen,
    renderMomentFeed: renderMomentFeed,
    addMomentComment: addMomentComment,
    getRelatedCharactersForMoment: getRelatedCharactersForMoment,
    generateCharacterMoment: generateCharacterMoment,
    generateMomentWithComments: generateMomentWithComments,
    renderWorldBookScreen: renderWorldBookScreen,
    renderDiaryScreen: renderDiaryScreen,
    renderCharacterSpaceScreen: renderCharacterSpaceScreen,
    renderWechatScreen: renderWechatScreen,
    showToast: showToast
  };

  document.addEventListener("DOMContentLoaded", initApp);
})(window, document);
