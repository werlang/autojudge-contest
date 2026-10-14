import { describe, expect, it } from 'vitest';
import { resolveRouteId } from '../src/utils/public-id.js';

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
});
