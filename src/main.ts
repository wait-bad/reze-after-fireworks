import { invoke } from "@tauri-apps/api/core";

type ActionId = "talk" | "gift" | "look" | "rest";
type LoopMode = "single" | "list";

type BgmTrack = {
  id: string;
  title: string;
  src: string;
};

type PetState = {
  mood: number;
  trust: number;
  energy: number;
  scene: string;
  volume: number;
  musicPlaying: boolean;
  autoPlayBgm: boolean;
  activeTrackId: string;
  loopMode: LoopMode;
  settingsOpen: boolean;
  geminiOpen: boolean;
  geminiLoading: boolean;
  geminiInput: string;
  geminiApiKeyDraft: string;
  geminiKeySaved: boolean;
  geminiBaseUrl: string;
  geminiModel: string;
  geminiNote: string;
  geminiStatus: string;
};

const backgroundImage = "/user_data/background.png";
const rezeImage = "/user_data/reze.png";
const dialogueFile = "/user_data/%E5%8F%B0%E8%AF%8D.txt";

const bgmTracks: BgmTrack[] = [
  { id: "first-glance", title: "first glance", src: "/user_data/first_glance.mp3" },
  { id: "jane-doe", title: "jane doe", src: "/user_data/janedoe.mp3" },
];

const autoPlayStorageKey = "reze.bgm.autoPlay";
const volumeStorageKey = "reze.bgm.volume";
const trackStorageKey = "reze.bgm.track";
const loopModeStorageKey = "reze.bgm.loopMode";
const legacyAIApiKeyStorageKey = "reze.gemini.apiKey";
const geminiBaseUrlStorageKey = "reze.ai.baseUrl";
const geminiModelStorageKey = "reze.ai.model";
const geminiNoteStorageKey = "reze.gemini.note";
const oldDefaultAINote = "70字以内。减少AI味。像蕾塞本人自然说话，不要总结，不要排比，不要解释规则。";
const defaultAiBaseUrl = "https://api.openai.com/v1";
const defaultAiModel = "gpt-5.5";
const defaultAINote = "尽量写到30到70字之间。减少AI味。像蕾塞本人自然说话，不要总结，不要排比，不要解释规则。";

const state: PetState = {
  mood: 64,
  trust: 18,
  energy: 72,
  scene: "(推开店门)  今天你在啊 蕾塞。",
  volume: Number(localStorage.getItem(volumeStorageKey) ?? "56"),
  musicPlaying: false,
  autoPlayBgm: localStorage.getItem(autoPlayStorageKey) !== "false",
  activeTrackId: localStorage.getItem(trackStorageKey) ?? "first-glance",
  loopMode: (localStorage.getItem(loopModeStorageKey) as LoopMode | null) ?? "single",
  settingsOpen: false,
  geminiOpen: false,
  geminiLoading: false,
  geminiInput: "",
  geminiApiKeyDraft: "",
  geminiKeySaved: false,
  geminiBaseUrl: localStorage.getItem(geminiBaseUrlStorageKey) ?? defaultAiBaseUrl,
  geminiModel: localStorage.getItem(geminiModelStorageKey) ?? defaultAiModel,
  geminiNote: (() => {
    const savedNote = localStorage.getItem(geminiNoteStorageKey);
    return !savedNote || savedNote === oldDefaultAINote ? defaultAINote : savedNote;
  })(),
  geminiStatus: "输入一句话，让她回应你。",
};

if (!bgmTracks.some((track) => track.id === state.activeTrackId)) {
  state.activeTrackId = bgmTracks[0].id;
}

const dialogueByAction: Record<ActionId, string[]> = { talk: [], gift: [], look: [], rest: [] };

