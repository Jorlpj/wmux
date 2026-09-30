// ─── Per-agent launch option grammar (verified entries only) ─────────────────
//
// Neutral launch options a role binding can turn on, mapped to each agent
// CLI's own spelling. Sibling of MODEL_FLAG_BY_LAUNCHER (orchestratorRole):
// an agent or option missing here is simply not offered — never guessed.
//
// Verified 2026-09-30:
//   claude 2.1.285  `--effort <level>` runs (modelUsage reported);
//                   `--dangerously-skip-permissions` listed in --help.
//   codex 0.159.2   `codex -c model_reasoning_effort=high exec …` prints
//                   "reasoning effort: high" over a config default of low;
//                   `--dangerously-bypass-approvals-and-sandbox` in --help.
//   agy 1.2.x       `--dangerously-skip-permissions` in --help. Effort is part
//                   of the model id (`gemini-3.8-flash-low`); wmux never emits
//                   agy's own `--effort`, so the two can never disagree.

export interface AgentLaunchGrammar {
  /** Tokens that set the effort, or absent when effort is not a flag. */
  effortFlag?: (effort: string) => string[];
  /** Does this token already set the effort? (a manual flag wins) */
  hasEffort?: (token: string) => boolean;
  /** The agent's own skip-all-permission-prompts flag. */
  skipPermissionsFlag?: string;
  /** Other spellings that already mean "skip permissions" on this CLI. */
  skipPermissionsAliases?: readonly string[];
  /** Effort is encoded in the model id suffix (agy). */
  effortInModelId?: boolean;
}

export const LAUNCH_GRAMMAR_BY_AGENT: Readonly<Record<string, AgentLaunchGrammar>> = {
  claude: {
    effortFlag: (e) => ['--effort', e],
    hasEffort: (t) => t === '--effort' || t.startsWith('--effort='),
    // No alias: `--allow-dangerously-skip-permissions` only makes bypass
    // available as an option (claude --help), it does not switch it on.
    skipPermissionsFlag: '--dangerously-skip-permissions',
  },
  codex: {
    effortFlag: (e) => ['-c', `model_reasoning_effort=${e}`],
    hasEffort: (t) => t.includes('model_reasoning_effort'),
    skipPermissionsFlag: '--dangerously-bypass-approvals-and-sandbox',
    skipPermissionsAliases: ['--yolo'],
  },
  agy: {
    skipPermissionsFlag: '--dangerously-skip-permissions',
    effortInModelId: true,
  },
};

export function launchGrammarFor(agent: string | undefined): AgentLaunchGrammar | undefined {
  return agent && Object.hasOwn(LAUNCH_GRAMMAR_BY_AGENT, agent) ? LAUNCH_GRAMMAR_BY_AGENT[agent] : undefined;
}

/** Effort levels that are safe as a single CLI token. */
export const EFFORT_TOKEN_RE = /^[a-z]{1,16}$/;
