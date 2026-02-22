const elements = {
  initMediaBtn: document.getElementById("initMediaBtn"),
  startRecordBtn: document.getElementById("startRecordBtn"),
  stopRecordBtn: document.getElementById("stopRecordBtn"),
  cameraSelect: document.getElementById("cameraSelect"),
  micSelect: document.getElementById("micSelect"),
  recordStatus: document.getElementById("recordStatus"),
  recordTimer: document.getElementById("recordTimer"),
  previewVideo: document.getElementById("previewVideo"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  fullscreenStage: document.getElementById("fullscreenStage"),
  fullscreenVideo: document.getElementById("fullscreenVideo"),
  fullscreenTeleprompterViewport: document.getElementById("fullscreenTeleprompterViewport"),
  fullscreenTeleprompterContent: document.getElementById("fullscreenTeleprompterContent"),
  fullscreenStartRecordBtn: document.getElementById("fullscreenStartRecordBtn"),
  fullscreenStopRecordBtn: document.getElementById("fullscreenStopRecordBtn"),
  fullscreenFollowToggleBtn: document.getElementById("fullscreenFollowToggleBtn"),
  fullscreenMirrorToggleBtn: document.getElementById("fullscreenMirrorToggleBtn"),
  fullscreenFollowHint: document.getElementById("fullscreenFollowHint"),
  fullscreenFontSizeRange: document.getElementById("fullscreenFontSizeRange"),
  fullscreenFontSizeValue: document.getElementById("fullscreenFontSizeValue"),
  fullscreenFontDownBtn: document.getElementById("fullscreenFontDownBtn"),
  fullscreenFontUpBtn: document.getElementById("fullscreenFontUpBtn"),
  fullscreenModeHint: document.getElementById("fullscreenModeHint"),
  playbackVideo: document.getElementById("playbackVideo"),
  recordResultMsg: document.getElementById("recordResultMsg"),
  downloadLink: document.getElementById("downloadLink"),
  languageSelect: document.getElementById("languageSelect"),
  scriptInput: document.getElementById("scriptInput"),
  loadScriptBtn: document.getElementById("loadScriptBtn"),
  startFollowBtn: document.getElementById("startFollowBtn"),
  stopFollowBtn: document.getElementById("stopFollowBtn"),
  prevLineBtn: document.getElementById("prevLineBtn"),
  nextLineBtn: document.getElementById("nextLineBtn"),
  resetPromptBtn: document.getElementById("resetPromptBtn"),
  speakBtn: document.getElementById("speakBtn"),
  stopSpeakBtn: document.getElementById("stopSpeakBtn"),
  speechStatus: document.getElementById("speechStatus"),
  transcriptOutput: document.getElementById("transcriptOutput"),
  teleprompterContent: document.getElementById("teleprompterContent"),
};

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const statusClasses = ["status-neutral", "status-success", "status-warning", "status-danger"];
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const RESTARTABLE_FOLLOW_ERRORS = new Set(["aborted", "audio-capture", "network", "no-speech"]);
const FOLLOW_WATCHDOG_INTERVAL_MS = 3000;
const FOLLOW_STALL_TIMEOUT_MS = 18000;
const FOLLOW_SESSION_REFRESH_MS = 55000;
const RECORD_MIME_PREFERENCES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=h264,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
const VIDEO_CONSTRAINT_PROFILES = [
  { width: 3840, height: 2160, frameRateIdeal: 30, frameRateMax: 60, label: "4K" },
  { width: 2560, height: 1440, frameRateIdeal: 30, frameRateMax: 60, label: "2K" },
  { width: 1920, height: 1080, frameRateIdeal: 30, frameRateMax: 60, label: "1080p" },
  { width: 1280, height: 720, frameRateIdeal: 30, frameRateMax: 30, label: "720p" },
];

const state = {
  stream: null,
  mediaRecorder: null,
  recording: false,
  recordTimerId: null,
  recordSeconds: 0,
  recordedChunks: [],
  playbackUrl: null,
  scriptLines: [],
  normalizedScript: "",
  currentNormIndex: 0,
  currentLineIndex: -1,
  recognition: null,
  followActive: false,
  followRestartTimerId: null,
  followWatchdogIntervalId: null,
  followSessionRefreshTimerId: null,
  followRestartAttempts: 0,
  followLastStartAt: 0,
  followLastResultAt: 0,
  followConsecutiveStalls: 0,
  recognitionRunning: false,
  recentTranscript: "",
  ttsActive: false,
  fullscreenActive: false,
  fullscreenMirrorEnabled: false,
  fullscreenFontSize: 52,
  autoFollowEnabled: true,
  activeVideoSettings: null,
  activeRecordConfig: null,
};

function setStatus(node, message, type = "neutral") {
  if (!node) {
    return;
  }
  for (const cls of statusClasses) {
    node.classList.remove(cls);
  }
  node.classList.add(`status-${type}`);
  node.textContent = message;
}

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
}

async function requestStageFullscreen() {
  if (typeof elements.fullscreenStage.requestFullscreen === "function") {
    await elements.fullscreenStage.requestFullscreen();
    return true;
  }
  if (typeof elements.fullscreenStage.webkitRequestFullscreen === "function") {
    elements.fullscreenStage.webkitRequestFullscreen();
    return true;
  }
  if (typeof elements.fullscreenStage.msRequestFullscreen === "function") {
    elements.fullscreenStage.msRequestFullscreen();
    return true;
  }
  return false;
}

async function exitDocumentFullscreen() {
  if (typeof document.exitFullscreen === "function") {
    await document.exitFullscreen();
    return;
  }
  if (typeof document.webkitExitFullscreen === "function") {
    document.webkitExitFullscreen();
    return;
  }
  if (typeof document.msExitFullscreen === "function") {
    document.msExitFullscreen();
  }
}

function formatDuration(seconds) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainSeconds = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remainSeconds}`;
}

function normalizeText(text) {
  if (!text) {
    return "";
  }
  const normalized = text.toLowerCase().normalize("NFKC");
  try {
    return normalized.replace(/[^\p{L}\p{N}]+/gu, "");
  } catch (_error) {
    return normalized.replace(/[\s`~!@#$%^&*()\-_=+[{\]}\\|;:'",<.>/?，。！？、；：「」『』（）【】《》〈〉…—]/g, "");
  }
}