const fallbackDialogue: Record<ActionId, string[]> = {
  talk: ["她看向你，像是刚从很远的地方回来。‘你刚刚说的，我听见了。’"],
  gift: ["她接过礼物，指尖停了一下。‘这种感觉……我还挺喜欢。’"],
  look: ["她歪了歪头。‘一直看着我做什么？我脸上有咖啡渍吗？’"],
  rest: ["她坐在长椅上，肩膀终于放松下来。夜色安静了一点。"],
};

const app = document.querySelector<HTMLDivElement>("#app");

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function activeTrack() {
  return bgmTracks.find((track) => track.id === state.activeTrackId) ?? bgmTracks[0];
}

function activeTrackIndex() {
  return Math.max(0, bgmTracks.findIndex((track) => track.id === state.activeTrackId));
}

function setText(selector: string, value: string | number) {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = String(value);
}

function updateHud() {
  setText("#mood-value", state.mood);
  setText("#trust-value", state.trust);
  setText("#energy-value", state.energy);
  setText("#scene-text", state.scene);
}

function randomLine(action: ActionId) {
  const lines = dialogueByAction[action].length > 0 ? dialogueByAction[action] : fallbackDialogue[action];
  return lines[Math.floor(Math.random() * lines.length)];
}

function changeState(mood: number, trust: number, energy: number, action: ActionId) {
  state.mood = clamp(state.mood + mood);
  state.trust = clamp(state.trust + trust);
  state.energy = clamp(state.energy + energy);
  state.scene = randomLine(action);
  updateHud();
}

function actionFromHeading(line: string): ActionId | null {
  if (line.includes("【聊天】")) return "talk";
  if (line.includes("【送礼物】")) return "gift";
  if (line.includes("【看看她】")) return "look";
  if (line.includes("【休息】")) return "rest";
  return null;
}

function cleanDialogueLine(line: string) {
  return line
    .replace(/^\s*[-*]\s*/, "")
    .replace(/^\*\*\[[^\]]+态\]\*\*\s*/, "")
    .replace(/^\[[^\]]+态\]\s*/, "")
    .trim();
}

async function loadDialogue() {
  try {
    const response = await fetch(dialogueFile);
    if (!response.ok) throw new Error(`Failed to load dialogue: ${response.status}`);
    const text = await response.text();
    let currentAction: ActionId | null = null;

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      const headingAction = actionFromHeading(line);
      if (headingAction) {
        currentAction = headingAction;
        continue;
      }
      if (!currentAction || !line.startsWith("*")) continue;
      const dialogue = cleanDialogueLine(line);
      if (dialogue) dialogueByAction[currentAction].push(dialogue);
    }
  } catch (error) {
    console.warn(error);
  }
}

function setSettingsOpen(open: boolean) {
  state.settingsOpen = open;
  const panel = document.querySelector<HTMLElement>("#settings-page");
  const backdrop = document.querySelector<HTMLElement>("#settings-backdrop");
  panel?.classList.toggle("is-open", open);
  backdrop?.classList.toggle("is-open", open);
  panel?.setAttribute("aria-hidden", String(!open));
}

function setAIOpen(open: boolean) {
  state.geminiOpen = open;
  const modal = document.querySelector<HTMLElement>("#gemini-modal");
  const backdrop = document.querySelector<HTMLElement>("#gemini-backdrop");
  modal?.classList.toggle("is-open", open);
  backdrop?.classList.toggle("is-open", open);
  modal?.setAttribute("aria-hidden", String(!open));
  if (open) document.querySelector<HTMLTextAreaElement>("#gemini-input")?.focus();
}

function setAILoading(loading: boolean) {
  state.geminiLoading = loading;
  const sendButton = document.querySelector<HTMLButtonElement>("#gemini-send");
  const testButton = document.querySelector<HTMLButtonElement>("#gemini-test");
  if (sendButton) {
    sendButton.disabled = loading;
    sendButton.textContent = loading ? "等待回应..." : "发送";
  }
  if (testButton) testButton.disabled = loading;
}

function updateAIStatus(message: string) {
  state.geminiStatus = message;
  setText("#gemini-status", message);
}

