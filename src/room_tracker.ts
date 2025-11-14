export class Bitmap {
  protected size: number;
  protected bitmap: Uint32Array;

  constructor(size: number) {
    if (size >= 2 ** 32) {
      throw new Error('Pool too large');
    }
    this.size = size;
    this.bitmap = new Uint32Array(Math.ceil(this.size / 32));
  }

  protected assertValidCode(code: number): void {
    if (!Number.isInteger(code)) {
      throw new TypeError('code is not an integer');
    }
    if (code < 0 || code >= this.size) {
      throw new RangeError(`code out of range (${code} not in 0-${this.size - 1})`);
    }
  }

  protected has(code: number): boolean {
    this.assertValidCode(code);
    const idx = code >> 5;
    const mask = 1 << (code & 0x1f);
    return (this.bitmap[idx] & mask) !== 0;
  }
  protected set(code: number): void {
    this.assertValidCode(code);
    const idx = code >> 5;
    const mask = 1 << (code & 0x1f);
    this.bitmap[idx] |= mask;
  }
  protected clear(code: number): void {
    this.assertValidCode(code);
    const idx = code >> 5;
    const mask = 1 << (code & 0x1f);
    this.bitmap[idx] &= ~mask;
  }
}

export class RandomBitmap extends Bitmap {
  acquire(): number {
    for (let i = 0; i < 10; i++) {
      const code = Math.floor(Math.random() * this.size);
      if (!this.has(code)) {
        this.set(code);
        return code;
      }
    }
    return -1;
  }
  release(code: number): void {
    this.clear(code);
  }
}

const rightmostFreeBit = (n: number) => Math.log2(((n + 1) & ~n) >>> 0);

export class SequentialBitmap extends Bitmap {
  private minFree: number = 0;

  private nextFree(): number {
    const nextN = this.minFree + 1;
    if (nextN === this.size) return -1;

    if (!this.has(nextN)) return nextN;

    const start = nextN >> 5;
    const freeIdx = this.bitmap.slice(start).findIndex((v) => v !== 0xffffffff) + start;
    if (freeIdx === -1) return -1;

    const bitPos = rightmostFreeBit(this.bitmap[freeIdx]);
    const nextFree = ((freeIdx << 5) | bitPos) >>> 0;
    return nextFree >= this.size ? -1 : nextFree;
  }
  acquire(): number {
    if (this.minFree === -1) return -1;
    const n = this.minFree;
    this.set(n);
    this.minFree = this.nextFree();
    return n;
  }
  release(code: number): void {
    this.clear(code);
    this.minFree = this.minFree === -1 ? code : Math.min(this.minFree, code);
  }
}

export type RoomNameSuccess = {
  ok: true;
  name: string;
  release: () => void;
};
export type RoomNameFailure = {
  ok: false;
  error: string;
};
export type RoomName = RoomNameSuccess | RoomNameFailure;

export class RoomTracker {
  protected wordSize: number;
  protected words: RandomBitmap;
  protected numberSize: number;
  protected numbers: SequentialBitmap;
  protected custom: Set<string>;

  constructor(
    protected wordlists: string[][],
    numberSize: number = 1000,
  ) {
    const filtered = wordlists.filter((v) => v.length > 0);
    this.wordSize = filtered.length > 0 ? wordlists.reduce((acc, cur) => acc * cur.length, 1) : 0;
    this.numberSize = numberSize;

    if (
      !Number.isInteger(this.wordSize) ||
      !Number.isInteger(this.numberSize) ||
      this.wordSize < 0 ||
      this.numberSize < 0
    ) {
      throw new Error('Invalid word/number size');
    }

    if (this.wordSize > Number.MAX_SAFE_INTEGER) {
      // with enough words in each list, or enough combinations, the code that
      // represents a word will get too large and our code will fail. but we'll
      // probably run out of memory before that happens...
      throw new Error('Too many combinations to represent!');
    }

    this.words = new RandomBitmap(this.wordSize);
    this.numbers = new SequentialBitmap(this.numberSize);
    this.custom = new Set<string>();
  }

  protected strname(code: number): string {
    const strs: string[] = [];
    let v = code;
    for (const list of this.wordlists) {
      const len = list.length;
      strs.push(list[v % len]);
      v = Math.floor(v / len);
    }
    return strs.join(' ');
  }

  public acquire(name: string | null = null): RoomName {
    // custom name, if given
    if (name) {
      if (this.custom.has(name)) {
        return {
          ok: false,
          error: 'Room name in use',
        };
      }
      this.custom.add(name);
      return {
        ok: true,
        name,
        release: () => this.custom.delete(name),
      };
    }
    if (this.wordSize > 0) {
      const combo = this.words.acquire();
      if (combo > -1) {
        return {
          ok: true,
          name: this.strname(combo),
          release: () => this.words.release(combo),
        };
      }
    }

    if (this.numberSize > 0) {
      const num = this.numbers.acquire();
      if (num > -1) {
        return {
          ok: true,
          name: `Room #${num + 1}`,
          release: () => this.numbers.release(num),
        };
      }
    }

    return {
      ok: false,
      error: 'No available room names',
    };
  }
}