function buildScriptFromInput(raw) {
  const lines = raw.split(/\r?\n/);
  const metas = [];
  let cursor = 0;
  let joinedNormalized = "";

  for (const originalLine of lines) {
    const normalizedLine = normalizeText(originalLine);
    const lineStart = cursor;
    const lineEnd = lineStart + normalizedLine.length;
    const searchable = normalizedLine.length > 0;
    if (searchable) {
      cursor = lineEnd;
      joinedNormalized += normalizedLine;
    }
    metas.push({
      textOriginal: originalLine,
      textDisplay: originalLine.trim().length ? originalLine : "　",
      normalized: normalizedLine,
      normStart: lineStart,
      normEnd: lineEnd,
      searchable,
      mainElement: null,
      fullscreenElement: null,
    });
  }

  state.scriptLines = metas;
  state.normalizedScript = joinedNormalized;
  state.currentNormIndex = 0;
  state.currentLineIndex = -1;
}

function renderScript() {
  elements.teleprompterContent.innerHTML = "";
  elements.fullscreenTeleprompterContent.innerHTML = "";

  if (!state.scriptLines.length) {
    const mainEmpty = document.createElement("p");
    mainEmpty.className = "empty";
    mainEmpty.textContent = "请先加载提词稿。";
    elements.teleprompterContent.append(mainEmpty);

    const fullscreenEmpty = document.createElement("p");
    fullscreenEmpty.className = "empty";
    fullscreenEmpty.textContent = "请先加载提词稿。";
    elements.fullscreenTeleprompterContent.append(fullscreenEmpty);
    return;
  }

  const mainFragment = document.createDocumentFragment();
  const fullscreenFragment = document.createDocumentFragment();
  state.scriptLines.forEach((lineMeta, index) => {
    const mainLine = document.createElement("p");
    mainLine.className = "prompt-line is-upcoming";
    mainLine.textContent = lineMeta.textDisplay;
    mainLine.setAttribute("data-line-index", String(index));
    mainLine.addEventListener("click", () => {
      setPromptByLineIndex(index);
    });
    lineMeta.mainElement = mainLine;
    mainFragment.append(mainLine);

    const fullscreenLine = document.createElement("p");
    fullscreenLine.className = "prompt-line prompt-line-fullscreen is-upcoming";
    fullscreenLine.textContent = lineMeta.textDisplay;
    fullscreenLine.setAttribute("data-line-index", String(index));
    fullscreenLine.addEventListener("click", () => {
      setPromptByLineIndex(index, true, "fullscreen");
    });
    lineMeta.fullscreenElement = fullscreenLine;
    fullscreenFragment.append(fullscreenLine);
  });

  elements.teleprompterContent.append(mainFragment);
  elements.fullscreenTeleprompterContent.append(fullscreenFragment);
}

function getFirstSearchableLineIndex() {
  for (let i = 0; i < state.scriptLines.length; i += 1) {
    if (state.scriptLines[i].searchable) {
      return i;
    }
  }
  return -1;
}

function getLineIndexFromNormIndex(normIndex) {
  let fallback = -1;
  for (let i = 0; i < state.scriptLines.length; i += 1) {
    const line = state.scriptLines[i];
    if (!line.searchable) {
      continue;
    }
    fallback = i;
    if (normIndex <= line.normEnd) {
      return i;
    }
  }
  return fallback;
}

function refreshFullscreenHint() {
  elements.fullscreenModeHint.textContent = getFullscreenElement() ? "按 Esc 可离开全螢幕" : "按按钮可离开全螢幕";
}

function updateMirrorToggleUI() {
  const enabled = state.fullscreenMirrorEnabled;
  elements.fullscreenStage.classList.toggle("is-mirrored", enabled);
  elements.fullscreenMirrorToggleBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
  elements.fullscreenMirrorToggleBtn.textContent = enabled ? "镜像画面：开" : "镜像画面：关";
  elements.fullscreenMirrorToggleBtn.classList.toggle("btn-secondary", enabled);
  elements.fullscreenMirrorToggleBtn.classList.toggle("btn-ghost", !enabled);
}

function clampFullscreenFontSize(size) {
  const numericSize = Number(size);
  if (Number.isNaN(numericSize)) {
    return state.fullscreenFontSize;
  }
  const max = Number(elements.fullscreenFontSizeRange.max);
  const min = Number(elements.fullscreenFontSizeRange.min);
  return Math.min(max, Math.max(min, numericSize));
}

function syncFullscreenFontSize() {
  const clamped = clampFullscreenFontSize(state.fullscreenFontSize);
  state.fullscreenFontSize = clamped;
  elements.fullscreenTeleprompterViewport.style.setProperty("--fullscreen-font-size", `${clamped}px`);
  elements.fullscreenFontSizeRange.value = String(clamped);
  elements.fullscreenFontSizeValue.textContent = `${clamped}px`;
}

function adjustFullscreenFontSize(delta) {
  state.fullscreenFontSize = clampFullscreenFontSize(state.fullscreenFontSize + delta);
  syncFullscreenFontSize();
}

function setFullscreenStageActive(active) {
  state.fullscreenActive = active;
  elements.fullscreenStage.classList.toggle("is-active", active);
  elements.fullscreenStage.setAttribute("aria-hidden", active ? "false" : "true");
  document.body.classList.toggle("is-fullscreen-mode", active);
  if (active) {
    try {
      elements.fullscreenTeleprompterViewport.focus({ preventScroll: true });
    } catch (_error) {
      elements.fullscreenTeleprompterViewport.focus();
    }
  }
  refreshFullscreenHint();
}

function updateFullscreenButton() {
  elements.fullscreenBtn.textContent = state.fullscreenActive ? "离开全螢幕题词" : "开啟全螢幕题词";
}

