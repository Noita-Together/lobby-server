import { TemplatedApp } from 'uWebsockets.js';
import { IUser } from './state/user';
import { AnyMessage, Message, PartialMessage, PlainMessage } from '@bufbuild/protobuf';
import { Envelope, GameAction, LobbyAction, ServerChat } from './gen/messages_pb';
import { v4 as uuidv4 } from 'uuid';
import { GameActions, LobbyActions } from './types';

type LobbyActionCreator = {
  [K in LobbyActions['case']]: (LobbyActions & { case: K })['value'];
};
type GameActionCreator = {
  [K in GameActions['case']]: (GameActions & { case: K })['value'];
};

type Creators<T extends PlainMessage<AnyMessage>> = {
  [K in keyof T]: (data?: PlainMessage<T[K]>) => Envelope;
} & unknown;

export const M: Creators<LobbyActionCreator & GameActionCreator> = {} as any;

for (const f of GameAction.fields.list()) {
  if (f.kind !== 'message' || f.oneof?.name !== 'action') continue;
  (M as any)[f.jsonName] = (data: PartialMessage<AnyMessage> | undefined) =>
    new Envelope({
      kind: {
        case: 'gameAction',
        value: {
          action: {
            case: f.jsonName as any,
            value: new f.T(data) as any,
          },
        },
      },
    });
}

for (const f of LobbyAction.fields.list()) {
  if (f.kind !== 'message' || f.oneof?.name !== 'action') continue;
  (M as any)[f.jsonName] = (data: PartialMessage<AnyMessage> | undefined) =>
    new Envelope({
      kind: {
        case: 'lobbyAction',
        value: {
          action: {
            case: f.jsonName as any,
            value: new f.T(data) as any,
          },
        },
      },
    });
}

export const BindPublishers = (app: TemplatedApp) => {
  const publish = (topic: string, message: Uint8Array | Envelope) => {
    app.publish(topic, message instanceof Uint8Array ? message : message.toBinary(), true, false);
  };

  return {
    broadcast: (topic: string) => (message: Uint8Array | Envelope) => publish(topic, message),
    chat: (topic: string) => (user: IUser, message: string) =>
      publish(
        topic,
        M.sChat({
          id: uuidv4(),
          userId: user.id,
          name: user.name,
          message,
        }),
      ),
  };
};

export type Publishers = ReturnType<typeof BindPublishers>;
