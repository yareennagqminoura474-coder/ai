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

  function getOfflineAiServiceMethod(name) {
    if (!window.AIService || !window.AIService[name]) {
      throw new Error("AI 服务未加载，请刷新页面或清除 PWA 缓存后重试。");
    }
    return window.AIService[name];
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

  function normalizeOfflineHistoryEventForRender(event) {
    var source = event && typeof event === "object" ? event : { content: event };
    var content = normalizeDisplayText(source.content || "");

    if (source.role === "user" || source.type === "user") {
      return Object.assign({}, source, {
        role: "user",
        type: "user",
        content: content
      });
    }

    return Object.assign({}, source, {
      type: source.type === "speech" ? "speech" : "action",
      characterId: source.type === "speech" ? source.characterId : "",
      content: content
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
    var history = session ? (session.history || []).map(normalizeOfflineHistoryEventForRender).filter(function (event) {
      return event.content;
    }) : [];

    if (!wrap) {
      return;
    }

    if (!session || !history.length) {
      wrap.innerHTML = '<div class="offline-empty">说点什么，或点击推进开始一段线下互动</div>';
    } else {
      wrap.innerHTML = history.map(renderOfflineEvent).join("");
    }

    if (window.AppApiJobs && window.AppApiJobs.scheduleScrollToBottom) {
      window.AppApiJobs.scheduleScrollToBottom(wrap);
    } else {
      requestAnimationFrame(function () {
        wrap.scrollTop = wrap.scrollHeight;
      });
    }

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
    var generationId;

    if (!session || isAdvancing || !participants.length) {
      return;
    }

    if (isApiJobRunning("offline", session.id, ["offline"])) {
      if (window.AppExtras && window.AppExtras.showToast) {
        window.AppExtras.showToast("正在回复中", true);
      }
      return;
    }

    isAdvancing = true;
    setAdvanceState(true);
    now = Date.now();
    historyForRequest = session.history.slice();
    generationId = createGenerationId();

    session.history.push({
      id: String(now),
      role: "system",
      type: "loading",
      characterId: "",
      characterName: "",
      content: "剧情正在推进...",
      createdAt: now,
      generationId: generationId
    });
    session.updatedAt = now;
    window.AppStorage.saveOfflineSession(session);
    renderOfflineMessages();

    try {
      await runApiJob({
        targetType: "offline",
        targetId: session.id,
        mode: "offline",
        generationId: generationId,
        beforeMessages: historyForRequest,
        requestSnapshot: {
          previousReplyText: collectEventText(historyForRequest)
        }
      });
      session = null;
    } catch (error) {
      session = getCurrentSession();
      session.history = removeLoadingEventsByGeneration(session.history, generationId);
      session.history.push({
        id: String(Date.now()),
        role: "system",
        type: "error",
        characterId: "",
        characterName: "",
        content: "推进失败：" + (error && error.message ? error.message : "未知错误"),
        createdAt: Date.now(),
        generationId: generationId
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

  async function handleOfflineJob(job) {
    var session = window.AppStorage.getOfflineSession(job.targetId);
    var participants = getParticipants(session);
    var requestSnapshot = job.requestSnapshot || {};
    var historyForRequest = Array.isArray(job.beforeMessages) && job.beforeMessages.length
      ? job.beforeMessages
      : (session && removeLoadingEventsByGeneration(session.history, job.generationId) || []);
    var latestUserInput = getLatestUserInput(historyForRequest);
    var generationContext;
    var aiResult;
    var events;
    var generatedEvents;

    if (!session || !participants.length) {
      throw new Error("线下会话不存在或没有参与角色。");
    }

    if (hasGeneratedOutput("offline", session.id, job.generationId)) {
      session.history = removeLoadingEventsByGeneration(session.history, job.generationId);
      session.updatedAt = Date.now();
      window.AppStorage.saveOfflineSession(session);
      if (currentSessionId === session.id) {
        renderOfflineMessages();
      }
      return { afterMessages: session.history };
    }

    generationContext = window.AppExtras && window.AppExtras.buildChatGenerationContext
      ? window.AppExtras.buildChatGenerationContext("offline", session.id, {
        generationId: job.generationId,
        previousReplyText: requestSnapshot.previousReplyText || collectEventText(historyForRequest),
        rejectedReplyText: requestSnapshot.rejectedReplyText || ""
      })
      : requestSnapshot;

    aiResult = await getOfflineAiServiceMethod("sendOfflineRequest")({
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
      memorySummaryRounds: generationContext.memorySummaryRounds,
      previousReplyText: generationContext.previousReplyText,
      rejectedReplyText: generationContext.rejectedReplyText
    });
    events = normalizeOfflineEventsForDisplay(Array.isArray(aiResult) ? aiResult : (aiResult && aiResult.events || []));
    session = window.AppStorage.getOfflineSession(job.targetId);
    session.history = removeLoadingEventsByGeneration(session.history, job.generationId);
    session.updatedAt = Date.now();
    window.AppStorage.saveOfflineSession(session);
    if (currentSessionId === session.id) {
      renderOfflineMessages();
    }

    if (!events.length) {
      showEmptyAiReplyToast();
      return { afterMessages: session.history };
    }

    generatedEvents = await streamOfflineEvents(session, events, {
      generationId: job.generationId
    });
    persistOfflineAiExtras(session, aiResult, {
      generationId: job.generationId,
      relatedMessageIds: (generatedEvents || []).map(function (event) {
        return event.id;
      })
    });

    if (window.AppExtras && window.AppExtras.finalizeChatGenerationContext) {
      window.AppExtras.finalizeChatGenerationContext(generationContext, aiResult);
    }

    session = window.AppStorage.getOfflineSession(job.targetId);
    if (session && currentSessionId === session.id) {
      renderOfflineMessages();
    }
    return { afterMessages: session ? session.history : [] };
  }

  function appendOfflineEvents(session, events, meta) {
    var extra = meta || {};

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
        createdAt: now,
        generationId: extra.generationId || event.generationId || "",
        sourceGenerationId: extra.generationId || event.sourceGenerationId || ""
      });

      recordOfflineMoneyEvent(event, session.mode, session.targetId, character, extra);

      if (event.type === "speech" && character) {
        window.AppStorage.addCharacterMemory(character.id, {
          content: "线下模式中说：" + event.content,
          source: "offline",
          generationId: extra.generationId || "",
          sourceGenerationId: extra.generationId || "",
          targetType: "offline",
          targetId: session.id,
          createdAt: now
        });
      } else if (event.characterId) {
        window.AppStorage.addCharacterMemory(event.characterId, {
          content: "线下动作：" + event.content,
          source: "offline",
          generationId: extra.generationId || "",
          sourceGenerationId: extra.generationId || "",
          targetType: "offline",
          targetId: session.id,
          createdAt: now
        });
      } else {
        addMemoryForParticipants(session, "线下剧情：" + event.content, "offline", now, extra);
      }
    });
  }

  function persistOfflineAiExtras(session, result, meta) {
    var extra = meta || {};

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
          generationId: extra.generationId || "",
          sourceGenerationId: extra.generationId || "",
          relatedMessageIds: extra.relatedMessageIds || [],
          targetType: "offline",
          targetId: session.id,
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
          generationId: extra.generationId || "",
          sourceGenerationId: extra.generationId || "",
          relatedMessageIds: extra.relatedMessageIds || [],
          targetType: "offline",
          targetId: session.id,
          createdAt: Date.now()
        });
      });
    } catch (error) {
      console.warn("线下记忆保存失败，剧情推进已保留。", error);
    }
  }

  function addMemoryForParticipants(session, content, source, createdAt, meta) {
    var extra = meta || {};

    (session.participantIds || []).forEach(function (characterId) {
      window.AppStorage.addCharacterMemory(characterId, {
        content: content,
        source: source,
        generationId: extra.generationId || "",
        sourceGenerationId: extra.generationId || "",
        targetType: session && session.id ? "offline" : "",
        targetId: session && session.id || "",
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

  function removeLoadingEventsByGeneration(history, generationId) {
    var gid = String(generationId || "");
    return (Array.isArray(history) ? history : []).filter(function (event) {
      if (!event || event.type !== "loading") {
        return true;
      }
      return gid && event.generationId !== gid;
    });
  }

  function createGenerationId() {
    return window.AppApiJobs && window.AppApiJobs.createGenerationId
      ? window.AppApiJobs.createGenerationId()
      : "generation_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  }

  function isApiJobRunning(targetType, targetId, modes) {
    return Boolean(window.AppApiJobs
      && window.AppApiJobs.isTargetRunning
      && window.AppApiJobs.isTargetRunning(targetType, targetId, modes));
  }

  function hasGeneratedOutput(targetType, targetId, generationId) {
    return Boolean(window.AppApiJobs
      && window.AppApiJobs.hasGeneratedOutput
      && window.AppApiJobs.hasGeneratedOutput(targetType, targetId, generationId));
  }

  function runApiJob(input) {
    if (!window.AppApiJobs || !window.AppApiJobs.runJob) {
      return Promise.reject(new Error("API job runner unavailable."));
    }

    return window.AppApiJobs.runJob(input);
  }

  function scheduleInlineRender(mode, targetId) {
    if (window.AppApiJobs && window.AppApiJobs.scheduleRenderChat) {
      window.AppApiJobs.scheduleRenderChat(mode === "group" ? "group" : "private", targetId);
      return;
    }

    if (mode === "group" && window.GroupManager && window.GroupManager.renderGroupChatMessages) {
      window.GroupManager.renderGroupChatMessages(targetId);
      return;
    }

    if (window.CharacterManager && window.CharacterManager.renderChatMessages) {
      window.CharacterManager.renderChatMessages(targetId);
    }
  }

  function scheduleInlineListRender(mode) {
    if (window.AppApiJobs && window.AppApiJobs.scheduleRenderList) {
      window.AppApiJobs.scheduleRenderList(mode === "group" ? "group" : "private");
      return;
    }

    if (mode === "group" && window.GroupManager && window.GroupManager.renderGroupList) {
      window.GroupManager.renderGroupList();
      return;
    }

    if (window.CharacterManager && window.CharacterManager.renderCharacterList) {
      window.CharacterManager.renderCharacterList();
    }
  }

  function collectEventText(items) {
    return (Array.isArray(items) ? items : []).filter(function (event) {
      return event
        && event.type !== "loading"
        && event.type !== "error"
        && event.role !== "user"
        && event.type !== "user"
        && event.type !== "offlineUserAction"
        && event.content;
    }).map(function (event) {
      return (event.characterName ? event.characterName + "：" : "") + event.content;
    }).join("\n");
  }

  function isInlineUserEvent(event) {
    return Boolean(event && (
      event.role === "user"
      || event.type === "user"
      || event.type === "offlineUserAction"
    ));
  }

  function isInlineGeneratedOfflineEvent(event) {
    return Boolean(event && event.content && event.type !== "loading" && event.type !== "error" && !isInlineUserEvent(event) && (
      event.type === "offlineAction"
      || event.type === "offlineSpeech"
      || event.role === "character"
    ));
  }

  function getInlineHistory(mode, targetId) {
    return mode === "group"
      ? window.AppStorage.getGroupChatHistory(targetId)
      : window.AppStorage.getChatHistory(targetId);
  }

  function saveInlineHistory(mode, targetId, messages) {
    if (mode === "group") {
      window.AppStorage.saveGroupChatHistory(targetId, messages);
      return;
    }
    window.AppStorage.saveChatHistory(targetId, messages);
  }

  function getInlineParticipants(mode, targetId) {
    var group;

    if (mode === "group") {
      group = getGroupById(targetId);
      return group ? getParticipants({ participantIds: group.memberIds || [] }) : [];
    }

    return getCharacterById(targetId) ? [getCharacterById(targetId)] : [];
  }

  function collectInlineGenerationIds(items) {
    var ids = {};

    (Array.isArray(items) ? items : []).forEach(function (event) {
      if (event && event.generationId) {
        ids[String(event.generationId)] = true;
      }
      if (event && event.sourceGenerationId) {
        ids[String(event.sourceGenerationId)] = true;
      }
    });

    return Object.keys(ids);
  }

  function findLatestInlineRegenerateMessageId(mode, targetId) {
    var messages = removeLoadingEvents(getInlineHistory(mode, targetId));
    var index;
    var nextIndex;
    var hasOfflineReply;

    for (index = messages.length - 1; index >= 0; index -= 1) {
      if (!isInlineUserEvent(messages[index])) {
        continue;
      }

      hasOfflineReply = false;
      nextIndex = index + 1;

      while (nextIndex < messages.length && !isInlineUserEvent(messages[nextIndex])) {
        if (isInlineGeneratedOfflineEvent(messages[nextIndex])) {
          hasOfflineReply = true;
          break;
        }
        nextIndex += 1;
      }

      if (hasOfflineReply) {
        return messages[index].id;
      }
    }

    return "";
  }

  function getPreviousInlineReplyText(messages, userIndex) {
    var list = Array.isArray(messages) ? messages : [];
    var end = typeof userIndex === "number" ? userIndex : list.length - 1;
    var start = end - 1;

    while (start >= 0 && !isInlineUserEvent(list[start])) {
      start -= 1;
    }

    return collectEventText(list.slice(start + 1, end));
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

  async function regenerateInlineOfflineLastTurn(options) {
    var source = options || {};
    var mode = source.targetType === "group" || source.mode === "group" ? "group" : "private";
    var targetId = String(source.targetId || inlineOfflineState.targetId || "");
    var participants;
    var messages;
    var messageId;
    var index;
    var nextIndex;
    var before;
    var oldMessages;
    var after;
    var oldGenerationIds;
    var oldBodyState;
    var generationId;
    var loadingMessage;
    var errorCharacter;

    if (!targetId || !isInlineOfflineActive(mode, targetId)) {
      return false;
    }

    participants = getInlineParticipants(mode, targetId);
    if (!participants.length || isAdvancing) {
      return false;
    }

    if (isApiJobRunning(mode, targetId, ["inlineOffline", "regenerate"])) {
      if (window.AppExtras && window.AppExtras.showToast) {
        window.AppExtras.showToast("正在回复中", true);
      }
      return true;
    }

    messages = getInlineHistory(mode, targetId);
    messageId = source.messageId || findLatestInlineRegenerateMessageId(mode, targetId);
    index = messages.findIndex(function (message) {
      return message && message.id === messageId && isInlineUserEvent(message);
    });

    if (index === -1) {
      return false;
    }

    nextIndex = index + 1;
    while (nextIndex < messages.length && !isInlineUserEvent(messages[nextIndex])) {
      nextIndex += 1;
    }

    before = messages.slice(0, index + 1);
    oldMessages = messages.slice(index + 1, nextIndex);
    after = messages.slice(nextIndex);
    oldGenerationIds = collectInlineGenerationIds(oldMessages);
    oldBodyState = window.AppStorage.getBodyState ? window.AppStorage.getBodyState(mode, targetId) : null;
    generationId = createGenerationId();
    loadingMessage = createInlineLoadingMessage(Date.now(), "正在重新生成...", generationId);
    errorCharacter = mode === "group" ? participants[0] : null;

    isAdvancing = true;
    setInlineAdvanceState(mode, true);

    if (oldGenerationIds.length && window.AppStorage.removeGenerationArtifacts) {
      window.AppStorage.removeGenerationArtifacts(oldGenerationIds, {
        targetType: mode,
        targetId: targetId
      });
    }

    saveInlineHistory(mode, targetId, before.concat([loadingMessage], after));
    scheduleInlineRender(mode, targetId);

    try {
      await runApiJob({
        targetType: mode,
        targetId: targetId,
        mode: "inlineOffline",
        generationId: generationId,
        beforeMessages: before,
        afterMessages: after,
        requestSnapshot: {
          parentUserMessageId: messageId,
          regenerateRequest: true,
          regenerateInstruction: String(source.instruction || source.regenerateInstruction || "").trim(),
          previousReplyText: getPreviousInlineReplyText(messages, index),
          rejectedReplyText: collectEventText(oldMessages),
          oldGenerationIds: oldGenerationIds,
          oldMessages: oldMessages,
          scene: inlineOfflineState.scene
        }
      });
      messages = null;
    } catch (error) {
      if (oldBodyState && window.AppStorage.saveBodyState) {
        window.AppStorage.saveBodyState(mode, targetId, oldBodyState);
      }
      messages = before.concat(oldMessages, [createInlineErrorMessage(error, errorCharacter, generationId)], after);
    } finally {
      if (messages) {
        saveInlineHistory(mode, targetId, messages);
      }
      scheduleInlineRender(mode, targetId);
      scheduleInlineListRender(mode);
      isAdvancing = false;
      setInlineAdvanceState(mode, false);
      updateInlineOfflineUi();
    }

    return true;
  }

  async function advancePrivateInlineOffline(characterId) {
    var character = getCharacterById(characterId);
    var messages;
    var historyForRequest;
    var now;
    var generationId;

    if (!character || isAdvancing) {
      return;
    }

    if (isApiJobRunning("private", character.id, ["inlineOffline"])) {
      if (window.AppExtras && window.AppExtras.showToast) {
        window.AppExtras.showToast("正在回复中", true);
      }
      return;
    }

    isAdvancing = true;
    setInlineAdvanceState("private", true);
    now = Date.now();
    generationId = createGenerationId();
    messages = window.AppStorage.getChatHistory(character.id);
    historyForRequest = messages.slice();
    messages.push(createInlineLoadingMessage(now, "正在输入中", generationId));
    window.AppStorage.saveChatHistory(character.id, messages);
    scheduleInlineRender("private", character.id);

    try {
      await runApiJob({
        targetType: "private",
        targetId: character.id,
        mode: "inlineOffline",
        generationId: generationId,
        beforeMessages: historyForRequest,
        requestSnapshot: {
          scene: inlineOfflineState.scene,
          previousReplyText: collectEventText(historyForRequest)
        }
      });
      messages = null;
    } catch (error) {
      messages = removeLoadingEventsByGeneration(window.AppStorage.getChatHistory(character.id), generationId);
      messages.push(createInlineErrorMessage(error, null, generationId));
    } finally {
      if (messages) {
        window.AppStorage.saveChatHistory(character.id, messages);
      }
      scheduleInlineRender("private", character.id);
      scheduleInlineListRender("private");
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
    var now;
    var generationId;

    if (!group || !participants.length || isAdvancing) {
      return;
    }

    if (isApiJobRunning("group", group.id, ["inlineOffline"])) {
      if (window.AppExtras && window.AppExtras.showToast) {
        window.AppExtras.showToast("正在回复中", true);
      }
      return;
    }

    isAdvancing = true;
    setInlineAdvanceState("group", true);
    now = Date.now();
    generationId = createGenerationId();
    messages = window.AppStorage.getGroupChatHistory(group.id);
    historyForRequest = messages.slice();
    messages.push(createInlineLoadingMessage(now, "正在输入中", generationId));
    window.AppStorage.saveGroupChatHistory(group.id, messages);
    scheduleInlineRender("group", group.id);

    try {
      await runApiJob({
        targetType: "group",
        targetId: group.id,
        mode: "inlineOffline",
        generationId: generationId,
        beforeMessages: historyForRequest,
        requestSnapshot: {
          scene: inlineOfflineState.scene,
          previousReplyText: collectEventText(historyForRequest)
        }
      });
      messages = null;
    } catch (error) {
      messages = removeLoadingEventsByGeneration(window.AppStorage.getGroupChatHistory(group.id), generationId);
      messages.push(createInlineErrorMessage(error, participants[0], generationId));
    } finally {
      if (messages) {
        window.AppStorage.saveGroupChatHistory(group.id, messages);
      }
      scheduleInlineRender("group", group.id);
      scheduleInlineListRender("group");
      isAdvancing = false;
      setInlineAdvanceState("group", false);
      updateInlineOfflineUi();
    }
  }

  async function handlePrivateInlineOfflineJob(job) {
    var character = getCharacterById(job.targetId);
    var requestSnapshot = job.requestSnapshot || {};
    var historyForRequest = Array.isArray(job.beforeMessages) && job.beforeMessages.length
      ? job.beforeMessages
      : (character ? removeLoadingEventsByGeneration(window.AppStorage.getChatHistory(character.id), job.generationId) : []);
    var suffixMessages = Array.isArray(job.afterMessages) ? job.afterMessages : [];
    var generationContext;
    var aiResult;
    var events;
    var messages;
    var baseMessages;
    var generatedMessages;

    if (!character) {
      throw new Error("角色不存在。");
    }

    if (hasGeneratedOutput("private", character.id, job.generationId)) {
      messages = removeLoadingEventsByGeneration(window.AppStorage.getChatHistory(character.id), job.generationId);
      window.AppStorage.saveChatHistory(character.id, messages);
      scheduleInlineRender("private", character.id);
      scheduleInlineListRender("private");
      return { afterMessages: messages };
    }

    generationContext = window.AppExtras && window.AppExtras.buildChatGenerationContext
      ? window.AppExtras.buildChatGenerationContext("private", character.id, {
        generationId: job.generationId,
        previousReplyText: requestSnapshot.previousReplyText || collectEventText(historyForRequest),
        rejectedReplyText: requestSnapshot.rejectedReplyText || "",
        regenerateRequest: requestSnapshot.regenerateRequest,
        regenerateInstruction: requestSnapshot.regenerateInstruction
      })
      : requestSnapshot;

    aiResult = await getOfflineAiServiceMethod("sendInlineOfflineRequest")({
      mode: "private",
      targetId: character.id,
      participants: [character],
      history: historyForRequest,
      offlineHistory: historyForRequest,
      userInput: getLatestInlineUserInput(historyForRequest) || "继续推进",
      regenerateRequest: Boolean(requestSnapshot.regenerateRequest),
      regenerateInstruction: String(requestSnapshot.regenerateInstruction || "").trim(),
      scene: requestSnapshot.scene || inlineOfflineState.scene,
      userSettings: character.chatSettings || {},
      memories: window.AppStorage.getMemoriesForCharacters([character.id]),
      sharedMemories: window.AppStorage.getMemoriesForCharacters([character.id]),
      chatMemories: generationContext.chatMemories,
      bodyStateEnabled: generationContext.bodyStateEnabled,
      bodyState: generationContext.bodyState,
      memorySummaryDue: generationContext.memorySummaryDue,
      memorySummaryRounds: generationContext.memorySummaryRounds,
      selectedWorldBookIds: requestSnapshot.selectedWorldBookIds || generationContext.selectedWorldBookIds,
      previousReplyText: generationContext.previousReplyText,
      rejectedReplyText: generationContext.rejectedReplyText
    });
    messages = removeLoadingEventsByGeneration(window.AppStorage.getChatHistory(character.id), job.generationId);
    window.AppStorage.saveChatHistory(character.id, messages);
    scheduleInlineRender("private", character.id);
    events = normalizeOfflineEventsForDisplay(aiResult && aiResult.events || []);

    if (!events.length) {
      showEmptyAiReplyToast();
      scheduleInlineListRender("private");
      return { afterMessages: messages };
    }

    baseMessages = suffixMessages.length || requestSnapshot.regenerateRequest
      ? historyForRequest.slice()
      : messages;
    window.AppStorage.saveChatHistory(character.id, baseMessages.concat(suffixMessages));
    generatedMessages = await streamInlineOfflineEvents(baseMessages, "private", character.id, [character], events, {
      generationId: job.generationId
    }, suffixMessages);
    persistInlineOfflineExtras("private", character.id, [character.id], aiResult, {
      generationId: job.generationId,
      relatedMessageIds: (generatedMessages || []).map(function (message) {
        return message.id;
      })
    });

    if (window.AppExtras && window.AppExtras.finalizeChatGenerationContext) {
      window.AppExtras.finalizeChatGenerationContext(generationContext, aiResult);
    }

    messages = window.AppStorage.getChatHistory(character.id);
    scheduleInlineRender("private", character.id);
    scheduleInlineListRender("private");
    return { afterMessages: messages };
  }

  async function handleGroupInlineOfflineJob(job) {
    var group = getGroupById(job.targetId);
    var participants = group ? getParticipants({ participantIds: group.memberIds || [] }) : [];
    var requestSnapshot = job.requestSnapshot || {};
    var historyForRequest = Array.isArray(job.beforeMessages) && job.beforeMessages.length
      ? job.beforeMessages
      : (group ? removeLoadingEventsByGeneration(window.AppStorage.getGroupChatHistory(group.id), job.generationId) : []);
    var suffixMessages = Array.isArray(job.afterMessages) ? job.afterMessages : [];
    var generationContext;
    var aiResult;
    var events;
    var messages;
    var baseMessages;
    var generatedMessages;

    if (!group || !participants.length) {
      throw new Error("群聊不存在或没有成员。");
    }

    if (hasGeneratedOutput("group", group.id, job.generationId)) {
      messages = removeLoadingEventsByGeneration(window.AppStorage.getGroupChatHistory(group.id), job.generationId);
      window.AppStorage.saveGroupChatHistory(group.id, messages);
      scheduleInlineRender("group", group.id);
      scheduleInlineListRender("group");
      return { afterMessages: messages };
    }

    generationContext = window.AppExtras && window.AppExtras.buildChatGenerationContext
      ? window.AppExtras.buildChatGenerationContext("group", group.id, {
        generationId: job.generationId,
        previousReplyText: requestSnapshot.previousReplyText || collectEventText(historyForRequest),
        rejectedReplyText: requestSnapshot.rejectedReplyText || "",
        regenerateRequest: requestSnapshot.regenerateRequest,
        regenerateInstruction: requestSnapshot.regenerateInstruction
      })
      : requestSnapshot;

    aiResult = await getOfflineAiServiceMethod("sendInlineOfflineRequest")({
      mode: "group",
      targetId: group.id,
      participants: participants,
      history: historyForRequest,
      offlineHistory: historyForRequest,
      userInput: getLatestInlineUserInput(historyForRequest) || "继续推进",
      regenerateRequest: Boolean(requestSnapshot.regenerateRequest),
      regenerateInstruction: String(requestSnapshot.regenerateInstruction || "").trim(),
      scene: requestSnapshot.scene || inlineOfflineState.scene,
      userSettings: group.settings || {},
      memories: window.AppStorage.getMemoriesForCharacters(group.memberIds || []),
      sharedMemories: window.AppStorage.getMemoriesForCharacters(group.memberIds || []),
      chatMemories: generationContext.chatMemories,
      bodyStateEnabled: generationContext.bodyStateEnabled,
      bodyState: generationContext.bodyState,
      memorySummaryDue: generationContext.memorySummaryDue,
      memorySummaryRounds: generationContext.memorySummaryRounds,
      selectedWorldBookIds: requestSnapshot.selectedWorldBookIds || generationContext.selectedWorldBookIds,
      previousReplyText: generationContext.previousReplyText,
      rejectedReplyText: generationContext.rejectedReplyText
    });
    messages = removeLoadingEventsByGeneration(window.AppStorage.getGroupChatHistory(group.id), job.generationId);
    window.AppStorage.saveGroupChatHistory(group.id, messages);
    scheduleInlineRender("group", group.id);
    events = normalizeOfflineEventsForDisplay(aiResult && aiResult.events || []);

    if (!events.length) {
      showEmptyAiReplyToast();
      scheduleInlineListRender("group");
      return { afterMessages: messages };
    }

    baseMessages = suffixMessages.length || requestSnapshot.regenerateRequest
      ? historyForRequest.slice()
      : messages;
    window.AppStorage.saveGroupChatHistory(group.id, baseMessages.concat(suffixMessages));
    generatedMessages = await streamInlineOfflineEvents(baseMessages, "group", group.id, participants, events, {
      generationId: job.generationId
    }, suffixMessages);
    persistInlineOfflineExtras("group", group.id, group.memberIds || [], aiResult, {
      generationId: job.generationId,
      relatedMessageIds: (generatedMessages || []).map(function (message) {
        return message.id;
      })
    });

    if (window.AppExtras && window.AppExtras.finalizeChatGenerationContext) {
      window.AppExtras.finalizeChatGenerationContext(generationContext, aiResult);
    }

    messages = window.AppStorage.getGroupChatHistory(group.id);
    scheduleInlineRender("group", group.id);
    scheduleInlineListRender("group");
    return { afterMessages: messages };
  }

  function createInlineLoadingMessage(createdAt, content, generationId) {
    return {
      id: String(createdAt),
      role: "system",
      type: "loading",
      characterId: "",
      characterName: "",
      content: content,
      createdAt: createdAt,
      generationId: generationId || ""
    };
  }

  function createInlineErrorMessage(error, character, generationId) {
    return {
      id: String(Date.now()),
      role: character ? "character" : "system",
      type: "error",
      characterId: character ? character.id : "",
      characterName: character ? character.name : "",
      content: "推进失败：" + (error && error.message ? error.message : "未知错误"),
      createdAt: Date.now(),
      generationId: generationId || ""
    };
  }

  function appendInlineOfflineEvents(messages, mode, chatId, participants, events, meta) {
    var participantMap = {};
    var extra = meta || {};

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
        createdAt: now,
        generationId: extra.generationId || event.generationId || "",
        sourceGenerationId: extra.generationId || event.sourceGenerationId || ""
      });

      recordOfflineMoneyEvent(event, mode, chatId, speechCharacter, extra);
      writeInlineEventMemory(mode, chatId, participants, speechCharacter, event.content, now, extra);
    });
  }

  function streamInlineOfflineEvents(baseMessages, mode, chatId, participants, events, meta, suffixMessages) {
    var participantMap = {};
    var shown = [];
    var extra = meta || {};
    var suffix = Array.isArray(suffixMessages) ? suffixMessages : [];
    var items = (events || []).slice(0, 50).filter(function (event) {
      return event && event.content;
    });

    (participants || []).forEach(function (character) {
      participantMap[character.id] = character;
    });

    if (!window.AppStream || !window.AppStream.appendMessagesWithStreamEffect) {
      appendInlineOfflineEvents(baseMessages, mode, chatId, participants, items, extra);
      if (mode === "group") {
        window.AppStorage.saveGroupChatHistory(chatId, baseMessages.concat(suffix));
      } else {
        window.AppStorage.saveChatHistory(chatId, baseMessages.concat(suffix));
      }
      return Promise.resolve(baseMessages.slice(-items.length));
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
          createdAt: now,
          generationId: extra.generationId || event.generationId || "",
          sourceGenerationId: extra.generationId || event.sourceGenerationId || ""
        };

        shown.push(message);
        recordOfflineMoneyEvent(event, mode, chatId, speechCharacter, extra);
        writeInlineEventMemory(mode, chatId, participants, speechCharacter, event.content, now, extra);

        if (mode === "group") {
          if (window.AppApiJobs && window.AppApiJobs.saveChatHistoryDebounced) {
            window.AppApiJobs.saveChatHistoryDebounced("group", chatId, baseMessages.concat(shown, suffix), 120);
          } else {
            window.AppStorage.saveGroupChatHistory(chatId, baseMessages.concat(shown, suffix));
          }
          if (window.GroupManager && window.GroupManager.renderGroupChatMessages) {
            if (window.AppApiJobs && window.AppApiJobs.scheduleRenderChat) {
              window.AppApiJobs.scheduleRenderChat("group", chatId);
            } else {
              window.GroupManager.renderGroupChatMessages(chatId);
            }
          }
        } else {
          if (window.AppApiJobs && window.AppApiJobs.saveChatHistoryDebounced) {
            window.AppApiJobs.saveChatHistoryDebounced("private", chatId, baseMessages.concat(shown, suffix), 120);
          } else {
            window.AppStorage.saveChatHistory(chatId, baseMessages.concat(shown, suffix));
          }
          if (window.CharacterManager && window.CharacterManager.renderChatMessages) {
            if (window.AppApiJobs && window.AppApiJobs.scheduleRenderChat) {
              window.AppApiJobs.scheduleRenderChat("private", chatId);
            } else {
              window.CharacterManager.renderChatMessages(chatId);
            }
          }
        }
      }
    }).then(function () {
      if (mode === "group") {
        window.AppStorage.saveGroupChatHistory(chatId, baseMessages.concat(shown, suffix));
        if (window.AppApiJobs && window.AppApiJobs.flushChatHistorySave) {
          window.AppApiJobs.flushChatHistorySave("group", chatId);
        }
      } else {
        window.AppStorage.saveChatHistory(chatId, baseMessages.concat(shown, suffix));
        if (window.AppApiJobs && window.AppApiJobs.flushChatHistorySave) {
          window.AppApiJobs.flushChatHistorySave("private", chatId);
        }
      }
      return shown;
    });
  }

  function streamOfflineEvents(session, events, meta) {
    var baseHistory = session && Array.isArray(session.history) ? session.history.slice() : [];
    var shown = [];
    var extra = meta || {};
    var items = (events || []).slice(0, 50).filter(function (event) {
      return event && event.content;
    });

    if (!session || !window.AppStream || !window.AppStream.appendMessagesWithStreamEffect) {
      if (session) {
        appendOfflineEvents(session, items, extra);
        session.updatedAt = Date.now();
        window.AppStorage.saveOfflineSession(session);
      }
      return Promise.resolve(session ? session.history.slice(-items.length) : []);
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
          createdAt: now,
          generationId: extra.generationId || event.generationId || "",
          sourceGenerationId: extra.generationId || event.sourceGenerationId || ""
        };
        var nextSession = window.AppStorage.getOfflineSession(session.id);

        if (!nextSession) {
          return;
        }

        shown.push(message);
        recordOfflineMoneyEvent(event, session.mode, session.targetId, character, extra);
        if (event.type === "speech" && character) {
          window.AppStorage.addCharacterMemory(character.id, {
            content: "线下模式中说：" + event.content,
            source: "offline",
            generationId: extra.generationId || "",
            sourceGenerationId: extra.generationId || "",
            targetType: "offline",
            targetId: session.id,
            createdAt: now
          });
        } else {
          (session.participantIds || []).forEach(function (memberId) {
            window.AppStorage.addCharacterMemory(memberId, {
              content: "线下事件：" + event.content,
              source: "offline",
              generationId: extra.generationId || "",
              sourceGenerationId: extra.generationId || "",
              targetType: "offline",
              targetId: session.id,
              createdAt: now
            });
          });
        }
        nextSession.history = baseHistory.concat(shown);
        nextSession.updatedAt = Date.now();
        if (window.AppApiJobs && window.AppApiJobs.saveOfflineSessionDebounced) {
          window.AppApiJobs.saveOfflineSessionDebounced(nextSession, 120);
        } else {
          window.AppStorage.saveOfflineSession(nextSession);
        }
        if (currentSessionId === session.id) {
          renderOfflineMessages();
        }
      }
    }).then(function () {
      var nextSession = window.AppStorage.getOfflineSession(session.id);
      if (nextSession) {
        nextSession.history = baseHistory.concat(shown);
        nextSession.updatedAt = Date.now();
        window.AppStorage.saveOfflineSession(nextSession);
      }
      return shown;
    });
  }

  function recordOfflineMoneyEvent(event, mode, chatId, character, meta) {
    var money = event && event.money && typeof event.money === "object" ? event.money : event;
    var extra = meta || {};
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
      generationId: extra.generationId || money.generationId || event.generationId || "",
      sourceGenerationId: extra.generationId || money.sourceGenerationId || event.sourceGenerationId || "",
      note: money.note || event.content || "线下模式金额事件",
      createdAt: Date.now()
    });
  }

  function writeInlineEventMemory(mode, chatId, participants, speechCharacter, content, createdAt, meta) {
    var extra = meta || {};

    if (speechCharacter) {
      window.AppStorage.addCharacterMemory(speechCharacter.id, {
        content: "线下模式中说：" + content,
        source: "offline",
        generationId: extra.generationId || "",
        sourceGenerationId: extra.generationId || "",
        targetType: mode === "group" ? "group" : "private",
        targetId: chatId,
        createdAt: createdAt
      });
      return;
    }

    (participants || []).forEach(function (character) {
      window.AppStorage.addCharacterMemory(character.id, {
        content: "线下剧情：" + content,
        source: "offline",
        generationId: extra.generationId || "",
        sourceGenerationId: extra.generationId || "",
        targetType: mode === "group" ? "group" : "private",
        targetId: chatId,
        createdAt: createdAt
      });
    });
  }

  function persistInlineOfflineExtras(mode, chatId, participantIds, result, meta) {
    var extra = meta || {};

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
          generationId: extra.generationId || "",
          sourceGenerationId: extra.generationId || "",
          relatedMessageIds: extra.relatedMessageIds || [],
          targetType: mode === "group" ? "group" : "private",
          targetId: chatId,
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
          generationId: extra.generationId || "",
          sourceGenerationId: extra.generationId || "",
          relatedMessageIds: extra.relatedMessageIds || [],
          targetType: mode === "group" ? "group" : "private",
          targetId: chatId,
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

  function registerOfflineApiJobHandlers() {
    if (!window.AppApiJobs || !window.AppApiJobs.registerHandler) {
      return;
    }

    window.AppApiJobs.registerHandler("offline", "offline", handleOfflineJob);
  }

  registerOfflineApiJobHandlers();

  window.OfflineManager = {
    openPrivateOffline: openPrivateOffline,
    openGroupOffline: openGroupOffline,
    enablePrivateInlineOffline: enablePrivateInlineOffline,
    enableGroupInlineOffline: enableGroupInlineOffline,
    disableInlineOffline: disableInlineOffline,
    isInlineOfflineActive: isInlineOfflineActive,
    requestInlineOfflineAdvance: requestInlineOfflineAdvance,
    regenerateInlineOfflineLastTurn: regenerateInlineOfflineLastTurn,
    getCurrentSession: getCurrentSession,
    openActiveOfflineThoughtsDrawer: openActiveOfflineThoughtsDrawer,
    updateOfflineThoughtButton: updateOfflineThoughtButton,
    handlePrivateInlineOfflineJob: handlePrivateInlineOfflineJob,
    handleGroupInlineOfflineJob: handleGroupInlineOfflineJob,
    goBack: goBack,
    renderOfflineMessages: renderOfflineMessages,
    sendOfflineUserInput: sendOfflineUserInput,
    advanceOffline: advanceOffline
  };
})(window, document);