function refreshPromptClasses(activeIndex) {
  state.scriptLines.forEach((lineMeta, index) => {
    const lineElements = [lineMeta.mainElement, lineMeta.fullscreenElement];
    lineElements.forEach((lineNode) => {
      if (!lineNode) {
        return;
      }
      lineNode.classList.remove("is-past", "is-active", "is-upcoming");
      if (index < activeIndex) {
        lineNode.classList.add("is-past");
        return;
      }
      if (index === activeIndex) {
        lineNode.classList.add("is-active");
        return;
      }
      lineNode.classList.add("is-upcoming");
    });
  });
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getScrollContainerFromNode(node, target) {
  if (!node) {
    return null;
  }
  if (target === "fullscreen") {
    return elements.fullscreenTeleprompterViewport;
  }
  if (target === "main") {
    return node.closest(".teleprompter");
  }
  return null;
}

function getLineHeightPx(node) {
  const style = window.getComputedStyle(node);
  const parsed = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return node.getBoundingClientRect().height || 56;
}

function getScrollAnchorOffset(node, container, target) {
  const containerStyle = window.getComputedStyle(container);
  const paddingTop = Number.parseFloat(containerStyle.paddingTop) || 0;
  if (target === "fullscreen") {
    const lineHeight = getLineHeightPx(node);
    const firstLineOffset = Math.max(6, lineHeight * 0.18);
    const desiredInsideViewport = paddingTop + firstLineOffset;
    const maxAllowed = Math.max(paddingTop, container.clientHeight - lineHeight * 0.9);
    return clampNumber(desiredInsideViewport, paddingTop, maxAllowed);
  }
  return paddingTop + container.clientHeight * 0.42;
}

function scrollPromptNodeIntoView(node, target = "main") {
  if (!node) {
    return;
  }

  const container = getScrollContainerFromNode(node, target);
  if (!container) {
    node.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
    return;
  }

  const anchor = getScrollAnchorOffset(node, container, target);
  const containerRect = container.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const nodeTopInScrollSpace = container.scrollTop + (nodeRect.top - containerRect.top);
  const rawTop = nodeTopInScrollSpace - anchor;
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const targetTop = clampNumber(rawTop, 0, maxTop);
  container.scrollTo({
    top: targetTop,
    behavior: prefersReducedMotion ? "auto" : "smooth",
  });
}

function scrollLineIntoView(index, target = "both") {
  const line = state.scriptLines[index];
  if (!line) {
    return;
  }
  if (target === "both" || target === "main") {
    scrollPromptNodeIntoView(line.mainElement, "main");
  }
  if (target === "both" || target === "fullscreen") {
    scrollPromptNodeIntoView(line.fullscreenElement, "fullscreen");
  }
}

function setPromptByLineIndex(lineIndex, shouldScroll = true, scrollTarget = "both") {
  if (!state.scriptLines[lineIndex]) {
    return;
  }
  const line = state.scriptLines[lineIndex];
  state.currentLineIndex = lineIndex;
  if (line.searchable) {
    state.currentNormIndex = Math.max(0, line.normStart + 1);
  }
  refreshPromptClasses(lineIndex);
  if (shouldScroll) {
    scrollLineIntoView(lineIndex, scrollTarget);
  }
}

function setPromptByNormIndex(normIndex) {
  if (!state.normalizedScript.length) {
    return;
  }
  const clampedIndex = Math.min(Math.max(0, normIndex), state.normalizedScript.length);
  state.currentNormIndex = clampedIndex;
  const nextLineIndex = getLineIndexFromNormIndex(clampedIndex);
  if (nextLineIndex === -1) {
    return;
  }
  if (nextLineIndex !== state.currentLineIndex) {
    setPromptByLineIndex(nextLineIndex);
  }
}

function jumpRelativeLine(step, scrollTarget = "both") {
  if (!state.scriptLines.length) {
    return;
  }
  const baseline = state.currentLineIndex >= 0 ? state.currentLineIndex : getFirstSearchableLineIndex();
  if (baseline === -1) {
    return;
  }
  let cursor = baseline + step;
  while (cursor >= 0 && cursor < state.scriptLines.length) {
    if (state.scriptLines[cursor].searchable) {
      setPromptByLineIndex(cursor, true, scrollTarget);
      return;
    }
    cursor += step;
  }
}

function resetPrompt() {
  const firstLine = getFirstSearchableLineIndex();
  if (firstLine === -1) {
    return;
  }
  state.recentTranscript = "";
  elements.transcriptOutput.textContent = "等待语音输入...";
  setPromptByLineIndex(firstLine);
}

function updateRecordButtons() {
  elements.initMediaBtn.disabled = state.recording;
  elements.startRecordBtn.disabled = !state.stream || state.recording;
  elements.stopRecordBtn.disabled = !state.recording;
  elements.fullscreenStartRecordBtn.disabled = !state.stream || state.recording;
  elements.fullscreenStopRecordBtn.disabled = !state.recording;
}

function updateFollowButtons() {
  const recognitionAvailable = Boolean(SpeechRecognitionCtor);
  elements.startFollowBtn.disabled = !recognitionAvailable || !state.scriptLines.length || state.followActive;
  elements.stopFollowBtn.disabled = !state.followActive;
  updateFollowToggleUI();
}

function updateFollowToggleUI() {
  const recognitionAvailable = Boolean(SpeechRecognitionCtor);
  const canUseFollow = recognitionAvailable && state.scriptLines.length > 0;
  const enabled = state.autoFollowEnabled;

  elements.fullscreenFollowToggleBtn.disabled = !recognitionAvailable;
  elements.fullscreenFollowToggleBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
  elements.fullscreenFollowToggleBtn.textContent = enabled ? "语音跟随：开" : "语音跟随：关";
  elements.fullscreenFollowToggleBtn.classList.toggle("btn-secondary", enabled);
  elements.fullscreenFollowToggleBtn.classList.toggle("btn-ghost", !enabled);

  if (!recognitionAvailable) {
    elements.fullscreenFollowHint.textContent = "浏览器不支援语音识别";
    return;
  }
  if (!canUseFollow) {
    elements.fullscreenFollowHint.textContent = "请先加载提词稿";
    return;
  }
  if (enabled && state.followActive) {
    elements.fullscreenFollowHint.textContent = "已自动跟随中";
    return;
  }
  if (enabled) {
    elements.fullscreenFollowHint.textContent = "预设已开启";
    return;
  }
  elements.fullscreenFollowHint.textContent = "目前已关闭";
}

function maybeStartAutoFollow(force = false) {
  if (!state.autoFollowEnabled || state.followActive) {
    return;
  }
  if (!SpeechRecognitionCtor || !state.normalizedScript.length) {
    return;
  }
  if (!force && !state.stream && !state.recording && !state.fullscreenActive) {
    return;
  }
  startFollowMode(false);
}

function setAutoFollowEnabled(enabled, showMessage = true, forceStart = false) {
  state.autoFollowEnabled = enabled;
  if (enabled) {
    if (showMessage) {
      setStatus(elements.speechStatus, "语音跟随已设为预设开启。", "success");
    }
    maybeStartAutoFollow(forceStart);
  } else {
    stopFollowMode(showMessage);
  }
  updateFollowButtons();
}

function clearFollowRestartTimer() {
  if (!state.followRestartTimerId) {
    return;
  }
  clearTimeout(state.followRestartTimerId);
  state.followRestartTimerId = null;
}

function clearFollowWatchdog() {
  if (!state.followWatchdogIntervalId) {
    return;
  }
  clearInterval(state.followWatchdogIntervalId);
  state.followWatchdogIntervalId = null;
}

function clearFollowSessionRefreshTimer() {
  if (!state.followSessionRefreshTimerId) {
    return;
  }
  clearTimeout(state.followSessionRefreshTimerId);
  state.followSessionRefreshTimerId = null;
}

function recreateRecognitionInstance() {
  if (!SpeechRecognitionCtor) {
    return false;
  }
  state.recognition = createRecognition();
  if (!state.recognition) {
    return false;
  }
  state.recognition.lang = elements.languageSelect.value;
  return true;
}

function restartRecognitionEngine(recreate = false, delayMs = 280) {
  if (!state.followActive) {
    return;
  }
  const previousRecognition = state.recognition;
  if (state.recognitionRunning && previousRecognition) {
    try {
      previousRecognition.stop();
    } catch (_error) {
      /* noop */
    }
  }
  state.recognitionRunning = false;
  if (recreate || !state.recognition) {
    const recreated = recreateRecognitionInstance();
    if (!recreated) {
      state.followActive = false;
      setStatus(elements.speechStatus, "语音识别引擎重建失败，请重新点击开始语音跟随。", "danger");
      updateFollowButtons();
      return;
    }
  }
  clearFollowRestartTimer();
  scheduleFollowRestart(delayMs);
}

function scheduleFollowSessionRefresh(delayMs = FOLLOW_SESSION_REFRESH_MS) {
  if (!state.followActive) {
    return;
  }
  clearFollowSessionRefreshTimer();
  state.followSessionRefreshTimerId = setTimeout(() => {
    state.followSessionRefreshTimerId = null;
    if (!state.followActive) {
      return;
    }
    restartRecognitionEngine(true, 220);
    scheduleFollowSessionRefresh(FOLLOW_SESSION_REFRESH_MS);
  }, delayMs);
}

function checkFollowHealth() {
  if (!state.followActive || !state.recognitionRunning) {
    return;
  }
  const now = Date.now();
  const baselineTs = Math.max(state.followLastResultAt, state.followLastStartAt);
  if (!baselineTs) {
    return;
  }
  const stalledMs = now - baselineTs;
  if (stalledMs < FOLLOW_STALL_TIMEOUT_MS) {
    return;
  }

  state.followConsecutiveStalls += 1;
  const shouldRecreate = state.followConsecutiveStalls >= 2;
  const tone = shouldRecreate ? "warning" : "neutral";
  setStatus(elements.speechStatus, "语音识别连接维护中，正在自动恢复...", tone);
  restartRecognitionEngine(shouldRecreate, shouldRecreate ? 260 : 220);
}

function startFollowMaintenance() {
  clearFollowWatchdog();
  clearFollowSessionRefreshTimer();
  state.followWatchdogIntervalId = setInterval(checkFollowHealth, FOLLOW_WATCHDOG_INTERVAL_MS);
  scheduleFollowSessionRefresh(FOLLOW_SESSION_REFRESH_MS);
}

function stopFollowMaintenance() {
  clearFollowRestartTimer();
  clearFollowWatchdog();
  clearFollowSessionRefreshTimer();
}

function scheduleFollowRestart(delayMs = 550) {
  if (!state.followActive || !state.recognition) {
    return;
  }
  clearFollowRestartTimer();
  state.followRestartTimerId = setTimeout(() => {
    state.followRestartTimerId = null;
    if (!state.followActive) {
      return;
    }
    startRecognitionSafely();
  }, delayMs);
}

function updateTTSButtons() {
  const speechAvailable = "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  elements.speakBtn.disabled = !speechAvailable || !state.scriptLines.length || state.ttsActive;
  elements.stopSpeakBtn.disabled = !speechAvailable || !state.ttsActive;
}

function clearRecordTimer() {
  if (state.recordTimerId) {
    clearInterval(state.recordTimerId);
    state.recordTimerId = null;
  }
}

function startRecordTimer() {
  clearRecordTimer();
  state.recordSeconds = 0;
  elements.recordTimer.textContent = "00:00";
  state.recordTimerId = setInterval(() => {
    state.recordSeconds += 1;
    elements.recordTimer.textContent = formatDuration(state.recordSeconds);
  }, 1000);
}

function getBestMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }
  for (const option of RECORD_MIME_PREFERENCES) {
    if (MediaRecorder.isTypeSupported(option)) {
      return option;
    }
  }
  return "";
}

