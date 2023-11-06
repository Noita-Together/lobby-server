import { ProtoHax, Wiretype } from './protohax/protohax';
import { Envelope, GameAction, LobbyAction, PlayerFrame, PlayerMove, PlayerPosition } from './gen/messages_pb';

const gameActionId = Envelope.fields.findJsonName('gameAction')!.no; // assumed <= 16

const playerPositionId = GameAction.fields.findJsonName('playerPosition')!.no; // assumed <= 16
const ppFrameId = PlayerPosition.fields.findJsonName('frame')!.no; // assumed <= 16
const ppUserId = PlayerPosition.fields.findJsonName('userId')!.no; // assumed <= 16

const playerMoveId = GameAction.fields.findJsonName('playerMove')!.no; // assumed <= 16
const pmUserId = PlayerMove.fields.findJsonName('userId')!.no; // assumed <= 16

const playerFrameXid = PlayerFrame.fields.findJsonName('x')!.no; // assumed <= 16
const playerFrameYid = PlayerFrame.fields.findJsonName('y')!.no; // assumed <= 16

export const maybePlayerMove = (envelope: Buffer) => {
  let playerMovePayload: Buffer | undefined = undefined as any;
  new ProtoHax(envelope as Buffer).with(gameActionId).if(playerMoveId, (phax) => {
    playerMovePayload = phax.Bytes();
  });
  return playerMovePayload;
};

export const tagPlayerMove = (rawPlayerMove: Buffer, pmId: Buffer): Buffer | undefined => {
  const embeddedUserId = new ProtoHax(rawPlayerMove).with(ppUserId).Bytes();
  if (embeddedUserId.length > 0) return;

  // prettier-ignore
  const playerMovePayloadSize = (
      (1 + 1) // string tag + length
    + pmId.length // userId (string) payload
    + rawPlayerMove.length // frames[] payload - repeated Frame
  );
  const playerMoveHeaderSize = playerMovePayloadSize > 127 ? 3 : 2;
  const gameActionPayloadSize = playerMovePayloadSize + playerMoveHeaderSize;
  const gameActionHeaderSize = gameActionPayloadSize > 127 ? 3 : 2;
  const msgLength = gameActionHeaderSize + playerMoveHeaderSize + playerMovePayloadSize;

  const buf = Buffer.alloc(msgLength);

  let pos = 0;

  // write GameAction tag+length
  buf[pos++] = (gameActionId << 3) | Wiretype.LEN;
  if (gameActionHeaderSize === 2) {
    buf[pos++] = msgLength;
  } else {
    buf[pos++] = (gameActionPayloadSize & 0x7f) | 0x80;
    buf[pos++] = (gameActionPayloadSize >>> 7) & 0x7f;
  }

  // write PlayerMove tag+length
  buf[pos++] = (playerMoveId << 3) | Wiretype.LEN;
  if (playerMoveHeaderSize === 2) {
    buf[pos++] = msgLength - pos;
  } else {
    buf[pos++] = (playerMovePayloadSize & 0x7f) | 0x80;
    buf[pos++] = (playerMovePayloadSize >>> 7) & 0x7f;
  }

  // write userId
  buf[pos++] = (pmUserId << 3) | Wiretype.LEN;
  buf[pos++] = pmId.length;
  pmId.copy(buf, pos, 0);
  pos += pmId.length;

  // write frames[]
  rawPlayerMove.copy(buf, pos);

  return buf;
};

export const lastPlayerPosition = (rawPlayerMove: Buffer) => {
  let x: number = 0;
  let y: number = 0;

  // extract the last frame message
  new ProtoHax(rawPlayerMove).each(ppFrameId, (phax) => {
    phax.if(playerFrameXid, (p) => {
      x = p.Float();
    });
    phax.if(playerFrameYid, (p) => {
      y = p.Float();
    });
  });

  return { x, y };
};

export const createPlayerPosition = (x: number, y: number, ppId: Buffer): Buffer | undefined => {
  // prettier-ignore
  const msgLength = (
      (1 + 1) // GameAction: tag + length
    + (1 + 1) // PlayerPosition: tag + length
    + (1 + 1) // PlayerPosition.userId: tag + length
    + ppId.length // userId payload
    + (1 + 1) // PlayerPosition.frame: tag + length
    + (1 + 4) // frame.x: tag + value
    + (1 + 4) // frame.y: tag + value
  );
  const buf = Buffer.alloc(msgLength);

  let pos = 0;

  // write GameAction tag+length
  buf[pos++] = (gameActionId << 3) | Wiretype.LEN;
  buf[pos++] = msgLength - pos;

  // write PlayerPosition tag+length
  buf[pos++] = (playerPositionId << 3) | Wiretype.LEN;
  buf[pos++] = msgLength - pos;

  // write userId
  buf[pos++] = (ppUserId << 3) | Wiretype.LEN;
  buf[pos++] = ppId.length;
  ppId.copy(buf, pos, 0);
  pos += ppId.length;

  // write Frame tag+length
  buf[pos++] = (ppFrameId << 3) | Wiretype.LEN;
  buf[pos++] = msgLength - pos;

  // write x
  buf[pos++] = (playerFrameXid << 3) | Wiretype.I32;
  buf.writeFloatLE(x, pos);
  pos += 4;

  // write y
  buf[pos++] = (playerFrameYid << 3) | Wiretype.I32;
  buf.writeFloatLE(y, pos);
  pos += 4;

  return buf;
};
