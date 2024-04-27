import { RecognizedString } from 'uWebSockets.js';
import { NT } from '@noita-together/nt-message';
import { createJwtFns } from '../jwt';
import { AuthProvider, ClientAuth } from '../runtypes/client_auth';
import { LobbyState } from '../state/lobby';
import { BindPublishers } from '../util';
import { ClientAuthWebSocket, TaggedClientAuth, createMessageHandler } from '../ws_handlers';
import { RoomName, RoomNameSuccess } from '../room_tracker';

export type MockSentMessage = {
  topic: string | null;
  user: ClientAuthWebSocket | null;
  message: NT.Envelope;
};

export const createTestEnv = (
  devMode: boolean,
  createRoomId?: () => string,
  createChatId?: () => string,
  createStatsId?: () => string,
  createRandomRoomName?: (userSuppliedName: string | null) => RoomName,
) => {
  const debug = () => {};

  const sentMessages: MockSentMessage[] = [];
  const closedSockets: { socket: ClientAuthWebSocket; code?: number; shortMessage?: RecognizedString }[] = [];
  const subscribed: Map<ClientAuthWebSocket, Set<string>> = new Map();

  const expectLobbyAction = <K extends keyof NT.ILobbyAction>(key: K) => {
    const env = sentMessages.shift()?.message!;
    expect(env).toBeDefined();
    const la = env.lobbyAction! as NT.LobbyAction;
    expect(la).toBeDefined();
    expect(la.action).toEqual(key);
    expect(la[key]).not.toBeUndefined();
    expect(la[key]).not.toBeNull();
    return la[key] as Exclude<(typeof la)[K], undefined | null>;
  };
  const expectGameAction = <K extends keyof NT.IGameAction>(key: K) => {
    const env = sentMessages.shift()?.message!;
    expect(env).toBeDefined();
    const ga = env.gameAction! as NT.GameAction;
    expect(ga).toBeDefined();
    expect(ga.action).toEqual(key);
    expect(ga[key]).not.toBeUndefined();
    expect(ga[key]).not.toBeNull();
    return ga[key] as Exclude<(typeof ga)[K], undefined | null>;
  };

  const publishers = BindPublishers(
    {
      publish: (topic: string, message: Uint8Array | NT.Envelope) => {
        const decoded = message instanceof Uint8Array ? NT.Envelope.decode(message) : message;
        sentMessages.push({ topic, message: decoded, user: null });
      },
    } as any,
    createChatId,
  );

  const lobby = new LobbyState(publishers, devMode, createRoomId, createChatId, createStatsId, createRandomRoomName);

  const { signToken, verifyToken } = createJwtFns('test secret', 'test refresh');

  const { users, sockets, handleUpgrade, handleOpen, handleMessage, handleClose } = createMessageHandler({
    verifyToken,
    lobby,
    debug: debug as any,
  });

  const testUser = (userId: string, username: string): ClientAuth => ({
    exp: 0,
    iat: 0,
    sub: userId,
    preferred_username: username,
    profile_image_url: '',
    provider: AuthProvider.Twitch,
  });

  const testToken = (userId: string, username: string) => signToken(userId, testUser(userId, username));

  const testSocket = (userId: string, username: string) => {
    const clientAuth = testUser(userId, username);

    const user: ClientAuthWebSocket & { toJSON: () => any; toString: () => string } = {
      send(msg: Uint8Array): number {
        sentMessages.push({ topic: null, message: NT.Envelope.decode(msg), user });
        return 1;
      },
      getUserData(): TaggedClientAuth {
        return { conn_id: 0, ip_hash: 'abc', ...clientAuth };
      },
      end(code?: number, shortMessage?: RecognizedString) {
        closedSockets.push({ socket: user, code, shortMessage });
      },
      close() {
        closedSockets.push({ socket: user });
      },
      publish(topic: string, msg: Uint8Array) {
        sentMessages.push({ topic, message: NT.Envelope.decode(msg), user });
        return true;
      },
      subscribe(topic: string) {
        const myTopics = subscribed.get(user) ?? new Set();
        myTopics.add(topic);
        subscribed.set(user, myTopics);
        return true;
      },
      unsubscribe(topic: string) {
        const myTopics = subscribed.get(user) ?? new Set();
        const res = myTopics.delete(topic);
        subscribed.set(user, myTopics);
        return res;
      },
      toJSON() {
        return { userId, username };
      },
      toString() {
        return `${userId}:${username}`;
      },
    };
    return user;
  };

  return {
    sentMessages,
    closedSockets,
    subscribed,
    lobby,
    users,
    expectGameAction,
    expectLobbyAction,
    testSocket,
    handleUpgrade,
    handleOpen,
    handleMessage,
    handleClose,
  };
};
