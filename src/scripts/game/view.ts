import {
  applyMove,
  beatsBid,
  continueAfterReveal,
  createGame,
  currentBid,
  currentPlayer,
  legalMoves,
  HUMAN_SEAT,
  MAX_INTOXICATION,
  MAX_PUSH,
  type Claim,
  type GameState,
  type LogEntry,
} from "./engine.ts";
import { chooseBotMove } from "./bots.ts";
import { TIER_ORDER, type Tier } from "./tiers.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

const REQUIRED_IDS = [
  "table",
  "opponents",
  "pot",
  "pot-stack",
  "bid-meter",
  "you",
  "your-flight",
  "intox-meter",
  "actions",
  "claim",
  "push",
  "doubt",
  "feed",
  "outcome",
  "again",
];

export class MissingElementError extends Error {
  constructor(id: string) {
    super(`view.ts: skeleton is missing required element #${id}`);
    this.name = "MissingElementError";
  }
}

export interface MountOptions {
  seed?: number;
  autoplay?: boolean;
  botDelayMs?: number;
  revealHoldMs?: number;
}

export interface GameHandle {
  step(): boolean;
  destroy(): void;
}

function requireElement<T extends Element>(doc: Document, id: string): T {
  const el = doc.getElementById(id);
  if (!el) throw new MissingElementError(id);
  return el as unknown as T;
}

function tierLabel(tier: Tier): string {
  return tier[0].toUpperCase() + tier.slice(1);
}

function claimText(claim: Claim): string {
  return `${claim.quantity} ${tierLabel(claim.tier)}${claim.quantity > 1 ? "s" : ""}`;
}

function bidRank(claim: Claim): number {
  return TIER_ORDER.indexOf(claim.tier) * MAX_PUSH + claim.quantity;
}

function majorityTier(tiers: readonly Tier[]): Tier {
  const counts = new Map<Tier, number>();
  for (const tier of tiers) counts.set(tier, (counts.get(tier) ?? 0) + 1);
  let best = tiers[0];
  let bestCount = 0;
  for (const [tier, count] of counts) {
    if (count > bestCount) {
      best = tier;
      bestCount = count;
    }
  }
  return best;
}

function playerName(state: GameState, seat: number): string {
  return state.players[seat].name;
}

function logEntryText(state: GameState, entry: LogEntry, appliedDamage?: number): string {
  switch (entry.kind) {
    case "round-start":
      return `Round ${entry.round} — ${playerName(state, entry.opener)} opens.`;
    case "push":
      return `${playerName(state, entry.by)} pushed ${entry.quantity} · claims ${tierLabel(entry.tier)}.`;
    case "resolution": {
      const resolution = entry.resolution;
      const verdict = resolution.claimWasTrue ? "it was true" : "it was a lie";
      const drinkerName = playerName(state, resolution.drinker);
      const blackout = resolution.eliminated !== null ? ` ${drinkerName} blacks out!` : "";
      return `${playerName(state, resolution.challenger)} doubted ${playerName(state, resolution.accused)} — ${verdict}. ${drinkerName} drinks the pot: +${appliedDamage ?? resolution.damage}%.${blackout}`;
    }
    case "game-over":
      return entry.outcome === "won" ? "You're the last one standing." : "You black out under the table.";
  }
}

function buildGlassArt(doc: Document, tier: Tier | null): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "glass-art");
  svg.setAttribute("viewBox", "0 0 24 32");
  svg.setAttribute("aria-hidden", "true");

  const outline = doc.createElementNS(SVG_NS, "path");
  outline.setAttribute("d", "M4 2 L20 2 L17 28 L7 28 Z");
  outline.setAttribute("fill", "none");
  outline.setAttribute("stroke", "currentColor");
  outline.setAttribute("stroke-width", "2");
  svg.appendChild(outline);

  if (tier) {
    const liquid = doc.createElementNS(SVG_NS, "path");
    liquid.setAttribute("class", "glass-liquid");
    liquid.setAttribute("d", "M6.5 14 L17.5 14 L17 28 L7 28 Z");
    svg.appendChild(liquid);
  }

  return svg;
}