function updateAIKeyStatus(message?: string) {
  const status = message ?? (state.geminiKeySaved ? "已保存到 Windows 凭据管理器。" : "尚未保存 API Key。");
  setText("#gemini-key-status", status);
}

function saveAINote() {
  const baseUrlInput = document.querySelector<HTMLInputElement>("#gemini-base-url");
  const modelInput = document.querySelector<HTMLInputElement>("#gemini-model");
  const noteInput = document.querySelector<HTMLTextAreaElement>("#gemini-note");
  state.geminiBaseUrl = baseUrlInput?.value.trim() || defaultAiBaseUrl;
  state.geminiModel = modelInput?.value.trim() || defaultAiModel;
  state.geminiNote = noteInput?.value.trim() || defaultAINote;
  localStorage.setItem(geminiBaseUrlStorageKey, state.geminiBaseUrl);
  localStorage.setItem(geminiModelStorageKey, state.geminiModel);
  localStorage.setItem(geminiNoteStorageKey, state.geminiNote);
}

async function refreshAIKeyStatus() {
  try {
    state.geminiKeySaved = await invoke<boolean>("has_gemini_api_key");
  } catch (error) {
    state.geminiKeySaved = false;
    updateAIKeyStatus(String(error));
    return;
  }
  updateAIKeyStatus();
}

async function migrateLegacyAIKey() {
  const legacyKey = localStorage.getItem(legacyAIApiKeyStorageKey)?.trim();
  if (!legacyKey) {
    localStorage.removeItem(legacyAIApiKeyStorageKey);
    return;
  }

  try {
    await invoke("save_gemini_api_key", { apiKey: legacyKey });
    state.geminiKeySaved = true;
  } catch (error) {
    console.warn("Failed to migrate AI API key.", error);
  } finally {
    localStorage.removeItem(legacyAIApiKeyStorageKey);
  }
}

async function saveAIApiKey() {
  const apiKeyInput = document.querySelector<HTMLInputElement>("#gemini-api-key");
  const apiKey = apiKeyInput?.value.trim() ?? "";
  if (!apiKey) {
    updateAIKeyStatus("请先输入新的 API Key。");
    return;
  }

  try {
    await invoke("save_gemini_api_key", { apiKey });
    state.geminiApiKeyDraft = "";
    state.geminiKeySaved = true;
    if (apiKeyInput) apiKeyInput.value = "";
    updateAIKeyStatus("已保存到 Windows 凭据管理器。输入框已清空。");
  } catch (error) {
    updateAIKeyStatus(String(error));
  }
}

async function deleteAIApiKey() {
  try {
    await invoke("delete_gemini_api_key");
    state.geminiKeySaved = false;
    updateAIKeyStatus("已删除保存的 API Key。");
  } catch (error) {
    updateAIKeyStatus(String(error));
  }
}

async function sendAIPrompt() {
  const input = document.querySelector<HTMLTextAreaElement>("#gemini-input");
  if (!input) return;
  state.geminiInput = input.value.trim();
  if (!state.geminiInput) {
    updateAIStatus("先输入一句话。");
    return;
  }
  saveAINote();
  setAILoading(true);
  updateAIStatus("她正在想怎么回你...");
  try {
    const response = await invoke<string>("ask_gemini", {
      baseUrl: state.geminiBaseUrl,
      model: state.geminiModel,
      prompt: state.geminiInput,
      userNote: state.geminiNote,
    });
    state.scene = response;
    updateHud();
    updateAIStatus(response);
  } catch (error) {
    updateAIStatus(String(error));
  } finally {
    setAILoading(false);
  }
}

async function testAIConnection() {
  saveAINote();
  setAILoading(true);
  setText("#gemini-test-result", "测试中...");
  try {
    const response = await invoke<string>("test_gemini_connection", {
      baseUrl: state.geminiBaseUrl,
      model: state.geminiModel,
      userNote: state.geminiNote,
    });
    setText("#gemini-test-result", response || "连接成功。");
  } catch (error) {
    setText("#gemini-test-result", String(error));
  } finally {
    setAILoading(false);
  }
}

