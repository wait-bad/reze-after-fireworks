type PetState = {
  mood: number;
  trust: number;
  energy: number;
  scene: string;
  volume: number;
  musicPlaying: boolean;
  settingsOpen: boolean;
};

const backgroundImage = "/user_data/background.png";
const rezeImage = "/user_data/reze.png";
const bgm = "/user_data/first_glance.mp4";

const state: PetState = {
  mood: 64,
  trust: 18,
  energy: 72,
  scene: "烟火散去后的夜晚，她还站在河岸边。",
  volume: 56,
  musicPlaying: false,
  settingsOpen: false,
};

const app = document.querySelector<HTMLDivElement>("#app");

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
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

function changeState(mood: number, trust: number, energy: number, scene: string) {
  state.mood = clamp(state.mood + mood);
  state.trust = clamp(state.trust + trust);
  state.energy = clamp(state.energy + energy);
  state.scene = scene;
  updateHud();
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
      const action = button.dataset.action;

      if (action === "talk") {
        changeState(8, 4, -5, "她看向你，像是刚从很远的地方回来。‘你刚刚说的，我听见了。’");
      }

      if (action === "gift") {
        changeState(10, 8, 0, "她接过饮料，指尖停了一下。‘这种味道……我还挺喜欢。’");
      }

      if (action === "walk") {
        changeState(4, 5, -12, "你们沿着河岸慢慢走，最后一束烟火在水面上散开。信赖悄悄增加了。");
      }

      if (action === "rest") {
        changeState(2, 1, 18, "她坐在长椅上，肩膀终于放松下来。夜色安静了一点。");
      }
    });
  });
}

function updateMusicButton(button: HTMLButtonElement | null) {
  if (button) button.textContent = state.musicPlaying ? "暂停 BGM" : "播放 BGM";
}

function attachMusicControls() {
  const video = document.querySelector<HTMLVideoElement>("#bgm");
  const musicToggle = document.querySelector<HTMLButtonElement>("#music-toggle");
  const volumeSlider = document.querySelector<HTMLInputElement>("#volume-slider");
  const volumeValue = document.querySelector<HTMLElement>("#volume-value");

  if (!video) return;

  video.volume = state.volume / 100;
  updateMusicButton(musicToggle);

  musicToggle?.addEventListener("click", async () => {
    if (video.paused) {
      await video.play();
      state.musicPlaying = true;
    } else {
      video.pause();
      state.musicPlaying = false;
    }

    updateMusicButton(musicToggle);
  });

  volumeSlider?.addEventListener("input", () => {
    state.volume = Number(volumeSlider.value);
    video.volume = state.volume / 100;
    if (volumeValue) volumeValue.textContent = `${state.volume}%`;
  });
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
          <button data-action="gift">送饮料</button>
          <button data-action="walk">散步</button>
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

      <video id="bgm" src="${bgm}" loop playsinline></video>
    </section>
  `;

  attachActionControls();
  attachMusicControls();
  attachSettingsControls();
}

render();