function buildGlassButton(doc: Document, index: number, tier: Tier, pressed: boolean, disabled: boolean): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "glass";
  button.dataset.tier = tier;
  button.dataset.index = String(index);
  button.setAttribute("aria-pressed", String(pressed));
  button.disabled = disabled;
  button.appendChild(buildGlassArt(doc, tier));
  const label = doc.createElement("span");
  label.className = "glass-label";
  label.textContent = tierLabel(tier);
  button.appendChild(label);
  const pips = doc.createElement("span");
  pips.className = "glass-pips";
  pips.setAttribute("aria-hidden", "true");
  pips.textContent = "●".repeat(TIER_ORDER.indexOf(tier) + 1);
  button.appendChild(pips);
  return button;
}

function buildGlassDisplay(doc: Document, tier: Tier | null): HTMLDivElement {
  const div = doc.createElement("div");
  div.className = tier ? "glass" : "glass glass-facedown";
  if (tier) div.dataset.tier = tier;
  div.appendChild(buildGlassArt(doc, tier));
  if (tier) {
    const label = doc.createElement("span");
    label.className = "glass-label";
    label.textContent = tierLabel(tier);
    div.appendChild(label);
  }
  return div;
}

export function mountGame(doc: Document, options: MountOptions = {}): GameHandle {
  for (const id of REQUIRED_IDS) requireElement(doc, id);

  const autoplay = options.autoplay ?? true;
  const botDelayMs = options.botDelayMs ?? 900;
  const revealHoldMs = options.revealHoldMs ?? 1600;

  const refs = {
    body: doc.body,
    table: requireElement<HTMLElement>(doc, "table"),
    opponents: requireElement<HTMLElement>(doc, "opponents"),
    potStack: requireElement<HTMLElement>(doc, "pot-stack"),
    bidMeter: requireElement<HTMLElement>(doc, "bid-meter"),
    yourFlight: requireElement<HTMLElement>(doc, "your-flight"),
    intoxMeter: requireElement<HTMLElement>(doc, "intox-meter"),
    claim: requireElement<HTMLElement>(doc, "claim"),
    push: requireElement<HTMLButtonElement>(doc, "push"),
    doubt: requireElement<HTMLButtonElement>(doc, "doubt"),
    feed: requireElement<HTMLElement>(doc, "feed"),
    outcome: requireElement<HTMLElement>(doc, "outcome"),
    again: requireElement<HTMLButtonElement>(doc, "again"),
  };

  let state = createGame({ seed: options.seed });
  let botSeed = state.seed * 2654435761;
  let renderedLogCount = 0;
  let lastIntoxication = state.players.map((p) => p.intoxication);
  let selection: number[] = [];
  let selectedTier: Tier | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let destroyed = false;

  const AbortControllerImpl = doc.defaultView?.AbortController ?? AbortController;
  const controller = new AbortControllerImpl();

  function schedule(fn: () => void, delay: number): void {
    if (!autoplay) return;
    const handle = setTimeout(() => {
      if (destroyed) return;
      fn();
    }, delay);
    timers.push(handle);
  }

  function clearTimers(): void {
    for (const handle of timers) clearTimeout(handle);
    timers = [];
  }

  function renderOpponents(): void {
    refs.opponents.innerHTML = "";
    for (const player of state.players) {
      if (player.seat === HUMAN_SEAT) continue;

      const seatEl = doc.createElement("div");
      seatEl.className = player.out ? "seat seat-out" : "seat";
      seatEl.dataset.seat = String(player.seat);

      const name = doc.createElement("div");
      name.className = "seat-name";
      name.textContent = player.out ? `${player.name} (out)` : player.name;
      seatEl.appendChild(name);

      const meter = doc.createElement("div");
      meter.className = "meter";
      meter.setAttribute("role", "meter");
      meter.setAttribute("aria-label", `${player.name}'s intoxication`);
      meter.setAttribute("aria-valuemin", "0");
      meter.setAttribute("aria-valuemax", String(MAX_INTOXICATION));
      meter.setAttribute("aria-valuenow", String(player.intoxication));
      meter.setAttribute("aria-valuetext", player.out ? "Blacked out" : `${player.intoxication} of ${MAX_INTOXICATION}`);
      const fill = doc.createElement("div");
      fill.className = "meter-fill";
      fill.style.width = `${player.intoxication}%`;
      meter.appendChild(fill);
      seatEl.appendChild(meter);

      refs.opponents.appendChild(seatEl);
    }
  }

  function renderPot(): void {
    refs.potStack.innerHTML = "";
    const revealed = state.phase !== "playing";

    for (const entry of state.pot) {
      const group = doc.createElement("div");
      group.className = "pot-group";

      const label = doc.createElement("div");
      label.className = "pot-group-label";
      label.textContent = `${playerName(state, entry.by)} · ${claimText(entry.claimed)}`;
      group.appendChild(label);

      const row = doc.createElement("div");
      row.className = "pot-group-glasses";
      const shown: (Tier | null)[] = revealed ? entry.actual : new Array(entry.claimed.quantity).fill(null);
      for (const tier of shown) row.appendChild(buildGlassDisplay(doc, tier));
      group.appendChild(row);

      refs.potStack.appendChild(group);
    }

    const bid = currentBid(state);
    if (!bid) {
      refs.bidMeter.setAttribute("aria-valuenow", "0");
      refs.bidMeter.setAttribute("aria-valuetext", "No bid yet");
    } else {
      const lastEntry = state.pot[state.pot.length - 1];
      refs.bidMeter.setAttribute("aria-valuenow", String(bidRank(bid)));
      refs.bidMeter.setAttribute("aria-valuetext", `${playerName(state, lastEntry.by)} claims ${claimText(bid)}`);
    }
  }

  function renderYou(): void {
    refs.yourFlight.innerHTML = "";
    const human = state.players[HUMAN_SEAT];
    const isHumanTurn = state.turn === HUMAN_SEAT && state.phase === "playing";

    human.flight.forEach((tier, index) => {
      refs.yourFlight.appendChild(buildGlassButton(doc, index, tier, selection.includes(index), !isHumanTurn));
    });

    const pct = human.intoxication;
    refs.intoxMeter.setAttribute("aria-valuenow", String(pct));
    refs.intoxMeter.setAttribute("aria-valuetext", `${pct} of ${MAX_INTOXICATION}`);
    let fill = refs.intoxMeter.querySelector<HTMLElement>(".meter-fill");
    if (!fill) {
      fill = doc.createElement("div");
      fill.className = "meter-fill";
      refs.intoxMeter.appendChild(fill);
    }
    fill.style.width = `${pct}%`;

    refs.table.style.setProperty("--intox", String(pct / MAX_INTOXICATION));
  }

  function renderClaimEditor(): void {
    const isHumanTurn = state.turn === HUMAN_SEAT && state.phase === "playing";
    const showClaim = isHumanTurn && selection.length > 0;
    refs.claim.hidden = !showClaim;
    refs.claim.innerHTML = "";
    if (!showClaim) return;

    if (!selectedTier) {
      const human = state.players[HUMAN_SEAT];
      selectedTier = majorityTier(selection.map((index) => human.flight[index]));
    }

    const summary = doc.createElement("span");
    summary.className = "claim-summary";
    summary.textContent = `${selection.length} shot${selection.length > 1 ? "s" : ""} · claim:`;
    refs.claim.appendChild(summary);

    for (const tier of TIER_ORDER) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "tier-choice";
      button.dataset.tier = tier;
      button.dataset.action = "choose-tier";
      button.style.setProperty("--tier-color", `var(--tier-${tier})`);
      button.setAttribute("aria-pressed", String(tier === selectedTier));
      button.textContent = tierLabel(tier);
      refs.claim.appendChild(button);
    }
  }

  function renderActions(): void {
    const isHumanTurn = state.turn === HUMAN_SEAT && state.phase === "playing";
    const moves = legalMoves(state);

    refs.push.hidden = !isHumanTurn;
    const claim: Claim | null = selectedTier && selection.length > 0 ? { quantity: selection.length, tier: selectedTier } : null;
    refs.push.disabled = !isHumanTurn || !claim || !beatsBid(claim, currentBid(state));

    refs.doubt.hidden = !(isHumanTurn && moves.canDoubt);
    if (!refs.doubt.hidden) {
      const bid = currentBid(state);
      const lastEntry = state.pot[state.pot.length - 1];
      refs.doubt.textContent = bid ? `Doubt — ${playerName(state, lastEntry.by)} claims ${claimText(bid)}` : "Doubt";
    }
  }

  function renderFeed(): void {
    while (renderedLogCount < state.log.length) {
      const entry = state.log[renderedLogCount];
      let appliedDamage: number | undefined;
      if (entry.kind === "resolution") {
        const drinker = entry.resolution.drinker;
        appliedDamage = state.players[drinker].intoxication - lastIntoxication[drinker];
        lastIntoxication[drinker] = state.players[drinker].intoxication;
      }
      const line = doc.createElement("div");
      line.className = "feed-line";
      line.textContent = logEntryText(state, entry, appliedDamage);
      refs.feed.appendChild(line);
      renderedLogCount++;
    }
    refs.feed.scrollTop = refs.feed.scrollHeight;
  }

  function renderOutcome(): void {
    if (state.phase === "over" && state.outcome) {
      refs.outcome.textContent = state.outcome === "won" ? "Last player standing — you win." : "You black out under the table.";
      refs.again.hidden = false;
      refs.again.focus();
    } else {
      refs.outcome.textContent = "";
      refs.again.hidden = true;
    }
  }

  function render(): void {
    refs.body.dataset.gameState = state.phase === "over" ? (state.outcome ?? "over") : "playing";
    renderOpponents();
    renderPot();
    renderYou();
    renderClaimEditor();
    renderActions();
    renderFeed();
    renderOutcome();
  }

  function afterStateChange(): void {
    render();
    if (destroyed || state.phase === "over") return;

    if (state.phase === "reveal") {
      schedule(() => {
        state = continueAfterReveal(state);
        afterStateChange();
      }, revealHoldMs);
      return;
    }

    if (currentPlayer(state).kind === "bot") {
      schedule(() => {
        const [move, nextSeed] = chooseBotMove(state, state.turn, botSeed);
        botSeed = nextSeed;
        state = applyMove(state, move);
        afterStateChange();
      }, botDelayMs);
    }
  }

  refs.yourFlight.addEventListener(
    "click",
    (event) => {
      const target = (event.target as HTMLElement | null)?.closest(".glass[data-index]") as HTMLButtonElement | null;
      if (!target || target.disabled) return;
      const index = Number(target.dataset.index);
      if (selection.includes(index)) {
        selection = selection.filter((i) => i !== index);
      } else if (selection.length < MAX_PUSH) {
        selection = [...selection, index];
      } else {
        return;
      }
      selectedTier = selection.length > 0 ? majorityTier(selection.map((i) => state.players[HUMAN_SEAT].flight[i])) : null;
      render();
    },
    { signal: controller.signal },
  );

  refs.claim.addEventListener(
    "click",
    (event) => {
      const target = (event.target as HTMLElement | null)?.closest('[data-action="choose-tier"]') as HTMLButtonElement | null;
      if (!target) return;
      selectedTier = target.dataset.tier as Tier;
      render();
    },
    { signal: controller.signal },
  );

  refs.push.addEventListener(
    "click",
    () => {
      if (refs.push.disabled || !selectedTier) return;
      const claimed: Claim = { quantity: selection.length, tier: selectedTier };
      state = applyMove(state, { kind: "push", shots: [...selection], claimed });
      selection = [];
      selectedTier = null;
      afterStateChange();
    },
    { signal: controller.signal },
  );

  refs.doubt.addEventListener(
    "click",
    () => {
      if (refs.doubt.hidden) return;
      state = applyMove(state, { kind: "doubt" });
      afterStateChange();
    },
    { signal: controller.signal },
  );

  refs.again.addEventListener(
    "click",
    () => {
      clearTimers();
      state = createGame({ seed: Math.floor(Math.random() * 1_000_000) });
      botSeed = state.seed * 2654435761;
      renderedLogCount = 0;
      lastIntoxication = state.players.map((p) => p.intoxication);
      refs.feed.innerHTML = "";
      selection = [];
      selectedTier = null;
      afterStateChange();
    },
    { signal: controller.signal },
  );

  afterStateChange();

  return {
    step(): boolean {
      if (state.phase === "over") return false;
      if (state.phase === "reveal") {
        state = continueAfterReveal(state);
      } else {
        const [move, nextSeed] = chooseBotMove(state, state.turn, botSeed);
        botSeed = nextSeed;
        state = applyMove(state, move);
      }
      render();
      return true;
    },
    destroy(): void {
      destroyed = true;
      clearTimers();
      controller.abort();
    },
  };
}
