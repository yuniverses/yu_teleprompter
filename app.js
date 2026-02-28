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
  followHealthStatus: document.getElementById("followHealthStatus"),
  transcriptOutput: document.getElementById("transcriptOutput"),
  teleprompterContent: document.getElementById("teleprompterContent"),
};

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const AudioContextCtor = window.AudioContext || window.webkitAudioContext || null;
const statusClasses = ["status-neutral", "status-success", "status-warning", "status-danger"];
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const RESTARTABLE_FOLLOW_ERRORS = new Set(["aborted", "audio-capture", "network", "no-speech"]);
const FOLLOW_WATCHDOG_INTERVAL_MS = 1000;
const FOLLOW_STARTUP_STALL_TIMEOUT_MS = 6000;
const FOLLOW_RUNTIME_STALL_TIMEOUT_MS = 12000;
const FOLLOW_VOICE_STALL_TIMEOUT_MS = 4200;
const FOLLOW_VOICE_RECENT_WINDOW_MS = 2400;
const FOLLOW_RESTART_MIN_INTERVAL_MS = 750;
const FOLLOW_MATCH_WINDOW_BACK_CHARS = 90;
const FOLLOW_MATCH_WINDOW_FORWARD_CHARS = 360;
const FOLLOW_MATCH_FALLBACK_BACK_CHARS = 200;
const FOLLOW_MATCH_FALLBACK_FORWARD_CHARS = 920;
const FOLLOW_MATCH_BACKWARD_PENALTY = 120;
const VOICE_ACTIVITY_RMS_THRESHOLD = 0.03;
const SCRIPT_STORAGE_KEY = "yu.teleprompter.script";
const TRANSCRIPT_FINAL_MAX_CHARS = 1200;
const DEFAULT_SCRIPT_TEXT = `各位觀眾大家好，歡迎來到今天的節目。
今天我們會快速帶你看完這次版本更新重點。
第一個重點是全螢幕錄影與提詞同步。
第二個重點是語音跟隨，系統會判斷你講到哪一句。
第三個重點是鏡像模式與快捷鍵操作。
接下來我會先示範一般錄影流程。
完成之後，再示範全螢幕模式下的實際使用情境。
最後我會整理三個拍攝小技巧，讓眼神更自然。`;
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
  followRestartAttempts: 0,
  followPendingRestart: false,
  followLastStartAt: 0,
  followLastResultAt: 0,
  followLastVoiceAt: 0,
  followLastRestartAt: 0,
  followConsecutiveStalls: 0,
  recognitionRunning: false,
  followHealthSnapshot: "",
  recentTranscript: "",
  transcriptFinalText: "",
  transcriptInterimText: "",
  voiceMonitorContext: null,
  voiceMonitorSource: null,
  voiceMonitorAnalyser: null,
  voiceMonitorBuffer: null,
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

function setFollowHealthStatus(message, type = "neutral") {
  const snapshot = `${type}:${message}`;
  if (snapshot === state.followHealthSnapshot) {
    return;
  }
  state.followHealthSnapshot = snapshot;
  setStatus(elements.followHealthStatus, message, type);
}

function updateFollowHealthIndicator(now = Date.now()) {
  if (!SpeechRecognitionCtor) {
    setFollowHealthStatus("語音引擎：此瀏覽器不支援語音識別", "warning");
    return;
  }
  if (!state.autoFollowEnabled) {
    setFollowHealthStatus("語音引擎：已關閉（可在全螢幕內開啟）", "neutral");
    return;
  }
  if (!state.followActive) {
    setFollowHealthStatus("語音引擎：待機中（預設自動跟隨已開啟）", "neutral");
    return;
  }
  if (state.followPendingRestart) {
    setFollowHealthStatus("語音引擎：重連中...", "warning");
    return;
  }
  if (!state.recognitionRunning) {
    setFollowHealthStatus("語音引擎：啟動中...", "neutral");
    return;
  }
  if (!state.followLastResultAt) {
    const elapsedSec = Math.max(0, Math.floor((now - state.followLastStartAt) / 1000));
    setFollowHealthStatus(`語音引擎：已連線，等待第一句（${elapsedSec}s）`, "neutral");
    return;
  }

  const elapsedMs = now - state.followLastResultAt;
  const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
  if (elapsedMs <= 2600) {
    setFollowHealthStatus("語音引擎：連線正常（剛收到識別）", "success");
    return;
  }
  if (elapsedMs < FOLLOW_RUNTIME_STALL_TIMEOUT_MS) {
    setFollowHealthStatus(`語音引擎：連線中，最近識別 ${elapsedSec} 秒前`, "neutral");
    return;
  }
  setFollowHealthStatus(`語音引擎：${elapsedSec} 秒無識別，正在檢查連線...`, "warning");
}

