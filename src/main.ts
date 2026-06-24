export {};

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
};

const backgroundImage = "/user_data/background.png";
const rezeImage = "/user_data/reze.png";
const dialogueFile = "/user_data/%E5%8F%B0%E8%AF%8D.txt";

const bgmTracks: BgmTrack[] = [
  {
    id: "first-glance",
    title: "first glance",
    src: "/user_data/first_glance.mp3",
  },
  {
    id: "jane-doe",
    title: "jane doe",
    src: "/user_data/janedoe.mp3",
  },
];

const autoPlayStorageKey = "reze.bgm.autoPlay";
const volumeStorageKey = "reze.bgm.volume";
const trackStorageKey = "reze.bgm.track";
const loopModeStorageKey = "reze.bgm.loopMode";

const state: PetState = {
  mood: 64,
  trust: 18,
  energy: 72,
  scene: "(推开店门)  今天你在啊 蕾塞 。",
  volume: Number(localStorage.getItem(volumeStorageKey) ?? "56"),
  musicPlaying: false,
  autoPlayBgm: localStorage.getItem(autoPlayStorageKey) !== "false",
  activeTrackId: localStorage.getItem(trackStorageKey) ?? "first-glance",
  loopMode: (localStorage.getItem(loopModeStorageKey) as LoopMode | null) ?? "single",
  settingsOpen: false,
};

if (!bgmTracks.some((track) => track.id === state.activeTrackId)) {
  state.activeTrackId = bgmTracks[0].id;
}

const dialogueByAction: Record<ActionId, string[]> = {
  talk: [],
  gift: [],
  look: [],
  rest: [],
};

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
  return Math.max(
    0,
    bgmTracks.findIndex((track) => track.id === state.activeTrackId),
  );
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

  if (wasPlaying || state.autoPlayBgm) {
    void playBgm(audio, musicToggle);
  }
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
    if (state.loopMode === "list") {
      playNextTrack(audio, musicToggle);
    }
  });

  if (autoPlayToggle) {
    autoPlayToggle.checked = state.autoPlayBgm;
    autoPlayToggle.addEventListener("change", () => {
      state.autoPlayBgm = autoPlayToggle.checked;
      localStorage.setItem(autoPlayStorageKey, String(state.autoPlayBgm));

      if (state.autoPlayBgm && audio.paused) {
        void playBgm(audio, musicToggle);
      }
    });
  }

  trackSelect?.addEventListener("change", () => {
    setTrack(trackSelect.value, audio, musicToggle);
  });

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

  if (state.autoPlayBgm) {
    void playBgm(audio, musicToggle);
  }
}

function attachSettingsControls() {
  document.querySelector("#settings-button")?.addEventListener("click", () => setSettingsOpen(true));
  document.querySelector("#settings-close")?.addEventListener("click", () => setSettingsOpen(false));
  document.querySelector("#settings-backdrop")?.addEventListener("click", () => setSettingsOpen(false));

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.settingsOpen) {
      setSettingsOpen(false);
    }
  });
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
        <div>
          <span>心情</span>
          <strong id="mood-value">${state.mood}</strong>
        </div>
        <div>
          <span>信赖</span>
          <strong id="trust-value">${state.trust}</strong>
        </div>
        <div>
          <span>精力</span>
          <strong id="energy-value">${state.energy}</strong>
        </div>
      </section>

      <section class="top-controls">
        <button id="settings-button">设置</button>
      </section>

      <section class="portrait-wrap">
        <img class="portrait" src="${rezeImage}" alt="Reze" draggable="false" />
      </section>

      <section class="dialogue">
        <div class="nameplate">Reze</div>
        <p id="scene-text">${state.scene}</p>
        <div class="actions">
          <button data-action="talk">聊天</button>
          <button data-action="gift">送礼物</button>
          <button data-action="look">看看她</button>
          <button data-action="rest">休息</button>
        </div>
      </section>

      <div id="settings-backdrop" class="settings-backdrop"></div>
      <aside id="settings-page" class="settings-page" aria-hidden="true">
        <div class="settings-header">
          <h2>设置</h2>
          <button id="settings-close">关闭</button>
        </div>

        <section class="settings-group">
          <h3>声音</h3>
          <div class="setting-row">
            <span>BGM</span>
            <button id="music-toggle">播放 BGM</button>
          </div>
          <label class="select-control" for="track-select">
            <span>BGM 切换</span>
            <select id="track-select">${renderTrackOptions()}</select>
          </label>
          <div class="setting-row loop-control">
            <span>循环模式</span>
            <div class="segmented-control">
              <button data-loop-mode="single" class="${state.loopMode === "single" ? "is-active" : ""}">单曲循环</button>
              <button data-loop-mode="list" class="${state.loopMode === "list" ? "is-active" : ""}">列表循环</button>
            </div>
          </div>
          <label class="setting-row toggle-control" for="autoplay-toggle">
            <span>启动时自动播放</span>
            <input id="autoplay-toggle" type="checkbox" ${state.autoPlayBgm ? "checked" : ""} />
          </label>
          <label class="volume-control" for="volume-slider">
            <span>音量</span>
            <input id="volume-slider" type="range" min="0" max="100" value="${state.volume}" />
            <strong id="volume-value">${state.volume}%</strong>
          </label>
        </section>

        <section class="settings-group muted">
          <h3>后续预留</h3>
          <p>这里以后可以放文字速度、窗口模式、AI 设置、存档、API Key 和记忆管理。</p>
        </section>
      </aside>

      <audio id="bgm" preload="auto"></audio>
    </section>
  `;

  attachActionControls();
  attachMusicControls();
  attachSettingsControls();
}

async function init() {
  await loadDialogue();
  render();
}

init();
