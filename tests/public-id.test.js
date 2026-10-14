import { describe, expect, it } from 'vitest';
import { resolveRouteId, sameEntity, sameTeam } from '../src/utils/public-id.js';

describe('resolveRouteId', () => {
    it('routes contests and problems by their public id', () => {
        expect(resolveRouteId({ publicId: 'k3m9x2p7q8w1a' })).toBe('k3m9x2p7q8w1a');
    });

    it('trims surrounding whitespace from the public id', () => {
        expect(resolveRouteId({ publicId: ' k3m9x2p7q8w1a ' })).toBe('k3m9x2p7q8w1a');
    });

    it('treats a blank or missing public id as unroutable', () => {
        expect(resolveRouteId({ publicId: '   ' })).toBeNull();
        expect(resolveRouteId({ publicId: null })).toBeNull();
        expect(resolveRouteId({})).toBeNull();
        expect(resolveRouteId(undefined)).toBeNull();
        expect(resolveRouteId(null)).toBeNull();
    });

    it('ignores a numeric id even when no public id is present', () => {
        expect(resolveRouteId({ id: 4 })).toBeNull();
        expect(resolveRouteId({ id: 4, publicId: '' })).toBeNull();
    });

    it('routes teams by publicId and never by a numeric team id', () => {
        expect(resolveRouteId({ publicId: 'tbits91cd0000' })).toBe('tbits91cd0000');
        expect(resolveRouteId({ id: 12 })).toBeNull();
    });
});

describe('sameEntity', () => {
    it('matches entities by public id', () => {
        expect(sameEntity({ publicId: 'pa1b2c3d4e5f6' }, { publicId: 'pa1b2c3d4e5f6', title: 'A + B' })).toBe(true);
        expect(sameEntity({ publicId: 'pa1b2c3d4e5f6' }, { publicId: 'pb2c3d4e5f6a1' })).toBe(false);
    });

    it('ignores a shared numeric id', () => {
        expect(sameEntity({ id: 1 }, { id: 1 })).toBe(false);
        expect(sameEntity({ id: 1, publicId: 'pa1b2c3d4e5f6' }, { id: 1, publicId: 'pb2c3d4e5f6a1' })).toBe(false);
    });

    it('never matches entities when either side lacks a public id', () => {
        expect(sameEntity({ title: 'Ghost' }, { title: 'Ghost' })).toBe(false);
        expect(sameEntity({}, {})).toBe(false);
        expect(sameEntity(undefined, undefined)).toBe(false);
        expect(sameEntity({ publicId: 'pa1b2c3d4e5f6' }, { id: 1 })).toBe(false);
    });
});

describe('sameTeam', () => {
    it('matches teams by public id', () => {
        expect(sameTeam({ publicId: 'tbits91cd0000' }, { publicId: 'tbits91cd0000' })).toBe(true);
        expect(sameTeam({ publicId: 'tbits91cd0000' }, { publicId: 'tninjas7f3a00' })).toBe(false);
    });

    it('ignores a shared numeric team id', () => {
        expect(sameTeam({ id: 9 }, { id: 9 })).toBe(false);
        expect(sameTeam({ id: 9, publicId: 'tbits91cd0000' }, { id: 9, publicId: 'tninjas7f3a00' })).toBe(false);
    });

    it('never matches two teams without a public id', () => {
        expect(sameTeam({ name: 'Bits' }, { name: 'Bits' })).toBe(false);
        expect(sameTeam(undefined, undefined)).toBe(false);
    });
});