function readStoredScript() {
  try {
    return window.localStorage.getItem(SCRIPT_STORAGE_KEY);
  } catch (_error) {
    return null;
  }
}

function saveScriptDraft(text) {
  try {
    window.localStorage.setItem(SCRIPT_STORAGE_KEY, text);
  } catch (_error) {
    /* ignore storage errors */
  }
}

function updateTranscriptDisplay() {
  const finalPart = state.transcriptFinalText.trim();
  const interimPart = state.transcriptInterimText.trim();

  if (!finalPart && !interimPart) {
    elements.transcriptOutput.textContent = "等待語音輸入...";
    return;
  }

  const lines = [];
  if (finalPart) {
    lines.push(finalPart.slice(-TRANSCRIPT_FINAL_MAX_CHARS));
  }
  if (interimPart) {
    lines.push(`▶ ${interimPart}`);
  }
  elements.transcriptOutput.textContent = lines.join("\n");
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
    mainEmpty.textContent = "請先載入提詞稿。";
    elements.teleprompterContent.append(mainEmpty);

    const fullscreenEmpty = document.createElement("p");
    fullscreenEmpty.className = "empty";
    fullscreenEmpty.textContent = "請先載入提詞稿。";
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
  elements.fullscreenModeHint.textContent = getFullscreenElement() ? "按 Esc 可離開全螢幕" : "按按鈕可離開全螢幕";
}

function updateMirrorToggleUI() {
  const enabled = state.fullscreenMirrorEnabled;
  elements.fullscreenStage.classList.toggle("is-mirrored", enabled);
  elements.fullscreenMirrorToggleBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
  elements.fullscreenMirrorToggleBtn.textContent = enabled ? "鏡像畫面：開" : "鏡像畫面：關";
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
  elements.fullscreenBtn.textContent = state.fullscreenActive ? "離開全螢幕提詞" : "開啟全螢幕提詞";
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
  state.transcriptFinalText = "";
  state.transcriptInterimText = "";
  updateTranscriptDisplay();
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
  elements.fullscreenFollowToggleBtn.textContent = enabled ? "語音跟隨：開" : "語音跟隨：關";
  elements.fullscreenFollowToggleBtn.classList.toggle("btn-secondary", enabled);
  elements.fullscreenFollowToggleBtn.classList.toggle("btn-ghost", !enabled);

  if (!recognitionAvailable) {
    elements.fullscreenFollowHint.textContent = "瀏覽器不支援語音識別";
    return;
  }
  if (!canUseFollow) {
    elements.fullscreenFollowHint.textContent = "請先載入提詞稿";
    return;
  }
  if (enabled && state.followActive) {
    elements.fullscreenFollowHint.textContent = "已自動跟隨中";
    return;
  }
  if (enabled) {
    elements.fullscreenFollowHint.textContent = "預設已開啟";
    return;
  }
  elements.fullscreenFollowHint.textContent = "目前已關閉";
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
      setStatus(elements.speechStatus, "語音跟隨已設為預設開啟。", "success");
    }
    maybeStartAutoFollow(forceStart);
  } else {
    stopFollowMode(showMessage);
  }
  updateFollowButtons();
  updateFollowHealthIndicator();
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

