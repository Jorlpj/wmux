// Run-334 probe (not for upstream): #2284 head 8defe9055 vs our 2.1.299 captures, the run-332 idle-row case,
// and the phrase drawn with cell skips (CSI n C) inside it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ClaudeTitleTurnEdge, sanitizeTitle } from '../titleDetect';

const DIR = 'C:/Users/Lontra/WMIXU/docs/issues-investigation/issue-2264-capture/';
const OSC_TITLE = new RegExp('\\u001b\\](0|2);([^\\u0007\\u001b]*)(?:\\u0007|\\u001b\\\\)', 'g');

function replay(name: string) {
  const cap = JSON.parse(readFileSync(DIR + name, 'utf8'));
  const esc = cap.events.find((e: { what: string }) => e.what === 'ESC').t as number;
  const edge = new ClaudeTitleTurnEdge();
  const titles: { t: number; title: string; edge: boolean }[] = [];
  for (const c of cap.chunks as { t: number; d: string }[]) {
    edge.noteOutput(c.d);
    for (const m of c.d.matchAll(OSC_TITLE)) {
      const title = sanitizeTitle(m[2]);
      titles.push({ t: c.t, title, edge: edge.observe(title) });
    }
  }
  return { esc, titles };
}

describe('#2284 8defe9055 vs our 2.1.299 captures (run 334)', () => {
  for (const name of ['think-esc-1500.json', 'think-esc-2800.json', 'think-esc-4000.json']) {
    it(name, () => {
      const { esc, titles } = replay(name);
      const inWindow = titles.filter((x) => x.edge && x.t >= esc && x.t < esc + 3000);
      console.log(name, JSON.stringify(titles.map((x) => `${x.t - esc}:${x.edge ? 'E ' : ''}${x.title}`)));
      expect(inWindow.length).toBeGreaterThanOrEqual(1);
    });
  }
});

describe('Stop-hook mark (run 334)', () => {
  it('a persistent Stop hook transcript row redrawn while idle no longer holds the mark', () => {
    const edge = new ClaudeTitleTurnEdge();
    edge.observe('◐ task');
    edge.observe('✳ task');
    edge.noteOutput('  ⎿  Stop hook error: Failed with non-blocking status code');
    edge.noteOutput('  ⎿  Stop hook feedback: keep going');
    edge.observe('◐ next');
    console.log('idle-row case -> edge on next interrupt:', edge.observe('✳ next'));
  });

  for (const [label, row] of [
    ['plain spaces (PR frame)', '\u001b[38;2;153;153;153m\u001b[2Crunning Stop hook · 3s · \u001b[m'],
    ['skipped spaces', '\u001b[38;2;153;153;153m\u001b[2Crunning\u001b[1CStop\u001b[1Chook\u001b[1C·\u001b[1C3s\u001b[m'],
    ['one skipped space', '\u001b[2Crunning Stop\u001b[1Chook · 3s · '],
    ['one skipped letter', '\u001b[2Crunning St\u001b[1Cp hook · 3s · '],
  ] as const) {
    it(`natural end after the row, ${label}`, () => {
      const edge = new ClaudeTitleTurnEdge();
      edge.observe('◐ task');
      edge.noteOutput(row);
      console.log(`${label} -> idle title read as interrupt edge:`, edge.observe('✳ task'));
    });
  }
});
