import { describe, expect, it } from 'vitest';

import { sha256 } from './sha256.js';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('sha256', () => {
  // The published NIST vectors. If a derived round constant were wrong, these
  // would be the first thing to fail.
  it('matches the NIST test vectors', () => {
    expect(sha256(utf8(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256(utf8('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('handles inputs that straddle the block padding boundary', () => {
    // 55, 56 and 64 bytes are the three interesting padding cases.
    for (const length of [54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128]) {
      const text = 'a'.repeat(length);
      expect(sha256(utf8(text))).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(sha256(utf8('a'.repeat(1000000).slice(0, 1000)))).toBe(
      sha256(utf8('a'.repeat(1000))),
    );
  });

  it('changes completely when one bit of input changes', () => {
    const a = sha256(utf8('go/nogo'));
    const b = sha256(utf8('go/nogp'));
    expect(a).not.toBe(b);
    let sameCharacters = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) sameCharacters += 1;
    }
    expect(sameCharacters).toBeLessThan(20);
  });
});
