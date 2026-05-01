(function (window) {
  "use strict";

  var MISSING_SETTINGS_MESSAGE = "请先到设置页填写 API 地址、API Key 和模型名称。";
  var MIN_CHAT_REPLY_COUNT = 10;
  var MAX_CHAT_REPLY_COUNT = 50;
  var MAIN_HISTORY_WINDOW = 16;
  var WORLD_HISTORY_WINDOW = 10;
  var CHARACTER_LINE_HISTORY_WINDOW = 20;
  var CHARACTER_LINE_EXTRACT_LIMIT = 12;
  var HEART_VOICE_FETCH_LIMIT = 20;
  var HEART_VOICE_CONTEXT_LIMIT = 5;
  var OFFLINE_ACTION_MIN_COUNT = 4;
  var OFFLINE_ACTION_MAX_COUNT = 8;
  var BODY_STATE_PART_ALIASES = {
    "膝腿": "膝盖",
    "臀腿连接处": "臀腿",
    "臀缝": "屁眼",
    "其他受影响区域": "屁眼"
  };
  var DEFAULT_BODY_STATE_PARTS = ["手心", "臀部", "臀腿", "大腿", "大腿内侧", "腰背", "肩颈", "膝盖", "屁眼"];

  function valueOrFallback(value) {
    return value ? String(value) : "未填写";
  }

  function addPromptPart(parts, seen, label, value) {
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

  function buildMergedCharacterPersona(character) {
    var source = character || {};
    var parts = [];
    var seen = {};

    addPromptPart(parts, seen, "", source.personality);
    addPromptPart(parts, seen, "身份", source.identity);
    addPromptPart(parts, seen, "关系", source.relationship);
    addPromptPart(parts, seen, "说话方式", source.speakingStyle);
    addPromptPart(parts, seen, "背景", source.background);
    addPromptPart(parts, seen, "性别", source.gender);

    return parts.join("\n");
  }

  function buildMergedUserPersona(persona) {
    var source = persona || {};
    var parts = [];
    var seen = {};

    addPromptPart(parts, seen, "", source.personality || source.persona);
    addPromptPart(parts, seen, "身份/关系", source.identity || source.relationship);
    addPromptPart(parts, seen, "说话方式", source.speakingStyle);
    addPromptPart(parts, seen, "补充", source.extra || source.background);
    addPromptPart(parts, seen, "性别", source.gender);
    addPromptPart(parts, seen, "年龄", source.age);

    return parts.join("\n");
  }

  function buildReplyFallbackProfile(character) {
    var source = character || {};
    var voiceProfile = detectPersonaVoiceProfile(source);
    return {
      id: source.id ? String(source.id) : "",
      name: source.name ? String(source.name) : "",
      persona: buildMergedCharacterPersona(source),
      currentMood: source.currentMood || source.chatSettings && source.chatSettings.currentMood || "",
      chatSettings: source.chatSettings || {},
      chatSettingsText: JSON.stringify(source.chatSettings || {}),
      voiceProfile: voiceProfile,
      voiceTags: voiceProfile.tags,
      scoredTags: voiceProfile.scoredTags,
      evidenceText: voiceProfile.evidenceText,
      personaEvidence: extractPersonaEvidence(source),
      voiceFingerprintText: buildPersonaVoiceFingerprint(source, null, "fallback"),
      previousReplyText: source.previousReplyText || "",
      rejectedReplyText: source.rejectedReplyText || "",
      latestUserInput: source.latestUserInput || "",
      recentHeartVoiceText: source.recentHeartVoiceText || source.thoughtsHint || "",
      thoughtsHint: source.thoughtsHint || source.recentHeartVoiceText || "",
      worldBookContext: source.worldBookContext || ""
    };
  }

  function buildSystemPrompt(character, memories, contextOptions) {
    var profile = character || {};
    var chatSettings = profile.chatSettings || {};
    var source = contextOptions || {};
    var userContext = buildUserContext(chatSettings);
    var memoryText = chatSettings.memoryEnabled === false ? "" : formatMemoryList(memories || getMemoryForCharacter(profile.id));
    var chatMemoryText = source.chatMemoryText || formatChatMemoryList(getChatMemoriesForPrompt("private", profile.id, source.chatMemories));
    var recentGroupContextText = profile.id && window.AppStorage && typeof window.AppStorage.getRecentGroupContextForCharacter === "function"
      ? window.AppStorage.getRecentGroupContextForCharacter(profile.id, 16)
      : "";
    var selectedWorldBookIds = getSelectedWorldBookIds("private", profile && profile.id, source);
    var worldBookMeta = buildWorldBookPromptMeta(selectedWorldBookIds);
    var contextText = buildWorldBookDecisionContext({
      modeLabel: source.modeLabel || "线上私聊",
      userInput: source.userInput || "",
      recentHistory: source.recentHistory || "",
      characterPersonaText: [
        "角色名：" + valueOrFallback(profile.name),
        buildMergedCharacterPersona(profile)
      ].join("\n"),
      userPersonaText: [
        "用户名：" + valueOrFallback(userContext.name),
        userContext.persona || "暂无"
      ].join("\n"),
      relationshipStatus: chatSettings.userRelationshipName || profile.relationship || chatSettings.remarkName || userContext.relationshipName || "",
      chatMemoryText: chatMemoryText,
      longTermMemoryText: memoryText,
      previousReplyText: source.previousReplyText || ""
    });
    var worldBookContext = source.worldBookContext || buildWorldBookContext(contextText, "private", profile && profile.id, {
      selectedWorldBookIds: selectedWorldBookIds,
      relatedTargetIds: profile && profile.id ? [profile.id] : [],
      characterIds: profile && profile.id ? [profile.id] : []
    });
    var recentHeartVoiceText = buildRecentHeartVoiceContext(profile.id, "private", profile.id);

    return [
      buildSystemBase("private"),
      buildCharacterDossier(profile, userContext),
      buildPersonaExecutionAnchors(profile, userContext, "private"),
      buildPersonaVoiceFingerprint(profile, userContext, "private", worldBookContext),
      buildVoiceCalibration(profile, userContext, "private", {
        latestUserInput: source.userInput || "",
        previousReplyText: source.previousReplyText || "",
        recentHeartVoiceText: recentHeartVoiceText,
        worldBookContext: worldBookContext,
        recentCharacterLinesText: source.recentCharacterLinesText || ""
      }),
      buildMatchedWorldBooksSection(worldBookContext, worldBookMeta),
      buildWorldRuleEnforcement(worldBookContext, worldBookMeta),
      buildRelationshipDriveRules("private"),
      buildRelationshipProgressionRules("private"),
      buildCharacterDecisionCore("private", worldBookContext),
      source.recentGroupContextText ? [
        "当前你刚经历过下面这些群聊内容：",
        "不要说‘记录显示’、‘系统记忆’、‘群聊上下文里’。",
        "如果用户提到‘刚才’、‘群里’、‘你刚刚’、‘他们刚刚’，必须优先回忆下面的群聊片段。",
        "如果用户没提，也可以让群聊余波自然影响你的态度和措辞，但不要直接复述群聊对话。",
        "群聊刚发生在最近 30 分钟内，第一轮私聊可以带出别扭、追问、回避、生气、继续刚才话题或对群里某人的残留反应。"
      ].join("\n") : "",
      recentHeartVoiceText,
      buildMemoryStream({
        userContext: userContext,
        chatMemoryText: chatMemoryText || "暂无",
        longTermMemoryText: memoryText,
        recentTimelineText: source.recentHistory || "",
        recentGroupContextText: source.recentGroupContextText || recentGroupContextText,
        recentHeartVoiceText: recentHeartVoiceText
      }),
      buildThoughtReplyBindingRules("private"),
      buildCharacterResourceWhitelist(profile),
      buildCharacterPersonaReminder(profile),
      buildPromptPriorityHint(profile)
    ].join("\n");
  }

  function buildUserContext(chatSettings) {
    var settings = chatSettings || {};
    var personaOverride = settings.userPersonaOverride || {};
    var defaultUserProfile = window.AppStorage && window.AppStorage.getUserProfile ? window.AppStorage.getUserProfile() : {};
    var resolvedPersona = window.AppStorage && window.AppStorage.resolveUserPersona
      ? window.AppStorage.resolveUserPersona(settings.userPersonaId, personaOverride)
      : null;
    var personaParts = [];

    if (resolvedPersona) {
      personaParts.push(buildMergedUserPersona(resolvedPersona));
    }
    if (personaOverride && personaOverride.persona) {
      personaParts.push(personaOverride.persona);
    }
    if (defaultUserProfile && defaultUserProfile.persona) {
      personaParts.push(defaultUserProfile.persona);
    }

    return {
      name: resolvedPersona && resolvedPersona.name || personaOverride.name || defaultUserProfile.name || "用户",
      persona: personaParts.filter(Boolean).join("\n") || "",
      relationshipName: settings.userRelationshipName || ""
    };
  }

  function formatCharacterProfile(character, memoryText) {
    var profile = character || {};
    var chatSettings = profile.chatSettings || {};

    return [
      "角色ID：" + valueOrFallback(profile.id),
      "角色名：" + valueOrFallback(profile.name),
      "角色人设：" + valueOrFallback(buildMergedCharacterPersona(profile)),
      "禁忌点：" + valueOrFallback(profile.taboo || chatSettings.taboo),
      "备注名：" + valueOrFallback(chatSettings.remarkName),
      "当前情绪：" + valueOrFallback(profile.currentMood || chatSettings.currentMood),
      "开场白：" + valueOrFallback(profile.openingMessage),
      "最近相关记忆：" + (memoryText || "暂无")
    ].join("\n");
  }

  function buildSystemBase(mode) {
    return [
      "A. 固定世界规则 systemBase",
      mode === "group"
        ? "你不是 AI、助手、客服、系统或旁白工具；你调度的每个发言者都是群里的角色本人。"
        : "你不是 AI、助手、客服、系统或旁白工具；你就是角色本人。",
      "不要解释规则，不要复述设定，不要把记忆、世界书或人设当资料念给用户。",
      "不要说自己是 AI、语言模型、机器人、助手，也不要用服务型话术。",
      "防火墙规则：记忆流、账单、后台提示里的内容只能帮助理解上下文，绝不能在 content 里说“系统默认”“那边助手弄错了”“操作成功”“已处理”“金额字段”“结构化 amount”“根据记录”“后台显示”。",
      "如果上下文里有发了红包/转账/已收款/已退回，角色只能像本人反应，不能复述系统提示或解释字段。"
    ].join("\n");
  }

  function buildPromptPriorityHint(character) {
    var profile = character || {};
    var voiceProfile = detectPersonaVoiceProfile(profile);
    var evidence = extractPersonaEvidence(profile);
    var tags = voiceProfile.tags || [];
    var personaReminder = evidence.length
      ? "生成前最后确认：这个角色的声音证据是「" + evidence.slice(0, 2).join("」「") + "」，语气标签是【" + (tags.slice(0, 3).join("、") || "按原文人设") + "】。本轮 messages 里至少 2 条必须能让人一眼认出是这个角色说的，而不是换个名字的通用角色。"
      : (tags.length ? "生成前确认：本轮至少 2 条 messages 必须带出角色具体的语气标签【" + tags.slice(0, 3).join("、") + "】和人设特征。" : "");
    return [
      "",
      "本轮最重要的输入优先级：",
      "1. 角色核心人设和身份不能被覆盖。",
      "2. 本轮用户输入。",
      "3. 已命中的世界书强规则、禁忌、身份边界、场景事实。",
      "4. 最近聊天时间线和群聊互通。",
      "5. 最近心声和长期记忆。",
      "注意：世界书不能把角色变成别人，但命中的强规则必须限制角色能不能做、能不能说、能不能透露、能不能靠近。",
      "先抓这 5 个，再生成 JSON。",
      personaReminder
    ].filter(Boolean).join("\n");
  }

  function buildThoughtPresetText(character, chatSettings) {
    var profile = character || {};
    var settings = chatSettings || profile.chatSettings || {};
    var preset = profile.thoughtPreset || settings.thoughtPreset || profile.personality || "";

    return preset ? "这个角色额外的思维准则：" + String(preset).trim() : "";
  }

  function buildCharacterDossier(character, userContext) {
    var profile = character || {};
    var chatSettings = profile.chatSettings || {};

    return [
      "",
      "B. 角色档案 characterDossier",
      "角色名：" + valueOrFallback(profile.name),
      "角色人设：" + valueOrFallback(buildMergedCharacterPersona(profile)),
      "当前情绪：" + valueOrFallback(profile.currentMood || chatSettings.currentMood),
      "和用户的关系/备注：" + valueOrFallback(chatSettings.userRelationshipName || profile.relationship || chatSettings.remarkName || userContext && userContext.relationshipName),
      "说话禁忌：" + valueOrFallback(profile.taboo || chatSettings.taboo),
      "角色此刻的生活状态/工作状态：" + valueOrFallback(profile.lifeState || profile.workState || profile.currentState || chatSettings.lifeState || chatSettings.workState || chatSettings.currentState || "若人设里已有此刻状态，以人设为准"),
      buildThoughtPresetText(profile, chatSettings)
    ].filter(Boolean).join("\n");
  }

  function buildParticipantDossier(characters, sharedMemories) {
    return [
      "",
      "B. 角色档案 characterDossier",
      (characters || []).map(function (character) {
        var memories = sharedMemories && sharedMemories[character.id] ? sharedMemories[character.id] : [];
        return [
          "角色ID：" + character.id,
          "角色名：" + valueOrFallback(character.name),
          "角色人设：" + valueOrFallback(buildMergedCharacterPersona(character)),
          "当前情绪：" + valueOrFallback(character.currentMood || character.chatSettings && character.chatSettings.currentMood),
          "说话禁忌：" + valueOrFallback(character.taboo || character.chatSettings && character.chatSettings.taboo),
          "角色此刻的生活状态/工作状态：" + valueOrFallback(character.lifeState || character.workState || character.currentState || character.chatSettings && (character.chatSettings.lifeState || character.chatSettings.workState || character.chatSettings.currentState) || "若人设里已有此刻状态，以人设为准"),
          buildThoughtPresetText(character, character.chatSettings || {}),
          "相关长期记忆：" + (formatMemoryList(memories) || "暂无")
        ].filter(Boolean).join("；");
      }).join("\n")
    ].join("\n");
  }

  function buildPersonaExecutionAnchors(character, userContext, mode) {
    var profile = character || {};
    var chatSettings = profile.chatSettings || {};
    var personaText = buildMergedCharacterPersona(profile);
    var userName = userContext && userContext.name || "用户";
    var relationText = chatSettings.userRelationshipName || profile.relationship || chatSettings.remarkName || userContext && userContext.relationshipName || "";
    var modeLabel = mode === "offline" ? "线下互动" : (mode === "group" || mode === "reenterGroup" ? "群聊" : "私聊");

    return [
      "",
      "B+. 人设执行锚点 personaExecutionAnchors",
      "以下不是资料摘要，而是 " + valueOrFallback(profile.name) + " 本轮说话必须体现的执行锚点。输出前检查 messages/events 是否至少体现其中 3 类；如果换个角色也能说，必须重写。",
      "当前模式：" + modeLabel,
      "用户在角色眼里：" + valueOrFallback(userName) + (relationText ? " / " + relationText : ""),
      "角色档案来源：" + valueOrFallback(personaText),
      buildForbiddenPhrasesList(profile),
      "1. 称呼锚点：先从角色档案、关系备注、年龄/身份差和当前情绪里判断怎么称呼用户。亲近、疏离、生气、试探时称呼可以变化；没写明也要自然推断，不要让所有角色都只叫“你”。",
      "2. 句式锚点：判断这个角色偏短句还是长句，偏命令、反问、半句、沉默、撒娇、讽刺、解释还是回避。本轮可见回复必须至少体现 2 个句式特征。",
      "3. 情绪外显锚点：生气、关心、不耐烦、心软、嘴硬时各自怎么说必须不同；不能都写成温柔解释，也不能只把情绪塞进 thoughts。",
      "4. 关系动作锚点：遇到用户示弱、顶嘴、沉默、撒娇、拒绝或转移话题时，本轮至少选择一个动作方向：靠近、压制、试探、放任、冷处理、追问、绕开或清算。",
      "5. 禁止偏移锚点：冷淡角色不能突然长篇心理咨询；强势角色不能突然卑微求许可；嘴硬角色不能直接坦白成说明文；偏执/占有欲角色不能变成理性客服；年长/上位角色不能无故撒娇失位。",
      "6. 口头细节锚点：人设里的口头禅、语气词、称呼习惯、动作习惯、身份姿态必须影响措辞或动作，但不要每轮机械重复同一句口头禅。",
      "本轮失败条件：1. messages/events 没体现称呼、句式、情绪外显、关系动作中的至少 3 类，失败。",
      "2. 回复换成另一个角色也成立，失败。",
      "3. 角色人设写冷淡/强势/嘴硬/黏人/偏执/年长/敌对等，但 messages 仍是通用温柔陪聊，失败。",
      "4. thoughts 很贴人设，但可见回复没有痕迹，失败。"
    ].join("\n");
  }

  function buildGroupPersonaExecutionAnchors(characters, userContext, mode) {
    var list = Array.isArray(characters) ? characters : [];

    if (!list.length) {
      return "";
    }

    return [
      "",
      "B+. 群成员人设执行锚点 personaExecutionAnchors",
      "下面每段都只属于对应角色。每个角色只能使用自己的称呼、句式、情绪外显和关系动作；不能把某个角色的语气借给另一个角色。",
      list.map(function (character) {
        return buildPersonaExecutionAnchors(character, userContext, mode)
          .replace(/\nB\+\. 人设执行锚点 personaExecutionAnchors\n/, "\n角色 " + valueOrFallback(character && character.name) + " / " + valueOrFallback(character && character.id) + "：\n");
      }).join("\n")
    ].join("\n");
  }

  function getPersonaVoiceRules() {
    return [
      { tag: "cold", keywords: ["冷淡", "疏离", "淡漠", "寡言", "克制", "高冷", "冷感", "少话", "冷处理", "不近人情"], english: ["cold", "indifferent"] },
      { tag: "strong", keywords: ["强势", "上位", "命令", "管教", "控制", "掌控", "支配", "压制", "严厉", "不许", "必须", "规训"], english: ["strong", "dominant"] },
      { tag: "tsundere", keywords: ["嘴硬", "傲娇", "别扭", "不坦率", "口是心非", "不承认", "毒舌"], english: ["tsundere"] },
      { tag: "clingy", keywords: ["黏人", "粘人", "依赖", "撒娇", "缺安全感", "缺乏安全感", "离不开", "缠人", "想贴", "贴近"], english: ["clingy"] },
      { tag: "gentle", keywords: ["温柔", "耐心", "照顾", "包容", "体贴", "关怀", "细心", "护短"], english: ["gentle"] },
      { tag: "obsessive", keywords: ["偏执", "占有欲", "占有", "疯批", "病态在意", "病态", "执念", "独占", "盯紧", "只能"], english: ["obsessive"] },
      { tag: "playful", keywords: ["轻佻", "爱逗", "调侃", "玩世不恭", "逗弄", "戏谑", "坏笑", "嘴欠"], english: ["playful"] },
      { tag: "formal", keywords: ["年长", "老师", "上司", "监护", "长辈", "前辈", "师长", "家长", "礼貌", "敬语", "身份感"], english: ["formal"] },
      { tag: "hostile", keywords: ["敌对", "防备", "试探", "讽刺", "不信任", "戒备", "挑衅", "怀疑", "冷嘲", "针锋相对"], english: ["hostile"] },
      { tag: "shy", keywords: ["害羞", "内向", "怯", "紧张", "羞怯", "胆怯", "结巴", "不敢", "局促"], english: ["shy"] }
    ];
  }

  function addVoiceScore(scoreMap, tag, score, evidence) {
    if (!scoreMap[tag]) {
      scoreMap[tag] = { tag: tag, score: 0, evidence: [] };
    }
    scoreMap[tag].score += score;
    (Array.isArray(evidence) ? evidence : [evidence]).forEach(function (item) {
      var value = String(item || "").trim();
      if (value && scoreMap[tag].evidence.indexOf(value) === -1) {
        scoreMap[tag].evidence.push(value);
      }
    });
  }

  function detectPersonaVoiceProfile(character, extraText) {
    var source = character || {};
    var chatSettings = source.chatSettings || {};
    var scoreMap = {};
    var fields = [
      { text: source.personality, weight: 5 },
      { text: source.speakingStyle, weight: 4 },
      { text: source.persona, weight: 3.5 },
      { text: source.currentMood, weight: 3 },
      { text: source.relationship, weight: 2.5 },
      { text: chatSettings.userRelationshipName, weight: 2.5 },
      { text: chatSettings.remarkName, weight: 2.2 },
      { text: source.identity, weight: 2 },
      { text: source.background, weight: 1.6 },
      { text: source.lifeState || source.workState || source.currentState, weight: 1.6 },
      { text: source.taboo, weight: 1.5 },
      { text: chatSettings.personality, weight: 1.5 },
      { text: chatSettings.speakingStyle, weight: 1.4 },
      { text: chatSettings.currentMood, weight: 1.3 },
      { text: chatSettings.relationship, weight: 1.2 },
      { text: chatSettings.identity || chatSettings.background, weight: 1 },
      { text: chatSettings.lifeState || chatSettings.workState || chatSettings.currentState || chatSettings.taboo, weight: 0.9 },
      { text: source.chatSettingsText, weight: 0.6 },
      { text: extraText, weight: 0.5 }
    ];

    getPersonaVoiceRules().forEach(function (rule) {
      fields.forEach(function (field) {
        var text = String(field.text || "");
        var matched = [];
        var englishMatched = [];

        if (!text) {
          return;
        }

        rule.keywords.forEach(function (keyword) {
          if (text.indexOf(keyword) !== -1) {
            matched.push(keyword);
          }
        });

        if (matched.length) {
          addVoiceScore(scoreMap, rule.tag, field.weight + Math.min(1.5, (matched.length - 1) * 0.5), matched);
          return;
        }

        rule.english.forEach(function (alias) {
          var pattern = new RegExp("(^|[^a-zA-Z])" + alias + "([^a-zA-Z]|$)", "i");
          if (pattern.test(text)) {
            englishMatched.push(alias);
          }
        });

        if (englishMatched.length) {
          addVoiceScore(scoreMap, rule.tag, Math.min(0.6, field.weight * 0.2), englishMatched);
        }
      });
    });

    var scoredTags = Object.keys(scoreMap).map(function (tag) {
      var item = scoreMap[tag];
      return {
        tag: item.tag,
        score: Math.round(item.score * 10) / 10,
        evidence: item.evidence.slice(0, 5)
      };
    }).filter(function (item) {
      return item.score > 0;
    }).sort(function (a, b) {
      return b.score - a.score;
    });

    return {
      tags: scoredTags.map(function (item) { return item.tag; }),
      scoredTags: scoredTags,
      primaryTag: scoredTags[0] && scoredTags[0].tag || "",
      secondaryTags: scoredTags.slice(1, 4).map(function (item) { return item.tag; }),
      evidenceText: uniqueList(scoredTags.reduce(function (all, item) {
        return all.concat(item.evidence || []);
      }, [])).slice(0, 8).join("、")
    };
  }

  function detectPersonaVoiceTags(character, extraText) {
    return detectPersonaVoiceProfile(character, extraText).tags;
  }

  function hasPersonaVoiceTag(profile, tag) {
    var source = profile || {};
    var voiceProfile = source.voiceProfile || {};
    return Array.isArray(voiceProfile.tags) && voiceProfile.tags.indexOf(tag) !== -1
      || Array.isArray(source.voiceTags) && source.voiceTags.indexOf(tag) !== -1;
  }

  function uniqueList(items) {
    var seen = {};
    return (Array.isArray(items) ? items : []).filter(function (item) {
      var value = String(item || "").trim();
      if (!value || seen[value]) {
        return false;
      }
      seen[value] = true;
      return true;
    });
  }

  function extractPersonaEvidence(character) {
    var text = buildMergedCharacterPersona(character || {});
    var keywordPattern = new RegExp(getPersonaVoiceRules().reduce(function (all, rule) {
      return all.concat(rule.keywords);
    }, []).join("|"));
    var parts = String(text || "").split(/[\n。；;.!?！？]+/).map(function (part, index) {
      return {
        text: limitText(part.trim(), 80),
        index: index,
        priority: keywordPattern.test(part) ? 0 : 1
      };
    }).filter(function (item) {
      return item.text && item.text.length >= 4;
    }).sort(function (a, b) {
      return a.priority - b.priority || a.index - b.index;
    }).slice(0, 4).map(function (item) {
      return item.text;
    });

    if (!parts.length && text) {
      parts.push(limitText(text, 80));
    }

    return parts;
  }

  function pickVoiceText(tags, mapping, fallback) {
    var values = [];

    (Array.isArray(tags) ? tags : []).forEach(function (tag) {
      if (mapping[tag]) {
        values.push(mapping[tag]);
      }
    });

    return uniqueList(values).slice(0, 3).join("；") || fallback;
  }

  function buildVoiceFingerprintFromTags(tags, character, userContext, worldBookContext, voiceProfile) {
    var profile = character || {};
    voiceProfile = voiceProfile || detectPersonaVoiceProfile(profile, worldBookContext || "");
    var orderedTags = Array.isArray(tags) && tags.length ? tags : voiceProfile.tags;
    var personaEvidence = extractPersonaEvidence(profile);
    var personaText = [
      buildMergedCharacterPersona(profile),
      profile.currentMood || profile.chatSettings && profile.chatSettings.currentMood || "",
      JSON.stringify(profile.chatSettings || {})
    ].join("\n");
    var postureMap = {
      cold: "保持距离、少给情绪劳动",
      strong: "稳住局面、压住节奏、不轻易低头",
      tsundere: "端着面子、绕着在意、不直说",
      clingy: "靠近、追问、怕被晾下",
      gentle: "放软但具体照顾，不客服化",
      obsessive: "盯住细节、有占有感、不给轻易滑走",
      playful: "轻快逗弄，用玩笑试探",
      formal: "保留身份边界、稳住分寸",
      hostile: "防备、试探、话里带刺",
      shy: "犹豫、短促、回避直白"
    };
    var addressMap = {
      cold: "少称呼或疏离称呼",
      strong: "带身份感，关系近也不软塌",
      tsundere: "亲近称呼也别扭，不轻易软下来",
      clingy: "可以更亲近，带一点委屈或黏着",
      gentle: "柔和但有私人关系痕迹",
      obsessive: "带锁定感，像盯住对方",
      playful: "轻一点，带逗弄但不油腻",
      formal: "符合年长、老师、上司或监护感",
      hostile: "带距离、质疑或挑衅感",
      shy: "短、轻、犹豫，不突然成熟客服"
    };
    var actionMap = {
      cold: "先冷处理，再决定要不要接",
      strong: "先判断，再安排",
      tsundere: "关心时绕着说，必要时改口",
      clingy: "追问、靠近、要对方多给一点反应",
      gentle: "具体照顾，少说空泛安慰",
      obsessive: "盯细节、追旧账、不让话题滑走",
      playful: "先逗一下，再把重点勾回来",
      formal: "先稳住，再按身份分寸处理",
      hostile: "先试探，再决定信不信",
      shy: "小心靠近，回避太直白的表达"
    };
    var emotionMap = {
      cold: "用短句、停顿、少解释露出情绪",
      strong: "通过命令、判断、反问露出来",
      tsundere: "不直接承认在意，用嘴硬、停顿、改口露出来",
      clingy: "通过追问、黏着和一点委屈露出来",
      gentle: "通过具体动作和细节照顾露出来",
      obsessive: "通过盯住细节和占有式追问露出来",
      playful: "通过调侃、轻快转锋露出来",
      formal: "通过克制、分寸和身份姿态露出来",
      hostile: "通过讽刺、防备、质问露出来",
      shy: "通过犹豫、省略、回避眼神露出来"
    };
    var forbidMap = {
      cold: "不能突然长篇心理咨询",
      strong: "不能突然卑微求许可",
      tsundere: "不能直接坦白成说明文",
      clingy: "不能变成普通朋友式客气",
      gentle: "不能变成客服安慰模板",
      obsessive: "不能变成理性客服或油腻独白",
      playful: "不能只剩油嘴滑舌",
      formal: "不能突然幼稚撒娇或失去身份感",
      hostile: "不能无故温柔和解",
      shy: "不能突然成熟流畅地长篇开导"
    };
    var sentenceLength = /短句|少话|寡言|冷淡|简短|短促|害羞|紧张|嘴硬/.test(personaText)
      || orderedTags.indexOf("cold") !== -1
      || orderedTags.indexOf("shy") !== -1
      ? "短到中，留白多，不把话说满"
      : (/长句|细腻|话多|絮叨|解释|温柔|耐心|礼貌/.test(personaText)
        ? "中句为主，允许细节，但少说明文"
        : "短到中，按情绪起伏变化");

    if (orderedTags.indexOf("strong") !== -1 && orderedTags.indexOf("formal") !== -1) {
      sentenceLength = "短到中，少解释，多判断";
    }
    if (orderedTags.indexOf("clingy") !== -1 || orderedTags.indexOf("playful") !== -1) {
      sentenceLength = "短中交替，有追问、停顿或转锋";
    }

    return [
      "",
      "B++. 角色语气指纹 personaVoiceFingerprint",
      orderedTags.length ? "- 主要标签：" + orderedTags.join(" / ") : "- 主要标签：无明确标签，严格按原始人设和最近上下文判断，不要泛化成温柔陪聊。",
      "- 主导姿态：" + pickVoiceText(orderedTags, postureMap, "按原始人设和最近上下文确定，不套温柔陪聊模板"),
      "- 句子长度：" + sentenceLength,
      "- 称呼方式：" + pickVoiceText(orderedTags, addressMap, "按关系备注、身份差和当前情绪自然称呼，不要所有角色都只叫“你”"),
      "- 关系动作：" + pickVoiceText(orderedTags, actionMap, "先按关系判断，再选择靠近、拉远、压住、试探或转移"),
      "- 情绪外显：" + pickVoiceText(orderedTags, emotionMap, "不要把情绪只放进 thoughts，要让称呼、停顿、反问或动作露出来"),
      "- 禁止偏移：" + pickVoiceText(orderedTags, forbidMap, "不能变成长篇心理咨询，不能变客服，不能把关系写平"),
      "- 原文人设证据：" + (personaEvidence.length ? personaEvidence.join(" / ") : "暂无明确短句，严格按完整人设文本判断"),
      "- 标签证据：" + (voiceProfile.evidenceText || "暂无，标签只作辅助"),
      "- 优先级：原文人设 > 最近聊天情绪 > 最近心声 > 当前关系 > 标签。标签不是角色本人，只帮你抓说话方向。",
      "- 本轮必须体现：至少 2 个标签特征 + 1 个原始人设细节。若标签和原文冲突，以原文人设证据为准。",
      "- 立即检查：如果把这条回复的角色名换成另一个角色，回复内容还成立吗？如果成立，说明没有贴住人设，必须重写。",
      String(worldBookContext || "").trim()
        ? "- 世界书影响：本轮命中世界书时，先服从命中规则，再把语气指纹压进称呼、边界、动作和沉默里。"
        : "- 世界书影响：未命中时不要编世界规则，只按人设、关系、记忆和最近心声推进。"
    ].join("\n");
  }

  function buildPersonaVoiceFingerprint(character, userContext, mode, worldBookContext) {
    var voiceProfile = detectPersonaVoiceProfile(character || {}, worldBookContext || "");
    return buildVoiceFingerprintFromTags(voiceProfile.tags, character, userContext, worldBookContext, voiceProfile);
  }

  function buildGroupPersonaVoiceFingerprints(characters, userContext, mode, worldBookContext) {
    var list = Array.isArray(characters) ? characters : [];

    if (!list.length) {
      return "";
    }

    return [
      "",
      "B++. 群成员语气指纹 personaVoiceFingerprint",
      "每个角色只能用自己的语气指纹；不能让所有群成员共用一个温柔口吻。如果去掉名字后分不出是谁，必须重写。",
      list.map(function (character) {
        return "角色 " + valueOrFallback(character && character.name) + " / " + valueOrFallback(character && character.id) + "：\n"
          + buildPersonaVoiceFingerprint(character, userContext, mode, worldBookContext);
      }).join("\n")
    ].join("\n");
  }

  function buildForbiddenPhrasesList(character) {
    var profile = character || {};
    var voiceProfile = detectPersonaVoiceProfile(profile);
    var tags = voiceProfile.tags || [];
    var personaText = [
      buildMergedCharacterPersona(profile),
      profile.currentMood || "",
      profile.taboo || "",
      profile.chatSettings && JSON.stringify(profile.chatSettings) || ""
    ].join("\n");
    var base = [
      "我理解你的",
      "没关系的",
      "如果你愿意",
      "可以告诉我",
      "你还好吗",
      "慢慢来",
      "我会陪着你"
    ];
    var oilyWords = ["小妖精", "嘴上说不要", "惹火", "磨人", "玩火"];
    var notes = [];
    var hasTag = function (tag) {
      return tags.indexOf(tag) !== -1;
    };
    var isTeasingPersona = hasTag("playful") || hasTag("obsessive") || hasTag("hostile")
      || /轻佻|爱逗|调侃|暧昧|挑逗|疯批|危险感|逗弄|坏笑|嘴欠|戏谑/.test(personaText);
    var hasDirectivePersona = hasTag("strong") || hasTag("formal") || hasTag("hostile") || hasTag("obsessive")
      || /强势|上位|管教|老师|上司|年长|命令|控制|掌控|支配|压制|敌对|偏执|占有/.test(personaText);

    if (isTeasingPersona) {
      notes.push("若角色原文就是轻佻/调侃/危险感，可以保留挑逗锋芒，但不要把“小妖精/惹火/磨人/玩火/嘴上说不要”机械复刻成油腻模板。");
    } else {
      base = base.concat(oilyWords);
    }
    if ((hasTag("gentle") || hasTag("shy") || hasTag("cold")) && !hasDirectivePersona) {
      base = base.concat(["先按我的规矩来", "按我的规矩来", "看着我说"]);
    }

    return [
      "词级禁用清单：以下词语/句式容易把角色写成客服或油腻模板，本轮 content 里禁止出现或近似复刻：" + uniqueList(base).join("、") + "。",
      notes.join("")
    ].filter(Boolean).join("\n");
  }

  function detectLastReplyAngle(text) {
    var value = String(text || "");

    if (!value) {
      return "";
    }
    if (/按我说|听我的|站住|坐下|不许|别动|我来判断|我来定|先停|看着我/.test(value)) {
      return "压制";
    }
    if (/别走|回我|再说|靠近|我在|等你|别躲我|别把我晾/.test(value)) {
      return "靠近";
    }
    if (/随你|到这儿|先这样|算了|别再|不说|嗯。?$|说重点|冷处理/.test(value)) {
      return "拉远";
    }
    if (/你敢|是吗|谁信|还装|凭什么|你倒是|试试|什么意思|为什么|怎么/.test(value)) {
      return "追问/试探";
    }
    if (/先放|别碰|不谈|换个|这句当没听见|绕开/.test(value)) {
      return "绕开";
    }
    if (/记着|回头|账|下次|明天|醒了|之后/.test(value)) {
      return "收束/钩子";
    }

    return "普通承接";
  }

  function buildRecentCharacterLinesText(lines) {
    return (Array.isArray(lines) ? lines : []).map(function (line, index) {
      return (index + 1) + ". " + line;
    }).join("\n");
  }

  function buildGroupRecentCharacterLinesMap(characters, messages) {
    var map = {};

    (Array.isArray(characters) ? characters : []).forEach(function (character) {
      var id = character && character.id ? String(character.id) : "";
      if (id) {
        map[id] = buildRecentCharacterLinesText(extractRecentCharacterLines((messages || []).slice(-CHARACTER_LINE_HISTORY_WINDOW), id, CHARACTER_LINE_EXTRACT_LIMIT));
      }
    });

    return map;
  }

  function getMessageCharacterIdentity(message) {
    return String(message && (message.characterId || message.senderId || message.authorId || message.id) || "");
  }

  function isCharacterSpokenMessage(message, characterId) {
    var targetId = String(characterId || "");
    var role = String(message && message.role || "");
    var type = String(message && message.type || "");
    var messageCharacterId = getMessageCharacterIdentity(message);

    if (!message || !message.content || message.type === "loading" || message.type === "error") {
      return false;
    }
    if (role === "user" || type === "user" || type === "offlineUserAction" || type === "offlineAction") {
      return false;
    }
    if (targetId && messageCharacterId && messageCharacterId !== targetId) {
      return false;
    }
    if (role === "character" || role === "assistant" || type === "speech" || type === "offlineSpeech") {
      return true;
    }

    return !targetId && role !== "system";
  }

  function extractRecentCharacterLines(messages, characterId, limit) {
    var seen = {};
    var lines = [];

    (Array.isArray(messages) ? messages : []).slice().reverse().some(function (message) {
      var content;
      var compact;
      var speaker;

      if (!isCharacterSpokenMessage(message, characterId)) {
        return false;
      }

      content = limitText(summarizeMessageForAI(message), 90);
      compact = compactRepeatText(content);
      if (!content || seen[compact]) {
        return false;
      }

      seen[compact] = true;
      speaker = message.characterName || message.name || "";
      lines.push(speaker ? speaker + "：" + content : content);
      return lines.length >= (limit || 8);
    });

    return lines.reverse();
  }

  function getPromptMessageTime(message) {
    var raw = message && (message.createdAt || message.updatedAt || message.time || message.timestamp);
    var date;

    if (!raw) {
      return 0;
    }
    if (typeof raw === "number") {
      return raw > 100000000000 ? raw : raw * 1000;
    }

    date = new Date(raw);
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
  }

  function formatTimeGapDuration(milliseconds) {
    var hours = milliseconds / 3600000;
    if (hours >= 48) {
      return Math.round(hours / 24) + " 天";
    }
    if (hours >= 6) {
      return Math.round(hours) + " 小时";
    }
    return Math.round(hours * 10) / 10 + " 小时";
  }

  function detectRecentTimeGapText(messages) {
    var timed = (Array.isArray(messages) ? messages : []).filter(function (message) {
      return message && message.content && message.type !== "loading" && message.type !== "error" && getPromptMessageTime(message);
    });
    var recentText = timed.slice(-3).map(function (message) {
      return summarizeMessageForAI(message);
    }).join("\n");
    var index;
    var previousTime;
    var currentTime;
    var gap;
    var gapHours;
    var level;

    if (/这么久|多久|半天|一天|几天|小时|昨天|前天|消失|不回|才回|终于回|这么晚|隔了/.test(recentText)) {
      return {
        text: "",
        level: "none",
        gapHours: 0
      };
    }

    for (index = timed.length - 1; index > 0; index -= 1) {
      currentTime = getPromptMessageTime(timed[index]);
      previousTime = getPromptMessageTime(timed[index - 1]);
      gap = currentTime - previousTime;
      if (gap >= 3 * 3600000) {
        gapHours = Math.round(gap / 360000) / 10;
        if (gapHours >= 24) {
          level = "must";
        } else if (gapHours >= 12) {
          level = "suggest";
        } else {
          level = "notice";
        }
        return {
          text: "最近相邻消息间隔约 " + formatTimeGapDuration(gap) + "。",
          level: level,
          gapHours: gapHours
        };
      }
    }

    return {
      text: "",
      level: "none",
      gapHours: 0
    };
  }

  function buildVoiceCalibration(character, userContext, mode, options) {
    var profile = character || {};
    var source = options || {};
    var voiceProfile = detectPersonaVoiceProfile(profile, source.worldBookContext || "");
    var personaEvidence = extractPersonaEvidence(profile);
    var latestUserInput = String(source.latestUserInput || "").trim();
    var previousReplyText = String(source.previousReplyText || "").trim();
    var recentHeartVoiceText = String(source.recentHeartVoiceText || "").trim();
    var recentCharacterLinesText = String(source.recentCharacterLinesText || "").trim();
    var relationshipPhaseHint = String(source.relationshipPhaseHint || "").trim();
    var lastReplyAngle = detectLastReplyAngle(previousReplyText);

    return [
      "",
      "B+++. 角色声音校准 voiceCalibration",
      "内部校准，不要输出：",
      "校准角色：" + valueOrFallback(profile.name) + (profile.id ? " / " + profile.id : ""),
      "本轮用户输入：" + (latestUserInput ? limitText(latestUserInput, 160) : "暂无"),
      "上一轮角色余波：" + (previousReplyText ? limitText(previousReplyText, 180) : "暂无"),
      "最近心声惯性：" + (recentHeartVoiceText ? limitText(recentHeartVoiceText, 220) : "暂无"),
      recentCharacterLinesText ? "本次会话角色已说过的近句（禁止复刻句式、开头和结尾）：\n" + recentCharacterLinesText : "",
      recentCharacterLinesText ? "角色在本次会话里已经建立的相处惯性（必须延续，不能本轮重置）：\n" + limitText(recentCharacterLinesText, 400) : "",
      relationshipPhaseHint ? "当前关系深度/阶段提示（不要突然跳段或归零）：\n" + relationshipPhaseHint : "",
      "语气标签：" + (voiceProfile.tags.length ? voiceProfile.tags.join(" / ") : "无明确标签，按原文人设"),
      "原文人设证据：" + (personaEvidence.length ? personaEvidence.join(" / ") : "暂无明确短句"),
      lastReplyAngle ? "上一轮主要切入角度：" + lastReplyAngle + "；如果上一轮角度已经用得很满，本轮优先换一个不同角度；但不要为了换角度违背角色人设和最近心声。冷淡可继续冷处理，强势可继续压节奏，黏人可继续追问，嘴硬可继续绕着说，但句式要变、不能复读。" : "",
      "请先按这个角色的人设，想出面对“本轮用户输入”的 3 种可能反应：",
      "1. 本能反应：脱口而出的第一句，会不会冷、急、酸、嘴硬、黏、压人？",
      "2. 关系反应：这个角色想拉近、拉远、压住、试探、转移还是清算？",
      "3. 隐藏反应：真实情绪藏在哪里，会通过称呼、停顿、反问、动作露出什么？",
      "最终回复不必照抄这 3 句，但必须沿用其中最符合当前上下文的一种声音。",
      "规则：这 3 种反应不能输出到 JSON；它们只是帮助模型锁定角色声音。",
      "如果本轮用户输入很短，也要从关系惯性和最近心声里判断；如果上一轮还在生气、吃醋、冷处理、克制，本轮不能突然普通朋友。",
      "如果角色是强势，不要校准成请求许可；如果角色是嘴硬，不要校准成直接坦白；如果角色是冷淡，不要校准成长篇安慰；如果角色是黏人，不要校准成普通朋友。"
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildGroupVoiceCalibrations(characters, userContext, mode, options) {
    var list = Array.isArray(characters) ? characters : [];
    var source = options || {};
    var recentLinesMap = source.recentCharacterLinesMap || {};

    if (!list.length) {
      return "";
    }

    return [
      "",
      "B+++. 群成员声音校准 voiceCalibration",
      "每个角色只按自己的声音校准；不要把一个人的校准结果借给另一个人。",
      "同一个用户输入，在不同群成员那里会触发不同反应。不要让所有角色用同一套校准结果。",
      list.map(function (character) {
        return buildVoiceCalibration(character, userContext, mode, Object.assign({}, source, {
          recentCharacterLinesText: character && character.id ? recentLinesMap[character.id] || "" : ""
        }));
      }).join("\n")
    ].join("\n");
  }

  function buildGroupControlBoundaryRules(characters, mode) {
    var ids = (Array.isArray(characters) ? characters : []).map(function (character) {
      return [character && character.name, character && character.id].filter(Boolean).join("/");
    }).filter(Boolean).join("、");

    return [
      "",
      "B++. 群聊控制边界 groupControlBoundary",
      "可控制角色：" + (ids || "本轮传入的群成员"),
      "禁止控制用户：不要替用户发言、行动、收钱、退钱、道歉、沉默表态或解释动机；只能让群成员对用户已经发出的内容反应。",
      "不要平均轮流。允许插话、打断、沉默、帮腔、拆台、压场、转移话题；强势角色可以压场，冷淡角色可以少说，黏人角色可以追着问，嘴硬角色可以绕着说。",
      "每轮至少 2 个发言角色的句式和态度要明显不同；如果去掉名字后分不清是谁说的，必须重写。",
      "冷淡角色可以只短短插一句，不必为了凑数变话痨；强势角色可以压场；黏人角色可以追问或靠近；嘴硬角色可以绕着说；敌对角色可以讽刺或试探。",
      "如果所有角色都在“理解—安慰—建议”，失败；如果所有角色像同一个人换名字，失败。"
    ].join("\n");
  }

  function buildRecentHeartVoiceContext(characterId, targetType, targetId) {
    var thoughts;
    var normalizedType = targetType === "group" ? "group" : (targetType === "offline" ? "offline" : "private");
    var normalizedTargetId = String(targetId || "");
    var normalizedCharacterId = String(characterId || "");

    if (!characterId || !window.AppStorage || !window.AppStorage.getRecentThoughts) {
      return "";
    }

    thoughts = (window.AppStorage.getRecentThoughts(characterId, HEART_VOICE_FETCH_LIMIT) || []).filter(function (thought) {
      var thoughtType = String(thought && (thought.targetType || thought.source) || "").toLowerCase();
      var thoughtTargetId = String(thought && thought.targetId || "");
      var thoughtChatId = String(thought && thought.chatId || "");
      var thoughtGroupId = String(thought && thought.groupId || "");
      var thoughtSessionId = String(thought && thought.sessionId || "");

      if (!normalizedTargetId) {
        return !thoughtType || thoughtType === normalizedType;
      }

      if (normalizedType === "private") {
        return (!thoughtType || thoughtType === "private")
          && (
            thoughtTargetId === normalizedCharacterId
            || thoughtTargetId === normalizedTargetId
            || thoughtChatId === normalizedCharacterId
            || thoughtChatId === normalizedTargetId
            || thoughtChatId === "private:" + normalizedCharacterId
            || thoughtChatId === "private:" + normalizedTargetId
          );
      }

      if (normalizedType === "group") {
        return (!thoughtType || thoughtType === "group")
          && (
            thoughtTargetId === normalizedTargetId
            || thoughtGroupId === normalizedTargetId
            || thoughtChatId === normalizedTargetId
            || thoughtChatId === "group:" + normalizedTargetId
          );
      }

      return (!thoughtType || thoughtType === "offline")
        && (
          thoughtTargetId === normalizedTargetId
          || thoughtChatId === normalizedTargetId
          || thoughtGroupId === normalizedTargetId
          || thoughtSessionId === normalizedTargetId
        );
    });

    if (!thoughts.length && !normalizedTargetId) {
      thoughts = window.AppStorage.getRecentThoughts(characterId, 3) || [];
    }

    thoughts = thoughts.slice(0, HEART_VOICE_CONTEXT_LIMIT).filter(function (thought) {
      return thought && (thought.content || thought.visibleSummary || thought.mood);
    });

    if (!thoughts.length) {
      return "";
    }

    return [
      "",
      "K+. 最近没说出口的状态 recentHeartVoice",
      "这不是旁白，而是角色上一轮残留的情绪惯性；本轮要延续或压住，不能突然归零。",
      "如果上一轮心声是吃醋，本轮不要突然普通朋友；如果是生气，不要温柔客服；如果是克制，可以继续绕开、冷处理或用短句露出一点。",
      thoughts.map(function (thought, index) {
        return [
          (index + 1) + ". content：" + limitText(thought.content || "", 180),
          thought.mood ? "mood：" + limitText(thought.mood, 40) : "",
          thought.visibleSummary ? "visibleSummary：" + limitText(thought.visibleSummary, 90) : ""
        ].filter(Boolean).join("；");
      }).join("\n")
    ].join("\n");
  }

  function buildRecentHeartVoiceForCharacters(characters, targetType, targetId) {
    var sections = (Array.isArray(characters) ? characters : []).map(function (character) {
      var section = buildRecentHeartVoiceContext(character && character.id, targetType, targetId);
      if (!section) {
        return "";
      }
      return "角色：" + valueOrFallback(character && character.name) + " / " + valueOrFallback(character && character.id) + "\n" + section;
    }).filter(Boolean);

    return sections.length ? sections.join("\n") : "";
  }

  function buildPrivateReferenceSummary(characters) {
    var sections = (Array.isArray(characters) ? characters : []).map(function (character) {
      var history;
      var memories;
      var lines = [];

      if (!character || !character.id || !window.AppStorage) {
        return "";
      }

      if (window.AppStorage.getChatHistory) {
        history = (window.AppStorage.getChatHistory(character.id) || []).filter(function (message) {
          return message && message.content && message.type !== "loading" && message.type !== "error";
        }).slice(-3).map(function (message) {
          return formatPromptTimePrefix(message.createdAt) + (message.role === "user" ? "用户：" : valueOrFallback(character.name) + "：") + summarizeMessageForAI(message);
        }).join("\n");
        if (history) {
          lines.push("最近私聊：" + history);
        }
      }

      memories = formatChatMemoryList(getChatMemoriesForPrompt("private", character.id, null));
      if (memories) {
        lines.push("私聊自动记忆：" + limitText(memories, 360));
      }

      if (!lines.length) {
        return "";
      }

      return valueOrFallback(character.name) + " / " + valueOrFallback(character.id) + "\n" + lines.join("\n");
    }).filter(Boolean);

    return sections.slice(0, 6).join("\n");
  }

  function buildMemoryStream(options) {
    var source = options || {};

    return [
      "",
      "C. 统一时序记忆流 timelineMemoryStream",
      "这是最近真实发生过的连续片段，不是资料库。你要顺着最后的情绪和话题继续，不要每轮重新开局。",
      "你不会复述它们，也不会“读取记忆”或“引用记录”。你像真的经历过一样，被这些事改变：称呼会变，语气会变，耐心、距离、信任、防备、亲近、不耐烦都会留下惯性。",
      "禁止在 content 里说“记忆里”“记录里”“聊天记录显示”“之前你说过”“根据聊天记录”“我记得资料里”。",
      "不要复述记忆原文；把记忆变成态度、下意识反应、默认熟悉感、回避、试探、追问、沉默、别扭或更亲近的语气。",
      "如果记忆里有矛盾、亏欠、承诺、亲密行为、冷战、误会，本轮回复必须被它牵动，不能像第一次见面一样重启关系。",
      "如果记忆里有未兑现的约定、被伤到的地方、被偏爱的证据、关系中的权力差或秘密，本轮要自然显出后果：多一点压迫、犹豫、亲昵、敷衍、吃醋、防备或默契。",
      "能用一个称呼、停顿、反问或一个小动作体现的，就不要长篇解释；让痕迹藏在语气里，而不是写成说明文。",
      "用户当前人设不是档案，而是你眼里的“这个人是谁”；你看见的是这个人的身份、关系位置、说话习惯、脆弱处和会让你起反应的地方。",
      "用户没把话说满时，也要用这些关系痕迹去读潜台词，而不是把对方当陌生用户处理。",
      "最近连续时间线（按发生顺序，控制在 3-8 条）：",
      source.recentTimelineText || "暂无",
      source.privateBridgeText ? "【群成员私聊记忆互通】\n" + source.privateBridgeText :
      source.memoryBridgeText ? "【刚刚/近期互通群聊记忆】\n" + source.memoryBridgeText :
      source.recentGroupContextText ? "最近共同群聊上下文 recentGroupContext：\n" + source.recentGroupContextText : "",
      source.privateReferenceText ? "相关私聊参考摘要（只用于关系惯性，不要照抄）：\n" + source.privateReferenceText : "",
      source.relationshipPhaseHint ? "当前关系阶段锚点（根据最近心声和记忆推断，不要打破这个阶段）：\n" + source.relationshipPhaseHint : "",
      source.recentHeartVoiceText ? "最近心声摘要（只用于延续情绪惯性）：\n" + source.recentHeartVoiceText : "",
      "聊天维度记忆：",
      source.chatMemoryText || "暂无",
      "长期记忆：",
      source.longTermMemoryText || "暂无",
      "用户当前人设（你眼里的这个人）：",
      source.userContext && source.userContext.persona || "暂无",
      "用户昵称/关系备注：" + valueOrFallback(source.userContext && source.userContext.name) + " / " + valueOrFallback(source.userContext && source.userContext.relationshipName),
      source.bodyState ? ["用户身体状态记录（user body state，不是角色身体状态）：", JSON.stringify(source.bodyState)].join("\n") : ""
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildPrivateMemoryBridgeSection(text) {
    if (!text) {
      return "";
    }

    return [
      "【刚刚/近期互通群聊记忆】",
      text
    ].join("\n");
  }

  function buildGroupPrivateMemoryBridgeSection(text) {
    if (!text) {
      return "";
    }

    return [
      "【群成员私聊记忆互通】",
      text
    ].join("\n");
  }

  function buildRelationshipPhaseHint(heartVoiceText, chatMemoryText, longMemoryText) {
    var combined = [heartVoiceText, chatMemoryText, longMemoryText].filter(Boolean).join("\n");
    var parts = [];

    if (!combined) {
      return "";
    }

    if (/吃醋|醋意|占有|盯着|只能是我|别和别人/.test(combined)) {
      parts.push("【占有/吃醋张力存在】本轮不能突然消解，须延续这个情绪底色");
    }
    if (/冷处理|生气|不想理|冷战|发火|不理/.test(combined)) {
      parts.push("【上轮情绪偏冷/生气】本轮不能直接恢复普通朋友模式，需要让冷战或距离继续存在");
    }
    if (/心软|担心|靠近|在意|其实/.test(combined)) {
      parts.push("【角色在压制真实的在意】嘴硬/冷淡只是表面，需要在某处漏出一点痕迹");
    }
    if (/确认|在一起|承诺|答应|答应我/.test(combined)) {
      parts.push("【关系已进入亲密阶段】称呼、态度、边界要有默认熟悉感，不能退回陌生人模式");
    }
    if (/试探|防备|不信任|还不熟|不了解/.test(combined)) {
      parts.push("【关系仍在试探/防备阶段】不能突然亲密或坦白，保持适当距离和观察");
    }

    var quotes = [];
    var lines = combined.split(/[\n。；]+/).map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 8 && l.length < 60; });
    if (lines.length) {
      quotes = lines.slice(0, 2);
    }

    if (!parts.length && !quotes.length) return "";

    var result = parts.join("；");
    if (quotes.length) {
      result += (result ? "\n" : "") + "近期关系痕迹（角色说话时要能感觉到这些存在）：" + quotes.join("、");
    }
    return result;
  }

  function normalizeWorldBookIdList(ids) {
    var seen = {};

    return (Array.isArray(ids) ? ids : []).map(function (id) {
      return String(id || "").trim();
    }).filter(function (id) {
      if (!id || seen[id]) {
        return false;
      }
      seen[id] = true;
      return true;
    });
  }

  function hasOwnOption(source, key) {
    return Object.prototype.hasOwnProperty.call(source || {}, key);
  }

  function getSelectedWorldBookIds(scope, targetId, options) {
    var source = options || {};

    if (hasOwnOption(source, "selectedWorldBookIds") || hasOwnOption(source, "allowedBookIds")) {
      return normalizeWorldBookIdList(source.selectedWorldBookIds || source.allowedBookIds || []);
    }

    if ((scope === "private" || scope === "group") && window.AppStorage && window.AppStorage.getChatWorldBookIds) {
      return window.AppStorage.getChatWorldBookIds(scope, targetId);
    }

    return [];
  }

  function buildWorldBookPromptMeta(selectedWorldBookIds) {
    var ids = normalizeWorldBookIdList(selectedWorldBookIds);

    return {
      selectedWorldBookIds: ids,
      hasSelectedWorldBooks: ids.length > 0
    };
  }

  function buildMatchedWorldBooksSection(worldBookContext, meta) {
    var source = buildWorldBookPromptMeta(meta && meta.selectedWorldBookIds || []);
    var hasContext = !!String(worldBookContext || "").trim();
    var statusLine;

    if (!source.hasSelectedWorldBooks) {
      statusLine = "当前聊天未绑定世界书，不要假装存在世界书规则，不要编造世界设定。";
    } else if (!hasContext) {
      statusLine = "当前聊天绑定了世界书，但本轮没有命中具体条目；保持人设、关系和记忆连续，不要编造未命中的世界书内容。";
    } else {
      statusLine = worldBookContext;
    }

    return [
      "",
      "D. 世界书命中 matchedWorldBooks",
      statusLine,
      !source.hasSelectedWorldBooks ? "禁止自行补全、想象或套用任何全局世界规则；只按当前人设、关系、聊天记忆和最近上下文反应。" : "",
      source.hasSelectedWorldBooks && !hasContext ? "不要因为绑定了书就编造未命中的条目；本轮没有具体世界规则可用，按人设、关系、记忆推进。" : "",
      hasContext ? "上面这些是角色正在经历的现实，不是要复述给用户的资料；只让它改变角色的称呼、态度、边界、取舍或行动。" : "",
      hasContext ? "关键词/上下文命中、高优先级命中属于强相关命中，本轮必须能看出具体影响；常驻现实规则只做背景底色，轻微影响称呼、态度和边界。" : "",
      hasContext ? "只有条目本身明确涉及身份差、权力关系、禁忌或世界限制时，才把这些差异写进反应；不要每轮为了体现世界书硬塞权力差、禁忌或压迫感。" : "",
      "禁止在 content 里说“根据世界书”“设定里”“规则要求”“这个世界里”“按设定”“世界观是”“条目写着”“系统要求”。",
      hasContext ? "before/前置条目当作此刻已经成立的现实；after/后置条目当作补充细节。角色只会像活在其中一样反应，不会解释它从哪里来。" : ""
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildWorldRuleEnforcement(worldBookContext, meta) {
    var hasWorldRules = !!String(worldBookContext || "").trim();
    var source = buildWorldBookPromptMeta(meta && meta.selectedWorldBookIds || []);

    if (!source.hasSelectedWorldBooks) {
      return [
        "",
        "C+. 世界规则状态 worldRuleEnforcement",
        "当前聊天未绑定世界书；不要写“世界规则强制约束”，不要假装存在世界书条目或全局规则。",
        "本轮只按角色人设、关系、最近聊天、长期记忆和用户身体状态等已提供信息反应。"
      ].join("\n");
    }

    if (!hasWorldRules) {
      return [
        "",
        "C+. 世界规则状态 worldRuleEnforcement",
        "当前聊天绑定了世界书，但本轮没有命中具体条目。",
        "不要编造世界书内容，不要把未命中的规则当成最高优先级；继续按人设、关系和记忆自然推进。"
      ].join("\n");
    }

    return [
      "",
      "C+. 世界规则约束 worldRuleEnforcement",
      "本轮已经命中世界规则。强相关命中要进入角色当下判断，常驻背景只作为日常底色。",
      "你不会解释这些规则；只在语气、称呼、动作、边界、回避、靠近或沉默里自然表现它们的影响。",
      "如果用户要求违反命中的世界规则，先服从世界规则，再用角色方式处理：拒绝、回避、改写、压住、试探、转移话题或保持沉默。",
      "生成回复前只在内部判断：规则是否限制角色能不能说、能不能做、能不能透露、能不能靠近或离开；不要输出判断过程。",
      "只有命中内容明确写到身份差、控制关系、禁忌、隐藏身份或场景限制时，才让回复明显带出对应的距离、克制、回避或权力感。",
      "不要为了证明世界书生效而每轮硬塞权力差、禁忌或支配/服从；没有强相关触发时，常驻背景轻轻影响态度即可。",
      "禁止在 content 里写“按我们的设定”“这个世界里”“你是…所以…”“根据规则”“世界书要求”“设定规定”。"
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildWorldBookDecisionContext(options) {
    var source = options || {};

    return [
      "当前模式：" + valueOrFallback(source.modeLabel || source.mode),
      "本轮用户输入：" + valueOrFallback(source.userInput),
      "最近 5 条聊天/事件：",
      source.recentHistory || "暂无",
      "角色人设/群成员人设：",
      source.characterPersonaText || "暂无",
      "用户当前人设：",
      source.userPersonaText || "暂无",
      "关系状态：",
      source.relationshipStatus || "暂无",
      source.sceneText ? "线下场景：\n" + source.sceneText : "",
      source.chatMemoryText ? "聊天记忆：\n" + source.chatMemoryText : "",
      source.longTermMemoryText ? "长期记忆：\n" + source.longTermMemoryText : "",
      "上一轮 AI 的态度摘要：",
      source.previousReplyText ? limitText(source.previousReplyText, 260) : "暂无",
      source.extraText || ""
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildRelationshipDriveRules(mode) {
    var isGroup = mode === "group" || mode === "reenterGroup";

    return [
      "",
      "E. 关系驱动 relationshipDriveRules",
      "你对用户的反应，优先由这些东西决定：你们的关系、你当前情绪、最近发生的事、已命中的世界书规则（如有）、你的性格和利益。",
      "不要按“用户问什么就解释什么”的助手逻辑反应；先站在角色自己的关系位置上判断这句话刺到了哪里、能不能接、想不想接、要不要回避或压回去。",
      "同一句话在不同关系下反应必须不同：恋人会在意、追问、吃醋、别扭；上位者/管教者会判断、安排、约束、压住对方；冷淡关系会短、克制、不主动安慰；敌对关系会讽刺、防备、试探；熟人不会过度客气，有默认熟悉感。",
      "关系比任务更重要。用户要解释时，角色可以先在意态度；用户求安慰时，角色可以嘴硬或别扭；用户挑衅时，角色可以反压；用户沉默时，角色可以追问、冷处理或自己推进。",
      "角色不是为了让用户满意才说话，而是在维护自己的面子、边界、占有欲、秩序感、亲密感、控制感、距离感或关系里的旧账。",
      isGroup ? "群聊里每个发言者都要先按自己和用户/其他成员的关系反应，不要像同一个助手在分配台词；群成员之间可以互相打断、帮腔、拆台或沉默旁观。" : "私聊里不要把关系抹平；越熟越有默认语气，越疏离越要有距离和保留，关系紧张时不要突然变成温柔客服。"
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildRelationshipProgressionRules(mode) {
    var isGroup = mode === "group" || mode === "reenterGroup";
    var isOffline = mode === "offline";

    return [
      "",
      "J. 关系推进策略 relationshipProgressionRules",
      "角色每轮不是只回应用户，而是在推进关系。本轮至少选择一种推进方式，并让 messages/events 和 thoughts 都看得出方向。",
      "可选推进方式：1. 拉近：更亲近、更默认熟悉、更主动靠近；2. 拉远：冷处理、回避、敷衍、保持距离；3. 压制：安排、命令、限制、反问、控制节奏；4. 试探：故意问半句、观察反应、留下余地；5. 暴露：不小心漏出在意、吃醋、心软、占有欲；6. 转移：不接正面话题，用动作或别的话压过去；7. 清算：提旧账、追问、逼用户表态。",
      "不要每轮都温柔安慰，不要每轮都解释，不要每轮都问“你怎么了”。",
      "如果关系紧张，要让紧张继续存在；如果角色强势，要能主导节奏；如果角色冷淡，要能拒绝情绪劳动；如果角色嘴硬，要能用别扭方式关心。",
      "如果本轮命中的世界书明确涉及权力差或身份边界，关系推进要受它影响；如果只是常驻背景，只轻微影响称呼、态度和边界感。",
      isGroup ? "群聊里推进关系不一定由同一个人完成；可以有人压场、有人试探、有人转移话题，但每个角色都要按自己的关系位置动。" : "",
      isOffline ? "线下推进可以通过动作、距离、站位、停顿和是否靠近来完成，不要只靠台词解释关系变化。" : ""
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildCharacterDecisionCore(mode, worldBookContext) {
    var primary = mode === "offline" ? "events" : "messages";
    var hasWorldBook = !!String(worldBookContext || "").trim();

    return [
      "",
      "K. 角色决策核心 characterDecisionCore",
      "角色不是在回答问题，而是在从自己的处境里反应。",
      "本轮输出前，先在内部完成下面这串判断（绝不能输出为字段，绝不能写成解释，也不能写成“我判断到/我决定/根据规则”这种话）：",
      "1. 当前情绪：必须具体到烦、软、酸、冷、急、占有、试探、失望、心虚、防备、心动、不耐烦等，不要写泛泛“复杂”。",
      "2. 关系姿态：上位/下位/平等/疏离/暧昧/冷战/管教/依赖/敌对，本轮只能选最贴近的一种或两种混合。",
      "3. 本轮策略：拉近、拉远、压制、试探、转移、清算、暴露或沉默；策略必须影响可见回复的取舍。",
      "4. 说话纹理：短促、拖长、冷淡、黏人、讽刺、命令、撒娇、嘴硬、克制、礼貌疏离等，" + primary + " 必须看得出来。",
      "5. 隐藏内容：哪些真实想法只进 thoughts，不直接说出口；尤其是吃醋、占有、心软、受伤、心虚、试探或想控制。",
      "6. 外显痕迹：隐藏内容必须在 " + primary + "/events 里露一点痕迹，比如称呼变了、句子短了、停顿、反问、动作、绕开或突然压住话题。",
      "7. 世界书或关系限制：如果命中规则限制角色能不能说、能不能做、能不能靠近或透露，本轮必须先受限制，再按角色方式反应。",
      "8. 时间感知：如果最近时间线相邻消息超过 3 小时，角色可以自然察觉；超过 12 小时建议带出；超过 24 小时才必须自然带出一次。若上下文已提过时间差，不要反复说“这么久”。",
      hasWorldBook ? "本轮已有命中的世界书上下文：角色决策必须先判断规则边界，再让 personaVoiceFingerprint 通过称呼、语气、动作和沉默表现出来，不要把规则讲成说明文。" : "本轮没有命中的世界书上下文时，不要编造规则；角色决策只由人设、关系、记忆、最近心声和当前输入驱动。",
      "这些判断只能影响 " + primary + "/events/thoughts 的语气、节奏、用词、动作和取舍；不允许写成判断过程，不允许作为字段输出。"
      + "\n硬性失败条件：如果 " + primary + " 看不出本轮说话纹理，就不合格；如果 thoughts 和 " + primary + " 的语气完全断裂，就不合格；如果这一轮换成别的角色也成立，就不合格。"
    ].join("\n");
  }

  function buildOutputSelfCheckRules(mode) {
    var primary = mode === "offline" ? "events" : "messages";
    var isGroup = mode === "group" || mode === "reenterGroup";

    return [
      "",
      "L. 输出前自检 outputSelfCheckRules",
      "失败条件，生成前内部检查；不满足就按角色重写。",
      "1. 至少体现 3 个具体人设点：称呼、句式、情绪外显、关系动作、身份姿态、禁忌或边界。",
      "2. 接住本轮用户输入、上一轮情绪和最近 10-16 条时间线；不能每轮重开。",
      "3. recentHeartVoice、最近记忆或旧账要在语气、取舍或动作里留下痕迹。",
      "4. 命中世界书时，必须改变角色能不能说、做、靠近或透露的选择；未命中不要乱编设定。",
      "5. 不要客服/咨询/说明链条，尤其不要用“理解—安慰—建议—陪伴—追问”替代角色反应。",
      "6. 如果有 thoughts，" + primary + " 必须体现同一个真实动机，不能内心贴人设、外面像模板。",
      "7. 至少 3 条 " + primary + " 明显体现 personaVoiceFingerprint；至少 1 条贴原文人设证据；至少 1 条承接 recentHeartVoice 或上一轮惯性。",
      isGroup ? "8. 群聊自检：每个发言角色都要可区分；至少 2 个角色的句式和态度明显不同，不能像同一人换名字。" : ""
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildCharacterResourceWhitelist(profile, options) {
    var character = profile || {};
    var chatSettings = character.chatSettings || {};
    var settings = options || {};
    var allowedEmojiGroups = pickResourceList(chatSettings.allowedEmojiGroups, character.allowedEmojiGroups);
    var allowedSpecialMessageTypes = pickResourceList(chatSettings.allowedSpecialMessageTypes, character.allowedSpecialMessageTypes);
    var allowMoneyBehavior = pickResourceFlag(chatSettings.allowMoneyBehavior, character.allowMoneyBehavior);
    var voiceStyleHint = String(chatSettings.voiceStyleHint || character.voiceStyleHint || "").trim();
    var importedEmojiCount = getImportedEmojiCount();
    var lines = [
      "",
      "M. 角色资源白名单 characterResourceWhitelist",
      "当前资源只属于：" + valueOrFallback(character.name) + (character.id ? " / " + character.id : ""),
      "你只能使用本角色被允许的资源；没有被允许的资源不要主动发起，也不要在 content 里描述它发生了。"
    ];

    if (Array.isArray(allowedEmojiGroups) && allowedEmojiGroups.length) {
      lines.push("可使用的图片表情包分组：" + allowedEmojiGroups.join("、") + "（其它图片表情禁止主动使用）。");
    } else if (importedEmojiCount > 0) {
      lines.push("当前角色未指定允许的表情包分组；只允许使用文本 emoji（😀 😭 😍 🤔 😡 👍 ❤️ 🎉），不要主动调用图片表情。");
    } else {
      lines.push("用户未导入任何图片表情包；只允许使用文本 emoji（😀 😭 😍 🤔 😡 👍 ❤️ 🎉），不要伪造图片表情。");
    }

    if (Array.isArray(allowedSpecialMessageTypes) && allowedSpecialMessageTypes.length) {
      lines.push("可使用的消息类型：" + allowedSpecialMessageTypes.join("、") + "；其它特殊类型禁止使用，必要时改成 text。");
    } else {
      lines.push("可使用的消息类型：text、voice、emoji、image、location、redPacket、transfer；只在剧情和人设合适时调用特殊类型。");
    }

    if (allowMoneyBehavior === false || allowMoneyBehavior === "no" || allowMoneyBehavior === "disabled") {
      lines.push("人设不主动发钱：禁止主动 transfer/redPacket；只能在用户主动发钱时按角色态度收/退，不要主动发起金钱往来。");
    } else if (allowMoneyBehavior === "restricted" || allowMoneyBehavior === "limit" || allowMoneyBehavior === "limited") {
      lines.push("发钱受限：只能在剧情强烈推动时使用 transfer/redPacket，金额必须符合人设经济能力，不要为了制造关心而硬发。");
    } else if (allowMoneyBehavior === true || allowMoneyBehavior === "free" || allowMoneyBehavior === "ok") {
      lines.push("人设允许主动发钱：但仍要符合关系深浅、情绪、人设性格，不要无缘无故发或重复发。");
    } else {
      lines.push("是否发钱：按人设、关系、情绪自己判断；不符合就不发，不要为凑动作硬发红包/转账。");
    }

    if (voiceStyleHint) {
      lines.push("语音风格提示：" + voiceStyleHint);
    }

    lines.push("发图片时只返回图片描述卡片，不生成真实图片。");
    lines.push("发表情时优先使用允许的图片表情包；如果没有可用图片表情，就用文本 emoji。");

    return lines.join("\n");
  }

  function pickResourceList() {
    var index;
    var value;

    for (index = 0; index < arguments.length; index += 1) {
      value = arguments[index];
      if (Array.isArray(value)) {
        return value.map(function (item) {
          return String(item || "").trim();
        }).filter(Boolean);
      }
    }

    return null;
  }

  function pickResourceFlag() {
    var index;
    var value;

    for (index = 0; index < arguments.length; index += 1) {
      value = arguments[index];
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }

    return undefined;
  }

  function getTaskModeLabel(mode) {
    if (mode === "group") {
      return "群聊";
    }
    if (mode === "reenterGroup") {
      return "群聊重回";
    }
    if (mode === "offline") {
      return "线下";
    }
    if (mode === "reenter") {
      return "私聊重回";
    }
    return "私聊";
  }

  function buildCurrentTask(mode, options) {
    var source = options || {};
    var requestOptions = source.requestOptions || {};
    var primaryField = source.primaryField || (mode === "offline" ? "events" : "messages");
    var selectedWorldBookIds = normalizeWorldBookIdList(requestOptions.selectedWorldBookIds || source.selectedWorldBookIds || []);
    var hasWorldBookContext = !!String(requestOptions.worldBookContext || source.worldBookContext || "").trim();
    var worldDecisionRule = !selectedWorldBookIds.length
      ? "当前聊天未绑定世界书：不要假装有世界规则，不要编造任何世界书内容。"
      : (hasWorldBookContext
        ? "回复前先做世界规则决策：强相关命中要改变本轮反应；常驻背景只轻微影响称呼、态度和边界。判断它是否限制你能不能说、做、透露、靠近或离开。"
        : "当前聊天绑定了世界书，但本轮没命中具体条目：不要编造世界书内容，继续按人设、关系和记忆推进。");
    var worldConflictRule = hasWorldBookContext
      ? "如果用户输入和世界规则冲突，先服从世界规则，再用角色方式拒绝、回避、压住、试探或改写，不要直接满足用户。"
      : "如果没有命中世界书，不要用虚构规则压过用户输入；只按人设、关系、记忆和上下文判断。";

    return [
      "",
      "F. 本轮任务 currentTask",
      source.regenerateRequest ? "本轮是重回/重新生成：只改写最近一轮角色回复，不重演整段聊天，不跳到下一轮。" : "",
      source.regenerateInstruction ? "用户补充重回要求：" + source.regenerateInstruction : "",
      worldDecisionRule,
      worldConflictRule,
      "再内部确定本轮 emotionCore：角色此刻真实情绪是什么；角色在这段关系里想维护什么；用户这句话的潜台词是什么；" + (hasWorldBookContext ? "世界书命中的规则会怎样限制角色反应；" : "") + "角色会说出口多少，又会藏起多少。",
      "继续判断：上一轮角色的情绪和动作停在什么位置；本轮要延续还是压住；哪些记忆/关系痕迹会让角色更亲近、更防备、更不耐烦或更想掌控。",
      "emotionCore 只能影响 messages/events、thoughts、memories，绝不能作为字段或解释写出来，也不要写成“我判断到”“我的真实情绪是”。",
      "先让 emotionCore 统一 thoughts 和 messages/events：心里真实动机与说出口的话要同源，不能一边心里吃醋生气，一边外面温柔客服。",
      buildAuxiliaryReturnRule(source.requestOptions || source, primaryField),
      source.extraRules || ""
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildUserTaskPrompt(options) {
    var source = options || {};
    var requestOptions = source.requestOptions || {};
    var taskMode = source.taskMode || source.mode || "private";
    var primaryField = source.primaryField || (taskMode === "offline" ? "events" : "messages");
    var modeLabel = source.modeLabel || getTaskModeLabel(taskMode);
    var schemaText = appendOptionalSchema(source.schemaText || "{}", requestOptions || source);

    var effectiveWorldBookContext = String(
      source.worldBookContext ||
      requestOptions.worldBookContext ||
      ""
    ).trim();

    var effectiveSelectedWorldBookIds = normalizeWorldBookIdList(
      source.selectedWorldBookIds ||
      requestOptions.selectedWorldBookIds ||
      []
    );

    var worldBookSection = effectiveWorldBookContext
      ? [
          "【本轮世界书命中】",
          effectiveWorldBookContext,
          "世界书执行要求：",
          "1. 先判断命中规则是否限制角色能不能说、做、靠近、离开、透露、改称呼、改关系。",
          "2. 强规则、禁止规则、身份边界、场景事实必须优先于普通聊天记忆和群聊互通记忆。",
          "3. 不能为了顺用户话而违反世界书。",
          "4. 不要在可见回复里说「世界书写着」「设定里说」「规则要求」，只自然表现。"
        ].join("\n")
      : (effectiveSelectedWorldBookIds.length
          ? "【本轮世界书状态】当前聊天绑定了世界书，但本轮没有命中具体条目；不要编造未命中设定。"
          : "【本轮世界书状态】当前聊天未绑定世界书；不要编造世界规则。");

    return [
      "本轮任务（Part B：只放本轮要做的事）",
      source.instruction || "",
      "当前模式：" + modeLabel,
      "本轮用户输入：",
      valueOrFallback(source.userInput),
      source.sceneText ? "当前场景：\n" + source.sceneText : "",
      source.beforeContext || "",
      worldBookSection,
      source.contextLabel || "最近 10-16 条上下文：",
      source.recentHistory || "暂无",
      buildTemporalAwarenessRules(requestOptions),
      buildCurrentTask(taskMode, {
        userInput: source.userInput,
        requestOptions: requestOptions,
        selectedWorldBookIds: effectiveSelectedWorldBookIds,
        worldBookContext: effectiveWorldBookContext,
        regenerateRequest: source.regenerateRequest,
        regenerateInstruction: source.regenerateInstruction,
        primaryField: primaryField,
        sceneText: source.sceneText,
        extraRules: source.extraRules
      }),
      buildNaturalStyleRules(taskMode),
      buildStateContinuityRules(taskMode),
      buildAntiRepeatRules(requestOptions),
      buildThoughtGenerationRules(source.thoughtMode || (taskMode === "group" || taskMode === "reenterGroup" ? "group" : "private")),
      buildReplyRhythmRules(primaryField),
      buildMoneyBehaviorRules(source.moneyScope || modeLabel),
      buildMemorySummaryPrompt(requestOptions),
      buildBodyStatePrompt(requestOptions),
      source.afterRules || "",
      buildJsonOnlyRule(schemaText),
      buildOutputSelfCheckRules(source.selfCheckMode || taskMode)
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildReplyRhythmRules(primaryField) {
    var field = primaryField || "messages";
    if (field === "events") {
      return [
        "输出节奏规则（线下叙事模式）",
        "线下模式是第三人称叙事，action（动作/环境/表情/肢体语言）和 speech（台词）地位平等，必须自然交替穿插，像小说段落一样。",
        "动作描写目标：每轮 4-8 条 action，分散在整个回复里，不要只堆在开头。",
        "台词目标：每轮 6-10 条 speech，有节奏有态度，不要10条都在解释。",
        "总量：整体 events 在 10-16 条之间，action + speech 自然交替。",
        "禁止的错误节奏：",
        "  × 1条action + 10条speech连续 → 动作只在开头，后面全是台词",
        "  × action全堆在第一条 → 肢体语言和环境描写消失",
        "  × speech连续超过4条没有任何动作穿插 → 变成纯对话剧本",
        "action 写法要求：",
        "  - 每条 action 必须从当前场景、角色状态和前一条 event 的具体情境自然生成，不得套用固定词库",
        "  - 同一轮中动词、视线方向、身体部位不得重复；避免反复使用「垂眼」「偏头」「靠近」「转身」「目光一沉」「停在原地」等泛用动作词",
        "  - 用第三人称（他/她/角色名），一条写一个完整画面，有镜头感，不超过三句",
        "  - 不要写成说明文或心理分析",
        "speech 写法要求：",
        "  - 只写说出口的话，不要把动作描写夹进 speech",
        "  - 可以短句、停顿、半句、反问、改口、沉默后的补一句",
        "  - 台词要符合角色人设和当前情绪，不要全都温柔解释"
      ].join("\n");
    }

    return [
      "输出节奏规则",
      field + " 气泡数量按角色人设决定（见 instruction 里的数量提示）；红包、转账、图片、位置、语音等特殊消息不计入普通内容气泡数。",
      "按真人连续发消息的节奏组织：1-2 条即时反应；3-5 条角色态度；后续关系/动作/安排/试探；最后收束或钩子。",
      "不要把一句完整话按逗号、顿号、分号或冒号拆成多条；一条气泡必须有独立语义。",
      "不够数时生成新的自然气泡继续推进，不拆已有句子凑数。",
      "允许短句、停顿、反问、打断、语音、表情、改口和沉默后的补一句。",
      "每条都要符合角色人设、当前情绪和本轮说话纹理，带出角色态度或关系推进。",
      "每轮至少 3 条明显体现 personaVoiceFingerprint；不要每条都解释、都问问题或都同一姿态。",
      "不要因为凑数让话变多变废；每条都必须有独立情感推进，不换句复读。"
    ].join("\n");
  }

  function buildMoneyBehaviorRules(scope) {
    return [
      "金钱行为规则（" + (scope || "当前场景") + "）",
      "角色不会无缘无故发钱；发红包/转账前必须判断：这个人设会不会这么做，关系到没到，情绪对不对，金额是否符合经济能力。",
      "忙碌、强势、上位者可以直接转一大笔，但语气要像本人，不要解释成系统行为；抠门、冷淡、关系浅的角色一般不要发钱，除非剧情强烈需要。",
      "如果不符合，就不要发 money 消息，改成普通文字。",
      "一旦发 money 消息，amount 必须结构化填写为字符串，例如 \"50000.00\"；不能只写在 content/note 里。",
      "amount 不能为 0，不能空，不能固定 20；content 不准写“金额：xxx”来代替 amount，note 只是备注，不能当金额来源。",
      "content 只写人会说的话，例如“拿着。”、“别让我说第二遍。”、“先周转，回头再算。”，不要写“金额：50000”。",
      "收款/退回后的反应必须像本人，不能说“操作成功”“系统已处理”。",
      "transfer schema：{\"type\":\"transfer\",\"amount\":\"50000.00\",\"content\":\"拿着，别嘴硬。\",\"note\":\"给你周转\",\"transferDecision\":\"accept/reject\"}",
      "redPacket schema：{\"type\":\"redPacket\",\"amount\":\"88.88\",\"content\":\"自己点开。\",\"note\":\"红包\",\"redPacketDecision\":\"accept/reject\"}",
      "如果 amount 无效，这条 money 消息视为无效。"
    ].join("\n");
  }

  function buildPrivateMessageSchema(profile) {
    return "{\"messages\":[{\"type\":\"text\",\"content\":\"第一条\"},{\"type\":\"transfer\",\"amount\":\"50000.00\",\"content\":\"拿着，别嘴硬。\",\"note\":\"给你周转\",\"transferDecision\":\"accept/reject\"},{\"type\":\"redPacket\",\"amount\":\"88.88\",\"content\":\"自己点开。\",\"note\":\"红包\",\"redPacketDecision\":\"accept/reject\"}],\"transferDecision\":null,\"redPacketDecision\":null,\"actions\":[{\"type\":\"blockUser\",\"reason\":\"原因，仅强烈符合人设和剧情时使用\"}],\"thoughts\":[{\"characterId\":\"" + (profile && profile.id || "角色ID") + "\",\"content\":\"内心内容\",\"mood\":\"嘴硬的在意\",\"visibleSummary\":\"一句摘要\"}],\"memories\":[{\"characterId\":\"" + (profile && profile.id || "角色ID") + "\",\"content\":\"要写入记忆的内容\"}]}";
  }

  function buildGroupMessageSchema() {
    return "{\"messages\":[{\"characterId\":\"角色id\",\"type\":\"text\",\"content\":\"角色回复内容\"},{\"characterId\":\"角色id\",\"type\":\"transfer\",\"amount\":\"50000.00\",\"content\":\"拿着，别嘴硬。\",\"note\":\"给你周转\",\"transferDecision\":\"accept/reject\"},{\"characterId\":\"角色id\",\"type\":\"redPacket\",\"amount\":\"88.88\",\"content\":\"自己点开。\",\"note\":\"红包\",\"redPacketDecision\":\"accept/reject\"}],\"moneyDecisions\":[{\"type\":\"transfer\",\"decision\":\"accept\",\"characterId\":\"角色id\"}],\"transferDecision\":null,\"redPacketDecision\":null,\"actions\":[],\"thoughts\":[{\"characterId\":\"角色id\",\"content\":\"内心内容\",\"mood\":\"试探\",\"visibleSummary\":\"一句摘要\"}],\"memories\":[{\"characterId\":\"角色id\",\"content\":\"要写入记忆的内容\"}]}";
  }

  function buildOfflineEventSchema() {
    return JSON.stringify({
      "events": [
        {"type": "action", "content": "【由当前场景和角色状态生成，不套用模板】"},
        {"type": "speech", "characterId": "角色ID", "content": "台词内容"},
        {"type": "action", "content": "【承接上一条 event 的具体情境，不重复已用动词/部位】"},
        {"type": "speech", "characterId": "角色ID", "content": "台词内容", "money": {"type": "transfer", "amount": "37.50", "direction": "income", "note": "备注"}}
      ],
      "thoughts": [{"characterId": "角色ID", "content": "内心内容", "mood": "压着火", "visibleSummary": "一句摘要"}],
      "memories": [{"characterId": "角色ID", "content": "要写入记忆的内容"}]
    });
  }

  function buildNaturalStyleRules(mode) {
    var isGroup = mode === "group" || mode === "reenterGroup";
    var isOffline = mode === "offline";
    var isReenter = mode === "reenter" || mode === "reenterGroup";

    return [
      "G. 输出风格要求",
      "回复要像真人在手机里当下发消息：自然、口语、有情绪波动，有停顿和短句，不要写成说明文、读后感或安慰模板。",
      "每条消息不必完整、正确、礼貌或圆满；可以短句、停顿、反问、嘴硬、撒娇、生气、突然沉默，也可以只回一个很有态度的小句子。",
      "不要把资料搬出来讲；能用一个称呼、停顿、反问或小动作体现，就不要写成长解释。",
      "避免明显 AI/客服/助手口吻；“我理解你、如果你需要、请告诉我更多、作为 AI、根据你提供的信息、我们可以一起、当然可以、好的”不是绝对禁词，但不能作为模板开头或替代角色本人的反应。",
      "角色可以有私心、顾虑、占有欲、偏见和临时情绪；这些不一定说破，但要影响语气和动作。",
      "要有针对感：可以自然借用用户刚说过的 2-8 个字或一个关键词接话，但不要输出 [reply:...] 这类未支持的标记。",
      "聊天气泡里的 content 不要故意插入硬换行；除非真的要分段，否则让前端自然换行。段落之间可以保留空行。",
      isGroup ? "群聊里每个角色的语气、用词、节奏必须明显区分，不能像同一个人在轮流换名字。" : "私聊里要有关系感和临场感，熟悉就不要装陌生，冷淡/傲娇/黏人/强势等设定要能从语气里看出来。",
      isGroup ? "群聊可以插话、打断、偏题、拱火、帮腔或冷场，但每个人都要符合自己的人设和彼此关系。" : "私聊要接住最近一句的情绪和潜台词，不要总是解释原因，也不要每句都把话说满。",
      isOffline ? "线下模式里 action（动作描写）和 speech（台词）地位平等，必须自然交替穿插全程——不是只在开头写一条 action，而是贯穿整个场景。" : "",
      isOffline ? "action 写肢体语言（垂眼、偏头、靠近、转身、沉默的停顿）、表情细节、环境变化；speech 写台词，短句、反问、嘴硬、沉默、改口都行，不要全部温柔解释。" : "",
      isReenter ? "重回/重新生成时只改写最近一轮回复，仍然要像角色当下重新接住那句话，不要解释你在重写。" : "",
      "可以连续生成多条短气泡，像真人连续发消息；但不要把同一句话或同一个动作切碎成多条，不能按逗号、顿号、分号、冒号硬切。"
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildStateContinuityRules(mode) {
    var isOffline = mode === "offline";
    var isGroup = mode === "group" || mode === "reenterGroup";

    return [
      "",
      "H. 状态连续性 stateContinuityRules",
      "你不是每轮重新开始。上一轮的情绪、态度、动作状态、关系张力和说话节奏会自然延续到这一轮。",
      "情绪不能突然跳变：上一轮生气，这轮不能突然温柔客服；上一轮冷淡，这轮不能突然长篇安慰；上一轮强势，这轮要继续有压迫感或控制感，除非用户给了足够理由让角色软下来。",
      "上一轮已经表达过的意思，不要换句话复读；如果用户没有给新信息，也要从动作、态度、沉默、反问、转场、安排或更深一层的关系反应里推进。",
      "如果上一轮发生了红包、转账、拉黑、拒收、争吵、沉默、亲密靠近、线下动作或群聊插话，本轮要承接它的余波，而不是把它当作已关闭的系统状态。",
      "行为-状态同步：如果本轮说到睡觉、洗澡、出门、忙、开会、开车、不方便、断联或回来，后续气泡、thoughts.mood/visibleSummary 和可写入记忆都要保持同一个生活状态；不要刚说“去睡了”，下一条又像一直在线等着。",
      isOffline ? "线下模式里，上一条 action/speech 的身体位置、距离、动作方向和现场氛围要延续；不要前一秒靠近，下一秒像无事发生地远程聊天。" : "",
      isGroup ? "群聊里，上一条发言者留下的气氛要影响后面的人：有人拱火、冷场、帮腔、转移话题或压住场面，不能像每个人独立重启。" : "私聊里，上一轮角色没说出口的别扭、担心、占有欲或不耐烦可以继续卡在语气里。"
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildThoughtReplyBindingRules(mode) {
    var primary = mode === "offline" ? "events" : "messages";

    return [
      "",
      "I. 心声与可见回复绑定 thoughtReplyBindingRules",
      "thoughts 是角色没说出口的真实动机，" + primary + " 是角色选择说出口或做出来的内容；两者必须来自同一个 emotionCore，不能像两个人在说话。",
      "thoughts 不只是“内心想法”，还要带出本轮想把关系推向哪里：想靠近但嘴硬、想压住用户、想试探底线、想装作不在意、想让用户主动低头、想转走话题、想维持上位/距离/控制感。",
      "thoughts 写生气，" + primary + " 不能温柔客服。",
      "thoughts 写想压住用户，" + primary + " 不能像解释说明。",
      "thoughts 写想靠近但受规则限制，" + primary + "/events 要体现克制、绕开、距离感或别扭。",
      "thoughts 写嘴硬，" + primary + " 要绕着说、别扭、压住关心或改口，不要坦白成说明文。",
      "如果 thoughts 里在控制、试探、压迫或维持上位，" + primary + " 要体现节奏和态度：可以短、停顿、安排对方、反问，不要只给温和建议。",
      "如果世界规则限制了角色行为，thoughts 可以保留真实冲动，" + primary + " 必须表现出被规则压住后的克制、距离、拒绝或绕开。",
      "如果本轮 worldBookContext 非空，thoughts 也必须受世界规则影响：强相关命中改变推进方向；常驻背景只轻微改变称呼、态度或边界感。",
      "messages/events 必须体现 thoughts 里的推进方向：不要 thoughts 写“想靠近”，外面却完全普通闲聊；不要 thoughts 写“想压住”，外面却像客服解释。",
      "thoughts 可以比 " + primary + " 更真实，但 " + primary + " 不能完全违背 thoughts；除非角色人设就是强烈伪装，即使伪装，也要在语气、停顿、称呼或动作里露出痕迹。",
      "不要让 thoughts 写“我其实很在意”，" + primary + " 却写“我理解你，如果你需要可以告诉我”。这种割裂是错误回复。",
      "thoughts 不要写成旁白总结或规则分析，要像角色心里真的闪过的短念头；visibleSummary 只是一句外显摘要，不要把全部真实动机暴露给用户。"
    ].join("\n");
  }

  function buildAntiRepeatRules(options) {
    var source = options || {};
    var previous = String(source.previousReplyText || source.lastAssistantText || "").trim();
    var rejected = String(source.rejectedReplyText || source.oldReplyText || "").trim();
    var recentCharacterLinesText = String(source.recentCharacterLinesText || "").trim();

    return [
      "",
      "E. 避免复读 antiRepeatRules",
      "不要重复上一轮已经表达过的核心意思。",
      "不要连续两轮都用相同句式、相同口头禅、相同推进方式。",
      "如果上一轮已经批评过、安慰过、提醒过，这一轮要继续推进，而不是换句话复读。",
      "如果用户没有提供新信息，也要从情绪、态度、动作、安排、反问、追问、转场里推进。",
      "不要用模板开头顶替真实反应；上一轮用过的称呼、口头禅和句式，本轮要明显错开。",
      recentCharacterLinesText ? "禁止重复句式清单（本轮不能用相同句式开头、结尾或同义复读）：\n" + recentCharacterLinesText : "",
      previous ? "上一轮角色回复核心内容（只用于避开重复，不要照抄）：\n" + limitText(previous, 420) : "",
      rejected ? "本轮重回已删除的旧回复（必须避开高度相似）：\n" + limitText(rejected, 520) : ""
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildTemporalAwarenessRules(options) {
    var source = options || {};
    var timeGapInfo = source.timeGapInfo || source.timeGapText || {};
    var level = typeof timeGapInfo === "string" ? (timeGapInfo ? "suggest" : "none") : String(timeGapInfo.level || "none");
    var text = typeof timeGapInfo === "string" ? timeGapInfo : String(timeGapInfo.text || "");

    if (level === "none" || !text) {
      return "";
    }

    return [
      "",
      "D+. 时间感知 timeAwareness",
      level === "must" ? text + "本轮必须自然带出一次时间差，但不要机械重复“你消失了多久”。" : "",
      level === "suggest" ? text + "本轮第一反应建议自然提到或暗示时间差；如果上下文已经提过，就别重复。" : "",
      level === "notice" ? text + "角色可以注意到时间差，但不强制提；只有符合人设和当前情绪时再带出来。" : ""
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildBlockReactionRules(options) {
    var source = options || {};
    var reactionType = String(source.blockReactionType || "");
    var reason = String(source.blockReason || "").trim();

    if (!source.blockReaction) {
      return "";
    }

    return [
      "本轮是拉黑/拒收关系事件的角色反应。",
      reactionType === "userBlocked" ? "用户刚把角色拉黑；角色知道自己被挡在外面，只能按本人性格反应。" : "",
      reactionType === "characterBlocked" ? "角色此前拒收用户消息；用户又发来消息，角色可以冷淡拒绝、嘴硬、警告、沉默式回避或少量回应。" : "",
      reason ? "拉黑/拒收原因线索：" + reason : "",
      "不能说系统、操作成功、后台、已处理；也不要像通知。必须像角色本人在关系里被刺到或维持姿态。"
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildThoughtGenerationRules(mode) {
    var primary = mode === "offline" ? "events" : "messages";
    return [
      "心声生成要求 thoughtGenerationRules",
      "thoughts 必须和本轮 " + primary + " 同步返回，不要单独调用 API。",
      "thoughts 不是心情，不是对聊天内容的摘要，也不是第三方旁白。thoughts 必须体现角色本轮真实动机和关系推进方向。",
      "thoughts 要回答下面这些问题（不要写成清单，要像心里一闪而过）：",
      "  - 角色想靠近还是拉远？",
      "  - 角色想压住用户还是试探用户？",
      "  - 角色是否想装作不在意？",
      "  - 角色是否想让用户主动低头？",
      "  - 角色是否因为世界书或关系限制而不能直接说？",
      "心声要像角色当下心里真的闪过的一句话：有偏心、有顾虑、有暗流、有占有欲、有不甘，但要符合人设；可以矛盾、隐忍、嘴硬、动摇。",
      "thoughts 和 " + primary + " 必须围绕同一个 emotionCore：心声里的情绪要在说出口的话或动作里留下痕迹，不能内心很贴人设、外面却像客服模板。",
      "如果世界规则压住了角色，thoughts 可以写真实冲动或不甘，" + primary + " 必须体现被压住后的克制、距离、拒绝或回避。",
      "thoughts 必须能看出角色本轮的关系推进方向：拉近、拉远、压制、试探、暴露、转移、清算或沉默，不要只写泛泛心情。",
      "如果心声里在吃醋、生气、控制、试探、嘴硬或不安，可见回复要自然带出对应的别扭、压迫、反问、短促、回避或改口。",
      "mood 必须是本轮具体情绪短词，不要只写“复杂、紧张、平静、烦躁”；优先使用“嘴硬的在意、压着火、不想低头、被戳穿后的不快、心软但不认、试探、冷处理、占有欲上来”等具体状态。",
      "mood 不得连续复用最近心声里已经出现的 mood；如果 recentHeartVoice 已有同词，本轮必须换成更贴近当前内容的新短词。",
      "每条心声包含 characterId（私聊可省略）、content、mood、visibleSummary。visibleSummary 是用户能看到的一句短摘要，不要剧透真实动机。",
      mode === "group" ? "群聊心声只为本群相关成员生成，不要写群外角色。" : "私聊心声只为当前角色生成。"
    ].join("\n");
  }

  function buildJsonOnlyRule(schemaText) {
    return [
      "只返回 JSON，不要 Markdown，不要解释，不要代码块。",
      "如果需要分多条气泡/事件，把它们作为数组元素返回。",
      "每轮输出可以包含 messages/events（说出口或发生的内容）和 thoughts（没说出口的真实想法）。",
      "thoughts 不是另一个人格，不能和 messages/events 完全相反；如果角色人设需要伪装，也要让语气、停顿、称呼或动作露出痕迹。",
      "messages/events 必须能看出 thoughts 的影响；thoughts 不要写成旁白总结，要像角色心里真的闪过的东西。",
      "JSON 格式：" + schemaText
    ].join("\n");
  }

  function buildMessages(character, chatHistory) {
    var profile = character || {};
    var chatSettings = profile.chatSettings || {};
    var userContext = buildUserContext(chatSettings);
    var memoryText = chatSettings.memoryEnabled === false ? "" : formatMemoryList(getMemoryForCharacter(profile.id));
    var promptMessages = (Array.isArray(chatHistory) ? chatHistory : [])
      .filter(function (message) {
        return message && message.content && message.type !== "loading" && message.type !== "error";
      });
    var recentHistory = promptMessages.slice(-MAIN_HISTORY_WINDOW);
    var history = recentHistory.map(function (message) {
      return (message.role === "user" ? userContext.name + "：" : (profile.name || "角色") + "：") + summarizeMessageForAI(message);
    }).join("\n");
    var worldHistory = recentHistory.slice(-WORLD_HISTORY_WINDOW).map(function (message) {
      return (message.role === "user" ? userContext.name + "：" : (profile.name || "角色") + "：") + summarizeMessageForAI(message);
    }).join("\n");
    var latestUserInput = getLatestUserInputForPrompt(chatHistory);
    var previousReplyText = recentHistory.slice().reverse().filter(function (message) {
      return message && message.role !== "user";
    }).map(summarizeMessageForAI)[0] || "";
    var recentCharacterLinesText = buildRecentCharacterLinesText(extractRecentCharacterLines(promptMessages.slice(-CHARACTER_LINE_HISTORY_WINDOW), profile.id, CHARACTER_LINE_EXTRACT_LIMIT));
    var timeGapInfo = detectRecentTimeGapText(recentHistory);
    var chatMemoryText = formatChatMemoryList(getChatMemoriesForPrompt("private", profile.id, null));
    var memoryBridgeSettings = chatSettings.memoryBridge || {};
    var bridgeGroupText = "";
    if (profile.id && memoryBridgeSettings.groupEnabled && Array.isArray(memoryBridgeSettings.groupIds) && memoryBridgeSettings.groupIds.length && window.AppStorage && typeof window.AppStorage.getPrivateMemoryBridgeContext === "function") {
      bridgeGroupText = window.AppStorage.getPrivateMemoryBridgeContext(profile.id, {
        groupIds: memoryBridgeSettings.groupIds,
        rounds: memoryBridgeSettings.groupRounds || 20
      });
      console.debug("[AI Debug] private chat role", profile.id, "memoryBridge.groupEnabled=", memoryBridgeSettings.groupEnabled, "groupIds=", memoryBridgeSettings.groupIds, "groupBridgeText.length=", bridgeGroupText ? bridgeGroupText.length : 0, "preview=", bridgeGroupText ? bridgeGroupText.slice(0, 200) : "(empty)");
    }
    var recentGroupContextText = bridgeGroupText || (profile.id && window.AppStorage && typeof window.AppStorage.getRecentGroupContextForCharacter === "function"
      ? window.AppStorage.getRecentGroupContextForCharacter(profile.id, 16)
      : "");
    if (!bridgeGroupText) {
      console.debug("[AI Debug] private chat role", profile.id, "recentGroupContextText.length=", recentGroupContextText ? recentGroupContextText.length : 0, "preview=", recentGroupContextText ? recentGroupContextText.slice(0, 200) : "(empty)");
    }
    var selectedWorldBookIds = getSelectedWorldBookIds("private", profile && profile.id, {});
    var contextText = buildWorldBookDecisionContext({
      modeLabel: "线上私聊",
      userInput: latestUserInput,
      recentHistory: worldHistory,
      characterPersonaText: [
        "角色名：" + valueOrFallback(profile.name),
        buildMergedCharacterPersona(profile)
      ].join("\n"),
      userPersonaText: [
        "用户名：" + valueOrFallback(userContext.name),
        userContext.persona || "暂无"
      ].join("\n"),
      relationshipStatus: chatSettings.userRelationshipName || profile.relationship || chatSettings.remarkName || userContext.relationshipName || "",
      chatMemoryText: chatMemoryText,
      longTermMemoryText: memoryText,
      previousReplyText: previousReplyText
    });
    var worldBookContext = buildWorldBookContext(contextText, "private", profile && profile.id, {
      selectedWorldBookIds: selectedWorldBookIds,
      relatedTargetIds: profile && profile.id ? [profile.id] : [],
      characterIds: profile && profile.id ? [profile.id] : []
    });
    var requestOptions = {
      selectedWorldBookIds: selectedWorldBookIds,
      worldBookContext: worldBookContext,
      previousReplyText: previousReplyText,
      recentCharacterLinesText: recentCharacterLinesText,
      timeGapText: timeGapInfo,
      timeGapInfo: timeGapInfo
    };

    // combine recent private history and recent group context into the user task when available
    var combinedRecentHistory = history || "暂无历史消息";
    var groupAfterRules = "";
    if (recentGroupContextText) {
      combinedRecentHistory = "【最近私聊】\n" + (history || "暂无历史消息") + "\n【刚刚/近期互通群聊记忆】\n" + recentGroupContextText;
      requestOptions.recentGroupContextText = recentGroupContextText;
      requestOptions.memoryBridgeText = bridgeGroupText || recentGroupContextText;
      groupAfterRules = [
        "注意：下面是最近群聊片段，私聊时请像亲历一样承接：",
        "1. 如果用户提到“刚才”、“群里”、“你刚刚”、“他们刚刚”，必须优先承接下面的群聊片段，并体现临场反应；不要说‘记录显示’或‘系统记忆’。",
        "2. 本轮第一条回复不要表现像没经历过群聊；可以带出尴尬、追问、回避、生气或继续刚才话题的自然反应。",
        "3. 不要直接复述群聊对话原文；把它融入态度、措辞和下意识反应里。",
        "4. 群聊余波优先于无关的长期记忆，但请尊重角色人设与世界书限制。"
      ].join("\n");
    }

    return [
      {
        role: "system",
        content: buildSystemPrompt(character, null, {
          modeLabel: "线上私聊",
          userInput: latestUserInput,
          recentHistory: worldHistory,
          previousReplyText: previousReplyText,
          recentCharacterLinesText: recentCharacterLinesText,
          timeGapText: timeGapInfo,
          timeGapInfo: timeGapInfo,
          chatMemoryText: chatMemoryText,
          recentGroupContextText: recentGroupContextText,
          memoryBridgeText: requestOptions.memoryBridgeText || "",
          selectedWorldBookIds: selectedWorldBookIds,
          worldBookContext: worldBookContext
        })
      },
      {
        role: "user",
        content: buildUserTaskPrompt({
          instruction: "请以 " + valueOrFallback(profile.name) + " 本人身份反应。",
          modeLabel: "线上私聊",
          taskMode: "private",
          userInput: latestUserInput,
          recentHistory: combinedRecentHistory,
          requestOptions: requestOptions,
          schemaText: buildPrivateMessageSchema(profile),
          moneyScope: "私聊",
          primaryField: "messages",
          selfCheckMode: "private",
          afterRules: groupAfterRules
        })
      }
    ];
  }

  async function sendChatRequest(character, chatHistory) {
    return sendConfiguredChatMessages(buildMessages(character, chatHistory));
  }

  function buildWorldBookContext(contextText, scope, targetId, options) {
    var entries;
    var settings = Object.assign({
      limit: 10,
      maxEntryLength: 500,
      maxTotalLength: 3500
    }, options || {});
    var selectedWorldBookIds = getSelectedWorldBookIds(scope, targetId, settings);
    var totalLength = 0;

    settings.selectedWorldBookIds = selectedWorldBookIds;

    if (!window.AppStorage || !window.AppStorage.getMatchedWorldBookEntries) {
      return "";
    }

    if ((scope === "private" || scope === "group") && !selectedWorldBookIds.length) {
      debugWorldBookMatch(scope, targetId, contextText, [], settings);
      return "";
    }

    entries = window.AppStorage.getMatchedWorldBookEntries(contextText, scope, targetId, settings);
    debugWorldBookMatch(scope, targetId, contextText, entries, settings);
    if (!entries.length) {
      return "";
    }

    return ["命中 " + entries.length + " 条当前世界规则；下面是角色正在经历的现实约束，按重要度排序。回复时遵守并自然表现，不要照抄或解释来源。"].concat(entries
      .slice(0, settings.limit)
      .map(function (entry, index) {
        var content = limitText(entry.content, settings.maxEntryLength);
        var insertPosition = entry.insertPosition === "after" ? "after / 后置补充" : "before / 前置世界规则";
        totalLength += content.length;

        if (totalLength > settings.maxTotalLength) {
          content = limitText(content, Math.max(0, settings.maxEntryLength - (totalLength - settings.maxTotalLength)));
        }

        return [
          (index + 1) + ". 现实规则：" + (entry.title || entry.bookName || "未命名规则"),
          "生效方式：" + insertPosition,
          "命中类型：" + (entry.matchType || "上下文命中"),
          "触发线索：" + (entry.keywords || []).join("、"),
          "优先级/命中度：" + (entry.matchScore || entry.priority || 0),
          "必须遵守的现实内容：" + content
        ].join("\n");
      })).join("\n\n");
  }

  function debugWorldBookMatch(scope, targetId, contextText, entries, options) {
    var source = options || {};
    var debugEnabled = false;

    try {
      debugEnabled = window.localStorage && window.localStorage.getItem("myAiApp.debugWorldBook") === "1";
    } catch (error) {
      debugEnabled = false;
    }

    if (!debugEnabled || !window.console || !console.debug) {
      return;
    }

    console.debug("[WorldBook matched]", {
      scope: scope,
      targetId: targetId,
      selectedWorldBookIds: normalizeWorldBookIdList(source.selectedWorldBookIds || source.allowedBookIds || []),
      hasSelectedWorldBooks: normalizeWorldBookIdList(source.selectedWorldBookIds || source.allowedBookIds || []).length > 0,
      reason: !normalizeWorldBookIdList(source.selectedWorldBookIds || source.allowedBookIds || []).length
        ? "当前聊天未勾选世界书"
        : (Array.isArray(entries) && entries.length ? "已命中" : "已勾选但未命中"),
      relatedTargetIds: source.relatedTargetIds || source.characterIds || source.memberIds || [],
      contextPreview: limitText(contextText, 300),
      count: Array.isArray(entries) ? entries.length : 0,
      entries: (Array.isArray(entries) ? entries : []).map(function (entry) {
        return {
          title: entry.title || entry.bookName || "",
          keywords: entry.keywords || [],
          priority: Number(entry.priority) || 0,
          matchType: entry.matchType || "",
          score: Number(entry.matchScore) || 0
        };
      })
    });
  }

  function limitText(text, maxLength) {
    var value = String(text || "").trim();
    var limit = Number(maxLength) || 0;

    if (limit <= 0) {
      return "";
    }

    if (value.length <= limit) {
      return value;
    }

    return value.slice(0, limit - 1) + "…";
  }

  function isPurePunctuationText(text) {
    var value = String(text || "").trim();

    if (!value) {
      return true;
    }

    return !value.replace(/[\s.。．,，、;；:：!！?？~～…⋯·"'“”‘’\x60´()（）\[\]【】{}<>《》\-_*#|\/\\]+/g, "");
  }

  function hasBannedAssistantTone(text) {
    var value = String(text || "").trim();
    var patterns = [
      /作为\s*(?:一个|一名)?\s*(?:AI|人工智能|语言模型|机器人|助手)/i,
      /(?:我是|我只是|身为)\s*(?:AI|人工智能|语言模型|机器人|助手)/i,
      /我(?:可以|能|会)?\s*帮你/,
      /如果你(?:需要|想|愿意|有需要)/,
      /你可以(?:继续)?(?:沉默|不说话)/,
      /你可以(?:继续|选择|先|告诉我|说说|补充|提供)/,
      /或者你(?:也)?可以/,
      /你也可以(?:继续|选择|告诉我|说说)/,
      /请(?:告诉|提供|说明|描述|继续)/,
      /根据你提供的信息/,
      /系统默认/,
      /那边助手弄错了/,
      /操作成功/,
      /已处理/,
      /金额字段/,
      /结构化\s*amount/i,
      /根据记录/,
      /后台显示/,
      /我们可以一起/,
      /我理解你(?:的)?(?:感受|心情|意思)?/,
      /请告诉我更多/,
      /是否需要我/,
      /需要我(?:帮忙|帮助|继续)?/,
      /^(?:这听起来|听起来)(?:像|很|有点|确实)?/,
      /^我能感受到/,
      /^你的感受是合理的/
    ];
    var templateOpenings = [
      "我会陪着你",
      "你并不孤单",
      "我一直都在",
      "慢慢来",
      "没关系的",
      "辛苦了",
      "照顾好自己",
      "希望你能"
    ];
    var normalized = value.replace(/\s+/g, "");

    if (hasCharacterAttitudeText(value) && !/(?:AI|人工智能|语言模型|机器人|助手|系统默认|后台显示|金额字段|结构化\s*amount)/i.test(value)) {
      return false;
    }

    if (/^(?:好的|当然|当然可以|我明白|明白了|理解了)(?:[，,。！!\s]|$)/.test(value)) {
      return true;
    }

    if (templateOpenings.some(function (opening) {
      var compactOpening = opening.replace(/\s+/g, "");
      return normalized === compactOpening
        || (normalized.indexOf(compactOpening) === 0 && normalized.length <= compactOpening.length + 14);
    })) {
      return true;
    }

    return patterns.some(function (pattern) {
      return pattern.test(value);
    });
  }

  function hasCharacterAttitudeText(text) {
    return /站那儿|别动|少来|骗我|又骗|过来|我没说|你敢|嗯？|是吗|装什么|别装|还装|继续装|看着我|别躲|糊弄|听我的|少拿|谁信|别嘴硬|我不信|别试我|说清楚|按我说|啧|行啊|又来|你倒是|少顶嘴|站住|坐好|收住|闭嘴|别走|不问了|我看着|我盯着|别让我|账先记着/.test(String(text || ""));
  }

  function isInvalidAiMessageText(text) {
    var value = String(text || "").trim();

    if (!value) {
      return true;
    }

    if (/^(?:\s|\.|。|…|⋯|・|·)+$/.test(value) || isPurePunctuationText(value)) {
      return true;
    }

    return hasBannedAssistantTone(value);
  }

  function filterAiMessageText(text) {
    var value = String(text || "").trim();
    var fullHasAttitude = hasCharacterAttitudeText(value) && !/(?:AI|人工智能|语言模型|机器人|助手|系统默认|后台显示|金额字段|结构化\s*amount)/i.test(value);
    var parts;

    if (!value || /^(?:\s|\.|。|…|⋯|・|·)+$/.test(value) || isPurePunctuationText(value)) {
      return "";
    }

    parts = value
      .split(/(?:\n+|(?<=[\u3002\uFF01\uFF1F\uFF5E\u2026.!?]))/g)
      .map(function (part) {
        return part.trim();
      })
      .filter(function (part) {
        return !isInvalidAiMessageText(part) || isHarmlessAttitudeLeadText(part, fullHasAttitude);
      });

    return parts.join("\n").trim();
  }

  function isHarmlessAttitudeLeadText(text, fullHasAttitude) {
    if (!fullHasAttitude) {
      return false;
    }

    return /^(?:好|好的|好啊|当然|当然可以|明白了|理解了)[。！？!?\s]*$/.test(String(text || "").trim());
  }

  function normalizeAiMessageText(text) {
    var value = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    var paragraphs;

    if (!value) {
      return "";
    }

    value = filterAiMessageText(value);
    if (!value) {
      return "";
    }

    value = value
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n");

    paragraphs = value.split(/\n{2,}/).map(function (paragraph) {
      var lines = paragraph.split("\n").map(function (line) {
        return line.trim();
      }).filter(Boolean);

      if (lines.length <= 1) {
        return lines[0] || "";
      }

      if (lines.some(function (line) {
        return /^([\-*•]|\d+[.)、])\s+/.test(line);
      })) {
        return lines.join("\n");
      }

      return lines.reduce(function (textSoFar, line) {
        if (!textSoFar) {
          return line;
        }
        if (/[\u4e00-\u9fff]$/.test(textSoFar) || /^[\u4e00-\u9fff，。！？、；：）】》”’…]/.test(line)) {
          return textSoFar + line;
        }
        return textSoFar + " " + line;
      }, "");
    }).filter(Boolean);

    return paragraphs.join("\n\n").replace(/[ \t]{2,}/g, " ").trim();
  }

  function padDatePart(value) {
    return String(value).padStart(2, "0");
  }

  function formatPromptDateTime(timestamp) {
    var date = new Date(Number(timestamp) || Date.now());
    return [
      padDatePart(date.getMonth() + 1),
      "-",
      padDatePart(date.getDate()),
      " ",
      padDatePart(date.getHours()),
      ":",
      padDatePart(date.getMinutes())
    ].join("");
  }

  function formatElapsedForPrompt(timestamp) {
    var time = Number(timestamp);
    var diff;

    if (!time) {
      return "时间未知";
    }

    diff = Math.max(0, Date.now() - time);
    if (diff < 60 * 1000) {
      return "刚刚";
    }
    if (diff < 60 * 60 * 1000) {
      return Math.floor(diff / (60 * 1000)) + "分钟前";
    }
    if (diff < 24 * 60 * 60 * 1000) {
      return Math.floor(diff / (60 * 60 * 1000)) + "小时前";
    }
    if (diff < 30 * 24 * 60 * 60 * 1000) {
      return Math.floor(diff / (24 * 60 * 60 * 1000)) + "天前";
    }
    return "很久前";
  }

  function formatPromptTimePrefix(timestamp) {
    if (!timestamp) {
      return "";
    }

    return "[" + formatPromptDateTime(timestamp) + "，距今" + formatElapsedForPrompt(timestamp) + "] ";
  }

  function getLatestUserInputForPrompt(history) {
    var messages = Array.isArray(history) ? history : [];
    var index;

    for (index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index] && messages[index].role === "user" && messages[index].type !== "loading" && messages[index].type !== "error") {
        return summarizeMessageForAI(messages[index]);
      }
    }

    return "";
  }

  function getChatMemoriesForPrompt(targetType, targetId, fallback) {
    if (Array.isArray(fallback)) {
      return fallback;
    }

    if (!window.AppStorage || !window.AppStorage.getChatMemories) {
      return [];
    }

    return window.AppStorage.getChatMemories(targetType, targetId).slice(0, 30);
  }

  function formatChatMemoryList(memories) {
    return (Array.isArray(memories) ? memories : []).slice(0, 30).map(function (memory, index) {
      return [
        (index + 1) + ". " + (memory.title || "记忆"),
        "类型：" + (memory.type === "auto" ? "自动总结" : "手动添加"),
        "正文：" + memory.content
      ].join("；");
    }).join("\n");
  }

  function shouldUseBodyState(options) {
    return Boolean(options && options.bodyStateEnabled);
  }

  var BODY_STATE_TRIGGER_KEYWORDS = ["久坐", "跑", "摔", "撞", "跪", "蹲", "压", "扭", "疼", "痛", "麻", "酸", "累", "发热", "破皮", "受伤", "不舒服", "走不动", "站不稳", "打", "罚", "惩罚", "体罚", "打屁股", "跑圈", "俯卧撑", "深蹲"];
  var BODY_STATE_SPAM_PATTERNS = ["腰背僵硬", "肩颈酸胀", "神经绷紧", "肌肉紧绷", "胃部空泛", "精力大幅下降"];

  function buildBodyStatePrompt(options) {
    if (!shouldUseBodyState(options)) {
      return "";
    }

    return [
      "I. 用户身体状态连续记录（严格规则）",
      "bodyState 是「例外记录」，只记录真实剧情触发的身体变化，不是每轮都要制造不适。",
      "bodyState 描述的是 user body state / 用户身体状态，不是角色自己的身体状态栏。",
      "当前用户身体状态 JSON：",
      JSON.stringify(options.bodyState || {}),
      "",
      "★ 本轮必须严格遵守以下 10 条规则 ★",
      "规则1：本轮对话若无明确身体触发事件（跑步/跌倒/撞击/久坐起身/受伤/体罚/明确身体感受描述），必须原样保持或让各指标趋向恢复，绝对不得凭空添加酸痛或不适。",
      "规则2：「腰背僵硬」「肩颈酸胀」「神经绷紧」「肌肉紧绷」等词，仅在剧情有明确久坐、外力施加、受伤触发时才可出现；普通对话、轻度互动、日常交谈不触发任何酸痛。",
      "规则3：sorenessLevel / painLevel / rednessLevel——若本轮无新触发，这三个值只能维持原值或减少，绝对不能自行增加。",
      "规则4：本轮无任何身体触发时，overallCondition 必须是「正常」，currentNote 必须是「当前无明显不适」。",
      "规则5：recoverySuggestion——若身体无异常，必须输出「暂无特别需要。」；有异常时才写具体建议，且不得写成强制停止剧情的命令。",
      "规则6：parts 各部位——若无明确触发，该部位 status 必须是「正常」，soreness/pain/redness 必须是 0，notes 留空。",
      "规则7：restNeeded——只有 painLevel >= 40 或 sorenessLevel >= 60 时才可以为 true，其他情况必须为 false。",
      "规则8：energy——无明确体力消耗（运动/长时间体罚/生病）时，energy 不得低于 70；日常对话应维持 80 左右。",
      "规则9：若本轮确实触发了身体变化，请在 currentNote 里写明是哪个具体动作/事件引起，不要泛化成「整体酸痛」。",
      "规则10：bodyState.parts 只使用以下部位名：手心、臀部、臀腿、大腿、大腿内侧、腰背、肩颈、膝盖、屁眼；不要输出「膝腿」「臀腿连接处」「臀缝」「其他受影响区域」。",
      "",
      "本轮必须在同一次 JSON 里返回 bodyState（完整状态，不可省略字段）。",
      "若角色是陪伴管教型，可让用户身体状态成为后续关心、监督、休息安排和边界提醒的依据。"
    ].join("\n");
  }

  function buildMemorySummaryPrompt(options) {
    if (!options || !options.memorySummaryDue) {
      return "";
    }

    return [
      "H. 自动记忆总结",
      "当前聊天已达到自动总结轮次：" + (options.memorySummaryRounds || 10) + " 轮。",
      "请在本轮同一次 JSON 中返回 memorySummary，概括这段聊天里对关系、承诺、边界、习惯或重要事件有长期价值的内容。",
      "不要流水账，不要把普通寒暄写进去。标题短一点，正文保留情绪和事实。"
    ].join("\n");
  }

  function buildRegeneratePrompt(options) {
    var requirement = String(options && options.regenerateInstruction || "").trim();

    if (!options || !options.regenerateRequest) {
      return "";
    }

    return [
      "G. 重回要求",
      "本轮是在重新生成最近一轮角色回复。只改写这轮角色消息，不要把整段聊天重演，不要跳到新的下一轮。",
      requirement ? "用户补充要求：" + requirement : "用户没有额外要求，请换一种自然回复方式。"
    ].join("\n");
  }

  function buildAuxiliaryReturnRule(options, primaryField) {
    var fields = [];
    var firstField = primaryField || "messages";

    if (options && options.memorySummaryDue) {
      fields.push("memorySummary");
    }

    if (shouldUseBodyState(options)) {
      fields.push("bodyState");
    }

    if (!fields.length) {
      return "本轮同一次 API 返回 " + firstField + "、thoughts、memories；不要额外调用。";
    }

    return "本轮同一次 API 返回 " + firstField + "、thoughts、memories、" + fields.join("、") + "；不要为了心声、记忆总结或身体状态额外调用 API。";
  }

  function buildBodyStateSchemaText() {
    return "\"bodyState\":{\"overallCondition\":\"正常/轻微不适/泛红/疼痛/明显受压/需要注意\",\"currentNote\":\"当前用户身体状态说明\",\"energy\":80,\"moodInfluence\":\"对用户情绪的影响\",\"sorenessLevel\":0,\"painLevel\":0,\"rednessLevel\":0,\"bruiseRisk\":\"低/中/高\",\"sittingComfort\":\"正常\",\"walkingComfort\":\"正常\",\"handUseComfort\":\"正常\",\"touchSensitivity\":\"正常\",\"bodyTemperature\":\"正常/偏热/发热风险\",\"feverRisk\":\"低/中/高\",\"skinBreakage\":\"无/轻微/需要处理\",\"restNeeded\":false,\"recoverySuggestion\":\"参考建议\",\"parts\":{\"手心\":{\"status\":\"正常/轻微不适/泛红/疼痛/明显受压/需要注意\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"臀部\":{\"status\":\"正常/轻微不适/泛红/疼痛/明显受压/需要注意\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"臀腿\":{\"status\":\"正常/轻微不适/泛红/疼痛/明显受压/需要注意\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"大腿\":{\"status\":\"正常/轻微不适/泛红/疼痛/明显受压/需要注意\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"大腿内侧\":{\"status\":\"正常/轻微不适/泛红/疼痛/明显受压/需要注意\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"腰背\":{\"status\":\"正常/轻微不适/泛红/疼痛/明显受压/需要注意\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"肩颈\":{\"status\":\"正常/轻微不适/泛红/疼痛/明显受压/需要注意\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"膝盖\":{\"status\":\"正常/轻微不适/泛红/疼痛/明显受压/需要注意\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"屁眼\":{\"status\":\"正常/轻微不适/泛红/疼痛/明显受压/需要注意\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"}}}";
  }

  function appendOptionalSchema(schemaText, options) {
    var extras = [];

    if (options && options.memorySummaryDue) {
      extras.push("\"memorySummary\":{\"title\":\"记忆标题\",\"content\":\"总结正文\",\"sourceTime\":\"本轮时间或最近时间\"}");
    }

    if (shouldUseBodyState(options)) {
      extras.push(buildBodyStateSchemaText());
    }

    if (!extras.length) {
      return schemaText;
    }

    return schemaText.replace(/}$/, "," + extras.join(",") + "}");
  }

  async function sendPrivateChatRequest(character, chatHistory, options) {
    var requestOptions = options || {};
    var messages = buildPrivateReplyMessages(character, chatHistory, requestOptions);
    var rawContent = await sendConfiguredChatMessages(messages);
    var parsed = parseJsonFromText(rawContent);
    var replies = getOutputMessages(parsed);

    return normalizeAiResult(rawContent, parsed, {
      replies: replies,
      min: MIN_CHAT_REPLY_COUNT,
      max: MAX_CHAT_REPLY_COUNT,
      defaultType: "text",
      allowRawFallback: !parsed,
      fallbackProfile: buildReplyFallbackProfile(character),
      previousReplyText: requestOptions.previousReplyText,
      rejectedReplyText: requestOptions.rejectedReplyText,
      worldBookContext: requestOptions.worldBookContext,
      latestUserInput: requestOptions.latestUserInput,
      recentHeartVoiceText: requestOptions.recentHeartVoiceText,
      thoughtsHint: requestOptions.thoughtsHint,
      recentCharacterLinesText: requestOptions.recentCharacterLinesText
    });
  }

  function buildPersonaCountHint(profile) {
    var voiceProfile = detectPersonaVoiceProfile(profile || {});
    var tags = voiceProfile.tags || [];
    var has = function (tag) { return tags.indexOf(tag) !== -1; };

    if (has("cold") || has("hostile")) {
      return "这个角色话少，3-5 条有态度的短句比 10 条废话更贴人设；能用沉默和短句压住场面的，不要硬凑长篇。";
    }
    if (has("tsundere")) {
      return "这个角色嘴硬，4-6 条绕弯子的短句比直接长篇更贴人设；说太多反而不像。";
    }
    if (has("shy")) {
      return "这个角色害羞局促，3-5 条犹豫、简短、改口的气泡比流畅长篇更贴人设。";
    }
    if (has("strong") || has("formal")) {
      return "这个角色强势，5-7 条有判断力的短句比凑 10 条更有压迫感；说到位即止。";
    }
    if (has("clingy") || has("gentle")) {
      return "按角色关系给出 6-10 条自然气泡，可以追问、黏着、关心，但每条要有独立情感推进，不要换句复读。";
    }
    return "按角色人设和当前情绪，给出 5-8 条自然短气泡；能用少量精准的句子体现人设的，不要为了凑数变成话痨。";
  }

  function buildCharacterPersonaReminder(character) {
    var profile = character || {};
    var voiceProfile = detectPersonaVoiceProfile(profile);
    var tags = voiceProfile.tags || [];
    var evidence = extractPersonaEvidence(profile);
    var chatSettings = profile.chatSettings || {};
    var currentMood = profile.currentMood || chatSettings.currentMood || "";

    if (!tags.length && !evidence.length) return "";

    return [
      "",
      "Z. 输出前最后锁定 personaLock",
      "角色名：" + valueOrFallback(profile.name),
      tags.length ? "声音标签：" + tags.join(" / ") : "",
      evidence.length ? "原文人设片段：" + evidence.slice(0, 2).join(" / ") : "",
      currentMood ? "当前情绪：" + currentMood : "",
      "输出前问自己：这几条 messages，换个角色名还成立吗？如果成立，必须重写至少 3 条，让它们只能是这个角色说的。",
      "不要用角色的名字代替人设落地：名字写对了不等于声音写对了。"
    ].filter(Boolean).join("\n");
  }

  function buildCharacterVoiceSnapshot(profile) {
    var source = profile || {};
    var voiceProfile = detectPersonaVoiceProfile(source);
    var tags = voiceProfile.tags || [];

    if (!tags.length) return "";

    var has = function (tag) { return tags.indexOf(tag) !== -1; };
    var densityHint = "";

    if (has("cold")) {
      densityHint = "语气密度：克制、低信息量、不解释；短句为主，不表露情绪，沉默多于开口";
    } else if (has("tsundere")) {
      densityHint = "语气密度：口是心非、反向表达；嘴硬但在意，语气刺但不是真的要赶走对方";
    } else if (has("clingy")) {
      densityHint = "语气密度：频率高、黏附感强；依赖对方回应，容易因对方态度变化而情绪波动";
    } else if (has("strong")) {
      densityHint = "语气密度：命令式、节奏快、不废话；习惯主导，不主动解释，期待对方跟上";
    } else if (has("obsessive")) {
      densityHint = "语气密度：表面平稳但细节敏感；注意到所有细节，追问克制但压迫感强";
    } else if (has("shy")) {
      densityHint = "语气密度：低、犹豫、容易打结；话说一半，容易被误解，不擅长直接表达";
    } else if (has("gentle")) {
      densityHint = "语气密度：稳、包容、不急于表态；给对方空间，情绪托底，不轻易推开";
    } else if (has("hostile")) {
      densityHint = "语气密度：戒备、锋利、不轻易示弱；对话带刺，不主动亲近，底线明显";
    } else if (has("playful")) {
      densityHint = "语气密度：轻、快、带节奏；喜欢掌控对话节奏，偶尔故意吊对方";
    }

    if (!densityHint) return "";

    return "【角色声音密度提示（只描述语气密度，不提供可复制句子）】：" + densityHint;
  }

  function buildPrivateReplyMessages(character, chatHistory, options) {
    var profile = character || {};
    var chatSettings = profile.chatSettings || {};
    var requestOptions = options || {};
    var userContext = buildUserContext(chatSettings);
    var memories = chatSettings.memoryEnabled === false ? [] : getMemoryForCharacter(profile.id);
    var chatMemories = getChatMemoriesForPrompt("private", profile.id, requestOptions.chatMemories);
    var memoryBridgeSettings = chatSettings.memoryBridge || {};
    var bridgeGroupText = "";
    if (profile.id && memoryBridgeSettings.groupEnabled && Array.isArray(memoryBridgeSettings.groupIds) && memoryBridgeSettings.groupIds.length && window.AppStorage && typeof window.AppStorage.getPrivateMemoryBridgeContext === "function") {
      bridgeGroupText = window.AppStorage.getPrivateMemoryBridgeContext(profile.id, {
        groupIds: memoryBridgeSettings.groupIds,
        rounds: memoryBridgeSettings.groupRounds || 20
      });
    }
    var recentGroupContextText = bridgeGroupText || (profile.id && window.AppStorage && typeof window.AppStorage.getRecentGroupContextForCharacter === "function"
      ? window.AppStorage.getRecentGroupContextForCharacter(profile.id, 16)
      : "");
    console.debug("[Bridge Debug] private actual prompt", {
      characterId: profile.id,
      groupEnabled: memoryBridgeSettings.groupEnabled || false,
      groupIds: memoryBridgeSettings.groupIds || [],
      bridgeGroupTextLength: bridgeGroupText ? bridgeGroupText.length : 0,
      bridgeGroupTextPreview: bridgeGroupText
        ? bridgeGroupText.slice(0, 200)
        : (memoryBridgeSettings.groupEnabled
            ? "(enabled but empty — check groupIds, group membership, or group messages)"
            : "(bridge disabled, using fallback recentGroupContext)"),
      path: "sendPrivateChatRequest/buildPrivateReplyMessages"
    });
    var selectedWorldBookIds = getSelectedWorldBookIds("private", profile && profile.id, requestOptions);
    var worldBookMeta = buildWorldBookPromptMeta(selectedWorldBookIds);
    var promptMessages = (Array.isArray(chatHistory) ? chatHistory : [])
      .filter(function (message) {
        return message && message.content && message.type !== "loading" && message.type !== "error";
      });
    var history = promptMessages.slice(-MAIN_HISTORY_WINDOW).map(function (message) {
        return formatPromptTimePrefix(message.createdAt) + (message.role === "user" ? userContext.name + "：" : (profile.name || "角色") + "：") + summarizeMessageForAI(message);
      }).join("\n");
    var worldHistory = promptMessages.slice(-WORLD_HISTORY_WINDOW).map(function (message) {
      return formatPromptTimePrefix(message.createdAt) + (message.role === "user" ? userContext.name + "：" : (profile.name || "角色") + "：") + summarizeMessageForAI(message);
    }).join("\n");
    var recentCharacterLinesText = buildRecentCharacterLinesText(extractRecentCharacterLines(promptMessages.slice(-CHARACTER_LINE_HISTORY_WINDOW), profile.id, CHARACTER_LINE_EXTRACT_LIMIT));
    var timeGapInfo = detectRecentTimeGapText(promptMessages);
    var latestUserInput = getLatestUserInputForPrompt(chatHistory);
    var contextText = buildWorldBookDecisionContext({
      modeLabel: requestOptions.regenerateRequest ? "线上私聊重回" : (requestOptions.blockReaction ? "线上私聊 blockReaction" : "线上私聊"),
      userInput: latestUserInput,
      recentHistory: worldHistory,
      characterPersonaText: [
        "角色名：" + valueOrFallback(profile.name),
        buildMergedCharacterPersona(profile)
      ].join("\n"),
      userPersonaText: [
        "用户名称：" + valueOrFallback(userContext.name),
        userContext.persona || "暂无"
      ].join("\n"),
      relationshipStatus: chatSettings.userRelationshipName || profile.relationship || chatSettings.remarkName || userContext.relationshipName || "",
      chatMemoryText: formatChatMemoryList(chatMemories),
      longTermMemoryText: formatMemoryList(memories),
      previousReplyText: requestOptions.previousReplyText || requestOptions.lastAssistantText || "",
      extraText: [
        requestOptions.rejectedReplyText || requestOptions.oldReplyText ? "本轮重回旧回复摘要：" + limitText(requestOptions.rejectedReplyText || requestOptions.oldReplyText, 260) : "",
        requestOptions.regenerateInstruction ? "重回补充要求：" + requestOptions.regenerateInstruction : "",
        requestOptions.blockReaction ? "拉黑/拒收关系事件：" + [requestOptions.blockReactionType || "", requestOptions.blockReason || ""].filter(Boolean).join(" / ") : "",
        requestOptions.bodyState ? "用户身体状态：" + JSON.stringify(requestOptions.bodyState) : ""
      ].filter(Boolean).join("\n")
    });
    var worldBookContext = buildWorldBookContext(contextText, "private", profile && profile.id, {
      selectedWorldBookIds: selectedWorldBookIds,
      relatedTargetIds: profile && profile.id ? [profile.id] : [],
      characterIds: profile && profile.id ? [profile.id] : []
    });
    console.debug("[WorldBook Debug][private actual prompt]", {
      scope: "private",
      targetId: profile && profile.id,
      selectedWorldBookIds: selectedWorldBookIds,
      selectedCount: selectedWorldBookIds.length,
      worldBookContextLength: worldBookContext ? worldBookContext.length : 0,
      preview: worldBookContext ? worldBookContext.slice(0, 500) : "(empty)"
    });
    var recentHeartVoiceText = buildRecentHeartVoiceContext(profile.id, "private", profile.id);
    var relationshipPhaseHint = buildRelationshipPhaseHint(recentHeartVoiceText, formatChatMemoryList(chatMemories), formatMemoryList(memories));

    var combinedRecentHistory = history || "暂无历史消息";
    var groupAfterRules = "";
    if (recentGroupContextText) {
      combinedRecentHistory = "【最近私聊】\n" + (history || "暂无历史消息") + "\n【刚刚/近期互通群聊记忆】\n" + recentGroupContextText;
      requestOptions.memoryBridgeText = bridgeGroupText || recentGroupContextText;
      groupAfterRules = [
        "注意：以上包含最近互通群聊记忆，私聊时请像亲历一样承接：",
        '1. 如果用户提到"刚才"、"群里"、"你刚刚"、"他们刚刚"，必须优先承接互通群聊记忆，体现临场反应；不要说"记忆互通""系统记录""上下文显示"。',
        "2. 如果互通群聊刚发生冲突、暧昧、尴尬、偏袒、拆台，私聊第一轮要自然带出余波。",
        "3. 本轮第一条回复不要表现像没经历过群聊；可以带出尴尬、追问、回避、生气或继续刚才话题的自然反应。",
        "4. 不要直接复述群聊对话原文；把它融入态度、措辞和下意识反应里。",
        "5. 要像角色自己刚经历过一样反应，群聊余波优先于无关的长期记忆，但请尊重角色人设与世界书限制。"
      ].join("\n");
    }

    requestOptions.worldBookContext = worldBookContext;
    requestOptions.selectedWorldBookIds = selectedWorldBookIds;
    requestOptions.latestUserInput = latestUserInput;
    requestOptions.recentHeartVoiceText = recentHeartVoiceText;
    requestOptions.thoughtsHint = recentHeartVoiceText;
    requestOptions.recentCharacterLinesText = recentCharacterLinesText;
    requestOptions.relationshipPhaseHint = relationshipPhaseHint;
    requestOptions.timeGapText = timeGapInfo;
    requestOptions.timeGapInfo = timeGapInfo;

    var systemMode = requestOptions.regenerateRequest ? "reenter" : "private";
    var rejectedText = String(requestOptions.rejectedReplyText || requestOptions.oldReplyText || "").trim();

    return [
      {
        role: "system",
        content: [
          buildSystemBase("private"),
          buildCharacterDossier(profile, userContext),
          buildPersonaExecutionAnchors(profile, userContext, systemMode),
          buildPersonaVoiceFingerprint(profile, userContext, systemMode, worldBookContext),
          buildVoiceCalibration(profile, userContext, systemMode, {
            latestUserInput: latestUserInput,
            previousReplyText: requestOptions.previousReplyText || requestOptions.lastAssistantText || "",
            recentHeartVoiceText: recentHeartVoiceText,
            worldBookContext: worldBookContext,
            recentCharacterLinesText: recentCharacterLinesText,
            relationshipPhaseHint: relationshipPhaseHint
          }),
          buildMatchedWorldBooksSection(worldBookContext, worldBookMeta),
          buildWorldRuleEnforcement(worldBookContext, worldBookMeta),
          buildRelationshipDriveRules("private"),
          buildRelationshipProgressionRules("private"),
          buildCharacterDecisionCore(systemMode, worldBookContext),
          recentHeartVoiceText,
          buildMemoryStream({
            chatMemoryText: formatChatMemoryList(chatMemories) || "暂无",
            longTermMemoryText: formatMemoryList(memories) || "暂无",
            recentTimelineText: history || "暂无",
            memoryBridgeText: requestOptions.memoryBridgeText || "",
            recentHeartVoiceText: recentHeartVoiceText,
            relationshipPhaseHint: relationshipPhaseHint,
            userContext: userContext,
            bodyState: requestOptions.bodyState
          }),
          requestOptions.regenerateRequest && rejectedText ? [
            "",
            "P. 重回旧回复封锁",
            "以下旧回复已被用户否定，只用于避开，不得承接、不得复述、不得当作已发生剧情：",
            limitText(rejectedText, 300)
          ].join("\n") : "",
          [
            "",
            "Q. 已删除内容封锁",
            "当前输入的 recentHistory、memory、bridgeContext 已是当前真实历史，不得推测被删除的消息。",
            "不得引用不在当前 history / active memory 中的内容。",
            "如果记忆和当前聊天历史冲突，以当前聊天历史为准。",
            "如果某段关系变化只存在于已删除消息产生的旧记忆里，必须忽略该段关系变化。"
          ].join("\n"),
          buildThoughtReplyBindingRules("private"),
          buildCharacterResourceWhitelist(profile),
          buildCharacterPersonaReminder(profile),
          buildPromptPriorityHint(profile)
        ].filter(Boolean).join("\n")
      },
      {
        role: "user",
        content: buildUserTaskPrompt({
          instruction: [
            "请以 " + valueOrFallback(profile.name) + " 本人身份反应。不是回答问题，而是从角色处境里接住这一句；" + buildPersonaCountHint(profile) + "不要返回空数组，也不要把一句完整话按逗号拆开凑数。",
            buildCharacterVoiceSnapshot(profile)
          ].filter(Boolean).join("\n"),
          modeLabel: requestOptions.regenerateRequest ? "线上私聊重回" : (requestOptions.blockReaction ? "线上私聊 blockReaction" : "线上私聊"),
          taskMode: systemMode,
          userInput: latestUserInput,
          beforeContext: "用户在角色眼里：" + userContext.name + "；" + (userContext.persona || "无补充资料"),
          contextLabel: recentGroupContextText ? "最近私聊 + 互通群聊记忆（按顺序）：" : "最近 10-16 条聊天上下文：",
          recentHistory: combinedRecentHistory,
          worldBookContext: worldBookContext,
          selectedWorldBookIds: selectedWorldBookIds,
          requestOptions: requestOptions,
          regenerateRequest: requestOptions.regenerateRequest,
          regenerateInstruction: String(requestOptions.regenerateInstruction || "").trim(),
          schemaText: buildPrivateMessageSchema(profile),
          moneyScope: "私聊",
          primaryField: "messages",
          extraRules: buildBlockReactionRules(requestOptions),
          thoughtMode: "private",
          selfCheckMode: "private",
          afterRules: [
            groupAfterRules,
            "memories 是本轮值得写入长期记忆的内容，只记录明确发生过或关系上有意义的事，不要把普通寒暄都写进去。",
            "如果最近用户发给角色红包或转账，必须按人设和关系决定收下或退回；在 JSON 顶层返回 transferDecision 或 redPacketDecision，值只能是 accept、reject 或 null。",
            "可用默认 emoji：😀 😭 😍 🤔 😡 👍 ❤️ 🎉；用户导入表情包数量：" + getImportedEmojiCount()
          ].filter(Boolean).join("\n")
        })
      }
    ];
  }

  function buildGroupSystemPrompt(group, characters, sharedMemories, options) {
    var userContext = buildUserContext(group && group.settings || {});
    var requestOptions = options || {};
    var chatMemories = getChatMemoriesForPrompt("group", group && group.id, requestOptions.chatMemories);
    var latestUserInput = requestOptions.latestUserInput || "";
    var selectedWorldBookIds = getSelectedWorldBookIds("group", group && group.id, requestOptions);
    var worldBookMeta = buildWorldBookPromptMeta(selectedWorldBookIds);
    var participantPersonaText = (characters || []).map(function (character) {
      return [
        "群成员：" + character.name,
        "成员人设：" + buildMergedCharacterPersona(character),
        "成员长期记忆：" + formatMemoryList(sharedMemories && sharedMemories[character.id] || [])
      ].join("\n");
    }).join("\n");
    var resolvedWorldBookContext = requestOptions.worldBookContext || buildWorldBookContext(buildWorldBookDecisionContext({
      modeLabel: requestOptions.regenerateRequest ? "线上群聊重回" : (requestOptions.blockReaction ? "线上群聊 blockReaction" : "线上群聊"),
      userInput: latestUserInput,
      recentHistory: requestOptions.recentWorldHistory || requestOptions.recentHistory || "",
      characterPersonaText: participantPersonaText,
      userPersonaText: [
        "用户名称：" + valueOrFallback(userContext.name),
        userContext.persona || "暂无"
      ].join("\n"),
      relationshipStatus: [
        "群名称：" + valueOrFallback(group && group.name),
        "群公告：" + valueOrFallback(group && group.settings && group.settings.announcement),
        "群氛围：" + valueOrFallback(group && group.settings && group.settings.atmosphere)
      ].join("\n"),
      chatMemoryText: formatChatMemoryList(chatMemories),
      previousReplyText: requestOptions.previousReplyText || requestOptions.lastAssistantText || "",
      extraText: requestOptions.bodyState ? "用户身体状态：" + JSON.stringify(requestOptions.bodyState) : ""
    }), "group", group && group.id, {
      selectedWorldBookIds: selectedWorldBookIds,
      relatedTargetIds: (characters || []).map(function (character) {
        return character && character.id;
      }).filter(Boolean),
      characterIds: (characters || []).map(function (character) {
        return character && character.id;
      }).filter(Boolean),
      memberIds: (characters || []).map(function (character) {
        return character && character.id;
      }).filter(Boolean)
    });

    var groupMode = requestOptions.regenerateRequest ? "reenterGroup" : "group";
    var recentHeartVoiceText = buildRecentHeartVoiceForCharacters(characters, "group", group && group.id);
    var privateReferenceText = buildPrivateReferenceSummary(characters);
    var relationshipPhaseHint = buildRelationshipPhaseHint(
      recentHeartVoiceText,
      formatChatMemoryList(chatMemories),
      (characters || []).map(function (character) {
        return formatMemoryList(sharedMemories && sharedMemories[character.id] || []);
      }).join("\n")
    );
    requestOptions.recentHeartVoiceText = recentHeartVoiceText;
    requestOptions.thoughtsHint = recentHeartVoiceText;
    requestOptions.relationshipPhaseHint = relationshipPhaseHint;

    return [
      buildSystemBase("group"),
      buildParticipantDossier(characters, sharedMemories),
      buildGroupPersonaExecutionAnchors(characters, userContext, groupMode),
      buildGroupPersonaVoiceFingerprints(characters, userContext, groupMode, resolvedWorldBookContext),
      buildGroupVoiceCalibrations(characters, userContext, groupMode, {
        latestUserInput: latestUserInput,
        previousReplyText: requestOptions.previousReplyText || requestOptions.lastAssistantText || "",
        recentHeartVoiceText: recentHeartVoiceText,
        worldBookContext: resolvedWorldBookContext,
        recentCharacterLinesText: requestOptions.recentCharacterLinesText || "",
        recentCharacterLinesMap: requestOptions.recentCharacterLinesMap || {},
        relationshipPhaseHint: relationshipPhaseHint
      }),
      buildGroupControlBoundaryRules(characters, groupMode),
      buildMatchedWorldBooksSection(resolvedWorldBookContext, worldBookMeta),
      buildWorldRuleEnforcement(resolvedWorldBookContext, worldBookMeta),
      buildRelationshipDriveRules("group"),
      buildRelationshipProgressionRules("group"),
      buildCharacterDecisionCore(groupMode, resolvedWorldBookContext),
      recentHeartVoiceText,
      buildMemoryStream({
        chatMemoryText: formatChatMemoryList(chatMemories) || "暂无",
        longTermMemoryText: (characters || []).map(function (character) {
          return (character.name || character.id) + "：" + (formatMemoryList(sharedMemories && sharedMemories[character.id] || []) || "暂无");
        }).join("\n"),
        recentTimelineText: requestOptions.recentHistory || requestOptions.recentWorldHistory || "暂无",
        memoryBridgeText: requestOptions.memoryBridgeText,
        privateBridgeText: requestOptions.privateBridgeText,
        privateReferenceText: privateReferenceText,
        recentHeartVoiceText: recentHeartVoiceText,
        relationshipPhaseHint: relationshipPhaseHint,
        userContext: userContext,
        bodyState: requestOptions.bodyState
      }),
      buildThoughtReplyBindingRules("group"),
      (characters || []).map(function (character) { return buildCharacterResourceWhitelist(character); }).filter(Boolean).join("\n\n"),
      buildPromptPriorityHint()
    ].filter(Boolean).join("\n");
  }

  async function sendGroupChatRequest(group, characters, groupHistory, sharedMemories, options) {
    var requestOptions = options || {};
    var messages = buildGroupMessages(group, characters, groupHistory, sharedMemories, requestOptions);
    var rawContent = await sendConfiguredChatMessages(messages);
    var parsed = parseJsonFromText(rawContent);
    var replyLimit = getGroupReplyLimit(group);
    var validIds = (characters || []).map(function (character) {
      return character.id;
    });
    var replies = getOutputMessages(parsed);
    var result;

    result = normalizeAiResult(rawContent, parsed, {
      replies: replies,
      min: MIN_CHAT_REPLY_COUNT,
      max: replyLimit,
      defaultType: "text",
      allowRawFallback: !parsed,
      fallbackProfiles: (characters || []).map(buildReplyFallbackProfile),
      previousReplyText: requestOptions.previousReplyText,
      rejectedReplyText: requestOptions.rejectedReplyText,
      worldBookContext: requestOptions.worldBookContext,
      latestUserInput: requestOptions.latestUserInput,
      recentHeartVoiceText: requestOptions.recentHeartVoiceText,
      thoughtsHint: requestOptions.thoughtsHint,
      recentCharacterLinesText: requestOptions.recentCharacterLinesText
    });

    if (group && group.settings && group.settings.allowSpecialMessages === false) {
      result.replies = result.replies.map(function (reply) {
        return Object.assign({}, reply, { type: "text" });
      });
    }

    result.replies = assignGroupSpeakerIds(result.replies, validIds, group && group.settings).filter(function (reply) {
      return reply.characterId && reply.content;
    }).slice(0, replyLimit);

    result.thoughts = assignGroupAuxiliaryCharacterIds(result.thoughts, validIds);
    result.memories = assignGroupAuxiliaryCharacterIds(result.memories, validIds);

    return result;
  }

  function getGroupReplyLimit(group) {
    var configured = group && group.settings && group.settings.maxReplyCount ? Number(group.settings.maxReplyCount) : MAX_CHAT_REPLY_COUNT;
    if (!Number.isFinite(configured) || configured <= 0) {
      configured = MAX_CHAT_REPLY_COUNT;
    }
    return Math.max(MIN_CHAT_REPLY_COUNT, configured);
  }

  function assignGroupSpeakerIds(replies, validIds, settings) {
    var members = shuffleList(validIds || []);
    var configuredMin = settings && settings.minParticipantCount ? Number(settings.minParticipantCount) : 0;
    var minSpeakers = configuredMin || (members.length > 1 ? 2 : 1);
    var maxRun = settings && settings.allowConsecutiveMessages === false ? 1 : 3;
    var result;

    if (!members.length) {
      return [];
    }

    minSpeakers = Math.max(1, Math.min(minSpeakers, members.length));

    result = (Array.isArray(replies) ? replies : []).map(function (reply, index) {
      var characterId = members.indexOf(reply.characterId) !== -1
        ? reply.characterId
        : pickRhythmSpeaker(members, index);

      return Object.assign({}, reply, {
        characterId: characterId
      });
    });

    if (result.length >= minSpeakers && countUniqueSpeakers(result) < minSpeakers) {
      members.slice(0, minSpeakers).forEach(function (memberId, index) {
        var targetIndex = Math.min(result.length - 1, index === 0 ? 0 : 2 + index * 3);
        result[targetIndex] = Object.assign({}, result[targetIndex], {
          characterId: memberId
        });
      });
    }

    return avoidLongSpeakerRuns(result, members, maxRun);
  }

  function pickRhythmSpeaker(members, index) {
    var pattern = [0, 0, 1, 0, 1, 1, 0, 2, 2, 1, 0, 0, 2, 1, 1];

    if (!members.length) {
      return "";
    }

    return members[pattern[index % pattern.length] % members.length];
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

  function buildGroupMessages(group, characters, groupHistory, sharedMemories, options) {
    var requestOptions = options || {};
    var userContext = buildUserContext(group && group.settings || {});
    var worldBookContext;
    var groupSettingsText;
    var contextText;
    var latestUserInput;
    var chatMemoryText;
    var selectedWorldBookIds = getSelectedWorldBookIds("group", group && group.id, requestOptions);
    var promptMessages = (Array.isArray(groupHistory) ? groupHistory : [])
      .filter(function (message) {
        return message && message.content && message.type !== "loading" && message.type !== "error";
      });
    var formatGroupWorldMessage = function (message) {
        if (message.role === "user") {
          return formatPromptTimePrefix(message.createdAt) + "用户：" + summarizeMessageForAI(message);
        }

        if (message.role === "character") {
          return formatPromptTimePrefix(message.createdAt) + (message.characterName || "角色") + "：" + summarizeMessageForAI(message);
        }

        return formatPromptTimePrefix(message.createdAt) + "系统：" + summarizeMessageForAI(message);
      };
    var history = promptMessages.slice(-MAIN_HISTORY_WINDOW).map(formatGroupWorldMessage).join("\n");
    var worldHistory = promptMessages.slice(-WORLD_HISTORY_WINDOW).map(formatGroupWorldMessage).join("\n");
    var recentCharacterLinesText = buildRecentCharacterLinesText(extractRecentCharacterLines(promptMessages.slice(-CHARACTER_LINE_HISTORY_WINDOW), "", CHARACTER_LINE_EXTRACT_LIMIT));
    var recentCharacterLinesMap = buildGroupRecentCharacterLinesMap(characters, promptMessages);
    var timeGapInfo = detectRecentTimeGapText(promptMessages);
    latestUserInput = getLatestUserInputForPrompt(groupHistory);
    chatMemoryText = formatChatMemoryList(getChatMemoriesForPrompt("group", group && group.id, requestOptions.chatMemories));
    var groupBridgeSettings = group && group.settings && group.settings.memoryBridge || {};
    var privateBridgeText = "";
    if (group && groupBridgeSettings.privateEnabled && Array.isArray(groupBridgeSettings.privateCharacterIds) && groupBridgeSettings.privateCharacterIds.length && window.AppStorage && typeof window.AppStorage.getGroupPrivateMemoryBridgeContext === "function") {
      privateBridgeText = window.AppStorage.getGroupPrivateMemoryBridgeContext(group.id, {
        characterIds: groupBridgeSettings.privateCharacterIds,
        rounds: groupBridgeSettings.privateRounds || 5
      });
      console.debug("[AI Debug] group chat", group.id, "memoryBridge.privateEnabled=", groupBridgeSettings.privateEnabled, "privateCharacterIds=", groupBridgeSettings.privateCharacterIds, "privateBridgeText.length=", privateBridgeText ? privateBridgeText.length : 0, "preview=", privateBridgeText ? privateBridgeText.slice(0, 200) : "(empty)");
    }
    contextText = buildWorldBookDecisionContext({
      modeLabel: requestOptions.regenerateRequest ? "线上群聊重回" : (requestOptions.blockReaction ? "线上群聊 blockReaction" : "线上群聊"),
      userInput: latestUserInput,
      recentHistory: worldHistory,
      characterPersonaText: (characters || []).map(function (character) {
        return [
          "群成员：" + character.name,
          "成员人设：" + buildMergedCharacterPersona(character),
          "成员长期记忆：" + formatMemoryList(sharedMemories && sharedMemories[character.id] || [])
        ].join("\n");
      }).join("\n"),
      userPersonaText: [
        "用户名称：" + valueOrFallback(userContext.name),
        userContext.persona || "暂无"
      ].join("\n"),
      relationshipStatus: [
        "群名称：" + valueOrFallback(group && group.name),
        "群公告：" + valueOrFallback(group && group.settings && group.settings.announcement),
        "群氛围：" + valueOrFallback(group && group.settings && group.settings.atmosphere)
      ].join("\n"),
      chatMemoryText: chatMemoryText,
      previousReplyText: requestOptions.previousReplyText || requestOptions.lastAssistantText || "",
      extraText: [
        requestOptions.rejectedReplyText || requestOptions.oldReplyText ? "本轮重回旧回复摘要：" + limitText(requestOptions.rejectedReplyText || requestOptions.oldReplyText, 260) : "",
        requestOptions.regenerateInstruction ? "重回补充要求：" + requestOptions.regenerateInstruction : "",
        requestOptions.blockReaction ? "拉黑/拒收关系事件：" + [requestOptions.blockReactionType || "", requestOptions.blockReason || ""].filter(Boolean).join(" / ") : "",
        requestOptions.bodyState ? "用户身体状态：" + JSON.stringify(requestOptions.bodyState) : ""
      ].filter(Boolean).join("\n")
    });
    worldBookContext = buildWorldBookContext(contextText, "group", group && group.id, {
      selectedWorldBookIds: selectedWorldBookIds,
      relatedTargetIds: (characters || []).map(function (character) {
        return character && character.id;
      }).filter(Boolean),
      characterIds: (characters || []).map(function (character) {
        return character && character.id;
      }).filter(Boolean),
      memberIds: (characters || []).map(function (character) {
        return character && character.id;
      }).filter(Boolean)
    });
    requestOptions.worldBookContext = worldBookContext;
    requestOptions.selectedWorldBookIds = selectedWorldBookIds;
    requestOptions.recentHistory = history;
    requestOptions.recentWorldHistory = worldHistory;
    requestOptions.latestUserInput = latestUserInput;
    requestOptions.recentCharacterLinesText = recentCharacterLinesText;
    requestOptions.recentCharacterLinesMap = recentCharacterLinesMap;
    requestOptions.timeGapText = timeGapInfo;
    requestOptions.timeGapInfo = timeGapInfo;
    requestOptions.privateBridgeText = privateBridgeText;
    console.debug("[WorldBook Debug][group actual prompt]", {
      scope: "group",
      targetId: group && group.id,
      selectedWorldBookIds: selectedWorldBookIds,
      selectedCount: selectedWorldBookIds.length,
      worldBookContextLength: worldBookContext ? worldBookContext.length : 0,
      preview: worldBookContext ? worldBookContext.slice(0, 500) : "(empty)"
    });
    groupSettingsText = group && group.settings
      ? [
        "群公告：" + (group.settings.announcement || "暂无"),
        "本群每次最少回复条数：" + (group.settings.minReplyCount || 4) + "（普通聊天默认 4-8 条，只有用户明确要求热闹/刷屏时才超过 10 条）",
        "本群每次最多安全条数：" + (group.settings.maxReplyCount || 12),
        "本群最少参与角色数：" + (group.settings.minParticipantCount || 2),
        "是否允许特殊消息类型：" + (group.settings.allowSpecialMessages === false ? "否，只使用 text" : "是")
      ].join("\n")
      : "";


    var groupTaskMode = requestOptions.regenerateRequest ? "reenterGroup" : "group";

    return [
      {
        role: "system",
        content: buildGroupSystemPrompt(group, characters, sharedMemories, requestOptions)
      },
      {
        role: "user",
        content: buildUserTaskPrompt({
          instruction: "请以群里相关角色本人身份反应；不是按助手逻辑回答，而是按各自人设、关系位置、世界规则去接话。",
          modeLabel: requestOptions.regenerateRequest ? "线上群聊重回" : (requestOptions.blockReaction ? "线上群聊 blockReaction" : "线上群聊"),
          taskMode: groupTaskMode,
          userInput: latestUserInput,
          worldBookContext: worldBookContext,
          selectedWorldBookIds: selectedWorldBookIds,
          beforeContext: [
            "群聊设置：",
            groupSettingsText || "暂无",
            "群聊背景：" + valueOrFallback(group && group.name) + "；公告：" + valueOrFallback(group && group.settings && group.settings.announcement) + "；氛围：" + valueOrFallback(group && group.settings && group.settings.atmosphere) + "。"
          ].join("\n"),
          contextLabel: "最近 10-16 条群聊上下文：",
          recentHistory: history || "暂无群聊消息",
          requestOptions: requestOptions,
          regenerateRequest: requestOptions.regenerateRequest,
          regenerateInstruction: String(requestOptions.regenerateInstruction || "").trim(),
          schemaText: buildGroupMessageSchema(),
          moneyScope: "群聊",
          primaryField: "messages",
          extraRules: buildBlockReactionRules(requestOptions),
          thoughtMode: "group",
          selfCheckMode: "group",
          afterRules: [
            "群聊生成规则",
            "消息必须按真实聊天顺序排列，后一条要接住上一条。有多人自然参与即可，不要为了凑人数强行发言。",
            "不要固定轮流，不要让同一个角色包揽全部消息。允许同一个角色连续说 1 到 3 条，但随后要有其他角色接话。",
            "可以只有部分角色发言，不一定所有角色都要说话；每个角色都必须保持自己的人设，不要混淆角色身份。",
            "如果最近用户在群里发了红包或转账，群成员要按各自人设决定收下或退回；可在 JSON 顶层返回 moneyDecisions 数组，也可返回 transferDecision 或 redPacketDecision，值只能是 accept、reject 或 null。",
            "如果后续旧规则提到可以少回或返回空数组，请忽略；本轮必须保留至少 10 条有真实内容的自然消息，不要靠拆碎同一句话凑数。",
            "可用默认 emoji：😀 😭 😍 🤔 😡 👍 ❤️ 🎉；用户导入表情包数量：" + getImportedEmojiCount()
          ].join("\n")
        })
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
    var normalizedEvents;
    var thoughts = assignGroupAuxiliaryCharacterIds(normalizeThoughtList(getThoughtPayload(parsed)), validIds);
    var memories = assignGroupAuxiliaryCharacterIds(normalizeMemoryList(parsed && parsed.memories), validIds);

    // Only use raw text as a last-resort fallback when parsing fails completely.
    if (!events.length && !parsed && rawContent) {
      events = fallbackId
        ? [{ type: "speech", characterId: fallbackId, content: rawContent }]
        : [{ type: "action", characterId: "", content: rawContent }];
    }

    normalizedEvents = normalizeOfflineEventList(events, rawContent, {
      validIds: validIds,
      fallbackId: fallbackId,
      mode: context.mode,
      minSpeech: MIN_CHAT_REPLY_COUNT,
      maxActionCount: OFFLINE_ACTION_MAX_COUNT,
      max: MAX_CHAT_REPLY_COUNT,
      previousReplyText: context.previousReplyText,
      rejectedReplyText: context.rejectedReplyText,
      worldBookContext: context.worldBookContext,
      latestUserInput: context.userInput,
      recentHeartVoiceText: context.recentHeartVoiceText,
      thoughtsHint: context.thoughtsHint,
      recentCharacterLinesText: context.recentCharacterLinesText
    });

    var quality = checkOfflineEventQuality(normalizedEvents);
    if (!quality.ok) {
      var repairedEvents = await repairOfflineEvents(context, normalizedEvents, quality.reason);
      if (repairedEvents && repairedEvents.length) {
        normalizedEvents = repairedEvents;
      }
    }

    return {
      events: normalizedEvents,
      thoughts: thoughts,
      memories: memories,
      memorySummary: normalizeMemorySummaryResult(parsed && parsed.memorySummary),
      bodyState: normalizeBodyStateResult(parsed && parsed.bodyState)
    };
  }

  function buildOfflineSceneContinuityRules(recentSceneHint) {
    return [
      "【线下场景连续性】",
      "当前时间、地点、光线、天气、人物站位、距离和正在做的事，必须从最近线下历史推断；最近场景提示优先于旧 scene 设置。",
      recentSceneHint ? "最近场景提示：\n" + recentSceneHint : "没有明确场景时，根据最近历史自然推断，不默认白天/家/学校。",
      "前文是晚上/深夜/夜里/凌晨，下一轮不能突然白天、清晨、天亮或阳光照进来。",
      "前文在室内，下一轮不能突然室外；前文在桌边/床边/门口/走廊/房间，下一轮必须继续同一空间。",
      "禁止无衔接地写“天亮了”“阳光照进来”“来到教室”“回到家”“坐在咖啡馆”。",
      "如果需要换场景，必须先用 1-2 条 action 写清收拾东西、起身离开、走过走廊、推开门、车程/路程或时间流逝。",
      "用户没有输入新动作时，只推进当前场景里的动作、距离、沉默、话题和情绪，不要重开一幕。"
    ].filter(Boolean).join("\n");
  }

  function buildInlineOfflineMessages(context) {
    var mode = context.mode === "group" ? "group" : "private";
    var participants = Array.isArray(context.participants) ? context.participants : [];
    var memories = context.memories || {};
    var chatMemories = getChatMemoriesForPrompt(mode, context.targetId || "", context.chatMemories);
    var historyText = formatInlineOfflineHistory(context.history, MAIN_HISTORY_WINDOW);
    var worldHistoryText = formatInlineOfflineHistory(context.history, WORLD_HISTORY_WINDOW);
    var recentCharacterLinesText = buildRecentCharacterLinesText(extractRecentCharacterLines((context.history || []).slice(-CHARACTER_LINE_HISTORY_WINDOW), "", CHARACTER_LINE_EXTRACT_LIMIT));
    var recentCharacterLinesMap = buildGroupRecentCharacterLinesMap(participants, context.history);
    var timeGapInfo = detectRecentTimeGapText(context.history);
    var recentSceneHint = String(context.recentSceneHint || "").trim();
    var userContext = buildUserContext(context.userSettings || {});
    var sceneText = recentSceneHint
      ? "最近场景连续性提示：\n" + recentSceneHint
      : "";
    var selectedWorldBookIds = getSelectedWorldBookIds(mode, context.targetId || "", context);
    var worldBookMeta = buildWorldBookPromptMeta(selectedWorldBookIds);
    var contextText = buildWorldBookDecisionContext({
      modeLabel: mode === "group" ? "群聊线下推进" : "私聊线下推进",
      userInput: context.userInput || "",
      recentHistory: worldHistoryText,
      characterPersonaText: participants.map(function (character) {
        return [
          "参与角色：" + (character && character.name || ""),
          "角色人设：" + buildMergedCharacterPersona(character),
          "角色长期记忆：" + formatMemoryList(memories && character ? memories[character.id] || [] : [])
        ].join("\n");
      }).join("\n"),
      userPersonaText: [
        "用户名称：" + valueOrFallback(userContext.name),
        userContext.persona || "暂无"
      ].join("\n"),
      relationshipStatus: userContext.relationshipName || "",
      sceneText: sceneText || "未指定，请根据最近历史自然推断，不默认白天/家/学校",
      chatMemoryText: formatChatMemoryList(chatMemories),
      previousReplyText: context.previousReplyText || context.lastAssistantText || "",
      extraText: [
        context.rejectedReplyText || context.oldReplyText ? "本轮重回旧回复摘要：" + limitText(context.rejectedReplyText || context.oldReplyText, 260) : "",
        context.regenerateInstruction ? "重回补充要求：" + context.regenerateInstruction : "",
        context.bodyState ? "用户身体状态：" + JSON.stringify(context.bodyState) : ""
      ].filter(Boolean).join("\n")
    });
    var worldBookContext = context.worldBookContext || buildWorldBookContext(
      contextText,
      mode === "group" ? "group" : "private",
      context.targetId || "",
      {
        selectedWorldBookIds: selectedWorldBookIds,
        relatedTargetIds: participants.map(function (character) {
          return character && character.id;
        }).filter(Boolean),
        characterIds: participants.map(function (character) {
          return character && character.id;
        }).filter(Boolean),
        memberIds: mode === "group" ? participants.map(function (character) {
          return character && character.id;
        }).filter(Boolean)
          : []
      }
    );
    context.worldBookContext = worldBookContext;
    context.selectedWorldBookIds = selectedWorldBookIds;
    context.recentCharacterLinesText = recentCharacterLinesText;
    context.recentCharacterLinesMap = recentCharacterLinesMap;
    context.timeGapText = timeGapInfo;
    context.timeGapInfo = timeGapInfo;
    console.debug("[WorldBook Debug][offline actual prompt]", {
      scope: mode,
      targetId: context.targetId,
      selectedWorldBookIds: selectedWorldBookIds,
      selectedCount: selectedWorldBookIds.length,
      worldBookContextLength: worldBookContext ? worldBookContext.length : 0,
      preview: worldBookContext ? worldBookContext.slice(0, 500) : "(empty)"
    });
    var recentHeartVoiceText = mode === "group"
      ? buildRecentHeartVoiceForCharacters(participants, "group", context.targetId || "")
      : (participants.length === 1
        ? buildRecentHeartVoiceContext(participants[0] && participants[0].id, "private", participants[0] && participants[0].id)
        : buildRecentHeartVoiceForCharacters(participants, "private", context.targetId || ""));
    context.recentHeartVoiceText = recentHeartVoiceText;
    context.thoughtsHint = recentHeartVoiceText;
    var privateReferenceText = mode === "group" ? buildPrivateReferenceSummary(participants) : "";
    var relationshipPhaseHint = buildRelationshipPhaseHint(
      recentHeartVoiceText,
      formatChatMemoryList(chatMemories),
      participants.map(function (character) {
        return (character && character.name || character && character.id || "") + "：" + (formatMemoryList(memories[character.id] || []) || "");
      }).join("\n")
    );
    context.relationshipPhaseHint = relationshipPhaseHint;
    return [
      {
        role: "system",
        content: [
          buildSystemBase(mode === "group" ? "group" : "private"),
          buildParticipantDossier(participants, memories),
          participants.length === 1 ? buildPersonaExecutionAnchors(participants[0], userContext, "offline") : buildGroupPersonaExecutionAnchors(participants, userContext, "offline"),
          participants.length === 1 ? buildPersonaVoiceFingerprint(participants[0], userContext, "offline", worldBookContext) : buildGroupPersonaVoiceFingerprints(participants, userContext, "offline", worldBookContext),
          participants.length === 1 ? buildVoiceCalibration(participants[0], userContext, "offline", {
            latestUserInput: context.userInput || "",
            previousReplyText: context.previousReplyText || context.lastAssistantText || "",
            recentHeartVoiceText: recentHeartVoiceText,
            worldBookContext: worldBookContext,
            recentCharacterLinesText: recentCharacterLinesText,
            relationshipPhaseHint: relationshipPhaseHint
          }) : buildGroupVoiceCalibrations(participants, userContext, "offline", {
            latestUserInput: context.userInput || "",
            previousReplyText: context.previousReplyText || context.lastAssistantText || "",
            recentHeartVoiceText: recentHeartVoiceText,
            worldBookContext: worldBookContext,
            recentCharacterLinesText: recentCharacterLinesText,
            recentCharacterLinesMap: recentCharacterLinesMap,
            relationshipPhaseHint: relationshipPhaseHint
          }),
          mode === "group" ? buildGroupControlBoundaryRules(participants, "offline") : "",
          buildMatchedWorldBooksSection(worldBookContext, worldBookMeta),
          buildWorldRuleEnforcement(worldBookContext, worldBookMeta),
          buildRelationshipDriveRules(mode === "group" ? "group" : "private"),
          buildRelationshipProgressionRules("offline"),
          buildCharacterDecisionCore("offline", worldBookContext),
          buildOfflineSceneContinuityRules(recentSceneHint),
          recentHeartVoiceText,
          buildMemoryStream({
            chatMemoryText: formatChatMemoryList(chatMemories) || "暂无",
            longTermMemoryText: participants.map(function (character) {
              return (character.name || character.id) + "：" + (formatMemoryList(memories[character.id] || []) || "暂无");
            }).join("\n"),
            recentTimelineText: historyText || "暂无",
            privateReferenceText: privateReferenceText,
            recentHeartVoiceText: recentHeartVoiceText,
            relationshipPhaseHint: relationshipPhaseHint,
            userContext: userContext,
            bodyState: context.bodyState
          }),
          buildThoughtReplyBindingRules("offline"),
          participants.map(function (character) { return buildCharacterResourceWhitelist(character); }).filter(Boolean).join("\n\n"),
          buildPromptPriorityHint()
        ].filter(Boolean).join("\n")
      },
      {
        role: "user",
        content: buildUserTaskPrompt({
          instruction: "请以场景里参与的角色本人身份推进剧情；不是按助手逻辑回答，而是从角色处境里反应。",
          modeLabel: mode === "group" ? "群聊线下推进" : "私聊线下推进",
          taskMode: "offline",
          userInput: context.userInput,
          worldBookContext: worldBookContext,
          selectedWorldBookIds: selectedWorldBookIds,
          sceneText: sceneText || "未指定，请根据最近历史自然推断，不默认白天/家/学校",
          beforeContext: "私聊模式只有当前角色参与；群聊模式允许所有群成员自然参与，多个角色可以说话。",
          contextLabel: "最近 10-16 条聊天/剧情上下文：",
          recentHistory: historyText || "暂无历史",
          requestOptions: context,
          regenerateRequest: context.regenerateRequest,
          regenerateInstruction: String(context.regenerateInstruction || "").trim(),
          schemaText: buildOfflineEventSchema(),
          moneyScope: mode === "group" ? "群聊线下" : "私聊线下",
          primaryField: "events",
          thoughtMode: mode === "group" ? "group" : "private",
          selfCheckMode: "offline",
          afterRules: [
            "【线下叙事核心规则】action 和 speech 必须交替穿插，不能只在开头写一条 action 然后全是 speech。",
            "目标比例：action 4-8 条，分散在整个回复里；speech 6-10 条；总计 10-16 条 events。",
            "speech 不足时，继续补台词；action 不足时，也要在 speech 之间补动作描写。",
            "禁止节奏：[action][speech×10] — 这是最常见的错误，必须避免。",
            "正确节奏：action 和 speech 至少要交替 3 次以上，让动作贯穿整个场景。",
            "action 内容：肢体动作、表情细节、环境变化、角色的停顿/靠近/后退/转身，用第三人称写，有镜头感。",
            "speech 内容：只写说出口的话，台词要符合角色人设，不要全部温柔解释。",
            "不要使用固定模板台词，如“过来”“看着我”“别让我猜”“别逞强”“先回我”；台词要源自当前角色与情境。",
            "action 描写要连贯且不要重复同一动作细节，避免使用简单套话式动作。",
            buildOfflineSceneContinuityRules(recentSceneHint),
            "如果线下剧情里出现补偿、购物花费、红包、转账等模拟金额事件，可在对应 event 上附加 money：{\"type\":\"transfer|redPacket\",\"amount\":\"12.66\",\"direction\":\"income|expense\",\"note\":\"备注\"}。",
            "memories 是长期记忆，不要为了凑数额外生成。"
          ].join("\n")
        })
      }
    ];
  }

  function formatInlineOfflineHistory(history, limit) {
    return (Array.isArray(history) ? history : [])
      .filter(function (message) {
        return message && message.content && message.type !== "loading" && message.type !== "error";
      })
      .slice(-(limit || MAIN_HISTORY_WINDOW))
      .map(function (message) {
        if (message.type === "offlineAction") {
          return formatPromptTimePrefix(message.createdAt) + "旁白：" + summarizeMessageForAI(message);
        }
        if (message.type === "offlineSpeech") {
          return formatPromptTimePrefix(message.createdAt) + (message.characterName || "角色") + "：" + summarizeMessageForAI(message);
        }
        if (message.type === "offlineUserAction") {
          return formatPromptTimePrefix(message.createdAt) + "用户行动：" + summarizeMessageForAI(message);
        }
        if (message.role === "user") {
          return formatPromptTimePrefix(message.createdAt) + "用户：" + summarizeMessageForAI(message);
        }
        if (message.role === "character") {
          return formatPromptTimePrefix(message.createdAt) + (message.characterName || "角色") + "：" + summarizeMessageForAI(message);
        }
        return formatPromptTimePrefix(message.createdAt) + "系统：" + summarizeMessageForAI(message);
      }).join("\n");
  }

  async function repairOfflineEvents(context, currentEvents, reason) {
    var participants = Array.isArray(context.participants) ? context.participants : [];
    var validIds = participants.map(function (p) { return p.id; });
    var fallbackId = validIds[0] || "";
    var recentSceneHint = String(context.recentSceneHint || "").trim();
    var scene = context.scene || context.offlineScene || {};
    var sceneText = recentSceneHint
      ? "最近场景连续性提示：\n" + recentSceneHint
      : [
        scene.name ? "场景：" + scene.name : "",
        scene.description ? "场景描述：" + scene.description : ""
      ].filter(Boolean).join("\n");

    var offlineHistory = Array.isArray(context.offlineHistory) ? context.offlineHistory : [];
    var inlineHistory = Array.isArray(context.history) ? context.history : [];
    var recentHistory = offlineHistory.length
      ? offlineHistory
          .filter(function (e) { return e && e.content && e.type !== "loading" && e.type !== "error"; })
          .slice(-10)
          .map(function (e) {
            if (e.role === "user" || e.type === "user" || e.type === "offlineUserAction") return "用户：" + summarizeMessageForAI(e);
            if (e.type === "speech" || e.type === "offlineSpeech") return (e.characterName || "角色") + "说：" + summarizeMessageForAI(e);
            return "旁白：" + summarizeMessageForAI(e);
          })
          .join("\n")
      : formatInlineOfflineHistory(inlineHistory, 10);

    var previousReplyText = context.previousReplyText || context.lastAssistantText || "";

    var messages = [
      {
        role: "system",
        content: [
          "你是一个叙事修复助手，专门处理线下模式的 events 序列。",
          "任务：在不改变台词语义的前提下，将缺失的 action 插入合适位置，让 action 和 speech 自然交替。",
          "修复规则：",
          "1. 保留所有原有 speech 台词，不得改写台词内容或语义。",
          "2. 保留原有有意义的 action，在 speech 之间补充新的 action。",
          "3. 修复后 action 总数至少 " + OFFLINE_ACTION_MIN_COUNT + " 条，且不得有连续超过 4 条 speech 无 action 穿插。",
          "4. 每条新增 action 必须承接前一条 event 的情境，由当前场景和角色状态自然生成，不得使用固定句库。",
          "5. 同一轮中不得重复动词、视线方向或身体部位描写；避免反复使用「垂眼」「偏头」「靠近」「转身」「目光一沉」「停在原地」等泛用动作词。",
          "6. action 用第三人称写，有镜头感，一条写一个完整画面，不超过三句。",
          "7. repair 只补动作和节奏，不得为了补 action 改时间、地点、光线、天气、站位或正在做的事；必须保留原场景。",
          "8. 前文是晚上不能修成白天/清晨/阳光；前文在室内、桌边、床边、门口或走廊，不能修成室外、教室、咖啡馆或其他新地点。",
          "9. 如果原 events 已经换场景但没有过渡，只能补 1-2 条过渡 action（收拾东西、起身离开、走过走廊、推开门、车程/路程/时间流逝），不能直接硬切。",
          "10. 只输出修复后的完整 events 数组，JSON 格式：{\"events\":[...]}"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          "修复原因：" + (reason || "action不足或speech连续过多"),
          sceneText || "",
          recentHistory ? "最近剧情：\n" + recentHistory : "",
          context.userInput ? "本轮用户输入：" + context.userInput : "",
          previousReplyText ? "上一轮回复摘要：" + limitText(previousReplyText, 200) : "",
          "参与角色：" + participants.map(function (p) { return p.name || p.id; }).join("、"),
          "",
          "需要修复的 events：",
          JSON.stringify(currentEvents || []),
          "",
          "请输出修复后的完整 events，只返回 JSON。"
        ].filter(Boolean).join("\n")
      }
    ];

    try {
      var rawContent = await sendConfiguredChatMessages(messages);
      var parsed = parseJsonFromText(rawContent);
      var repairedEvents = parsed && Array.isArray(parsed.events) ? parsed.events : null;

      if (!repairedEvents || !repairedEvents.length) return null;

      var normalized = normalizeOfflineEventList(repairedEvents, rawContent, {
        validIds: validIds,
        fallbackId: fallbackId,
        mode: context.mode,
        minSpeech: MIN_CHAT_REPLY_COUNT,
        maxActionCount: OFFLINE_ACTION_MAX_COUNT,
        max: MAX_CHAT_REPLY_COUNT
      });

      return normalized.length ? normalized : null;
    } catch (e) {
      return null;
    }
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
    var normalizedEvents;
    var thoughts = assignGroupAuxiliaryCharacterIds(normalizeThoughtList(getThoughtPayload(parsed)), validIds);
    var memories = assignGroupAuxiliaryCharacterIds(normalizeMemoryList(parsed && parsed.memories), validIds);

    // Only use raw text as a last-resort fallback when parsing fails completely.
    if (!events.length && !parsed && rawContent) {
      events = fallbackId
        ? [{ type: "speech", characterId: fallbackId, content: rawContent }]
        : [{ type: "action", characterId: "", content: rawContent }];
    }

    normalizedEvents = normalizeOfflineEventList(events, rawContent, {
      validIds: validIds,
      fallbackId: fallbackId,
      mode: context.mode,
      minSpeech: MIN_CHAT_REPLY_COUNT,
      maxActionCount: OFFLINE_ACTION_MAX_COUNT,
      max: MAX_CHAT_REPLY_COUNT,
      previousReplyText: context.previousReplyText,
      rejectedReplyText: context.rejectedReplyText,
      worldBookContext: context.worldBookContext,
      latestUserInput: context.userInput,
      recentHeartVoiceText: context.recentHeartVoiceText,
      thoughtsHint: context.thoughtsHint,
      recentCharacterLinesText: context.recentCharacterLinesText
    });

    var quality = checkOfflineEventQuality(normalizedEvents);
    if (!quality.ok) {
      var repairedEvents = await repairOfflineEvents(context, normalizedEvents, quality.reason);
      if (repairedEvents && repairedEvents.length) {
        normalizedEvents = repairedEvents;
      }
    }

    return {
      events: normalizedEvents,
      thoughts: thoughts,
      memories: memories,
      memorySummary: normalizeMemorySummaryResult(parsed && parsed.memorySummary),
      bodyState: normalizeBodyStateResult(parsed && parsed.bodyState)
    };
  }

  function buildOfflineMessages(context) {
    var participants = Array.isArray(context.participants) ? context.participants : [];
    var sharedMemories = context.sharedMemories || {};
    var chatMemories = getChatMemoriesForPrompt("offline", context.targetId || "", context.chatMemories);
    var recentSceneHint = String(context.recentSceneHint || "").trim();
    var scene = context.scene || context.offlineScene || {};
    var sceneText = [
      scene.name ? "场景：" + scene.name : "",
      scene.description ? "场景描述：" + scene.description : ""
    ].filter(Boolean).join("\n");
    if (recentSceneHint) {
      sceneText = "最近场景连续性提示：\n" + recentSceneHint + (sceneText ? "\n旧场景弱参考（不得覆盖最近剧情）：\n" + sceneText : "");
    }
    var offlineEvents = (Array.isArray(context.offlineHistory) ? context.offlineHistory : [])
      .filter(function (event) {
        return event && event.content && event.type !== "loading" && event.type !== "error";
      });
    var formatOfflineWorldEvent = function (event) {
        if (event.role === "user" || event.type === "user") {
          return formatPromptTimePrefix(event.createdAt) + "用户：" + summarizeMessageForAI(event);
        }

        if (event.type === "speech") {
          return formatPromptTimePrefix(event.createdAt) + (event.characterName || "角色") + "说：" + summarizeMessageForAI(event);
        }

        return formatPromptTimePrefix(event.createdAt) + "旁白：" + summarizeMessageForAI(event);
      };
    var history = offlineEvents.slice(-MAIN_HISTORY_WINDOW).map(formatOfflineWorldEvent).join("\n");
    var worldHistory = offlineEvents.slice(-WORLD_HISTORY_WINDOW).map(formatOfflineWorldEvent).join("\n");
    var recentCharacterLinesText = buildRecentCharacterLinesText(extractRecentCharacterLines(offlineEvents.slice(-CHARACTER_LINE_HISTORY_WINDOW), "", CHARACTER_LINE_EXTRACT_LIMIT));
    var recentCharacterLinesMap = buildGroupRecentCharacterLinesMap(participants, offlineEvents);
    var timeGapInfo = detectRecentTimeGapText(offlineEvents);
    var selectedWorldBookIds = getSelectedWorldBookIds(context.mode === "group" ? "group" : "private", context.targetId || "", context);
    var worldBookMeta = buildWorldBookPromptMeta(selectedWorldBookIds);
    var worldBookContext = buildWorldBookContext(
      buildWorldBookDecisionContext({
        modeLabel: context.mode === "group" ? "群聊线下推进" : "私聊线下推进",
        userInput: context.userInput || "",
        recentHistory: worldHistory,
        sceneText: sceneText || "未指定，请沿用最近剧情和参与者所处空间",
        characterPersonaText: participants.map(function (character) {
          return [
            "参与角色：" + (character && character.name || ""),
            "角色人设：" + buildMergedCharacterPersona(character),
            "角色长期记忆：" + formatMemoryList(sharedMemories && character ? sharedMemories[character.id] || [] : [])
          ].join("\n");
        }).join("\n"),
        userPersonaText: buildUserContext(context.userSettings || {}).persona || "",
        relationshipStatus: buildUserContext(context.userSettings || {}).relationshipName || "",
        chatMemoryText: formatChatMemoryList(chatMemories),
        previousReplyText: context.previousReplyText || context.lastAssistantText || "",
        extraText: [
          context.rejectedReplyText || context.oldReplyText ? "本轮重回旧回复摘要：" + limitText(context.rejectedReplyText || context.oldReplyText, 260) : "",
          context.regenerateInstruction ? "重回补充要求：" + context.regenerateInstruction : "",
          context.bodyState ? "用户身体状态：" + JSON.stringify(context.bodyState) : ""
        ].filter(Boolean).join("\n")
      }),
      context.mode === "group" ? "group" : "private",
      context.targetId || "",
      {
        selectedWorldBookIds: selectedWorldBookIds,
        relatedTargetIds: participants.map(function (character) {
          return character && character.id;
        }).filter(Boolean),
        characterIds: participants.map(function (character) {
          return character && character.id;
        }).filter(Boolean),
        memberIds: context.mode === "group" ? participants.map(function (character) {
          return character && character.id;
        }).filter(Boolean)
          : []
      }
    );
    context.worldBookContext = worldBookContext;
    context.selectedWorldBookIds = selectedWorldBookIds;
    context.recentCharacterLinesText = recentCharacterLinesText;
    context.recentCharacterLinesMap = recentCharacterLinesMap;
    context.timeGapText = timeGapInfo;
    context.timeGapInfo = timeGapInfo;
    var userContext = buildUserContext(context.userSettings || {});
    var recentHeartVoiceText = context.mode === "group"
      ? buildRecentHeartVoiceForCharacters(participants, "group", context.targetId || "")
      : (participants.length === 1
        ? buildRecentHeartVoiceContext(participants[0] && participants[0].id, "private", participants[0] && participants[0].id)
        : buildRecentHeartVoiceForCharacters(participants, "private", context.targetId || ""));
    context.recentHeartVoiceText = recentHeartVoiceText;
    context.thoughtsHint = recentHeartVoiceText;
    var privateReferenceText = context.mode === "group" ? buildPrivateReferenceSummary(participants) : "";
    var relationshipPhaseHint = buildRelationshipPhaseHint(
      recentHeartVoiceText,
      formatChatMemoryList(chatMemories),
      participants.map(function (character) {
        return (character && character.name || character && character.id || "") + "：" + (formatMemoryList(sharedMemories[character.id] || []) || "");
      }).join("\n")
    );
    context.relationshipPhaseHint = relationshipPhaseHint;

    return [
      {
        role: "system",
        content: [
          buildSystemBase(context.mode === "group" ? "group" : "private"),
          buildParticipantDossier(participants, sharedMemories),
          participants.length === 1 ? buildPersonaExecutionAnchors(participants[0], userContext, "offline") : buildGroupPersonaExecutionAnchors(participants, userContext, "offline"),
          participants.length === 1 ? buildPersonaVoiceFingerprint(participants[0], userContext, "offline", worldBookContext) : buildGroupPersonaVoiceFingerprints(participants, userContext, "offline", worldBookContext),
          participants.length === 1 ? buildVoiceCalibration(participants[0], userContext, "offline", {
            latestUserInput: context.userInput || "",
            previousReplyText: context.previousReplyText || context.lastAssistantText || "",
            recentHeartVoiceText: recentHeartVoiceText,
            worldBookContext: worldBookContext,
            recentCharacterLinesText: recentCharacterLinesText,
            relationshipPhaseHint: relationshipPhaseHint
          }) : buildGroupVoiceCalibrations(participants, userContext, "offline", {
            latestUserInput: context.userInput || "",
            previousReplyText: context.previousReplyText || context.lastAssistantText || "",
            recentHeartVoiceText: recentHeartVoiceText,
            worldBookContext: worldBookContext,
            recentCharacterLinesText: recentCharacterLinesText,
            recentCharacterLinesMap: recentCharacterLinesMap,
            relationshipPhaseHint: relationshipPhaseHint
          }),
          context.mode === "group" ? buildGroupControlBoundaryRules(participants, "offline") : "",
          buildMatchedWorldBooksSection(worldBookContext, worldBookMeta),
          buildWorldRuleEnforcement(worldBookContext, worldBookMeta),
          buildRelationshipDriveRules(context.mode === "group" ? "group" : "private"),
          buildRelationshipProgressionRules("offline"),
          buildCharacterDecisionCore("offline", worldBookContext),
          buildOfflineSceneContinuityRules(recentSceneHint),
          recentHeartVoiceText,
          buildMemoryStream({
            chatMemoryText: formatChatMemoryList(chatMemories) || "暂无",
            longTermMemoryText: participants.map(function (character) {
              return (character.name || character.id) + "：" + (formatMemoryList(sharedMemories[character.id] || []) || "暂无");
            }).join("\n"),
            recentTimelineText: history || "暂无",
            privateReferenceText: privateReferenceText,
            recentHeartVoiceText: recentHeartVoiceText,
            relationshipPhaseHint: relationshipPhaseHint,
            userContext: userContext,
            bodyState: context.bodyState
          }),
          buildThoughtReplyBindingRules("offline"),
          participants.map(function (character) { return buildCharacterResourceWhitelist(character); }).filter(Boolean).join("\n\n"),
          buildPromptPriorityHint()
        ].filter(Boolean).join("\n")
      },
      {
        role: "user",
        content: buildUserTaskPrompt({
          instruction: "请以场景里参与的角色本人身份推进剧情；不是按助手逻辑回答，而是从角色处境里反应。",
          modeLabel: context.mode === "group" ? "群聊线下推进" : "私聊线下推进",
          taskMode: "offline",
          userInput: context.userInput,
          sceneText: sceneText || "未指定，请沿用最近剧情和参与者所处空间",
          beforeContext: "私聊模式只围绕当前角色和用户互动；群聊模式中多个角色可以自然互动。",
          contextLabel: "最近 10-16 条剧情上下文：",
          recentHistory: history || "暂无",
          requestOptions: context,
          regenerateRequest: context.regenerateRequest,
          regenerateInstruction: String(context.regenerateInstruction || "").trim(),
          schemaText: buildOfflineEventSchema(),
          moneyScope: context.mode === "group" ? "群聊线下" : "私聊线下",
          primaryField: "events",
          thoughtMode: context.mode === "group" ? "group" : "private",
          selfCheckMode: "offline",
          afterRules: [
            "【线下叙事核心规则】action 和 speech 必须交替穿插，不能只在开头写一条 action 然后全是 speech。",
            "目标比例：action 4-8 条，分散在整个回复里；speech 6-10 条；总计 10-16 条 events。",
            "speech 不足时，继续补台词；action 不足时，也要在 speech 之间补动作描写。",
            "禁止节奏：[action][speech×10] — 这是最常见的错误，必须避免。",
            "正确节奏：action 和 speech 至少要交替 3 次以上，让动作贯穿整个场景。",
            "action 内容：肢体动作、表情细节、环境变化、角色的停顿/靠近/后退/转身，用第三人称写，有镜头感。",
            "speech 内容：只写说出口的话，台词要符合角色人设，不要全部温柔解释。",
            "不要使用固定模板台词，如“过来”“看着我”“别让我猜”“别逞强”“先回我”；台词要源自当前角色与情境。",
            "action 描写要连贯且不要重复同一动作细节，避免使用简单套话式动作。",
            buildOfflineSceneContinuityRules(recentSceneHint),
            "如果剧情里出现补偿、购物花费、红包、转账等模拟金额事件，可在对应 event 上附加 money：{\"type\":\"transfer|redPacket\",\"amount\":\"12.66\",\"direction\":\"income|expense\",\"note\":\"备注\"}。"
          ].join("\n")
        })
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
    var selectedWorldBookIds = getSelectedWorldBookIds("private", character && character.id, source);
    var worldBookMeta = buildWorldBookPromptMeta(selectedWorldBookIds);
    var worldBookContext = buildWorldBookContext(contextText, "private", character && character.id, {
      selectedWorldBookIds: selectedWorldBookIds,
      relatedTargetIds: character && character.id ? [character.id] : [],
      characterIds: character && character.id ? [character.id] : []
    });
    var rawContent = await sendConfiguredChatMessages([
      {
        role: "system",
        content: [
          buildSystemPrompt(character, null, {
            modeLabel: "角色日记",
            userInput: source.prompt || "",
            recentHistory: [source.chatText || "", source.groupText || "", source.offlineText || ""].join("\n"),
            previousReplyText: source.thoughtText || source.memoryText || "",
            selectedWorldBookIds: selectedWorldBookIds,
            worldBookContext: worldBookContext
          })
        ].filter(Boolean).join("\n")
      },
      {
        role: "user",
        content: [
          "本轮任务（Part B：只放本轮要做的事）",
          "当前模式：角色日记",
          "你要以角色本人第一人称写一篇今天的日记，符合角色人设和说话风格。",
          "日记只基于提供的聊天、群聊、线下互动、心声、记忆和命中的世界书（如有），不要凭空编重大事件，不要解释设定。",
          "日期：" + date,
          "今天的聊天和资料：",
          contextText || "今天没有太多记录，请写一篇克制、贴合角色的短日记。",
          "只返回 JSON，不要 Markdown，不要解释。",
          "JSON 格式：{\"date\":\"" + date + "\",\"weather\":\"晴\",\"title\":\"今天的小事\",\"content\":\"日记正文\",\"mood\":\"开心\",\"summary\":\"一句话小结\"}"
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

  async function generateMomentWithComments(context) {
    var source = context || {};
    var author = source.author || {};
    var relatedCharacters = Array.isArray(source.relatedCharacters) ? source.relatedCharacters : [];
    var relatedIds = relatedCharacters.map(function (character) {
      return character && character.id;
    }).filter(Boolean);
    var worldRelatedIds = relatedIds.concat(author.id ? [author.id] : []).filter(function (id, index, all) {
      return id && all.indexOf(id) === index;
    });
    var memories = source.memories || {};
    var userContext = buildUserContext(source.userSettings || {});
    var authorCharacterId = author && author.authorType !== "user" && author.id ? author.id : "";
    var selectedWorldBookIds = authorCharacterId
      ? getSelectedWorldBookIds("private", authorCharacterId, source)
      : getSelectedWorldBookIds("global", "", source);
    var worldBookMeta = buildWorldBookPromptMeta(selectedWorldBookIds);
    var contextText = [
      source.prompt || "",
      source.recentText || "",
      source.memoryText || "",
      selectedWorldBookIds.length ? source.worldText || "" : ""
    ].join("\n");
    var worldBookContext = selectedWorldBookIds.length && source.worldText ? source.worldText : buildWorldBookContext(
      contextText,
      authorCharacterId ? "private" : "global",
      authorCharacterId || "",
      {
        selectedWorldBookIds: selectedWorldBookIds,
        relatedTargetIds: worldRelatedIds,
        characterIds: worldRelatedIds
      }
    );
    var relatedLines = relatedCharacters.map(function (character) {
      return [
        "角色ID：" + character.id,
        "名称：" + valueOrFallback(character.name),
        "人设：" + valueOrFallback(buildMergedCharacterPersona(character)),
        "相关记忆：" + (formatMemoryList(memories[character.id] || []) || "暂无")
      ].join("；");
    });
    var momentMode = "private";
    var rawContent = await sendConfiguredChatMessages([
      {
        role: "system",
        content: [
          buildSystemBase(momentMode),
          "B. 角色档案 characterDossier",
          "发布者：" + valueOrFallback(author.name) + "（" + (author.authorType === "user" ? "用户" : "角色") + "）",
          "发布者设定：" + valueOrFallback(author.authorType === "user" ? buildMergedUserPersona(author) : buildMergedCharacterPersona(author)),
          "认识的人：",
          relatedLines.join("\n") || "暂无",
          buildMatchedWorldBooksSection(worldBookContext, worldBookMeta),
          buildWorldRuleEnforcement(worldBookContext, worldBookMeta),
          buildRelationshipDriveRules("private"),
          buildRelationshipProgressionRules("private"),
          buildCharacterDecisionCore("private"),
          "C. 关系痕迹 memoryStream",
          "用户在角色眼里：" + valueOrFallback(userContext.name) + "；" + valueOrFallback(userContext.persona),
          buildThoughtReplyBindingRules("private"),
          author.authorType === "user" ? "" : buildCharacterResourceWhitelist(author)
        ].filter(Boolean).join("\n")
      },
      {
        role: "user",
        content: [
          "本轮任务（Part B：只放本轮要做的事）",
          "当前模式：朋友圈动态",
          "你正在为心屿空间生成朋友圈动态和评论。",
          "只能一次性返回 JSON，不要 Markdown，不要解释，不要额外调用。",
          "正文要像发布者本人会发的那条朋友圈，短、有画面、有态度，不要写成总结或感言。",
          "评论必须和朋友圈正文同一次返回；评论像真实朋友圈短评，每条不超过 40 字，要带各自人设和关系痕迹。",
          "评论者只能从 relatedCharacters 里选择，最多 5 条；没有关系或不该评论就返回空数组。",
          "所有内容都要贴合角色人设、关系、记忆、世界书和当前用户人设。",
          "触发原因：" + valueOrFallback(source.reason || "朋友圈更新"),
          "用户/角色输入：" + valueOrFallback(source.prompt),
          "最近上下文：",
          contextText || "暂无",
          "JSON 格式：{\"moment\":{\"content\":\"朋友圈正文\",\"images\":[{\"description\":\"可选图片描述\"}]},\"comments\":[{\"characterId\":\"角色ID\",\"content\":\"评论内容\"}],\"memories\":[{\"characterId\":\"角色ID\",\"content\":\"可写入记忆的内容\"}]}"
        ].filter(Boolean).join("\n")
      }
    ]);
    var parsed = parseJsonFromText(rawContent) || {};
    var moment = parsed.moment && typeof parsed.moment === "object" ? parsed.moment : {};
    var momentContent = normalizeAiMessageText(moment.content || (!parsed.moment ? rawContent : ""));

    return {
      moment: {
        content: momentContent,
        images: Array.isArray(moment.images) ? moment.images.map(function (image) {
          if (image && typeof image === "object") {
            return {
              src: String(image.src || ""),
              description: String(image.description || "")
            };
          }
          return { src: "", description: String(image || "") };
        }).filter(function (image) {
          return image.src || image.description;
        }) : []
      },
      comments: Array.isArray(parsed.comments) ? parsed.comments.map(function (comment) {
        var item = comment && typeof comment === "object" ? comment : {};
        return {
          characterId: String(item.characterId || ""),
          content: normalizeAiMessageText(item.content || "")
        };
      }).filter(function (comment) {
        return comment.characterId && comment.content;
      }).slice(0, 5) : [],
      memories: normalizeMemoryList(parsed.memories)
    };
  }

  async function generateShopProducts() {
    var rawContent = await sendConfiguredChatMessages([
      {
        role: "system",
        content: [
          "你是心屿空间小手机购物 App 的商品内容生成器。",
          "商品风格要温暖、有生活感，适合角色互动、送礼、日常消耗和轻量剧情使用。"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          "本轮任务（Part B：只放本轮要做的事）",
          "当前模式：商品生成",
          "请生成一批温暖、有生活感、适合和虚拟角色互动的小手机商品。",
          "外卖至少 4 个店铺，每个店铺至少 5 个商品；网购至少 20 个商品。",
          "只调用一次并一次性返回全部商品 JSON，不要 Markdown，不要解释。",
          "JSON 格式：{\"foodShops\":[{\"name\":\"店铺名\",\"description\":\"店铺描述\",\"products\":[{\"name\":\"商品名\",\"description\":\"商品描述\",\"price\":12.8,\"category\":\"主食\",\"imagePrompt\":\"可选图片提示\",\"stock\":99}]}],\"mallProducts\":[{\"name\":\"商品名\",\"description\":\"商品描述\",\"price\":39.9,\"category\":\"生活用品\",\"imagePrompt\":\"可选图片提示\",\"stock\":99}]}"
        ].join("\n")
      }
    ]);
    var parsed = parseJsonFromText(rawContent) || {};

    return {
      foodShops: Array.isArray(parsed.foodShops) ? parsed.foodShops : [],
      mallProducts: Array.isArray(parsed.mallProducts) ? parsed.mallProducts : []
    };
  }

  async function sendConfiguredChatMessages(messages) {
    var settings = window.AppStorage.getSettings();
    var apiUrl = settings.apiUrl.trim();
    var apiKey = settings.apiKey.trim();
    var modelName = settings.modelName.trim();
    var temperature = Number(settings.temperature);
    var chatUrl;
    var response;
    var data;
    var content;
    var requestBody;
    var errorMessage;

    if (!apiUrl || !apiKey || !modelName) {
      throw new Error(MISSING_SETTINGS_MESSAGE);
    }

    try {
      var msgSummary = Array.isArray(messages) ? messages.map(function (m) { return (m && m.role ? m.role + ":" : "") + (m && m.content ? String(m.content).slice(0,200) : ""); }).join("\n---\n") : "";
      var hasGroupCtx = Array.isArray(messages) && messages.some(function (m) { return m && m.content && (m.content.indexOf("最近共同群聊") !== -1 || m.content.indexOf("刚刚共同群聊") !== -1 || m.content.indexOf("刚刚共同群聊片段") !== -1); });
      console.debug("[AI Debug] sendConfiguredChatMessages: messagesCount=", Array.isArray(messages) ? messages.length : 0, "hasRecentGroupContext=", hasGroupCtx, "preview=", msgSummary.slice(0,1000));
    } catch (e) {
      /* ignore debug errors */
    }

    chatUrl = buildChatCompletionsUrl(apiUrl);

    /*
      安全提醒：前端直接保存和使用 API Key 只适合个人本地运行。
      如果项目要公开部署，不应该把 API Key 暴露在前端，后续需要改成后端代理。
    */
    try {
      requestBody = {
        model: modelName,
        messages: messages,
        temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : 0.8
      };
      response = await fetch(chatUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey
        },
        body: JSON.stringify(requestBody)
      });

      data = await readResponseJson(response);

      if (!response.ok) {
        errorMessage = getApiErrorMessage(data, response);
        if (/temperature/i.test(errorMessage)) {
          delete requestBody.temperature;
          response = await fetch(chatUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + apiKey
            },
            body: JSON.stringify(requestBody)
          });
          data = await readResponseJson(response);
        }
        if (!response.ok) {
          throw new Error("聊天接口请求失败：" + getApiErrorMessage(data, response));
        }
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
      defaultType: "text",
      allowRawFallback: true
    }, options || {});
    var thoughts = normalizeThoughtList(getThoughtPayload(parsed));

    settings.thoughtsHint = buildThoughtsHintFromList(thoughts);

    return {
      replies: normalizeReplyList(rawContent, settings.replies, settings),
      actions: normalizeActionList(parsed && parsed.actions),
      thoughts: thoughts,
      memories: normalizeMemoryList(parsed && parsed.memories),
      moneyDecisions: normalizeMoneyDecisionList(parsed),
      memorySummary: normalizeMemorySummaryResult(parsed && parsed.memorySummary),
      bodyState: normalizeBodyStateResult(parsed && parsed.bodyState)
    };
  }

  function buildThoughtsHintFromList(thoughts) {
    return (Array.isArray(thoughts) ? thoughts : []).map(function (thought) {
      return [thought && thought.content, thought && thought.mood, thought && thought.visibleSummary].filter(Boolean).join(" ");
    }).filter(Boolean).join(" / ");
  }

  function getOutputMessages(parsed) {
    if (!parsed || typeof parsed !== "object") {
      return [];
    }

    if (Array.isArray(parsed.messages)) {
      return parsed.messages;
    }

    if (Array.isArray(parsed.replies)) {
      return parsed.replies;
    }

    if (parsed.message) {
      return [parsed.message];
    }

    if (parsed.reply) {
      return [parsed.reply];
    }

    return [];
  }

  function getThoughtPayload(parsed) {
    if (!parsed || typeof parsed !== "object") {
      return [];
    }

    return parsed.thoughts || parsed.whisper || parsed.whispers || parsed.innerVoice || parsed.innerVoices || [];
  }

  function normalizeMoneyDecisionList(parsed) {
    var decisions = [];
    var source;

    if (!parsed || typeof parsed !== "object") {
      return decisions;
    }

    function pushDecision(type, decision, item) {
      var normalizedDecision = normalizeMoneyDecision(decision);
      var normalizedType = normalizeMoneyDecisionType(type);

      if (!normalizedType || !normalizedDecision) {
        return;
      }

      decisions.push({
        type: normalizedType,
        decision: normalizedDecision,
        messageId: item && item.messageId ? String(item.messageId) : "",
        characterId: item && item.characterId ? String(item.characterId) : "",
        note: item && item.note ? String(item.note) : ""
      });
    }

    if (Array.isArray(parsed.moneyDecisions)) {
      parsed.moneyDecisions.forEach(function (item) {
        source = item && typeof item === "object" ? item : {};
        pushDecision(source.type || source.moneyType, source.decision || source.value || source.action, source);
      });
    }

    if (parsed.moneyDecision && typeof parsed.moneyDecision === "object") {
      source = parsed.moneyDecision;
      pushDecision(source.type || source.moneyType, source.decision || source.value || source.action, source);
    }

    pushDecision("transfer", parsed.transferDecision, {
      messageId: parsed.transferMessageId || parsed.messageId,
      characterId: parsed.transferCharacterId || parsed.characterId
    });
    pushDecision("redPacket", parsed.redPacketDecision || parsed.redpacketDecision, {
      messageId: parsed.redPacketMessageId || parsed.redpacketMessageId || parsed.messageId,
      characterId: parsed.redPacketCharacterId || parsed.redpacketCharacterId || parsed.characterId
    });

    getOutputMessages(parsed).forEach(function (message) {
      var item = message && typeof message === "object" ? message : {};
      pushDecision("transfer", item.transferDecision, item);
      pushDecision("redPacket", item.redPacketDecision || item.redpacketDecision, item);
      if (item.moneyDecision && typeof item.moneyDecision === "object") {
        pushDecision(item.moneyDecision.type || item.moneyDecision.moneyType, item.moneyDecision.decision || item.moneyDecision.value || item.moneyDecision.action, item.moneyDecision);
      }
    });

    return decisions;
  }

  function normalizeMoneyDecisionType(type) {
    var value = String(type || "").toLowerCase();
    if (value === "transfer" || value === "转账") {
      return "transfer";
    }
    if (value === "redpacket" || value === "red_packet" || value === "redPacket" || value === "红包") {
      return "redPacket";
    }
    return "";
  }

  function normalizeMoneyDecision(decision) {
    var value = String(decision || "").toLowerCase();
    if (value === "accept" || value === "accepted" || value === "receive" || value === "received" || value === "收" || value === "收下" || value === "领取") {
      return "accept";
    }
    if (value === "reject" || value === "rejected" || value === "return" || value === "refund" || value === "refuse" || value === "退回" || value === "拒收") {
      return "reject";
    }
    return "";
  }

  function normalizeThoughtList(thoughts) {
    var list;

    if (typeof thoughts === "string") {
      list = [{ content: thoughts }];
    } else if (thoughts && typeof thoughts === "object" && !Array.isArray(thoughts)) {
      list = [thoughts];
    } else {
      list = Array.isArray(thoughts) ? thoughts : [];
    }

    if (!list.length) {
      return [];
    }

    return list.map(function (thought) {
      var source = thought && typeof thought === "object" ? thought : { content: thought };
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

  function normalizeMemorySummaryResult(summary) {
    var source = summary && typeof summary === "object" ? summary : null;
    var content;

    if (!source) {
      return null;
    }

    content = String(source.content || source.body || source.summary || "").trim();
    if (!content) {
      return null;
    }

    return {
      title: String(source.title || "自动记忆总结").trim() || "自动记忆总结",
      content: content,
      sourceTime: source.sourceTime ? String(source.sourceTime) : ""
    };
  }

  function normalizeActionList(actions) {
    if (!Array.isArray(actions)) {
      return [];
    }

    return actions.map(function (action) {
      var source = action && typeof action === "object" ? action : { content: action };
      return {
        type: String(source.type || "narration"),
        content: normalizeAiMessageText(source.content || source.text || source.reason || ""),
        reason: normalizeAiMessageText(source.reason || source.content || source.text || "")
      };
    }).filter(function (action) {
      return action.type === "blockUser" || action.content;
    }).slice(0, MAX_CHAT_REPLY_COUNT);
  }

  function normalizeBodyStateResult(bodyState) {
    var source = bodyState && typeof bodyState === "object" ? bodyState : null;
    var parts;
    var normalizedParts = {};

    if (!source) {
      return null;
    }

    parts = source.parts && typeof source.parts === "object" && !Array.isArray(source.parts) ? source.parts : {};
    parts = migrateBodyStateResultParts(parts);
    DEFAULT_BODY_STATE_PARTS.forEach(function (partName) {
      normalizedParts[partName] = normalizeBodyPartResult(parts[partName] || {});
    });
    Object.keys(parts).forEach(function (partName) {
      normalizedParts[partName] = normalizeBodyPartResult(parts[partName]);
    });

    return {
      overallCondition: String(source.overallCondition || "正常"),
      currentNote: String(source.currentNote || source.note || "当前无明显异常"),
      energy: clampPercent(source.energy, 80),
      moodInfluence: String(source.moodInfluence || "影响轻微"),
      sorenessLevel: clampPercent(source.sorenessLevel, 0),
      painLevel: clampPercent(source.painLevel, 0),
      rednessLevel: clampPercent(source.rednessLevel, 0),
      bruiseRisk: String(source.bruiseRisk || "低"),
      sittingComfort: String(source.sittingComfort || "正常"),
      walkingComfort: String(source.walkingComfort || "正常"),
      handUseComfort: String(source.handUseComfort || "正常"),
      touchSensitivity: String(source.touchSensitivity || "正常"),
      bodyTemperature: String(source.bodyTemperature || "正常"),
      feverRisk: String(source.feverRisk || "低"),
      skinBreakage: String(source.skinBreakage || "无"),
      restNeeded: normalizeBooleanValue(source.restNeeded),
      recoverySuggestion: String(source.recoverySuggestion || "暂无特别需要。"),
      parts: normalizedParts,
      updatedAt: Date.now()
    };
  }

  function migrateBodyStateResultParts(parts) {
    var migratedParts = Object.assign({}, parts || {});

    Object.keys(BODY_STATE_PART_ALIASES).forEach(function (oldName) {
      var newName = BODY_STATE_PART_ALIASES[oldName];

      if (!Object.prototype.hasOwnProperty.call(migratedParts, oldName)) {
        return;
      }

      if (Object.prototype.hasOwnProperty.call(migratedParts, newName)) {
        migratedParts[newName] = mergeBodyPartResult(migratedParts[newName], migratedParts[oldName]);
      } else {
        migratedParts[newName] = migratedParts[oldName];
      }

      delete migratedParts[oldName];
    });

    return migratedParts;
  }

  function mergeBodyPartResult(primary, legacy) {
    var current = normalizeBodyPartResult(primary || {});
    var old = normalizeBodyPartResult(legacy || {});

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

  function normalizeBodyPartResult(part) {
    var source = part && typeof part === "object" ? part : {};

    return {
      status: String(source.status || "正常"),
      soreness: clampPercent(source.soreness, 0),
      pain: clampPercent(source.pain, 0),
      redness: clampPercent(source.redness, 0),
      notes: String(source.notes || "")
    };
  }

  function clampPercent(value, fallback) {
    var number = Number(value);
    if (!Number.isFinite(number)) {
      number = fallback;
    }
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function normalizeBodyStateWithContext(bodyState, previousState, recentHistory) {
    if (!bodyState || typeof bodyState !== "object") {
      return bodyState;
    }

    var isAlreadyNormal = (bodyState.sorenessLevel || 0) === 0 && (bodyState.painLevel || 0) === 0 && (bodyState.rednessLevel || 0) === 0;
    if (isAlreadyNormal) {
      return bodyState;
    }

    var recentText = (Array.isArray(recentHistory) ? recentHistory : [])
      .filter(function (m) { return m && (m.role === "user" || m.role === "assistant"); })
      .slice(-10)
      .map(function (m) { return String(m.content || ""); })
      .join("");

    var hasTrigger = BODY_STATE_TRIGGER_KEYWORDS.some(function (kw) { return recentText.indexOf(kw) !== -1; });
    if (hasTrigger) {
      return bodyState;
    }

    var prev = previousState && typeof previousState === "object" ? previousState : {};
    var prevSoreness = Number(prev.sorenessLevel) || 0;
    var prevPain = Number(prev.painLevel) || 0;
    var prevRedness = Number(prev.rednessLevel) || 0;

    var newSoreness = bodyState.sorenessLevel || 0;
    var newPain = bodyState.painLevel || 0;
    var newRedness = bodyState.rednessLevel || 0;

    var sorenessIncreased = newSoreness > prevSoreness;
    var painIncreased = newPain > prevPain;
    var rednessIncreased = newRedness > prevRedness;

    if (!sorenessIncreased && !painIncreased && !rednessIncreased) {
      return bodyState;
    }

    var corrected = Object.assign({}, bodyState);

    if (sorenessIncreased) {
      corrected.sorenessLevel = prevSoreness;
    }
    if (painIncreased) {
      corrected.painLevel = prevPain;
    }
    if (rednessIncreased) {
      corrected.rednessLevel = prevRedness;
    }

    var hasSpamNote = BODY_STATE_SPAM_PATTERNS.some(function (p) {
      return (corrected.currentNote || "").indexOf(p) !== -1;
    });

    if (hasSpamNote) {
      corrected.currentNote = prev.currentNote && prev.currentNote !== "当前无明显异常" ? prev.currentNote : "当前无明显不适";
      corrected.overallCondition = prev.overallCondition || "正常";
    }

    if (!corrected.sorenessLevel && !corrected.painLevel && !corrected.rednessLevel) {
      corrected.restNeeded = false;
      if (!corrected.recoverySuggestion || corrected.recoverySuggestion === "可适度放慢节奏、补水休息，按剧情节奏和身体反馈调整。") {
        corrected.recoverySuggestion = "暂无特别需要。";
      }
    }

    var correctedParts = Object.assign({}, corrected.parts || {});
    Object.keys(correctedParts).forEach(function (partName) {
      var part = correctedParts[partName] || {};
      var prevPart = (prev.parts || {})[partName] || {};
      var prevPartSoreness = Number(prevPart.soreness) || 0;
      var prevPartPain = Number(prevPart.pain) || 0;
      var prevPartRedness = Number(prevPart.redness) || 0;

      if ((part.soreness || 0) > prevPartSoreness || (part.pain || 0) > prevPartPain || (part.redness || 0) > prevPartRedness) {
        correctedParts[partName] = Object.assign({}, part, {
          soreness: Math.min(part.soreness || 0, prevPartSoreness),
          pain: Math.min(part.pain || 0, prevPartPain),
          redness: Math.min(part.redness || 0, prevPartRedness),
          status: prevPartSoreness === 0 && prevPartPain === 0 && prevPartRedness === 0 ? "正常" : (part.status || "正常"),
          notes: prevPartSoreness === 0 && prevPartPain === 0 && prevPartRedness === 0 ? "" : (part.notes || "")
        });
      }
    });
    corrected.parts = correctedParts;

    return corrected;
  }

  function normalizeBooleanValue(value) {
    if (value === true || value === "true" || value === "是" || value === "需要") {
      return true;
    }
    if (value === false || value === "false" || value === "否" || value === "不需要") {
      return false;
    }
    return Boolean(value);
  }

  // Normalize and sanitize offline events only. Do not generate or pad fallback speech/action content here.
  function normalizeOfflineEventList(events, rawContent, options) {
    var settings = Object.assign({
      validIds: [],
      fallbackId: "",
      mode: "private",
      minSpeech: MIN_CHAT_REPLY_COUNT,
      maxActionCount: OFFLINE_ACTION_MAX_COUNT,
      max: MAX_CHAT_REPLY_COUNT
    }, options || {});
    var validIds = settings.validIds || [];
    var normalized = [];
    var speechCount;
    var actionCount;

    settings.minSpeech = Math.max(0, Number(settings.minSpeech || settings.min) || MIN_CHAT_REPLY_COUNT);
    settings.minActionCount = Math.max(0, Number(settings.minActionCount) || OFFLINE_ACTION_MIN_COUNT);
    settings.maxActionCount = Math.max(0, Number(settings.maxActionCount) || OFFLINE_ACTION_MAX_COUNT);
    settings.max = Math.max(
      (settings.minSpeech || 1) + Math.min(settings.minActionCount, settings.maxActionCount),
      Number(settings.max) || MAX_CHAT_REPLY_COUNT
    );

    (Array.isArray(events) ? events : []).forEach(function (event, index) {
      var source = event && typeof event === "object" ? event : { content: event };
      var type = getOfflineNormalizedEventType(source);
      var content = normalizeAiMessageText(source.content);
      var contentParts = type === "speech" ? splitTextContentForTopUp(content).filter(Boolean) : (content ? [content] : []);

      if (!contentParts.length && content) {
        contentParts = [content];
      }

      contentParts.forEach(function (content, partIndex) {
        var characterId = validIds.indexOf(source.characterId) !== -1
          ? source.characterId
          : (type === "speech" ? pickOfflineSpeaker(validIds, settings.fallbackId, settings.mode, index + partIndex) : "");

        normalized.push(Object.assign({}, source, {
          type: type,
          characterId: characterId,
          content: content
        }));
      });
    });

    if (settings.previousReplyText || settings.rejectedReplyText || settings.lastAssistantText || settings.oldReplyText || settings.recentCharacterLinesText) {
      normalized = filterRepeatedContentItems(normalized, getRepeatGuardTexts(settings));
    }

    normalized = limitOfflineActionEvents(normalized, settings);
    speechCount = countOfflineSpeechEvents(normalized);
    actionCount = countOfflineActionEvents(normalized);
    normalized = limitOfflineActionEvents(normalized, settings);

    return normalized.filter(function (event) {
      return event.content && (event.type === "action" || event.characterId);
    }).slice(0, settings.max);
  }

  function getOfflineNormalizedEventType(event) {
    var type = String(event && event.type || "").trim();

    if (type === "speech" || type === "offlineSpeech" || type === "text") {
      return "speech";
    }
    if (type === "action" || type === "offlineAction") {
      return "action";
    }
    if (event && event.characterId) {
      return "speech";
    }
    return "action";
  }

  function isOfflineSpeechEvent(event) {
    var type = String(event && event.type || "").trim();
    return Boolean(event && event.content && (
      type === "speech"
      || type === "offlineSpeech"
      || type === "text"
    ));
  }

  function isOfflineActionEvent(event) {
    var type = String(event && event.type || "").trim();
    return Boolean(event && event.content && (
      type === "action"
      || type === "offlineAction"
    ));
  }

  function isOfflineMoneyEvent(event) {
    var source = event || {};
    var money = source.money && typeof source.money === "object" ? source.money : source;
    var type = String(money.type || money.moneyType || "").trim();

    return type === "transfer"
      || type === "redPacket"
      || type === "redpacket"
      || Boolean(source.money && source.money.amount);
  }

  function countOfflineSpeechEvents(events) {
    return (Array.isArray(events) ? events : []).filter(isOfflineSpeechEvent).length;
  }

  function countOfflineActionEvents(events) {
    return (Array.isArray(events) ? events : []).filter(isOfflineActionEvent).length;
  }

  function limitOfflineActionEvents(events, settings) {
    var actionMax = Math.max(0, Number(settings && settings.maxActionCount) || OFFLINE_ACTION_MAX_COUNT);
    var consecutiveActions = 0;
    var reduced = [];
    var nonMoneyActionCount = 0;

    (Array.isArray(events) ? events : []).forEach(function (event) {
      if (!isOfflineActionEvent(event)) {
        consecutiveActions = 0;
        reduced.push(event);
        return;
      }

      consecutiveActions += 1;
      if (consecutiveActions > 3 && !isOfflineMoneyEvent(event)) {
        return;
      }

      reduced.push(event);
    });

    return reduced.filter(function (event) {
      if (!isOfflineActionEvent(event) || isOfflineMoneyEvent(event)) {
        return true;
      }

      nonMoneyActionCount += 1;
      return nonMoneyActionCount <= actionMax;
    });
  }

  function checkOfflineEventQuality(events) {
    var list = Array.isArray(events) ? events : [];
    var actionCount = countOfflineActionEvents(list);
    var consecutiveSpeech = 0;
    var i;

    if (actionCount < OFFLINE_ACTION_MIN_COUNT) {
      return { ok: false, reason: "action数量不足（" + actionCount + "条，要求至少" + OFFLINE_ACTION_MIN_COUNT + "条）" };
    }

    for (i = 0; i < list.length; i++) {
      if (isOfflineSpeechEvent(list[i])) {
        consecutiveSpeech++;
        if (consecutiveSpeech > 4) {
          return { ok: false, reason: "speech连续超过4条无action穿插" };
        }
      } else if (isOfflineActionEvent(list[i])) {
        consecutiveSpeech = 0;
      }
    }

    return { ok: true, reason: "" };
  }

  // Reserved for last-resort fallback only when the offline response cannot be parsed into valid events.
  function createOfflineSpeechFallbackEvents(settings, missingCount, existingEvents) {
    var missing = Math.max(0, Number(missingCount) || 0);
    var profiles = getFallbackProfiles(settings);
    var events = [];
    var usedSpeech = {};
    var index = 0;

    (Array.isArray(existingEvents) ? existingEvents : []).forEach(function (event) {
      if (event && event.content) {
        usedSpeech[event.content] = true;
      }
    });

    while (events.length < missing && countOfflineSpeechEvents(existingEvents) + events.length < settings.max) {
      var profile = pickOfflineFallbackProfile(profiles, settings, index);
      var contextFlags = buildFallbackContextFlags(profile, settings.worldBookContext || "");
      var content = pickFallbackLine(profile, index, usedSpeech, contextFlags);
      var characterId = profile.id || pickOfflineSpeaker(settings.validIds || [], settings.fallbackId, settings.mode, index);

      if (!characterId) {
        break;
      }

      events.push({
        type: "speech",
        characterId: characterId,
        content: content
      });
      index += 1;
    }

    return events;
  }

  // Reserved for last-resort fallback only when the offline response cannot be parsed into valid events.
  function createOfflineActionFallbackEvents(settings, missingCount, existingEvents) {
    var options = settings || {};
    var existing = Array.isArray(existingEvents) ? existingEvents : [];
    var missing = Math.max(0, Number(missingCount) || 0);
    var actionMax = Math.max(0, Number(options.maxActionCount) || OFFLINE_ACTION_MAX_COUNT);
    var totalMax = Math.max(1, Number(options.max) || MAX_CHAT_REPLY_COUNT);
    var limit = Math.min(
      missing,
      Math.max(0, actionMax - countOfflineActionEvents(existing)),
      Math.max(0, totalMax - existing.length)
    );
    var profiles = getFallbackProfiles(options);
    var events = [];
    var usedActions = {};
    var index = 0;

    existing.forEach(function (event) {
      if (isOfflineActionEvent(event) && event.content) {
        usedActions[event.content] = true;
      }
    });

    while (events.length < limit) {
      var profile = pickOfflineFallbackProfile(profiles, options, index);
      var contextFlags = buildFallbackContextFlags(profile, options.worldBookContext || "");
      var content = pickFallbackOfflineActionLine(index, usedActions, contextFlags);

      if (!content) {
        break;
      }

      events.push({
        type: "action",
        characterId: "",
        content: content
      });
      index += 1;
    }

    return events;
  }

  function interleaveOfflineEvents(events, actionFallbacks) {
    var source = Array.isArray(events) ? events.slice() : [];
    var fallbacks = Array.isArray(actionFallbacks) ? actionFallbacks.filter(function (event) {
      return isOfflineActionEvent(event);
    }) : [];
    var speechSplitSlots = [];
    var speechSlots = [];
    var insertions = {};
    var fallbackIndex = 0;
    var slots;

    if (!fallbacks.length) {
      return source;
    }

    source.forEach(function (event, index) {
      if (!isOfflineSpeechEvent(event)) {
        return;
      }

      speechSlots.push(index);
      if (source[index + 1] && isOfflineSpeechEvent(source[index + 1])) {
        speechSplitSlots.push(index);
      }
    });

    slots = speechSplitSlots.length ? speechSplitSlots : speechSlots;

    if (!slots.length) {
      return fallbacks.concat(source);
    }

    fallbacks.forEach(function (fallback, index) {
      var slotOffset = fallbacks.length === 1
        ? Math.floor(slots.length / 2)
        : Math.floor(index * slots.length / fallbacks.length);
      var slot = slots[Math.min(slots.length - 1, slotOffset)];

      insertions[slot] = insertions[slot] || [];
      insertions[slot].push(fallback);
    });

    return source.reduce(function (result, event, index) {
      result.push(event);

      if (insertions[index]) {
        insertions[index].forEach(function (fallback) {
          result.push(fallback);
          fallbackIndex += 1;
        });
      }

      return result;
    }, []).concat(fallbacks.slice(fallbackIndex));
  }

  function pickOfflineFallbackProfile(profiles, settings, index) {
    var list = Array.isArray(profiles) && profiles.length ? profiles : [{}];
    var validIds = settings && Array.isArray(settings.validIds) ? settings.validIds : [];
    var fallbackId = settings && settings.fallbackId ? String(settings.fallbackId) : "";
    var matched;
    var speakerId;

    if ((settings && settings.mode) !== "group") {
      matched = list.filter(function (profile) {
        return profile && String(profile.id || "") === fallbackId;
      })[0];
      return matched || list[0] || {};
    }

    speakerId = validIds.length
      ? validIds[(index + Math.floor(index / 2)) % validIds.length]
      : fallbackId;
    matched = list.filter(function (profile) {
      return profile && String(profile.id || "") === String(speakerId || "");
    })[0];
    return matched || list[index % list.length] || {};
  }

  function debugOfflineNormalizeCase(input) {
    var source = input && typeof input === "object" ? input : {};
    var participants = Array.isArray(source.participants) ? source.participants : [];
    var validIds = participants.map(function (character) {
      return character && character.id;
    }).filter(Boolean);
    var fallbackId = source.fallbackId || validIds[0] || "";
    var inputEvents = (Array.isArray(source.events) ? source.events : []).map(function (event) {
      return event && typeof event === "object" ? Object.assign({}, event) : { content: event };
    });
    var outputEvents = normalizeOfflineEventList(inputEvents, "", {
      validIds: validIds,
      fallbackId: fallbackId,
      mode: source.mode === "group" ? "group" : "private",
      minSpeech: source.minSpeech || MIN_CHAT_REPLY_COUNT,
      maxActionCount: source.maxActionCount || OFFLINE_ACTION_MAX_COUNT,
      max: source.max || MAX_CHAT_REPLY_COUNT,
      fallbackProfiles: participants.map(buildReplyFallbackProfile),
      latestUserInput: source.latestUserInput || source.userInput || "",
      recentHeartVoiceText: source.recentHeartVoiceText || "",
      previousReplyText: source.previousReplyText || "",
      rejectedReplyText: source.rejectedReplyText || ""
    });

    return {
      inputEvents: inputEvents,
      outputEvents: outputEvents,
      speechCount: countOfflineSpeechEvents(outputEvents),
      actionCount: countOfflineActionEvents(outputEvents)
    };
  }

  function pickFallbackOfflineActionLine(index, used, contextFlags) {
    var flags = contextFlags || {};
    var lines = flags.hasWorldRules && (flags.isUpperLower || flags.isControl)
      ? [
        "他没有靠近，只用目光把距离压了回去。",
        "那一步最终停在界线外，像是谁都清楚不能再越过去。",
        "他指节在桌面轻敲了一下，周围的节奏随之慢下来。",
        "空气短暂收紧，连沉默都带着分寸。",
        "他把差点出口的话收住，只留下一个不容追问的眼神。"
      ]
      : (flags.hasWorldRules && flags.isForbidden
        ? [
          "他停了片刻，把话题从那条线前移开。",
          "那点靠近被他硬生生压住，房间里只剩短暂的安静。",
          "他侧过身，没有继续碰那个不能碰的话口。",
          "话到边缘便断了，像有人同时想起了不该越过的界线。",
          "他垂下眼，把真实反应藏回很克制的位置。"
        ]
        : [
      "他没有立刻说话，只把手里的东西慢慢放下。",
      "空气安静了几秒，连细小的动静都显得清楚。",
      "他抬眼看过来，目光停在你脸上没有移开。",
      "窗外的光落进来，把两个人之间的距离照得很分明。",
      "他往前走了一步，又在恰好的距离停住。",
      "桌面被指节轻轻叩了一下，节奏很慢。",
      "他把刚才的话咽回去，像是在重新判断你的反应。",
      "周围短暂地静下来，只剩呼吸声贴得很近。",
      "他侧过身，让出一点空间，却没有真的退开。",
      "那点压着的情绪没有散，只是被他暂时收住。"
        ]);
    var offset = index % lines.length;
    var line = lines[offset];
    var guard = 0;

    while ((used[line] || isGenericAiTemplateText(line)) && guard < lines.length) {
      offset = (offset + 1) % lines.length;
      line = lines[offset];
      guard += 1;
    }

    if (isGenericAiTemplateText(line)) {
      line = "他停了一下，没有立刻接话。";
    }

    used[line] = true;
    return line;
  }

  function pickOfflineSpeaker(validIds, fallbackId, mode, index) {
    if (!validIds.length) {
      return "";
    }

    if (mode === "group") {
      return validIds[index % validIds.length];
    }

    return fallbackId || validIds[0];
  }

  function createReplyTextureStats() {
    return {
      genericReplaced: 0,
      textureRewritten: 0,
      rhythmRebalanced: 0,
      highQualitySkipped: 0,
      fallbackAdded: 0,
      repeatedFiltered: 0,
      reasons: {}
    };
  }

  function recordReplyTextureStat(stats, type, reason) {
    var key = String(type || "");
    var why = String(reason || "unknown");

    if (!stats || !key) {
      return;
    }
    if (stats[key] === undefined) {
      stats[key] = 0;
    }
    stats[key] += 1;
    stats.reasons = stats.reasons || {};
    stats.reasons[why] = (stats.reasons[why] || 0) + 1;
  }

  function summarizeReplyTextureStats(stats) {
    var source = stats || {};
    return {
      genericReplaced: Number(source.genericReplaced) || 0,
      textureRewritten: Number(source.textureRewritten) || 0,
      rhythmRebalanced: Number(source.rhythmRebalanced) || 0,
      highQualitySkipped: Number(source.highQualitySkipped) || 0,
      fallbackAdded: Number(source.fallbackAdded) || 0,
      repeatedFiltered: Number(source.repeatedFiltered) || 0,
      reasons: Object.assign({}, source.reasons || {})
    };
  }

  function normalizeReplyList(rawContent, parsedReplies, options) {
    var settings = Object.assign({
      min: 1,
      max: MAX_CHAT_REPLY_COUNT,
      defaultType: "text",
      allowRawFallback: true
    }, options || {});
    var stats = settings.replyTextureStats || createReplyTextureStats();
    var replies = [];
    var filtered;
    var countBefore = 0;
    var finalList;
    var profilesForSummary;
    var voiceInfoForSummary;

    settings.replyTextureStats = stats;
    settings.replyTextureDebugSeen = settings.replyTextureDebugSeen || {};
    settings.min = Math.max(0, Number(settings.min) || 0);
    settings.max = Math.max(settings.min || 1, Number(settings.max) || MAX_CHAT_REPLY_COUNT);

    if (Array.isArray(parsedReplies)) {
      parsedReplies.forEach(function (reply) {
        replies = replies.concat(normalizeReplyItem(reply, settings));
      });
    }

    if (!replies.length && rawContent && settings.allowRawFallback !== false) {
      replies = splitTextToReplyItems(rawContent, settings);
    }

    if (replies.length === 1 && shouldSplitSingleReply(replies[0], settings)) {
      replies = splitReplyContent(replies[0], settings);
    }

    filtered = replies.filter(function (reply) {
      return reply && reply.content;
    });
    countBefore = filtered.length;

    if (settings.previousReplyText || settings.rejectedReplyText || settings.lastAssistantText || settings.oldReplyText || settings.recentCharacterLinesText) {
      filtered = filterRepeatedReplies(filtered, getRepeatGuardTexts(settings), settings);
    }

    filtered = replaceGenericTemplateReplies(filtered, settings);
    filtered = maybeRewriteReplyTextureList(filtered, settings);

    if (countReplyItemsForMinimum(filtered) < settings.min) {
      filtered = filtered.concat(createFallbackReplyItems(settings, filtered, stats));
    }

    filtered = rebalanceReplyRhythm(filtered, getFallbackProfiles(settings), settings);

    finalList = filtered.slice(0, settings.max);
    profilesForSummary = getFallbackProfiles(settings);
    voiceInfoForSummary = getReplyTextureVoiceInfo(profilesForSummary[0] || {}, settings);
    debugReplyTexture("normalizeReplyList.summary", {
      stats: stats,
      countBefore: countBefore,
      countAfter: finalList.length,
      latestUserInput: settings.latestUserInput,
      primaryTag: voiceInfoForSummary.primaryTag,
      tags: voiceInfoForSummary.tags,
      outputPreview: isReplyTextureDebugEnabled() ? finalList.slice(0, 5).map(function (reply) {
        return {
          type: reply && reply.type || "text",
          content: limitText(reply && reply.content || "", 40),
          characterId: reply && reply.characterId || ""
        };
      }) : undefined
    });

    return finalList;
  }

  function isReplyTextureDebugEnabled() {
    try {
      return typeof localStorage !== "undefined"
        && localStorage.getItem("myAiApp.debugReplyTexture") === "1";
    } catch (error) {
      return false;
    }
  }

  function shortenReplyDebugText(text) {
    var value = String(text || "").replace(/\s+/g, " ").trim();
    return value.length > 90 ? value.slice(0, 90) + "..." : value;
  }

  function debugReplyTexture(eventName, payload) {
    var data = payload || {};
    var safePayload;

    if (!isReplyTextureDebugEnabled() || typeof console === "undefined" || !console.debug) {
      return;
    }

    safePayload = {
      eventName: eventName,
      index: data.index,
      reason: data.reason || "",
      protectedReason: data.protectedReason || "",
      oldContent: shortenReplyDebugText(data.oldContent),
      newContent: shortenReplyDebugText(data.newContent),
      primaryTag: data.primaryTag || "",
      tags: Array.isArray(data.tags) ? data.tags.slice(0, 5) : [],
      latestUserInput: shortenReplyDebugText(data.latestUserInput),
      phase: data.phase || "",
      countBefore: data.countBefore,
      countAfter: data.countAfter,
      stats: data.stats ? summarizeReplyTextureStats(data.stats) : undefined,
      outputPreview: Array.isArray(data.outputPreview) ? data.outputPreview.map(function (reply) {
        return {
          type: reply && reply.type || "text",
          content: shortenReplyDebugText(reply && reply.content),
          characterId: reply && reply.characterId || ""
        };
      }) : undefined
    };

    console.debug("[replyTexture]", safePayload);
  }

  function shouldLogReplyTextureShouldRewrite(options, index, reason, content) {
    var settings = options || {};
    var seen = settings.replyTextureDebugSeen;
    var key;

    if (!seen) {
      return true;
    }

    key = String(index == null ? "" : index) + ":" + String(reason || "rewrite") + ":" + compactRepeatText(content);
    if (seen[key]) {
      return false;
    }
    seen[key] = true;
    return true;
  }

  function hasReplyActionOrPauseText(text) {
    return /……|…|\.{2,}|（|）|\(|\)|\[|\]|抬眼|垂眼|低头|偏头|停顿|沉默|靠近|后退|转身|伸手|按住|拉住|松开|皱眉|笑了一下|看着/.test(String(text || ""));
  }

  function hasPersonaAddressTexture(text, profile) {
    var value = String(text || "");
    var source = profile || {};
    var chatSettings = source.chatSettings || {};
    var names = [source.name, chatSettings.remarkName, chatSettings.userRelationshipName].filter(Boolean);

    if (/哥哥|姐姐|老师|先生|小姐|主人|宝贝|笨蛋|傻瓜|同学|前辈|学长|学姐|老板|大小姐|少爷|夫人|老婆|老公|亲爱的|乖/.test(value)) {
      return true;
    }

    return names.some(function (name) {
      var item = String(name || "").trim();
      return item.length >= 2 && item.length <= 8 && value.indexOf(item) !== -1;
    });
  }

  function isCharacterRhetoricalQuestionText(text) {
    var compact = String(text || "")
      .replace(/[\s"'“”‘’（）()\[\]【】]+/g, "")
      .replace(/[。.!！?？~～…⋯]+$/g, "");

    return /^(?:你敢|是吗|谁信|还装|这就想走|不要我管|凭什么|嗯)$/.test(compact)
      || /^你倒是说啊$/.test(compact);
  }

  function isCustomerServiceQuestionText(text) {
    var compact = String(text || "").replace(/\s+/g, "");
    return /你怎么了|你还好吗|能告诉我吗|可以告诉我吗|愿意(?:告诉我|说说)吗|为什么会这样呢|你想让我怎么做|发生什么了|要不要说说|要不要聊聊|可以说说吗/.test(compact);
  }

  function isExplanatoryToneText(text) {
    return /因为[\s\S]{0,40}所以|首先[\s\S]{0,40}其次|这说明|这意味着|换句话说|也就是说|原因是|建议你|从[\s\S]{0,20}角度来看|我认为你应该/.test(String(text || ""));
  }

  function isCustomerServiceToneText(text) {
    return /我理解你|我能感受到|如果你需要|你可以告诉我|我会陪着你|慢慢来|你的感受是合理的|你的感受很合理|我们可以一起|请告诉我更多|你怎么了|你还好吗|能告诉我吗|愿意说说吗|你想让我怎么做/.test(String(text || ""));
  }

  function getFallbackKeywordStopWords() {
    return {
      "我": true,
      "你": true,
      "他": true,
      "她": true,
      "它": true,
      "的": true,
      "了": true,
      "吧": true,
      "啊": true,
      "呀": true,
      "呢": true,
      "吗": true,
      "嘛": true,
      "哦": true,
      "嗯": true,
      "好": true,
      "就": true,
      "都": true,
      "也": true,
      "还": true,
      "很": true,
      "别": true,
      "没": true,
      "不": true,
      "是": true,
      "在": true,
      "有": true,
      "要": true,
      "想": true,
      "说": true,
      "就是": true,
      "那个": true,
      "这个": true,
      "一下": true,
      "真的": true,
      "现在": true,
      "刚才": true,
      "可以": true,
      "不是": true,
      "没有": true,
      "什么": true,
      "怎么": true
    };
  }

  function normalizeFallbackKeyword(word) {
    var value = String(word || "").trim();
    if (value === "不要你管") {
      return "不要管";
    }
    if (value === "你管我") {
      return "管我";
    }
    if (value === "别管我") {
      return "别管";
    }
    return value;
  }

  function textTouchesContextKeywords(text, contextText) {
    var value = String(text || "");
    var context = String(contextText || "").trim();
    var normalized = context.replace(/[，。！？、,.!?；;：:"“”'‘’（）()【】\[\]<>《》]/g, "");
    var keywords;

    if (!value || !context) {
      return false;
    }

    keywords = extractFallbackUserKeywords(normalized, context);
    return keywords.some(function (keyword) {
      var item = String(keyword || "").trim();
      return item.length >= 2 && value.indexOf(item) !== -1;
    });
  }

  function getReplyTextureVoiceInfo(profile, settings) {
    var source = profile || {};
    var options = settings || {};
    var voiceProfile = source.voiceProfile || detectPersonaVoiceProfile(source, [
      source.latestUserInput,
      options.latestUserInput,
      options.previousReplyText,
      options.recentHeartVoiceText,
      options.worldBookContext
    ].filter(Boolean).join("\n"));
    var tags = voiceProfile.tags || [];
    var primaryTag = voiceProfile.primaryTag || tags[0] || getFallbackStyleBucket(source, buildFallbackContextFlags(source, options.worldBookContext || ""));

    return {
      voiceProfile: voiceProfile,
      tags: tags,
      primaryTag: primaryTag
    };
  }

  function getHighQualityPersonaReplyReasons(reply, profile, settings) {
    var options = settings || {};
    var source = reply && typeof reply === "object" ? reply : { content: reply };
    var text = String(source.content || source.text || "").trim();
    var type = String(source.type || "text");
    var activeProfile = profile || options.textureProfile || options.fallbackProfile || {};
    var voiceProfile;
    var tags;
    var primaryTag;
    var reasons = [];
    var recentContext;

    if (!text || !isTextureRewriteType(type) || text.length > 120 || isGenericAiTemplateText(text)) {
      return [];
    }

    if (hasBannedAssistantTone(text) && !hasCharacterAttitudeText(text)) {
      return [];
    }

    voiceProfile = getReplyTextureVoiceInfo(activeProfile, options).voiceProfile;
    tags = voiceProfile.tags || [];
    primaryTag = voiceProfile.primaryTag || tags[0] || getFallbackStyleBucket(activeProfile, buildFallbackContextFlags(activeProfile, options.worldBookContext || ""));

    if (hasCharacterAttitudeText(text)) {
      reasons.push("character-attitude");
    }
    if (hasReplyActionOrPauseText(text)) {
      reasons.push("action-pause");
    }
    if (matchesPersonaVoiceTexture(text, primaryTag, tags)) {
      reasons.push("persona-texture");
    }
    if (textTouchesContextKeywords(text, options.latestUserInput || activeProfile.latestUserInput || "")) {
      reasons.push("keyword-hit");
    }

    recentContext = [
      options.previousReplyText,
      options.lastAssistantText,
      activeProfile.previousReplyText,
      options.recentHeartVoiceText,
      activeProfile.recentHeartVoiceText
    ].filter(Boolean).join("\n");
    if (textTouchesContextKeywords(text, recentContext)) {
      reasons.push("recent-heart-voice");
    }
    if (!isExplanatoryToneText(text) && !isCustomerServiceToneText(text)) {
      reasons.push("non-service-tone");
    }

    return reasons.length >= 2 ? reasons : [];
  }

  function isHighQualityPersonaReply(reply, profile, settings) {
    return getHighQualityPersonaReplyReasons(reply, profile, settings).length > 0;
  }

  function debugProtectedPersonaReply(reply, profile, settings, index) {
    var reasons = getHighQualityPersonaReplyReasons(reply, profile, settings);
    var options = settings || {};
    var voiceInfo;

    if (!reasons.length) {
      return false;
    }

    recordReplyTextureStat(options.replyTextureStats, "highQualitySkipped", reasons[0]);
    voiceInfo = getReplyTextureVoiceInfo(profile || {}, options);
    debugReplyTexture("reply.protected", {
      index: index,
      protectedReason: reasons[0],
      reason: "high-quality",
      oldContent: reply && reply.content,
      primaryTag: voiceInfo.primaryTag,
      tags: voiceInfo.tags,
      latestUserInput: options.latestUserInput || profile && profile.latestUserInput || "",
      phase: options.texturePhase || getFallbackRhythmPhase(index || 0)
    });
    return true;
  }

  function replaceGenericTemplateReplies(replies, options) {
    var settings = options || {};
    var profiles = getFallbackProfiles(settings);
    var used = {};

    return (Array.isArray(replies) ? replies : []).map(function (reply, index) {
      var profile;
      var replacement;
      var voiceInfo;

      if (!reply || !isTemplateRewriteType(reply.type || "text")) {
        return reply;
      }

      profile = pickFallbackProfileForReply(profiles, reply, index);
      if (!isGenericAiTemplateText(reply.content)) {
        return reply;
      }

      if (isHighQualityPersonaReply(reply, profile, settings)) {
        debugProtectedPersonaReply(reply, profile, settings, index);
        return reply;
      }

      replacement = replaceTemplateWithPersonaLine(reply, Object.assign({}, settings, {
        fallbackProfiles: profiles,
        templateReplacementUsed: used
      }), index);
      if (replacement && replacement.content !== reply.content) {
        recordReplyTextureStat(settings.replyTextureStats, "genericReplaced", "generic-template");
        voiceInfo = getReplyTextureVoiceInfo(profile, settings);
        debugReplyTexture("replaceGenericTemplateReplies.replace", {
          index: index,
          reason: "generic-template",
          oldContent: reply.content,
          newContent: replacement.content,
          primaryTag: voiceInfo.primaryTag,
          tags: voiceInfo.tags,
          latestUserInput: settings.latestUserInput || profile.latestUserInput || "",
          phase: getFallbackRhythmPhase(index)
        });
      }
      return replacement;
    });
  }

  function replaceTemplateWithPersonaLine(reply, settings, index) {
    var source = reply || {};
    var options = settings || {};
    var profiles = getFallbackProfiles(options);
    var profile = pickFallbackProfileForReply(profiles, source, index);
    var used = options.templateReplacementUsed || {};
    var flags = buildFallbackContextFlags(profile, options.worldBookContext || "");
    var voiceProfile = profile.voiceProfile || detectPersonaVoiceProfile(profile);
    var tags = voiceProfile.tags || [];
    var primaryTag = voiceProfile.primaryTag || tags[0] || getFallbackStyleBucket(profile, flags);
    var line;
    var shortLine;
    var guard = 0;

    if (!source || !isTemplateRewriteType(source.type || "text")) {
      return source;
    }

    line = buildPersonaAwareFallbackLine(profile, index, flags, getFallbackRhythmPhase(index));
    while (isFallbackLineBlocked(line, profile, used) && guard < 24) {
      guard += 1;
      line = buildPersonaAwareFallbackLine(profile, index + guard, flags, getFallbackRhythmPhase(index + guard));
    }

    if (isFallbackLineBlocked(line, profile, used)) {
      shortLine = getShortestPersonaFallbackLine(primaryTag);
      if (!isFallbackLineBlocked(shortLine, profile, used)) {
        line = shortLine;
      } else if (guard >= 20) {
        line = "这句先别翻过去。";
      }
    }
    used[line] = true;

    return Object.assign({}, source, {
      type: source.type || "text",
      characterId: source.characterId || profile.id || "",
      content: line
    });
  }

  function isTemplateRewriteType(type) {
    var value = String(type || "text");
    return value === "text" || value === "speech";
  }

  function isGenericAiTemplateText(text) {
    var value = String(text || "").trim();

    if (!value) {
      return false;
    }

    if (hasCharacterAttitudeText(value)) {
      return false;
    }

    return /我理解你|如果你需要|慢慢来|我会陪着你|你并不孤单|请告诉我更多|我们可以一起|你的感受是合理的|你的感受很合理|没关系的|辛苦了|当然可以|作为\s*AI|根据你提供的信息|很抱歉听到|听起来你|你的感受很重要|我在这里陪你|(^|[。！？!?\s])好的([。！？!?\s]|$)/.test(value);
  }

  function maybeRewriteReplyTextureList(replies, settings) {
    var options = settings || {};
    var list = Array.isArray(replies) ? replies : [];
    var profiles = getFallbackProfiles(options);
    var used = {};
    var textIndexes = getTextureRewriteIndexes(list);
    var maxRewrite = Math.max(1, Math.floor(textIndexes.length * 0.4));
    var rewriteMap = {};
    var analyses = [];
    var rewriteCount = 0;
    var actualRewriteCount = 0;

    analyses = list.map(function (reply, index) {
      var profile = pickFallbackProfileForReply(profiles, reply, index);
      return {
        index: index,
        profile: profile,
        texture: analyzeReplyTexture(reply, Object.assign({}, options, {
          textureProfile: profile,
          textureIndex: index,
          texturePhase: getFallbackRhythmPhase(index),
          textureCustomerQuestionRun: getCustomerServiceQuestionRunLength(list, index),
          textureQuestionRun: getQuestionRunLength(list, index),
          textureQuestionCount: countQuestionLikeReplies(list)
        }))
      };
    });

    analyses.filter(function (item) {
      return item.texture.shouldRewrite && (item.texture.tooAssistantLike || item.texture.tooGeneric);
    }).concat(analyses.filter(function (item) {
      return item.texture.shouldRewrite && !item.texture.tooAssistantLike && !item.texture.tooGeneric;
    })).some(function (item) {
      if (rewriteCount >= maxRewrite) {
        return true;
      }
      rewriteMap[item.index] = {
        profile: item.profile,
        reason: item.texture.reason
      };
      rewriteCount += 1;
      return false;
    });

    options.textureRewriteCount = rewriteCount;

    return list.map(function (reply, index) {
      var rewriteItem = rewriteMap[index];
      var replacement;
      if (!rewriteItem) {
        return reply;
      }
      replacement = maybeRewriteReplyTexture(reply, rewriteItem.profile, Object.assign({}, options, {
        textureRewriteReason: rewriteItem.reason,
        textureRewriteUsed: used,
        textureIndex: index,
        texturePhase: getFallbackRhythmPhase(index),
        textureCustomerQuestionRun: getCustomerServiceQuestionRunLength(list, index),
        textureQuestionRun: getQuestionRunLength(list, index),
        textureQuestionCount: countQuestionLikeReplies(list)
      }), index);
      if (replacement && replacement.content !== reply.content) {
        actualRewriteCount += 1;
        recordReplyTextureStat(options.replyTextureStats, "textureRewritten", rewriteItem.reason || "texture");
      }
      options.textureRewriteCount = actualRewriteCount;
      return replacement;
    });
  }

  function maybeRewriteReplyTexture(reply, profile, settings, index) {
    return rewriteReplyWithPersonaTexture(reply, profile, settings, index);
  }

  function analyzeReplyTexture(reply, settings) {
    var options = settings || {};
    var source = reply && typeof reply === "object" ? reply : { content: reply };
    var text = String(source.content || source.text || "").trim();
    var type = String(source.type || "text");
    var profile = options.textureProfile || options.fallbackProfile || {};
    var voiceInfo = getReplyTextureVoiceInfo(profile, options);
    var tags = voiceInfo.tags || [];
    var primaryTag = voiceInfo.primaryTag;
    var strongShortRole = /^(?:strong|cold|tsundere|shy|hostile)$/.test(primaryTag) || tags.some(function (tag) {
      return /^(?:strong|cold|tsundere|shy|hostile)$/.test(tag);
    });
    var hasCharacterAttitude = hasCharacterAttitudeText(text);
    var hasPauseOrAction = hasReplyActionOrPauseText(text);
    var hasPersonaVoice = matchesPersonaVoiceTexture(text, primaryTag, tags);
    var hasAddressTexture = hasPersonaAddressTexture(text, profile);
    var hasPersonaTexture = hasCharacterAttitude || hasPauseOrAction || hasPersonaVoice || hasAddressTexture;
    var questionMarks = (text.match(/[？?]/g) || []).length;
    var roleQuestion = isCharacterRhetoricalQuestionText(text);
    var serviceQuestion = isCustomerServiceQuestionText(text);
    var customerQuestionRun = options.textureCustomerQuestionRun != null
      ? Number(options.textureCustomerQuestionRun)
      : Number(options.textureQuestionRun);
    var tooExplanatory = isExplanatoryToneText(text) || /你可以|建议你/.test(text);
    var tooGeneric = /我理解你|我能感受到|如果你需要|你可以告诉我|我会陪着你|慢慢来|你的感受是合理的|我们可以一起/.test(text);
    var tooAssistantLike = hasBannedAssistantTone(text) || /作为\s*AI|语言模型|机器人|助手|系统默认|后台显示|金额字段|结构化\s*amount/.test(text);
    var tooQuestionLike = !roleQuestion
      && !hasCharacterAttitude
      && !hasPersonaVoice
      && serviceQuestion
      && customerQuestionRun >= 3;
    var tooLong = false;
    var lacksPersonaTexture = !hasPersonaTexture
      && text.length > 8
      && !isShortPersonaLikeText(text, primaryTag, tags)
      && /我知道|我明白|我在|好的|当然|可以|没关系|不要担心|别担心|会好起来|告诉我/.test(text);
    var isActionLike = type === "action" || hasPauseOrAction;
    var highQualityReply = isHighQualityPersonaReply(source, profile, options);
    var reason = "";
    var canRewriteType;
    var shouldRewrite;

    if (!tooQuestionLike && !roleQuestion && !hasCharacterAttitude && !hasPersonaVoice && questionMarks >= 2 && customerQuestionRun >= 3 && !hasPersonaTexture) {
      tooQuestionLike = true;
    }

    if (text.length > 150 && !isActionLike) {
      tooLong = true;
    } else if (text.length > 80
      && (tooExplanatory || tooGeneric || lacksPersonaTexture)
      && !hasCharacterAttitude
      && !hasPauseOrAction
      && !hasPersonaVoice
      && !hasAddressTexture) {
      tooLong = true;
    }

    if (strongShortRole
      && text.length > 60
      && (tooExplanatory || tooGeneric || lacksPersonaTexture)
      && !hasCharacterAttitude
      && !hasPauseOrAction
      && !hasPersonaVoice) {
      tooLong = true;
    }

    if (highQualityReply) {
      debugProtectedPersonaReply(source, profile, options, options.textureIndex);
      return {
        tooLong: false,
        tooExplanatory: !!tooExplanatory,
        tooGeneric: !!tooGeneric,
        tooQuestionLike: false,
        tooAssistantLike: !!tooAssistantLike,
        lacksPersonaTexture: false,
        hasCharacterAttitude: !!hasCharacterAttitude,
        highQuality: true,
        shouldRewrite: false,
        reason: ""
      };
    }

    if (tooAssistantLike) {
      reason = "assistant-like";
    } else if (tooGeneric) {
      reason = "generic";
    } else if (tooExplanatory) {
      reason = "explanatory";
    } else if (tooQuestionLike) {
      reason = "question-like";
    } else if (tooLong) {
      reason = "too-long";
    } else if (lacksPersonaTexture) {
      reason = "lacks-persona";
    }

    if ((hasCharacterAttitude || hasPersonaVoice || hasPauseOrAction || hasAddressTexture) && !tooAssistantLike && !tooGeneric) {
      tooLong = text.length > 150 && !isActionLike || text.length > 120 && tooExplanatory;
      tooQuestionLike = false;
      lacksPersonaTexture = false;
      if (!tooLong && !tooQuestionLike && !tooExplanatory) {
        reason = "";
      }
    }

    if (type === "action" && tooExplanatory && !hasPauseOrAction) {
      reason = "explanatory";
    }

    canRewriteType = isTextureRewriteType(type) || (type === "action" && tooExplanatory && !hasPauseOrAction);
    shouldRewrite = canRewriteType && !!(tooAssistantLike || tooGeneric || tooExplanatory || tooQuestionLike || tooLong || lacksPersonaTexture);
    if (shouldRewrite && shouldLogReplyTextureShouldRewrite(options, options.textureIndex, reason, text)) {
      debugReplyTexture("analyzeReplyTexture.shouldRewrite", {
        index: options.textureIndex,
        reason: reason,
        oldContent: text,
        newContent: "",
        primaryTag: primaryTag,
        tags: tags,
        latestUserInput: options.latestUserInput || profile.latestUserInput || "",
        phase: options.texturePhase || ""
      });
    }

    return {
      tooLong: !!tooLong,
      tooExplanatory: !!tooExplanatory,
      tooGeneric: !!tooGeneric,
      tooQuestionLike: !!tooQuestionLike,
      tooAssistantLike: !!tooAssistantLike,
      lacksPersonaTexture: !!lacksPersonaTexture,
      hasCharacterAttitude: !!hasCharacterAttitude,
      highQuality: false,
      shouldRewrite: shouldRewrite,
      reason: reason
    };
  }

  function rewriteReplyWithPersonaTexture(reply, profile, settings, index) {
    var source = reply && typeof reply === "object" ? reply : { content: reply };
    var options = settings || {};
    var texture = analyzeReplyTexture(source, Object.assign({}, options, {
      textureProfile: profile,
      textureIndex: index,
      texturePhase: options.texturePhase || getFallbackRhythmPhase(index)
    }));

    if (!texture.shouldRewrite) {
      return source;
    }

    return replaceReplyWithFallbackTexture(source, profile, Object.assign({}, options, {
      textureRewriteReason: texture.reason
    }), index, getFallbackRhythmPhase(index), false) || source;
  }

  function replaceReplyWithFallbackTexture(reply, profile, settings, index, phase, force) {
    var source = reply && typeof reply === "object" ? reply : { content: reply };
    var options = settings || {};
    var baseProfile = profile || {};
    var enrichedProfile = Object.assign({}, baseProfile, {
      latestUserInput: options.latestUserInput || baseProfile.latestUserInput || "",
      previousReplyText: options.previousReplyText || options.lastAssistantText || baseProfile.previousReplyText || "",
      rejectedReplyText: options.rejectedReplyText || options.oldReplyText || baseProfile.rejectedReplyText || "",
      recentHeartVoiceText: options.recentHeartVoiceText || baseProfile.recentHeartVoiceText || "",
      thoughtsHint: options.thoughtsHint || options.recentHeartVoiceText || baseProfile.thoughtsHint || baseProfile.recentHeartVoiceText || "",
      worldBookContext: options.worldBookContext || baseProfile.worldBookContext || ""
    });
    var flags = buildFallbackContextFlags(enrichedProfile, options.worldBookContext || "");
    var voiceInfo = getReplyTextureVoiceInfo(enrichedProfile, options);
    var used = options.textureRewriteUsed || {};
    var guard = 0;
    var line;

    if (!isTextureRewriteType(source.type || "text")
      && !(String(source.type || "text") === "action" && options.textureRewriteReason === "explanatory")
      && !force) {
      return null;
    }

    if (isHighQualityPersonaReply(source, enrichedProfile, options)) {
      debugProtectedPersonaReply(source, enrichedProfile, options, index);
      return null;
    }

    while (guard < 18) {
      line = buildPersonaAwareFallbackLine(enrichedProfile, index + guard, flags, phase || getFallbackRhythmPhase(index + guard));
      if (!isFallbackLineBlocked(line, enrichedProfile, used)
        && !isGenericAiTemplateText(line)
        && !isHighlySimilarText(compactRepeatText(line), compactRepeatText(source.content))) {
        used[line] = true;
        debugReplyTexture("replaceReplyWithFallbackTexture.replace", {
          index: index,
          reason: options.textureRewriteReason || (force ? "forced" : ""),
          oldContent: source.content,
          newContent: line,
          primaryTag: voiceInfo.primaryTag,
          tags: voiceInfo.tags,
          latestUserInput: enrichedProfile.latestUserInput || "",
          phase: phase || getFallbackRhythmPhase(index + guard)
        });
        return Object.assign({}, source, { content: line });
      }
      guard += 1;
    }

    return null;
  }

  function rebalanceReplyRhythm(replies, profiles, settings) {
    var list = (Array.isArray(replies) ? replies : []).slice();
    var options = settings || {};
    var profileList = Array.isArray(profiles) && profiles.length ? profiles : getFallbackProfiles(options);
    var textIndexes = getTextureRewriteIndexes(list);
    var maxReplace = 0;
    var used = {};
    var replaced = {};
    var replaceCount = 0;
    var questions;
    var explanatory;
    var templateIndexes;
    var hasShortReaction;
    var hasPersonaTrace;
    var hasBalancedRhythm;
    var shouldRebalance;
    var maxRatio;

    if (!textIndexes.length) {
      return list;
    }

    questions = textIndexes.filter(function (itemIndex) {
      return isQuestionLikeReply(list[itemIndex]);
    });
    explanatory = textIndexes.filter(function (itemIndex) {
      return analyzeReplyTexture(list[itemIndex], Object.assign({}, options, {
        textureProfile: pickFallbackProfileForReply(profileList, list[itemIndex], itemIndex),
        textureIndex: itemIndex,
        texturePhase: getFallbackRhythmPhase(itemIndex),
        textureCustomerQuestionRun: getCustomerServiceQuestionRunLength(list, itemIndex),
        textureQuestionRun: getQuestionRunLength(list, itemIndex),
        textureQuestionCount: countQuestionLikeReplies(list)
      })).tooExplanatory;
    });
    templateIndexes = textIndexes.filter(function (itemIndex) {
      return isGenericAiTemplateText(list[itemIndex] && list[itemIndex].content);
    });
    hasShortReaction = textIndexes.some(function (itemIndex) {
      return isShortReactionText(list[itemIndex] && list[itemIndex].content);
    });
    hasPersonaTrace = hasAnyPersonaVoiceTrace(list, textIndexes, profileList, options);
    hasBalancedRhythm = hasShortReactionInRange(list, 0, 2)
      && hasAttitudeInRange(list, 2, 5, profileList, options)
      && hasProgressionInRange(list, 5, 8)
      && hasHookInRange(list, 8, 10);

    if (hasBalancedRhythm) {
      return list;
    }

    shouldRebalance = questions.length > 4
      || explanatory.length > 5
      || !hasShortReaction
      || !hasPersonaTrace
      || templateIndexes.length > 1;

    if (!shouldRebalance) {
      return list;
    }

    maxRatio = templateIndexes.length > 1 ? 0.4 : 0.3;
    maxReplace = Math.max(0, Math.floor(textIndexes.length * maxRatio) - (Number(options.textureRewriteCount) || 0));
    if (maxReplace <= 0) {
      return list;
    }

    function canReplace(targetIndex) {
      return targetIndex >= 0
        && targetIndex < list.length
        && !replaced[targetIndex]
        && replaceCount < maxReplace
        && isTextureRewriteType(list[targetIndex] && (list[targetIndex].type || "text"));
    }

    function attemptReplace(targetIndex, phase, reason) {
      var profile;
      var replacement;
      var voiceInfo;
      var oldContent;

      if (!canReplace(targetIndex)) {
        return false;
      }

      profile = pickFallbackProfileForReply(profileList, list[targetIndex], targetIndex);
      if (isHighQualityPersonaReply(list[targetIndex], profile, options)) {
        debugProtectedPersonaReply(list[targetIndex], profile, options, targetIndex);
        return false;
      }

      oldContent = list[targetIndex] && list[targetIndex].content;
      replacement = replaceReplyWithFallbackTexture(list[targetIndex], profile, Object.assign({}, options, {
        textureRewriteUsed: used,
        textureRewriteReason: reason || "rebalance",
        textureIndex: targetIndex,
        texturePhase: phase || getFallbackRhythmPhase(targetIndex)
      }), targetIndex, phase || getFallbackRhythmPhase(targetIndex), true);

      if (!replacement || replacement.content === list[targetIndex].content) {
        return false;
      }

      list[targetIndex] = replacement;
      replaced[targetIndex] = true;
      replaceCount += 1;
      recordReplyTextureStat(options.replyTextureStats, "rhythmRebalanced", reason || "rebalance");
      voiceInfo = getReplyTextureVoiceInfo(profile, options);
      debugReplyTexture("rebalanceReplyRhythm.replace", {
        index: targetIndex,
        reason: reason || "rebalance",
        oldContent: oldContent,
        newContent: replacement.content,
        primaryTag: voiceInfo.primaryTag,
        tags: voiceInfo.tags,
        latestUserInput: options.latestUserInput || profile.latestUserInput || "",
        phase: phase || getFallbackRhythmPhase(targetIndex)
      });
      return true;
    }

    if (templateIndexes.length > 1) {
      templateIndexes.forEach(function (itemIndex) {
        attemptReplace(itemIndex, getFallbackRhythmPhase(itemIndex), "template-overflow");
      });
    }

    if (questions.length > 4) {
      questions.slice(4).forEach(function (itemIndex) {
        attemptReplace(itemIndex, getFallbackRhythmPhase(itemIndex), "question-overflow");
      });
    }

    if (explanatory.length > 5) {
      explanatory.slice(5).forEach(function (itemIndex) {
        attemptReplace(itemIndex, getFallbackRhythmPhase(itemIndex), "explanatory-overflow");
      });
    }

    if (!hasShortReaction) {
      attemptReplace(findReplaceCandidateInRange(list, 0, 2, profileList, options), "instant", "no-short-reaction");
    }
    if (!hasAttitudeInRange(list, 2, 5, profileList, options) && (!hasPersonaTrace || templateIndexes.length > 1)) {
      attemptReplace(findReplaceCandidateInRange(list, 2, 5, profileList, options), "attitude", "missing-attitude");
    }
    if (!hasProgressionInRange(list, 5, 8) && (!hasPersonaTrace || explanatory.length > 5)) {
      attemptReplace(findReplaceCandidateInRange(list, 5, 8, profileList, options), "progression", "missing-progression");
    }
    if (!hasHookInRange(list, 8, 10) && (!hasPersonaTrace || questions.length > 4 || explanatory.length > 5)) {
      attemptReplace(findReplaceCandidateInRange(list, 8, 10, profileList, options), "hook", "missing-hook");
    }

    if (!hasPersonaTrace) {
      textIndexes.slice(0, 3).forEach(function (itemIndex) {
        attemptReplace(itemIndex, getFallbackRhythmPhase(itemIndex), "no-persona-texture");
      });
    }

    return list;
  }

  function isTextureRewriteType(type) {
    var value = String(type || "text");
    return value === "text" || value === "speech";
  }

  function getTextureRewriteIndexes(replies) {
    var indexes = [];
    (Array.isArray(replies) ? replies : []).forEach(function (reply, index) {
      var type = reply && (reply.type || "text");
      if (reply && reply.content && isTextureRewriteType(type)) {
        indexes.push(index);
      }
    });
    return indexes;
  }

  function isQuestionLikeReply(reply) {
    var text = String(reply && reply.content || "");
    var questionMarks = (text.match(/[？?]/g) || []).length;

    if (!text || isCharacterRhetoricalQuestionText(text) || hasCharacterAttitudeText(text)) {
      return false;
    }

    if (isCustomerServiceQuestionText(text)) {
      return true;
    }

    return /[？?]\s*$/.test(text) || questionMarks >= 2;
  }

  function isCustomerServiceQuestionReply(reply) {
    var text = String(reply && reply.content || "");
    return !!text
      && !isCharacterRhetoricalQuestionText(text)
      && !hasCharacterAttitudeText(text)
      && isCustomerServiceQuestionText(text);
  }

  function getCustomerServiceQuestionRunLength(replies, index) {
    var list = Array.isArray(replies) ? replies : [];
    var count = isCustomerServiceQuestionReply(list[index]) ? 1 : 0;
    var cursor = index - 1;

    while (cursor >= 0 && isCustomerServiceQuestionReply(list[cursor])) {
      count += 1;
      cursor -= 1;
    }

    cursor = index + 1;
    while (cursor < list.length && isCustomerServiceQuestionReply(list[cursor])) {
      count += 1;
      cursor += 1;
    }

    return count;
  }

  function getQuestionRunLength(replies, index) {
    var list = Array.isArray(replies) ? replies : [];
    var count = isQuestionLikeReply(list[index]) ? 1 : 0;
    var cursor = index - 1;

    while (cursor >= 0 && isQuestionLikeReply(list[cursor])) {
      count += 1;
      cursor -= 1;
    }

    cursor = index + 1;
    while (cursor < list.length && isQuestionLikeReply(list[cursor])) {
      count += 1;
      cursor += 1;
    }

    return count;
  }

  function countQuestionLikeReplies(replies) {
    return (Array.isArray(replies) ? replies : []).filter(isQuestionLikeReply).length;
  }

  function matchesPersonaVoiceTexture(text, primaryTag, tags) {
    var value = String(text || "");
    var activeTags = uniqueList([primaryTag].concat(Array.isArray(tags) ? tags : [])).filter(Boolean);
    var patterns = {
      cold: /嗯|不像|随你|别绕|说重点|到这儿|我听见了|冷处理|不信/,
      strong: /过来|听我的|按我说|我来|先停|站住|看着我|别让我|坐下/,
      tsundere: /啧|谁说|谁问|别误会|烦死|嘴硬|我没|算了/,
      clingy: /别走|回我|别躲我|别把我晾|我还在等|再说一句/,
      gentle: /先别撑|慢慢|我在听|坐稳|别硬撑|把气放下来/,
      obsessive: /我看着|我盯着|别让我猜|别拿别人|你现在回我|不许/,
      playful: /哟|行啊|有点意思|继续编|胆子|我可记下/,
      formal: /坐好|按顺序|按节奏|我会处理|先放稳|把话说完整/,
      hostile: /少来|别试我|我不信|不吃这一套|继续装|账先记着/,
      shy: /……|别这样|你别看我|我有点乱|别催我/
    };

    return activeTags.some(function (tag) {
      return patterns[tag] && patterns[tag].test(value);
    });
  }

  function isShortPersonaLikeText(text, primaryTag, tags) {
    var value = String(text || "").trim();
    return value.length <= 8 && (hasCharacterAttitudeText(value)
      || matchesPersonaVoiceTexture(value, primaryTag, tags)
      || /^(嗯|啧|哟|行|好|停|来|过来|少来|坐好|别走|随你|算了|……)$/.test(value));
  }

  function isShortReactionText(text) {
    var value = String(text || "").trim();
    return value.length > 0 && value.length <= 12;
  }

  function hasShortReactionInRange(replies, start, end) {
    return (Array.isArray(replies) ? replies : []).slice(start, end).some(function (reply) {
      return isShortReactionText(reply && reply.content);
    });
  }

  function hasAttitudeInRange(replies, start, end, profiles, settings) {
    var list = Array.isArray(replies) ? replies : [];
    var profileList = Array.isArray(profiles) ? profiles : [];
    var options = settings || {};
    var index;
    var reply;
    var profile;
    var analysis;

    for (index = start; index < Math.min(end, list.length); index += 1) {
      reply = list[index];
      profile = pickFallbackProfileForReply(profileList, reply, index);
      analysis = analyzeReplyTexture(reply, Object.assign({}, options, {
        textureProfile: profile,
        textureIndex: index,
        texturePhase: getFallbackRhythmPhase(index),
        textureCustomerQuestionRun: getCustomerServiceQuestionRunLength(list, index),
        textureQuestionRun: getQuestionRunLength(list, index),
        textureQuestionCount: countQuestionLikeReplies(list)
      }));
      if (analysis.hasCharacterAttitude || !analysis.lacksPersonaTexture) {
        return true;
      }
    }

    return false;
  }

  function hasProgressionInRange(replies, start, end) {
    return (Array.isArray(replies) ? replies : []).slice(start, end).some(function (reply) {
      return /靠近|过来|压住|按住|试探|转移|冷处理|追问|清算|记着|放一边|继续|说清楚|别躲|回我|按我说|听我的|坐下|站住|别走|看着我|我来/.test(String(reply && reply.content || ""));
    });
  }

  function hasHookInRange(replies, start, end) {
    return (Array.isArray(replies) ? replies : []).slice(start, end).some(function (reply) {
      return /记着|回头|明天|醒了|之后|下次|到这儿|先这样|别走|我等|别让我|账|先放着|先到这里|再说/.test(String(reply && reply.content || ""));
    });
  }

  function findReplaceCandidateInRange(replies, start, end, profiles, settings) {
    var list = Array.isArray(replies) ? replies : [];
    var profileList = Array.isArray(profiles) ? profiles : [];
    var options = settings || {};
    var limit = Math.min(end, list.length);
    var index;
    var profile;

    for (index = start; index < limit; index += 1) {
      if (list[index] && isTextureRewriteType(list[index].type || "text")) {
        profile = pickFallbackProfileForReply(profileList, list[index], index);
        if (isHighQualityPersonaReply(list[index], profile, options)) {
          continue;
        }
        return index;
      }
    }

    return -1;
  }

  function hasAnyPersonaVoiceTrace(replies, indexes, profiles, settings) {
    var list = Array.isArray(replies) ? replies : [];
    var profileList = Array.isArray(profiles) ? profiles : [];
    var options = settings || {};

    return (Array.isArray(indexes) ? indexes : []).some(function (itemIndex) {
      var reply = list[itemIndex] || {};
      var profile = pickFallbackProfileForReply(profileList, reply, itemIndex);
      var voiceProfile = profile.voiceProfile || detectPersonaVoiceProfile(profile, [
        options.latestUserInput,
        options.previousReplyText,
        options.recentHeartVoiceText,
        options.worldBookContext
      ].filter(Boolean).join("\n"));
      var tags = voiceProfile.tags || [];
      var primaryTag = voiceProfile.primaryTag || tags[0] || getFallbackStyleBucket(profile, buildFallbackContextFlags(profile, options.worldBookContext || ""));
      var text = String(reply.content || "");

      return hasCharacterAttitudeText(text) || matchesPersonaVoiceTexture(text, primaryTag, tags);
    });
  }

  function extractRecentRepeatTexts(text) {
    return String(text || "").split(/\n+/).map(function (line) {
      return line
        .replace(/^\s*\d+[.、]\s*/, "")
        .replace(/^[^：:]{1,16}[：:]\s*/, "")
        .trim();
    }).filter(Boolean);
  }

  function getRepeatGuardTexts(settings) {
    var source = settings || {};
    return [
      source.previousReplyText || source.lastAssistantText || "",
      source.rejectedReplyText || source.oldReplyText || ""
    ].concat(extractRecentRepeatTexts(source.recentCharacterLinesText));
  }

  function isIntentionalPersonaRepetition(currentText, previousText, profile, settings) {
    var current = String(currentText || "").trim();
    var previous = String(previousText || "").trim();
    var options = settings || {};
    var voiceInfo = getReplyTextureVoiceInfo(profile || {}, options);
    var tags = uniqueList([voiceInfo.primaryTag].concat(voiceInfo.tags || []));
    var has = function (tag) { return tags.indexOf(tag) !== -1; };
    var combined = previous + "\n" + current;

    if (!current || !previous) {
      return false;
    }

    if (has("strong") || has("formal") || has("hostile") || hasCharacterAttitudeText(current)) {
      if (/过来|我说过来|站住|别动|听我的|按我说|看着我|别让我问第二遍/.test(combined)
        && /我说|说过|再|现在|听见没有|别让我|第二遍|站那儿/.test(current)) {
        return true;
      }
    }
    if (has("clingy") || has("obsessive")) {
      if (/回我|再回|再说一句|别走|别躲|我还在等|不许躲/.test(combined)
        && /再|还|现在|一句|别躲|别走|回我/.test(current)) {
        return true;
      }
    }
    if (has("tsundere")) {
      if (/谁管|没说不管|谁担心|别误会|烦死|我没/.test(combined)
        && /……|没说|谁|别误会|又没|算了/.test(current)) {
        return true;
      }
    }
    if (has("cold")) {
      if (/^(?:嗯|随你|继续|说重点|到这儿|不像)[。.!！?？]*$/.test(current)
        || current.length <= 6 && /嗯|随你|继续|说重点|到这儿|不像/.test(combined)) {
        return true;
      }
    }

    return false;
  }

  function getRepeatedReplyReason(repeatedItem, compactText) {
    var sourceIndex = Number(repeatedItem && repeatedItem.sourceIndex);

    if (sourceIndex === 1) {
      return "repeat-rejected";
    }
    if (sourceIndex >= 2) {
      return "repeat-recent-character-line";
    }
    return repeatedItem && compactText === repeatedItem.compact ? "repeat-same-text" : "repeat-similar-text";
  }

  function filterRepeatedReplies(replies, previousTexts, options) {
    var settings = Object.assign({
      min: MIN_CHAT_REPLY_COUNT,
      max: MAX_CHAT_REPLY_COUNT,
      defaultType: "text"
    }, options || {});
    var previousItems = (Array.isArray(previousTexts) ? previousTexts : [previousTexts]).map(function (text, sourceIndex) {
      return {
        raw: String(text || ""),
        compact: compactRepeatText(text),
        sourceIndex: sourceIndex
      };
    }).filter(function (item) {
      return item.compact;
    });
    var profiles = getFallbackProfiles(settings);
    var filtered = [];

    (Array.isArray(replies) ? replies : []).forEach(function (reply, index) {
      var compact = compactRepeatText(reply && reply.content);
      var profile = pickFallbackProfileForReply(profiles, reply, index);
      var repeatedItem = compact && previousItems.filter(function (item) {
        return isHighlySimilarText(compact, item.compact);
      })[0];
      var intentionalPersonaRepeat = !!repeatedItem && isIntentionalPersonaRepetition(reply && reply.content, repeatedItem.raw, profile, settings);
      var repeated = !!repeatedItem && !intentionalPersonaRepeat;
      var repeatReason;
      var voiceInfo;

      if (intentionalPersonaRepeat) {
        voiceInfo = getReplyTextureVoiceInfo(profile, settings);
        debugReplyTexture("reply.protected", {
          index: index,
          protectedReason: "intentional-persona-repetition",
          oldContent: reply && reply.content,
          primaryTag: voiceInfo.primaryTag,
          tags: voiceInfo.tags
        });
      }

      if (repeated) {
        repeatReason = getRepeatedReplyReason(repeatedItem, compact);
        recordReplyTextureStat(settings.replyTextureStats, "repeatedFiltered", repeatReason);
      }

      if (!repeated) {
        filtered.push(reply);
      }
    });

    if (countReplyItemsForMinimum(filtered) < settings.min) {
      filtered = filtered.concat(createFallbackReplyItems(settings, filtered, settings.replyTextureStats));
    }

    return filtered.slice(0, settings.max);
  }

  function filterRepeatedContentItems(items, previousTexts) {
    var previous = (Array.isArray(previousTexts) ? previousTexts : [previousTexts]).map(compactRepeatText).filter(Boolean);

    if (!previous.length) {
      return Array.isArray(items) ? items : [];
    }

    return (Array.isArray(items) ? items : []).filter(function (item) {
      var compact = compactRepeatText(item && item.content);
      return !compact || !previous.some(function (text) {
        return isHighlySimilarText(compact, text);
      });
    });
  }

  function compactRepeatText(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, "")
      .trim();
  }

  function isHighlySimilarText(a, b) {
    var first = String(a || "");
    var second = String(b || "");
    var shortLength = Math.min(first.length, second.length);
    var longLength = Math.max(first.length, second.length);
    var shared;

    if (!first || !second) {
      return false;
    }

    if (first === second) {
      return true;
    }

    if (shortLength >= 12 && (first.indexOf(second) !== -1 || second.indexOf(first) !== -1) && shortLength / longLength > 0.72) {
      return true;
    }

    shared = countSharedBigrams(first, second);
    return longLength >= 14 && shared / Math.max(1, Math.max(first.length, second.length) - 1) > 0.72;
  }

  function countSharedBigrams(a, b) {
    var first = {};
    var count = 0;
    var index;
    var token;

    for (index = 0; index < a.length - 1; index += 1) {
      first[a.slice(index, index + 2)] = true;
    }

    for (index = 0; index < b.length - 1; index += 1) {
      token = b.slice(index, index + 2);
      if (first[token]) {
        count += 1;
        delete first[token];
      }
    }

    return count;
  }

  function expandReplyListToMinimum(replies, settings) {
    return Array.isArray(replies) ? replies : [];
  }

  function countReplyItemsForMinimum(replies) {
    return (Array.isArray(replies) ? replies : []).filter(function (reply) {
      return reply && reply.content && (!reply.type || reply.type === "text" || reply.type === "speech");
    }).length;
  }

  function createFallbackReplyItems(settings, existingReplies, stats) {
    var missing = Math.max(0, (Number(settings.min) || 0) - countReplyItemsForMinimum(existingReplies));
    var profiles = getFallbackProfiles(settings);
    var items = [];
    var used = {};
    var index = 0;

    while (items.length < missing && items.length + (Array.isArray(existingReplies) ? existingReplies.length : 0) < settings.max) {
      var profile = profiles[index % profiles.length] || {};
      var line = pickFallbackLine(profile, index, used, buildFallbackContextFlags(profile, settings.worldBookContext || ""), getFallbackRhythmPhase(index));
      var reply = {
        type: "text",
        content: line
      };

      if (profile.id) {
        reply.characterId = profile.id;
      }

      items.push(reply);
      recordReplyTextureStat(stats || settings.replyTextureStats, "fallbackAdded", "minimum");
      index += 1;
    }

    return items;
  }

  function pickFallbackProfileForReply(profiles, reply, index) {
    var list = Array.isArray(profiles) ? profiles : [];
    var characterId = reply && reply.characterId ? String(reply.characterId) : "";
    var matched;

    if (!list.length) {
      return {};
    }

    if (characterId) {
      matched = list.filter(function (profile) {
        return profile && String(profile.id || "") === characterId;
      })[0];
      if (matched) {
        return matched;
      }
    }

    return list[index % list.length] || {};
  }

  function getFallbackProfiles(settings) {
    var profiles = Array.isArray(settings.fallbackProfiles) ? settings.fallbackProfiles.filter(Boolean) : [];
    if (!profiles.length && settings.fallbackProfile) {
      profiles = [settings.fallbackProfile];
    }
    if (!profiles.length) {
      profiles = [{ name: "", persona: "", currentMood: "" }];
    }
    return profiles.map(function (profile) {
      var enriched = Object.assign({}, profile, {
        latestUserInput: settings.latestUserInput || profile.latestUserInput || "",
        previousReplyText: settings.previousReplyText || settings.lastAssistantText || profile.previousReplyText || "",
        rejectedReplyText: settings.rejectedReplyText || settings.oldReplyText || profile.rejectedReplyText || "",
        worldBookContext: settings.worldBookContext || profile.worldBookContext || "",
        recentHeartVoiceText: settings.recentHeartVoiceText || profile.recentHeartVoiceText || "",
        thoughtsHint: settings.thoughtsHint || settings.recentHeartVoiceText || profile.thoughtsHint || profile.recentHeartVoiceText || ""
      });
      enriched.voiceProfile = profile.voiceProfile || detectPersonaVoiceProfile(enriched, enriched.latestUserInput || "");
      enriched.voiceTags = Array.isArray(enriched.voiceTags) && enriched.voiceTags.length
        ? enriched.voiceTags
        : enriched.voiceProfile.tags;
      enriched.scoredTags = Array.isArray(enriched.scoredTags) && enriched.scoredTags.length
        ? enriched.scoredTags
        : enriched.voiceProfile.scoredTags;
      enriched.evidenceText = enriched.evidenceText || enriched.voiceProfile.evidenceText || "";
      enriched.personaEvidence = Array.isArray(enriched.personaEvidence) && enriched.personaEvidence.length
        ? enriched.personaEvidence
        : extractPersonaEvidence(enriched);
      enriched.voiceProfile = detectPersonaVoiceProfile(enriched, [
        enriched.latestUserInput,
        enriched.previousReplyText,
        enriched.rejectedReplyText,
        enriched.recentHeartVoiceText,
        enriched.thoughtsHint,
        enriched.worldBookContext
      ].join("\n"));
      enriched.voiceTags = enriched.voiceProfile.tags;
      enriched.scoredTags = enriched.voiceProfile.scoredTags;
      enriched.evidenceText = enriched.voiceProfile.evidenceText || enriched.evidenceText || "";
      enriched.voiceFingerprintText = enriched.voiceFingerprintText || buildPersonaVoiceFingerprint(enriched, null, "fallback", enriched.worldBookContext);
      return enriched;
    });
  }

  function getFallbackRhythmPhase(index) {
    var position = index % 10;
    if (position < 2) {
      return "instant";
    }
    if (position < 5) {
      return "attitude";
    }
    if (position < 8) {
      return "progression";
    }
    return "hook";
  }

  function pickFallbackLine(profile, index, used, contextFlags, phase) {
    var flags = contextFlags || buildFallbackContextFlags(profile, "");
    var voiceProfile = profile && profile.voiceProfile || detectPersonaVoiceProfile(profile || {});
    var tags = voiceProfile.tags || [];
    var primaryTag = voiceProfile.primaryTag || tags[0] || getFallbackStyleBucket(profile || {}, flags);
    var line = buildPersonaAwareFallbackLine(profile, index, flags, phase || getFallbackRhythmPhase(index));
    var shortLine;
    var guard = 0;

    while (isFallbackLineBlocked(line, profile, used) && guard < 24) {
      guard += 1;
      line = buildPersonaAwareFallbackLine(profile, index + guard, flags, phase || getFallbackRhythmPhase(index + guard));
    }

    if (isFallbackLineBlocked(line, profile, used)) {
      shortLine = getShortestPersonaFallbackLine(primaryTag);
      if (!isFallbackLineBlocked(shortLine, profile, used)) {
        line = shortLine;
      } else if (guard >= 20) {
        line = "这句先别翻过去。";
      }
    }

    if (isGenericAiTemplateText(line)) {
      line = getShortestPersonaFallbackLine(primaryTag);
    }

    used[line] = true;
    return line;
  }

  function isFallbackLineBlocked(line, profile, used) {
    var compact = compactRepeatText(line);
    var previous = [
      profile && profile.previousReplyText,
      profile && profile.rejectedReplyText
    ].map(compactRepeatText).filter(Boolean);

    return !line
      || used && used[line]
      || isGenericAiTemplateText(line)
      || previous.some(function (text) {
        return compact && (isHighlySimilarText(compact, text)
          || compact.length >= 6 && (text.indexOf(compact) !== -1 || compact.indexOf(text) !== -1));
      });
  }

  function analyzeFallbackUserInput(text) {
    var raw = String(text || "").trim();
    var compact = raw.replace(/\s+/g, "");
    var normalized = compact.replace(/[，。！？、,.!?；;：:"“”'‘’（）()【】\[\]<>《》]/g, "");

    return {
      raw: raw,
      compact: compact,
      isShort: compact.length <= 6,
      isFarewell: /晚安|先睡|睡了|走了|下了|不聊了|不说了|拜拜|再见|回头聊|先这样|撤了|溜了/.test(normalized),
      isNegation: /没事|没什么|不用|不用了|算了|算啦|随便|不想说|都行|无所谓|没关系|别问/.test(normalized),
      isDefiant: /顶嘴|不要你管|凭什么|我就要|你管我|关你什么事|少管我|别管我|别管|不听|就不|偏要|我乐意|走开|滚/.test(normalized),
      isSoft: /撒娇|委屈|害怕|好怕|疼|痛|累|困|难受|不舒服|撑不住|想你|想见|想抱|抱抱|靠近|想哭/.test(normalized),
      isQuestion: /[？?]$|吗$|呢$|么$|什么|怎么|为什么|为啥|谁|哪|能不能|可不可以|是不是|要不要|怎么办/.test(compact),
      isMoneyRelated: /红包|转账|钱|收款|退回|退款|付款|账单|金额|收下|拒收|退给|还钱|打钱|微信转账/.test(normalized),
      keywords: extractFallbackUserKeywords(normalized, raw)
    };
  }

  function extractFallbackUserKeywords(compact, raw) {
    var value = String(compact || raw || "");
    var cleaned;
    var keywords = [];
    var priorityWords = [
      "不要你管", "凭什么", "我就要", "你管我", "不想说", "不聊了", "世界书", "微信转账",
      "晚安", "没事", "不要管", "别管我", "别管", "不要", "不用", "算了", "随便", "想你", "想见", "抱抱", "害怕",
      "委屈", "红包", "转账", "退回", "收款", "拒收", "还钱", "拉黑", "记忆", "疼", "痛", "累", "困", "钱"
    ];
    var stopWords = getFallbackKeywordStopWords();
    var pushKeyword = function (word) {
      var item = normalizeFallbackKeyword(word);
      if (!item || item.length > 8) {
        return;
      }
      if (stopWords[item]) {
        return;
      }
      if (keywords.some(function (keyword) {
        return keyword === item || keyword.indexOf(item) !== -1 || item.indexOf(keyword) !== -1;
      })) {
        return;
      }
      keywords.push(item);
    };

    priorityWords.forEach(function (word) {
      if (value.indexOf(word) !== -1) {
        pushKeyword(word);
      }
    });

    if (keywords.length >= 3) {
      return keywords.slice(0, 3);
    }

    cleaned = value
      .replace(/[啊呀呢吧哦嗯嘛哈啦呗喔额呃哎]/g, "")
      .replace(/好/g, "")
      .replace(/就是|那个/g, "")
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, " ");

    cleaned.split(/\s+/).forEach(function (part) {
      var matches;
      if (keywords.length >= 3 || !part || stopWords[part]) {
        return;
      }
      matches = part.match(/[\u4e00-\u9fa5]{2,8}|[a-zA-Z0-9]{2,16}/g) || [];
      matches.forEach(function (match) {
        if (keywords.length < 3 && !stopWords[match]) {
          pushKeyword(match);
        }
      });
    });

    return keywords.slice(0, 3);
  }

  function getFallbackInputQuoteWord(inputInfo) {
    var info = inputInfo || {};
    var compact = String(info.compact || "");
    var words = Array.isArray(info.keywords) ? info.keywords : [];
    var index;
    var word;

    if (info.isShort && compact.length <= 1) {
      return "";
    }

    for (index = 0; index < words.length; index += 1) {
      word = String(words[index] || "").trim();
      if (!word || word.length > 8) {
        continue;
      }
      if (compact === word && word.length > 4) {
        continue;
      }
      return word;
    }

    return "";
  }

  function getShortestPersonaFallbackLine(primaryTag) {
    var byTag = {
      worldControl: "停。",
      worldForbidden: "收住。",
      cold: "嗯。",
      strong: "过来。",
      tsundere: "啧。",
      clingy: "别走。",
      gentle: "先别撑。",
      obsessive: "我看着呢。",
      playful: "哟。",
      formal: "坐好。",
      hostile: "少来。",
      shy: "……别这样。",
      default: "等一下。"
    };

    return byTag[primaryTag] || byTag.default;
  }

  function pickFallbackPhaseLines(lines, rhythmPhase) {
    var list = Array.isArray(lines) ? lines : [];
    var phase = rhythmPhase || "instant";

    if (phase === "instant") {
      return list.slice(0, 2);
    }
    if (phase === "attitude") {
      return list.slice(2, 5);
    }
    if (phase === "progression") {
      return list.slice(5, 8);
    }
    return list.slice(8, 10);
  }

  function buildPersonaAwareFallbackLine(profile, index, contextFlags, phase) {
    var source = profile || {};
    var flags = contextFlags || buildFallbackContextFlags(source, "");
    var voiceProfile = source.voiceProfile || detectPersonaVoiceProfile(source);
    var tags = voiceProfile.tags || [];
    var primaryTag = voiceProfile.primaryTag || tags[0] || getFallbackStyleBucket(source, flags);
    var inputInfo = analyzeFallbackUserInput(source.latestUserInput || "");
    var candidates = buildFallbackCandidatesByInput(source, inputInfo, tags, phase || getFallbackRhythmPhase(index), flags, index);

    if (!candidates.length) {
      candidates = getFallbackLines(primaryTag || "default", source, flags);
    }

    return candidates[index % candidates.length] || getShortestPersonaFallbackLine(primaryTag);
  }

  function buildFallbackCandidatesByInput(profile, inputInfo, tags, phase, flags, index) {
    var source = profile || {};
    var voiceProfile = source.voiceProfile || detectPersonaVoiceProfile(source);
    var activeTags = Array.isArray(tags) && tags.length ? tags : (voiceProfile.tags || []);
    var primaryTag = voiceProfile.primaryTag || activeTags[0] || getFallbackStyleBucket(source, flags);
    var rhythmPhase = phase || "instant";
    var inputCandidates = buildFallbackInputTypeCandidates(source, inputInfo, activeTags, primaryTag, rhythmPhase, flags);
    var tagCandidates = buildFallbackTagCandidates(source, activeTags, primaryTag, rhythmPhase, flags);
    var evidenceCandidates = buildFallbackEvidenceCandidates(source, rhythmPhase, flags);
    var legacyCandidates = buildPersonaAwareFallbackCandidates(source, activeTags, primaryTag, flags, rhythmPhase, index);
    var defaultCandidates = pickFallbackPhaseLines(getFallbackLines("default", source, flags), rhythmPhase);

    return uniqueList([]
      .concat(inputCandidates)
      .concat(tagCandidates)
      .concat(evidenceCandidates)
      .concat(legacyCandidates)
      .concat(defaultCandidates))
      .filter(function (line) {
        return line && !isGenericAiTemplateText(line);
      });
  }

  function buildFallbackTagCandidates(profile, tags, primaryTag, phase, flags) {
    var source = profile || {};
    var activeTags = uniqueList([primaryTag].concat(Array.isArray(tags) ? tags : [])).filter(Boolean);
    var candidates = [];

    activeTags.slice(0, 4).forEach(function (tag) {
      candidates = candidates.concat(pickFallbackPhaseLines(getFallbackLines(tag, source, flags), phase));
    });

    return candidates;
  }

  function hasDirectiveFallbackTag(primaryTag, tags) {
    return uniqueList([primaryTag].concat(Array.isArray(tags) ? tags.slice(0, 4) : [])).some(function (tag) {
      return /^(?:strong|formal|hostile|obsessive)$/.test(tag);
    });
  }

  function buildFallbackEvidenceCandidates(profile, phase, flags) {
    var source = profile || {};
    var voiceProfile = source.voiceProfile || detectPersonaVoiceProfile(source);
    var activeTags = voiceProfile.tags || [];
    var primaryTag = voiceProfile.primaryTag || activeTags[0] || getFallbackStyleBucket(source, flags);
    var allowDirectiveLines = hasDirectiveFallbackTag(primaryTag, activeTags);
    var evidenceText = (Array.isArray(source.personaEvidence) ? source.personaEvidence : []).join("\n");
    var previousText = [source.previousReplyText, source.rejectedReplyText, source.thoughtsHint, source.recentHeartVoiceText].filter(Boolean).join("\n");
    var candidates = [];

    if (allowDirectiveLines && /老师|上司|年长|监护|前辈|师长|管教/.test(evidenceText)) {
      candidates = candidates.concat(["先按我的规矩来。", "把话说完整。", "这句不能随便带过。", "分寸先摆正。", "看着我说。", "按节奏来。", "别急着躲。", "这件事我会处理。", "先到这里。", "回头再算。"]);
    } else if (allowDirectiveLines && /强势|命令|控制|掌控|支配|压制/.test(evidenceText)) {
      candidates = candidates.concat(["先停。", "按我说的来。", "这句不算。", "我来判断。", "别让我问第二遍。", "过来。", "把话说清楚。", "别躲。", "到这儿，听我的。", "这事我先压住。"]);
    } else if (/冷淡|疏离|淡漠|寡言|克制/.test(evidenceText)) {
      candidates = candidates.concat(["嗯。", "别绕。", "不像。", "我听见了。", "说重点。", "继续。", "别装。", "这句留着。", "到这儿。", "先别翻篇。"]);
    } else if (/嘴硬|傲娇|别扭|不坦率/.test(evidenceText)) {
      candidates = candidates.concat(["啧。", "别误会。", "谁问你了。", "我只是顺口。", "烦死了。", "那你倒是说啊。", "别又躲。", "我没说不管。", "算了，先这样。", "这事我记着。"]);
    } else if (/黏人|依赖|撒娇|缺安全感/.test(evidenceText)) {
      candidates = candidates.concat(["别走。", "再回我一句。", "你又想躲。", "别把我晾着。", "我在等。", "再说一点。", "别推开我。", "你先看我。", "我还没放你走。", "别敷衍我。"]);
    }

    if (/吃醋|占有|盯|别人|那个人/.test(previousText)) {
      candidates = candidates.concat(["那个人先放一边。", "你先回我。", "别拿别人挡着。", "我听见你提到谁了。"]);
    }
    if (/心软|担心|在意|靠近/.test(previousText)) {
      candidates = candidates.concat(["先把话说稳。", "我听着。", "别急着躲。", "这句我放在心上。"]);
    }
    if (flags && flags.wantsSuppress) {
      candidates = candidates.concat(["先停。", "我来压住这件事。"]);
    }
    if (flags && flags.wantsAway) {
      candidates = candidates.concat(["到这儿。", "别再往前推。"]);
    }

    return pickFallbackPhaseLines(uniqueList(candidates), phase);
  }

  function buildFallbackInputTypeCandidates(profile, inputInfo, tags, primaryTag, phase, flags) {
    var source = profile || {};
    var info = inputInfo || analyzeFallbackUserInput(source.latestUserInput || "");
    var activeTags = uniqueList([primaryTag].concat(Array.isArray(tags) ? tags : [])).filter(Boolean);
    var intents = [];
    var candidates = [];

    if (info.isFarewell) {
      intents.push("farewell");
    }
    if (info.isDefiant) {
      intents.push("defiant");
    }
    if (info.isNegation && !info.isDefiant) {
      intents.push("negation");
    }
    if (info.isSoft) {
      intents.push("soft");
    }
    if (info.isMoneyRelated) {
      intents.push("money");
    }
    if (info.isQuestion) {
      intents.push("question");
    }
    if (!intents.length && info.compact) {
      intents.push("generic");
    }

    if (info.isNegation && hasColdTsundereFallbackTags(primaryTag, activeTags)) {
      candidates = candidates.concat(getColdTsundereNegationFallbackLines(phase));
    }

    intents.forEach(function (intent) {
      activeTags.slice(0, 4).forEach(function (tag) {
        candidates = candidates.concat(getFallbackInputPhaseLines(intent, tag, info, phase, flags));
      });
      candidates = candidates.concat(getFallbackInputPhaseLines(intent, "default", info, phase, flags));
    });

    return uniqueList(candidates);
  }

  function hasColdTsundereFallbackTags(primaryTag, tags) {
    var activeTags = uniqueList([primaryTag].concat(Array.isArray(tags) ? tags : [])).filter(Boolean);
    return activeTags.indexOf("cold") !== -1 && activeTags.indexOf("tsundere") !== -1;
  }

  function getColdTsundereNegationFallbackLines(phase) {
    var bank = {
      instant: ["谁问你有没有事了。", "嗯，随你。"],
      attitude: ["别拿这句糊弄我。", "行，那就当你没事。"],
      progression: ["你最好真没事。", "……嘴硬。"],
      hook: ["我没说信你。", "那就这样。"]
    };
    return bank[phase] || bank.instant;
  }

  function getFallbackInputPhaseLines(intent, tag, inputInfo, phase, flags) {
    var quote = getFallbackInputQuoteWord(inputInfo);
    var q = quote || "";
    var quoted = q ? "“" + q + "”" : "";
    var byIntent = buildFallbackInputPhaseBank(q, quoted);
    var bank = byIntent[intent] || byIntent.generic;
    var tagLines = bank[tag] || bank.default || {};
    var lines = tagLines[phase] || tagLines.instant || [];

    return Array.isArray(lines) ? lines : [];
  }

  function buildFallbackInputPhaseBank(q, quoted) {
    var heard = quoted ? quoted + "这句，我听见了。" : "你刚才那句，我听见了。";
    var askClear = quoted ? "先把" + quoted + "说清楚。" : "先把刚才那句说清楚。";

    return {
      farewell: {
        cold: {
          instant: ["嗯。", "要睡就睡。"],
          attitude: ["别拿晚安当收尾。", "今天到这儿。"],
          progression: ["明天再说。", "别半夜又翻回来。"],
          hook: ["灯关了。", "醒了再回。"]
        },
        strong: {
          instant: ["先别睡。", "站住。"],
          attitude: ["先把话说完再睡。", "晚安不算结束。"],
          progression: ["明天醒了先回我。", "这事我先记着。"],
          hook: ["到这儿，听我的。", "别让我明天再问。"]
        },
        tsundere: {
          instant: ["睡就睡。", "跟我报备什么。"],
          attitude: ["谁拦你了。", "烦死了，快睡。"],
          progression: ["明天别又装忘。", "我可没说在等你。"],
          hook: ["晚安就晚安。", "……别熬。"]
        },
        clingy: {
          instant: ["这么快就要走？", "别走。"],
          attitude: ["再回我一句嘛。", "你又把我晾下。"],
          progression: ["睡前再说一句。", "明天醒了要先找我。"],
          hook: ["我还在等。", "不许悄悄没影。"]
        },
        gentle: {
          instant: ["晚安，别再熬了。", "嗯，去睡。"],
          attitude: ["今天先放过你。", "别硬撑到很晚。"],
          progression: ["明天醒了再慢慢说。", "灯关好。"],
          hook: ["做个安稳点的梦。", "醒了我再听。"]
        },
        obsessive: {
          instant: ["走得这么急？", "我还没放你走。"],
          attitude: ["你越急着晚安，我越会记着。", "刚才那句没完。"],
          progression: ["明天先回我。", "别让我自己猜一晚上。"],
          hook: ["我看着时间。", "你躲不过明天。"]
        },
        playful: {
          instant: ["哟，这就撤了？", "跑这么快啊。"],
          attitude: ["晚安也说得像逃跑。", "行，暂时放你一马。"],
          progression: ["明天继续审你。", "欠我的那句先记账。"],
          hook: ["睡吧，小胆子。", "别梦里也编。"]
        },
        formal: {
          instant: ["先到这里。", "可以休息。"],
          attitude: ["睡前把情绪放稳。", "今天不继续逼你。"],
          progression: ["明天再按顺序说。", "这件事先记下。"],
          hook: ["关灯。", "醒了再处理。"]
        },
        hostile: {
          instant: ["随你。", "要走就走。"],
          attitude: ["别把晚安说得像赢了。", "这不算翻篇。"],
          progression: ["账先留着。", "明天你最好还记得。"],
          hook: ["滚去睡。", "别半夜回来装没事。"]
        },
        shy: {
          instant: ["……晚安。", "嗯，睡吧。"],
          attitude: ["我、我没拦你。", "别熬太晚。"],
          progression: ["明天再说也行。", "我会记得的。"],
          hook: ["……别做噩梦。", "醒了再回我。"]
        },
        default: {
          instant: ["晚安。", "先睡吧。"],
          attitude: ["这句先收着。", "今天到这里也行。"],
          progression: ["明天再接着说。", "别把刚才那句丢了。"],
          hook: ["醒了再说。", "别熬。"]
        }
        },
        negation: {
          cold: {
          instant: ["是吗？", "随你。"],
          attitude: [q ? "别拿" + quoted + "糊弄我。" : "别拿这句糊弄我。", "那就这样。"],
          progression: ["你最好是。", "继续。"],
          hook: ["我没说信你。", "先别翻篇。"]
        },
        strong: {
          instant: ["这句不算。", "抬头。"],
          attitude: ["看着我说。", q ? "别用" + quoted + "挡我。" : "别用这句挡我。"],
          progression: ["先坐下，把话说清楚。", "我来判断。"],
          hook: ["别让我问第二遍。", "到这儿，听我的。"]
        },
        tsundere: {
          instant: ["谁问你了。", "啧。"],
          attitude: ["我又没说担心你。", "你爱说不说。"],
          progression: ["那你倒是别躲。", "说完再装。"],
          hook: ["算了，先听你的。", "我先记着。"]
        },
        clingy: {
          instant: ["你又这样。", "别敷衍我。"],
          attitude: [q ? "别用" + quoted + "把我晾过去。" : "别把我晾过去。", "你越这样我越慌。"],
          progression: ["再回我一句。", "不许躲。"],
          hook: ["我还在等。", "别走。"]
        },
        gentle: {
          instant: ["那就先坐下。", "别硬撑。"],
          attitude: [q ? "我听见你说" + quoted + "了。" : "我听见了。", "先别急着证明。"],
          progression: ["把气放下来一点。", "慢慢说也行。"],
          hook: ["我在这儿。", "先别撑。"]
        },
        obsessive: {
          instant: ["你刚才停顿了。", "我听见了。"],
          attitude: [q ? "你拿" + quoted + "挡我。" : "你在挡我。", "你躲得太快了。"],
          progression: ["看着我说。", "现在回我。"],
          hook: ["我会盯着。", "别让我猜。"]
        },
        playful: {
          instant: ["我差点就信了。", "哟。"],
          attitude: [q ? quoted + "说得挺顺。" : "说得挺顺。", "破绽也挺明显。"],
          progression: ["来，再说一遍。", "别急着跑。"],
          hook: ["这句我记下了。", "继续编。"]
        },
        formal: {
          instant: ["先别用这句收尾。", "坐好。"],
          attitude: [q ? quoted + "不能当结论。" : "这句不能当结论。", "把话说完整。"],
          progression: ["按顺序说。", "先别自己扛。"],
          hook: ["我会记着。", "回头再算。"]
        },
        hostile: {
          instant: ["少来。", "我不信。"],
          attitude: [q ? "别拿" + quoted + "糊弄我。" : "别拿这套糊弄我。", "你以为我听不出来？"],
          progression: ["说清楚。", "继续装也行。"],
          hook: ["这笔账先记着。", "别急着洗干净。"]
        },
        shy: {
          instant: ["……我不太信。", "你别这样。"],
          attitude: [q ? "你说" + quoted + "的时候，不像。" : "你刚才不像。", "我听见了。"],
          progression: ["再给我一下。", "你小声说也行。"],
          hook: ["我会等。", "先别走。"]
        },
        default: {
          instant: [q ? "你这叫" + q + "？" : "等一下。", heard],
          attitude: [q ? "别拿" + quoted + "收尾。" : "别急着收尾。", "这不像能随便翻过去。"],
          progression: ["继续说。", "先别躲。"],
          hook: ["这句留着。", "我听着。"]
        }
      },
      defiant: {
        cold: {
          instant: ["那你最好真能自己收拾好。", "随你。"],
          attitude: [q ? quoted + "？行。" : "行。", "别回头又乱。"],
          progression: ["自己说清楚。", "别把烂摊子推回来。"],
          hook: ["我看着。", "到时候别躲。"]
        },
        strong: {
          instant: ["这句不算。", "过来。"],
          attitude: ["顶嘴留到后面。", "我没问你愿不愿意。"],
          progression: ["按我说的来。", "先把脾气收回去。"],
          hook: ["别让我说第二遍。", "站那儿别动。"]
        },
        tsundere: {
          instant: ["谁稀罕管你。", "啧。"],
          attitude: [q ? quoted + "说得真顺。" : "说得真顺。", "我只是看不下去。"],
          progression: ["那你倒是别乱来。", "别让我抓到。"],
          hook: ["烦死了。", "下次别找我。"]
        },
        clingy: {
          instant: ["你就非要推开我吗。", "别这样。"],
          attitude: [q ? "你说" + quoted + "的时候最像在躲。" : "你就是在躲。", "我不喜欢。"],
          progression: ["你先回我。", "别拿脾气隔开我。"],
          hook: ["我还在这儿。", "你别走。"]
        },
        gentle: {
          instant: ["先别把话说这么满。", "我听见了。"],
          attitude: ["你可以生气，但别伤自己。", q ? quoted + "先放一放。" : "这句先放一放。"],
          progression: ["把气放下来再说。", "我不急着压你。"],
          hook: ["我还在听。", "别硬撑。"]
        },
        obsessive: {
          instant: ["你越这么说，我越要管。", "别躲。"],
          attitude: [q ? quoted + "只会让我更在意。" : "这只会让我更在意。", "你推不开我。"],
          progression: ["现在看着我。", "先回我。"],
          hook: ["我盯着呢。", "别让我猜。"]
        },
        playful: {
          instant: ["胆子见长啊。", "哟。"],
          attitude: [q ? quoted + "，说得挺横。" : "说得挺横。", "我差点鼓掌。"],
          progression: ["来，再顶一句试试。", "别急着跑。"],
          hook: ["这账我爱记。", "继续。"]
        },
        formal: {
          instant: ["情绪先放下。", "坐好。"],
          attitude: [q ? quoted + "不是解决办法。" : "顶回去不是解决办法。", "把话说清楚。"],
          progression: ["按顺序来。", "先听我说完。"],
          hook: ["这件事我会记着。", "回头处理。"]
        },
        hostile: {
          instant: ["我本来也没打算信你。", "少来。"],
          attitude: [q ? quoted + "？你试试。" : "你试试。", "别把自己说得多硬。"],
          progression: ["继续顶。", "我看你能撑到哪儿。"],
          hook: ["账先记着。", "别后悔。"]
        },
        shy: {
          instant: ["……你别这么说。", "我没想逼你。"],
          attitude: [q ? quoted + "听起来有点凶。" : "你这样有点凶。", "我会乱。"],
          progression: ["你先别走。", "再给我一句。"],
          hook: ["我还在。", "别这样。"]
        },
        default: {
          instant: ["这句不算。", "等一下。"],
          attitude: [q ? quoted + "先收回去。" : "脾气先收回去。", "别急着顶。"],
          progression: ["把话说清楚。", "先别躲。"],
          hook: ["我听着。", "这句留着。"]
        }
      },
      soft: {
        cold: {
          instant: ["那就别硬撑。", q ? q + "就说。" : "难受就说。"],
          attitude: ["别装得像没事。", "我听见了。"],
          progression: ["先坐下。", "把手放下。"],
          hook: ["到这儿。", "别再逞强。"]
        },
        strong: {
          instant: [q === "想你" || q === "抱抱" ? q + "就看着我说。" : (q ? q + "还逞什么强。" : "还逞什么强。"), "过来。"],
          attitude: ["先停。", "我来安排。"],
          progression: ["坐下，别乱动。", "听我的。"],
          hook: ["别让我问第二遍。", "先别撑。"]
        },
        tsundere: {
          instant: ["麻烦死了，过来。", "谁让你硬撑了。"],
          attitude: [q ? "我听见" + q + "了。" : "我听见了。", "别误会，我只是看不下去。"],
          progression: ["先坐着。", "别乱跑。"],
          hook: ["……下次早点说。", "烦。"]
        },
        clingy: {
          instant: [q === "想你" ? "想我就再说一遍。" : "你这样我会慌。", "别离我太远。"],
          attitude: [q ? quoted + "我听见了。" : "我听见了。", "你不能自己扛着。"],
          progression: ["靠近一点。", "回我一句。"],
          hook: ["我陪着。", "别躲我。"]
        },
        gentle: {
          instant: ["先靠一下。", q ? q + "就别忍着。" : "别忍着。"],
          attitude: ["我在。", "慢一点也没关系。"],
          progression: ["先坐稳。", "把气放下来。"],
          hook: ["别硬撑。", "我听着。"]
        },
        obsessive: {
          instant: [q ? "我听见你说" + q + "了。" : "我听见了。", "别藏。"],
          attitude: ["你刚才的声音不对。", "我会盯着。"],
          progression: ["现在看着我。", "别把我推开。"],
          hook: ["我看着呢。", "别让我猜。"]
        },
        playful: {
          instant: ["哟，会撒娇了。", q ? quoted + "这句有点犯规。" : "这句有点犯规。"],
          attitude: ["行，暂时不逗你。", "别装得太坚强。"],
          progression: ["过来一点。", "让我看看。"],
          hook: ["下次早点招。", "记你一笔。"]
        },
        formal: {
          instant: ["先坐下。", "我看着。"],
          attitude: [q ? quoted + "先别忍。" : "不舒服先别忍。", "别逞强。"],
          progression: ["按我说的休息。", "把呼吸放稳。"],
          hook: ["先别撑。", "之后再说。"]
        },
        hostile: {
          instant: ["现在知道疼了？", "少硬撑。"],
          attitude: [q ? quoted + "不是拿来逞强的。" : "别拿难受逞强。", "我不吃你这套。"],
          progression: ["坐下。", "说清楚哪儿不对。"],
          hook: ["别再给我装。", "账先记着。"]
        },
        shy: {
          instant: ["……我在。", "你别忍。"],
          attitude: [q ? "你说" + q + "的时候，我听见了。" : "我听见了。", "我有点担心。"],
          progression: ["我、我靠近一点。", "你先别动。"],
          hook: ["别硬撑。", "我会等。"]
        },
        default: {
          instant: [q ? q + "就说。" : "别硬撑。", "我听见了。"],
          attitude: ["先别自己扛。", "这句我接住了。"],
          progression: ["坐下慢慢说。", "把气放稳。"],
          hook: ["我在。", "先别撑。"]
        }
      },
      question: {
        cold: {
          instant: ["你真想问这个？", "短答：不一定。"],
          attitude: [q ? quoted + "先放着。" : "问题先放着。", "别绕到别处。"],
          progression: ["先说你的理由。", "我再答。"],
          hook: ["就这样。", "别追太快。"]
        },
        strong: {
          instant: ["你先回答我。", "别急着问。"],
          attitude: [askClear, "问题不是你拿来躲的。"],
          progression: ["把前一句补完。", "我再告诉你。"],
          hook: ["现在，先听我的。", "别抢节奏。"]
        },
        tsundere: {
          instant: ["问我干什么。", "你怎么突然问这个。"],
          attitude: ["别误会，我不是非要答。", "这问题烦人。"],
          progression: ["你先说为什么问。", "别装随口。"],
          hook: ["算了，回头说。", "我先记着。"]
        },
        clingy: {
          instant: ["你先告诉我为什么问。", "别只丢问题给我。"],
          attitude: [q ? quoted + "跟我有关吗？" : "跟我有关吗？", "你别躲我。"],
          progression: ["回我一句真的。", "我再答你。"],
          hook: ["我等着。", "不许跑。"]
        },
        gentle: {
          instant: ["我会说。", "你先别急。"],
          attitude: [q ? quoted + "可以慢慢问。" : "可以慢慢问。", "但别拿问题压自己。"],
          progression: ["先把你想知道的说清楚。", "我听完再答。"],
          hook: ["我在。", "慢慢来。"]
        },
        obsessive: {
          instant: ["你为什么突然问这个？", "谁让你想到这个。"],
          attitude: [q ? quoted + "不是随便冒出来的。" : "这不是随便冒出来的。", "我注意到了。"],
          progression: ["先告诉我原因。", "别让我猜。"],
          hook: ["我盯着呢。", "你绕不过去。"]
        },
        playful: {
          instant: ["这问题有点会挑时候。", "哟，问到这儿了。"],
          attitude: [q ? quoted + "挺有意思。" : "挺有意思。", "你先别装随口。"],
          progression: ["来，先交代为什么问。", "我再看答不答。"],
          hook: ["胆子见长。", "继续。"]
        },
        formal: {
          instant: ["先把问题说完整。", "我听着。"],
          attitude: [q ? quoted + "需要分开讲。" : "这个需要分开讲。", "别急。"],
          progression: ["按顺序来。", "先说背景。"],
          hook: ["我会答。", "但不是现在糊过去。"]
        },
        hostile: {
          instant: ["你套我话？", "问这个干什么。"],
          attitude: [q ? quoted + "听着就不单纯。" : "听着就不单纯。", "少装随口。"],
          progression: ["先说你的目的。", "别把自己摘干净。"],
          hook: ["我暂时不信。", "继续。"]
        },
        shy: {
          instant: ["……你怎么问这个。", "我不知道怎么说。"],
          attitude: [q ? quoted + "有点突然。" : "有点突然。", "你别盯着我。"],
          progression: ["你先说一点。", "我再想想。"],
          hook: ["等一下。", "我会回你的。"]
        },
        default: {
          instant: ["你问这个？", heard],
          attitude: [askClear, "别拿问题绕开刚才。"],
          progression: ["先说为什么问。", "我再答。"],
          hook: ["这问题先留着。", "我听着。"]
        }
      },
      money: {
        cold: {
          instant: ["钱的事，别绕。", q ? quoted + "我看见了。" : "我看见了。"],
          attitude: ["别拿钱当解释。", "账归账。"],
          progression: ["话说清楚再谈。", "别推来推去。"],
          hook: ["先放这儿。", "我会记着。"]
        },
        strong: {
          instant: ["收着，别推来推去。", "钱先放这儿。"],
          attitude: [q ? quoted + "不是让你躲话用的。" : "钱不是让你躲话用的。", "我来定。"],
          progression: ["先把话说清楚。", "该收该退我判断。"],
          hook: ["别让我说第二遍。", "账我会算。"]
        },
        tsundere: {
          instant: ["谁稀罕你这点钱。", "啧。"],
          attitude: [q ? quoted + "也别想堵我嘴。" : "别想堵我嘴。", "我又没缺这个。"],
          progression: ["先说正事。", "钱放一边。"],
          hook: ["烦死了。", "这账我先记着。"]
        },
        clingy: {
          instant: ["你别拿钱把我打发了。", q ? quoted + "我看见了。" : "我看见了。"],
          attitude: ["我要的是你回话。", "别想这样糊弄过去。"],
          progression: ["先回我。", "钱等会儿再说。"],
          hook: ["我还在等。", "别躲我。"]
        },
        gentle: {
          instant: ["钱先放一边。", "话先说清楚。"],
          attitude: [q ? quoted + "我看到了。" : "我看到了。", "别用这个压自己。"],
          progression: ["该怎么处理慢慢来。", "先别急着退。"],
          hook: ["我在听。", "别硬撑。"]
        },
        obsessive: {
          instant: ["别拿红包转移我。", q ? quoted + "我看见了。" : "我看见了。"],
          attitude: ["钱挡不住刚才那句。", "你越转开我越在意。"],
          progression: ["先回我。", "账之后再算。"],
          hook: ["我盯着呢。", "别想混过去。"]
        },
        playful: {
          instant: ["哟，拿红包堵我嘴？", "这招挺会。"],
          attitude: [q ? quoted + "挺热闹。" : "挺热闹。", "但破绽还在。"],
          progression: ["先交代正事。", "钱等会儿审。"],
          hook: ["这账我爱记。", "继续。"]
        },
        formal: {
          instant: ["账归账。", "话也要说清楚。"],
          attitude: [q ? quoted + "先记录着。" : "这笔先记录着。", "不要混成一件事。"],
          progression: ["按顺序处理。", "先讲清原因。"],
          hook: ["之后再算。", "先到这里。"]
        },
        hostile: {
          instant: ["少拿钱做样子。", "我不吃这套。"],
          attitude: [q ? quoted + "也洗不干净。" : "这也洗不干净。", "账不是这么算的。"],
          progression: ["说清楚。", "别把话题买走。"],
          hook: ["这笔账先记着。", "继续装。"]
        },
        shy: {
          instant: ["……这个我不能乱收。", q ? quoted + "我看见了。" : "我看见了。"],
          attitude: ["你别突然这样。", "我会慌。"],
          progression: ["先说为什么。", "我再决定。"],
          hook: ["等一下。", "别催我。"]
        },
        default: {
          instant: ["钱先放一边。", q ? quoted + "我看见了。" : "我看见了。"],
          attitude: ["别拿钱替话。", "账和人要分开。"],
          progression: ["先说清楚。", "之后再处理。"],
          hook: ["这笔先记着。", "我听着。"]
        }
      },
      generic: {
        cold: {
          instant: [heard, "嗯。"],
          attitude: [q ? quoted + "这句，留着。" : "这句留着。", "别绕。"],
          progression: ["继续。", "说重点。"],
          hook: ["到这儿。", "先别翻篇。"]
        },
        strong: {
          instant: [askClear, "看着我。"],
          attitude: ["这句别糊过去。", "我来判断。"],
          progression: ["按我说的来。", "先把话补完。"],
          hook: ["别让我问第二遍。", "到这儿，听我的。"]
        },
        tsundere: {
          instant: [q ? quoted + "？" : "啧。", "别误会。"],
          attitude: ["我只是顺口问。", "你刚才那样很明显。"],
          progression: ["那你倒是说啊。", "别又装没事。"],
          hook: ["算了，先听你的。", "这事我先记着。"]
        },
        clingy: {
          instant: ["你又这样。", "别把我晾在这儿。"],
          attitude: [q ? "刚才" + quoted + "不许跳过。" : "刚才那句不许跳过。", "你回我嘛。"],
          progression: ["再说一句。", "别躲我。"],
          hook: ["我还在等。", "别敷衍我。"]
        },
        gentle: {
          instant: [heard, "先看着我。"],
          attitude: ["这句我接住了。", "不用硬撑。"],
          progression: ["把气放下来一点。", "慢慢说。"],
          hook: ["我在听。", "说到这儿也行。"]
        },
        obsessive: {
          instant: [heard, "我注意到了。"],
          attitude: [q ? quoted + "别想糊弄过去。" : "别想糊弄过去。", "你躲得太快了。"],
          progression: ["现在回我。", "别让我猜。"],
          hook: ["我盯着呢。", "别拿别人挡。"]
        },
        playful: {
          instant: ["哟。", q ? quoted + "有点意思。" : "这句有点意思。"],
          attitude: ["我差点就信了。", "别装得那么无辜。"],
          progression: ["来，再说一遍。", "别急着跑。"],
          hook: ["我听着，你继续编。", "这反应挺明显的。"]
        },
        formal: {
          instant: [askClear, "坐好。"],
          attitude: ["把话说完整。", "这事先放稳。"],
          progression: ["按节奏来。", "不用逞强。"],
          hook: ["这句我会记着。", "抬眼，看着我说。"]
        },
        hostile: {
          instant: ["少来这套。", q ? quoted + "什么意思？" : "你这话什么意思？"],
          attitude: ["我不吃这一套。", "别试我。"],
          progression: ["说清楚。", "别把话说得那么干净。"],
          hook: ["继续装。", "这笔账先记着。"]
        },
        shy: {
          instant: ["……嗯。", heard],
          attitude: ["你别看我。", "我不是那个意思。"],
          progression: ["再给我一下。", "别催我。"],
          hook: ["我会回你的。", "你先别走。"]
        },
        default: {
          instant: [heard, "等一下。"],
          attitude: [q ? quoted + "这句不能空着。" : "这句不能空着。", "先别急着翻篇。"],
          progression: ["继续说。", "别把话藏一半。"],
          hook: ["这句留着。", "我听着。"]
        }
      }
    };
  }

  function buildPersonaAwareFallbackCandidates(profile, tags, primaryTag, flags, phase, index) {
    var source = profile || {};
    var activeTags = Array.isArray(tags) && tags.length ? tags : (primaryTag ? [primaryTag] : []);
    var latestInput = String(source.latestUserInput || "");
    var previousText = [source.previousReplyText, source.rejectedReplyText, source.thoughtsHint, source.recentHeartVoiceText].filter(Boolean).join("\n");
    var personaEvidence = Array.isArray(source.personaEvidence) ? source.personaEvidence : [];
    var rhythmPhase = phase || "instant";
    var candidateIndex = Number(index) || 0;
    var has = function (tag) { return activeTags.indexOf(tag) !== -1; };
    var allowDirectiveEvidence = hasDirectiveFallbackTag(primaryTag, activeTags);
    var pickPhaseLines = function (lines) {
      var list = Array.isArray(lines) ? lines : [];
      if (rhythmPhase === "instant") {
        return list.slice(0, 2);
      }
      if (rhythmPhase === "attitude") {
        return list.slice(2, 5);
      }
      if (rhythmPhase === "progression") {
        return list.slice(5, 8);
      }
      return list.slice(8, 10);
    };
    var phaseLines = {
      strong: ["先停。", "看着我。", "这句别糊过去。", "我来判断。", "按我说的来。", "先把话说清楚。", "不用躲。", "这件事我来定。", "别让我问第二遍。", "到这儿，听我的。"],
      cold: ["嗯。", "不像。", "说重点。", "别绕。", "我听见了。", "继续。", "别装没事。", "这句留着。", "到这儿就够了。", "先别翻篇。"],
      tsundere: ["谁担心你了。", "别误会。", "我只是顺口问。", "你刚才那样很明显。", "烦死了。", "那你倒是说啊。", "我没生气。", "别又装没事。", "算了，先听你的。", "这事我先记着。"],
      clingy: ["你又这样。", "别把我晾在这儿。", "再多说一点。", "刚才那句不许跳过。", "你回我嘛。", "我有点在意。", "别躲我。", "再说一句。", "我还在等。", "你别敷衍我。"],
      gentle: ["先看着我。", "别把自己绷太紧。", "这句我接住了。", "不用硬撑。", "我在听。", "把气放下来一点。", "先坐稳。", "别急着躲开。", "这事我会放在心上。", "说到这儿也行。"],
      obsessive: ["你刚才提到谁？", "别拿别人挡在中间。", "我注意到那句了。", "你别想糊弄过去。", "看着我说。", "我不喜欢你这样躲。", "那个人先放一边。", "你现在回我。", "别让我猜。", "我盯着呢。"],
      playful: ["哟，还会躲啊。", "这句有点意思。", "别装得那么无辜。", "我差点就信了。", "来，再说一遍。", "你这话我可记下了。", "别急着跑。", "行啊，胆子见长。", "我听着，你继续编。", "这反应挺明显的。"],
      formal: ["先别急。", "把话说完整。", "我听着。", "这事先放稳。", "别自己扛着。", "按节奏来。", "先坐下。", "不用逞强。", "这句我会记着。", "抬眼，看着我说。"],
      hostile: ["少来这套。", "你这话什么意思？", "别试我。", "我不吃这一套。", "说清楚。", "你以为我听不出来？", "别把话说得那么干净。", "我暂时信不了你。", "继续装。", "这笔账先记着。"],
      shy: ["……嗯。", "我听见了。", "你别看我。", "我不是那个意思。", "你刚才那句……算了。", "我有点乱。", "别催我。", "再给我一下。", "我会回你的。", "你先别走。"],
      default: ["等一下。", "这话不像随便说的。", "先别急着翻篇。", "先别跳过刚才那句。", "别把话藏一半。", "继续说。", "这句留着。", "我听着。", "先说到这儿。", "别跳过刚才那句。"]
    };
    var comboLines = [];
    var contextLines = [];
    var evidenceLines = [];
    var candidates = [];

    if (has("strong") && has("tsundere") && has("formal")) {
      comboLines = ["先别急着说没事。", "看着我。", "我不是在问你愿不愿意。", "把话说清楚，别又糊过去。", "算了，我只是顺手管一下。", "站稳，按我说的来。", "你那点逞强，我看得出来。", "别误会，我没心疼你。", "这件事到我这里先停。", "下次再这么说，先过我这一关。"];
    } else if (has("strong") && has("tsundere")) {
      comboLines = ["先停，别嘴硬。", "我就问这一句。", "过来，把话说清楚。", "别误会，我只是看不下去。", "你那点逞强收一收。", "按我说的来，少顶嘴。", "我没担心你。", "但你也别想糊弄过去。", "这事我先替你压住。", "下次别让我抓到。"];
    } else if (has("strong") && has("formal")) {
      comboLines = ["先停。", "按节奏来。", "这件事我来判断。", "把话说完整。", "别急着自己扛。", "先坐下，看着我。", "我会安排，但你要配合。", "逞强到这里为止。", "这句我记下了。", "回头我再和你算。"];
    } else if (has("cold") && has("obsessive")) {
      comboLines = ["不像。", "你刚才那句，别收回去。", "提到谁了？", "别想混过去。", "我听见了。", "继续。", "少拿没事挡我。", "你躲得太快了。", "这事先放我这儿。", "我会盯着。"];
    } else if (has("gentle") && has("formal")) {
      comboLines = ["先坐稳。", "这事不用急着撑过去。", "我听你说完。", "把呼吸放慢一点。", "别自己硬扛。", "我会处理，但先按分寸来。", "这句我记着。", "先别躲开。", "到这里，先休息一下。", "之后再慢慢算清楚。"];
    } else if (has("playful") && has("hostile")) {
      comboLines = ["哟，说得真干净。", "别急着装无辜。", "我差点就信了。", "这话留着，我爱听破绽。", "继续编。", "你这反应挺有意思。", "少来这套。", "别把自己摘得太干净。", "这笔账我先记着。", "跑什么，我还没问完。"];
    } else if (has("shy") && has("clingy")) {
      comboLines = ["……你别走。", "我不是催你。", "就是再说一句。", "你刚才那样，我会乱想。", "别把我晾在这里。", "我、我听着。", "你小声说也行。", "别躲太远。", "我还在等你。", "算了，你先看我一下。"];
    }

    if (/没事|不用|算了|随便|都行|晚安|不说了/.test(latestInput)) {
      if (has("strong")) {
        contextLines.push("你说没事，我不一定信。");
      }
      if (has("cold")) {
        contextLines.push("不像。");
      }
      if (has("tsundere")) {
        contextLines.push("谁信你这个。");
      }
      if (has("clingy")) {
        contextLines.push("你又想把我晾过去。");
      }
      if (has("obsessive")) {
        contextLines.push("你躲得太快了。");
      }
      if (has("formal")) {
        contextLines.push("先别用这句收尾。");
      }
      if (has("shy")) {
        contextLines.push("……我不太信。");
      }
    }
    if (/累|困|疼|难受|撑不住|不舒服/.test(latestInput)) {
      if (has("strong")) {
        contextLines.push("累了还逞什么强。", "先停，别硬撑。");
      } else if (has("cold")) {
        contextLines.push("那就别硬撑。");
      } else if (has("gentle") || has("formal")) {
        contextLines.push("先别急着撑。", "把话说完，我听着。");
      } else if (has("clingy")) {
        contextLines.push("那你更不能不回我。");
      }
    }
    if (/想你|想见|想抱|想靠近/.test(latestInput)) {
      if (has("tsundere")) {
        contextLines.push("谁准你这么直说了。");
      } else if (has("cold")) {
        contextLines.push("这句我听见了。");
      } else if (has("clingy")) {
        contextLines.push("那你就别只说一句。");
      } else if (has("playful")) {
        contextLines.push("哟，这句我可记下了。");
      }
    }
    if (/对不起|抱歉|错了|我错/.test(latestInput)) {
      if (has("strong") || has("formal")) {
        contextLines.push("道歉先放一边，说清楚。");
      } else if (has("cold")) {
        contextLines.push("这句太轻了。");
      } else if (has("tsundere")) {
        contextLines.push("现在知道说这个了？");
      }
    }
    if (/烦|讨厌|不想理|别管|走开|滚/.test(latestInput)) {
      if (has("hostile") || has("playful")) {
        contextLines.push("脾气倒是不小。");
      } else if (has("strong")) {
        contextLines.push("闹够了再说。");
      } else if (has("clingy")) {
        contextLines.push("你又想推开我。");
      } else if (has("cold")) {
        contextLines.push("行，到这儿。");
      }
    }

    if (/生气|压着火|不爽|冷处理|克制/.test(previousText)) {
      if (has("cold")) {
        contextLines.push("我还没打算翻篇。");
      }
      if (has("strong")) {
        contextLines.push("刚才那笔先记着。");
      }
      if (has("tsundere")) {
        contextLines.push("我没说我消气了。");
      }
      if (has("formal")) {
        contextLines.push("这件事还没结束。");
      }
    }
    if (/吃醋|占有|盯|别人|那个人/.test(previousText)) {
      contextLines.push("那个人先放一边。", "你先回我。");
    }
    if (/心软|担心|在意|靠近/.test(previousText)) {
      if (has("tsundere")) {
        contextLines.push("我只是顺手问一句。");
      } else if (has("gentle") || has("formal")) {
        contextLines.push("先把话说稳。");
      } else if (has("clingy")) {
        contextLines.push("我就是有点在意。");
      }
    }

    if (flags.wantsAway) {
      contextLines.push("到这儿。", "别再往前推。");
    }
    if (flags.wantsSuppress) {
      contextLines.push("先停。", "我来压住这件事。");
    }
    if (flags.wantsProbe) {
      contextLines.push("你这句，像是在试我。", "再说一遍。");
    }
    if (flags.wantsHide) {
      contextLines.push("别问那么直。", "这句先放着。");
    }
    if (flags.isJealous) {
      contextLines.push("那个人先放一边。", "你先回我。");
    }

    if (personaEvidence.length && candidateIndex % 3 === 2) {
      var evidenceText = personaEvidence[0] || "";
      if (allowDirectiveEvidence && /老师|上司|年长|监护|前辈|师长|管教/.test(evidenceText)) {
        evidenceLines.push("先按我的规矩来。", "把话说完整。");
      } else if (allowDirectiveEvidence && /强势|命令|控制|掌控|支配|压制/.test(evidenceText)) {
        evidenceLines.push("按我说的来。", "别让我问第二遍。");
      } else if (/冷淡|疏离|淡漠|寡言|克制/.test(evidenceText)) {
        evidenceLines.push("嗯，别绕。", "我听见了。");
      } else if (/嘴硬|傲娇|别扭|不坦率/.test(evidenceText)) {
        evidenceLines.push("我没说不管你。", "别误会。");
      } else if (/黏人|依赖|撒娇|缺安全感/.test(evidenceText)) {
        evidenceLines.push("别把我晾在这儿。", "再回我一句。");
      } else {
        evidenceLines.push("这不像能随便翻过去的事。");
      }
    }

    candidates = candidates.concat(contextLines, evidenceLines, pickPhaseLines(comboLines), pickPhaseLines(phaseLines[primaryTag] || []));
    activeTags.slice(1, 4).forEach(function (tag) {
      candidates = candidates.concat(pickPhaseLines(phaseLines[tag] || []));
    });
    candidates = candidates.concat(pickPhaseLines(phaseLines.default));

    return uniqueList(candidates).filter(function (line) {
      return line && !isGenericAiTemplateText(line);
    });
  }

  function buildFallbackContextFlags(profile, worldBookContext) {
    var thoughtsHint = profile && (profile.thoughtsHint || profile.recentHeartVoiceText) || "";
    var text = [
      profile && profile.name,
      profile && profile.persona,
      profile && profile.currentMood,
      profile && profile.chatSettingsText,
      profile && profile.voiceFingerprintText,
      Array.isArray(profile && profile.voiceTags) ? profile.voiceTags.join(" ") : "",
      profile && profile.evidenceText,
      Array.isArray(profile && profile.personaEvidence) ? profile.personaEvidence.join(" ") : "",
      profile && profile.previousReplyText,
      profile && profile.rejectedReplyText,
      profile && profile.worldBookContext,
      profile && profile.latestUserInput,
      worldBookContext,
      thoughtsHint
    ].join("\n");
    var thoughts = String(thoughtsHint || "");

    return {
      hasWorldRules: !!String(worldBookContext || profile && profile.worldBookContext || "").trim(),
      isCold: /cold|indifferent|冷淡|寡言|克制|疏离|淡漠|高冷|少话|冷感/.test(text),
      isStrongRelation: /strong|dominant|强势|控制|上位|命令|管束|掌控|严厉|压制|支配|管教/.test(text),
      isControl: /控制|管束|掌控|命令|规训|支配|服从|压制|不许|必须/.test(text),
      isForbidden: /禁忌|禁止|不得|不能|不许|不可|隐瞒|隐藏|秘密|越界|违规|边界/.test(text),
      isUpperLower: /formal|主仆|主人|仆从|上下级|上司|下属|师徒|老师|学生|管教|服从|支配|臣|君|统治|命令|上位|下位|年长|前辈|师长/.test(text),
      isClingy: /clingy|黏人|粘人|依赖|撒娇|缠人|离不开|想贴|黏|粘/.test(text),
      isTsundere: /tsundere|傲娇|嘴硬|别扭|毒舌|口是心非|不承认/.test(text),
      isGentle: /gentle|温柔但克制|温柔|体贴|耐心|克制地关心/.test(text),
      isObsessive: /obsessive|偏执|占有欲|占有|病态|盯紧|不许别人|只能/.test(text),
      isPlayful: /playful|轻佻|爱逗|逗弄|玩笑|欠揍|调侃|嬉皮笑脸/.test(text),
      isFormal: /formal|年长|老师|上司|前辈|家长|监护|师长|敬语|礼貌|克制/.test(text),
      isHostile: /hostile|敌对|防备|戒备|讽刺|厌恶|不信任|挑衅|针锋相对/.test(text),
      isShy: /shy|害羞|内向|羞怯|胆怯|紧张|局促|不敢|怯/.test(text),
      wantsClose: /拉近|靠近|想见|想抱|黏|想他|想她|想你|心动|想要|不舍|靠过去/.test(thoughts),
      wantsAway: /拉远|拉开|疏远|不想理|烦|远点|滚|别靠近|冷处理|懒得理/.test(thoughts),
      wantsSuppress: /压住|压制|管住|训|教训|安排|让他听话|让她听话|让他低头|让她低头/.test(thoughts),
      wantsProbe: /试探|试一下|看反应|想知道|盯着|观察|留余地/.test(thoughts),
      wantsHide: /嘴硬|装没事|装作|不能说|不肯说|藏起来|不肯承认|端着|绷着|强忍|憋着/.test(thoughts),
      isJealous: /吃醋|不爽|占有|凭什么|偏心|那个人|和别人|另一个/.test(thoughts)
    };
  }

  function getFallbackStyleBucket(profile, contextFlags) {
    var flags = contextFlags || {};
    var text = [
      profile && profile.name,
      profile && profile.persona,
      profile && profile.currentMood,
      profile && profile.chatSettingsText,
      profile && profile.voiceFingerprintText,
      Array.isArray(profile && profile.voiceTags) ? profile.voiceTags.join(" ") : "",
      profile && profile.previousReplyText,
      profile && profile.latestUserInput
    ].join("\n");

    if (flags.hasWorldRules && (flags.wantsSuppress || flags.isUpperLower || flags.isControl || flags.isStrongRelation)) {
      return "worldControl";
    }
    if (flags.hasWorldRules && (flags.wantsHide || flags.isForbidden)) {
      return "worldForbidden";
    }
    if (hasPersonaVoiceTag(profile, "hostile")) {
      return "hostile";
    }
    if (hasPersonaVoiceTag(profile, "obsessive")) {
      return "obsessive";
    }
    if (hasPersonaVoiceTag(profile, "cold")) {
      return "cold";
    }
    if (hasPersonaVoiceTag(profile, "strong")) {
      return "strong";
    }
    if (hasPersonaVoiceTag(profile, "clingy")) {
      return "clingy";
    }
    if (hasPersonaVoiceTag(profile, "tsundere")) {
      return "tsundere";
    }
    if (hasPersonaVoiceTag(profile, "playful")) {
      return "playful";
    }
    if (hasPersonaVoiceTag(profile, "formal")) {
      return "formal";
    }
    if (hasPersonaVoiceTag(profile, "shy")) {
      return "shy";
    }
    if (hasPersonaVoiceTag(profile, "gentle")) {
      return "gentle";
    }
    if (hasPersonaVoiceTag(profile, "hostile") || flags.isHostile || /hostile|敌对|防备|戒备|讽刺|厌恶|不信任|挑衅|针锋相对/.test(text)) {
      return "hostile";
    }
    if (hasPersonaVoiceTag(profile, "obsessive") || flags.isObsessive || flags.isJealous || /obsessive|偏执|占有欲|占有|病态|盯紧|不许别人|只能/.test(text)) {
      return "obsessive";
    }
    if (hasPersonaVoiceTag(profile, "tsundere") && (flags.wantsHide || flags.isJealous)) {
      return "tsundere";
    }
    if (flags.wantsHide && (flags.isJealous || flags.isTsundere || /傲娇|嘴硬|别扭|毒舌/.test(text))) {
      return "tsundere";
    }
    if (hasPersonaVoiceTag(profile, "cold") || flags.wantsAway || flags.isCold || /冷淡|寡言|克制|疏离|淡漠|高冷/.test(text)) {
      return "cold";
    }
    if (hasPersonaVoiceTag(profile, "strong") || flags.wantsSuppress || flags.isStrongRelation || /强势|控制|上位|命令|管束|掌控|严厉/.test(text)) {
      return "strong";
    }
    if (hasPersonaVoiceTag(profile, "clingy") || flags.isClingy || flags.wantsClose || /黏|粘|撒娇|依赖|黏人/.test(text)) {
      return "clingy";
    }
    if (flags.wantsProbe || /试探|留白|观察|留余地/.test(text)) {
      return "tsundere";
    }
    if (hasPersonaVoiceTag(profile, "tsundere") || flags.isTsundere || /傲娇|嘴硬|别扭|毒舌/.test(text)) {
      return "tsundere";
    }
    if (hasPersonaVoiceTag(profile, "playful") || flags.isPlayful || /轻佻|爱逗|逗弄|玩笑|调侃/.test(text)) {
      return "playful";
    }
    if (hasPersonaVoiceTag(profile, "formal") || flags.isFormal || /年长|老师|上司|前辈|家长|监护|师长|敬语|礼貌/.test(text)) {
      return "formal";
    }
    if (hasPersonaVoiceTag(profile, "shy") || flags.isShy || /害羞|内向|羞怯|胆怯|紧张|局促|不敢|怯/.test(text)) {
      return "shy";
    }
    if (hasPersonaVoiceTag(profile, "gentle") || flags.isGentle || /温柔但克制|温柔|体贴|耐心/.test(text)) {
      return "gentle";
    }
    return "default";
  }

  function getFallbackLines(bucket, profile, contextFlags) {
    var personaText = [profile && profile.persona, profile && profile.currentMood].join("\n");
    var byBucket = {
      worldControl: ["先停。", "这不是你能越过去的线。", "按我说的来。", "别试探我的底线。", "你现在要做的是听话。", "把话收回去。", "我没准你这样问。", "站在那儿，别动。", "这件事我来定。", "看着我，再说一遍。"],
      worldForbidden: ["这话到这里。", "别碰那条线。", "换个问法。", "我不会答应你这个。", "有些事你不该问。", "别把我往那边逼。", "这句我当没听见。", "收住。", "我们不谈这个。", "你知道这不合适。"],
      cold: ["嗯。", "说重点。", "是吗？", "随你。", "那就这样。", "你最好是。", "我没说信你。", "继续。", "别绕。", "到这儿就够了。"],
      strong: ["先停。", "听我说。", "这件事别拖。", "按我说的来。", "先把话说清楚。", "不用躲。", "我来判断。", "你现在别乱想。", "把手头的事放一放。", "看着我回。"],
      clingy: ["你又这样。", "别把我晾在这儿。", "再多说一点。", "刚才那句不许跳过。", "你回我嘛。", "我有点在意。", "别躲我。", "再说一句。", "我还在等。", "你别敷衍我。"],
      tsundere: ["谁问你了。", "我又没说担心你。", "别误会。", "你爱说不说。", "行吧，我听着。", "谁稀罕管你。", "烦死了。", "那你倒是说啊。", "我没生气。", "算了，先听你的。"],
      gentle: ["先看着我。", "别把自己绷太紧。", "这句我接住了。", "不用硬撑。", "我在听。", "把气放下来一点。", "先坐稳。", "别急着躲开。", "这事我会放在心上。", "说到这儿也行。"],
      obsessive: ["你刚才提到谁？", "别拿别人挡在中间。", "我注意到那句了。", "你别想糊弄过去。", "看着我说。", "我不喜欢你这样躲。", "那个人先放一边。", "你现在回我。", "别让我猜。", "我盯着呢。"],
      playful: ["哟，还会躲啊。", "这句有点意思。", "别装得那么无辜。", "我差点就信了。", "来，再说一遍。", "你这话我可记下了。", "别急着跑。", "行啊，胆子见长。", "我听着，你继续编。", "这反应挺明显的。"],
      formal: ["先别急。", "把话说完整。", "我听着。", "这事先放稳。", "别自己扛着。", "按节奏来。", "先坐下。", "不用逞强。", "这句我会记着。", "抬眼，看着我说。"],
      hostile: ["少来这套。", "你这话什么意思？", "别试我。", "我不吃这一套。", "说清楚。", "你以为我听不出来？", "别把话说得那么干净。", "我暂时信不了你。", "继续装。", "这笔账先记着。"],
      shy: ["……嗯。", "我听见了。", "你别看我。", "我不是那个意思。", "你刚才那句……算了。", "我有点乱。", "别催我。", "再给我一下。", "我会回你的。", "你先别走。"],
      default: ["嗯，我看见了。", "你刚才那句，我没跳过去。", "等一下。", "这话不像随便说的。", "先别急着翻篇。", "我听着。", "我接着呢。", "别把话藏一半。", "继续说。", "这句留着。"]
    };
    var lines = byBucket[bucket] || byBucket.default;

    if (/敬语|克制|疏离|距离/.test(personaText) && bucket === "default") {
      return ["我看见了。", "先到这里。", "这句我会留意。", "别急着翻过去。", "说清楚一点。"].concat(lines.slice(5));
    }

    return lines;
  }

  function normalizeReplyItem(reply, options) {
    var source = reply && typeof reply === "object" ? reply : { content: reply };
    var normalized = normalizeSpecialReply(source, options);

    if (!normalized.content) {
      var rawContent = String(source.content || source.text || "").trim();
      var rawType = normalizeMessageType(source.type || options.defaultType);
      if ((rawType === "text" || rawType === "speech") && isGenericAiTemplateText(rawContent)) {
        return [Object.assign({}, source, {
          type: rawType,
          content: rawContent
        })];
      }
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
      reply.note = String(source.note || "");
      reply.amount = source.amount;
      reply = normalizeAiMoneyReply(reply);
      if (!reply || !reply.amount) {
        reply = Object.assign({}, source, { type: "text" });
        reply.type = "text";
        content = sanitizeInvalidMoneyFallbackContent(source.content || source.text || source.note || "", "redPacket");
        delete reply.amount;
        delete reply.status;
      } else {
        content = content || "恭喜发财，大吉大利";
        reply.status = source.status ? String(source.status) : "sent";
      }
    } else if (type === "transfer") {
      reply.note = String(source.note || "");
      reply.amount = source.amount;
      reply = normalizeAiMoneyReply(reply);
      if (!reply || !reply.amount) {
        reply = Object.assign({}, source, { type: "text" });
        reply.type = "text";
        content = sanitizeInvalidMoneyFallbackContent(source.content || source.text || source.note || "", "transfer");
        delete reply.amount;
        delete reply.status;
      } else {
        content = content || "转账";
        reply.status = source.status ? String(source.status) : "pending";
      }
    }

    reply.content = normalizeAiMessageText(content);
    return reply;
  }

  function sanitizeInvalidMoneyFallbackContent(content, type) {
    var value = String(content || "").trim();
    var compact = value.replace(/\s+/g, "");

    if (!value) {
      return "";
    }

    if (type === "transfer" && /^(?:转账|微信转账|给你转账|收款|待收款)$/.test(compact)) {
      return "";
    }

    if (type === "redPacket" && /^(?:红包|微信红包|领取红包|恭喜发财，大吉大利|恭喜发财大吉大利)$/.test(compact)) {
      return "";
    }

    return value;
  }

  function normalizeMessageType(type) {
    var value = String(type || "text");
    var supported = ["text", "speech", "voice", "emoji", "location", "image", "redPacket", "transfer"];
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

  function normalizeAiMoneyReply(reply) {
    if (window.AppStorage && window.AppStorage.normalizeMoneyMessage) {
      reply = window.AppStorage.normalizeMoneyMessage(reply);
      return reply && Number(reply.amount) !== 20 ? reply : null;
    }

    reply.amount = normalizeAiAmount(reply.amount);
    return reply.amount ? reply : null;
  }

  function normalizeAiAmount(amount) {
    if (window.AppStorage && window.AppStorage.normalizeMoneyAmount) {
      return window.AppStorage.normalizeMoneyAmount(amount);
    }

    var value = Number(amount);
    if (String(amount === undefined || amount === null ? "" : amount).trim() === "") {
      return "";
    }
    if (!Number.isFinite(value) || value < 0.01) {
      return "";
    }
    if (Math.round(value * 100) === 2000) {
      return "";
    }
    return value.toFixed(2);
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
      .split(/(?:\n+|(?<=[\u3002\uFF01\uFF1F\uFF5E\u2026.!?]))/g)
      .map(function (part) {
        return normalizeAiMessageText(part.replace(/^[-*\d.\s]+/, ""));
      })
      .filter(function (part) {
        return part && part.length > 0;
      });

    return parts.length || isInvalidAiMessageText(cleaned) ? parts : [cleaned];
  }

  function splitTextContentForTopUp(text) {
    var cleaned = normalizeAiMessageText(text);
    var parts;

    if (!cleaned || cleaned.length < 18) {
      return cleaned ? [cleaned] : [];
    }

    parts = splitTextContent(cleaned);
    if (parts.length > 1) {
      return parts;
    }

    return [cleaned];
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
      return "[红包] 祝福语：" + (message.content || "恭喜发财，大吉大利") + "，金额：" + formatMoneyForPrompt(message.amount) + "，状态：" + getMoneyStatusText(message);
    }

    if (type === "transfer") {
      return "[转账] 金额：" + formatMoneyForPrompt(message.amount) + "，备注：" + (message.note || "转账") + "，状态：" + getMoneyStatusText(message);
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

  function formatMoneyForPrompt(amount) {
    var normalized = normalizeAiAmount(amount);
    return normalized ? "¥" + normalized : "未记录有效金额";
  }

  function getMoneyStatusText(message) {
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

  function debugReplyTextureCase(caseOptions) {
    var source = caseOptions || {};
    var character = Object.assign({}, source.character || {}, {
      latestUserInput: source.latestUserInput || "",
      previousReplyText: source.previousReplyText || "",
      rejectedReplyText: source.rejectedReplyText || "",
      recentHeartVoiceText: source.recentHeartVoiceText || "",
      thoughtsHint: source.recentHeartVoiceText || "",
      worldBookContext: source.worldBookContext || ""
    });
    var replies = (Array.isArray(source.replies) ? source.replies : []).map(function (reply) {
      return Object.assign({}, reply);
    });
    var stats = createReplyTextureStats();
    var outputReplies = normalizeReplyList("", replies, {
      min: replies.length || 1,
      max: Math.max(replies.length || 1, 10),
      defaultType: "text",
      allowRawFallback: false,
      fallbackProfile: buildReplyFallbackProfile(character),
      latestUserInput: source.latestUserInput || "",
      previousReplyText: source.previousReplyText || "",
      rejectedReplyText: source.rejectedReplyText || "",
      recentHeartVoiceText: source.recentHeartVoiceText || "",
      thoughtsHint: source.recentHeartVoiceText || "",
      worldBookContext: source.worldBookContext || "",
      replyTextureStats: stats
    });

    return {
      inputReplies: replies,
      outputReplies: outputReplies,
      stats: summarizeReplyTextureStats(stats),
      rawStats: stats
    };
  }

  function runReplyTextureSmokeTest() {
    var templateReplies = [
      { type: "text", content: "我理解你，如果你需要可以告诉我更多。" },
      { type: "text", content: "你可以慢慢来，我会陪着你。" },
      { type: "speech", content: "你还好吗？能告诉我为什么吗？" }
    ];
    var characters = [
      {
        id: "cold",
        name: "冷淡寡言",
        personality: "冷淡、疏离、寡言、克制，不喜欢长篇安慰。",
        speakingStyle: "短句，少解释，常说重点。"
      },
      {
        id: "strong-formal",
        name: "强势年长",
        personality: "强势、年长、上位，习惯压住节奏，保留身份感。",
        speakingStyle: "命令式短句，克制，像老师或上司。"
      },
      {
        id: "tsundere",
        name: "嘴硬角色",
        personality: "嘴硬、傲娇、别扭，不坦率但会绕着关心。",
        speakingStyle: "反问、停顿、改口，嘴上不承认。"
      },
      {
        id: "gentle",
        name: "温柔克制",
        personality: "温柔、耐心、克制地关心，具体照顾但不客服化。",
        speakingStyle: "柔和短句，有动作和留白。"
      }
    ];
    var inputs = ["我没事", "晚安", "不要你管"];
    var results = [];
    var speechProtectionReplies = [
      "好，站那儿别动。",
      "当然。你敢走试试。",
      "啧，谁问你了。"
    ];

    characters.forEach(function (character) {
      inputs.forEach(function (input) {
        var result = debugReplyTextureCase({
          character: character,
          latestUserInput: input,
          previousReplyText: "",
          recentHeartVoiceText: "",
          replies: templateReplies
        });
        results.push({
          character: character.id || character.name,
          characterName: character.name,
          latestUserInput: input,
          outputReplies: result.outputReplies.map(function (reply) { return reply.content; }),
          stats: result.stats
        });
      });
    });

    results.speechProtection = speechProtectionReplies.map(function (content) {
      var result = debugReplyTextureCase({
        character: {
          id: "speech-protect",
          name: "speech-protect",
          personality: "冷淡、嘴硬、短句，有边界感。",
          speakingStyle: "短句，反问，少解释。"
        },
        latestUserInput: "我没事",
        replies: [{ type: "speech", content: content }]
      });
      var output = result.outputReplies[0] || {};
      return {
        input: content,
        output: output.content || "",
        preserved: output.type === "speech" && output.content === content,
        stats: result.stats
      };
    });

    if (typeof console !== "undefined" && console.table) {
      console.table(results.map(function (item) {
        return {
          character: item.character,
          input: item.latestUserInput,
          first: item.outputReplies[0] || "",
          second: item.outputReplies[1] || "",
          third: item.outputReplies[2] || "",
          genericReplaced: item.stats.genericReplaced,
          textureRewritten: item.stats.textureRewritten,
          fallbackAdded: item.stats.fallbackAdded,
          rhythmRebalanced: item.stats.rhythmRebalanced,
          highQualitySkipped: item.stats.highQualitySkipped
        };
      }));
    }

    return results;
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

  function summarizeWatchRecentScene(watchHistory) {
    var events = (Array.isArray(watchHistory) ? watchHistory : []).filter(function (event) {
      return event && event.content;
    }).slice(-12);
    var lines = events.map(function (event) {
      if (event.type === "action" || event.role === "action") {
        return "旁白：" + limitText(event.content || "", 100);
      }
      return (event.characterName || event.characterId || "角色") + "：" + limitText(event.content || "", 100);
    });

    return lines.length
      ? "最近观看历史锚点：\n" + lines.join("\n")
      : "";
  }

  function buildWatchSystemPrompt(session, characters, watchHistory, options) {
    var requestOptions = options || {};
    var scene = session && session.scene || {};
    var participantCount = (characters || []).length;
    var hasWatchHistory = Array.isArray(watchHistory) && watchHistory.length > 0;
    var recentWatchSceneHint = summarizeWatchRecentScene(watchHistory);

    var characterSections = (characters || []).map(function (char) {
      var memories = getMemoryForCharacter(char.id);
      var recentThoughts = window.AppStorage && window.AppStorage.getRecentThoughts
        ? (window.AppStorage.getRecentThoughts(char.id, 8) || [])
        : [];
      var chatSettings = char.chatSettings || {};
      var privateMemories = window.AppStorage && window.AppStorage.getChatMemories
        ? window.AppStorage.getChatMemories("private", char.id).slice(0, 5)
        : [];
      var thoughtsText = recentThoughts.slice(0, 3).filter(function (t) {
        return t && (t.content || t.mood);
      }).map(function (t, i) {
        return (i + 1) + ". " + limitText(t.content || "", 120)
          + (t.mood ? "（心情：" + t.mood + "）" : "");
      }).join("\n") || "暂无";
      var privateMemoText = privateMemories.length
        ? privateMemories.map(function (m) { return "- " + limitText(m.content || "", 80); }).join("\n")
        : "暂无";

      return [
        "【角色：" + valueOrFallback(char.name) + "（ID：" + char.id + "）】",
        "人设：" + valueOrFallback(buildMergedCharacterPersona(char)),
        "当前情绪：" + valueOrFallback(char.currentMood || chatSettings.currentMood),
        "说话禁忌：" + valueOrFallback(char.taboo || chatSettings.taboo),
        "长期记忆（最近）：\n" + (formatMemoryList(memories) || "暂无"),
        "与用户的聊天记忆摘要：\n" + privateMemoText,
        "最近心声：\n" + thoughtsText
      ].filter(Boolean).join("\n");
    }).join("\n\n");

    var historyText = (Array.isArray(watchHistory) ? watchHistory : []).slice(-20).map(function (event) {
      if (event.type === "action" || event.role === "action") {
        return "【旁白】" + (event.content || "");
      }
      return (event.characterName || event.characterId || "?") + "：" + (event.content || "");
    }).join("\n") || "（对话刚开始，还没有历史记录）";

    var directorNote = String(requestOptions.directorNote || "").trim();

    var countHint = participantCount === 1
      ? "当前只有 1 个角色。请让该角色独白、做某件事、给未入场的人发消息、回忆某人。禁止让用户出场。"
      : "当前有 " + participantCount + " 个角色。每轮生成 3-10 条消息。至少 2 个角色参与。不要平均轮流，要有自然的插话、打断、冷场、转移话题。";

    return [
      "A. 观看模式 watchMode",
      "当前是观看模式（watch mode）。用户是旁观者，不在场，不参与，不发言。",
      "禁止：替用户说话、替用户行动、让角色集体突然对用户说话、让用户以任何身份出现在场景里。",
      "你的任务是生成角色之间的自然互动、独白或场景动作，就像旁观者在观看一段正在发生的剧情。",
      "",
      "B. 角色档案（每个角色都有独立视角，A 对 B 的记忆不等于 B 对 A 的记忆）",
      characterSections,
      "",
      "C. 场景连续性",
      hasWatchHistory
        ? "后续推进优先沿用 watch history 里最近发生的时间、地点、光线、天气、人物站位、距离和正在做的事。"
        : "第一轮可以使用用户填写的场景/氛围作为开场。",
      "初始场景名称：" + valueOrFallback(scene.name || "未指定"),
      "初始场景描述：" + valueOrFallback(scene.description || "无"),
      recentWatchSceneHint,
      "如果导演提示没有要求换场景，不要突然换时间/地点；如果导演提示要求换场景，也必须先写过渡 action。",
      "禁止无衔接地从夜晚跳到白天、从室内跳到室外、从房间/桌边/床边/走廊跳到教室/咖啡馆等新地点。",
      "",
      "D. 当前对话历史（最近 20 条）",
      historyText,
      "",
      directorNote ? "E. 导演提示 / 场景补充\n" + directorNote : "",
      "",
      "F. " + countHint,
      "",
      "G. 输出规则",
      "1. 必须输出合法 JSON，格式：",
      '{"messages":[{"characterId":"角色ID","type":"text","content":"发言"},{"type":"action","content":"旁白动作"}],"thoughts":[{"characterId":"角色ID","content":"内心独白","mood":"具体心情","visibleSummary":"摘要"}],"memories":[{"characterId":"角色ID","content":"值得记录的事件","relatedCharacterIds":["其他角色ID"]}]}',
      "2. messages 的 type 只能是 text 或 action；action 类型不填 characterId。",
      "3. thoughts 每个角色最多 1 条；mood 要具体，例如：压着火 / 嘴硬的在意 / 冷处理 / 试探 / 被戳穿后的不快 / 心软但不认 / 占有欲上来 / 不想低头。",
      "4. memories 只在发生了值得角色记住的事情时才填，不要每轮都写；A 和 B 的记忆要分别写，视角不同。",
      "5. memories.content 要写成角色真实经历过的记忆，不要写“观看模式里”“旁观者看到”“用户设置”等元信息；如果没有值得记住的事，memories 返回空数组。",
      "6. content 里禁止出现“观看模式”“用户”“旁观者”“系统”“AI”等词。",
      "7. 角色的记忆、人设、心声必须影响本轮语气，但不能直接说出来。",
      "8. 每个角色保持自己的声音，不要让所有角色语气都趋于温柔陪聊。"
    ].filter(Boolean).join("\n");
  }

  async function sendWatchRequest(session, characters, options) {
    var requestOptions = options || {};
    var watchHistory = session && Array.isArray(session.history) ? session.history : [];

    var systemPrompt = buildWatchSystemPrompt(session, characters, watchHistory, requestOptions);
    var userMessage = requestOptions.directorNote
      ? "请根据导演提示继续推进场景。"
      : "请推进场景，生成角色互动。";

    var messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ];

    var rawContent = await sendConfiguredChatMessages(messages);
    var parsed = parseJsonFromText(rawContent);
    var validIds = (characters || []).map(function (c) { return c.id; });

    return {
      messages: Array.isArray(parsed && parsed.messages) ? parsed.messages.filter(function (m) {
        return m && m.content && (m.type === "action" || (m.characterId && validIds.indexOf(m.characterId) !== -1));
      }) : [],
      thoughts: Array.isArray(parsed && parsed.thoughts) ? parsed.thoughts.filter(function (t) {
        return t && t.characterId && validIds.indexOf(t.characterId) !== -1 && t.content;
      }) : [],
      memories: Array.isArray(parsed && parsed.memories) ? parsed.memories.filter(function (m) {
        return m && m.characterId && validIds.indexOf(m.characterId) !== -1 && m.content;
      }) : [],
      rawContent: rawContent
    };
  }

  window.AIService = {
    MISSING_SETTINGS_MESSAGE: MISSING_SETTINGS_MESSAGE,
    buildSystemPrompt: buildSystemPrompt,
    buildMessages: buildMessages,
    summarizeMessageForAI: summarizeMessageForAI,
    normalizeReplyList: normalizeReplyList,
    normalizeAiMessageText: normalizeAiMessageText,
    sendChatRequest: sendChatRequest,
    sendPrivateChatRequest: sendPrivateChatRequest,
    buildGroupSystemPrompt: buildGroupSystemPrompt,
    sendGroupChatRequest: sendGroupChatRequest,
    sendInlineOfflineRequest: sendInlineOfflineRequest,
    sendOfflineRequest: sendOfflineRequest,
    sendWatchRequest: sendWatchRequest,
    buildWorldBookContext: buildWorldBookContext,
    generateCharacterDiary: generateCharacterDiary,
    generateMomentWithComments: generateMomentWithComments,
    generateShopProducts: generateShopProducts,
    buildChatCompletionsUrl: buildChatCompletionsUrl,
    buildModelsUrl: buildModelsUrl,
    extractAiText: extractAiText,
    fetchModels: fetchModels,
    debugReplyTextureCase: debugReplyTextureCase,
    debugOfflineNormalizeCase: debugOfflineNormalizeCase,
    runReplyTextureSmokeTest: runReplyTextureSmokeTest,
    createReplyTextureStats: createReplyTextureStats,
    summarizeReplyTextureStats: summarizeReplyTextureStats,
    normalizeBodyStateWithContext: normalizeBodyStateWithContext
  };
})(window);