function attachActionControls() {
  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action as ActionId | undefined;
      if (!action) return;
      if (action === "talk") changeState(8, 4, -5, action);
      if (action === "gift") changeState(10, 8, 0, action);
      if (action === "look") changeState(4, 3, -2, action);
      if (action === "rest") changeState(2, 1, 18, action);
    });
  });
}

function updateMusicButton(button: HTMLButtonElement | null) {
  if (button) button.textContent = state.musicPlaying ? "暂停 BGM" : "播放 BGM";
}

function updateLoopButtons() {
  document.querySelectorAll<HTMLButtonElement>("[data-loop-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.loopMode === state.loopMode);
  });
}

async function playBgm(audio: HTMLAudioElement, musicToggle: HTMLButtonElement | null) {
  try {
    await audio.play();
    state.musicPlaying = true;
  } catch (error) {
    state.musicPlaying = false;
    console.warn("BGM autoplay was blocked by WebView2.", error);
  }
  updateMusicButton(musicToggle);
}

function pauseBgm(audio: HTMLAudioElement, musicToggle: HTMLButtonElement | null) {
  audio.pause();
  state.musicPlaying = false;
  updateMusicButton(musicToggle);
}

function applyTrack(audio: HTMLAudioElement) {
  audio.src = activeTrack().src;
  audio.loop = state.loopMode === "single";
  audio.load();
}

function setTrack(trackId: string, audio: HTMLAudioElement, musicToggle: HTMLButtonElement | null) {
  state.activeTrackId = bgmTracks.some((track) => track.id === trackId) ? trackId : bgmTracks[0].id;
  localStorage.setItem(trackStorageKey, state.activeTrackId);
  const wasPlaying = state.musicPlaying;
  applyTrack(audio);
  if (wasPlaying || state.autoPlayBgm) void playBgm(audio, musicToggle);
}

function playNextTrack(audio: HTMLAudioElement, musicToggle: HTMLButtonElement | null) {
  const nextIndex = (activeTrackIndex() + 1) % bgmTracks.length;
  setTrack(bgmTracks[nextIndex].id, audio, musicToggle);
  const select = document.querySelector<HTMLSelectElement>("#track-select");
  if (select) select.value = state.activeTrackId;
}

function setLoopMode(loopMode: LoopMode, audio: HTMLAudioElement) {
  state.loopMode = loopMode;
  localStorage.setItem(loopModeStorageKey, state.loopMode);
  audio.loop = state.loopMode === "single";
  updateLoopButtons();
}

function attachMusicControls() {
  const audio = document.querySelector<HTMLAudioElement>("#bgm");
  const musicToggle = document.querySelector<HTMLButtonElement>("#music-toggle");
  const autoPlayToggle = document.querySelector<HTMLInputElement>("#autoplay-toggle");
  const trackSelect = document.querySelector<HTMLSelectElement>("#track-select");
  const volumeSlider = document.querySelector<HTMLInputElement>("#volume-slider");
  const volumeValue = document.querySelector<HTMLElement>("#volume-value");
  if (!audio) return;

  audio.volume = state.volume / 100;
  applyTrack(audio);
  updateMusicButton(musicToggle);
  updateLoopButtons();

  audio.addEventListener("ended", () => {
    if (state.loopMode === "list") playNextTrack(audio, musicToggle);
  });

  if (autoPlayToggle) {
    autoPlayToggle.checked = state.autoPlayBgm;
    autoPlayToggle.addEventListener("change", () => {
      state.autoPlayBgm = autoPlayToggle.checked;
      localStorage.setItem(autoPlayStorageKey, String(state.autoPlayBgm));
      if (state.autoPlayBgm && audio.paused) void playBgm(audio, musicToggle);
    });
  }

  trackSelect?.addEventListener("change", () => setTrack(trackSelect.value, audio, musicToggle));

  document.querySelectorAll<HTMLButtonElement>("[data-loop-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const loopMode = button.dataset.loopMode as LoopMode | undefined;
      if (loopMode) setLoopMode(loopMode, audio);
    });
  });

  musicToggle?.addEventListener("click", () => {
    if (audio.paused) {
      state.autoPlayBgm = true;
      localStorage.setItem(autoPlayStorageKey, "true");
      if (autoPlayToggle) autoPlayToggle.checked = true;
      void playBgm(audio, musicToggle);
    } else {
      pauseBgm(audio, musicToggle);
    }
  });

  volumeSlider?.addEventListener("input", () => {
    state.volume = Number(volumeSlider.value);
    audio.volume = state.volume / 100;
    localStorage.setItem(volumeStorageKey, String(state.volume));
    if (volumeValue) volumeValue.textContent = String(state.volume) + "%";
  });

  if (state.autoPlayBgm) void playBgm(audio, musicToggle);
}