function getFileExtensionByMimeType(mimeType) {
  if (!mimeType) {
    return "webm";
  }
  const lower = mimeType.toLowerCase();
  if (lower.includes("mp4")) {
    return "mp4";
  }
  if (lower.includes("webm")) {
    return "webm";
  }
  return "webm";
}

function getFormatLabelByMimeType(mimeType) {
  return getFileExtensionByMimeType(mimeType).toUpperCase();
}

function getActiveVideoTrackSettings(stream) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track?.getSettings) {
    return null;
  }
  return track.getSettings();
}

function formatVideoSettings(settings) {
  if (!settings) {
    return "未知分辨率";
  }
  const width = settings.width || "?";
  const height = settings.height || "?";
  const fps = settings.frameRate ? ` ${Math.round(settings.frameRate)}fps` : "";
  return `${width}x${height}${fps}`;
}

function estimateVideoBitrate(settings) {
  const width = settings?.width || 1280;
  const height = settings?.height || 720;
  const fps = settings?.frameRate || 30;
  const pixels = width * height;
  let bitrate = 4_500_000;
  if (pixels >= 3840 * 2160) {
    bitrate = 28_000_000;
  } else if (pixels >= 2560 * 1440) {
    bitrate = 18_000_000;
  } else if (pixels >= 1920 * 1080) {
    bitrate = 12_000_000;
  } else if (pixels >= 1280 * 720) {
    bitrate = 7_500_000;
  }
  if (fps > 30) {
    bitrate = Math.round(bitrate * Math.min(1.65, fps / 30));
  }
  return clampNumber(bitrate, 4_000_000, 34_000_000);
}

