(function (window, document) {
  "use strict";

  var STORAGE_KEY = "myAiApp.apiJobs";
  var STALE_RUNNING_MS = 10 * 60 * 1000;
  var JOB_TIMEOUT_MS = 75 * 1000;
  var MAX_STORED_JOBS = 20;
  var MAX_ERROR_JOBS = 5;
  var MAX_DONE_JOBS = 5;
  var DONE_RETENTION_MS = 5 * 60 * 1000;
  var ERROR_RETENTION_MS = 30 * 60 * 1000;
  var handlers = {};
  var runningJobs = {};
  var renderQueue = {};
  var listQueue = {};
  var scrollQueue = typeof WeakMap !== "undefined" ? new WeakMap() : null;

  function parseJson(value, fallback) {
    if (!value) {
      return fallback;
    }

    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn("API job store parse failed.", error);
      return fallback;
    }
  }

  function truncateText(value, maxLength) {
    var text = String(value || "").trim();
    return text.length > maxLength ? text.slice(0, maxLength) : text;
  }

  function normalizeMessagesField(messages) {
    if (Array.isArray(messages)) {
      return messages;
    }
    if (messages && typeof messages === "object") {
      if (typeof messages.beforeMessageCount === "number" || typeof messages.afterMessageCount === "number" || typeof messages.count === "number") {
        return messages;
      }
    }
    return [];
  }

  function summarizeMessageForStorage(message) {
    if (!message || typeof message !== "object") {
      return truncateText(String(message || ""), 200);
    }

    var parts = [];
    if (message.role) {
      parts.push(String(message.role));
    }
    if (typeof message.content === "string") {
      parts.push(message.content);
    } else if (typeof message.text === "string") {
      parts.push(message.text);
    } else if (typeof message.description === "string") {
      parts.push(message.description);
    } else if (typeof message.name === "string") {
      parts.push(message.name);
    } else {
      try {
        parts.push(JSON.stringify(message));
      } catch (error) {
        parts.push(String(message));
      }
    }

    return truncateText(parts.filter(Boolean).join(" ").replace(/\s+/g, " "), 200);
  }

  function summarizeMessagesForStorage(messages, countKey) {
    if (!Array.isArray(messages)) {
      messages = normalizeMessagesField(messages);
    }

    var count = Array.isArray(messages) ? messages.length : (typeof messages.count === "number" ? messages.count : 0);
    var lastMessage = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;

    return {
      [countKey]: count,
      lastMessagePreview: summarizeMessageForStorage(lastMessage)
    };
  }

  function sanitizeRequestSnapshot(source) {
    var snapshot = source && typeof source === "object" ? source : {};

    return {
      userInput: truncateText(snapshot.userInput, 300),
      sceneName: truncateText(snapshot.sceneName || "", 100),
      sceneDescription: truncateText(snapshot.sceneDescription || "", 220),
      selectedWorldBookIds: Array.isArray(snapshot.selectedWorldBookIds) ? snapshot.selectedWorldBookIds.slice(0, 20) : [],
      regenerateInstruction: truncateText(snapshot.regenerateInstruction, 300),
      blockReason: truncateText(snapshot.blockReason, 200),
      bodyStateEnabled: Boolean(snapshot.bodyStateEnabled),
      memorySummaryDue: Boolean(snapshot.memorySummaryDue),
      createdAt: Number(snapshot.createdAt) || 0
    };
  }

  function sanitizeJobForStorage(job) {
    var normalized = normalizeJob(job);

    return {
      id: normalized.id,
      targetType: normalized.targetType,
      targetId: normalized.targetId,
      mode: normalized.mode,
      status: normalized.status,
      generationId: normalized.generationId,
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt,
      error: truncateText(normalized.error, 200),
      requestSnapshot: sanitizeRequestSnapshot(normalized.requestSnapshot),
      beforeMessages: summarizeMessagesForStorage(normalized.beforeMessages, "beforeMessageCount"),
      afterMessages: summarizeMessagesForStorage(normalized.afterMessages, "afterMessageCount")
    };
  }

  function isQuotaExceeded(error) {
    var message = error && error.message ? String(error.message).toLowerCase() : "";
    return message.indexOf("quota") !== -1 || message.indexOf("storage") !== -1 || message.indexOf("disk") !== -1;
  }

  function getJobs() {
    var jobs = parseJson(localStorage.getItem(STORAGE_KEY), []);
    return Array.isArray(jobs) ? jobs : [];
  }

  function cleanupJobsFromList(jobs) {
    var now = Date.now();

    return (Array.isArray(jobs) ? jobs.slice() : []).map(function (job) {
      var normalized = normalizeJob(job);

      if (normalized.status === "running" && now - normalized.updatedAt > STALE_RUNNING_MS) {
        normalized.status = "interrupted";
        normalized.updatedAt = now;
      }

      return normalized;
    }).filter(function (job) {
      if (job.status === "done" && now - job.updatedAt > DONE_RETENTION_MS) {
        return false;
      }
      if (job.status === "error" && now - job.updatedAt > ERROR_RETENTION_MS) {
        return false;
      }
      return true;
    });
  }

  function cleanupJobs() {
    var jobs = getJobs();
    var cleaned = cleanupJobsFromList(jobs);
    if (cleaned.length !== jobs.length) {
      saveJobs(cleaned);
    }
    return cleaned;
  }

  function reduceJobsForStorage(jobs) {
    var activeStatuses = { pending: true, running: true, interrupted: true };
    var active = [];
    var error = [];
    var done = [];
    var others = [];

    (Array.isArray(jobs) ? jobs.slice() : []).forEach(function (job) {
      var normalized = normalizeJob(job);

      if (activeStatuses[normalized.status]) {
        active.push(normalized);
        return;
      }
      if (normalized.status === "error") {
        error.push(normalized);
        return;
      }
      if (normalized.status === "done") {
        done.push(normalized);
        return;
      }
      others.push(normalized);
    });

    function sortByUpdatedAt(list) {
      return list.sort(function (a, b) {
        return b.updatedAt - a.updatedAt;
      });
    }

    active = sortByUpdatedAt(active).slice(0, MAX_STORED_JOBS);
    error = sortByUpdatedAt(error).slice(0, MAX_ERROR_JOBS);
    done = sortByUpdatedAt(done).slice(0, MAX_DONE_JOBS);
    others = sortByUpdatedAt(others).slice(0, MAX_DONE_JOBS);

    var stored = active.slice();

    [error, done, others].forEach(function (list) {
      list.forEach(function (job) {
        if (stored.length < MAX_STORED_JOBS) {
          stored.push(job);
        }
      });
    });

    return stored.map(sanitizeJobForStorage);
  }

  function saveJobs(jobs) {
    jobs = cleanupJobsFromList(jobs);
    var storedJobs = reduceJobsForStorage(jobs);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(storedJobs));
      return;
    } catch (error) {
      if (!isQuotaExceeded(error)) {
        console.warn("API job storage failed.", error);
        return;
      }
    }

    try {
      var withoutDone = reduceJobsForStorage(jobs.filter(function (job) {
        return normalizeJob(job).status !== "done";
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(withoutDone));
      return;
    } catch (error) {
      if (!isQuotaExceeded(error)) {
        console.warn("API job storage failed after removing done jobs.", error);
        return;
      }
    }

    try {
      var withoutDoneError = reduceJobsForStorage(jobs.filter(function (job) {
        var status = normalizeJob(job).status;
        return status !== "done" && status !== "error";
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(withoutDoneError));
      return;
    } catch (error) {
      if (!isQuotaExceeded(error)) {
        console.warn("API job storage failed after removing done and error jobs.", error);
        return;
      }
    }

    try {
      var fallback = (Array.isArray(jobs) ? jobs.slice() : []).filter(function (job) {
        var status = normalizeJob(job).status;
        return status === "pending" || status === "running" || status === "interrupted";
      }).sort(function (a, b) {
        return normalizeJob(b).updatedAt - normalizeJob(a).updatedAt;
      }).slice(0, MAX_STORED_JOBS).map(function (job) {
        var minimal = sanitizeJobForStorage(job);
        minimal.beforeMessages = { beforeMessageCount: minimal.beforeMessages.beforeMessageCount || minimal.beforeMessages.count || 0, lastMessagePreview: minimal.beforeMessages.lastMessagePreview || "" };
        minimal.afterMessages = { afterMessageCount: minimal.afterMessages.afterMessageCount || minimal.afterMessages.count || 0, lastMessagePreview: minimal.afterMessages.lastMessagePreview || "" };
        return minimal;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback));
      return;
    } catch (error) {
      console.warn("API job storage failed after fallback compaction.", error);
    }
  }

  function createId(prefix) {
    return String(prefix || "job") + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  }

  function createGenerationId() {
    return createId("generation");
  }

  function normalizeTargetType(targetType) {
    return targetType === "group" ? "group" : (targetType === "offline" ? "offline" : "private");
  }

  function normalizeJob(source) {
    var now = Date.now();
    var job = source && typeof source === "object" ? source : {};

    return {
      id: String(job.id || createId("api_job")),
      targetType: normalizeTargetType(job.targetType),
      targetId: String(job.targetId || ""),
      mode: String(job.mode || "chat"),
      status: String(job.status || "pending"),
      requestSnapshot: job.requestSnapshot && typeof job.requestSnapshot === "object" ? job.requestSnapshot : {},
      beforeMessages: normalizeMessagesField(job.beforeMessages),
      afterMessages: normalizeMessagesField(job.afterMessages),
      generationId: String(job.generationId || createGenerationId()),
      createdAt: Number(job.createdAt) || now,
      updatedAt: Number(job.updatedAt) || now,
      error: String(job.error || "")
    };
  }

  function upsertJob(job) {
    var jobs = getJobs();
    var normalized = normalizeJob(job);
    var index = jobs.findIndex(function (item) {
      return item.id === normalized.id;
    });

    if (index === -1) {
      jobs.push(normalized);
    } else {
      jobs[index] = normalized;
    }

    saveJobs(jobs);
    return normalized;
  }

  function updateJob(jobId, patch) {
    var jobs = getJobs();
    var index = jobs.findIndex(function (item) {
      return item.id === jobId;
    });
    var next;

    if (index === -1) {
      return null;
    }

    next = normalizeJob(Object.assign({}, jobs[index], patch || {}, {
      updatedAt: Date.now()
    }));
    jobs[index] = next;
    saveJobs(jobs);
    return next;
  }

  function clearJobsForTarget(targetType, targetId) {
    var type = normalizeTargetType(targetType);
    var id = String(targetId || "");

    if (!id) {
      return false;
    }

    var jobs = getJobs().filter(function (job) {
      var normalized = normalizeJob(job);
      return !(normalized.targetType === type && normalized.targetId === id);
    });

    if (jobs.length !== getJobs().length) {
      saveJobs(jobs);
    }

    return true;
  }

  function getHandler(job) {
    return handlers[job.targetType + ":" + job.mode] || handlers[job.mode] || null;
  }

  function registerHandler(targetType, mode, handler) {
    var key;

    if (typeof mode === "function") {
      handler = mode;
      mode = targetType;
      targetType = "";
    }

    if (typeof handler !== "function") {
      return;
    }

    key = targetType ? normalizeTargetType(targetType) + ":" + mode : String(mode || "");
    handlers[key] = handler;
  }

  function hasHandler(targetType, mode) {
    return Boolean(getHandler(normalizeJob({
      targetType: targetType,
      targetId: "__handler_probe__",
      mode: mode,
      generationId: "__handler_probe__"
    })));
  }

  function isTargetRunning(targetType, targetId, modes) {
    var type = normalizeTargetType(targetType);
    var id = String(targetId || "");
    var modeList = Array.isArray(modes) ? modes.map(String) : (modes ? [String(modes)] : []);
    var jobs = getJobs();

    if (!id) {
      return false;
    }

    return jobs.some(function (job) {
      var normalized = normalizeJob(job);
      var statusActive = normalized.status === "pending" || normalized.status === "running";
      var modeMatched = !modeList.length || modeList.indexOf(normalized.mode) !== -1;

      return statusActive
        && normalized.targetType === type
        && normalized.targetId === id
        && modeMatched;
    });
  }

  async function runJob(input, executor) {
    var job = upsertJob(Object.assign({}, input || {}, {
      status: "running",
      error: "",
      updatedAt: Date.now()
    }));
    var handler = typeof executor === "function" ? executor : getHandler(job);
    var result;

    if (!handler) {
      updateJob(job.id, {
        status: "error",
        error: "No handler registered for job mode: " + job.mode
      });
      return null;
    }

    runningJobs[job.id] = true;

    try {
      var timeoutHandle;
      var timeoutPromise = new Promise(function (_, reject) {
        timeoutHandle = setTimeout(function () {
          reject(new Error("生成超时，请重试。"));
        }, JOB_TIMEOUT_MS);
      });
      result = await Promise.race([handler(job), timeoutPromise]);
      clearTimeout(timeoutHandle);
      updateJob(job.id, {
        status: "done",
        afterMessages: [],
        error: ""
      });
      return result;
    } catch (error) {
      updateJob(job.id, {
        status: "error",
        error: error && error.message ? error.message : String(error || "Unknown error")
      });
      throw error;
    } finally {
      delete runningJobs[job.id];
    }
  }

  function touchRunningJobs(status) {
    var jobs = getJobs();
    var changed = false;

    jobs = jobs.map(function (job) {
      if (job.status !== "running") {
        return job;
      }

      changed = true;
      return normalizeJob(Object.assign({}, job, {
        status: status || "running",
        updatedAt: Date.now()
      }));
    });

    if (changed) {
      saveJobs(jobs);
    }
  }

  function resumeInterruptedJobs() {
    var now = Date.now();
    var jobs = getJobs();
    var runnable = [];
    var changed = false;

    jobs = jobs.map(function (job) {
      var next = normalizeJob(job);

      if (next.status === "running" && (!runningJobs[next.id] || now - next.updatedAt > STALE_RUNNING_MS)) {
        next.status = "interrupted";
        next.updatedAt = now;
        changed = true;
        runnable.push(Object.assign({}, next, {
          status: "pending",
          updatedAt: now
        }));
      } else if (next.status === "pending") {
        runnable.push(next);
      }

      return next;
    });

    if (changed) {
      saveJobs(jobs);
    }

    runnable.forEach(function (job) {
      var handler = getHandler(job);

      if (!handler || runningJobs[job.id] || hasGeneratedOutput(job.targetType, job.targetId, job.generationId)) {
        return;
      }

      runJob(Object.assign({}, job, {
        status: "pending"
      })).catch(function (error) {
        console.warn("API job resume failed.", error);
      });
    });
  }

  function hasGeneratedOutput(targetType, targetId, generationId) {
    var type = normalizeTargetType(targetType);
    var id = String(targetId || "");
    var gid = String(generationId || "");
    var messages;
    var session;

    if (!gid || !window.AppStorage) {
      return false;
    }

    if (type === "group") {
      messages = window.AppStorage.getGroupChatHistory ? window.AppStorage.getGroupChatHistory(id) : [];
      return messages.some(function (message) {
        return message && message.generationId === gid && message.type !== "loading";
      });
    }

    if (type === "offline") {
      session = window.AppStorage.getOfflineSession ? window.AppStorage.getOfflineSession(id) : null;
      return Boolean(session && Array.isArray(session.history) && session.history.some(function (event) {
        return event && event.generationId === gid && event.type !== "loading";
      }));
    }

    messages = window.AppStorage.getChatHistory ? window.AppStorage.getChatHistory(id) : [];
    return messages.some(function (message) {
      return message && message.generationId === gid && message.type !== "loading";
    });
  }

  function scheduleRenderChat(targetType, targetId) {
    var type = normalizeTargetType(targetType);
    var id = String(targetId || "");
    var key = type + ":" + id;

    if (renderQueue[key]) {
      return;
    }

    renderQueue[key] = true;
    requestAnimationFrame(function () {
      delete renderQueue[key];
      renderNow(type, id);
    });
  }

  function renderNow(targetType, targetId) {
    if (targetType === "group") {
      if (window.GroupManager && window.GroupManager.getActiveGroupId && window.GroupManager.getActiveGroupId() === targetId) {
        window.GroupManager.renderGroupChatMessages(targetId);
      }
      return;
    }

    if (targetType === "offline") {
      if (window.OfflineManager && window.OfflineManager.getCurrentSession && window.OfflineManager.getCurrentSession() && window.OfflineManager.getCurrentSession().id === targetId) {
        window.OfflineManager.renderOfflineMessages();
      }
      return;
    }

    if (window.CharacterManager && window.CharacterManager.getActiveCharacterId && window.CharacterManager.getActiveCharacterId() === targetId) {
      window.CharacterManager.renderChatMessages(targetId);
    }
  }

  function scheduleRenderList(targetType) {
    var type = normalizeTargetType(targetType);

    if (listQueue[type]) {
      return;
    }

    listQueue[type] = true;
    requestAnimationFrame(function () {
      delete listQueue[type];
      if (type === "group") {
        if (window.GroupManager && window.GroupManager.renderGroupList) {
          window.GroupManager.renderGroupList();
        }
        return;
      }
      if (window.CharacterManager && window.CharacterManager.renderCharacterList) {
        window.CharacterManager.renderCharacterList();
      }
    });
  }

  function scheduleScrollToBottom(element) {
    if (!element) {
      return;
    }

    if (scrollQueue) {
      if (scrollQueue.get(element)) {
        return;
      }
      scrollQueue.set(element, true);
    } else if (element.__appScrollQueued) {
      return;
    } else {
      element.__appScrollQueued = true;
    }

    requestAnimationFrame(function () {
      if (scrollQueue) {
        scrollQueue.delete(element);
      } else {
        element.__appScrollQueued = false;
      }
      element.scrollTop = element.scrollHeight;
    });
  }

  function saveChatHistoryDebounced(targetType, targetId, messages, delay) {
    if (!window.AppStorage) {
      return;
    }

    if (normalizeTargetType(targetType) === "group") {
      if (window.AppStorage.saveGroupChatHistoryDebounced) {
        window.AppStorage.saveGroupChatHistoryDebounced(targetId, messages, delay);
      } else {
        window.AppStorage.saveGroupChatHistory(targetId, messages);
      }
      return;
    }

    if (window.AppStorage.saveChatHistoryDebounced) {
      window.AppStorage.saveChatHistoryDebounced(targetId, messages, delay);
    } else {
      window.AppStorage.saveChatHistory(targetId, messages);
    }
  }

  function flushChatHistorySave(targetType, targetId) {
    if (!window.AppStorage) {
      return;
    }

    if (normalizeTargetType(targetType) === "group") {
      if (window.AppStorage.flushGroupChatHistorySave) {
        window.AppStorage.flushGroupChatHistorySave(targetId);
      }
      return;
    }

    if (window.AppStorage.flushChatHistorySave) {
      window.AppStorage.flushChatHistorySave(targetId);
    }
  }

  function saveOfflineSessionDebounced(session, delay) {
    if (window.AppStorage && window.AppStorage.saveOfflineSessionDebounced) {
      window.AppStorage.saveOfflineSessionDebounced(session, delay);
    } else if (window.AppStorage && window.AppStorage.saveOfflineSession) {
      window.AppStorage.saveOfflineSession(session);
    }
  }

  function flushAll() {
    touchRunningJobs("running");
    if (window.AppStorage && window.AppStorage.flushAllDebouncedSaves) {
      window.AppStorage.flushAllDebouncedSaves();
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      flushAll();
    }
  });

  window.addEventListener("pagehide", flushAll);

  window.AppApiJobs = {
    createGenerationId: createGenerationId,
    getJobs: getJobs,
    runJob: runJob,
    registerHandler: registerHandler,
    hasHandler: hasHandler,
    isTargetRunning: isTargetRunning,
    resumeInterruptedJobs: resumeInterruptedJobs,
    touchRunningJobs: touchRunningJobs,
    scheduleRenderChat: scheduleRenderChat,
    scheduleRenderList: scheduleRenderList,
    scheduleScrollToBottom: scheduleScrollToBottom,
    saveChatHistoryDebounced: saveChatHistoryDebounced,
    flushChatHistorySave: flushChatHistorySave,
    saveOfflineSessionDebounced: saveOfflineSessionDebounced,
    flushAll: flushAll,
    cleanupJobs: cleanupJobs,
    clearJobsForTarget: clearJobsForTarget,
    clearFinishedJobs: function () {
      var jobs = getJobs().filter(function (job) {
        return normalizeJob(job).status !== "done" && normalizeJob(job).status !== "error";
      });
      saveJobs(jobs);
    },
    getStorageSize: function () {
      var data = localStorage.getItem(STORAGE_KEY);
      return data ? data.length : 0;
    },
    hasGeneratedOutput: hasGeneratedOutput
  };
})(window, document);