function attachSettingsControls() {
  document.querySelector("#settings-button")?.addEventListener("click", () => setSettingsOpen(true));
  document.querySelector("#settings-close")?.addEventListener("click", () => setSettingsOpen(false));
  document.querySelector("#settings-backdrop")?.addEventListener("click", () => setSettingsOpen(false));
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (state.geminiOpen) setAIOpen(false);
      if (state.settingsOpen) setSettingsOpen(false);
    }
  });
}

function attachAIControls() {
  document.querySelector("#gemini-button")?.addEventListener("click", () => setAIOpen(true));
  document.querySelector("#gemini-close")?.addEventListener("click", () => setAIOpen(false));
  document.querySelector("#gemini-backdrop")?.addEventListener("click", () => setAIOpen(false));
  document.querySelector("#gemini-send")?.addEventListener("click", () => void sendAIPrompt());
  document.querySelector("#gemini-test")?.addEventListener("click", () => void testAIConnection());
  document.querySelector("#gemini-save-key")?.addEventListener("click", () => void saveAIApiKey());
  document.querySelector("#gemini-delete-key")?.addEventListener("click", () => void deleteAIApiKey());
  document.querySelector("#gemini-base-url")?.addEventListener("change", saveAINote);
  document.querySelector("#gemini-model")?.addEventListener("change", saveAINote);
  document.querySelector("#gemini-note")?.addEventListener("change", saveAINote);
  document.querySelector("#gemini-input")?.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === "Enter" && (keyboardEvent.ctrlKey || keyboardEvent.metaKey)) void sendAIPrompt();
  });
  updateAIKeyStatus();
}

function renderTrackOptions() {
  return bgmTracks
    .map((track) => `<option value="${track.id}" ${track.id === state.activeTrackId ? "selected" : ""}>${track.title}</option>`)
    .join("");
}