function buildAudioConstraints(audioDeviceId) {
  const base = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
    channelCount: { ideal: 2 },
    sampleRate: { ideal: 48000 },
  };
  if (!audioDeviceId) {
    return base;
  }
  return {
    ...base,
    deviceId: { exact: audioDeviceId },
  };
}

function buildVideoConstraintProfile(videoDeviceId, profile) {
  const baseDevice = videoDeviceId ? { deviceId: { exact: videoDeviceId } } : {};
  if (!profile) {
    return {
      ...baseDevice,
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30, max: 60 },
    };
  }
  return {
    ...baseDevice,
    width: { exact: profile.width },
    height: { exact: profile.height },
    frameRate: { ideal: profile.frameRateIdeal, max: profile.frameRateMax },
  };
}

function isConstraintError(error) {
  return error?.name === "OverconstrainedError" || error?.name === "ConstraintNotSatisfiedError";
}

async function openBestQualityStream(videoDeviceId, audioDeviceId) {
  const audioConstraints = buildAudioConstraints(audioDeviceId);
  const candidates = [
    ...VIDEO_CONSTRAINT_PROFILES.map((profile) => ({
      label: profile.label,
      constraints: {
        video: buildVideoConstraintProfile(videoDeviceId, profile),
        audio: audioConstraints,
      },
    })),
    {
      label: "Auto",
      constraints: {
        video: buildVideoConstraintProfile(videoDeviceId, null),
        audio: audioConstraints,
      },
    },
    {
      label: "Default",
      constraints: {
        video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
        audio: audioConstraints,
      },
    },
  ];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(candidate.constraints);
      return {
        stream,
        profileLabel: candidate.label,
      };
    } catch (error) {
      lastError = error;
      if (isConstraintError(error)) {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("无法取得可用视频流");
}

function createMediaRecorderWithFallback(stream, preferredConfig, mimeType) {
  try {
    return new MediaRecorder(stream, preferredConfig);
  } catch (_errorWithBitrate) {
    if (mimeType) {
      try {
        return new MediaRecorder(stream, { mimeType });
      } catch (_errorWithMime) {
        /* noop */
      }
    }
    return new MediaRecorder(stream);
  }
}

function syncFullscreenStream() {
  elements.fullscreenVideo.srcObject = state.stream || null;
}

function stopMediaTracks() {
  if (!state.stream) {
    return;
  }
  state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null;
  state.activeVideoSettings = null;
  state.activeRecordConfig = null;
  elements.previewVideo.srcObject = null;
  syncFullscreenStream();
}

function buildSelectOptions(selectNode, devices, fallbackLabel) {
  const current = selectNode.value;
  selectNode.innerHTML = "";
  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `${fallbackLabel} ${index + 1}`;
    selectNode.append(option);
  });

  if (!devices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = `没有可用${fallbackLabel}`;
    selectNode.append(option);
    selectNode.disabled = true;
    return;
  }

  selectNode.disabled = false;
  if (current && devices.some((device) => device.deviceId === current)) {
    selectNode.value = current;
  }
}

async function refreshDeviceLists() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    setStatus(elements.recordStatus, "浏览器不支援设备枚举。", "warning");
    elements.cameraSelect.disabled = true;
    elements.micSelect.disabled = true;
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const microphones = devices.filter((device) => device.kind === "audioinput");
  buildSelectOptions(elements.cameraSelect, cameras, "摄影机");
  buildSelectOptions(elements.micSelect, microphones, "麦克风");
}

async function initMedia() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus(elements.recordStatus, "浏览器不支援录影 API。", "danger");
    return;
  }

  if (state.recording) {
    return;
  }

  const videoDeviceId = elements.cameraSelect.value;
  const audioDeviceId = elements.micSelect.value;

  try {
    stopMediaTracks();
    const { stream, profileLabel } = await openBestQualityStream(videoDeviceId, audioDeviceId);
    state.stream = stream;
    state.activeVideoSettings = getActiveVideoTrackSettings(stream);
    state.activeRecordConfig = null;
    elements.previewVideo.srcObject = stream;
    syncFullscreenStream();
    await refreshDeviceLists();
    const qualityText = formatVideoSettings(state.activeVideoSettings);
    setStatus(elements.recordStatus, `设备已就绪（${profileLabel}，${qualityText}），可以开始录影。`, "success");
    updateRecordButtons();
    maybeStartAutoFollow();
  } catch (error) {
    setStatus(elements.recordStatus, `开启设备失败：${error.message}`, "danger");
  }
}

function handleRecordStop() {
  clearRecordTimer();
  elements.recordTimer.textContent = formatDuration(state.recordSeconds);
  state.recording = false;
  updateRecordButtons();

  if (!state.recordedChunks.length) {
    setStatus(elements.recordStatus, "没有录到可用内容。", "warning");
    return;
  }

  const mimeType = state.mediaRecorder?.mimeType || "video/webm";
  const blob = new Blob(state.recordedChunks, { type: mimeType });
  if (state.playbackUrl) {
    URL.revokeObjectURL(state.playbackUrl);
  }
  state.playbackUrl = URL.createObjectURL(blob);
  elements.playbackVideo.src = state.playbackUrl;
  elements.downloadLink.href = state.playbackUrl;
  const outputExt = getFileExtensionByMimeType(mimeType);
  const outputFormat = getFormatLabelByMimeType(mimeType);
  elements.downloadLink.download = `teleprompter-recording-${Date.now()}.${outputExt}`;
  elements.downloadLink.classList.remove("hidden");
  const qualityInfo = state.activeRecordConfig
    ? `${formatVideoSettings(state.activeRecordConfig)}，约 ${(state.activeRecordConfig.videoBitsPerSecond / 1_000_000).toFixed(1)} Mbps`
    : "未知录制参数";
  elements.recordResultMsg.textContent = `录影完成（${outputFormat}，${qualityInfo}），大小 ${(blob.size / (1024 * 1024)).toFixed(2)} MB。`;
  setStatus(elements.recordStatus, "录影已结束，已生成可下载文件。", "success");
}

