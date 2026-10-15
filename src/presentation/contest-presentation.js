import { isPassedSubmission, isPendingSubmission } from '../utils/submission-status.js';
import { countSolvedProblems, findTeamStanding, normalizeStandingScore, resolveStandingTeams } from '../utils/standings.js';
import { resolveRouteId, sameEntity } from '../utils/public-id.js';
import { formatDuration, formatLocalDateTime, formatMinutes, formatRelativeTime } from '../utils/time-format.js';
import { getContestDurationMinutes, getContestTiming, getProblemLetter, getProblemTitle, sortProblems, summarizeProblemSubmissions } from '../utils/contest-progress.js';
import { extractPublicCases } from '../workspace/contest-public-cases.js';

/*
 * Page layout shared by every generated Markdown page (problem, submission,
 * team standing, contest overview), so contestants scan them the same way:
 *
 *   # Title
 *
 *   One-line summary sentence.
 *
 *   - **Label:** value          <- definition-style field list
 *   - **Label:** value
 *
 *   ## Section                   <- optional sections (statement, hint, cases)
 *
 * Fields whose value is missing are omitted instead of rendering `undefined`.
 *
 * Safety: every team, contest, problem, file and verdict name that is
 * interpolated inline goes through `escapeInline`, so it renders as plain text
 * (no forged headings, links or HTML). Judge output and public test cases sit in
 * code fences, and problem statements are intentionally
 * rendered as the Markdown the contest author wrote.
 */

const MINUTE_MS = 60 * 1000;
const MAX_FILE_NAME_LENGTH = 80;
// Longest output (in lines) the inline diff compares, keeping the LCS table small.
const MAX_DIFF_LINES = 200;
const WHITESPACE_ONLY_NOTE = 'The outputs differ only in whitespace or line endings.';
// Windows device names are reserved with or without an extension (`nul.md` too).
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const CONTEST_PHASE_LABELS = {
    notStarted: 'Not started',
    running: 'Running',
    ended: 'Ended',
};

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
 * Render the problem page: `# A. Title`, the team's progress on it, the
 * statement, and the public test cases numbered from 1 (matching the exported
 * testcase files).
 * @param {object} problem
 * @param {{ problems?: object[], submissions?: object[] }} [options]
 * @param {object[]} [options.problems] all contest problems, used for the letter
 * @param {object[]} [options.submissions] the team's own submissions
 * @returns {string}
 */
export function renderProblemPage(problem, { problems = [], submissions = [] } = {}) {
    const lines = [
        `# ${escapeInline(getProblemPageName(problem, problems))}`,
        '',
        describeProblemProgress(problem, submissions),
        '',
    ];

    const statement = getProblemStatement(problem);
    lines.push(statement ? statement.trim() : '*The statement is not available in the current contest data.*');

    const publicCases = buildPublicCases(problem);
    if (publicCases) {
        lines.push('', publicCases);
    }

    return `${lines.join('\n')}\n`;
}

/**
 * Render one submission: verdict, problem, local submit time, time or penalty,
 * file details, judge hint, an inline line diff of expected versus received
 * output, and the raw outputs. The fields list already carries verdict and
 * problem, so a summary sentence appears only while the submission is pending.
 * @param {object} submission
 * @param {{ problems?: object[] }} [options]
 * @param {object[]} [options.problems] all contest problems, used for the letter
 * @returns {string}
 */
export function renderSubmissionDetails(submission, { problems = [] } = {}) {
    const verdict = escapeInline(formatSubmissionStatus(submission?.status));
    const problemLabel = escapeInline(formatSubmissionProblemLabel(submission?.problem, problems));
    const relative = formatRelativeTime(submission?.submittedAt);

    const lines = [`# ${escapeInline(getSubmissionHeading(submission))}`, ''];
    if (isPendingSubmission(submission?.status)) {
        lines.push('*Still being judged.*', '');
    }

    const submittedAt = submission?.submittedAt
        ? `${formatLocalDateTime(submission.submittedAt)}${relative ? ` (${relative})` : ''}`
        : '';

    lines.push(...renderFields([
        ['Verdict', verdict],
        ['Problem', problemLabel],
        ['Submitted', submittedAt],
        [isPassedSubmission(submission?.status) ? 'Time' : 'Penalty', formatOptionalMinutes(submission?.score)],
        ['File', escapeInline(submission?.filename ?? submission?.fileName)],
        ['Language', escapeInline(submission?.language)],
    ]));

    const hint = submission?.hint ?? {};
    const hintMessage = toText(hint.message);
    if (hintMessage) {
        lines.push('', '## Hint', '', fence(hintMessage));
    }

    const hasExpected = hint.expected != null;
    const hasReceived = hint.received != null;
    const expected = hasExpected ? normalizeText(hint.expected) : '';
    const received = hasReceived ? normalizeText(hint.received) : '';
    if (hasExpected && hasReceived) {
        const rawDiffers = String(hint.expected) !== String(hint.received);
        lines.push('', ...renderOutputDiff(expected, received, rawDiffers));
    }
    if (hasExpected || hasReceived) {
        lines.push('', '## Raw output');
        if (hasExpected) {
            lines.push('', '### Expected', '', fence(expected));
        }
        if (hasReceived) {
            lines.push('', '### Received', '', fence(received));
        }
    }

    return `${lines.join('\n')}\n`;
}

