import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Contract tests for this week's spec (crit 5, "A game"):
// https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/05-game/
//
// These answer the mechanically-checkable spec lines. The rest — five-minute
// pickup-ability, whether the opening screen actually invites the first move,
// and the one focused test on a game rule plus a playtesting-driven change —
// are judged at the crit, not here.
const DIST = resolve("dist");

function files(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const pages = files()
  .map((path) => relative(DIST, path).split(sep).join("/"))
  .filter((name) => name.endsWith(".html"))
  .map((name) => ({
    name,
    doc: new JSDOM(readFileSync(join(DIST, name), "utf8")).window.document,
  }));

const FORBIDDEN_PHRASES = [
  "how to play",
  "instructions",
  "tutorial",
  "click here to start",
];

describe("spec: no instructions anywhere, on screen or off", () => {
  for (const { name, doc } of pages) {
    it(`${name} ships no how-to-play text`, () => {
      const text = doc.body.textContent?.toLowerCase() ?? "";
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(text, `found forbidden instructional phrase "${phrase}"`).not.toContain(phrase);
      }
    });

    it(`${name} has no modal/dialog standing in for a how-to-play screen`, () => {
      expect(doc.querySelector('dialog, [role="dialog"]')).toBeNull();
    });
  }
});

function freshHome() {
  return new JSDOM(readFileSync(join(DIST, "index.html"), "utf8")).window.document;
}

describe("spec: it can be lost, and play ends somewhere", () => {
  it("ships the ended-state contract in the built page", () => {
    const doc = freshHome();
    expect(doc.body.dataset.gameState).toBe("playing");
    expect(doc.querySelector("#outcome")?.getAttribute("role")).toBe("status");
    expect(doc.querySelector("#again")?.hasAttribute("hidden")).toBe(true);
    expect(doc.querySelector("dialog, [role='dialog']")).toBeNull();
  });

  it("reaches an ending from every seed, and can be lost as well as won", async () => {
    const { mountGame } = await import("../src/scripts/game/view.ts");
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const doc = freshHome();
      const game = mountGame(doc, { seed, autoplay: false });
      let ticks = 0;
      while (game.step()) expect(ticks++, `seed ${seed} did not end`).toBeLessThan(2000);
      const ended = doc.body.dataset.gameState;
      expect(ended, `seed ${seed}`).toMatch(/^(won|lost)$/);
      expect(doc.querySelector("#outcome")?.textContent?.trim()).not.toBe("");
      outcomes.add(ended!);
      game.destroy();
    }
    expect(outcomes, "a wrong move must be able to lose it").toContain("lost");
    expect(outcomes, "and an ending must be reachable in the player's favour").toContain("won");
  });
});
