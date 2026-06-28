type NouColor = "red" | "yellow" | "green" | "blue" | "wild";
type NouKind = "number" | "skip" | "reverse" | "draw2" | "wild" | "wild4";
type PlayerId = "player" | "reze";

type NouCard = {
  id: string;
  color: NouColor;
  kind: NouKind;
  value?: number;
};

type NouState = {
  deck: NouCard[];
  discard: NouCard[];
  player: NouCard[];
  reze: NouCard[];
  turn: PlayerId;
  activeColor: Exclude<NouColor, "wild">;
  status: string;
  winner: PlayerId | null;
  hasDrawn: boolean;
  pendingWildId: string | null;
};

type NouMountOptions = {
  buttonSelector: string;
  modalSelector: string;
  backdropSelector: string;
  rootSelector: string;
  onLine?: (line: string) => void;
};

const colors: Array<Exclude<NouColor, "wild">> = ["red", "yellow", "green", "blue"];
const colorNames: Record<Exclude<NouColor, "wild">, string> = {
  red: "红",
  yellow: "黄",
  green: "绿",
  blue: "蓝",
};

let game: NouState | null = null;
let mounted = false;
let optionsRef: NouMountOptions | null = null;

function cardLabel(card: NouCard) {
  if (card.kind === "number") return String(card.value);
  if (card.kind === "skip") return "停";
  if (card.kind === "reverse") return "返";
  if (card.kind === "draw2") return "+2";
  if (card.kind === "wild") return "换";
  return "+4";
}

function cardName(card: NouCard) {
  const label = cardLabel(card);
  if (card.color === "wild") return label === "换" ? "万能换色" : "万能+4";
  return `${colorNames[card.color]}${label}`;
}

