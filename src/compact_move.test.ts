import {
  createArmrCoder,
  createDeltaCoder,
  decodeBitfield,
  decodeStable,
  encodeBitfield,
  encodeStable,
} from './compact_move';
import { NT } from './gen/pbjs_pb';

describe('compact move encoding', () => {
  describe('armR encoding', () => {
    const tests: { targetBytes: number; maxError: number; value: number }[] = [
      { targetBytes: 1, maxError: (Math.PI * 2 + 1) / 2 ** 7 },
      { targetBytes: 2, maxError: (Math.PI * 2 + 1) / 2 ** 14 },
      { targetBytes: 3, maxError: (Math.PI * 2 + 1) / 2 ** 21 },
    ].flatMap((obj) =>
      [
        -Math.PI,
        -1,
        0,
        1,
        Math.PI,
        // fake fuzz testing. should complain enough if something is amiss
        Math.random() * (Math.PI * 2) - Math.PI,
        Math.random() * (Math.PI * 2) - Math.PI,
        Math.random() * (Math.PI * 2) - Math.PI,
        Math.random() * (Math.PI * 2) - Math.PI,
      ].map((value) => ({ ...obj, value })),
    );

    it.each(tests)('bytes<=$targetBytes maxError<=$maxError value=$value', ({ targetBytes, maxError, value }) => {
      const { encodeArmR, decodeArmR } = createArmrCoder(targetBytes);
      const encoded = encodeArmR(value);
      const roundtrip = decodeArmR(encoded);
      expect(Math.abs(roundtrip - value)).toBeLessThanOrEqual(maxError);
      const serialized = NT.CompactPlayerFrames.encode({ armR: [encoded] }).finish();
      const serializedSize = serialized.length - 2; // [tag][len][varint]
      expect(serializedSize).toBeLessThanOrEqual(targetBytes);
    });
  });
  describe('delta encoding', () => {
    const tests: { fractionalDigits: number; maxError: number; value: number }[] = [
      { fractionalDigits: 1, maxError: 0.1 / 2 },
      { fractionalDigits: 2, maxError: 0.01 / 2 },
      { fractionalDigits: 3, maxError: 0.001 / 2 },
    ].flatMap((obj) =>
      [
        5,
        5.49,
        5.51,
        1005,
        1005.49,
        1005.51,
        // fake fuzz testing. should complain enough if something is amiss
        1 + Math.random(),
        1 + Math.random(),
        1 + Math.random(),
        1 + Math.random(),
      ].map((value) => ({ ...obj, value })),
    );

    it.each(tests)(
      'fractionalDigits=$fractionalDigits maxError<=$maxError value=$value',
      ({ fractionalDigits, maxError, value }) => {
        const { encodeDelta, decodeDelta } = createDeltaCoder(fractionalDigits);

        const seq = [1, value];
        let i = 0;

        const { init, deltas } = encodeDelta(seq.length, () => seq[i++])!;

        const res: number[] = new Array(2);
        decodeDelta(init, deltas, (i, v) => {
          res[i] = v;
        });

        expect(res[0]).toEqual(seq[0]);
        expect(Math.abs(seq[1] - res[1])).toBeLessThanOrEqual(maxError);
      },
    );
    it('avoids cumulative error', () => {
      const vs = new Array(30).fill(1).map((v, idx) => idx * 1.05);
      const { encodeDelta, decodeDelta } = createDeltaCoder(1);
      const { init, deltas } = encodeDelta(30, (i) => vs[i]);
      const res: number[] = new Array(30);
      decodeDelta(init, deltas, (i, v) => {
        res[i] = v;
      });
      expect(Math.abs(res[29] - vs[29])).toBeLessThanOrEqual(0.051);
    });
  });
  describe('bitfield encoding', () => {
    const tests: { name: string; vs: number[] }[] = [
      { name: 'empty', vs: [] },
      { name: 'asymmetrical', vs: [-1, 1, 1, -1, -1] },
      { name: 'max length', vs: new Array(32).fill(1) },
    ];
    it.each(tests)('$name', ({ vs }) => {
      const encoded = encodeBitfield(vs.length, (i) => vs[i]);
      const decoded = new Array(vs.length);
      decodeBitfield(vs.length, encoded, (i, v) => {
        decoded[i] = v;
      });
      expect(decoded).toStrictEqual(vs);
    });
    it('throws on invalid values', () => {
      expect(() => encodeBitfield(1, () => 2)).toThrow('Invalid');
    });
    it('throws on too-long arrays', () => {
      expect(() => encodeBitfield(33, () => 1)).toThrow('Cannot encode');
    });
  });
  describe('stable value encoding', () => {
    const tests: { name: string; vs: number[] }[] = [
      { name: 'empty', vs: [] },
      { name: '0->1 midway', vs: [0, 0, 1, 1] },
      { name: '0->1->0', vs: [0, 1, 0] },
      { name: 'all 1', vs: [1, 1, 1] },
    ];
    it.each(tests)('$name', ({ vs }) => {
      const { idxs, vals } = encodeStable(vs.length, (i) => vs[i]);
      const decoded = new Array(vs.length);
      decodeStable(vs.length, idxs, vals, (i, v) => {
        decoded[i] = v;
      });
      expect(decoded).toStrictEqual(vs);
    });
    it('throws on mismatched inputs', () => {
      expect(() => {
        decodeStable(1, [], [1], () => {});
      }).toThrow('Invalid');
    });
  });
});
