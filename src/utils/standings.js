import { sameTeam } from './public-id.js';

/**
 * Normalize, rank, and enrich contest standings teams for shared controller and
 * provider use. On the AutoJudge server `score` is the team's total time in
 * milliseconds (lower is better), so teams order by solved count descending,
 * then score ascending, then name. Teams tied on both solved count and score
 * share one `rank` (standard competition ranking: 1, 1, 3).
 * @param {object | undefined | null} contest
 * @returns {Array<object>} normalized teams, each carrying a 1-based `rank`
 */
export function resolveStandingTeams(contest) {
    const rawTeams = Array.isArray(contest?.teams) ? contest.teams : [];
    const sortedTeams = rawTeams
        .map(normalizeStandingTeam)
        .sort(compareStandingTeams);

    return sortedTeams.map((team, index) => {
        const previous = sortedTeams[index - 1];
        const tiedWithPrevious = previous && hasSameStanding(previous, team);

        // Ties inherit the previous team's rank; otherwise rank is the position.
        team.rank = tiedWithPrevious ? previous.rank : index + 1;
        return team;
    });
}

/**
 * Find a team's ranked standings entry (it always carries `rank`), or null when
 * the team is not in the contest standings.
 * @param {object | undefined | null} contest
 * @param {object | undefined | null} team
 * @param {Array<object>} [standings] already-resolved standings, to avoid ranking twice
 * @returns {object | null}
 */
export function findTeamStanding(contest, team, standings = resolveStandingTeams(contest)) {
    return standings.find(entry => sameTeam(entry, team)) ?? null;
}

/**
 * Order two normalized teams: more solved first, then lower total time, then name.
 * @param {object} left
 * @param {object} right
 * @returns {number}
 */
function compareStandingTeams(left, right) {
    const solvedDiff = countSolvedProblems(right) - countSolvedProblems(left);
    if (solvedDiff !== 0) {
        return solvedDiff;
    }

    if (left.score !== right.score) {
        return left.score - right.score;
    }

    return left.name.localeCompare(right.name);
}

/**
 * Check whether two teams are tied on both solved count and total time.
 * @param {object} left
 * @param {object} right
 * @returns {boolean}
 */
function hasSameStanding(left, right) {
    return countSolvedProblems(left) === countSolvedProblems(right) && left.score === right.score;
}

/**
 * Normalize one standings entry into a stable tree and output shape.
 * @param {object | undefined | null} team
 * @returns {object}
 */
export function normalizeStandingTeam(team) {
    return {
        ...team,
        name: resolveStandingTeamName(team),
        score: normalizeStandingScore(team),
    };
}

/**
 * Count the problems one standings entry has solved, from its `solvedProblemIds`.
 * The one solved-count source for standings rows, pages and the status bar.
 * @param {object | undefined | null} team
 * @returns {number}
 */
export function countSolvedProblems(team) {
    return resolveSolvedProblemList(team).length;
}

/**
 * Convert a team score field into a deterministic number for sorting and output.
 * @param {object | undefined | null} team
 * @returns {number}
 */
export function normalizeStandingScore(team) {
    const rawScore = Number(team?.score);
    const normalizedScore = Number.isFinite(rawScore) ? rawScore : 0;

    if (!Number.isFinite(normalizedScore)) {
        return 0;
    }

    return normalizedScore;
}

/**
 * Resolve the display name for one team standings row.
 * @param {object | undefined | null} team
 * @returns {string}
 */
function resolveStandingTeamName(team) {
    return team?.name?.toString().trim() || 'Unnamed team';
}

/**
 * Return the team's solved public ids, or an empty list when the server did not
 * send `solvedProblemIds`.
 * @param {object | undefined | null} team
 * @returns {string[]}
 */
function resolveSolvedProblemList(team) {
    return Array.isArray(team?.solvedProblemIds) ? team.solvedProblemIds : [];
}
