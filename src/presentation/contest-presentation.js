import { isPassedSubmission, isPendingSubmission } from '../utils/submission-status.js';
import { countSolvedProblems, normalizeStandingScore, resolveStandingTeams } from '../utils/standings.js';
import { resolveRouteId, sameEntity, sameTeam } from '../utils/public-id.js';
import { formatDuration, formatLocalDateTime, formatMinutes, formatRelativeTime } from '../utils/time-format.js';
import { getContestDurationMinutes, getContestTiming, getProblemLetter, sortProblems, summarizeProblemSubmissions } from '../utils/contest-progress.js';
import { extractPublicCases } from '../workspace/contest-public-cases.js';

/*
 * Page layout shared by every generated Markdown page (problem, submission,
 * team standing, contest overview), so contestants scan them the same way:
 *
 *   # Title
 *
 *   One-line summary sentence.
 *
 *   - **Label:** value          <- definition-style field list (no tables, so
 *   - **Label:** value             team names with `|` cannot break the layout)
 *
 *   ## Section                   <- optional sections (statement, hint, cases)
 *
 * Fields whose value is missing are omitted instead of rendering `undefined`.
 */

const MINUTE_MS = 60 * 1000;
const MAX_FILE_NAME_LENGTH = 80;
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
 * Build the explorer contest header description with the current team.
 * @param {{ name?: string } | undefined | null} team
 * @returns {string}
 */
export function buildContestHeaderDescription(team) {
    return team?.name?.toString().trim() || 'Unknown Team';
}

/**
 * Format a time score or penalty in milliseconds as minutes.
 * @deprecated Use `formatMinutes` from `src/utils/time-format.js`.
 * @param {number} ms
 * @returns {string}
 */
export function formatProblemScore(ms) {
    return formatMinutes(ms);
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
        `# ${getProblemPageName(problem, problems)}`,
        '',
        describeProblemProgress(problem, submissions),
        '',
    ];

    const statement = getProblemStatement(problem);
    lines.push(statement ? statement.trim() : '*The statement is not available in the current contest data.*');

    const casesTable = buildPublicCasesTable(problem);
    if (casesTable) {
        lines.push('', casesTable);
    }

    return `${lines.join('\n')}\n`;
}

/**
 * Render one submission: verdict, problem, local submit time, time or penalty,
 * file details, judge hint, and expected versus received output.
 * @param {object} submission
 * @param {{ problems?: object[] }} [options]
 * @param {object[]} [options.problems] all contest problems, used for the letter
 * @returns {string}
 */
export function renderSubmissionDetails(submission, { problems = [] } = {}) {
    const verdict = formatSubmissionStatus(submission?.status);
    const problemLabel = formatSubmissionProblemLabel(submission?.problem, problems);
    const relative = formatRelativeTime(submission?.submittedAt);

    const lines = [
        `# ${getSubmissionHeading(submission)}`,
        '',
        describeSubmission(submission, verdict, problemLabel),
        '',
    ];

    const submittedAt = submission?.submittedAt
        ? `${formatLocalDateTime(submission.submittedAt)}${relative ? ` (${relative})` : ''}`
        : '';

    lines.push(...renderFields([
        ['Verdict', verdict],
        ['Problem', problemLabel],
        ['Submitted', submittedAt],
        [isPassedSubmission(submission?.status) ? 'Time' : 'Penalty', formatOptionalMinutes(submission?.score)],
        ['File', submission?.filename ?? submission?.fileName],
        ['Language', submission?.language],
    ]));

    const hint = submission?.hint ?? {};
    const hintMessage = toText(hint.message);
    if (hintMessage) {
        lines.push('', '## Hint', '', fence(hintMessage));
    }

    const hasExpected = hint.expected != null;
    const hasReceived = hint.received != null;
    if (hasExpected || hasReceived) {
        lines.push('', '## Expected vs received output');
        if (hasExpected && hasReceived) {
            lines.push('', 'For a side-by-side diff, right-click the submission in Contest Explorer and choose **Compare Expected and Received Output**.');
        }
        if (hasExpected) {
            lines.push('', '### Expected', '', fence(String(hint.expected).trimEnd()));
        }
        if (hasReceived) {
            lines.push('', '### Received', '', fence(String(hint.received).trimEnd()));
        }
    }

    return `${lines.join('\n')}\n`;
}

/**
 * Render one team's standing: rank, solved count, total time, and the solved
 * problems as a lettered list.
 * @param {object} team
 * @param {{ contest?: object, problems?: object[] } | null | undefined} snapshot
 * @returns {string}
 */