function render() {
  if (!app) return;

  app.innerHTML = `
    <section class="stage" style="--scene-image: url('${backgroundImage}')">
      <div class="scene-overlay"></div>
      <section class="hud" aria-label="character status">
        <div><span>心情</span><strong id="mood-value">${state.mood}</strong></div>
        <div><span>信赖</span><strong id="trust-value">${state.trust}</strong></div>
        <div><span>精力</span><strong id="energy-value">${state.energy}</strong></div>
      </section>
      <section class="top-controls"><button id="settings-button">设置</button></section>
      <section class="portrait-wrap"><img class="portrait" src="${rezeImage}" alt="Reze" draggable="false" /></section>
      <section class="dialogue">
        <div class="nameplate">Reze</div>
        <p id="scene-text">${state.scene}</p>
        <div class="actions">
          <button data-action="talk">聊天</button>
          <button data-action="gift">送礼物</button>
          <button data-action="look">看看她</button>
          <button data-action="rest">休息</button>
          <button id="gemini-button">ChatGPT</button>
        </div>
      </section>
      <div id="settings-backdrop" class="settings-backdrop"></div>
      <aside id="settings-page" class="settings-page" aria-hidden="true">
        <div class="settings-header"><h2>设置</h2><button id="settings-close">关闭</button></div>
        <section class="settings-group">
          <h3>声音</h3>
          <div class="setting-row"><span>BGM</span><button id="music-toggle">播放 BGM</button></div>
          <label class="select-control" for="track-select"><span>BGM 切换</span><select id="track-select">${renderTrackOptions()}</select></label>
          <div class="setting-row loop-control"><span>循环模式</span><div class="segmented-control"><button data-loop-mode="single" class="${state.loopMode === "single" ? "is-active" : ""}">单曲循环</button><button data-loop-mode="list" class="${state.loopMode === "list" ? "is-active" : ""}">列表循环</button></div></div>
          <label class="setting-row toggle-control" for="autoplay-toggle"><span>启动时自动播放</span><input id="autoplay-toggle" type="checkbox" ${state.autoPlayBgm ? "checked" : ""} /></label>
          <label class="volume-control" for="volume-slider"><span>音量</span><input id="volume-slider" type="range" min="0" max="100" value="${state.volume}" /><strong id="volume-value">${state.volume}%</strong></label>
        </section>
        <section class="settings-group">
          <h3>ChatGPT / 中转站</h3>
          <label class="text-control" for="gemini-base-url"><span>Base URL</span><input id="gemini-base-url" type="text" value="${state.geminiBaseUrl}" placeholder="https://你的中转站/v1" autocomplete="off" /></label>
          <label class="text-control" for="gemini-model"><span>模型</span><input id="gemini-model" type="text" value="${state.geminiModel}" placeholder="gpt-5.5" autocomplete="off" /></label>
          <label class="text-control" for="gemini-api-key"><span>API Key</span><input id="gemini-api-key" type="password" value="${state.geminiApiKeyDraft}" placeholder="输入中转站 API Key" autocomplete="off" /></label>
          <div class="setting-row"><span>密钥</span><div class="segmented-control"><button id="gemini-save-key">保存</button><button id="gemini-delete-key">删除</button></div></div>
          <p id="gemini-key-status" class="setting-hint">${state.geminiKeySaved ? "已保存到 Windows 凭据管理器。" : "尚未保存 API Key。"}</p>
          <label class="textarea-control" for="gemini-note"><span>随请求发送的备注</span><textarea id="gemini-note" rows="5">${state.geminiNote}</textarea></label>
          <div class="setting-row"><span>连通性</span><button id="gemini-test">测试 AI</button></div>
          <p id="gemini-test-result" class="setting-hint">尚未测试。</p>
        </section>
        <section class="settings-group muted"><h3>后续预留</h3><p>这里以后可以放文字速度、窗口模式、存档和记忆管理。</p></section>
      </aside>
      <audio id="bgm" preload="auto"></audio>
      <div id="gemini-backdrop" class="modal-backdrop"></div>
      <aside id="gemini-modal" class="gemini-modal" aria-hidden="true">
        <div class="settings-header"><h2>ChatGPT</h2><button id="gemini-close">关闭</button></div>
        <label class="textarea-control" for="gemini-input"><span>输入内容</span><textarea id="gemini-input" rows="5" placeholder="想对她说什么？">${state.geminiInput}</textarea></label>
        <div class="gemini-actions"><button id="gemini-send">发送</button></div>
        <p id="gemini-status" class="gemini-status">${state.geminiStatus}</p>
      </aside>
    </section>
  `;

  attachActionControls();
  attachMusicControls();
  attachSettingsControls();
  attachAIControls();
}

async function init() {
  await loadDialogue();
  await migrateLegacyAIKey();
  await refreshAIKeyStatus();
  render();
}

init();