function stopVoiceMonitor() {
  if (state.voiceMonitorSource) {
    try {
      state.voiceMonitorSource.disconnect();
    } catch (_error) {
      /* noop */
    }
  }
  if (state.voiceMonitorAnalyser) {
    try {
      state.voiceMonitorAnalyser.disconnect();
    } catch (_error) {
      /* noop */
    }
  }
  if (state.voiceMonitorContext) {
    try {
      state.voiceMonitorContext.close();
    } catch (_error) {
      /* noop */
    }
  }
  state.voiceMonitorContext = null;
  state.voiceMonitorSource = null;
  state.voiceMonitorAnalyser = null;
  state.voiceMonitorBuffer = null;
}

function startVoiceMonitor() {
  stopVoiceMonitor();
  if (!AudioContextCtor || !state.stream) {
    return;
  }
  const hasAudioTrack = Boolean(state.stream.getAudioTracks?.().length);
  if (!hasAudioTrack) {
    return;
  }
  try {
    const context = new AudioContextCtor();
    const source = context.createMediaStreamSource(state.stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.18;
    source.connect(analyser);
    state.voiceMonitorContext = context;
    state.voiceMonitorSource = source;
    state.voiceMonitorAnalyser = analyser;
    state.voiceMonitorBuffer = new Uint8Array(analyser.fftSize);
    if (context.state === "suspended") {
      context.resume().catch(() => {});
    }
  } catch (_error) {
    stopVoiceMonitor();
  }
}

function sampleVoiceLevel() {
  if (!state.voiceMonitorAnalyser || !state.voiceMonitorBuffer) {
    return null;
  }
  if (state.voiceMonitorContext && state.voiceMonitorContext.state === "suspended") {
    state.voiceMonitorContext.resume().catch(() => {});
  }
  try {
    state.voiceMonitorAnalyser.getByteTimeDomainData(state.voiceMonitorBuffer);
  } catch (_error) {
    return null;
  }
  let sum = 0;
  for (let i = 0; i < state.voiceMonitorBuffer.length; i += 1) {
    const centered = (state.voiceMonitorBuffer[i] - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / state.voiceMonitorBuffer.length);
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
  const now = Date.now();
  const minimumGapMs = Math.max(0, state.followLastRestartAt + FOLLOW_RESTART_MIN_INTERVAL_MS - now);
  const safeDelayMs = Math.max(delayMs, minimumGapMs);
  state.followPendingRestart = true;
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
      state.followPendingRestart = false;
      setStatus(elements.speechStatus, "語音識別引擎重建失敗，請重新點擊開始語音跟隨。", "danger");
      stopFollowMaintenance();
      updateFollowButtons();
      updateFollowHealthIndicator();
      return;
    }
  }
  clearFollowRestartTimer();
  scheduleFollowRestart(safeDelayMs);
  updateFollowHealthIndicator();
}

function checkFollowHealth() {
  const now = Date.now();
  updateFollowHealthIndicator(now);
  if (!state.followActive || !state.recognitionRunning) {
    return;
  }

  const sampledVoice = sampleVoiceLevel();
  if (sampledVoice !== null && sampledVoice >= VOICE_ACTIVITY_RMS_THRESHOLD) {
    state.followLastVoiceAt = now;
  }

  const hasRecentVoice = state.followLastVoiceAt > 0 && now - state.followLastVoiceAt <= FOLLOW_VOICE_RECENT_WINDOW_MS;
  const hasVoiceMonitor = Boolean(state.voiceMonitorAnalyser);
  const resultGapMs = state.followLastResultAt ? now - state.followLastResultAt : now - state.followLastStartAt;
  if (hasRecentVoice && resultGapMs >= FOLLOW_VOICE_STALL_TIMEOUT_MS) {
    state.followConsecutiveStalls += 1;
    setStatus(elements.speechStatus, "偵測到有聲音但沒有識別結果，正在快速重連...", "warning");
    restartRecognitionEngine(true, 180);
    return;
  }
  if (!state.followLastResultAt && hasVoiceMonitor && !hasRecentVoice) {
    return;
  }

  const baselineTs = state.followLastResultAt || state.followLastStartAt;
  if (!baselineTs) {
    return;
  }
  const stallTimeoutMs = state.followLastResultAt ? FOLLOW_RUNTIME_STALL_TIMEOUT_MS : FOLLOW_STARTUP_STALL_TIMEOUT_MS;
  const stalledMs = now - baselineTs;
  if (stalledMs < stallTimeoutMs) {
    return;
  }

  state.followConsecutiveStalls += 1;
  const shouldRecreate = state.followConsecutiveStalls >= 2 || !state.followLastResultAt;
  const tone = shouldRecreate ? "warning" : "neutral";
  setStatus(elements.speechStatus, "語音識別連線異常，正在自動恢復...", tone);
  restartRecognitionEngine(shouldRecreate, shouldRecreate ? 260 : 220);
}

