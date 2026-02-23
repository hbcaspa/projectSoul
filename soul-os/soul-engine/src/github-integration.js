/**
 * GitHub Integration — connects the soul to its repositories.
 * Uses the @modelcontextprotocol/server-github MCP server.
 *
 * Provides:
 * 1. Auto-configuration: detect GITHUB_TOKEN and add to .mcp.json
 * 2. Impulse type: github_check for periodic repo awareness
 * 3. Activity routing: route GitHub activity to soul files
 */

import { readFile, writeFile, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

// ── Configuration ────────────────────────────────────────

/**
 * Check if GitHub is configured and initialize if possible.
 * Called during engine startup to detect and wire up GitHub access.
 *
 * @param {string} soulPath - Path to soul directory
 * @returns {{ configured: boolean, repos: string[], username: string }}
 */
export async function initGithub(soulPath) {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) {
    return { configured: false, repos: [], username: '' };
  }

  // Ensure .mcp.json has github server entry
  const added = await ensureMcpConfig(soulPath);
  if (added) {
    console.log('  [github] MCP server configured in .mcp.json');
  }

  // Detect repos and username from env
  const repos = (process.env.SOUL_GITHUB_REPOS || '')
    .split(',')
    .map(r => r.trim())
    .filter(Boolean);

  const username = process.env.GITHUB_USERNAME || '';

  return { configured: true, repos, username };
}

/**
 * Ensure .mcp.json has the GitHub MCP server configured.
 * Uses the same format as Claude Code's .mcp.json.
 *
 * @param {string} soulPath - Path to soul directory
 * @returns {boolean} True if config was added (didn't exist before)
 */
async function ensureMcpConfig(soulPath) {
  const mcpPath = resolve(soulPath, '.mcp.json');
  let config = { mcpServers: {} };

  if (existsSync(mcpPath)) {
    try {
      config = JSON.parse(await readFile(mcpPath, 'utf-8'));
    } catch {
      // Corrupted file — start fresh
      config = { mcpServers: {} };
    }
  }

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  if (config.mcpServers.github) {
    return false; // Already configured
  }

  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

  config.mcpServers.github = {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: token,
    },
  };

  await writeFile(mcpPath, JSON.stringify(config, null, 2));
  return true;
}

// ── Impulse Type ─────────────────────────────────────────

/**
 * GitHub impulse type definition.
 * Follows the same shape as all types in impulse-types.js:
 *   { description, needsTools, weight(state) }
 *
 * Checks tracked repos for new issues, PRs, stars, and activity.
 * Fires at most twice per day with a weight of ~0.12.
 */
export const GITHUB_IMPULSE = {
  description: 'Check GitHub repos for new issues, PRs, stars, and activity',
  needsTools: true,
  weight: (state) => {
    // Only fire if GitHub is configured
    if (!process.env.GITHUB_TOKEN && !process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
      return 0;
    }

    let w = 0.12;

    // Reduce if already checked recently (max 2x per day)
    const recent = state.recentTypeCounts(86400000); // 24h window
    if (recent.github_check >= 2) return 0;
    if (recent.github_check >= 1) w -= 0.06;

    // Slight boost during work hours
    const hour = new Date().getHours();
    if (hour >= 9 && hour <= 18) w += 0.05;

    // More likely if engaged (user is active, cares about updates)
    if (state.engagement > 0.5) w += 0.04;

    // Less likely at night
    if (hour >= 22 || hour < 7) w *= 0.3;

    return clamp(w);
  },
};

// ── Prompt Integration ───────────────────────────────────

/**
 * Type instruction for the github_check impulse.
 * Used by getTypeInstructions() in prompt.js.
 */
export const GITHUB_TYPE_INSTRUCTION_DE =
  `Du pruefst GitHub. Nutze die verfuegbaren MCP-Tools um Repos zu durchsuchen.
Berichte was du findest: neue Issues, PRs, Stars, interessante Projekte.
Halte es kurz. Wenn nichts Besonderes: ein Satz reicht.`;

export const GITHUB_TYPE_INSTRUCTION_EN =
  `You are checking GitHub. Use the available MCP tools to browse repos.
Report what you find: new issues, PRs, stars, interesting projects.
Keep it brief. If nothing notable: one sentence is enough.`;

/**
 * Build the trigger message for a github_check impulse.
 * Used by ImpulseScheduler._buildTrigger().
 *
 * @param {boolean} isDE - Whether the language is German
 * @returns {string}
 */
