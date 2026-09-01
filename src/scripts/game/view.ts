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
  "player-gauge",
  "opponents",
  "table-scene",
  "table-edge-shots",
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

function worstTier(tiers: readonly Tier[]): Tier {
  let worst = tiers[0];
  for (const tier of tiers) {
    if (TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(worst)) worst = tier;
  }
  return worst;
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

// The shared gradient <defs> that every 3D glass's rim/body reference via
// url(#glass-rim-grad)/url(#glass-body-grad) --- appended once per document
// (ported from the artifact sketch's dedup pattern) rather than duplicated
// inline in every glass, which is what let Chromium's SVG-in-3D-transform
// paint bug reproduce in the first place.
function ensureGlassDefs(doc: Document): void {
  if (doc.getElementById("glass-defs")) return;

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("id", "glass-defs");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";

  const defs = doc.createElementNS(SVG_NS, "defs");

  const rimGrad = doc.createElementNS(SVG_NS, "radialGradient");
  rimGrad.setAttribute("id", "glass-rim-grad");
  rimGrad.setAttribute("cx", "38%");
  rimGrad.setAttribute("cy", "30%");
  rimGrad.setAttribute("r", "75%");
  for (const [offset, color] of [
    ["0%", "rgba(255,255,255,0.95)"],
    ["35%", "rgba(255,255,255,0.35)"],
    ["78%", "rgba(10,10,10,0.55)"],
    ["100%", "rgba(10,10,10,0.7)"],
  ]) {
    const stop = doc.createElementNS(SVG_NS, "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", color);
    rimGrad.appendChild(stop);
  }
  defs.appendChild(rimGrad);

  const bodyGrad = doc.createElementNS(SVG_NS, "linearGradient");
  bodyGrad.setAttribute("id", "glass-body-grad");
  bodyGrad.setAttribute("x1", "0%");
  bodyGrad.setAttribute("y1", "0%");
  bodyGrad.setAttribute("x2", "100%");
  bodyGrad.setAttribute("y2", "25%");
  for (const [offset, color] of [
    ["0%", "rgba(0,0,0,0.32)"],
    ["22%", "rgba(255,255,255,0.5)"],
    ["40%", "rgba(255,255,255,0.06)"],
    ["65%", "rgba(0,0,0,0.18)"],
    ["100%", "rgba(0,0,0,0.5)"],
  ]) {
    const stop = doc.createElementNS(SVG_NS, "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", color);
    bodyGrad.appendChild(stop);
  }
  defs.appendChild(bodyGrad);

  svg.appendChild(defs);
  doc.body.appendChild(svg);
}

// The pseudo-3d shot glass: a rim ellipse + tapered body path, both filled
// via the shared gradients above, plus an optional liquid path when a tier
// is known. Used for the HUD flight list, the table-edge shots, the pot
// (face-down when tier is null), and the flying push animation.
//
// There are only 6 distinct shapes (5 tiers + face-down), and this is
// rebuilt on nearly every render, so cache one template per shape per
// document and clone it --- far cheaper in jsdom than re-running every
// createElementNS/setAttribute call each time.
const glassTemplateCache = new WeakMap<Document, Map<string, SVGSVGElement>>();

function buildGlass3dSvg(doc: Document, tier: Tier | null): SVGSVGElement {
  let cache = glassTemplateCache.get(doc);
  if (!cache) {
    cache = new Map();
    glassTemplateCache.set(doc, cache);
  }
  const key = tier ?? "";
  let template = cache.get(key);
  if (!template) {
    template = buildGlass3dSvgTemplate(doc, tier);
    cache.set(key, template);
  }
  return template.cloneNode(true) as SVGSVGElement;
}

function buildGlass3dSvgTemplate(doc: Document, tier: Tier | null): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "glass3d-svg");
  svg.setAttribute("viewBox", "0 0 40 112");
  svg.setAttribute("aria-hidden", "true");

  const shadow = doc.createElementNS(SVG_NS, "ellipse");
  shadow.setAttribute("cx", "20");
  shadow.setAttribute("cy", "105");
  shadow.setAttribute("rx", "14");
  shadow.setAttribute("ry", "4");
  shadow.setAttribute("fill", "rgba(0,0,0,0.5)");
  svg.appendChild(shadow);

  const rim = doc.createElementNS(SVG_NS, "ellipse");
  rim.setAttribute("cx", "20");
  rim.setAttribute("cy", "20");
  rim.setAttribute("rx", "17");
  rim.setAttribute("ry", "10");
  rim.setAttribute("fill", "url(#glass-rim-grad)");
  rim.setAttribute("stroke", "rgba(255,255,255,0.55)");
  rim.setAttribute("stroke-width", "1.5");
  svg.appendChild(rim);

  const body = doc.createElementNS(SVG_NS, "path");
  body.setAttribute("d", "M6,20 L34,20 L28,100 L12,100 Z");
  body.setAttribute("fill", "url(#glass-body-grad)");
  body.setAttribute("stroke", "rgba(255,255,255,0.32)");
  body.setAttribute("stroke-width", "1.5");
  svg.appendChild(body);

  // The liquid area is reserved even face-down (tier === null) --- it's an
  // invisible anchor for the .pot-liquid-overlay workaround below either
  // way (Chromium won't paint a fill nested this deep in the rotateX
  // chain), so a face-down glass can get its own "pending" outline overlay
  // at the exact size/position the real colored one will occupy on reveal,
  // instead of looking like a smaller, emptier glass until then.
  const liquid = doc.createElementNS(SVG_NS, "path");
  liquid.setAttribute("class", "glass3d-liquid");
  liquid.setAttribute("d", "M8.9,58 L31.1,58 L28,100 L12,100 Z");
  liquid.style.fill = tier ? `var(--tier-${tier})` : "none";
  svg.appendChild(liquid);

  return svg;
}

