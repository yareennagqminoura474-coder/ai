(function (window, document) {
  "use strict";

  var activeCharacterId = "";
  var createReturnPage = "characterListScreen";
  var formMode = "create";
  var editingCharacterId = "";
  var selectedAvatar = "";
  var isSending = false;
  var isCharacterSelectionMode = false;
  var selectedCharacterIds = [];
  var isPrivateMessageSelectionMode = false;
  var selectedPrivateMessageIds = [];
  var INITIAL_PRIVATE_RENDER_LIMIT = 60;
  var privateVisibleMessageCounts = {};
  var privateHistoryLoadSuppressedUntil = {};
  var privateInputDrafts = {};
  var currentChatRenderToken = "";

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

  function formatAmount(value) {
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

  function normalizeMoneyMessage(message) {
    if (window.AppStorage && window.AppStorage.normalizeMoneyMessage) {
      return window.AppStorage.normalizeMoneyMessage(message);
    }

    if (!message || (message.type !== "redPacket" && message.type !== "transfer")) {
      return message;
    }

    message.amount = normalizeMoneyAmount(message.amount);
    return message.amount ? message : null;
  }

  function hasValidMoneyAmount(message) {
    return Boolean(normalizeMoneyMessage(message));
  }

  function normalizeDisplayText(text) {
    if (window.AIService && window.AIService.normalizeAiMessageText) {
      return window.AIService.normalizeAiMessageText(text);
    }

    return String(text || "").trim();
  }

  function showEmptyAiReplyToast() {
    if (window.AppExtras && window.AppExtras.showToast) {
      window.AppExtras.showToast("这次没回出来，重试一下", true);
    }
  }

  function normalizeReplyItemsForDisplay(replies) {
    if (window.AIService && window.AIService.normalizeReplyList) {
      return window.AIService.normalizeReplyList("", replies, {
        min: 10,
        max: 50,
        defaultType: "text",
        allowRawFallback: false
      });
    }

    return (Array.isArray(replies) ? replies : []).map(function (reply) {
      var source = reply && typeof reply === "object" ? reply : { content: reply };
      return Object.assign({}, source, {
        content: normalizeDisplayText(source.content || "")
      });
    }).filter(function (reply) {
      return reply.content;
    });
  }

  function getBubbleTextClass(text) {
    var value = normalizeDisplayText(text);

    return value.length > 0 && value.length <= 6 && value.indexOf("\n") === -1 ? " short-text" : "";
  }

  function captureChatScrollState(wrap) {
    if (!wrap) {
      return null;
    }

    return {
      scrollTop: wrap.scrollTop,
      scrollHeight: wrap.scrollHeight,
      nearBottom: wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight <= 80
    };
  }

  function restoreChatScrollState(wrap, state, isStillActive) {
    if (!wrap || !state) {
      return;
    }

    requestAnimationFrame(function () {
      var maxScrollTop;

      if (typeof isStillActive === "function" && !isStillActive()) {
        return;
      }

      if (state.nearBottom) {
        wrap.scrollTop = wrap.scrollHeight;
        return;
      }

      maxScrollTop = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
      wrap.scrollTop = Math.min(Math.max(0, state.scrollTop), maxScrollTop);
    });
  }

  function suppressPrivateHistoryLoad(characterId) {
    privateHistoryLoadSuppressedUntil[characterId] = Date.now() + 700;
  }

  function isPrivateHistoryLoadSuppressed(characterId) {
    return Date.now() < (privateHistoryLoadSuppressedUntil[characterId] || 0);
  }

  function getActivePage() {
    if (window.AppNavigation && window.AppNavigation.getActivePage) {
      return window.AppNavigation.getActivePage();
    }

    return "homeScreen";
  }

  function refreshHomeSummary() {
    if (window.AppNavigation && window.AppNavigation.refreshHomeSummary) {
      window.AppNavigation.refreshHomeSummary();
    }
  }

  function getCharacterById(characterId) {
    return window.AppStorage.getCharacters().find(function (character) {
      return character.id === characterId;
    });
  }

  function getAvatarText(character) {
    var name = character && character.name ? character.name.trim() : "";
    return name ? name.slice(0, 1) : "心";
  }

  function renderAvatar(character, className) {
    if (character && character.avatar) {
      return '<img class="' + className + ' has-image" src="' + escapeHtml(character.avatar) + '" alt="' + escapeHtml(character.name || "角色") + '头像">';
    }

    return '<span class="' + className + '" aria-hidden="true">' + escapeHtml(getAvatarText(character)) + "</span>";
  }

  function renderUserAvatar(user, className) {
    var source = user || {};

    if (source.avatar) {
      return '<img class="' + className + ' has-image user-message-avatar" src="' + escapeHtml(source.avatar) + '" alt="' + escapeHtml(source.name || "我") + '头像">';
    }

    return '<span class="' + className + ' user-message-avatar" aria-hidden="true">我</span>';
  }

  function getPrivateUserDisplay(character, settings) {
    var chatSettings = settings || getPrivateChatSettings(character);
    var profile = window.AppStorage.getUserProfile ? window.AppStorage.getUserProfile() : {};
    var resolved = window.AppStorage.resolveUserPersona
      ? window.AppStorage.resolveUserPersona(chatSettings.userPersonaId, chatSettings.userPersonaOverride)
      : null;

    return {
      name: resolved && resolved.name || profile.name || "我",
      avatar: resolved && resolved.avatar || profile.avatar || ""
    };
  }

  function renderPrivateUserMessageAvatar(character, settings) {
    var chatSettings = settings || getPrivateChatSettings(character);

    if (chatSettings.hideUserAvatar) {
      return "";
    }

    return renderUserAvatar(getPrivateUserDisplay(character, chatSettings), "message-avatar");
  }

  function getCharacterSummary(character) {
    var persona = buildCharacterPersonaText(character);

    if (persona) {
      return persona;
    }
    return "这个角色还没有补充详细人设。";
  }

  function addPersonaPart(parts, seen, label, value) {
    var text = String(value || "").trim();
    var key;

    if (!text || text === "未设定") {
      return;
    }

    key = text.toLowerCase();
    if (seen[key]) {
      return;
    }

    seen[key] = true;
    parts.push(label ? label + "：" + text : text);
  }

  function buildCharacterPersonaText(character) {
    var source = character || {};
    var parts = [];
    var seen = {};

    addPersonaPart(parts, seen, "", source.personality);
    addPersonaPart(parts, seen, "身份", source.identity);
    addPersonaPart(parts, seen, "关系", source.relationship);
    addPersonaPart(parts, seen, "说话方式", source.speakingStyle);
    addPersonaPart(parts, seen, "背景", source.background);
    addPersonaPart(parts, seen, "性别", source.gender);

    return parts.join("\n\n");
  }

  function renderCharacterList() {
    var listContent = getElement("characterListContent");
    var characters = window.AppStorage.getCharacters();
    var characterIds = characters.map(function (character) {
      return character.id;
    });

    if (!listContent) {
      return;
    }

    closeAllMenus();
    selectedCharacterIds = selectedCharacterIds.filter(function (characterId) {
      return characterIds.indexOf(characterId) !== -1;
    });

    if (characters.length === 0) {
      isCharacterSelectionMode = false;
      selectedCharacterIds = [];
      updateCharacterSelectionButton();
      listContent.classList.remove("selection-mode");
      listContent.innerHTML = [
        '<div class="empty-state">',
        '  <div class="empty-visual" aria-hidden="true"><span class="empty-dot"></span></div>',
        "  <h3>还没有角色</h3>",
        "  <p>创建你的第一个角色，开始一段新的故事</p>",
        '  <button id="emptyCreateCharacterBtn" class="full-button" type="button">创建角色</button>',
        "</div>"
      ].join("");

      getElement("emptyCreateCharacterBtn").addEventListener("click", openCreateCharacterScreen);
      return;
    }

    updateCharacterSelectionButton();
    listContent.classList.toggle("selection-mode", isCharacterSelectionMode);
    listContent.innerHTML = [
      '<div class="character-list">',
      characters.map(function (character) {
        var lastMessage = getLastMessagePreview(character.id);
        var selected = selectedCharacterIds.indexOf(character.id) !== -1;

        return [
          '<article class="character-card ' + (isCharacterSelectionMode ? "selection-mode " : "") + (selected ? "selected" : "") + '" data-character-id="' + escapeHtml(character.id) + '">',
          '  <button class="character-card-main" type="button">',
          isCharacterSelectionMode ? '    <span class="select-check ' + (selected ? "active" : "") + '" aria-hidden="true"></span>' : "",
          "    " + renderAvatar(character, "character-avatar"),
          '    <span class="character-info">',
          '      <span class="character-title-row">',
          "        <h3>" + escapeHtml(character.name) + "</h3>",
          "      </span>",
          '      <span class="character-desc">' + escapeHtml(getCharacterSummary(character)) + "</span>",
          '      <span class="character-last">' + escapeHtml(lastMessage) + "</span>",
          "    </span>",
          "  </button>",
          isCharacterSelectionMode ? "" : [
          '  <div class="card-actions">',
          '    <button class="card-more" type="button" aria-label="更多角色操作">···</button>',
          '    <div class="action-menu card-action-menu hidden" aria-label="角色操作菜单">',
          '      <button class="menu-edit" type="button">编辑</button>',
          '      <button class="menu-delete danger-text" type="button">删除</button>',
          "    </div>",
          "  </div>",
          ].join(""),
          "</article>"
        ].join("");
      }).join(""),
      "</div>",
      isCharacterSelectionMode ? renderCharacterBatchActionBar(characters.length) : ""
    ].join("");

    bindCharacterListActions(listContent);
  }

  function bindCharacterListActions(listContent) {
    Array.prototype.forEach.call(listContent.querySelectorAll(".character-card-main"), function (button) {
      button.addEventListener("click", function () {
        var card = button.closest(".character-card");
        closeAllMenus();
        if (isCharacterSelectionMode) {
          toggleCharacterSelection(card.dataset.characterId);
          return;
        }
        openChatScreen(card.dataset.characterId);
      });
    });

    Array.prototype.forEach.call(listContent.querySelectorAll("[data-character-batch-action]"), function (button) {
      button.addEventListener("click", function () {
        handleCharacterBatchAction(button.dataset.characterBatchAction);
      });
    });

    Array.prototype.forEach.call(listContent.querySelectorAll(".card-more"), function (button) {
      button.addEventListener("click", function (event) {
        var card = button.closest(".character-card");
        event.stopPropagation();
        toggleCardMenu(card);
      });
    });

    Array.prototype.forEach.call(listContent.querySelectorAll(".menu-edit"), function (button) {
      button.addEventListener("click", function (event) {
        var card = button.closest(".character-card");
        event.stopPropagation();
        openEditCharacterScreen(card.dataset.characterId);
      });
    });

    Array.prototype.forEach.call(listContent.querySelectorAll(".menu-delete"), function (button) {
      button.addEventListener("click", function (event) {
        var card = button.closest(".character-card");
        event.stopPropagation();
        deleteCharacterWithConfirm(card.dataset.characterId);
      });
    });
  }

  function renderCharacterBatchActionBar(totalCount) {
    return [
      '<div class="batch-action-bar" aria-label="角色批量操作">',
      '  <span class="batch-action-count">已选 ' + selectedCharacterIds.length + ' 个</span>',
      '  <button class="batch-action-button" type="button" data-character-batch-action="all">' + (selectedCharacterIds.length === totalCount ? "取消全选" : "全选") + '</button>',
      '  <button class="batch-action-button batch-action-danger" type="button" data-character-batch-action="delete">删除</button>',
      '  <button class="batch-action-button" type="button" data-character-batch-action="cancel">取消</button>',
      "</div>"
    ].join("");
  }

  function updateCharacterSelectionButton() {
    var button = getElement("characterBatchSelectBtn");

    if (button) {
      button.textContent = isCharacterSelectionMode ? "取消" : "选择";
    }
  }

  function toggleCharacterSelectionMode() {
    isCharacterSelectionMode = !isCharacterSelectionMode;
    selectedCharacterIds = [];
    renderCharacterList();
  }

  function toggleCharacterSelection(characterId) {
    var index = selectedCharacterIds.indexOf(characterId);

    if (index === -1) {
      selectedCharacterIds.push(characterId);
    } else {
      selectedCharacterIds.splice(index, 1);
    }

    renderCharacterList();
  }

  function handleCharacterBatchAction(action) {
    var characters = window.AppStorage.getCharacters();

    if (action === "all") {
      selectedCharacterIds = selectedCharacterIds.length === characters.length
        ? []
        : characters.map(function (character) {
          return character.id;
        });
      renderCharacterList();
      return;
    }

    if (action === "cancel") {
      isCharacterSelectionMode = false;
      selectedCharacterIds = [];
      renderCharacterList();
      return;
    }

    if (action === "delete") {
      deleteSelectedCharacters();
    }
  }

  function deleteSelectedCharacters() {
    var ids = selectedCharacterIds.slice();

    if (!ids.length) {
      return;
    }

    if (!window.confirm("确定删除选中的 " + ids.length + " 个角色吗？聊天记录、记忆和心声也会一起删除。")) {
      return;
    }

    ids.forEach(function (characterId) {
      window.AppStorage.deleteCharacter(characterId);
    });

    if (ids.indexOf(activeCharacterId) !== -1) {
      activeCharacterId = "";
    }

    isCharacterSelectionMode = false;
    selectedCharacterIds = [];
    renderCharacterList();
    refreshHomeSummary();
  }

  function getLastMessagePreview(characterId) {
    var history = window.AppStorage.getChatHistory(characterId);
    var lastMessage = getLastVisibleMessage(history);

    if (!lastMessage) {
      return "最近消息会显示在这里";
    }

    return lastMessage.role === "user" ? "我：" + formatMessagePreview(lastMessage) : formatMessagePreview(lastMessage);
  }

  function getLastVisibleMessage(history) {
    var messages = Array.isArray(history) ? history : [];
    var index;

    for (index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index] && messages[index].role !== "system" && messages[index].type !== "loading" && messages[index].type !== "pat") {
        return messages[index];
      }
    }

    return null;
  }

  function formatMessagePreview(message) {
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

  function openCreateCharacterScreen() {
    var form = getElement("createCharacterForm");
    var currentPage = getActivePage();

    formMode = "create";
    editingCharacterId = "";
    selectedAvatar = "";
    createReturnPage = currentPage === "createCharacterScreen" ? "characterListScreen" : currentPage;

    setFormModeLabels();
    hideFormError();
    if (form) {
      form.reset();
    }
    updateAvatarPreview();
    closeAllMenus();

    window.setActivePage("createCharacterScreen");
  }

  function openEditCharacterScreen(characterId) {
    var character = getCharacterById(characterId);
    var form = getElement("createCharacterForm");

    if (!character) {
      renderCharacterList();
      window.setActivePage("characterListScreen");
      return;
    }

    formMode = "edit";
    editingCharacterId = characterId;
    selectedAvatar = character.avatar || "";
    createReturnPage = getActivePage();

    setFormModeLabels();
    hideFormError();
    if (form) {
      form.reset();
    }
    fillCharacterForm(character);
    updateAvatarPreview();
    closeAllMenus();

    window.setActivePage("createCharacterScreen");
  }

  function closeCreateCharacterScreen() {
    window.setActivePage(createReturnPage || "characterListScreen");
  }

  function setFormModeLabels() {
    var title = getElement("createCharacterTitle");
    var saveButton = getElement("saveCharacterBtn");

    if (title) {
      title.textContent = formMode === "edit" ? "编辑角色" : "创建角色";
    }

    if (saveButton) {
      saveButton.textContent = formMode === "edit" ? "更新" : "保存";
    }
  }

  function fillCharacterForm(character) {
    var momentSettings = getCharacterMomentSettings(character);
    var diarySettings = getCharacterDiarySettings(character);

    setFieldValue("characterName", character.name);
    setFieldValue("characterPersonality", buildCharacterPersonaText(character));
    setFieldValue("characterOpeningMessage", character.openingMessage);
    setCheckedValue("characterMomentAutoPost", momentSettings.autoPostEnabled);
    setFieldValue("characterMomentFrequency", momentSettings.frequency);
    setCheckedValue("characterMomentAllowComments", momentSettings.allowRelatedCharacterComments);
    setCheckedValue("characterDiaryAuto", diarySettings.autoDiaryEnabled);
    setFieldValue("characterDiaryFrequency", diarySettings.frequency);
    setCheckedValue("characterDiaryUseChat", diarySettings.allowUseChatHistory);
    setCheckedValue("characterDiaryUseThoughts", diarySettings.allowUseThoughts);
  }

  function setFieldValue(id, value) {
    var field = getElement(id);
    if (field) {
      field.value = value || "";
    }
  }

  function setCheckedValue(id, checked) {
    var field = getElement(id);
    if (field) {
      field.checked = Boolean(checked);
    }
  }

  function getCheckedValue(id) {
    var field = getElement(id);
    return Boolean(field && field.checked);
  }

  function saveCharacterFromForm() {
    var form = getElement("createCharacterForm");
    var nameInput = getElement("characterName");
    var name = nameInput ? nameInput.value.trim() : "";
    var character;

    if (!name) {
      showFormError("角色名称不能为空");
      if (nameInput) {
        nameInput.focus();
      }
      return;
    }

    character = buildCharacterFromForm(name);

    if (formMode === "edit") {
      updateExistingCharacter(character);
    } else {
      window.AppStorage.addCharacter(character);
      afterCharacterSaved();
    }

    if (form) {
      form.reset();
    }
    selectedAvatar = "";
    updateAvatarPreview();
  }

  function buildCharacterFromForm(name) {
    var now = Date.now();
    var existing = editingCharacterId ? getCharacterById(editingCharacterId) : null;

    return {
      id: existing ? existing.id : String(now),
      name: name,
      avatar: selectedAvatar || "",
      gender: "",
      identity: "",
      personality: getFieldValue("characterPersonality"),
      background: "",
      speakingStyle: "",
      relationship: "",
      openingMessage: getFieldValue("characterOpeningMessage"),
      chatSettings: existing && existing.chatSettings ? existing.chatSettings : undefined,
      momentSettings: {
        autoPostEnabled: getCheckedValue("characterMomentAutoPost"),
        frequency: getFieldValue("characterMomentFrequency") || "normal",
        allowRelatedCharacterComments: getCheckedValue("characterMomentAllowComments"),
        lastGeneratedAt: existing && existing.momentSettings ? Number(existing.momentSettings.lastGeneratedAt) || 0 : 0
      },
      diarySettings: {
        autoDiaryEnabled: getCheckedValue("characterDiaryAuto"),
        frequency: getFieldValue("characterDiaryFrequency") || "daily",
        allowUseChatHistory: getCheckedValue("characterDiaryUseChat"),
        allowUseThoughts: getCheckedValue("characterDiaryUseThoughts")
      },
      createdAt: existing ? existing.createdAt : now
    };
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

  function updateExistingCharacter(character) {
    var updatedCharacter = window.AppStorage.updateCharacter(editingCharacterId, character);

    if (!updatedCharacter) {
      showFormError("没有找到要更新的角色");
      return;
    }

    syncOpeningMessageAfterUpdate(updatedCharacter);
    afterCharacterSaved(updatedCharacter.id);
  }

  function afterCharacterSaved(updatedCharacterId) {
    hideFormError();
    renderCharacterList();
    refreshHomeSummary();

    if (createReturnPage === "chatScreen" && updatedCharacterId) {
      openChatScreen(updatedCharacterId);
      return;
    }

    if (createReturnPage === "wechatScreen") {
      window.setActivePage("wechatScreen");
      return;
    }

    window.setActivePage(createReturnPage || "characterListScreen");
  }

  function getFieldValue(id) {
    var field = getElement(id);
    return field ? field.value.trim() : "";
  }

  function showFormError(message) {
    var error = getElement("formError");
    if (!error) {
      return;
    }

    error.textContent = message;
    error.classList.add("show");
  }

  function hideFormError() {
    var error = getElement("formError");
    if (!error) {
      return;
    }

    error.textContent = "";
    error.classList.remove("show");
  }

  function handleAvatarFileChange(event) {
    var input = event.target;
    var file = input.files && input.files[0];
    var reader;

    if (!file) {
      return;
    }

    if (!file.type || file.type.indexOf("image/") !== 0) {
      showFormError("请选择图片文件");
      input.value = "";
      return;
    }

    reader = new FileReader();
    reader.onload = function () {
      selectedAvatar = String(reader.result || "");
      hideFormError();
      updateAvatarPreview();
      input.value = "";
    };
    reader.onerror = function () {
      showFormError("头像读取失败，请重新选择");
      input.value = "";
    };
    reader.readAsDataURL(file);
  }

  function updateAvatarPreview() {
    var image = getElement("avatarImagePreview");
    var text = getElement("avatarTextPreview");

    if (!image || !text) {
      return;
    }

    if (selectedAvatar) {
      image.src = selectedAvatar;
      image.classList.remove("hidden");
      text.classList.add("hidden");
      return;
    }

    image.removeAttribute("src");
    image.classList.add("hidden");
    text.textContent = "+";
    text.classList.remove("hidden");
  }

  function saveActivePrivateInputDraft() {
    var input = getElement("chatInput");

    if (input && activeCharacterId) {
      privateInputDrafts[activeCharacterId] = input.value || "";
    }
  }

  function restorePrivateInputDraft(characterId) {
    var input = getElement("chatInput");

    if (input) {
      input.value = privateInputDrafts[characterId] || "";
    }
  }

  function handlePrivateInputDraftChange() {
    saveActivePrivateInputDraft();
  }

  function syncRecentGroupContextToPrivateMemory(characterId) {
    if (!window.GroupManager || !window.AppStorage || !window.AppStorage.addChatMemory || !window.AppStorage.getGroups || !window.AppStorage.getGroupChatHistory) {
      return;
    }

    var groupId = window.GroupManager.getActiveGroupId && window.GroupManager.getActiveGroupId();
    if (!groupId) {
      return;
    }

    var group = (window.AppStorage.getGroups() || []).find(function (item) {
      return item && item.id === groupId;
    });
    if (!group || !Array.isArray(group.memberIds) || group.memberIds.indexOf(characterId) === -1) {
      return;
    }

    var history = (window.AppStorage.getGroupChatHistory(groupId) || []).filter(function (message) {
      return message && message.content && message.type !== "loading" && message.type !== "error";
    }).slice(-4).map(function (message) {
      return (message.role === "user" ? "你：" : (message.characterName || "角色") + "：") + message.content;
    }).join("\n");

    if (!history) {
      return;
    }

    var title = "来自群聊《" + (group.name || "群聊") + "》的最近上下文";
    var existing = window.AppStorage.getChatMemories("private", characterId) || [];
    var newContent = "最近你在群聊《" + (group.name || "群聊") + "》中的互动如下：\n" + history;

    // find existing memory for same group (prefer groupId match if present)
    var foundIndex = -1;
    for (var i = 0; i < existing.length; i++) {
      var item = existing[i];
      if (!item) { continue; }
      if (item.groupId && String(item.groupId) === String(group.id)) {
        foundIndex = i;
        break;
      }
      if (item.title && item.title.indexOf("来自群聊《" + (group.name || "群聊") + "》") === 0) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex !== -1 && existing[foundIndex] && existing[foundIndex].id) {
      // update existing memory content and timestamps
      try {
        window.AppStorage.updateChatMemory("private", characterId, existing[foundIndex].id, {
          content: newContent,
          updatedAt: Date.now(),
          sourceTime: Date.now(),
          groupId: group.id
        });
      } catch (e) {
        // fallback to add if update not supported
        window.AppStorage.addChatMemory("private", characterId, {
          title: title,
          content: newContent,
          sourceTime: Date.now(),
          type: "auto",
          source: "group",
          generationId: "",
          sourceGenerationId: "",
          targetType: "private",
          targetId: characterId,
          groupId: group.id,
          createdAt: Date.now()
        });
      }
    } else {
      window.AppStorage.addChatMemory("private", characterId, {
        title: title,
        content: newContent,
        sourceTime: Date.now(),
        type: "auto",
        source: "group",
        generationId: "",
        sourceGenerationId: "",
        targetType: "private",
        targetId: characterId,
        groupId: group.id,
        createdAt: Date.now()
      });
    }
  }

  function openChatScreen(characterId) {
    var character = getCharacterById(characterId);
    var token;

    if (!character) {
      renderCharacterList();
      window.setActivePage("characterListScreen");
      return;
    }

    saveActivePrivateInputDraft();
    syncRecentGroupContextToPrivateMemory(characterId);
    activeCharacterId = characterId;
    if (window.GroupManager && window.GroupManager.deactivateActiveGroup) {
      window.GroupManager.deactivateActiveGroup();
    }
    token = Date.now() + "_" + Math.random().toString(36).slice(2) + "_" + characterId;
    currentChatRenderToken = token;
    isPrivateMessageSelectionMode = false;
    selectedPrivateMessageIds = [];
    privateVisibleMessageCounts[characterId] = INITIAL_PRIVATE_RENDER_LIMIT;
    updateChatHeader(character);
    renderChatOpeningPlaceholder(character);
    restorePrivateInputDraft(characterId);
    updateInlineOfflineUi();
    updatePrivateBlockUi(characterId);
    closeAllMenus();
    ensureOpeningMessage(character);
    window.setActivePage("chatScreen");
    updateThoughtButton(characterId);
    requestAnimationFrame(function () {
      if (currentChatRenderToken !== token || activeCharacterId !== characterId) {
        return;
      }
      renderChatMessages(characterId);
    });
  }

  function updateChatHeader(character) {
    var title = getElement("chatTitle");
    var avatar = getElement("chatHeaderAvatar");
    var settings = getPrivateChatSettings(character);

    if (title) {
      title.textContent = settings.remarkName || character.name;
    }

    if (!avatar) {
      return;
    }

    avatar.innerHTML = character.avatar
      ? '<img src="' + escapeHtml(character.avatar) + '" alt="">'
      : escapeHtml(getAvatarText(character));
  }

  function renderChatOpeningPlaceholder(character) {
    var messagesWrap = getElement("chatMessages");
    var settings = getPrivateChatSettings(character);

    if (!messagesWrap) {
      return;
    }

    messagesWrap.classList.remove("selection-mode");
    applyChatBackground(messagesWrap, settings.chatBackground);
    messagesWrap.innerHTML = [
      '<div class="chat-opening-placeholder" aria-live="polite">',
      '  <span class="chat-opening-dot"></span>',
      "  <em>正在打开聊天...</em>",
      "</div>"
    ].join("");
    messagesWrap.scrollTop = 0;
  }

  function ensureOpeningMessage(character) {
    if (!character.openingMessage) {
      return;
    }

    var history = window.AppStorage.getChatHistory(character.id);
    var hasOpening = history.some(function (message) {
      return message.type === "opening";
    });

    if (hasOpening) {
      return;
    }

    history.unshift({
      id: character.id + "-opening",
      role: "character",
      type: "opening",
      content: character.openingMessage,
      createdAt: character.createdAt || Date.now()
    });
    window.AppStorage.saveChatHistory(character.id, history);
  }

  function syncOpeningMessageAfterUpdate(character) {
    var history = window.AppStorage.getChatHistory(character.id);
    var openingMessage;
    var nextHistory;

    if (!history.length) {
      return;
    }

    openingMessage = history.find(function (message) {
      return message.type === "opening";
    });

    if (!openingMessage) {
      return;
    }

    nextHistory = history.filter(function (message) {
      return message.type !== "opening";
    });

    if (character.openingMessage) {
      nextHistory.unshift({
        id: character.id + "-opening",
        role: "character",
        type: "opening",
        content: character.openingMessage,
        createdAt: openingMessage.createdAt || character.createdAt || Date.now()
      });
    }

    window.AppStorage.saveChatHistory(character.id, nextHistory);
  }

  function renderChatMessages(characterId, options) {
    if (characterId !== activeCharacterId) {
      return;
    }

    var messagesWrap = getElement("chatMessages");
    var messages = window.AppStorage.getChatHistory(characterId);
    var character = getCharacterById(characterId);
    var settings = getPrivateChatSettings(character);
    var renderOptions = options || {};
    var visibleInfo = getPrivateVisibleMessages(characterId, messages, renderOptions);
    var visibleMessages = visibleInfo.messages;
    var messageIds = messages.map(function (message) {
      return message.id;
    });
    var selectableCount = getSelectablePrivateMessages(messages).length;

    if (!messagesWrap || !character) {
      return;
    }

    selectedPrivateMessageIds = selectedPrivateMessageIds.filter(function (messageId) {
      return messageIds.indexOf(messageId) !== -1;
    });
    messagesWrap.classList.toggle("selection-mode", isPrivateMessageSelectionMode);
    applyChatBackground(messagesWrap, settings.chatBackground);

    if (messages.length === 0) {
      messagesWrap.innerHTML = '<div class="chat-empty">开始输入消息，聊天内容会显示在这里</div>' + (isPrivateMessageSelectionMode ? renderPrivateMessageBatchActionBar(selectableCount) : "");
    } else {
      messagesWrap.innerHTML = renderPrivateLoadMoreBar(characterId, visibleInfo.hiddenCount) + renderPrivateMessagesWithDates(visibleMessages, character) + (isPrivateMessageSelectionMode ? renderPrivateMessageBatchActionBar(selectableCount) : "");
      bindPrivateLoadMore(messagesWrap, characterId);
      bindPrivateMessageActions(messagesWrap, messages);
      bindPrivateMessageDetails(messagesWrap, messages);
    }

    if (isPrivateMessageSelectionMode) {
      bindPrivateMessageBatchActions(messagesWrap, messages);
    } else {
      bindPrivateHistoryScrollLoader(messagesWrap, characterId);
    }

    if (renderOptions.restoreScrollState) {
      restoreChatScrollState(messagesWrap, renderOptions.restoreScrollState, function () {
        return characterId === activeCharacterId;
      });
    } else if (!isPrivateMessageSelectionMode && !renderOptions.skipScroll) {
      if (window.AppApiJobs && window.AppApiJobs.scheduleScrollToBottom) {
        window.AppApiJobs.scheduleScrollToBottom(messagesWrap);
      } else {
        requestAnimationFrame(function () {
          if (characterId !== activeCharacterId) {
            return;
          }
          messagesWrap.scrollTop = messagesWrap.scrollHeight;
        });
      }
    }

    updatePrivateBlockUi(characterId);
    updateThoughtButton(characterId);
  }

  function getPrivateVisibleMessages(characterId, messages, options) {
    var allMessages = Array.isArray(messages) ? messages : [];
    var forceFull = options && options.forceFull;
    var selectionFull = isPrivateMessageSelectionMode;
    var current = privateVisibleMessageCounts[characterId] || INITIAL_PRIVATE_RENDER_LIMIT;
    var count = forceFull || selectionFull ? allMessages.length : Math.min(allMessages.length, Math.max(INITIAL_PRIVATE_RENDER_LIMIT, current));

    if (!selectionFull || forceFull) {
      privateVisibleMessageCounts[characterId] = count;
    }
    return {
      messages: allMessages.slice(Math.max(0, allMessages.length - count)),
      hiddenCount: Math.max(0, allMessages.length - count)
    };
  }

  function renderPrivateLoadMoreBar(characterId, hiddenCount) {
    if (!hiddenCount) {
      return "";
    }

    return '<button class="chat-load-more" type="button" data-private-load-more="' + escapeHtml(characterId || "") + '">加载更早消息（' + hiddenCount + '）</button>';
  }

  function bindPrivateLoadMore(wrap, characterId) {
    var button = wrap ? wrap.querySelector("[data-private-load-more]") : null;

    if (!button) {
      return;
    }

    button.addEventListener("click", function () {
      privateVisibleMessageCounts[characterId] = (privateVisibleMessageCounts[characterId] || INITIAL_PRIVATE_RENDER_LIMIT) + INITIAL_PRIVATE_RENDER_LIMIT;
      renderChatMessages(characterId, { skipScroll: true });
    });
  }

  function bindPrivateHistoryScrollLoader(wrap, characterId) {
    if (!wrap || wrap.__privateHistoryLoaderBound === characterId) {
      return;
    }

    wrap.__privateHistoryLoaderBound = characterId;
    wrap.addEventListener("scroll", function () {
      if (isPrivateHistoryLoadSuppressed(characterId)) {
        return;
      }

      if (activeCharacterId !== characterId || wrap.scrollTop > 28) {
        return;
      }

      if (!wrap.querySelector("[data-private-load-more]")) {
        return;
      }

      privateVisibleMessageCounts[characterId] = (privateVisibleMessageCounts[characterId] || INITIAL_PRIVATE_RENDER_LIMIT) + INITIAL_PRIVATE_RENDER_LIMIT;
      renderChatMessages(characterId, { skipScroll: true });
    }, { passive: true });
  }

  function applyChatBackground(wrap, background) {
    if (!wrap) {
      return;
    }

    if (background) {
      wrap.classList.add("custom-chat-background");
      wrap.style.backgroundImage = 'linear-gradient(rgba(246,247,244,0.76), rgba(246,247,244,0.76)), url("' + String(background).replace(/"/g, "%22") + '")';
    } else {
      wrap.classList.remove("custom-chat-background");
      wrap.style.backgroundImage = "";
    }
  }

  function renderPrivateMessagesWithDates(messages, character) {
    var lastDateKey = "";

    return messages.map(function (message) {
      var html = "";
      var dateKey;

      if (message.type !== "loading") {
        dateKey = getDateKey(message.createdAt);
        if (dateKey && dateKey !== lastDateKey) {
          html += renderDateSeparator(message.createdAt);
          lastDateKey = dateKey;
        }
      }

      return html + renderPrivateMessage(message, character);
    }).join("");
  }

  function getDateKey(timestamp) {
    var date = new Date(timestamp || Date.now());
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function renderDateSeparator(timestamp) {
    return '<div class="chat-date-separator">' + escapeHtml(getDateLabel(timestamp)) + "</div>";
  }

  function getDateLabel(timestamp) {
    var target = new Date(timestamp || Date.now());
    var today = new Date();
    var yesterday = new Date();
    var targetKey = getDateKey(target);

    yesterday.setDate(today.getDate() - 1);

    if (targetKey === getDateKey(today)) {
      return "今天";
    }

    if (targetKey === getDateKey(yesterday)) {
      return "昨天";
    }

    return targetKey;
  }

  function renderPrivateMessage(message, character) {
    var messageId = escapeHtml(message.id || "");
    var settings = getPrivateChatSettings(character);
    var roleClass = message.role === "user" ? "user" : "character";
    var avatar = roleClass === "character" ? renderAvatar(character, "message-avatar") : renderPrivateUserMessageAvatar(character, settings);
    var bubbleClass = "message-bubble" + getBubbleTextClass(message.content);
    var selectCheck = renderPrivateMessageSelectCheck(message);

    if (message.type === "offlineUserAction") {
      return renderOfflineUserActionMessage(message, selectCheck);
    }

    if (message.type === "offlineAction") {
      return renderOfflineActionMessage(message, selectCheck);
    }

    if (message.type === "offlineSpeech") {
      return renderOfflineSpeechMessage(message, character, selectCheck);
    }

    if (message.role === "system") {
      return [
        '<div class="message-row system message-action-target" data-message-id="' + messageId + '">',
        selectCheck,
        '  <div class="group-system-message">' + escapeHtml(message.content) + renderEditedMark(message) + "</div>",
        "</div>"
      ].join("");
    }

    if (isStandaloneMessage(message)) {
      return [
        '<div class="message-row ' + roleClass + ' message-action-target" data-message-id="' + messageId + '">',
        selectCheck,
        roleClass === "user" ? renderStandaloneMessage(message) + avatar : avatar + renderStandaloneMessage(message),
        "</div>"
      ].join("");
    }

    if (message.type === "error") {
      bubbleClass += " message-error";
    }

    if (message.type === "loading") {
      bubbleClass += " typing-bubble";
    }

    return [
      '<div class="message-row ' + roleClass + ' message-action-target" data-message-id="' + messageId + '">',
      selectCheck,
      roleClass === "user"
        ? '  <div class="' + bubbleClass + '">' + renderMessageContent(message) + renderEditedMark(message) + "</div>" + avatar
        : avatar + '  <div class="' + bubbleClass + '">' + renderMessageContent(message) + renderEditedMark(message) + "</div>",
      "</div>"
    ].join("");
  }

  function renderPrivateMessageSelectCheck(message) {
    var selected;

    if (!isPrivateMessageSelectionMode || !isPrivateMessageSelectable(message)) {
      return "";
    }

    selected = selectedPrivateMessageIds.indexOf(message.id) !== -1;
    return '<button class="select-check ' + (selected ? "active" : "") + '" type="button" data-private-message-select="' + escapeHtml(message.id || "") + '" aria-label="选择消息"></button>';
  }

  function renderOfflineUserActionMessage(message, selectCheck) {
    return [
      '<div class="message-row user offline-user-action-row message-action-target" data-message-id="' + escapeHtml(message.id || "") + '">',
      selectCheck,
      '  <div class="message-bubble' + getBubbleTextClass(message.content) + '">' + escapeHtml(normalizeDisplayText(message.content)) + renderEditedMark(message) + "</div>",
      renderPrivateUserMessageAvatar(getCharacterById(activeCharacterId)),
      "</div>"
    ].join("");
  }

  function renderOfflineActionMessage(message, selectCheck) {
    return [
      '<div class="message-row system offline-action-row message-action-target" data-message-id="' + escapeHtml(message.id || "") + '">',
      selectCheck,
      '  <div class="inline-offline-action-card"><i aria-hidden="true">✦</i><span>' + escapeHtml(message.content) + renderEditedMark(message) + "</span></div>",
      "</div>"
    ].join("");
  }

  function renderOfflineSpeechMessage(message, character, selectCheck) {
    var speaker = character || { name: message.characterName || "角色" };

    return [
      '<div class="message-row character group-character-row offline-speech-row message-action-target" data-message-id="' + escapeHtml(message.id || "") + '">',
      selectCheck,
      renderAvatar(speaker, "message-avatar"),
      '  <div class="group-message-main">',
      '    <span class="group-message-name">' + escapeHtml(message.characterName || speaker.name || "角色") + "</span>",
      '    <div class="inline-offline-speech-bubble">' + escapeHtml(message.content) + renderEditedMark(message) + "</div>",
      '    <span class="inline-offline-time">' + formatInlineTime(message.createdAt) + "</span>",
      "  </div>",
      "</div>"
    ].join("");
  }

  function formatInlineTime(timestamp) {
    var date = new Date(timestamp || Date.now());
    return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  }

  function renderMessageContent(message) {
    return escapeHtml(normalizeDisplayText(message.content));
  }

  function renderEditedMark(message) {
    return message && message.edited ? '<span class="message-edited-mark">已编辑</span>' : "";
  }

  function isStandaloneMessage(message) {
    return (message.type === "redPacket" && hasValidMoneyAmount(message))
      || (message.type === "transfer" && hasValidMoneyAmount(message))
      || message.type === "location"
      || message.type === "emoji"
      || message.type === "image"
      || message.type === "voice";
  }

  function renderStandaloneMessage(message) {
    if (message.type === "redPacket") {
      return renderRedPacketCard(message);
    }

    if (message.type === "transfer") {
      return renderTransferCard(message);
    }

    if (message.type === "location") {
      return renderLocationMessage(message);
    }

    if (message.type === "emoji") {
      return renderEmojiMessage(message);
    }

    if (message.type === "image") {
      return renderImageMessage(message);
    }

    if (message.type === "voice") {
      return renderVoiceMessage(message);
    }

    return '<div class="message-bubble">' + escapeHtml(message.content) + "</div>";
  }

  function renderImageMessage(message) {
    var image = message.image || {};

    if (image.src) {
      return [
        '<button class="message-special-wrapper image-message message-detail-trigger" type="button" data-message-id="' + escapeHtml(message.id || "") + '">',
        '  <img src="' + escapeHtml(image.src) + '" alt="' + escapeHtml(image.name || "图片") + '">',
        "</button>"
      ].join("");
    }

    return [
      '<button class="message-special-wrapper ai-image-card message-detail-trigger" type="button" data-message-id="' + escapeHtml(message.id || "") + '">',
      "  <strong>[图片]</strong>",
      "  <span>" + escapeHtml(image.description || message.content || "角色发来的一张图片描述") + "</span>",
      "</button>"
    ].join("");
  }

  function renderVoiceMessage(message) {
    var voice = message.voice || {};
    var duration = voice.duration || estimateVoiceDuration(message.content);

    return [
      '<button class="message-special-wrapper voice-message message-detail-trigger" type="button" data-message-id="' + escapeHtml(message.id || "") + '">',
      '  <span class="voice-wave" aria-hidden="true"></span>',
      '  <span class="voice-duration">' + escapeHtml(String(duration)) + "''</span>",
      "</button>"
    ].join("");
  }

  function renderEmojiMessage(message) {
    if (message.emoji && message.emoji.type === "image") {
      return [
        '<span class="message-special-wrapper">',
        '  <img class="emoji-image-message" src="' + escapeHtml(message.emoji.src) + '" alt="表情">',
        "</span>"
      ].join("");
    }

    return [
      '<span class="message-special-wrapper">',
      '  <span class="emoji-text-message">' + escapeHtml((message.emoji && message.emoji.value) || message.content || "😀") + "</span>",
      "</span>"
    ].join("");
  }

  function renderLocationMessage(message) {
    var location = message.location || {};
    var address = getSafeLocationAddress(location);

    return [
      '<button class="message-special-wrapper location-message-card message-detail-trigger" type="button" data-message-id="' + escapeHtml(message.id || "") + '">',
      "  <strong>" + escapeHtml(location.name || message.content || "位置") + "</strong>",
      "  <span>" + escapeHtml(address) + "</span>",
      '  <div class="fake-map" aria-hidden="true"><span></span></div>',
      "</button>"
    ].join("");
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

  function renderRedPacketCard(message) {
    var source = message || {};
    message = normalizeMoneyMessage(message);
    if (!message) {
      return escapeHtml(normalizeDisplayText(source.content || source.note || ""));
    }

    var canOperate = canOperateIncomingMoneyMessage(message);
    var closed = isMoneyMessageClosed(message);
    var amount = message.amount;
    var note = message.note && message.note !== message.content ? message.note : "";
    return [
      '<div class="message-special-wrapper money-card red-packet-card red-packet message-detail-trigger' + getMoneyCardStateClass(message, closed) + '" role="button" tabindex="0" data-message-id="' + escapeHtml(message.id || "") + '">',
      '  <span class="money-card-icon" aria-hidden="true">🧧</span>',
      '  <span class="money-card-main">',
      '    <span class="money-card-header">',
      '      <strong class="money-card-title">' + escapeHtml(message.content || "红包") + "</strong>",
      '      <em class="money-card-status">' + escapeHtml(getMoneyMessageStatusText(message)) + "</em>",
      "    </span>",
      '    <span class="money-card-amount">¥' + escapeHtml(amount) + "</span>",
      note ? '    <small class="money-card-note">' + escapeHtml(note) + "</small>" : "",
      renderMoneyStatusOrActions(message, canOperate, "领取"),
      "  </span>",
      "</div>"
    ].join("");
  }

  function renderTransferCard(message) {
    var source = message || {};
    message = normalizeMoneyMessage(message);
    var amount = message ? message.amount : "";
    if (!amount) {
      return escapeHtml(normalizeDisplayText(source.content || source.note || ""));
    }

    var canOperate = canOperateIncomingMoneyMessage(message);
    var closed = isMoneyMessageClosed(message);
    var note = message.note || (message.content && message.content !== "转账" ? message.content : "");
    return [
      '<div class="message-special-wrapper money-card transfer-message-card transfer message-detail-trigger' + getMoneyCardStateClass(message, closed) + '" role="button" tabindex="0" data-message-id="' + escapeHtml(message.id || "") + '">',
      '  <span class="money-card-icon" aria-hidden="true">¥</span>',
      '  <span class="money-card-main">',
      '    <span class="money-card-header">',
      '      <strong class="money-card-title">转账</strong>',
      '      <em class="money-card-status">' + escapeHtml(getMoneyMessageStatusText(message)) + "</em>",
      "    </span>",
      '    <span class="money-card-amount">¥' + escapeHtml(amount) + "</span>",
      '    <small class="money-card-note">' + escapeHtml(note || "微信转账") + "</small>",
      renderMoneyStatusOrActions(message, canOperate, "收款"),
      "  </span>",
      "</div>"
    ].join("");
  }

  function renderMoneyStatusOrActions(message, canOperate, acceptLabel) {
    if (canOperate) {
      return [
        '    <span class="money-card-actions">',
        '      <button type="button" data-money-action="accept">' + escapeHtml(acceptLabel) + "</button>",
        '      <button class="secondary" type="button" data-money-action="reject">退回</button>',
        "    </span>"
      ].join("");
    }

    return "";
  }

  function getMoneyCardStateClass(message, closed) {
    var status = message && message.status ? String(message.status) : "";
    var returned = status === "returned" || status === "rejected" || status === "refunded";
    if (returned) {
      return " returned received";
    }
    return closed ? " done received" : "";
  }

  function canOperateIncomingMoneyMessage(message) {
    return Boolean(message && message.role === "character" && hasValidMoneyAmount(message) && !isMoneyMessageClosed(message));
  }

  function isMoneyMessageClosed(message) {
    var status = message && message.status ? String(message.status) : "";
    return Boolean(message && (
      message.received
      || (message.role === "character" && (message.walletRecorded || message.walletLedgerId))
      || status === "accepted"
      || status === "received"
      || status === "returned"
      || status === "rejected"
      || status === "refunded"
    ));
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

  function bindPrivateMessageActions(container, messages) {
    var messageMap = {};

    messages.forEach(function (message) {
      if (message && message.id) {
        messageMap[message.id] = message;
      }
    });

    Array.prototype.forEach.call(container.querySelectorAll(".message-action-target"), function (node) {
      var timer = null;
      var openMenu = function (event) {
        var message = messageMap[node.dataset.messageId];

        if (isPrivateMessageSelectionMode || !message || message.type === "loading") {
          return;
        }

        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }

        openPrivateMessageMenu(message);
      };
      var clearTimer = function () {
        window.clearTimeout(timer);
        timer = null;
      };

      node.addEventListener("contextmenu", openMenu);
      node.addEventListener("touchstart", function () {
        clearTimer();
        timer = window.setTimeout(function () {
          node.dataset.longPressed = "true";
          openMenu();
        }, 560);
      }, { passive: true });
      node.addEventListener("click", function (event) {
        if (isPrivateMessageSelectionMode) {
          event.preventDefault();
          event.stopPropagation();
          togglePrivateMessageSelection(node.dataset.messageId);
          return;
        }

        if (node.dataset.longPressed === "true") {
          event.preventDefault();
          event.stopPropagation();
          node.dataset.longPressed = "";
        }
      });
      node.addEventListener("touchend", clearTimer, { passive: true });
      node.addEventListener("touchmove", clearTimer, { passive: true });
      node.addEventListener("touchcancel", clearTimer, { passive: true });
    });
  }

  function bindPrivateMessageDetails(container, messages) {
    var messageMap = {};

    if (isPrivateMessageSelectionMode) {
      return;
    }

    messages.forEach(function (message) {
      if (message && message.id) {
        messageMap[message.id] = message;
      }
    });

    Array.prototype.forEach.call(container.querySelectorAll(".message-detail-trigger"), function (button) {
      button.addEventListener("click", function (event) {
        var message = messageMap[button.dataset.messageId];
        var row = button.closest(".message-action-target");
        var moneyActionButton = event.target && event.target.closest ? event.target.closest("[data-money-action]") : null;

        event.preventDefault();
        event.stopPropagation();

        if (row && row.dataset.longPressed === "true") {
          row.dataset.longPressed = "";
          return;
        }

        if (message && moneyActionButton) {
          handlePrivateMoneyMessage(message.id, moneyActionButton.dataset.moneyAction);
          return;
        }

        if (message && window.WeChatTools && window.WeChatTools.showMessageDetail) {
          window.WeChatTools.showMessageDetail(message);
        }
      });
    });
  }

  function handlePrivateMoneyMessage(messageId, action) {
    var character = activeCharacterId ? getCharacterById(activeCharacterId) : null;
    var messages;
    var changed = false;
    var toastText = action === "reject" ? "已退回。" : "已存入钱包。";

    if (!character || !window.AppStorage.receiveMoneyMessage || !window.AppStorage.returnMoneyMessage) {
      return;
    }

    messages = window.AppStorage.getChatHistory(character.id).map(function (message) {
      if (message.id !== messageId) {
        return message;
      }

      changed = true;
      return (action === "reject" ? window.AppStorage.returnMoneyMessage : window.AppStorage.receiveMoneyMessage)(Object.assign({}, message), {
        sourceType: "private",
        sourceId: character.id,
        characterId: character.id,
        sourceName: character.name
      });
    });

    if (changed) {
      window.AppStorage.saveChatHistory(character.id, messages);
      renderChatMessages(character.id);
      renderCharacterList();
      if (window.AppExtras && window.AppExtras.showToast) {
        window.AppExtras.showToast(toastText);
      }
    }
  }

  function isPrivateMessageSelectable(message) {
    return Boolean(message && message.id && message.type !== "loading");
  }

  function isPrivateMessageEditable(message) {
    var type = String(message && message.type || "text");

    return Boolean(message && message.id && message.content && (
      type === "text"
      || type === "offlineUserAction"
      || type === "offlineSpeech"
      || type === "offlineAction"
      || type === "error"
    ));
  }

  function getSelectablePrivateMessages(messages) {
    return (Array.isArray(messages) ? messages : []).filter(isPrivateMessageSelectable);
  }

  function renderPrivateMessageBatchActionBar(totalCount) {
    return [
      '<div class="batch-action-bar chat-batch-action-bar" aria-label="私聊消息批量操作">',
      '  <span class="batch-action-count">已选 ' + selectedPrivateMessageIds.length + ' 条</span>',
      '  <button class="batch-action-button" type="button" data-private-message-batch-action="all">' + (totalCount > 0 && selectedPrivateMessageIds.length === totalCount ? "取消全选" : "全选") + '</button>',
      '  <button class="batch-action-button batch-action-danger" type="button" data-private-message-batch-action="delete">删除</button>',
      '  <button class="batch-action-button" type="button" data-private-message-batch-action="cancel">取消</button>',
      "</div>"
    ].join("");
  }

  function bindPrivateMessageBatchActions(container, messages) {
    Array.prototype.forEach.call(container.querySelectorAll("[data-private-message-select]"), function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        togglePrivateMessageSelection(button.dataset.privateMessageSelect);
      });
    });

    Array.prototype.forEach.call(container.querySelectorAll("[data-private-message-batch-action]"), function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        handlePrivateMessageBatchAction(button.dataset.privateMessageBatchAction, messages);
      });
    });
  }

  function openPrivateMessageSelectionMode() {
    closeAllMenus();

    if (!activeCharacterId) {
      return;
    }

    isPrivateMessageSelectionMode = true;
    selectedPrivateMessageIds = [];
    renderChatMessages(activeCharacterId);
  }

  function togglePrivateMessageSelection(messageId) {
    var messages = activeCharacterId ? window.AppStorage.getChatHistory(activeCharacterId) : [];
    var message = messages.find(function (item) {
      return item.id === messageId;
    });
    var index;

    if (!isPrivateMessageSelectable(message)) {
      return;
    }

    index = selectedPrivateMessageIds.indexOf(messageId);
    if (index === -1) {
      selectedPrivateMessageIds.push(messageId);
    } else {
      selectedPrivateMessageIds.splice(index, 1);
    }

    renderChatMessages(activeCharacterId);
  }

  function handlePrivateMessageBatchAction(action, messages) {
    var selectable = getSelectablePrivateMessages(messages);

    if (action === "all") {
      selectedPrivateMessageIds = selectedPrivateMessageIds.length === selectable.length
        ? []
        : selectable.map(function (message) {
          return message.id;
        });
      renderChatMessages(activeCharacterId);
      return;
    }

    if (action === "cancel") {
      isPrivateMessageSelectionMode = false;
      selectedPrivateMessageIds = [];
      renderChatMessages(activeCharacterId);
      return;
    }

    if (action === "delete") {
      deleteSelectedPrivateMessages();
    }
  }

  function deleteSelectedPrivateMessages() {
    var ids = selectedPrivateMessageIds.slice();
    var messages;
    var scrollState;

    if (!activeCharacterId || !ids.length) {
      return;
    }

    if (!window.confirm("确定删除选中的 " + ids.length + " 条消息吗？")) {
      return;
    }

    scrollState = captureChatScrollState(getElement("chatMessages"));
    messages = window.AppStorage.getChatHistory(activeCharacterId).filter(function (message) {
      return ids.indexOf(message.id) === -1;
    });
    window.AppStorage.saveChatHistory(activeCharacterId, messages);

    isPrivateMessageSelectionMode = false;
    selectedPrivateMessageIds = [];
    suppressPrivateHistoryLoad(activeCharacterId);
    renderChatMessages(activeCharacterId, { skipScroll: true, restoreScrollState: scrollState });
    renderCharacterList();
  }

  function openPrivateMessageMenu(message) {
    if (!window.MessageActionMenu) {
      return;
    }

    window.MessageActionMenu.open({
      canRegenerate: message.role === "user",
      canEdit: isPrivateMessageEditable(message),
      onAction: function (action) {
        handlePrivateMessageAction(action, message.id);
      }
    });
  }

  function handlePrivateMessageAction(action, messageId) {
    var messages;
    var message;

    if (!activeCharacterId || !messageId) {
      return;
    }

    messages = window.AppStorage.getChatHistory(activeCharacterId);
    message = messages.find(function (item) {
      return item.id === messageId;
    });

    if (!message) {
      return;
    }

    if (action === "copy") {
      copyText(message.content || "");
      return;
    }

    if (action === "edit") {
      openPrivateMessageEditSheet(messageId);
      return;
    }

    if (action === "delete") {
      var scrollState = captureChatScrollState(getElement("chatMessages"));
      messages = messages.filter(function (item) {
        return item.id !== messageId;
      });
      window.AppStorage.saveChatHistory(activeCharacterId, messages);
      suppressPrivateHistoryLoad(activeCharacterId);
      renderChatMessages(activeCharacterId, { skipScroll: true, restoreScrollState: scrollState });
      renderCharacterList();
      return;
    }

    if (action === "memory") {
      window.AppStorage.addCharacterMemory(activeCharacterId, {
        content: "手动写入记忆：" + (message.content || ""),
        source: "private",
        createdAt: Date.now()
      });
      window.alert("已写入记忆");
      return;
    }

    if (action === "regenerate" && message.role === "user") {
      openPrivateRegenerateReplySheet(messageId);
    }
  }

  function openPrivateMessageEditSheet(messageId) {
    var characterId = activeCharacterId;
    var messages = characterId ? window.AppStorage.getChatHistory(characterId) : [];
    var message = messages.find(function (item) {
      return item.id === messageId;
    });

    if (!message || !isPrivateMessageEditable(message) || !window.WeChatTools || !window.WeChatTools.openMessageEditSheet) {
      return;
    }

    window.WeChatTools.openMessageEditSheet(message, function (content) {
      var scrollState = captureChatScrollState(getElement("chatMessages"));
      var editedAt = Date.now();
      var changed = false;
      var nextMessages = window.AppStorage.getChatHistory(characterId).map(function (item) {
        if (item.id !== messageId) {
          return item;
        }

        changed = true;
        return Object.assign({}, item, {
          content: normalizeDisplayText(content),
          edited: true,
          editedAt: editedAt
        });
      });

      if (!changed) {
        return false;
      }

      window.AppStorage.saveChatHistory(characterId, nextMessages);
      suppressPrivateHistoryLoad(characterId);
      renderChatMessages(characterId, { skipScroll: true, restoreScrollState: scrollState });
      renderCharacterList();
      return true;
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {
        copyTextWithTextarea(text);
      });
      return;
    }

    copyTextWithTextarea(text);
  }

  function copyTextWithTextarea(text) {
    var textarea;

    textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function appendPrivateMessageLocally(characterId, message, previousMessages) {
    var wrap = getElement("chatMessages");
    var character = getCharacterById(characterId);
    var previous = Array.isArray(previousMessages) ? previousMessages.filter(function (item) {
      return item && item.type !== "loading";
    }) : [];
    var last = previous.length ? previous[previous.length - 1] : null;
    var html = "";

    if (!wrap || activeCharacterId !== characterId || isPrivateMessageSelectionMode || !message) {
      schedulePrivateRender(characterId);
      return;
    }

    if (wrap.querySelector(".chat-empty")) {
      schedulePrivateRender(characterId);
      return;
    }

    if (!last || getDateKey(last.createdAt) !== getDateKey(message.createdAt)) {
      html += renderDateSeparator(message.createdAt);
    }

    html += renderPrivateMessage(message, character);
    wrap.insertAdjacentHTML("beforeend", html);
    if (window.AppApiJobs && window.AppApiJobs.scheduleScrollToBottom) {
      window.AppApiJobs.scheduleScrollToBottom(wrap);
    } else {
      requestAnimationFrame(function () {
        if (activeCharacterId !== characterId) {
          return;
        }
        wrap.scrollTop = wrap.scrollHeight;
      });
    }
  }

  function sendUserMessage() {
    var input = getElement("chatInput");
    var content = input ? input.value.trim() : "";
    var now;
    var messages;
    var previousMessages;
    var isOffline = isInlineOfflineActive();
    var message;

    if (!activeCharacterId || !getCharacterById(activeCharacterId) || !content) {
      return;
    }

    now = Date.now();
    messages = window.AppStorage.getChatHistory(activeCharacterId);
    previousMessages = messages.slice();
    message = {
      id: String(now),
      role: "user",
      type: isOffline ? "offlineUserAction" : "text",
      content: content,
      createdAt: now
    };
    messages.push(message);

    window.AppStorage.addCharacterMemory(activeCharacterId, {
      content: (isOffline ? "用户在线下模式中说/做：" : "用户曾说：") + content,
      source: isOffline ? "offline" : "private",
      createdAt: now
    });

    window.AppStorage.saveChatHistory(activeCharacterId, messages);

    if (input) {
      input.value = "";
      privateInputDrafts[activeCharacterId] = "";
      input.focus();
    }

    closeToolPanel();
    appendPrivateMessageLocally(activeCharacterId, message, previousMessages);
    schedulePrivateListRender();
  }

  async function handleComposerAction() {
    var input = getElement("chatInput");
    var characterId = activeCharacterId;
    var blockState = characterId ? getPrivateBlockState(characterId) : {};
    var hadInput = Boolean(input && input.value.trim());

    if (isInlineOfflineActive()) {
      await requestCharacterReply();
      return;
    }

    if (hadInput) {
      sendUserMessage();
    }

    if (hadInput && blockState.userBlocked) {
      addPrivateSystemMessage(characterId, "已拉黑，对方消息会被拦截。");
      maybeRequestCharacterBlockedReaction(characterId, blockState);
      return;
    }

    if (hadInput && blockState.characterBlocked) {
      addPrivateSystemMessage(characterId, "对方暂时拒收你的消息。");
      maybeRequestCharacterBlockedReaction(characterId, blockState);
      return;
    }

    await requestCharacterReply();
  }

  function toggleToolPanel() {
    var panel = getElement("chatToolPanel");

    if (panel) {
      panel.classList.toggle("hidden");
    }
  }

  function closeToolPanel() {
    var panel = getElement("chatToolPanel");

    if (panel) {
      panel.classList.add("hidden");
    }
  }

  function sendToolMessage(type) {
    var character = activeCharacterId ? getCharacterById(activeCharacterId) : null;
    var now = Date.now();
    var messages;
    var content;
    var role = "user";

    if (!character) {
      return;
    }

    if (openRichToolSheet(type, character.id)) {
      closeToolPanel();
      return;
    }

    content = getToolMessageContent(type, character);

    if (!content) {
      return;
    }

    if (type === "pat") {
      role = "system";
    }

    messages = window.AppStorage.getChatHistory(character.id);
    messages.push({
      id: String(now),
      role: role,
      type: type,
      content: content,
      createdAt: now
    });

    if (role === "user") {
      window.AppStorage.addCharacterMemory(character.id, {
        content: "用户发送了：" + content,
        source: "private",
        createdAt: now
      });
    }

    window.AppStorage.saveChatHistory(character.id, messages);
    closeToolPanel();
    renderChatMessages(character.id);
    renderCharacterList();
  }

  function openRichToolSheet(type, characterId) {
    if (!window.WeChatTools) {
      return false;
    }

    if (type === "redPacket") {
      window.WeChatTools.openRedPacketSheet(function (payload) {
        appendPrivateToolMessage(characterId, payload);
      });
      return true;
    }

    if (type === "transfer") {
      window.WeChatTools.openTransferSheet(function (payload) {
        appendPrivateToolMessage(characterId, payload);
      });
      return true;
    }

    if (type === "familyCardPay") {
      openFamilyCardPaySheet(characterId);
      return true;
    }

    if (type === "location") {
      window.WeChatTools.openLocationSheet(function (payload) {
        appendPrivateToolMessage(characterId, payload);
      });
      return true;
    }

    if (type === "emoji") {
      window.WeChatTools.openEmojiSheet(function (payload) {
        appendPrivateToolMessage(characterId, payload);
      });
      return true;
    }

    if (type === "image") {
      window.WeChatTools.openImagePicker(function (payload) {
        appendPrivateToolMessage(characterId, payload);
      });
      return true;
    }

    if (type === "voice") {
      window.WeChatTools.openVoiceSheet(function (payload) {
        appendPrivateToolMessage(characterId, payload);
      });
      return true;
    }

    return false;
  }

  function appendPrivateToolMessage(characterId, payload) {
    var character = getCharacterById(characterId);
    var now = Date.now();
    var messages;
    var message;

    if (!character || !payload) {
      return;
    }

    messages = window.AppStorage.getChatHistory(characterId);
    message = Object.assign({}, payload, {
      id: String(now),
      role: "user",
      createdAt: now
    });
    message = recordPrivateMoneyMessage(message, character);

    messages.push(message);
    window.AppStorage.addCharacterMemory(characterId, {
      content: "用户发送了：" + getMessageMemoryText(message),
      source: "private",
      createdAt: now
    });
    window.AppStorage.saveChatHistory(characterId, messages);
    renderChatMessages(characterId);
    renderCharacterList();
  }

  function openFamilyCardPaySheet(characterId) {
    var character = getCharacterById(characterId);
    var cards = window.AppStorage.getFamilyCardsForCharacter ? window.AppStorage.getFamilyCardsForCharacter(characterId).filter(function (card) {
      return card.enabled && card.totalLimit > card.usedAmount;
    }) : [];
    var card;
    var amount;
    var note;

    if (!character) {
      return;
    }

    if (!cards.length) {
      window.alert("请先在钱包的亲属卡里为该角色创建并启用亲属卡。");
      return;
    }

    card = cards.find(function (item) {
      return character.chatSettings && character.chatSettings.familyCardId === item.id;
    }) || cards[0];
    amount = window.prompt("使用「" + card.name + "」支付金额", "");
    if (amount === null) {
      return;
    }

    amount = normalizeMoneyAmount(amount);
    if (!amount) {
      window.alert("请输入有效金额。");
      return;
    }

    note = window.prompt("支付备注", "亲属卡支付") || "亲属卡支付";
    appendPrivateToolMessage(characterId, {
      type: "transfer",
      content: "亲属卡支付",
      amount: amount,
      note: note,
      status: "paid",
      paymentMethod: "familyCard",
      familyCardId: card.id
    });
  }

  function recordPrivateMoneyMessage(message, character) {
    if (!window.AppStorage.recordMoneyMessage || !message || (message.type !== "redPacket" && message.type !== "transfer")) {
      return message;
    }

    if (!character) {
      return message;
    }

    return window.AppStorage.recordMoneyMessage(message, {
      sourceType: "private",
      sourceId: character.id,
      characterId: character.id,
      generationId: message.generationId || "",
      sourceName: character.name
    }) || message;
  }

  function getMessageMemoryText(message) {
    if (message.type === "redPacket") {
      return "红包：" + (message.content || "恭喜发财，大吉大利");
    }
    if (message.type === "transfer") {
      return "转账：" + (normalizeMoneyAmount(message.amount) || "");
    }
    if (message.type === "location") {
      return "位置：" + (message.location && message.location.name ? message.location.name : message.content || "") + "，" + getSafeLocationAddress(message.location);
    }
    if (message.type === "emoji") {
      return message.emoji && message.emoji.type === "text" ? "表情：" + message.emoji.value : "图片表情";
    }
    if (message.type === "image") {
      return message.image && message.image.src
        ? "图片：" + (message.image.name || "图片")
        : "图片描述：" + ((message.image && message.image.description) || message.content || "");
    }
    if (message.type === "voice") {
      return "语音：" + ((message.voice && message.voice.text) || message.content || "");
    }
    if (message.type === "offlineUserAction") {
      return message.content || "";
    }
    if (message.type === "offlineAction") {
      return "线下旁白：" + (message.content || "");
    }
    if (message.type === "offlineSpeech") {
      return "线下发言：" + (message.content || "");
    }
    return message.content || "";
  }

  function getToolMessageContent(type, character) {
    if (type === "image") {
      return "";
    }
    if (type === "emoji") {
      return "";
    }
    if (type === "voice") {
      return "";
    }
    if (type === "location") {
      return "";
    }
    if (type === "pat") {
      return "你拍了拍 " + (character.name || "角色");
    }
    if (type === "transfer") {
      return "";
    }
    if (type === "redPacket") {
      return "";
    }
    return "";
  }

  function findLatestPrivateRegenerateMessageId() {
    var messages = activeCharacterId ? removeLoadingMessages(window.AppStorage.getChatHistory(activeCharacterId)) : [];
    var offlineActive = isInlineOfflineActive();
    var index;
    var nextIndex;
    var hasCharacterReply;

    for (index = messages.length - 1; index >= 0; index -= 1) {
      if (!messages[index] || messages[index].role !== "user") {
        continue;
      }

      hasCharacterReply = false;
      nextIndex = index + 1;

      while (nextIndex < messages.length && messages[nextIndex].role !== "user") {
        if (messages[nextIndex].role === "character" && messages[nextIndex].type !== "error"
          || offlineActive && (messages[nextIndex].type === "offlineSpeech" || messages[nextIndex].type === "offlineAction")) {
          hasCharacterReply = true;
          break;
        }
        nextIndex += 1;
      }

      if (hasCharacterReply) {
        return messages[index].id;
      }
    }

    return "";
  }

  function openPrivateRegenerateReplySheet(messageId) {
    if (!activeCharacterId || !messageId) {
      window.alert("还没有可重回的角色回复。");
      return;
    }

    if (window.AppExtras && window.AppExtras.openRegenerateReplySheet) {
      window.AppExtras.openRegenerateReplySheet({
        onConfirm: function (requirement) {
          regeneratePrivateReplyFromMessage(messageId, requirement);
        }
      });
      return;
    }

    regeneratePrivateReplyFromMessage(messageId, window.prompt("重回要求（可选）", "") || "");
  }

  function openActiveRegenerateReply() {
    var messageId;

    closeAllMenus();
    messageId = findLatestPrivateRegenerateMessageId();

    if (!messageId) {
      window.alert("还没有可重回的角色回复。");
      return;
    }

    openPrivateRegenerateReplySheet(messageId);
  }

  async function regeneratePrivateReplyFromMessage(messageId, requirement) {
    var requestCharacterId = activeCharacterId;
    var character = requestCharacterId ? getCharacterById(requestCharacterId) : null;
    var messages;
    var index;
    var nextIndex;
    var before;
    var after;
    var oldMessages;
    var oldGenerationIds;
    var oldBodyState;
    var loadingMessage;
    var generationId;
    var rejectedReplyText;

    if (!requestCharacterId || !character) {
      return;
    }

    if (isInlineOfflineActive()) {
      if (window.OfflineManager && window.OfflineManager.regenerateInlineOfflineLastTurn) {
        await window.OfflineManager.regenerateInlineOfflineLastTurn({
          mode: "private",
          targetType: "private",
          targetId: requestCharacterId,
          messageId: messageId,
          regenerateInstruction: requirement
        });
      }
      return;
    }

    if (isPrivateJobRunning(requestCharacterId, ["regenerate"])) {
      showPrivateBusyNotice(requestCharacterId);
      return;
    }

    messages = window.AppStorage.getChatHistory(requestCharacterId);
    index = messages.findIndex(function (message) {
      return message.id === messageId && message.role === "user";
    });

    if (index === -1) {
      return;
    }

    nextIndex = index + 1;
    while (nextIndex < messages.length && messages[nextIndex].role !== "user") {
      nextIndex += 1;
    }

    before = messages.slice(0, index + 1);
    oldMessages = messages.slice(index + 1, nextIndex);
    after = messages.slice(nextIndex);
    oldGenerationIds = collectGenerationIds(oldMessages);
    oldBodyState = window.AppStorage.getBodyState ? window.AppStorage.getBodyState("private", requestCharacterId) : null;
    rejectedReplyText = collectPrivateReplyText(oldMessages);
    generationId = window.AppApiJobs && window.AppApiJobs.createGenerationId
      ? window.AppApiJobs.createGenerationId()
      : "generation_" + Date.now();
    loadingMessage = createPrivateLoadingMessage(generationId, "正在重新生成...");

    isSending = true;
    setReplyState(true);

    if (oldGenerationIds.length && window.AppStorage.removeGenerationArtifacts) {
      window.AppStorage.removeGenerationArtifacts(oldGenerationIds, {
        targetType: "private",
        targetId: requestCharacterId
      });
    }

    window.AppStorage.saveChatHistory(requestCharacterId, before.concat([loadingMessage], after));
    schedulePrivateRender(requestCharacterId);

    try {
      await requestPrivateJob({
        targetType: "private",
        targetId: requestCharacterId,
        mode: "regenerate",
        generationId: generationId,
        beforeMessages: before,
        afterMessages: after,
        requestSnapshot: {
          parentUserMessageId: messageId,
          regenerateRequest: true,
          regenerateInstruction: String(requirement || "").trim(),
          previousReplyText: getPreviousPrivateReplyText(messages, index),
          rejectedReplyText: rejectedReplyText,
          oldGenerationIds: oldGenerationIds,
          oldMessages: oldMessages
        }
      });
      messages = null;
    } catch (error) {
      if (oldBodyState && window.AppStorage.saveBodyState) {
        window.AppStorage.saveBodyState("private", requestCharacterId, oldBodyState);
      }
      messages = before.concat(oldMessages, [{
        id: String(Date.now()),
        role: "character",
        type: "error",
        content: "回复失败：" + (error && error.message ? error.message : "未知错误"),
        createdAt: Date.now(),
        generationId: generationId
      }], after);
    } finally {
      if (getCharacterById(requestCharacterId)) {
        if (messages) {
          window.AppStorage.saveChatHistory(requestCharacterId, messages);
        }
        schedulePrivateRender(requestCharacterId);
        schedulePrivateListRender();
      }
      isSending = false;
      setReplyState(false);
    }
  }

  function appendPrivateReplies(messages, characterId, replies, meta) {
    var startAt = Date.now();
    var generated = [];
    var extra = meta || {};

    (replies || []).slice(0, 50).forEach(function (item, index) {
      var createdAt;
      var message;

      if (!item || !item.content) {
        return;
      }

      createdAt = startAt + index;
      message = createPrivateCharacterReplyMessage(item, createdAt, extra);
      message = recordPrivateMoneyMessage(message, getCharacterById(characterId));
      messages.push(message);
      generated.push(message);
      window.AppStorage.addCharacterMemory(characterId, {
        content: "角色曾回复：" + getMessageMemoryText(message),
        source: "private",
        generationId: extra.generationId || "",
        sourceGenerationId: extra.generationId || "",
        relatedMessageIds: [message.id],
        targetType: "private",
        targetId: characterId,
        createdAt: createdAt
      });
    });

    return {
      messages: messages,
      generated: generated
    };
  }

  function streamPrivateReplies(baseMessages, characterId, replies, suffixMessages, meta) {
    var shown = [];
    var startAt = Date.now();
    var suffix = Array.isArray(suffixMessages) ? suffixMessages : [];
    var extra = meta || {};
    var items = (replies || []).slice(0, 50).filter(function (item) {
      return item && item.content;
    });
    var appended;

    if (!window.AppStream || !window.AppStream.appendMessagesWithStreamEffect) {
      appended = appendPrivateReplies(baseMessages.slice(), characterId, items, extra);
      window.AppStorage.saveChatHistory(characterId, appended.messages.concat(suffix));
      if (activeCharacterId === characterId) {
        schedulePrivateRender(characterId);
      }
      schedulePrivateListRender();
      return Promise.resolve(appended.generated);
    }

    return window.AppStream.appendMessagesWithStreamEffect({
      targetType: "private",
      targetId: characterId,
      messages: items,
      renderOne: function (item, index) {
        var character = getCharacterById(characterId);
        var createdAt = startAt + index;
        var message;

        if (!character) {
          return;
        }

        message = createPrivateCharacterReplyMessage(item, createdAt, extra);
        message = recordPrivateMoneyMessage(message, character);
        shown.push(message);
        window.AppStorage.addCharacterMemory(characterId, {
          content: "角色曾回复：" + getMessageMemoryText(message),
          source: "private",
          generationId: extra.generationId || "",
          sourceGenerationId: extra.generationId || "",
          relatedMessageIds: [message.id],
          targetType: "private",
          targetId: characterId,
          createdAt: createdAt
        });
        savePrivateHistoryDebounced(characterId, baseMessages.concat(shown, suffix));
        if (activeCharacterId === characterId) {
          schedulePrivateRender(characterId);
        }
      }
    }).then(function () {
      window.AppStorage.saveChatHistory(characterId, baseMessages.concat(shown, suffix));
      flushPrivateHistory(characterId);
      schedulePrivateRender(characterId);
      schedulePrivateListRender();
      return shown;
    });
  }

  function normalizePrivateAiResult(result) {
    if (Array.isArray(result)) {
      return { replies: normalizeReplyItemsForDisplay(result), actions: [], thoughts: [], memories: [], moneyDecisions: [], memorySummary: null, bodyState: null };
    }

    result = result && typeof result === "object" ? result : {};
    return {
      replies: normalizeReplyItemsForDisplay(Array.isArray(result.replies) ? result.replies : []),
      actions: Array.isArray(result.actions) ? result.actions : [],
      thoughts: Array.isArray(result.thoughts) ? result.thoughts : [],
      memories: Array.isArray(result.memories) ? result.memories : [],
      moneyDecisions: Array.isArray(result.moneyDecisions) ? result.moneyDecisions : collectReplyMoneyDecisions(result.replies),
      memorySummary: result.memorySummary || null,
      bodyState: result.bodyState || null
    };
  }

  function collectReplyMoneyDecisions(replies) {
    var decisions = [];

    (Array.isArray(replies) ? replies : []).forEach(function (reply) {
      if (!reply || typeof reply !== "object") {
        return;
      }
      if (reply.transferDecision) {
        decisions.push({ type: "transfer", decision: reply.transferDecision, messageId: reply.messageId || "" });
      }
      if (reply.redPacketDecision || reply.redpacketDecision) {
        decisions.push({ type: "redPacket", decision: reply.redPacketDecision || reply.redpacketDecision, messageId: reply.messageId || "" });
      }
      if (reply.moneyDecision && typeof reply.moneyDecision === "object") {
        decisions.push(reply.moneyDecision);
      }
    });

    return decisions;
  }

  function applyPrivateMoneyDecisions(messages, character, aiResult) {
    var decisions = Array.isArray(aiResult && aiResult.moneyDecisions) ? aiResult.moneyDecisions : [];

    if (!decisions.length || !window.AppStorage.applyMoneyDecision) {
      return messages;
    }

    decisions.forEach(function (decision) {
      var index = findPendingOutgoingMoneyMessageIndex(messages, decision);
      if (index === -1) {
        return;
      }
      messages[index] = window.AppStorage.applyMoneyDecision(Object.assign({}, messages[index]), decision.decision, {
        sourceType: "private",
        sourceId: character.id,
        characterId: character.id,
        sourceName: character.name
      }) || messages[index];
    });

    return messages;
  }

  function findPendingOutgoingMoneyMessageIndex(messages, decision) {
    var type = normalizeMoneyDecisionType(decision && decision.type);
    var messageId = decision && decision.messageId ? String(decision.messageId) : "";
    var index;

    if (!type) {
      return -1;
    }

    if (messageId) {
      index = messages.findIndex(function (message) {
        return message.id === messageId && isPendingOutgoingMoneyMessage(message, type);
      });
      if (index !== -1) {
        return index;
      }
    }

    for (index = messages.length - 1; index >= 0; index -= 1) {
      if (isPendingOutgoingMoneyMessage(messages[index], type)) {
        return index;
      }
    }

    return -1;
  }

  function isPendingOutgoingMoneyMessage(message, type) {
    var status = message && message.status ? String(message.status) : "pending";
    return Boolean(message
      && message.role === "user"
      && message.type === type
      && status !== "accepted"
      && status !== "received"
      && status !== "returned"
      && status !== "rejected"
      && status !== "refunded");
  }

  function normalizeMoneyDecisionType(type) {
    var value = String(type || "").toLowerCase();
    if (value === "transfer" || value === "转账") {
      return "transfer";
    }
    if (value === "redpacket" || value === "red_packet" || value === "红包") {
      return "redPacket";
    }
    return "";
  }

  function persistPrivateAiExtras(characterId, result, source, meta) {
    var now = Date.now();
    var character = getCharacterById(characterId);
    var extra = meta || {};

    if (!character || !result) {
      return;
    }

    try {
      (result.thoughts || []).forEach(function (thought) {
        window.AppStorage.addCharacterThought(characterId, {
          source: source || "private",
          chatId: characterId,
          content: thought.content,
          mood: thought.mood || "",
          visibleSummary: thought.visibleSummary || thought.summary || "",
          generationId: extra.generationId || "",
          sourceGenerationId: extra.generationId || "",
          relatedMessageIds: extra.relatedMessageIds || [],
          targetType: "private",
          targetId: characterId,
          createdAt: now
        });
      });
    } catch (error) {
      console.warn("角色心声保存失败，聊天回复已保留。", error);
    }

    updateThoughtButton(characterId);

    if (character.chatSettings && character.chatSettings.memoryEnabled === false) {
      return;
    }

    try {
      (result.memories || []).forEach(function (memory) {
        window.AppStorage.addCharacterMemory(characterId, {
          content: memory.content,
          source: source || "private",
          generationId: extra.generationId || "",
          sourceGenerationId: extra.generationId || "",
          relatedMessageIds: extra.relatedMessageIds || [],
          targetType: "private",
          targetId: characterId,
          createdAt: now
        });
      });
    } catch (error) {
      console.warn("角色记忆保存失败，聊天回复已保留。", error);
    }
  }

  function createPrivateCharacterReplyMessage(reply, createdAt, meta) {
    var source = reply && typeof reply === "object" ? reply : { content: String(reply || "") };
    var type = source.type || "text";
    var extra = meta || {};
    var message = Object.assign({}, source, {
      id: String(createdAt + Math.random()),
      role: "character",
      type: type,
      createdAt: createdAt,
      generationId: extra.generationId || source.generationId || "",
      parentUserMessageId: extra.parentUserMessageId || source.parentUserMessageId || "",
      generatedAt: extra.generatedAt || createdAt
    });

    if (extra.blockedMessage || source.blockedMessage) {
      message.blockedMessage = true;
      message.type = source.type || "blockedReaction";
    }

    if (type === "voice") {
      message.voice = Object.assign({
        text: source.content || "",
        duration: estimateVoiceDuration(source.content || "")
      }, source.voice || {});
    }

    if (type === "emoji") {
      message.emoji = source.emoji && source.emoji.type === "image"
        ? { type: "image", src: source.emoji.src || "" }
        : { type: "text", value: source.emoji && source.emoji.value ? source.emoji.value : (source.content || "😂") };
      message.content = source.content || (message.emoji.type === "text" ? message.emoji.value : "[表情]");
    }

    if (type === "image") {
      message.image = Object.assign({
        description: source.image && source.image.description ? source.image.description : (source.content || "角色发来的一张图片描述")
      }, source.image || {});
      message.content = source.content || "[图片]";
    }

    if (type === "location") {
      message.location = Object.assign({
        name: source.location && source.location.name ? source.location.name : (source.content || "位置"),
        address: source.location && source.location.address ? source.location.address : "常去的地方",
        lat: null,
        lng: null
      }, source.location || {});
      message.location.lat = null;
      message.location.lng = null;
    }

    if (type === "redPacket") {
      message.note = source.note || "";
      message = normalizeMoneyMessage(message);
      if (!message) {
        message = Object.assign({}, source, {
          id: String(createdAt + Math.random()),
          role: "character",
          type: "text",
          createdAt: createdAt
        });
        message.type = "text";
        message.status = "";
        message.content = source.content || "";
      } else {
        message.status = source.status || "pending";
        message.content = source.content || "恭喜发财，大吉大利";
      }
    }

    if (type === "transfer") {
      message.note = source.note || "";
      message = normalizeMoneyMessage(message);
      if (!message) {
        message = Object.assign({}, source, {
          id: String(createdAt + Math.random()),
          role: "character",
          type: "text",
          createdAt: createdAt
        });
        message.type = "text";
        message.note = "";
        message.status = "";
        message.content = source.content || source.note || "";
      } else {
        message.status = source.status || "pending";
        message.content = source.content || "转账";
      }
    }

    message.content = normalizeDisplayText(message.content || source.content || "");
    message.generationId = message.generationId || extra.generationId || source.generationId || "";
    message.parentUserMessageId = message.parentUserMessageId || extra.parentUserMessageId || source.parentUserMessageId || "";
    message.generatedAt = message.generatedAt || extra.generatedAt || createdAt;
    if (extra.blockedMessage || source.blockedMessage) {
      message.blockedMessage = true;
      if (message.type === "text") {
        message.type = "blockedReaction";
      }
    }
    return message;
  }

  function schedulePrivateRender(characterId) {
    if (window.AppApiJobs && window.AppApiJobs.scheduleRenderChat) {
      window.AppApiJobs.scheduleRenderChat("private", characterId);
      return;
    }
    renderChatMessages(characterId);
  }

  function schedulePrivateListRender() {
    if (window.AppApiJobs && window.AppApiJobs.scheduleRenderList) {
      window.AppApiJobs.scheduleRenderList("private");
      return;
    }
    renderCharacterList();
  }

  function savePrivateHistoryDebounced(characterId, messages) {
    if (window.AppApiJobs && window.AppApiJobs.saveChatHistoryDebounced) {
      window.AppApiJobs.saveChatHistoryDebounced("private", characterId, messages, 120);
      return;
    }
    window.AppStorage.saveChatHistory(characterId, messages);
  }

  function flushPrivateHistory(characterId) {
    if (window.AppApiJobs && window.AppApiJobs.flushChatHistorySave) {
      window.AppApiJobs.flushChatHistorySave("private", characterId);
    }
  }

  function isPrivateJobRunning(characterId, modes) {
    return Boolean(window.AppApiJobs
      && window.AppApiJobs.isTargetRunning
      && window.AppApiJobs.isTargetRunning("private", characterId, modes));
  }

  function showPrivateBusyNotice(characterId) {
    if (characterId && activeCharacterId === characterId && window.AppExtras && window.AppExtras.showToast) {
      window.AppExtras.showToast("正在回复中", true);
    }
  }

  function createPrivateLoadingMessage(generationId, content) {
    var now = Date.now();
    return {
      id: String(now + Math.random()),
      role: "character",
      type: "loading",
      content: content || "正在输入中",
      createdAt: now,
      generationId: generationId || ""
    };
  }

  function removeLoadingMessagesByGeneration(messages, generationId) {
    var gid = String(generationId || "");
    return (Array.isArray(messages) ? messages : []).filter(function (message) {
      if (!message || message.type !== "loading") {
        return true;
      }
      return gid && message.generationId !== gid;
    });
  }

  function collectGenerationIds(messages) {
    var ids = {};

    (Array.isArray(messages) ? messages : []).forEach(function (message) {
      if (message && message.generationId) {
        ids[String(message.generationId)] = true;
      }
      if (message && message.sourceGenerationId) {
        ids[String(message.sourceGenerationId)] = true;
      }
    });

    return Object.keys(ids);
  }

  function collectPrivateReplyText(messages) {
    return (Array.isArray(messages) ? messages : []).filter(function (message) {
      return message && message.role === "character" && message.type !== "loading" && message.type !== "error" && message.content;
    }).map(function (message) {
      return getMessageMemoryText(message);
    }).join("\n");
  }

  function getPreviousPrivateReplyText(messages, userIndex) {
    var list = Array.isArray(messages) ? messages : [];
    var index = typeof userIndex === "number" ? userIndex : list.length - 1;
    var end = index;
    var start = end - 1;

    while (start >= 0 && list[start] && list[start].role !== "user") {
      start -= 1;
    }

    return collectPrivateReplyText(list.slice(start + 1, end));
  }

  function getLastPrivateUserMessage(messages) {
    var list = Array.isArray(messages) ? messages : [];
    var index;

    for (index = list.length - 1; index >= 0; index -= 1) {
      if (list[index] && list[index].role === "user") {
        return list[index];
      }
    }

    return null;
  }

  function hasPrivateGeneratedOutput(characterId, generationId) {
    return Boolean(window.AppApiJobs
      && window.AppApiJobs.hasGeneratedOutput
      && window.AppApiJobs.hasGeneratedOutput("private", characterId, generationId));
  }

  function buildPrivateGenerationContext(characterId, extraOptions, historyForRequest) {
    var extras = Object.assign({}, extraOptions || {});
    var list = Array.isArray(historyForRequest) ? historyForRequest : [];

    if (!extras.previousReplyText) {
      extras.previousReplyText = getPreviousPrivateReplyText(list);
    }

    return window.AppExtras && window.AppExtras.buildChatGenerationContext
      ? window.AppExtras.buildChatGenerationContext("private", characterId, extras)
      : extras;
  }

  function handlePrivateAiActions(characterId, result, meta) {
    var actions = result && Array.isArray(result.actions) ? result.actions : [];

    actions.forEach(function (action) {
      if (!action || action.type !== "blockUser" || !window.AppStorage || !window.AppStorage.setCharacterBlockedUser) {
        return;
      }
      window.AppStorage.setCharacterBlockedUser(characterId, true, action.reason || action.content || "");
      if (activeCharacterId === characterId) {
        updatePrivateBlockUi(characterId);
      }
    });
  }

  function requestPrivateJob(input) {
    if (!window.AppApiJobs || !window.AppApiJobs.runJob) {
      return Promise.reject(new Error("API job runner unavailable."));
    }

    return window.AppApiJobs.runJob(input);
  }

  async function handlePrivateChatJob(job) {
    var characterId = job.targetId;
    var character = getCharacterById(characterId);
    var requestSnapshot = job.requestSnapshot || {};
    var historyForRequest = Array.isArray(job.beforeMessages) && job.beforeMessages.length
      ? job.beforeMessages
      : removeLoadingMessagesByGeneration(window.AppStorage.getChatHistory(characterId), job.generationId);
    var generationContext;
    var aiResult;
    var replies;
    var messages;
    var baseMessages;
    var suffixMessages = Array.isArray(job.afterMessages) ? job.afterMessages : [];
    var generatedMessages;
    var parentUserMessage = requestSnapshot.parentUserMessageId ? { id: requestSnapshot.parentUserMessageId } : getLastPrivateUserMessage(historyForRequest);

    if (!character) {
      throw new Error("角色不存在。");
    }

    if (hasPrivateGeneratedOutput(characterId, job.generationId)) {
      messages = removeLoadingMessagesByGeneration(window.AppStorage.getChatHistory(characterId), job.generationId);
      window.AppStorage.saveChatHistory(characterId, messages);
      schedulePrivateRender(characterId);
      schedulePrivateListRender();
      return { afterMessages: messages };
    }

    generationContext = buildPrivateGenerationContext(characterId, {
      generationId: job.generationId,
      previousReplyText: requestSnapshot.previousReplyText || "",
      rejectedReplyText: requestSnapshot.rejectedReplyText || "",
      blockReaction: requestSnapshot.blockReaction,
      blockReactionType: requestSnapshot.blockReactionType,
      blockReason: requestSnapshot.blockReason,
      regenerateRequest: requestSnapshot.regenerateRequest,
      regenerateInstruction: requestSnapshot.regenerateInstruction
    }, historyForRequest);

    if (window.AIService.sendPrivateChatRequest) {
      aiResult = normalizePrivateAiResult(await window.AIService.sendPrivateChatRequest(character, historyForRequest, generationContext));
    } else {
      aiResult = normalizePrivateAiResult({
        replies: [{ content: await window.AIService.sendChatRequest(character, historyForRequest) }]
      });
    }

    replies = aiResult.replies || [];
    messages = removeLoadingMessagesByGeneration(window.AppStorage.getChatHistory(characterId), job.generationId);
    window.AppStorage.saveChatHistory(characterId, messages);
    schedulePrivateRender(characterId);

    if (!replies.length) {
      showEmptyAiReplyToast();
      schedulePrivateListRender();
      return { afterMessages: messages };
    }

    baseMessages = suffixMessages.length || requestSnapshot.regenerateRequest
      ? historyForRequest.slice()
      : messages;
    baseMessages = applyPrivateMoneyDecisions(baseMessages, character, aiResult);
    window.AppStorage.saveChatHistory(characterId, baseMessages.concat(suffixMessages));
    generatedMessages = await streamPrivateReplies(baseMessages, characterId, replies, suffixMessages, {
      generationId: job.generationId,
      parentUserMessageId: parentUserMessage && parentUserMessage.id || "",
      generatedAt: Date.now(),
      blockedMessage: Boolean(requestSnapshot.blockReaction)
    });
    persistPrivateAiExtras(characterId, aiResult, requestSnapshot.blockReaction ? "blockReaction" : "private", {
      generationId: job.generationId,
      relatedMessageIds: (generatedMessages || []).map(function (message) {
        return message.id;
      })
    });
    handlePrivateAiActions(characterId, aiResult, { generationId: job.generationId });

    if (window.AppExtras && window.AppExtras.finalizeChatGenerationContext) {
      window.AppExtras.finalizeChatGenerationContext(generationContext, aiResult);
    }

    messages = window.AppStorage.getChatHistory(characterId);
    schedulePrivateRender(characterId);
    schedulePrivateListRender();
    return { afterMessages: messages };
  }

  async function handlePrivateRegenerateJob(job) {
    return handlePrivateChatJob(job);
  }

  async function handlePrivateBlockReactionJob(job) {
    return handlePrivateChatJob(job);
  }

  async function handlePrivateInlineOfflineJob(job) {
    if (window.OfflineManager && window.OfflineManager.handlePrivateInlineOfflineJob) {
      return window.OfflineManager.handlePrivateInlineOfflineJob(job);
    }
    throw new Error("线下管理器还没有准备好。");
  }

  function getPrivateBlockState(characterId) {
    return window.AppStorage && window.AppStorage.getBlockState
      ? window.AppStorage.getBlockState(characterId)
      : { userBlocked: false, characterBlocked: false, lastBlockReactionAt: 0 };
  }

  function estimateVoiceDuration(text) {
    return Math.min(60, Math.max(2, Math.ceil(String(text || "").length / 4)));
  }

  async function requestCharacterReply() {
    var requestCharacterId = activeCharacterId;
    var character = requestCharacterId ? getCharacterById(requestCharacterId) : null;
    var messages;
    var historyForRequest;
    var loadingMessage;
    var errorContent;
    var generationId;

    if (!requestCharacterId || !character) {
      return;
    }

    if (isInlineOfflineActive()) {
      if (getElement("chatInput") && getElement("chatInput").value.trim()) {
        sendUserMessage();
      }
      if (window.OfflineManager && window.OfflineManager.requestInlineOfflineAdvance) {
        await window.OfflineManager.requestInlineOfflineAdvance({
          mode: "private",
          targetId: requestCharacterId
        });
      }
      return;
    }

    messages = window.AppStorage.getChatHistory(requestCharacterId);

    if (!messages.some(function (message) {
      return message.role === "user";
    })) {
      showEmptyAiReplyToast();
      return;
    }

    if (isPrivateJobRunning(requestCharacterId, ["chat"])) {
      showPrivateBusyNotice(requestCharacterId);
      return;
    }

    isSending = true;
    setReplyState(true);

    historyForRequest = messages.slice();
    generationId = window.AppApiJobs && window.AppApiJobs.createGenerationId
      ? window.AppApiJobs.createGenerationId()
      : "generation_" + Date.now();

    loadingMessage = createPrivateLoadingMessage(generationId, "正在输入中");

    messages.push(loadingMessage);
    window.AppStorage.saveChatHistory(requestCharacterId, messages);
    schedulePrivateRender(requestCharacterId);

    try {
      await requestPrivateJob({
        targetType: "private",
        targetId: requestCharacterId,
        mode: "chat",
        generationId: generationId,
        beforeMessages: historyForRequest,
        requestSnapshot: {
          parentUserMessageId: getLastPrivateUserMessage(historyForRequest) && getLastPrivateUserMessage(historyForRequest).id || "",
          previousReplyText: getPreviousPrivateReplyText(historyForRequest)
        }
      });
      messages = null;
    } catch (error) {
      errorContent = error && error.message === window.AIService.MISSING_SETTINGS_MESSAGE
        ? window.AIService.MISSING_SETTINGS_MESSAGE
        : "回复失败：" + (error && error.message ? error.message : "未知错误");

      messages = removeLoadingMessagesByGeneration(window.AppStorage.getChatHistory(requestCharacterId), generationId);
      messages.push({
        id: String(Date.now()),
        role: "character",
        type: "error",
        content: errorContent,
        createdAt: Date.now(),
        generationId: generationId
      });
    } finally {
      if (getCharacterById(requestCharacterId)) {
        if (messages) {
          window.AppStorage.saveChatHistory(requestCharacterId, messages);
        }
        schedulePrivateRender(requestCharacterId);
        schedulePrivateListRender();
      }
      isSending = false;
      setReplyState(false);
    }
  }

  function removeLoadingMessages(messages) {
    return (Array.isArray(messages) ? messages : []).filter(function (message) {
      return message.type !== "loading";
    });
  }

  function setCompactReplyButton(button, label, busy) {
    if (!button) {
      return;
    }

    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.textContent = busy ? "…" : (label === "推进" ? "▶" : "↑");
  }

  function setReplyState(sending) {
    var replyButton = getElement("replyButton");
    var isOffline = isInlineOfflineActive();
    var label = sending ? (isOffline ? "推进中" : "发送中") : (isOffline ? "推进" : "发送");

    if (!replyButton) {
      return;
    }

    replyButton.disabled = sending;
    setCompactReplyButton(replyButton, label, sending);
  }

  function toggleCardMenu(card) {
    var menu = card ? card.querySelector(".card-action-menu") : null;
    var shouldOpen = menu && menu.classList.contains("hidden");

    closeAllMenus();

    if (shouldOpen) {
      menu.classList.remove("hidden");
    }
  }

  function toggleChatActionMenu() {
    var menu = getElement("chatActionMenu");

    if (!menu) {
      return;
    }

    if (menu.classList.contains("hidden")) {
      closeAllMenus();
      updatePrivateBlockUi(activeCharacterId);
      menu.classList.remove("hidden");
    } else {
      menu.classList.add("hidden");
    }
  }

  function closeAllMenus() {
    var listContent = getElement("characterListContent");
    var chatMenu = getElement("chatActionMenu");

    closeToolPanel();

    if (listContent) {
      Array.prototype.forEach.call(listContent.querySelectorAll(".card-action-menu"), function (menu) {
        menu.classList.add("hidden");
      });
    }

    if (chatMenu) {
      chatMenu.classList.add("hidden");
    }

    if (window.MessageActionMenu) {
      window.MessageActionMenu.close();
    }
  }

  function editActiveCharacter() {
    if (activeCharacterId) {
      openEditCharacterScreen(activeCharacterId);
    }
  }

  function clearActiveChatHistory() {
    var character = activeCharacterId ? getCharacterById(activeCharacterId) : null;

    closeAllMenus();

    if (!character) {
      return;
    }

    if (!window.confirm("确定要清空聊天记录吗？")) {
      return;
    }

    window.AppStorage.deleteChatHistory(character.id);
    ensureOpeningMessage(character);
    renderChatMessages(character.id);
    renderCharacterList();
  }

  function addPrivateSystemMessage(characterId, content, meta) {
    var messages = window.AppStorage.getChatHistory(characterId);
    var now = Date.now();
    var message = Object.assign({
      id: String(now + Math.random()),
      role: "system",
      type: "text",
      content: content,
      createdAt: now
    }, meta || {});

    messages.push(message);
    window.AppStorage.saveChatHistory(characterId, messages);
    if (activeCharacterId === characterId) {
      schedulePrivateRender(characterId);
    }
    schedulePrivateListRender();
    return message;
  }

  function toggleActiveCharacterBlock() {
    var character = activeCharacterId ? getCharacterById(activeCharacterId) : null;
    var state = character ? getPrivateBlockState(character.id) : null;
    var nextBlocked;
    var reason = "";

    closeAllMenus();

    if (!character || !window.AppStorage || !window.AppStorage.setUserBlockedCharacter) {
      return;
    }

    nextBlocked = !state.userBlocked;
    if (nextBlocked && window.prompt) {
      reason = window.prompt("拉黑原因（可选）", "") || "";
    }

    window.AppStorage.setUserBlockedCharacter(character.id, nextBlocked, reason);
    addPrivateSystemMessage(character.id, nextBlocked ? "你已拉黑 " + (character.name || "对方") + "。" : "你已取消拉黑 " + (character.name || "对方") + "。");
    updatePrivateBlockUi(character.id);
    renderChatMessages(character.id);
    renderCharacterList();

    if (nextBlocked) {
      requestPrivateBlockReaction(character.id, "userBlocked", reason);
    }
  }

  function maybeRequestCharacterBlockedReaction(characterId, blockState) {
    var state = blockState || getPrivateBlockState(characterId);
    var lastAt = Number(state.lastBlockReactionAt) || 0;

    if (!characterId || Date.now() - lastAt < 15000) {
      return;
    }

    requestPrivateBlockReaction(characterId, state.characterBlocked ? "characterBlocked" : "userBlocked", state.characterBlockReason || state.userBlockReason || "");
  }

  async function requestPrivateBlockReaction(characterId, reactionType, reason) {
    var character = characterId ? getCharacterById(characterId) : null;
    var messages;
    var historyForRequest;
    var generationId;

    if (!character || isPrivateJobRunning(characterId, ["blockReaction"])) {
      showPrivateBusyNotice(characterId);
      return;
    }

    generationId = window.AppApiJobs && window.AppApiJobs.createGenerationId
      ? window.AppApiJobs.createGenerationId()
      : "generation_" + Date.now();
    messages = window.AppStorage.getChatHistory(characterId);
    historyForRequest = messages.slice();
    messages.push(createPrivateLoadingMessage(generationId, "正在输入中"));
    window.AppStorage.saveChatHistory(characterId, messages);
    schedulePrivateRender(characterId);

    if (window.AppStorage.setBlockReactionTimestamp) {
      window.AppStorage.setBlockReactionTimestamp(characterId, Date.now());
    }

    try {
      await requestPrivateJob({
        targetType: "private",
        targetId: characterId,
        mode: "blockReaction",
        generationId: generationId,
        beforeMessages: historyForRequest,
        requestSnapshot: {
          blockReaction: true,
          blockReactionType: reactionType || "userBlocked",
          blockReason: reason || "",
          previousReplyText: getPreviousPrivateReplyText(historyForRequest)
        }
      });
    } catch (error) {
      messages = removeLoadingMessagesByGeneration(window.AppStorage.getChatHistory(characterId), generationId);
      messages.push({
        id: String(Date.now()),
        role: "character",
        type: "error",
        content: "回复失败：" + (error && error.message ? error.message : "未知错误"),
        createdAt: Date.now(),
        generationId: generationId
      });
      window.AppStorage.saveChatHistory(characterId, messages);
      schedulePrivateRender(characterId);
      schedulePrivateListRender();
    }
  }

  function deleteActiveCharacter() {
    if (activeCharacterId) {
      deleteCharacterWithConfirm(activeCharacterId);
    }
  }

  function openActiveCharacterOffline() {
    closeAllMenus();

    if (isInlineOfflineActive() && window.OfflineManager) {
      window.OfflineManager.disableInlineOffline();
      return;
    }

    if (activeCharacterId && window.OfflineManager) {
      window.OfflineManager.openPrivateOffline(activeCharacterId);
    }
  }

  function isInlineOfflineActive() {
    return Boolean(activeCharacterId
      && window.OfflineManager
      && window.OfflineManager.isInlineOfflineActive
      && window.OfflineManager.isInlineOfflineActive("private", activeCharacterId));
  }

  function updateInlineOfflineUi() {
    var active = isInlineOfflineActive();
    var bar = getElement("privateOfflineModeBar");
    var input = getElement("chatInput");
    var replyButton = getElement("replyButton");
    var menuButton = getElement("chatOfflineBtn");

    if (bar) {
      bar.classList.add("hidden");
    }

    if (input) {
      input.placeholder = active ? "说点什么，或描述你的动作..." : "输入消息";
    }

    if (replyButton && !replyButton.disabled) {
      setCompactReplyButton(replyButton, active ? "推进" : "发送", false);
    }

    if (menuButton) {
      menuButton.textContent = active ? "退出线下模式" : "进入线下模式";
    }
  }

  function ensurePrivateBlockNotice() {
    var notice = getElement("privateBlockNotice");
    var messages = getElement("chatMessages");

    if (notice || !messages || !messages.parentNode) {
      return notice;
    }

    notice = document.createElement("div");
    notice.id = "privateBlockNotice";
    notice.className = "private-block-notice hidden";
    messages.parentNode.insertBefore(notice, messages);
    return notice;
  }

  function updatePrivateBlockUi(characterId) {
    var state = characterId ? getPrivateBlockState(characterId) : {};
    var notice = ensurePrivateBlockNotice();
    var input = getElement("chatInput");
    var menuButton = getElement("chatBlockBtn");
    var blockedText = "";

    if (state.userBlocked) {
      blockedText = "已拉黑，对方消息会被拦截";
    } else if (state.characterBlocked) {
      blockedText = "对方暂时拒收你的消息";
    }

    if (notice) {
      notice.textContent = blockedText;
      notice.classList.toggle("hidden", !blockedText);
    }

    if (input && !isInlineOfflineActive()) {
      input.placeholder = state.userBlocked ? "已拉黑，仍可发送但不会触发正常回复" : (state.characterBlocked ? "对方暂时拒收你的消息" : "输入消息");
    }

    if (menuButton) {
      menuButton.textContent = state.userBlocked ? "取消拉黑" : "拉黑";
    }
  }

  function getPrivateChatSettings(character) {
    return Object.assign({
      pinned: false,
      remarkName: "",
      timestampEnabled: false,
      timestampStyle: "below",
      timestampShowSeconds: false,
      hideUserAvatar: false,
      hideCharacterAvatar: false,
      bubbleRadius: 8,
      readReceiptEnabled: false,
      patAction: "",
      chatBackground: "",
      familyCardId: "",
      userPersonaId: "",
      userPersonaOverride: {
        name: "",
        avatar: "",
        persona: ""
      },
      memoryEnabled: true
    }, character && character.chatSettings || {});
  }

  function openActivePrivateSettings() {
    var character = activeCharacterId ? getCharacterById(activeCharacterId) : null;

    closeAllMenus();

    if (!character) {
      return;
    }

    renderPrivateChatSettings(character);
    window.setActivePage("privateChatSettingsScreen");
  }

  function openActiveChatMemory() {
    var character = activeCharacterId ? getCharacterById(activeCharacterId) : null;

    closeAllMenus();

    if (character && window.AppExtras && window.AppExtras.openChatMemoryPanel) {
      window.AppExtras.openChatMemoryPanel("private", character.id, (character.chatSettings && character.chatSettings.remarkName || character.name || "私聊") + " · 记忆");
    }
  }

  function openActiveChatWorldBookSelector() {
    var character = activeCharacterId ? getCharacterById(activeCharacterId) : null;

    closeAllMenus();

    if (character && window.AppExtras && window.AppExtras.openChatWorldBookSelector) {
      window.AppExtras.openChatWorldBookSelector("private", character.id);
    }
  }

  function openActiveBodyState() {
    var character = activeCharacterId ? getCharacterById(activeCharacterId) : null;

    closeAllMenus();

    if (character && window.AppExtras && window.AppExtras.openBodyStatePanel) {
      window.AppExtras.openBodyStatePanel("private", character.id, "你的身体状态");
    }
  }

  function renderUserPersonaOptions(selectedId) {
    var personas = window.AppStorage.getUserPersonas ? window.AppStorage.getUserPersonas() : [];

    return [
      '<option value="">不绑定我的人设预设</option>',
      personas.map(function (persona) {
        return '<option value="' + escapeHtml(persona.id) + '"' + (selectedId === persona.id ? " selected" : "") + ">" + escapeHtml(persona.name || "未命名人设") + "</option>";
      }).join("")
    ].join("");
  }

  function renderPrivateChatSettings(character) {
    var form = getElement("privateChatSettingsForm");
    var settings = getPrivateChatSettings(character);
    var momentSettings = getCharacterMomentSettings(character);
    var diarySettings = getCharacterDiarySettings(character);
    var persona = settings.userPersonaOverride || {};
    var familyCards = window.AppStorage.getFamilyCardsForCharacter ? window.AppStorage.getFamilyCardsForCharacter(character.id) : [];

    if (!form) {
      return;
    }

    form.innerHTML = [
      '<section class="form-section">',
      '<div class="section-title-row"><h3>基础信息</h3><span>角色</span></div>',
      '<div class="field-group"><label>角色昵称</label><input data-private-field="name" type="text" value="' + escapeHtml(character.name) + '"></div>',
      '<div class="field-group"><label>备注名</label><input data-private-field="remarkName" type="text" value="' + escapeHtml(settings.remarkName) + '"></div>',
      '<div class="field-group"><label>角色人设</label><textarea class="persona-textarea" data-private-field="personality">' + escapeHtml(buildCharacterPersonaText(character)) + '</textarea></div>',
      "</section>",
      '<section class="form-section">',
      '<div class="section-title-row"><h3>朋友圈设置</h3><span>动态</span></div>',
      '<label class="switch-row"><input data-private-field="momentAutoPostEnabled" type="checkbox"' + (momentSettings.autoPostEnabled ? " checked" : "") + '>允许主动发朋友圈</label>',
      '<div class="field-group"><label>朋友圈频率</label><select data-private-field="momentFrequency">' + renderMomentFrequencyOptions(momentSettings.frequency) + '</select></div>',
      '<label class="switch-row"><input data-private-field="momentAllowRelatedComments" type="checkbox"' + (momentSettings.allowRelatedCharacterComments ? " checked" : "") + '>允许认识的人评论</label>',
      "</section>",
      '<section class="form-section">',
      '<div class="section-title-row"><h3>日记设置</h3><span>记录</span></div>',
      '<label class="switch-row"><input data-private-field="diaryAutoEnabled" type="checkbox"' + (diarySettings.autoDiaryEnabled ? " checked" : "") + '>允许自动写日记</label>',
      '<div class="field-group"><label>日记频率</label><select data-private-field="diaryFrequency">' + renderDiaryFrequencyOptions(diarySettings.frequency) + '</select></div>',
      '<label class="switch-row"><input data-private-field="diaryUseChatHistory" type="checkbox"' + (diarySettings.allowUseChatHistory ? " checked" : "") + '>允许使用聊天记录</label>',
      '<label class="switch-row"><input data-private-field="diaryUseThoughts" type="checkbox"' + (diarySettings.allowUseThoughts ? " checked" : "") + '>允许使用心声</label>',
      "</section>",
      '<section class="form-section">',
      '<div class="section-title-row"><h3>我在聊天中的身份</h3><span>专属</span></div>',
      '<div class="field-group"><label>我在 TA 面前是谁</label><select data-private-field="userPersonaId">' + renderUserPersonaOptions(settings.userPersonaId || "") + '</select></div>',
      '<div class="field-group"><label>我的昵称</label><input data-private-field="userName" type="text" value="' + escapeHtml(persona.name || "") + '"></div>',
      '<div class="field-group"><label>我的人设</label><textarea data-private-field="userPersona">' + escapeHtml(persona.persona || "") + '</textarea></div>',
      "</section>",
      '<section class="form-section">',
      '<div class="section-title-row"><h3>聊天显示</h3><span>外观</span></div>',
      '<label class="switch-row"><input data-private-field="timestampEnabled" type="checkbox"' + (settings.timestampEnabled ? " checked" : "") + '>显示时间戳</label>',
      '<div class="field-group"><label>时间戳样式</label><select data-private-field="timestampStyle">' + renderTimestampStyleOptions(settings.timestampStyle) + '</select></div>',
      '<label class="switch-row"><input data-private-field="timestampShowSeconds" type="checkbox"' + (settings.timestampShowSeconds ? " checked" : "") + '>显示秒</label>',
      '<label class="switch-row"><input data-private-field="hideUserAvatar" type="checkbox"' + (settings.hideUserAvatar ? " checked" : "") + '>隐藏我的头像</label>',
      '<label class="switch-row"><input data-private-field="hideCharacterAvatar" type="checkbox"' + (settings.hideCharacterAvatar ? " checked" : "") + '>隐藏对方头像</label>',
      '<div class="field-group"><label>气泡圆角</label><input data-private-field="bubbleRadius" type="number" min="2" max="24" value="' + escapeHtml(settings.bubbleRadius || 8) + '"></div>',
      '<div class="field-group"><label>聊天背景图</label><input data-private-field="chatBackground" type="text" value="' + escapeHtml(settings.chatBackground || "") + '" placeholder="可粘贴图片 data URL 或地址"><input data-private-file="chatBackground" type="file" accept="image/*"><small class="field-help">上传后会转为 base64 保存在本地。</small></div>',
      "</section>",
      '<section class="form-section">',
      '<div class="section-title-row"><h3>消息行为</h3><span>聊天</span></div>',
      '<label class="switch-row"><input data-private-field="pinned" type="checkbox"' + (settings.pinned ? " checked" : "") + '>置顶聊天</label>',
      '<label class="switch-row"><input data-private-field="readReceiptEnabled" type="checkbox"' + (settings.readReceiptEnabled ? " checked" : "") + '>消息已读状态</label>',
      '<div class="field-group"><label>拍一拍文案</label><input data-private-field="patAction" type="text" value="' + escapeHtml(settings.patAction || "") + '"></div>',
      '<div class="field-group"><label>绑定亲属卡</label><select data-private-field="familyCardId"><option value="">不绑定</option>' + familyCards.map(function (card) {
        return '<option value="' + escapeHtml(card.id) + '"' + (settings.familyCardId === card.id ? " selected" : "") + ">" + escapeHtml(card.name) + "（剩余 ¥" + escapeHtml(formatAmount(Math.max(0, card.totalLimit - card.usedAmount))) + "）</option>";
      }).join("") + '</select><small class="field-help">可在钱包 > 亲属卡新增；聊天输入栏也可以使用亲属卡支付。</small></div>',
      '<button class="outline-button danger" type="button" data-private-action="clear-history">清空聊天记录</button>',
      "</section>",
      '<section class="form-section">',
      '<div class="section-title-row"><h3>记忆设置</h3><span>长期记忆</span></div>',
      '<label class="switch-row"><input data-private-field="memoryEnabled" type="checkbox"' + (settings.memoryEnabled !== false ? " checked" : "") + '>开启长期记忆</label>',
      '<button class="outline-button" type="button" data-private-action="view-memory">查看本私聊记忆</button>',
      '<button class="outline-button danger" type="button" data-private-action="clear-chat-memory">清空本私聊记忆</button>',
      '<button class="outline-button danger" type="button" data-private-action="clear-memory">清空该角色记忆</button>',
      "</section>"
    ].join("");

    form.onclick = handlePrivateSettingsAction;
    form.onchange = handlePrivateSettingsChange;
  }

  function renderTimestampStyleOptions(value) {
    return [
      '<option value="below"' + (value === "below" ? " selected" : "") + ">气泡下方</option>",
      '<option value="center"' + (value === "center" ? " selected" : "") + ">居中分隔</option>",
      '<option value="none"' + (value === "none" ? " selected" : "") + ">不显示</option>"
    ].join("");
  }

  function renderMomentFrequencyOptions(value) {
    return [
      '<option value="low"' + (value === "low" ? " selected" : "") + ">偶尔</option>",
      '<option value="normal"' + (value === "normal" ? " selected" : "") + ">普通</option>",
      '<option value="high"' + (value === "high" ? " selected" : "") + ">较频繁</option>"
    ].join("");
  }

  function renderDiaryFrequencyOptions(value) {
    return [
      '<option value="daily"' + (value === "daily" ? " selected" : "") + ">每日</option>",
      '<option value="often"' + (value === "often" ? " selected" : "") + ">经常</option>",
      '<option value="low"' + (value === "low" ? " selected" : "") + ">偶尔</option>"
    ].join("");
  }

  function handlePrivateSettingsAction(event) {
    var button = event.target.closest("[data-private-action]");

    if (!button || !activeCharacterId) {
      return;
    }

    if (button.dataset.privateAction === "clear-history") {
      clearActiveChatHistory();
      renderPrivateChatSettings(getCharacterById(activeCharacterId));
      return;
    }

    if (button.dataset.privateAction === "clear-memory" && window.confirm("确定清空该角色记忆吗？")) {
      window.AppStorage.resetPrivateCharacterState(activeCharacterId);
      window.alert("已清空记忆并恢复默认身体状态");
      renderPrivateChatSettings(getCharacterById(activeCharacterId));
      return;
    }

    if (button.dataset.privateAction === "clear-chat-memory" && window.confirm("确定清空本私聊记忆吗？")) {
      window.AppStorage.resetPrivateChatState(activeCharacterId);
      addPrivateSystemMessage(activeCharacterId, "本次私聊状态已重置，已清除本次聊天记忆。");
      window.alert("已清空本私聊记忆并重置本次会话状态");
      renderChatMessages(activeCharacterId);
      if (typeof updateThoughtButton === "function") {
        updateThoughtButton(activeCharacterId);
      }
      renderPrivateChatSettings(getCharacterById(activeCharacterId));
      return;
    }

    if (button.dataset.privateAction === "view-memory") {
      openActiveChatMemory();
      return;
    }

    if (button.dataset.privateAction === "view-body-state") {
      openActiveBodyState();
      return;
    }

    if (button.dataset.privateAction === "view-thoughts") {
      openActiveCharacterThoughtsDrawer();
    }
  }

  function handlePrivateSettingsChange(event) {
    var input = event.target.closest("[data-private-file='chatBackground']");
    var file = input && input.files && input.files[0];

    if (!file) {
      return;
    }

    readFileAsDataUrl(file, function (dataUrl) {
      var field = getElement("privateChatSettingsForm").querySelector("[data-private-field='chatBackground']");
      if (field) {
        field.value = dataUrl;
      }
      input.value = "";
    });
  }

  function readFileAsDataUrl(file, callback) {
    var reader = new FileReader();
    reader.onload = function () {
      callback(String(reader.result || ""));
    };
    reader.readAsDataURL(file);
  }

  function savePrivateChatSettings() {
    var character = activeCharacterId ? getCharacterById(activeCharacterId) : null;
    var form = getElement("privateChatSettingsForm");
    var userPersonaOverride;
    var next;

    if (!character || !form) {
      return;
    }

    userPersonaOverride = character.chatSettings && character.chatSettings.userPersonaOverride || {};

    next = {
      name: getPrivateField("name") || character.name,
      avatar: character.avatar || "",
      gender: "",
      identity: "",
      personality: getPrivateField("personality") || buildCharacterPersonaText(character),
      background: "",
      speakingStyle: "",
      relationship: "",
      momentSettings: {
        autoPostEnabled: getPrivateChecked("momentAutoPostEnabled"),
        frequency: getPrivateField("momentFrequency") || "normal",
        allowRelatedCharacterComments: getPrivateChecked("momentAllowRelatedComments"),
        lastGeneratedAt: character.momentSettings ? Number(character.momentSettings.lastGeneratedAt) || 0 : 0
      },
      diarySettings: {
        autoDiaryEnabled: getPrivateChecked("diaryAutoEnabled"),
        frequency: getPrivateField("diaryFrequency") || "daily",
        allowUseChatHistory: getPrivateChecked("diaryUseChatHistory"),
        allowUseThoughts: getPrivateChecked("diaryUseThoughts")
      },
      chatSettings: {
        pinned: getPrivateChecked("pinned"),
        remarkName: getPrivateField("remarkName"),
        timestampEnabled: getPrivateChecked("timestampEnabled"),
        timestampStyle: getPrivateField("timestampStyle") || "below",
        timestampShowSeconds: getPrivateChecked("timestampShowSeconds"),
        hideUserAvatar: getPrivateChecked("hideUserAvatar"),
        hideCharacterAvatar: getPrivateChecked("hideCharacterAvatar"),
        bubbleRadius: Math.max(2, Math.min(24, Number(getPrivateField("bubbleRadius")) || 8)),
        readReceiptEnabled: getPrivateChecked("readReceiptEnabled"),
        patAction: getPrivateField("patAction"),
        chatBackground: getPrivateField("chatBackground"),
        familyCardId: getPrivateField("familyCardId"),
        userPersonaId: getPrivateField("userPersonaId"),
        userPersonaOverride: {
          name: getPrivateField("userName"),
          avatar: userPersonaOverride.avatar || "",
          persona: getPrivateField("userPersona")
        },
        memoryEnabled: getPrivateChecked("memoryEnabled")
      }
    };

    window.AppStorage.updateCharacter(character.id, next);
    updateChatHeader(getCharacterById(character.id));
    renderChatMessages(character.id);
    renderCharacterList();
    window.setActivePage("chatScreen");
  }

  function getPrivateField(name) {
    var field = getElement("privateChatSettingsForm").querySelector('[data-private-field="' + name + '"]');
    return field ? String(field.value || "").trim() : "";
  }

  function getPrivateChecked(name) {
    var field = getElement("privateChatSettingsForm").querySelector('[data-private-field="' + name + '"]');
    return Boolean(field && field.checked);
  }

  function openActiveCharacterThoughts() {
    closeAllMenus();

    if (activeCharacterId && window.AppExtras && window.AppExtras.openThoughtsForCharacter) {
      window.AppExtras.openThoughtsForCharacter(activeCharacterId, "chatScreen");
    }
  }

  function openActiveCharacterThoughtsDrawer() {
    closeAllMenus();

    if (activeCharacterId && window.AppExtras && window.AppExtras.openThoughtsDrawerForCharacter) {
      window.AppExtras.openThoughtsDrawerForCharacter(activeCharacterId);
    }
  }

  function updateThoughtButton(characterId) {
    var targetId = characterId || activeCharacterId;

    if (targetId && window.AppExtras && window.AppExtras.updatePrivateThoughtsButton) {
      window.AppExtras.updatePrivateThoughtsButton(targetId);
    }
  }

  function openActiveChatSearch() {
    var character = activeCharacterId ? getCharacterById(activeCharacterId) : null;
    var settings = getPrivateChatSettings(character);

    closeAllMenus();

    if (!character || !window.WeChatTools || !window.WeChatTools.openChatSearchSheet) {
      return;
    }

    window.WeChatTools.openChatSearchSheet({
      title: "搜索聊天记录",
      messages: window.AppStorage.getChatHistory(character.id),
      sender: function (message) {
        if (message.role === "user") {
          return "我";
        }
        if (message.role === "system") {
          return "系统";
        }
        return settings.remarkName || character.name || "角色";
      },
      onJump: function (messageId) {
        scrollToPrivateMessage(messageId);
      }
    });
  }

  function scrollToPrivateMessage(messageId) {
    var wrap = getElement("chatMessages");
    var target = null;

    if (!wrap) {
      return;
    }

    Array.prototype.some.call(wrap.querySelectorAll("[data-message-id]"), function (node) {
      if (node.dataset.messageId === messageId) {
        target = node;
        return true;
      }
      return false;
    });

    if (!target && activeCharacterId) {
      renderChatMessages(activeCharacterId, { forceFull: true });
      Array.prototype.some.call(wrap.querySelectorAll("[data-message-id]"), function (node) {
        if (node.dataset.messageId === messageId) {
          target = node;
          return true;
        }
        return false;
      });
    }

    if (target) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.classList.add("message-search-hit");
      window.setTimeout(function () {
        target.classList.remove("message-search-hit");
      }, 1600);
    }
  }

  function deleteCharacterWithConfirm(characterId) {
    var character = getCharacterById(characterId);

    closeAllMenus();

    if (!character) {
      renderCharacterList();
      return;
    }

    if (!window.confirm("确定要删除这个角色吗？删除后聊天记录也会一起删除。")) {
      return;
    }

    window.AppStorage.deleteCharacter(character.id);

    if (activeCharacterId === character.id) {
      activeCharacterId = "";
    }

    renderCharacterList();
    refreshHomeSummary();
    window.setActivePage("characterListScreen");
  }

  function deactivateActiveCharacter() {
    saveActivePrivateInputDraft();
    activeCharacterId = "";
    currentChatRenderToken = "";
    isPrivateMessageSelectionMode = false;
    selectedPrivateMessageIds = [];
    closeAllMenus();
  }

  function resetState() {
    saveActivePrivateInputDraft();
    activeCharacterId = "";
    currentChatRenderToken = "";
    createReturnPage = "characterListScreen";
    formMode = "create";
    editingCharacterId = "";
    selectedAvatar = "";
    isCharacterSelectionMode = false;
    selectedCharacterIds = [];
    isPrivateMessageSelectionMode = false;
    selectedPrivateMessageIds = [];
    setFormModeLabels();
    updateAvatarPreview();
    closeAllMenus();
  }

  function registerPrivateApiJobHandlers() {
    if (!window.AppApiJobs || !window.AppApiJobs.registerHandler) {
      return;
    }

    window.AppApiJobs.registerHandler("private", "chat", handlePrivateChatJob);
    window.AppApiJobs.registerHandler("private", "inlineOffline", handlePrivateInlineOfflineJob);
    window.AppApiJobs.registerHandler("private", "regenerate", handlePrivateRegenerateJob);
    window.AppApiJobs.registerHandler("private", "blockReaction", handlePrivateBlockReactionJob);
  }

  registerPrivateApiJobHandlers();

  window.CharacterManager = {
    renderCharacterList: renderCharacterList,
    toggleCharacterSelectionMode: toggleCharacterSelectionMode,
    openCreateCharacterScreen: openCreateCharacterScreen,
    openEditCharacterScreen: openEditCharacterScreen,
    closeCreateCharacterScreen: closeCreateCharacterScreen,
    saveCharacterFromForm: saveCharacterFromForm,
    handleAvatarFileChange: handleAvatarFileChange,
    openChatScreen: openChatScreen,
    renderChatMessages: renderChatMessages,
    sendUserMessage: sendUserMessage,
    handleComposerAction: handleComposerAction,
    toggleToolPanel: toggleToolPanel,
    closeToolPanel: closeToolPanel,
    sendToolMessage: sendToolMessage,
    requestCharacterReply: requestCharacterReply,
    openPrivateMessageSelectionMode: openPrivateMessageSelectionMode,
    toggleChatActionMenu: toggleChatActionMenu,
    closeAllMenus: closeAllMenus,
    editActiveCharacter: editActiveCharacter,
    clearActiveChatHistory: clearActiveChatHistory,
    deleteActiveCharacter: deleteActiveCharacter,
    toggleActiveCharacterBlock: toggleActiveCharacterBlock,
    openActiveCharacterOffline: openActiveCharacterOffline,
    updateInlineOfflineUi: updateInlineOfflineUi,
    openActivePrivateSettings: openActivePrivateSettings,
    openActiveChatMemory: openActiveChatMemory,
    openActiveChatWorldBookSelector: openActiveChatWorldBookSelector,
    openActiveBodyState: openActiveBodyState,
    openActiveRegenerateReply: openActiveRegenerateReply,
    savePrivateChatSettings: savePrivateChatSettings,
    openActiveCharacterThoughts: openActiveCharacterThoughts,
    openActiveCharacterThoughtsDrawer: openActiveCharacterThoughtsDrawer,
    updateThoughtButton: updateThoughtButton,
    getActiveCharacterId: function () {
      return activeCharacterId;
    },
    openActiveChatSearch: openActiveChatSearch,
    deleteCharacterWithConfirm: deleteCharacterWithConfirm,
    handlePrivateInputDraftChange: handlePrivateInputDraftChange,
    deactivateActiveCharacter: deactivateActiveCharacter,
    resetState: resetState
  };
})(window, document);
