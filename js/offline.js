(function (window, document) {
  "use strict";

  var currentSessionId = "";
  var returnPage = "homeScreen";
  var isAdvancing = false;
  var inlineOfflineState = {
    targetType: "",
    targetId: "",
    scene: {
      name: "",
      description: ""
    }
  };

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

  function showEmptyAiReplyToast() {
    if (window.AppExtras && window.AppExtras.showToast) {
      window.AppExtras.showToast("这次没回出来，重试一下", true);
    }
  }

  function normalizeOfflineEventsForDisplay(events) {
    return (Array.isArray(events) ? events : []).map(function (event) {
      var source = event && typeof event === "object" ? event : { content: event };
      var content = normalizeDisplayText(source.content || "");
      return Object.assign({}, source, {
        type: source.type === "speech" ? "speech" : "action",
        content: content
      });
    }).filter(function (event) {
      return event.content;
    });
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

  function getActivePage() {
    if (window.AppNavigation && window.AppNavigation.getActivePage) {
      return window.AppNavigation.getActivePage();
    }

    return "homeScreen";
  }

  function openPrivateOffline(characterId) {
    chooseInlineScene(function (scene) {
      enablePrivateInlineOffline(characterId, scene);
    });
  }

  function openGroupOffline(groupId) {
    chooseInlineScene(function (scene) {
      enableGroupInlineOffline(groupId, scene);
    });
  }

  function chooseInlineScene(callback) {
    if (window.WeChatTools && window.WeChatTools.openOfflineSceneSheet) {
      window.WeChatTools.openOfflineSceneSheet(callback);
      return;
    }

    callback({
      name: "家",
      description: "熟悉、放松、适合日常互动的室内场景"
    });
  }

  function setCurrentInlineOfflineState(targetType, targetId, scene) {
    inlineOfflineState = {
      targetType: String(targetType || ""),
      targetId: String(targetId || ""),
      scene: normalizeScene(scene)
    };
  }

  function activateStoredInlineOfflineState(targetType, targetId) {
    var stored = window.AppStorage.getInlineOfflineState
      ? window.AppStorage.getInlineOfflineState(targetType, targetId)
      : null;

    if (!stored || !stored.enabled) {
      return false;
    }

    setCurrentInlineOfflineState(stored.targetType || targetType, stored.targetId || targetId, stored.scene);
    return true;
  }

  function ensureSession(base) {
    var existing = window.AppStorage.getOfflineSession(base.id);
    var now = Date.now();
    var session = existing || {
      id: base.id,
      mode: base.mode,
      targetId: base.targetId,
      participantIds: base.participantIds,
      title: base.title,
      history: [],
      createdAt: now,
      updatedAt: now
    };

    session.mode = base.mode;
    session.targetId = base.targetId;
    session.participantIds = base.participantIds;
    session.title = base.title;
    session.updatedAt = now;
    window.AppStorage.saveOfflineSession(session);
    return session;
  }

  function openSession(session) {
    getElement("offlineTitle").textContent = session.title || "线下模式";
    renderOfflineMessages();
    updateOfflineThoughtButton(session);
  }

  function goBack() {
    window.setActivePage(returnPage || "homeScreen");
  }

  function getCurrentSession() {
    return currentSessionId ? window.AppStorage.getOfflineSession(currentSessionId) : null;
  }

  function openActiveOfflineThoughtsDrawer() {
    var session = getCurrentSession();

    if (session && window.AppExtras && window.AppExtras.openThoughtsDrawerForOfflineSession) {
      window.AppExtras.openThoughtsDrawerForOfflineSession(session);
    }
  }

  function updateOfflineThoughtButton(session) {
    if (window.AppExtras && window.AppExtras.updateOfflineThoughtsButton) {
      window.AppExtras.updateOfflineThoughtsButton(session || getCurrentSession());
    }
  }

  function getParticipants(session) {
    return (session && session.participantIds || []).map(getCharacterById).filter(Boolean);
  }

  function renderOfflineMessages() {
    var wrap = getElement("offlineMessages");
    var session = getCurrentSession();
    var history = session ? session.history || [] : [];

    if (!wrap) {
      return;
    }

    if (!session || !history.length) {
      wrap.innerHTML = '<div class="offline-empty">说点什么，或点击推进开始一段线下互动</div>';
    } else {
      wrap.innerHTML = history.map(renderOfflineEvent).join("");
    }

    requestAnimationFrame(function () {
      wrap.scrollTop = wrap.scrollHeight;
    });

    updateOfflineThoughtButton(session);
  }

  function renderOfflineEvent(event) {
    if (event.role === "user" || event.type === "user") {
      return [
        '<div class="offline-user-row">',
        '  <div class="offline-user-bubble">' + escapeHtml(normalizeDisplayText(event.content)) + "</div>",
        '  <span class="offline-time">' + formatTime(event.createdAt) + "</span>",
        "</div>"
      ].join("");
    }

    if (event.type === "speech") {
      return renderSpeechEvent(event);
    }

    return renderActionEvent(event);
  }

  function renderSpeechEvent(event) {
    var character = getCharacterById(event.characterId) || { name: event.characterName || "角色" };

    return [
      '<div class="offline-speech-row">',
      renderAvatar(character, "offline-avatar"),
      '  <div class="offline-speech-main">',
      '    <span class="offline-name">' + escapeHtml(event.characterName || character.name || "角色") + "</span>",
      '    <div class="offline-speech-bubble">' + escapeHtml(normalizeDisplayText(event.content)) + "</div>",
      '    <span class="offline-time">' + formatTime(event.createdAt) + "</span>",
      "  </div>",
      "</div>"
    ].join("");
  }

  function renderActionEvent(event) {
    var cls = event.type === "error" ? " offline-action-error" : "";

    return [
      '<div class="offline-action-card' + cls + '">',
      '  <span>' + escapeHtml(normalizeDisplayText(event.content)) + "</span>",
      '  <i aria-hidden="true">✦</i>',
      '  <small>' + formatTime(event.createdAt) + "</small>",
      "</div>"
    ].join("");
  }

  function formatTime(timestamp) {
    var date = new Date(timestamp || Date.now());
    return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  }

  function sendOfflineUserInput() {
    var input = getElement("offlineInput");
    var content = input ? input.value.trim() : "";
    var session = getCurrentSession();
    var now;

    if (!session || !content) {
      return;
    }

    now = Date.now();
    session.history.push({
      id: String(now),
      role: "user",
      type: "user",
      characterId: "",
      characterName: "",
      content: content,
      createdAt: now
    });
    session.updatedAt = now;
    window.AppStorage.saveOfflineSession(session);
    addMemoryForParticipants(session, "用户在线下模式说/做：" + content, "offline", now);

    input.value = "";
    input.focus();
    renderOfflineMessages();
  }

  async function advanceOffline() {
    var session = getCurrentSession();
    var participants = getParticipants(session);
    var now;
    var historyForRequest;
    var aiResult;
    var events;
    var latestUserInput;
    var generationContext;

    if (!session || isAdvancing || !participants.length) {
      return;
    }

    isAdvancing = true;
    setAdvanceState(true);
    now = Date.now();
    historyForRequest = session.history.slice();
    latestUserInput = getLatestUserInput(historyForRequest);

    session.history.push({
      id: String(now),
      role: "system",
      type: "loading",
      characterId: "",
      characterName: "",
      content: "剧情正在推进...",
      createdAt: now
    });
    session.updatedAt = now;
    window.AppStorage.saveOfflineSession(session);
    renderOfflineMessages();

    try {
      generationContext = window.AppExtras && window.AppExtras.buildChatGenerationContext
        ? window.AppExtras.buildChatGenerationContext("offline", session.id)
        : {};
      aiResult = await window.AIService.sendOfflineRequest({
        mode: session.mode,
        targetId: session.targetId,
        userInput: latestUserInput,
        participants: participants,
        offlineHistory: historyForRequest,
        sharedMemories: window.AppStorage.getMemoriesForCharacters(session.participantIds),
        chatMemories: generationContext.chatMemories,
        bodyStateEnabled: generationContext.bodyStateEnabled,
        bodyState: generationContext.bodyState,
        memorySummaryDue: generationContext.memorySummaryDue,
        memorySummaryRounds: generationContext.memorySummaryRounds
      });
      events = normalizeOfflineEventsForDisplay(Array.isArray(aiResult) ? aiResult : (aiResult && aiResult.events || []));
      session = getCurrentSession();
      session.history = removeLoadingEvents(session.history);
      window.AppStorage.saveOfflineSession(session);
      renderOfflineMessages();
      if (!events.length) {
        showEmptyAiReplyToast();
        session = null;
        return;
      }
      persistOfflineAiExtras(session, aiResult);
      await streamOfflineEvents(session, events);
      if (window.AppExtras && window.AppExtras.finalizeChatGenerationContext) {
        window.AppExtras.finalizeChatGenerationContext(generationContext, aiResult);
      }
      session = null;
    } catch (error) {
      session = getCurrentSession();
      session.history = removeLoadingEvents(session.history);
      session.history.push({
        id: String(Date.now()),
        role: "system",
        type: "error",
        characterId: "",
        characterName: "",
        content: "推进失败：" + (error && error.message ? error.message : "未知错误"),
        createdAt: Date.now()
      });
    } finally {
      if (session) {
        session.updatedAt = Date.now();
        window.AppStorage.saveOfflineSession(session);
      }
      renderOfflineMessages();
      isAdvancing = false;
      setAdvanceState(false);
    }
  }

  function appendOfflineEvents(session, events) {
    (events || []).forEach(function (event) {
      var character = event.characterId ? getCharacterById(event.characterId) : null;
      var now = Date.now();

      session.history.push({
        id: String(now + Math.random()),
        role: event.type === "speech" ? "character" : "system",
        type: event.type,
        characterId: event.characterId || "",
        characterName: character ? character.name : "",
        content: event.content,
        createdAt: now
      });

      recordOfflineMoneyEvent(event, session.mode, session.targetId, character);

      if (event.type === "speech" && character) {
        window.AppStorage.addCharacterMemory(character.id, {
          content: "线下模式中说：" + event.content,
          source: "offline",
          createdAt: now
        });
      } else if (event.characterId) {
        window.AppStorage.addCharacterMemory(event.characterId, {
          content: "线下动作：" + event.content,
          source: "offline",
          createdAt: now
        });
      } else {
        addMemoryForParticipants(session, "线下剧情：" + event.content, "offline", now);
      }
    });
  }

  function persistOfflineAiExtras(session, result) {
    if (!session || !result || Array.isArray(result)) {
      return;
    }

    try {
      (result.thoughts || []).forEach(function (thought) {
        if (!thought.characterId || !thought.content) {
          return;
        }

        window.AppStorage.addCharacterThought(thought.characterId, {
          source: "offline",
          chatId: session.id,
          content: thought.content,
          mood: thought.mood || "",
          visibleSummary: thought.visibleSummary || thought.summary || "",
          createdAt: Date.now()
        });
      });
    } catch (error) {
      console.warn("线下心声保存失败，剧情推进已保留。", error);
    }

    updateOfflineThoughtButton(session);

    try {
      (result.memories || []).forEach(function (memory) {
        if (!memory.characterId || !memory.content) {
          return;
        }

        window.AppStorage.addCharacterMemory(memory.characterId, {
          content: memory.content,
          source: "offline",
          createdAt: Date.now()
        });
      });
    } catch (error) {
      console.warn("线下记忆保存失败，剧情推进已保留。", error);
    }
  }

  function addMemoryForParticipants(session, content, source, createdAt) {
    (session.participantIds || []).forEach(function (characterId) {
      window.AppStorage.addCharacterMemory(characterId, {
        content: content,
        source: source,
        createdAt: createdAt
      });
    });
  }

  function getLatestUserInput(history) {
    var users = (history || []).filter(function (event) {
      return event.role === "user" || event.type === "user";
    });
    return users.length ? users[users.length - 1].content : "";
  }

  function removeLoadingEvents(history) {
    return (Array.isArray(history) ? history : []).filter(function (event) {
      return event.type !== "loading";
    });
  }

  function enablePrivateInlineOffline(characterId, scene) {
    if (!getCharacterById(characterId)) {
      return;
    }

    setCurrentInlineOfflineState("private", characterId, scene);
    if (window.AppStorage.setInlineOfflineState) {
      window.AppStorage.setInlineOfflineState("private", characterId, inlineOfflineState.scene);
    }
    appendInlineSceneMessage("private", characterId, [getCharacterById(characterId)]);
    updateInlineOfflineUi();
  }

  function enableGroupInlineOffline(groupId, scene) {
    var group = getGroupById(groupId);
    if (!group) {
      return;
    }

    setCurrentInlineOfflineState("group", groupId, scene);
    if (window.AppStorage.setInlineOfflineState) {
      window.AppStorage.setInlineOfflineState("group", groupId, inlineOfflineState.scene);
    }
    appendInlineSceneMessage("group", groupId, getParticipants({ participantIds: group.memberIds || [] }));
    updateInlineOfflineUi();
  }

  function disableInlineOffline() {
    if (inlineOfflineState.targetType && inlineOfflineState.targetId) {
      appendInlineSystemMessage(inlineOfflineState.targetType, inlineOfflineState.targetId, "已退出线下模式");
      if (window.AppStorage.clearInlineOfflineState) {
        window.AppStorage.clearInlineOfflineState(inlineOfflineState.targetType, inlineOfflineState.targetId);
      }
    }

    setCurrentInlineOfflineState("", "", {});
    updateInlineOfflineUi();
  }

  function normalizeScene(scene) {
    var source = scene && typeof scene === "object" ? scene : {};
    return {
      name: String(source.name || "家"),
      description: String(source.description || "熟悉、放松、适合日常互动的室内场景")
    };
  }

  function appendInlineSceneMessage(mode, targetId, participants) {
    var scene = inlineOfflineState.scene || {};
    var message = {
      id: String(Date.now() + Math.random()),
      role: "system",
      type: "system",
      characterId: "",
      characterName: "",
      content: "已进入线下模式：" + (scene.name || "当前场景") + (scene.description ? "，" + scene.description : ""),
      scene: scene,
      createdAt: Date.now()
    };
    var messages;

    if (mode === "group") {
      messages = window.AppStorage.getGroupChatHistory(targetId);
      messages.push(message);
      window.AppStorage.saveGroupChatHistory(targetId, messages);
      if (window.GroupManager && window.GroupManager.renderGroupChatMessages) {
        window.GroupManager.renderGroupChatMessages(targetId);
      }
    } else {
      messages = window.AppStorage.getChatHistory(targetId);
      messages.push(message);
      window.AppStorage.saveChatHistory(targetId, messages);
      if (window.CharacterManager && window.CharacterManager.renderChatMessages) {
        window.CharacterManager.renderChatMessages(targetId);
      }
    }

    (participants || []).forEach(function (character) {
      if (character) {
        window.AppStorage.addCharacterMemory(character.id, {
          content: "线下模式场景：" + (scene.name || "未指定场景") + (scene.description ? "。" + scene.description : ""),
          source: "offline",
          createdAt: Date.now()
        });
      }
    });
  }

  function appendInlineSystemMessage(mode, targetId, content) {
    var message = {
      id: String(Date.now() + Math.random()),
      role: "system",
      type: "system",
      characterId: "",
      characterName: "",
      content: content,
      createdAt: Date.now()
    };
    var messages;

    if (mode === "group") {
      messages = window.AppStorage.getGroupChatHistory(targetId);
      messages.push(message);
      window.AppStorage.saveGroupChatHistory(targetId, messages);
      if (window.GroupManager && window.GroupManager.renderGroupChatMessages) {
        window.GroupManager.renderGroupChatMessages(targetId);
      }
    } else {
      messages = window.AppStorage.getChatHistory(targetId);
      messages.push(message);
      window.AppStorage.saveChatHistory(targetId, messages);
      if (window.CharacterManager && window.CharacterManager.renderChatMessages) {
        window.CharacterManager.renderChatMessages(targetId);
      }
    }
  }

  function isInlineOfflineActive(targetType, targetId) {
    if (inlineOfflineState.targetType === targetType && inlineOfflineState.targetId === targetId) {
      return true;
    }

    return activateStoredInlineOfflineState(targetType, targetId);
  }

  function updateInlineOfflineUi() {
    if (window.CharacterManager && window.CharacterManager.updateInlineOfflineUi) {
      window.CharacterManager.updateInlineOfflineUi();
    }

    if (window.GroupManager && window.GroupManager.updateInlineOfflineUi) {
      window.GroupManager.updateInlineOfflineUi();
    }
  }

  async function requestInlineOfflineAdvance(options) {
    var mode = options && options.mode || inlineOfflineState.targetType;
    var targetId = options && options.targetId || inlineOfflineState.targetId;

    if (mode && targetId && !isInlineOfflineActive(mode, targetId)) {
      return;
    }

    if (mode === "private") {
      await advancePrivateInlineOffline(targetId);
      return;
    }

    if (mode === "group") {
      await advanceGroupInlineOffline(targetId);
    }
  }

  async function advancePrivateInlineOffline(characterId) {
    var character = getCharacterById(characterId);
    var messages;
    var historyForRequest;
    var aiResult;
    var events;
    var now;
    var generationContext;

    if (!character || isAdvancing) {
      return;
    }

    isAdvancing = true;
    setInlineAdvanceState("private", true);
    now = Date.now();
    messages = window.AppStorage.getChatHistory(character.id);
    historyForRequest = messages.slice();
    messages.push(createInlineLoadingMessage(now, "正在输入中"));
    window.AppStorage.saveChatHistory(character.id, messages);

    if (window.CharacterManager && window.CharacterManager.renderChatMessages) {
      window.CharacterManager.renderChatMessages(character.id);
    }

    try {
      generationContext = window.AppExtras && window.AppExtras.buildChatGenerationContext
        ? window.AppExtras.buildChatGenerationContext("private", character.id)
        : {};
      aiResult = await window.AIService.sendInlineOfflineRequest({
        mode: "private",
        targetId: character.id,
        participants: [character],
        history: historyForRequest,
        userInput: getLatestInlineUserInput(historyForRequest),
        scene: inlineOfflineState.scene,
        userSettings: character.chatSettings || {},
        memories: window.AppStorage.getMemoriesForCharacters([character.id]),
        chatMemories: generationContext.chatMemories,
        bodyStateEnabled: generationContext.bodyStateEnabled,
        bodyState: generationContext.bodyState,
        memorySummaryDue: generationContext.memorySummaryDue,
        memorySummaryRounds: generationContext.memorySummaryRounds
      });
      messages = removeLoadingEvents(window.AppStorage.getChatHistory(character.id));
      window.AppStorage.saveChatHistory(character.id, messages);
      if (window.CharacterManager && window.CharacterManager.renderChatMessages) {
        window.CharacterManager.renderChatMessages(character.id);
      }
      events = normalizeOfflineEventsForDisplay(aiResult && aiResult.events || []);
      if (!events.length) {
        showEmptyAiReplyToast();
        messages = null;
        return;
      }
      persistInlineOfflineExtras("private", character.id, [character.id], aiResult);
      await streamInlineOfflineEvents(messages, "private", character.id, [character], events);
      if (window.AppExtras && window.AppExtras.finalizeChatGenerationContext) {
        window.AppExtras.finalizeChatGenerationContext(generationContext, aiResult);
      }
      messages = null;
    } catch (error) {
      messages = removeLoadingEvents(window.AppStorage.getChatHistory(character.id));
      messages.push(createInlineErrorMessage(error));
    } finally {
      if (messages) {
        window.AppStorage.saveChatHistory(character.id, messages);
      }
      if (window.CharacterManager && window.CharacterManager.renderChatMessages) {
        window.CharacterManager.renderChatMessages(character.id);
        window.CharacterManager.renderCharacterList();
      }
      isAdvancing = false;
      setInlineAdvanceState("private", false);
      updateInlineOfflineUi();
    }
  }

  async function advanceGroupInlineOffline(groupId) {
    var group = getGroupById(groupId);
    var participants = group ? getParticipants({
      participantIds: group.memberIds || []
    }) : [];
    var messages;
    var historyForRequest;
    var aiResult;
    var events;
    var now;
    var generationContext;

    if (!group || !participants.length || isAdvancing) {
      return;
    }

    isAdvancing = true;
    setInlineAdvanceState("group", true);
    now = Date.now();
    messages = window.AppStorage.getGroupChatHistory(group.id);
    historyForRequest = messages.slice();
    messages.push(createInlineLoadingMessage(now, "正在输入中"));
    window.AppStorage.saveGroupChatHistory(group.id, messages);

    if (window.GroupManager && window.GroupManager.renderGroupChatMessages) {
      window.GroupManager.renderGroupChatMessages(group.id);
    }

    try {
      generationContext = window.AppExtras && window.AppExtras.buildChatGenerationContext
        ? window.AppExtras.buildChatGenerationContext("group", group.id)
        : {};
      aiResult = await window.AIService.sendInlineOfflineRequest({
        mode: "group",
        targetId: group.id,
        participants: participants,
        history: historyForRequest,
        userInput: getLatestInlineUserInput(historyForRequest),
        scene: inlineOfflineState.scene,
        userSettings: group.settings || {},
        memories: window.AppStorage.getMemoriesForCharacters(group.memberIds || []),
        chatMemories: generationContext.chatMemories,
        bodyStateEnabled: generationContext.bodyStateEnabled,
        bodyState: generationContext.bodyState,
        memorySummaryDue: generationContext.memorySummaryDue,
        memorySummaryRounds: generationContext.memorySummaryRounds
      });
      messages = removeLoadingEvents(window.AppStorage.getGroupChatHistory(group.id));
      window.AppStorage.saveGroupChatHistory(group.id, messages);
      if (window.GroupManager && window.GroupManager.renderGroupChatMessages) {
        window.GroupManager.renderGroupChatMessages(group.id);
      }
      events = normalizeOfflineEventsForDisplay(aiResult && aiResult.events || []);
      if (!events.length) {
        showEmptyAiReplyToast();
        messages = null;
        return;
      }
      persistInlineOfflineExtras("group", group.id, group.memberIds || [], aiResult);
      await streamInlineOfflineEvents(messages, "group", group.id, participants, events);
      if (window.AppExtras && window.AppExtras.finalizeChatGenerationContext) {
        window.AppExtras.finalizeChatGenerationContext(generationContext, aiResult);
      }
      messages = null;
    } catch (error) {
      messages = removeLoadingEvents(window.AppStorage.getGroupChatHistory(group.id));
      messages.push(createInlineErrorMessage(error, participants[0]));
    } finally {
      if (messages) {
        window.AppStorage.saveGroupChatHistory(group.id, messages);
      }
      if (window.GroupManager && window.GroupManager.renderGroupChatMessages) {
        window.GroupManager.renderGroupChatMessages(group.id);
        window.GroupManager.renderGroupList();
      }
      isAdvancing = false;
      setInlineAdvanceState("group", false);
      updateInlineOfflineUi();
    }
  }

  function createInlineLoadingMessage(createdAt, content) {
    return {
      id: String(createdAt),
      role: "system",
      type: "loading",
      characterId: "",
      characterName: "",
      content: content,
      createdAt: createdAt
    };
  }

  function createInlineErrorMessage(error, character) {
    return {
      id: String(Date.now()),
      role: character ? "character" : "system",
      type: "error",
      characterId: character ? character.id : "",
      characterName: character ? character.name : "",
      content: "推进失败：" + (error && error.message ? error.message : "未知错误"),
      createdAt: Date.now()
    };
  }

  function appendInlineOfflineEvents(messages, mode, chatId, participants, events) {
    var participantMap = {};

    (participants || []).forEach(function (character) {
      participantMap[character.id] = character;
    });

    (events || []).slice(0, 50).forEach(function (event, index) {
      var now = Date.now() + index;
      var character = event.characterId ? participantMap[event.characterId] : null;
      var speechCharacter = event.type === "speech"
        ? (character || participants[0])
        : null;

      if (!event || !event.content) {
        return;
      }

      messages.push({
        id: String(now + Math.random()),
        role: speechCharacter ? "character" : "system",
        type: speechCharacter ? "offlineSpeech" : "offlineAction",
        characterId: speechCharacter ? speechCharacter.id : "",
        characterName: speechCharacter ? speechCharacter.name : "",
        content: event.content,
        createdAt: now
      });

      recordOfflineMoneyEvent(event, mode, chatId, speechCharacter);
      writeInlineEventMemory(mode, chatId, participants, speechCharacter, event.content, now);
    });
  }

  function streamInlineOfflineEvents(baseMessages, mode, chatId, participants, events) {
    var participantMap = {};
    var shown = [];
    var items = (events || []).slice(0, 50).filter(function (event) {
      return event && event.content;
    });

    (participants || []).forEach(function (character) {
      participantMap[character.id] = character;
    });

    if (!window.AppStream || !window.AppStream.appendMessagesWithStreamEffect) {
      appendInlineOfflineEvents(baseMessages, mode, chatId, participants, items);
      if (mode === "group") {
        window.AppStorage.saveGroupChatHistory(chatId, baseMessages);
      } else {
        window.AppStorage.saveChatHistory(chatId, baseMessages);
      }
      return Promise.resolve();
    }

    return window.AppStream.appendMessagesWithStreamEffect({
      targetType: mode,
      targetId: chatId,
      messages: items,
      renderOne: function (event, index) {
        var now = Date.now() + index;
        var character = event.characterId ? participantMap[event.characterId] : null;
        var speechCharacter = event.type === "speech"
          ? (character || participants[0])
          : null;
        var message = {
          id: String(now + Math.random()),
          role: speechCharacter ? "character" : "system",
          type: speechCharacter ? "offlineSpeech" : "offlineAction",
          characterId: speechCharacter ? speechCharacter.id : "",
          characterName: speechCharacter ? speechCharacter.name : "",
          content: event.content,
          createdAt: now
        };

        shown.push(message);
        recordOfflineMoneyEvent(event, mode, chatId, speechCharacter);
        writeInlineEventMemory(mode, chatId, participants, speechCharacter, event.content, now);

        if (mode === "group") {
          window.AppStorage.saveGroupChatHistory(chatId, baseMessages.concat(shown));
          if (window.GroupManager && window.GroupManager.renderGroupChatMessages) {
            window.GroupManager.renderGroupChatMessages(chatId);
          }
        } else {
          window.AppStorage.saveChatHistory(chatId, baseMessages.concat(shown));
          if (window.CharacterManager && window.CharacterManager.renderChatMessages) {
            window.CharacterManager.renderChatMessages(chatId);
          }
        }
      }
    });
  }

  function streamOfflineEvents(session, events) {
    var baseHistory = session && Array.isArray(session.history) ? session.history.slice() : [];
    var shown = [];
    var items = (events || []).slice(0, 50).filter(function (event) {
      return event && event.content;
    });

    if (!session || !window.AppStream || !window.AppStream.appendMessagesWithStreamEffect) {
      if (session) {
        appendOfflineEvents(session, items);
        session.updatedAt = Date.now();
        window.AppStorage.saveOfflineSession(session);
      }
      return Promise.resolve();
    }

    return window.AppStream.appendMessagesWithStreamEffect({
      targetType: "offline",
      targetId: session.id,
      messages: items,
      renderOne: function (event) {
        var character = event.characterId ? getCharacterById(event.characterId) : null;
        var now = Date.now();
        var message = {
          id: String(now + Math.random()),
          role: event.type === "speech" ? "character" : "system",
          type: event.type,
          characterId: event.characterId || "",
          characterName: character ? character.name : "",
          content: event.content,
          createdAt: now
        };
        var nextSession = window.AppStorage.getOfflineSession(session.id);

        if (!nextSession) {
          return;
        }

        shown.push(message);
        recordOfflineMoneyEvent(event, session.mode, session.targetId, character);
        if (event.type === "speech" && character) {
          window.AppStorage.addCharacterMemory(character.id, {
            content: "线下模式中说：" + event.content,
            source: "offline",
            createdAt: now
          });
        } else {
          (session.participantIds || []).forEach(function (memberId) {
            window.AppStorage.addCharacterMemory(memberId, {
              content: "线下事件：" + event.content,
              source: "offline",
              createdAt: now
            });
          });
        }
        nextSession.history = baseHistory.concat(shown);
        nextSession.updatedAt = Date.now();
        window.AppStorage.saveOfflineSession(nextSession);
        if (currentSessionId === session.id) {
          renderOfflineMessages();
        }
      }
    });
  }

  function recordOfflineMoneyEvent(event, mode, chatId, character) {
    var money = event && event.money && typeof event.money === "object" ? event.money : event;
    var normalizedAmount = window.AppStorage && window.AppStorage.normalizeMoneyAmount
      ? window.AppStorage.normalizeMoneyAmount(money && money.amount)
      : "";
    var amount = normalizedAmount ? Number(normalizedAmount) : 0;
    var direction = money && money.direction === "expense" ? "expense" : (money && money.direction === "income" ? "income" : "");
    var kind = money && (money.moneyType || money.type);
    var recordType;

    if (!window.AppStorage.addWalletLedger || !amount || amount < 0.01 || !direction) {
      return;
    }

    if (kind === "redPacket" || kind === "redpacket") {
      recordType = direction === "income" ? "redpacket_in" : "redpacket_out";
    } else if (kind === "transfer") {
      recordType = direction === "income" ? "transfer_in" : "transfer_out";
    } else {
      recordType = kind || "system";
    }

    window.AppStorage.addWalletLedger({
      type: recordType,
      amount: amount,
      direction: direction,
      sourceType: "offline",
      sourceId: chatId,
      characterId: character ? character.id : (money.characterId || ""),
      groupId: mode === "group" ? chatId : "",
      note: money.note || event.content || "线下模式金额事件",
      createdAt: Date.now()
    });
  }

  function writeInlineEventMemory(mode, chatId, participants, speechCharacter, content, createdAt) {
    if (speechCharacter) {
      window.AppStorage.addCharacterMemory(speechCharacter.id, {
        content: "线下模式中说：" + content,
        source: "offline",
        createdAt: createdAt
      });
      return;
    }

    (participants || []).forEach(function (character) {
      window.AppStorage.addCharacterMemory(character.id, {
        content: "线下剧情：" + content,
        source: "offline",
        createdAt: createdAt
      });
    });
  }

  function persistInlineOfflineExtras(mode, chatId, participantIds, result) {
    if (!result) {
      return;
    }

    try {
      (result.thoughts || []).forEach(function (thought) {
        if (!thought.characterId || !thought.content) {
          return;
        }

        window.AppStorage.addCharacterThought(thought.characterId, {
          source: "offline",
          chatId: chatId,
          content: thought.content,
          mood: thought.mood || "",
          visibleSummary: thought.visibleSummary || thought.summary || "",
          createdAt: Date.now()
        });
      });
    } catch (error) {
      console.warn("线下心声保存失败，剧情推进已保留。", error);
    }

    if (window.AppExtras) {
      if (mode === "group" && window.AppExtras.updateGroupThoughtsButton) {
        window.AppExtras.updateGroupThoughtsButton(chatId);
      }
      if (mode !== "group" && window.AppExtras.updatePrivateThoughtsButton) {
        window.AppExtras.updatePrivateThoughtsButton(chatId);
      }
    }

    try {
      (result.memories || []).forEach(function (memory) {
        if (!memory.characterId || !memory.content) {
          return;
        }

        window.AppStorage.addCharacterMemory(memory.characterId, {
          content: memory.content,
          source: "offline",
          createdAt: Date.now()
        });
      });
    } catch (error) {
      console.warn("线下记忆保存失败，剧情推进已保留。", error);
    }
  }

  function getLatestInlineUserInput(history) {
    var users = (history || []).filter(function (event) {
      return event.role === "user" || event.type === "offlineUserAction" || event.type === "user";
    });
    return users.length ? users[users.length - 1].content : "继续当前互动";
  }

  function setInlineAdvanceState(mode, advancing) {
    var button = getElement(mode === "group" ? "groupReplyButton" : "replyButton");
    if (button) {
      button.disabled = advancing;
      button.setAttribute("aria-label", advancing ? "推进中" : "推进");
      button.setAttribute("title", advancing ? "推进中" : "推进");
      button.textContent = advancing ? "…" : "▶";
    }
  }

  function setAdvanceState(advancing) {
    var button = getElement("offlineAdvanceBtn");
    if (button) {
      button.disabled = advancing;
      button.textContent = advancing ? "推进中" : "推进";
    }
  }

  window.OfflineManager = {
    openPrivateOffline: openPrivateOffline,
    openGroupOffline: openGroupOffline,
    enablePrivateInlineOffline: enablePrivateInlineOffline,
    enableGroupInlineOffline: enableGroupInlineOffline,
    disableInlineOffline: disableInlineOffline,
    isInlineOfflineActive: isInlineOfflineActive,
    requestInlineOfflineAdvance: requestInlineOfflineAdvance,
    getCurrentSession: getCurrentSession,
    openActiveOfflineThoughtsDrawer: openActiveOfflineThoughtsDrawer,
    updateOfflineThoughtButton: updateOfflineThoughtButton,
    goBack: goBack,
    renderOfflineMessages: renderOfflineMessages,
    sendOfflineUserInput: sendOfflineUserInput,
    advanceOffline: advanceOffline
  };
})(window, document);
