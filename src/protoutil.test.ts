import { NT } from './gen/pbjs_pb';
import { maybePlayerMove, tagPlayerMove } from './protoutil';

const asSingle = (v: number) => {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(v, 0);
  return buf.readFloatBE(0);
};

describe('PlayerMove userId tagging', () => {
  it('works with empty frames', () => {
    const buf = Buffer.from('0a020a00', 'hex');
    const mpm = maybePlayerMove(buf);
    expect(mpm).toBeDefined();
    const tagged = tagPlayerMove(mpm!, Buffer.from('foo'));
    expect(tagged).toBeDefined();
    expect(NT.Envelope.decode(tagged!).toJSON()).toEqual({
      gameAction: {
        sPlayerMoves: {
          userFrames: [
            {
              userId: 'foo',
            },
          ],
        },
      },
    });
  });
  it('works as expected', () => {
    const frames: NT.ICompactPlayerFrames = {
      xInit: 1.3,
      xDeltas: [1, -1],
      yInit: -1.3,
      yDeltas: [1, -1],
      animIdx: [1],
      animVal: [1],
      armR: [1],
      armScaleY: 1,
      scaleX: 1,
      heldIdx: [1],
      heldVal: [1],
    };

    const encoded = NT.Envelope.encode({ gameAction: { cPlayerMove: frames } }).finish();
    const playerMovePayload = maybePlayerMove(Buffer.from(encoded));
    expect(playerMovePayload).toBeDefined();

    const pmId = Buffer.from('12345');
    const tagged = tagPlayerMove(playerMovePayload!, pmId);
    expect(tagged).toBeDefined();

    const decoded = NT.Envelope.decode(tagged!);
    const expected: NT.IEnvelope = {
      gameAction: {
        sPlayerMoves: {
          userFrames: [
            {
              ...frames,
              userId: '12345',
              xInit: asSingle(frames.xInit!),
              yInit: asSingle(frames.yInit!),
            },
          ],
        },
      },
    };
    expect(decoded.toJSON()).toEqual(expected);
  });
  // protobuf.js fails to merge messages when decoding
  it.skip('correctly supports concatenation (protobuf.js)', () => {
    const frames: NT.ICompactPlayerFrames = {
      xInit: 1.3,
      xDeltas: [1, -1],
      yInit: -1.3,
      yDeltas: [1, -1],
      animIdx: [1],
      animVal: [1],
      armR: [1],
      armScaleY: 1,
      scaleX: 1,
      heldIdx: [1],
      heldVal: [1],
    };

    const encoded = NT.Envelope.encode({ gameAction: { cPlayerMove: frames } }).finish();
    const playerMovePayload = maybePlayerMove(Buffer.from(encoded));
    expect(playerMovePayload).toBeDefined();

    const pmId = Buffer.from('12345');
    const tagged = tagPlayerMove(playerMovePayload!, pmId);
    expect(tagged).toBeDefined();

    const encoded2 = NT.Envelope.encode({ gameAction: { cPlayerMove: frames } }).finish();
    const playerMovePayload2 = maybePlayerMove(Buffer.from(encoded2));
    expect(playerMovePayload2).toBeDefined();

    const pmId2 = Buffer.from('6789');
    const tagged2 = tagPlayerMove(playerMovePayload2!, pmId2);
    expect(tagged2).toBeDefined();

    const concatenated = Buffer.concat([tagged!, tagged2!]);
    const decoded = NT.Envelope.decode(concatenated);

    const expected: NT.IEnvelope = {
      gameAction: {
        sPlayerMoves: {
          userFrames: [
            {
              ...frames,
              userId: '12345',
              xInit: asSingle(frames.xInit!),
              yInit: asSingle(frames.yInit!),
            },
            {
              ...frames,
              userId: '6789',
              xInit: asSingle(frames.xInit!),
              yInit: asSingle(frames.yInit!),
            },
          ],
        },
      },
    };
    expect(decoded.toJSON()).toEqual(expected);
  });
  it('refuses client-supplied userId', () => {
    const frames: NT.ICompactPlayerFrames = {
      xInit: 1.3,
      xDeltas: [1, -1],
      yInit: -1.3,
      yDeltas: [1, -1],
      animIdx: [1],
      animVal: [1],
      armR: [1],
      armScaleY: 1,
      scaleX: 1,
      heldIdx: [1],
      heldVal: [1],
      userId: 'rejected',
    };
    const encoded = NT.Envelope.encode({ gameAction: { cPlayerMove: frames } }).finish();
    const playerMovePayload = maybePlayerMove(Buffer.from(encoded));
    expect(playerMovePayload).toBeDefined();

    const pmId = Buffer.from('12345');
    const tagged = tagPlayerMove(playerMovePayload!, pmId);
    expect(tagged).toBeUndefined();
  });
});