function startFollowMaintenance() {
  clearFollowWatchdog();
  startVoiceMonitor();
  checkFollowHealth();
  state.followWatchdogIntervalId = setInterval(checkFollowHealth, FOLLOW_WATCHDOG_INTERVAL_MS);
}

function stopFollowMaintenance() {
  clearFollowRestartTimer();
  clearFollowWatchdog();
  stopVoiceMonitor();
  updateFollowHealthIndicator();
}

function scheduleFollowRestart(delayMs = 550) {
  if (!state.followActive || !state.recognition) {
    return;
  }
  state.followPendingRestart = true;
  state.followLastRestartAt = Date.now();
  clearFollowRestartTimer();
  updateFollowHealthIndicator();
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
    return "未知解析度";
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

  throw lastError || new Error("無法取得可用視訊串流");
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
  stopVoiceMonitor();
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
    option.textContent = `沒有可用${fallbackLabel}`;
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
    setStatus(elements.recordStatus, "瀏覽器不支援設備列舉。", "warning");
    elements.cameraSelect.disabled = true;
    elements.micSelect.disabled = true;
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const microphones = devices.filter((device) => device.kind === "audioinput");
  buildSelectOptions(elements.cameraSelect, cameras, "攝影機");
  buildSelectOptions(elements.micSelect, microphones, "麥克風");
}

async function initMedia() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus(elements.recordStatus, "瀏覽器不支援錄影 API。", "danger");
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
    setStatus(elements.recordStatus, `設備已就緒（${profileLabel}，${qualityText}），可以開始錄影。`, "success");
    updateRecordButtons();
    maybeStartAutoFollow();
    if (state.followActive) {
      startVoiceMonitor();
    }
  } catch (error) {
    setStatus(elements.recordStatus, `開啟設備失敗：${error.message}`, "danger");
  }
}

