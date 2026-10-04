// Prompt construction for remixes. Bump PROMPT_VERSION whenever the remix wording changes so results stay comparable.
// Shared by the browser and the Node CLI, so it takes the API spec text as an argument instead of reading files.
import type { Scope } from './types';

export const PROMPT_VERSION = 'v6';
/** Staged remixes (level 1 first, then the rest) use different wording, so they're versioned separately. */
export const STAGED_PROMPT_VERSION = 'v6-staged1';

const levelCount = (scope: Scope) => (scope === 'quick' ? 6 : 20);

export function systemPrompt(spec: string): string {
  return `You are a brilliant game designer and engineer creating cartridges for the DIGI-FUZE, a fantasy retro console.

Here is the complete cartridge API. Every cartridge you write must follow it exactly.

<cartridge_api>
${spec}
</cartridge_api>`;
}

export function remixRequest(a: { title: string; source: string }, b: { title: string; source: string }, scope: Scope = 'full', staged = false): string {
  const size = staged
    ? `You'll build it in two steps so the player can start playing fast. **This step: level 1 only.** Write a complete, polished cartridge (title screen, pause, game over, score, saved high score, sound and juice) with exactly ONE level that is fun on its own and teaches the fused mechanic. Structure the code so levels are data (a \`LEVELS\` array plus per-level twist flags), because in the next step you'll add levels 2 to ${levelCount(scope)}. Save the furthest level reached as a number under the storage key \`best\` (\`api.storage.set('best', n)\`) and make the title screen start at it. When level 1 is cleared, show a short level-clear moment, save \`best\` as 2, and return to the title screen. Keep it lean so it's ready fast.`
    : scope === 'quick'
      ? 'It\'s a complete but compact cartridge: title screen, about 6 levels with escalating variety that draws on both parents, pause, game over, victory, score, saved high score, sound and juice. Keep the code tight (well under 1,000 lines) so it\'s ready fast.'
      : 'It\'s a full cartridge per the quality bar: title screen, a real progression of about 20 levels with variety that draws on both parents, pause, game over, victory, score, saved high score, sound and juice.';
  return `Two cartridges have just been plugged into the console at the same time. Your job is to make the game that comes out: a brand-new cartridge that kitbashes them.

<cartridge title="${a.title}">
${a.source}
</cartridge>

<cartridge title="${b.title}">
${b.source}
</cartridge>

What makes a great kitbash:
- Fuse the core mechanics of BOTH games into one coherent game with its own identity. Both parents' core mechanics should be instantly recognizable in play, and the combination should create new gameplay that neither had on its own.
- Not two minigames side by side or alternating, and not one game re-skinned with the other's art.
- Fun within 30 seconds of pressing START. The title screen names the new game and explains the controls in a line or two.
- ${size}
- Reuse and adapt code from the parents freely. They're yours to cannibalize.
- Give it an original name and original art. Never use or allude to existing commercial game titles, characters, brands or logos.
- It has to run first time. There is no human to fix it.

Respond in exactly this format:
TITLE: <the new game's name, max 20 characters>
PITCH: <one sentence describing the fused gameplay>

\`\`\`javascript
<the complete cartridge source>
\`\`\`

Nothing after the code block.`;
}

/** Step 2 of a staged remix: the player is already playing level 1 while this runs. */
export function expandRequest(scope: Scope, feedback?: string): string {
  const n = levelCount(scope);
  const notes = feedback?.trim()
    ? `\n\nThe player tried level 1 and has feedback for the full game. Take it seriously: change level 1 too if it asks for that (then it's fine to break the "keep level 1 as is" rule below), and let it shape the new levels.\n\n<player_feedback>\n${feedback.trim()}\n</player_feedback>`
    : '';
  return `The player has tried level 1 and wants the full game. Now finish it: add levels 2 to ${n}${scope === 'quick' ? ', a compact but escalating set' : ', a real progression'} with variety that draws on both parents (new layouts, enemies, rules or twists, not only faster numbers), plus a victory screen after level ${n}.${notes}

Unless the feedback says otherwise, keep level 1, the controls, the look, and the storage keys as they are (\`best\` = furthest level reached, plus the high score), so a player who just cleared level 1 continues seamlessly at level 2 when this version loads. The title screen starts at the furthest level reached, and LEFT/RIGHT on the title selects any level reached so far. When a level is cleared, save \`best\` and continue to the next level (no longer return to the title after level 1).

Return the COMPLETE cartridge in the same format (TITLE, PITCH, then one \`\`\`javascript block). Nothing after the code block.`;
}

export function repairRequest(problem: string): string {
  return `Your cartridge failed the console's automated boot test, so it can't ship yet:

<test_failure>
${problem}
</test_failure>

Fix the problem and return the COMPLETE corrected cartridge in the same format (TITLE, PITCH, then one \`\`\`javascript block). Nothing after the code block.`;
}

export function runtimeRepairRequest(error: string): string {
  return `Your cartridge booted, but it crashed while someone was playing it:

<runtime_error>
${error}
</runtime_error>

Fix the cause (and anything similar you spot) and return the COMPLETE corrected cartridge in the same format (TITLE, PITCH, then one \`\`\`javascript block). Nothing after the code block.`;
}

export function bugReportRequest(description: string, recent: string): string {
  return `Your cartridge runs, but the player says it isn't working properly. A screenshot of the screen at the moment they reported it is attached.

<player_report>
${description}
</player_report>

<recent_activity>
${recent}
</recent_activity>

Find the cause (and anything similar you spot) and return the COMPLETE corrected cartridge in the same format (TITLE, PITCH, then one \`\`\`javascript block). Nothing after the code block.`;
}

export interface ParsedRemix { title: string; pitch: string; code: string | null; truncatedFence: boolean }

export function parseResponse(text: string): ParsedRemix {
  const title = (/^\s*TITLE:\s*(.+)$/m.exec(text)?.[1] || 'UNTITLED REMIX').trim().slice(0, 32);
  const pitch = (/^\s*PITCH:\s*(.+)$/m.exec(text)?.[1] || '').trim().slice(0, 300);
  const fences = [...text.matchAll(/```(?:javascript|js|mjs)?[ \t]*\n([\s\S]*?)```/g)];
  if (fences.length) {
    const best = fences.reduce((x, y) => (y[1].length > x[1].length ? y : x));
    return { title, pitch, code: best[1], truncatedFence: false };
  }
  const open = /```(?:javascript|js|mjs)?[ \t]*\n([\s\S]*)$/.exec(text);
  if (open) return { title, pitch, code: open[1], truncatedFence: true };
  return { title, pitch, code: null, truncatedFence: false };
}
