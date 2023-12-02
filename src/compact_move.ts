import PATH from 'node:path';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { NT } from './gen/pbjs_pb';

const infile = PATH.resolve(__dirname, '../ndjson');

type Stat = { min: number; max: number; zero: number; nan: number };
type StatKey = 'x' | 'y' | 'armR' | 'armScaleY' | 'scaleX' | 'anim' | 'held';
const stats: { [K in StatKey]: Stat } & { messages: number } = {
  messages: 0,
  x: { min: Infinity, max: -Infinity, zero: 0, nan: 0 },
  y: { min: Infinity, max: -Infinity, zero: 0, nan: 0 },
  armR: { min: Infinity, max: -Infinity, zero: 0, nan: 0 },
  armScaleY: { min: Infinity, max: -Infinity, zero: 0, nan: 0 },
  scaleX: { min: Infinity, max: -Infinity, zero: 0, nan: 0 },
  anim: { min: Infinity, max: -Infinity, zero: 0, nan: 0 },
  held: { min: Infinity, max: -Infinity, zero: 0, nan: 0 },
};

const addStat = (key: StatKey, v: number) => {
  if (isNaN(v)) {
    stats[key].nan++;
    return true;
  }
  stats[key].min = Math.min(stats[key].min, v);
  stats[key].max = Math.max(stats[key].max, v);
  if (v === 0) stats[key].zero++;
  return false;
};
const addStats = (obj: any) => {
  let s = false;
  s ||= addStat('x', obj.x);
  s ||= addStat('y', obj.y);
  s ||= addStat('armR', obj.armR);
  s ||= addStat('armScaleY', obj.armScaleY);
  s ||= addStat('scaleX', obj.scaleX);
  s ||= addStat('anim', obj.anim);
  s ||= addStat('held', obj.held);
  if (s) {
    console.log(obj);
    process.exit(1);
  }
};

let lastStats = Date.now() + 5000;

const DELTA_FACTOR = 2 ** 6;
const ROT_FACTOR = 2 ** 7;

/**
 * Create an encoder-decoder pair for lossy-encoding radian
 * values (`armR`) to integers that can be compactly encoded
 * as varints.
 * @param targetBytes The size, in bytes, of encoded values
 * when serialized as a varint
 */
export const createArmrCoder = (targetBytes: number) => {
  const factor = 2 ** (7 * targetBytes);
  const pi2 = Math.PI * 2 + 1;

  return {
    /**
     * Lossily encode `v`, a value in radians between -PI and PI,
     * as an unsigned integer to fit within `targetBytes` of
     * serialized protobuf output.
     * @see {createArmrCoder}
     */
    encodeArmR: (v: number) => (((v + Math.PI) * factor) / pi2) | 0,
    /**
     * Decode a lossily-encoded value `v` to a value in radians
     * between -PI and PI.
     * @see {createArmrCoder}
     */
    decodeArmR: (v: number) => (v * pi2) / factor - Math.PI,
  };
};

export const createDeltaCoder = (fractionalDigits: number) => {
  const factor = 10 ** fractionalDigits;
  return {
    encodeDelta: (len: number, get: (i: number) => number): { init: number; deltas: number[] } => {
      if (len === 0) return { init: 0, deltas: [] };

      const init = get(0);
      const deltas: number[] = [];

      if (typeof init !== 'number') throw new Error('Invalid value');

      let last = init;
      for (let i = 1; i < len; i++) {
        const val = get(i);
        if (typeof val !== 'number') throw new Error('Invalid value');

        const d = Math.round((val - last) * factor);
        deltas.push(d);
        last += d / factor; // ameliorate rounding errors
      }
      return { init, deltas };
    },
    decodeDelta: (init: number, deltas: number[], set: (i: number, v: number) => void): void => {
      let cum = init;
      set(0, cum);
      for (let i = 0; i < deltas.length; i++) {
        cum += deltas[i] / factor;
        set(i + 1, cum);
      }
    },
  };
};

