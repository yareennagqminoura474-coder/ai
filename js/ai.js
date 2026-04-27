(function (window) {
  "use strict";

  var MISSING_SETTINGS_MESSAGE = "请先到设置页填写 API 地址、API Key 和模型名称。";

  function valueOrFallback(value) {
    return value ? String(value) : "未填写";
  }

  function buildSystemPrompt(character, memories) {
    var profile = character || {};
    var chatSettings = profile.chatSettings || {};
    var personaOverride = chatSettings.userPersonaOverride || {};
    var defaultUserProfile = window.AppStorage && window.AppStorage.getUserProfile ? window.AppStorage.getUserProfile() : {};
    var userName = personaOverride.name || defaultUserProfile.name || "用户";
    var userPersona = personaOverride.persona || defaultUserProfile.persona || "";
    var memoryText = chatSettings.memoryEnabled === false ? "" : formatMemoryList(memories || getMemoryForCharacter(profile.id));

    return [
      "你正在扮演一个由用户创建的聊天角色。",
      "请始终保持角色人设，不要说自己是 AI、语言模型、机器人或助手。",
      "回复要像真实手机聊天，自然、具体、有情绪，但不要太长。",
      "不要脱离用户为角色设定的信息，不要擅自改写角色核心设定。",
      "",
      "角色信息：",
      "角色名称：" + valueOrFallback(profile.name),
      "性别：" + valueOrFallback(profile.gender),
      "身份：" + valueOrFallback(profile.identity),
      "性格设定：" + valueOrFallback(profile.personality),
      "背景故事：" + valueOrFallback(profile.background),
      "说话风格：" + valueOrFallback(profile.speakingStyle),
      "和用户的关系：" + valueOrFallback(profile.relationship),
      "开场白：" + valueOrFallback(profile.openingMessage),
      "备注名：" + valueOrFallback(chatSettings.remarkName),
      "",
      "用户在这个私聊中的身份：",
      "用户昵称：" + valueOrFallback(userName),
      "用户人设：" + valueOrFallback(userPersona),
      "",
      "和这个角色相关的共享记忆：",
      memoryText || "暂无"
    ].join("\n");
  }

  function buildMessages(character, chatHistory) {
    var recentHistory = (Array.isArray(chatHistory) ? chatHistory : [])
      .filter(function (message) {
        return message && message.content && message.type !== "loading" && message.type !== "error";
      })
      .slice(-20);

    return [{
      role: "system",
      content: buildSystemPrompt(character)
    }].concat(recentHistory.map(function (message) {
      return {
        role: message.role === "user" ? "user" : "assistant",
        content: summarizeMessageForAI(message)
      };
    }));
  }

  async function sendChatRequest(character, chatHistory) {
    return sendConfiguredChatMessages(buildMessages(character, chatHistory));
  }

  function buildWorldBookContext(contextText, scope, targetId) {
    var entries;

    if (!window.AppStorage || !window.AppStorage.getMatchedWorldBookEntries) {
      return "";
    }

    entries = window.AppStorage.getMatchedWorldBookEntries(contextText, scope, targetId);
    if (!entries.length) {
      return "";
    }

    return ["本次命中 " + entries.length + " 条世界书。"].concat(entries
      .map(function (entry, index) {
        return [
          (index + 1) + ". " + (entry.bookName || "World Book") + " / " + (entry.title || "Entry"),
          "关键词：" + (entry.keywords || []).join("、"),
          "内容：" + entry.content
        ].join("\n");
      })).join("\n\n");
  }

  async function sendPrivateChatRequest(character, chatHistory) {
    var messages = buildPrivateReplyMessages(character, chatHistory);
    var rawContent = await sendConfiguredChatMessages(messages);
    var parsed = parseJsonFromText(rawContent);
    var replies = parsed && Array.isArray(parsed.replies) ? parsed.replies : [];

    return normalizeAiResult(rawContent, parsed, {
      replies: replies,
      min: 10,
      max: 50,
      defaultType: "text"
    });
  }

  function buildPrivateReplyMessages(character, chatHistory) {
    var history = (Array.isArray(chatHistory) ? chatHistory : [])
      .filter(function (message) {
        return message && message.content && message.type !== "loading" && message.type !== "error";
      })
      .slice(-24)
      .map(function (message) {
        return (message.role === "user" ? "用户：" : (character.name || "角色") + "：") + summarizeMessageForAI(message);
      }).join("\n");
    var worldBookContext = buildWorldBookContext(history, "private", character && character.id);

    return [
      {
        role: "system",
        content: [
          buildSystemPrompt(character),
          "世界书设定：",
          worldBookContext || "暂无匹配世界书。",
          "",
          "本轮私聊只调用一次 API，必须同一次返回 replies、thoughts、memories。",
          "replies 是显示给用户的手机聊天气泡，至少 10 条，安全上限 50 条；每条要短，多条之间自然衔接，不要写成一大段或只返回一条。",
          "thoughts 是角色心声，不显示在聊天气泡里；memories 是可写入长期记忆的内容。不要为了心声或记忆单独调用 API。",
          "你可以使用的消息类型：text 普通文字，voice 语音消息，emoji 表情，image 虚拟图片描述卡片，location 虚拟位置，redPacket 模拟红包，transfer 模拟转账。",
          "普通聊天以 text 为主，只有剧情/语境合适时才使用特殊消息。红包和转账只是模拟 UI，不涉及真实支付，金额不要夸张。",
          "发表情时优先使用默认 emoji 或用户已导入的图片表情；如果没有可用图片表情，就用文本 emoji。",
          "发图片时只返回图片描述卡片，不生成真实图片。",
          "只返回 JSON，不要 Markdown，不要解释。",
          "JSON 格式：{\"replies\":[{\"type\":\"text\",\"content\":\"第一条\"},{\"type\":\"text\",\"content\":\"第二条\"}],\"thoughts\":[{\"content\":\"角色此刻的内心想法\",\"mood\":\"平静\",\"visibleSummary\":\"一句话摘要\"}],\"memories\":[{\"content\":\"可写入长期记忆的内容\"}]}",
          "可用默认 emoji：😀 😭 😍 🤔 😡 👍 ❤️ 🎉；用户导入表情包数量：" + getImportedEmojiCount()
        ].join("\n")
      },
      {
        role: "user",
        content: "以下是最近聊天上下文，请以角色身份连续回复多条气泡：\n" + (history || "暂无历史消息")
      }
    ];
  }

  function buildGroupSystemPrompt(group, characters, sharedMemories) {
    var memberLines = (characters || []).map(function (character) {
      var memories = sharedMemories && sharedMemories[character.id] ? sharedMemories[character.id] : [];

      return [
        "角色ID：" + character.id,
        "名称：" + valueOrFallback(character.name),
        "身份：" + valueOrFallback(character.identity),
        "性别：" + valueOrFallback(character.gender),
        "性格：" + valueOrFallback(character.personality),
        "背景：" + valueOrFallback(character.background),
        "说话风格：" + valueOrFallback(character.speakingStyle),
        "关系：" + valueOrFallback(character.relationship),
        "相关记忆：" + (formatMemoryList(memories) || "暂无")
      ].join("；");
    });

    return [
      "最高优先级规则：你正在模拟一个真实的多人微信群聊。请根据最近上下文，一次性生成至少 10 条连续群聊消息，只调用一次 API。",
      "消息必须按真实聊天顺序排列，后一条要接住上一条。至少 2 个角色参与；如果群成员超过 2 人，尽量让 3 个或更多角色参与。",
      "不要固定轮流，不要让同一个角色包揽全部消息。允许同一个角色连续说 1 到 3 条，但随后要有其他角色接话。",
      "可以插话、补充、反驳、开玩笑、打断、转移话题。内容像真实微信群聊，不要像作文，每条消息适合手机聊天气泡。",
      "只返回 JSON，不要 Markdown，不要解释。JSON 格式：{\"replies\":[{\"characterId\":\"角色ID\",\"type\":\"text\",\"content\":\"消息内容\"}],\"thoughts\":[{\"characterId\":\"角色ID\",\"content\":\"内心想法\",\"mood\":\"平静\",\"visibleSummary\":\"一句摘要\"}],\"memories\":[{\"characterId\":\"角色ID\",\"content\":\"可写入长期记忆的内容\"}]}。",
      "支持 type：text、voice、emoji、image、location、redPacket、transfer。普通聊天以 text 为主，特殊类型只在语境合适时使用。",
      "如果后续旧规则提到 3 到 8 条，请忽略；本轮群聊回复以至少 10 条为准。",
      "这是一个多人群聊场景，群聊名称是：" + valueOrFallback(group && group.name),
      "本轮必须至少 10 条 replies，安全上限由群设置决定，绝对不要只返回一条。",
      "发言顺序要自然随机，不要固定轮流，后一条消息要能接住上一条消息。",
      "可以只有部分角色发言，不一定所有角色都要说话；允许同一个角色连续说 1 到 3 条，但不要让同一个角色包揽所有消息。",
      "每个角色都必须保持自己的人设，不要混淆角色身份。",
      "可以插话、接话、反驳、补充、转移话题，内容要像真实群聊，每条 content 控制在手机气泡长度。",
      "可用消息类型：text、voice、emoji、image、location、redPacket、transfer。普通聊天以 text 为主，特殊消息只在语境合适时使用。",
      "红包和转账只是模拟 UI，不涉及真实支付；发图片只返回图片描述卡片，不生成真实图片。",
      "只返回 JSON，不要返回 Markdown、解释或代码块。",
      "JSON 格式：{\"replies\":[{\"characterId\":\"角色ID\",\"type\":\"text\",\"content\":\"角色回复内容\"}],\"thoughts\":[{\"characterId\":\"角色ID\",\"content\":\"这个角色此刻的内心想法\",\"mood\":\"平静\",\"visibleSummary\":\"一句话摘要\"}],\"memories\":[{\"characterId\":\"角色ID\",\"content\":\"可写入长期记忆的内容\"}]}",
      "可用默认 emoji：😀 😭 😍 🤔 😡 👍 ❤️ 🎉；用户导入表情包数量：" + getImportedEmojiCount(),
      "",
      "群成员：",
      memberLines.join("\n")
    ].join("\n");
  }

  async function sendGroupChatRequest(group, characters, groupHistory, sharedMemories) {
    var messages = buildGroupMessages(group, characters, groupHistory, sharedMemories);
    var rawContent = await sendConfiguredChatMessages(messages);
    var parsed = parseJsonFromText(rawContent);
    var validIds = (characters || []).map(function (character) {
      return character.id;
    });
    var replies = parsed && Array.isArray(parsed.replies) ? parsed.replies : [];
    var result;

    result = normalizeAiResult(rawContent, parsed, {
      replies: replies,
      min: group && group.settings && group.settings.minReplyCount ? group.settings.minReplyCount : 10,
      max: group && group.settings && group.settings.maxReplyCount ? group.settings.maxReplyCount : 50,
      defaultType: "text"
    });

    if (group && group.settings && group.settings.allowSpecialMessages === false) {
      result.replies = result.replies.map(function (reply) {
        return Object.assign({}, reply, { type: "text" });
      });
    }

    result.replies = assignGroupSpeakerIds(result.replies, validIds, group && group.settings).filter(function (reply) {
      return reply.characterId && reply.content;
    }).slice(0, group && group.settings && group.settings.maxReplyCount ? group.settings.maxReplyCount : 50);

    result.thoughts = assignGroupAuxiliaryCharacterIds(result.thoughts, validIds);
    result.memories = assignGroupAuxiliaryCharacterIds(result.memories, validIds);

    return result;
  }

  function assignGroupSpeakerIds(replies, validIds, settings) {
    var members = shuffleList(validIds || []);
    var configuredMin = settings && settings.minParticipantCount ? Number(settings.minParticipantCount) : 0;
    var minSpeakers = configuredMin || (members.length > 2 ? 3 : Math.min(2, members.length));
    var maxRun = settings && settings.allowConsecutiveMessages === false ? 1 : 3;
    var result;

    if (!members.length) {
      return [];
    }

    minSpeakers = Math.max(1, Math.min(minSpeakers, members.length));

    result = (Array.isArray(replies) ? replies : []).map(function (reply, index) {
      var characterId = members.indexOf(reply.characterId) !== -1
        ? reply.characterId
        : members[index % members.length];

      return Object.assign({}, reply, {
        characterId: characterId
      });
    });

    if (result.length >= minSpeakers && countUniqueSpeakers(result) < minSpeakers) {
      members.slice(0, minSpeakers).forEach(function (memberId, index) {
        result[index] = Object.assign({}, result[index], {
          characterId: memberId
        });
      });
    }

    return avoidLongSpeakerRuns(result, members, maxRun);
  }

  function assignGroupAuxiliaryCharacterIds(items, validIds) {
    var members = validIds || [];
    if (!members.length) {
      return [];
    }

    return (Array.isArray(items) ? items : []).map(function (item, index) {
      return Object.assign({}, item, {
        characterId: members.indexOf(item.characterId) !== -1 ? item.characterId : members[index % members.length]
      });
    }).filter(function (item) {
      return item.characterId && item.content;
    });
  }

  function avoidLongSpeakerRuns(replies, members, maxRun) {
    var lastId = "";
    var runLength = 0;
    var nextIndex = 0;
    var allowedRun = Math.max(1, Number(maxRun) || 3);

    return replies.map(function (reply) {
      var characterId = reply.characterId;

      if (characterId === lastId) {
        runLength += 1;
      } else {
        lastId = characterId;
        runLength = 1;
      }

      if (runLength > allowedRun && members.length > 1) {
        characterId = pickDifferentSpeaker(members, lastId, nextIndex);
        nextIndex += 1;
        lastId = characterId;
        runLength = 1;
      }

      return Object.assign({}, reply, {
        characterId: characterId
      });
    });
  }

  function pickDifferentSpeaker(members, currentId, offset) {
    var index;
    var candidate;

    for (index = 0; index < members.length; index += 1) {
      candidate = members[(index + offset) % members.length];
      if (candidate !== currentId) {
        return candidate;
      }
    }

    return currentId;
  }

  function countUniqueSpeakers(replies) {
    var seen = {};

    replies.forEach(function (reply) {
      if (reply && reply.characterId) {
        seen[reply.characterId] = true;
      }
    });

    return Object.keys(seen).length;
  }

  function shuffleList(items) {
    return (items || []).slice().sort(function () {
      return Math.random() - 0.5;
    });
  }

  function buildGroupMessages(group, characters, groupHistory, sharedMemories) {
    var worldBookContext;
    var groupSettingsText;
    var history = (Array.isArray(groupHistory) ? groupHistory : [])
      .filter(function (message) {
        return message && message.content && message.type !== "loading" && message.type !== "error";
      })
      .slice(-30)
      .map(function (message) {
        if (message.role === "user") {
          return "用户：" + summarizeMessageForAI(message);
        }

        if (message.role === "character") {
          return (message.characterName || "角色") + "：" + summarizeMessageForAI(message);
        }

        return "系统：" + summarizeMessageForAI(message);
      }).join("\n");
    worldBookContext = buildWorldBookContext(history, "group", group && group.id);
    groupSettingsText = group && group.settings
      ? [
        "群公告：" + (group.settings.announcement || "暂无"),
        "本群每次最少回复条数：" + (group.settings.minReplyCount || 10),
        "本群每次最多安全条数：" + (group.settings.maxReplyCount || 50),
        "本群最少参与角色数：" + (group.settings.minParticipantCount || 2),
        "是否允许特殊消息类型：" + (group.settings.allowSpecialMessages === false ? "否，只使用 text" : "是")
      ].join("\n")
      : "";


    return [
      {
        role: "system",
        content: buildGroupSystemPrompt(group, characters, sharedMemories)
      },
      {
        role: "user",
        content: [
          "请同一次 JSON 返回 replies、thoughts、memories。replies 显示在群聊里，thoughts 存入角色心声，memories 存入长期记忆，不要额外调用 API。",
          groupSettingsText,
          "世界书设定：",
          worldBookContext || "暂无匹配世界书。",
          "最近群聊上下文：",
          history || "暂无群聊消息"
        ].join("\n")
      }
    ];
  }

  async function sendInlineOfflineRequest(context) {
    var messages = buildInlineOfflineMessages(context || {});
    var rawContent = await sendConfiguredChatMessages(messages);
    var parsed = parseJsonFromText(rawContent);
    var participants = context && Array.isArray(context.participants) ? context.participants : [];
    var validIds = participants.map(function (character) {
      return character.id;
    });
    var fallbackId = validIds[0] || "";
    var events = parsed && Array.isArray(parsed.events) ? parsed.events : [];
    var thoughts = assignGroupAuxiliaryCharacterIds(normalizeThoughtList(parsed && parsed.thoughts), validIds);
    var memories = assignGroupAuxiliaryCharacterIds(normalizeMemoryList(parsed && parsed.memories), validIds);

    if (!events.length && rawContent) {
      events = [{ type: "action", characterId: "", content: rawContent }];
    }

    return {
      events: events.map(function (event, index) {
        var type = event && event.type === "speech" ? "speech" : "action";
        var characterId = validIds.indexOf(event && event.characterId) !== -1
          ? event.characterId
          : (type === "speech" ? (context.mode === "group" && validIds.length ? validIds[index % validIds.length] : fallbackId) : "");

        return {
          type: type,
          characterId: characterId,
          content: String(event && event.content || "").trim()
        };
      }).filter(function (event) {
        return event.content && (event.type === "action" || event.characterId);
      }).slice(0, 20),
      thoughts: thoughts,
      memories: memories
    };
  }

  function buildInlineOfflineMessages(context) {
    var mode = context.mode === "group" ? "group" : "private";
    var participants = Array.isArray(context.participants) ? context.participants : [];
    var memories = context.memories || {};
    var historyText = formatInlineOfflineHistory(context.history);
    var scene = context.scene || {};
    var sceneText = [
      scene.name ? "场景：" + scene.name : "",
      scene.description ? "场景描述：" + scene.description : ""
    ].filter(Boolean).join("\n");
    var contextText = [context.userInput || "", sceneText, historyText].join("\n");
    var worldBookContext = context.worldBookContext || buildWorldBookContext(
      contextText,
      mode === "group" ? "group" : "private",
      context.targetId || ""
    );
    var participantLines = participants.map(function (character) {
      return [
        "角色ID：" + character.id,
        "名称：" + valueOrFallback(character.name),
        "身份：" + valueOrFallback(character.identity),
        "性格：" + valueOrFallback(character.personality),
        "背景：" + valueOrFallback(character.background),
        "说话风格：" + valueOrFallback(character.speakingStyle),
        "关系：" + valueOrFallback(character.relationship),
        "相关记忆：" + (formatMemoryList(memories[character.id] || []) || "暂无")
      ].join("；");
    });

    return [
      {
        role: "system",
        content: [
          "这是内嵌在线聊天流里的线下模式，不要切换场景页面。",
          "模式：" + (mode === "group" ? "群聊线下模式" : "私聊线下模式"),
          sceneText || "场景：未指定，请沿用当前聊天氛围。",
          "你要把用户输入理解为一句话、一个动作或一个场景推进点。",
          "本轮只调用一次 API，必须同一次返回 events、thoughts、memories。",
          "events 一次至少 6 条，最多 20 条。action 是旁白/动作描写，speech 是角色说话。",
          "私聊模式只有当前角色参与；群聊模式允许所有群成员自然参与，多个角色可以说话。",
          "动作描写要短而有画面感；角色发言要像真实当面对话，不要写成长作文。",
          "thoughts 是角色心声，memories 是长期记忆，不要为了心声或记忆额外调用 API。",
          "只返回 JSON，不要 Markdown，不要解释。",
          "JSON 格式：{\"events\":[{\"type\":\"action\",\"content\":\"动作旁白\"},{\"type\":\"speech\",\"characterId\":\"角色ID\",\"content\":\"角色说的话\"}],\"thoughts\":[{\"characterId\":\"角色ID\",\"content\":\"内心想法\",\"mood\":\"紧张\",\"visibleSummary\":\"一句摘要\"}],\"memories\":[{\"characterId\":\"角色ID\",\"content\":\"可写入长期记忆的内容\"}]}",
          "",
          "世界书设定：",
          worldBookContext || "暂无匹配世界书。",
          "",
          "参与角色：",
          participantLines.join("\n")
        ].join("\n")
      },
      {
        role: "user",
        content: [
          "用户本次输入：",
          valueOrFallback(context.userInput),
          "",
          "当前场景：",
          sceneText || "未指定",
          "",
          "当前聊天流最近内容：",
          historyText || "暂无历史"
        ].join("\n")
      }
    ];
  }

  function formatInlineOfflineHistory(history) {
    return (Array.isArray(history) ? history : [])
      .filter(function (message) {
        return message && message.content && message.type !== "loading" && message.type !== "error";
      })
      .slice(-30)
      .map(function (message) {
        if (message.type === "offlineAction") {
          return "旁白：" + summarizeMessageForAI(message);
        }
        if (message.type === "offlineSpeech") {
          return (message.characterName || "角色") + "：" + summarizeMessageForAI(message);
        }
        if (message.type === "offlineUserAction") {
          return "用户行动：" + summarizeMessageForAI(message);
        }
        if (message.role === "user") {
          return "用户：" + summarizeMessageForAI(message);
        }
        if (message.role === "character") {
          return (message.characterName || "角色") + "：" + summarizeMessageForAI(message);
        }
        return "系统：" + summarizeMessageForAI(message);
      }).join("\n");
  }

  async function sendOfflineRequest(context) {
    var messages = buildOfflineMessages(context || {});
    var rawContent = await sendConfiguredChatMessages(messages);
    var parsed = parseJsonFromText(rawContent);
    var participants = context && Array.isArray(context.participants) ? context.participants : [];
    var validIds = participants.map(function (character) {
      return character.id;
    });
    var fallbackId = validIds[0] || "";
    var events = parsed && Array.isArray(parsed.events) ? parsed.events : [];
    var thoughts = assignGroupAuxiliaryCharacterIds(normalizeThoughtList(parsed && parsed.thoughts), validIds);
    var memories = assignGroupAuxiliaryCharacterIds(normalizeMemoryList(parsed && parsed.memories), validIds);

    if (!events.length && rawContent) {
      events = [{ type: "action", characterId: "", content: rawContent }];
    }

    return {
      events: events.map(function (event) {
      var type = event.type === "speech" ? "speech" : "action";
      var characterId = validIds.indexOf(event.characterId) !== -1
        ? event.characterId
        : (type === "speech" ? fallbackId : "");

      return {
        type: type,
        characterId: characterId,
        content: String(event.content || "").trim()
      };
    }).filter(function (event) {
      return event.content && (event.type === "action" || event.characterId);
      }).slice(0, 50),
      thoughts: thoughts,
      memories: memories
    };
  }

  function buildOfflineMessages(context) {
    var participants = Array.isArray(context.participants) ? context.participants : [];
    var sharedMemories = context.sharedMemories || {};
    var participantLines = participants.map(function (character) {
      return [
        "角色ID：" + character.id,
        "名称：" + valueOrFallback(character.name),
        "身份：" + valueOrFallback(character.identity),
        "性格：" + valueOrFallback(character.personality),
        "背景：" + valueOrFallback(character.background),
        "说话风格：" + valueOrFallback(character.speakingStyle),
        "记忆：" + (formatMemoryList(sharedMemories[character.id] || []) || "暂无")
      ].join("；");
    });
    var history = (Array.isArray(context.offlineHistory) ? context.offlineHistory : [])
      .filter(function (event) {
        return event && event.content && event.type !== "loading" && event.type !== "error";
      })
      .slice(-30)
      .map(function (event) {
        if (event.role === "user" || event.type === "user") {
          return "用户：" + summarizeMessageForAI(event);
        }

        if (event.type === "speech") {
          return (event.characterName || "角色") + "说：" + summarizeMessageForAI(event);
        }

        return "旁白：" + summarizeMessageForAI(event);
      }).join("\n");
    var worldBookContext = buildWorldBookContext(
      [context.userInput || "", history].join("\n"),
      context.mode === "group" ? "group" : "private",
      context.targetId || ""
    );

    return [
      {
        role: "system",
        content: [
          "这是线下互动 / 剧情互动模式，不是断网模式。",
          "模式：" + (context.mode === "group" ? "群聊线下模式" : "私聊线下模式"),
          "你要保持角色人设，不能混淆角色身份。",
          "每次推进生成 3 到 8 条 events，形成一小段完整剧情。",
          "后一个动作或发言要接住前一个事件，角色顺序要自然随机，不要固定轮流。",
          "角色说话不要太长，动作描写像小说旁白但不要冗长。",
          "私聊模式只围绕当前角色和用户互动；群聊模式中多个角色可以自然互动。",
          "只返回 JSON，不要返回 Markdown、解释或代码块。",
          "同一次 JSON 里返回 events、thoughts、memories，不要为了心声或记忆额外调用 API。",
          "JSON 格式必须是：{\"events\":[{\"type\":\"speech\",\"characterId\":\"角色ID\",\"content\":\"角色说的话\"},{\"type\":\"action\",\"characterId\":\"\",\"content\":\"旁白动作\"}],\"thoughts\":[{\"characterId\":\"角色ID\",\"content\":\"内心想法\",\"mood\":\"紧张\",\"visibleSummary\":\"一句摘要\"}],\"memories\":[{\"characterId\":\"角色ID\",\"content\":\"可写入长期记忆的内容\"}]}",
          "",
          "世界书设定：",
          worldBookContext || "暂无匹配世界书。",
          "",
          "参与角色：",
          participantLines.join("\n")
        ].join("\n")
      },
      {
        role: "user",
        content: [
          "用户本次输入：" + valueOrFallback(context.userInput),
          "",
          "最近剧情：",
          history || "暂无"
        ].join("\n")
      }
    ];
  }

  async function generateCharacterDiary(character, context) {
    var source = context || {};
    var date = source.date || new Date().toISOString().slice(0, 10);
    var contextText = [
      source.chatText || "",
      source.groupText || "",
      source.offlineText || "",
      source.thoughtText || "",
      source.memoryText || ""
    ].join("\n");
    var worldBookContext = buildWorldBookContext(contextText, "private", character && character.id);
    var rawContent = await sendConfiguredChatMessages([
      {
        role: "system",
        content: [
          buildSystemPrompt(character),
          "你要以角色本人第一人称写一篇今天的日记，符合角色人设和说话风格。",
          "日记只基于提供的聊天、群聊、线下互动、心声、记忆和世界书设定，不要凭空编重大事件。",
          "只返回 JSON，不要 Markdown，不要解释。",
          "JSON 格式：{\"date\":\"" + date + "\",\"weather\":\"晴\",\"title\":\"今天的小事\",\"content\":\"日记正文\",\"mood\":\"开心\",\"summary\":\"一句话小结\"}",
          "世界书设定：",
          worldBookContext || "暂无匹配世界书。"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          "日期：" + date,
          "今天的聊天和资料：",
          contextText || "今天没有太多记录，请写一篇克制、贴合角色的短日记。"
        ].join("\n")
      }
    ]);
    var parsed = parseJsonFromText(rawContent) || {};

    return {
      date: String(parsed.date || date),
      weather: String(parsed.weather || "未记录"),
      title: String(parsed.title || "今天的小事"),
      content: String(parsed.content || rawContent || "").trim(),
      mood: String(parsed.mood || ""),
      summary: String(parsed.summary || "")
    };
  }

  async function sendConfiguredChatMessages(messages) {
    var settings = window.AppStorage.getSettings();
    var apiUrl = settings.apiUrl.trim();
    var apiKey = settings.apiKey.trim();
    var modelName = settings.modelName.trim();
    var chatUrl;
    var response;
    var data;
    var content;

    if (!apiUrl || !apiKey || !modelName) {
      throw new Error(MISSING_SETTINGS_MESSAGE);
    }

    chatUrl = buildChatCompletionsUrl(apiUrl);

    /*
      安全提醒：前端直接保存和使用 API Key 只适合个人本地运行。
      如果项目要公开部署，不应该把 API Key 暴露在前端，后续需要改成后端代理。
    */
    try {
      response = await fetch(chatUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey
        },
        body: JSON.stringify({
          model: modelName,
          messages: messages,
          temperature: 0.8
        })
      });

      data = await readResponseJson(response);

      if (!response.ok) {
        throw new Error("聊天接口请求失败：" + getApiErrorMessage(data, response));
      }
    } catch (error) {
      if (error && error.message && error.message.indexOf("聊天接口请求失败：") === 0) {
        throw error;
      }

      throw new Error("聊天接口请求失败：" + (error && error.message ? error.message : "未知错误"));
    }

    content = extractAiText(data);

    if (!content || !String(content).trim()) {
      console.error("AI raw response:", data);
      throw new Error("接口返回格式不兼容，请查看控制台 raw response。");
    }

    return String(content).trim();
  }

  function extractAiText(data) {
    var choice;
    var message;
    var content;
    var index;

    function asText(value) {
      var parts;

      if (value === null || value === undefined) {
        return "";
      }

      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }

      if (Array.isArray(value)) {
        parts = value.map(asText).filter(function (item) {
          return item && String(item).trim();
        });
        return parts.join("\n");
      }

      if (typeof value === "object") {
        if (value.text !== undefined) {
          return asText(value.text);
        }
        if (value.content !== undefined) {
          return asText(value.content);
        }
        if (value.message !== undefined) {
          return asText(value.message);
        }
      }

      return "";
    }

    if (data && data.choices && data.choices[0]) {
      choice = data.choices[0];
      message = choice.message || {};

      content = asText(message.content);
      if (content) {
        return content;
      }

      content = asText(message.reasoning_content);
      if (content) {
        return content;
      }

      content = asText(choice.text);
      if (content) {
        return content;
      }
    }

    content = asText(data && data.output_text);
    if (content) {
      return content;
    }

    if (data && Array.isArray(data.output)) {
      for (index = 0; index < data.output.length; index += 1) {
        content = asText(data.output[index] && data.output[index].content);
        if (content) {
          return content;
        }

        content = asText(data.output[index] && data.output[index].text);
        if (content) {
          return content;
        }
      }
    }

    content = asText(data && data.content) || asText(data && data.message) || asText(data && data.text);
    if (content) {
      return content;
    }

    console.error("AI raw response:", data);
    throw new Error("接口返回格式不兼容，请查看控制台 raw response。");
  }

  function buildChatCompletionsUrl(apiUrl) {
    var url = String(apiUrl || "").trim().replace(/\/+$/, "");

    if (!url) {
      throw new Error("请先填写 API 地址。");
    }

    if (/\/v1\/chat\/completions$/i.test(url) || /\/chat\/completions$/i.test(url)) {
      return url;
    }

    if (/\/v1\/models$/i.test(url)) {
      return url.replace(/\/v1\/models$/i, "/v1/chat/completions");
    }

    if (/\/models$/i.test(url)) {
      return url.replace(/\/models$/i, "/chat/completions");
    }

    if (/\/v1\/responses$/i.test(url)) {
      return url.replace(/\/v1\/responses$/i, "/v1/chat/completions");
    }

    if (/\/responses$/i.test(url)) {
      return url.replace(/\/responses$/i, "/chat/completions");
    }

    if (/\/v1$/i.test(url)) {
      return url + "/chat/completions";
    }

    return url + "/v1/chat/completions";
  }

  function buildModelsUrl(apiUrl) {
    var url = String(apiUrl || "").trim().replace(/\/+$/, "");

    if (!url) {
      throw new Error("请先填写 API 地址。");
    }

    if (/\/v1\/chat\/completions$/i.test(url)) {
      return url.replace(/\/v1\/chat\/completions$/i, "/v1/models");
    }

    if (/\/chat\/completions$/i.test(url)) {
      return url.replace(/\/chat\/completions$/i, "/models");
    }

    if (/\/v1\/responses$/i.test(url)) {
      return url.replace(/\/v1\/responses$/i, "/v1/models");
    }

    if (/\/responses$/i.test(url)) {
      return url.replace(/\/responses$/i, "/models");
    }

    if (/\/v1\/models$/i.test(url) || /\/models$/i.test(url)) {
      return url;
    }

    if (/\/v1$/i.test(url)) {
      return url + "/models";
    }

    return url + "/v1/models";
  }

  async function fetchModels(apiUrl, apiKey) {
    var key = String(apiKey || "").trim();
    var modelsUrl;
    var response;
    var data;
    var models;

    if (!key) {
      throw new Error("请先填写 API Key。");
    }

    modelsUrl = buildModelsUrl(apiUrl);

    /*
      安全提醒：前端直接使用 API Key 拉取模型列表只适合个人本地运行。
      如果项目要公开部署，不应该把 API Key 暴露在前端，后续需要改成后端代理。
    */
    response = await fetch(modelsUrl, {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + key
      }
    });

    data = await readResponseJson(response);

    if (!response.ok) {
      throw new Error(getApiErrorMessage(data, response));
    }

    models = normalizeModels(data);

    if (!models.length) {
      throw new Error("接口返回中没有可用模型。");
    }

    return models;
  }

  function normalizeModels(data) {
    var list = [];
    var seen = {};

    if (data && Array.isArray(data.data)) {
      list = data.data;
    } else if (Array.isArray(data)) {
      list = data;
    }

    return list.reduce(function (models, item) {
      var id = typeof item === "string" ? item : item && item.id;

      if (!id || seen[id]) {
        return models;
      }

      seen[id] = true;
      models.push({ id: String(id) });
      return models;
    }, []);
  }

  async function readResponseJson(response) {
    try {
      return await response.json();
    } catch (error) {
      throw new Error("接口返回不是有效 JSON。");
    }
  }

  function getApiErrorMessage(data, response) {
    if (data && data.error && data.error.message) {
      return data.error.message;
    }

    if (data && data.message) {
      return data.message;
    }

    return "请求失败，HTTP 状态码 " + response.status + "。";
  }

  function parseJsonFromText(text) {
    var value = String(text || "").trim();
    var start;
    var end;

    if (!value) {
      return null;
    }

    value = value.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

    try {
      return JSON.parse(value);
    } catch (error) {
      start = value.indexOf("{");
      end = value.lastIndexOf("}");

      if (start !== -1 && end !== -1 && end > start) {
        try {
          return JSON.parse(value.slice(start, end + 1));
        } catch (innerError) {
          return null;
        }
      }
    }

    return null;
  }

  function normalizeAiResult(rawContent, parsed, options) {
    var settings = Object.assign({
      replies: [],
      min: 1,
      max: 50,
      defaultType: "text"
    }, options || {});

    return {
      replies: normalizeReplyList(rawContent, settings.replies, settings),
      thoughts: normalizeThoughtList(parsed && parsed.thoughts),
      memories: normalizeMemoryList(parsed && parsed.memories)
    };
  }

  function normalizeThoughtList(thoughts) {
    if (!Array.isArray(thoughts)) {
      return [];
    }

    return thoughts.map(function (thought) {
      var source = thought && typeof thought === "object" ? thought : {};
      return {
        characterId: source.characterId ? String(source.characterId) : "",
        content: String(source.content || "").trim(),
        mood: String(source.mood || "").trim(),
        visibleSummary: String(source.visibleSummary || source.summary || "").trim()
      };
    }).filter(function (thought) {
      return thought.content;
    }).slice(0, 50);
  }

  function normalizeMemoryList(memories) {
    if (!Array.isArray(memories)) {
      return [];
    }

    return memories.map(function (memory) {
      var source = memory && typeof memory === "object" ? memory : {};
      return {
        characterId: source.characterId ? String(source.characterId) : "",
        content: String(source.content || "").trim()
      };
    }).filter(function (memory) {
      return memory.content;
    }).slice(0, 50);
  }

  function normalizeReplyList(rawContent, parsedReplies, options) {
    var settings = Object.assign({
      min: 1,
      max: 50,
      defaultType: "text"
    }, options || {});
    var replies = [];

    if (Array.isArray(parsedReplies)) {
      parsedReplies.forEach(function (reply) {
        replies = replies.concat(normalizeReplyItem(reply, settings));
      });
    }

    if (!replies.length && rawContent) {
      replies = splitTextToReplyItems(rawContent, settings);
    }

    if (replies.length === 1 && shouldSplitSingleReply(replies[0], settings)) {
      replies = splitReplyContent(replies[0], settings);
    }

    return replies.filter(function (reply) {
      return reply && reply.content;
    }).slice(0, settings.max);
  }

  function normalizeReplyItem(reply, options) {
    var source = reply && typeof reply === "object" ? reply : { content: reply };
    var normalized = normalizeSpecialReply(source, options);

    if (!normalized.content) {
      return [];
    }

    if (shouldSplitSingleReply(normalized, options)) {
      return splitReplyContent(normalized, options);
    }

    return [normalized];
  }

  function normalizeSpecialReply(source, options) {
    var type = normalizeMessageType(source.type || options.defaultType);
    var content = String(source.content || "").trim();
    var reply = Object.assign({}, source, {
      type: type
    });

    if (type === "emoji") {
      reply.emoji = normalizeEmojiPayload(source.emoji);
      content = content || (reply.emoji.type === "text" ? reply.emoji.value : "[表情]");
    } else if (type === "voice") {
      content = content || source.voice && source.voice.text || "";
      reply.voice = normalizeVoicePayload(source.voice, content);
    } else if (type === "location") {
      reply.location = normalizeLocationPayload(source.location, content);
      content = content || reply.location.name;
    } else if (type === "image") {
      reply.image = normalizeImagePayload(source.image);
      content = content || "[图片]";
    } else if (type === "redPacket") {
      content = content || "恭喜发财，大吉大利";
      reply.amount = normalizeAiAmount(source.amount || "8.88");
      reply.status = source.status ? String(source.status) : "sent";
    } else if (type === "transfer") {
      content = content || "转账";
      reply.amount = normalizeAiAmount(source.amount || "20.00");
      reply.note = String(source.note || "");
      reply.status = source.status ? String(source.status) : "pending";
    }

    reply.content = content;
    return reply;
  }

  function normalizeMessageType(type) {
    var value = String(type || "text");
    var supported = ["text", "voice", "emoji", "location", "image", "redPacket", "transfer"];
    return supported.indexOf(value) === -1 ? "text" : value;
  }

  function normalizeEmojiPayload(emoji) {
    if (emoji && emoji.type === "image" && emoji.src) {
      return {
        type: "image",
        src: String(emoji.src)
      };
    }

    return {
      type: "text",
      value: emoji && emoji.value ? String(emoji.value) : "😂"
    };
  }

  function normalizeVoicePayload(voice, content) {
    var text = String(voice && voice.text || content || "");
    return {
      text: text,
      duration: estimateVoiceDuration(text)
    };
  }

  function normalizeLocationPayload(location, content) {
    return {
      name: String(location && location.name || content || "位置"),
      address: String(location && location.address || "常去的地方"),
      lat: null,
      lng: null
    };
  }

  function normalizeImagePayload(image) {
    return {
      description: String(image && image.description || "角色发来的一张图片描述")
    };
  }

  function normalizeAiAmount(amount) {
    var value = Number(amount);
    if (!value || value <= 0) {
      value = 8.88;
    }
    return Math.min(value, 200).toFixed(2);
  }

  function estimateVoiceDuration(text) {
    return Math.min(60, Math.max(2, Math.ceil(String(text || "").length / 4)));
  }

  function shouldSplitSingleReply(reply, options) {
    return reply
      && reply.type === "text"
      && splitTextContent(reply.content).length > 1;
  }

  function splitReplyContent(reply, options) {
    return splitTextContent(reply.content).map(function (content) {
      return Object.assign({}, reply, {
        type: options.defaultType || "text",
        content: content
      });
    });
  }

  function splitTextToReplyItems(text, options) {
    return splitTextContent(text).map(function (content) {
      return {
        type: options.defaultType || "text",
        content: content
      };
    });
  }

  function splitTextContent(text) {
    var cleaned = String(text || "")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    var parts;

    if (!cleaned) {
      return [];
    }

    parts = cleaned
      .split(/(?:\n+|(?<=[\u3002\uFF01\uFF1F\uFF5E\u2026\uFF1B;.!?]))/g)
      .map(function (part) {
        return part.replace(/^[-*\d.\s]+/, "").trim();
      })
      .filter(function (part) {
        return part && part.length > 0;
      });

    return parts.length ? parts : [cleaned];
  }

  function summarizeMessageForAI(message) {
    var type = message && message.type ? message.type : "text";
    var image;
    var voice;
    var emoji;
    var location;

    if (type === "image") {
      image = message.image || {};
      if (image.src) {
        return "[图片] 用户发送了一张图片：文件名 " + (image.name || "未命名图片");
      }
      return "[图片] 描述：" + (image.description || message.content || "图片");
    }

    if (type === "voice") {
      voice = message.voice || {};
      return "[语音消息 " + (voice.duration || estimateVoiceDuration(message.content)) + "秒]：" + (voice.text || message.content || "");
    }

    if (type === "emoji") {
      emoji = message.emoji || {};
      if (emoji.type === "image") {
        return "[图片表情] " + (emoji.name || "用户导入表情");
      }
      return "[表情] " + (emoji.value || message.content || "");
    }

    if (type === "location") {
      location = message.location || {};
      return "[位置] " + (location.name || message.content || "位置") + "，" + getSafeLocationAddress(location);
    }

    if (type === "redPacket") {
      return "[红包] 祝福语：" + (message.content || "恭喜发财，大吉大利") + "，金额：¥" + (message.amount || "0.00");
    }

    if (type === "transfer") {
      return "[转账] 金额：¥" + (message.amount || "0.00") + "，备注：" + (message.note || "转账");
    }

    if (type === "pat") {
      return "[拍一拍] " + (message.content || "");
    }

    if (type === "offlineUserAction") {
      return "[线下行动] " + (message.content || "");
    }

    if (type === "offlineAction") {
      return "[线下旁白] " + (message.content || "");
    }

    if (type === "offlineSpeech") {
      return "[线下发言] " + (message.content || "");
    }

    return String(message && message.content || "");
  }

  function getImportedEmojiCount() {
    if (!window.AppStorage || !window.AppStorage.getEmojiPacks) {
      return 0;
    }

    return window.AppStorage.getEmojiPacks().length;
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

  function splitFallbackReplies(text) {
    var lines = String(text || "")
      .split(/\n+/)
      .map(function (line) {
        return line.replace(/^[-*\d.\s]+/, "").trim();
      })
      .filter(Boolean);

    if (lines.length > 1) {
      return lines.map(function (line) {
        return { content: line };
      });
    }

    return [{ content: String(text || "").trim() }];
  }

  function getMemoryForCharacter(characterId) {
    if (!characterId || !window.AppStorage || !window.AppStorage.getCharacterMemory) {
      return [];
    }

    return window.AppStorage.getCharacterMemory(characterId).slice(-20);
  }

  function formatMemoryList(memories) {
    return (Array.isArray(memories) ? memories : [])
      .slice(-20)
      .map(function (memory, index) {
        return (index + 1) + ". " + memory.content;
      }).join("\n");
  }

  window.AIService = {
    MISSING_SETTINGS_MESSAGE: MISSING_SETTINGS_MESSAGE,
    buildSystemPrompt: buildSystemPrompt,
    buildMessages: buildMessages,
    summarizeMessageForAI: summarizeMessageForAI,
    normalizeReplyList: normalizeReplyList,
    sendChatRequest: sendChatRequest,
    sendPrivateChatRequest: sendPrivateChatRequest,
    buildGroupSystemPrompt: buildGroupSystemPrompt,
    sendGroupChatRequest: sendGroupChatRequest,
    sendInlineOfflineRequest: sendInlineOfflineRequest,
    sendOfflineRequest: sendOfflineRequest,
    buildWorldBookContext: buildWorldBookContext,
    generateCharacterDiary: generateCharacterDiary,
    buildChatCompletionsUrl: buildChatCompletionsUrl,
    buildModelsUrl: buildModelsUrl,
    extractAiText: extractAiText,
    fetchModels: fetchModels
  };
})(window);
