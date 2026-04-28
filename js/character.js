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

  function normalizeDisplayText(text) {
    if (window.AIService && window.AIService.normalizeAiMessageText) {
      return window.AIService.normalizeAiMessageText(text);
    }

    return String(text || "").trim();
  }

  function getBubbleTextClass(text) {
    var value = normalizeDisplayText(text);

    return value.length > 0 && value.length <= 6 && value.indexOf("\n") === -1 ? " short-text" : "";
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
    if (character.personality) {
      return character.personality;
    }
    if (character.background) {
      return character.background;
    }
    return "这个角色还没有补充详细人设。";
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
        var identity = character.identity || character.gender || "未设定";
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
          '        <span class="character-badge">' + escapeHtml(identity) + "</span>",
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
    setFieldValue("characterGender", character.gender || "未设定");
    setFieldValue("characterIdentity", character.identity);
    setFieldValue("characterPersonality", character.personality);
    setFieldValue("characterBackground", character.background);
    setFieldValue("characterSpeakingStyle", character.speakingStyle);
    setFieldValue("characterRelationship", character.relationship);
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
      gender: getFieldValue("characterGender"),
      identity: getFieldValue("characterIdentity"),
      personality: getFieldValue("characterPersonality"),
      background: getFieldValue("characterBackground"),
      speakingStyle: getFieldValue("characterSpeakingStyle"),
      relationship: getFieldValue("characterRelationship"),
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

  function openChatScreen(characterId) {
    var character = getCharacterById(characterId);

    if (!character) {
      renderCharacterList();
      window.setActivePage("characterListScreen");
      return;
    }

    activeCharacterId = characterId;
    isPrivateMessageSelectionMode = false;
    selectedPrivateMessageIds = [];
    updateChatHeader(character);
    updateInlineOfflineUi();
    closeAllMenus();
    ensureOpeningMessage(character);
    renderChatMessages(characterId);
    window.setActivePage("chatScreen");
    updateThoughtButton();
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

  function renderChatMessages(characterId) {
    var messagesWrap = getElement("chatMessages");
    var messages = window.AppStorage.getChatHistory(characterId);
    var character = getCharacterById(characterId);
    var settings = getPrivateChatSettings(character);
    var messageIds = messages.map(function (message) {
      return message.id;
    });
    var selectableCount = getSelectablePrivateMessages(messages).length;

    if (!messagesWrap) {
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
      messagesWrap.innerHTML = renderPrivateMessagesWithDates(messages, character) + (isPrivateMessageSelectionMode ? renderPrivateMessageBatchActionBar(selectableCount) : "");
      bindPrivateMessageActions(messagesWrap, messages);
      bindPrivateMessageDetails(messagesWrap, messages);
    }

    if (isPrivateMessageSelectionMode) {
      bindPrivateMessageBatchActions(messagesWrap, messages);
    }

    if (!isPrivateMessageSelectionMode) {
      requestAnimationFrame(function () {
        messagesWrap.scrollTop = messagesWrap.scrollHeight;
      });
    }

    updateThoughtButton(characterId);
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
        '  <div class="group-system-message">' + escapeHtml(message.content) + "</div>",
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

    return [
      '<div class="message-row ' + roleClass + ' message-action-target" data-message-id="' + messageId + '">',
      selectCheck,
      roleClass === "user"
        ? '  <div class="' + bubbleClass + '">' + renderMessageContent(message) + "</div>" + avatar
        : avatar + '  <div class="' + bubbleClass + '">' + renderMessageContent(message) + "</div>",
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
      '  <div class="message-bubble' + getBubbleTextClass(message.content) + '">' + escapeHtml(normalizeDisplayText(message.content)) + "</div>",
      "</div>"
    ].join("");
  }

  function renderOfflineActionMessage(message, selectCheck) {
    return [
      '<div class="message-row system offline-action-row message-action-target" data-message-id="' + escapeHtml(message.id || "") + '">',
      selectCheck,
      '  <div class="inline-offline-action-card"><i aria-hidden="true">✦</i><span>' + escapeHtml(message.content) + '</span><small>' + formatInlineTime(message.createdAt) + "</small></div>",
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
      '    <div class="inline-offline-speech-bubble">' + escapeHtml(message.content) + "</div>",
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

  function isStandaloneMessage(message) {
    return message.type === "redPacket"
      || message.type === "transfer"
      || message.type === "location"
      || message.type === "emoji"
      || message.type === "image"
      || message.type === "voice";
  }

  function renderStandaloneMessage(message) {
    if (message.type === "redPacket") {
      return renderRedPacketMessage(message);
    }

    if (message.type === "transfer") {
      return renderTransferMessage(message);
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

  function renderRedPacketMessage(message) {
    var canReceive = message.role === "character";
    var received = isMoneyMessageReceived(message);
    return [
      '<button class="message-special-wrapper red-packet-card message-detail-trigger' + (received ? " received" : "") + '" type="button" data-message-id="' + escapeHtml(message.id || "") + '"' + (canReceive && !received ? ' data-money-claim="redPacket"' : "") + '>',
      '  <span class="money-card-icon">福</span>',
      '  <span class="money-card-main">',
      "    <strong>" + escapeHtml(message.content || "恭喜发财，大吉大利") + "</strong>",
      "    <em>微信红包</em>",
      canReceive ? '    <small class="money-card-action">' + (received ? "已领取" : "领取红包") + "</small>" : "",
      "  </span>",
      "</button>"
    ].join("");
  }

  function renderTransferMessage(message) {
    var canReceive = message.role === "character";
    var received = isMoneyMessageReceived(message);
    return [
      '<button class="message-special-wrapper transfer-message-card message-detail-trigger' + (received ? " received" : "") + '" type="button" data-message-id="' + escapeHtml(message.id || "") + '"' + (canReceive && !received ? ' data-money-claim="transfer"' : "") + '>',
      '  <span class="money-card-icon">¥</span>',
      '  <span class="money-card-main">',
      "    <strong>¥" + escapeHtml(message.amount || "0.00") + "</strong>",
      "    <em>" + escapeHtml(message.note || "转账") + "</em>",
      "    <small>微信转账</small>",
      canReceive ? '    <small class="money-card-action">' + (received ? "已收款" : "收款") + "</small>" : "",
      "  </span>",
      "</button>"
    ].join("");
  }

  function isMoneyMessageReceived(message) {
    return Boolean(message && (message.received || message.walletRecorded || message.walletLedgerId));
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

        event.preventDefault();
        event.stopPropagation();

        if (row && row.dataset.longPressed === "true") {
          row.dataset.longPressed = "";
          return;
        }

        if (message && button.dataset.moneyClaim) {
          receivePrivateMoneyMessage(message.id);
          return;
        }

        if (message && window.WeChatTools && window.WeChatTools.showMessageDetail) {
          window.WeChatTools.showMessageDetail(message);
        }
      });
    });
  }

  function receivePrivateMoneyMessage(messageId) {
    var character = activeCharacterId ? getCharacterById(activeCharacterId) : null;
    var messages;
    var changed = false;

    if (!character || !window.AppStorage.receiveMoneyMessage) {
      return;
    }

    messages = window.AppStorage.getChatHistory(character.id).map(function (message) {
      if (message.id !== messageId) {
        return message;
      }

      changed = true;
      return window.AppStorage.receiveMoneyMessage(Object.assign({}, message), {
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
    }
  }

  function isPrivateMessageSelectable(message) {
    return Boolean(message && message.id && message.type !== "loading");
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

    if (!activeCharacterId || !ids.length) {
      return;
    }

    if (!window.confirm("确定删除选中的 " + ids.length + " 条消息吗？")) {
      return;
    }

    messages = window.AppStorage.getChatHistory(activeCharacterId).filter(function (message) {
      return ids.indexOf(message.id) === -1;
    });
    window.AppStorage.saveChatHistory(activeCharacterId, messages);

    isPrivateMessageSelectionMode = false;
    selectedPrivateMessageIds = [];
    renderChatMessages(activeCharacterId);
    renderCharacterList();
  }

  function openPrivateMessageMenu(message) {
    if (!window.MessageActionMenu) {
      return;
    }

    window.MessageActionMenu.open({
      canRegenerate: message.role === "user",
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

    if (action === "delete") {
      messages = messages.filter(function (item) {
        return item.id !== messageId;
      });
      window.AppStorage.saveChatHistory(activeCharacterId, messages);
      renderChatMessages(activeCharacterId);
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
      regeneratePrivateReplyFromMessage(messageId);
    }
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

  function sendUserMessage() {
    var input = getElement("chatInput");
    var content = input ? input.value.trim() : "";
    var now;
    var messages;
    var isOffline = isInlineOfflineActive();

    if (!activeCharacterId || !getCharacterById(activeCharacterId) || !content) {
      return;
    }

    now = Date.now();
    messages = window.AppStorage.getChatHistory(activeCharacterId);

    messages.push({
      id: String(now),
      role: "user",
      type: isOffline ? "offlineUserAction" : "text",
      content: content,
      createdAt: now
    });

    window.AppStorage.addCharacterMemory(activeCharacterId, {
      content: (isOffline ? "用户在线下模式中说/做：" : "用户曾说：") + content,
      source: isOffline ? "offline" : "private",
      createdAt: now
    });

    window.AppStorage.saveChatHistory(activeCharacterId, messages);

    if (input) {
      input.value = "";
      input.focus();
    }

    closeToolPanel();
    renderChatMessages(activeCharacterId);
    renderCharacterList();
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
    amount = window.prompt("使用「" + card.name + "」支付金额", "20.00");
    if (amount === null) {
      return;
    }

    amount = Number(amount);
    if (!amount || amount <= 0) {
      window.alert("请输入有效金额。");
      return;
    }

    note = window.prompt("支付备注", "亲属卡支付") || "亲属卡支付";
    appendPrivateToolMessage(characterId, {
      type: "transfer",
      content: "亲属卡支付",
      amount: amount.toFixed(2),
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
      sourceName: character.name
    }) || message;
  }

  function getMessageMemoryText(message) {
    if (message.type === "redPacket") {
      return "红包：" + (message.content || "恭喜发财，大吉大利");
    }
    if (message.type === "transfer") {
      return "转账：" + (message.amount || "");
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

  async function regeneratePrivateReplyFromMessage(messageId) {
    var requestCharacterId = activeCharacterId;
    var character = requestCharacterId ? getCharacterById(requestCharacterId) : null;
    var messages;
    var index;
    var nextIndex;
    var before;
    var after;
    var loadingMessage;
    var aiResult;
    var replies;
    var reply;

    if (!requestCharacterId || !character || isSending) {
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
    while (nextIndex < messages.length && messages[nextIndex].role === "character") {
      nextIndex += 1;
    }

    before = messages.slice(0, index + 1);
    after = messages.slice(nextIndex);
    loadingMessage = {
      id: String(Date.now()),
      role: "character",
      type: "loading",
      content: "正在输入...",
      createdAt: Date.now()
    };

    isSending = true;
    setReplyState(true);
    window.AppStorage.saveChatHistory(requestCharacterId, before.concat([loadingMessage], after));
    renderChatMessages(requestCharacterId);

    try {
      if (window.AIService.sendPrivateChatRequest) {
        aiResult = normalizePrivateAiResult(await window.AIService.sendPrivateChatRequest(character, before));
        replies = aiResult.replies;
      } else {
        reply = await window.AIService.sendChatRequest(character, before);
        aiResult = normalizePrivateAiResult({ replies: [{ content: reply }] });
        replies = aiResult.replies;
      }

      persistPrivateAiExtras(requestCharacterId, aiResult, "private");
      await streamPrivateReplies(before.slice(), requestCharacterId, replies, after);
      messages = null;
    } catch (error) {
      messages = before.concat([{
        id: String(Date.now()),
        role: "character",
        type: "error",
        content: "回复失败：" + (error && error.message ? error.message : "未知错误"),
        createdAt: Date.now()
      }], after);
    } finally {
      if (getCharacterById(requestCharacterId)) {
        if (messages) {
          window.AppStorage.saveChatHistory(requestCharacterId, messages);
        }
        if (activeCharacterId === requestCharacterId) {
          renderChatMessages(requestCharacterId);
        }
        renderCharacterList();
      }
      isSending = false;
      setReplyState(false);
    }
  }

  function appendPrivateReplies(messages, characterId, replies) {
    var startAt = Date.now();

    (replies || []).slice(0, 50).forEach(function (item, index) {
      var createdAt;
      var message;

      if (!item || !item.content) {
        return;
      }

      createdAt = startAt + index;
      message = createPrivateCharacterReplyMessage(item, createdAt);
      message = recordPrivateMoneyMessage(message, getCharacterById(characterId));
      messages.push(message);
      window.AppStorage.addCharacterMemory(characterId, {
        content: "角色曾回复：" + getMessageMemoryText(message),
        source: "private",
        createdAt: createdAt
      });
    });

    return messages;
  }

  function streamPrivateReplies(baseMessages, characterId, replies, suffixMessages) {
    var shown = [];
    var startAt = Date.now();
    var suffix = Array.isArray(suffixMessages) ? suffixMessages : [];
    var items = (replies || []).slice(0, 50).filter(function (item) {
      return item && item.content;
    });

    if (!window.AppStream || !window.AppStream.appendMessagesWithStreamEffect) {
      window.AppStorage.saveChatHistory(characterId, appendPrivateReplies(baseMessages.slice(), characterId, items).concat(suffix));
      if (activeCharacterId === characterId) {
        renderChatMessages(characterId);
      }
      return Promise.resolve();
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

        message = createPrivateCharacterReplyMessage(item, createdAt);
        message = recordPrivateMoneyMessage(message, character);
        shown.push(message);
        window.AppStorage.addCharacterMemory(characterId, {
          content: "角色曾回复：" + getMessageMemoryText(message),
          source: "private",
          createdAt: createdAt
        });
        window.AppStorage.saveChatHistory(characterId, baseMessages.concat(shown, suffix));
        if (activeCharacterId === characterId) {
          renderChatMessages(characterId);
        }
        renderCharacterList();
      }
    });
  }

  function normalizePrivateAiResult(result) {
    if (Array.isArray(result)) {
      return { replies: result, thoughts: [], memories: [] };
    }

    result = result && typeof result === "object" ? result : {};
    return {
      replies: Array.isArray(result.replies) ? result.replies : [],
      thoughts: Array.isArray(result.thoughts) ? result.thoughts : [],
      memories: Array.isArray(result.memories) ? result.memories : []
    };
  }

  function persistPrivateAiExtras(characterId, result, source) {
    var now = Date.now();
    var character = getCharacterById(characterId);

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
          createdAt: now
        });
      });
    } catch (error) {
      console.warn("角色记忆保存失败，聊天回复已保留。", error);
    }
  }

  function createPrivateCharacterReplyMessage(reply, createdAt) {
    var source = reply && typeof reply === "object" ? reply : { content: String(reply || "") };
    var type = source.type || "text";
    var message = Object.assign({}, source, {
      id: String(createdAt + Math.random()),
      role: "character",
      type: type,
      createdAt: createdAt
    });

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
      message.amount = source.amount || "8.88";
      message.status = source.status || "sent";
      message.content = source.content || "恭喜发财，大吉大利";
    }

    if (type === "transfer") {
      message.amount = source.amount || "20.00";
      message.note = source.note || "";
      message.status = source.status || "pending";
      message.content = source.content || "转账";
    }

    message.content = normalizeDisplayText(message.content || source.content || "");
    return message;
  }

  function estimateVoiceDuration(text) {
    return Math.min(60, Math.max(2, Math.ceil(String(text || "").length / 4)));
  }

  async function requestCharacterReply() {
    var requestCharacterId = activeCharacterId;
    var character = requestCharacterId ? getCharacterById(requestCharacterId) : null;
    var messages;
    var historyForRequest;
    var now;
    var loadingMessage;
    var aiResult;
    var replies;
    var reply;
    var errorContent;

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
      messages.push({
        id: String(Date.now()),
        role: "character",
        content: "先发一句话，我再回复你。",
        createdAt: Date.now()
      });
      window.AppStorage.saveChatHistory(requestCharacterId, messages);
      renderChatMessages(requestCharacterId);
      renderCharacterList();
      return;
    }

    if (isSending) {
      return;
    }

    isSending = true;
    setReplyState(true);

    now = Date.now();
    historyForRequest = messages.slice();

    loadingMessage = {
      id: String(now),
      role: "character",
      type: "loading",
      content: "正在输入...",
      createdAt: now
    };

    messages.push(loadingMessage);
    window.AppStorage.saveChatHistory(requestCharacterId, messages);
    renderChatMessages(requestCharacterId);

    try {
      if (window.AIService.sendPrivateChatRequest) {
        aiResult = normalizePrivateAiResult(await window.AIService.sendPrivateChatRequest(character, historyForRequest));
        replies = aiResult.replies;
      } else {
        reply = await window.AIService.sendChatRequest(character, historyForRequest);
        aiResult = normalizePrivateAiResult({ replies: [{ content: reply }] });
        replies = aiResult.replies;
      }

      messages = removeLoadingMessages(window.AppStorage.getChatHistory(requestCharacterId));
      window.AppStorage.saveChatHistory(requestCharacterId, messages);
      if (activeCharacterId === requestCharacterId) {
        renderChatMessages(requestCharacterId);
      }
      persistPrivateAiExtras(requestCharacterId, aiResult, "private");
      await streamPrivateReplies(messages, requestCharacterId, replies, []);
      messages = null;
    } catch (error) {
      errorContent = error && error.message === window.AIService.MISSING_SETTINGS_MESSAGE
        ? window.AIService.MISSING_SETTINGS_MESSAGE
        : "回复失败：" + (error && error.message ? error.message : "未知错误");

      messages = removeLoadingMessages(window.AppStorage.getChatHistory(requestCharacterId));
      messages.push({
        id: String(Date.now()),
        role: "character",
        type: "error",
        content: errorContent,
        createdAt: Date.now()
      });
    } finally {
      if (getCharacterById(requestCharacterId)) {
        if (messages) {
          window.AppStorage.saveChatHistory(requestCharacterId, messages);
        }
        if (activeCharacterId === requestCharacterId) {
          renderChatMessages(requestCharacterId);
        }
        renderCharacterList();
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

  function setReplyState(sending) {
    var replyButton = getElement("replyButton");
    var isOffline = isInlineOfflineActive();

    if (!replyButton) {
      return;
    }

    replyButton.disabled = sending;
    replyButton.textContent = sending ? (isOffline ? "推进中" : "回复中") : (isOffline ? "推进" : "回复");
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
      replyButton.textContent = active ? "推进" : "回复";
    }

    if (menuButton) {
      menuButton.textContent = active ? "退出线下模式" : "进入线下模式";
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
      '<div class="field-group"><label>角色头像</label><input data-private-field="avatar" type="text" value="' + escapeHtml(character.avatar || "") + '" placeholder="可粘贴图片 data URL 或地址"></div>',
      '<div class="field-group"><label>角色身份</label><input data-private-field="identity" type="text" value="' + escapeHtml(character.identity || "") + '"></div>',
      '<div class="field-group"><label>角色人设</label><textarea data-private-field="personality">' + escapeHtml(character.personality || "") + '</textarea></div>',
      '<div class="field-group"><label>说话风格</label><textarea data-private-field="speakingStyle">' + escapeHtml(character.speakingStyle || "") + '</textarea></div>',
      '<div class="field-group"><label>关系设定</label><input data-private-field="relationship" type="text" value="' + escapeHtml(character.relationship || "") + '"></div>',
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
      '<div class="field-group"><label>我的头像</label><input data-private-field="userAvatar" type="text" value="' + escapeHtml(persona.avatar || "") + '"></div>',
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
      '<button class="outline-button" type="button" data-private-action="view-thoughts">查看该角色心声</button>',
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
      window.AppStorage.clearCharacterMemory(activeCharacterId);
      window.alert("已清空记忆");
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
    var next;

    if (!character || !form) {
      return;
    }

    next = {
      name: getPrivateField("name") || character.name,
      avatar: getPrivateField("avatar"),
      identity: getPrivateField("identity"),
      personality: getPrivateField("personality"),
      speakingStyle: getPrivateField("speakingStyle"),
      relationship: getPrivateField("relationship"),
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
          avatar: getPrivateField("userAvatar"),
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

  function resetState() {
    activeCharacterId = "";
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
    openActiveCharacterOffline: openActiveCharacterOffline,
    updateInlineOfflineUi: updateInlineOfflineUi,
    openActivePrivateSettings: openActivePrivateSettings,
    savePrivateChatSettings: savePrivateChatSettings,
    openActiveCharacterThoughts: openActiveCharacterThoughts,
    openActiveCharacterThoughtsDrawer: openActiveCharacterThoughtsDrawer,
    updateThoughtButton: updateThoughtButton,
    getActiveCharacterId: function () {
      return activeCharacterId;
    },
    openActiveChatSearch: openActiveChatSearch,
    deleteCharacterWithConfirm: deleteCharacterWithConfirm,
    resetState: resetState
  };
})(window, document);
