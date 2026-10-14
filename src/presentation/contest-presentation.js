import { isPassedSubmission, isPendingSubmission, isTimeLimitSubmission } from '../utils/submission-status.js';
import { extractSolvedProblemNames, normalizeStandingScore, resolveStandingTeams } from '../utils/standings.js';
import { sameTeam } from '../utils/public-id.js';


/**
 * Build the markdown preview shown when a contest problem is opened from the
 * explorer without requiring a second VS Code view surface.
 * @param {object} problem
 * @returns {string}
 */
export function buildProblemPreview(problem) {
    const lines = [
        `# ${getProblemTitle(problem)}`,
    ];

    const statement = getProblemStatement(problem);
    if (statement) {
        lines.push('', statement.trim());
    }
    else {
        lines.push('', 'Problem statement details were not included in the current contest snapshot.');
    }

    return lines.join('\n');
}

/**
 * Return a readable status label for explorer descriptions and output messages.
 * @param {string | undefined | null} status
 * @returns {string}
 */
export function formatSubmissionStatus(status) {
    if (!status) {
        return 'Unknown';
    }

    return status
        .toString()
        .trim()
        .toLowerCase()
        .split(/[_\s]+/)
        .filter(Boolean)
        .map(token => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');
}

/**
 * Render the full submission payload in a readable output-channel block.
 * @param {object} submission
 * @returns {string}
 */
export function renderSubmissionDetails(submission) {
    const statusEmoji = getStatusEmoji(submission.status);
    const statusText = formatSubmissionStatus(submission.status);

    const lines = [
        `# 📝 Submission #${submission.id ?? 'Unknown'}`,
        '',
        `| **Status** | ${statusEmoji} **${statusText}** |`,
        `| :--- | :--- |`,
    ];

    const problemLabel = buildSubmissionProblemLabel(submission?.problem);
    if (problemLabel) {
        lines.push(`| **🧩 Problem** | ${problemLabel} |`);
    }

    if (submission?.submittedAt) {
        lines.push(`| **⏰ Submitted At** | \`${submission.submittedAt}\` |`);
    }

    let scoreLabel = 'Time';
    if (!isPassedSubmission(submission?.status)) {
        scoreLabel = 'Penalty';
    }
    if (submission?.score != null) {
        lines.push(`| **⏱️ ${scoreLabel}** | ${formatProblemScore(submission.score)} |`);
    }

    if (submission?.hint) {
        const { message, expected, received } = submission.hint;
        if (message) {
            lines.push('', '---', '', '### 💡 Hint');
            const hintMessage = message?.toString().trim();
            if (hintMessage) {
                lines.push('', '```', hintMessage.replace(/\n/g, '\n'), '```');
            }
        }

        if (expected != null || received != null) {
            lines.push('', '### 🔎 Expected vs Received');
            if (expected != null) {
                lines.push('', '**Expected Output:**', '```', expected.toString().trim(), '```');
            }
            if (received != null) {
                lines.push('', '**Received Output:**', '```', received.toString().trim(), '```');
            }
        }
    }

    return lines.join('\n');
}

/**
 * Return status emoji based on status value.
 * @param {string | undefined | null} status
 * @returns {string}
 */
function getStatusEmoji(status) {
    if (isPassedSubmission(status)) {
        return '🟢';
    }
    if (isPendingSubmission(status) || isTimeLimitSubmission(status)) {
        return '🟡';
    }
    return '🔴';
}

/**
 * Build the explorer contest header description with the current team.
 * @param {{ name?: string } | undefined | null} team
 * @returns {string}
 */
export function buildContestHeaderDescription(team) {
    return team?.name?.toString().trim() || 'Unknown Team';
}

/**
 * Format problem score from milliseconds as a minute string.
 * @param {number} ms 
 * @returns {string}
 */
export function formatProblemScore(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = (totalSeconds / 60).toFixed(1);
    return `${minutes} min`;
}

/**
 * Render the contest dashboard as a Markdown metrics table. A contest without a
 * start time has not started: its end and remaining time are shown as not started
 * rather than computed from `new Date(null)` (1970) or reported as ended.
 * @param {object} contest
 * @returns {string}
 */
export function renderContestDashboard(contest) {
    const hasStarted = Boolean(contest.startTime);
    const startTime = hasStarted ? `\`${contest.startTime}\`` : 'Not started';
    let endTime = 'Not started';
    let remainingTime = 'Not started';

    if (hasStarted) {
        const endTimestamp = new Date(contest.startTime).getTime() + contest.duration * 60 * 1000;
        const remainingMs = endTimestamp - Date.now();
        endTime = `\`${new Date(endTimestamp).toISOString()}\``;
        remainingTime = remainingMs > 0 ? formatProblemScore(remainingMs) : 'Ended';
    }

    const lines = [
        `# 🏆 Contest ${contest.name.trim()}`,
        '',
        `| **Metric** | **Value** |`,
        `| :--- | :--- |`,
        `| **📅 Start Time** | ${startTime} |`,
        `| **🏁 End Time** | ${endTime} |`,
        `| **⏳ Remaining Time** | **${remainingTime}** |`,
        `| **⏱️ Duration** | ${contest.duration} minutes |`,
        `| **⚠️ Penalty Time** | ${contest.penaltyTime} minutes |`,
        `| **❄️ Freeze Time** | ${contest.freezeTime} minutes |`,
        `| **🥶 Frozen Scoreboard** | ${contest.frozenScoreboard ? 'Yes ❄️' : 'No'} |`,
        `| **📚 Problems Count** | ${contest.problems?.length ?? 0} |`,
        `| **👥 Teams Count** | ${contest.teams?.length ?? 0} |`,
    ];

    return lines.join('\n');
}

/**
 * Render details of a team's standing and solved problems in Markdown.
 * @param {object} team
 * @param {object | null} currentSnapshot
 * @returns {string}
 */
export function renderTeamStandingDetails(team, currentSnapshot) {
    const sortedTeams = currentSnapshot?.contest ? resolveStandingTeams(currentSnapshot.contest) : [];
    const teamIndex = sortedTeams.findIndex(entry => sameTeam(entry, team));
    const rank = teamIndex !== -1 ? teamIndex + 1 : 'Unknown';

    const normalizedScore = formatProblemScore(normalizeStandingScore(team));
    const contestProblems = currentSnapshot?.contest?.problems ?? [];
    const solvedProblemNames = extractSolvedProblemNames(team, contestProblems);

    const lines = [
        `# 👥 Team Standing: ${team.name}`,
        '',
        `| **Metric** | **Value** |`,
        `| :--- | :--- |`,
        `| **🏆 Rank** | **#${rank}** |`,
        `| **⏱️ Time** | \`${normalizedScore}\` |`,
        `| **✅ Solved Problems** | ${solvedProblemNames.length} / ${contestProblems.length} |`,
        '',
        `### 🧩 Solved Problems List`,
        '',
    ];

    if (solvedProblemNames.length) {
        for (const problemName of solvedProblemNames) {
            lines.push(`> - ${problemName} `);
        }
    } else {
        lines.push('*This team has not solved any problems yet.*');
    }

    return lines.join('\n');
}

/**
 * Return the best available problem title while guarding against blank API data.
 * @param {object} problem
 * @returns {string}
 */
function getProblemTitle(problem) {
    const title = problem?.title?.toString().trim();
    return title || `Problem ${problem?.publicId ?? ''}`.trim();
}

/**
 * Choose the most informative statement field currently present in the problem payload.
 * @param {object} problem
 * @returns {string}
 */
function getProblemStatement(problem) {
    return [problem?.description, problem?.statement, problem?.body]
        .find(value => typeof value === 'string' && value.trim());
}

/**
 * Append a submission detail line when the source value is present.
 * @param {string[]} lines
 * @param {string} label
 * @param {unknown} value
 */
function appendSubmissionField(lines, label, value) {
    const normalizedValue = value?.toString().trim();
    if (normalizedValue) {
        lines.push(`${label}: ${normalizedValue}`);
    }
}

/**
 * Build a compact submission problem label for output-channel summaries.
 * @param {{ publicId?: string, title?: string } | undefined | null} problem
 * @returns {string}
 */
function buildSubmissionProblemLabel(problem) {
    const title = problem?.title?.toString().trim();
    const publicId = problem?.publicId?.toString().trim();
    const suffix = publicId ? ` (${publicId})` : '';

    if (title) {
        return `${title}${suffix}`;
    }

    return publicId ? `Problem${suffix}` : '';
}