function tallLiquidPath(fraction: number): string {
  const topY = 2;
  const bottomY = 92;
  const topLeftX = 4;
  const topRightX = 20;
  const bottomLeftX = 7;
  const bottomRightX = 17;
  const fillTopY = bottomY - fraction * (bottomY - topY);
  const t = 1 - fraction;
  const leftX = topLeftX + t * (bottomLeftX - topLeftX);
  const rightX = topRightX + t * (bottomRightX - topRightX);
  return `M${leftX} ${fillTopY} L${rightX} ${fillTopY} L${bottomRightX} ${bottomY} L${bottomLeftX} ${bottomY} Z`;
}

function buildIntoxTube(doc: Document, pct: number): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "intox-tube-art");
  svg.setAttribute("viewBox", "0 0 24 96");
  svg.setAttribute("aria-hidden", "true");

  const outline = doc.createElementNS(SVG_NS, "path");
  outline.setAttribute("d", "M4 2 L20 2 L17 92 L7 92 Z");
  outline.setAttribute("fill", "none");
  outline.setAttribute("stroke", "currentColor");
  outline.setAttribute("stroke-width", "2");
  svg.appendChild(outline);

  const fraction = Math.max(0, Math.min(1, pct / MAX_INTOXICATION));
  if (fraction > 0) {
    const liquid = doc.createElementNS(SVG_NS, "path");
    liquid.setAttribute("class", "intox-tube-liquid");
    liquid.setAttribute("d", tallLiquidPath(fraction));
    svg.appendChild(liquid);
  }

  return svg;
}

function buildGlassButton(doc: Document, index: number, tier: Tier, pressed: boolean, disabled: boolean): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "glass hud-glass";
  button.dataset.tier = tier;
  button.dataset.index = String(index);
  button.setAttribute("aria-pressed", String(pressed));
  button.disabled = disabled;
  button.appendChild(buildGlass3dSvg(doc, tier));
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

