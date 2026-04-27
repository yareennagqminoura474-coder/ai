(function (window) {
  "use strict";

  var STORAGE_KEYS = {
    characters: "myAiApp.characters",
    settings: "myAiApp.settings",
    groups: "myAiApp.groups",
    memory: "myAiApp.memory",
    emojiPacks: "myAiApp.emojiPacks",
    worldBooks: "myAiApp.worldBooks",
    thoughts: "myAiApp.thoughts",
    diaries: "myAiApp.diaries",
    userProfile: "myAiApp.userProfile",
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
    var settings = parseJson(localStorage.getItem(STORAGE_KEYS.settings), {});
    return {
      apiUrl: settings.apiUrl || "",
      apiKey: settings.apiKey || "",
      modelName: settings.modelName || ""
    };
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({
      apiUrl: settings.apiUrl || "",
      apiKey: settings.apiKey || "",
      modelName: settings.modelName || ""
    }));
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
    var text = String(contextText || "").toLowerCase();
    var target = String(targetId || "");
    var matched = [];

    getWorldBooks().forEach(function (book) {
      if (!book.enabled || !isWorldBookInScope(book, scope, target)) {
        return;
      }

      (book.entries || []).forEach(function (entry) {
        var keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
        var hasKeyword = keywords.some(function (keyword) {
          return keyword && text.indexOf(String(keyword).toLowerCase()) !== -1;
        });

        if (entry.enabled && (hasKeyword || (!keywords.length && book.scope === "global"))) {
          matched.push(Object.assign({}, entry, {
            bookName: book.name,
            bookDescription: book.description,
            bookScope: book.scope
          }));
        }
      });

      if (!matched.length && book.scope === "global" && book.description) {
        matched.push({
          id: book.id + "-description",
          title: book.name,
          keywords: [],
          content: book.description,
          enabled: true,
          priority: 0,
          bookName: book.name,
          bookDescription: book.description,
          bookScope: book.scope,
          createdAt: book.createdAt,
          updatedAt: book.updatedAt
        });
      }
    });

    return matched.sort(function (a, b) {
      return (Number(b.priority) || 0) - (Number(a.priority) || 0);
    }).slice(0, 10);
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
    var profile = parseJson(localStorage.getItem(STORAGE_KEYS.userProfile), {});
    return profile && typeof profile === "object" && !Array.isArray(profile)
      ? Object.assign({ name: "", avatar: "", persona: "" }, profile)
      : { name: "", avatar: "", persona: "" };
  }

  function saveUserProfile(profile) {
    localStorage.setItem(STORAGE_KEYS.userProfile, JSON.stringify(Object.assign({
      name: "",
      avatar: "",
      persona: ""
    }, profile || {})));
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
      chatHistory: getAllChatHistories(),
      groups: getGroups(),
      groupChatHistory: getAllGroupChatHistories(),
      offlineSessions: getAllOfflineSessions(),
      memory: getMemoryStore(),
      emojiPacks: getEmojiPacks(),
      worldBooks: getWorldBooks(),
      thoughts: getThoughtStore(),
      diaries: getDiaries(),
      userProfile: getUserProfile(),
      userPersonas: getUserProfile()
    };
  }

  function importAllData(data) {
    var normalized = normalizeBackupData(data);

    clearAllData();
    saveCharacters(normalized.characters);
    saveSettings(normalized.settings);
    saveGroups(normalized.groups);
    saveMemoryStore(normalized.memory);
    saveEmojiPacks(normalized.emojiPacks);
    saveWorldBooks(normalized.worldBooks);
    saveThoughtStore(normalized.thoughts);
    saveDiaries(normalized.diaries);
    saveUserProfile(normalized.userProfile);

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
      characters: Array.isArray(data.characters) ? data.characters.map(normalizeCharacter) : [],
      settings: {
        apiUrl: String(data.settings && data.settings.apiUrl || ""),
        apiKey: String(data.settings && data.settings.apiKey || ""),
        modelName: String(data.settings && data.settings.modelName || "")
      },
      chatHistory: normalizeMessageMap(data.chatHistory || {}),
      groups: Array.isArray(data.groups) ? data.groups.map(normalizeGroup) : [],
      groupChatHistory: normalizeMessageMap(data.groupChatHistory || {}),
      offlineSessions: normalizeOfflineSessions(data.offlineSessions || {}),
      memory: normalizeMemory(data.memory || {}),
      emojiPacks: normalizeEmojiPacks(data.emojiPacks || []),
      worldBooks: normalizeWorldBooks(data.worldBooks || []),
      thoughts: normalizeThoughts(data.thoughts || {}),
      diaries: normalizeDiaries(data.diaries || []),
      userProfile: normalizeUserProfile(data.userProfile || data.userPersonas || {})
    };
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
      createdAt: Number(source.createdAt) || Date.now()
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
      userPersonaOverride: {
        name: String(persona.name || ""),
        avatar: String(persona.avatar || ""),
        persona: String(persona.persona || "")
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
      memorySharingEnabled: source.memorySharingEnabled !== false,
      minReplyCount: Math.max(1, Number(source.minReplyCount) || 10),
      maxReplyCount: Math.max(10, Number(source.maxReplyCount) || 50),
      minParticipantCount: Math.max(1, Number(source.minParticipantCount) || 2),
      allowConsecutiveMessages: source.allowConsecutiveMessages !== false,
      allowSpecialMessages: source.allowSpecialMessages !== false,
      userPersonaOverride: {
        name: String(persona.name || ""),
        avatar: String(persona.avatar || ""),
        persona: String(persona.persona || "")
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
    return {
      name: String(source.name || ""),
      avatar: String(source.avatar || ""),
      persona: String(source.persona || "")
    };
  }

  function clearAllData() {
    localStorage.removeItem(STORAGE_KEYS.characters);
    localStorage.removeItem(STORAGE_KEYS.settings);
    localStorage.removeItem(STORAGE_KEYS.groups);
    localStorage.removeItem(STORAGE_KEYS.memory);
    localStorage.removeItem(STORAGE_KEYS.emojiPacks);
    localStorage.removeItem(STORAGE_KEYS.worldBooks);
    localStorage.removeItem(STORAGE_KEYS.thoughts);
    localStorage.removeItem(STORAGE_KEYS.diaries);
    localStorage.removeItem(STORAGE_KEYS.userProfile);
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
    clearCharacterThoughts: clearCharacterThoughts,
    getDiaries: getDiaries,
    saveDiaries: saveDiaries,
    addDiary: addDiary,
    updateDiary: updateDiary,
    deleteDiary: deleteDiary,
    getDiariesByCharacter: getDiariesByCharacter,
    getTodayDiary: getTodayDiary,
    getUserProfile: getUserProfile,
    saveUserProfile: saveUserProfile,
    exportAllData: exportAllData,
    importAllData: importAllData,
    clearAllData: clearAllData
  };
})(window);