function handleRecordStop() {
  clearRecordTimer();
  elements.recordTimer.textContent = formatDuration(state.recordSeconds);
  state.recording = false;
  updateRecordButtons();

  if (!state.recordedChunks.length) {
    setStatus(elements.recordStatus, "沒有錄到可用內容。", "warning");
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
    ? `${formatVideoSettings(state.activeRecordConfig)}，約 ${(state.activeRecordConfig.videoBitsPerSecond / 1_000_000).toFixed(1)} Mbps`
    : "未知錄製參數";
  elements.recordResultMsg.textContent = `錄影完成（${outputFormat}，${qualityInfo}），大小 ${(blob.size / (1024 * 1024)).toFixed(2)} MB。`;
  setStatus(elements.recordStatus, "錄影已結束，已產生可下載檔案。", "success");
}

async function startRecording() {
  if (typeof MediaRecorder === "undefined") {
    setStatus(elements.recordStatus, "瀏覽器不支援 MediaRecorder。", "danger");
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
      const message = event.error?.message || "錄影過程中發生錯誤。";
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
    setStatus(elements.recordStatus, `錄影中...（${formatLabel}，${recordingQuality}，${bitrateText} Mbps）`, "warning");
  } catch (error) {
    setStatus(elements.recordStatus, `無法開始錄影：${error.message}`, "danger");
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
  state.followPendingRestart = false;
  updateFollowHealthIndicator();
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
      state.followPendingRestart = false;
      setStatus(elements.speechStatus, "麥克風權限被拒絕，無法繼續語音跟隨。", "danger");
      updateFollowButtons();
      stopFollowMaintenance();
      updateFollowHealthIndicator();
      return;
    }

    state.followRestartAttempts += 1;
    const retryDelay = Math.min(2100, 500 + state.followRestartAttempts * 260);
    const recreate = state.followRestartAttempts >= 4;
    setStatus(elements.speechStatus, "語音識別中斷，正在嘗試自動恢復...", "warning");
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
      setStatus(elements.recordStatus, "無法進入全螢幕：請先允許相機權限。", "danger");
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
      setStatus(elements.recordStatus, "已進入全螢幕提詞模式。", "success");
    } else {
      setStatus(elements.recordStatus, "瀏覽器不支援原生全螢幕，已開啟沉浸提詞模式。", "warning");
    }
  } catch (error) {
    setStatus(elements.recordStatus, `原生全螢幕啟動失敗，已改為沉浸模式：${error.message}`, "warning");
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
    setStatus(elements.recordStatus, "已離開全螢幕提詞模式。", "neutral");
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
    setStatus(elements.recordStatus, "已離開全螢幕提詞模式。", "neutral");
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
    state.followPendingRestart = false;
    state.followLastStartAt = Date.now();
    state.followLastVoiceAt = 0;
    state.followConsecutiveStalls = 0;
    updateFollowHealthIndicator();
  };

  recognition.onresult = (event) => {
    let interimText = "";
    let hasAnyTranscript = false;
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0]?.transcript?.trim();
      if (!transcript) {
        continue;
      }
      hasAnyTranscript = true;
      if (event.results[i].isFinal) {
        processRecognizedText(transcript);
        state.transcriptFinalText = `${state.transcriptFinalText} ${transcript}`.trim();
        if (state.transcriptFinalText.length > TRANSCRIPT_FINAL_MAX_CHARS * 2) {
          state.transcriptFinalText = state.transcriptFinalText.slice(-TRANSCRIPT_FINAL_MAX_CHARS * 2);
        }
      } else {
        interimText = `${interimText} ${transcript}`.trim();
      }
    }
    if (hasAnyTranscript) {
      state.followLastResultAt = Date.now();
      state.followConsecutiveStalls = 0;
    }
    state.transcriptInterimText = interimText;
    updateTranscriptDisplay();
    updateFollowHealthIndicator();
  };

  recognition.onerror = (event) => {
    if (!state.followActive) {
      return;
    }
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      stopFollowMaintenance();
      state.followActive = false;
      state.followRestartAttempts = 0;
      setStatus(elements.speechStatus, "請允許麥克風權限，才能使用語音跟隨。", "danger");
      updateFollowButtons();
      updateFollowHealthIndicator();
      return;
    }

    if (RESTARTABLE_FOLLOW_ERRORS.has(event.error)) {
      const tone = event.error === "no-speech" ? "neutral" : "warning";
      const message = event.error === "no-speech" ? "暫時沒聽到聲音，持續待命中..." : "識別短暫中斷，正在自動重連...";
      setStatus(elements.speechStatus, message, tone);
      restartRecognitionEngine(false, event.error === "no-speech" ? 420 : 700);
      return;
    }

    setStatus(elements.speechStatus, `語音識別異常：${event.error}`, "warning");
    restartRecognitionEngine(true, 850);
  };

  recognition.onend = () => {
    state.recognitionRunning = false;
    if (state.followActive && !state.followPendingRestart) {
      setStatus(elements.speechStatus, "語音識別已中斷，正在自動重連...", "warning");
      scheduleFollowRestart(520);
    }
    updateFollowHealthIndicator();
  };

  return recognition;
}

