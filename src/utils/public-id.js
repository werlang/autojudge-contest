/**
 * Choose the identifier to place in an API route for a contest, problem, or team.
 * Newer servers return an opaque public key (`publicId` by default, `scoreboardId`
 * for teams), which is used when present. Older servers only return the numeric
 * `id`, so it is kept as a fallback.
 * @param {object | undefined | null} entity
 * @param {string} [idKey='publicId'] field that holds the preferred identifier
 * @returns {string | number | null}
 */
export function resolveRouteId(entity, idKey = 'publicId') {
    const preferredId = normalizeIdValue(entity?.[idKey]);
    if (preferredId != null) {
        return preferredId;
    }

    return entity?.id ?? null;
}

/**
 * Decide whether two contest or problem references point at the same entity.
 * Compares `publicId` when both carry one, otherwise the numeric `id` when both
 * carry one. Missing identifiers never match each other.
 * @param {object | undefined | null} left
 * @param {object | undefined | null} right
 * @returns {boolean}
 */
export function sameEntity(left, right) {
    return sharesIdentifier(left, right, ['publicId', 'id']);
}

/**
 * Decide whether two standings entries point at the same team. Compares
 * `scoreboardId` when both carry one, otherwise the numeric `id` when both carry
 * one. Missing identifiers never match each other.
 * @param {object | undefined | null} left
 * @param {object | undefined | null} right
 * @returns {boolean}
 */
export function sameTeam(left, right) {
    return sharesIdentifier(left, right, ['scoreboardId', 'id']);
}

/**
 * Compare the first identifier field that both entities carry.
 * @param {object | undefined | null} left
 * @param {object | undefined | null} right
 * @param {string[]} fields identifier fields in order of preference
 * @returns {boolean}
 */
function sharesIdentifier(left, right, fields) {
    for (const field of fields) {
        const leftValue = normalizeIdValue(left?.[field]);
        const rightValue = normalizeIdValue(right?.[field]);

        if (leftValue != null && rightValue != null) {
            return leftValue === rightValue;
        }
    }

    return false;
}

/**
 * Normalize one identifier value. Blank strings and non-finite numbers count as missing.
 * @param {unknown} value
 * @returns {string | number | null}
 */
function normalizeIdValue(value) {
    if (typeof value === 'string') {
        return value.trim() || null;
    }

    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
