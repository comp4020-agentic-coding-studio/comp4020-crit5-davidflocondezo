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

// TODO once the game mechanic is settled: assert play can be lost and reaches
// an ending. This needs a DOM contract for "the game has ended" that doesn't
// presume the mechanic — e.g. a data attribute or aria-live region set when
// play ends. Decide the contract, then replace this stub.
describe.todo("spec: it can be lost, and play ends somewhere");
