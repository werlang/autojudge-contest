/**
 * Normalize, sort, and enrich contest standings teams for shared controller and
 * provider use.
 * @param {object | undefined | null} contest
 * @returns {Array<object>}
 */
export function resolveStandingTeams(contest) {
    const rawTeams = Array.isArray(contest?.teams) ? contest.teams : [];

    return rawTeams
        .map(normalizeStandingTeam)
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }

            return left.name.localeCompare(right.name);
        });
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
 * Extract the solved problem labels from one standings entry. Matches on the
 * `solvedProblemIds` public keys when the server sends them, otherwise on the
 * legacy numeric `solvedProblems` list.
 * @param {object | undefined | null} team
 * @param {object[] | undefined | null} problems
 * @returns {string[]}
 */
export function extractSolvedProblemNames(team, problems) {
    const rawProblems = problems ? problems.filter(problem => isSolvedProblem(team, problem)) : [];

    return rawProblems
        .slice()
        .sort((left, right) => normalizeProblemOrder(left) - normalizeProblemOrder(right))
        .map(problem => resolveProblemName(problem))
        .filter(Boolean);
}

/**
 * Count the problems one standings entry has solved, using the same list that
 * `extractSolvedProblemNames` matches against.
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
    return team?.name?.toString().trim() || `Team #${team?.id ?? '?'}`;
}

/**
 * Check whether one contest problem is in the team's solved list. Public keys
 * are used when `solvedProblemIds` is present, numeric ids otherwise.
 * @param {object | undefined | null} team
 * @param {object | undefined | null} problem
 * @returns {boolean}
 */
function isSolvedProblem(team, problem) {
    const usesPublicIds = Array.isArray(team?.solvedProblemIds);
    const problemKey = usesPublicIds ? problem?.publicId : problem?.id;

    return problemKey != null && resolveSolvedProblemList(team).includes(problemKey);
}

/**
 * Return the solved list in the shape the server sent: public ids when
 * `solvedProblemIds` is present, legacy numeric ids otherwise.
 * @param {object | undefined | null} team
 * @returns {Array<string | number>}
 */
function resolveSolvedProblemList(team) {
    if (Array.isArray(team?.solvedProblemIds)) {
        return team.solvedProblemIds;
    }

    return Array.isArray(team?.solvedProblems) ? team.solvedProblems : [];
}

/**
 * Resolve the display label for one solved problem.
 * @param {unknown} problem
 * @returns {string}
 */
function resolveProblemName(problem) {
    if (typeof problem === 'string') {
        return problem.trim();
    }

    return problem?.title?.toString().trim()
        || problem?.name?.toString().trim()
        || problem?.problem?.title?.toString().trim()
        || '';
}

/**
 * Normalize problem ordering when standings data carries per-problem order.
 * @param {unknown} problem
 * @returns {number}
 */
function normalizeProblemOrder(problem) {
    const normalizedOrder = Number(problem?.order ?? problem?.problem?.order);
    return Number.isFinite(normalizedOrder) ? normalizedOrder : Number.MAX_SAFE_INTEGER;
}