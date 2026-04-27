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
    return name ? name.slice(0, 1) : "AI";
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
  }

  function goBack() {
    window.setActivePage(returnPage || "homeScreen");
  }

  function getCurrentSession() {
    return currentSessionId ? window.AppStorage.getOfflineSession(currentSessionId) : null;
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
  }

  function renderOfflineEvent(event) {
    if (event.role === "user" || event.type === "user") {
      return [
        '<div class="offline-user-row">',
        '  <div class="offline-user-bubble">' + escapeHtml(event.content) + "</div>",
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
      '    <div class="offline-speech-bubble">' + escapeHtml(event.content) + "</div>",
      '    <span class="offline-time">' + formatTime(event.createdAt) + "</span>",
      "  </div>",
      "</div>"
    ].join("");
  }

  function renderActionEvent(event) {
    var cls = event.type === "error" ? " offline-action-error" : "";

    return [
      '<div class="offline-action-card' + cls + '">',
      '  <span>' + escapeHtml(event.content) + "</span>",
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
      aiResult = await window.AIService.sendOfflineRequest({
        mode: session.mode,
        targetId: session.targetId,
        userInput: latestUserInput,
        participants: participants,
        offlineHistory: historyForRequest,
        sharedMemories: window.AppStorage.getMemoriesForCharacters(session.participantIds)
      });
      events = Array.isArray(aiResult) ? aiResult : (aiResult && aiResult.events || []);
      session = getCurrentSession();
      session.history = removeLoadingEvents(session.history);
      appendOfflineEvents(session, events);
      persistOfflineAiExtras(session, aiResult);
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
      session.updatedAt = Date.now();
      window.AppStorage.saveOfflineSession(session);
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

    inlineOfflineState = {
      targetType: "private",
      targetId: characterId,
      scene: normalizeScene(scene)
    };
    appendInlineSceneMessage("private", characterId, [getCharacterById(characterId)]);
    updateInlineOfflineUi();
  }

  function enableGroupInlineOffline(groupId, scene) {
    var group = getGroupById(groupId);
    if (!group) {
      return;
    }

    inlineOfflineState = {
      targetType: "group",
      targetId: groupId,
      scene: normalizeScene(scene)
    };
    appendInlineSceneMessage("group", groupId, getParticipants({ participantIds: group.memberIds || [] }));
    updateInlineOfflineUi();
  }

  function disableInlineOffline() {
    inlineOfflineState = {
      targetType: "",
      targetId: "",
      scene: {
        name: "",
        description: ""
      }
    };
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
    var content = "进入线下模式：" + (scene.name || "未指定场景") + (scene.description ? "。" + scene.description : "");
    var message = {
      id: String(Date.now() + Math.random()),
      role: "system",
      type: "offlineAction",
      characterId: "",
      characterName: "",
      content: content,
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
          content: "线下模式场景：" + content,
          source: "offline",
          createdAt: Date.now()
        });
      }
    });
  }

  function isInlineOfflineActive(targetType, targetId) {
    return inlineOfflineState.targetType === targetType && inlineOfflineState.targetId === targetId;
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
    var now;

    if (!character || isAdvancing) {
      return;
    }

    isAdvancing = true;
    setInlineAdvanceState("private", true);
    now = Date.now();
    messages = window.AppStorage.getChatHistory(character.id);
    historyForRequest = messages.slice();
    messages.push(createInlineLoadingMessage(now, "剧情正在推进..."));
    window.AppStorage.saveChatHistory(character.id, messages);

    if (window.CharacterManager && window.CharacterManager.renderChatMessages) {
      window.CharacterManager.renderChatMessages(character.id);
    }

    try {
      aiResult = await window.AIService.sendInlineOfflineRequest({
        mode: "private",
        targetId: character.id,
        participants: [character],
        history: historyForRequest,
        userInput: getLatestInlineUserInput(historyForRequest),
        scene: inlineOfflineState.scene,
        memories: window.AppStorage.getMemoriesForCharacters([character.id])
      });
      messages = removeLoadingEvents(window.AppStorage.getChatHistory(character.id));
      appendInlineOfflineEvents(messages, "private", character.id, [character], aiResult && aiResult.events || []);
      persistInlineOfflineExtras("private", character.id, [character.id], aiResult);
    } catch (error) {
      messages = removeLoadingEvents(window.AppStorage.getChatHistory(character.id));
      messages.push(createInlineErrorMessage(error));
    } finally {
      window.AppStorage.saveChatHistory(character.id, messages);
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
    var now;

    if (!group || !participants.length || isAdvancing) {
      return;
    }

    isAdvancing = true;
    setInlineAdvanceState("group", true);
    now = Date.now();
    messages = window.AppStorage.getGroupChatHistory(group.id);
    historyForRequest = messages.slice();
    messages.push(createInlineLoadingMessage(now, "群聊剧情正在推进..."));
    window.AppStorage.saveGroupChatHistory(group.id, messages);

    if (window.GroupManager && window.GroupManager.renderGroupChatMessages) {
      window.GroupManager.renderGroupChatMessages(group.id);
    }

    try {
      aiResult = await window.AIService.sendInlineOfflineRequest({
        mode: "group",
        targetId: group.id,
        participants: participants,
        history: historyForRequest,
        userInput: getLatestInlineUserInput(historyForRequest),
        scene: inlineOfflineState.scene,
        memories: window.AppStorage.getMemoriesForCharacters(group.memberIds || [])
      });
      messages = removeLoadingEvents(window.AppStorage.getGroupChatHistory(group.id));
      appendInlineOfflineEvents(messages, "group", group.id, participants, aiResult && aiResult.events || []);
      persistInlineOfflineExtras("group", group.id, group.memberIds || [], aiResult);
    } catch (error) {
      messages = removeLoadingEvents(window.AppStorage.getGroupChatHistory(group.id));
      messages.push(createInlineErrorMessage(error, participants[0]));
    } finally {
      window.AppStorage.saveGroupChatHistory(group.id, messages);
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

    (events || []).slice(0, 20).forEach(function (event, index) {
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

      writeInlineEventMemory(mode, chatId, participants, speechCharacter, event.content, now);
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
      button.textContent = advancing ? "推进中" : "推进";
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
    goBack: goBack,
    renderOfflineMessages: renderOfflineMessages,
    sendOfflineUserInput: sendOfflineUserInput,
    advanceOffline: advanceOffline
  };
})(window, document);
