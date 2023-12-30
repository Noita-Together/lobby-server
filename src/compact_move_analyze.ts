import PATH from 'node:path';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  NT,
  createArmrCoder,
  createDeltaCoder,
  decodeBitfield,
  decodeStable,
  encodeBitfield,
  encodeStable,
} from '@noita-together/nt-message';

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