async function startRecording() {
  if (typeof MediaRecorder === "undefined") {
    setStatus(elements.recordStatus, "浏览器不支援 MediaRecorder。", "danger");
    return;
  }

  if (!state.stream) {
    await initMedia();
    if (!state.stream) {
      return;
    }
  }

  const mimeType = getBestMimeType();
  const currentSettings = getActiveVideoTrackSettings(state.stream);
  state.activeVideoSettings = currentSettings;
  const videoBitsPerSecond = estimateVideoBitrate(currentSettings);
  const audioBitsPerSecond = 160_000;
  const recorderConfig = mimeType
    ? { mimeType, videoBitsPerSecond, audioBitsPerSecond }
    : { videoBitsPerSecond, audioBitsPerSecond };
  try {
    maybeStartAutoFollow();
    state.recordedChunks = [];
    state.mediaRecorder = createMediaRecorderWithFallback(state.stream, recorderConfig, mimeType);
    const actualVideoBps = state.mediaRecorder.videoBitsPerSecond || videoBitsPerSecond;
    const actualAudioBps = state.mediaRecorder.audioBitsPerSecond || audioBitsPerSecond;
    const activeMimeType = state.mediaRecorder.mimeType || mimeType || "video/webm";
    state.activeRecordConfig = {
      ...(currentSettings || {}),
      videoBitsPerSecond: actualVideoBps,
      audioBitsPerSecond: actualAudioBps,
      mimeType: activeMimeType,
    };
    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        state.recordedChunks.push(event.data);
      }
    };
    state.mediaRecorder.onerror = (event) => {
      const message = event.error?.message || "录影过程中发生错误。";
      setStatus(elements.recordStatus, message, "danger");
    };
    state.mediaRecorder.onstop = handleRecordStop;
    state.mediaRecorder.start(250);
    state.recording = true;
    startRecordTimer();
    updateRecordButtons();
    const recordingQuality = formatVideoSettings(currentSettings);
    const bitrateText = (actualVideoBps / 1_000_000).toFixed(1);
    const formatLabel = getFormatLabelByMimeType(activeMimeType);
    setStatus(elements.recordStatus, `录影中...（${formatLabel}，${recordingQuality}，${bitrateText} Mbps）`, "warning");
  } catch (error) {
    setStatus(elements.recordStatus, `无法开始录影：${error.message}`, "danger");
  }
}

function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state !== "recording") {
    return;
  }
  state.mediaRecorder.stop();
}

function startRecognitionSafely() {
  if (!state.followActive || !state.recognition) {
    return;
  }

  clearFollowRestartTimer();
  try {
    state.recognition.start();
  } catch (error) {
    if (error.name === "InvalidStateError") {
      scheduleFollowRestart(320);
      return;
    }

    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      state.followActive = false;
      state.followRestartAttempts = 0;
      setStatus(elements.speechStatus, "麦克风权限被拒绝，无法继续语音跟随。", "danger");
      updateFollowButtons();
      stopFollowMaintenance();
      return;
    }

    state.followRestartAttempts += 1;
    const retryDelay = Math.min(2100, 500 + state.followRestartAttempts * 260);
    const recreate = state.followRestartAttempts >= 4;
    setStatus(elements.speechStatus, "语音识别中断，正在尝试自动恢复...", "warning");
    restartRecognitionEngine(recreate, retryDelay);
  }
}

async function enterFullscreenMode() {
  if (state.fullscreenActive) {
    return;
  }

  if (!state.stream) {
    await initMedia();
    if (!state.stream) {
      setStatus(elements.recordStatus, "无法进入全螢幕：请先允许相机权限。", "danger");
      return;
    }
  }

  if (!state.scriptLines.length) {
    loadScript();
  }
  maybeStartAutoFollow();

  const firstLine = state.currentLineIndex >= 0 ? state.currentLineIndex : getFirstSearchableLineIndex();
  if (firstLine >= 0 && state.currentLineIndex === -1) {
    setPromptByLineIndex(firstLine, true, "fullscreen");
  } else {
    scrollLineIntoView(firstLine, "fullscreen");
  }

  syncFullscreenStream();
  setFullscreenStageActive(true);
  updateFullscreenButton();

  try {
    const nativeFullscreen = await requestStageFullscreen();
    refreshFullscreenHint();
    if (nativeFullscreen) {
      setStatus(elements.recordStatus, "已进入全螢幕题词模式。", "success");
    } else {
      setStatus(elements.recordStatus, "浏览器不支援原生全螢幕，已开启沉浸题词模式。", "warning");
    }
  } catch (error) {
    setStatus(elements.recordStatus, `原生全螢幕启动失败，已改为沉浸模式：${error.message}`, "warning");
  }
}

async function exitFullscreenMode(showMessage = true, fromFullscreenEvent = false) {
  const wasActive = state.fullscreenActive || Boolean(getFullscreenElement());
  if (!fromFullscreenEvent && getFullscreenElement()) {
    try {
      await exitDocumentFullscreen();
    } catch (_error) {
      /* noop */
    }
  }
  setFullscreenStageActive(false);
  updateFullscreenButton();
  if (showMessage && wasActive) {
    setStatus(elements.recordStatus, "已离开全螢幕题词模式。", "neutral");
  }
}

async function toggleFullscreenMode() {
  if (state.fullscreenActive || getFullscreenElement() === elements.fullscreenStage) {
    await exitFullscreenMode(true, false);
    return;
  }
  await enterFullscreenMode();
}

function handleFullscreenChange() {
  const activeElement = getFullscreenElement();
  if (activeElement === elements.fullscreenStage) {
    if (!state.fullscreenActive) {
      setFullscreenStageActive(true);
      updateFullscreenButton();
    }
    refreshFullscreenHint();
    return;
  }

  if (state.fullscreenActive) {
    setFullscreenStageActive(false);
    updateFullscreenButton();
    setStatus(elements.recordStatus, "已离开全螢幕题词模式。", "neutral");
  }
}