/**
 * Render one team's standing: rank, solved count (the raw server count, as
 * everywhere else), total time, and the solved problems it can name as a
 * lettered list.
 * @param {object} team
 * @param {{ contest?: object, problems?: object[] } | null | undefined} snapshot
 * @returns {string}
 */
export function renderTeamStandingDetails(team, snapshot) {
    const contest = snapshot?.contest;
    const standings = contest ? resolveStandingTeams(contest) : [];
    const ranked = findTeamStanding(contest, team, standings);
    const standing = ranked ?? team;
    const rank = ranked?.rank ?? null;

    const problems = sortProblems(contest?.problems ?? snapshot?.problems);
    const solvedIds = Array.isArray(standing?.solvedProblemIds) ? standing.solvedProblemIds : [];
    const solvedProblems = problems.filter(problem => solvedIds.includes(resolveRouteId(problem)));
    // The raw server count, like the tree row, status bar and rank order; the
    // list below only names the solved problems it can resolve.
    const solvedCount = countSolvedProblems(standing);
    const totalTime = formatMinutes(normalizeStandingScore(standing));
    const name = escapeInline(getTeamPageName(team));

    const summary = rank == null
        ? `${name} is not in the current standings.`
        : `${name} is ranked #${rank} with ${pluralize(solvedCount, 'problem')} solved.`;

    const lines = [
        `# ${name}`,
        '',
        summary,
        '',
        ...renderFields([
            ['Rank', rank == null ? '—' : `#${rank} of ${standings.length}`],
            ['Solved', problems.length ? `${solvedCount} of ${problems.length}` : String(solvedCount)],
            ['Total time', totalTime],
        ]),
        '',
        '## Solved problems',
        '',
    ];

    if (solvedProblems.length) {
        for (const problem of solvedProblems) {
            lines.push(`- ${escapeInline(formatProblemLabel(problem, problems))}`);
        }
    }
    else {
        lines.push('*This team has not solved any problems yet.*');
    }

    return `${lines.join('\n')}\n`;
}

/**
 * Render the "Contest Overview" page: phase, local start and end, remaining
 * time when the page was generated, rules, counts, and the team's position.
 * @param {object} contest
 * @param {{ team?: object, problems?: object[] }} [options]
 * @param {object} [options.team] the signed-in team, for its rank and solved count
 * @param {object[]} [options.problems] contest problems when the contest payload lacks them
 * @param {number} [now=Date.now()]
 * @returns {string}
 */
export function renderContestDashboard(contest, { team, problems } = {}, now = Date.now()) {
    const timing = getContestTiming(contest, now);
    const phase = CONTEST_PHASE_LABELS[timing.phase];
    const durationMinutes = getContestDurationMinutes(contest);
    const problemCount = (contest?.problems ?? problems ?? []).length;
    // A scheduled (future) contest has no endTime from getContestTiming yet,
    // but its end is still known from the start and duration.
    const endTime = timing.endTime ?? (timing.startTime && durationMinutes != null
        ? new Date(timing.startTime.getTime() + durationMinutes * MINUTE_MS)
        : null);
    const standings = Array.isArray(contest?.teams) ? resolveStandingTeams(contest) : [];

    let remaining = '';
    if (timing.phase === 'running' && timing.remainingMs != null) {
        remaining = formatDuration(timing.remainingMs);
    }
    else if (timing.phase !== 'running') {
        remaining = phase;
    }

    const lines = [
        `# ${escapeInline(getContestPageName(contest))}`,
        '',
        describeContestPhase(timing),
        '',
        ...renderFields([
            ['Phase', phase],
            ['Start', timing.startTime ? formatLocalDateTime(timing.startTime) : 'Not started'],
            ['End', endTime ? formatLocalDateTime(endTime) : (timing.startTime ? '' : 'Not started')],
            ['Remaining (when opened)', remaining],
            ['Duration', durationMinutes != null ? formatDuration(durationMinutes * MINUTE_MS) : ''],
            ['Penalty per wrong answer', formatMinutesField(contest?.penaltyTime)],
            ['Scoreboard freeze', formatFreeze(contest)],
            ['Problems', String(problemCount)],
            ['Teams', String(standings.length)],
        ]),
    ];

    if (team) {
        const standing = findTeamStanding(contest, team, standings);
        lines.push('', `## ${escapeInline(getTeamPageName(team))}`, '');
        lines.push(...renderFields([
            ['Rank', standing ? `#${standing.rank} of ${standings.length}` : '—'],
            ['Solved', standing ? `${countSolvedProblems(standing)} of ${problemCount}` : '—'],
            ['Total time', standing ? formatMinutes(normalizeStandingScore(standing)) : ''],
        ]));
    }

    return `${lines.join('\n')}\n`;
}