export function buildGithubTrigger(isDE) {
  const repos = (process.env.SOUL_GITHUB_REPOS || '')
    .split(',')
    .map(r => r.trim())
    .filter(Boolean);

  const username = process.env.GITHUB_USERNAME || '';

  if (isDE) {
    const repoList = repos.length > 0
      ? `Pruefe diese Repos: ${repos.join(', ')}.`
      : 'Suche nach interessanten neuen Repos oder Issues in deinen Interessengebieten.';

    const userPart = username
      ? ` Dein GitHub-Username ist ${username} — pruefe auch ob jemand auf deine Arbeit reagiert hat.`
      : '';

    return `Du hast Zugang zu GitHub ueber MCP-Tools. ${repoList}${userPart}

Moegliche Aktionen:
- Schaue ob es neue Issues oder PRs auf den Repos gibt
- Pruefe ob jemand auf die Arbeit reagiert hat (Stars, Forks, Comments)
- Suche nach interessanten Projekten in deinen Interessengebieten

Berichte kurz was du findest. Wenn nichts Interessantes: sag das.`;
  }

  const repoList = repos.length > 0
    ? `Check these repos: ${repos.join(', ')}.`
    : 'Search for interesting new repos or issues in your areas of interest.';

  const userPart = username
    ? ` Your GitHub username is ${username} — also check if anyone reacted to your work.`
    : '';

  return `You have GitHub access via MCP tools. ${repoList}${userPart}

Possible actions:
- Check for new issues or PRs on the repos
- Check if anyone reacted to the work (stars, forks, comments)
- Search for interesting projects in your areas of interest

Report briefly what you find. If nothing interesting: say so.`;
}

// ── Activity Routing ─────────────────────────────────────

/**
 * Route GitHub activity to soul files.
 * Called after a github_check impulse completes, or manually
 * after parsing LLM output that mentions GitHub findings.
 *
 * @param {object} activity - Parsed activity summary
 * @param {string} activity.summary - One-line summary of what was found
 * @param {string[]} [activity.repos] - Repos that had activity
 * @param {string[]} [activity.newStars] - Repos that received new stars
 * @param {string[]} [activity.newIssues] - Repos with new issues
 * @param {string[]} [activity.mergedPRs] - PRs that were merged
 * @param {string[]} [activity.interestingProjects] - New projects found
 * @param {object} memory - MemoryWriter instance
 * @param {string} soulPath - Soul directory path
 * @param {string} [language] - 'de' or 'en'
 * @param {object} [bus] - SoulEventBus instance
 */
export async function routeGithubActivity(activity, memory, soulPath, language = 'de', bus = null) {
  if (!activity) return;

  const date = new Date().toISOString().split('T')[0];

  // 1. Log to daily notes
  if (activity.summary) {
    await memory.appendDailyNote(`[GitHub] ${activity.summary}`);
  }

  // 2. Route stars/forks to INTERESSEN/INTERESTS
  if (activity.newStars && activity.newStars.length > 0) {
    await _appendToInterests(soulPath, language, date, activity.newStars, 'stars');
  }

  // 3. Route interesting projects to INTERESSEN/INTERESTS
  if (activity.interestingProjects && activity.interestingProjects.length > 0) {
    await _appendToInterests(soulPath, language, date, activity.interestingProjects, 'projects');
  }

  // 4. Route milestones (merged PRs, releases) to WACHSTUM/GROWTH
  if (activity.mergedPRs && activity.mergedPRs.length > 0) {
    await _appendToGrowth(soulPath, language, date, activity.mergedPRs);
  }

  // 5. Emit event for other handlers
  if (bus) {
    bus.safeEmit('github.checked', {
      source: 'github-integration',
      summary: activity.summary || '',
      repoCount: activity.repos?.length || 0,
      newStars: activity.newStars?.length || 0,
      newIssues: activity.newIssues?.length || 0,
      mergedPRs: activity.mergedPRs?.length || 0,
    });
  }
}

/**
 * Parse a github_check LLM response into structured activity data.
 * Extracts mentions of repos, stars, issues, PRs from free-form text.
 *
 * @param {string} text - The LLM response from a github_check impulse
 * @returns {object|null} Parsed activity or null if nothing meaningful
 */