function findClosestOccurrenceInRange(script, snippet, rangeStart, rangeEnd) {
  if (!snippet.length || !script.length) {
    return -1;
  }
  const minStart = Math.max(0, rangeStart);
  const maxStart = Math.min(Math.max(0, script.length - snippet.length), rangeEnd - snippet.length);
  if (maxStart < minStart) {
    return -1;
  }

  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  let searchFrom = minStart;
  while (searchFrom <= maxStart) {
    const foundAt = script.indexOf(snippet, searchFrom);
    if (foundAt === -1 || foundAt > maxStart) {
      break;
    }
    const distance = Math.abs(foundAt - state.currentNormIndex);
    const backwardPenalty = foundAt < state.currentNormIndex ? FOLLOW_MATCH_BACKWARD_PENALTY : 0;
    const score = distance + backwardPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = foundAt;
    }
    searchFrom = foundAt + 1;
  }
  return bestIndex;
}

function findClosestOccurrence(snippet) {
  const script = state.normalizedScript;
  if (!snippet || !script) {
    return -1;
  }
  const cursor = clampNumber(state.currentNormIndex, 0, script.length);
  const nearStart = cursor - FOLLOW_MATCH_WINDOW_BACK_CHARS;
  const nearEnd = cursor + FOLLOW_MATCH_WINDOW_FORWARD_CHARS;
  const nearHit = findClosestOccurrenceInRange(script, snippet, nearStart, nearEnd);
  if (nearHit !== -1) {
    return nearHit;
  }

  const forwardHit = findClosestOccurrenceInRange(
    script,
    snippet,
    cursor,
    cursor + FOLLOW_MATCH_FALLBACK_FORWARD_CHARS,
  );
  if (forwardHit !== -1) {
    return forwardHit;
  }

  return findClosestOccurrenceInRange(script, snippet, cursor - FOLLOW_MATCH_FALLBACK_BACK_CHARS, cursor);
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

function processRecognizedText(text) {
  const rolling = `${state.recentTranscript} ${text}`.trim().slice(-260);

  const normalizedRolling = normalizeText(rolling);
  const matchedIndex = locateNormalizedPosition(normalizedRolling);
  if (matchedIndex !== null) {
    setPromptByNormIndex(matchedIndex);
  }
  state.recentTranscript = rolling.slice(-220);
}

function startFollowMode(showMessage = true) {
  if (!SpeechRecognitionCtor) {
    setStatus(elements.speechStatus, "瀏覽器不支援 SpeechRecognition。", "warning");
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
    setStatus(elements.speechStatus, "語音識別初始化失敗。", "danger");
    return;
  }

  state.recognition.lang = elements.languageSelect.value;
  state.followActive = true;
  state.followRestartAttempts = 0;
  state.followPendingRestart = false;
  state.followLastStartAt = Date.now();
  state.followLastResultAt = 0;
  state.followLastVoiceAt = 0;
  state.followLastRestartAt = 0;
  state.followConsecutiveStalls = 0;
  state.recentTranscript = "";
  state.transcriptFinalText = "";
  state.transcriptInterimText = "";
  updateTranscriptDisplay();
  if (showMessage) {
    setStatus(elements.speechStatus, "語音跟隨已啟動，開始說話即可自動跳行。", "success");
  }
  updateFollowButtons();
  updateFollowHealthIndicator();
  startFollowMaintenance();
  startRecognitionSafely();
}

function stopFollowMode(showMessage = true) {
  state.followActive = false;
  state.followRestartAttempts = 0;
  state.followPendingRestart = false;
  state.followLastStartAt = 0;
  state.followLastResultAt = 0;
  state.followLastVoiceAt = 0;
  state.followLastRestartAt = 0;
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
    setStatus(elements.speechStatus, "語音跟隨已停止。", "neutral");
  }
  updateFollowButtons();
  updateFollowHealthIndicator();
}

