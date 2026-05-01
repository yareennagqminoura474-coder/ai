(function (window) {
  "use strict";

  var STORAGE_KEYS = {
    characters: "myAiApp.characters",
    settings: "myAiApp.settings",
    groups: "myAiApp.groups",
    contactGroups: "myAiApp.contactGroups",
    memory: "myAiApp.memory",
    chatMemories: "myAiApp.chatMemories",
    chatRounds: "myAiApp.chatRounds",
    bodyStates: "myAiApp.bodyStates",
    emojiPacks: "myAiApp.emojiPacks",
    worldBooks: "myAiApp.worldBooks",
    chatWorldBooks: "myAiApp.chatWorldBooks",
    thoughts: "myAiApp.thoughts",
    blockRelations: "myAiApp.blockRelations",
    bodyStateSnapshots: "myAiApp.bodyStateSnapshots",
    diaries: "myAiApp.diaries",
    userProfile: "myAiApp.userProfile",
    userPersonas: "myAiApp.userPersonas",
    desktopState: "myAiApp.desktopState",
    wechatState: "myAiApp.wechatState",
    moments: "myAiApp.moments",
    inlineOffline: "myAiApp.inlineOffline",
    wallet: "myAiApp.wallet",
    bodyStateMigrationV1: "myAiApp.bodyStateMigrationV1",
    moneyMessageMigrationVersion: "myAiApp.moneyMessageMigrationVersion",
    shop: "myAiApp.shop",
    recentHidden: "myAiApp.recentHidden",
    theme: "myAiApp.theme",
    photos: "myAiApp.photos",
    notes: "myAiApp.notes",
    chatPrefix: "myAiApp.chat.",
    groupChatPrefix: "myAiApp.groupChat.",
    offlinePrefix: "myAiApp.offline.",
    watchPrefix: "myAiApp.watch."
  };
  var debouncedPrivateChatSaves = {};
  var debouncedPrivateChatTimers = {};
  var debouncedGroupChatSaves = {};
  var debouncedGroupChatTimers = {};
  var debouncedOfflineSaves = {};
  var debouncedOfflineTimers = {};
  var debouncedWatchSaves = {};
  var debouncedWatchTimers = {};
  var BODY_STATE_PART_ALIASES = {
    "膝腿": "膝盖",
    "臀腿连接处": "臀腿",
    "臀缝": "屁眼",
    "其他受影响区域": "屁眼"
  };
  var DEFAULT_BODY_STATE_PARTS = ["手心", "臀部", "臀腿", "大腿", "大腿内侧", "腰背", "肩颈", "膝盖", "屁眼"];

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

  function normalizeGenerationIdList(generationIds) {
    var list = Array.isArray(generationIds) ? generationIds : [generationIds];
    return list.map(function (generationId) {
      return String(generationId || "");
    }).filter(Boolean);
  }

  function roundAmount(value) {
    var amount = Number(value);

    if (!Number.isFinite(amount)) {
      return 0;
    }

    return Math.round(amount * 100) / 100;
  }

  function normalizeMoneyAmount(value) {
    var text;
    var match;
    var amount;

    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 0.01) {
        return "";
      }
      return roundAmount(value).toFixed(2);
    }

    text = String(value === undefined || value === null ? "" : value).trim();
    if (!text) {
      return "";
    }

    text = text
      .replace(/[￥¥]/g, "")
      .replace(/元/g, "")
      .replace(/,/g, "")
      .replace(/\s+/g, "");
    match = text.match(/[-+]?\d+(?:\.\d+)?/);
    if (!match) {
      return "";
    }

    amount = Number(match[0]);
    if (!Number.isFinite(amount) || amount < 0.01) {
      return "";
    }

    return roundAmount(amount).toFixed(2);
  }

  function normalizePositiveAmount(value) {
    var normalized = normalizeMoneyAmount(value);
    return normalized ? Number(normalized) : 0;
  }

  function normalizeMoneyMessage(message) {
    var source = message && typeof message === "object" ? message : null;
    var mismatch;

    if (!source || (source.type !== "redPacket" && source.type !== "transfer")) {
      return source;
    }

    mismatch = detectMoneyAmountMismatch(source);
    if (!mismatch.amount) {
      return null;
    }

    source.amount = mismatch.amount;
    if (mismatch.cleanedContent !== undefined) {
      source.content = mismatch.cleanedContent;
    }
    if (mismatch.cleanedNote !== undefined) {
      source.note = mismatch.cleanedNote;
    }
    return source;
  }

  function detectMoneyAmountMismatch(message) {
    var source = message && typeof message === "object" ? message : {};
    var amountInfo = extractMoneyAmountInfo(source.amount);
    var contentInfo = extractMoneyAmountInfo(source.content);
    var noteInfo = extractMoneyAmountInfo(source.note);
    var result = {
      amount: amountInfo.normalized,
      amountInfo: amountInfo,
      contentAmount: contentInfo.normalized,
      noteAmount: noteInfo.normalized
    };

    if (!amountInfo.normalized) {
      result.amount = "";
      return result;
    }

    if (hasConflictingAmount(amountInfo, contentInfo)) {
      result.cleanedContent = cleanConflictingMoneyText(source.content, source.type, "content");
    }
    if (hasConflictingAmount(amountInfo, noteInfo)) {
      result.cleanedNote = cleanConflictingMoneyText(source.note, source.type, "note");
    }

    return result;
  }

  function extractMoneyAmountInfo(value) {
    var text = String(value === undefined || value === null ? "" : value).trim();
    var compact;
    var match;
    var amount;

    if (typeof value === "number") {
      return {
        raw: value,
        value: Number.isFinite(value) ? roundAmount(value) : NaN,
        normalized: normalizeMoneyAmount(value),
        hasNumber: Number.isFinite(value)
      };
    }

    if (!text) {
      return { raw: value, value: NaN, normalized: "", hasNumber: false };
    }

    compact = text
      .replace(/[￥¥]/g, "")
      .replace(/元/g, "")
      .replace(/,/g, "")
      .replace(/\s+/g, "");
    match = compact.match(/[-+]?\d+(?:\.\d+)?/);
    if (!match) {
      return { raw: value, value: NaN, normalized: "", hasNumber: false };
    }

    amount = Number(match[0]);
    return {
      raw: value,
      value: Number.isFinite(amount) ? roundAmount(amount) : NaN,
      normalized: normalizeMoneyAmount(value),
      hasNumber: Number.isFinite(amount)
    };
  }

  function hasConflictingAmount(primaryInfo, secondaryInfo) {
    if (!primaryInfo || !secondaryInfo || !primaryInfo.normalized || !secondaryInfo.normalized) {
      return false;
    }

    return primaryInfo.normalized !== secondaryInfo.normalized;
  }

  function cleanConflictingMoneyText(value, type, fieldName) {
    var original = String(value || "");
    var cleaned = original
      .replace(/(?:转账金额|红包金额|金额)\s*[：:]\s*[￥¥]?\s*[-+]?\d[\d,]*(?:\.\d+)?\s*元?/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (fieldName === "content" && !cleaned && isMoneyAmountOnlyText(original)) {
      return type === "redPacket" ? "恭喜发财，大吉大利" : "转账";
    }

    return cleaned;
  }

  function isMoneyAmountOnlyText(value) {
    var text = String(value || "")
      .replace(/金额/g, "")
      .replace(/[：:]/g, "")
      .replace(/[￥¥元,\s]/g, "")
      .trim();

    return /^[-+]?\d+(?:\.\d+)?$/.test(text);
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
    clearChatWorldBooks("private", characterId);
    clearCharacterMemory(characterId);
    clearChatMemories("private", characterId);
    clearBodyState("private", characterId);
    clearBodyStateSnapshots("private", characterId);
    resetChatRoundCounter("private", characterId);
    clearBlockState(characterId);
    deleteOfflineSessionsForTarget("private", characterId);
    if (window.AppApiJobs && typeof window.AppApiJobs.clearJobsForTarget === "function") {
      window.AppApiJobs.clearJobsForTarget("private", characterId);
    }
    clearCharacterThoughts(characterId);
    removeCharacterFromGroups(characterId);
    removeCharacterFromContactGroups(characterId);
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
    if (debouncedPrivateChatSaves[characterId]) {
      return debouncedPrivateChatSaves[characterId].slice();
    }

    var messages = parseJson(localStorage.getItem(STORAGE_KEYS.chatPrefix + characterId), []);
    return Array.isArray(messages) ? messages : [];
  }

  function saveChatHistory(characterId, messages) {
    if (debouncedPrivateChatTimers[characterId]) {
      clearTimeout(debouncedPrivateChatTimers[characterId]);
      delete debouncedPrivateChatTimers[characterId];
    }
    delete debouncedPrivateChatSaves[characterId];
    localStorage.setItem(STORAGE_KEYS.chatPrefix + characterId, JSON.stringify(messages || []));
  }

  function saveChatHistoryDebounced(characterId, messages, delay) {
    if (!characterId) {
      return;
    }

    debouncedPrivateChatSaves[characterId] = Array.isArray(messages) ? messages.slice() : [];
    if (debouncedPrivateChatTimers[characterId]) {
      clearTimeout(debouncedPrivateChatTimers[characterId]);
    }
    debouncedPrivateChatTimers[characterId] = setTimeout(function () {
      flushChatHistorySave(characterId);
    }, Math.max(40, Number(delay) || 120));
  }

  function flushChatHistorySave(characterId) {
    var pending = debouncedPrivateChatSaves[characterId];

    if (debouncedPrivateChatTimers[characterId]) {
      clearTimeout(debouncedPrivateChatTimers[characterId]);
      delete debouncedPrivateChatTimers[characterId];
    }

    if (!pending) {
      return;
    }

    delete debouncedPrivateChatSaves[characterId];
    localStorage.setItem(STORAGE_KEYS.chatPrefix + characterId, JSON.stringify(pending || []));
  }

  function deleteChatHistory(characterId) {
    localStorage.removeItem(STORAGE_KEYS.chatPrefix + characterId);
  }

  function getBlockRelations() {
    var relations = parseJson(localStorage.getItem(STORAGE_KEYS.blockRelations), {});
    return relations && typeof relations === "object" && !Array.isArray(relations) ? relations : {};
  }

  function saveBlockRelations(relations) {
    localStorage.setItem(STORAGE_KEYS.blockRelations, JSON.stringify(relations || {}));
  }

  function getBlockRelationKey(characterId) {
    return "private:" + String(characterId || "");
  }

  function normalizeBlockState(state) {
    var source = state && typeof state === "object" ? state : {};
    return {
      userBlocked: Boolean(source.userBlocked),
      characterBlocked: Boolean(source.characterBlocked),
      userBlockReason: String(source.userBlockReason || ""),
      characterBlockReason: String(source.characterBlockReason || ""),
      userBlockedAt: Number(source.userBlockedAt) || 0,
      characterBlockedAt: Number(source.characterBlockedAt) || 0,
      lastBlockReactionAt: Number(source.lastBlockReactionAt) || 0,
      updatedAt: Number(source.updatedAt) || 0
    };
  }

  function getBlockState(characterId) {
    return normalizeBlockState(getBlockRelations()[getBlockRelationKey(characterId)]);
  }

  function saveBlockState(characterId, state) {
    var relations = getBlockRelations();
    var key = getBlockRelationKey(characterId);
    var normalized = normalizeBlockState(Object.assign({}, state || {}, {
      updatedAt: Date.now()
    }));

    if (!normalized.userBlocked && !normalized.characterBlocked && !normalized.userBlockReason && !normalized.characterBlockReason) {
      delete relations[key];
    } else {
      relations[key] = normalized;
    }

    saveBlockRelations(relations);
    return relations[key] || normalizeBlockState({});
  }

  function setUserBlockedCharacter(characterId, blocked, reason) {
    var state = getBlockState(characterId);
    state.userBlocked = Boolean(blocked);
    state.userBlockReason = blocked ? String(reason || state.userBlockReason || "") : "";
    state.userBlockedAt = blocked ? Date.now() : 0;
    return saveBlockState(characterId, state);
  }

  function setCharacterBlockedUser(characterId, blocked, reason) {
    var state = getBlockState(characterId);
    state.characterBlocked = Boolean(blocked);
    state.characterBlockReason = blocked ? String(reason || state.characterBlockReason || "") : "";
    state.characterBlockedAt = blocked ? Date.now() : 0;
    return saveBlockState(characterId, state);
  }

  function setBlockReactionTimestamp(characterId, timestamp) {
    var state = getBlockState(characterId);
    state.lastBlockReactionAt = Number(timestamp) || Date.now();
    return saveBlockState(characterId, state);
  }

  function isUserBlockedCharacter(characterId) {
    return getBlockState(characterId).userBlocked;
  }

  function isCharacterBlockedUser(characterId) {
    return getBlockState(characterId).characterBlocked;
  }

  function clearBlockState(characterId) {
    var relations = getBlockRelations();
    delete relations[getBlockRelationKey(characterId)];
    saveBlockRelations(relations);
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
    clearChatWorldBooks("group", groupId);
    clearGroupMemory(groupId);
    clearChatMemories("group", groupId);
    clearGroupThoughts(groupId);
    clearBodyState("group", groupId);
    clearBodyStateSnapshots("group", groupId);
    resetChatRoundCounter("group", groupId);
    deleteOfflineSession("group-" + groupId);
    deleteOfflineSessionsForTarget("group", groupId);
    if (window.AppApiJobs && typeof window.AppApiJobs.clearJobsForTarget === "function") {
      window.AppApiJobs.clearJobsForTarget("group", groupId);
    }
  }

  function getContactGroups() {
    return normalizeContactGroups(parseJson(localStorage.getItem(STORAGE_KEYS.contactGroups), []));
  }

  function saveContactGroups(groups) {
    localStorage.setItem(STORAGE_KEYS.contactGroups, JSON.stringify(normalizeContactGroups(groups || [])));
  }

  function addContactGroup(group) {
    var groups = getContactGroups();
    var next = normalizeContactGroup(Object.assign({}, group || {}, {
      id: group && group.id || createId("contact_group"),
      createdAt: group && group.createdAt || Date.now(),
      updatedAt: Date.now()
    }), groups.length);

    groups.unshift(next);
    saveContactGroups(groups);
    return next;
  }

  function updateContactGroup(groupId, nextGroup) {
    var groups = getContactGroups();
    var index = groups.findIndex(function (group) {
      return group.id === groupId;
    });

    if (index === -1) {
      return null;
    }

    groups[index] = normalizeContactGroup(Object.assign({}, groups[index], nextGroup || {}, {
      id: groupId,
      createdAt: groups[index].createdAt || nextGroup && nextGroup.createdAt || Date.now(),
      updatedAt: Date.now()
    }), index);
    saveContactGroups(groups);
    return groups[index];
  }

  function deleteContactGroup(groupId) {
    saveContactGroups(getContactGroups().filter(function (group) {
      return group.id !== groupId;
    }));
  }

  function removeCharacterFromContactGroups(characterId) {
    var changed = false;
    var groups = getContactGroups().map(function (group) {
      var memberIds = (group.memberIds || []).filter(function (memberId) {
        return memberId !== characterId;
      });

      if (memberIds.length !== (group.memberIds || []).length) {
        changed = true;
        return Object.assign({}, group, {
          memberIds: memberIds,
          updatedAt: Date.now()
        });
      }

      return group;
    });

    if (changed) {
      saveContactGroups(groups);
    }
  }

  function canCharactersInteractInMoments(authorId, commenterId) {
    var firstId = String(authorId || "");
    var secondId = String(commenterId || "");
    var characterIds;

    if (!firstId || !secondId || firstId === secondId) {
      return true;
    }

    characterIds = getCharacters().map(function (character) {
      return character.id;
    });

    if (characterIds.indexOf(firstId) === -1 || characterIds.indexOf(secondId) === -1) {
      return true;
    }

    return getContactGroups().some(function (group) {
      var members = group.memberIds || [];
      return members.indexOf(firstId) !== -1 && members.indexOf(secondId) !== -1;
    });
  }

  function getGroupChatHistory(groupId) {
    if (debouncedGroupChatSaves[groupId]) {
      return debouncedGroupChatSaves[groupId].slice();
    }

    var messages = parseJson(localStorage.getItem(STORAGE_KEYS.groupChatPrefix + groupId), []);
    return Array.isArray(messages) ? messages : [];
  }

  function saveGroupChatHistory(groupId, messages) {
    if (debouncedGroupChatTimers[groupId]) {
      clearTimeout(debouncedGroupChatTimers[groupId]);
      delete debouncedGroupChatTimers[groupId];
    }
    delete debouncedGroupChatSaves[groupId];
    localStorage.setItem(STORAGE_KEYS.groupChatPrefix + groupId, JSON.stringify(messages || []));
  }

  function saveGroupChatHistoryDebounced(groupId, messages, delay) {
    if (!groupId) {
      return;
    }

    debouncedGroupChatSaves[groupId] = Array.isArray(messages) ? messages.slice() : [];
    if (debouncedGroupChatTimers[groupId]) {
      clearTimeout(debouncedGroupChatTimers[groupId]);
    }
    debouncedGroupChatTimers[groupId] = setTimeout(function () {
      flushGroupChatHistorySave(groupId);
    }, Math.max(40, Number(delay) || 120));
  }

  function flushGroupChatHistorySave(groupId) {
    var pending = debouncedGroupChatSaves[groupId];

    if (debouncedGroupChatTimers[groupId]) {
      clearTimeout(debouncedGroupChatTimers[groupId]);
      delete debouncedGroupChatTimers[groupId];
    }

    if (!pending) {
      return;
    }

    delete debouncedGroupChatSaves[groupId];
    localStorage.setItem(STORAGE_KEYS.groupChatPrefix + groupId, JSON.stringify(pending || []));
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
      id: String(memoryItem.id || createId("memory")),
      content: String(memoryItem.content),
      source: memoryItem.source || "private",
      generationId: String(memoryItem.generationId || memoryItem.sourceGenerationId || ""),
      sourceGenerationId: String(memoryItem.sourceGenerationId || memoryItem.generationId || ""),
      targetType: String(memoryItem.targetType || ""),
      targetId: String(memoryItem.targetId || ""),
      relatedCharacterIds: Array.isArray(memoryItem.relatedCharacterIds) ? memoryItem.relatedCharacterIds.map(String) : [],
      relatedMessageIds: Array.isArray(memoryItem.relatedMessageIds) ? memoryItem.relatedMessageIds.map(String) : [],
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

  function formatRecentGroupMessageForContext(message) {
    if (!message || !message.content) {
      return "";
    }

    if (message.type === "redPacket") {
      return "红包：" + (message.content || "恭喜发财，大吉大利");
    }
    if (message.type === "transfer") {
      return "转账：" + (normalizeMoneyAmount(message.amount) || "");
    }
    if (message.type === "location") {
      return "位置：" + ((message.location && message.location.name) || message.content || "");
    }
    if (message.type === "emoji") {
      return message.emoji && message.emoji.type === "text"
        ? "表情：" + message.emoji.value
        : "图片表情";
    }
    if (message.type === "voice") {
      return "语音：" + ((message.voice && message.voice.text) || message.content || "");
    }

    return message.content;
  }

  function getRecentGroupContextForCharacter(characterId, limit) {
    var groups = getGroups();
    var perGroupLimit = Math.max(6, Math.min(16, Number(limit) || 16));
    var maxTotalLength = 1500;
    var now = Date.now();
    var recentWindowMs = 20 * 60 * 1000; // 20 minutes
    var summaries = [];

    if (!characterId || !groups.length) {
      return "";
    }

    // try to resolve character name for simple mention detection
    var characterName = "";
    try {
      var chars = getCharacters();
      var found = (chars || []).find(function (c) { return c && String(c.id) === String(characterId); });
      characterName = found && found.name ? String(found.name) : "";
    } catch (e) {
      characterName = "";
    }

    groups.forEach(function (group) {
      if (!group || !Array.isArray(group.memberIds) || group.memberIds.indexOf(characterId) === -1) {
        return;
      }

      var history = (getGroupChatHistory(group.id) || []).filter(function (message) {
        return message && message.content && message.type !== "loading" && message.type !== "error";
      });

      if (!history.length) {
        return;
      }

      // score and pick candidates
      var candidates = history.map(function (m) {
        var score = 0;
        if (!m || !m.content) {
          return null;
        }
        if (m.role === "user") {
          score += 40;
        }
        if (m.role === "character" && String(m.characterId) === String(characterId)) {
          score += 60;
        }
        if (characterName && m.content.indexOf(characterName) !== -1) {
          score += 35;
        }
        if (now - Number(m.createdAt || 0) <= recentWindowMs) {
          score += 20;
        }
        // small bonus for short, direct messages
        if (typeof m.content === "string" && m.content.length < 120) {
          score += 5;
        }

        return { msg: m, score: score, ts: Number(m.createdAt) || 0 };
      }).filter(Boolean);

      if (!candidates.length) {
        return;
      }

      candidates.sort(function (a, b) {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return b.ts - a.ts;
      });

      var picked = candidates.slice(0, perGroupLimit);
      var lines = picked.map(function (it) {
        var m = it.msg;
        var actor = m.role === "user" ? "用户" : (String(m.characterId) === String(characterId) ? "你" : (m.characterName || "某人"));
        return "- " + actor + "：" + formatRecentGroupMessageForContext(m);
      });

      // explicit current-role summary for this group
      var own = history.filter(function (m) { return m && m.role === "character" && String(m.characterId) === String(characterId); }).slice(-3).map(function (m) { return formatRecentGroupMessageForContext(m); });
      if (own.length) {
        lines.push("- 当前角色当时说/听到：" + own.join(" / "));
      }

      summaries.push({
        groupName: group.name || "群聊",
        createdAt: picked.length ? (Number(picked[0].msg.createdAt) || now) : now,
        text: "群聊《" + (group.name || "群聊") + "》刚刚发生：\n" + lines.join("\n")
      });
    });

    if (!summaries.length) {
      return "";
    }

    // sort by recent group activity
    summaries.sort(function (a, b) { return b.createdAt - a.createdAt; });

    var out = [];
    var total = 0;
    for (var i = 0; i < summaries.length; i++) {
      var s = summaries[i].text;
      if (total + s.length > maxTotalLength) {
        var remaining = Math.max(0, maxTotalLength - total);
        if (remaining > 20) {
          out.push(s.slice(0, remaining));
        }
        break;
      }
      out.push(s);
      total += s.length;
    }

    return out.join("\n\n");
  }

  function normalizeBridgeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function truncateBridgeText(text, maxLength) {
    text = String(text || "");
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, Math.max(0, maxLength - 3)) + "...";
  }

  function collectRecentChatRounds(messages, rounds) {
    var result = [];
    var current = [];
    var i;

    if (!Array.isArray(messages) || !messages.length || !Number.isFinite(rounds) || rounds <= 0) {
      return result;
    }

    for (i = messages.length - 1; i >= 0 && result.length < rounds; i -= 1) {
      var msg = messages[i];
      if (!msg || !msg.content || msg.type === "loading" || msg.type === "error" || msg.type === "system") {
        continue;
      }
      if (msg.role === "user") {
        current.unshift(msg);
        result.unshift(current.slice());
        current = [];
        continue;
      }
      if (msg.role === "character") {
        current.unshift(msg);
      }
    }

    if (current.length && result.length < rounds) {
      result.unshift(current.slice());
    }

    return result;
  }

  function buildBridgeMessageLine(message, currentCharacterId, userName) {
    if (!message || !message.content) {
      return "";
    }

    var content = normalizeBridgeText(message.content);
    if (message.role === "user") {
      return "- 用户：" + content;
    }

    if (message.role === "character") {
      if (String(message.characterId) === String(currentCharacterId)) {
        return "- 当前角色：" + content;
      }
      return "- " + (String(message.characterName || "角色")) + "：" + content;
    }

    return "";
  }

  function containsMention(text, keys) {
    var content = normalizeBridgeText(text).toLowerCase();
    return (keys || []).some(function (key) {
      return key && content.indexOf(String(key || "").toLowerCase()) !== -1;
    });
  }

  function buildBridgeMessageKeys(character) {
    var keys = [];
    if (character && character.chatSettings && character.chatSettings.userPersonaOverride && character.chatSettings.userPersonaOverride.name) {
      keys.push(String(character.chatSettings.userPersonaOverride.name || "").trim());
    }
    var profile = getUserProfile();
    if (profile && profile.name) {
      keys.push(String(profile.name || "").trim());
    }
    keys.push("用户", "我", "你");
    return keys.filter(function (item, index, array) {
      return item && array.indexOf(item) === index;
    });
  }

  function isPrivateBridgeKeyMessage(message, prevMessage, nextMessage, currentCharacterId) {
    if (!message || message.role !== "character") {
      return false;
    }

    if (prevMessage && prevMessage.role === "character" && String(prevMessage.characterId) !== String(message.characterId)) {
      return true;
    }
    if (nextMessage && nextMessage.role === "character" && String(nextMessage.characterId) !== String(message.characterId)) {
      return true;
    }

    var content = normalizeBridgeText(message.content).toLowerCase();
    if (content.indexOf("？") !== -1 || content.indexOf("?") !== -1 || content.indexOf("！") !== -1 || content.indexOf("!") !== -1 || content.indexOf("…") !== -1) {
      return true;
    }

    var triggerWords = ["怎么", "为什么", "别", "不要", "还是", "又", "不过", "可是", "真是", "真的", "你说", "问", "追问", "冲突", "拆台", "暧昧", "质问", "责怪", "挑衅", "挑逗", "撩"];
    return triggerWords.some(function (word) {
      return content.indexOf(word) !== -1;
    });
  }

  function getPrivateMemoryBridgeContext(characterId, options) {
    var params = options && typeof options === "object" ? options : {};
    var groupIds = Array.isArray(params.groupIds) ? params.groupIds.map(String).filter(Boolean) : [];
    var rounds = Number(params.rounds) || 10;
    var maxLength = 2200;
    var groups = getGroups();
    var characters = getCharacters();
    var character = characters.find(function (c) { return String(c.id) === String(characterId); });
    var out = [];

    if (!characterId || !groupIds.length || !groups.length) {
      return "";
    }

    var userKeys = buildBridgeMessageKeys(character);
    var userName = userKeys[0] || "用户";

    function collectRoundCandidates(round) {
      var candidates = [];
      var selectedScores = {};
      var selectedIndexes = {};
      var isDirectReplyIndex = {};

      round.forEach(function (message, index) {
        if (!message || !message.content) {
          return;
        }

        if (message.role === "user") {
          selectedIndexes[index] = true;
          selectedScores[index] = 100;
          return;
        }

        if (message.role === "character") {
          if (String(message.characterId) === String(characterId)) {
            selectedIndexes[index] = true;
            selectedScores[index] = 95;
            return;
          }

          var prevMessage = round[index - 1];
          var nextMessage = round[index + 1];
          var directReply = prevMessage && prevMessage.role === "user";
          if (directReply) {
            selectedIndexes[index] = true;
            selectedScores[index] = 90;
            isDirectReplyIndex[index] = true;
            return;
          }

          if (containsMention(message.content, userKeys) || isPrivateBridgeKeyMessage(message, prevMessage, nextMessage, characterId)) {
            selectedIndexes[index] = true;
            selectedScores[index] = 70;
            return;
          }

          candidates.push(index);
        }
      });

      Object.keys(selectedIndexes).forEach(function (key) {
        var index = Number(key);
        for (var delta = -2; delta <= 2; delta += 1) {
          var pivot = index + delta;
          if (pivot < 0 || pivot >= round.length) {
            continue;
          }
          if (!round[pivot] || !round[pivot].content || round[pivot].type === "loading" || round[pivot].type === "error" || round[pivot].type === "system") {
            continue;
          }
          if (!selectedIndexes[pivot]) {
            selectedIndexes[pivot] = true;
            selectedScores[pivot] = 60 - Math.abs(delta) * 5;
          }
        }
      });

      candidates.forEach(function (index) {
        if (selectedIndexes[index]) {
          return;
        }
        var message = round[index];
        var prevMessage = round[index - 1];
        var nextMessage = round[index + 1];
        if (prevMessage && prevMessage.role === "character" && nextMessage && nextMessage.role === "character" && String(prevMessage.characterId) !== String(message.characterId) && String(nextMessage.characterId) !== String(message.characterId)) {
          selectedIndexes[index] = true;
          selectedScores[index] = 65;
        }
      });

      Object.keys(selectedIndexes).forEach(function (key) {
        var index = Number(key);
        candidates.push(index);
      });

      candidates = candidates.filter(function (index, pos) {
        return candidates.indexOf(index) === pos;
      });

      candidates.sort(function (a, b) {
        var scoreA = selectedScores[a] || 0;
        var scoreB = selectedScores[b] || 0;
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
        return a - b;
      });

      var keepCount = Math.min(candidates.length, 16);
      var kept = candidates.slice(0, keepCount).sort(function (a, b) { return a - b; });
      return kept.map(function (index) { return round[index]; });
    }

    (groups || []).forEach(function (group) {
      if (!group || !Array.isArray(group.memberIds) || groupIds.indexOf(String(group.id)) === -1) {
        return;
      }
      if (group.memberIds.indexOf(String(characterId)) === -1) {
        return;
      }

      var history = (getGroupChatHistory(group.id) || []).filter(function (message) {
        return message && message.content && message.type !== "loading" && message.type !== "error" && message.type !== "system";
      });
      if (!history.length) {
        return;
      }

      var roundsList = collectRecentChatRounds(history, rounds);
      if (!roundsList.length) {
        return;
      }

      var groupName = group.name || "群聊";
      var lines = [];
      roundsList.forEach(function (round) {
        var selectedMessages = collectRoundCandidates(round);
        selectedMessages.forEach(function (message) {
          if (!message || !message.content) {
            return;
          }
          lines.push(buildBridgeMessageLine(message, characterId, userName));
        });
      });

      if (!lines.length) {
        return;
      }

      if (lines.length > 16) {
        lines = lines.slice(0, 16);
      }

      var groupText = "群聊《" + groupName + "》最近发生：\n" + lines.join("\n");
      if (out.join("\n").length + groupText.length > maxLength) {
        groupText = truncateBridgeText(groupText, Math.max(0, maxLength - out.join("\n").length));
      }
      if (groupText) {
        out.push(groupText);
      }
    });

    if (!out.length) {
      return "";
    }

    var result = out.join("\n\n");
    return truncateBridgeText(result, maxLength);
  }

  function getGroupPrivateMemoryBridgeContext(groupId, options) {
    var params = options && typeof options === "object" ? options : {};
    var characterIds = Array.isArray(params.characterIds) ? params.characterIds.map(String).filter(Boolean) : [];
    var rounds = Number(params.rounds) || 5;
    var maxLength = 2200;
    var group = getGroups().find(function (g) { return String(g.id) === String(groupId); });
    var characters = getCharacters();
    var out = [];

    if (!group || !Array.isArray(group.memberIds) || !characterIds.length) {
      return "";
    }

    characterIds.forEach(function (characterId) {
      if (group.memberIds.indexOf(String(characterId)) === -1) {
        return;
      }

      var character = characters.find(function (c) { return String(c.id) === String(characterId); });
      var history = (getChatHistory(characterId) || []).filter(function (message) {
        return message && message.content && message.type !== "loading" && message.type !== "error" && message.type !== "system";
      });

      if (!history.length) {
        return;
      }

      var roundsList = collectRecentChatRounds(history, rounds);
      if (!roundsList.length) {
        return;
      }

      var lines = [];
      roundsList.forEach(function (round) {
        round.forEach(function (message) {
          if (!message || !message.content) {
            return;
          }
          lines.push(buildBridgeMessageLine(message, characterId, "用户"));
        });
      });

      if (!lines.length) {
        return;
      }

      var name = (character && character.name) ? character.name : "角色";
      var section = "角色 " + name + " 最近和用户私聊：\n" + lines.join("\n");
      if (out.join("\n").length + section.length > maxLength) {
        section = truncateBridgeText(section, Math.max(0, maxLength - out.join("\n").length));
      }
      if (section) {
        out.push(section);
      }
    });

    if (!out.length) {
      return "";
    }

    return truncateBridgeText(out.join("\n\n"), maxLength);
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
      generationId: String(source.generationId || source.sourceGenerationId || ""),
      sourceGenerationId: String(source.sourceGenerationId || source.generationId || ""),
      targetType: String(source.targetType || ""),
      targetId: String(source.targetId || ""),
      relatedMessageIds: Array.isArray(source.relatedMessageIds) ? source.relatedMessageIds.map(String) : [],
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
    var migration;
    var v1;

    states = states && typeof states === "object" && !Array.isArray(states) ? states : {};
    v1 = runBodyStateMigrationV1(states);
    if (v1.changed) {
      states = v1.states;
    }
    migration = migrateBodyStateStoreParts(states);

    if (v1.changed || migration.changed) {
      saveBodyStateStore(migration.states);
    }

    return migration.states;
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

  function getBodyStateSnapshotStore() {
    var snapshots = parseJson(localStorage.getItem(STORAGE_KEYS.bodyStateSnapshots), {});
    return snapshots && typeof snapshots === "object" && !Array.isArray(snapshots) ? snapshots : {};
  }

  function saveBodyStateSnapshotStore(snapshots) {
    localStorage.setItem(STORAGE_KEYS.bodyStateSnapshots, JSON.stringify(snapshots || {}));
  }

  function saveBodyStateSnapshot(generationId, targetType, targetId, oldBodyState) {
    var snapshots;

    if (!generationId || !targetId) {
      return null;
    }

    snapshots = getBodyStateSnapshotStore();
    snapshots[String(generationId)] = {
      generationId: String(generationId),
      targetType: targetType === "group" ? "group" : (targetType === "offline" ? "offline" : "private"),
      targetId: String(targetId),
      beforeSnapshot: normalizeBodyState(oldBodyState || {}),
      createdAt: Date.now()
    };
    saveBodyStateSnapshotStore(snapshots);
    return snapshots[String(generationId)];
  }

  function getBodyStateSnapshot(generationId) {
    var source = getBodyStateSnapshotStore()[String(generationId || "")];

    if (!source || typeof source !== "object") {
      return null;
    }

    return {
      generationId: String(source.generationId || generationId || ""),
      targetType: source.targetType === "group" ? "group" : (source.targetType === "offline" ? "offline" : "private"),
      targetId: String(source.targetId || ""),
      beforeSnapshot: normalizeBodyState(source.beforeSnapshot || {}),
      createdAt: Number(source.createdAt) || 0
    };
  }

  function restoreBodyStateBeforeGenerationIds(targetType, targetId, generationIds) {
    var ids = normalizeGenerationIdList(generationIds);
    var snapshots;

    if (!ids.length) {
      return false;
    }

    snapshots = ids.map(getBodyStateSnapshot).filter(function (snapshot) {
      return snapshot && snapshot.targetType === targetType && snapshot.targetId === String(targetId || "");
    }).sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    if (!snapshots.length) {
      return false;
    }

    saveBodyState(targetType, targetId, snapshots[0].beforeSnapshot);
    return true;
  }

  function clearBodyState(targetType, targetId) {
    var store = getBodyStateStore();
    delete store[getChatScopedKey(targetType, targetId)];
    saveBodyStateStore(store);
  }

  function clearBodyStateSnapshots(targetType, targetId) {
    var snapshots = getBodyStateSnapshotStore();
    var scope = targetType === "group" ? "group" : (targetType === "offline" ? "offline" : "private");
    var normalizedId = String(targetId || "");

    Object.keys(snapshots).forEach(function (key) {
      var snapshot = snapshots[key];
      if (snapshot && snapshot.targetType === scope && snapshot.targetId === normalizedId) {
        delete snapshots[key];
      }
    });

    saveBodyStateSnapshotStore(snapshots);
  }

  function resetPrivateCharacterState(characterId) {
    if (!characterId) {
      return false;
    }

    clearCharacterMemory(characterId);
    clearChatMemories("private", characterId);
    clearCharacterThoughts(characterId);
    saveBodyState("private", characterId, getDefaultBodyState());
    clearBodyStateSnapshots("private", characterId);
    resetChatRoundCounter("private", characterId);
    return true;
  }

  function clearChatThoughts(targetType, targetId) {
    if (!targetId) {
      return false;
    }

    var store = getThoughtStore();
    var normalizedTargetType = targetType === "group" ? "group" : (targetType === "offline" ? "offline" : "private");
    var normalizedTargetId = String(targetId || "");

    Object.keys(store).forEach(function (characterId) {
      var thoughts = Array.isArray(store[characterId]) ? store[characterId] : [];
      var filtered = thoughts.filter(function (thought) {
        if (!thought) {
          return true;
        }

        var thoughtType = String(thought.targetType || thought.source || "").toLowerCase();
        var thoughtTargetId = String(thought.targetId || thought.chatId || thought.groupId || "");

        if (thoughtType === normalizedTargetType || (!thoughtType && thoughtTargetId === normalizedTargetId)) {
          return thoughtTargetId !== normalizedTargetId;
        }

        return true;
      });

      if (filtered.length !== thoughts.length) {
        if (filtered.length) {
          store[characterId] = filtered;
        } else {
          delete store[characterId];
        }
      }
    });

    saveThoughtStore(store);
    return true;
  }

  function resetPrivateChatState(characterId) {
    if (!characterId) {
      return false;
    }

    clearChatMemories("private", characterId);
    clearChatThoughts("private", characterId);
    clearBodyState("private", characterId);
    clearBodyStateSnapshots("private", characterId);
    resetChatRoundCounter("private", characterId);
    return true;
  }

  function clearGroupThoughts(groupId) {
    return clearChatThoughts("group", groupId);
  }

  function resetGroupMemoryState(groupId) {
    if (!groupId) {
      return false;
    }

    clearChatMemories("group", groupId);
    clearGroupThoughts(groupId);
    saveBodyState("group", groupId, getDefaultBodyState());
    clearBodyStateSnapshots("group", groupId);
    resetChatRoundCounter("group", groupId);
    return true;
  }

  function resetAllCharacterMemoryAndStates() {
    getCharacters().forEach(function (character) {
      resetPrivateCharacterState(character.id);
    });
    return true;
  }

  function clearAllBodyStates() {
    saveBodyStateStore({});
  }

  var BODY_STATE_SPAM_NOTES = ["腰背僵硬", "肩颈酸胀", "神经绷紧", "肌肉紧绷", "胃部空泛", "精力大幅下降"];
  var BODY_STATE_OLD_DEFAULT_SUGGESTION = "可适度放慢节奏、补水休息，按剧情节奏和身体反馈调整。";

  function runBodyStateMigrationV1(states) {
    if (localStorage.getItem(STORAGE_KEYS.bodyStateMigrationV1)) {
      return { states: states, changed: false };
    }

    var changed = false;
    var normalized = {};

    Object.keys(states || {}).forEach(function (key) {
      var s = states[key];
      if (!s || typeof s !== "object") {
        normalized[key] = s;
        return;
      }

      var hasSpam = BODY_STATE_SPAM_NOTES.some(function (p) {
        return (s.currentNote || "").indexOf(p) !== -1;
      });
      var isHighPain = (s.painLevel || 0) >= 40 || (s.rednessLevel || 0) >= 40;

      if (hasSpam && !isHighPain) {
        normalized[key] = Object.assign({}, s, {
          sorenessLevel: 0,
          currentNote: "当前无明显不适",
          overallCondition: "正常",
          restNeeded: false,
          recoverySuggestion: "暂无特别需要。"
        });
        changed = true;
        return;
      }

      if (s.recoverySuggestion === BODY_STATE_OLD_DEFAULT_SUGGESTION) {
        normalized[key] = Object.assign({}, s, { recoverySuggestion: "暂无特别需要。" });
        changed = true;
        return;
      }

      normalized[key] = s;
    });

    localStorage.setItem(STORAGE_KEYS.bodyStateMigrationV1, "1");
    return { states: normalized, changed: changed };
  }

  function migrateBodyStateStoreParts(states) {
    var changed = false;
    var normalized = {};

    Object.keys(states || {}).forEach(function (key) {
      var migration = migrateBodyStateParts(states[key]);
      normalized[key] = migration.bodyState;
      if (migration.changed) {
        changed = true;
      }
    });

    return { states: normalized, changed: changed };
  }

  function migrateBodyStateParts(bodyState) {
    var source = bodyState && typeof bodyState === "object" ? bodyState : {};
    var parts = source.parts && typeof source.parts === "object" && !Array.isArray(source.parts) ? source.parts : {};
    var migratedParts = Object.assign({}, parts);
    var changed = false;

    Object.keys(BODY_STATE_PART_ALIASES).forEach(function (oldName) {
      var newName = BODY_STATE_PART_ALIASES[oldName];

      if (!Object.prototype.hasOwnProperty.call(migratedParts, oldName)) {
        return;
      }

      if (Object.prototype.hasOwnProperty.call(migratedParts, newName)) {
        migratedParts[newName] = mergeBodyPartState(migratedParts[newName], migratedParts[oldName]);
      } else {
        migratedParts[newName] = migratedParts[oldName];
      }

      delete migratedParts[oldName];
      changed = true;
    });

    if (!changed) {
      return { bodyState: source, changed: false };
    }

    return {
      bodyState: Object.assign({}, source, { parts: migratedParts }),
      changed: true
    };
  }

  function mergeBodyPartState(primary, legacy) {
    var current = normalizeBodyPartState(primary || {});
    var old = normalizeBodyPartState(legacy || {});

    return {
      status: current.status && current.status !== "正常" ? current.status : old.status,
      soreness: current.soreness || old.soreness,
      pain: current.pain || old.pain,
      redness: current.redness || old.redness,
      notes: [current.notes, old.notes].filter(Boolean).filter(function (note, index, list) {
        return list.indexOf(note) === index;
      }).join("；")
    };
  }

  function normalizeBodyState(bodyState) {
    var migration = migrateBodyStateParts(bodyState);
    var source = migration.bodyState && typeof migration.bodyState === "object" ? migration.bodyState : {};
    var parts = source.parts && typeof source.parts === "object" && !Array.isArray(source.parts) ? source.parts : {};
    var normalizedParts = {};
    var defaultParts = DEFAULT_BODY_STATE_PARTS;

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
      recoverySuggestion: String(source.recoverySuggestion && source.recoverySuggestion !== "可适度放慢节奏、补水休息，按剧情节奏和身体反馈调整。" ? source.recoverySuggestion : "暂无特别需要。"),
      parts: normalizedParts,
      generationId: String(source.generationId || ""),
      targetType: String(source.targetType || ""),
      targetId: String(source.targetId || ""),
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
    if (debouncedOfflineSaves[sessionId]) {
      return Object.assign({}, debouncedOfflineSaves[sessionId], {
        history: Array.isArray(debouncedOfflineSaves[sessionId].history) ? debouncedOfflineSaves[sessionId].history.slice() : []
      });
    }

    return parseJson(localStorage.getItem(STORAGE_KEYS.offlinePrefix + sessionId), null);
  }

  function saveOfflineSession(session) {
    if (!session || !session.id) {
      return;
    }

    if (debouncedOfflineTimers[session.id]) {
      clearTimeout(debouncedOfflineTimers[session.id]);
      delete debouncedOfflineTimers[session.id];
    }
    delete debouncedOfflineSaves[session.id];
    localStorage.setItem(STORAGE_KEYS.offlinePrefix + session.id, JSON.stringify(session));
  }

  function saveOfflineSessionDebounced(session, delay) {
    if (!session || !session.id) {
      return;
    }

    debouncedOfflineSaves[session.id] = Object.assign({}, session, {
      history: Array.isArray(session.history) ? session.history.slice() : []
    });
    if (debouncedOfflineTimers[session.id]) {
      clearTimeout(debouncedOfflineTimers[session.id]);
    }
    debouncedOfflineTimers[session.id] = setTimeout(function () {
      flushOfflineSessionSave(session.id);
    }, Math.max(40, Number(delay) || 120));
  }

  function flushOfflineSessionSave(sessionId) {
    var pending = debouncedOfflineSaves[sessionId];

    if (debouncedOfflineTimers[sessionId]) {
      clearTimeout(debouncedOfflineTimers[sessionId]);
      delete debouncedOfflineTimers[sessionId];
    }

    if (!pending) {
      return;
    }

    delete debouncedOfflineSaves[sessionId];
    localStorage.setItem(STORAGE_KEYS.offlinePrefix + sessionId, JSON.stringify(pending));
  }

  function flushAllDebouncedSaves() {
    Object.keys(debouncedPrivateChatSaves).forEach(flushChatHistorySave);
    Object.keys(debouncedGroupChatSaves).forEach(flushGroupChatHistorySave);
    Object.keys(debouncedOfflineSaves).forEach(flushOfflineSessionSave);
    Object.keys(debouncedWatchSaves).forEach(flushWatchSessionSave);
  }

  function deleteOfflineSession(sessionId) {
    localStorage.removeItem(STORAGE_KEYS.offlinePrefix + sessionId);
  }

  function deleteOfflineSessionsForTarget(targetType, targetId) {
    var identifier = String(targetId || "");

    if (!identifier) {
      return false;
    }

    var sessions = getAllOfflineSessions();

    Object.keys(sessions).forEach(function (sessionId) {
      var session = sessions[sessionId];

      if (!session) {
        return;
      }

      if (String(session.targetType || "") === String(targetType || "") && String(session.targetId || "") === identifier) {
        if (debouncedOfflineTimers[sessionId]) {
          clearTimeout(debouncedOfflineTimers[sessionId]);
          delete debouncedOfflineTimers[sessionId];
        }
        delete debouncedOfflineSaves[sessionId];
        localStorage.removeItem(STORAGE_KEYS.offlinePrefix + sessionId);
      }
    });

    return true;
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

  function getWatchSession(sessionId) {
    if (!sessionId) {
      return null;
    }

    if (debouncedWatchSaves[sessionId]) {
      return Object.assign({}, debouncedWatchSaves[sessionId], {
        history: Array.isArray(debouncedWatchSaves[sessionId].history) ? debouncedWatchSaves[sessionId].history.slice() : []
      });
    }

    return parseJson(localStorage.getItem(STORAGE_KEYS.watchPrefix + sessionId), null);
  }

  function saveWatchSession(session) {
    if (!session || !session.id) {
      return;
    }

    if (debouncedWatchTimers[session.id]) {
      clearTimeout(debouncedWatchTimers[session.id]);
      delete debouncedWatchTimers[session.id];
    }
    delete debouncedWatchSaves[session.id];
    localStorage.setItem(STORAGE_KEYS.watchPrefix + session.id, JSON.stringify(session));
  }

  function saveWatchSessionDebounced(session, delay) {
    if (!session || !session.id) {
      return;
    }

    debouncedWatchSaves[session.id] = Object.assign({}, session, {
      history: Array.isArray(session.history) ? session.history.slice() : []
    });
    if (debouncedWatchTimers[session.id]) {
      clearTimeout(debouncedWatchTimers[session.id]);
    }
    debouncedWatchTimers[session.id] = setTimeout(function () {
      flushWatchSessionSave(session.id);
    }, Math.max(40, Number(delay) || 120));
  }

  function flushWatchSessionSave(sessionId) {
    var pending = debouncedWatchSaves[sessionId];

    if (debouncedWatchTimers[sessionId]) {
      clearTimeout(debouncedWatchTimers[sessionId]);
      delete debouncedWatchTimers[sessionId];
    }

    if (!pending) {
      return;
    }

    delete debouncedWatchSaves[sessionId];
    localStorage.setItem(STORAGE_KEYS.watchPrefix + sessionId, JSON.stringify(pending));
  }

  function deleteWatchSession(sessionId) {
    if (!sessionId) {
      return;
    }

    if (debouncedWatchTimers[sessionId]) {
      clearTimeout(debouncedWatchTimers[sessionId]);
      delete debouncedWatchTimers[sessionId];
    }
    delete debouncedWatchSaves[sessionId];
    localStorage.removeItem(STORAGE_KEYS.watchPrefix + sessionId);
  }

  function getAllWatchSessions() {
    var prefix = STORAGE_KEYS.watchPrefix;
    var sessions = [];
    var i;
    var key;
    var session;

    for (i = 0; i < localStorage.length; i += 1) {
      key = localStorage.key(i);
      if (key && key.indexOf(prefix) === 0) {
        session = parseJson(localStorage.getItem(key), null);
        if (session && session.id) {
          sessions.push(session);
        }
      }
    }

    return sessions.sort(function (a, b) {
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
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
    removeWorldBookFromChatBindings(bookId);
  }

  function getChatWorldBookStore() {
    return normalizeChatWorldBookStore(parseJson(localStorage.getItem(STORAGE_KEYS.chatWorldBooks), {}));
  }

  function saveChatWorldBookStore(store) {
    localStorage.setItem(STORAGE_KEYS.chatWorldBooks, JSON.stringify(normalizeChatWorldBookStore(store || {})));
  }

  function getChatWorldBookKey(targetType, targetId) {
    return (targetType === "group" ? "group" : "private") + ":" + String(targetId || "");
  }

  function getLegacyChatWorldBookIds(targetType, targetId) {
    var id = String(targetId || "");
    var target;

    if (!id) {
      return [];
    }

    if (targetType === "group") {
      target = getGroups().find(function (group) {
        return group.id === id;
      });
      return normalizeWorldBookIdList(target && target.settings && target.settings.worldBookIds || []);
    }

    target = getCharacters().find(function (character) {
      return character.id === id;
    });
    return normalizeWorldBookIdList(target && target.chatSettings && target.chatSettings.worldBookIds || []);
  }

  function getChatWorldBookIds(targetType, targetId) {
    var key = getChatWorldBookKey(targetType, targetId);
    var store = getChatWorldBookStore();

    if (Object.prototype.hasOwnProperty.call(store, key)) {
      return store[key].slice();
    }

    return getLegacyChatWorldBookIds(targetType === "group" ? "group" : "private", targetId);
  }

  function setChatWorldBookIds(targetType, targetId, ids) {
    var key = getChatWorldBookKey(targetType, targetId);
    var store = getChatWorldBookStore();
    var normalized = normalizeWorldBookIdList(ids);

    if (!String(targetId || "")) {
      return [];
    }

    if (normalized.length) {
      store[key] = normalized;
    } else {
      delete store[key];
    }

    saveChatWorldBookStore(store);
    return normalized.slice();
  }

  function clearChatWorldBooks(targetType, targetId) {
    setChatWorldBookIds(targetType, targetId, []);
  }

  function toggleChatWorldBook(targetType, targetId, bookId) {
    var ids = getChatWorldBookIds(targetType, targetId);
    var id = String(bookId || "");
    var index;

    if (!id) {
      return ids;
    }

    index = ids.indexOf(id);
    if (index === -1) {
      ids.push(id);
    } else {
      ids.splice(index, 1);
    }

    return setChatWorldBookIds(targetType, targetId, ids);
  }

  function getSelectedWorldBooksForChat(targetType, targetId) {
    var selectedIds = getChatWorldBookIds(targetType, targetId);

    return getWorldBooks().filter(function (book) {
      return selectedIds.indexOf(book.id) !== -1;
    });
  }

  function removeWorldBookFromChatBindings(bookId) {
    var id = String(bookId || "");
    var store;
    var changed = false;

    if (!id) {
      return;
    }

    store = getChatWorldBookStore();
    Object.keys(store).forEach(function (key) {
      var next = store[key].filter(function (item) {
        return item !== id;
      });

      if (next.length !== store[key].length) {
        changed = true;
        if (next.length) {
          store[key] = next;
        } else {
          delete store[key];
        }
      }
    });

    if (changed) {
      saveChatWorldBookStore(store);
    }
  }

  function getMatchedWorldBookEntries(contextText, scope, targetId, options) {
    var rawText = String(contextText || "");
    var text = rawText.toLowerCase();
    var target = String(targetId || "");
    var source = options || {};
    var hasSelectedFilter = Object.prototype.hasOwnProperty.call(source, "selectedWorldBookIds")
      || Object.prototype.hasOwnProperty.call(source, "allowedBookIds");
    var selectedWorldBookIds = normalizeWorldBookIdList(source.selectedWorldBookIds || source.allowedBookIds || []);
    var relatedTargetIds = normalizeWorldBookTargetIds(source.relatedTargetIds || source.characterIds || source.memberIds || []);
    var matched = [];
    var contextTokens = extractWorldBookTokens(rawText);

    if (hasSelectedFilter && !selectedWorldBookIds.length) {
      return [];
    }

    getWorldBooks().forEach(function (book) {
      if (hasSelectedFilter && selectedWorldBookIds.indexOf(book.id) === -1) {
        return;
      }

      if (!book.enabled || !isWorldBookInScope(book, scope, target, relatedTargetIds)) {
        return;
      }

      (book.entries || []).forEach(function (entry) {
        if (!entry.enabled || !isWorldBookEntryInScope(entry, scope, target, relatedTargetIds)) {
          return;
        }

        var keywords = normalizeWorldBookKeywords(entry);
        var alwaysActive = isWorldBookEntryAlwaysActive(entry, book);
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
        var groupScore = entry.group && text.indexOf(String(entry.group).toLowerCase()) !== -1 ? 2 : 0;
        var contentScore = contextTokens.reduce(function (score, token) {
          if (!token || token.length < 2) {
            return score;
          }
          return String(entry.content || "").toLowerCase().indexOf(token) !== -1 ? score + 1 : score;
        }, 0);
        var baseScore = keywordScore + titleScore + groupScore + Math.min(contentScore, 6);
        var priority = Number(entry.priority) || 0;
        var score = baseScore + priority + (alwaysActive ? 100 : 0);
        var shouldInclude = alwaysActive || baseScore > 0 || (!keywords.length && priority >= 8);

        if (shouldInclude) {
          matched.push(Object.assign({}, entry, {
            bookName: book.name,
            bookDescription: book.description,
            bookScope: book.scope,
            bookTargetIds: book.targetIds.slice(),
            keywords: keywords,
            alwaysActive: Boolean(alwaysActive),
            matchType: alwaysActive ? "常驻现实规则" : (baseScore > 0 ? "关键词/上下文命中" : "高优先级命中"),
            matchScore: score
          }));
        }
      });
    });

    if (!matched.length) {
      matched = getFallbackWorldBookEntries(scope, target, relatedTargetIds, hasSelectedFilter ? selectedWorldBookIds : null);
    }

    return matched.sort(function (a, b) {
      var scoreGap = (Number(b.matchScore) || 0) - (Number(a.matchScore) || 0);

      if (scoreGap) {
        return scoreGap;
      }

      return (Number(b.priority) || 0) - (Number(a.priority) || 0);
    }).slice(0, 10);
  }

  function getFallbackWorldBookEntries(scope, targetId, relatedTargetIds, allowedBookIds) {
    var fallback = [];
    var selectedWorldBookIds = Array.isArray(allowedBookIds) ? allowedBookIds : null;

    getWorldBooks().forEach(function (book) {
      if (selectedWorldBookIds && selectedWorldBookIds.indexOf(book.id) === -1) {
        return;
      }

      if (!book.enabled || !isWorldBookFallbackEligible(book, scope, targetId, relatedTargetIds)) {
        return;
      }

      (book.entries || []).forEach(function (entry) {
        var priority = Number(entry.priority) || 0;
        var alwaysActive = isWorldBookEntryAlwaysActive(entry, book);

        if (!entry.enabled || !isWorldBookEntryInScope(entry, scope, targetId, relatedTargetIds)) {
          return;
        }

        if (!alwaysActive && priority < 8) {
          return;
        }

        fallback.push(Object.assign({}, entry, {
          bookName: book.name,
          bookDescription: book.description,
          bookScope: book.scope,
          bookTargetIds: book.targetIds.slice(),
          keywords: normalizeWorldBookKeywords(entry),
          alwaysActive: Boolean(alwaysActive),
          matchType: alwaysActive ? "常驻现实规则" : "高优先级兜底",
          matchScore: (alwaysActive ? 80 : 40) + priority
        }));
      });
    });

    return fallback.sort(function (a, b) {
      var pinnedGap = Number(Boolean(b.alwaysActive)) - Number(Boolean(a.alwaysActive));
      if (pinnedGap) {
        return pinnedGap;
      }
      return (Number(b.priority) || 0) - (Number(a.priority) || 0);
    }).slice(0, 3);
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

  function isWorldBookInScope(book, scope, targetId, relatedTargetIds) {
    var ids = normalizeWorldBookTargetIds(relatedTargetIds);

    if (book.scope === "global" || book.scope === "all") {
      return true;
    }

    if (book.scope !== scope) {
      return scope === "group"
        && book.scope === "private"
        && book.targetIds.length
        && ids.some(function (id) {
          return book.targetIds.indexOf(id) !== -1;
        });
    }

    return !book.targetIds.length
      || book.targetIds.indexOf(targetId) !== -1
      || ids.some(function (id) {
        return book.targetIds.indexOf(id) !== -1;
      });
  }

  function isWorldBookFallbackEligible(book, scope, targetId, relatedTargetIds) {
    if (book.scope === "global" || book.scope === "all" || book.alwaysActive || book.pinned) {
      return true;
    }

    return isWorldBookInScope(book, scope, targetId, relatedTargetIds) && book.targetIds.length > 0;
  }

  function isWorldBookEntryInScope(entry, scope, targetId, relatedTargetIds) {
    var entryScope = String(entry.scope || "").trim();
    var ids = normalizeWorldBookTargetIds(relatedTargetIds);

    if (entryScope && entryScope !== "global" && entryScope !== "all" && entryScope !== scope) {
      if (!(scope === "group" && entryScope === "private" && entry.targetIds && entry.targetIds.length && ids.some(function (id) {
        return entry.targetIds.indexOf(id) !== -1;
      }))) {
      return false;
      }
    }

    if (!entry.targetIds || !entry.targetIds.length) {
      return true;
    }

    return entry.targetIds.indexOf(targetId) !== -1
      || ids.some(function (id) {
        return entry.targetIds.indexOf(id) !== -1;
      });
  }

  function isWorldBookEntryAlwaysActive(entry, book) {
    return Boolean(entry && (entry.alwaysActive || entry.pinned || entry.isPinned || entry.constant || entry.常驻 || entry["常驻"]))
      || Boolean(book && (book.alwaysActive || book.pinned || book.isPinned || book.constant || book.常驻 || book["常驻"]));
  }

  function normalizeWorldBookScope(scope) {
    var value = String(scope || "").toLowerCase();

    if (value === "private" || value === "group" || value === "global" || value === "all") {
      return value;
    }

    return "global";
  }

  function normalizeWorldBookTargetIds(value) {
    var list = Array.isArray(value) ? value : (value ? String(value).split(/[,，\s]+/) : []);

    return list.map(function (item) {
      return String(item || "").trim();
    }).filter(Boolean).filter(function (item, index, all) {
      return all.indexOf(item) === index;
    });
  }

  function normalizeWorldBookIdList(value) {
    var list = Array.isArray(value) ? value : (value ? String(value).split(/[,，\s]+/) : []);

    return list.map(function (item) {
      return String(item || "").trim();
    }).filter(Boolean).filter(function (item, index, all) {
      return all.indexOf(item) === index;
    });
  }

  function normalizeWorldBookKeywords(entry) {
    var source = entry && typeof entry === "object" ? entry : {};
    var values = [];

    if (source.keyword) {
      values = values.concat(String(source.keyword).split(/[,，\s]+/));
    }

    if (Array.isArray(source.keywords)) {
      values = values.concat(source.keywords);
    } else if (source.keywords) {
      values = values.concat(String(source.keywords).split(/[,，\s]+/));
    }

    return values.map(function (keyword) {
      return String(keyword || "").trim();
    }).filter(Boolean).filter(function (keyword, index, all) {
      return all.indexOf(keyword) === index;
    });
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

  function normalizeThoughtMood(thought, recentThoughts) {
    var source = thought && typeof thought === "object" ? thought : {};
    var currentMood = String(source.mood || "").trim();
    var recentMoods = (Array.isArray(recentThoughts) ? recentThoughts : []).slice(0, 3).map(function (item) {
      return String(item && item.mood || "").trim();
    }).filter(Boolean);

    if (currentMood && !isGenericThoughtMood(currentMood) && recentMoods.indexOf(currentMood) === -1) {
      return currentMood;
    }

    return inferThoughtMood(source, recentMoods, currentMood);
  }

  function isGenericThoughtMood(mood) {
    return ["复杂", "紧张", "平静", "烦躁"].indexOf(String(mood || "").trim()) !== -1;
  }

  function inferThoughtMood(thought, recentMoods, fallbackMood) {
    var source = thought && typeof thought === "object" ? thought : {};
    var text = [source.content, source.visibleSummary || source.summary].join(" ");
    var candidates = [];
    var fallbackCandidates = [
      "嘴硬的在意",
      "压着火",
      "不想低头",
      "被戳穿后的不快",
      "心软但不认",
      "试探",
      "冷处理",
      "占有欲上来",
      "想靠近又克制",
      "怕露怯",
      "想压住你"
    ];
    var addIf = function (pattern, mood) {
      if (pattern.test(text)) {
        candidates.push(mood);
      }
    };
    var choose;

    addIf(/占有|吃醋|我的|不许|别碰|抢|独占|归我/, "占有欲上来");
    addIf(/嘴硬|不承认|才不|没事|算了|别管|装作|不在意/, "嘴硬的在意");
    addIf(/心软|舍不得|不忍|想哄|放不下|又疼|又想管/, "心软但不认");
    addIf(/试探|看看|底线|逼问|套话|反问|探一探/, "试探");
    addIf(/冷|不理|沉默|晾|回避|避开|淡下去/, "冷处理");
    addIf(/低头|认错|服软|台阶|输了|让步|不肯/, "不想低头");
    addIf(/戳穿|看穿|拆穿|说中|被发现|露馅/, "被戳穿后的不快");
    addIf(/火|气|怒|烦|忍着|压住|不耐烦|发作/, "压着火");
    addIf(/怕|慌|急|担心|不安|露怯|心虚/, "怕露怯");
    addIf(/靠近|抱|亲|碰|贴|想要|克制|忍住/, "想靠近又克制");
    addIf(/控制|管住|听话|规矩|边界|压制|掌控|上位/, "想压住你");

    candidates = candidates.concat(fallbackCandidates);
    choose = candidates.find(function (mood) {
      return mood && recentMoods.indexOf(mood) === -1 && mood !== fallbackMood;
    });

    return choose || candidates[0] || fallbackMood || "试探";
  }

  function normalizeThoughtComparableText(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[\s，。！？、；：,.!?;:"'“”‘’（）()[\]{}<>《》\-—_]/g, "");
  }

  function areThoughtTextsHighlySimilar(first, second) {
    var a = normalizeThoughtComparableText(first);
    var b = normalizeThoughtComparableText(second);
    var chars;
    var overlap = 0;

    if (!a && !b) {
      return true;
    }

    if (!a || !b) {
      return false;
    }

    if (a === b) {
      return true;
    }

    if (Math.min(a.length, b.length) >= 12 && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1)) {
      return true;
    }

    chars = Array.from(new Set(a.split("")));
    chars.forEach(function (char) {
      if (b.indexOf(char) !== -1) {
        overlap += 1;
      }
    });

    return Math.min(a.length, b.length) >= 16 && overlap / Math.max(chars.length, Array.from(new Set(b.split(""))).length) >= 0.86;
  }

  function shouldSkipThought(existingThoughts, newThought) {
    var source = newThought && typeof newThought === "object" ? newThought : {};
    var newMood = String(source.mood || "").trim();
    var newContent = String(source.content || "").trim();
    var newSummary = String(source.visibleSummary || source.summary || "").trim();
    var last;

    if (!existingThoughts || !existingThoughts.length) {
      return false;
    }

    last = existingThoughts[0];

    if (last) {
      var lastMood = String(last.mood || "").trim();
      var lastContent = String(last.content || "").trim();
      var lastSummary = String(last.visibleSummary || "").trim();

      if (areThoughtTextsHighlySimilar(newContent, lastContent)
          && newMood
          && lastMood === newMood
          && areThoughtTextsHighlySimilar(newSummary, lastSummary)) {
        return true;
      }

      if (areThoughtTextsHighlySimilar(newContent, lastContent)
          && newMood
          && lastMood === newMood
          && areThoughtTextsHighlySimilar(newSummary || newContent, lastSummary || lastContent)) {
        return true;
      }
    }

    return false;
  }

  function addCharacterThought(characterId, thought) {
    var thoughts;
    var source = thought && typeof thought === "object" ? thought : {};

    if (!characterId || !source.content) {
      return null;
    }

    thoughts = getCharacterThoughts(characterId);
    source = Object.assign({}, source, {
      mood: normalizeThoughtMood(source, thoughts)
    });

    if (shouldSkipThought(thoughts, source)) {
      return null;
    }

    thoughts.unshift({
      id: String(source.id || Date.now() + Math.random()),
      source: source.source || "private",
      chatId: String(source.chatId || characterId),
      content: String(source.content || ""),
      mood: String(source.mood || ""),
      visibleSummary: String(source.visibleSummary || source.summary || ""),
      generationId: String(source.generationId || source.sourceGenerationId || ""),
      sourceGenerationId: String(source.sourceGenerationId || source.generationId || ""),
      targetType: String(source.targetType || source.source || ""),
      targetId: String(source.targetId || source.chatId || ""),
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
    var wallet = normalizeWallet(parseJson(localStorage.getItem(STORAGE_KEYS.wallet), {}));
    var migration = migrateWalletLedgerAmounts(wallet);

    if (migration.changed) {
      persistWallet(migration.wallet);
    }

    return migration.wallet;
  }

  function saveWallet(wallet) {
    var migration = migrateWalletLedgerAmounts(normalizeWallet(wallet || {}));
    persistWallet(migration.wallet);
  }

  function persistWallet(wallet) {
    localStorage.setItem(STORAGE_KEYS.wallet, JSON.stringify(wallet || {}));
  }

  function migrateMoneyMessagesInHistories() {
    var currentVersion = Number(localStorage.getItem(STORAGE_KEYS.moneyMessageMigrationVersion)) || 0;

    if (currentVersion >= 1) {
      return false;
    }

    migrateMoneyMessageHistoryPrefix(STORAGE_KEYS.chatPrefix);
    migrateMoneyMessageHistoryPrefix(STORAGE_KEYS.groupChatPrefix);
    migrateOfflineMoneyMessageHistories();
    localStorage.setItem(STORAGE_KEYS.moneyMessageMigrationVersion, "1");
    return true;
  }

  function migrateMoneyMessageHistoryPrefix(prefix) {
    var index;
    var key;
    var value;
    var migrated;

    for (index = 0; index < localStorage.length; index += 1) {
      key = localStorage.key(index);
      if (!key || key.indexOf(prefix) !== 0) {
        continue;
      }

      value = parseJson(localStorage.getItem(key), []);
      if (!Array.isArray(value)) {
        continue;
      }

      migrated = migrateMoneyMessageArray(value);
      if (migrated.changed) {
        localStorage.setItem(key, JSON.stringify(migrated.items));
      }
    }
  }

  function migrateOfflineMoneyMessageHistories() {
    var index;
    var key;
    var session;
    var changed;
    var inlineStates;

    for (index = 0; index < localStorage.length; index += 1) {
      key = localStorage.key(index);
      if (!key || key.indexOf(STORAGE_KEYS.offlinePrefix) !== 0) {
        continue;
      }

      session = parseJson(localStorage.getItem(key), null);
      if (!session || typeof session !== "object") {
        continue;
      }

      changed = migrateMoneyMessageArraysOnObject(session, ["history", "messages", "events"]);
      if (changed) {
        localStorage.setItem(key, JSON.stringify(session));
      }
    }

    inlineStates = parseJson(localStorage.getItem(STORAGE_KEYS.inlineOffline), null);
    if (inlineStates && typeof inlineStates === "object" && !Array.isArray(inlineStates)) {
      changed = false;
      Object.keys(inlineStates).forEach(function (stateKey) {
        if (migrateMoneyMessageArraysOnObject(inlineStates[stateKey], ["history", "messages", "events"])) {
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem(STORAGE_KEYS.inlineOffline, JSON.stringify(inlineStates));
      }
    }
  }

  function migrateMoneyMessageArraysOnObject(target, fieldNames) {
    var changed = false;

    if (!target || typeof target !== "object") {
      return false;
    }

    (fieldNames || []).forEach(function (fieldName) {
      var migrated;
      if (!Array.isArray(target[fieldName])) {
        return;
      }

      migrated = migrateMoneyMessageArray(target[fieldName]);
      if (migrated.changed) {
        target[fieldName] = migrated.items;
        changed = true;
      }
    });

    return changed;
  }

  function migrateMoneyMessageArray(messages) {
    var changed = false;
    var items = (Array.isArray(messages) ? messages : []).map(function (message) {
      var migrated = migrateOneMoneyMessage(message);
      if (migrated !== message) {
        changed = true;
      }
      return migrated;
    });

    return { items: items, changed: changed };
  }

  function migrateOneMoneyMessage(message) {
    var source = message && typeof message === "object" ? message : null;
    var normalized;

    if (!source || (source.type !== "redPacket" && source.type !== "transfer")) {
      return message;
    }

    normalized = normalizeMoneyMessage(Object.assign({}, source));
    if (normalized) {
      return normalized;
    }

    return Object.assign({}, source, {
      type: "text",
      amount: "",
      note: "",
      status: "",
      content: source.content || source.note || (source.type === "redPacket" ? "红包" : "转账")
    });
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

    source = normalizeMoneyMessage(source);
    if (!source) {
      return message;
    }

    amount = normalizePositiveAmount(source.amount);
    if (!amount) {
      return source;
    }

    if (source.role !== "user") {
      source.received = Boolean(source.received);
      source.walletRecorded = Boolean(source.walletRecorded || source.walletLedgerId);
      source.status = source.status || "pending";
      return source;
    }

    if (source.paymentMethod === "familyCard" && source.familyCardId) {
      record = spendFamilyCard(source.familyCardId, amount, {
        sourceType: info.sourceType || "private",
        sourceId: info.sourceId || "",
        characterId: info.characterId || source.characterId || "",
        groupId: info.groupId || "",
        sourceGenerationId: source.generationId || info.generationId || "",
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
        sourceGenerationId: source.generationId || info.generationId || "",
        note: source.note || source.content || (source.type === "redPacket" ? "红包" : "转账"),
        createdAt: source.createdAt || Date.now()
      }, {
        preventOverdraft: direction === "expense"
      });
    }

    if (record) {
      source.walletLedgerId = record.id;
      source.walletRecorded = true;
      source.paidAt = record.createdAt;
      if (!source.status || source.status === "sent") {
        source.status = "pending";
      }
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

    source = normalizeMoneyMessage(source);
    if (!source) {
      return message;
    }

    if (isMoneyMessageClosed(source)) {
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
      sourceGenerationId: source.generationId || info.generationId || "",
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

  function returnMoneyMessage(message, context) {
    var source = message && typeof message === "object" ? message : null;
    var info = context || {};
    var amount;
    var record;

    if (!source || source.role === "user" || (source.type !== "redPacket" && source.type !== "transfer")) {
      return source;
    }

    source = normalizeMoneyMessage(source);
    if (!source) {
      return message;
    }

    if (isMoneyMessageClosed(source)) {
      return source;
    }

    amount = normalizePositiveAmount(source.amount);
    if (amount) {
      record = addWalletLedger({
        type: source.type === "redPacket" ? "redpacket_return" : "transfer_return",
        amount: amount,
        direction: "expense",
        sourceType: info.sourceType || "private",
        sourceId: info.sourceId || "",
        characterId: info.characterId || source.characterId || "",
        groupId: info.groupId || "",
        sourceGenerationId: source.generationId || info.generationId || "",
        note: "已退回，未入账：" + (source.note || source.content || (source.type === "redPacket" ? "红包" : "转账")),
        createdAt: Date.now()
      }, {
        skipBalance: true
      });
    }

    source.status = "returned";
    source.returnedAt = record ? record.createdAt : Date.now();
    source.returnLedgerId = record ? record.id : "";
    source.received = false;
    source.walletRecorded = false;
    return source;
  }

  function settleOutgoingMoneyMessage(message, decision, context) {
    var source = message && typeof message === "object" ? message : null;
    var info = context || {};
    var normalizedDecision = normalizeMoneyDecision(decision);
    var amount;
    var record;

    if (!source || source.role !== "user" || (source.type !== "redPacket" && source.type !== "transfer")) {
      return source;
    }

    source = normalizeMoneyMessage(source);
    if (!source) {
      return message;
    }

    if (!normalizedDecision || isOutgoingMoneyClosed(source)) {
      return source;
    }

    amount = normalizePositiveAmount(source.amount);
    if (normalizedDecision === "accept") {
      source.status = source.type === "redPacket" ? "received" : "accepted";
      source.acceptedAt = Date.now();
      return source;
    }

    if (amount && !source.refundLedgerId && (source.walletLedgerId || source.walletRecorded)) {
      record = addWalletLedger({
        type: source.type === "redPacket" ? "redpacket_refund" : "transfer_refund",
        amount: amount,
        direction: "income",
        sourceType: info.sourceType || "private",
        sourceId: info.sourceId || "",
        characterId: info.characterId || source.characterId || "",
        groupId: info.groupId || "",
        sourceGenerationId: source.generationId || info.generationId || "",
        note: "对方退回：" + (source.note || source.content || (source.type === "redPacket" ? "红包" : "转账")),
        createdAt: Date.now()
      });
    }

    source.status = "returned";
    source.refunded = Boolean(record || source.refundLedgerId);
    source.returnedAt = record ? record.createdAt : Date.now();
    source.refundLedgerId = record ? record.id : (source.refundLedgerId || "");
    return source;
  }

  function applyMoneyDecision(message, decision, context) {
    var source = message && typeof message === "object" ? message : null;
    var normalizedDecision = normalizeMoneyDecision(decision);

    if (!source || !normalizedDecision) {
      return source;
    }

    if (source.role === "user") {
      return settleOutgoingMoneyMessage(source, normalizedDecision, context);
    }

    return normalizedDecision === "accept"
      ? receiveMoneyMessage(source, context)
      : returnMoneyMessage(source, context);
  }

  function normalizeMoneyDecision(decision) {
    var value = String(decision || "").toLowerCase();
    if (value === "accept" || value === "accepted" || value === "receive" || value === "received") {
      return "accept";
    }
    if (value === "reject" || value === "rejected" || value === "return" || value === "refund" || value === "refuse") {
      return "reject";
    }
    return "";
  }

  function isMoneyMessageClosed(message) {
    var status = message && message.status ? String(message.status) : "";
    return Boolean(message && (
      message.received
      || message.walletLedgerId
      || status === "accepted"
      || status === "received"
      || status === "returned"
      || status === "rejected"
      || status === "refunded"
    ));
  }

  function isOutgoingMoneyClosed(message) {
    var status = message && message.status ? String(message.status) : "";
    return status === "accepted"
      || status === "received"
      || status === "returned"
      || status === "rejected"
      || status === "refunded";
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
      contactGroups: getContactGroups(),
      groupChatHistory: getAllGroupChatHistories(),
      offlineSessions: getAllOfflineSessions(),
      memory: getMemoryStore(),
      chatMemories: getChatMemoryStore(),
      chatRounds: getChatRoundStore(),
      bodyStates: getBodyStateStore(),
      bodyStateSnapshots: getBodyStateSnapshotStore(),
      blockRelations: getBlockRelations(),
      emojiPacks: getEmojiPacks(),
      worldBooks: getWorldBooks(),
      chatWorldBooks: getChatWorldBookStore(),
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
    saveContactGroups(normalized.contactGroups);
    saveMemoryStore(normalized.memory);
    saveChatMemoryStore(normalized.chatMemories);
    saveChatRoundStore(normalized.chatRounds);
    saveBodyStateStore(normalized.bodyStates);
    saveBodyStateSnapshotStore(normalized.bodyStateSnapshots);
    saveBlockRelations(normalized.blockRelations);
    saveEmojiPacks(normalized.emojiPacks);
    saveWorldBooks(normalized.worldBooks);
    saveChatWorldBookStore(normalized.chatWorldBooks);
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

    localStorage.removeItem(STORAGE_KEYS.moneyMessageMigrationVersion);
    migrateMoneyMessagesInHistories();
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
      contactGroups: normalizeContactGroups(data.contactGroups || data.contactGroupList || []),
      groupChatHistory: normalizeMessageMap(data.groupChatHistory || data.groupChatHistories || {}),
      offlineSessions: normalizeOfflineSessions(data.offlineSessions || data.offline || {}),
      memory: normalizeMemory(data.memory || {}),
      chatMemories: normalizeChatMemories(data.chatMemories || data.chatMemory || {}),
      chatRounds: normalizeChatRounds(data.chatRounds || data.roundCounters || {}),
      bodyStates: normalizeBodyStates(data.bodyStates || data.bodyState || {}),
      bodyStateSnapshots: normalizeBodyStateSnapshots(data.bodyStateSnapshots || {}),
      blockRelations: normalizeBlockRelations(data.blockRelations || {}),
      emojiPacks: normalizeEmojiPacks(data.emojiPacks || []),
      worldBooks: normalizeWorldBooks(data.worldBooks || []),
      chatWorldBooks: normalizeChatWorldBookStore(data.chatWorldBooks || data.chatWorldBookBindings || {}),
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

  function normalizeContactGroups(groups) {
    return Array.isArray(groups) ? groups.map(normalizeContactGroup).filter(function (group) {
      return group.name;
    }) : [];
  }

  function normalizeContactGroup(group, index) {
    var source = group && typeof group === "object" ? group : {};
    var now = Date.now();
    var seen = {};

    return {
      id: source.id ? String(source.id) : createId("contact_group") + "_" + (index || 0),
      name: String(source.name || "").trim(),
      memberIds: (Array.isArray(source.memberIds) ? source.memberIds : []).map(String).filter(function (memberId) {
        if (!memberId || seen[memberId]) {
          return false;
        }
        seen[memberId] = true;
        return true;
      }),
      createdAt: Number(source.createdAt) || now,
      updatedAt: Number(source.updatedAt) || Number(source.createdAt) || now
    };
  }

  function normalizePrivateMemoryBridgeSettings(source) {
    source = source && typeof source === "object" && !Array.isArray(source) ? source : {};

    return {
      groupEnabled: source.groupEnabled === true,
      groupIds: Array.isArray(source.groupIds) ? source.groupIds.map(String).filter(Boolean) : [],
      groupRounds: Math.max(3, Math.min(20, Number(source.groupRounds) || 10)),
      includeGroupSummary: source.includeGroupSummary !== false,
      includeRawGroupMessages: source.includeRawGroupMessages !== false
    };
  }

  function normalizeGroupMemoryBridgeSettings(source) {
    source = source && typeof source === "object" && !Array.isArray(source) ? source : {};

    return {
      privateEnabled: source.privateEnabled === true,
      privateCharacterIds: Array.isArray(source.privateCharacterIds) ? source.privateCharacterIds.map(String).filter(Boolean) : [],
      privateRounds: Math.max(3, Math.min(10, Number(source.privateRounds) || 5)),
      includePrivateSummary: source.includePrivateSummary !== false,
      includeRawPrivateMessages: source.includeRawPrivateMessages !== false
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
      worldBookIds: normalizeWorldBookIdList(source.worldBookIds || []),
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
      memoryEnabled: source.memoryEnabled !== false,
      memoryBridge: normalizePrivateMemoryBridgeSettings(source.memoryBridge || {})
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
      worldBookIds: normalizeWorldBookIdList(source.worldBookIds || []),
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
      memoryBridge: normalizeGroupMemoryBridgeSettings(source.memoryBridge || {})
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
            id: String(item && item.id || createId("memory")),
            content: String(item && item.content || ""),
            source: item && item.source ? String(item.source) : "private",
            generationId: String(item && (item.generationId || item.sourceGenerationId) || ""),
            sourceGenerationId: String(item && (item.sourceGenerationId || item.generationId) || ""),
            targetType: String(item && item.targetType || ""),
            targetId: String(item && item.targetId || ""),
            relatedCharacterIds: Array.isArray(item && item.relatedCharacterIds) ? item.relatedCharacterIds.map(String) : [],
            relatedMessageIds: Array.isArray(item && item.relatedMessageIds) ? item.relatedMessageIds.map(String) : [],
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

  function normalizeBodyStateSnapshots(snapshots) {
    var normalized = {};

    if (!snapshots || typeof snapshots !== "object" || Array.isArray(snapshots)) {
      return normalized;
    }

    Object.keys(snapshots).forEach(function (generationId) {
      var source = snapshots[generationId] && typeof snapshots[generationId] === "object" ? snapshots[generationId] : {};
      var id = String(source.generationId || generationId || "");

      if (!id) {
        return;
      }

      normalized[id] = {
        generationId: id,
        targetType: source.targetType === "group" ? "group" : (source.targetType === "offline" ? "offline" : "private"),
        targetId: String(source.targetId || ""),
        beforeSnapshot: normalizeBodyState(source.beforeSnapshot || {}),
        createdAt: Number(source.createdAt) || Date.now()
      };
    });

    return normalized;
  }

  function normalizeBlockRelations(relations) {
    var normalized = {};

    if (!relations || typeof relations !== "object" || Array.isArray(relations)) {
      return normalized;
    }

    Object.keys(relations).forEach(function (key) {
      normalized[String(key)] = normalizeBlockState(relations[key]);
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

  function normalizeChatWorldBookStore(store) {
    var normalized = {};

    if (!store || typeof store !== "object" || Array.isArray(store)) {
      return normalized;
    }

    Object.keys(store).forEach(function (key) {
      normalized[String(key)] = normalizeWorldBookIdList(store[key]);
    });

    return normalized;
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
      scope: normalizeWorldBookScope(source.scope),
      targetIds: normalizeWorldBookTargetIds(source.targetIds || source.targetId || source.characterIds || source.groupIds),
      alwaysActive: Boolean(source.alwaysActive || source.pinned || source.isPinned || source.constant || source.常驻 || source["常驻"]),
      pinned: Boolean(source.pinned || source.isPinned),
      createdAt: Number(source.createdAt) || now,
      updatedAt: Number(source.updatedAt) || now
    };
  }

  function normalizeWorldBookEntry(entry, index) {
    var source = entry && typeof entry === "object" ? entry : {};
    var now = Date.now();
    var content = String(source.content || "");
    var keywords = normalizeWorldBookKeywords(source);
    var keyword = String(source.keyword || keywords[0] || "").trim();

    return {
      id: String(source.id || now + index),
      title: String(source.title || "未命名条目"),
      keyword: keyword,
      keywords: keywords,
      content: content,
      insertPosition: source.insertPosition === "after" ? "after" : "before",
      group: String(source.group || "未分组").trim() || "未分组",
      enabled: source.enabled !== false,
      scope: source.scope ? normalizeWorldBookScope(source.scope) : "",
      targetIds: normalizeWorldBookTargetIds(source.targetIds || source.targetId || source.characterIds || source.groupIds),
      alwaysActive: Boolean(source.alwaysActive || source.pinned || source.isPinned || source.constant || source.常驻 || source["常驻"]),
      pinned: Boolean(source.pinned || source.isPinned),
      summary: String(source.summary || content.slice(0, 90)).trim(),
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
      generationId: String(source.generationId || source.sourceGenerationId || ""),
      sourceGenerationId: String(source.sourceGenerationId || source.generationId || ""),
      targetType: String(source.targetType || source.source || ""),
      targetId: String(source.targetId || source.chatId || ""),
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
      }) : [],
      moneyAmountMigrationVersion: Number(source.moneyAmountMigrationVersion) || 0
    };
  }

  function migrateWalletLedgerAmounts(wallet) {
    var target = wallet || normalizeWallet({});
    var repaired = false;
    var balanceDelta = 0;

    if (target.moneyAmountMigrationVersion >= 2) {
      return { wallet: target, changed: false };
    }

    target.ledger = (target.ledger || []).map(function (record) {
      var amount = Number(record && record.amount);
      var noteAmount;
      var repairedAmount;
      var delta;

      if (!record || !isMoneyLedgerType(record.type) || !shouldRepairLegacyLedgerAmount(amount)) {
        return record;
      }

      noteAmount = normalizeMoneyAmount(record.note);
      if (!noteAmount) {
        return record;
      }

      repairedAmount = Number(noteAmount);
      delta = repairedAmount - (Number.isFinite(amount) ? amount : 0);
      if (shouldLedgerAffectBalance(record) && delta) {
        balanceDelta += record.direction === "income" ? delta : -delta;
      }
      repaired = true;
      return Object.assign({}, record, {
        amount: repairedAmount
      });
    });

    if (balanceDelta) {
      target.balance = Math.max(0, roundAmount((Number(target.balance) || 0) + balanceDelta));
    }
    target.moneyAmountMigrationVersion = 2;
    return { wallet: target, changed: true, repaired: repaired };
  }

  function isMoneyLedgerType(type) {
    var value = String(type || "").toLowerCase();
    return value.indexOf("transfer_") === 0 || value.indexOf("redpacket_") === 0;
  }

  function shouldRepairLegacyLedgerAmount(amount) {
    return !Number.isFinite(amount) || amount === 0 || amount === 20;
  }

  function shouldLedgerAffectBalance(record) {
    var type = String(record && record.type || "").toLowerCase();
    return type !== "transfer_return" && type !== "redpacket_return";
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
    localStorage.removeItem(STORAGE_KEYS.contactGroups);
    localStorage.removeItem(STORAGE_KEYS.memory);
    localStorage.removeItem(STORAGE_KEYS.chatMemories);
    localStorage.removeItem(STORAGE_KEYS.chatRounds);
    localStorage.removeItem(STORAGE_KEYS.bodyStates);
    localStorage.removeItem(STORAGE_KEYS.bodyStateSnapshots);
    localStorage.removeItem(STORAGE_KEYS.blockRelations);
    localStorage.removeItem(STORAGE_KEYS.emojiPacks);
    localStorage.removeItem(STORAGE_KEYS.worldBooks);
    localStorage.removeItem(STORAGE_KEYS.chatWorldBooks);
    localStorage.removeItem(STORAGE_KEYS.thoughts);
    localStorage.removeItem(STORAGE_KEYS.diaries);
    localStorage.removeItem(STORAGE_KEYS.userProfile);
    localStorage.removeItem(STORAGE_KEYS.userPersonas);
    localStorage.removeItem(STORAGE_KEYS.desktopState);
    localStorage.removeItem(STORAGE_KEYS.wechatState);
    localStorage.removeItem(STORAGE_KEYS.moments);
    localStorage.removeItem(STORAGE_KEYS.inlineOffline);
    localStorage.removeItem(STORAGE_KEYS.wallet);
    localStorage.removeItem(STORAGE_KEYS.moneyMessageMigrationVersion);
    localStorage.removeItem(STORAGE_KEYS.shop);
    localStorage.removeItem(STORAGE_KEYS.recentHidden);
    localStorage.removeItem(STORAGE_KEYS.theme);
    localStorage.removeItem(STORAGE_KEYS.photos);
    localStorage.removeItem(STORAGE_KEYS.notes);
    localStorage.removeItem("myAiApp.apiJobs");
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

  function removeGenerationArtifacts(generationIds, options) {
    var ids = normalizeGenerationIdList(generationIds);
    var settings = options || {};

    if (!ids.length) {
      return;
    }

    removeThoughtArtifacts(ids);
    removeCharacterMemoryArtifacts(ids);
    removeChatMemoryArtifacts(ids, settings.targetType, settings.targetId);
    removeWalletLedgerArtifacts(ids);
    if (settings.targetType && settings.targetId) {
      restoreBodyStateBeforeGenerationIds(settings.targetType, settings.targetId, ids);
    }
  }

  function hasGenerationId(value, generationIds) {
    return generationIds.indexOf(String(value || "")) !== -1;
  }

  function removeThoughtArtifacts(generationIds) {
    var store = getThoughtStore();
    var changed = false;

    Object.keys(store).forEach(function (characterId) {
      var next = (Array.isArray(store[characterId]) ? store[characterId] : []).filter(function (thought) {
        return !hasGenerationId(thought.generationId || thought.sourceGenerationId, generationIds);
      });

      if (next.length !== (store[characterId] || []).length) {
        store[characterId] = next;
        changed = true;
      }
    });

    if (changed) {
      saveThoughtStore(store);
    }
  }

  function removeCharacterMemoryArtifacts(generationIds) {
    var store = getMemoryStore();
    var changed = false;

    Object.keys(store).forEach(function (characterId) {
      var next = (Array.isArray(store[characterId]) ? store[characterId] : []).filter(function (memory) {
        return !hasGenerationId(memory && (memory.generationId || memory.sourceGenerationId), generationIds);
      });

      if (next.length !== (store[characterId] || []).length) {
        store[characterId] = next;
        changed = true;
      }
    });

    if (changed) {
      saveMemoryStore(store);
    }
  }

  function removeChatMemoryArtifacts(generationIds, targetType, targetId) {
    var store = getChatMemoryStore();
    var scopedKey = targetType && targetId ? getChatScopedKey(targetType, targetId) : "";
    var changed = false;

    Object.keys(store).forEach(function (key) {
      if (scopedKey && key !== scopedKey) {
        return;
      }

      var next = (Array.isArray(store[key]) ? store[key] : []).filter(function (memory) {
        return !hasGenerationId(memory && (memory.generationId || memory.sourceGenerationId), generationIds);
      });

      if (next.length !== (store[key] || []).length) {
        store[key] = next;
        changed = true;
      }
    });

    if (changed) {
      saveChatMemoryStore(store);
    }
  }

  function removeWalletLedgerArtifacts(generationIds) {
    var wallet = getWallet();
    var removed = [];

    wallet.ledger = (wallet.ledger || []).filter(function (record) {
      var generated = hasGenerationId(record && (record.sourceGenerationId || record.generationId), generationIds)
        && record.manual !== true
        && record.userManual !== true;

      if (generated) {
        removed.push(record);
      }

      return !generated;
    });

    if (!removed.length) {
      return;
    }

    removed.forEach(function (record) {
      var amount = Number(record.amount) || 0;
      if (!amount || !shouldLedgerAffectBalance(record)) {
        return;
      }

      if (record.direction === "income") {
        wallet.balance = roundAmount(wallet.balance - amount);
      } else if (record.direction === "expense") {
        wallet.balance = roundAmount(wallet.balance + amount);
      }
    });

    saveWallet(wallet);
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
    saveChatHistoryDebounced: saveChatHistoryDebounced,
    flushChatHistorySave: flushChatHistorySave,
    deleteChatHistory: deleteChatHistory,
    getBlockState: getBlockState,
    setUserBlockedCharacter: setUserBlockedCharacter,
    setCharacterBlockedUser: setCharacterBlockedUser,
    setBlockReactionTimestamp: setBlockReactionTimestamp,
    isUserBlockedCharacter: isUserBlockedCharacter,
    isCharacterBlockedUser: isCharacterBlockedUser,
    clearBlockState: clearBlockState,
    getGroups: getGroups,
    saveGroups: saveGroups,
    addGroup: addGroup,
    updateGroup: updateGroup,
    deleteGroup: deleteGroup,
    getContactGroups: getContactGroups,
    saveContactGroups: saveContactGroups,
    addContactGroup: addContactGroup,
    updateContactGroup: updateContactGroup,
    deleteContactGroup: deleteContactGroup,
    canCharactersInteractInMoments: canCharactersInteractInMoments,
    getGroupChatHistory: getGroupChatHistory,
    saveGroupChatHistory: saveGroupChatHistory,
    saveGroupChatHistoryDebounced: saveGroupChatHistoryDebounced,
    flushGroupChatHistorySave: flushGroupChatHistorySave,
    deleteGroupChatHistory: deleteGroupChatHistory,
    getEmojiPacks: getEmojiPacks,
    saveEmojiPacks: saveEmojiPacks,
    addEmoji: addEmoji,
    getCharacterMemory: getCharacterMemory,
    saveCharacterMemory: saveCharacterMemory,
    addCharacterMemory: addCharacterMemory,
    getMemoriesForCharacters: getMemoriesForCharacters,
    getRecentGroupContextForCharacter: getRecentGroupContextForCharacter,
    getPrivateMemoryBridgeContext: getPrivateMemoryBridgeContext,
    getGroupPrivateMemoryBridgeContext: getGroupPrivateMemoryBridgeContext,
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
    saveBodyStateSnapshot: saveBodyStateSnapshot,
    getBodyStateSnapshot: getBodyStateSnapshot,
    restoreBodyStateBeforeGenerationIds: restoreBodyStateBeforeGenerationIds,
    clearBodyState: clearBodyState,
    clearBodyStateSnapshots: clearBodyStateSnapshots,
    clearAllBodyStates: clearAllBodyStates,
    getDefaultBodyState: getDefaultBodyState,
    resetPrivateCharacterState: resetPrivateCharacterState,
    resetPrivateChatState: resetPrivateChatState,
    clearGroupThoughts: clearGroupThoughts,
    resetGroupMemoryState: resetGroupMemoryState,
    resetAllCharacterMemoryAndStates: resetAllCharacterMemoryAndStates,
    getOfflineSession: getOfflineSession,
    saveOfflineSession: saveOfflineSession,
    saveOfflineSessionDebounced: saveOfflineSessionDebounced,
    flushOfflineSessionSave: flushOfflineSessionSave,
    flushAllDebouncedSaves: flushAllDebouncedSaves,
    deleteOfflineSession: deleteOfflineSession,
    getAllChatHistories: getAllChatHistories,
    getAllGroupChatHistories: getAllGroupChatHistories,
    getAllOfflineSessions: getAllOfflineSessions,
    getWatchSession: getWatchSession,
    saveWatchSession: saveWatchSession,
    saveWatchSessionDebounced: saveWatchSessionDebounced,
    flushWatchSessionSave: flushWatchSessionSave,
    deleteWatchSession: deleteWatchSession,
    getAllWatchSessions: getAllWatchSessions,
    getWorldBooks: getWorldBooks,
    saveWorldBooks: saveWorldBooks,
    addWorldBook: addWorldBook,
    updateWorldBook: updateWorldBook,
    deleteWorldBook: deleteWorldBook,
    getChatWorldBookIds: getChatWorldBookIds,
    setChatWorldBookIds: setChatWorldBookIds,
    toggleChatWorldBook: toggleChatWorldBook,
    getSelectedWorldBooksForChat: getSelectedWorldBooksForChat,
    getMatchedWorldBookEntries: getMatchedWorldBookEntries,
    getCharacterThoughts: getCharacterThoughts,
    saveCharacterThoughts: saveCharacterThoughts,
    normalizeThoughtMood: normalizeThoughtMood,
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
    normalizeMoneyAmount: normalizeMoneyAmount,
    normalizeMoneyMessage: normalizeMoneyMessage,
    detectMoneyAmountMismatch: detectMoneyAmountMismatch,
    migrateWalletLedgerAmounts: migrateWalletLedgerAmounts,
    migrateMoneyMessagesInHistories: migrateMoneyMessagesInHistories,
    removeGenerationArtifacts: removeGenerationArtifacts,
    recordMoneyMessage: recordMoneyMessage,
    receiveMoneyMessage: receiveMoneyMessage,
    returnMoneyMessage: returnMoneyMessage,
    settleOutgoingMoneyMessage: settleOutgoingMoneyMessage,
    applyMoneyDecision: applyMoneyDecision,
    exportAllData: exportAllData,
    importAllData: importAllData,
    clearAllData: clearAllData
  };

  migrateMoneyMessagesInHistories();
})(window);