function createRecognition() {
  if (!SpeechRecognitionCtor) {
    return null;
  }
  const recognition = new SpeechRecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = elements.languageSelect.value;
  recognition.onstart = () => {
    state.recognitionRunning = true;
    state.followRestartAttempts = 0;
    state.followLastStartAt = Date.now();
    state.followConsecutiveStalls = 0;
  };

  recognition.onresult = (event) => {
    state.followLastResultAt = Date.now();
    state.followConsecutiveStalls = 0;
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0]?.transcript?.trim();
      if (!transcript) {
        continue;
      }
      if (event.results[i].isFinal) {
        processRecognizedText(transcript, true);
      } else {
        interimText = `${interimText} ${transcript}`.trim();
      }
    }
    if (interimText) {
      processRecognizedText(interimText, false);
    }
  };

  recognition.onerror = (event) => {
    if (!state.followActive) {
      return;
    }
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      stopFollowMaintenance();
      state.followActive = false;
      state.followRestartAttempts = 0;
      setStatus(elements.speechStatus, "请允许麦克风权限，才能使用语音跟随。", "danger");
      updateFollowButtons();
      return;
    }

    if (RESTARTABLE_FOLLOW_ERRORS.has(event.error)) {
      const tone = event.error === "no-speech" ? "neutral" : "warning";
      const message = event.error === "no-speech" ? "暂时没听到声音，持续待命中..." : "识别短暂中断，正在自动重连...";
      setStatus(elements.speechStatus, message, tone);
      restartRecognitionEngine(false, event.error === "no-speech" ? 420 : 700);
      return;
    }

    setStatus(elements.speechStatus, `语音识别异常：${event.error}`, "warning");
    restartRecognitionEngine(true, 850);
  };

  recognition.onend = () => {
    state.recognitionRunning = false;
    if (state.followActive) {
      scheduleFollowRestart(520);
    }
  };

  return recognition;
}

function findClosestOccurrence(snippet) {
  const script = state.normalizedScript;
  if (!snippet || !script) {
    return -1;
  }

  const nearStart = Math.max(0, state.currentNormIndex - 100);
  const nearMatch = script.indexOf(snippet, nearStart);
  if (nearMatch !== -1) {
    return nearMatch;
  }

  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  let searchFrom = 0;

  while (searchFrom < script.length) {
    const index = script.indexOf(snippet, searchFrom);
    if (index === -1) {
      break;
    }
    const distance = Math.abs(index - state.currentNormIndex);
    const backwardPenalty = index < state.currentNormIndex ? 40 : 0;
    const score = distance + backwardPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
    searchFrom = index + 1;
  }

  return bestIndex;
}

function locateNormalizedPosition(normalizedSpeech) {
  if (!normalizedSpeech || !state.normalizedScript.length) {
    return null;
  }

  const maxLen = Math.min(36, normalizedSpeech.length);
  const minLen = Math.min(4, maxLen);
  if (maxLen < 1) {
    return null;
  }

  for (let len = maxLen; len >= minLen; len -= 1) {
    const snippet = normalizedSpeech.slice(-len);
    const foundAt = findClosestOccurrence(snippet);
    if (foundAt === -1) {
      continue;
    }
    const proposed = foundAt + len;
    if (proposed < state.currentNormIndex - 24) {
      continue;
    }
    return proposed;
  }
  return null;
}

function processRecognizedText(text, isFinal) {
  const rolling = `${state.recentTranscript} ${text}`.trim().slice(-260);
  elements.transcriptOutput.textContent = rolling || "等待语音输入...";

  const normalizedRolling = normalizeText(rolling);
  const matchedIndex = locateNormalizedPosition(normalizedRolling);
  if (matchedIndex !== null) {
    setPromptByNormIndex(matchedIndex);
  }

  if (isFinal) {
    state.recentTranscript = rolling.slice(-220);
  }
}

function startFollowMode(showMessage = true) {
  if (!SpeechRecognitionCtor) {
    setStatus(elements.speechStatus, "浏览器不支援 SpeechRecognition。", "warning");
    return;
  }

  if (!state.normalizedScript.length) {
    loadScript();
    if (!state.normalizedScript.length) {
      return;
    }
  }

  if (!state.recognition) {
    state.recognition = createRecognition();
  }
  if (!state.recognition) {
    setStatus(elements.speechStatus, "语音识别初始化失败。", "danger");
    return;
  }

  state.recognition.lang = elements.languageSelect.value;
  state.followActive = true;
  state.followRestartAttempts = 0;
  state.followLastStartAt = Date.now();
  state.followLastResultAt = Date.now();
  state.followConsecutiveStalls = 0;
  state.recentTranscript = "";
  elements.transcriptOutput.textContent = "正在聆听...";
  if (showMessage) {
    setStatus(elements.speechStatus, "语音跟随已启动，开始讲话即可自动跳行。", "success");
  }
  updateFollowButtons();
  startFollowMaintenance();
  startRecognitionSafely();
}

function stopFollowMode(showMessage = true) {
  state.followActive = false;
  state.followRestartAttempts = 0;
  state.followLastStartAt = 0;
  state.followLastResultAt = 0;
  state.followConsecutiveStalls = 0;
  state.recognitionRunning = false;
  stopFollowMaintenance();
  if (state.recognition) {
    try {
      state.recognition.stop();
    } catch (_error) {
      /* noop */
    }
  }
  if (showMessage) {
    setStatus(elements.speechStatus, "语音跟随已停止。", "neutral");
  }
  updateFollowButtons();
}

function startTTS() {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    setStatus(elements.speechStatus, "浏览器不支援文字转语音。", "warning");
    return;
  }
  if (!state.scriptLines.length) {
    loadScript();
    if (!state.scriptLines.length) {
      return;
    }
  }

  stopTTS(false);
  const startLine = state.currentLineIndex >= 0 ? state.currentLineIndex : getFirstSearchableLineIndex();
  const safeStartLine = startLine >= 0 ? startLine : 0;
  const baseNorm = state.scriptLines[safeStartLine]?.normStart ?? 0;
  const utteranceText = state.scriptLines
    .slice(safeStartLine)
    .map((line) => line.textOriginal)
    .join("\n")
    .trim();

  if (!utteranceText) {
    setStatus(elements.speechStatus, "当前没有可朗读内容。", "warning");
    return;
  }

  const utterance = new SpeechSynthesisUtterance(utteranceText);
  utterance.lang = elements.languageSelect.value;
  utterance.rate = 1;
  utterance.pitch = 1;

  utterance.onstart = () => {
    state.ttsActive = true;
    updateTTSButtons();
    setStatus(elements.speechStatus, "TTS 朗读中...", "success");
  };

  utterance.onboundary = (event) => {
    if (typeof event.charIndex !== "number") {
      return;
    }
    const spokenText = utteranceText.slice(0, event.charIndex);
    const spokenNormLength = normalizeText(spokenText).length;
    setPromptByNormIndex(baseNorm + spokenNormLength);
  };

  utterance.onend = () => {
    state.ttsActive = false;
    updateTTSButtons();
    setStatus(elements.speechStatus, "TTS 朗读结束。", "neutral");
  };

  utterance.onerror = () => {
    state.ttsActive = false;
    updateTTSButtons();
    setStatus(elements.speechStatus, "TTS 朗读失败，请检查浏览器语音引擎。", "danger");
  };

  window.speechSynthesis.speak(utterance);
}