export const encodeBitfield = (len: number, next: (i: number) => number): number => {
  if (len > 32) throw new Error('Cannot encode more than 32 values in a bitfield');
  let res = 0;
  for (let i = 0; i < len; i++) {
    const val = next(i);
    // values must be -1 or 1
    if (val !== -1 && val !== 1) throw new Error('Invalid value: ' + val);
    res |= ((val + 1) >>> 1) << i;
    // javascript bitwise operations operate on 32-bit signed integers
  }
  return res >>> 0; // convert to unsigned
};
export const decodeBitfield = (len: number, val: number, set: (i: number, val: number) => void): void => {
  if (len > 32) throw new Error('Cannot encode more than 32 values in a bitfield');
  for (let i = 0; i < len; i++) {
    set(i, ((val & 1) << 1) - 1);
    val >>>= 1;
  }
};

export const encodeStable = (len: number, get: (i: number) => number): { idxs: number[]; vals: number[] } => {
  let last = 0;
  const idxs: number[] = [];
  const vals: number[] = [];
  for (let i = 0; i < len; i++) {
    const val = get(i);
    if (val === last) continue;
    idxs.push(i);
    vals.push(val);
    last = val;
  }
  return { idxs, vals };
};
export const decodeStable = (
  len: number,
  idxs: number[],
  vals: number[],
  set: (i: number, val: number) => void,
): void => {
  if (idxs.length !== vals.length) throw new Error('Invalid data: arrays must be same length');
  let cur = 0;
  for (let i = 0, pos = 0; i < len; i++) {
    if (idxs[pos] === i) {
      cur = vals[pos];
      pos++;
    }
    set(i, cur);
  }
};

const { encodeArmR, decodeArmR } = createArmrCoder(1);
const { encodeDelta, decodeDelta } = createDeltaCoder(1);

export const encodeFrames = (frames: NT.PlayerFrame[]): NT.CompactPlayerFrames => {
  const numFrames = frames.length;
  if (numFrames === 0) return new NT.CompactPlayerFrames();
  if (numFrames > 32) throw new Error('cannot compact more than 32 frames');

  const { init: xInit, deltas: xDeltas } = encodeDelta(numFrames, (i) => frames[i]!.x!);
  const { init: yInit, deltas: yDeltas } = encodeDelta(numFrames, (i) => frames[i]!.y!);
  const armR: number[] = frames.map((f) => encodeArmR(f.armR!));
  const armScaleY = encodeBitfield(numFrames, (i) => frames[i]!.armScaleY!);
  const scaleX = encodeBitfield(numFrames, (i) => frames[i]!.scaleX!);
  const { idxs: animIdx, vals: animVal } = encodeStable(numFrames, (i) => frames[i]!.anim!);
  const { idxs: heldIdx, vals: heldVal } = encodeStable(numFrames, (i) => frames[i]!.held!);

  return new NT.CompactPlayerFrames({
    xInit,
    xDeltas,
    yInit,
    yDeltas,
    armR,
    armScaleY,
    scaleX,
    animIdx,
    animVal,
    heldIdx,
    heldVal,
  });
};

const getBit = (v: number, i: number) => (((v >>> i) & 1) << 1) - 1;
export const decodeFrames = (pm: NT.CompactPlayerFrames): NT.PlayerFrame[] => {
  const numFrames = pm.armR.length;
  const frames: NT.PlayerFrame[] = new Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    frames[i] = new NT.PlayerFrame({ armR: decodeArmR(pm.armR[i]) });
  }
  decodeDelta(pm.xInit, pm.xDeltas, (i, v) => {
    frames[i].x = v;
  });
  decodeDelta(pm.yInit, pm.yDeltas, (i, v) => {
    frames[i].y = v;
  });
  decodeBitfield(numFrames, pm.armScaleY, (i, v) => {
    frames[i].armScaleY = v;
  });
  decodeBitfield(numFrames, pm.scaleX, (i, v) => {
    frames[i].scaleX = v;
  });
  decodeStable(numFrames, pm.animIdx, pm.animVal, (i, v) => (frames[i].anim = v));
  decodeStable(numFrames, pm.heldIdx, pm.heldVal, (i, v) => (frames[i].held = v));

  return frames;
};

