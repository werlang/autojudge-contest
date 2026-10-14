/**
 * Choose the identifier to place in an API route for a contest, problem, or team.
 * Newer servers return `publicId`, which is used when present. Older servers only
 * return the numeric `id`, so it is kept as a fallback.
 * @param {{ publicId?: string | null, id?: number | string | null } | undefined | null} entity
 * @returns {string | number | null}
 */
export function resolveRouteId(entity) {
    const publicId = typeof entity?.publicId === 'string' ? entity.publicId.trim() : '';
    if (publicId) {
        return publicId;
    }

    return entity?.id ?? null;
}
