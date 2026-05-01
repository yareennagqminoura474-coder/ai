(function (window) {
  "use strict";

  var currentSessionId = null;
  var autoAdvanceTimer = null;
  var watchReturnPage = "homeScreen";
  var AUTO_ADVANCE_DELAY = 12000;

  function createId(prefix) {
    return String(prefix || "watch") + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getCurrentSession() {
    if (!currentSessionId || !window.AppStorage) {
      return null;
    }
    return window.AppStorage.getWatchSession(currentSessionId);
  }

  function getCharactersForSession(session) {
    if (!session || !window.AppStorage) {
      return [];
    }
    var allChars = window.AppStorage.getCharacters();
    return (session.participantIds || []).map(function (id) {
      return allChars.filter(function (c) { return c.id === id; })[0] || null;
    }).filter(Boolean);
  }

  function normalizeSetupReturnPage(pageId) {
    return pageId === "wechatScreen" || pageId === "watchListScreen"
      ? pageId
      : "homeScreen";
  }

  function isWatchScreenActive() {
    return Boolean(window.AppNavigation
      && window.AppNavigation.getActivePage
      && window.AppNavigation.getActivePage() === "watchScreen");
  }

  function returnToWatchList() {
    stopAutoAdvance();
    currentSessionId = null;
    if (window.setActivePage) {
      window.setActivePage("watchListScreen");
    }
  }

  // ── Setup screen ──────────────────────────────────────────────

  function openWatchSetup(returnPage) {
    watchReturnPage = normalizeSetupReturnPage(returnPage);
    renderWatchSetupForm();
    window.setActivePage("watchSetupScreen");
  }

  function renderWatchSetupForm() {
    var form = document.getElementById("watchSetupForm");
    if (!form) {
      return;
    }

    var characters = window.AppStorage ? window.AppStorage.getCharacters() : [];

    var memberRows = characters.length > 0
      ? characters.map(function (char) {
          var initial = escapeHtml((char.name || "?").slice(0, 1));
          var hasAvatar = char.avatar;
          var avatarHtml = hasAvatar
            ? '<img class="member-avatar-img watch-member-avatar" src="' + escapeHtml(char.avatar) + '" alt="">'
            : '<span class="member-avatar watch-member-avatar">' + initial + '</span>';
          return [
            '<label class="member-select-item">',
            '  <input type="checkbox" name="watchChar" value="' + escapeHtml(char.id) + '">',
            '  ' + avatarHtml,
            '  <span class="member-name">' + escapeHtml(char.name || "未命名") + '</span>',
            '</label>'
          ].join("");
        }).join("")
      : '<p class="field-help">还没有角色，请先创建角色。</p>';

    form.innerHTML = [
      '<div class="form-error" id="watchSetupError" role="alert" aria-live="polite"></div>',
      '<section class="form-section">',
      '  <div class="section-title-row"><h3>选择角色</h3><span>至少 1 个</span></div>',
      '  <div id="watchCharacterList" class="member-select-list">',
      memberRows,
      '  </div>',
      '</section>',
      '<section class="form-section">',
      '  <div class="section-title-row"><h3>场景设置</h3><span>可选</span></div>',
      '  <div class="field-group">',
      '    <label for="watchSceneName">场景 / 地点</label>',
      '    <input id="watchSceneName" type="text" placeholder="例如：咖啡馆、深夜宿舍、某个下午" maxlength="50">',
      '  </div>',
      '  <div class="field-group">',
      '    <label for="watchSceneDesc">当前氛围 / 设定说明</label>',
      '    <textarea id="watchSceneDesc" placeholder="描述氛围、时间、背景，或角色们当前的关系状态。可以留空。" maxlength="300"></textarea>',
      '  </div>',
      '</section>'
    ].join("");
  }

  function createWatchSession() {
    var form = document.getElementById("watchSetupForm");
    if (!form) {
      return;
    }

    var checkboxes = form.querySelectorAll("input[name=\"watchChar\"]:checked");
    var participantIds = Array.prototype.map.call(checkboxes, function (cb) { return cb.value; });

    if (participantIds.length === 0) {
      var err = document.getElementById("watchSetupError");
      if (err) {
        err.textContent = "请至少选择一个角色。";
      }
      return;
    }

    var sceneNameEl = document.getElementById("watchSceneName");
    var sceneDescEl = document.getElementById("watchSceneDesc");
    var sceneName = sceneNameEl ? String(sceneNameEl.value || "").trim() : "";
    var sceneDesc = sceneDescEl ? String(sceneDescEl.value || "").trim() : "";

    var characters = window.AppStorage.getCharacters().filter(function (c) {
      return participantIds.indexOf(c.id) !== -1;
    });

    var sessionTitle = characters.map(function (c) { return c.name || "角色"; }).join("、")
      + (sceneName ? " · " + sceneName : "");

    var session = {
      id: createId("watch"),
      title: sessionTitle,
      participantIds: participantIds,
      scene: {
        name: sceneName,
        description: sceneDesc
      },
      directorNotes: [],
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    window.AppStorage.saveWatchSession(session);
    openWatchSession(session.id);
  }

  // ── Watch session screen ──────────────────────────────────────

  function openWatchSession(sessionId) {
    currentSessionId = sessionId;
    var session = getCurrentSession();

    if (!session) {
      currentSessionId = null;
      window.showToast && window.showToast("找不到观看会话", true);
      window.setActivePage("watchListScreen");
      return;
    }

    updateWatchHeader(session);
    renderWatchMessages();
    window.setActivePage("watchScreen");

    if (!session.history || session.history.length === 0) {
      setTimeout(function () {
        advanceWatch("");
      }, 500);
    }
  }

  function updateWatchHeader(session) {
    var titleEl = document.getElementById("watchTitle");
    if (titleEl) {
      titleEl.textContent = session && session.title ? session.title : "观看";
    }
    var noteEl = document.getElementById("watchDirectorNote");
    if (noteEl) {
      noteEl.value = "";
    }
    updateAutoToggleUI();
  }

  // ── AI advance ────────────────────────────────────────────────

  async function advanceWatch(directorNote) {
    var session = getCurrentSession();
    if (!session) {
      returnToWatchList();
      return;
    }

    if (!window.AIService || !window.AIService.sendWatchRequest) {
      window.showToast && window.showToast("AI 服务不可用", true);
      return;
    }

    var profile = window.AppStorage.getActiveApiProfile ? window.AppStorage.getActiveApiProfile() : null;
    if (!profile || !profile.apiUrl || !profile.apiKey || !profile.modelName) {
      stopAutoAdvance();
      window.showToast && window.showToast(window.AIService.MISSING_SETTINGS_MESSAGE || "请先填写 API 设置", true);
      return;
    }

    var characters = getCharactersForSession(session);
    if (!characters.length) {
      window.showToast && window.showToast("找不到参与角色", true);
      return;
    }

    var noteText = String(directorNote || "").trim();
    appendWatchLoadingEvent();

    try {
      var result = await window.AIService.sendWatchRequest(session, characters, {
        directorNote: noteText
      });

      removeWatchLoadingEvent();

      var now = Date.now();
      var newEvents = [];

      (result.messages || []).forEach(function (msg) {
        if (!msg || !msg.content) {
          return;
        }
        var characterId = String(msg.characterId || "");
        var char = characters.filter(function (c) { return c.id === characterId; })[0] || null;
        newEvents.push({
          id: createId("we"),
          role: msg.type === "action" ? "action" : "character",
          type: String(msg.type || "text"),
          characterId: characterId,
          characterName: char ? (char.name || "") : "",
          content: String(msg.content || ""),
          createdAt: now
        });
        now += 50;
      });

      session = getCurrentSession();
      if (!session) {
        return;
      }

      session.history = (session.history || []).concat(newEvents);
      session.updatedAt = Date.now();

      if (noteText) {
        session.directorNotes = (session.directorNotes || []).concat([{
          content: noteText,
          createdAt: Date.now()
        }]);
      }

      window.AppStorage.saveWatchSessionDebounced(session, 120);
      renderWatchMessages();

      (result.thoughts || []).forEach(function (thought) {
        if (!thought || !thought.characterId || !thought.content) {
          return;
        }
        window.AppStorage.addCharacterThought(thought.characterId, {
          content: String(thought.content || ""),
          mood: String(thought.mood || ""),
          visibleSummary: String(thought.visibleSummary || ""),
          source: "watch",
          targetType: "watch",
          targetId: session.id,
          chatId: "watch:" + session.id,
          createdAt: Date.now()
        });
      });

      (result.memories || []).forEach(function (mem) {
        if (!mem || !mem.characterId || !mem.content) {
          return;
        }
        window.AppStorage.addCharacterMemory(mem.characterId, {
          content: String(mem.content || ""),
          source: "watch",
          targetType: "watch",
          targetId: session.id,
          relatedCharacterIds: Array.isArray(mem.relatedCharacterIds) ? mem.relatedCharacterIds : [],
          createdAt: Date.now()
        });
      });

    } catch (err) {
      removeWatchLoadingEvent();
      var errMsg = err && err.message ? String(err.message) : "生成失败，请重试";
      window.showToast && window.showToast(errMsg, true);
    }
  }

  function appendWatchLoadingEvent() {
    var container = document.getElementById("watchMessages");
    if (!container) {
      return;
    }
    var el = document.createElement("div");
    el.id = "watchLoadingEvent";
    el.className = "watch-loading";
    el.innerHTML = '<span class="watch-loading-dots"><em></em><em></em><em></em></span>';
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  function removeWatchLoadingEvent() {
    var el = document.getElementById("watchLoadingEvent");
    if (el) {
      el.parentNode.removeChild(el);
    }
  }

  // ── Render ────────────────────────────────────────────────────

  function renderWatchMessages() {
    var container = document.getElementById("watchMessages");
    if (!container) {
      return;
    }

    var session = getCurrentSession();
    if (!session) {
      if (isWatchScreenActive()) {
        returnToWatchList();
      }
      return;
    }

    var characters = getCharactersForSession(session);
    var charMap = {};
    characters.forEach(function (c) { charMap[c.id] = c; });

    var history = session.history || [];

    if (!history.length) {
      container.innerHTML = '<div class="watch-empty"><p>正在准备场景……</p></div>';
      return;
    }

    container.innerHTML = history.map(function (event) {
      return renderWatchEvent(event, charMap);
    }).join("");

    container.scrollTop = container.scrollHeight;
  }

  function renderWatchEvent(event, charMap) {
    if (!event) {
      return "";
    }

    if (event.type === "action" || event.role === "action") {
      return '<div class="watch-action-line">' + escapeHtml(event.content || "") + '</div>';
    }

    var char = charMap && event.characterId ? charMap[event.characterId] : null;
    var nameText = char && char.name ? char.name : (event.characterName || "");
    var initial = escapeHtml((nameText || "?").slice(0, 1));
    var avatarHtml = char && char.avatar
      ? '<img class="watch-avatar" src="' + escapeHtml(char.avatar) + '" alt="">'
      : '<span class="watch-avatar">' + initial + '</span>';

    return [
      '<div class="watch-speech-row">',
      '  ' + avatarHtml,
      '  <div class="watch-speech-main">',
      '    <span class="watch-name">' + escapeHtml(nameText) + '</span>',
      '    <div class="watch-bubble">' + escapeHtml(event.content || "") + '</div>',
      '  </div>',
      '</div>'
    ].join("");
  }

  // ── Auto advance ──────────────────────────────────────────────

  function updateAutoToggleUI() {
    var toggle = document.getElementById("watchAutoToggle");
    if (toggle) {
      toggle.checked = Boolean(autoAdvanceTimer);
    }
  }

  function startAutoAdvance() {
    stopAutoAdvance();
    autoAdvanceTimer = setInterval(function () {
      var session = getCurrentSession();
      if (!session) {
        stopAutoAdvance();
        return;
      }
      if (document.getElementById("watchLoadingEvent")) {
        return;
      }
      advanceWatch("");
    }, AUTO_ADVANCE_DELAY);
    updateAutoToggleUI();
  }

  function stopAutoAdvance() {
    if (autoAdvanceTimer) {
      clearInterval(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
    updateAutoToggleUI();
  }

  // ── Session control ───────────────────────────────────────────

  function clearWatchHistory() {
    var session = getCurrentSession();
    if (!session) {
      return;
    }
    session.history = [];
    session.directorNotes = [];
    session.updatedAt = Date.now();
    window.AppStorage.saveWatchSession(session);
    renderWatchMessages();
  }

  function endWatchSession() {
    stopAutoAdvance();
    currentSessionId = null;
    window.setActivePage("watchListScreen");
  }

  // ── Watch session list ────────────────────────────────────────

  function renderWatchSessionList() {
    var container = document.getElementById("watchSessionList");
    if (!container) {
      return;
    }

    var sessions = window.AppStorage ? window.AppStorage.getAllWatchSessions() : [];

    if (!sessions.length) {
      container.innerHTML = [
        '<div class="soft-empty soft-empty-card">',
        '  <span class="soft-empty-icon" aria-hidden="true">眼</span>',
        '  <strong>还没有观看记录</strong>',
        '  <em>点击右上角 + 新建观看</em>',
        '</div>'
      ].join("");
      return;
    }

    container.innerHTML = sessions.map(function (session) {
      var lastEvent = session.history && session.history.length > 0
        ? session.history[session.history.length - 1]
        : null;
      var preview = lastEvent ? String(lastEvent.content || "").slice(0, 30) : "暂无记录";
      var count = session.history ? session.history.length : 0;
      return [
        '<div class="watch-session-card" data-watch-session-id="' + escapeHtml(session.id) + '">',
        '  <div class="watch-session-info">',
        '    <strong class="watch-session-title">' + escapeHtml(session.title || "观看") + '</strong>',
        '    <em class="watch-session-preview">' + escapeHtml(preview) + '</em>',
        '  </div>',
        '  <span class="watch-session-count">' + count + ' 条</span>',
        '</div>'
      ].join("");
    }).join("");

    Array.prototype.forEach.call(
      container.querySelectorAll("[data-watch-session-id]"),
      function (card) {
        card.addEventListener("click", function () {
          openWatchSession(card.dataset.watchSessionId);
        });
      }
    );
  }

  // ── Binding ───────────────────────────────────────────────────

  function bindWatchSetupActions() {
    var backBtn = document.getElementById("watchSetupBackBtn");
    var startBtn = document.getElementById("startWatchBtn");

    if (backBtn) {
      backBtn.addEventListener("click", function () {
        window.setActivePage(normalizeSetupReturnPage(watchReturnPage));
      });
    }

    if (startBtn) {
      startBtn.addEventListener("click", createWatchSession);
    }
  }

  function bindWatchScreenActions() {
    var backBtn = document.getElementById("watchBackBtn");
    var advanceBtn = document.getElementById("watchAdvanceBtn");
    var autoToggle = document.getElementById("watchAutoToggle");
    var clearBtn = document.getElementById("watchClearBtn");
    var endBtn = document.getElementById("watchEndBtn");
    var thoughtsBtn = document.getElementById("watchThoughtsBtn");

    if (backBtn) {
      backBtn.addEventListener("click", function () {
        stopAutoAdvance();
        window.setActivePage("watchListScreen");
      });
    }

    if (advanceBtn) {
      advanceBtn.addEventListener("click", function () {
        var noteEl = document.getElementById("watchDirectorNote");
        var note = noteEl ? String(noteEl.value || "").trim() : "";
        if (noteEl) {
          noteEl.value = "";
        }
        advanceWatch(note);
      });
    }

    if (autoToggle) {
      autoToggle.addEventListener("change", function () {
        if (autoToggle.checked) {
          startAutoAdvance();
        } else {
          stopAutoAdvance();
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        if (window.confirm("清空本次观看记录？")) {
          clearWatchHistory();
        }
      });
    }

    if (endBtn) {
      endBtn.addEventListener("click", function () {
        if (window.confirm("结束观看并返回？")) {
          endWatchSession();
        }
      });
    }

    if (thoughtsBtn) {
      thoughtsBtn.addEventListener("click", function () {
        var session = getCurrentSession();
        if (!session) {
          return;
        }
        var characterIds = session.participantIds || [];
        if (window.AppExtras && window.AppExtras.openThoughtsDrawer) {
          window.AppExtras.openThoughtsDrawer({
            title: "观看心声",
            characterIds: characterIds,
            chatId: "watch:" + session.id
          });
        } else if (characterIds.length > 0 && window.AppExtras && window.AppExtras.openThoughtsForCharacter) {
          window.AppExtras.openThoughtsForCharacter(characterIds[0]);
        }
      });
    }
  }

  function bindWatchListActions() {
    var newBtn = document.getElementById("newWatchBtn");
    if (newBtn) {
      newBtn.addEventListener("click", function () {
        openWatchSetup("watchListScreen");
      });
    }
  }

  function init() {
    bindWatchSetupActions();
    bindWatchScreenActions();
    bindWatchListActions();
  }

  window.WatchManager = {
    init: init,
    openSetup: openWatchSetup,
    openSession: openWatchSession,
    createSession: createWatchSession,
    renderMessages: renderWatchMessages,
    renderSessionList: renderWatchSessionList,
    advance: advanceWatch,
    stopAutoAdvance: stopAutoAdvance,
    endSession: endWatchSession,
    getCurrentSessionId: function () { return currentSessionId; }
  };

  document.addEventListener("DOMContentLoaded", init);
})(window);
