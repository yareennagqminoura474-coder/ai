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
    "worldBookScreen",
    "diaryScreen",
    "characterSpaceScreen",
    "thoughtsScreen"
  ];
  var activePage = "homeScreen";
  var currentMessageAction = null;
  var emojiSendCallback = null;
  var imageSendCallback = null;
  var diaryTab = "character";
  var diaryCharacterId = "";
  var characterSpaceId = "";
  var thoughtsReturnPage = "homeScreen";
  var thoughtsState = {
    title: "心声",
    characterIds: [],
    chatId: "",
    characterFilter: "all",
    sourceFilter: "all",
    moodFilter: "all"
  };
  var noteSearchKeyword = "";
  var currentThemeId = "default";
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

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setActivePage(pageId) {
    if (pageIds.indexOf(pageId) === -1) {
      return;
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

      screen.classList.toggle("active", id === pageId);
      screen.setAttribute("aria-hidden", id === pageId ? "false" : "true");
    });

    updateDockState(pageId);

    if (pageId === "homeScreen") {
      refreshHomeSummary();
    }

    if (pageId === "wechatScreen") {
      renderWechatScreen();
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
    var dockSettings = getElement("dockSettings");

    if (!dockHome || !dockChat || !dockSettings) {
      return;
    }

    dockHome.classList.toggle("active", pageId === "homeScreen");
    dockChat.classList.toggle("active", pageId === "wechatScreen" || pageId === "characterListScreen" || pageId === "chatScreen" || pageId === "groupListScreen" || pageId === "groupChatScreen" || pageId === "privateChatSettingsScreen" || pageId === "groupSettingsScreen" || pageId === "thoughtsScreen");
    dockSettings.classList.toggle("active", pageId === "settingsScreen" || pageId === "worldBookScreen" || pageId === "diaryScreen" || pageId === "characterSpaceScreen");
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

  function renderWechatScreen() {
    var list = getElement("wechatRecentList");
    var count = getElement("wechatRecentCount");
    var recentItems = getRecentChats();

    if (!list) {
      return;
    }

    if (count) {
      count.textContent = recentItems.length + " 条";
    }

    if (!recentItems.length) {
      list.innerHTML = '<div class="soft-empty">暂无最近聊天，先从上方入口开始</div>';
      return;
    }

    list.innerHTML = recentItems.map(renderRecentChatItem).join("");

    Array.prototype.forEach.call(list.querySelectorAll("[data-recent-open]"), function (item) {
      item.addEventListener("click", function () {
        if (item.dataset.recentType === "private") {
          window.CharacterManager.openChatScreen(item.dataset.recentId);
        } else {
          window.GroupManager.openGroupChatScreen(item.dataset.recentId);
        }
      });
    });

    Array.prototype.forEach.call(list.querySelectorAll("[data-recent-action]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        handleRecentAction(button.dataset.recentAction, button.dataset.recentType, button.dataset.recentId, Number(button.dataset.recentTime) || Date.now());
      });
    });
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
        fallback: character.name ? character.name.slice(0, 1) : "AI",
        preview: last ? formatRecentPreview(last) : "还没有聊天记录",
        time: last ? last.createdAt : 0,
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
        preview: last ? formatRecentPreview(last) : "还没有群聊消息",
        time: last ? last.createdAt : 0,
        pinned: Boolean(groupSettings.pinned)
      };
    });

    return privateItems.concat(groupItems).filter(function (item) {
      var hiddenAt = window.AppStorage.getRecentHiddenAt ? window.AppStorage.getRecentHiddenAt(item.type, item.id) : 0;
      return item.time && (!hiddenAt || item.time > hiddenAt);
    }).sort(function (a, b) {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      return b.time - a.time;
    }).slice(0, 20);
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
      return "[转账] " + (message.amount ? "¥" + message.amount : "");
    }
    if (message.type === "location") {
      return "[位置] " + (message.location && message.location.name ? message.location.name : message.content || "");
    }
    if (message.type === "offlineUserAction") {
      return "[线下行动] " + (message.content || "");
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

  function renderRecentChatItem(item) {
    return [
      '<article class="recent-chat-item' + (item.pinned ? " pinned" : "") + '">',
      '  <button class="recent-open" type="button" data-recent-open data-recent-type="' + escapeHtml(item.type) + '" data-recent-id="' + escapeHtml(item.id) + '">',
      item.type === "group" ? renderRecentGroupAvatar(item.memberIds) : renderRecentSingleAvatar(item),
      '    <span class="recent-chat-main">',
      '      <strong>' + (item.pinned ? '<i>置顶</i>' : "") + escapeHtml(item.title) + "</strong>",
      item.originalTitle && item.originalTitle !== item.title ? '      <small>原名：' + escapeHtml(item.originalTitle) + "</small>" : "",
      "      <em>" + escapeHtml(item.preview) + "</em>",
      "    </span>",
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

    return '<span class="recent-chat-avatar" aria-hidden="true">' + escapeHtml(item.fallback || "AI") + "</span>";
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

        return '<i>' + escapeHtml(character.name ? character.name.slice(0, 1) : "AI") + "</i>";
      }).join(""),
      "</span>"
    ].join("");
  }

  function bindHomeActions() {
    getElement("openWeChat").addEventListener("click", function () {
      setActivePage("wechatScreen");
    });

    getElement("openSettings").addEventListener("click", function () {
      setActivePage("settingsScreen");
    });

    getElement("openWorldBook").addEventListener("click", function () {
      setActivePage("worldBookScreen");
    });

    getElement("openDiary").addEventListener("click", function () {
      openDiaryScreen();
    });

    getElement("openCharacterSpace").addEventListener("click", function () {
      openCharacterSpaceScreen();
    });

    getElement("openBackup").addEventListener("click", function () {
      setActivePage("settingsScreen");
    });

    getElement("openTheme").addEventListener("click", function () {
      setActivePage("themeScreen");
    });

    getElement("openPhoto").addEventListener("click", function () {
      setActivePage("photoScreen");
    });

    getElement("openNotebook").addEventListener("click", function () {
      setActivePage("notebookScreen");
    });

    Array.prototype.forEach.call(document.querySelectorAll(".desktop-coming"), function (button) {
      button.addEventListener("click", function () {
        window.alert("功能开发中");
      });
    });

    getElement("dockHome").addEventListener("click", goHome);
    getElement("dockChat").addEventListener("click", function () {
      setActivePage("wechatScreen");
    });
    getElement("dockSettings").addEventListener("click", function () {
      setActivePage("settingsScreen");
    });
  }

  function bindNavigationActions() {
    getElement("characterListBack").addEventListener("click", function () {
      setActivePage("wechatScreen");
    });
    getElement("newCharacterBtn").addEventListener("click", window.CharacterManager.openCreateCharacterScreen);
    getElement("characterBatchSelectBtn").addEventListener("click", window.CharacterManager.toggleCharacterSelectionMode);
    getElement("createBackBtn").addEventListener("click", window.CharacterManager.closeCreateCharacterScreen);
    getElement("chatBackBtn").addEventListener("click", function () {
      setActivePage("characterListScreen");
    });
    getElement("groupListBack").addEventListener("click", function () {
      setActivePage("wechatScreen");
    });
    getElement("newGroupBtn").addEventListener("click", window.GroupManager.openCreateGroupScreen);
    getElement("groupBatchSelectBtn").addEventListener("click", window.GroupManager.toggleGroupSelectionMode);
    getElement("createGroupBackBtn").addEventListener("click", function () {
      setActivePage("groupListScreen");
    });
    getElement("groupChatBackBtn").addEventListener("click", function () {
      setActivePage("groupListScreen");
    });
    getElement("offlineBackBtn").addEventListener("click", window.OfflineManager.goBack);
    getElement("wechatBackBtn").addEventListener("click", goHome);
    getElement("wechatAddBtn").addEventListener("click", function () {
      window.CharacterManager.openCreateCharacterScreen();
    });
    getElement("settingsBackBtn").addEventListener("click", goHome);
    getElement("privateChatSettingsBackBtn").addEventListener("click", function () {
      setActivePage("chatScreen");
    });
    getElement("groupSettingsBackBtn").addEventListener("click", function () {
      setActivePage("groupChatScreen");
    });
    getElement("worldBookBackBtn").addEventListener("click", goHome);
    getElement("diaryBackBtn").addEventListener("click", goHome);
    getElement("characterSpaceBackBtn").addEventListener("click", goHome);
    getElement("themeBackBtn").addEventListener("click", goHome);
    getElement("photoBackBtn").addEventListener("click", goHome);
    getElement("notebookBackBtn").addEventListener("click", goHome);
    getElement("thoughtsBackBtn").addEventListener("click", function () {
      setActivePage(thoughtsReturnPage || "homeScreen");
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

    getElement("chatPlusBtn").addEventListener("click", function (event) {
      event.stopPropagation();
      if (window.GroupManager && window.GroupManager.closeToolPanel) {
        window.GroupManager.closeToolPanel();
      }
      window.CharacterManager.toggleToolPanel();
    });

    Array.prototype.forEach.call(document.querySelectorAll("#chatToolPanel [data-message-type]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        window.CharacterManager.sendToolMessage(button.dataset.messageType);
      });
    });

    getElement("replyButton").addEventListener("click", function () {
      window.CharacterManager.requestCharacterReply();
    });

    getElement("wechatOpenCharacterList").addEventListener("click", function () {
      setActivePage("characterListScreen");
    });

    getElement("wechatOpenGroupList").addEventListener("click", function () {
      setActivePage("groupListScreen");
    });

    getElement("wechatOpenCreateCharacter").addEventListener("click", function () {
      window.CharacterManager.openCreateCharacterScreen();
    });

    getElement("wechatOpenCreateGroup").addEventListener("click", function () {
      window.GroupManager.openCreateGroupScreen();
    });

    getElement("wechatOpenContacts").addEventListener("click", function () {
      setActivePage("characterListScreen");
    });

    getElement("wechatOpenData").addEventListener("click", function () {
      setActivePage("settingsScreen");
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

    getElement("groupPlusBtn").addEventListener("click", function (event) {
      event.stopPropagation();
      if (window.CharacterManager && window.CharacterManager.closeToolPanel) {
        window.CharacterManager.closeToolPanel();
      }
      window.GroupManager.toggleToolPanel();
    });

    Array.prototype.forEach.call(document.querySelectorAll("#groupToolPanel [data-message-type]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        window.GroupManager.sendToolMessage(button.dataset.messageType);
      });
    });

    getElement("groupReplyButton").addEventListener("click", function () {
      window.GroupManager.requestGroupReply();
    });

    getElement("offlineComposer").addEventListener("submit", function (event) {
      event.preventDefault();
      window.OfflineManager.sendOfflineUserInput();
    });

    getElement("offlineAdvanceBtn").addEventListener("click", function () {
      window.OfflineManager.advanceOffline();
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

  function bindChatMenuActions() {
    var chatMenu = getElement("chatActionMenu");

    getElement("chatMoreBtn").addEventListener("click", function (event) {
      event.stopPropagation();
      window.CharacterManager.toggleChatActionMenu();
    });

    if (chatMenu) {
      chatMenu.addEventListener("click", function (event) {
        event.stopPropagation();
      });
    }

    getElement("chatEditCharacterBtn").addEventListener("click", window.CharacterManager.editActiveCharacter);
    getElement("chatSettingsBtn").addEventListener("click", window.CharacterManager.openActivePrivateSettings);
    getElement("chatThoughtsBtn").addEventListener("click", window.CharacterManager.openActiveCharacterThoughts);
    getElement("chatSearchBtn").addEventListener("click", window.CharacterManager.openActiveChatSearch);
    getElement("chatBatchSelectBtn").addEventListener("click", window.CharacterManager.openPrivateMessageSelectionMode);
    getElement("chatOfflineBtn").addEventListener("click", window.CharacterManager.openActiveCharacterOffline);
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
      window.GroupManager.toggleGroupActionMenu();
    });

    if (groupMenu) {
      groupMenu.addEventListener("click", function (event) {
        event.stopPropagation();
      });
    }

    getElement("groupSettingsBtn").addEventListener("click", window.GroupManager.openActiveGroupSettings);
    getElement("groupThoughtsBtn").addEventListener("click", window.GroupManager.openActiveGroupThoughts);
    getElement("groupSearchBtn").addEventListener("click", window.GroupManager.openActiveGroupSearch);
    getElement("groupBatchMessageSelectBtn").addEventListener("click", window.GroupManager.openGroupMessageSelectionMode);
    getElement("groupOfflineBtn").addEventListener("click", window.GroupManager.openActiveGroupOffline);
    getElement("groupOfflineExitBtn").addEventListener("click", function () {
      window.OfflineManager.disableInlineOffline();
    });
  }

  function bindDataManagementActions() {
    getElement("fetchModelsBtn").addEventListener("click", fetchModelsFromSettings);
    getElement("exportDataBtn").addEventListener("click", exportAllData);
    getElement("newWorldBookBtn").addEventListener("click", createWorldBook);
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
    getElement("clearAllDataBtn").addEventListener("click", clearAllData);
  }

  function bindGlobalActions() {
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".action-menu") && !event.target.closest(".card-more") && event.target.id !== "chatMoreBtn" && event.target.id !== "groupChatMoreBtn") {
        window.CharacterManager.closeAllMenus();
        if (window.GroupManager) {
          window.GroupManager.closeAllMenus();
        }
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

    if (!sheet) {
      return;
    }

    currentMessageAction = options || null;

    if (regenerateButton) {
      regenerateButton.classList.toggle("hidden", Boolean(options && options.canRegenerate === false));
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

  function openOfflineSceneSheet(onSelect) {
    var scenes = [
      { name: "家", description: "熟悉、放松、适合日常互动的室内场景" },
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
          status: "sent"
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
      showMoneyDetail("红包详情", message.content || "恭喜发财，大吉大利", "¥" + (message.amount || "0.00"), "已发送");
      return;
    }

    if (message.type === "transfer") {
      showMoneyDetail("转账详情", message.note || "转账", "¥" + (message.amount || "0.00"), message.status === "pending" ? "待收款" : "已发送");
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

    return '<span class="' + className + '" aria-hidden="true">' + escapeHtml(character && character.name ? character.name.slice(0, 1) : "AI") + "</span>";
  }

  function createWorldBook() {
    var now = Date.now();
    window.AppStorage.addWorldBook({
      id: String(now),
      name: "未命名世界书",
      description: "",
      entries: [],
      enabled: true,
      scope: "global",
      targetIds: [],
      createdAt: now,
      updatedAt: now
    });
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
        '<div class="empty-state compact-empty">',
        '  <div class="empty-visual" aria-hidden="true"><span class="empty-dot"></span></div>',
        "  <h3>世界书还是空的</h3>",
        "  <p>把世界观、地点、规则和长期设定整理成资料卡，AI 回复时会按关键词引用。</p>",
        '  <button class="full-button" type="button" data-world-action="create">新建世界书</button>',
        "</div>"
      ].join("");
      bindWorldBookActions(content);
      return;
    }

    content.innerHTML = [
      '<div class="notebook-list">',
      books.map(renderWorldBookCard).join(""),
      "</div>"
    ].join("");
    bindWorldBookActions(content);
  }

  function renderWorldBookCard(book) {
    return [
      '<article class="world-book-card" data-book-id="' + escapeHtml(book.id) + '">',
      '  <div class="section-title-row">',
      "    <h3>资料本</h3>",
      '    <span>' + (book.enabled ? "已启用" : "已禁用") + "</span>",
      "  </div>",
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
      '  <div class="world-entry-list">',
      "    " + (book.entries || []).map(renderWorldBookEntry).join(""),
      "  </div>",
      '  <div class="settings-action-row">',
      '    <button class="outline-button" type="button" data-world-action="add-entry">新建条目</button>',
      '    <button class="outline-button" type="button" data-world-action="duplicate-book">复制世界书</button>',
      '    <button class="outline-button" type="button" data-world-action="export-book">导出 JSON</button>',
      '    <button class="outline-button" type="button" data-world-action="import-book">导入 JSON</button>',
      '    <button class="outline-button" type="button" data-world-action="save-book">保存世界书</button>',
      '    <button class="outline-button danger" type="button" data-world-action="delete-book">删除</button>',
      "  </div>",
      "</article>"
    ].join("");
  }

  function renderScopeOptions(scope) {
    return [
      '<option value="global"' + (scope === "global" ? " selected" : "") + ">全局</option>",
      '<option value="private"' + (scope === "private" ? " selected" : "") + ">指定私聊</option>",
      '<option value="group"' + (scope === "group" ? " selected" : "") + ">指定群聊</option>"
    ].join("");
  }

  function renderWorldBookEntry(entry) {
    return [
      '<section class="world-entry-card" data-entry-id="' + escapeHtml(entry.id) + '">',
      '  <div class="settings-inline-grid">',
      '    <label><span>标题</span><input data-entry-field="title" type="text" value="' + escapeHtml(entry.title) + '" maxlength="60"></label>',
      '    <label><span>优先级</span><input data-entry-field="priority" type="number" value="' + escapeHtml(entry.priority || 0) + '"></label>',
      "  </div>",
      '  <label class="switch-row"><input data-entry-field="enabled" type="checkbox"' + (entry.enabled ? " checked" : "") + ">启用条目</label>",
      '  <div class="field-group">',
      '    <label>关键词</label>',
      '    <input data-entry-field="keywords" type="text" value="' + escapeHtml((entry.keywords || []).join(", ")) + '" placeholder="学校, 图书馆, 宿舍">',
      "  </div>",
      '  <div class="field-group">',
      '    <label>内容</label>',
      '    <textarea data-entry-field="content">' + escapeHtml(entry.content) + "</textarea>",
      "  </div>",
      '  <div class="settings-action-row compact-action-row">',
      '    <button class="outline-button" type="button" data-world-action="entry-up">上移</button>',
      '    <button class="outline-button" type="button" data-world-action="entry-down">下移</button>',
      '    <button class="outline-button" type="button" data-world-action="duplicate-entry">复制</button>',
      '    <button class="outline-button danger" type="button" data-world-action="delete-entry">删除</button>',
      "  </div>",
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

      if (!book) {
        return;
      }

      if (button.dataset.worldAction === "save-book") {
        window.AppStorage.updateWorldBook(bookId, collectWorldBookFromCard(card, book));
        renderWorldBookScreen();
        return;
      }

      if (button.dataset.worldAction === "add-entry") {
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

      if (button.dataset.worldAction === "import-book") {
        getElement("worldBookImportInput").click();
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
        renderWorldBookScreen();
      }
    };
  }

  function collectWorldBookFromCard(card, book, options) {
    var next = {
      name: getScopedFieldValue(card, "[data-book-field='name']") || "未命名世界书",
      description: getScopedFieldValue(card, "[data-book-field='description']"),
      enabled: Boolean(card.querySelector("[data-book-field='enabled']").checked),
      scope: getScopedFieldValue(card, "[data-book-field='scope']") || "global",
      targetIds: getScopedFieldValue(card, "[data-book-field='targetIds']").split(/[,，\s]+/).map(function (id) { return id.trim(); }).filter(Boolean),
      entries: []
    };

    Array.prototype.forEach.call(card.querySelectorAll(".world-entry-card"), function (entryCard) {
      var existing;
      var entry;

      if (options && options.deleteEntryId === entryCard.dataset.entryId) {
        return;
      }

      existing = (book.entries || []).find(function (item) { return item.id === entryCard.dataset.entryId; });
      entry = {
        id: entryCard.dataset.entryId,
        title: getScopedFieldValue(entryCard, "[data-entry-field='title']") || "未命名条目",
        keywords: getScopedFieldValue(entryCard, "[data-entry-field='keywords']").split(/[,，\s]+/).map(function (keyword) { return keyword.trim(); }).filter(Boolean),
        content: getScopedFieldValue(entryCard, "[data-entry-field='content']"),
        enabled: Boolean(entryCard.querySelector("[data-entry-field='enabled']").checked),
        priority: Number(getScopedFieldValue(entryCard, "[data-entry-field='priority']")) || 0,
        createdAt: existing && existing.createdAt || Date.now(),
        updatedAt: Date.now()
      };
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
        keywords: [],
        content: "",
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
      chatText: chatText,
      groupText: groupText,
      offlineText: offlineText,
      thoughtText: thoughtText,
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
    var groups = window.AppStorage.getGroups().filter(function (group) {
      return (group.memberIds || []).indexOf(character.id) !== -1;
    });

    return [
      '<article class="space-profile-card">',
      renderSmallAvatar(character, "space-avatar"),
      '  <div><h3>' + escapeHtml(character.name) + "</h3><p>" + escapeHtml(character.identity || character.relationship || "未设置身份") + "</p></div>",
      "</article>",
      '<section class="form-section"><div class="section-title-row"><h3>角色资料</h3><span>Profile</span></div>',
      '<p class="space-copy">' + escapeHtml(character.personality || "暂无性格设定") + "</p>",
      '<p class="space-copy">' + escapeHtml(character.background || "暂无背景故事") + "</p>",
      '<p class="space-copy">' + escapeHtml(character.speakingStyle || "暂无说话风格") + "</p>",
      '<div class="settings-action-row"><button class="outline-button" type="button" data-space-action="open-chat">和 TA 私聊</button><button class="outline-button" type="button" data-space-action="edit-character">编辑角色</button></div></section>',
      '<section class="form-section"><div class="section-title-row"><h3>角色记忆</h3><span>' + memories.length + " 条</span></div>" + renderSimpleList(memories.map(function (memory) { return memory.content; }), "暂无记忆") + '<button class="outline-button danger" type="button" data-space-action="clear-memory">清空记忆</button></section>',
      '<section class="form-section"><div class="section-title-row"><h3>角色心声</h3><span>' + thoughts.length + " 条</span></div>" + renderSimpleList(thoughts.slice(0, 5).map(function (thought) { return thought.visibleSummary || thought.content; }), "暂无心声") + '<div class="settings-action-row"><button class="outline-button" type="button" data-space-action="open-thoughts">查看全部心声</button><button class="outline-button danger" type="button" data-space-action="clear-thoughts">清空心声</button></div></section>',
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
        window.AppStorage.clearCharacterMemory(characterSpaceId);
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
    renderThoughtsScreen(character ? character.name + "的心声" : "心声", characterId ? [characterId] : []);
    setActivePage("thoughtsScreen");
  }

  function openThoughtsForGroup(groupId, returnPage) {
    var group = window.AppStorage.getGroups().find(function (item) {
      return item.id === groupId;
    });
    thoughtsReturnPage = returnPage || getActivePage() || "homeScreen";
    renderThoughtsScreen(group ? group.name + " · 成员心声" : "成员心声", group ? group.memberIds || [] : [], groupId);
    setActivePage("thoughtsScreen");
  }

  function renderThoughtsScreen(title, characterIds, chatId) {
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
      '  <label><span>角色</span><select data-thought-filter="character"><option value="all">全部角色</option>' + (thoughtsState.characterIds || []).map(function (characterId) {
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

  function loadSettingsIntoForm() {
    var settings = window.AppStorage.getSettings();
    var savedTip = getElement("settingsSavedTip");

    getElement("apiUrl").value = settings.apiUrl;
    getElement("apiKey").value = settings.apiKey;
    getElement("modelName").value = settings.modelName;

    if (savedTip) {
      savedTip.textContent = "";
      savedTip.classList.remove("error");
    }
  }

  function saveSettingsFromForm() {
    window.AppStorage.saveSettings(getSettingsFromForm());
    showSettingsTip("设置已保存");
  }

  function getSettingsFromForm() {
    return {
      apiUrl: getElement("apiUrl").value.trim(),
      apiKey: getElement("apiKey").value.trim(),
      modelName: getElement("modelName").value.trim()
    };
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
    link.download = "my-ai-app-backup-" + Date.now() + ".json";
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

  function updateStatusTime() {
    var statusTime = getElement("statusTime");
    var now = new Date();
    var hours = String(now.getHours()).padStart(2, "0");
    var minutes = String(now.getMinutes()).padStart(2, "0");

    if (statusTime) {
      statusTime.textContent = hours + ":" + minutes;
    }
  }

  function initApp() {
    applySavedTheme();
    bindHomeActions();
    bindNavigationActions();
    bindForms();
    bindChatMenuActions();
    bindGroupMenuActions();
    bindDataManagementActions();
    bindGlobalActions();
    bindMessageActionSheet();
    bindWeChatModal();
    updateStatusTime();
    window.setInterval(updateStatusTime, 30000);
    window.CharacterManager.renderCharacterList();
    window.GroupManager.renderGroupList();
    loadSettingsIntoForm();
    refreshHomeSummary();
    setActivePage("homeScreen");
  }

  window.setActivePage = setActivePage;
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
    openChatSearchSheet: openChatSearchSheet,
    openOfflineSceneSheet: openOfflineSceneSheet,
    showSheet: showWeChatSheet,
    close: closeWeChatSheet
  };
  window.AppNavigation = {
    getActivePage: getActivePage,
    refreshHomeSummary: refreshHomeSummary
  };
  window.AppExtras = {
    openThoughtsForCharacter: openThoughtsForCharacter,
    openThoughtsForGroup: openThoughtsForGroup,
    openCharacterSpaceScreen: openCharacterSpaceScreen,
    openDiaryScreen: openDiaryScreen,
    renderWorldBookScreen: renderWorldBookScreen,
    renderDiaryScreen: renderDiaryScreen,
    renderCharacterSpaceScreen: renderCharacterSpaceScreen,
    renderWechatScreen: renderWechatScreen
  };

  document.addEventListener("DOMContentLoaded", initApp);
})(window, document);
