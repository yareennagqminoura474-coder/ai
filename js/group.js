(function (window, document) {
  "use strict";

  var selectedMemberIds = [];
  var activeGroupId = "";
  var createReturnPage = "groupListScreen";
  var isGroupReplying = false;
  var isGroupSelectionMode = false;
  var selectedGroupIds = [];
  var isGroupMessageSelectionMode = false;
  var selectedGroupMessageIds = [];
  var INITIAL_GROUP_RENDER_LIMIT = 60;
  var groupVisibleMessageCounts = {};
  var groupHistoryLoadSuppressedUntil = {};
  var groupInputDrafts = {};
  var currentGroupRenderToken = "";
  var collapsedAnnouncements = {};

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

  function normalizeDisplayText(text) {
    if (window.AIService && window.AIService.normalizeAiMessageText) {
      return window.AIService.normalizeAiMessageText(text);
    }

    return String(text || "").trim();
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

  function suppressGroupHistoryLoad(groupId) {
    groupHistoryLoadSuppressedUntil[groupId] = Date.now() + 700;
  }

  function isGroupHistoryLoadSuppressed(groupId) {
    return Date.now() < (groupHistoryLoadSuppressedUntil[groupId] || 0);
  }

  function getCharacterById(characterId) {
    return window.AppStorage.getCharacters().find(function (character) {
      return character.id === characterId;
    });
  }

  function getGroupById(groupId) {
    return window.AppStorage.getGroups().find(function (group) {
      return group.id === groupId;
    });
  }

  function getGroupCharacters(group) {
    return (group && group.memberIds || []).map(getCharacterById).filter(Boolean);
  }

  function getAvatarText(character) {
    var name = character && character.name ? character.name.trim() : "";
    return name ? name.slice(0, 1) : "心";
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

  function getCharacterPersonaPreview(character) {
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

  function getGroupUserDisplay(group, settings) {
    var groupSettings = settings || getGroupSettings(group);
    var profile = window.AppStorage.getUserProfile ? window.AppStorage.getUserProfile() : {};
    var resolved = window.AppStorage.resolveUserPersona
      ? window.AppStorage.resolveUserPersona(groupSettings.userPersonaId, groupSettings.userPersonaOverride)
      : null;

    return {
      name: resolved && resolved.name || profile.name || "我",
      avatar: resolved && resolved.avatar || profile.avatar || ""
    };
  }

  function renderGroupUserMessageAvatar(group, settings) {
    return renderUserAvatar(getGroupUserDisplay(group, settings), "message-avatar");
  }

  function refreshHomeSummary() {
    if (window.AppNavigation && window.AppNavigation.refreshHomeSummary) {
      window.AppNavigation.refreshHomeSummary();
    }
  }

  function getActivePage() {
    if (window.AppNavigation && window.AppNavigation.getActivePage) {
      return window.AppNavigation.getActivePage();
    }

    return "homeScreen";
  }

  function renderGroupList() {
    var listContent = getElement("groupListContent");
    var groups = window.AppStorage.getGroups();
    var groupIds = groups.map(function (group) {
      return group.id;
    });

    if (!listContent) {
      return;
    }

    closeAllMenus();
    selectedGroupIds = selectedGroupIds.filter(function (groupId) {
      return groupIds.indexOf(groupId) !== -1;
    });

    if (!groups.length) {
      isGroupSelectionMode = false;
      selectedGroupIds = [];
      updateGroupSelectionButton();
      listContent.classList.remove("selection-mode");
      listContent.innerHTML = [
        '<div class="empty-state">',
        '  <div class="empty-visual" aria-hidden="true"><span class="empty-dot"></span></div>',
        "  <h3>还没有群聊</h3>",
        "  <p>创建一个多人互动空间</p>",
        '  <button id="emptyCreateGroupBtn" class="full-button" type="button">创建群聊</button>',
        "</div>"
      ].join("");
      getElement("emptyCreateGroupBtn").addEventListener("click", openCreateGroupScreen);
      return;
    }

    updateGroupSelectionButton();
    listContent.classList.toggle("selection-mode", isGroupSelectionMode);
    listContent.innerHTML = [
      '<div class="group-list">',
      groups.map(renderGroupCard).join(""),
      "</div>",
      isGroupSelectionMode ? renderGroupBatchActionBar(groups.length) : ""
    ].join("");

    Array.prototype.forEach.call(listContent.querySelectorAll(".group-card"), function (card) {
      card.addEventListener("click", function () {
        if (isGroupSelectionMode) {
          toggleGroupSelection(card.dataset.groupId);
          return;
        }
        openGroupChatScreen(card.dataset.groupId);
      });
    });

    Array.prototype.forEach.call(listContent.querySelectorAll("[data-group-batch-action]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        handleGroupBatchAction(button.dataset.groupBatchAction);
      });
    });
  }

  function renderGroupCard(group) {
    var members = getGroupCharacters(group);
    var last = getGroupLastPreview(group.id);
    var selected = selectedGroupIds.indexOf(group.id) !== -1;

    return [
      '<button class="group-card ' + (isGroupSelectionMode ? "selection-mode " : "") + (selected ? "selected" : "") + '" type="button" data-group-id="' + escapeHtml(group.id) + '">',
      isGroupSelectionMode ? '  <span class="select-check ' + (selected ? "active" : "") + '" aria-hidden="true"></span>' : "",
      '  <span class="group-avatar-stack" aria-hidden="true">',
      members.slice(0, 4).map(function (member) {
        return renderAvatar(member, "group-stack-avatar");
      }).join(""),
      "  </span>",
      '  <span class="group-card-info">',
      "    <strong>" + escapeHtml(group.name) + "</strong>",
      '    <span>' + members.length + " 位成员</span>",
      '    <em>' + escapeHtml(last) + "</em>",
      "  </span>",
      "</button>"
    ].join("");
  }

  function renderGroupBatchActionBar(totalCount) {
    return [
      '<div class="batch-action-bar" aria-label="群聊批量操作">',
      '  <span class="batch-action-count">已选 ' + selectedGroupIds.length + ' 个</span>',
      '  <button class="batch-action-button" type="button" data-group-batch-action="all">' + (selectedGroupIds.length === totalCount ? "取消全选" : "全选") + '</button>',
      '  <button class="batch-action-button batch-action-danger" type="button" data-group-batch-action="delete">删除</button>',
      '  <button class="batch-action-button" type="button" data-group-batch-action="cancel">取消</button>',
      "</div>"
    ].join("");
  }

  function updateGroupSelectionButton() {
    var button = getElement("groupBatchSelectBtn");

    if (button) {
      button.textContent = isGroupSelectionMode ? "取消" : "选择";
    }
  }

  function toggleGroupSelectionMode() {
    isGroupSelectionMode = !isGroupSelectionMode;
    selectedGroupIds = [];
    renderGroupList();
  }

  function toggleGroupSelection(groupId) {
    var index = selectedGroupIds.indexOf(groupId);

    if (index === -1) {
      selectedGroupIds.push(groupId);
    } else {
      selectedGroupIds.splice(index, 1);
    }

    renderGroupList();
  }

  function handleGroupBatchAction(action) {
    var groups = window.AppStorage.getGroups();

    if (action === "all") {
      selectedGroupIds = selectedGroupIds.length === groups.length
        ? []
        : groups.map(function (group) {
          return group.id;
        });
      renderGroupList();
      return;
    }

    if (action === "cancel") {
      isGroupSelectionMode = false;
      selectedGroupIds = [];
      renderGroupList();
      return;
    }

    if (action === "delete") {
      deleteSelectedGroups();
    }
  }

  function deleteSelectedGroups() {
    var ids = selectedGroupIds.slice();

    if (!ids.length) {
      return;
    }

    if (!window.confirm("确定删除选中的 " + ids.length + " 个群聊吗？群聊记录也会一起删除。")) {
      return;
    }

    ids.forEach(function (groupId) {
      window.AppStorage.deleteGroup(groupId);
    });

    if (ids.indexOf(activeGroupId) !== -1) {
      activeGroupId = "";
      currentGroupRenderToken = "";
    }

    isGroupSelectionMode = false;
    selectedGroupIds = [];
    renderGroupList();
    refreshHomeSummary();
  }

  function getGroupLastPreview(groupId) {
    var history = window.AppStorage.getGroupChatHistory(groupId);
    var last = getLastVisibleGroupMessage(history);

    if (!last) {
      return "最近消息会显示在这里";
    }

    if (last.role === "user") {
      return "我：" + formatGroupMessagePreview(last);
    }

    if (last.role === "character") {
      return (last.characterName || "角色") + "：" + formatGroupMessagePreview(last);
    }

    return formatGroupMessagePreview(last);
  }

  function getLastVisibleGroupMessage(history) {
    var messages = Array.isArray(history) ? history : [];
    var index;

    for (index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index] && messages[index].role !== "system" && messages[index].type !== "loading" && messages[index].type !== "pat") {
        return messages[index];
      }
    }

    return null;
  }

  function formatGroupMessagePreview(message) {
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

  function openCreateGroupScreen() {
    var form = getElement("createGroupForm");
    var currentPage = getActivePage();

    selectedMemberIds = [];
    createReturnPage = currentPage === "createGroupScreen" ? "groupListScreen" : currentPage;
    hideGroupFormError();
    if (form) {
      form.reset();
    }
    renderMemberSelector();
    window.setActivePage("createGroupScreen");
  }

  function renderMemberSelector() {
    var list = getElement("groupMemberList");
    var count = getElement("groupSelectedCount");
    var characters = window.AppStorage.getCharacters();

    if (!list) {
      return;
    }

    if (count) {
      count.textContent = "已选 " + selectedMemberIds.length + " 个";
    }

    if (!characters.length) {
      list.innerHTML = '<div class="soft-empty">请先创建至少 2 个角色</div>';
      return;
    }

    list.innerHTML = characters.map(function (character) {
      var active = selectedMemberIds.indexOf(character.id) !== -1;
      return [
        '<button class="member-option ' + (active ? "active" : "") + '" type="button" data-character-id="' + escapeHtml(character.id) + '">',
        renderAvatar(character, "member-option-avatar"),
        '  <span class="member-option-text">',
        "    <strong>" + escapeHtml(character.name) + "</strong>",
        "    <em>" + escapeHtml(getCharacterPersonaPreview(character) || "未写人设") + "</em>",
        "  </span>",
        '  <span class="member-check" aria-hidden="true">' + (active ? "✓" : "") + "</span>",
        "</button>"
      ].join("");
    }).join("");

    Array.prototype.forEach.call(list.querySelectorAll(".member-option"), function (button) {
      button.addEventListener("click", function () {
        toggleMember(button.dataset.characterId);
      });
    });
  }

  function toggleMember(characterId) {
    var index = selectedMemberIds.indexOf(characterId);

    if (index === -1) {
      selectedMemberIds.push(characterId);
    } else {
      selectedMemberIds.splice(index, 1);
    }

    renderMemberSelector();
  }

  function saveGroupFromForm() {
    var nameInput = getElement("groupName");
    var name = nameInput ? nameInput.value.trim() : "";
    var group;

    if (!name) {
      showGroupFormError("群聊名称不能为空");
      if (nameInput) {
        nameInput.focus();
      }
      return;
    }

    if (selectedMemberIds.length < 2) {
      showGroupFormError("至少选择 2 个角色才能创建群聊");
      return;
    }

    group = {
      id: String(Date.now()),
      name: name,
      memberIds: selectedMemberIds.slice(),
      createdAt: Date.now()
    };

    window.AppStorage.addGroup(group);
    hideGroupFormError();
    renderGroupList();
    refreshHomeSummary();
    if (createReturnPage === "wechatScreen") {
      window.setActivePage("wechatScreen");
    } else {
      window.setActivePage(createReturnPage || "groupListScreen");
    }
  }

  function showGroupFormError(message) {
    var error = getElement("groupFormError");
    if (error) {
      error.textContent = message;
      error.classList.add("show");
    }
  }

  function hideGroupFormError() {
    var error = getElement("groupFormError");
    if (error) {
      error.textContent = "";
      error.classList.remove("show");
    }
  }

  function saveActiveGroupInputDraft() {
    var input = getElement("groupChatInput");

    if (input && activeGroupId) {
      groupInputDrafts[activeGroupId] = input.value || "";
    }
  }

  function restoreGroupInputDraft(groupId) {
    var input = getElement("groupChatInput");

    if (input) {
      input.value = groupInputDrafts[groupId] || "";
    }
  }

  function handleGroupInputDraftChange() {
    saveActiveGroupInputDraft();
  }

  function openGroupChatScreen(groupId) {
    var group = getGroupById(groupId);
    var token;

    if (!group) {
      renderGroupList();
      window.setActivePage("groupListScreen");
      return;
    }

    saveActiveGroupInputDraft();
    activeGroupId = groupId;
    if (window.CharacterManager && window.CharacterManager.deactivateActiveCharacter) {
      window.CharacterManager.deactivateActiveCharacter();
    }
    token = Date.now() + "_" + Math.random().toString(36).slice(2) + "_" + groupId;
    currentGroupRenderToken = token;
    isGroupMessageSelectionMode = false;
    selectedGroupMessageIds = [];
    groupVisibleMessageCounts[groupId] = INITIAL_GROUP_RENDER_LIMIT;
    updateGroupChatHeader(group);
    renderGroupOpeningPlaceholder(group);
    restoreGroupInputDraft(groupId);
    updateInlineOfflineUi();
    closeAllMenus();
    window.setActivePage("groupChatScreen");
    updateThoughtButton(groupId);
    requestAnimationFrame(function () {
      if (currentGroupRenderToken !== token || activeGroupId !== groupId) {
        return;
      }
      renderGroupChatMessages(groupId);
    });
  }

  function updateGroupChatHeader(group) {
    var title = getElement("groupChatTitle");
    var avatar = getElement("groupChatHeaderAvatar");
    var members = group && Array.isArray(group.memberIds) ? group.memberIds : [];

    if (title) {
      title.textContent = group && group.name || "群聊";
    }

    if (avatar) {
      avatar.textContent = members.length ? String(members.length) : "群";
      avatar.setAttribute("title", (group && group.name || "群聊") + "，" + members.length + " 人");
    }
  }

  function renderGroupOpeningPlaceholder(group) {
    var wrap = getElement("groupChatMessages");
    var settings = getGroupSettings(group);

    if (!wrap) {
      return;
    }

    wrap.classList.remove("selection-mode");
    applyGroupChatBackground(wrap, settings.background);
    wrap.innerHTML = [
      '<div class="chat-opening-placeholder" aria-live="polite">',
      '  <span class="chat-opening-dot"></span>',
      "  <em>正在打开聊天...</em>",
      "</div>"
    ].join("");
    wrap.scrollTop = 0;
  }

  function renderGroupChatMessages(groupId, options) {
    if (groupId !== activeGroupId) {
      return;
    }

    var wrap = getElement("groupChatMessages");
    var group = getGroupById(groupId);
    var settings = getGroupSettings(group);
    var messages = window.AppStorage.getGroupChatHistory(groupId);
    var renderOptions = options || {};
    var visibleInfo = getGroupVisibleMessages(groupId, messages, renderOptions);
    var visibleMessages = visibleInfo.messages;
    var messageIds = messages.map(function (message) {
      return message.id;
    });
    var selectableCount = getSelectableGroupMessages(messages).length;

    if (!wrap || !group) {
      return;
    }

    selectedGroupMessageIds = selectedGroupMessageIds.filter(function (messageId) {
      return messageIds.indexOf(messageId) !== -1;
    });
    wrap.classList.toggle("selection-mode", isGroupMessageSelectionMode);
    applyGroupChatBackground(wrap, settings.background);

    if (!messages.length) {
      wrap.innerHTML = renderGroupAnnouncement(group, settings) + '<div class="chat-empty">发送一句话，再点回复让群成员互动</div>' + (isGroupMessageSelectionMode ? renderGroupMessageBatchActionBar(selectableCount) : "");
    } else {
      wrap.innerHTML = renderGroupAnnouncement(group, settings) + renderGroupLoadMoreBar(groupId, visibleInfo.hiddenCount) + renderGroupMessagesWithDates(visibleMessages, function (message) {
        var messageId = escapeHtml(message.id || "");
        var selectCheck = renderGroupMessageSelectCheck(message);
        var userAvatar = renderGroupUserMessageAvatar(group, settings);

        if (message.type === "offlineAction") {
          return renderGroupOfflineActionMessage(message, selectCheck);
        }

        if (message.type === "offlineUserAction") {
          return renderGroupOfflineUserActionMessage(message, group, settings, selectCheck);
        }

        if (message.role === "user") {
          if (isStandaloneMessage(message)) {
            return [
              '<div class="message-row user message-action-target" data-message-id="' + messageId + '">',
              selectCheck,
              renderStandaloneGroupMessage(message),
              userAvatar,
              "</div>"
            ].join("");
          }

          return [
            '<div class="message-row user message-action-target" data-message-id="' + messageId + '">',
            selectCheck,
            '  <div class="message-bubble' + getBubbleTextClass(message.content) + '">' + renderGroupMessageContent(message) + renderEditedMark(message) + "</div>",
            userAvatar,
            "</div>"
          ].join("");
        }

        if (message.role === "system") {
          return [
            '<div class="message-row system message-action-target" data-message-id="' + messageId + '">',
            selectCheck,
            '  <div class="group-system-message">' + escapeHtml(message.content) + renderEditedMark(message) + "</div>",
            "</div>"
          ].join("");
        }

        return renderCharacterGroupMessage(message);
      }) + (isGroupMessageSelectionMode ? renderGroupMessageBatchActionBar(selectableCount) : "");
      bindGroupLoadMore(wrap, groupId);
      bindGroupMessageActions(wrap, messages);
      bindGroupMessageDetails(wrap, messages);
    }

    bindGroupAnnouncementActions(wrap);

    if (isGroupMessageSelectionMode) {
      bindGroupMessageBatchActions(wrap, messages);
    } else {
      bindGroupHistoryScrollLoader(wrap, groupId);
    }

    if (renderOptions.restoreScrollState) {
      restoreChatScrollState(wrap, renderOptions.restoreScrollState, function () {
        return groupId === activeGroupId;
      });
    } else if (!isGroupMessageSelectionMode && !renderOptions.skipScroll) {
      if (window.AppApiJobs && window.AppApiJobs.scheduleScrollToBottom) {
        window.AppApiJobs.scheduleScrollToBottom(wrap);
      } else {
        requestAnimationFrame(function () {
          if (groupId !== activeGroupId) {
            return;
          }
          wrap.scrollTop = wrap.scrollHeight;
        });
      }
    }

    updateThoughtButton(groupId);
  }

  function getGroupVisibleMessages(groupId, messages, options) {
    var allMessages = Array.isArray(messages) ? messages : [];
    var forceFull = options && options.forceFull;
    var selectionFull = isGroupMessageSelectionMode;
    var current = groupVisibleMessageCounts[groupId] || INITIAL_GROUP_RENDER_LIMIT;
    var count = forceFull || selectionFull ? allMessages.length : Math.min(allMessages.length, Math.max(INITIAL_GROUP_RENDER_LIMIT, current));

    if (!selectionFull || forceFull) {
      groupVisibleMessageCounts[groupId] = count;
    }
    return {
      messages: allMessages.slice(Math.max(0, allMessages.length - count)),
      hiddenCount: Math.max(0, allMessages.length - count)
    };
  }

  function renderGroupLoadMoreBar(groupId, hiddenCount) {
    if (!hiddenCount) {
      return "";
    }

    return '<button class="chat-load-more" type="button" data-group-load-more="' + escapeHtml(groupId || "") + '">加载更早消息（' + hiddenCount + '）</button>';
  }

  function bindGroupLoadMore(wrap, groupId) {
    var button = wrap ? wrap.querySelector("[data-group-load-more]") : null;

    if (!button) {
      return;
    }

    button.addEventListener("click", function () {
      groupVisibleMessageCounts[groupId] = (groupVisibleMessageCounts[groupId] || INITIAL_GROUP_RENDER_LIMIT) + INITIAL_GROUP_RENDER_LIMIT;
      renderGroupChatMessages(groupId, { skipScroll: true });
    });
  }

  function bindGroupHistoryScrollLoader(wrap, groupId) {
    if (!wrap || wrap.__groupHistoryLoaderBound === groupId) {
      return;
    }

    wrap.__groupHistoryLoaderBound = groupId;
    wrap.addEventListener("scroll", function () {
      if (isGroupHistoryLoadSuppressed(groupId)) {
        return;
      }

      if (activeGroupId !== groupId || wrap.scrollTop > 28) {
        return;
      }

      if (!wrap.querySelector("[data-group-load-more]")) {
        return;
      }

      groupVisibleMessageCounts[groupId] = (groupVisibleMessageCounts[groupId] || INITIAL_GROUP_RENDER_LIMIT) + INITIAL_GROUP_RENDER_LIMIT;
      renderGroupChatMessages(groupId, { skipScroll: true });
    }, { passive: true });
  }

  function applyGroupChatBackground(wrap, background) {
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

  function renderGroupAnnouncement(group, settings) {
    var collapsed = collapsedAnnouncements[group.id];

    if (!settings.announcement) {
      return "";
    }

    return [
      '<section class="group-announcement' + (collapsed ? " collapsed" : "") + '">',
      '  <button type="button" data-group-announcement-toggle>',
      "    <strong>群公告</strong>",
      "    <span>" + (collapsed ? "展开" : "折叠") + "</span>",
      "  </button>",
      collapsed ? "" : '  <p>' + escapeHtml(settings.announcement) + "</p>",
      "</section>"
    ].join("");
  }

  function bindGroupAnnouncementActions(wrap) {
    Array.prototype.forEach.call(wrap.querySelectorAll("[data-group-announcement-toggle]"), function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        collapsedAnnouncements[activeGroupId] = !collapsedAnnouncements[activeGroupId];
        renderGroupChatMessages(activeGroupId);
      });
    });
  }

  function renderGroupMessagesWithDates(messages, renderer) {
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

      return html + renderer(message);
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

  function renderCharacterGroupMessage(message) {
    var character = getCharacterById(message.characterId);
    var bubbleClass = "message-bubble" + getBubbleTextClass(message.content);
    var messageId = escapeHtml(message.id || "");
    var selectCheck = renderGroupMessageSelectCheck(message);

    if (message.type === "offlineSpeech") {
      return renderGroupOfflineSpeechMessage(message, character, selectCheck);
    }

    if (message.type === "error") {
      bubbleClass += " message-error";
    }

    if (message.type === "loading") {
      bubbleClass += " typing-bubble";
    }

    return [
      '<div class="message-row character group-character-row message-action-target" data-message-id="' + messageId + '">',
      selectCheck,
      renderAvatar(character || { name: message.characterName }, "message-avatar"),
      '  <div class="group-message-main">',
      '    <span class="group-message-name">' + escapeHtml(message.characterName || "角色") + "</span>",
      isStandaloneMessage(message)
        ? renderStandaloneGroupMessage(message)
        : '    <div class="' + bubbleClass + '">' + renderGroupMessageContent(message) + renderEditedMark(message) + "</div>",
      "  </div>",
      "</div>"
    ].join("");
  }

  function renderGroupMessageSelectCheck(message) {
    var selected;

    if (!isGroupMessageSelectionMode || !isGroupMessageSelectable(message)) {
      return "";
    }

    selected = selectedGroupMessageIds.indexOf(message.id) !== -1;
    return '<button class="select-check ' + (selected ? "active" : "") + '" type="button" data-group-message-select="' + escapeHtml(message.id || "") + '" aria-label="选择消息"></button>';
  }

  function renderGroupOfflineUserActionMessage(message, group, settings, selectCheck) {
    return [
      '<div class="message-row user offline-user-action-row message-action-target" data-message-id="' + escapeHtml(message.id || "") + '">',
      selectCheck,
      '  <div class="message-bubble' + getBubbleTextClass(message.content) + '">' + escapeHtml(normalizeDisplayText(message.content)) + renderEditedMark(message) + "</div>",
      renderGroupUserMessageAvatar(group, settings),
      "</div>"
    ].join("");
  }

  function renderGroupOfflineActionMessage(message, selectCheck) {
    return [
      '<div class="message-row system offline-action-row message-action-target" data-message-id="' + escapeHtml(message.id || "") + '">',
      selectCheck,
      '  <div class="inline-offline-action-card"><i aria-hidden="true">✦</i><span>' + escapeHtml(message.content) + renderEditedMark(message) + "</span></div>",
      "</div>"
    ].join("");
  }

  function renderGroupOfflineSpeechMessage(message, character, selectCheck) {
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

  function renderGroupMessageContent(message) {
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

  function renderStandaloneGroupMessage(message) {
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

  function bindGroupMessageActions(container, messages) {
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

        if (isGroupMessageSelectionMode || !message || message.type === "loading") {
          return;
        }

        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }

        openGroupMessageMenu(message);
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
        if (isGroupMessageSelectionMode) {
          event.preventDefault();
          event.stopPropagation();
          toggleGroupMessageSelection(node.dataset.messageId);
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

  function bindGroupMessageDetails(container, messages) {
    var messageMap = {};

    if (isGroupMessageSelectionMode) {
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
          handleGroupMoneyMessage(message.id, moneyActionButton.dataset.moneyAction);
          return;
        }

        if (message && window.WeChatTools && window.WeChatTools.showMessageDetail) {
          window.WeChatTools.showMessageDetail(message);
        }
      });
    });
  }

  function handleGroupMoneyMessage(messageId, action) {
    var group = activeGroupId ? getGroupById(activeGroupId) : null;
    var messages;
    var changed = false;
    var toastText = action === "reject" ? "已退回。" : "已存入钱包。";

    if (!group || !window.AppStorage.receiveMoneyMessage || !window.AppStorage.returnMoneyMessage) {
      return;
    }

    messages = window.AppStorage.getGroupChatHistory(group.id).map(function (message) {
      if (message.id !== messageId) {
        return message;
      }

      changed = true;
      return (action === "reject" ? window.AppStorage.returnMoneyMessage : window.AppStorage.receiveMoneyMessage)(Object.assign({}, message), {
        sourceType: "group",
        sourceId: group.id,
        groupId: group.id,
        characterId: message.characterId || "",
        sourceName: message.characterName || group.name
      });
    });

    if (changed) {
      window.AppStorage.saveGroupChatHistory(group.id, messages);
      renderGroupChatMessages(group.id);
      renderGroupList();
      if (window.AppExtras && window.AppExtras.showToast) {
        window.AppExtras.showToast(toastText);
      }
    }
  }

  function isGroupMessageSelectable(message) {
    return Boolean(message && message.id && message.type !== "loading");
  }

  function isGroupMessageEditable(message) {
    var type = String(message && message.type || "text");

    return Boolean(message && message.id && message.content && (
      type === "text"
      || type === "offlineUserAction"
      || type === "offlineSpeech"
      || type === "offlineAction"
      || type === "error"
    ));
  }

  function getSelectableGroupMessages(messages) {
    return (Array.isArray(messages) ? messages : []).filter(isGroupMessageSelectable);
  }

  function renderGroupMessageBatchActionBar(totalCount) {
    return [
      '<div class="batch-action-bar chat-batch-action-bar" aria-label="群聊消息批量操作">',
      '  <span class="batch-action-count">已选 ' + selectedGroupMessageIds.length + ' 条</span>',
      '  <button class="batch-action-button" type="button" data-group-message-batch-action="all">' + (totalCount > 0 && selectedGroupMessageIds.length === totalCount ? "取消全选" : "全选") + '</button>',
      '  <button class="batch-action-button batch-action-danger" type="button" data-group-message-batch-action="delete">删除</button>',
      '  <button class="batch-action-button" type="button" data-group-message-batch-action="cancel">取消</button>',
      "</div>"
    ].join("");
  }

  function bindGroupMessageBatchActions(container, messages) {
    Array.prototype.forEach.call(container.querySelectorAll("[data-group-message-select]"), function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleGroupMessageSelection(button.dataset.groupMessageSelect);
      });
    });

    Array.prototype.forEach.call(container.querySelectorAll("[data-group-message-batch-action]"), function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        handleGroupMessageBatchAction(button.dataset.groupMessageBatchAction, messages);
      });
    });
  }

  function openGroupMessageSelectionMode() {
    closeAllMenus();

    if (!activeGroupId) {
      return;
    }

    isGroupMessageSelectionMode = true;
    selectedGroupMessageIds = [];
    renderGroupChatMessages(activeGroupId);
  }

  function toggleGroupMessageSelection(messageId) {
    var messages = activeGroupId ? window.AppStorage.getGroupChatHistory(activeGroupId) : [];
    var message = messages.find(function (item) {
      return item.id === messageId;
    });
    var index;

    if (!isGroupMessageSelectable(message)) {
      return;
    }

    index = selectedGroupMessageIds.indexOf(messageId);
    if (index === -1) {
      selectedGroupMessageIds.push(messageId);
    } else {
      selectedGroupMessageIds.splice(index, 1);
    }

    renderGroupChatMessages(activeGroupId);
  }

  function handleGroupMessageBatchAction(action, messages) {
    var selectable = getSelectableGroupMessages(messages);

    if (action === "all") {
      selectedGroupMessageIds = selectedGroupMessageIds.length === selectable.length
        ? []
        : selectable.map(function (message) {
          return message.id;
        });
      renderGroupChatMessages(activeGroupId);
      return;
    }

    if (action === "cancel") {
      isGroupMessageSelectionMode = false;
      selectedGroupMessageIds = [];
      renderGroupChatMessages(activeGroupId);
      return;
    }

    if (action === "delete") {
      deleteSelectedGroupMessages();
    }
  }

  function deleteSelectedGroupMessages() {
    var ids = selectedGroupMessageIds.slice();
    var messages;
    var scrollState;

    if (!activeGroupId || !ids.length) {
      return;
    }

    if (!window.confirm("确定删除选中的 " + ids.length + " 条群聊消息吗？")) {
      return;
    }

    scrollState = captureChatScrollState(getElement("groupChatMessages"));
    messages = window.AppStorage.getGroupChatHistory(activeGroupId).filter(function (message) {
      return ids.indexOf(message.id) === -1;
    });
    window.AppStorage.saveGroupChatHistory(activeGroupId, messages);

    isGroupMessageSelectionMode = false;
    selectedGroupMessageIds = [];
    suppressGroupHistoryLoad(activeGroupId);
    renderGroupChatMessages(activeGroupId, { skipScroll: true, restoreScrollState: scrollState });
    renderGroupList();
  }

  function openGroupMessageMenu(message) {
    if (!window.MessageActionMenu) {
      return;
    }

    window.MessageActionMenu.open({
      canRegenerate: message.role === "user",
      canEdit: isGroupMessageEditable(message),
      onAction: function (action) {
        handleGroupMessageAction(action, message.id);
      }
    });
  }

  function handleGroupMessageAction(action, messageId) {
    var group = activeGroupId ? getGroupById(activeGroupId) : null;
    var messages;
    var message;

    if (!group || !messageId) {
      return;
    }

    messages = window.AppStorage.getGroupChatHistory(group.id);
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
      openGroupMessageEditSheet(messageId);
      return;
    }

    if (action === "delete") {
      var scrollState = captureChatScrollState(getElement("groupChatMessages"));
      messages = messages.filter(function (item) {
        return item.id !== messageId;
      });
      window.AppStorage.saveGroupChatHistory(group.id, messages);
      suppressGroupHistoryLoad(group.id);
      renderGroupChatMessages(group.id, { skipScroll: true, restoreScrollState: scrollState });
      renderGroupList();
      return;
    }

    if (action === "memory") {
      writeGroupMessageToMemory(group, message);
      window.alert("已写入记忆");
      return;
    }

    if (action === "regenerate" && message.role === "user") {
      openGroupRegenerateReplySheet(messageId);
    }
  }

  function openGroupMessageEditSheet(messageId) {
    var groupId = activeGroupId;
    var messages = groupId ? window.AppStorage.getGroupChatHistory(groupId) : [];
    var message = messages.find(function (item) {
      return item.id === messageId;
    });

    if (!message || !isGroupMessageEditable(message) || !window.WeChatTools || !window.WeChatTools.openMessageEditSheet) {
      return;
    }

    window.WeChatTools.openMessageEditSheet(message, function (content) {
      var scrollState = captureChatScrollState(getElement("groupChatMessages"));
      var editedAt = Date.now();
      var changed = false;
      var nextMessages = window.AppStorage.getGroupChatHistory(groupId).map(function (item) {
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

      window.AppStorage.saveGroupChatHistory(groupId, nextMessages);
      suppressGroupHistoryLoad(groupId);
      renderGroupChatMessages(groupId, { skipScroll: true, restoreScrollState: scrollState });
      renderGroupList();
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

  function sendGroupUserMessage() {
    var input = getElement("groupChatInput");
    var content = input ? input.value.trim() : "";
    var group = activeGroupId ? getGroupById(activeGroupId) : null;
    var messages;
    var now;
    var isOffline = isInlineOfflineActive();

    if (!group || !content) {
      return;
    }

    now = Date.now();
    messages = window.AppStorage.getGroupChatHistory(group.id);
    messages.push({
      id: String(now),
      role: "user",
      characterId: "",
      characterName: "",
      content: content,
      type: isOffline ? "offlineUserAction" : "text",
      createdAt: now
    });

    group.memberIds.forEach(function (memberId) {
      window.AppStorage.addCharacterMemory(memberId, {
        content: (isOffline ? "用户在群聊《" + group.name + "》线下模式中说/做：" : "用户在群聊「" + group.name + "」中说：") + content,
        source: isOffline ? "offline" : "group",
        targetType: "group",
        targetId: group.id,
        relatedMessageIds: [String(now)],
        createdAt: now
      });
    });

    window.AppStorage.saveGroupChatHistory(group.id, messages);
    input.value = "";
    groupInputDrafts[group.id] = "";
    input.focus();
    closeToolPanel();
    renderGroupChatMessages(group.id);
    renderGroupList();
  }

  async function handleComposerAction() {
    var input = getElement("groupChatInput");

    if (isInlineOfflineActive()) {
      await requestGroupReply();
      return;
    }

    if (input && input.value.trim()) {
      sendGroupUserMessage();
    }

    await requestGroupReply();
  }

  function toggleToolPanel() {
    var panel = getElement("groupToolPanel");

    if (panel) {
      panel.classList.toggle("hidden");
    }
  }

  function closeToolPanel() {
    var panel = getElement("groupToolPanel");

    if (panel) {
      panel.classList.add("hidden");
    }
  }

  function sendToolMessage(type) {
    var group = activeGroupId ? getGroupById(activeGroupId) : null;
    var now = Date.now();
    var messages;
    var content;
    var role = "user";

    if (!group) {
      return;
    }

    if (openRichToolSheet(type, group.id)) {
      closeToolPanel();
      return;
    }

    content = getToolMessageContent(type, group);

    if (!content) {
      return;
    }

    if (type === "pat") {
      role = "system";
    }

    messages = window.AppStorage.getGroupChatHistory(group.id);
    var toolMessage = {
      id: String(now),
      role: role,
      characterId: "",
      characterName: "",
      content: content,
      type: type,
      createdAt: now
    };
    messages.push(toolMessage);

    if (role === "user") {
      group.memberIds.forEach(function (memberId) {
        window.AppStorage.addCharacterMemory(memberId, {
          content: "用户在群聊《" + group.name + "》中发送了：" + content,
          source: "group",
          targetType: "group",
          targetId: group.id,
          relatedMessageIds: [toolMessage.id],
          createdAt: now
        });
      });
    }

    window.AppStorage.saveGroupChatHistory(group.id, messages);
    closeToolPanel();
    renderGroupChatMessages(group.id);
    renderGroupList();
  }

  function openRichToolSheet(type, groupId) {
    if (!window.WeChatTools) {
      return false;
    }

    if (type === "redPacket") {
      window.WeChatTools.openRedPacketSheet(function (payload) {
        appendGroupToolMessage(groupId, payload);
      });
      return true;
    }

    if (type === "transfer") {
      window.WeChatTools.openTransferSheet(function (payload) {
        appendGroupToolMessage(groupId, payload);
      });
      return true;
    }

    if (type === "location") {
      window.WeChatTools.openLocationSheet(function (payload) {
        appendGroupToolMessage(groupId, payload);
      });
      return true;
    }

    if (type === "emoji") {
      window.WeChatTools.openEmojiSheet(function (payload) {
        appendGroupToolMessage(groupId, payload);
      });
      return true;
    }

    if (type === "image") {
      window.WeChatTools.openImagePicker(function (payload) {
        appendGroupToolMessage(groupId, payload);
      });
      return true;
    }

    if (type === "voice") {
      window.WeChatTools.openVoiceSheet(function (payload) {
        appendGroupToolMessage(groupId, payload);
      });
      return true;
    }

    return false;
  }

  function appendGroupToolMessage(groupId, payload) {
    var group = getGroupById(groupId);
    var now = Date.now();
    var messages;
    var message;

    if (!group || !payload) {
      return;
    }

    messages = window.AppStorage.getGroupChatHistory(group.id);
    message = Object.assign({}, payload, {
      id: String(now),
      role: "user",
      characterId: "",
      characterName: "",
      createdAt: now
    });
    message = recordGroupMoneyMessage(message, group, null);

    messages.push(message);
    group.memberIds.forEach(function (memberId) {
      window.AppStorage.addCharacterMemory(memberId, {
        content: "用户在群聊《" + group.name + "》中发送了：" + getMessageMemoryText(message),
        source: "group",
        targetType: "group",
        targetId: group.id,
        relatedMessageIds: [message.id],
        createdAt: now
      });
    });
    window.AppStorage.saveGroupChatHistory(group.id, messages);
    renderGroupChatMessages(group.id);
    renderGroupList();
  }

  function recordGroupMoneyMessage(message, group, character) {
    if (!window.AppStorage.recordMoneyMessage || !message || (message.type !== "redPacket" && message.type !== "transfer")) {
      return message;
    }

    return window.AppStorage.recordMoneyMessage(message, {
      sourceType: "group",
      sourceId: group.id,
      groupId: group.id,
      characterId: character ? character.id : "",
      sourceName: character ? character.name : group.name
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

  function getToolMessageContent(type, group) {
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
      return "你在《" + (group.name || "群聊") + "》里拍了拍大家";
    }
    if (type === "transfer") {
      return "";
    }
    if (type === "redPacket") {
      return "";
    }
    return "";
  }

  function findLatestGroupRegenerateMessageId() {
    var messages = activeGroupId ? removeLoadingMessages(window.AppStorage.getGroupChatHistory(activeGroupId)) : [];
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

  function openGroupRegenerateReplySheet(messageId) {
    if (!activeGroupId || !messageId) {
      window.alert("还没有可重回的群聊回复。");
      return;
    }

    if (window.AppExtras && window.AppExtras.openRegenerateReplySheet) {
      window.AppExtras.openRegenerateReplySheet({
        onConfirm: function (requirement) {
          regenerateGroupReplyFromMessage(messageId, requirement);
        }
      });
      return;
    }

    regenerateGroupReplyFromMessage(messageId, window.prompt("重回要求（可选）", "") || "");
  }

  function openActiveGroupRegenerateReply() {
    var messageId;

    closeAllMenus();
    messageId = findLatestGroupRegenerateMessageId();

    if (!messageId) {
      window.alert("还没有可重回的群聊回复。");
      return;
    }

    openGroupRegenerateReplySheet(messageId);
  }

  async function regenerateGroupReplyFromMessage(messageId, requirement) {
    var group = activeGroupId ? getGroupById(activeGroupId) : null;
    var characters = group ? getGroupCharacters(group) : [];
    var messages;
    var index;
    var nextIndex;
    var before;
    var after;
    var oldMessages;
    var oldGenerationIds;
    var oldBodyState;
    var rejectedReplyText;
    var generationId;

    if (!group || !characters.length) {
      return;
    }

    if (isInlineOfflineActive()) {
      if (window.OfflineManager && window.OfflineManager.regenerateInlineOfflineLastTurn) {
        await window.OfflineManager.regenerateInlineOfflineLastTurn({
          mode: "group",
          targetType: "group",
          targetId: group.id,
          messageId: messageId,
          regenerateInstruction: requirement
        });
      }
      return;
    }

    if (isGroupJobRunning(group.id, ["regenerate"])) {
      showGroupBusyNotice(group.id);
      return;
    }

    messages = window.AppStorage.getGroupChatHistory(group.id);
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
    oldGenerationIds = collectGroupGenerationIds(oldMessages);
    oldBodyState = window.AppStorage.getBodyState ? window.AppStorage.getBodyState("group", group.id) : null;
    rejectedReplyText = collectGroupReplyText(oldMessages);
    generationId = window.AppApiJobs && window.AppApiJobs.createGenerationId
      ? window.AppApiJobs.createGenerationId()
      : "generation_" + Date.now();

    isGroupReplying = true;
    setGroupReplyState(true);

    if (oldGenerationIds.length && window.AppStorage.removeGenerationArtifacts) {
      window.AppStorage.removeGenerationArtifacts(oldGenerationIds, {
        targetType: "group",
        targetId: group.id
      });
    }

    window.AppStorage.saveGroupChatHistory(group.id, before.concat([createGroupLoadingMessage(generationId, characters[0])], after));
    scheduleGroupRender(group.id);

    try {
      await requestGroupJob({
        targetType: "group",
        targetId: group.id,
        mode: "regenerate",
        generationId: generationId,
        beforeMessages: before,
        afterMessages: after,
        requestSnapshot: {
          parentUserMessageId: messageId,
          regenerateRequest: true,
          regenerateInstruction: String(requirement || "").trim(),
          previousReplyText: getPreviousGroupReplyText(messages, index),
          rejectedReplyText: rejectedReplyText,
          oldGenerationIds: oldGenerationIds,
          oldMessages: oldMessages
        }
      });
      messages = null;
    } catch (error) {
      if (oldBodyState && window.AppStorage.saveBodyState) {
        window.AppStorage.saveBodyState("group", group.id, oldBodyState);
      }
      messages = before.concat(oldMessages, [{
        id: String(Date.now()),
        role: "character",
        characterId: characters[0].id,
        characterName: characters[0].name,
        content: "回复失败：" + (error && error.message ? error.message : "未知错误"),
        type: "error",
        createdAt: Date.now(),
        generationId: generationId
      }], after);
    } finally {
      if (messages) {
        window.AppStorage.saveGroupChatHistory(group.id, messages);
      }
      scheduleGroupRender(group.id);
      scheduleGroupListRender();
      isGroupReplying = false;
      setGroupReplyState(false);
    }
  }

  function appendGroupReplies(messages, group, characters, replies, meta) {
    var startAt = Date.now();
    var extra = meta || {};
    var generated = [];

    (replies || []).slice(0, 50).forEach(function (reply, index) {
      var character = getCharacterById(reply.characterId) || characters[0];
      var createdAt;
      var message;

      if (!character || !reply.content) {
        return;
      }

      createdAt = startAt + index;
      message = createGroupCharacterReplyMessage(reply, character, createdAt, extra);
      message = recordGroupMoneyMessage(message, group, character);
      messages.push(message);
      generated.push(message);
      window.AppStorage.addCharacterMemory(character.id, {
        content: "\u89d2\u8272\u5728\u7fa4\u804a\u91cc\u56de\u590d\u4e86\uff1a" + getMessageMemoryText(message),
        source: "group",
        generationId: extra.generationId || "",
        sourceGenerationId: extra.generationId || "",
        relatedMessageIds: [message.id],
        targetType: "group",
        targetId: group.id,
        createdAt: createdAt
      });
    });

    return {
      messages: messages,
      generated: generated
    };
  }

  function streamGroupReplies(baseMessages, group, characters, replies, suffixMessages, meta) {
    var shown = [];
    var startAt = Date.now();
    var suffix = Array.isArray(suffixMessages) ? suffixMessages : [];
    var extra = meta || {};
    var items = (replies || []).slice(0, 50).filter(function (item) {
      return item && item.content;
    });
    var appended;

    if (!window.AppStream || !window.AppStream.appendMessagesWithStreamEffect) {
      appended = appendGroupReplies(baseMessages.slice(), group, characters, items, extra);
      window.AppStorage.saveGroupChatHistory(group.id, appended.messages.concat(suffix));
      if (activeGroupId === group.id) {
        scheduleGroupRender(group.id);
      }
      scheduleGroupListRender();
      return Promise.resolve(appended.generated);
    }

    return window.AppStream.appendMessagesWithStreamEffect({
      targetType: "group",
      targetId: group.id,
      messages: items,
      renderOne: function (reply, index) {
        var character = getCharacterById(reply.characterId) || characters[0];
        var createdAt = startAt + index;
        var message;

        if (!group || !character || !getGroupById(group.id)) {
          return;
        }

        message = createGroupCharacterReplyMessage(reply, character, createdAt, extra);
        message = recordGroupMoneyMessage(message, group, character);
        shown.push(message);
        window.AppStorage.addCharacterMemory(character.id, {
          content: "\u89d2\u8272\u5728\u7fa4\u804a\u91cc\u56de\u590d\u4e86\uff1a" + getMessageMemoryText(message),
          source: "group",
          generationId: extra.generationId || "",
          sourceGenerationId: extra.generationId || "",
          relatedMessageIds: [message.id],
          targetType: "group",
          targetId: group.id,
          createdAt: createdAt
        });
        saveGroupHistoryDebounced(group.id, baseMessages.concat(shown, suffix));
        if (activeGroupId === group.id) {
          scheduleGroupRender(group.id);
        }
      }
    }).then(function () {
      window.AppStorage.saveGroupChatHistory(group.id, baseMessages.concat(shown, suffix));
      flushGroupHistory(group.id);
      scheduleGroupRender(group.id);
      scheduleGroupListRender();
      return shown;
    });
  }

  function normalizeGroupAiResult(result) {
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
        decisions.push({ type: "transfer", decision: reply.transferDecision, messageId: reply.messageId || "", characterId: reply.characterId || "" });
      }
      if (reply.redPacketDecision || reply.redpacketDecision) {
        decisions.push({ type: "redPacket", decision: reply.redPacketDecision || reply.redpacketDecision, messageId: reply.messageId || "", characterId: reply.characterId || "" });
      }
      if (reply.moneyDecision && typeof reply.moneyDecision === "object") {
        decisions.push(reply.moneyDecision);
      }
    });

    return decisions;
  }

  function applyGroupMoneyDecisions(messages, group, aiResult) {
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
        sourceType: "group",
        sourceId: group.id,
        groupId: group.id,
        characterId: decision.characterId || "",
        sourceName: group.name
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

  function persistGroupAiExtras(group, result, meta) {
    var now = Date.now();
    var extra = meta || {};

    if (!group || !result) {
      return;
    }

    try {
      (result.thoughts || []).forEach(function (thought) {
        var characterId = thought.characterId;
        if (!getCharacterById(characterId)) {
          return;
        }

        window.AppStorage.addCharacterThought(characterId, {
          source: "group",
          chatId: group.id,
          content: thought.content,
          mood: thought.mood || "",
          visibleSummary: thought.visibleSummary || thought.summary || "",
          generationId: extra.generationId || "",
          sourceGenerationId: extra.generationId || "",
          relatedMessageIds: extra.relatedMessageIds || [],
          targetType: "group",
          targetId: group.id,
          createdAt: now
        });
      });
    } catch (error) {
      console.warn("群聊心声保存失败，群聊回复已保留。", error);
    }

    updateThoughtButton(group.id);

    if (group.settings && group.settings.memorySharingEnabled === false) {
      return;
    }

    try {
      (result.memories || []).forEach(function (memory) {
        var characterId = memory.characterId;
        if (!characterId) {
          (group.memberIds || []).forEach(function (memberId) {
            window.AppStorage.addCharacterMemory(memberId, {
              content: memory.content,
              source: "group",
              generationId: extra.generationId || "",
              sourceGenerationId: extra.generationId || "",
              relatedMessageIds: extra.relatedMessageIds || [],
              targetType: "group",
              targetId: group.id,
              createdAt: now
            });
          });
          return;
        }

        if (!getCharacterById(characterId)) {
          return;
        }

        window.AppStorage.addCharacterMemory(characterId, {
          content: memory.content,
          source: "group",
          generationId: extra.generationId || "",
          sourceGenerationId: extra.generationId || "",
          relatedMessageIds: extra.relatedMessageIds || [],
          targetType: "group",
          targetId: group.id,
          createdAt: now
        });
      });
    } catch (error) {
      console.warn("群聊记忆保存失败，群聊回复已保留。", error);
    }
  }

  function createGroupCharacterReplyMessage(reply, character, createdAt, meta) {
    var source = reply && typeof reply === "object" ? reply : { content: String(reply || "") };
    var type = source.type || "text";
    var extra = meta || {};
    var message = Object.assign({}, source, {
      id: String(createdAt + Math.random()),
      role: "character",
      characterId: character.id,
      characterName: character.name,
      type: type,
      createdAt: createdAt,
      generationId: extra.generationId || source.generationId || "",
      parentUserMessageId: extra.parentUserMessageId || source.parentUserMessageId || "",
      generatedAt: extra.generatedAt || createdAt
    });

    if (type === "voice") {
      message.voice = Object.assign({
        text: source.content || "",
        duration: estimateVoiceDuration(source.content || "")
      }, source.voice || {});
    }

    if (type === "emoji") {
      message.emoji = source.emoji && source.emoji.type === "image"
        ? { type: "image", src: source.emoji.src || "", name: source.emoji.name || "\u8868\u60c5" }
        : { type: "text", value: source.emoji && source.emoji.value ? source.emoji.value : (source.content || "\ud83d\ude00") };
      message.content = source.content || (message.emoji.type === "text" ? message.emoji.value : "[\u8868\u60c5]");
    }

    if (type === "image") {
      message.image = Object.assign({
        description: source.image && source.image.description ? source.image.description : (source.content || "\u89d2\u8272\u53d1\u6765\u7684\u4e00\u5f20\u56fe\u7247\u63cf\u8ff0")
      }, source.image || {});
      message.content = source.content || "[\u56fe\u7247]";
    }

    if (type === "location") {
      message.location = Object.assign({
        name: source.location && source.location.name ? source.location.name : (source.content || "\u4f4d\u7f6e"),
        address: source.location && source.location.address ? source.location.address : "\u5e38\u53bb\u7684\u5730\u65b9",
        lat: null,
        lng: null
      }, source.location || {});
      message.location.lat = null;
      message.location.lng = null;
      message.content = source.content || message.location.name;
    }

    if (type === "redPacket") {
      message.note = source.note || "";
      message = normalizeMoneyMessage(message);
      if (!message) {
        message = Object.assign({}, source, {
          id: String(createdAt + Math.random()),
          role: "character",
          characterId: source.characterId || "",
          characterName: source.characterName || "",
          type: "text",
          createdAt: createdAt
        });
        message.type = "text";
        message.status = "";
        message.content = source.content || "";
      } else {
        message.status = source.status || "pending";
        message.content = source.content || "\u606d\u559c\u53d1\u8d22\uff0c\u5927\u5409\u5927\u5229";
      }
    }

    if (type === "transfer") {
      message.note = source.note || "";
      message = normalizeMoneyMessage(message);
      if (!message) {
        message = Object.assign({}, source, {
          id: String(createdAt + Math.random()),
          role: "character",
          characterId: source.characterId || "",
          characterName: source.characterName || "",
          type: "text",
          createdAt: createdAt
        });
        message.type = "text";
        message.note = "";
        message.status = "";
        message.content = source.content || source.note || "";
      } else {
        message.status = source.status || "pending";
        message.content = source.content || "\u8f6c\u8d26";
      }
    }

    message.content = normalizeDisplayText(message.content || source.content || "");
    message.generationId = message.generationId || extra.generationId || source.generationId || "";
    message.parentUserMessageId = message.parentUserMessageId || extra.parentUserMessageId || source.parentUserMessageId || "";
    message.generatedAt = message.generatedAt || extra.generatedAt || createdAt;
    return message;
  }

  function estimateVoiceDuration(text) {
    return Math.min(60, Math.max(2, Math.ceil(String(text || "").length / 4)));
  }

  function writeGroupMessageToMemory(group, message) {
    var content = "手动写入记忆：" + (message.content || "");

    if (message.role === "character" && message.characterId) {
      window.AppStorage.addCharacterMemory(message.characterId, {
        content: content,
        source: "group",
        createdAt: Date.now()
      });
      return;
    }

    (group.memberIds || []).forEach(function (memberId) {
      window.AppStorage.addCharacterMemory(memberId, {
        content: content,
        source: "group",
        createdAt: Date.now()
      });
    });
  }

  async function requestGroupReply() {
    var group = activeGroupId ? getGroupById(activeGroupId) : null;
    var characters = group ? getGroupCharacters(group) : [];
    var messages;
    var historyForRequest;
    var generationId;

    if (!group || isGroupReplying || !characters.length) {
      return;
    }

    if (isInlineOfflineActive()) {
      if (getElement("groupChatInput") && getElement("groupChatInput").value.trim()) {
        sendGroupUserMessage();
      }
      if (window.OfflineManager && window.OfflineManager.requestInlineOfflineAdvance) {
        await window.OfflineManager.requestInlineOfflineAdvance({
          mode: "group",
          targetId: group.id
        });
      }
      return;
    }

    messages = window.AppStorage.getGroupChatHistory(group.id);

    if (!messages.some(function (message) {
      return message.role === "user";
    })) {
      showEmptyAiReplyToast();
      return;
    }

    if (isGroupJobRunning(group.id, ["chat"])) {
      showGroupBusyNotice(group.id);
      return;
    }

    isGroupReplying = true;
    setGroupReplyState(true);
    historyForRequest = messages.slice();
    generationId = window.AppApiJobs && window.AppApiJobs.createGenerationId
      ? window.AppApiJobs.createGenerationId()
      : "generation_" + Date.now();

    messages.push(createGroupLoadingMessage(generationId, characters[0]));
    window.AppStorage.saveGroupChatHistory(group.id, messages);
    scheduleGroupRender(group.id);

    try {
      await requestGroupJob({
        targetType: "group",
        targetId: group.id,
        mode: "chat",
        generationId: generationId,
        beforeMessages: historyForRequest,
        requestSnapshot: {
          parentUserMessageId: getLastGroupUserMessage(historyForRequest) && getLastGroupUserMessage(historyForRequest).id || "",
          previousReplyText: getPreviousGroupReplyText(historyForRequest)
        }
      });
      messages = null;
    } catch (error) {
      messages = removeGroupLoadingByGeneration(window.AppStorage.getGroupChatHistory(group.id), generationId);
      messages.push({
        id: String(Date.now()),
        role: "character",
        characterId: characters[0].id,
        characterName: characters[0].name,
        content: "回复失败：" + (error && error.message ? error.message : "未知错误"),
        type: "error",
        createdAt: Date.now(),
        generationId: generationId
      });
    } finally {
      if (messages) {
        window.AppStorage.saveGroupChatHistory(group.id, messages);
      }
      scheduleGroupRender(group.id);
      scheduleGroupListRender();
      isGroupReplying = false;
      setGroupReplyState(false);
    }
  }

  function addGroupSystemMessage(groupId, content) {
    var messages = window.AppStorage.getGroupChatHistory(groupId);
    messages.push({
      id: String(Date.now()),
      role: "system",
      characterId: "",
      characterName: "",
      content: content,
      type: "text",
      createdAt: Date.now()
    });
    window.AppStorage.saveGroupChatHistory(groupId, messages);
    renderGroupChatMessages(groupId);
  }

  function removeLoadingMessages(messages) {
    return (Array.isArray(messages) ? messages : []).filter(function (message) {
      return message.type !== "loading";
    });
  }

  function scheduleGroupRender(groupId) {
    if (window.AppApiJobs && window.AppApiJobs.scheduleRenderChat) {
      window.AppApiJobs.scheduleRenderChat("group", groupId);
      return;
    }
    renderGroupChatMessages(groupId);
  }

  function scheduleGroupListRender() {
    if (window.AppApiJobs && window.AppApiJobs.scheduleRenderList) {
      window.AppApiJobs.scheduleRenderList("group");
      return;
    }
    renderGroupList();
  }

  function saveGroupHistoryDebounced(groupId, messages) {
    if (window.AppApiJobs && window.AppApiJobs.saveChatHistoryDebounced) {
      window.AppApiJobs.saveChatHistoryDebounced("group", groupId, messages, 120);
      return;
    }
    window.AppStorage.saveGroupChatHistory(groupId, messages);
  }

  function flushGroupHistory(groupId) {
    if (window.AppApiJobs && window.AppApiJobs.flushChatHistorySave) {
      window.AppApiJobs.flushChatHistorySave("group", groupId);
    }
  }

  function isGroupJobRunning(groupId, modes) {
    return Boolean(window.AppApiJobs
      && window.AppApiJobs.isTargetRunning
      && window.AppApiJobs.isTargetRunning("group", groupId, modes));
  }

  function showGroupBusyNotice(groupId) {
    if (groupId && activeGroupId === groupId && window.AppExtras && window.AppExtras.showToast) {
      window.AppExtras.showToast("正在回复中", true);
    }
  }

  function createGroupLoadingMessage(generationId, character) {
    var now = Date.now();
    return {
      id: String(now + Math.random()),
      role: "character",
      characterId: character && character.id || "",
      characterName: character && character.name || "角色",
      content: "正在输入中",
      type: "loading",
      createdAt: now,
      generationId: generationId || ""
    };
  }

  function removeGroupLoadingByGeneration(messages, generationId) {
    var gid = String(generationId || "");
    return (Array.isArray(messages) ? messages : []).filter(function (message) {
      if (!message || message.type !== "loading") {
        return true;
      }
      return gid && message.generationId !== gid;
    });
  }

  function collectGroupGenerationIds(messages) {
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

  function collectGroupReplyText(messages) {
    return (Array.isArray(messages) ? messages : []).filter(function (message) {
      return message && message.role === "character" && message.type !== "loading" && message.type !== "error" && message.content;
    }).map(function (message) {
      return (message.characterName || "角色") + "：" + getMessageMemoryText(message);
    }).join("\n");
  }

  function getPreviousGroupReplyText(messages, userIndex) {
    var list = Array.isArray(messages) ? messages : [];
    var index = typeof userIndex === "number" ? userIndex : list.length - 1;
    var end = index;
    var start = end - 1;

    while (start >= 0 && list[start] && list[start].role !== "user") {
      start -= 1;
    }

    return collectGroupReplyText(list.slice(start + 1, end));
  }

  function getLastGroupUserMessage(messages) {
    var list = Array.isArray(messages) ? messages : [];
    var index;

    for (index = list.length - 1; index >= 0; index -= 1) {
      if (list[index] && list[index].role === "user") {
        return list[index];
      }
    }

    return null;
  }

  function hasGroupGeneratedOutput(groupId, generationId) {
    return Boolean(window.AppApiJobs
      && window.AppApiJobs.hasGeneratedOutput
      && window.AppApiJobs.hasGeneratedOutput("group", groupId, generationId));
  }

  function requestGroupJob(input) {
    if (!window.AppApiJobs || !window.AppApiJobs.runJob) {
      return Promise.reject(new Error("API job runner unavailable."));
    }

    return window.AppApiJobs.runJob(input);
  }

  async function handleGroupChatJob(job) {
    var groupId = job.targetId;
    var group = getGroupById(groupId);
    var characters = group ? getGroupCharacters(group) : [];
    var requestSnapshot = job.requestSnapshot || {};
    var historyForRequest = Array.isArray(job.beforeMessages) && job.beforeMessages.length
      ? job.beforeMessages
      : removeGroupLoadingByGeneration(window.AppStorage.getGroupChatHistory(groupId), job.generationId);
    var suffixMessages = Array.isArray(job.afterMessages) ? job.afterMessages : [];
    var generationContext;
    var aiResult;
    var replies;
    var messages;
    var baseMessages;
    var generatedMessages;
    var parentUserMessage = requestSnapshot.parentUserMessageId ? { id: requestSnapshot.parentUserMessageId } : getLastGroupUserMessage(historyForRequest);

    if (!group || !characters.length) {
      throw new Error("群聊不存在或没有成员。");
    }

    if (hasGroupGeneratedOutput(groupId, job.generationId)) {
      messages = removeGroupLoadingByGeneration(window.AppStorage.getGroupChatHistory(groupId), job.generationId);
      window.AppStorage.saveGroupChatHistory(groupId, messages);
      scheduleGroupRender(groupId);
      scheduleGroupListRender();
      return { afterMessages: messages };
    }

    generationContext = window.AppExtras && window.AppExtras.buildChatGenerationContext
      ? window.AppExtras.buildChatGenerationContext("group", groupId, {
        generationId: job.generationId,
        previousReplyText: requestSnapshot.previousReplyText || getPreviousGroupReplyText(historyForRequest),
        rejectedReplyText: requestSnapshot.rejectedReplyText || "",
        regenerateRequest: requestSnapshot.regenerateRequest,
        regenerateInstruction: requestSnapshot.regenerateInstruction
      })
      : requestSnapshot;

    if (!window.AIService || typeof window.AIService.sendGroupChatRequest !== "function") {
      messages = removeGroupLoadingByGeneration(window.AppStorage.getGroupChatHistory(groupId), job.generationId);
      window.AppStorage.saveGroupChatHistory(groupId, messages);
      scheduleGroupRender(groupId);
      scheduleGroupListRender();
      throw new Error("AI 服务未加载，请刷新或清除缓存后重试。");
    }

    aiResult = normalizeGroupAiResult(await window.AIService.sendGroupChatRequest(
      group,
      characters,
      historyForRequest,
      window.AppStorage.getMemoriesForCharacters(group.memberIds),
      generationContext
    ));
    replies = aiResult.replies || [];

    messages = removeGroupLoadingByGeneration(window.AppStorage.getGroupChatHistory(groupId), job.generationId);
    window.AppStorage.saveGroupChatHistory(groupId, messages);
    scheduleGroupRender(groupId);

    if (!replies.length) {
      showEmptyAiReplyToast();
      scheduleGroupListRender();
      return { afterMessages: messages };
    }

    baseMessages = suffixMessages.length || requestSnapshot.regenerateRequest
      ? historyForRequest.slice()
      : messages;
    baseMessages = applyGroupMoneyDecisions(baseMessages, group, aiResult);
    window.AppStorage.saveGroupChatHistory(groupId, baseMessages.concat(suffixMessages));
    generatedMessages = await streamGroupReplies(baseMessages, group, characters, replies, suffixMessages, {
      generationId: job.generationId,
      parentUserMessageId: parentUserMessage && parentUserMessage.id || "",
      generatedAt: Date.now()
    });
    persistGroupAiExtras(group, aiResult, {
      generationId: job.generationId,
      relatedMessageIds: (generatedMessages || []).map(function (message) {
        return message.id;
      })
    });

    if (window.AppExtras && window.AppExtras.finalizeChatGenerationContext) {
      window.AppExtras.finalizeChatGenerationContext(generationContext, aiResult);
    }

    messages = window.AppStorage.getGroupChatHistory(groupId);
    scheduleGroupRender(groupId);
    scheduleGroupListRender();
    return { afterMessages: messages };
  }

  async function handleGroupRegenerateJob(job) {
    return handleGroupChatJob(job);
  }

  async function handleGroupInlineOfflineJob(job) {
    if (window.OfflineManager && window.OfflineManager.handleGroupInlineOfflineJob) {
      return window.OfflineManager.handleGroupInlineOfflineJob(job);
    }
    throw new Error("线下管理器还没有准备好。");
  }

  function setCompactReplyButton(button, label, busy) {
    if (!button) {
      return;
    }

    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.textContent = busy ? "…" : (label === "推进" ? "▶" : "↑");
  }

  function setGroupReplyState(sending) {
    var button = getElement("groupReplyButton");
    var isOffline = isInlineOfflineActive();
    var label = sending ? (isOffline ? "推进中" : "发送中") : (isOffline ? "推进" : "发送");
    if (button) {
      button.disabled = sending;
      setCompactReplyButton(button, label, sending);
    }
  }

  function toggleGroupActionMenu() {
    var menu = getElement("groupChatActionMenu");
    if (!menu) {
      return;
    }

    menu.classList.toggle("hidden");
  }

  function closeAllMenus() {
    var menu = getElement("groupChatActionMenu");

    closeToolPanel();

    if (menu) {
      menu.classList.add("hidden");
    }

    if (window.MessageActionMenu) {
      window.MessageActionMenu.close();
    }
  }

  function openActiveGroupOffline() {
    closeAllMenus();
    if (isInlineOfflineActive() && window.OfflineManager) {
      window.OfflineManager.disableInlineOffline();
      return;
    }
    if (activeGroupId && window.OfflineManager) {
      window.OfflineManager.openGroupOffline(activeGroupId);
    }
  }

  function isInlineOfflineActive() {
    return Boolean(activeGroupId
      && window.OfflineManager
      && window.OfflineManager.isInlineOfflineActive
      && window.OfflineManager.isInlineOfflineActive("group", activeGroupId));
  }

  function updateInlineOfflineUi() {
    var active = isInlineOfflineActive();
    var bar = getElement("groupOfflineModeBar");
    var input = getElement("groupChatInput");
    var replyButton = getElement("groupReplyButton");
    var menuButton = getElement("groupOfflineBtn");

    if (bar) {
      bar.classList.add("hidden");
    }

    if (input) {
      input.placeholder = active ? "说点什么，或描述你的动作..." : "输入群聊消息";
    }

    if (replyButton && !replyButton.disabled) {
      setCompactReplyButton(replyButton, active ? "推进" : "发送", false);
    }

    if (menuButton) {
      menuButton.textContent = active ? "退出线下模式" : "进入线下模式";
    }
  }

  function getGroupSettings(group) {
    return Object.assign({
      avatar: "",
      announcement: "",
      background: "",
      pinned: false,
      memorySharingEnabled: true,
      minReplyCount: 4,
      maxReplyCount: 12,
      minParticipantCount: 2,
      allowConsecutiveMessages: true,
      allowSpecialMessages: true,
      userPersonaId: "",
      userPersonaOverride: {
        name: "",
        avatar: "",
        persona: ""
      }
    }, group && group.settings || {});
  }

  function openActiveGroupSettings() {
    var group = activeGroupId ? getGroupById(activeGroupId) : null;

    closeAllMenus();

    if (!group) {
      return;
    }

    renderGroupSettings(group);
    window.setActivePage("groupSettingsScreen");
  }

  function openActiveGroupMemory() {
    var group = activeGroupId ? getGroupById(activeGroupId) : null;

    closeAllMenus();

    if (group && window.AppExtras && window.AppExtras.openChatMemoryPanel) {
      window.AppExtras.openChatMemoryPanel("group", group.id, (group.name || "群聊") + " · 记忆");
    }
  }

  function openActiveGroupWorldBookSelector() {
    var group = activeGroupId ? getGroupById(activeGroupId) : null;

    closeAllMenus();

    if (group && window.AppExtras && window.AppExtras.openChatWorldBookSelector) {
      window.AppExtras.openChatWorldBookSelector("group", group.id);
    }
  }

  function openActiveGroupBodyState() {
    var group = activeGroupId ? getGroupById(activeGroupId) : null;

    closeAllMenus();

    if (group && window.AppExtras && window.AppExtras.openBodyStatePanel) {
      window.AppExtras.openBodyStatePanel("group", group.id, "你的身体状态");
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

  function renderGroupSettings(group) {
    var form = getElement("groupSettingsForm");
    var settings = getGroupSettings(group);
    var persona = settings.userPersonaOverride || {};
    var characters = window.AppStorage.getCharacters();

    if (!form) {
      return;
    }

    form.innerHTML = [
      '<section class="form-section">',
      '<div class="section-title-row"><h3>群聊基础信息</h3><span>Group</span></div>',
      '<div class="field-group"><label>群聊名称</label><input data-group-settings-field="name" type="text" value="' + escapeHtml(group.name || "") + '"></div>',
      '<div class="field-group"><label>群头像</label><input data-group-settings-field="avatar" type="text" value="' + escapeHtml(settings.avatar || "") + '"></div>',
      '<div class="field-group"><label>群公告</label><textarea data-group-settings-field="announcement">' + escapeHtml(settings.announcement || "") + '</textarea></div>',
      '<div class="field-group"><label>群聊背景图</label><input data-group-settings-field="background" type="text" value="' + escapeHtml(settings.background || "") + '" placeholder="可粘贴图片 data URL 或地址"><input data-group-settings-file="background" type="file" accept="image/*"><small class="field-help">上传后会转为 base64 保存在本地。</small></div>',
      '<label class="switch-row"><input data-group-settings-field="pinned" type="checkbox"' + (settings.pinned ? " checked" : "") + '>置顶群聊</label>',
      "</section>",
      '<section class="form-section">',
      '<div class="section-title-row"><h3>群成员管理</h3><span>至少 2 个</span></div>',
      '<div class="member-select-list">' + characters.map(function (character) {
        var checked = (group.memberIds || []).indexOf(character.id) !== -1;
        return [
          '<label class="member-option ' + (checked ? "active" : "") + '">',
          '<input class="visually-hidden" data-group-member-id="' + escapeHtml(character.id) + '" type="checkbox"' + (checked ? " checked" : "") + '>',
          renderAvatar(character, "member-option-avatar"),
          '<span class="member-option-text"><strong>' + escapeHtml(character.name) + '</strong><em>' + escapeHtml(getCharacterPersonaPreview(character) || "未写人设") + '</em></span>',
          '<span class="member-check" aria-hidden="true">' + (checked ? "✓" : "") + '</span>',
          "</label>"
        ].join("");
      }).join("") + "</div>",
      "</section>",
      '<section class="form-section">',
      '<div class="section-title-row"><h3>我在群里的身份</h3><span>专属</span></div>',
      '<div class="field-group"><label>我在这个群里是谁</label><select data-group-settings-field="userPersonaId">' + renderUserPersonaOptions(settings.userPersonaId || "") + '</select></div>',
      '<div class="field-group"><label>我的群昵称</label><input data-group-settings-field="userName" type="text" value="' + escapeHtml(persona.name || "") + '"></div>',
      '<div class="field-group"><label>我的群头像</label><input data-group-settings-field="userAvatar" type="text" value="' + escapeHtml(persona.avatar || "") + '"></div>',
      '<div class="field-group"><label>我的群人设</label><textarea data-group-settings-field="userPersona">' + escapeHtml(persona.persona || "") + '</textarea></div>',
      "</section>",
      '<section class="form-section">',
      '<div class="section-title-row"><h3>群聊回复设置</h3><span>生成</span></div>',
      '<div class="settings-inline-grid">',
      '<label><span>最少回复条数</span><input data-group-settings-field="minReplyCount" type="number" min="1" max="50" value="' + escapeHtml(settings.minReplyCount || 4) + '"></label>',
      '<label><span>最多安全条数</span><input data-group-settings-field="maxReplyCount" type="number" min="4" max="50" value="' + escapeHtml(settings.maxReplyCount || 12) + '"></label>',
      "</div>",
      '<div class="field-group"><label>最少参与角色数</label><input data-group-settings-field="minParticipantCount" type="number" min="1" max="10" value="' + escapeHtml(settings.minParticipantCount || 2) + '"></div>',
      '<label class="switch-row"><input data-group-settings-field="allowConsecutiveMessages" type="checkbox"' + (settings.allowConsecutiveMessages !== false ? " checked" : "") + '>允许同一角色连续发言</label>',
      '<label class="switch-row"><input data-group-settings-field="allowSpecialMessages" type="checkbox"' + (settings.allowSpecialMessages !== false ? " checked" : "") + '>允许特殊消息类型</label>',
      "</section>",
      '<section class="form-section">',
      '<div class="section-title-row"><h3>记忆设置</h3><span>Memory</span></div>',
      '<label class="switch-row"><input data-group-settings-field="memorySharingEnabled" type="checkbox"' + (settings.memorySharingEnabled !== false ? " checked" : "") + '>群聊记忆共享</label>',
      '<button class="outline-button" type="button" data-group-settings-action="view-memory">查看本群聊记忆</button>',
      '<button class="outline-button danger" type="button" data-group-settings-action="clear-chat-memory">清空本群聊记忆</button>',
      '<button class="outline-button danger" type="button" data-group-settings-action="clear-group-memory">清空成员群聊记忆</button>',
      "</section>"
    ].join("");

    form.onchange = function (event) {
      var option = event.target.closest(".member-option");
      var backgroundInput = event.target.closest("[data-group-settings-file='background']");
      var file = backgroundInput && backgroundInput.files && backgroundInput.files[0];

      if (file) {
        readFileAsDataUrl(file, function (dataUrl) {
          var field = form.querySelector("[data-group-settings-field='background']");
          if (field) {
            field.value = dataUrl;
          }
          backgroundInput.value = "";
        });
      }

      if (option) {
        option.classList.toggle("active", event.target.checked);
        option.querySelector(".member-check").textContent = event.target.checked ? "✓" : "";
      }
    };
    form.onclick = handleGroupSettingsAction;
  }

  function handleGroupSettingsAction(event) {
    var button = event.target.closest("[data-group-settings-action]");
    var group = activeGroupId ? getGroupById(activeGroupId) : null;

    if (!button || !group) {
      return;
    }

    if (button.dataset.groupSettingsAction === "view-thoughts") {
      openActiveGroupThoughtsDrawer();
      return;
    }

    if (button.dataset.groupSettingsAction === "view-memory") {
      openActiveGroupMemory();
      return;
    }

    if (button.dataset.groupSettingsAction === "view-body-state") {
      openActiveGroupBodyState();
      return;
    }

    if (button.dataset.groupSettingsAction === "clear-chat-memory" && window.confirm("确定清空本群聊记忆吗？")) {
      window.AppStorage.resetGroupMemoryState(group.id);
      addGroupSystemMessage(group.id, "本群聊状态已重置，记忆和群聊思想已清除。");
      window.alert("已清空本群聊记忆并恢复默认群组状态");
      updateThoughtButton(group.id);
      scheduleGroupRender(group.id);
      scheduleGroupListRender();
      return;
    }

    if (button.dataset.groupSettingsAction === "clear-group-memory" && window.confirm("确定清空成员的群聊记忆吗？")) {
      (group.memberIds || []).forEach(function (memberId) {
        var kept = window.AppStorage.getCharacterMemory(memberId).filter(function (memory) {
          return !(memory.source === "group" && String(memory.targetId || "") === String(group.id));
        });
        window.AppStorage.saveCharacterMemory(memberId, kept);
      });
      window.AppStorage.resetGroupMemoryState(group.id);
      addGroupSystemMessage(group.id, "群成员在本群的记忆已清理，群聊状态已重置。");
      window.alert("已清空成员群聊记忆并恢复默认群组状态");
      updateThoughtButton(group.id);
      scheduleGroupRender(group.id);
      scheduleGroupListRender();
    }
  }

  function saveGroupSettings() {
    var group = activeGroupId ? getGroupById(activeGroupId) : null;
    var form = getElement("groupSettingsForm");
    var memberIds;
    var next;

    if (!group || !form) {
      return;
    }

    memberIds = Array.prototype.map.call(form.querySelectorAll("[data-group-member-id]:checked"), function (input) {
      return input.dataset.groupMemberId;
    });

    if (memberIds.length < 2) {
      window.alert("群聊至少保留 2 个角色成员。");
      return;
    }

    next = {
      name: getGroupSettingField("name") || group.name,
      memberIds: memberIds,
      settings: {
        avatar: getGroupSettingField("avatar"),
        announcement: getGroupSettingField("announcement"),
        background: getGroupSettingField("background"),
        pinned: getGroupSettingChecked("pinned"),
        memorySharingEnabled: getGroupSettingChecked("memorySharingEnabled"),
        minReplyCount: Math.max(1, Math.min(50, Number(getGroupSettingField("minReplyCount")) || 4)),
        maxReplyCount: Math.max(4, Math.min(50, Number(getGroupSettingField("maxReplyCount")) || 12)),
        minParticipantCount: Math.max(1, Number(getGroupSettingField("minParticipantCount")) || 2),
        allowConsecutiveMessages: getGroupSettingChecked("allowConsecutiveMessages"),
        allowSpecialMessages: getGroupSettingChecked("allowSpecialMessages"),
        userPersonaId: getGroupSettingField("userPersonaId"),
        userPersonaOverride: {
          name: getGroupSettingField("userName"),
          avatar: getGroupSettingField("userAvatar"),
          persona: getGroupSettingField("userPersona")
        }
      }
    };

    window.AppStorage.updateGroup(group.id, next);
    updateGroupChatHeader(getGroupById(group.id));
    renderGroupChatMessages(group.id);
    renderGroupList();
    window.setActivePage("groupChatScreen");
  }

  function getGroupSettingField(name) {
    var field = getElement("groupSettingsForm").querySelector('[data-group-settings-field="' + name + '"]');
    return field ? String(field.value || "").trim() : "";
  }

  function getGroupSettingChecked(name) {
    var field = getElement("groupSettingsForm").querySelector('[data-group-settings-field="' + name + '"]');
    return Boolean(field && field.checked);
  }

  function readFileAsDataUrl(file, callback) {
    var reader = new FileReader();
    reader.onload = function () {
      callback(String(reader.result || ""));
    };
    reader.readAsDataURL(file);
  }

  function openActiveGroupThoughts() {
    closeAllMenus();

    if (activeGroupId && window.AppExtras && window.AppExtras.openThoughtsForGroup) {
      window.AppExtras.openThoughtsForGroup(activeGroupId, "groupChatScreen");
    }
  }

  function openActiveGroupThoughtsDrawer() {
    closeAllMenus();

    if (activeGroupId && window.AppExtras && window.AppExtras.openThoughtsDrawerForGroup) {
      window.AppExtras.openThoughtsDrawerForGroup(activeGroupId);
    }
  }

  function updateThoughtButton(groupId) {
    var targetId = groupId || activeGroupId;

    if (targetId && window.AppExtras && window.AppExtras.updateGroupThoughtsButton) {
      window.AppExtras.updateGroupThoughtsButton(targetId);
    }
  }

  function openActiveGroupSearch() {
    var group = activeGroupId ? getGroupById(activeGroupId) : null;

    closeAllMenus();

    if (!group || !window.WeChatTools || !window.WeChatTools.openChatSearchSheet) {
      return;
    }

    window.WeChatTools.openChatSearchSheet({
      title: "搜索群聊记录",
      messages: window.AppStorage.getGroupChatHistory(group.id),
      sender: function (message) {
        if (message.role === "user") {
          return "我";
        }
        if (message.role === "system") {
          return "系统";
        }
        return message.characterName || "角色";
      },
      onJump: function (messageId) {
        scrollToGroupMessage(messageId);
      }
    });
  }

  function scrollToGroupMessage(messageId) {
    var wrap = getElement("groupChatMessages");
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

    if (!target && activeGroupId) {
      renderGroupChatMessages(activeGroupId, { forceFull: true });
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

  function deactivateActiveGroup() {
    saveActiveGroupInputDraft();
    activeGroupId = "";
    currentGroupRenderToken = "";
    isGroupMessageSelectionMode = false;
    selectedGroupMessageIds = [];
    closeAllMenus();
  }

  function getActiveGroupId() {
    return activeGroupId;
  }

  function registerGroupApiJobHandlers() {
    if (!window.AppApiJobs || !window.AppApiJobs.registerHandler) {
      return;
    }

    window.AppApiJobs.registerHandler("group", "chat", handleGroupChatJob);
    window.AppApiJobs.registerHandler("group", "inlineOffline", handleGroupInlineOfflineJob);
    window.AppApiJobs.registerHandler("group", "regenerate", handleGroupRegenerateJob);
  }

  registerGroupApiJobHandlers();

  window.GroupManager = {
    renderGroupList: renderGroupList,
    toggleGroupSelectionMode: toggleGroupSelectionMode,
    openCreateGroupScreen: openCreateGroupScreen,
    saveGroupFromForm: saveGroupFromForm,
    openGroupChatScreen: openGroupChatScreen,
    renderGroupChatMessages: renderGroupChatMessages,
    sendGroupUserMessage: sendGroupUserMessage,
    handleComposerAction: handleComposerAction,
    toggleToolPanel: toggleToolPanel,
    closeToolPanel: closeToolPanel,
    sendToolMessage: sendToolMessage,
    requestGroupReply: requestGroupReply,
    openGroupMessageSelectionMode: openGroupMessageSelectionMode,
    toggleGroupActionMenu: toggleGroupActionMenu,
    closeAllMenus: closeAllMenus,
    openActiveGroupOffline: openActiveGroupOffline,
    updateInlineOfflineUi: updateInlineOfflineUi,
    openActiveGroupSettings: openActiveGroupSettings,
    openActiveGroupMemory: openActiveGroupMemory,
    openActiveGroupWorldBookSelector: openActiveGroupWorldBookSelector,
    openActiveGroupBodyState: openActiveGroupBodyState,
    openActiveGroupRegenerateReply: openActiveGroupRegenerateReply,
    saveGroupSettings: saveGroupSettings,
    openActiveGroupThoughts: openActiveGroupThoughts,
    openActiveGroupThoughtsDrawer: openActiveGroupThoughtsDrawer,
    updateThoughtButton: updateThoughtButton,
    openActiveGroupSearch: openActiveGroupSearch,
    handleGroupInputDraftChange: handleGroupInputDraftChange,
    deactivateActiveGroup: deactivateActiveGroup,
    getActiveGroupId: getActiveGroupId
  };
})(window, document);