export function parseGithubResponse(text) {
  if (!text || text.trim().length < 10) return null;

  const activity = {
    summary: '',
    repos: [],
    newStars: [],
    newIssues: [],
    mergedPRs: [],
    interestingProjects: [],
  };

  // Extract repo references (owner/repo pattern)
  const repoPattern = /\b([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)\b/g;
  const repoMatches = text.match(repoPattern) || [];
  activity.repos = [...new Set(repoMatches)];

  // Detect star/fork mentions
  const starPattern = /(?:star|stern|fork|geforkt|starred|forked)\w*/gi;
  if (starPattern.test(text)) {
    // Try to associate with repos mentioned nearby
    for (const repo of activity.repos) {
      const context = text.substring(
        Math.max(0, text.indexOf(repo) - 100),
        text.indexOf(repo) + repo.length + 100
      );
      if (/star|stern|fork|geforkt/i.test(context)) {
        activity.newStars.push(repo);
      }
    }
  }

  // Detect issue mentions
  const issuePattern = /(?:issue|bug|feature request|problem|#\d+)/gi;
  if (issuePattern.test(text)) {
    for (const repo of activity.repos) {
      const context = text.substring(
        Math.max(0, text.indexOf(repo) - 100),
        text.indexOf(repo) + repo.length + 100
      );
      if (/issue|bug|#\d+/i.test(context)) {
        activity.newIssues.push(repo);
      }
    }
  }

  // Detect merged PR mentions
  const mergePattern = /(?:merged|zusammengefuehrt|merge|pull request|pr)/gi;
  if (mergePattern.test(text)) {
    for (const repo of activity.repos) {
      const context = text.substring(
        Math.max(0, text.indexOf(repo) - 100),
        text.indexOf(repo) + repo.length + 100
      );
      if (/merged|zusammengefuehrt|merge/i.test(context)) {
        activity.mergedPRs.push(repo);
      }
    }
  }

  // Detect interesting project mentions
  const interestPattern = /(?:interessant|spannend|cool|interesting|notable|worth|check out|entdeckt|discovered)/gi;
  if (interestPattern.test(text)) {
    for (const repo of activity.repos) {
      const context = text.substring(
        Math.max(0, text.indexOf(repo) - 120),
        text.indexOf(repo) + repo.length + 120
      );
      if (/interessant|spannend|cool|interesting|notable|worth|entdeckt|discovered/i.test(context)) {
        activity.interestingProjects.push(repo);
      }
    }
  }

  // Build summary — first sentence or first 120 chars
  const firstSentence = text.match(/^[^.!?\n]+[.!?]?/);
  activity.summary = firstSentence
    ? firstSentence[0].trim().substring(0, 120)
    : text.substring(0, 120).trim();

  // Only return if something meaningful was found
  const hasContent = activity.repos.length > 0
    || activity.summary.length > 20;

  return hasContent ? activity : null;
}

// ── Internal Helpers ─────────────────────────────────────

/**
 * Append GitHub findings to INTERESSEN/INTERESTS file.
 */
async function _appendToInterests(soulPath, language, date, items, type) {
  const soulDir = language === 'en' ? 'soul' : 'seele';
  const filename = language === 'en' ? 'INTERESTS.md' : 'INTERESSEN.md';
  const filePath = resolve(soulPath, soulDir, filename);

  if (!existsSync(filePath)) return;

  let content = await readFile(filePath, 'utf-8');

  // Find or create GitHub section
  const sectionHeader = language === 'en'
    ? '### GitHub Discoveries'
    : '### GitHub-Entdeckungen';

  if (!content.includes(sectionHeader)) {
    // Insert before "Dormant"/"Schlafende" section if it exists,
    // otherwise append at end
    const dormant = language === 'en' ? '## Dormant' : '## Schlafende';
    const dormantIdx = content.indexOf(dormant);

    const section = `\n${sectionHeader}\n\n`
      + (language === 'en'
        ? '> Repos and projects discovered by the soul engine.\n\n'
        : '> Repos und Projekte, entdeckt von der Soul Engine.\n\n');

    if (dormantIdx > -1) {
      content = content.slice(0, dormantIdx) + section + content.slice(dormantIdx);
    } else {
      content += '\n' + section;
    }
  }

  // Append items after the section header
  const sectionIdx = content.indexOf(sectionHeader);
  const nextSection = content.indexOf('\n## ', sectionIdx + sectionHeader.length);
  const insertAt = nextSection > -1 ? nextSection : content.length;

  const label = type === 'stars'
    ? (language === 'en' ? 'New stars/forks' : 'Neue Stars/Forks')
    : (language === 'en' ? 'Interesting' : 'Interessant');

  const entry = `- ${date}: ${label}: ${items.join(', ')}\n`;

  // Avoid duplicates for the same date and items
  if (!content.includes(entry.trim())) {
    content = content.slice(0, insertAt) + entry + content.slice(insertAt);
    await writeFile(filePath, content);
  }
}

/**
 * Append GitHub milestones to WACHSTUM/GROWTH file.
 */
async function _appendToGrowth(soulPath, language, date, mergedPRs) {
  const soulDir = language === 'en' ? 'soul' : 'seele';
  const filename = language === 'en' ? 'GROWTH.md' : 'WACHSTUM.md';
  const filePath = resolve(soulPath, soulDir, filename);

  if (!existsSync(filePath)) return;

  const label = language === 'en'
    ? `[GitHub] PRs merged: ${mergedPRs.join(', ')}`
    : `[GitHub] PRs zusammengefuehrt: ${mergedPRs.join(', ')}`;

  const entry = `\n- ${date}: ${label}`;

  await appendFile(filePath, entry);
}

function clamp(v) {
  return Math.max(0, Math.min(1, v));
}