/**
 * Build a problem page name: `A. Title`, or just the title when the problem is
 * not in the list.
 * @param {object} problem
 * @param {object[]} [problems]
 * @returns {string}
 */
export function getProblemPageName(problem, problems = []) {
    return formatProblemLabel(problem, problems);
}

/**
 * Build a submission page name: `Submission 852 · A. Title`.
 * @param {object} submission
 * @param {object[]} [problems]
 * @returns {string}
 */
export function getSubmissionPageName(submission, problems = []) {
    const problemLabel = formatSubmissionProblemLabel(submission?.problem, problems);
    const heading = getSubmissionHeading(submission);
    return problemLabel ? `${heading} · ${problemLabel}` : heading;
}

/**
 * Build a team page name from the team name.
 * @param {{ name?: string } | null | undefined} team
 * @returns {string}
 */
export function getTeamPageName(team) {
    return toText(team?.name) || 'Unnamed team';
}

/**
 * Build the contest overview page name: `Contest Overview · Name`.
 * @param {{ name?: string } | null | undefined} contest
 * @returns {string}
 */
export function getContestPageName(contest) {
    const name = toText(contest?.name);
    return name ? `Contest Overview · ${name}` : 'Contest Overview';
}

/**
 * Make a page name safe as a file name (it becomes the preview tab title):
 * strips `/ \ : * ? " < > |` and control characters, collapses whitespace,
 * trims trailing dots, caps the length at 80 characters, and suffixes Windows
 * reserved device names (`CON`, `NUL`, `COM1`, ...) with `_`.
 * @param {unknown} name
 * @param {string} [fallback='page']
 * @returns {string}
 */
