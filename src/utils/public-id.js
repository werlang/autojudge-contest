/**
 * Choose the identifier placed in an API route (or a generated file name) for a
 * contest, problem, or team. Only `publicId` is routable.
 * @param {object | undefined | null} entity
 * @param {string} [idKey='publicId'] field that holds the public key
 * @returns {string | null}
 */
export function resolveRouteId(entity, idKey = 'publicId') {
    return normalizePublicKey(entity?.[idKey]);
}

/**
 * Decide whether two contest or problem references point at the same entity by
 * comparing `publicId`. Missing public ids never match each other.
 * @param {object | undefined | null} left
 * @param {object | undefined | null} right
 * @returns {boolean}
 */
export function sameEntity(left, right) {
    return sharesPublicKey(left, right, 'publicId');
}

/**
 * Decide whether two standings entries point at the same team by comparing
 * `publicId`. Missing public ids never match each other.
 * @param {object | undefined | null} left
 * @param {object | undefined | null} right
 * @returns {boolean}
 */
export function sameTeam(left, right) {
    return sharesPublicKey(left, right, 'publicId');
}

/**
 * Compare one public key field on two entities.
 * @param {object | undefined | null} left
 * @param {object | undefined | null} right
 * @param {string} field public key field to compare
 * @returns {boolean}
 */
function sharesPublicKey(left, right, field) {
    const leftKey = normalizePublicKey(left?.[field]);

    return leftKey != null && leftKey === normalizePublicKey(right?.[field]);
}

/**
 * Normalize one public key. Only non-blank strings count; numeric ids are not
 * public keys and always normalize to null.
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizePublicKey(value) {
    if (typeof value !== 'string') {
        return null;
    }

    return value.trim() || null;
}
