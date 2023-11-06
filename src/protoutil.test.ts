import { PlainMessage } from '@bufbuild/protobuf';
import { Envelope, GameAction } from './gen/messages_pb';
import { createPlayerPosition, lastPlayerPosition, maybePlayerMove, tagPlayerMove } from './protoutil';

const gameActionId = Envelope.fields.findJsonName('gameAction')!.no;
const playerMoveId = GameAction.fields.findJsonName('playerMove')!.no;

const asSingle = (v: number) => {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(v, 0);
  return buf.readFloatBE(0);
};

describe('lastPlayerPosition', () => {
  it('works as expected', () => {
    const frame = (x: number, y: number) => ({ x, y, anim: 1, armR: 0.872, armScaleY: 1, held: 1, scaleX: 1 });

    const encoded = Buffer.from(
      new Envelope({
        kind: {
          case: 'gameAction',
          value: {
            action: {
              case: 'playerMove',
              value: {
                frames: [frame(1, 2), frame(3, 4)],
              },
            },
          },
        },
      }).toBinary(),
    );

    const playerMovePayload = maybePlayerMove(encoded);

    expect(playerMovePayload).toBeDefined();
    const pos = lastPlayerPosition(playerMovePayload!);
    expect(pos).toEqual({ x: 3, y: 4 });
  });
});

describe('createPlayerPosition', () => {
  it('works as expected', () => {
    const x = 1.3,
      y = 5.2;

    const expectedFrame = {
      x: asSingle(x),
      y: asSingle(y),
    };

    const ppId = Buffer.from('12345');
    const playerPosition = createPlayerPosition(x, y, ppId);

    expect(playerPosition).toBeDefined();

    const env = Envelope.fromBinary(playerPosition!);

    expect(env).toEqual({
      kind: {
        case: 'gameAction',
        value: {
          action: {
            case: 'playerPosition',
            value: {
              userId: '12345',
              frame: expectedFrame,
            },
          },
        },
      },
    } as PlainMessage<Envelope>);
  });
});

describe('PlayerMove userId tagging', () => {
  it('works as expected', () => {
    const frame = { x: 1.3, y: -1.3, anim: 1, armR: 0.872, armScaleY: 1, held: 1, scaleX: 1 };
    const mangledFrame = {
      ...frame,
      x: asSingle(frame.x),
      y: asSingle(frame.y),
      armR: asSingle(frame.armR),
    };

    const encoded = Buffer.from(
      new Envelope({
        kind: {
          case: 'gameAction',
          value: {
            action: {
              case: 'playerMove',
              value: {
                frames: new Array(15).fill(frame),
              },
            },
          },
        },
      }).toBinary(),
    );

    const playerMovePayload = maybePlayerMove(encoded);

    expect(playerMovePayload).toBeDefined();

    const pmId = Buffer.from('12345');

    const tagged = tagPlayerMove(playerMovePayload!, pmId);

    expect(tagged).toBeDefined();

    const env = Envelope.fromBinary(tagged!);

    expect(env).toEqual({
      kind: {
        case: 'gameAction',
        value: {
          action: {
            case: 'playerMove',
            value: {
              userId: '12345',
              frames: new Array(15).fill(mangledFrame),
            },
          },
        },
      },
    } as PlainMessage<Envelope>);
  });
  it('refuses client-supplied userId', () => {
    const frame = { x: 1.3, y: -1.3, anim: 1, armR: 0.872, armScaleY: 1, held: 1, scaleX: 1 };
    const encoded = Buffer.from(
      new Envelope({
        kind: {
          case: 'gameAction',
          value: {
            action: {
              case: 'playerMove',
              value: {
                frames: new Array(15).fill(frame),
                userId: 'oh noes',
              },
            },
          },
        },
      }).toBinary(),
    );

    const playerMovePayload = maybePlayerMove(encoded);

    expect(playerMovePayload).toBeDefined();

    const pmId = Buffer.from('12345');

    const tagged = tagPlayerMove(playerMovePayload!, pmId);

    expect(tagged).toBeUndefined();
  });
});