function buildDeck() {
  const deck: NouCard[] = [];
  let nextId = 0;
  const push = (color: NouColor, kind: NouKind, value?: number) => {
    deck.push({ id: `nou-${nextId++}`, color, kind, value });
  };

  for (const color of colors) {
    push(color, "number", 0);
    for (let copy = 0; copy < 2; copy += 1) {
      for (let value = 1; value <= 9; value += 1) push(color, "number", value);
      push(color, "skip");
      push(color, "reverse");
      push(color, "draw2");
    }
  }

  for (let copy = 0; copy < 4; copy += 1) {
    push("wild", "wild");
    push("wild", "wild4");
  }

  return shuffle(deck);
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function drawOne(state: NouState) {
  if (state.deck.length === 0) {
    const top = state.discard.pop();
    if (top) {
      state.deck = shuffle(state.discard);
      state.discard = [top];
    }
  }
  return state.deck.pop() ?? null;
}

function drawMany(state: NouState, owner: PlayerId, count: number) {
  const hand = owner === "player" ? state.player : state.reze;
  for (let index = 0; index < count; index += 1) {
    const card = drawOne(state);
    if (card) hand.push(card);
  }
}

function createGame(): NouState {
  const state: NouState = {
    deck: buildDeck(),
    discard: [],
    player: [],
    reze: [],
    turn: "player",
    activeColor: "red",
    status: "你们各抽了七张牌。你先出。",
    winner: null,
    hasDrawn: false,
    pendingWildId: null,
  };

  drawMany(state, "player", 7);
  drawMany(state, "reze", 7);

  let first = drawOne(state);
  while (first && first.color === "wild") {
    state.deck.unshift(first);
    state.deck = shuffle(state.deck);
    first = drawOne(state);
  }

  if (first) {
    state.discard.push(first);
    state.activeColor = first.color === "wild" ? "red" : first.color;
  }

  return state;
}

function topCard(state: NouState) {
  return state.discard[state.discard.length - 1];
}

function canPlay(card: NouCard, state: NouState) {
  const top = topCard(state);
  if (!top) return true;
  if (card.color === "wild") return true;
  if (card.color === state.activeColor) return true;
  if (card.kind === "number" && top.kind === "number" && card.value === top.value) return true;
  return card.kind !== "number" && card.kind === top.kind;
}

function setLine(line: string) {
  optionsRef?.onLine?.(line);
}

function nextPlayer(owner: PlayerId) {
  return owner === "player" ? "reze" : "player";
}

function bestWildColor(hand: NouCard[]) {
  const counts = colors.map((color) => ({ color, count: hand.filter((card) => card.color === color).length }));
  counts.sort((left, right) => right.count - left.count);
  return counts[0].color;
}

function finishTurn(state: NouState, owner: PlayerId, card: NouCard, chosenColor?: Exclude<NouColor, "wild">) {
  const target = nextPlayer(owner);
  state.pendingWildId = null;
  state.hasDrawn = false;
  state.discard.push(card);
  state.activeColor = card.color === "wild" ? chosenColor ?? "red" : card.color;

  const ownerName = owner === "player" ? "你" : "蕾塞";
  const targetName = target === "player" ? "你" : "蕾塞";
  let line = `${ownerName}打出了 ${cardName(card)}。`;

  if ((owner === "player" ? state.player : state.reze).length === 0) {
    state.winner = owner;
    state.turn = owner;
    state.status = owner === "player" ? "你赢了。蕾塞把牌收起来，笑得有点不服气。" : "蕾塞赢了。她把最后一张牌轻轻推到桌边。";
    setLine(state.status);
    return;
  }

  if (card.kind === "draw2") {
    drawMany(state, target, 2);
    state.turn = owner;
    line += `${targetName}抽两张，跳过这一回合。`;
  } else if (card.kind === "wild4") {
    drawMany(state, target, 4);
    state.turn = owner;
    line += `${targetName}抽四张，颜色变成${colorNames[state.activeColor]}。`;
  } else if (card.kind === "skip" || card.kind === "reverse") {
    state.turn = owner;
    line += `${targetName}被跳过。`;
  } else {
    state.turn = target;
    if (card.color === "wild") line += `颜色变成${colorNames[state.activeColor]}。`;
  }

  state.status = line;
  setLine(line);
}

function playPlayerCard(cardId: string, chosenColor?: Exclude<NouColor, "wild">) {
  if (!game || game.turn !== "player" || game.winner) return;
  const index = game.player.findIndex((card) => card.id === cardId);
  if (index < 0) return;
  const card = game.player[index];
  if (!canPlay(card, game)) {
    game.status = "这张牌现在还不能出。";
    renderNou();
    return;
  }
  if (card.color === "wild" && !chosenColor) {
    game.pendingWildId = card.id;
    game.status = "选一个颜色。";
    renderNou();
    return;
  }
  game.player.splice(index, 1);
  finishTurn(game, "player", card, chosenColor);
  renderNou();
  scheduleRezeMove();
}

function playerDraw() {
  if (!game || game.turn !== "player" || game.winner || game.hasDrawn) return;
  const card = drawOne(game);
  if (card) game.player.push(card);
  game.hasDrawn = true;
  game.status = card && canPlay(card, game) ? `你抽到了 ${cardName(card)}，可以选择打出。` : "你抽了一张牌。";
  renderNou();
}

function playerPass() {
  if (!game || game.turn !== "player" || game.winner || !game.hasDrawn) return;
  game.hasDrawn = false;
  game.turn = "reze";
  game.status = "你把回合交给了蕾塞。";
  renderNou();
  scheduleRezeMove();
}

function scheduleRezeMove() {
  if (!game || game.turn !== "reze" || game.winner) return;
  window.setTimeout(() => {
    if (!game || game.turn !== "reze" || game.winner) return;
    playRezeTurn(game);
    renderNou();
    if (game.turn === "reze" && !game.winner) scheduleRezeMove();
  }, 720);
}

function playRezeTurn(state: NouState) {
  const playable = state.reze.filter((card) => canPlay(card, state));
  if (playable.length === 0) {
    const drawn = drawOne(state);
    if (drawn) state.reze.push(drawn);
    if (drawn && canPlay(drawn, state)) {
      const chosenColor = drawn.color === "wild" ? bestWildColor(state.reze) : undefined;
      state.reze = state.reze.filter((card) => card.id !== drawn.id);
      finishTurn(state, "reze", drawn, chosenColor);
    } else {
      state.turn = "player";
      state.status = "蕾塞抽了一张牌，然后看向你。";
      setLine(state.status);
    }
    return;
  }

  playable.sort((left, right) => {
    const score = (card: NouCard) => (card.kind === "wild4" ? 5 : card.kind === "draw2" ? 4 : card.kind === "skip" ? 3 : card.kind === "reverse" ? 2 : card.kind === "wild" ? 1 : 0);
    return score(right) - score(left);
  });
  const card = playable[0];
  const chosenColor = card.color === "wild" ? bestWildColor(state.reze) : undefined;
  state.reze = state.reze.filter((item) => item.id !== card.id);
  finishTurn(state, "reze", card, chosenColor);
}

function cardHtml(card: NouCard, playable = false, hidden = false) {
  if (hidden) return `<div class="nou-card nou-card-back"><span>NOU</span></div>`;
  const colorClass = card.color === "wild" ? "wild" : card.color;
  return `<button class="nou-card ${colorClass} ${playable ? "is-playable" : ""}" data-card-id="${card.id}" style="--nou-color:${cardColor(card)}"><span class="nou-corner">${cardLabel(card)}</span><strong>${cardLabel(card)}</strong><small>${card.color === "wild" ? "" : colorNames[card.color]}</small></button>`;
}

function cardColor(card: NouCard) {
  if (card.color === "red") return "#d94343";
  if (card.color === "yellow") return "#e2b93b";
  if (card.color === "green") return "#2f9b65";
  if (card.color === "blue") return "#3d76d9";
  return "#272b35";
}

function renderNou() {
  const root = document.querySelector<HTMLElement>(optionsRef?.rootSelector ?? "");
  if (!root || !game) return;
  const currentGame = game;
  const top = topCard(currentGame);
  const playerTurn = currentGame.turn === "player" && !currentGame.winner;
  const playableCount = currentGame.player.filter((card) => canPlay(card, currentGame)).length;

  root.innerHTML = `
    <div class="nou-table">
      <div class="nou-header">
        <div><h2>NOU</h2><p>${currentGame.winner ? "本局结束" : currentGame.turn === "player" ? "你的回合" : "蕾塞的回合"}</p></div>
        <button id="nou-new-game">新局</button>
      </div>
      <div class="nou-rival">
        <span>蕾塞</span>
        <div class="nou-hand nou-hand-rival">${currentGame.reze.map(() => cardHtml({ id: "", color: "wild", kind: "wild" }, false, true)).join("")}</div>
        <strong>${currentGame.reze.length} 张</strong>
      </div>
      <div class="nou-center">
        <button id="nou-draw" class="nou-draw-pile" ${!playerTurn || currentGame.hasDrawn ? "disabled" : ""}>抽牌<br><strong>${currentGame.deck.length}</strong></button>
        <div class="nou-discard">${top ? cardHtml(top) : ""}<span>当前颜色：${colorNames[currentGame.activeColor]}</span></div>
        <div class="nou-message">${currentGame.status}</div>
      </div>
      <div class="nou-player-row">
        <div class="nou-hand nou-hand-player">${currentGame.player.map((card) => cardHtml(card, playerTurn && canPlay(card, currentGame))).join("")}</div>
        <div class="nou-actions"><button id="nou-pass" ${!playerTurn || !currentGame.hasDrawn ? "disabled" : ""}>结束回合</button><span>${playableCount} 张可出</span></div>
      </div>
      ${currentGame.pendingWildId ? `<div class="nou-color-picker"><span>选择颜色</span>${colors.map((color) => `<button data-wild-color="${color}" style="--nou-color:${cardColor({ id: "", color, kind: "number", value: 0 })}">${colorNames[color]}</button>`).join("")}</div>` : ""}
    </div>
  `;

  root.querySelector<HTMLButtonElement>("#nou-new-game")?.addEventListener("click", () => {
    game = createGame();
    renderNou();
  });
  root.querySelector<HTMLButtonElement>("#nou-draw")?.addEventListener("click", playerDraw);
  root.querySelector<HTMLButtonElement>("#nou-pass")?.addEventListener("click", playerPass);
  root.querySelectorAll<HTMLButtonElement>("[data-card-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const cardId = button.dataset.cardId;
      if (cardId) playPlayerCard(cardId);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-wild-color]").forEach((button) => {
    button.addEventListener("click", () => {
      const color = button.dataset.wildColor as Exclude<NouColor, "wild"> | undefined;
      const pendingWildId = game?.pendingWildId;
      if (color && pendingWildId) playPlayerCard(pendingWildId, color);
    });
  });
}

function setNouOpen(open: boolean) {
  const modal = document.querySelector<HTMLElement>(optionsRef?.modalSelector ?? "");
  const backdrop = document.querySelector<HTMLElement>(optionsRef?.backdropSelector ?? "");
  modal?.classList.toggle("is-open", open);
  backdrop?.classList.toggle("is-open", open);
  modal?.setAttribute("aria-hidden", String(!open));
  if (open) {
    if (!game) game = createGame();
    renderNou();
  }
}

export function mountNouGame(options: NouMountOptions) {
  optionsRef = options;
  const button = document.querySelector<HTMLButtonElement>(options.buttonSelector);
  const backdrop = document.querySelector<HTMLElement>(options.backdropSelector);
  const close = document.querySelector<HTMLButtonElement>("#nou-close");

  if (button) button.onclick = () => setNouOpen(true);
  if (backdrop) backdrop.onclick = () => setNouOpen(false);
  if (close) close.onclick = () => setNouOpen(false);

  if (!mounted) {
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setNouOpen(false);
    });
    mounted = true;
  }
}
