/**
 * Stable command and view identifiers used across the contest extension.
 */
export const CONTEST_VIEW_ID = 'autojudgeContest.explorer';
export const TEAMS_VIEW_ID = 'autojudgeContest.teams';

/**
 * Stable context keys used by view gating and selection-aware toolbar actions.
 */
export const CONTEXT_KEYS = Object.freeze({
    STATE: 'autojudgeContest.state',
    // True while Contest Explorer lists only unsolved problems.
    UNSOLVED_ONLY: 'autojudgeContest.unsolvedOnly',
});

/**
 * Values of the `autojudgeContest.state` context key. `loading` covers the first
 * session restore, and `offline` means a stored session could not be loaded
 * because the server was unreachable (the token is kept).
 */
export const VIEW_STATES = Object.freeze({
    LOADING: 'loading',
    LOGGED_IN: 'loggedIn',
    LOGGED_OUT: 'loggedOut',
    OFFLINE: 'offline',
});

/**
 * Stable command identifiers used by the manifest, tree items, and activation flow.
 */
export const COMMANDS = Object.freeze({
    LOGIN_TEAM: 'autojudgeContest.loginTeam',
    LOGOUT_TEAM: 'autojudgeContest.logoutTeam',
    OPEN_PROBLEM: 'autojudgeContest.openProblem',
    EXPORT_PUBLIC_CASES: 'autojudgeContest.exportPublicCases',
    OPEN_SUBMISSION: 'autojudgeContest.openSubmission',
    OPEN_TEAM_STANDING: 'autojudgeContest.openTeamStanding',
    OPEN_STANDINGS: 'autojudgeContest.openStandings',
    REFRESH_TREE: 'autojudgeContest.refreshTree',
    OPEN_CONTEST_DASHBOARD: 'autojudgeContest.openContestDashboard',
    SUBMIT_ACTIVE_FILE: 'autojudgeContest.submitActiveFile',
    COMPARE_SUBMISSION_OUTPUT: 'autojudgeContest.compareSubmissionOutput',
    SHOW_UNSOLVED_PROBLEMS: 'autojudgeContest.showUnsolvedProblems',
    SHOW_ALL_PROBLEMS: 'autojudgeContest.showAllProblems',
});

/**
 * Tree item context values used by manifest menus.
 */
export const TREE_CONTEXT = Object.freeze({
    CONTEST: 'autojudgeContest.contest',
    PROBLEM: 'autojudgeContest.problem',
    STANDING_TEAM: 'autojudgeContest.standingTeam',
    SUBMISSION: 'autojudgeContest.submission',
    // A submission whose hint carries both expected and received output, so it can be diffed.
    SUBMISSION_WITH_OUTPUT: 'autojudgeContest.submission.output',
});