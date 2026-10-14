import { describe, expect, it } from 'vitest';
import { resolveRouteId, sameEntity, sameTeam } from '../src/utils/public-id.js';

describe('resolveRouteId', () => {
    it('prefers the public id when the server returned one', () => {
        expect(resolveRouteId({ id: 4, publicId: 'k3m9x2p7q8w1a' })).toBe('k3m9x2p7q8w1a');
    });

    it('falls back to the numeric id for servers that do not send a public id', () => {
        expect(resolveRouteId({ id: 4 })).toBe(4);
    });

    it('treats a blank public id as missing and falls back to the numeric id', () => {
        expect(resolveRouteId({ id: 4, publicId: '   ' })).toBe(4);
        expect(resolveRouteId({ id: 4, publicId: null })).toBe(4);
    });

    it('trims surrounding whitespace from the public id', () => {
        expect(resolveRouteId({ id: 4, publicId: ' k3m9x2p7q8w1a ' })).toBe('k3m9x2p7q8w1a');
    });

    it('returns null when neither identifier is available', () => {
        expect(resolveRouteId({})).toBeNull();
        expect(resolveRouteId(undefined)).toBeNull();
        expect(resolveRouteId(null)).toBeNull();
    });

    it('routes teams by scoreboardId and falls back to the numeric team id', () => {
        expect(resolveRouteId({ id: 12, scoreboardId: 'sb-ninjas-7f3a' }, 'scoreboardId')).toBe('sb-ninjas-7f3a');
        expect(resolveRouteId({ id: 12 }, 'scoreboardId')).toBe(12);
        expect(resolveRouteId({ scoreboardId: 'sb-bits-91cd' }, 'scoreboardId')).toBe('sb-bits-91cd');
    });
});

describe('sameEntity', () => {
    it('matches entities by public id when both carry one', () => {
        expect(sameEntity({ publicId: 'pa1b2c3d4e5f6' }, { publicId: 'pa1b2c3d4e5f6', title: 'A + B' })).toBe(true);
        expect(sameEntity({ publicId: 'pa1b2c3d4e5f6' }, { publicId: 'pb2c3d4e5f6a1' })).toBe(false);
    });

    it('prefers the public id over a shared numeric id', () => {
        expect(sameEntity({ id: 1, publicId: 'pa1b2c3d4e5f6' }, { id: 1, publicId: 'pb2c3d4e5f6a1' })).toBe(false);
    });

    it('falls back to the numeric id when either side has no public id', () => {
        expect(sameEntity({ id: 1 }, { id: 1, publicId: 'pa1b2c3d4e5f6' })).toBe(true);
        expect(sameEntity({ id: 1 }, { id: 2, publicId: 'pa1b2c3d4e5f6' })).toBe(false);
    });

    it('never matches entities that carry no comparable identifier', () => {
        expect(sameEntity({ title: 'Ghost' }, { title: 'Ghost' })).toBe(false);
        expect(sameEntity({}, {})).toBe(false);
        expect(sameEntity(undefined, undefined)).toBe(false);
        expect(sameEntity({ publicId: 'pa1b2c3d4e5f6' }, { id: 1 })).toBe(false);
    });
});

describe('sameTeam', () => {
    it('matches teams by scoreboard id when both carry one', () => {
        expect(sameTeam({ scoreboardId: 'sb-bits-91cd', id: 9 }, { scoreboardId: 'sb-bits-91cd' })).toBe(true);
        expect(sameTeam({ scoreboardId: 'sb-bits-91cd' }, { scoreboardId: 'sb-ninjas-7f3a' })).toBe(false);
    });

    it('falls back to the numeric id for legacy teams', () => {
        expect(sameTeam({ id: 9 }, { id: 9 })).toBe(true);
        expect(sameTeam({ id: 9 }, { id: 12 })).toBe(false);
    });

    it('never matches two teams without any identifier', () => {
        expect(sameTeam({ name: 'Bits' }, { name: 'Bits' })).toBe(false);
        expect(sameTeam(undefined, undefined)).toBe(false);
    });
});
