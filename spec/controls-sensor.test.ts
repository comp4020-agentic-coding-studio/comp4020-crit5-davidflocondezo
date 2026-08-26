import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Sensor (harness, carries forward): every interactive control must be a real
// <button>/<a>/<input>, not a div/span wearing role="button" or an onclick
// handler, and every real button must have an accessible name. Runs against
// the static built page AND against a live-mounted game, since this app's
// controls are built by client-side JS and a static-only check would miss
// them entirely — see CLAUDE.md's "mount the source module" pattern.
const DIST = resolve("dist");

function fakeButtonSelectors() {
  return '[role="button"]:not(button), [onclick]:not(button):not(a):not(input)';
}

function assertNoFakeButtons(doc: Document, label: string) {
  const fakes = doc.querySelectorAll(fakeButtonSelectors());
  expect(fakes.length, `${label}: found ${fakes.length} div/span standing in for a real control`).toBe(0);
}

function assertEveryButtonNamed(doc: Document, label: string) {
  for (const button of doc.querySelectorAll("button")) {
    const accessibleName = button.getAttribute("aria-label")?.trim() || button.textContent?.trim() || "";
    expect(accessibleName, `${label}: button ${button.outerHTML.slice(0, 80)} has no accessible name`).not.toBe("");
  }
}

describe("sensor: every control is a real element with an accessible name", () => {
  it("holds for the built static page", () => {
    const doc = new JSDOM(readFileSync(join(DIST, "index.html"), "utf8")).window.document;
    assertNoFakeButtons(doc, "static page");
    assertEveryButtonNamed(doc, "static page");
  });

  it("holds once the game is mounted and played", async () => {
    const { mountGame } = await import("../src/scripts/game/view.ts");
    const doc = new JSDOM(readFileSync(join(DIST, "index.html"), "utf8")).window.document;
    const game = mountGame(doc, { seed: 7, autoplay: false });
    let ticks = 0;
    while (game.step() && ticks < 50) {
      assertNoFakeButtons(doc, `mounted game, tick ${ticks}`);
      assertEveryButtonNamed(doc, `mounted game, tick ${ticks}`);
      ticks++;
    }
    game.destroy();
  });
});