export function renderTeamStandingDetails(team, snapshot) {
    const contest = snapshot?.contest;
    const standings = contest ? resolveStandingTeams(contest) : [];
    const index = standings.findIndex(entry => sameTeam(entry, team));
    const standing = index === -1 ? team : standings[index];
    const rank = index === -1 ? null : standing.rank ?? index + 1;

    const problems = sortProblems(contest?.problems ?? snapshot?.problems);
    const solvedIds = Array.isArray(standing?.solvedProblemIds) ? standing.solvedProblemIds : [];
    const solvedProblems = problems.filter(problem => solvedIds.includes(resolveRouteId(problem)));
    const solvedCount = solvedProblems.length || countSolvedProblems(standing);
    const totalTime = formatMinutes(normalizeStandingScore(standing));
    const name = getTeamPageName(team);

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
            lines.push(`- ${formatProblemLabel(problem, problems)}`);
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
 * @param {{ team?: object, submissions?: object[], problems?: object[] }} [options]
 * @param {object} [options.team] the signed-in team, for its rank and solved count
 * @param {object[]} [options.submissions] the team's submissions (accepted for API symmetry; not shown yet)
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
        `# ${getContestPageName(contest)}`,
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
        const index = standings.findIndex(entry => sameTeam(entry, team));
        const standing = standings[index];
        lines.push('', `## ${getTeamPageName(team)}`, '');
        lines.push(...renderFields([
            ['Rank', standing ? `#${standing.rank ?? index + 1} of ${standings.length}` : '—'],
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
 * Write the one-line submission summary sentence.
 * @param {object} submission
 * @param {string} verdict
 * @param {string} problemLabel
 * @returns {string}
 */
function describeSubmission(submission, verdict, problemLabel) {
    const target = problemLabel ? ` for ${problemLabel}` : '';
    if (isPendingSubmission(submission?.status)) {
        return `**${verdict}**${target} — still being judged.`;
    }
    return `**${verdict}**${target}.`;
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
 * Label a problem as `A. Title`, falling back to the title (or `Problem`)
 * when no letter can be resolved.
 * @param {object} problem
 * @param {object[]} problems
 * @returns {string}
 */
function formatProblemLabel(problem, problems) {
    const letter = getProblemLetter(problem, problems);
    const title = toText(problem?.title) || toText(problem?.name);
    if (letter) {
        return title ? `${letter}. ${title}` : `Problem ${letter}`;
    }
    return title || 'Problem';
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
 * Render the public input/output pairs as a Markdown table numbered from 1,
 * matching the exported testcase files. Returns '' when there are none.
 * @param {object} problem
 * @returns {string}
 */
function buildPublicCasesTable(problem) {
    const publicCases = extractPublicCases(problem);
    if (!publicCases.length) {
        return '';
    }

    return [
        '## Public test cases',
        '',
        '| # | Input | Output |',
        '| :-- | :-- | :-- |',
        ...publicCases.map((testCase, index) =>
            `| ${index + 1} | ${formatTableCell(testCase.input)} | ${formatTableCell(testCase.output)} |`),
    ].join('\n');
}

/**
 * Keep multiline text readable inside a Markdown table cell: encode HTML,
 * pipe, and Markdown emphasis characters as entities (so `a*b*c` stays
 * literal), preserve whitespace that HTML would collapse (tabs become four
 * spaces, leading and trailing spaces and extra spaces in a run become
 * `&nbsp;`), and join lines with `<br>`.
 * @param {unknown} value
 * @returns {string}
 */
function formatTableCell(value) {
    const lines = String(value ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/\n+$/, '')
        .split('\n')
        .map(line => line
            .replace(/[&<>|*_`[\]\\~]/g, char => `&#${char.charCodeAt(0)};`)
            .replace(/\t/g, '    ')
            .replace(/^ +| +$| {2,}/g, (spaces, offset, text) => {
                const internal = offset > 0 && offset + spaces.length < text.length;
                // An internal run keeps one breakable space; the rest cannot collapse.
                return internal ? ` ${'&nbsp;'.repeat(spaces.length - 1)}` : '&nbsp;'.repeat(spaces.length);
            }));

    return `<code>${lines.join('<br>')}</code>`;
}

/**
 * Wrap text in a fenced code block whose fence is longer than any backtick
 * run inside the text, so judge output cannot break out of the block.
 * @param {string} text
 * @returns {string}
 */
function fence(text) {
    const longestRun = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length));
    const marker = '`'.repeat(longestRun + 1);
    return `${marker}text\n${text}\n${marker}`;
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