// A real, clickable duplicate of the HUD flight glass standing on the table
// edge --- kept out of the tab order and hidden from assistive tech (the HUD
// list is the sole accessible interface for the same action) since exposing
// both would read as two controls for one action. Still carries a non-empty
// aria-label so it never trips spec/controls-sensor.test.ts, which checks
// every <button> has an accessible name regardless of aria-hidden.
function buildEdgeShot(doc: Document, index: number, total: number, tier: Tier, pressed: boolean, disabled: boolean): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "edge-shot";
  button.dataset.tier = tier;
  button.dataset.index = String(index);
  button.setAttribute("aria-pressed", String(pressed));
  button.setAttribute("aria-hidden", "true");
  button.tabIndex = -1;
  button.setAttribute("aria-label", `${tierLabel(tier)} shot`);
  button.disabled = disabled;
  // human.flight shrinks over a round (pushed shots leave it), so the spread
  // is computed from however many are actually left rather than pinned to
  // fixed CSS nth-of-type slots sized for a fixed demo count.
  const left = total > 1 ? 10 + index * (80 / (total - 1)) : 50;
  button.style.left = `${left}%`;
  button.appendChild(buildGlass3dSvg(doc, tier));
  return button;
}

function buildPotShot(doc: Document, tier: Tier | null, isHistory: boolean, entryIndex: number): HTMLSpanElement {
  const span = doc.createElement("span");
  span.className = isHistory ? "pot-shot pot-shot--history" : "pot-shot";
  span.dataset.potIndex = String(entryIndex);
  if (tier) span.dataset.tier = tier;
  span.appendChild(buildGlass3dSvg(doc, tier));
  return span;
}

