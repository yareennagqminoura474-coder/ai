(function (window) {
  "use strict";

  var STORAGE_KEYS = {
    characters: "myAiApp.characters",
    settings: "myAiApp.settings",
    groups: "myAiApp.groups",
    memory: "myAiApp.memory",
    chatMemories: "myAiApp.chatMemories",
    chatRounds: "myAiApp.chatRounds",
    bodyStates: "myAiApp.bodyStates",
    emojiPacks: "myAiApp.emojiPacks",
    worldBooks: "myAiApp.worldBooks",
    thoughts: "myAiApp.thoughts",
    diaries: "myAiApp.diaries",
    userProfile: "myAiApp.userProfile",
    userPersonas: "myAiApp.userPersonas",
    desktopState: "myAiApp.desktopState",
    wechatState: "myAiApp.wechatState",
    moments: "myAiApp.moments",
    inlineOffline: "myAiApp.inlineOffline",
    wallet: "myAiApp.wallet",
    shop: "myAiApp.shop",
    recentHidden: "myAiApp.recentHidden",
    theme: "myAiApp.theme",
    photos: "myAiApp.photos",
    notes: "myAiApp.notes",
    chatPrefix: "myAiApp.chat.",
    groupChatPrefix: "myAiApp.groupChat.",
    offlinePrefix: "myAiApp.offline."
  };

  function parseJson(value, fallback) {
    if (!value) {
      return fallback;
    }

    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn("localStorage 数据解析失败，已使用默认值。", error);
      return fallback;
    }
  }

  function createId(prefix) {
    return String(prefix || "id") + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  }

  function roundAmount(value) {
    var amount = Number(value);

    if (!Number.isFinite(amount)) {
      return 0;
    }

    return Math.round(amount * 100) / 100;
  }

  function normalizePositiveAmount(value) {
    return Math.max(0, roundAmount(value));
  }

  function getCharacters() {
    var characters = parseJson(localStorage.getItem(STORAGE_KEYS.characters), []);
    return Array.isArray(characters) ? characters : [];
  }

  function saveCharacters(characters) {
    localStorage.setItem(STORAGE_KEYS.characters, JSON.stringify(characters || []));
  }

  function addCharacter(character) {
    var characters = getCharacters();
    characters.unshift(character);
    saveCharacters(characters);
    return character;
  }

  function updateCharacter(characterId, nextCharacter) {
    var characters = getCharacters();
    var index = characters.findIndex(function (character) {
      return character.id === characterId;
    });

    if (index === -1) {
      return null;
    }

    characters[index] = Object.assign({}, characters[index], nextCharacter, {
      id: characterId,
      createdAt: characters[index].createdAt || nextCharacter.createdAt || Date.now()
    });
    saveCharacters(characters);
    return characters[index];
  }

  function deleteCharacter(characterId) {
    var characters = getCharacters().filter(function (character) {
      return character.id !== characterId;
    });

    saveCharacters(characters);
    deleteChatHistory(characterId);
    clearCharacterMemory(characterId);
    clearChatMemories("private", characterId);
    clearBodyState("private", characterId);
    resetChatRoundCounter("private", characterId);
    clearCharacterThoughts(characterId);
    removeCharacterFromGroups(characterId);
  }

  function removeCharacterFromGroups(characterId) {
    var groups = getGroups().map(function (group) {
      return Object.assign({}, group, {
        memberIds: (group.memberIds || []).filter(function (memberId) {
          return memberId !== characterId;
        })
      });
    });

    saveGroups(groups);
  }

  function getSettings() {
    var rawSettings = parseJson(localStorage.getItem(STORAGE_KEYS.settings), {});
    var settings = normalizeSettings(rawSettings);

    if (!rawSettings || typeof rawSettings !== "object" || !Array.isArray(rawSettings.apiProfiles)) {
      saveSettings(settings);
    }

    return settings;
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(normalizeSettings(settings || {})));
  }

  function getActiveApiProfile() {
    return normalizeSettings(parseJson(localStorage.getItem(STORAGE_KEYS.settings), {})).activeApiProfile;
  }

  function getChatHistory(characterId) {
    var messages = parseJson(localStorage.getItem(STORAGE_KEYS.chatPrefix + characterId), []);
    return Array.isArray(messages) ? messages : [];
  }

  function saveChatHistory(characterId, messages) {
    localStorage.setItem(STORAGE_KEYS.chatPrefix + characterId, JSON.stringify(messages || []));
  }

  function deleteChatHistory(characterId) {
    localStorage.removeItem(STORAGE_KEYS.chatPrefix + characterId);
  }

  function getGroups() {
    var groups = parseJson(localStorage.getItem(STORAGE_KEYS.groups), []);
    return Array.isArray(groups) ? groups : [];
  }

  function saveGroups(groups) {
    localStorage.setItem(STORAGE_KEYS.groups, JSON.stringify(groups || []));
  }

  function addGroup(group) {
    var groups = getGroups();
    groups.unshift(group);
    saveGroups(groups);
    return group;
  }

  function updateGroup(groupId, nextGroup) {
    var groups = getGroups();
    var index = groups.findIndex(function (group) {
      return group.id === groupId;
    });

    if (index === -1) {
      return null;
    }

    groups[index] = Object.assign({}, groups[index], nextGroup, {
      id: groupId,
      createdAt: groups[index].createdAt || nextGroup.createdAt || Date.now()
    });
    saveGroups(groups);
    return groups[index];
  }

  function deleteGroup(groupId) {
    saveGroups(getGroups().filter(function (group) {
      return group.id !== groupId;
    }));
    deleteGroupChatHistory(groupId);
    clearChatMemories("group", groupId);
    clearBodyState("group", groupId);
    resetChatRoundCounter("group", groupId);
    deleteOfflineSession("group-" + groupId);
  }

  function getGroupChatHistory(groupId) {
    var messages = parseJson(localStorage.getItem(STORAGE_KEYS.groupChatPrefix + groupId), []);
    return Array.isArray(messages) ? messages : [];
  }

  function saveGroupChatHistory(groupId, messages) {
    localStorage.setItem(STORAGE_KEYS.groupChatPrefix + groupId, JSON.stringify(messages || []));
  }

  function deleteGroupChatHistory(groupId) {
    localStorage.removeItem(STORAGE_KEYS.groupChatPrefix + groupId);
  }

  function getEmojiPacks() {
    var emojis = parseJson(localStorage.getItem(STORAGE_KEYS.emojiPacks), []);
    return Array.isArray(emojis) ? emojis : [];
  }

  function saveEmojiPacks(emojis) {
    localStorage.setItem(STORAGE_KEYS.emojiPacks, JSON.stringify(Array.isArray(emojis) ? emojis : []));
  }

  function addEmoji(emoji) {
    var emojis = getEmojiPacks();
    var source = emoji && typeof emoji === "object" ? emoji : {};
    var nextEmoji = {
      id: String(source.id || Date.now()),
      name: String(source.name || "表情"),
      type: source.type === "image" ? "image" : "text",
      src: String(source.src || ""),
      createdAt: Number(source.createdAt) || Date.now()
    };

    if (!nextEmoji.src) {
      return null;
    }

    emojis.unshift(nextEmoji);
    saveEmojiPacks(emojis.slice(0, 80));
    return nextEmoji;
  }

  function getMemoryStore() {
    var memory = parseJson(localStorage.getItem(STORAGE_KEYS.memory), {});
    return memory && typeof memory === "object" && !Array.isArray(memory) ? memory : {};
  }

  function saveMemoryStore(memory) {
    localStorage.setItem(STORAGE_KEYS.memory, JSON.stringify(memory || {}));
  }

  function getCharacterMemory(characterId) {
    var memory = getMemoryStore();
    var memories = memory[characterId];
    return Array.isArray(memories) ? memories : [];
  }

  function saveCharacterMemory(characterId, memories) {
    var memory = getMemoryStore();
    memory[characterId] = Array.isArray(memories) ? memories : [];
    saveMemoryStore(memory);
  }

  function addCharacterMemory(characterId, memoryItem) {
    var memories;

    if (!characterId || !memoryItem || !memoryItem.content) {
      return;
    }

    memories = getCharacterMemory(characterId);
    memories.push({
      content: String(memoryItem.content),
      source: memoryItem.source || "private",
      createdAt: Number(memoryItem.createdAt) || Date.now()
    });

    if (memories.length > 120) {
      memories = memories.slice(-120);
    }

    saveCharacterMemory(characterId, memories);
  }

  function getMemoriesForCharacters(characterIds) {
    var result = {};

    (characterIds || []).forEach(function (characterId) {
      result[characterId] = getCharacterMemory(characterId).slice(-20);
    });

    return result;
  }

  function clearCharacterMemory(characterId) {
    var memory = getMemoryStore();
    delete memory[characterId];
    saveMemoryStore(memory);
  }

  function getChatScopedKey(targetType, targetId) {
    return (targetType === "group" ? "group" : (targetType === "offline" ? "offline" : "private")) + ":" + String(targetId || "");
  }

  function getChatMemoryStore() {
    var memories = parseJson(localStorage.getItem(STORAGE_KEYS.chatMemories), {});
    return memories && typeof memories === "object" && !Array.isArray(memories) ? memories : {};
  }

  function saveChatMemoryStore(memories) {
    localStorage.setItem(STORAGE_KEYS.chatMemories, JSON.stringify(memories || {}));
  }

  function getChatMemories(targetType, targetId) {
    var store = getChatMemoryStore();
    var key = getChatScopedKey(targetType, targetId);
    var memories = store[key];
    return Array.isArray(memories) ? memories.map(normalizeChatMemoryItem).filter(function (item) {
      return item.content;
    }) : [];
  }

  function saveChatMemories(targetType, targetId, memories) {
    var store = getChatMemoryStore();
    store[getChatScopedKey(targetType, targetId)] = Array.isArray(memories)
      ? memories.map(normalizeChatMemoryItem).filter(function (item) { return item.content; })
      : [];
    saveChatMemoryStore(store);
  }

  function addChatMemory(targetType, targetId, memoryItem) {
    var memories;
    var item;

    if (!targetId || !memoryItem || !memoryItem.content) {
      return null;
    }

    memories = getChatMemories(targetType, targetId);
    item = normalizeChatMemoryItem(memoryItem);
    item.id = item.id || createId("chat_memory");
    item.createdAt = item.createdAt || Date.now();
    item.updatedAt = Date.now();
    memories.unshift(item);
    saveChatMemories(targetType, targetId, memories.slice(0, 200));
    return item;
  }

  function updateChatMemory(targetType, targetId, memoryId, nextMemory) {
    var memories = getChatMemories(targetType, targetId);
    var index = memories.findIndex(function (memory) {
      return memory.id === memoryId;
    });

    if (index === -1) {
      return null;
    }

    memories[index] = normalizeChatMemoryItem(Object.assign({}, memories[index], nextMemory || {}, {
      id: memoryId,
      updatedAt: Date.now()
    }));
    saveChatMemories(targetType, targetId, memories);
    return memories[index];
  }

  function deleteChatMemory(targetType, targetId, memoryId) {
    saveChatMemories(targetType, targetId, getChatMemories(targetType, targetId).filter(function (memory) {
      return memory.id !== memoryId;
    }));
  }

  function clearChatMemories(targetType, targetId) {
    var store = getChatMemoryStore();
    delete store[getChatScopedKey(targetType, targetId)];
    saveChatMemoryStore(store);
  }

  function clearAllChatMemoriesByType(targetType) {
    var store = getChatMemoryStore();
    var prefix = (targetType === "group" ? "group" : "private") + ":";

    Object.keys(store).forEach(function (key) {
      if (key.indexOf(prefix) === 0) {
        delete store[key];
      }
    });

    saveChatMemoryStore(store);
  }

  function normalizeChatMemoryItem(memory, index) {
    var source = memory && typeof memory === "object" ? memory : {};
    var now = Date.now();
    var type = source.type === "auto" || source.type === "自动总结" ? "auto" : "manual";
    var title = String(source.title || "").trim();
    var content = String(source.content || source.body || "").trim();

    if (!title && content) {
      title = content.slice(0, 18) + (content.length > 18 ? "..." : "");
    }

    return {
      id: String(source.id || (index !== undefined ? "chat_memory_" + now + "_" + index : "")),
      title: title || (type === "auto" ? "自动总结" : "手动记忆"),
      content: content,
      sourceTime: Number(source.sourceTime) || Number(source.createdAt) || now,
      type: type,
      source: source.source === "group" || source.source === "offline" ? source.source : "private",
      createdAt: Number(source.createdAt) || now,
      updatedAt: Number(source.updatedAt) || Number(source.createdAt) || now
    };
  }

  function getChatRoundStore() {
    var rounds = parseJson(localStorage.getItem(STORAGE_KEYS.chatRounds), {});
    return rounds && typeof rounds === "object" && !Array.isArray(rounds) ? rounds : {};
  }

  function saveChatRoundStore(rounds) {
    localStorage.setItem(STORAGE_KEYS.chatRounds, JSON.stringify(rounds || {}));
  }

  function getChatRoundCounter(targetType, targetId) {
    var value = Number(getChatRoundStore()[getChatScopedKey(targetType, targetId)]);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  function setChatRoundCounter(targetType, targetId, count) {
    var rounds = getChatRoundStore();
    rounds[getChatScopedKey(targetType, targetId)] = Math.max(0, Math.floor(Number(count) || 0));
    saveChatRoundStore(rounds);
  }

  function resetChatRoundCounter(targetType, targetId) {
    setChatRoundCounter(targetType, targetId, 0);
  }

  function getBodyStateStore() {
    var states = parseJson(localStorage.getItem(STORAGE_KEYS.bodyStates), {});
    return states && typeof states === "object" && !Array.isArray(states) ? states : {};
  }

  function saveBodyStateStore(states) {
    localStorage.setItem(STORAGE_KEYS.bodyStates, JSON.stringify(states || {}));
  }

  function getDefaultBodyState() {
    return normalizeBodyState({});
  }

  function getBodyState(targetType, targetId) {
    var store = getBodyStateStore();
    return normalizeBodyState(store[getChatScopedKey(targetType, targetId)] || {});
  }

  function saveBodyState(targetType, targetId, bodyState) {
    var store = getBodyStateStore();
    store[getChatScopedKey(targetType, targetId)] = normalizeBodyState(bodyState || {});
    saveBodyStateStore(store);
    return store[getChatScopedKey(targetType, targetId)];
  }

  function clearBodyState(targetType, targetId) {
    var store = getBodyStateStore();
    delete store[getChatScopedKey(targetType, targetId)];
    saveBodyStateStore(store);
  }

  function clearAllBodyStates() {
    saveBodyStateStore({});
  }

  function normalizeBodyState(bodyState) {
    var source = bodyState && typeof bodyState === "object" ? bodyState : {};
    var parts = source.parts && typeof source.parts === "object" && !Array.isArray(source.parts) ? source.parts : {};
    var normalizedParts = {};
    var defaultParts = ["手心", "臀部", "大腿", "臀腿连接处", "腰背", "肩颈", "膝腿", "其他受影响区域"];

    defaultParts.forEach(function (partName) {
      normalizedParts[partName] = normalizeBodyPartState(parts[partName] || {});
    });

    Object.keys(parts).forEach(function (partName) {
      normalizedParts[partName] = normalizeBodyPartState(parts[partName]);
    });

    return {
      overallCondition: String(source.overallCondition || "正常"),
      currentNote: String(source.currentNote || source.note || "当前无明显异常"),
      energy: Math.max(0, Math.min(100, Number(source.energy) || 80)),
      moodInfluence: String(source.moodInfluence || "影响轻微"),
      sorenessLevel: Math.max(0, Math.min(100, Number(source.sorenessLevel) || 0)),
      painLevel: Math.max(0, Math.min(100, Number(source.painLevel) || 0)),
      rednessLevel: Math.max(0, Math.min(100, Number(source.rednessLevel) || 0)),
      bruiseRisk: String(source.bruiseRisk || "低"),
      sittingComfort: String(source.sittingComfort || "正常"),
      walkingComfort: String(source.walkingComfort || "正常"),
      handUseComfort: String(source.handUseComfort || "正常"),
      touchSensitivity: String(source.touchSensitivity || "正常"),
      bodyTemperature: String(source.bodyTemperature || "正常"),
      feverRisk: String(source.feverRisk || "低"),
      skinBreakage: String(source.skinBreakage || "无"),
      restNeeded: normalizeBoolean(source.restNeeded),
      recoverySuggestion: String(source.recoverySuggestion || "保持休息、补水，若出现持续疼痛或发热请及时停止剧情并处理。"),
      parts: normalizedParts,
      updatedAt: Number(source.updatedAt) || Date.now()
    };
  }

  function normalizeBodyPartState(part) {
    var source = part && typeof part === "object" ? part : {};
    return {
      status: String(source.status || "正常"),
      soreness: Math.max(0, Math.min(100, Number(source.soreness) || 0)),
      pain: Math.max(0, Math.min(100, Number(source.pain) || 0)),
      redness: Math.max(0, Math.min(100, Number(source.redness) || 0)),
      notes: String(source.notes || "")
    };
  }

  function normalizeBoolean(value) {
    if (value === true || value === "true" || value === "是" || value === "需要") {
      return true;
    }
    if (value === false || value === "false" || value === "否" || value === "不需要") {
      return false;
    }
    return Boolean(value);
  }

  function getOfflineSession(sessionId) {
    return parseJson(localStorage.getItem(STORAGE_KEYS.offlinePrefix + sessionId), null);
  }

  function saveOfflineSession(session) {
    if (!session || !session.id) {
      return;
    }

    localStorage.setItem(STORAGE_KEYS.offlinePrefix + session.id, JSON.stringify(session));
  }

  function deleteOfflineSession(sessionId) {
    localStorage.removeItem(STORAGE_KEYS.offlinePrefix + sessionId);
  }

  function getAllChatHistories() {
    return getAllPrefixedItems(STORAGE_KEYS.chatPrefix);
  }

  function getAllGroupChatHistories() {
    return getAllPrefixedItems(STORAGE_KEYS.groupChatPrefix);
  }

  function getAllOfflineSessions() {
    return getAllPrefixedItems(STORAGE_KEYS.offlinePrefix);
  }

  function getWorldBooks() {
    var books = parseJson(localStorage.getItem(STORAGE_KEYS.worldBooks), []);
    return normalizeWorldBooks(Array.isArray(books) ? books : []);
  }

  function saveWorldBooks(worldBooks) {
    localStorage.setItem(STORAGE_KEYS.worldBooks, JSON.stringify(Array.isArray(worldBooks) ? worldBooks : []));
  }

  function addWorldBook(book) {
    var books = getWorldBooks();
    var now = Date.now();
    var nextBook = normalizeWorldBook(Object.assign({
      id: String(now),
      name: "",
      description: "",
      entries: [],
      enabled: true,
      scope: "global",
      targetIds: [],
      createdAt: now,
      updatedAt: now
    }, book || {}), 0);

    books.unshift(nextBook);
    saveWorldBooks(books);
    return nextBook;
  }

  function updateWorldBook(bookId, nextBook) {
    var books = getWorldBooks();
    var index = books.findIndex(function (book) {
      return book.id === bookId;
    });

    if (index === -1) {
      return null;
    }

    books[index] = normalizeWorldBook(Object.assign({}, books[index], nextBook || {}, {
      id: bookId,
      createdAt: books[index].createdAt || Date.now(),
      updatedAt: Date.now()
    }), index);
    saveWorldBooks(books);
    return books[index];
  }

  function deleteWorldBook(bookId) {
    saveWorldBooks(getWorldBooks().filter(function (book) {
      return book.id !== bookId;
    }));
  }

  function getMatchedWorldBookEntries(contextText, scope, targetId) {
    var rawText = String(contextText || "");
    var text = rawText.toLowerCase();
    var target = String(targetId || "");
    var matched = [];
    var contextTokens = extractWorldBookTokens(rawText);

    getWorldBooks().forEach(function (book) {
      if (!book.enabled || !isWorldBookInScope(book, scope, target)) {
        return;
      }

      (book.entries || []).forEach(function (entry) {
        var keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
        var keywordScore = keywords.reduce(function (score, keyword) {
          var value = String(keyword || "").trim().toLowerCase();

          if (!value) {
            return score;
          }

          if (text.indexOf(value) !== -1) {
            return score + 8 + Math.min(6, value.length);
          }

          if (contextTokens.indexOf(value) !== -1) {
            return score + 4;
          }

          return score;
        }, 0);
        var titleScore = entry.title && text.indexOf(String(entry.title).toLowerCase()) !== -1 ? 5 : 0;
        var contentScore = contextTokens.reduce(function (score, token) {
          if (!token || token.length < 2) {
            return score;
          }
          return String(entry.content || "").toLowerCase().indexOf(token) !== -1 ? score + 1 : score;
        }, 0);
        var score = keywordScore + titleScore + Math.min(contentScore, 6) + (Number(entry.priority) || 0);

        if (entry.enabled && score > 0) {
          matched.push(Object.assign({}, entry, {
            bookName: book.name,
            bookDescription: book.description,
            bookScope: book.scope,
            matchScore: score
          }));
        }
      });
    });

    return matched.sort(function (a, b) {
      var scoreGap = (Number(b.matchScore) || 0) - (Number(a.matchScore) || 0);

      if (scoreGap) {
        return scoreGap;
      }

      return (Number(b.priority) || 0) - (Number(a.priority) || 0);
    }).slice(0, 10);
  }

  function extractWorldBookTokens(text) {
    var value = String(text || "").toLowerCase();
    var tokens = value.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9_]{2,}/g) || [];
    var seen = {};

    return tokens.filter(function (token) {
      if (seen[token]) {
        return false;
      }
      seen[token] = true;
      return true;
    }).slice(0, 80);
  }

  function isWorldBookInScope(book, scope, targetId) {
    if (book.scope === "global") {
      return true;
    }

    if (book.scope !== scope) {
      return false;
    }

    return !book.targetIds.length || book.targetIds.indexOf(targetId) !== -1;
  }

  function getThoughtStore() {
    var thoughts = parseJson(localStorage.getItem(STORAGE_KEYS.thoughts), {});
    return thoughts && typeof thoughts === "object" && !Array.isArray(thoughts) ? thoughts : {};
  }

  function saveThoughtStore(thoughts) {
    localStorage.setItem(STORAGE_KEYS.thoughts, JSON.stringify(thoughts || {}));
  }

  function getCharacterThoughts(characterId) {
    var thoughts = getThoughtStore()[characterId];
    return Array.isArray(thoughts) ? thoughts : [];
  }

  function saveCharacterThoughts(characterId, thoughts) {
    var store = getThoughtStore();
    store[characterId] = Array.isArray(thoughts) ? thoughts : [];
    saveThoughtStore(store);
  }

  function addCharacterThought(characterId, thought) {
    var thoughts;
    var source = thought && typeof thought === "object" ? thought : {};

    if (!characterId || !source.content) {
      return null;
    }

    thoughts = getCharacterThoughts(characterId);
    thoughts.unshift({
      id: String(source.id || Date.now() + Math.random()),
      source: source.source || "private",
      chatId: String(source.chatId || characterId),
      content: String(source.content || ""),
      mood: String(source.mood || ""),
      visibleSummary: String(source.visibleSummary || source.summary || ""),
      relatedMessageIds: Array.isArray(source.relatedMessageIds) ? source.relatedMessageIds.map(String) : [],
      readAt: source.readAt !== undefined ? Number(source.readAt) || 0 : 0,
      unread: source.unread === false ? false : true,
      createdAt: Number(source.createdAt) || Date.now()
    });
    saveCharacterThoughts(characterId, thoughts.slice(0, 300));
    return thoughts[0];
  }

  function getRecentThoughts(characterId, limit) {
    return getCharacterThoughts(characterId).slice(0, Number(limit) || 20);
  }

  function clearCharacterThoughts(characterId) {
    var store = getThoughtStore();
    delete store[characterId];
    saveThoughtStore(store);
  }

  function deleteCharacterThought(characterId, thoughtId) {
    saveCharacterThoughts(characterId, getCharacterThoughts(characterId).filter(function (thought) {
      return thought.id !== thoughtId;
    }));
  }

  function isThoughtUnread(thought) {
    if (!thought) {
      return false;
    }

    if (thought.unread === true) {
      return true;
    }

    if (thought.unread === false) {
      return false;
    }

    if (Object.prototype.hasOwnProperty.call(thought, "readAt")) {
      return !Number(thought.readAt);
    }

    return false;
  }

  function getUnreadThoughtCount(characterIds, chatId) {
    var ids = Array.isArray(characterIds) ? characterIds : [characterIds];
    var targetChatId = String(chatId || "");
    var count = 0;

    ids.filter(Boolean).forEach(function (characterId) {
      getCharacterThoughts(characterId).forEach(function (thought) {
        if (targetChatId && String(thought.chatId || "") !== targetChatId) {
          return;
        }

        if (isThoughtUnread(thought)) {
          count += 1;
        }
      });
    });

    return count;
  }

  function markThoughtsRead(characterIds, chatId) {
    var ids = Array.isArray(characterIds) ? characterIds : [characterIds];
    var targetChatId = String(chatId || "");
    var now = Date.now();

    ids.filter(Boolean).forEach(function (characterId) {
      var changed = false;
      var thoughts = getCharacterThoughts(characterId).map(function (thought) {
        if (targetChatId && String(thought.chatId || "") !== targetChatId) {
          return thought;
        }

        if (!isThoughtUnread(thought)) {
          return thought;
        }

        changed = true;
        return Object.assign({}, thought, {
          readAt: now,
          unread: false
        });
      });

      if (changed) {
        saveCharacterThoughts(characterId, thoughts);
      }
    });
  }

  function getDiaries() {
    var diaries = parseJson(localStorage.getItem(STORAGE_KEYS.diaries), []);
    return Array.isArray(diaries) ? diaries : [];
  }

  function saveDiaries(diaries) {
    localStorage.setItem(STORAGE_KEYS.diaries, JSON.stringify(Array.isArray(diaries) ? diaries : []));
  }

  function addDiary(diary) {
    var diaries = getDiaries();
    var now = Date.now();
    var nextDiary = normalizeDiary(Object.assign({
      id: String(now),
      createdAt: now,
      updatedAt: now
    }, diary || {}), 0);

    diaries.unshift(nextDiary);
    saveDiaries(diaries);
    return nextDiary;
  }

  function updateDiary(diaryId, diary) {
    var diaries = getDiaries();
    var index = diaries.findIndex(function (item) {
      return item.id === diaryId;
    });

    if (index === -1) {
      return null;
    }

    diaries[index] = normalizeDiary(Object.assign({}, diaries[index], diary || {}, {
      id: diaryId,
      updatedAt: Date.now()
    }), index);
    saveDiaries(diaries);
    return diaries[index];
  }

  function deleteDiary(diaryId) {
    saveDiaries(getDiaries().filter(function (diary) {
      return diary.id !== diaryId;
    }));
  }

  function getDiariesByCharacter(characterId) {
    return getDiaries().filter(function (diary) {
      return diary.characterId === characterId;
    });
  }

  function getTodayDiary(characterId) {
    var today = getLocalDateString();
    return getDiaries().find(function (diary) {
      return diary.characterId === characterId && diary.date === today;
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

  function getUserProfile() {
    var rawProfile = parseJson(localStorage.getItem(STORAGE_KEYS.userProfile), {});
    var profile = normalizeUserProfile(rawProfile);

    if (!rawProfile || typeof rawProfile !== "object" || !rawProfile.wxid || !rawProfile.name) {
      saveUserProfile(profile);
    }

    return profile;
  }

  function saveUserProfile(profile) {
    localStorage.setItem(STORAGE_KEYS.userProfile, JSON.stringify(normalizeUserProfile(profile || {})));
  }

  function getUserPersonas() {
    return normalizeUserPersonas(parseJson(localStorage.getItem(STORAGE_KEYS.userPersonas), []));
  }

  function saveUserPersonas(personas) {
    localStorage.setItem(STORAGE_KEYS.userPersonas, JSON.stringify(normalizeUserPersonas(personas || [])));
  }

  function addUserPersona(persona) {
    var personas = getUserPersonas();
    var next = normalizeUserPersona(Object.assign({
      id: createId("persona"),
      createdAt: Date.now(),
      updatedAt: Date.now()
    }, persona || {}), personas.length);

    personas.unshift(next);
    saveUserPersonas(personas);
    return next;
  }

  function updateUserPersona(personaId, nextPersona) {
    var personas = getUserPersonas();
    var index = personas.findIndex(function (persona) {
      return persona.id === personaId;
    });

    if (index === -1) {
      return null;
    }

    personas[index] = normalizeUserPersona(Object.assign({}, personas[index], nextPersona || {}, {
      id: personaId,
      createdAt: personas[index].createdAt || Date.now(),
      updatedAt: Date.now()
    }), index);
    saveUserPersonas(personas);
    return personas[index];
  }

  function deleteUserPersona(personaId) {
    saveUserPersonas(getUserPersonas().filter(function (persona) {
      return persona.id !== personaId;
    }));
  }

  function getUserPersonaById(personaId) {
    return getUserPersonas().find(function (persona) {
      return persona.id === personaId;
    }) || null;
  }

  function resolveUserPersona(personaId, override) {
    var profile = getUserProfile();
    var persona = personaId ? getUserPersonaById(personaId) : null;
    var legacy = override && typeof override === "object" ? override : {};
    var source = persona || {};

    return normalizeUserPersona({
      id: source.id || "",
      name: source.name || legacy.name || profile.name || "我",
      avatar: source.avatar || legacy.avatar || profile.avatar || "",
      gender: source.gender || legacy.gender || "",
      age: source.age || legacy.age || "",
      identity: source.identity || legacy.identity || "",
      personality: source.personality || legacy.personality || "",
      speakingStyle: source.speakingStyle || legacy.speakingStyle || "",
      extra: source.extra || legacy.extra || legacy.persona || profile.persona || "",
      createdAt: source.createdAt || Date.now(),
      updatedAt: source.updatedAt || Date.now()
    }, 0);
  }

  function getDesktopState() {
    return normalizeDesktopState(parseJson(localStorage.getItem(STORAGE_KEYS.desktopState), {}));
  }

  function saveDesktopState(state) {
    localStorage.setItem(STORAGE_KEYS.desktopState, JSON.stringify(normalizeDesktopState(state || {})));
  }

  function updateDesktopState(nextState) {
    var state = Object.assign({}, getDesktopState(), nextState || {});
    saveDesktopState(state);
    return getDesktopState();
  }

  function getWechatState() {
    return normalizeWechatState(parseJson(localStorage.getItem(STORAGE_KEYS.wechatState), {}));
  }

  function saveWechatState(state) {
    localStorage.setItem(STORAGE_KEYS.wechatState, JSON.stringify(normalizeWechatState(state || {})));
  }

  function updateWechatState(nextState) {
    var state = Object.assign({}, getWechatState(), nextState || {});
    saveWechatState(state);
    return getWechatState();
  }

  function getMoments() {
    return normalizeMoments(parseJson(localStorage.getItem(STORAGE_KEYS.moments), []));
  }

  function saveMoments(moments) {
    localStorage.setItem(STORAGE_KEYS.moments, JSON.stringify(normalizeMoments(moments || [])));
  }

  function addMoment(moment) {
    var moments = getMoments();
    var profile = getUserProfile();
    var next = normalizeMoment(Object.assign({
      id: createId("moment"),
      authorType: "user",
      authorName: profile.name,
      authorAvatar: profile.avatar,
      createdAt: Date.now()
    }, moment || {}), 0);

    moments.unshift(next);
    saveMoments(moments.slice(0, 200));
    return next;
  }

  function updateMoment(momentId, nextMoment) {
    var moments = getMoments();
    var index = moments.findIndex(function (moment) {
      return moment.id === momentId;
    });

    if (index === -1) {
      return null;
    }

    moments[index] = normalizeMoment(Object.assign({}, moments[index], nextMoment || {}, {
      id: momentId
    }), index);
    saveMoments(moments);
    return moments[index];
  }

  function deleteMoment(momentId) {
    saveMoments(getMoments().filter(function (moment) {
      return moment.id !== momentId;
    }));
  }

  function addMomentComment(momentId, comment) {
    var moments = getMoments();
    var index = moments.findIndex(function (moment) {
      return moment.id === momentId;
    });
    var source = comment && typeof comment === "object" ? comment : { content: comment };
    var nextComment;

    if (index === -1 || !String(source.content || "").trim()) {
      return null;
    }

    nextComment = normalizeMomentComment(Object.assign({
      id: createId("momentComment"),
      authorType: "user",
      createdAt: Date.now()
    }, source), moments[index].comments.length);
    moments[index].comments.push(nextComment);
    saveMoments(moments);
    return nextComment;
  }

  function getInlineOfflineStates() {
    var states = parseJson(localStorage.getItem(STORAGE_KEYS.inlineOffline), {});
    return states && typeof states === "object" && !Array.isArray(states) ? states : {};
  }

  function saveInlineOfflineStates(states) {
    localStorage.setItem(STORAGE_KEYS.inlineOffline, JSON.stringify(states || {}));
  }

  function getInlineOfflineKey(targetType, targetId) {
    return String(targetType || "") + ":" + String(targetId || "");
  }

  function getInlineOfflineState(targetType, targetId) {
    var state = getInlineOfflineStates()[getInlineOfflineKey(targetType, targetId)];
    if (!state || state.enabled === false) {
      return null;
    }
    return {
      targetType: String(state.targetType || targetType || ""),
      targetId: String(state.targetId || targetId || ""),
      scene: normalizeOfflineScene(state.scene || {}),
      enabled: true,
      updatedAt: Number(state.updatedAt) || Date.now()
    };
  }

  function setInlineOfflineState(targetType, targetId, scene) {
    var states = getInlineOfflineStates();
    var key = getInlineOfflineKey(targetType, targetId);

    states[key] = {
      targetType: String(targetType || ""),
      targetId: String(targetId || ""),
      scene: normalizeOfflineScene(scene || {}),
      enabled: true,
      updatedAt: Date.now()
    };
    saveInlineOfflineStates(states);
    return states[key];
  }

  function clearInlineOfflineState(targetType, targetId) {
    var states = getInlineOfflineStates();
    delete states[getInlineOfflineKey(targetType, targetId)];
    saveInlineOfflineStates(states);
  }

  function getRecentHidden() {
    var hidden = parseJson(localStorage.getItem(STORAGE_KEYS.recentHidden), {});
    return hidden && typeof hidden === "object" && !Array.isArray(hidden) ? hidden : {};
  }

  function saveRecentHidden(hidden) {
    localStorage.setItem(STORAGE_KEYS.recentHidden, JSON.stringify(hidden || {}));
  }

  function hideRecentChat(type, id, lastMessageTime) {
    var hidden = getRecentHidden();
    hidden[String(type || "") + ":" + String(id || "")] = Number(lastMessageTime) || Date.now();
    saveRecentHidden(hidden);
  }

  function getRecentHiddenAt(type, id) {
    return Number(getRecentHidden()[String(type || "") + ":" + String(id || "")]) || 0;
  }

  function getTheme() {
    var theme = parseJson(localStorage.getItem(STORAGE_KEYS.theme), {});
    return normalizeTheme(theme || {});
  }

  function saveTheme(theme) {
    localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(normalizeTheme(theme || {})));
  }

  function getPhotos() {
    var photos = parseJson(localStorage.getItem(STORAGE_KEYS.photos), []);
    return normalizePhotos(photos);
  }

  function savePhotos(photos) {
    localStorage.setItem(STORAGE_KEYS.photos, JSON.stringify(normalizePhotos(photos)));
  }

  function addPhoto(photo) {
    var photos = getPhotos();
    var next = normalizePhoto(photo || {}, 0);
    if (!next.src) {
      return null;
    }
    photos.unshift(next);
    savePhotos(photos.slice(0, 120));
    return next;
  }

  function deletePhoto(photoId) {
    savePhotos(getPhotos().filter(function (photo) {
      return photo.id !== photoId;
    }));
  }

  function getNotes() {
    var notes = parseJson(localStorage.getItem(STORAGE_KEYS.notes), []);
    return normalizeNotes(notes);
  }

  function saveNotes(notes) {
    localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(normalizeNotes(notes)));
  }

  function addNote(note) {
    var notes = getNotes();
    var next = normalizeNote(note || {}, 0);
    notes.unshift(next);
    saveNotes(notes);
    return next;
  }

  function updateNote(noteId, note) {
    var notes = getNotes();
    var index = notes.findIndex(function (item) {
      return item.id === noteId;
    });

    if (index === -1) {
      return null;
    }

    notes[index] = normalizeNote(Object.assign({}, notes[index], note || {}, {
      id: noteId,
      updatedAt: Date.now()
    }), index);
    saveNotes(notes);
    return notes[index];
  }

  function deleteNote(noteId) {
    saveNotes(getNotes().filter(function (note) {
      return note.id !== noteId;
    }));
  }

  function getShop() {
    return normalizeShop(parseJson(localStorage.getItem(STORAGE_KEYS.shop), {}));
  }

  function saveShop(shop) {
    localStorage.setItem(STORAGE_KEYS.shop, JSON.stringify(normalizeShop(shop || {})));
  }

  function getDefaultShopProducts() {
    return createDefaultShopData();
  }

  function getWallet() {
    return normalizeWallet(parseJson(localStorage.getItem(STORAGE_KEYS.wallet), {}));
  }

  function saveWallet(wallet) {
    localStorage.setItem(STORAGE_KEYS.wallet, JSON.stringify(normalizeWallet(wallet || {})));
  }

  function addWalletLedger(record, options) {
    var wallet = getWallet();
    var normalized = normalizeLedgerRecord(record || {}, 0);
    var settings = options || {};

    if (!normalized.amount && normalized.type !== "system") {
      return null;
    }

    if (!settings.skipBalance) {
      if (normalized.direction === "income") {
        wallet.balance = roundAmount(wallet.balance + normalized.amount);
      } else if (normalized.direction === "expense") {
        if (settings.preventOverdraft && wallet.balance < normalized.amount) {
          return null;
        }
        wallet.balance = roundAmount(wallet.balance - normalized.amount);
      }
    }

    wallet.ledger.unshift(normalized);
    saveWallet(wallet);
    return normalized;
  }

  function rechargeWallet(amount, note) {
    return addWalletLedger({
      type: "recharge",
      amount: normalizePositiveAmount(amount),
      direction: "income",
      sourceType: "system",
      sourceId: "wallet",
      note: note || "钱包充值",
      createdAt: Date.now()
    });
  }

  function getFamilyCards() {
    return getWallet().familyCards;
  }

  function addFamilyCard(card) {
    var wallet = getWallet();
    var next = normalizeFamilyCard(Object.assign({
      id: createId("familycard"),
      name: "亲属卡",
      createdAt: Date.now()
    }, card || {}), wallet.familyCards.length);

    wallet.familyCards.unshift(next);
    saveWallet(wallet);
    return next;
  }

  function updateFamilyCard(cardId, nextCard) {
    var wallet = getWallet();
    var index = wallet.familyCards.findIndex(function (card) {
      return card.id === cardId;
    });

    if (index === -1) {
      return null;
    }

    wallet.familyCards[index] = normalizeFamilyCard(Object.assign({}, wallet.familyCards[index], nextCard || {}, {
      id: cardId,
      createdAt: wallet.familyCards[index].createdAt || Date.now()
    }), index);
    saveWallet(wallet);
    return wallet.familyCards[index];
  }

  function deleteFamilyCard(cardId) {
    var wallet = getWallet();
    wallet.familyCards = wallet.familyCards.filter(function (card) {
      return card.id !== cardId;
    });
    saveWallet(wallet);
  }

  function getFamilyCardsForCharacter(characterId) {
    return getFamilyCards().filter(function (card) {
      return card.targetCharacterId === characterId;
    });
  }

  function getFamilyCardById(cardId) {
    return getFamilyCards().find(function (card) {
      return card.id === cardId;
    }) || null;
  }

  function spendFamilyCard(cardId, amount, context) {
    var wallet = getWallet();
    var spendAmount = normalizePositiveAmount(amount);
    var cardIndex = wallet.familyCards.findIndex(function (card) {
      return card.id === cardId;
    });
    var card;
    var record;

    if (cardIndex === -1 || !spendAmount) {
      return null;
    }

    card = wallet.familyCards[cardIndex];
    if (!card.enabled || card.usedAmount + spendAmount > card.totalLimit) {
      return null;
    }

    card.usedAmount = roundAmount(card.usedAmount + spendAmount);
    wallet.familyCards[cardIndex] = card;
    record = normalizeLedgerRecord(Object.assign({
      type: "familycard_pay",
      amount: spendAmount,
      direction: "expense",
      sourceType: "private",
      sourceId: card.targetCharacterId,
      characterId: card.targetCharacterId,
      note: card.name + " 支付",
      familyCardId: card.id,
      createdAt: Date.now()
    }, context || {}), wallet.ledger.length);
    wallet.ledger.unshift(record);
    saveWallet(wallet);
    return record;
  }

  function recordMoneyMessage(message, context) {
    var source = message && typeof message === "object" ? message : null;
    var info = context || {};
    var record;
    var type;
    var direction;
    var amount;
    var sourceName = info.sourceName || "";

    if (!source || source.walletLedgerId || (source.type !== "redPacket" && source.type !== "transfer")) {
      return source;
    }

    amount = normalizePositiveAmount(source.amount);
    if (!amount) {
      return source;
    }

    if (source.role !== "user") {
      source.received = Boolean(source.received);
      source.walletRecorded = Boolean(source.walletRecorded || source.walletLedgerId);
      return source;
    }

    if (source.paymentMethod === "familyCard" && source.familyCardId) {
      record = spendFamilyCard(source.familyCardId, amount, {
        sourceType: info.sourceType || "private",
        sourceId: info.sourceId || "",
        characterId: info.characterId || source.characterId || "",
        groupId: info.groupId || "",
        note: source.note || "亲属卡支付给" + (sourceName || "角色")
      });
    } else {
      direction = source.role === "user" ? "expense" : "income";
      if (source.type === "redPacket") {
        type = direction === "expense" ? "redpacket_out" : "redpacket_in";
      } else {
        type = direction === "expense" ? "transfer_out" : "transfer_in";
      }

      record = addWalletLedger({
        type: type,
        amount: amount,
        direction: direction,
        sourceType: info.sourceType || "private",
        sourceId: info.sourceId || "",
        characterId: info.characterId || source.characterId || "",
        groupId: info.groupId || "",
        note: source.note || source.content || (source.type === "redPacket" ? "红包" : "转账"),
        createdAt: source.createdAt || Date.now()
      }, {
        preventOverdraft: direction === "expense"
      });
    }

    if (record) {
      source.walletLedgerId = record.id;
    }

    return source;
  }

  function receiveMoneyMessage(message, context) {
    var source = message && typeof message === "object" ? message : null;
    var info = context || {};
    var amount;
    var record;
    var type;

    if (!source || source.role === "user" || (source.type !== "redPacket" && source.type !== "transfer")) {
      return source;
    }

    if (source.received || source.walletRecorded || source.walletLedgerId) {
      source.received = true;
      source.walletRecorded = true;
      return source;
    }

    amount = normalizePositiveAmount(source.amount);
    if (!amount) {
      return source;
    }

    type = source.type === "redPacket" ? "redpacket_in" : "transfer_in";
    record = addWalletLedger({
      type: type,
      amount: amount,
      direction: "income",
      sourceType: info.sourceType || "private",
      sourceId: info.sourceId || "",
      characterId: info.characterId || source.characterId || "",
      groupId: info.groupId || "",
      note: source.note || source.content || (source.type === "redPacket" ? "红包" : "转账"),
      createdAt: Date.now()
    });

    if (record) {
      source.received = true;
      source.receivedAt = record.createdAt;
      source.walletRecorded = true;
      source.walletLedgerId = record.id;
      source.ledgerId = record.id;
      source.status = source.type === "redPacket" ? "received" : "accepted";
    }

    return source;
  }

  function getAllPrefixedItems(prefix) {
    var items = {};

    for (var index = 0; index < localStorage.length; index += 1) {
      var key = localStorage.key(index);
      if (key && key.indexOf(prefix) === 0) {
        items[key.slice(prefix.length)] = parseJson(localStorage.getItem(key), []);
      }
    }

    return items;
  }

  function exportAllData() {
    return {
      version: 3,
      exportedAt: Date.now(),
      characters: getCharacters(),
      settings: getSettings(),
      apiProfiles: getSettings().apiProfiles,
      activeApiProfileId: getSettings().activeApiProfileId,
      temperature: getSettings().temperature,
      chatHistory: getAllChatHistories(),
      groups: getGroups(),
      groupChatHistory: getAllGroupChatHistories(),
      offlineSessions: getAllOfflineSessions(),
      memory: getMemoryStore(),
      chatMemories: getChatMemoryStore(),
      chatRounds: getChatRoundStore(),
      bodyStates: getBodyStateStore(),
      emojiPacks: getEmojiPacks(),
      worldBooks: getWorldBooks(),
      thoughts: getThoughtStore(),
      diaries: getDiaries(),
      diarySettings: getCharacters().reduce(function (settings, character) {
        settings[character.id] = character.diarySettings || {};
        return settings;
      }, {}),
      momentSettings: getCharacters().reduce(function (settings, character) {
        settings[character.id] = character.momentSettings || {};
        return settings;
      }, {}),
      userProfile: getUserProfile(),
      userPersonas: getUserPersonas(),
      desktopState: getDesktopState(),
      wechatState: getWechatState(),
      moments: getMoments(),
      inlineOffline: getInlineOfflineStates(),
      wallet: getWallet(),
      shop: getShop(),
      themes: getTheme(),
      photos: getPhotos(),
      notes: getNotes(),
      recentHidden: getRecentHidden(),
      privateChatSettings: getCharacters().reduce(function (settings, character) {
        settings[character.id] = normalizePrivateChatSettings(character.chatSettings || {});
        return settings;
      }, {}),
      groupSettings: getGroups().reduce(function (settings, group) {
        settings[group.id] = normalizeGroupSettings(group.settings || {});
        return settings;
      }, {})
    };
  }

  function importAllData(data) {
    var normalized = normalizeBackupData(data);

    clearAllData();
    saveCharacters(normalized.characters);
    saveSettings(normalized.settings);
    saveGroups(normalized.groups);
    saveMemoryStore(normalized.memory);
    saveChatMemoryStore(normalized.chatMemories);
    saveChatRoundStore(normalized.chatRounds);
    saveBodyStateStore(normalized.bodyStates);
    saveEmojiPacks(normalized.emojiPacks);
    saveWorldBooks(normalized.worldBooks);
    saveThoughtStore(normalized.thoughts);
    saveDiaries(normalized.diaries);
    saveUserProfile(normalized.userProfile);
    saveUserPersonas(normalized.userPersonas);
    saveDesktopState(normalized.desktopState);
    saveWechatState(normalized.wechatState);
    saveMoments(normalized.moments);
    saveInlineOfflineStates(normalized.inlineOffline);
    saveWallet(normalized.wallet);
    saveShop(normalized.shop);
    saveTheme(normalized.themes);
    savePhotos(normalized.photos);
    saveNotes(normalized.notes);
    saveRecentHidden(normalized.recentHidden);

    Object.keys(normalized.chatHistory).forEach(function (characterId) {
      saveChatHistory(characterId, normalized.chatHistory[characterId]);
    });

    Object.keys(normalized.groupChatHistory).forEach(function (groupId) {
      saveGroupChatHistory(groupId, normalized.groupChatHistory[groupId]);
    });

    Object.keys(normalized.offlineSessions).forEach(function (sessionId) {
      saveOfflineSession(normalized.offlineSessions[sessionId]);
    });
  }

  function normalizeBackupData(data) {
    if (!data || typeof data !== "object") {
      throw new Error("导入文件不是有效的 JSON 对象。");
    }

    return {
      characters: Array.isArray(data.characters) ? data.characters.map(function (character, index) {
        var normalized = normalizeCharacter(character, index);
        if (data.diarySettings && data.diarySettings[normalized.id]) {
          normalized.diarySettings = normalizeCharacterDiarySettings(data.diarySettings[normalized.id]);
        }
        if (data.momentSettings && data.momentSettings[normalized.id]) {
          normalized.momentSettings = normalizeCharacterMomentSettings(data.momentSettings[normalized.id]);
        }
        return normalized;
      }) : [],
      settings: normalizeSettings(Object.assign({}, data.settings || {}, {
        apiProfiles: data.apiProfiles || data.settings && data.settings.apiProfiles,
        activeApiProfileId: data.activeApiProfileId || data.settings && data.settings.activeApiProfileId,
        temperature: data.temperature !== undefined ? data.temperature : data.settings && data.settings.temperature
      })),
      chatHistory: normalizeMessageMap(data.chatHistory || data.privateChatHistories || data.privateChatHistory || {}),
      groups: Array.isArray(data.groups) ? data.groups.map(normalizeGroup) : [],
      groupChatHistory: normalizeMessageMap(data.groupChatHistory || data.groupChatHistories || {}),
      offlineSessions: normalizeOfflineSessions(data.offlineSessions || data.offline || {}),
      memory: normalizeMemory(data.memory || {}),
      chatMemories: normalizeChatMemories(data.chatMemories || data.chatMemory || {}),
      chatRounds: normalizeChatRounds(data.chatRounds || data.roundCounters || {}),
      bodyStates: normalizeBodyStates(data.bodyStates || data.bodyState || {}),
      emojiPacks: normalizeEmojiPacks(data.emojiPacks || []),
      worldBooks: normalizeWorldBooks(data.worldBooks || []),
      thoughts: normalizeThoughts(data.thoughts || {}),
      diaries: normalizeDiaries(data.diaries || []),
      userProfile: normalizeUserProfile(data.userProfile || {}),
      userPersonas: normalizeUserPersonas(Array.isArray(data.userPersonas) ? data.userPersonas : []),
      desktopState: normalizeDesktopState(data.desktopState || data.desktop || {}),
      wechatState: normalizeWechatState(data.wechatState || data.wechat || {}),
      moments: normalizeMoments(data.moments || data.momentPosts || []),
      inlineOffline: normalizeInlineOfflineStates(data.inlineOffline || data.inlineOfflineStates || {}),
      wallet: normalizeWallet(data.wallet || {}),
      shop: normalizeShop(data.shop || {}),
      themes: normalizeTheme(data.themes || data.theme || {}),
      photos: normalizePhotos(data.photos || []),
      notes: normalizeNotes(data.notes || []),
      recentHidden: normalizeRecentHidden(data.recentHidden || {})
    };
  }

  function normalizeSettings(settings) {
    var source = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
    var profiles = Array.isArray(source.apiProfiles) ? source.apiProfiles.map(normalizeApiProfile).filter(function (profile) {
      return profile.id;
    }) : [];
    var legacyTemperature = clampTemperature(source.temperature);
    var activeId = String(source.activeApiProfileId || "");
    var activeProfile;

    if (!profiles.length) {
      profiles.push(normalizeApiProfile({
        id: activeId || "default",
        name: "默认预设",
        apiUrl: source.apiUrl || "",
        apiKey: source.apiKey || "",
        modelName: source.modelName || "",
        temperature: legacyTemperature,
        createdAt: source.createdAt || Date.now(),
        updatedAt: source.updatedAt || Date.now()
      }));
    }

    activeProfile = profiles.find(function (profile) {
      return profile.id === activeId;
    }) || profiles[0];
    activeId = activeProfile.id;

    return {
      activeApiProfileId: activeId,
      apiProfiles: profiles,
      apiUrl: activeProfile.apiUrl || "",
      apiKey: activeProfile.apiKey || "",
      modelName: activeProfile.modelName || "",
      temperature: clampTemperature(activeProfile.temperature),
      autoMemorySummaryEnabled: source.autoMemorySummaryEnabled !== false,
      autoMemorySummaryRounds: Math.max(5, Math.min(50, Number(source.autoMemorySummaryRounds) || 10)),
      bodyStateEnabled: source.bodyStateEnabled !== false,
      showThoughtUnreadBadge: source.showThoughtUnreadBadge !== false,
      activeApiProfile: Object.assign({}, activeProfile, {
        temperature: clampTemperature(activeProfile.temperature)
      })
    };
  }

  function normalizeApiProfile(profile, index) {
    var source = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
    var now = Date.now();

    return {
      id: String(source.id || createId("api") + "_" + (index || 0)),
      name: String(source.name || "API 预设"),
      apiUrl: String(source.apiUrl || ""),
      apiKey: String(source.apiKey || ""),
      modelName: String(source.modelName || ""),
      temperature: clampTemperature(source.temperature),
      createdAt: Number(source.createdAt) || now,
      updatedAt: Number(source.updatedAt) || now
    };
  }

  function clampTemperature(value) {
    var temperature = Number(value);

    if (!Number.isFinite(temperature)) {
      temperature = 0.8;
    }

    return Math.max(0, Math.min(2, Math.round(temperature * 100) / 100));
  }

  function normalizeCharacter(character, index) {
    var source = character && typeof character === "object" ? character : {};
    var id = source.id ? String(source.id) : String(Date.now() + index);

    return {
      id: id,
      name: String(source.name || ""),
      avatar: String(source.avatar || ""),
      gender: String(source.gender || ""),
      identity: String(source.identity || ""),
      personality: String(source.personality || ""),
      background: String(source.background || ""),
      speakingStyle: String(source.speakingStyle || ""),
      relationship: String(source.relationship || ""),
      openingMessage: String(source.openingMessage || ""),
      chatSettings: normalizePrivateChatSettings(source.chatSettings || {}),
      momentSettings: normalizeCharacterMomentSettings(source.momentSettings || {}),
      diarySettings: normalizeCharacterDiarySettings(source.diarySettings || {}),
      createdAt: Number(source.createdAt) || Date.now()
    };
  }

  function normalizeCharacterMomentSettings(settings) {
    var source = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
    var frequency = ["low", "normal", "high"].indexOf(source.frequency) === -1 ? "normal" : source.frequency;

    return {
      autoPostEnabled: source.autoPostEnabled !== false,
      frequency: frequency,
      allowRelatedCharacterComments: source.allowRelatedCharacterComments !== false,
      lastGeneratedAt: Number(source.lastGeneratedAt) || 0
    };
  }

  function normalizeCharacterDiarySettings(settings) {
    var source = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
    var frequency = ["daily", "often", "low"].indexOf(source.frequency) === -1 ? "daily" : source.frequency;

    return {
      autoDiaryEnabled: source.autoDiaryEnabled !== false,
      frequency: frequency,
      allowUseChatHistory: source.allowUseChatHistory !== false,
      allowUseThoughts: source.allowUseThoughts !== false
    };
  }

  function normalizeGroup(group, index) {
    var source = group && typeof group === "object" ? group : {};
    return {
      id: source.id ? String(source.id) : String(Date.now() + index),
      name: String(source.name || ""),
      memberIds: Array.isArray(source.memberIds) ? source.memberIds.map(String) : [],
      settings: normalizeGroupSettings(source.settings || {}),
      createdAt: Number(source.createdAt) || Date.now()
    };
  }

  function normalizePrivateChatSettings(settings) {
    var source = settings && typeof settings === "object" ? settings : {};
    var persona = source.userPersonaOverride && typeof source.userPersonaOverride === "object" ? source.userPersonaOverride : {};

    return {
      pinned: Boolean(source.pinned),
      remarkName: String(source.remarkName || ""),
      timestampEnabled: Boolean(source.timestampEnabled),
      timestampStyle: source.timestampStyle === "center" || source.timestampStyle === "none" ? source.timestampStyle : "below",
      timestampShowSeconds: Boolean(source.timestampShowSeconds),
      hideUserAvatar: Boolean(source.hideUserAvatar),
      hideCharacterAvatar: Boolean(source.hideCharacterAvatar),
      bubbleRadius: Math.max(2, Math.min(24, Number(source.bubbleRadius) || 8)),
      readReceiptEnabled: Boolean(source.readReceiptEnabled),
      patAction: String(source.patAction || ""),
      chatBackground: String(source.chatBackground || ""),
      familyCardId: String(source.familyCardId || ""),
      userPersonaId: String(source.userPersonaId || ""),
      userPersonaOverride: {
        name: String(persona.name || ""),
        avatar: String(persona.avatar || ""),
        gender: String(persona.gender || ""),
        age: String(persona.age || ""),
        identity: String(persona.identity || ""),
        personality: String(persona.personality || ""),
        speakingStyle: String(persona.speakingStyle || ""),
        extra: String(persona.extra || persona.persona || ""),
        persona: String(persona.persona || persona.extra || "")
      },
      memoryEnabled: source.memoryEnabled !== false
    };
  }

  function normalizeGroupSettings(settings) {
    var source = settings && typeof settings === "object" ? settings : {};
    var persona = source.userPersonaOverride && typeof source.userPersonaOverride === "object" ? source.userPersonaOverride : {};

    return {
      avatar: String(source.avatar || ""),
      announcement: String(source.announcement || ""),
      background: String(source.background || ""),
      pinned: Boolean(source.pinned),
      memorySharingEnabled: source.memorySharingEnabled !== false,
      minReplyCount: Math.max(1, Number(source.minReplyCount) || 10),
      maxReplyCount: Math.max(10, Number(source.maxReplyCount) || 50),
      minParticipantCount: Math.max(1, Number(source.minParticipantCount) || 2),
      allowConsecutiveMessages: source.allowConsecutiveMessages !== false,
      allowSpecialMessages: source.allowSpecialMessages !== false,
      userPersonaId: String(source.userPersonaId || ""),
      userPersonaOverride: {
        name: String(persona.name || ""),
        avatar: String(persona.avatar || ""),
        gender: String(persona.gender || ""),
        age: String(persona.age || ""),
        identity: String(persona.identity || ""),
        personality: String(persona.personality || ""),
        speakingStyle: String(persona.speakingStyle || ""),
        extra: String(persona.extra || persona.persona || ""),
        persona: String(persona.persona || persona.extra || "")
      }
    };
  }

  function normalizeMessageMap(messagesById) {
    var normalized = {};

    if (!messagesById || typeof messagesById !== "object" || Array.isArray(messagesById)) {
      return normalized;
    }

    Object.keys(messagesById).forEach(function (id) {
      var messages = messagesById[id];
      normalized[String(id)] = Array.isArray(messages) ? messages.map(normalizeMessage) : [];
    });

    return normalized;
  }

  function normalizeMessage(message, index) {
    var source = message && typeof message === "object" ? message : {};
    var type = String(source.type || "text");
    var role = source.role ? String(source.role) : (type === "system" || type === "pat" ? "system" : "character");

    return Object.assign({}, source, {
      id: String(source.id || Date.now() + index),
      role: role,
      type: type,
      content: String(source.content || ""),
      createdAt: Number(source.createdAt) || Date.now()
    });
  }

  function normalizeOfflineSessions(sessions) {
    var normalized = {};

    if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) {
      return normalized;
    }

    Object.keys(sessions).forEach(function (sessionId) {
      var source = sessions[sessionId];
      if (!source || typeof source !== "object") {
        return;
      }

      normalized[String(sessionId)] = {
        id: String(source.id || sessionId),
        mode: source.mode === "group" ? "group" : "private",
        targetId: String(source.targetId || ""),
        participantIds: Array.isArray(source.participantIds) ? source.participantIds.map(String) : [],
        title: String(source.title || ""),
        scene: normalizeOfflineScene(source.scene || {}),
        history: Array.isArray(source.history) ? source.history.map(normalizeMessage) : [],
        createdAt: Number(source.createdAt) || Date.now(),
        updatedAt: Number(source.updatedAt) || Date.now()
      };
    });

    return normalized;
  }

  function normalizeMemory(memory) {
    var normalized = {};

    if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
      return normalized;
    }

    Object.keys(memory).forEach(function (characterId) {
      var memories = memory[characterId];
      normalized[String(characterId)] = Array.isArray(memories)
        ? memories.map(function (item) {
          return {
            content: String(item && item.content || ""),
            source: item && item.source ? String(item.source) : "private",
            createdAt: Number(item && item.createdAt) || Date.now()
          };
        }).filter(function (item) {
          return item.content;
        })
        : [];
    });

    return normalized;
  }

  function normalizeChatMemories(memories) {
    var normalized = {};

    if (!memories || typeof memories !== "object" || Array.isArray(memories)) {
      return normalized;
    }

    Object.keys(memories).forEach(function (key) {
      normalized[String(key)] = Array.isArray(memories[key])
        ? memories[key].map(normalizeChatMemoryItem).filter(function (memory) { return memory.content; })
        : [];
    });

    return normalized;
  }

  function normalizeChatRounds(rounds) {
    var normalized = {};

    if (!rounds || typeof rounds !== "object" || Array.isArray(rounds)) {
      return normalized;
    }

    Object.keys(rounds).forEach(function (key) {
      normalized[String(key)] = Math.max(0, Math.floor(Number(rounds[key]) || 0));
    });

    return normalized;
  }

  function normalizeBodyStates(states) {
    var normalized = {};

    if (!states || typeof states !== "object" || Array.isArray(states)) {
      return normalized;
    }

    Object.keys(states).forEach(function (key) {
      normalized[String(key)] = normalizeBodyState(states[key]);
    });

    return normalized;
  }

  function normalizeEmojiPacks(emojis) {
    if (!Array.isArray(emojis)) {
      return [];
    }

    return emojis.map(function (emoji, index) {
      var source = emoji && typeof emoji === "object" ? emoji : {};

      return {
        id: String(source.id || Date.now() + index),
        name: String(source.name || "表情"),
        type: source.type === "image" ? "image" : "text",
        src: String(source.src || ""),
        createdAt: Number(source.createdAt) || Date.now()
      };
    }).filter(function (emoji) {
      return emoji.src;
    });
  }

  function normalizeWorldBooks(books) {
    return Array.isArray(books) ? books.map(normalizeWorldBook) : [];
  }

  function normalizeWorldBook(book, index) {
    var source = book && typeof book === "object" ? book : {};
    var now = Date.now();

    return {
      id: String(source.id || now + index),
      name: String(source.name || "未命名世界书"),
      description: String(source.description || ""),
      entries: Array.isArray(source.entries) ? source.entries.map(normalizeWorldBookEntry) : [],
      enabled: source.enabled !== false,
      scope: source.scope === "private" || source.scope === "group" ? source.scope : "global",
      targetIds: Array.isArray(source.targetIds) ? source.targetIds.map(String) : [],
      createdAt: Number(source.createdAt) || now,
      updatedAt: Number(source.updatedAt) || now
    };
  }

  function normalizeWorldBookEntry(entry, index) {
    var source = entry && typeof entry === "object" ? entry : {};
    var now = Date.now();

    return {
      id: String(source.id || now + index),
      title: String(source.title || "未命名条目"),
      keywords: Array.isArray(source.keywords)
        ? source.keywords.map(String).map(function (keyword) { return keyword.trim(); }).filter(Boolean)
        : String(source.keywords || "").split(/[,，\s]+/).map(function (keyword) { return keyword.trim(); }).filter(Boolean),
      content: String(source.content || ""),
      enabled: source.enabled !== false,
      priority: Number(source.priority) || 0,
      createdAt: Number(source.createdAt) || now,
      updatedAt: Number(source.updatedAt) || now
    };
  }

  function normalizeThoughts(thoughts) {
    var normalized = {};

    if (!thoughts || typeof thoughts !== "object" || Array.isArray(thoughts)) {
      return normalized;
    }

    Object.keys(thoughts).forEach(function (characterId) {
      normalized[String(characterId)] = Array.isArray(thoughts[characterId])
        ? thoughts[characterId].map(normalizeThought).filter(function (thought) { return thought.content; })
        : [];
    });

    return normalized;
  }

  function normalizeThought(thought, index) {
    var source = thought && typeof thought === "object" ? thought : {};
    return {
      id: String(source.id || Date.now() + index),
      source: source.source === "group" || source.source === "offline" ? source.source : "private",
      chatId: String(source.chatId || ""),
      content: String(source.content || ""),
      mood: String(source.mood || ""),
      visibleSummary: String(source.visibleSummary || source.summary || ""),
      relatedMessageIds: Array.isArray(source.relatedMessageIds) ? source.relatedMessageIds.map(String) : [],
      readAt: source.readAt !== undefined ? Number(source.readAt) || 0 : (source.unread ? 0 : Number(source.createdAt) || Date.now()),
      unread: source.unread === true && !Number(source.readAt),
      createdAt: Number(source.createdAt) || Date.now()
    };
  }

  function normalizeDiaries(diaries) {
    return Array.isArray(diaries) ? diaries.map(normalizeDiary).filter(function (diary) {
      return diary.title || diary.content;
    }) : [];
  }

  function normalizeDiary(diary, index) {
    var source = diary && typeof diary === "object" ? diary : {};
    var now = Date.now();

    return {
      id: String(source.id || now + index),
      type: source.type === "mine" ? "mine" : "character",
      characterId: String(source.characterId || ""),
      date: String(source.date || getLocalDateString()),
      weather: String(source.weather || ""),
      title: String(source.title || ""),
      content: String(source.content || ""),
      mood: String(source.mood || ""),
      summary: String(source.summary || ""),
      createdAt: Number(source.createdAt) || now,
      updatedAt: Number(source.updatedAt) || now
    };
  }

  function normalizeUserProfile(profile) {
    var source = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
    var wxid = String(source.wxid || source.wechatId || "");

    if (!wxid) {
      wxid = "wxid_" + Math.random().toString(36).slice(2, 8);
    }

    return {
      name: String(source.name || "林澈"),
      avatar: String(source.avatar || ""),
      persona: String(source.persona || ""),
      wxid: wxid,
      activePersonaId: String(source.activePersonaId || ""),
      momentsAutoReview: Boolean(source.momentsAutoReview)
    };
  }

  function normalizeUserPersonas(personas) {
    return Array.isArray(personas) ? personas.map(normalizeUserPersona).filter(function (persona) {
      return persona.name;
    }) : [];
  }

  function normalizeUserPersona(persona, index) {
    var source = persona && typeof persona === "object" && !Array.isArray(persona) ? persona : {};
    var now = Date.now();

    return {
      id: String(source.id || createId("persona") + "_" + (index || 0)),
      name: String(source.name || "").trim(),
      avatar: String(source.avatar || ""),
      gender: String(source.gender || ""),
      age: String(source.age || ""),
      identity: String(source.identity || source.relationship || ""),
      personality: String(source.personality || ""),
      speakingStyle: String(source.speakingStyle || ""),
      extra: String(source.extra || source.persona || source.background || ""),
      createdAt: Number(source.createdAt) || now,
      updatedAt: Number(source.updatedAt) || now
    };
  }

  function normalizeDesktopState(state) {
    var source = state && typeof state === "object" && !Array.isArray(state) ? state : {};
    return {
      currentPage: Math.max(0, Number(source.currentPage) || 0)
    };
  }

  function normalizeWechatState(state) {
    var source = state && typeof state === "object" && !Array.isArray(state) ? state : {};
    var tab = String(source.tab || "wechat");

    if (tab === "discover") {
      tab = "moments";
    }

    if (tab === "spirit") {
      tab = "wechat";
    }

    if (["wechat", "moments", "me"].indexOf(tab) === -1) {
      tab = "wechat";
    }
    return {
      tab: tab
    };
  }

  function normalizeMoments(moments) {
    return Array.isArray(moments) ? moments.map(normalizeMoment).filter(function (moment) {
      return moment.content;
    }) : [];
  }

  function normalizeMoment(moment, index) {
    var source = moment && typeof moment === "object" ? moment : { content: moment };
    var authorType = source.authorType === "character" ? "character" : "user";
    var now = Date.now();
    var images = Array.isArray(source.images) ? source.images : (source.image ? [source.image] : []);

    return {
      id: String(source.id || createId("moment") + "_" + (index || 0)),
      authorType: authorType,
      authorId: String(source.authorId || ""),
      authorName: String(source.authorName || ""),
      authorAvatar: String(source.authorAvatar || ""),
      content: String(source.content || "").trim(),
      images: images.map(function (image) {
        if (image && typeof image === "object") {
          return {
            src: String(image.src || image.url || ""),
            description: String(image.description || image.name || "")
          };
        }
        return {
          src: String(image || ""),
          description: ""
        };
      }).filter(function (image) {
        return image.src || image.description;
      }).slice(0, 9),
      likes: Array.isArray(source.likes) ? source.likes.map(String) : [],
      comments: Array.isArray(source.comments) ? source.comments.map(normalizeMomentComment).filter(function (comment) {
        return comment.content;
      }) : [],
      visibility: source.visibility === "private" ? "private" : "all",
      source: ["manual", "ai", "diary", "chat"].indexOf(source.source) === -1 ? "manual" : source.source,
      createdAt: Number(source.createdAt) || now
    };
  }

  function normalizeMomentComment(comment, index) {
    var item = comment && typeof comment === "object" ? comment : { content: comment };
    var authorType = item.authorType === "character" ? "character" : "user";

    return {
      id: String(item.id || createId("momentComment") + "_" + (index || 0)),
      authorType: authorType,
      authorId: String(item.authorId || ""),
      authorName: String(item.authorName || (authorType === "user" ? "我" : "角色")),
      authorAvatar: String(item.authorAvatar || ""),
      content: String(item.content || "").trim(),
      createdAt: Number(item.createdAt) || Date.now()
    };
  }

  function normalizeInlineOfflineStates(states) {
    var normalized = {};

    if (!states || typeof states !== "object" || Array.isArray(states)) {
      return normalized;
    }

    Object.keys(states).forEach(function (key) {
      var source = states[key] && typeof states[key] === "object" ? states[key] : {};
      var targetType = source.targetType === "group" ? "group" : "private";
      var targetId = String(source.targetId || "");

      if (!targetId || source.enabled === false) {
        return;
      }

      normalized[getInlineOfflineKey(targetType, targetId)] = {
        targetType: targetType,
        targetId: targetId,
        scene: normalizeOfflineScene(source.scene || {}),
        enabled: true,
        updatedAt: Number(source.updatedAt) || Date.now()
      };
    });

    return normalized;
  }

  function normalizeShop(shop) {
    var source = shop && typeof shop === "object" && !Array.isArray(shop) ? shop : {};

    return {
      productsGeneratedAt: Number(source.productsGeneratedAt) || 0,
      foodShops: Array.isArray(source.foodShops) ? source.foodShops.map(normalizeFoodShop).filter(function (shopItem) {
        return shopItem.name && shopItem.products.length;
      }) : [],
      mallProducts: Array.isArray(source.mallProducts) ? source.mallProducts.map(function (product, index) {
        return normalizeProduct(product, "mall", index);
      }).filter(function (product) {
        return product.name;
      }) : [],
      cart: Array.isArray(source.cart) ? source.cart.map(normalizeCartItem).filter(function (item) {
        return item.name && item.quantity > 0;
      }) : [],
      orders: Array.isArray(source.orders) ? source.orders.map(normalizeShopOrder).filter(function (order) {
        return order.items.length;
      }) : []
    };
  }

  function normalizeFoodShop(shop, index) {
    var source = shop && typeof shop === "object" ? shop : {};
    var shopId = String(source.id || createId("foodshop") + "_" + (index || 0));

    return {
      id: shopId,
      name: String(source.name || ""),
      description: String(source.description || ""),
      products: Array.isArray(source.products) ? source.products.map(function (product, productIndex) {
        return normalizeProduct(Object.assign({}, product || {}, {
          shopId: shopId
        }), "food", productIndex);
      }).filter(function (product) {
        return product.name;
      }) : []
    };
  }

  function normalizeProduct(product, sourceType, index) {
    var source = product && typeof product === "object" ? product : {};
    var price = Math.max(0.1, roundAmount(source.price || source.amount || 1));

    return {
      id: String(source.id || createId("product") + "_" + (index || 0)),
      name: String(source.name || ""),
      description: String(source.description || ""),
      price: price,
      imagePrompt: String(source.imagePrompt || ""),
      category: String(source.category || (sourceType === "food" ? "日常" : "生活")),
      stock: Math.max(0, Number(source.stock) || 99),
      shopId: String(source.shopId || "")
    };
  }

  function normalizeCartItem(item, index) {
    var source = item && typeof item === "object" ? item : {};

    return {
      id: String(source.id || createId("cart") + "_" + (index || 0)),
      productId: String(source.productId || ""),
      sourceType: source.sourceType === "food" ? "food" : "mall",
      shopId: String(source.shopId || ""),
      name: String(source.name || ""),
      price: Math.max(0, roundAmount(source.price)),
      quantity: Math.max(1, Math.min(99, Number(source.quantity) || 1))
    };
  }

  function normalizeShopOrder(order, index) {
    var source = order && typeof order === "object" ? order : {};

    return {
      id: String(source.id || createId("order") + "_" + (index || 0)),
      items: Array.isArray(source.items) ? source.items.map(normalizeCartItem).filter(function (item) {
        return item.name;
      }) : [],
      totalAmount: normalizePositiveAmount(source.totalAmount),
      payMethod: source.payMethod === "familyCard" ? "familyCard" : "wallet",
      familyCardId: String(source.familyCardId || ""),
      createdAt: Number(source.createdAt) || Date.now()
    };
  }

  function createDefaultShopData() {
    var foodNames = [
      ["晚风便当铺", "适合边聊天边吃的温柔便当", [["海苔鸡排饭", 18.8, "主食"], ["番茄牛肉饭", 22.5, "主食"], ["玉子烧小盒", 9.9, "小食"], ["柠檬气泡水", 7.5, "饮品"], ["热乎味噌汤", 6.8, "汤品"]]],
      ["月亮甜品屋", "送给角色也不突兀的小甜点", [["草莓云朵卷", 16.8, "甜品"], ["焦糖布丁", 12.8, "甜品"], ["小熊曲奇袋", 13.9, "零食"], ["桂花乌龙奶茶", 14.5, "饮品"], ["栗子奶油盒", 17.8, "甜品"]]],
      ["课间小食堂", "学习间隙的轻松补给", [["芝士饭团", 8.8, "主食"], ["咖喱可乐饼", 10.5, "小食"], ["热狗小船", 12.0, "小食"], ["冰镇酸奶", 6.5, "饮品"], ["午后水果杯", 11.8, "水果"]]],
      ["深夜粥铺", "安静夜晚的一点热气", [["皮蛋瘦肉粥", 15.8, "粥品"], ["南瓜小米粥", 12.8, "粥品"], ["葱油拌面", 13.8, "主食"], ["糖心蛋", 4.0, "小食"], ["蜂蜜柚子茶", 8.8, "饮品"]]]
    ];
    var mallNames = [
      ["软绵绵抱枕", 39.9, "日用品"], ["透明便利贴", 9.9, "学习"], ["星星笔记本", 16.8, "学习"], ["角色同款发夹", 19.9, "周边"], ["迷你香薰石", 22.0, "生活"],
      ["暖手小方块", 29.9, "日用品"], ["告白信纸套装", 12.8, "礼物"], ["云朵马克杯", 35.0, "生活"], ["小兔钥匙扣", 15.8, "周边"], ["夜读台灯", 49.9, "学习"],
      ["奶盐饼干罐", 18.8, "零食"], ["薄荷糖小盒", 7.5, "零食"], ["雨天贴纸包", 8.8, "学习"], ["柔软围巾", 59.0, "穿搭"], ["拍立得相册", 32.0, "生活"],
      ["可爱便当袋", 26.8, "日用品"], ["心情记录卡", 11.9, "学习"], ["角色生日徽章", 13.8, "周边"], ["樱花洗衣珠", 24.9, "日用品"], ["午睡眼罩", 21.8, "生活"]
    ];

    return {
      productsGeneratedAt: Date.now(),
      foodShops: foodNames.map(function (shop) {
        var shopId = createId("foodshop");
        return {
          id: shopId,
          name: shop[0],
          description: shop[1],
          products: shop[2].map(function (product) {
            return {
              id: createId("food"),
              name: product[0],
              description: "适合心屿小手机里的日常互动。",
              price: product[1],
              imagePrompt: product[0],
              category: product[2],
              stock: 99,
              shopId: shopId
            };
          })
        };
      }),
      mallProducts: mallNames.map(function (product) {
        return {
          id: createId("mall"),
          name: product[0],
          description: "可以自用，也可以当作送给角色的小礼物。",
          price: product[1],
          imagePrompt: product[0],
          category: product[2],
          stock: 99
        };
      }),
      cart: [],
      orders: []
    };
  }

  function normalizeWallet(wallet) {
    var source = wallet && typeof wallet === "object" && !Array.isArray(wallet) ? wallet : {};
    return {
      balance: roundAmount(source.balance === undefined ? 0 : source.balance),
      ledger: Array.isArray(source.ledger) ? source.ledger.map(normalizeLedgerRecord).filter(function (record) {
        return record.type;
      }) : [],
      familyCards: Array.isArray(source.familyCards) ? source.familyCards.map(normalizeFamilyCard).filter(function (card) {
        return card.id;
      }) : []
    };
  }

  function normalizeLedgerRecord(record, index) {
    var source = record && typeof record === "object" ? record : {};
    var direction = source.direction === "expense" ? "expense" : "income";
    var type = String(source.type || "system");

    return Object.assign({}, source, {
      id: String(source.id || createId("ledger") + "_" + (index || 0)),
      type: type,
      amount: normalizePositiveAmount(source.amount),
      direction: direction,
      sourceType: String(source.sourceType || "system"),
      sourceId: String(source.sourceId || ""),
      characterId: String(source.characterId || ""),
      groupId: String(source.groupId || ""),
      familyCardId: String(source.familyCardId || ""),
      note: String(source.note || ""),
      createdAt: Number(source.createdAt) || Date.now()
    });
  }

  function normalizeFamilyCard(card, index) {
    var source = card && typeof card === "object" ? card : {};
    var totalLimit = normalizePositiveAmount(source.totalLimit || source.limit || 1000);
    var usedAmount = Math.min(totalLimit, normalizePositiveAmount(source.usedAmount));

    return {
      id: String(source.id || createId("familycard") + "_" + (index || 0)),
      name: String(source.name || "亲属卡"),
      targetCharacterId: String(source.targetCharacterId || source.characterId || ""),
      totalLimit: totalLimit,
      usedAmount: usedAmount,
      enabled: source.enabled !== false,
      createdAt: Number(source.createdAt) || Date.now()
    };
  }

  function normalizeRecentHidden(hidden) {
    var normalized = {};

    if (!hidden || typeof hidden !== "object" || Array.isArray(hidden)) {
      return normalized;
    }

    Object.keys(hidden).forEach(function (key) {
      normalized[String(key)] = Number(hidden[key]) || Date.now();
    });
    return normalized;
  }

  function normalizeTheme(theme) {
    var source = theme && typeof theme === "object" && !Array.isArray(theme) ? theme : {};
    return {
      active: String(source.active || "default")
    };
  }

  function normalizePhotos(photos) {
    return Array.isArray(photos) ? photos.map(normalizePhoto).filter(function (photo) {
      return photo.src;
    }) : [];
  }

  function normalizePhoto(photo, index) {
    var source = photo && typeof photo === "object" ? photo : {};
    var now = Date.now();

    return {
      id: String(source.id || now + index),
      name: String(source.name || "图片"),
      src: String(source.src || ""),
      createdAt: Number(source.createdAt) || now
    };
  }

  function normalizeNotes(notes) {
    return Array.isArray(notes) ? notes.map(normalizeNote).filter(function (note) {
      return note.title || note.content;
    }) : [];
  }

  function normalizeNote(note, index) {
    var source = note && typeof note === "object" ? note : {};
    var now = Date.now();

    return {
      id: String(source.id || now + index),
      title: String(source.title || "未命名笔记"),
      content: String(source.content || ""),
      createdAt: Number(source.createdAt) || now,
      updatedAt: Number(source.updatedAt) || now
    };
  }

  function normalizeOfflineScene(scene) {
    var source = scene && typeof scene === "object" ? scene : {};
    return {
      name: String(source.name || ""),
      description: String(source.description || "")
    };
  }

  function clearAllData() {
    localStorage.removeItem(STORAGE_KEYS.characters);
    localStorage.removeItem(STORAGE_KEYS.settings);
    localStorage.removeItem(STORAGE_KEYS.groups);
    localStorage.removeItem(STORAGE_KEYS.memory);
    localStorage.removeItem(STORAGE_KEYS.chatMemories);
    localStorage.removeItem(STORAGE_KEYS.chatRounds);
    localStorage.removeItem(STORAGE_KEYS.bodyStates);
    localStorage.removeItem(STORAGE_KEYS.emojiPacks);
    localStorage.removeItem(STORAGE_KEYS.worldBooks);
    localStorage.removeItem(STORAGE_KEYS.thoughts);
    localStorage.removeItem(STORAGE_KEYS.diaries);
    localStorage.removeItem(STORAGE_KEYS.userProfile);
    localStorage.removeItem(STORAGE_KEYS.userPersonas);
    localStorage.removeItem(STORAGE_KEYS.desktopState);
    localStorage.removeItem(STORAGE_KEYS.wechatState);
    localStorage.removeItem(STORAGE_KEYS.moments);
    localStorage.removeItem(STORAGE_KEYS.inlineOffline);
    localStorage.removeItem(STORAGE_KEYS.wallet);
    localStorage.removeItem(STORAGE_KEYS.shop);
    localStorage.removeItem(STORAGE_KEYS.recentHidden);
    localStorage.removeItem(STORAGE_KEYS.theme);
    localStorage.removeItem(STORAGE_KEYS.photos);
    localStorage.removeItem(STORAGE_KEYS.notes);
    removeAllPrefixedItems(STORAGE_KEYS.chatPrefix);
    removeAllPrefixedItems(STORAGE_KEYS.groupChatPrefix);
    removeAllPrefixedItems(STORAGE_KEYS.offlinePrefix);
  }

  function removeAllPrefixedItems(prefix) {
    var keysToRemove = [];

    for (var index = 0; index < localStorage.length; index += 1) {
      var key = localStorage.key(index);
      if (key && key.indexOf(prefix) === 0) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(function (key) {
      localStorage.removeItem(key);
    });
  }

  window.AppStorage = {
    getCharacters: getCharacters,
    saveCharacters: saveCharacters,
    addCharacter: addCharacter,
    updateCharacter: updateCharacter,
    deleteCharacter: deleteCharacter,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getChatHistory: getChatHistory,
    saveChatHistory: saveChatHistory,
    deleteChatHistory: deleteChatHistory,
    getGroups: getGroups,
    saveGroups: saveGroups,
    addGroup: addGroup,
    updateGroup: updateGroup,
    deleteGroup: deleteGroup,
    getGroupChatHistory: getGroupChatHistory,
    saveGroupChatHistory: saveGroupChatHistory,
    deleteGroupChatHistory: deleteGroupChatHistory,
    getEmojiPacks: getEmojiPacks,
    saveEmojiPacks: saveEmojiPacks,
    addEmoji: addEmoji,
    getCharacterMemory: getCharacterMemory,
    saveCharacterMemory: saveCharacterMemory,
    addCharacterMemory: addCharacterMemory,
    getMemoriesForCharacters: getMemoriesForCharacters,
    clearCharacterMemory: clearCharacterMemory,
    getChatMemories: getChatMemories,
    saveChatMemories: saveChatMemories,
    addChatMemory: addChatMemory,
    updateChatMemory: updateChatMemory,
    deleteChatMemory: deleteChatMemory,
    clearChatMemories: clearChatMemories,
    clearAllChatMemoriesByType: clearAllChatMemoriesByType,
    getChatRoundCounter: getChatRoundCounter,
    setChatRoundCounter: setChatRoundCounter,
    resetChatRoundCounter: resetChatRoundCounter,
    getBodyState: getBodyState,
    saveBodyState: saveBodyState,
    clearBodyState: clearBodyState,
    clearAllBodyStates: clearAllBodyStates,
    getDefaultBodyState: getDefaultBodyState,
    getOfflineSession: getOfflineSession,
    saveOfflineSession: saveOfflineSession,
    deleteOfflineSession: deleteOfflineSession,
    getAllChatHistories: getAllChatHistories,
    getAllGroupChatHistories: getAllGroupChatHistories,
    getAllOfflineSessions: getAllOfflineSessions,
    getWorldBooks: getWorldBooks,
    saveWorldBooks: saveWorldBooks,
    addWorldBook: addWorldBook,
    updateWorldBook: updateWorldBook,
    deleteWorldBook: deleteWorldBook,
    getMatchedWorldBookEntries: getMatchedWorldBookEntries,
    getCharacterThoughts: getCharacterThoughts,
    saveCharacterThoughts: saveCharacterThoughts,
    addCharacterThought: addCharacterThought,
    getRecentThoughts: getRecentThoughts,
    getUnreadThoughtCount: getUnreadThoughtCount,
    markThoughtsRead: markThoughtsRead,
    clearCharacterThoughts: clearCharacterThoughts,
    deleteCharacterThought: deleteCharacterThought,
    getDiaries: getDiaries,
    saveDiaries: saveDiaries,
    addDiary: addDiary,
    updateDiary: updateDiary,
    deleteDiary: deleteDiary,
    getDiariesByCharacter: getDiariesByCharacter,
    getTodayDiary: getTodayDiary,
    getUserProfile: getUserProfile,
    saveUserProfile: saveUserProfile,
    getUserPersonas: getUserPersonas,
    saveUserPersonas: saveUserPersonas,
    addUserPersona: addUserPersona,
    updateUserPersona: updateUserPersona,
    deleteUserPersona: deleteUserPersona,
    getUserPersonaById: getUserPersonaById,
    resolveUserPersona: resolveUserPersona,
    getDesktopState: getDesktopState,
    saveDesktopState: saveDesktopState,
    updateDesktopState: updateDesktopState,
    getWechatState: getWechatState,
    saveWechatState: saveWechatState,
    updateWechatState: updateWechatState,
    getMoments: getMoments,
    saveMoments: saveMoments,
    addMoment: addMoment,
    updateMoment: updateMoment,
    deleteMoment: deleteMoment,
    addMomentComment: addMomentComment,
    getInlineOfflineState: getInlineOfflineState,
    setInlineOfflineState: setInlineOfflineState,
    clearInlineOfflineState: clearInlineOfflineState,
    getInlineOfflineStates: getInlineOfflineStates,
    getRecentHidden: getRecentHidden,
    hideRecentChat: hideRecentChat,
    getRecentHiddenAt: getRecentHiddenAt,
    getTheme: getTheme,
    saveTheme: saveTheme,
    getPhotos: getPhotos,
    savePhotos: savePhotos,
    addPhoto: addPhoto,
    deletePhoto: deletePhoto,
    getNotes: getNotes,
    saveNotes: saveNotes,
    addNote: addNote,
    updateNote: updateNote,
    deleteNote: deleteNote,
    getActiveApiProfile: getActiveApiProfile,
    getShop: getShop,
    saveShop: saveShop,
    getDefaultShopProducts: getDefaultShopProducts,
    getWallet: getWallet,
    saveWallet: saveWallet,
    addWalletLedger: addWalletLedger,
    rechargeWallet: rechargeWallet,
    getFamilyCards: getFamilyCards,
    addFamilyCard: addFamilyCard,
    updateFamilyCard: updateFamilyCard,
    deleteFamilyCard: deleteFamilyCard,
    getFamilyCardsForCharacter: getFamilyCardsForCharacter,
    getFamilyCardById: getFamilyCardById,
    spendFamilyCard: spendFamilyCard,
    recordMoneyMessage: recordMoneyMessage,
    receiveMoneyMessage: receiveMoneyMessage,
    exportAllData: exportAllData,
    importAllData: importAllData,
    clearAllData: clearAllData
  };
})(window);