function startTTS() {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    setStatus(elements.speechStatus, "瀏覽器不支援文字轉語音。", "warning");
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
    setStatus(elements.speechStatus, "目前沒有可朗讀內容。", "warning");
    return;
  }

  const utterance = new SpeechSynthesisUtterance(utteranceText);
  utterance.lang = elements.languageSelect.value;
  utterance.rate = 1;
  utterance.pitch = 1;

  utterance.onstart = () => {
    state.ttsActive = true;
    updateTTSButtons();
    setStatus(elements.speechStatus, "TTS 朗讀中...", "success");
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
    setStatus(elements.speechStatus, "TTS 朗讀結束。", "neutral");
  };

  utterance.onerror = () => {
    state.ttsActive = false;
    updateTTSButtons();
    setStatus(elements.speechStatus, "TTS 朗讀失敗，請檢查瀏覽器語音引擎。", "danger");
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
    setStatus(elements.speechStatus, "已停止 TTS 朗讀。", "neutral");
  }
  state.ttsActive = false;
  updateTTSButtons();
}

function loadScript() {
  const rawInput = elements.scriptInput.value;
  saveScriptDraft(rawInput);
  const raw = rawInput.trim();
  if (!raw) {
    setStatus(elements.speechStatus, "提詞稿不能為空。", "danger");
    state.scriptLines = [];
    state.normalizedScript = "";
    state.currentLineIndex = -1;
    state.currentNormIndex = 0;
    renderScript();
    updateFollowButtons();
    updateTTSButtons();
    updateFollowHealthIndicator();
    return;
  }

  buildScriptFromInput(raw);
  const searchableCount = state.scriptLines.filter((line) => line.searchable).length;
  if (!searchableCount || !state.normalizedScript.length) {
    renderScript();
    setStatus(elements.speechStatus, "提詞稿沒有可識別內容，請調整文本。", "danger");
    updateFollowButtons();
    updateTTSButtons();
    updateFollowHealthIndicator();
    return;
  }

  renderScript();
  resetPrompt();
  setStatus(elements.speechStatus, `已載入 ${searchableCount} 行，可開始語音跟隨。`, "success");
  updateFollowButtons();
  updateTTSButtons();
  maybeStartAutoFollow();
  updateFollowHealthIndicator();
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
  elements.scriptInput.addEventListener("input", () => {
    saveScriptDraft(elements.scriptInput.value);
  });
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
      setStatus(elements.speechStatus, `識別語言已切換為 ${elements.languageSelect.options[elements.languageSelect.selectedIndex].text}。`, "neutral");
    }
    updateFollowButtons();
    updateFollowHealthIndicator();
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
  setStatus(elements.recordStatus, "尚未開啟設備。", "neutral");
  setStatus(elements.speechStatus, "尚未開始語音跟隨。", "neutral");
  const storedScript = readStoredScript();
  if (storedScript && storedScript.trim()) {
    elements.scriptInput.value = storedScript;
  } else {
    elements.scriptInput.value = DEFAULT_SCRIPT_TEXT;
    saveScriptDraft(DEFAULT_SCRIPT_TEXT);
  }
  setFullscreenStageActive(false);
  updateRecordButtons();
  updateFollowButtons();
  updateTTSButtons();
  updateFullscreenButton();
  updateMirrorToggleUI();
  syncFullscreenFontSize();
  updateTranscriptDisplay();
  updateFollowHealthIndicator();
  bindEvents();

  if (navigator.mediaDevices?.enumerateDevices) {
    try {
      await refreshDeviceLists();
    } catch (_error) {
      setStatus(elements.recordStatus, "讀取設備清單失敗，請稍後再試。", "warning");
    }
  }

  if (!SpeechRecognitionCtor) {
    setStatus(elements.speechStatus, "目前瀏覽器不支援語音識別，請改用 Chrome 或 Edge。", "warning");
  }

  if (!("speechSynthesis" in window)) {
    elements.speakBtn.disabled = true;
    elements.stopSpeakBtn.disabled = true;
  }

  loadScript();
  updateFollowHealthIndicator();
}

initialize();