function stopTTS(showMessage = true) {
  if (!("speechSynthesis" in window)) {
    return;
  }
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
  }
  if (state.ttsActive && showMessage) {
    setStatus(elements.speechStatus, "已停止 TTS 朗读。", "neutral");
  }
  state.ttsActive = false;
  updateTTSButtons();
}

function loadScript() {
  const raw = elements.scriptInput.value.trim();
  if (!raw) {
    setStatus(elements.speechStatus, "提词稿不能为空。", "danger");
    state.scriptLines = [];
    state.normalizedScript = "";
    state.currentLineIndex = -1;
    state.currentNormIndex = 0;
    renderScript();
    updateFollowButtons();
    updateTTSButtons();
    return;
  }

  buildScriptFromInput(raw);
  const searchableCount = state.scriptLines.filter((line) => line.searchable).length;
  if (!searchableCount || !state.normalizedScript.length) {
    renderScript();
    setStatus(elements.speechStatus, "提词稿没有可识别内容，请调整文本。", "danger");
    updateFollowButtons();
    updateTTSButtons();
    return;
  }

  renderScript();
  resetPrompt();
  setStatus(elements.speechStatus, `已加载 ${searchableCount} 行，可开始语音跟随。`, "success");
  updateFollowButtons();
  updateTTSButtons();
  maybeStartAutoFollow();
}

function bindEvents() {
  elements.initMediaBtn.addEventListener("click", initMedia);
  elements.startRecordBtn.addEventListener("click", startRecording);
  elements.stopRecordBtn.addEventListener("click", stopRecording);
  elements.fullscreenStartRecordBtn.addEventListener("click", startRecording);
  elements.fullscreenStopRecordBtn.addEventListener("click", stopRecording);
  elements.fullscreenBtn.addEventListener("click", toggleFullscreenMode);
  elements.fullscreenMirrorToggleBtn.addEventListener("click", () => {
    state.fullscreenMirrorEnabled = !state.fullscreenMirrorEnabled;
    updateMirrorToggleUI();
  });
  elements.fullscreenFollowToggleBtn.addEventListener("click", () => {
    setAutoFollowEnabled(!state.autoFollowEnabled, true, true);
  });
  elements.fullscreenFontSizeRange.addEventListener("input", (event) => {
    state.fullscreenFontSize = clampFullscreenFontSize(event.target.value);
    syncFullscreenFontSize();
  });
  elements.fullscreenFontDownBtn.addEventListener("click", () => adjustFullscreenFontSize(-2));
  elements.fullscreenFontUpBtn.addEventListener("click", () => adjustFullscreenFontSize(2));

  elements.cameraSelect.addEventListener("change", () => {
    if (state.stream && !state.recording) {
      initMedia();
    }
  });
  elements.micSelect.addEventListener("change", () => {
    if (state.stream && !state.recording) {
      initMedia();
    }
  });

  elements.loadScriptBtn.addEventListener("click", loadScript);
  elements.startFollowBtn.addEventListener("click", () => setAutoFollowEnabled(true, true, true));
  elements.stopFollowBtn.addEventListener("click", () => setAutoFollowEnabled(false, true));
  elements.prevLineBtn.addEventListener("click", () => jumpRelativeLine(-1));
  elements.nextLineBtn.addEventListener("click", () => jumpRelativeLine(1));
  elements.resetPromptBtn.addEventListener("click", resetPrompt);
  elements.speakBtn.addEventListener("click", startTTS);
  elements.stopSpeakBtn.addEventListener("click", () => stopTTS(true));

  elements.languageSelect.addEventListener("change", () => {
    const wasFollowing = state.followActive;
    if (state.recognition) {
      state.recognition.lang = elements.languageSelect.value;
    }
    if (state.followActive) {
      stopFollowMode(false);
    }
    if (state.autoFollowEnabled) {
      maybeStartAutoFollow(wasFollowing);
    } else {
      setStatus(elements.speechStatus, `识别语言已切换为 ${elements.languageSelect.options[elements.languageSelect.selectedIndex].text}。`, "neutral");
    }
    updateFollowButtons();
  });

  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
  document.addEventListener("MSFullscreenChange", handleFullscreenChange);

  window.addEventListener("keydown", (event) => {
    const shouldAdjustFont =
      state.fullscreenActive &&
      (event.key === "=" || event.key === "+" || event.key === "-" || event.key === "_");
    if (shouldAdjustFont) {
      event.preventDefault();
      adjustFullscreenFontSize(event.key === "-" || event.key === "_" ? -2 : 2);
      return;
    }
    if (state.fullscreenActive && event.key === "ArrowUp") {
      event.preventDefault();
      jumpRelativeLine(-1, "fullscreen");
      return;
    }
    if (state.fullscreenActive && event.key === "ArrowDown") {
      event.preventDefault();
      jumpRelativeLine(1, "fullscreen");
      return;
    }
    if (event.key === "Escape" && state.fullscreenActive && !getFullscreenElement()) {
      exitFullscreenMode(true, true);
    }
  });

  window.addEventListener("beforeunload", () => {
    exitFullscreenMode(false, true);
    stopFollowMode(false);
    stopTTS(false);
    clearRecordTimer();
    stopMediaTracks();
    if (state.playbackUrl) {
      URL.revokeObjectURL(state.playbackUrl);
    }
  });
}

async function initialize() {
  setStatus(elements.recordStatus, "尚未开启设备。", "neutral");
  setStatus(elements.speechStatus, "尚未开始语音跟随。", "neutral");
  setFullscreenStageActive(false);
  updateRecordButtons();
  updateFollowButtons();
  updateTTSButtons();
  updateFullscreenButton();
  updateMirrorToggleUI();
  syncFullscreenFontSize();
  bindEvents();

  if (navigator.mediaDevices?.enumerateDevices) {
    try {
      await refreshDeviceLists();
    } catch (_error) {
      setStatus(elements.recordStatus, "读取设备清单失败，请稍后再试。", "warning");
    }
  }

  if (!SpeechRecognitionCtor) {
    setStatus(elements.speechStatus, "当前浏览器不支援语音识别，请改用 Chrome 或 Edge。", "warning");
  }

  if (!("speechSynthesis" in window)) {
    elements.speakBtn.disabled = true;
    elements.stopSpeakBtn.disabled = true;
  }

  loadScript();
}

initialize();
