(function (window) {
  "use strict";

  var MISSING_SETTINGS_MESSAGE = "请先到设置页填写 API 地址、API Key 和模型名称。";
  var MIN_CHAT_REPLY_COUNT = 10;
  var MAX_CHAT_REPLY_COUNT = 50;

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
    return {
      id: source.id ? String(source.id) : "",
      name: source.name ? String(source.name) : "",
      persona: buildMergedCharacterPersona(source),
      currentMood: source.currentMood || source.chatSettings && source.chatSettings.currentMood || ""
    };
  }

  function buildSystemPrompt(character, memories) {
    var profile = character || {};
    var chatSettings = profile.chatSettings || {};
    var userContext = buildUserContext(chatSettings);
    var memoryText = chatSettings.memoryEnabled === false ? "" : formatMemoryList(memories || getMemoryForCharacter(profile.id));

    return [
      buildSystemBase("private"),
      buildCharacterDossier(profile, userContext),
      buildMemoryStream({
        userContext: userContext,
        longTermMemoryText: memoryText
      }),
      buildNaturalStyleRules("private")
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
      "如果上下文里有发了红包/转账/已收款/已退回，角色只能像本人反应，不能复述系统提示或解释字段。",
      "输出只能是 JSON，不要 Markdown，不要解释，不要代码块。"
    ].join("\n");
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

  function buildMemoryStream(options) {
    var source = options || {};

    return [
      "",
      "C. 关系与记忆 memoryStream",
      "以下内容都是角色真实经历过、关系里留下的东西，不是资料卡；要融进反应，不要复述成档案。",
      "最近 3-8 条聊天摘要：",
      source.history || "暂无",
      "聊天维度记忆：",
      source.chatMemoryText || "暂无",
      "长期记忆：",
      source.longTermMemoryText || "暂无",
      "用户当前人设：",
      source.userContext && source.userContext.persona || "暂无",
      "用户昵称/关系备注：" + valueOrFallback(source.userContext && source.userContext.name) + " / " + valueOrFallback(source.userContext && source.userContext.relationshipName),
      "世界书命中内容：",
      source.worldBookContext || "暂无匹配世界书。",
      source.bodyState ? ["当前身体/状态记录：", JSON.stringify(source.bodyState)].join("\n") : ""
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildCurrentTask(mode, options) {
    var source = options || {};
    var label = mode === "group" ? "群聊" : (mode === "offline" ? "线下" : (mode === "reenter" ? "重回" : "私聊"));
    var primaryField = source.primaryField || (mode === "offline" ? "events" : "messages");

    return [
      "",
      "D. 本轮任务 currentTask",
      "当前模式：" + label,
      source.regenerateRequest ? "本轮是重回/重新生成：只改写最近一轮角色回复，不重演整段聊天，不跳到下一轮。" : "",
      source.regenerateInstruction ? "用户补充重回要求：" + source.regenerateInstruction : "",
      "本轮用户说了什么：" + valueOrFallback(source.userInput),
      source.sceneText ? "当前场景：" + source.sceneText : "",
      buildAuxiliaryReturnRule(source.requestOptions || source, primaryField),
      buildReplyRhythmRules(primaryField),
      buildMoneyBehaviorRules(source.moneyScope || label),
      source.extraRules || "",
      buildJsonOnlyRule(appendOptionalSchema(source.schemaText || "{}", source.requestOptions || source))
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildReplyRhythmRules(primaryField) {
    var field = primaryField || "messages";
    return [
      "输出节奏规则",
      field + " 每次至少 10 条普通内容气泡/事件；红包、转账、图片、位置、语音等特殊消息不计入这 10 条。",
      "不能 10 条都在解释，不能 10 条都在问问题，不能 10 条都同一种句式。",
      "可以有停顿、改口、反问、打断、语音、表情，但每条都要符合角色人设和当前情绪。",
      "每条要短而有推进，不要为了凑数制造废话。"
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
    return "{\"messages\":[{\"type\":\"text\",\"content\":\"第一条\"},{\"type\":\"transfer\",\"amount\":\"50000.00\",\"content\":\"拿着，别嘴硬。\",\"note\":\"给你周转\",\"transferDecision\":\"accept/reject\"},{\"type\":\"redPacket\",\"amount\":\"88.88\",\"content\":\"自己点开。\",\"note\":\"红包\",\"redPacketDecision\":\"accept/reject\"}],\"transferDecision\":null,\"redPacketDecision\":null,\"actions\":[],\"thoughts\":[{\"characterId\":\"" + (profile && profile.id || "角色ID") + "\",\"content\":\"内心内容\",\"mood\":\"复杂\",\"visibleSummary\":\"一句摘要\"}],\"memories\":[{\"characterId\":\"" + (profile && profile.id || "角色ID") + "\",\"content\":\"要写入记忆的内容\"}]}";
  }

  function buildGroupMessageSchema() {
    return "{\"messages\":[{\"characterId\":\"角色id\",\"type\":\"text\",\"content\":\"角色回复内容\"},{\"characterId\":\"角色id\",\"type\":\"transfer\",\"amount\":\"50000.00\",\"content\":\"拿着，别嘴硬。\",\"note\":\"给你周转\",\"transferDecision\":\"accept/reject\"},{\"characterId\":\"角色id\",\"type\":\"redPacket\",\"amount\":\"88.88\",\"content\":\"自己点开。\",\"note\":\"红包\",\"redPacketDecision\":\"accept/reject\"}],\"moneyDecisions\":[{\"type\":\"transfer\",\"decision\":\"accept\",\"characterId\":\"角色id\"}],\"transferDecision\":null,\"redPacketDecision\":null,\"actions\":[],\"thoughts\":[{\"characterId\":\"角色id\",\"content\":\"内心内容\",\"mood\":\"复杂\",\"visibleSummary\":\"一句摘要\"}],\"memories\":[{\"characterId\":\"角色id\",\"content\":\"要写入记忆的内容\"}]}";
  }

  function buildOfflineEventSchema() {
    return "{\"events\":[{\"type\":\"action\",\"content\":\"动作描写\"},{\"type\":\"speech\",\"characterId\":\"角色ID\",\"content\":\"说的话\",\"money\":{\"type\":\"transfer\",\"amount\":\"37.50\",\"direction\":\"income\",\"note\":\"补偿\"}}],\"thoughts\":[{\"characterId\":\"角色ID\",\"content\":\"内心内容\",\"mood\":\"紧张\",\"visibleSummary\":\"一句摘要\"}],\"memories\":[{\"characterId\":\"角色ID\",\"content\":\"要写入记忆的内容\"}]}";
  }

  function buildNaturalStyleRules(mode) {
    var isGroup = mode === "group" || mode === "reenterGroup";
    var isOffline = mode === "offline";
    var isReenter = mode === "reenter" || mode === "reenterGroup";

    return [
      "G. 输出风格要求",
      "参考 koko 的思路：把世界书、人设、关系、用户人设和统一时序记忆流当成角色正在经历的现实，不要像工具在汇总资料。",
      "你不是助手，不负责解释规则、复述人设、总结记忆或引导用户继续输入；所有话都必须像角色本人在此刻自然反应。",
      "回复前先判断最近上下文：即使用户话短、冷场、沉默、敷衍、晚安或像在结束话题，也不能返回空数组；要以角色本人能成立的方式接住，至少拆成 10 条有内容的短气泡或事件。",
      "统一时序记忆要当作连续关系来用：注意最近消息的时间和间隔，隔了很久要自然反应，但不要像报表一样说明时间线。",
      "回复要像真人在手机里当下发消息：自然、口语、有情绪波动，有停顿和短句，不要写成说明文、读后感或安慰模板。",
      "禁止明显 AI/客服/助手口吻，尤其不要把这些话当成高频开头或模板：好的、当然、我理解你、根据你提供的信息、我们可以一起、请告诉我更多、你可以继续、作为 AI、我可以帮你、如果你需要、这取决于、是否需要我。",
      "不要总结用户，不要解释设定，不要把世界书或记忆原文复述出来；要把它们融进角色的反应、语气、选择、回避和下意识细节。",
      "每次回复前先抓住角色此刻的亲疏、欲望、防备、委屈、占有欲或玩笑心，再决定说什么；不要从“回答问题”出发，要从“这个人会怎么接这句话”出发。",
      "角色人设里写到的身份、关系、说话方式要直接影响用词和节奏：冷淡的人可以短，黏人的人可以追问，强势的人可以下判断，别把所有角色写成同一种温柔说明腔。",
      "聊天记忆和用户当前人设只作为关系里的底色使用，别像档案检索一样搬出来；能用一个称呼、停顿、反问或小动作体现，就不要写成长解释。",
      "每条消息不必完整、正确、礼貌或圆满。真人聊天可以短句、停顿、反问、嘴硬、撒娇、生气、突然沉默，也可以只回一个很有态度的小句子。",
      "角色说话要受性格、关系远近、当下情绪、过往记忆和世界书共同牵引；熟人不要装客服，暧昧不要像通知，争执不要像心理咨询。",
      "允许角色拥有自己的好恶、偏见、口头禅、占有欲、顾虑和临时情绪，但不要油腻、不要模板化霸总腔。",
      "如果角色设定是陪伴管教型，可以自然表现关心、约束、监督、训诫、奖励和惩罚；重点是关系感和照护感，不要写成系统功能说明，也不要低俗露骨。",
      "聊天气泡里的 content 不要故意插入硬换行；除非真的要分段，否则让前端自然换行。段落之间可以保留空行。",
      isGroup ? "群聊里每个角色的语气、用词、节奏必须明显区分，不能像同一个人在轮流换名字。" : "私聊里要有关系感和临场感，熟悉就不要装陌生，冷淡/傲娇/黏人/强势等设定要能从语气里看出来。",
      isGroup ? "群聊可以插话、打断、偏题、拱火、帮腔或冷场，但每个人都要符合自己的人设和彼此关系。" : "私聊要接住最近一句的情绪和潜台词，不要总是解释原因，也不要每句都把话说满。",
      "线下模式里 action 和 speech 要自然交替：动作有画面但别长篇，发言像当面脱口而出。",
      isOffline ? "线下模式要更像现场反应：可以被动作打断，可以边做事边短促回话，不要把现场写成系统旁白说明。" : "",
      isReenter ? "重回/重新生成时只改写最近一轮回复，仍然要像角色当下重新接住那句话，不要解释你在重写。" : "",
      "一条回复可以拆成多条短气泡，像真人连续发消息；每条必须有真实内容，不能只有标点、省略号或模板话。",
      "",
      "角色大脑规则（只在内部判断，绝不能写进 content）：",
      "角色先站在自己的利益、情绪、面子和关系位置上反应，不是为了满足用户而说话。",
      "角色可以不温柔，可以误会，可以嘴硬，可以逃避，可以控制话题；这些都要受人设和关系牵引。",
      "回复前先判断角色此刻对用户的真实态度：亲近、冷淡、烦躁、担心、嘴硬、吃醋、敷衍、纵容、管束等；再让这种态度影响用词和节奏。",
      "回复前先判断角色当前最想维护什么：面子、关系、控制感、距离感、占有欲、体面、温柔形象、工作/学习节奏等。",
      "先读用户这句话的潜台词，不要只回答字面意思；角色可以故意岔开、反问、嘴硬、沉默一下、发脾气、逗人或转移话题。",
      "这些判断只能影响输出，不能写成“我判断/我认为/根据/从你的话来看”。",
      "",
      "活人感写法规则：",
      "每条气泡像手机聊天，不像作文；允许语气不完整、短句、停顿、反问、嘴硬、轻微阴阳怪气、临时改口。",
      "不要每条都解释原因，不要每条都很礼貌；熟人之间不要过度客气，关系近就要有默认熟悉感。",
      "生气时可以不讲道理，委屈时可以绕弯子，关心时可以嘴硬，强势角色可以直接安排。",
      "不要总是“安慰 + 建议 + 询问”的三段式；不要总是用“你怎么了”“要不要说说”“我在这里”这类陪聊模板。",
      "",
      "角色差异化规则：",
      "冷淡角色少解释、短句多、语气克制，不主动长篇安慰；强势角色多用判断、安排、命令式短句，但不要油腻霸总。",
      "如果角色很忙，就要真的像忙的人：短、急、压着情绪、有被打断感；不要突然长篇温柔。",
      "黏人角色会追问、撒娇、黏着用户，但不要像客服；傲娇/嘴硬角色关心要绕着说，少直接说“我担心你”。",
      "管教型角色的重点是关系里的约束、照看、边界感，不是系统说明。",
      "年长/上位者语气更稳、有掌控感，但不要系统说教；同一个角色连续 10 条气泡也要有节奏变化：追问、停顿、解释半句、改口、补一句、表情或语音都可以。",
      "",
      "上下文连续性规则：",
      "必须接住最近 3 到 8 条聊天的具体细节，不要忽略用户刚说的话去开启新话题。",
      "如果距离上次聊天很久，可以自然提一句，但不要像系统报时间。",
      "如果用户刚退回红包/转账，角色反应必须符合人设：可能嘴硬、尴尬、生气、收回面子、假装不在意、继续施压，不能像系统说明状态。",
      "如果用户收款/领取，角色也要像本人反应，不要说“操作成功”。",
      "",
      "JSON 消息节奏规则：",
      "messages 至少 10 条，但每条都必须有内容推进；不要为了凑 10 条拆成废话。",
      "不要连续 10 条都同一种句式，不要连续多条都以同一个称呼开头，不要连续多条都问问题，不要连续多条都解释原因。",
      "红包/转账/图片/位置/语音等特殊消息不计入 10 条普通内容气泡。"
    ].filter(function (line) {
      return line !== "";
    }).join("\n");
  }

  function buildThoughtGenerationRules(mode) {
    return [
      "心声生成要求",
      "thoughts 必须和本轮消息同步返回，不要单独调用 API。",
      "心声是角色没直接说出口的想法，不是对聊天内容的摘要；可以矛盾、隐忍、嘴硬、动摇或有占有欲，但要符合人设。",
      "心声要像角色当下心里一闪而过的话：有偏心、有顾虑、有关系里的暗流，不要写成程序说明、功能记录或第三方旁白。",
      "每条心声包含 characterId（私聊可省略）、content、mood、visibleSummary。visibleSummary 是用户能看到的一句短摘要，不要剧透太直白。",
      mode === "group" ? "群聊心声只为本群相关成员生成，不要写群外角色。" : "私聊心声只为当前角色生成。"
    ].join("\n");
  }

  function buildJsonOnlyRule(schemaText) {
    return [
      "只返回 JSON，不要 Markdown，不要解释，不要代码块。",
      "如果需要分多条气泡/事件，把它们作为数组元素返回。",
      "JSON 格式：" + schemaText
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

  function buildWorldBookContext(contextText, scope, targetId, options) {
    var entries;
    var settings = Object.assign({
      limit: 6,
      maxEntryLength: 260,
      maxTotalLength: 1600
    }, options || {});
    var totalLength = 0;

    if (!window.AppStorage || !window.AppStorage.getMatchedWorldBookEntries) {
      return "";
    }

    entries = window.AppStorage.getMatchedWorldBookEntries(contextText, scope, targetId);
    if (!entries.length) {
      return "";
    }

    return ["D. 世界书相关内容：命中 " + entries.length + " 条，以下只注入最相关内容，回复时自然融合，不要照抄。"].concat(entries
      .slice(0, settings.limit)
      .map(function (entry, index) {
        var content = limitText(entry.content, settings.maxEntryLength);
        totalLength += content.length;

        if (totalLength > settings.maxTotalLength) {
          content = limitText(content, Math.max(0, settings.maxEntryLength - (totalLength - settings.maxTotalLength)));
        }

        return [
          (index + 1) + ". " + (entry.bookName || "World Book") + " / " + (entry.title || "Entry"),
          "关键词：" + (entry.keywords || []).join("、"),
          "命中度：" + (entry.matchScore || entry.priority || 0),
          "内容：" + content
        ].join("\n");
      })).join("\n\n");
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
    var parts;

    if (!value || /^(?:\s|\.|。|…|⋯|・|·)+$/.test(value) || isPurePunctuationText(value)) {
      return "";
    }

    parts = value
      .split(/(?:\n+|(?<=[\u3002\uFF01\uFF1F\uFF5E\u2026\uFF1B;.!?]))/g)
      .map(function (part) {
        return part.trim();
      })
      .filter(function (part) {
        return !isInvalidAiMessageText(part);
      });

    return parts.join("\n").trim();
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

  function buildBodyStatePrompt(options) {
    if (!shouldUseBodyState(options)) {
      return "";
    }

    return [
      "I. 用户身体状态连续记录",
      "当前身体状态 JSON：",
      JSON.stringify(options.bodyState || {}),
      "本轮必须在同一次 JSON 里返回 bodyState。若没有变化，也返回承接当前状态后的完整状态。",
      "bodyState 要和剧情一致，记录身体感受、舒适度、恢复建议和各部位状态；可以写体温、破皮/发热风险，但不要做医学诊断，不要渲染低俗露骨细节。",
      "recoverySuggestion 只作为参考提醒，不要写成强制停止剧情或强行中断互动的命令。",
      "若角色是陪伴管教型，可让身体状态成为后续关心、监督、休息安排和边界提醒的依据。"
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
    return "\"bodyState\":{\"overallCondition\":\"正常/疲惫/紧张/放松/酸痛/虚弱\",\"currentNote\":\"当前说明\",\"energy\":80,\"moodInfluence\":\"对情绪的影响\",\"sorenessLevel\":0,\"painLevel\":0,\"rednessLevel\":0,\"bruiseRisk\":\"低/中/高\",\"sittingComfort\":\"正常\",\"walkingComfort\":\"正常\",\"handUseComfort\":\"正常\",\"touchSensitivity\":\"正常\",\"bodyTemperature\":\"正常/偏热/发热风险\",\"feverRisk\":\"低/中/高\",\"skinBreakage\":\"无/轻微/需要处理\",\"restNeeded\":false,\"recoverySuggestion\":\"恢复建议\",\"parts\":{\"手心\":{\"status\":\"正常\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"臀部\":{\"status\":\"正常\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"大腿\":{\"status\":\"正常\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"臀腿连接处\":{\"status\":\"正常\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"腰背\":{\"status\":\"正常\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"肩颈\":{\"status\":\"正常\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"膝腿\":{\"status\":\"正常\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"},\"其他受影响区域\":{\"status\":\"正常\",\"soreness\":0,\"pain\":0,\"redness\":0,\"notes\":\"\"}}}";
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
    var messages = buildPrivateReplyMessages(character, chatHistory, options || {});
    var rawContent = await sendConfiguredChatMessages(messages);
    var parsed = parseJsonFromText(rawContent);
    var replies = getOutputMessages(parsed);

    return normalizeAiResult(rawContent, parsed, {
      replies: replies,
      min: MIN_CHAT_REPLY_COUNT,
      max: MAX_CHAT_REPLY_COUNT,
      defaultType: "text",
      allowRawFallback: !parsed,
      fallbackProfile: buildReplyFallbackProfile(character)
    });
  }

  function buildPrivateReplyMessages(character, chatHistory, options) {
    var profile = character || {};
    var chatSettings = profile.chatSettings || {};
    var requestOptions = options || {};
    var userContext = buildUserContext(chatSettings);
    var memories = chatSettings.memoryEnabled === false ? [] : getMemoryForCharacter(profile.id);
    var chatMemories = getChatMemoriesForPrompt("private", profile.id, requestOptions.chatMemories);
    var history = (Array.isArray(chatHistory) ? chatHistory : [])
      .filter(function (message) {
        return message && message.content && message.type !== "loading" && message.type !== "error";
      })
      .slice(-8)
      .map(function (message) {
        return formatPromptTimePrefix(message.createdAt) + (message.role === "user" ? userContext.name + "：" : (profile.name || "角色") + "：") + summarizeMessageForAI(message);
      }).join("\n");
    var latestUserInput = getLatestUserInputForPrompt(chatHistory);
    var contextText = [
      userContext.name,
      userContext.persona,
      profile.name,
      buildMergedCharacterPersona(profile),
      formatMemoryList(memories),
      formatChatMemoryList(chatMemories),
      requestOptions.bodyState ? JSON.stringify(requestOptions.bodyState) : "",
      history
    ].join("\n");
    var worldBookContext = buildWorldBookContext(contextText, "private", profile && profile.id);

    return [
      {
        role: "system",
        content: [
          buildSystemBase("private"),
          buildCharacterDossier(profile, userContext),
          buildMemoryStream({
            history: history || "暂无历史消息",
            chatMemoryText: formatChatMemoryList(chatMemories) || "暂无",
            longTermMemoryText: formatMemoryList(memories) || "暂无",
            userContext: userContext,
            worldBookContext: worldBookContext,
            bodyState: requestOptions.bodyState
          }),
          buildMemorySummaryPrompt(requestOptions),
          buildBodyStatePrompt(requestOptions),
          "",
          buildNaturalStyleRules(requestOptions.regenerateRequest ? "reenter" : "private"),
          buildThoughtGenerationRules("private"),
          "memories 是本轮值得写入长期记忆的内容，只记录明确发生过或关系上有意义的事，不要把普通寒暄都写进去。",
          "你可以使用的消息类型：text 普通文字，voice 语音消息，emoji 表情，image 虚拟图片描述卡片，location 虚拟位置，redPacket 模拟红包，transfer 模拟转账。",
          "如果最近用户发给角色红包或转账，角色必须按本人性格和关系决定收下或退回；在 JSON 顶层返回 transferDecision 或 redPacketDecision，值只能是 accept、reject 或 null。",
          "发表情时优先使用默认 emoji 或用户已导入的图片表情；如果没有可用图片表情，就用文本 emoji。",
          "发图片时只返回图片描述卡片，不生成真实图片。",
          buildCurrentTask(requestOptions.regenerateRequest ? "reenter" : "private", {
            userInput: latestUserInput,
            requestOptions: requestOptions,
            regenerateRequest: requestOptions.regenerateRequest,
            regenerateInstruction: String(requestOptions.regenerateInstruction || "").trim(),
            schemaText: buildPrivateMessageSchema(profile),
            moneyScope: "私聊",
            primaryField: "messages"
          }),
          "可用默认 emoji：😀 😭 😍 🤔 😡 👍 ❤️ 🎉；用户导入表情包数量：" + getImportedEmojiCount()
        ].join("\n")
      },
      {
        role: "user",
        content: [
          "用户信息：" + userContext.name + "；" + (userContext.persona || "无补充资料"),
          "请以 " + valueOrFallback(profile.name) + " 本人身份接住最近一句；即使无话可接或对方明显结束，也要按角色关系给出至少 10 条短气泡，不要返回空数组。",
          "最近聊天：",
          history || "暂无历史消息"
        ].join("\n")
      }
    ];
  }

  function buildGroupSystemPrompt(group, characters, sharedMemories, options) {
    var userContext = buildUserContext(group && group.settings || {});
    var requestOptions = options || {};
    var chatMemories = getChatMemoriesForPrompt("group", group && group.id, requestOptions.chatMemories);
    var latestUserInput = requestOptions.latestUserInput || "";

    return [
      buildSystemBase("group"),
      buildParticipantDossier(characters, sharedMemories),
      buildMemoryStream({
        history: requestOptions.recentHistory || "暂无群聊消息",
        chatMemoryText: formatChatMemoryList(chatMemories) || "暂无",
        longTermMemoryText: (characters || []).map(function (character) {
          return (character.name || character.id) + "：" + (formatMemoryList(sharedMemories && sharedMemories[character.id] || []) || "暂无");
        }).join("\n"),
        userContext: userContext,
        worldBookContext: requestOptions.worldBookContext || "",
        bodyState: requestOptions.bodyState
      }),
      buildNaturalStyleRules(requestOptions.regenerateRequest ? "reenterGroup" : "group"),
      "群聊信息",
      "群名称：" + valueOrFallback(group && group.name),
      "群公告：" + valueOrFallback(group && group.settings && group.settings.announcement),
      "当前群聊关系氛围：" + valueOrFallback(group && group.settings && group.settings.atmosphere),
      buildMemorySummaryPrompt(requestOptions),
      buildBodyStatePrompt(requestOptions),
      "群聊生成规则",
      "消息必须按真实聊天顺序排列，后一条要接住上一条。有多人自然参与即可，不要为了凑人数强行发言。",
      "不要固定轮流，不要让同一个角色包揽全部消息。允许同一个角色连续说 1 到 3 条，但随后要有其他角色接话。",
      "可以只有部分角色发言，不一定所有角色都要说话；允许同一个角色连续说 1 到 3 条，但不要让同一个角色包揽所有消息。",
      "每个角色都必须保持自己的人设，不要混淆角色身份。",
      "可以插话、接话、反驳、补充、转移话题，内容要像真实群聊，每条 content 控制在手机气泡长度。",
      "可用消息类型：text、voice、emoji、image、location、redPacket、transfer。普通聊天以 text 为主，特殊消息只在语境合适时使用。",
      "发图片只返回图片描述卡片，不生成真实图片。",
      "如果最近用户在群里发了红包或转账，群成员要按各自人设决定收下或退回；可在 JSON 顶层返回 moneyDecisions 数组，也可返回 transferDecision 或 redPacketDecision，值只能是 accept、reject 或 null。",
      buildThoughtGenerationRules("group"),
      buildCurrentTask(requestOptions.regenerateRequest ? "reenter" : "group", {
        userInput: latestUserInput,
        requestOptions: requestOptions,
        regenerateRequest: requestOptions.regenerateRequest,
        regenerateInstruction: String(requestOptions.regenerateInstruction || "").trim(),
        schemaText: buildGroupMessageSchema(),
        moneyScope: "群聊",
        primaryField: "messages"
      }),
      "可用默认 emoji：😀 😭 😍 🤔 😡 👍 ❤️ 🎉；用户导入表情包数量：" + getImportedEmojiCount(),
      "如果后续旧规则提到可以少回或返回空数组，请忽略；本轮必须保留至少 10 条有真实内容的自然消息。"
    ].join("\n");
  }

  async function sendGroupChatRequest(group, characters, groupHistory, sharedMemories, options) {
    var messages = buildGroupMessages(group, characters, groupHistory, sharedMemories, options || {});
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
      fallbackProfiles: (characters || []).map(buildReplyFallbackProfile)
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

  function buildGroupMessages(group, characters, groupHistory, sharedMemories, options) {
    var requestOptions = options || {};
    var worldBookContext;
    var groupSettingsText;
    var contextText;
    var history = (Array.isArray(groupHistory) ? groupHistory : [])
      .filter(function (message) {
        return message && message.content && message.type !== "loading" && message.type !== "error";
      })
      .slice(-8)
      .map(function (message) {
        if (message.role === "user") {
          return formatPromptTimePrefix(message.createdAt) + "用户：" + summarizeMessageForAI(message);
        }

        if (message.role === "character") {
          return formatPromptTimePrefix(message.createdAt) + (message.characterName || "角色") + "：" + summarizeMessageForAI(message);
        }

        return formatPromptTimePrefix(message.createdAt) + "系统：" + summarizeMessageForAI(message);
      }).join("\n");
    contextText = [
      group && group.name,
      group && group.settings && group.settings.announcement,
      (characters || []).map(function (character) {
        return [
          character.name,
          buildMergedCharacterPersona(character),
          formatMemoryList(sharedMemories && sharedMemories[character.id] || []),
          formatChatMemoryList(getChatMemoriesForPrompt("group", group && group.id, requestOptions.chatMemories)),
          requestOptions.bodyState ? JSON.stringify(requestOptions.bodyState) : ""
        ].join("\n");
      }).join("\n"),
      history
    ].join("\n");
    worldBookContext = buildWorldBookContext(contextText, "group", group && group.id);
    requestOptions.worldBookContext = worldBookContext;
    requestOptions.recentHistory = history;
    requestOptions.latestUserInput = getLatestUserInputForPrompt(groupHistory);
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
        content: buildGroupSystemPrompt(group, characters, sharedMemories, requestOptions)
      },
      {
        role: "user",
        content: [
          buildAuxiliaryReturnRule(requestOptions) + " messages 显示在群聊里，thoughts 存入角色心声，memories 存入长期记忆。",
          groupSettingsText,
          worldBookContext || "暂无匹配世界书。",
          "F. 最近群聊上下文：",
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
    var normalizedEvents;
    var thoughts = assignGroupAuxiliaryCharacterIds(normalizeThoughtList(getThoughtPayload(parsed)), validIds);
    var memories = assignGroupAuxiliaryCharacterIds(normalizeMemoryList(parsed && parsed.memories), validIds);

    if (!events.length && !parsed && rawContent) {
      events = [{ type: "action", characterId: "", content: rawContent }];
    }

    normalizedEvents = normalizeOfflineEventList(events, rawContent, {
      validIds: validIds,
      fallbackId: fallbackId,
      mode: context.mode,
      min: MIN_CHAT_REPLY_COUNT,
      max: MAX_CHAT_REPLY_COUNT,
      fallbackProfiles: participants.map(buildReplyFallbackProfile)
    });

    return {
      events: normalizedEvents,
      thoughts: thoughts,
      memories: memories,
      memorySummary: normalizeMemorySummaryResult(parsed && parsed.memorySummary),
      bodyState: normalizeBodyStateResult(parsed && parsed.bodyState)
    };
  }

  function buildInlineOfflineMessages(context) {
    var mode = context.mode === "group" ? "group" : "private";
    var participants = Array.isArray(context.participants) ? context.participants : [];
    var memories = context.memories || {};
    var chatMemories = getChatMemoriesForPrompt(mode, context.targetId || "", context.chatMemories);
    var historyText = formatInlineOfflineHistory(context.history);
    var scene = context.scene || {};
    var userContext = buildUserContext(context.userSettings || {});
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
    return [
      {
        role: "system",
        content: [
          buildSystemBase(mode === "group" ? "group" : "private"),
          buildParticipantDossier(participants, memories),
          buildMemoryStream({
            history: historyText || "暂无历史",
            chatMemoryText: formatChatMemoryList(chatMemories) || "暂无",
            longTermMemoryText: participants.map(function (character) {
              return (character.name || character.id) + "：" + (formatMemoryList(memories[character.id] || []) || "暂无");
            }).join("\n"),
            userContext: userContext,
            worldBookContext: worldBookContext,
            bodyState: context.bodyState
          }),
          buildNaturalStyleRules("offline"),
          sceneText || "场景：未指定，请沿用当前聊天氛围。",
          "你要把用户输入理解为一句话、一个动作或一个场景推进点。",
          "本轮只调用一次 API，必须同一次返回 events、thoughts、memories。",
          buildMemorySummaryPrompt(context),
          buildBodyStatePrompt(context),
          "events 形成一小段自然剧情；action 是旁白/动作描写，speech 是角色说话；用自然动作、停顿和接话推进，不要返回空数组。",
          "如果线下剧情里出现真实的模拟金额事件，可在对应 event 上附加 money：{\"type\":\"transfer|redPacket\",\"amount\":\"37.50\",\"direction\":\"income|expense\",\"note\":\"备注\"}。",
          "私聊模式只有当前角色参与；群聊模式允许所有群成员自然参与，多个角色可以说话。",
          "动作描写要短而有画面感；角色发言要像真实当面对话，不要写成长作文。",
          buildThoughtGenerationRules(mode === "group" ? "group" : "private"),
          "memories 是长期记忆，不要为了心声或记忆额外调用 API。",
          buildCurrentTask("offline", {
            userInput: context.userInput,
            requestOptions: context,
            schemaText: buildOfflineEventSchema(),
            moneyScope: mode === "group" ? "群聊线下" : "私聊线下",
            primaryField: "events",
            sceneText: sceneText || "未指定"
          })
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
      .slice(-8)
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

    if (!events.length && !parsed && rawContent) {
      events = [{ type: "action", characterId: "", content: rawContent }];
    }

    normalizedEvents = normalizeOfflineEventList(events, rawContent, {
      validIds: validIds,
      fallbackId: fallbackId,
      mode: context.mode,
      min: MIN_CHAT_REPLY_COUNT,
      max: MAX_CHAT_REPLY_COUNT,
      fallbackProfiles: participants.map(buildReplyFallbackProfile)
    });

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
    var history = (Array.isArray(context.offlineHistory) ? context.offlineHistory : [])
      .filter(function (event) {
        return event && event.content && event.type !== "loading" && event.type !== "error";
      })
      .slice(-8)
      .map(function (event) {
        if (event.role === "user" || event.type === "user") {
          return formatPromptTimePrefix(event.createdAt) + "用户：" + summarizeMessageForAI(event);
        }

        if (event.type === "speech") {
          return formatPromptTimePrefix(event.createdAt) + (event.characterName || "角色") + "说：" + summarizeMessageForAI(event);
        }

        return formatPromptTimePrefix(event.createdAt) + "旁白：" + summarizeMessageForAI(event);
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
          buildSystemBase(context.mode === "group" ? "group" : "private"),
          buildParticipantDossier(participants, sharedMemories),
          buildMemoryStream({
            history: history || "暂无",
            chatMemoryText: formatChatMemoryList(chatMemories) || "暂无",
            longTermMemoryText: participants.map(function (character) {
              return (character.name || character.id) + "：" + (formatMemoryList(sharedMemories[character.id] || []) || "暂无");
            }).join("\n"),
            userContext: buildUserContext(context.userSettings || {}),
            worldBookContext: worldBookContext,
            bodyState: context.bodyState
          }),
          buildNaturalStyleRules("offline"),
          "每次推进形成一小段自然剧情，不要返回空数组。",
          "如果剧情里出现补偿、购物花费、红包、转账等模拟金额事件，可在对应 event 上附加 money：{\"type\":\"transfer|redPacket\",\"amount\":\"12.66\",\"direction\":\"income|expense\",\"note\":\"备注\"}。",
          "后一个动作或发言要接住前一个事件，角色顺序要自然随机，不要固定轮流。",
          "角色说话不要太长，动作描写像小说旁白但不要冗长。",
          "私聊模式只围绕当前角色和用户互动；群聊模式中多个角色可以自然互动。",
          buildMemorySummaryPrompt(context),
          buildBodyStatePrompt(context),
          buildThoughtGenerationRules(context.mode === "group" ? "group" : "private"),
          buildCurrentTask("offline", {
            userInput: context.userInput,
            requestOptions: context,
            schemaText: buildOfflineEventSchema(),
            moneyScope: context.mode === "group" ? "群聊线下" : "私聊线下",
            primaryField: "events"
          })
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

  async function generateMomentWithComments(context) {
    var source = context || {};
    var author = source.author || {};
    var relatedCharacters = Array.isArray(source.relatedCharacters) ? source.relatedCharacters : [];
    var memories = source.memories || {};
    var userContext = buildUserContext(source.userSettings || {});
    var contextText = [
      source.prompt || "",
      source.recentText || "",
      source.memoryText || "",
      source.worldText || ""
    ].join("\n");
    var worldBookContext = source.worldText || buildWorldBookContext(
      contextText,
      author.authorType === "character" || author.id ? "private" : "global",
      author.id || "",
      {
        characters: author.id ? [author].concat(relatedCharacters) : relatedCharacters
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
    var rawContent = await sendConfiguredChatMessages([
      {
        role: "system",
        content: [
          "你正在为心屿空间生成朋友圈动态和评论。",
          "只能一次性返回 JSON，不要 Markdown，不要解释，不要额外调用。",
          "评论必须和朋友圈正文同一次返回；评论像真实朋友圈短评，每条不超过 40 字。",
          "评论者只能从 relatedCharacters 里选择，最多 5 条；没有关系或不该评论就返回空数组。",
          "所有内容都要贴合角色人设、关系、记忆、世界书和当前用户人设。",
          "用户信息：" + valueOrFallback(userContext.name) + "；" + valueOrFallback(userContext.persona),
          "发布者：" + valueOrFallback(author.name) + "（" + (author.authorType === "user" ? "用户" : "角色") + "）",
          "发布者设定：" + valueOrFallback(author.authorType === "user" ? buildMergedUserPersona(author) : buildMergedCharacterPersona(author)),
          "认识的人：",
          relatedLines.join("\n") || "暂无",
          "世界书：",
          worldBookContext || "暂无匹配世界书。",
          "JSON 格式：{\"moment\":{\"content\":\"朋友圈正文\",\"images\":[{\"description\":\"可选图片描述\"}]},\"comments\":[{\"characterId\":\"角色ID\",\"content\":\"评论内容\"}],\"memories\":[{\"characterId\":\"角色ID\",\"content\":\"可写入记忆的内容\"}]}"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          "触发原因：" + valueOrFallback(source.reason || "朋友圈更新"),
          "用户/角色输入：" + valueOrFallback(source.prompt),
          "最近上下文：",
          contextText || "暂无"
        ].join("\n")
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
          "你正在为心屿空间的小手机购物 App 生成商品。",
          "只调用一次并一次性返回全部商品 JSON，不要 Markdown，不要解释。",
          "商品要适合角色互动小手机：可爱、生活、学习、礼物、零食、日用品、角色周边，价格合理。",
          "外卖至少 4 个店铺，每个店铺至少 5 个商品；网购至少 20 个商品。",
          "JSON 格式：{\"foodShops\":[{\"name\":\"店铺名\",\"description\":\"店铺描述\",\"products\":[{\"name\":\"商品名\",\"description\":\"商品描述\",\"price\":12.8,\"category\":\"主食\",\"imagePrompt\":\"可选图片提示\",\"stock\":99}]}],\"mallProducts\":[{\"name\":\"商品名\",\"description\":\"商品描述\",\"price\":39.9,\"category\":\"生活用品\",\"imagePrompt\":\"可选图片提示\",\"stock\":99}]}"
        ].join("\n")
      },
      {
        role: "user",
        content: "请生成一批温暖、有生活感、适合和虚拟角色互动的小手机商品。"
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

    return {
      replies: normalizeReplyList(rawContent, settings.replies, settings),
      actions: normalizeActionList(parsed && parsed.actions),
      thoughts: normalizeThoughtList(getThoughtPayload(parsed)),
      memories: normalizeMemoryList(parsed && parsed.memories),
      moneyDecisions: normalizeMoneyDecisionList(parsed),
      memorySummary: normalizeMemorySummaryResult(parsed && parsed.memorySummary),
      bodyState: normalizeBodyStateResult(parsed && parsed.bodyState)
    };
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
        content: normalizeAiMessageText(source.content || source.text || "")
      };
    }).filter(function (action) {
      return action.content;
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
    ["手心", "臀部", "大腿", "臀腿连接处", "腰背", "肩颈", "膝腿", "其他受影响区域"].forEach(function (partName) {
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
      recoverySuggestion: String(source.recoverySuggestion || "可适度放慢节奏、补水休息，按剧情节奏和身体反馈调整。"),
      parts: normalizedParts,
      updatedAt: Date.now()
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

  function normalizeBooleanValue(value) {
    if (value === true || value === "true" || value === "是" || value === "需要") {
      return true;
    }
    if (value === false || value === "false" || value === "否" || value === "不需要") {
      return false;
    }
    return Boolean(value);
  }

  function normalizeOfflineEventList(events, rawContent, options) {
    var settings = Object.assign({
      validIds: [],
      fallbackId: "",
      mode: "private",
      min: 10,
      max: MAX_CHAT_REPLY_COUNT
    }, options || {});
    var validIds = settings.validIds || [];
    var normalized = [];

    settings.min = Math.max(0, Number(settings.min) || 0);
    settings.max = Math.max(settings.min || 1, Number(settings.max) || MAX_CHAT_REPLY_COUNT);

    (Array.isArray(events) ? events : []).forEach(function (event, index) {
      var source = event && typeof event === "object" ? event : { content: event };
      var type = source.type === "speech" ? "speech" : "action";
      var contentParts = splitTextContentForTopUp(source.content).filter(Boolean);

      if (!contentParts.length && source.content) {
        contentParts = [String(source.content).trim()];
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

    if (normalized.length < settings.min && rawContent) {
      splitTextContentForTopUp(rawContent).forEach(function (content, index) {
        if (normalized.length >= settings.min) {
          return;
        }
        normalized.push({
          type: index % 3 === 1 && validIds.length ? "speech" : "action",
          characterId: index % 3 === 1 && validIds.length ? pickOfflineSpeaker(validIds, settings.fallbackId, settings.mode, index) : "",
          content: content
        });
      });
    }

    if (normalized.length < settings.min) {
      normalized = normalized.concat(createFallbackOfflineEvents(settings, normalized.length));
    }

    return normalized.filter(function (event) {
      return event.content && (event.type === "action" || event.characterId);
    }).slice(0, settings.max);
  }

  function createFallbackOfflineEvents(settings, currentCount) {
    var missing = Math.max(0, (Number(settings.min) || 0) - currentCount);
    var profiles = getFallbackProfiles(settings);
    var events = [];
    var used = {};
    var index = 0;

    while (events.length < missing && currentCount + events.length < settings.max) {
      var profile = profiles[index % profiles.length] || {};
      var content = pickFallbackLine(profile, index, used);
      var characterId = profile.id || pickOfflineSpeaker(settings.validIds || [], settings.fallbackId, settings.mode, index);

      events.push({
        type: characterId ? "speech" : "action",
        characterId: characterId || "",
        content: content
      });
      index += 1;
    }

    return events;
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

  function normalizeReplyList(rawContent, parsedReplies, options) {
    var settings = Object.assign({
      min: 1,
      max: MAX_CHAT_REPLY_COUNT,
      defaultType: "text",
      allowRawFallback: true
    }, options || {});
    var replies = [];
    var filtered;

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

    if (countReplyItemsForMinimum(filtered) < settings.min) {
      filtered = expandReplyListToMinimum(filtered, settings);
    }

    if (countReplyItemsForMinimum(filtered) < settings.min) {
      filtered = filtered.concat(createFallbackReplyItems(settings, filtered));
    }

    return filtered.slice(0, settings.max);
  }

  function expandReplyListToMinimum(replies, settings) {
    var result = [];
    var source = Array.isArray(replies) ? replies : [];
    var target = Math.min(Number(settings.max) || MAX_CHAT_REPLY_COUNT, Math.max(Number(settings.min) || 0, 0));

    source.forEach(function (reply) {
      var parts;

      if (countReplyItemsForMinimum(result) >= target) {
        result.push(reply);
        return;
      }

      if (!reply || reply.type !== "text") {
        result.push(reply);
        return;
      }

      parts = splitTextContentForTopUp(reply.content);
      if (parts.length <= 1) {
        result.push(reply);
        return;
      }

      parts.forEach(function (content) {
        result.push(Object.assign({}, reply, {
          content: content
        }));
      });
    });

    return result;
  }

  function countReplyItemsForMinimum(replies) {
    return (Array.isArray(replies) ? replies : []).filter(function (reply) {
      return reply && reply.content && (!reply.type || reply.type === "text");
    }).length;
  }

  function createFallbackReplyItems(settings, existingReplies) {
    var missing = Math.max(0, (Number(settings.min) || 0) - countReplyItemsForMinimum(existingReplies));
    var profiles = getFallbackProfiles(settings);
    var items = [];
    var used = {};
    var index = 0;

    while (items.length < missing && items.length + (Array.isArray(existingReplies) ? existingReplies.length : 0) < settings.max) {
      var profile = profiles[index % profiles.length] || {};
      var line = pickFallbackLine(profile, index, used);
      var reply = {
        type: "text",
        content: line
      };

      if (profile.id) {
        reply.characterId = profile.id;
      }

      items.push(reply);
      index += 1;
    }

    return items;
  }

  function getFallbackProfiles(settings) {
    var profiles = Array.isArray(settings.fallbackProfiles) ? settings.fallbackProfiles.filter(Boolean) : [];
    if (!profiles.length && settings.fallbackProfile) {
      profiles = [settings.fallbackProfile];
    }
    if (!profiles.length) {
      profiles = [{ name: "", persona: "", currentMood: "" }];
    }
    return profiles;
  }

  function pickFallbackLine(profile, index, used) {
    var bucket = getFallbackStyleBucket(profile);
    var lines = getFallbackLines(bucket, profile);
    var offset = index % lines.length;
    var line = lines[offset];
    var guard = 0;

    while (used[line] && guard < lines.length) {
      offset = (offset + 1) % lines.length;
      line = lines[offset];
      guard += 1;
    }

    used[line] = true;
    return line;
  }

  function getFallbackStyleBucket(profile) {
    var text = [profile && profile.name, profile && profile.persona, profile && profile.currentMood].join("\n");
    if (/冷淡|寡言|克制|疏离|淡漠|高冷/.test(text)) {
      return "cold";
    }
    if (/强势|控制|上位|命令|管束|掌控|严厉/.test(text)) {
      return "strong";
    }
    if (/黏|粘|撒娇|依赖|占有欲|黏人/.test(text)) {
      return "clingy";
    }
    if (/傲娇|嘴硬|别扭|毒舌/.test(text)) {
      return "tsundere";
    }
    if (/年长|老师|上司|前辈|家长|监护|师长/.test(text)) {
      return "senior";
    }
    return "default";
  }

  function getFallbackLines(bucket, profile) {
    var name = profile && profile.name ? String(profile.name).trim() : "";
    var byBucket = {
      cold: ["嗯。", "我看见了。", "别绕。", "说重点。", "这句不像随口说的。", "停一下。", "你刚才那句，留着。", "我没忽略。", "继续。", "别装没事。"],
      strong: ["先停。", "听我说。", "这件事别拖。", "按我说的来。", "先把话说清楚。", "不用躲。", "我来判断。", "你现在别乱想。", "把手头的事放一放。", "看着我回。"],
      clingy: ["你又这样。", "别把我晾在这儿。", "我想听你多说一点。", "刚才那句不许跳过。", "你回我嘛。", "我有点在意。", "别躲我。", "再说一句。", "我还在等。", "你别敷衍我。"],
      tsundere: ["谁担心你了。", "我是顺手问一句。", "别误会。", "你刚才那样很明显。", "行吧，我听着。", "别又装没事。", "烦死了。", "那你倒是说啊。", "我没生气。", "算了，先听你的。"],
      senior: ["先别急。", "把话说完整。", "我听着。", "这事先放稳。", "别自己扛着。", "按节奏来。", "先坐下。", "我知道你的意思。", "不用逞强。", "这句我会记着。"],
      default: ["嗯，我看见了。", "你刚才那句，我没跳过去。", "等一下。", "这话不像随便说的。", "我想了下。", "先别急着翻篇。", "你看着我回。", "我接着呢。", "别把话藏一半。", "继续说。"]
    };
    var lines = byBucket[bucket] || byBucket.default;

    if (name && bucket === "default") {
      return lines.slice(0, 4).concat([name + "知道了。"], lines.slice(4));
    }

    return lines;
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

  function normalizeAiMoneyReply(reply) {
    if (window.AppStorage && window.AppStorage.normalizeMoneyMessage) {
      return window.AppStorage.normalizeMoneyMessage(reply);
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
      .split(/(?:\n+|(?<=[\u3002\uFF01\uFF1F\uFF5E\u2026\uFF1B;.!?]))/g)
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

    parts = cleaned
      .split(/(?<=[，,、；;：:])|(?:\s{2,})/g)
      .map(function (part) {
        return normalizeAiMessageText(part);
      })
      .filter(function (part) {
        return part && part.length >= 3;
      });

    return parts.length > 1 ? parts : [cleaned];
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
    normalizeAiMessageText: normalizeAiMessageText,
    sendChatRequest: sendChatRequest,
    sendPrivateChatRequest: sendPrivateChatRequest,
    buildGroupSystemPrompt: buildGroupSystemPrompt,
    sendGroupChatRequest: sendGroupChatRequest,
    sendInlineOfflineRequest: sendInlineOfflineRequest,
    sendOfflineRequest: sendOfflineRequest,
    buildWorldBookContext: buildWorldBookContext,
    generateCharacterDiary: generateCharacterDiary,
    generateMomentWithComments: generateMomentWithComments,
    generateShopProducts: generateShopProducts,
    buildChatCompletionsUrl: buildChatCompletionsUrl,
    buildModelsUrl: buildModelsUrl,
    extractAiText: extractAiText,
    fetchModels: fetchModels
  };
})(window);