const diffFrame = (
  a: NT.PlayerFrame,
  b: NT.PlayerFrame,
  xyTolerance: number = 0.051,
  armrTolerance: number = (Math.PI * 2 + 1) / 2 ** 7,
) => {
  let samey = true;
  samey &&= Math.abs(a.x! - b.x!) < xyTolerance;
  samey &&= Math.abs(a.y! - b.y!) < xyTolerance;
  samey &&= Math.abs(a.armR! - b.armR!) < armrTolerance;
  samey &&= a.armScaleY === b.armScaleY;
  samey &&= a.scaleX === b.scaleX;
  samey &&= a.held === b.held;
  samey &&= a.anim === b.anim;
  if (samey) return;
  return {
    x: b.x! - a.x!,
    y: b.y! - a.y!,
    armR: b.armR! - a.armR!,
    armScaleY: [a.armScaleY, b.armScaleY],
    scaleX: [a.scaleX, b.scaleX],
    held: [a.held, b.held],
    anim: [a.anim, b.anim],
  };
};
const diffFrames = (a: NT.PlayerFrame[], b: NT.PlayerFrame[]) => {
  for (let i = 0; i < a.length; i++) {
    const diff = diffFrame(a[i], b[i]);
    if (diff) return { i, ...diff };
  }
};

const calcPrecision = (
  { x, y, armR }: { x: number; y: number; armR: number },
  a: NT.PlayerFrame[],
  b: NT.PlayerFrame[],
) => {
  for (let i = 0; i < a.length; i++) {
    x = Math.max(x, Math.abs(a[i].x! - b[i].x!));
    y = Math.max(y, Math.abs(a[i].y! - b[i].y!));
    armR = Math.max(armR, Math.abs(b[i].armR! - a[i].armR!));
  }
  return { x, y, armR };
};

const bytesAt = (players: number, bytes: number) => bytes * (players + 1);

let oldSize = 0;
let newSize = 0;
let lineCount = 0;
if (require.main === module) {
  (async function processLineByLine() {
    try {
      const rl = createInterface({
        input: createReadStream(infile),
        crlfDelay: Infinity,
      });

      let prec = { x: 0, y: 0, armR: 0 };

      rl.on('line', (line) => {
        const obj = JSON.parse(line);
        if (!obj.frames || !obj.frames.length) return;
        oldSize += NT.OldClientPlayerMove.encode(obj).finish().length;
        const compact = encodeFrames(obj.frames);
        newSize += NT.CompactPlayerFrames.encode(compact).finish().length;
        const roundtrip = decodeFrames(compact);
        const diff = diffFrames(obj.frames, roundtrip);
        if (diff) {
          console.log(lineCount);
          console.log(diff);
          process.exit();
        }
        prec = calcPrecision(prec, obj.frames, roundtrip);
        lineCount++;
        //   stats.messages++;
        //   try {
        //     obj.frames.forEach((frame: any) => addStats(frame));
        //   } catch (e) {}
        //   if (Date.now() > lastStats) {
        //     console.log(stats);
        //     lastStats = Date.now() + 5000;
        //   }
      });

      await once(rl, 'close');

      console.log('File processed.');
      const oldSizeAt90 = bytesAt(90, oldSize);
      const newSizeAt90 = bytesAt(90, newSize);
      console.log({
        oldSize: oldSize.toLocaleString() + 'b',
        oldSizeAt90: oldSizeAt90.toLocaleString() + 'b',
        newSize: newSize.toLocaleString() + 'b',
        newSizeAt90: newSizeAt90.toLocaleString() + 'b',
        pctAt90: ((100 * newSizeAt90) / oldSizeAt90).toFixed(2) + '%',
      });
      console.log(prec);
      // console.log(stats);
    } catch (err) {
      console.error(err);
    }
  })();
}
