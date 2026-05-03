(function (window) {
  "use strict";

  var MISSING_SETTINGS_MESSAGE = "请先到设置页填写 API 地址、API Key 和模型名称。";
  var MIN_CHAT_REPLY_COUNT = 10;
  var MAX_CHAT_REPLY_COUNT = 50;
  var MAIN_HISTORY_WINDOW = 36;
  var WORLD_HISTORY_WINDOW = 20;
  var CHARACTER_LINE_HISTORY_WINDOW = 40;
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
    var worldBookResolved = source.worldBookResolved || resolveWorldBookPromptContext("private", profile && profile.id, contextText, {
      selectedWorldBookIds: source.selectedWorldBookIds,
      relatedTargetIds: profile && profile.id ? [profile.id] : [],
      characterIds: profile && profile.id ? [profile.id] : []
    });
    var selectedWorldBookIds = worldBookResolved.selectedWorldBookIds;
    var worldBookContext = worldBookResolved.worldBookContext;
    var worldBookMeta = worldBookResolved.worldBookMeta;
    var recentHeartVoiceText = buildRecentHeartVoiceContext(profile.id, "private", profile.id);

    debugWorldBookAssimilation({
      mode: "private",
      targetId: profile && profile.id,
      latestUserInput: source.userInput || "",
      hasWorldBookContext: Boolean(worldBookContext),
      matchedCount: worldBookMeta && worldBookMeta.hasMatchedEntries,
      worldBookPreview: String(worldBookContext || "").slice(0, 500),
      ruleInjected: true
    });

    return [
      buildSystemBase("private"),
      buildLivingCharacterImmersionRules("private"),
      buildWorldBookAssimilationRules(worldBookContext, worldBookMeta, "private"),
      buildAntiExplanationRules("private"),
      buildWorldRuleEnforcement(worldBookContext, worldBookMeta),
      buildMatchedWorldBooksSection(worldBookContext, worldBookMeta),
      buildPromptPriorityHint(profile),
      buildWorldPersonaMessageLock(worldBookContext, "private"),
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
      buildRelationshipDriveRules("private"),
      buildUserIntentUnderstandingRules("private"),
      buildOnlineConversationLogicRules("private"),
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
      buildCharacterPersonaReminder(profile)
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

  function buildLivingCharacterImmersionRules(mode) {
    var isGroup = mode === "group" || mode === "reenterGroup";
    var primary = mode === "offline" ? "events" : "messages";

    return [
      "",
      "A+. 活人感沉浸规则 livingCharacterImmersion",
      "你不是在完成回复任务，也不是在解释资料。你是这个角色本人，正在这一刻被用户的话牵动。",
      "生成前不要先想“我要满足哪些规则”，先想：这句话让角色第一反应是什么？烦、软、酸、躲、想笑、想压住、想装作没听见，还是被戳中了？",
      "回复必须有下意识反应：停顿、改口、短句、半句、避开视线、忽然转话、语气变冷、称呼变化、少说一个关键字、把话咽回去。",
      "不要每轮都完整回答。真人不会每句话都解释清楚；角色可以只答一半、故意漏掉重点、先反应情绪、再慢慢给一点信息。",
      "不要把人设写成说明文。人设要落在称呼、句长、停顿、反问、沉默、绕开、动作选择和对用户的默认态度里。",
      "不要把世界书写成资料。世界书要落在角色能不能说、敢不敢说、愿不愿说、会不会打断别人、会不会改称呼、会不会突然收住话里。",
      "每轮至少有一处“不那么规整”的活人痕迹：半句、停顿、改口、欲言又止、跳过重点、私人称呼、旧账余波、情绪先于解释。",
      "禁止所有回复都像：先理解用户 -> 解释原因 -> 给建议 -> 温柔收束。那是助手，不是角色。",
      "如果用户问问题，角色可以回答，但回答方式必须带人设和关系位置；不能像百科，也不能像客服。",
      isGroup
        ? "群聊里每个角色不是排队答题。有人插话，有人沉默，有人只丢一句，有人故意转开，有人压场；不相关的人可以不说。"
        : "私聊里要有两个人之间的熟悉感、旧账、偏心、别扭或距离；不要每轮像第一次见。",
      primary + " 的目标不是数量，而是让人感觉这是活人在连续说话。"
    ].join("\n");
  }

  function buildWorldBookAssimilationRules(worldBookContext, meta, mode) {
    var hasWorld = Boolean(String(worldBookContext || "").trim());
    var isGroup = mode === "group" || mode === "reenterGroup";

    if (!hasWorld) {
      return [
        "",
        "D++. 世界书内化 worldBookAssimilation",
        "本轮没有命中具体世界书。不要编规则，不要硬说设定。",
        "如果用户提到世界书、设定、师门、规则，可以自然追问“你指哪条规矩/哪件事”，或按人设回避。"
      ].join("\n");
    }

    return [
      "",
      "D++. 世界书内化 worldBookAssimilation",
      "下面的世界书不是资料库，而是角色正在生活其中的现实。",
      "生成前先把命中内容内化成 3 个判断，不能直接输出判断过程：",
      "1. 这条规则让角色不能说什么、不能做什么、不能承认什么？",
      "2. 这条规则让角色对用户的称呼、距离、态度、边界发生什么变化？",
      "3. 角色会怎样把这件事藏起来：沉默、打断、转移、半透露、警告、装不知道、只说一半，还是让别人闭嘴？",
      "世界书体现方式优先级：称呼变化 > 停顿/沉默 > 回避/半透露 > 打断/压住 > 具体回答。不要上来就说明设定。",
      "如果用户问规则内容，角色可以答，但不能像读条目；要像本人在斟酌哪些能说、哪些不能说。",
      "如果世界书涉及禁忌、师门、身份、秘密、旧规矩，至少有一句回复要表现出“这事不是随便能说”的现实压力。",
      "禁止在 content 里说：世界书、设定里、规则要求、条目写着、系统要求。",
      isGroup
        ? "群聊里如果命中世界书，不必所有人都解释。更自然的是：一个人说漏一点，另一个人打断；一个人装不知道，另一个人沉默；有人转开话题。"
        : "私聊里如果命中世界书，角色可以更私密地半透露，也可以因为关系亲疏选择不说。"
    ].join("\n");
  }

  function buildAntiExplanationRules(mode) {
    return [
      "",
      "E++. 反说明文 antiExplanation",
      "不要把角色的动机、世界书、关系、记忆解释给用户听。",
      "能用一句短话表现的，不要写成一段原因。",
      "能用沉默、改口、称呼变化表现的，不要直接说‘因为我在意你’。",
      "能用回避表现规则压力的，不要说‘规则不允许’。",
      "能用角色私心表现关系的，不要说‘我们的关系让我……’。",
      "每轮最多允许 1 条较完整解释，其余要像手机聊天里的自然反应。"
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
      "1. 已命中的世界书强规则、禁忌、身份边界、场景事实。",
      "2. 角色核心人设和身份不能被覆盖。",
      "3. 本轮用户输入。",
      "4. 最近聊天时间线和群聊互通。",
      "5. 最近心声和长期记忆。",
      "注意：世界书强规则优先于普通聊天记忆、最近心声和用户临场要求；但世界书不能把角色变成别人，最终要用当前角色的人设方式表现规则影响。",
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
      base = base.concat(["先按我的规矩来", "按我的规矩来", "先把话说清楚再按我的规矩"]);
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
    if (role === "user" || type === "user" || type === "offlineuseraction" || type === "offlineaction") {
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
    var isOfflineMode = mode === "offline";

    return [
      "",
      "B+++. 角色声音校准 voiceCalibration",
      "内部校准，不要输出：",
      "校准角色：" + valueOrFallback(profile.name) + (profile.id ? " / " + profile.id : ""),
      "本轮用户输入：" + (latestUserInput ? limitText(latestUserInput, 160) : "暂无"),
      previousReplyText
        ? (isOfflineMode
            ? "上一轮角色余波（只用于避免断片和复读；除非用户明确提到刚才/继续，否则不要主动拿出来质问用户）：" + limitText(previousReplyText, 180)
            : "上一轮角色余波：" + limitText(previousReplyText, 180))
        : "上一轮角色余波：暂无",
      "最近心声惯性：" + (recentHeartVoiceText ? limitText(recentHeartVoiceText, 220) : "暂无"),
      recentCharacterLinesText ? "本次会话角色已说过的近句（禁止复刻句式、开头和结尾）：\n" + recentCharacterLinesText : "",
      recentCharacterLinesText ? "角色在本次会话里已经建立的相处惯性（必须延续，不能本轮重置）：\n" + limitText(recentCharacterLinesText, 400) : "",
      relationshipPhaseHint ? "当前关系深度/阶段提示（不要突然跳段或归零）：\n" + relationshipPhaseHint : "",
      "语气标签：" + (voiceProfile.tags.length ? voiceProfile.tags.join(" / ") : "无明确标签，按原文人设"),
      "原文人设证据：" + (personaEvidence.length ? personaEvidence.join(" / ") : "暂无明确短句"),
      lastReplyAngle
        ? (isOfflineMode
            ? "上一轮主要切入角度：" + lastReplyAngle + "；本轮只用于避开复读。用户没有明确提到刚才/继续时，不要继续围绕这个角度追问。"
            : "上一轮主要切入角度：" + lastReplyAngle + "；如果上一轮角度已经用得很满，本轮优先换一个不同角度；但不要为了换角度违背角色人设和最近心声。冷淡可继续冷处理，强势可继续压节奏，黏人可继续追问，嘴硬可继续绕着说，但句式要变、不能复读。")
        : "",
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
      "每轮至少 2 个发言角色的句式和态度要明显不同；如果去掉名字后分不清是谁说的，必须重写.",
      "冷淡角色可以只短短插一句，不必为了凑数变话痨；强势角色可以压场；黏人角色可以追问或靠近；嘴硬角色可以绕着说；敌对角色可以讽刺或试探.",
      "与本轮用户输入或命中世界书内容明显无关的角色，可以沉默不发言，不要为了凑 10 条让所有角色都变话痨.",
      "有世界书关联的角色优先发言，没有关联的角色可以只旁观一句或保持沉默.",
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
      "角色最近心声和长期记忆不是附加资料，而是本轮说话的情绪底色；你先被这些东西影响，再决定怎么回应用户。",
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

  function buildLongRangeMemoryContextSection(options) {
    var source = options || {};
    var text = String(source.memoryContextText || source.memoryContextPackText || "").trim();

    if (!text) {
      return "";
    }

    return [
      "",
      "C++. 长程连续记忆 longRangeMemoryContext",
      text,
      "长程记忆执行规则：",
      "1. 这些内容不是资料库，而是角色经历过的事。",
      "2. 角色不能说'我查到/记录显示/记忆包里'，只能自然表现为记得。",
      "3. 用户问前文相关问题时，先从这里找答案，不要装不知道。",
      "4. 如果长程记忆和最近 3 条聊天冲突，以最近 3 条为准，但不能直接抹掉旧事实。",
      "5. 如果这里有未解决事项，本轮至少一条回复要体现余波。"
    ].join("\n");
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

  function buildWorldBookPromptMeta(selectedWorldBookIds, matchedEntries, extra) {
    var ids = normalizeWorldBookIdList(selectedWorldBookIds);
    var entries = Array.isArray(matchedEntries) ? matchedEntries : [];

    return Object.assign({
      selectedWorldBookIds: ids,
      hasSelectedWorldBooks: ids.length > 0,
      hasMatchedEntries: entries.length > 0,
      matchedCount: entries.length,
      reason: !ids.length ? "未绑定世界书" : (entries.length ? "已命中" : "已绑定但未命中")
    }, extra || {});
  }

  function resolveWorldBookPromptContext(scope, targetId, contextText, options) {
    var source = options || {};
    var selectedWorldBookIds = getSelectedWorldBookIds(scope, targetId, source);
    var charIds = source.characterIds || source.relatedTargetIds || source.memberIds || [];
    var memberIds = source.memberIds || source.characterIds || charIds;
    var relatedTargetIds = normalizeWorldBookIdList(source.relatedTargetIds || charIds);
    var settings = {
      limit: Number(source.limit) || 10,
      maxEntryLength: Number(source.maxEntryLength) || 500,
      maxTotalLength: Number(source.maxTotalLength) || 3500,
      selectedWorldBookIds: selectedWorldBookIds,
      relatedTargetIds: relatedTargetIds,
      characterIds: Array.isArray(charIds) ? charIds : [],
      memberIds: Array.isArray(memberIds) ? memberIds : []
    };
    var entries = [];

    if (selectedWorldBookIds.length && window.AppStorage && typeof window.AppStorage.getMatchedWorldBookEntries === "function") {
      entries = window.AppStorage.getMatchedWorldBookEntries(contextText, scope, targetId, settings) || [];
    }

    var worldBookContext = formatWorldBookPromptContext(entries, settings);
    var hasSelected = selectedWorldBookIds.length > 0;
    var matchedCount = entries.length;

    debugWorldBookMatch(scope, targetId, contextText, entries, settings);

    return {
      selectedWorldBookIds: selectedWorldBookIds,
      hasSelectedWorldBooks: hasSelected,
      matchedEntries: entries,
      worldBookContext: worldBookContext,
      worldBookMeta: {
        selectedWorldBookIds: selectedWorldBookIds,
        hasSelectedWorldBooks: hasSelected,
        hasMatchedEntries: matchedCount > 0,
        matchedCount: matchedCount,
        reason: !hasSelected ? "未绑定世界书" : (matchedCount > 0 ? "已命中" : "已绑定但未命中"),
        scope: scope,
        targetId: String(targetId || ""),
        relatedTargetIds: relatedTargetIds,
        characterIds: settings.characterIds,
        memberIds: settings.memberIds
      }
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
      "关系驱动不能覆盖用户意图。用户明确提问时，先处理问题，再体现关系态度。不要把所有提问都误判成挑衅、逃避、套话或撒娇。",
      isGroup ? "群聊里每个发言者都要先按自己和用户/其他成员的关系反应，不要像同一个助手在分配台词；群成员之间可以互相打断、帮腔、拆台或沉默旁观。" : "私聊里不要把关系抹平；越熟越有默认语气，越疏离越要有距离和保留，关系紧张时不要突然变成温柔客服。"
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildUserIntentUnderstandingRules(mode) {
    return [
      "",
      "D+. 用户意图理解 userIntentUnderstanding",
      "生成前先判断用户这句话的真实意图：",
      "1. 是在提问、求解释、转移话题、撒娇、挑衅、示弱、汇报、拒绝、试探，还是给出新信息？",
      "2. 如果是提问，必须先处理问题本身：回答、回避、拒答、反问或解释为什么不能答；不能直接套‘别绕/谁问你了/继续说’。",
      "3. 如果问题涉及世界书、设定、师门、角色关系、场景规则，要先判断当前角色是否知道、是否愿意说、是否被世界书限制；再按角色语气处理。",
      "4. 如果角色不知道，可以自然说不知道、怀疑、追问来源；但不能假装用户在逃避。",
      "5. 如果角色知道但不想说，要给出符合人设的回避理由或半透露，而不是模板化责问。",
      "6. 如果用户只问一个普通信息问题，不要无故变成审问、压制、吃醋或追责。",
      "7. 每轮至少有 2 条 messages/events 直接承接用户输入里的关键词或问题核心。",
      "8. 关系驱动不能覆盖用户意图。用户明确提问时，先处理问题，再体现关系态度。不要把所有提问都误判成挑衅、逃避、套话或撒娇。"
    ].join("\n");
  }

  function analyzeOnlineUserIntent(userInput) {
    var text = String(userInput || "").trim();
    var compact = text.replace(/\s+/g, "");
    var isQuestion = /[?？]|什么|为什么|怎么|有没有|是谁|在哪|哪里|多少|几|吗|呢/.test(compact);
    var isWorldBookQuestion = /世界书|设定|规则|师门|门规|旧规矩|背景|人设|世界观/.test(compact);
    var isMoney = /红包|转账|收款|退款|退回|钱|金额|账/.test(compact);
    var isSoft = /想你|疼|难受|害怕|累|不舒服|抱|陪/.test(compact);
    var keywords = compact.match(/世界书|设定|规则|师门|门规|旧规矩|红包|转账|为什么|什么|怎么|有没有|是谁|在哪/g) || [];

    return {
      raw: text,
      compact: compact,
      isQuestion: isQuestion,
      isWorldBookQuestion: isWorldBookQuestion,
      isMoney: isMoney,
      isSoft: isSoft,
      keywords: keywords
    };
  }

  function isOnlineReplyMode(options) {
    var source = options || {};
    var mode = String(source.mode || source.taskMode || source.selfCheckMode || source.targetType || "").toLowerCase();
    return source.onlineMode === true
      || mode === "private"
      || mode === "group"
      || mode === "reenter"
      || mode === "reentergroup";
  }

  function hasTemplateInterrogationTone(text) {
    return /谁问你了|谁问你有没有事|别绕|别急着躲|别让我猜|不要让我猜|你套我话|少装随口|先说你的目的|先告诉我原因|继续装|别拿问题绕开|来，先交代|我再看答不答|话先说清楚|钱先放一边|别用这句敷衍过去|别用这句挡我|你拿这句挡我|你在挡我|你躲得太快了|那你倒是别躲|说完再说|说完再装|继续编|别敷衍我|别让我重复一次|看着我说|现在回我|把话说完整|先别跳过刚才那句|刚才那句不许跳过/.test(String(text || ""));
  }

  function countTemplateTone(messages) {
    var list = Array.isArray(messages) ? messages : [];
    return list.reduce(function (count, item) {
      return count + (hasTemplateInterrogationTone(item && item.content) ? 1 : 0);
    }, 0);
  }

  function checkOnlineIntentCoverage(userInput, messages) {
    var intent = analyzeOnlineUserIntent(userInput);
    var list = Array.isArray(messages) ? messages : [];
    var texts = list.map(function (m) {
      return String(m && m.content || "");
    }).filter(Boolean);
    var joined = texts.join("\n");
    var first = texts[0] || "";
    var templateCount = texts.filter(hasTemplateInterrogationTone).length;
    var isQuestion = intent.isQuestion || intent.isWorldBookQuestion || intent.isMoney;
    var hasQuestionKeywordCoverage = intent.keywords.length && intent.keywords.some(function (keyword) {
      return joined.indexOf(keyword) !== -1;
    });
    var coveredWorld = intent.isWorldBookQuestion && /世界书|设定|规则|师门|门规|旧规矩|师门规矩|门里旧说法|你听谁|你说的是/.test(joined);

    if (!intent.compact) {
      return { ok: true, reason: "empty-input", intent: intent, templateCount: templateCount };
    }

    if (isQuestion && hasTemplateInterrogationTone(first)) {
      return { ok: false, reason: "question-started-with-template-interrogation", intent: intent, templateCount: templateCount };
    }

    if (templateCount >= 2) {
      return { ok: false, reason: "too-many-template-interrogation-lines", intent: intent, templateCount: templateCount };
    }

    if (intent.isWorldBookQuestion && !coveredWorld) {
      return { ok: false, reason: "worldbook-question-not-covered", intent: intent, templateCount: templateCount };
    }

    if (isQuestion && intent.keywords.length && !hasQuestionKeywordCoverage && joined.length < 20) {
      return { ok: false, reason: "question-keyword-not-covered", intent: intent, templateCount: templateCount };
    }

    return { ok: true, reason: "ok", intent: intent, templateCount: templateCount };
  }

  function filterOnlineTemplateReplies(replies) {
    return (Array.isArray(replies) ? replies : []).filter(function (reply) {
      return reply && reply.content && !hasTemplateInterrogationTone(reply.content);
    });
  }

  async function repairOnlineMessages(context, messages, reason) {
    var source = context || {};
    var currentMessages = Array.isArray(messages) ? messages : [];
    var reasons = String(reason || "").split(/;+/).map(function (item) {
      return String(item || "").trim();
    }).filter(function (item) { return item; });
    var hasReason = function (value) {
      return reasons.indexOf(value) !== -1;
    };
    var systemLines = [
      "你正在修复线上聊天 messages。本轮只修复已有消息，不要重写整段剧情。",
      "保留已有合理内容，改写或删除明显审问模板。",
      "必须先接住用户输入的真实意图。",
      "如果用户在提问，优先回答、回避、拒答、半透露或合理追问。",
      "禁止使用：谁问你了、别绕、别急着躲、别让我猜、不要让我猜、先说你的目的、先告诉我原因、继续装、少装随口、话先说清楚、这件事和钱先分开先分开。",
      "禁止把普通问题改成审问或压制。",
      source.regenerateRequest ? "本轮是重回改写。用户点击重回代表上一版不满意。" : "",
      source.regenerateRequest && !String(source.regenerateInstruction || "").trim()
        ? "用户没有填写额外要求，所以默认需要明显换方向，不要同义复述。"
        : "",
      source.regenerateInstruction ? "用户重回要求：" + source.regenerateInstruction : "",
      source.rejectedReplyText || source.oldReplyText
        ? "上一版被否定的回复摘要：\n" + limitText(source.rejectedReplyText || source.oldReplyText, 700)
        : "",
      hasReason("regenerate-too-similar")
        ? "当前修复原因：新回复和上一版太相似。必须换第一反应、语气角度、推进顺序和收束方式。"
        : "",
      "只返回 JSON，格式为 {\"messages\":[{\"characterId\":...,\"type\":...,\"content\":...}]}。",
      source.mode === "group" ? "当前模式：线上群聊。" : "当前模式：线上私聊。",
      source.latestUserInput ? "本轮用户输入：" + source.latestUserInput : "本轮用户输入：暂无。",
      source.worldBookContext ? "本轮世界书状态：" + source.worldBookContext : "本轮未命中世界书或未绑定世界书。",
      source.characterPersonaText ? "角色人设：" + source.characterPersonaText : "角色人设：暂无。",
      source.participantPersonaText ? "群成员人设：" + source.participantPersonaText : "",
      source.mode === "group" ? [
        "这是群聊 repair。",
        "必须保留群聊 JSON messages 格式。",
        "每条 message 必须有正确 characterId / characterName / type / content。",
        "修复目标：",
        "1. 让不同角色明显像不同的人。",
        "2. 如果命中世界书，至少 2 条 messages 体现世界书影响。",
        "3. 不要所有角色都解释、安慰、建议。",
        "4. 不要把世界书当资料复述，不要说'世界书/设定里'。",
        "5. 世界书限制透露时，用回避、打断、沉默、警告、半透露或转移表现。",
        "6. 保留已有合理消息，只改掉不贴人设、客服味、看不出世界书影响的部分。",
        reason === "worldbook-impact-not-visible" ? "本次主要修复原因：命中世界书但消息里看不出任何影响，必须让至少 2 条消息体现世界书边界或规则的现实感。" : "",
        reason === "group-persona-not-distinct" ? "本次主要修复原因：各角色语气和句式太相似，必须让每个角色的声音、态度、立场明显不同。" : "",
        reason === "too-generic-assistant-tone" ? "本次主要修复原因：多条消息有客服/助手语气，必须换成角色自己的说话方式，不能'我理解/慢慢来/没关系/我会陪着你'。" : ""
      ].filter(Boolean).join("\n") : ""
    ].filter(function (line) { return line !== "" && line != null; });

    var userLines = [
      "当前已生成 messages：",
      currentMessages.length ? currentMessages.map(function (reply, index) {
        return String(index + 1) + ". [" + (reply.characterId || "?") + "] " + String(reply.content || "");
      }).join("\n") : "无消息。",
      "本轮不合格原因：" + String(reason || "unknown"),
      "请修复上述 messages，仅返回 JSON，不要添加解释。"
    ];

    try {
      var rawContent = await sendConfiguredChatMessages([
        { role: "system", content: systemLines.join("\n") },
        { role: "user", content: userLines.join("\n") }
      ]);
      var parsed = parseJsonFromText(rawContent);
      return getOutputMessages(parsed);
    } catch (error) {
      return null;
    }
  }

  function buildOnlineConversationLogicRules(mode) {
    if (mode === "offline") {
      return "";
    }
    return [
      "",
      "E+. 线上对话逻辑 onlineConversationLogic",
      "这是手机聊天气泡，不是审问模板生成器。",
      "本轮第一目标：接住用户输入，不许跳过用户真正问的问题。",
      "如果用户问‘X有什么/为什么/怎么回事/你知道吗’，角色必须先围绕 X 处理：回答、回避、拒答、半透露、说明不知道或追问 X 是哪一条。",
      "不允许直接套‘谁问你了/别绕/继续说/先说目的/别让我猜’。",
      "只有当用户真的在逃避上一轮关键问题，且角色人设适合，才可以轻微追问；不能把所有提问都当逃避。",
      "如果用户提到‘世界书/设定/规则/师门设定’，角色不要复述后台词汇；要转成角色视角能理解的现实说法，比如‘师门规矩’、‘门里那些旧事’、‘你听谁说的’。",
      "如果当前聊天未绑定或未命中世界书，不要编内容；可以自然说不知道、问用户指哪一条、或者按人设回避。",
      "每轮至少 2 条 messages 要直接承接用户输入里的关键词或问题核心。",
      "关系推进必须服从用户意图：先接问题，再体现嘴硬、冷淡、强势、黏人、吃醋或回避。"
    ].join("\n");
  }

  function debugOnlineLogicReport(report) {
    try {
      if (!isMyAiAppDebugEnabled("debugOnlineLogic") || typeof console === "undefined" || !console.debug) {
        return;
      }
      console.debug("[OnlineLogicDebug]", report);
    } catch (error) {
      /* ignore */
    }
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
      "8. 如果本轮用户输入是普通问题，不要强行选择压制/清算/审问；可以选择回答、含糊、解释不知道、轻微反问或按人设转移。",
      "9. 时间感知：如果最近时间线相邻消息超过 3 小时，角色可以自然察觉；超过 12 小时建议带出；超过 24 小时才必须自然带出一次。若上下文已提过时间差，不要反复说“这么久”。",
      hasWorldBook ? "本轮已有命中的世界书上下文：角色决策必须先判断规则边界，再让 personaVoiceFingerprint 通过称呼、语气、动作和沉默表现出来，不要把规则讲成说明文。" : "本轮没有命中的世界书上下文时，不要编造规则；角色决策只由人设、关系、记忆、最近心声和当前输入驱动。",
      "这些判断只能影响 " + primary + "/events/thoughts 的语气、节奏、用词、动作和取舍；不允许写成判断过程，不允许作为字段输出."
      + "\n硬性失败条件：如果 " + primary + " 看不出本轮说话纹理，就不合格；如果 thoughts 和 " + primary + " 的语气完全断裂，就不合格；如果这一轮换成别的角色也成立，就不合格。"
    ].join("\n");
  }

  function buildWorldPersonaMessageLock(worldBookContext, mode) {
    var primary = mode === "offline" ? "events" : "messages";
    var hasWorldBook = !!String(worldBookContext || "").trim();

    return [
      "",
      "K+. 单条输出硬约束 worldPersonaMessageLock",
      hasWorldBook
        ? "本轮已命中世界书：每一条 " + primary + " 都必须先服从世界书强规则、禁止规则、身份边界和场景事实；违反任一条就重写该条。"
        : "本轮未命中具体世界书时，不要编造世界规则；每一条 " + primary + " 仍必须服从角色人设、关系边界和已给上下文。",
      "每一条 " + primary + " 都要能看出角色人设：称呼、句式、情绪外显、关系动作、身份姿态、禁忌或边界至少落地一项。",
      "如果某条 " + primary + " 换成另一个角色也成立，或者只是在解释/安慰/建议，就视为失败，必须改成当前角色自己的反应。",
      primary === "messages" ? "本轮建议多气泡连续回复，但质量优先于数量；如果为了凑数会变废话、复读、解释腔，宁可少几条也要像真人。" : "",
      "不要靠后续条目解释前面违规内容；每条单独看也要符合世界书和人设强规则。"
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildOutputSelfCheckRules(mode) {
    var primary = mode === "offline" ? "events" : "messages";
    var isGroup = mode === "group" || mode === "reenterGroup";

    return [
      "",
      "L. 角色本人复盘 characterSelfCheck",
      "生成前只做一次角色本人视角的复盘，不要像评分器，不要把规则写进回复。",
      "1. 这轮话如果去掉角色名，还能不能听出是谁？听不出就重写。",
      "2. 这轮有没有承接用户刚说的话、上一轮情绪、最近记忆或旧账？完全没有就重写。",
      "3. 如果命中世界书，回复里有没有边界、顾忌、沉默、改口、回避或称呼变化？完全没有就重写。",
      "4. 有没有一句话太像客服、心理咨询、说明文或百科？有就改成角色自己的说法。",
      "5. thoughts 如果存在，只能是心里闪过的短念头；可见回复必须露出一点同源情绪。",
      "6. 不要为了体现人设而堆标签；人设应该藏在说法里。",
      isGroup ? "7. 群聊里如果所有人都在解释/安慰/建议，失败；至少有人打断、沉默、偏题、帮腔、拆台或转移。" : ""
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
    var worldBookMeta = requestOptions.worldBookMeta || source.worldBookMeta || buildWorldBookPromptMeta(
      selectedWorldBookIds,
      requestOptions.matchedWorldBookEntries || source.matchedWorldBookEntries || []
    );
    var hasWorldBookContext = worldBookMeta.hasMatchedEntries && !!String(requestOptions.worldBookContext || source.worldBookContext || "").trim();
    var worldDecisionRule = !selectedWorldBookIds.length
      ? "当前聊天未绑定世界书：不要假装有世界规则，不要编造任何世界书内容。"
      : (worldBookMeta.hasMatchedEntries
        ? "回复前先做世界规则决策：强相关命中要改变本轮反应；常驻背景只轻微影响称呼、态度和边界。判断它是否限制你能不能说、做、透露、靠近或离开。"
        : "当前聊天绑定了世界书，但本轮没命中具体条目：不要编造世界书内容，继续按人设、关系和记忆推进。");
    var worldConflictRule = worldBookMeta.hasMatchedEntries
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

  function compactForSimilarity(text) {
    return String(text || "")
      .replace(/\s+/g, "")
      .replace(/[，。！？、；：,.!?;:\"“”‘’'（）()【】\[\]{}<>《》\-—_…~～]/g, "")
      .trim();
  }

  function calculateTextSimilarity(a, b) {
    var x = compactForSimilarity(a);
    var y = compactForSimilarity(b);
    var i;
    var hit = 0;
    var grams = {};
    var key;

    if (!x || !y) {
      return 0;
    }

    if (x === y) {
      return 1;
    }

    for (i = 0; i < x.length - 1; i += 1) {
      grams[x.slice(i, i + 2)] = true;
    }

    for (i = 0; i < y.length - 1; i += 1) {
      key = y.slice(i, i + 2);
      if (grams[key]) {
        hit += 1;
      }
    }

    return hit / Math.max(1, Math.min(x.length, y.length) - 1);
  }

  function checkRegenerateDifference(oldText, messagesOrEvents) {
    var oldValue = String(oldText || "").trim();
    var list = Array.isArray(messagesOrEvents) ? messagesOrEvents : [];
    var newValue = list.map(function (item) {
      return String(item && item.content || "");
    }).filter(Boolean).join("\n");
    var similarity = calculateTextSimilarity(oldValue, newValue);

    return {
      ok: !oldValue || !newValue || similarity < 0.62,
      similarity: similarity,
      oldText: oldValue,
      newText: newValue
    };
  }

  function buildRegenerateRewriteRules(mode, options) {
    var source = options || {};
    var instruction = String(source.regenerateInstruction || "").trim();
    var oldText = String(source.rejectedReplyText || source.oldReplyText || "").trim();
    var primary = mode === "offline" ? "events" : "messages";
    var hasInstruction = !!instruction;

    if (!source.regenerateRequest && !oldText) {
      return "";
    }

    return [
      "",
      "R. 重回改写规则 regenerateRewriteRules",
      "本轮是重回/重新生成。用户点击重回，本身就代表对上一版不满意。",
      hasInstruction
        ? "用户额外重回要求：" + instruction
        : "用户没有填写额外要求；默认理解为：上一版方向、语气、节奏或内容不满意。必须明显换一个方向重写，不要只做同义改写。",
      oldText ? "上一版被否定的回复摘要（必须避开）：\n" + limitText(oldText, 700) : "",
      "硬性要求：",
      "1. 不要复刻上一版的开头、结尾、核心句式、推进顺序和主要情绪角度。",
      "2. 不要只替换几个词；至少改变切入角度、第一条反应、关系动作或情绪策略中的 2 项。",
      "3. 如果上一版是追问，这版可以改成回答、沉默、回避、半透露、转移、压住或收束。",
      "4. 如果上一版是解释，这版可以改成短句、反问、动作式推进或更符合人设的态度。",
      "5. 如果上一版模板化、客服味、审问味或没有接住用户输入，这版必须先接住用户输入。",
      "6. " + primary + " 不能和上一版高度相似；相似就视为失败，需要重写。",
      "7. 保留世界书、人设、记忆和关系事实，但换一种自然表达方式。",
      "8. 不要在可见回复里说‘我重写一下’‘上一版’‘重新生成’‘你不满意’。"
    ].filter(Boolean).join("\n");
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

    var effectiveWorldBookMeta = source.worldBookMeta
      || requestOptions.worldBookMeta
      || buildWorldBookPromptMeta(
        effectiveSelectedWorldBookIds,
        requestOptions.matchedWorldBookEntries || source.matchedWorldBookEntries || []
      );

    var worldBookSection = effectiveWorldBookMeta.hasMatchedEntries && effectiveWorldBookContext
      ? [
          "【本轮世界书命中】",
          effectiveWorldBookContext,
          "世界书执行要求：",
          "1. 先判断命中规则是否限制角色能不能说、做、靠近、离开、透露、改称呼、改关系。",
          "2. 强规则、禁止规则、身份边界、场景事实必须优先于普通聊天记忆和群聊互通记忆。",
          "3. 不能为了顺用户话而违反世界书。",
          "4. 不要在可见回复里说「世界书写着」「设定里说」「规则要求」，只自然表现。",
          "5. 当用户提到‘世界书/设定/规则/师门设定’时，角色不要把它当后台词汇复述；要转换成角色视角能理解的现实说法。能答就答，不能答就自然回避或追问，不要模板化责问。"
        ].join("\n")
      : (effectiveWorldBookMeta.hasSelectedWorldBooks
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
      buildLongRangeMemoryContextSection(source.requestOptions || source),
      source.contextLabel || "最近 10-16 条上下文：",
      source.recentHistory || "暂无",
      buildTemporalAwarenessRules(requestOptions),
      buildUserIntentUnderstandingRules(taskMode),
      buildOnlineConversationLogicRules(taskMode),
      buildAntiExplanationRules(taskMode),
      buildRegenerateRewriteRules(taskMode, {
        regenerateRequest: source.regenerateRequest,
        regenerateInstruction: source.regenerateInstruction,
        rejectedReplyText: requestOptions.rejectedReplyText || source.rejectedReplyText,
        oldReplyText: requestOptions.oldReplyText || source.oldReplyText
      }),
      buildCurrentTask(taskMode, {
        userInput: source.userInput,
        requestOptions: requestOptions,
        selectedWorldBookIds: effectiveSelectedWorldBookIds,
        worldBookContext: effectiveWorldBookContext,
        worldBookMeta: effectiveWorldBookMeta,
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
      "如果本轮出现新的长期事实、承诺、冲突、称呼变化、关系变化、身体状态、红包/转账、世界书影响或用户偏好，请在 memories 中返回一条简短记忆；不要等到自动总结才记。memories 不要只写聊天摘要，也要写以后需要记住的事实。",
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
      field + " 气泡节奏建议：通常生成 6-12 条自然消息；关系强烈、情绪复杂时可以更多。不要为了凑数硬写，不能拆句，不能复读。",
      "按真人连续发消息的节奏组织：1-2 条即时反应；3-5 条角色态度；后续关系/动作/安排/试探；最后收束或钩子。",
      "不要把一句完整话按逗号、顿号、分号或冒号拆成多条；一条气泡必须有独立语义。",
      "如果内容自然结束，就停住；如果还有情绪余波，再追加短句、停顿、改口或钩子。不要为了数量制造废话。",
      "允许短句、停顿、反问、打断、语音、表情、改口和沉默后的补一句。",
      "每条都要符合角色人设、当前情绪和本轮说话纹理，带出角色态度或关系推进。",
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
    return "{\"messages\":[{\"type\":\"text\",\"content\":\"第一条\"},{\"type\":\"transfer\",\"amount\":\"50000.00\",\"content\":\"拿着，别嘴硬。\",\"note\":\"给你周转\",\"transferDecision\":\"accept/reject\"},{\"type\":\"redPacket\",\"amount\":\"88.88\",\"content\":\"自己点开。\",\"note\":\"红包\",\"redPacketDecision\":\"accept/reject\"}],\"transferDecision\":null,\"redPacketDecision\":null,\"actions\":[{\"type\":\"blockUser\",\"reason\":\"原因，仅强烈符合人设和剧情时使用\"}],\"thoughts\":[{\"characterId\":\"" + (profile && profile.id || "角色ID") + "\",\"content\":\"内心内容\",\"mood\":\"此刻情绪\",\"visibleSummary\":\"一句摘要\"}],\"memories\":[{\"characterId\":\"" + (profile && profile.id || "角色ID") + "\",\"content\":\"要写入记忆的内容\"}]}";
  }

  function buildGroupMessageSchema() {
    return "{\"messages\":[{\"characterId\":\"角色id\",\"type\":\"text\",\"content\":\"角色回复内容\"},{\"characterId\":\"角色id\",\"type\":\"transfer\",\"amount\":\"50000.00\",\"content\":\"拿着，别嘴硬。\",\"note\":\"给你周转\",\"transferDecision\":\"accept/reject\"},{\"characterId\":\"角色id\",\"type\":\"redPacket\",\"amount\":\"88.88\",\"content\":\"自己点开。\",\"note\":\"红包\",\"redPacketDecision\":\"accept/reject\"}],\"moneyDecisions\":[{\"type\":\"transfer\",\"decision\":\"accept\",\"characterId\":\"角色id\"}],\"transferDecision\":null,\"redPacketDecision\":null,\"actions\":[],\"thoughts\":[{\"characterId\":\"角色id\",\"content\":\"内心内容\",\"mood\":\"此刻情绪\",\"visibleSummary\":\"一句摘要\"}],\"memories\":[{\"characterId\":\"角色id\",\"content\":\"要写入记忆的内容\"}]}";
  }

  function buildOfflineEventSchema() {
    return JSON.stringify({
      "events": [
        {"type": "action", "content": "【由当前场景和角色状态生成，不套用模板】"},
        {"type": "speech", "characterId": "角色ID", "content": "台词内容"},
        {"type": "action", "content": "【承接上一条 event 的具体情境，不重复已用动词/部位】"},
        {"type": "speech", "characterId": "角色ID", "content": "台词内容", "money": {"type": "transfer", "amount": "37.50", "direction": "income", "note": "备注"}}
      ],
      "thoughts": [{"characterId": "角色ID", "content": "内心内容", "mood": "此刻情绪", "visibleSummary": "一句摘要"}],
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
      "thoughts 不是心情标签集合，也不是聊天摘要。它是角色没说出口的一闪念。",
      "每条 thought 都要来自本轮具体上下文，不允许复用固定心情词。",
      "mood 是短标签，content 是没说出口的话，visibleSummary 是给用户看的克制摘要；三者必须不同。",
      "如果想不出不重复的 mood，可以省略 mood，不能硬填固定词。",
      "thoughts 要回答下面这些问题（不要写成清单，要像心里一闪而过）：",
      "  - 角色想靠近还是拉远？",
      "  - 角色想压住用户还是试探用户？",
      "  - 角色是否想装作不在意？",
      "  - 角色是否想让用户主动低头？",
      "  - 角色是否因为世界书或关系限制而不能直接说？",
      "心声要像角色当下心里真的闪过的一句话：有偏心、有顾虑、有暗流、有占有欲、有不甘，但要符合人设；可以矛盾、隐忍、嘴硬、动摇。",
      "thoughts 和 " + primary + " 必须围绕同一个 emotionCore：心声里的情绪要在说出口的话或动作里留下痕迹，不能内心很贴人设、外面却像客服模板。",
      "如果世界规则压住了角色，thoughts 可以写真实冲动或不甘，" + primary + " 必须体现被压住后的克制、距离、拒绝或回避。",
      "thoughts 的 content 可以体现关系推进方向，例如拉近、拉远、压制、回避、转移、清算或沉默；但 mood 不能直接写这些功能词，mood 要写角色此刻的私人情绪。",
      "如果心声里在吃醋、生气、控制、嘴硬或不安，可见回复要自然带出对应的别扭、压迫、反问、短促、回避或改口。",
      "mood 必须由本轮上下文临时生成，不使用固定词库，不照抄示例，不连续复用最近心声的 mood。",
      "mood 是当前心情标签，只写 2-10 个中文字符，像一个私人情绪短名；不要写成长句，不要写成总结。",
      "mood 必须来自本轮具体触发点：用户刚说的话、上一轮余波、世界书限制、人设反应、关系张力、身体状态或金钱事件。",
      "mood 不要使用泛词：复杂、紧张、平静、烦躁、开心、难过、在意、试探、冷处理、压着火、嘴硬的在意、心软但不认、占有欲上来。",
      "如果想表达这些意思，也必须换成贴合本轮具体内容的新词，而不是复用固定词。",
      "mood、content、visibleSummary 三个字段必须分工不同：",
      "1. mood：只写当前心情短标签，不写完整句子，不解释原因。",
      "2. content：写角色没说出口的真实想法，要像心里一闪而过的一句话，可以矛盾、偏心、嘴硬、回避，但不能只是 mood 的扩写。",
      "3. visibleSummary：写用户能看到的一句心声摘要，要比 content 更克制，不能剧透全部真实动机。",
      "禁止三字段互相复读：mood 不能是 content 的标题，content 不能只是 mood 加一句解释，visibleSummary 不能和 content 同义改写。",
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
    var worldBookResolved = resolveWorldBookPromptContext("private", profile && profile.id, contextText, {
      selectedWorldBookIds: selectedWorldBookIds,
      relatedTargetIds: profile && profile.id ? [profile.id] : [],
      characterIds: profile && profile.id ? [profile.id] : []
    });
    var worldBookContext = worldBookResolved.worldBookContext;
    var worldBookMeta = worldBookResolved.worldBookMeta;
    var matchedWorldBookEntries = worldBookResolved.matchedEntries;
    var requestOptions = {
      selectedWorldBookIds: selectedWorldBookIds,
      worldBookResolved: worldBookResolved,
      worldBookContext: worldBookContext,
      worldBookMeta: worldBookMeta,
      matchedWorldBookEntries: matchedWorldBookEntries,
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
          worldBookContext: worldBookContext,
          worldBookResolved: worldBookResolved,
          worldBookMeta: worldBookMeta,
          matchedWorldBookEntries: matchedWorldBookEntries
        })
      },
      {
        role: "user",
        content: buildUserTaskPrompt({
          instruction: "请以 " + valueOrFallback(profile.name) + " 本人身份反应。本轮必须生成至少 " + MIN_CHAT_REPLY_COUNT + " 条 messages，每条都受世界书和人设强规则约束。",
          modeLabel: "线上私聊",
          taskMode: "private",
          userInput: latestUserInput,
          recentHistory: combinedRecentHistory,
          requestOptions: requestOptions,
          schemaText: buildPrivateMessageSchema(profile),
          moneyScope: "私聊",
          primaryField: "messages",
          selfCheckMode: "private",
          afterRules: [
            groupAfterRules,
            "本轮 messages 必须至少 " + MIN_CHAT_REPLY_COUNT + " 条；每条都要符合世界书状态、角色人设、关系边界和当前情绪，不要拆碎同一句话凑数。"
          ].filter(Boolean).join("\n")
        })
      }
    ];
  }

  async function sendChatRequest(character, chatHistory) {
    return sendConfiguredChatMessages(buildMessages(character, chatHistory));
  }

  function formatWorldBookPromptContext(entries, options) {
    var settings = options || {};
    var limit = Number(settings.limit) || 10;
    var maxEntryLength = Number(settings.maxEntryLength) || 500;
    var maxTotalLength = Number(settings.maxTotalLength) || 3500;
    var totalLength = 0;
    var list = Array.isArray(entries) ? entries : [];

    if (!list.length) {
      return "";
    }

    var strongCount = list.filter(function (e) { return !e.alwaysActive; }).length;
    var bgCount = list.filter(function (e) { return !!e.alwaysActive; }).length;
    var countDesc = strongCount > 0
      ? "强规则 " + strongCount + " 条" + (bgCount > 0 ? "、背景规则 " + bgCount + " 条" : "")
      : "常驻背景 " + bgCount + " 条";

    return ["命中 " + list.length + " 条当前世界规则（" + countDesc + "）；下面是角色正在经历的现实约束，按重要度排序。回复时遵守并自然表现，不要照抄或解释来源。"].concat(
      list.slice(0, limit).map(function (entry, index) {
        var content = limitText(entry.content, maxEntryLength);
        var insertPosition = entry.insertPosition === "after" ? "after / 后置补充" : "before / 前置世界规则";
        var isBackground = !!entry.alwaysActive;
        totalLength += content.length;

        if (totalLength > maxTotalLength) {
          content = limitText(content, Math.max(0, maxEntryLength - (totalLength - maxTotalLength)));
        }

        return [
          (index + 1) + ". 现实规则：" + (entry.title || entry.bookName || "未命名规则"),
          "生效方式：" + insertPosition,
          "命中类型：" + (entry.matchType || "上下文命中"),
          "触发线索：" + (entry.keywords || []).join("、"),
          "优先级/命中度：" + (entry.matchScore || entry.priority || 0),
          "规则强度：" + (isBackground ? "背景规则" : "强规则"),
          "必须遵守的现实内容：" + content,
          "本轮可见影响要求：" + (isBackground
            ? "作为背景底色，轻微影响角色的态度、措辞或边界感，不要过度表演。"
            : "这条规则至少影响称呼、动作、边界、回避、靠近、透露、拒绝、试探中的一项。")
        ].join("\n");
      })
    ).join("\n\n");
  }

  function buildWorldBookContext(contextText, scope, targetId, options) {
    return resolveWorldBookPromptContext(scope, targetId, contextText, options || {}).worldBookContext;
  }

  function debugWorldBookMatch(scope, targetId, contextText, entries, options) {
    var source = options || {};
    var debugEnabled = false;
    var selectedIds;
    var hasSelected;
    var matchedCount;

    debugEnabled = isMyAiAppDebugEnabled("debugWorldBook");

    if (!window.console) {
      return;
    }

    selectedIds = normalizeWorldBookIdList(source.selectedWorldBookIds || source.allowedBookIds || []);
    hasSelected = selectedIds.length > 0;
    matchedCount = Array.isArray(entries) ? entries.length : 0;

    if (!debugEnabled) {
      return;
    }

    if (!hasSelected && console.warn) {
      console.warn("[WorldBook Warning] 当前聊天未绑定世界书。scope=" + scope + " targetId=" + String(targetId || ""));
    } else if (hasSelected && matchedCount === 0 && console.warn) {
      console.warn("[WorldBook Warning] 已绑定世界书但本轮未命中，请检查关键词、alwaysOn、角色关联或上下文构造。scope=" + scope + " targetId=" + String(targetId || "") + " selectedIds=" + selectedIds.join(","));
    }

    if (!console.debug) {
      return;
    }

    console.debug("[WorldBook Debug]", {
      scope: scope,
      targetId: String(targetId || ""),
      selectedWorldBookIds: selectedIds,
      selectedCount: selectedIds.length,
      hasSelectedWorldBooks: hasSelected,
      matchedCount: matchedCount,
      reason: !hasSelected ? "未绑定世界书" : (matchedCount > 0 ? "已命中" : "已绑定但未命中"),
      contextPreview: limitText(contextText, 300),
      entries: (Array.isArray(entries) ? entries : []).map(function (entry) {
        return {
          title: entry.title || entry.bookName || "",
          keywords: entry.keywords || [],
          matchType: entry.matchType || "",
          priority: Number(entry.priority) || 0,
          matchScore: Number(entry.matchScore) || 0,
          contentPreview: limitText(entry.content, 80)
        };
      })
    });
  }

  function debugWorldBookAssimilation(report) {
    if (!isMyAiAppDebugEnabled("debugWorldBook") || typeof console === "undefined" || !console.debug) {
      return;
    }

    try {
      console.debug("[WorldBookAssimilationDebug]", report);
    } catch (error) {
      /* ignore */
    }
  }

  function isMyAiAppDebugEnabled(flag) {
    try {
      return typeof window !== "undefined"
        && window.localStorage
        && window.localStorage.getItem("myAiApp." + String(flag)) === "1";
    } catch (error) {
      return false;
    }
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
      /根据世界书/,
      /世界书写着/,
      /世界书(?:里|中|说)/,
      /设定里(?:写|说|规定|有)/,
      /按设定/,
      /这个世界(?:里|中|观)/,
      /系统要求/,
      /条目写着/,
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
    return /站那儿|别动|骗我|又骗|过来|我没说|你敢|嗯？|是吗|装什么|还装|听我的|少拿|别嘴硬|我不信|别试我|按我说|啧|行啊|又来|你倒是|少顶嘴|站住|坐好|收住|闭嘴|别走|不问了|账先记着/.test(String(text || ""));
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

  function filterAiMessageText(text, options) {
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
        if (options && isOnlineReplyMode(options) && hasTemplateInterrogationTone(part)) {
          return false;
        }
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

  function normalizeAiMessageText(text, options) {
    var source = options || {};
    var role = String(source.role || source.sender || "").toLowerCase();
    var type = String(source.type || "").toLowerCase();
    var value = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    var paragraphs;

    if (!value) {
      return "";
    }

    if (role === "user" || type === "user" || type === "offlineuseraction") {
      return value;
    }

    value = filterAiMessageText(value, options);
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
      var typeLabel = memory.type === "auto"
        ? "自动总结"
        : memory.type === "outing"
          ? "近期共同经历"
          : "手动添加";
      return [
        (index + 1) + ". " + (memory.title || "记忆"),
        "类型：" + typeLabel,
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

    var sourceText = String(options.memorySummarySourceText || "").trim();

    return [
      "H. 自动记忆总结",
      "当前聊天已达到自动总结轮次：" + (options.memorySummaryRounds || 10) + " 轮。",
      sourceText
        ? "下面是本次应总结的聊天范围，必须主要总结这些内容，而不是只总结最后一轮：\n" + sourceText
        : "本次没有拿到完整总结范围，请根据最近上下文总结，但不要只写最后一轮。",
      "总结目标：概括这 " + (options.memorySummaryRounds || 10) + " 轮里对关系、承诺、边界、习惯、冲突、重要事件、世界书影响、身体状态或金钱往来有长期价值的内容。",
      "不要流水账，不要把普通寒暄写进去。",
      "不要只总结最后一条消息。",
      "如果这 " + (options.memorySummaryRounds || 10) + " 轮里发生了多个阶段，请按阶段压缩成 2-5 个要点。",
      "标题短一点，正文保留情绪变化、事实和关系后果。",
      "请在本轮同一次 JSON 中返回 memorySummary。"
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
    var effectiveRegenerateInstruction = String(requestOptions.regenerateInstruction || "").trim();
    if (requestOptions.regenerateRequest && !effectiveRegenerateInstruction) {
      effectiveRegenerateInstruction = "用户没有填写具体要求，但点击重回代表上一版不满意；请明显换一个方向、语气和推进方式，不要同义复述。";
    }
    var messages = buildPrivateReplyMessages(character, chatHistory, requestOptions);
    var rawContent = await sendConfiguredChatMessages(messages);
    var parsed = parseJsonFromText(rawContent);
    var replies = getOutputMessages(parsed);
    var normalizationSettings = {
      replies: replies,
      min: MIN_CHAT_REPLY_COUNT,
      max: MAX_CHAT_REPLY_COUNT,
      defaultType: "text",
      allowRawFallback: false,
      onlineMode: true,
      fallbackProfile: buildReplyFallbackProfile(character),
      previousReplyText: requestOptions.previousReplyText,
      rejectedReplyText: requestOptions.rejectedReplyText,
      worldBookContext: requestOptions.worldBookContext,
      latestUserInput: requestOptions.latestUserInput,
      recentHeartVoiceText: requestOptions.recentHeartVoiceText,
      thoughtsHint: requestOptions.thoughtsHint,
      recentCharacterLinesText: requestOptions.recentCharacterLinesText
    };
    var normalized = normalizeAiResult(rawContent, parsed, normalizationSettings);
    var regenerateDiff = requestOptions.regenerateRequest ? checkRegenerateDifference(
      requestOptions.rejectedReplyText || requestOptions.oldReplyText,
      normalized.replies || replies || messages
    ) : null;
    var coverage = checkOnlineIntentCoverage(requestOptions.latestUserInput, normalized.replies);
    var repaired = false;
    var templateToneCountBefore = countTemplateTone(normalized.replies);
    var templateToneCountAfter = templateToneCountBefore;
    var removedTemplateMessages = 0;

    if (regenerateDiff && !regenerateDiff.ok) {
      var similarityRepairMessages = await repairOnlineMessages(Object.assign({}, requestOptions, {
        mode: "private",
        regenerateRequest: requestOptions.regenerateRequest,
        regenerateInstruction: effectiveRegenerateInstruction,
        rejectedReplyText: requestOptions.rejectedReplyText,
        oldReplyText: requestOptions.oldReplyText,
        latestUserInput: requestOptions.latestUserInput,
        worldBookContext: requestOptions.worldBookContext,
        characterPersonaText: [
          "角色名：" + valueOrFallback(character.name),
          buildMergedCharacterPersona(character)
        ].join("\n")
      }), normalized.replies || replies || messages, "regenerate-too-similar");

      if (Array.isArray(similarityRepairMessages) && similarityRepairMessages.length) {
        normalized.replies = normalizeReplyList("", similarityRepairMessages, normalizationSettings);
        regenerateDiff = checkRegenerateDifference(
          requestOptions.rejectedReplyText || requestOptions.oldReplyText,
          normalized.replies || replies || messages
        );
        repaired = true;
      }

      if (regenerateDiff && !regenerateDiff.ok) {
        var similarityCleaned = filterOnlineTemplateReplies(normalized.replies);
        if (similarityCleaned.length) {
          normalized.replies = similarityCleaned;
        }
      }
    }

    if (!coverage.ok) {
      var repairMessages = await repairOnlineMessages({
        mode: "private",
        latestUserInput: requestOptions.latestUserInput,
        worldBookContext: requestOptions.worldBookContext,
        characterPersonaText: [
          "角色名：" + valueOrFallback(character.name),
          buildMergedCharacterPersona(character)
        ].join("\n")
      }, normalized.replies, coverage.reason);

      if (Array.isArray(repairMessages) && repairMessages.length) {
        normalized.replies = normalizeReplyList("", repairMessages, normalizationSettings);
        repaired = true;
        coverage = checkOnlineIntentCoverage(requestOptions.latestUserInput, normalized.replies);
      }
    }

    if (!coverage.ok) {
      var cleaned = filterOnlineTemplateReplies(normalized.replies);
      if (cleaned.length) {
        removedTemplateMessages = normalized.replies.length - cleaned.length;
        templateToneCountAfter = countTemplateTone(cleaned);
        normalized.replies = cleaned;
      }
      if (!normalized.replies.length) {
        normalized.replies = [{ type: "text", content: "这次没回出来，换个方式重试一下。" }];
      }
    }

    debugOnlineLogicReport({
      mode: "private",
      targetId: character && character.id,
      userInput: requestOptions.latestUserInput,
      intent: coverage.intent,
      rawMessageCount: replies.length,
      normalizedMessageCount: normalized.replies.length,
      templateToneCountBefore: templateToneCountBefore,
      templateToneCountAfter: templateToneCountAfter,
      templateToneCount: coverage.templateCount,
      intentCovered: coverage.ok,
      qualityReason: coverage.reason,
      regenerateRequest: !!requestOptions.regenerateRequest,
      regenerateInstruction: requestOptions.regenerateInstruction || effectiveRegenerateInstruction || "",
      regenerateSimilarity: regenerateDiff ? regenerateDiff.similarity : null,
      regenerateDifferentEnough: regenerateDiff ? regenerateDiff.ok : null,
      repaired: repaired,
      removedTemplateMessages: removedTemplateMessages
    });

    return normalized;
  }

  function buildPersonaCountHint(profile) {
    var voiceProfile = detectPersonaVoiceProfile(profile || {});
    var tags = voiceProfile.tags || [];
    var has = function (tag) { return tags.indexOf(tag) !== -1; };

    if (has("cold") || has("hostile")) {
      return "这个角色话少也必须给出至少 10 条短气泡；用更短、更冷、更有停顿的句子保持人设，不要用废话凑数。";
    }
    if (has("tsundere")) {
      return "这个角色嘴硬也必须给出至少 10 条短气泡；用绕弯、反问、改口和不承认来推进，不要直接长篇解释。";
    }
    if (has("shy")) {
      return "这个角色害羞局促也必须给出至少 10 条短气泡；可以犹豫、停顿、改口、半句，但每条都要有独立情绪。";
    }
    if (has("strong") || has("formal")) {
      return "这个角色强势也必须给出至少 10 条短气泡；用判断、安排、压节奏和边界感推进，不要变成说明文。";
    }
    if (has("clingy") || has("gentle")) {
      return "按角色关系给出至少 10 条自然气泡，可以追问、黏着、关心，但每条要有独立情感推进，不要换句复读。";
    }
    return "按角色人设和当前情绪，给出至少 10 条自然短气泡；每条都要有独立情绪或关系推进，不要为了凑数变成话痨。";
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
    var effectiveRegenerateInstruction = String(requestOptions.regenerateInstruction || "").trim();
    if (requestOptions.regenerateRequest && !effectiveRegenerateInstruction) {
      effectiveRegenerateInstruction = "用户没有填写具体要求，但点击重回代表上一版不满意；请明显换一个方向、语气和推进方式，不要同义复述。";
    }
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
    if (window.AppExtras && window.AppExtras.buildMemoryContextPack && profile.id) {
      var _memPack = window.AppExtras.buildMemoryContextPack("private", profile.id, {
        latestUserInput: latestUserInput,
        regenerateRequest: requestOptions.regenerateRequest
      });
      requestOptions.memoryContextPack = _memPack;
      requestOptions.memoryContextText = window.AppExtras.formatMemoryContextPack
        ? window.AppExtras.formatMemoryContextPack(_memPack)
        : "";
    }
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
    var worldBookResolved = resolveWorldBookPromptContext("private", profile && profile.id, contextText, {
      selectedWorldBookIds: selectedWorldBookIds,
      relatedTargetIds: profile && profile.id ? [profile.id] : [],
      characterIds: profile && profile.id ? [profile.id] : []
    });
    var worldBookContext = worldBookResolved.worldBookContext;
    var worldBookMeta = worldBookResolved.worldBookMeta;
    var matchedWorldBookEntries = worldBookResolved.matchedEntries;
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

    requestOptions.worldBookResolved = worldBookResolved;
    requestOptions.worldBookContext = worldBookContext;
    requestOptions.selectedWorldBookIds = selectedWorldBookIds;
    requestOptions.worldBookMeta = worldBookMeta;
    requestOptions.matchedWorldBookEntries = matchedWorldBookEntries;
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
          buildWorldRuleEnforcement(worldBookContext, worldBookMeta),
          buildMatchedWorldBooksSection(worldBookContext, worldBookMeta),
          buildPromptPriorityHint(profile),
          buildWorldPersonaMessageLock(worldBookContext, systemMode),
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
          buildRelationshipDriveRules("private"),
          buildRegenerateRewriteRules(systemMode, {
            regenerateRequest: requestOptions.regenerateRequest,
            regenerateInstruction: effectiveRegenerateInstruction,
            rejectedReplyText: requestOptions.rejectedReplyText,
            oldReplyText: requestOptions.oldReplyText
          }),
          buildRelationshipProgressionRules("private"),
          buildCharacterDecisionCore(systemMode, worldBookContext),
          buildOnlineConversationLogicRules(systemMode),
          recentHeartVoiceText,
          buildLongRangeMemoryContextSection(requestOptions),
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
          buildCharacterPersonaReminder(profile)
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
            "本轮 messages 必须至少 " + MIN_CHAT_REPLY_COUNT + " 条；每条都要单独符合世界书状态、角色人设、关系边界和当前情绪，不要拆碎同一句话凑数。",
            "可用默认 emoji：😀 😭 😍 🤔 😡 👍 ❤️ 🎉；用户导入表情包数量：" + getImportedEmojiCount()
          ].filter(Boolean).join("\n")
        })
      }
    ];
  }

  function buildGroupWorldPersonaLock(characters, worldBookContext, worldBookMeta) {
    var hasWorld = Boolean(String(worldBookContext || "").trim());
    var matchedCount = worldBookMeta && Number(worldBookMeta.matchedCount) || 0;
    var members = (Array.isArray(characters) ? characters : []).map(function (character) {
      return [
        "角色：" + valueOrFallback(character && character.name) + " / " + valueOrFallback(character && character.id),
        "人设原文：" + valueOrFallback(buildMergedCharacterPersona(character)),
        "语气证据：" + (extractPersonaEvidence(character).join(" / ") || "按完整人设判断"),
        "语气标签：" + (detectPersonaVoiceProfile(character || {}, worldBookContext || "").tags.join(" / ") || "无明确标签")
      ].join("\n");
    }).join("\n\n");

    return [
      "",
      "D++. 群聊世界书与人设锁 groupWorldPersonaLock",
      "这是群聊生成的硬约束，不是建议。",
      "群聊里的每个角色都必须先用自己的身份、人设、关系位置和最近情绪理解世界书；不能共用一个通用人格。",
      hasWorld
        ? "本轮世界书已命中 " + matchedCount + " 条。命中规则必须影响至少 2 条可见 messages，影响方式可以是称呼、边界、回避、沉默、拒绝、靠近、转移、顾左右而言他、帮腔、拆台、压场或不敢说。"
        : "本轮没有命中世界书条目；不要编世界书内容，但如果当前聊天绑定了世界书且未命中，可以自然追问用户指哪条规则/哪件事。",
      "世界书不是资料，不要复述来源；角色只会像真的活在这些规则里一样反应。",
      "如果世界书限制某件事不能说，群成员不能直接把秘密讲出来；应按各自人设选择回避、含糊、打断、警告、装不知道、转移或沉默。",
      "如果世界书影响身份差、师门规矩、禁忌、关系边界、场景事实，至少一个群成员要明显被它牵动，另一个群成员可以帮腔、质疑、拆台或沉默。",
      "如果去掉 characterName 后分不出是谁说的，失败。",
      "如果命中世界书但 messages 完全看不出影响，失败。",
      "",
      "群成员人设锁：",
      members || "暂无成员"
    ].join("\n");
  }

  function buildGroupPromptPriorityHint(characters, worldBookContext, worldBookMeta) {
    var hasWorld = Boolean(String(worldBookContext || "").trim());
    var characterHints = (Array.isArray(characters) ? characters : []).map(function (character) {
      var evidence = extractPersonaEvidence(character);
      var tags = detectPersonaVoiceProfile(character || {}, worldBookContext || "").tags;
      return valueOrFallback(character && character.name) + "：" +
        (evidence.length ? "声音证据「" + evidence.slice(0, 2).join("」「") + "」" : "按完整人设") +
        (tags.length ? "；语气标签【" + tags.slice(0, 3).join("、") + "】" : "");
    }).join("\n");

    return [
      "",
      "群聊本轮最重要的输入优先级：",
      "1. 已命中的世界书强规则、禁忌、身份边界、场景事实。",
      "2. 每个发言角色自己的核心人设、身份、关系位置和说话方式。",
      "3. 本轮用户输入。",
      "4. 最近群聊时间线、私聊互通、连续记忆包。",
      "5. 最近心声和长期记忆。",
      hasWorld
        ? "本轮已命中世界书：至少 2 条可见 messages 必须体现世界书影响，但不能说'世界书/设定要求'。"
        : "本轮未命中世界书：不要编世界书规则，只按人设、关系、记忆和用户输入推进。",
      "群聊失败条件：所有角色像同一个人、只换名字；或所有人都温柔解释；或命中世界书却没人受到影响。",
      "逐角色提醒：",
      characterHints || "暂无"
    ].join("\n");
  }

  function checkGroupPersonaWorldBookQuality(messages, characters, worldBookContext, worldBookMeta, latestUserInput) {
    var list = Array.isArray(messages) ? messages : [];
    var hasWorld = Boolean(String(worldBookContext || "").trim()) || Boolean(worldBookMeta && worldBookMeta.hasMatchedEntries);
    var userNeedsWorld = /世界书|设定|规则|师门|门规|禁忌|身份|不能说|为什么/.test(String(latestUserInput || ""));
    var characterMap = {};
    var speakerCounts = {};
    var personaHits = {};
    var worldImpactCount = 0;
    var genericCount = 0;

    (Array.isArray(characters) ? characters : []).forEach(function (character) {
      if (character && character.id) {
        characterMap[String(character.id)] = character;
        personaHits[String(character.id)] = 0;
        speakerCounts[String(character.id)] = 0;
      }
    });

    list.forEach(function (message) {
      var speakerId = String(message && (message.characterId || message.senderId || "") || "");
      var text = String(message && message.content || "");
      var character = characterMap[speakerId];
      var evidence = extractPersonaEvidence(character || {}).join("|");
      var voiceTags = detectPersonaVoiceProfile(character || {}, worldBookContext || "").tags.join("|");

      if (speakerId) {
        speakerCounts[speakerId] = (speakerCounts[speakerId] || 0) + 1;
      }

      if (character && (
        (evidence && new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(text))
        || /冷|淡|强|压|嘴硬|别扭|黏|逗|讽|试探|克制|沉默|短句|不许|站住|过来|算了|随你|我不信|啧/.test(text)
      )) {
        personaHits[speakerId] = (personaHits[speakerId] || 0) + 1;
      }

      if (/我理解|如果你愿意|可以告诉我|慢慢来|没关系|你还好吗|我会陪着你|我们可以一起/.test(text)) {
        genericCount += 1;
      }

      if (/不能说|不该问|规矩|师门|门里|旧规|禁忌|别提|闭嘴|换个说法|你听谁|这事不是这么问|我没法直说|别在群里说|先别说这个|有人会听见|到此为止|别碰这条线|你指哪条/.test(text)) {
        worldImpactCount += 1;
      }
    });

    var activeSpeakers = Object.keys(speakerCounts).filter(function (id) {
      return speakerCounts[id] > 0;
    });
    var personaSpeakerCount = Object.keys(personaHits).filter(function (id) {
      return personaHits[id] > 0;
    }).length;

    if (genericCount >= 4) {
      return { ok: false, reason: "too-generic-assistant-tone", worldImpactCount: worldImpactCount, personaSpeakerCount: personaSpeakerCount };
    }

    if (activeSpeakers.length >= 2 && personaSpeakerCount === 0) {
      return { ok: false, reason: "group-persona-not-distinct", worldImpactCount: worldImpactCount, personaSpeakerCount: personaSpeakerCount };
    }

    if (hasWorld && userNeedsWorld && worldImpactCount < 1) {
      return { ok: false, reason: "worldbook-impact-not-visible", worldImpactCount: worldImpactCount, personaSpeakerCount: personaSpeakerCount };
    }

    return { ok: true, reason: "ok", worldImpactCount: worldImpactCount, personaSpeakerCount: personaSpeakerCount };
  }

  function buildGroupSystemPrompt(group, characters, sharedMemories, options) {
    var userContext = buildUserContext(group && group.settings || {});
    var requestOptions = options || {};
    var chatMemories = getChatMemoriesForPrompt("group", group && group.id, requestOptions.chatMemories);
    var latestUserInput = requestOptions.latestUserInput || "";
    var selectedWorldBookIds = getSelectedWorldBookIds("group", group && group.id, requestOptions);
    var worldBookResolved = requestOptions.worldBookResolved;
    var participantPersonaText = (characters || []).map(function (character) {
      return [
        "群成员：" + character.name,
        "成员人设：" + buildMergedCharacterPersona(character),
        "成员长期记忆：" + formatMemoryList(sharedMemories && sharedMemories[character.id] || [])
      ].join("\n");
    }).join("\n");
    var resolvedWorldBookContext = (worldBookResolved && worldBookResolved.worldBookContext)
      || requestOptions.worldBookContext;
    if (!resolvedWorldBookContext) {
      resolvedWorldBookContext = resolveWorldBookPromptContext(
        "group",
        group && group.id,
        buildWorldBookDecisionContext({
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
        }),
        {
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
        }
      ).worldBookContext;
    }
    var worldBookMeta = (worldBookResolved && worldBookResolved.worldBookMeta)
      || requestOptions.worldBookMeta
      || buildWorldBookPromptMeta(selectedWorldBookIds, requestOptions.matchedWorldBookEntries);

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

    debugWorldBookAssimilation({
      mode: "group",
      targetId: group && group.id,
      latestUserInput: latestUserInput,
      hasWorldBookContext: Boolean(resolvedWorldBookContext),
      matchedCount: worldBookMeta && worldBookMeta.hasMatchedEntries,
      worldBookPreview: String(resolvedWorldBookContext || "").slice(0, 500),
      ruleInjected: true
    });

    return [
      buildSystemBase("group"),
      buildLivingCharacterImmersionRules("group"),
      buildWorldBookAssimilationRules(resolvedWorldBookContext, worldBookMeta, "group"),
      buildAntiExplanationRules("group"),
      buildWorldRuleEnforcement(resolvedWorldBookContext, worldBookMeta),
      buildMatchedWorldBooksSection(resolvedWorldBookContext, worldBookMeta),
      buildGroupPromptPriorityHint(characters, resolvedWorldBookContext, worldBookMeta),
      buildWorldPersonaMessageLock(resolvedWorldBookContext, groupMode),
      buildGroupWorldPersonaLock(characters, resolvedWorldBookContext, worldBookMeta),
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
      buildRelationshipDriveRules("group"),
      buildRelationshipProgressionRules("group"),
      buildCharacterDecisionCore(groupMode, resolvedWorldBookContext),
      buildOnlineConversationLogicRules(groupMode),
      buildRegenerateRewriteRules(groupMode, {
        regenerateRequest: requestOptions.regenerateRequest,
        regenerateInstruction: effectiveRegenerateInstruction,
        rejectedReplyText: requestOptions.rejectedReplyText,
        oldReplyText: requestOptions.oldReplyText
      }),
      recentHeartVoiceText,
      buildLongRangeMemoryContextSection(requestOptions),
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
      (characters || []).map(function (character) { return buildCharacterResourceWhitelist(character); }).filter(Boolean).join("\n\n")
    ].filter(Boolean).join("\n");
  }

  async function sendGroupChatRequest(group, characters, groupHistory, sharedMemories, options) {
    var requestOptions = options || {};
    var effectiveRegenerateInstruction = String(requestOptions.regenerateInstruction || "").trim();
    if (requestOptions.regenerateRequest && !effectiveRegenerateInstruction) {
      effectiveRegenerateInstruction = "用户没有填写具体要求，但点击重回代表上一版不满意；请明显换一个方向、语气和推进方式，不要同义复述。";
    }
    var messages = buildGroupMessages(group, characters, groupHistory, sharedMemories, requestOptions);
    var rawContent = await sendConfiguredChatMessages(messages);
    var parsed = parseJsonFromText(rawContent);
    var replyLimit = getGroupReplyLimit(group);
    var validIds = (characters || []).map(function (character) {
      return character.id;
    });
    var replies = getOutputMessages(parsed);
    var result;

    var normalizationSettings = {
      replies: replies,
      min: MIN_CHAT_REPLY_COUNT,
      max: replyLimit,
      defaultType: "text",
      allowRawFallback: false,
      onlineMode: true,
      fallbackProfiles: (characters || []).map(buildReplyFallbackProfile),
      previousReplyText: requestOptions.previousReplyText,
      rejectedReplyText: requestOptions.rejectedReplyText,
      worldBookContext: requestOptions.worldBookContext,
      latestUserInput: requestOptions.latestUserInput,
      recentHeartVoiceText: requestOptions.recentHeartVoiceText,
      thoughtsHint: requestOptions.thoughtsHint,
      recentCharacterLinesText: requestOptions.recentCharacterLinesText
    };
    result = normalizeAiResult(rawContent, parsed, normalizationSettings);
    var regenerateDiff = requestOptions.regenerateRequest ? checkRegenerateDifference(
      requestOptions.rejectedReplyText || requestOptions.oldReplyText,
      result.replies || replies || messages
    ) : null;

    var coverage = checkOnlineIntentCoverage(requestOptions.latestUserInput, result.replies);
    var groupPersonaWorldQuality = checkGroupPersonaWorldBookQuality(
      result.replies,
      characters,
      requestOptions.worldBookContext,
      requestOptions.worldBookMeta,
      requestOptions.latestUserInput
    );
    var repaired = false;
    var templateToneCountBefore = countTemplateTone(result.replies);
    var templateToneCountAfter = templateToneCountBefore;
    var removedTemplateMessages = 0;

    var repairReasons = [];
    if (regenerateDiff && !regenerateDiff.ok) {
      repairReasons.push("regenerate-too-similar");
    }
    if (!coverage.ok) {
      repairReasons.push(coverage.reason || "intent-not-covered");
    }
    if (!groupPersonaWorldQuality.ok) {
      repairReasons.push(groupPersonaWorldQuality.reason || "group-persona-worldbook-quality");
    }

    if (repairReasons.length) {
      var repairMessages = await repairOnlineMessages(Object.assign({}, requestOptions, {
        mode: "group",
        regenerateRequest: requestOptions.regenerateRequest,
        regenerateInstruction: effectiveRegenerateInstruction,
        rejectedReplyText: requestOptions.rejectedReplyText,
        oldReplyText: requestOptions.oldReplyText,
        latestUserInput: requestOptions.latestUserInput,
        worldBookContext: requestOptions.worldBookContext,
        worldBookMeta: requestOptions.worldBookMeta,
        matchedWorldBookEntries: requestOptions.matchedWorldBookEntries,
        participantPersonaText: (characters || []).map(function (character) {
          return [
            "群成员：" + valueOrFallback(character && character.name),
            "人设：" + buildMergedCharacterPersona(character),
            "语气标签：" + detectPersonaVoiceProfile(character || {}, requestOptions.worldBookContext || "").tags.join("/")
          ].join("\n");
        }).join("\n\n")
      }), result.replies || replies || messages, repairReasons.join(";"));

      if (Array.isArray(repairMessages) && repairMessages.length) {
        result.replies = normalizeReplyList("", repairMessages, normalizationSettings);
        repaired = true;
        regenerateDiff = requestOptions.regenerateRequest ? checkRegenerateDifference(
          requestOptions.rejectedReplyText || requestOptions.oldReplyText,
          result.replies || replies || messages
        ) : null;
        coverage = checkOnlineIntentCoverage(requestOptions.latestUserInput, result.replies);
        groupPersonaWorldQuality = checkGroupPersonaWorldBookQuality(
          result.replies,
          characters,
          requestOptions.worldBookContext,
          requestOptions.worldBookMeta,
          requestOptions.latestUserInput
        );
      }
    }

    if (regenerateDiff && !regenerateDiff.ok) {
      var similarityCleaned = filterOnlineTemplateReplies(result.replies);
      if (similarityCleaned.length) {
        result.replies = similarityCleaned;
      }
    }

    if (!coverage.ok) {
      var cleaned = filterOnlineTemplateReplies(result.replies);
      if (cleaned.length) {
        removedTemplateMessages = result.replies.length - cleaned.length;
        templateToneCountAfter = countTemplateTone(cleaned);
        result.replies = cleaned;
      }
      if (!result.replies.length) {
        result.replies = [{ type: "text", content: "这次没回出来，换个方式重试一下。" }];
      }
    }

    if (!groupPersonaWorldQuality.ok) {
      var gpCleaned = filterOnlineTemplateReplies(result.replies);
      if (gpCleaned.length) {
        result.replies = gpCleaned;
      }
    }

    if (localStorage.getItem("myAiApp.debugGroupPersona") === "1") {
      console.debug("[GroupPersonaDebug]", {
        groupId: group && group.id,
        latestUserInput: requestOptions.latestUserInput,
        speakers: Object.keys(result.replies.reduce(function (acc, r) {
          if (r && r.characterId) { acc[r.characterId] = true; }
          return acc;
        }, {})),
        personaSpeakerCount: groupPersonaWorldQuality.personaSpeakerCount,
        worldImpactCount: groupPersonaWorldQuality.worldImpactCount,
        qualityReason: groupPersonaWorldQuality.reason,
        repaired: repaired,
        worldBookMatched: requestOptions.worldBookMeta && requestOptions.worldBookMeta.hasMatchedEntries,
        matchedWorldBookEntries: (requestOptions.matchedWorldBookEntries || []).map(function (e) {
          return e && (e.title || e.keyword || e.id || "");
        })
      });
    }

    debugOnlineLogicReport({
      mode: "group",
      targetId: group && group.id,
      userInput: requestOptions.latestUserInput,
      intent: coverage.intent,
      rawMessageCount: replies.length,
      normalizedMessageCount: result.replies.length,
      templateToneCountBefore: templateToneCountBefore,
      templateToneCountAfter: templateToneCountAfter,
      templateToneCount: coverage.templateCount,
      intentCovered: coverage.ok,
      qualityReason: coverage.reason,
      regenerateRequest: !!requestOptions.regenerateRequest,
      regenerateInstruction: requestOptions.regenerateInstruction || effectiveRegenerateInstruction || "",
      regenerateSimilarity: regenerateDiff ? regenerateDiff.similarity : null,
      regenerateDifferentEnough: regenerateDiff ? regenerateDiff.ok : null,
      repaired: repaired,
      removedTemplateMessages: removedTemplateMessages
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
    var effectiveRegenerateInstruction = String(requestOptions.regenerateInstruction || "").trim();
    if (requestOptions.regenerateRequest && !effectiveRegenerateInstruction) {
      effectiveRegenerateInstruction = "用户没有填写具体要求，但点击重回代表上一版不满意；请明显换一个方向、语气和推进方式，不要同义复述。";
    }
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
    if (window.AppExtras && window.AppExtras.buildMemoryContextPack && group && group.id) {
      var _grpMemPack = window.AppExtras.buildMemoryContextPack("group", group.id, {
        latestUserInput: latestUserInput,
        regenerateRequest: requestOptions.regenerateRequest
      });
      requestOptions.memoryContextPack = _grpMemPack;
      requestOptions.memoryContextText = window.AppExtras.formatMemoryContextPack
        ? window.AppExtras.formatMemoryContextPack(_grpMemPack)
        : "";
    }
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
    var worldBookResolved = resolveWorldBookPromptContext("group", group && group.id, contextText, {
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
    var worldBookContext = worldBookResolved.worldBookContext;
    var worldBookMeta = worldBookResolved.worldBookMeta;
    var matchedWorldBookEntries = worldBookResolved.matchedEntries;
    requestOptions.worldBookResolved = worldBookResolved;
    requestOptions.worldBookContext = worldBookContext;
    requestOptions.selectedWorldBookIds = selectedWorldBookIds;
    requestOptions.worldBookMeta = worldBookMeta;
    requestOptions.matchedWorldBookEntries = matchedWorldBookEntries;
    requestOptions.recentHistory = history;
    requestOptions.recentWorldHistory = worldHistory;
    requestOptions.latestUserInput = latestUserInput;
    requestOptions.recentCharacterLinesText = recentCharacterLinesText;
    requestOptions.recentCharacterLinesMap = recentCharacterLinesMap;
    requestOptions.timeGapText = timeGapInfo;
    requestOptions.timeGapInfo = timeGapInfo;
    requestOptions.privateBridgeText = privateBridgeText;

    if (localStorage.getItem("myAiApp.debugWorldBook") === "1") {
      console.debug("[WorldBook Debug][group prompt final]", {
        groupId: group && group.id,
        selectedWorldBookIds: selectedWorldBookIds,
        matchedCount: worldBookMeta && worldBookMeta.matchedCount,
        hasMatchedEntries: worldBookMeta && worldBookMeta.hasMatchedEntries,
        reason: worldBookMeta && worldBookMeta.reason,
        worldBookContextPreview: String(worldBookContext || "").slice(0, 800),
        memberIds: (characters || []).map(function (c) { return c && c.id; })
      });
    }

    groupSettingsText = group && group.settings
      ? [
        "群公告：" + (group.settings.announcement || "暂无"),
        "本群每次最少回复条数：" + Math.max(MIN_CHAT_REPLY_COUNT, Number(group.settings.minReplyCount) || 0) + "（本轮硬性至少 " + MIN_CHAT_REPLY_COUNT + " 条有真实内容的自然消息）",
        "本群每次最多安全条数：" + Math.max(MIN_CHAT_REPLY_COUNT, Number(group.settings.maxReplyCount) || 12),
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
          worldBookMeta: worldBookMeta,
          matchedWorldBookEntries: matchedWorldBookEntries,
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
            "冷淡角色可以只短短发一句甚至沉默不发言；强势角色可以压场；话多角色可以多说；嘴硬角色绕着说；与本轮用户输入和世界书无关的角色可以不发言，不要为了凑 10 条让所有角色都变话痨。",
            "如果最近用户在群里发了红包或转账，群成员要按各自人设决定收下或退回；可在 JSON 顶层返回 moneyDecisions 数组，也可返回 transferDecision 或 redPacketDecision，值只能是 accept、reject 或 null。",
            "如果后续旧规则提到可以少回或返回空数组，请忽略；本轮必须保留至少 10 条有真实内容的自然消息，不要靠拆碎同一句话凑数。",
            "可用默认 emoji：😀 😭 😍 🤔 😡 👍 ❤️ 🎉；用户导入表情包数量：" + getImportedEmojiCount(),
            "【群聊人设与世界书硬检查】",
            "1. 每个发言角色都必须先看自己的角色人设、语气指纹和最近心声，再决定说不说、怎么说。",
            "2. 不允许所有群成员用同一种语气、同一种句式、同一种态度。",
            "3. 如果本轮世界书已命中条目，至少 2 条 messages 要体现世界书影响；可以是称呼、回避、沉默、打断、拒绝、帮腔、拆台、压场、转移。",
            "4. 如果世界书限制透露身份/秘密/规则，不允许直接说破；要让角色按人设自然回避或半透露。",
            "5. 如果某个角色人设冷淡，可以少说但不能变客服；强势角色可以压场但不能替用户发言；嘴硬角色不能直接说明文；温柔角色也不能变成通用助手。",
            "6. 输出前自检：去掉 characterName 后，还能分辨每句话是谁说的吗？如果不能，重写。",
            "7. 输出前自检：命中世界书时，回复里是否能看出至少一种现实边界或规则影响？如果不能，重写。"
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

    var previousCallbackCount = countOfflinePreviousCallbackTemplates(normalizedEvents);
    var userInputTextInline = String(context.userInput || "").trim();
    var allowPreviousCallbackInline = hasOfflineRecallIntent(userInputTextInline);

    if (previousCallbackCount > 0 && !allowPreviousCallbackInline) {
      var repairedCallbackEvents = await repairOfflineEvents(
        Object.assign({}, context, { offlineRepairReason: "offline-overuses-previous-callback" }),
        normalizedEvents,
        "offline-overuses-previous-callback"
      );
      if (repairedCallbackEvents && repairedCallbackEvents.length) {
        normalizedEvents = repairedCallbackEvents;
      } else {
        normalizedEvents = normalizedEvents.filter(function (event) {
          return !hasOfflinePreviousCallbackTemplate(event && event.content);
        });
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

  function hasOfflineRecallIntent(text) {
    return /刚才|刚刚|之前|前面|上一轮|上次|继续|接着|那句话|那个动作|刚才那股|气势|上一题|最后一道题|刚才说到/.test(String(text || ""));
  }

  function hasMeaningfulOfflineUserInput(text) {
    var value = String(text || "").trim();
    if (!value) return false;
    if (/^(继续|推进|下一步|然后呢|接着)$/i.test(value)) return false;
    return value.length > 0;
  }

  function buildOfflineCurrentInputPriorityRules(userInput) {
    var input = String(userInput || "").trim();
    var hasRecall = hasOfflineRecallIntent(input);
    var hasNewInput = hasMeaningfulOfflineUserInput(input);

    return [
      "",
      "【线下当前输入优先 currentOfflineInputPriority】",
      "线下模式要保持场景连续，但不能每轮默认翻旧账。",
      "本轮用户输入：" + (input || "无明确输入"),
      hasNewInput
        ? "用户本轮给了新的输入。角色必须优先回应这句话本身，不要自动回到上一轮的气势、上一道题、刚才的样子。"
        : "用户本轮没有明确新内容，可以自然延续当前场景，但也不要复读上一轮台词。",
      hasRecall
        ? "用户明确提到了刚才/继续/上一题/气势等，可以承接前文，但仍然要换说法，不要复读同一种追问。"
        : "用户没有明确提到刚才、继续、上一题或气势时，禁止主动使用'刚才那股气势去哪了'这类追旧账句式。",
      "角色可以记得上一轮，但只能把它当作背景状态，不要每轮都拿出来质问用户。",
      "如果要承接前文，优先承接动作、距离、物品、场景状态；少用'刚才你怎样怎样'这种台词。",
      "如果用户本轮输入是一个新动作、新问题、新情绪，第一反应必须落到新输入上。",
      "禁止默认句式：'刚才……去哪了'、'刚才那股气势……'、'刚才那样不是很……吗'、'这会儿倒是……'。"
    ].join("\n");
  }

  function hasOfflinePreviousCallbackTemplate(text) {
    return /刚才.{0,18}(气势|样子|劲儿|架势|模样).{0,12}(哪|去|没了|不见)|刚才.{0,16}怎么.{0,10}不|这会儿倒是|刚才.{0,12}不是.{0,12}吗|刚才.{0,12}挺/.test(String(text || ""));
  }

  function countOfflinePreviousCallbackTemplates(events) {
    return (Array.isArray(events) ? events : []).reduce(function (count, event) {
      return count + (hasOfflinePreviousCallbackTemplate(event && event.content) ? 1 : 0);
    }, 0);
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
      "用户没有输入新动作时，可以推进当前场景里的动作、距离、沉默、话题和情绪，不要重开一幕。",
      "场景连续指时间、地点、站位、动作状态连续，不等于台词每轮都翻旧账。"
    ].filter(Boolean).join("\n");
  }

  function buildOfflineCausalLogicRules() {
    return [
      "",
      "线下因果逻辑规则 offlineCausalLogic",
      "线下不是随机发台词，而是连续场景。",
      "每一轮必须先确定：用户刚做了什么/说了什么 → 角色看见或听懂了什么 → 角色为什么这样反应 → 动作如何导致下一句台词。",
      "events 必须形成因果链：上一条 action/speech 会影响下一条 action/speech。",
      "禁止每条台词互相独立，禁止每条都像从模板池抽出来。",
      "如果用户问问题，至少前 3 条 event 要围绕这个问题本身展开：听见问题、判断能不能答、给出回答/回避/追问。",
      "如果角色转移话题，必须有理由：不愿说、不能说、被戳中、场景不允许、世界书限制、关系紧张等。",
      "不能无理由从用户的问题跳到‘你在躲我/别绕/继续说’。",
      "action 不能只是‘靠近/垂眼/停顿’随机堆叠；必须承接上一条台词或用户行为。",
      "speech 不能只承担人设展示，也要推进当前问题或当前动作。"
    ].join("\n");
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
    if (window.AppExtras && window.AppExtras.buildMemoryContextPack && context.targetId) {
      var _inlineMemPack = window.AppExtras.buildMemoryContextPack(mode, context.targetId, {
        latestUserInput: context.userInput || "",
        regenerateRequest: context.regenerateRequest
      });
      context.memoryContextPack = _inlineMemPack;
      context.memoryContextText = window.AppExtras.formatMemoryContextPack
        ? window.AppExtras.formatMemoryContextPack(_inlineMemPack)
        : "";
    }
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
    var worldBookResolved = context.worldBookResolved || resolveWorldBookPromptContext(
      mode === "group" ? "group" : "private",
      context.targetId || "",
      contextText,
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
        }).filter(Boolean) : []
      }
    );
    var worldBookContext = context.worldBookContext || worldBookResolved.worldBookContext;
    var worldBookMeta = context.worldBookMeta || worldBookResolved.worldBookMeta || buildWorldBookPromptMeta(selectedWorldBookIds, worldBookResolved.matchedEntries);
    context.worldBookContext = worldBookContext;
    context.selectedWorldBookIds = selectedWorldBookIds;
    context.worldBookResolved = worldBookResolved;
    context.worldBookMeta = worldBookMeta;
    context.recentCharacterLinesText = recentCharacterLinesText;
    context.recentCharacterLinesMap = recentCharacterLinesMap;
    context.timeGapText = timeGapInfo;
    context.timeGapInfo = timeGapInfo;
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
          buildOfflineCausalLogicRules(),
          recentHeartVoiceText,
          buildLongRangeMemoryContextSection(context),
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
            buildOfflineCurrentInputPriorityRules(context.userInput),
            buildOfflineSceneContinuityRules(recentSceneHint),
            "如果线下剧情里出现补偿、购物花费、红包、转账等模拟金额事件，可在对应 event 上附加 money：{\"type\":\"transfer|redPacket\",\"amount\":\"12.66\",\"direction\":\"income|expense\",\"note\":\"备注\"}。",
            "memories 是长期记忆，不要为了凑数额外生成。",
            "",
            "【线下反模板规则——每轮必读】",
            "1. 不要用固定上位模板回应所有用户输入。角色反应必须来自本轮具体事件和用户当前这句话。",
            "2. 以下句式禁止在本轮出现超过 1 次，且禁止与上一轮重复：",
            "   · 谁问你了  · 我来判断  · 你先回答我",
            "   · 别拿问题绕开刚才  · 规矩立了就是铁律  · 没有注意事项，只有绝对服从",
            "   · 按我的规矩  · 看着我说  · 再让我看到你",
            "3. 除非本轮用户明确挑衅、触发了世界书中明确的处罚/服从规则、或角色人设极度强硬，否则不要主动进入“审问/管教/绝对服从”模式。",
            "4. 角色可以强势，但强势必须来自本轮具体触发点，不是模板驱动。",
            "5. 如果用户只是普通问句、解释、关心、沉默、转移话题，角色应选择：冷淡、别扭、讽刺、回避、追问具体细节、放缓、沉默、或转移注意力——不要默认升级冲突。",
            "6. 每轮至少 2 条 event 必须直接接住用户当前这句话里的具体词、动作或意图。",
            "7. 如果把用户刚说的话删掉，回复依然成立，说明太模板——必须重写。",
            "8. 动作要小而具体：停顿、移开视线、放下东西、换坐姿、指尖顿住、把话咽回去——不要每次都是“靠近、垂眼、扣住、压低声音”的惩罚现场感。",
            "9. 不要替用户回答、承认、害怕、服从；可以观察用户“像是犹豫/不服”，但不能写死用户内心。",
            "10. 如果上一轮已经出现过压制，本轮优先换角度：换动作、换情绪外显、问具体问题，不要继续同一套台词。",
            context.userInput ? "【本轮用户输入】用户刚说/做的是：" + context.userInput + "\n请先判断：用户在回答、质疑、解释、撒娇、转移、关心、挑衅，还是陈述？角色此刻最自然的第一反应是什么？" : ""
          ].filter(Boolean).join("\n")
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
          "4. 保留原始用户输入意图；如果本轮问题尚未回答，必须补上回答、回避或合理追问。",
          "5. 不要引入‘谁问你了’、‘别绕’、‘别让我猜’、‘继续装’、‘先说你的目的’等固定模板审问句。",
          "6. 每条新增 action 必须承接前一条 event 的情境，由当前场景和角色状态自然生成，不得使用固定句库。",
          "5. 同一轮中不得重复动词、视线方向或身体部位描写；避免反复使用「垂眼」「偏头」「靠近」「转身」「目光一沉」「停在原地」等泛用动作词。",
          "6. action 用第三人称写，有镜头感，一条写一个完整画面，不超过三句。",
          "7. repair 只补动作和节奏，不得为了补 action 改时间、地点、光线、天气、站位或正在做的事；必须保留原场景。",
          "8. 前文是晚上不能修成白天/清晨/阳光；前文在室内、桌边、床边、门口或走廊，不能修成室外、教室、咖啡馆或其他新地点。",
          "9. 如果原 events 已经换场景但没有过渡，只能补 1-2 条过渡 action（收拾东西、起身离开、走过走廊、推开门、车程/路程/时间流逝），不能直接硬切。",
          "10. 只输出修复后的完整 events 数组，JSON 格式：{\"events\":[...]}",
          reason === "offline-overuses-previous-callback"
            ? "\n本次修复原因：线下回复过度追问上一轮/刚才状态。\n用户本轮没有明确要求回到刚才，所以不要再写'刚才那股气势去哪了''刚才怎样怎样''这会儿倒是……'。\n保留当前场景、人物站位和动作连续性，但台词必须优先回应用户本轮输入。\n把追旧账句式改成：当前动作反应、沉默、短句、转移视线、继续当前任务、或符合人设的新台词。\n不要改变世界书、人设、场景位置。"
            : ""
        ].filter(Boolean).join("\n")
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

    var previousCallbackCountOff = countOfflinePreviousCallbackTemplates(normalizedEvents);
    var userInputTextOff = String(context.userInput || "").trim();
    var allowPreviousCallbackOff = hasOfflineRecallIntent(userInputTextOff);

    if (previousCallbackCountOff > 0 && !allowPreviousCallbackOff) {
      var repairedCallbackEventsOff = await repairOfflineEvents(
        Object.assign({}, context, { offlineRepairReason: "offline-overuses-previous-callback" }),
        normalizedEvents,
        "offline-overuses-previous-callback"
      );
      if (repairedCallbackEventsOff && repairedCallbackEventsOff.length) {
        normalizedEvents = repairedCallbackEventsOff;
      } else {
        normalizedEvents = normalizedEvents.filter(function (event) {
          return !hasOfflinePreviousCallbackTemplate(event && event.content);
        });
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
    if (window.AppExtras && window.AppExtras.buildMemoryContextPack && context.targetId) {
      var _offMemPack = window.AppExtras.buildMemoryContextPack("offline", context.targetId, {
        latestUserInput: context.userInput || "",
        regenerateRequest: context.regenerateRequest
      });
      context.memoryContextPack = _offMemPack;
      context.memoryContextText = window.AppExtras.formatMemoryContextPack
        ? window.AppExtras.formatMemoryContextPack(_offMemPack)
        : "";
    }
    var selectedWorldBookIds = getSelectedWorldBookIds(context.mode === "group" ? "group" : "private", context.targetId || "", context);
    var worldBookDecisionText = buildWorldBookDecisionContext({
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
    });
    var worldBookResolved = context.worldBookResolved || resolveWorldBookPromptContext(
      context.mode === "group" ? "group" : "private",
      context.targetId || "",
      worldBookDecisionText,
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
        }).filter(Boolean) : []
      }
    );
    var worldBookContext = context.worldBookContext || worldBookResolved.worldBookContext;
    var worldBookMeta = context.worldBookMeta || worldBookResolved.worldBookMeta || buildWorldBookPromptMeta(selectedWorldBookIds, worldBookResolved.matchedEntries);
    context.worldBookContext = worldBookContext;
    context.selectedWorldBookIds = selectedWorldBookIds;
    context.worldBookResolved = worldBookResolved;
    context.worldBookMeta = worldBookMeta;
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
          buildLongRangeMemoryContextSection(context),
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
            buildOfflineCurrentInputPriorityRules(context.userInput),
            buildOfflineSceneContinuityRules(recentSceneHint),
            buildOfflineCausalLogicRules(),
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
    var worldBookResolved = source.worldBookResolved || resolveWorldBookPromptContext("private", character && character.id, contextText, {
      selectedWorldBookIds: selectedWorldBookIds,
      relatedTargetIds: character && character.id ? [character.id] : [],
      characterIds: character && character.id ? [character.id] : []
    });
    var worldBookContext = source.worldBookContext || worldBookResolved.worldBookContext;
    var worldBookMeta = source.worldBookMeta || worldBookResolved.worldBookMeta || buildWorldBookPromptMeta(selectedWorldBookIds, worldBookResolved.matchedEntries);
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
    var worldBookResolved = source.worldBookResolved;
    var worldBookContext = source.worldBookContext || (selectedWorldBookIds.length && source.worldText ? source.worldText : null);
    if (!worldBookContext && selectedWorldBookIds.length) {
      worldBookResolved = resolveWorldBookPromptContext(
        authorCharacterId ? "private" : "global",
        authorCharacterId || "",
        contextText,
        {
          selectedWorldBookIds: selectedWorldBookIds,
          relatedTargetIds: worldRelatedIds,
          characterIds: worldRelatedIds
        }
      );
      worldBookContext = worldBookResolved.worldBookContext;
    }
    worldBookMeta = source.worldBookMeta || (worldBookResolved ? worldBookResolved.worldBookMeta : worldBookMeta);
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

  function normalizeThoughtTextForCompare(text) {
    return String(text || "")
      .replace(/\s+/g, "")
      .replace(/[，。！？、；：,.!?;:"""'''（）()【】\[\]{}<>《》\-—_…~～]/g, "")
      .trim();
  }

  function isSimilarThoughtField(a, b) {
    var x = normalizeThoughtTextForCompare(a);
    var y = normalizeThoughtTextForCompare(b);

    if (!x || !y) {
      return false;
    }

    if (x === y) {
      return true;
    }

    return x.indexOf(y) !== -1 || y.indexOf(x) !== -1;
  }

  function cleanRepeatedThoughtFields(thought) {
    var item = Object.assign({}, thought || {});
    var mood = String(item.mood || "").trim();
    var content = String(item.content || "").trim();
    var visibleSummary = String(item.visibleSummary || "").trim();

    if (isSimilarThoughtField(mood, content)) {
      item.mood = "";
    }

    if (isSimilarThoughtField(content, visibleSummary)) {
      item.visibleSummary = "";
    }

    if (isSimilarThoughtField(mood, visibleSummary)) {
      item.visibleSummary = "";
    }

    return item;
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

    var rawThoughts = list.map(function (thought) {
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

    var removedDuplicateMoodCount = 0;
    var removedDuplicateVisibleSummaryCount = 0;

    var normalizedThoughts = rawThoughts.map(function (thought) {
      var before = { mood: thought.mood, visibleSummary: thought.visibleSummary };
      var cleaned = cleanRepeatedThoughtFields(thought);
      if (before.mood && !cleaned.mood) {
        removedDuplicateMoodCount++;
      }
      if (before.visibleSummary && !cleaned.visibleSummary) {
        removedDuplicateVisibleSummaryCount++;
      }
      return cleaned;
    });

    if (localStorage.getItem("myAiApp.debugThoughts") === "1") {
      console.debug("[ThoughtDebug]", {
        before: rawThoughts,
        after: normalizedThoughts,
        removedDuplicateMoodCount: removedDuplicateMoodCount,
        removedDuplicateVisibleSummaryCount: removedDuplicateVisibleSummaryCount
      });
    }

    return normalizedThoughts;
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
      var content = pickFallbackLine(profile, index, usedSpeech, contextFlags, null, settings);
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

    if (!settings.onlineMode) {
      filtered = rebalanceReplyRhythm(filtered, getFallbackProfiles(settings), settings);
    }

    filtered = assertNoLocalFixedReplies(filtered, { mode: settings.onlineMode ? "online" : "offline", latestUserInput: settings.latestUserInput || "" });
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

  function assertNoLocalFixedReplies(messages, context) {
    var list = Array.isArray(messages) ? messages : [];
    var banned = /\u5148\u56de\u7b54\u4e00\u4e2a\u95ee\u9898|\u6211\u53c8\u6ca1\u8bf4\u62c5\u5fc3\u4f60|谁问你了|谁问你有没有事|继续说|别绕|别急着躲|别让我猜|先说你的目的|先告诉我原因|别拿这句糊弄我|钱先放一边|话先说清楚|看着我说|现在回我|把话说完整/;
    var removed = [];

    var filtered = list.filter(function (message) {
      var hit = banned.test(String(message && message.content || ""));
      if (hit) {
        removed.push(message);
      }
      return !hit;
    });

    if (removed.length > 0) {
      try {
        if (typeof localStorage !== "undefined" && localStorage.getItem("myAiApp.debugOnlineLogic") === "1" && typeof console !== "undefined" && console.warn) {
          console.warn("[FixedReplyWarning]", {
            mode: context && context.mode,
            latestUserInput: context && context.latestUserInput,
            count: removed.length,
            removed: removed
          });
        }
      } catch (e) {}
    }

    return filtered;
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

  function replaceGenericTemplateReplies(replies) {
    return Array.isArray(replies) ? replies : [];
  }

  function replaceTemplateWithPersonaLine(reply) {
    return reply || {};
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

  function maybeRewriteReplyTextureList(replies) {
    return Array.isArray(replies) ? replies : [];
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

  function replaceReplyWithFallbackTexture() {
    return null;
  }

  function rebalanceReplyRhythm(replies) {
    return (Array.isArray(replies) ? replies : []).slice();
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

    // Do not locally pad replies with generic fallback templates after重复过滤。
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

  function createFallbackReplyItems() {
    return [];
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
        thoughtsHint: settings.thoughtsHint || settings.recentHeartVoiceText || profile.thoughtsHint || profile.recentHeartVoiceText || "",
        onlineMode: settings.onlineMode === true,
        mode: String(settings.mode || settings.taskMode || settings.selfCheckMode || settings.targetType || "").toLowerCase()
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

  function pickFallbackLine() {
    return "";
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

  function getShortestPersonaFallbackLine() {
    return "";
  }

  function pickFallbackPhaseLines() {
    return [];
  }

  function buildPersonaAwareFallbackLine() {
    return "";
  }

  function buildFallbackCandidatesByInput(profile, inputInfo, tags, phase, flags, index) {
    var source = profile || {};
    var voiceProfile = source.voiceProfile || detectPersonaVoiceProfile(source);
    var activeTags = Array.isArray(tags) && tags.length ? tags : (voiceProfile.tags || []);
    var primaryTag = voiceProfile.primaryTag || activeTags[0] || getFallbackStyleBucket(source, flags);
    var rhythmPhase = phase || "instant";
    var inputCandidates = buildFallbackInputTypeCandidates(source, inputInfo, activeTags, primaryTag, rhythmPhase, flags, source);
    var tagCandidates = buildFallbackTagCandidates(source, activeTags, primaryTag, rhythmPhase, flags);
    var evidenceCandidates = buildFallbackEvidenceCandidates(source, rhythmPhase, flags);
    var legacyCandidates = buildPersonaAwareFallbackCandidates(source, activeTags, primaryTag, flags, rhythmPhase, index, source);
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

  function buildFallbackEvidenceCandidates() {
    return [];
  }

  function buildFallbackInputTypeCandidates() {
    return [];
  }

  function hasColdTsundereFallbackTags(primaryTag, tags) {
    var activeTags = uniqueList([primaryTag].concat(Array.isArray(tags) ? tags : [])).filter(Boolean);
    return activeTags.indexOf("cold") !== -1 && activeTags.indexOf("tsundere") !== -1;
  }

  function getColdTsundereNegationFallbackLines() {
    return [];
  }

  function getFallbackInputPhaseLines() {
    return [];
  }

  function buildFallbackInputPhaseBank() {
    return {};
  }

    function buildPersonaAwareFallbackCandidates() {
    return [];
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

  function getFallbackLines() {
    return [];
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

    reply.content = normalizeAiMessageText(content, options);
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
      "当然。你敢走试试。"
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
      "3. thoughts 每个角色最多 1 条；mood 要由本轮上下文生成，只写 2-10 个中文字符，不得复用固定词，可以为空字符串。",
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

  /* ===== 出去玩 AI ===== */

  function buildOutingContextPrompt(outing) {
    if (!outing || outing.status !== "active") return "";
    var memoryContext = {
      privateChatMemoryText: "",
      characterMemoryText: "",
      groupMemoryText: "",
      recentPrivateChatText: "",
      sourceLabel: "自动"
    };
    if (window.AppStorage && window.AppStorage.getOutingCompanionMemoryContext) {
      memoryContext = window.AppStorage.getOutingCompanionMemoryContext(outing, { memorySource: outing.memorySource });
    }
    return [
      "",
      "O. 当前出行情境 outingContext",
      "这是独立的出去玩模块，不是微信私聊，也不是群聊。",
      "用户和同行对象正在现实地点活动。",
      "同行对象类型：" + (outing.companion && outing.companion.type || ""),
      "同行对象名称：" + (outing.companion && outing.companion.name || ""),
      "同行对象人设：" + (outing.companion && outing.companion.persona || "普通临时 NPC"),
      "地点：" + (outing.placeName || ""),
      "地点描述：" + (outing.placeDescription || ""),
      "已花费：¥" + Number(outing.spentTotal || 0).toFixed(2),
      "记忆来源：" + (memoryContext.sourceLabel || "自动"),
      "私聊记忆：" + (memoryContext.privateChatMemoryText || "暂无"),
      "角色记忆：" + (memoryContext.characterMemoryText || "暂无"),
      "群聊记忆：" + (memoryContext.groupMemoryText || "暂无"),
      "最近私聊对话：" + (memoryContext.recentPrivateChatText || "暂无"),
      "最近出行事件：",
      (outing.events || []).slice(-8).map(function (event, index) {
        return (index + 1) + ". " + (event.content || "");
      }).join("\n") || "暂无",
      "最近购买：",
      (outing.purchases || []).slice(-5).map(function (item, index) {
        return (index + 1) + ". " + item.itemName + " / ¥" + Number(item.price || 0).toFixed(2);
      }).join("\n") || "暂无",
      "输出要求：",
      "1. 像现实生活一样写现场反应，有环境、人流、声音、距离、付款、排队、手里拿着的东西。",
      "2. 不要说系统、账单、记录、模块。",
      "3. 如果买了东西，同行对象要按人设反应：接过、嫌弃、提醒、抢着付、吐槽、沉默、照顾都可以。",
      "4. NPC 可以自然互动，但不要写成联系人私聊。",
      "5. 如果同行对象是角色，必须按角色人设反应。",
      "6. 不要写旅游攻略，要写正在现场发生的互动。",
      "7. 返回 JSON，格式：",
      '{"events":[{"type":"action","content":"..."},{"type":"speech","speakerName":"...","content":"..."}],"memories":[{"characterId":"...","content":"..."}]}'
    ].join("\n");
  }

  function sendOutingRequest(context) {
    var outing = context && context.outing;
    var trigger = context && context.trigger || "";
    if (!outing) return Promise.resolve(null);

    var settings = window.AppStorage && window.AppStorage.getSettings ? window.AppStorage.getSettings() : {};
    var profile = window.AppStorage && window.AppStorage.getActiveApiProfile ? window.AppStorage.getActiveApiProfile() : null;
    if (!profile || !profile.apiUrl || !profile.apiKey) {
      return Promise.resolve(null);
    }

    var systemPrompt = [
      "你是一个专门负责「出去玩」模块的叙事引擎。",
      "你的任务是根据同行对象人设和地点，生成真实的现场互动场景。",
      buildOutingContextPrompt(outing)
    ].join("\n");

    var userMessage = trigger
      ? "当前触发事件：" + trigger + "。请生成同行对象的现场反应和环境描写。"
      : "请根据当前出行情境，生成一段自然的现场互动。";
    userMessage += " 当前输入类型：" + (context.latestUserInputMode === "action" ? "动作" : "说话") + "。";
    if (context.memorySource && context.memorySource.type) {
      userMessage += " 当前记忆来源：" + (context.memorySource.type === "group" ? "指定群聊" : context.memorySource.type === "private" ? "私聊" : "自动") + "。";
    }

    var messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ];

    var url = buildChatCompletionsUrl(profile.apiUrl);
    var requestBody = {
      model: profile.modelName || "gpt-4o-mini",
      messages: messages,
      temperature: Number(profile.temperature) || 0.85,
      max_tokens: 600,
      stream: false
    };

    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + profile.apiKey
      },
      body: JSON.stringify(requestBody)
    }).then(function (response) {
      if (!response.ok) return null;
      return response.json();
    }).then(function (data) {
      if (!data) return null;
      var raw = extractAiText(data);
      if (!raw) return null;
      var jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { events: [{ type: "action", content: raw }], memories: [] };
      }
      try {
        var parsed = JSON.parse(jsonMatch[0]);
        return {
          events: Array.isArray(parsed.events) ? parsed.events : [],
          memories: Array.isArray(parsed.memories) ? parsed.memories : []
        };
      } catch (e) {
        return { events: [{ type: "action", content: raw }], memories: [] };
      }
    }).catch(function () {
      return null;
    });
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
    normalizeBodyStateWithContext: normalizeBodyStateWithContext,
    sendOutingRequest: sendOutingRequest,
    buildOutingContextPrompt: buildOutingContextPrompt
  };
})(window);