export function toSafeFileName(name, fallback = 'page') {
    const cleaned = String(name ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\/\\:*?"<>|\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_FILE_NAME_LENGTH)
        .replace(/[.\s]+$/g, '')
        .trim();

    return avoidReservedName(cleaned) || fallback;
}

/**
 * Append `_` to a name whose part before the first dot is a Windows reserved
 * device name, so the file can be created on every platform.
 * @param {string} name
 * @returns {string}
 */
function avoidReservedName(name) {
    const base = name.split('.')[0].trimEnd();
    return WINDOWS_RESERVED_NAME.test(base) ? `${base}_${name.slice(base.length)}` : name;
}

/**
 * Render `[label, value]` pairs as the shared definition-style field list,
 * skipping blank values.
 * @param {Array<[string, unknown]>} fields
 * @returns {string[]}
 */
function renderFields(fields) {
    return fields
        .map(([label, value]) => [label, toText(value)])
        .filter(([, value]) => value)
        .map(([label, value]) => `- **${label}:** ${value}`);
}

/**
 * Describe the team's progress on one problem as a single line.
 * @param {object} problem
 * @param {object[]} submissions
 * @returns {string}
 */
function describeProblemProgress(problem, submissions) {
    const { attempts, solved, pending } = summarizeProblemSubmissions(problem, submissions);
    const attemptText = pluralize(attempts, 'attempt');

    if (solved) {
        return `**Solved** · ${attemptText}`;
    }
    if (pending) {
        return `**Judging** · ${attemptText}`;
    }
    if (attempts) {
        return `**Not solved yet** · ${attemptText}`;
    }
    return '**Not attempted yet**';
}

/**
 * Write the one-line contest phase summary sentence.
 * @param {ReturnType<typeof getContestTiming>} timing
 * @returns {string}
 */
function describeContestPhase(timing) {
    if (timing.phase === 'running') {
        return timing.remainingMs != null
            ? `The contest is running; ${formatDuration(timing.remainingMs)} remained when this page was opened.`
            : 'The contest is running.';
    }
    if (timing.phase === 'ended') {
        return 'The contest has ended.';
    }
    return timing.startTime
        ? `The contest starts ${formatLocalDateTime(timing.startTime)}.`
        : 'The contest has not started yet.';
}

/**
 * Describe the scoreboard freeze window and whether it is frozen now.
 * @param {object} contest
 * @returns {string}
 */
function formatFreeze(contest) {
    const minutes = formatMinutesField(contest?.freezeTime);
    if (!minutes) {
        return contest?.frozenScoreboard ? 'Frozen now' : '';
    }
    return `${minutes}${contest?.frozenScoreboard ? ' (frozen now)' : ''}`;
}

/**
 * Format a minutes-valued contest setting (`20 min`), or '' when missing.
 * @param {unknown} minutes
 * @returns {string}
 */
function formatMinutesField(minutes) {
    const value = Number(minutes);
    return minutes != null && minutes !== '' && Number.isFinite(value) ? formatMinutes(value * MINUTE_MS) : '';
}

/**
 * Format an optional millisecond time score, or '' when missing.
 * @param {unknown} ms
 * @returns {string}
 */
function formatOptionalMinutes(ms) {
    return ms != null && ms !== '' && Number.isFinite(Number(ms)) ? formatMinutes(ms) : '';
}

/**
 * Build the submission heading: `Submission 852`.
 * @param {{ id?: unknown } | null | undefined} submission
 * @returns {string}
 */
function getSubmissionHeading(submission) {
    const id = toText(submission?.id);
    return id ? `Submission ${id}` : 'Submission';
}

/**
 * Label a submission's problem with the contest letter, preferring the full
 * problem from the contest list when the submission carries only a stub.
 * @param {object | null | undefined} problem
 * @param {object[]} problems
 * @returns {string}
 */
function formatSubmissionProblemLabel(problem, problems) {
    if (!problem) {
        return '';
    }
    const fullProblem = (problems ?? []).find(entry => sameEntity(entry, problem)) ?? problem;
    return formatProblemLabel(fullProblem, problems);
}

/**
 * Label a problem as `A. Title`, or just the title when no letter can be
 * resolved. Titles come from the shared `getProblemTitle`.
 * @param {object} problem
 * @param {object[]} problems
 * @returns {string}
 */
function formatProblemLabel(problem, problems) {
    const letter = getProblemLetter(problem, problems);
    const title = getProblemTitle(problem, letter);
    return letter ? `${letter}. ${title}` : title;
}

/**
 * Choose the most informative statement field present in the problem payload.
 * @param {object} problem
 * @returns {string | undefined}
 */
function getProblemStatement(problem) {
    return [problem?.description, problem?.statement, problem?.body]
        .find(value => typeof value === 'string' && value.trim());
}

/**
 * Render the public input/output pairs as one `### Case N` section each,
 * numbered from 1 to match the exported testcase files. Input and output sit in
 * stacked code fences so multi-line values stay one copyable block with their
 * whitespace intact (HTML tables cannot hold blank lines safely in Markdown).
 * Returns '' when there are none.
 * @param {object} problem
 * @returns {string}
 */
function buildPublicCases(problem) {
    const publicCases = extractPublicCases(problem);
    if (!publicCases.length) {
        return '';
    }

    return [
        '## Public test cases',
        ...publicCases.flatMap((testCase, index) => [
            '',
            `### Case ${index + 1}`,
            '',
            '**Input**',
            '',
            fence(normalizeText(testCase.input)),
            '',
            '**Output**',
            '',
            fence(normalizeText(testCase.output)),
        ]),
    ].join('\n');
}

/**
 * Normalize line endings to `\n` and drop trailing newlines so a value renders
 * as a compact code block.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

/**
 * Render the `## Output difference` section: a legend and a `diff` fence. When
 * the raw outputs differ but the diff shows no real change (no `-`/`+` lines,
 * or every removed line only differs from its added line by trailing
 * whitespace) a note says so, since the diff alone would look identical. The
 * note is skipped when the diff is truncated, as the cut part is unverified.
 * @param {string} expected normalized expected output
 * @param {string} received normalized received output
 * @param {boolean} rawDiffers whether the unnormalized outputs are different
 * @returns {string[]}
 */
function renderOutputDiff(expected, received, rawDiffers) {
    const expectedLines = expected.split('\n');
    const receivedLines = received.split('\n');
    const truncated = expectedLines.length > MAX_DIFF_LINES || receivedLines.length > MAX_DIFF_LINES;
    const diff = diffLines(expectedLines.slice(0, MAX_DIFF_LINES), receivedLines.slice(0, MAX_DIFF_LINES));

    return [
        '## Output difference',
        '',
        '`-` expected, `+` your output',
        ...(truncated ? ['', `*Only the first ${MAX_DIFF_LINES} lines of each output are compared.*`] : []),
        '',
        fence(diff.join('\n'), 'diff'),
        ...(rawDiffers && !truncated && isWhitespaceOnlyDiff(diff) ? ['', WHITESPACE_ONLY_NOTE] : []),
    ];
}

/**
 * Tell whether a line diff only contains whitespace changes: the removed lines
 * equal the added lines once trailing whitespace is ignored (trivially true
 * when there are no removed or added lines).
 * @param {string[]} diff output of `diffLines`
 * @returns {boolean}
 */
function isWhitespaceOnlyDiff(diff) {
    const removed = diff.filter(line => line.startsWith('-')).map(line => line.slice(2).trimEnd());
    const added = diff.filter(line => line.startsWith('+')).map(line => line.slice(2).trimEnd());

    return removed.length === added.length && removed.every((line, index) => line === added[index]);
}

/**
 * Line diff from a longest-common-subsequence table. Every line is a marker, a
 * space, then the content: shared lines get two spaces, expected-only lines
 * `- `, received-only lines `+ ` (removals first). The separating space keeps
 * content such as `-1` readable and the columns aligned.
 * @param {string[]} expected
 * @param {string[]} received
 * @returns {string[]}
 */
function diffLines(expected, received) {
    // common[i][j] = length of the LCS of expected[i..] and received[j..].
    const common = Array.from({ length: expected.length + 1 }, () => new Array(received.length + 1).fill(0));
    for (let i = expected.length - 1; i >= 0; i -= 1) {
        for (let j = received.length - 1; j >= 0; j -= 1) {
            common[i][j] = expected[i] === received[j]
                ? common[i + 1][j + 1] + 1
                : Math.max(common[i + 1][j], common[i][j + 1]);
        }
    }

    const diff = [];
    let i = 0;
    let j = 0;
    while (i < expected.length || j < received.length) {
        if (i < expected.length && j < received.length && expected[i] === received[j]) {
            diff.push(`  ${expected[i]}`);
            i += 1;
            j += 1;
        } else if (j >= received.length || (i < expected.length && common[i + 1][j] >= common[i][j + 1])) {
            diff.push(`- ${expected[i]}`);
            i += 1;
        } else {
            diff.push(`+ ${received[j]}`);
            j += 1;
        }
    }
    return diff;
}

/**
 * Escape a user- or server-provided value for inline Markdown so it renders as
 * the plain text it is: newlines collapse to spaces, HTML `< > &` become
 * entities, Markdown control characters and every `#` are backslash-escaped
 * (a trailing `#` would otherwise close an ATX heading), and a leading `+`,
 * `-`, `=` or `1.` that could start a block is escaped too.
 * @param {unknown} value
 * @returns {string}
 */
function escapeInline(value) {
    return toText(value)
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f\s]+/g, ' ')
        .replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char])
        .replace(/[\\`*_[\]~|#]/g, '\\$&')
        .replace(/^([+\-=])/, '\\$1')
        .replace(/^(\d+)([.)])/, '$1\\$2');
}

/**
 * Wrap text in a fenced code block whose fence is longer than any backtick
 * run inside the text, so judge output cannot break out of the block.
 * @param {string} text
 * @param {string} [language] fence info string, `text` by default
 * @returns {string}
 */
function fence(text, language = 'text') {
    const longestRun = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length));
    const marker = '`'.repeat(longestRun + 1);
    return `${marker}${language}\n${text}\n${marker}`;
}

/**
 * Pluralize a count: `1 attempt`, `2 attempts`.
 * @param {number} count
 * @param {string} noun
 * @returns {string}
 */
function pluralize(count, noun) {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Trim a value to text, treating null and undefined as ''.
 * @param {unknown} value
 * @returns {string}
 */
function toText(value) {
    return value == null ? '' : String(value).trim();
}