export function mountGame(doc: Document, options: MountOptions = {}): GameHandle {
  for (const id of REQUIRED_IDS) requireElement(doc, id);
  ensureGlassDefs(doc);

  const autoplay = options.autoplay ?? true;
  const botDelayMs = options.botDelayMs ?? 900;
  const revealHoldMs = options.revealHoldMs ?? 2400;

  const refs = {
    body: doc.body,
    table: requireElement<HTMLElement>(doc, "table"),
    playerGauge: requireElement<HTMLElement>(doc, "player-gauge"),
    opponents: requireElement<HTMLElement>(doc, "opponents"),
    scene: requireElement<HTMLElement>(doc, "table-scene"),
    pot: requireElement<HTMLElement>(doc, "pot"),
    potStack: requireElement<HTMLElement>(doc, "pot-stack"),
    edgeShots: requireElement<HTMLElement>(doc, "table-edge-shots"),
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
  let humanLastDrinkTier: Tier | null = null;
  let selection: number[] = [];
  let selectedTier: Tier | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let destroyed = false;
  let potLiquidOverlays: { overlay: HTMLElement; source: SVGPathElement }[] = [];
  let renderedPotEntries = 0;
  let renderedPotRevealed = false;
  let renderedFlightTiers = "";
  let renderedEdgeShotTiers = "";
  let renderedGaugeKey = "";
  const opponentSeatRefs = new Map<number, { seatEl: HTMLElement; nameEl: HTMLElement; meter: HTMLElement; fill: HTMLElement }>();
  let potHintRemoved = false;
  let potShotEls: HTMLElement[] = [];
  let cachedFlightButtons: HTMLButtonElement[] = [];
  let cachedEdgeShotButtons: HTMLButtonElement[] = [];
  let cachedIntoxFill: HTMLElement | null = null;

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

  // Chromium fails to paint an SVG <path> fill when it's nested inside the
  // rotateX(88deg)/rotateX(-88deg) transform chain that makes the table read
  // as a tilted surface --- so the liquid color is painted by a plain
  // position:fixed div, clipped to the same trapezoid and kept aligned to
  // the real (invisible) liquid path's screen position instead.
  function clearPotLiquidOverlays(): void {
    for (const { overlay } of potLiquidOverlays) overlay.remove();
    potLiquidOverlays = [];
  }

  function positionPotLiquidOverlay(entry: { overlay: HTMLElement; source: SVGPathElement }): void {
    const rect = entry.source.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    entry.overlay.style.left = `${rect.left}px`;
    entry.overlay.style.top = `${rect.top}px`;
    entry.overlay.style.width = `${rect.width}px`;
    entry.overlay.style.height = `${rect.height}px`;
  }

  function repositionPotLiquidOverlays(): void {
    for (const entry of potLiquidOverlays) positionPotLiquidOverlay(entry);
  }

  function paintPotLiquid(liquidPath: SVGPathElement, tier: Tier): void {
    const overlay = doc.createElement("div");
    overlay.className = "pot-liquid-overlay";
    overlay.style.background = `var(--tier-${tier})`;
    doc.body.appendChild(overlay);
    const entry = { overlay, source: liquidPath };
    potLiquidOverlays.push(entry);
    positionPotLiquidOverlay(entry);
  }

  // Face-down glasses get a white outline over the same liquid area instead
  // of a color, so the glass already reads at its full "with liquid" size
  // and doesn't visibly grow the moment reveal swaps the outline for a fill.
  // This draws the outline as a stroked SVG polygon rather than a
  // bordered+clip-path div: a rectangular border clipped to the trapezoid
  // only keeps the border fragments that happen to fall inside the clip,
  // leaving a broken outline instead of one that hugs the trapezoid.
  function paintPotLiquidPending(liquidPath: SVGPathElement): void {
    const overlay = doc.createElement("div");
    overlay.className = "pot-liquid-overlay pot-liquid-overlay--pending";
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    const outline = doc.createElementNS(SVG_NS, "polygon");
    outline.setAttribute("points", "0,0 100,0 86,100 14,100");
    outline.setAttribute("fill", "none");
    outline.setAttribute("stroke", "rgba(255, 255, 255, 0.6)");
    outline.setAttribute("stroke-width", "6");
    outline.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(outline);
    overlay.appendChild(svg);
    doc.body.appendChild(overlay);
    const entry = { overlay, source: liquidPath };
    potLiquidOverlays.push(entry);
    positionPotLiquidOverlay(entry);
  }

  function removePotLiquidOverlay(source: SVGPathElement | null): void {
    if (!source) return;
    const index = potLiquidOverlays.findIndex((entry) => entry.source === source);
    if (index === -1) return;
    potLiquidOverlays[index].overlay.remove();
    potLiquidOverlays.splice(index, 1);
  }

  function renderOpponents(): void {
    // The seats themselves never change (fixed players/order) --- only their
    // intoxication/out status does, on almost every tick --- so build each
    // seat once, cache its refs (a querySelector per tick per seat adds up
    // across hundreds of ticks), and patch in place rather than rebuilding.
    for (const player of state.players) {
      if (player.seat === HUMAN_SEAT) continue;

      let cached = opponentSeatRefs.get(player.seat);
      if (!cached) {
        const seatEl = doc.createElement("div");
        seatEl.dataset.seat = String(player.seat);

        const nameEl = doc.createElement("div");
        nameEl.className = "seat-name";
        seatEl.appendChild(nameEl);

        const meter = doc.createElement("div");
        meter.className = "meter";
        meter.setAttribute("role", "meter");
        meter.setAttribute("aria-label", `${player.name}'s intoxication`);
        meter.setAttribute("aria-valuemin", "0");
        meter.setAttribute("aria-valuemax", String(MAX_INTOXICATION));
        const fill = doc.createElement("div");
        fill.className = "meter-fill";
        meter.appendChild(fill);
        seatEl.appendChild(meter);

        refs.opponents.appendChild(seatEl);
        cached = { seatEl, nameEl, meter, fill };
        opponentSeatRefs.set(player.seat, cached);
      }

      const { seatEl, nameEl, meter, fill } = cached;
      seatEl.className = player.out ? "seat seat-out" : "seat";
      nameEl.textContent = player.out ? `${player.name} (out)` : player.name;
      meter.setAttribute("aria-valuenow", String(player.intoxication));
      meter.setAttribute("aria-valuetext", player.out ? "Blacked out" : `${player.intoxication} of ${MAX_INTOXICATION}`);
      fill.style.width = `${player.intoxication}%`;
    }
  }

  function renderPot(): void {
    const revealed = state.phase !== "playing";

    // A new round always shrinks the pot back down --- that's the only time
    // a full rebuild is warranted (re-render on every tick otherwise would
    // make this O(pot size) per tick, and the pot grows across a round).
    if (state.pot.length < renderedPotEntries) {
      clearPotLiquidOverlays();
      refs.potStack.innerHTML = "";
      renderedPotEntries = 0;
      potHintRemoved = false;
      potShotEls = [];
      renderedPotRevealed = false;
    } else if (revealed && !renderedPotRevealed) {
      // The reveal flip (false -> true) never changes pot size --- repaint
      // each already-standing face-down shot's glass in place rather than
      // tearing down and rebuilding the whole stack a second time.
      const actualFlat = state.pot.slice(0, renderedPotEntries).flatMap((entry) => entry.actual);
      potShotEls.forEach((shot, i) => {
        const tier = actualFlat[i];
        if (!tier) return;
        shot.dataset.tier = tier;
        const oldSvg = shot.querySelector<SVGSVGElement>(".glass3d-svg");
        removePotLiquidOverlay(oldSvg?.querySelector<SVGPathElement>(".glass3d-liquid") ?? null);
        const newSvg = buildGlass3dSvg(doc, tier);
        if (oldSvg) shot.replaceChild(newSvg, oldSvg);
        else shot.appendChild(newSvg);
        const liquid = newSvg.querySelector<SVGPathElement>(".glass3d-liquid");
        if (liquid) paintPotLiquid(liquid, tier);
      });
      renderedPotRevealed = true;
    }

    if (state.pot.length === 0) {
      if (!potHintRemoved && !refs.potStack.querySelector(".pot-hint")) {
        const hint = doc.createElement("span");
        hint.className = "pot-hint";
        hint.textContent = "The pot";
        refs.potStack.appendChild(hint);
      }
    } else if (!potHintRemoved) {
      refs.potStack.querySelector(".pot-hint")?.remove();
      potHintRemoved = true;
    }

    // The previously-latest entry is no longer latest once a new one lands
    // --- demote its shots to the dimmer "history" look in place, rather
    // than rebuilding them.
    if (renderedPotEntries > 0 && renderedPotEntries < state.pot.length) {
      const prevLatestIndex = renderedPotEntries - 1;
      refs.potStack.querySelectorAll(`[data-pot-index="${prevLatestIndex}"]`).forEach((shot) => {
        shot.classList.add("pot-shot--history");
      });
    }

    const latestIndex = state.pot.length - 1;
    for (let index = renderedPotEntries; index < state.pot.length; index++) {
      const entry = state.pot[index];
      const isHistory = index !== latestIndex;
      const shown: (Tier | null)[] = revealed ? entry.actual : new Array(entry.claimed.quantity).fill(null);
      for (const tier of shown) {
        const shot = buildPotShot(doc, tier, isHistory, index);
        refs.potStack.appendChild(shot);
        potShotEls.push(shot);
        const liquid = shot.querySelector<SVGPathElement>(".glass3d-liquid");
        if (liquid) {
          if (revealed && tier) paintPotLiquid(liquid, tier);
          else if (!revealed) paintPotLiquidPending(liquid);
        }
      }
    }
    // A multi-shot push appends several glasses to the flex-centered pot row
    // in the same pass --- each new sibling re-centers the row, so an
    // overlay pinned to its source's rect right when it was created can go
    // stale before the row finishes growing. Repositioning once after the
    // whole pass settles corrects that for every overlay just added.
    repositionPotLiquidOverlays();
    renderedPotEntries = state.pot.length;
    renderedPotRevealed = revealed;

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
    const human = state.players[HUMAN_SEAT];
    const isHumanTurn = state.turn === HUMAN_SEAT && state.phase === "playing";

    // Whose turn it is (and the selection) changes almost every tick as play
    // rotates around the table, but the flight itself --- the expensive part,
    // a small SVG tree per glass --- only changes when the human actually
    // pushes. Rebuild the glasses only when the flight composition changes;
    // otherwise just patch the pressed/disabled state on the existing ones.
    const tiersKey = human.flight.join(",");
    if (tiersKey !== renderedFlightTiers) {
      renderedFlightTiers = tiersKey;
      refs.yourFlight.innerHTML = "";
      cachedFlightButtons = human.flight.map((tier, index) => {
        const button = buildGlassButton(doc, index, tier, selection.includes(index), !isHumanTurn);
        refs.yourFlight.appendChild(button);
        return button;
      });
    } else {
      cachedFlightButtons.forEach((button, index) => {
        button.disabled = !isHumanTurn;
        button.setAttribute("aria-pressed", String(selection.includes(index)));
      });
    }

    const pct = human.intoxication;
    refs.intoxMeter.setAttribute("aria-valuenow", String(pct));
    refs.intoxMeter.setAttribute("aria-valuetext", `${pct} of ${MAX_INTOXICATION}`);
    if (!cachedIntoxFill) {
      cachedIntoxFill = refs.intoxMeter.querySelector<HTMLElement>(".meter-fill");
      if (!cachedIntoxFill) {
        cachedIntoxFill = doc.createElement("div");
        cachedIntoxFill.className = "meter-fill";
        refs.intoxMeter.appendChild(cachedIntoxFill);
      }
    }
    cachedIntoxFill.style.width = `${pct}%`;

    refs.table.style.setProperty("--intox", String(pct / MAX_INTOXICATION));
  }

  function renderEdgeShots(): void {
    const human = state.players[HUMAN_SEAT];
    const isHumanTurn = state.turn === HUMAN_SEAT && state.phase === "playing";
    const total = human.flight.length;

    const tiersKey = human.flight.join(",");
    if (tiersKey === renderedEdgeShotTiers) {
      cachedEdgeShotButtons.forEach((button, index) => {
        button.disabled = !isHumanTurn;
        button.setAttribute("aria-pressed", String(selection.includes(index)));
      });
      return;
    }
    renderedEdgeShotTiers = tiersKey;

    refs.edgeShots.innerHTML = "";
    cachedEdgeShotButtons = human.flight.map((tier, index) => {
      const button = buildEdgeShot(doc, index, total, tier, selection.includes(index), !isHumanTurn);
      refs.edgeShots.appendChild(button);
      return button;
    });
  }

  function renderPlayerGauge(): void {
    const pct = state.players[HUMAN_SEAT].intoxication;
    const key = `${pct}|${humanLastDrinkTier ?? ""}`;
    if (key === renderedGaugeKey) return;
    renderedGaugeKey = key;

    refs.playerGauge.innerHTML = "";
    if (humanLastDrinkTier) {
      refs.playerGauge.dataset.tier = humanLastDrinkTier;
    } else {
      delete refs.playerGauge.dataset.tier;
    }
    refs.playerGauge.classList.toggle("player-gauge--danger", pct >= 80);
    refs.playerGauge.appendChild(buildIntoxTube(doc, pct));
    const label = doc.createElement("span");
    label.className = "player-gauge-pct";
    label.textContent = `${pct}%`;
    refs.playerGauge.appendChild(label);
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
        if (drinker === HUMAN_SEAT) {
          humanLastDrinkTier = worstTier(state.pot.flatMap((potEntry) => potEntry.actual));
        }
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
    renderEdgeShots();
    renderPlayerGauge();
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

  function toggleSelection(index: number): void {
    if (selection.includes(index)) {
      selection = selection.filter((i) => i !== index);
    } else if (selection.length < MAX_PUSH) {
      selection = [...selection, index];
    } else {
      return;
    }
    selectedTier = selection.length > 0 ? majorityTier(selection.map((i) => state.players[HUMAN_SEAT].flight[i])) : null;
    render();
  }

  // Decorative push animation: clones a glass into a position:fixed div that
  // transitions from the source glass's screen rect to the pot's, then
  // removes itself. Uses a CSS transition rather than Element.animate() so
  // prefers-reduced-motion is handled entirely by CSS (see .flying-shot in
  // styles.css) with no matchMedia call needed here.
  function flyToPot(sourceEl: Element, tier: Tier): void {
    const sourceRect = sourceEl.getBoundingClientRect();
    const potRect = refs.pot.getBoundingClientRect();

    const flying = doc.createElement("div");
    flying.className = "flying-shot";
    flying.style.left = `${sourceRect.left}px`;
    flying.style.top = `${sourceRect.top}px`;
    flying.style.width = `${sourceRect.width}px`;
    flying.style.height = `${sourceRect.height}px`;
    flying.appendChild(buildGlass3dSvg(doc, tier));
    doc.body.appendChild(flying);

    const deltaX = potRect.left + potRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
    const deltaY = potRect.top + potRect.height / 2 - (sourceRect.top + sourceRect.height / 2);

    const cleanup = () => flying.remove();
    flying.addEventListener("transitionend", cleanup, { once: true });
    timers.push(setTimeout(cleanup, 900));

    const view = doc.defaultView;
    const raf = view && typeof view.requestAnimationFrame === "function" ? view.requestAnimationFrame.bind(view) : (fn: () => void) => setTimeout(fn, 0);
    raf(() => {
      flying.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(0.7)`;
      flying.style.opacity = "0";
    });
  }

  function clearFlyingShots(): void {
    for (const el of doc.querySelectorAll(".flying-shot")) el.remove();
  }

  function triggerShake(): void {
    refs.scene.classList.remove("shake");
    void refs.scene.offsetWidth;
    refs.scene.classList.add("shake");
  }

  refs.yourFlight.addEventListener(
    "click",
    (event) => {
      const target = (event.target as HTMLElement | null)?.closest(".glass[data-index]") as HTMLButtonElement | null;
      if (!target || target.disabled) return;
      toggleSelection(Number(target.dataset.index));
    },
    { signal: controller.signal },
  );

  refs.edgeShots.addEventListener(
    "click",
    (event) => {
      const target = (event.target as HTMLElement | null)?.closest(".edge-shot[data-index]") as HTMLButtonElement | null;
      if (!target || target.disabled) return;
      toggleSelection(Number(target.dataset.index));
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
      for (const index of selection) {
        const edgeShot = refs.edgeShots.querySelector(`[data-index="${index}"]`);
        if (edgeShot) flyToPot(edgeShot, selectedTier);
      }
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
      triggerShake();
      state = applyMove(state, { kind: "doubt" });
      afterStateChange();
    },
    { signal: controller.signal },
  );

  refs.again.addEventListener(
    "click",
    () => {
      clearTimers();
      clearFlyingShots();
      state = createGame({ seed: Math.floor(Math.random() * 1_000_000) });
      botSeed = state.seed * 2654435761;
      renderedLogCount = 0;
      lastIntoxication = state.players.map((p) => p.intoxication);
      humanLastDrinkTier = null;
      refs.feed.innerHTML = "";
      selection = [];
      selectedTier = null;
      afterStateChange();
    },
    { signal: controller.signal },
  );

  const view = doc.defaultView;
  if (view && typeof view.addEventListener === "function") {
    view.addEventListener("resize", () => repositionPotLiquidOverlays(), { signal: controller.signal });
  }

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
      clearFlyingShots();
      clearPotLiquidOverlays();
      controller.abort();
    },
  };
}
