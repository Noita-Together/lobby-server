import { Bitmap, RandomBitmap, RoomNameFailure, RoomNameSuccess, RoomTracker, SequentialBitmap } from './room_tracker';

describe('Bitmap', () => {
  it('correctly implements bitmap tracking', () => {
    const bmp = new Bitmap(129);
    for (let i = 0; i < 129; i++) {
      bmp['set'](i);
      expect(bmp['has'](i)).toEqual(true);
      bmp['clear'](i);
      expect(bmp['has'](i)).toEqual(false);
    }
  });
  it.each([
    [0, null],
    [128, null],
    [Infinity, TypeError],
    [NaN, TypeError],
    [1.23, TypeError],
    [-1, RangeError],
    [130, RangeError],
  ] as [v: number, err: Error | null][])('enforces valid `code` values: %s %s', (code, errorClass) => {
    const bmp = new Bitmap(129);
    if (errorClass === null) {
      expect(() => bmp['assertValidCode'](code)).not.toThrow();
    } else {
      expect(() => bmp['assertValidCode'](code)).toThrow(errorClass);
    }
  });
});
describe('RandomBitmap', () => {
  it('returns -1 when full', () => {
    const bmp = new RandomBitmap(1);
    expect(bmp.acquire()).toEqual(0);
    expect(bmp.acquire()).toEqual(-1);
  });
  it('correctly releases codes', () => {
    const bmp = new RandomBitmap(2);
    const code1 = bmp.acquire();
    const code2 = bmp.acquire();
    expect(code1).not.toEqual(code2);

    expect(code1).not.toEqual(-1);
    expect(code2).not.toEqual(-1);

    bmp.release(code1);
    bmp.release(code1);
    expect(bmp.acquire()).toEqual(code1);
    expect(bmp.acquire()).toEqual(-1);
  });
});
describe('SequentialBitmap', () => {
  it('returns -1 when full', () => {
    const bmp = new SequentialBitmap(1);
    expect(bmp.acquire()).toEqual(0);
    expect(bmp.acquire()).toEqual(-1);
  });
  it('correctly releases codes', () => {
    const bmp = new SequentialBitmap(2);

    const code = bmp.acquire();
    expect(code).toEqual(0);
    bmp.release(code);
    expect(bmp.acquire()).toEqual(0);
  });

  it.each([
    [-1, [~0]],
    [0, [~0b00000000000000000000000000000001]],
    [1, [~0b00000000000000000000000000000010]],
    [7, [~0b00000000000000000000000010000000]],
    [8, [~0b00000000000000000000000100000000]],
    [31, [~0b10000000000000000000000000000000]],
    [32, [~0, ~0b00000000000000000000000000000001]],
  ] as [number, number[]][])('correctly finds the next free code: %s', (code, bitmap) => {
    const size = Math.max(1, (Math.floor(code / 32) + 1) * 32);
    const bmp = new SequentialBitmap(size);
    for (const [idx, v] of bitmap.entries()) {
      bmp['bitmap'][idx] = v >>> 0;
    }
    bmp['minFree'] = 0;
    expect(bmp['nextFree']()).toEqual(code);
  });

  it('correctly returns the lowest available value', () => {
    const bmp = new SequentialBitmap(2);
    const code1 = bmp.acquire();
    const code2 = bmp.acquire();
    bmp.release(code1);
    expect(bmp.acquire()).toEqual(0);
  });
  it('does not return an invalid code from the last byte of a bitmap', () => {
    const bmp = new SequentialBitmap(33);
    bmp['bitmap'][0] = ~0 >>> 0;
    bmp['bitmap'][1] = 1;
    bmp['minFree'] = 0;
    expect(bmp['nextFree']()).toEqual(-1);
  });
});
describe('RoomTracker', () => {
  it('returns names -> numbers -> failure', () => {
    const rt = new RoomTracker([['a'], ['b']], 1);
    const r1 = rt.acquire() as RoomNameSuccess;
    expect(r1.ok).toEqual(true);
    expect(r1.name).toEqual('a b');

    const r2 = rt.acquire() as RoomNameSuccess;
    expect(r2.ok).toEqual(true);
    expect(r2.name).toEqual('Room #1');

    const r3 = rt.acquire() as RoomNameFailure;
    expect(r3.ok).toEqual(false);
    expect(r3.error).toEqual('No available room names');
  });
  it('correctly releases assigned names', () => {
    const rt = new RoomTracker([['a'], ['b']], 1);
    const r1 = rt.acquire() as RoomNameSuccess;
    expect(r1.ok).toEqual(true);
    expect(r1.name).toEqual('a b');

    const r2 = rt.acquire() as RoomNameSuccess;
    expect(r2.ok).toEqual(true);
    expect(r2.name).toEqual('Room #1');

    r1.release();
    const r3 = rt.acquire() as RoomNameSuccess;
    expect(r3.ok).toEqual(true);
    expect(r3.name).toEqual('a b');

    r2.release();
    const r4 = rt.acquire() as RoomNameSuccess;
    expect(r4.ok).toEqual(true);
    expect(r4.name).toEqual('Room #1');
  });
  it('works with no wordlists', () => {
    const rt = new RoomTracker([], 1);
    const r1 = rt.acquire() as RoomNameSuccess;
    expect(r1.ok).toEqual(true);
    expect(r1.name).toEqual('Room #1');
  });
  it('works with no wordlists and no capacity', () => {
    const rt = new RoomTracker([], 0);
    const r1 = rt.acquire() as RoomNameFailure;
    expect(r1.ok).toEqual(false);
    expect(r1.error).toEqual('No available room names');
  });
});
