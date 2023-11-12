import { PartialMessage } from '@bufbuild/protobuf';
import { Envelope } from '../gen/messages_pb';
import { createJwtFns } from '../jwt';
import { AuthProvider, ClientAuth } from '../runtypes/client_auth';
import { LobbyState, SYSTEM_USER } from '../state/lobby';
import { BindPublishers, M } from '../util';
import { ClientAuthWebSocket, createMessageHandler } from '../ws_handlers';

type sentMessage = {
  topic: string | null;
  user: ClientAuthWebSocket | null;
  message: PartialMessage<Envelope>;
};

const createTestEnv = (
  devMode: boolean,
  createRoomId?: () => string,
  createChatId?: () => string,
  createStatsId?: () => string,
) => {
  const debug = () => {};

  const sentMessages: sentMessage[] = [];
  const subscribed: Map<ClientAuthWebSocket, Set<string>> = new Map();

  const publishers = BindPublishers(
    {
      publish: (topic: string, message: Uint8Array | Envelope) => {
        const decoded = message instanceof Uint8Array ? Envelope.fromBinary(message) : message;
        sentMessages.push({ topic, message: decoded, user: null });
      },
    } as any,
    createChatId,
  );

  const lobby = new LobbyState(publishers, devMode, createRoomId, createChatId, createStatsId);

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
        sentMessages.push({ topic: null, message: Envelope.fromBinary(msg), user });
        return 1;
      },
      getUserData(): ClientAuth {
        return clientAuth;
      },
      close() {},
      publish(topic: string, msg: Uint8Array) {
        sentMessages.push({ topic, message: Envelope.fromBinary(msg), user });
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

  return { sentMessages, subscribed, lobby, users, testSocket, handleUpgrade, handleOpen, handleMessage, handleClose };
};

const uuidRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('lobby conformance tests', () => {
  describe('socket open', () => {
    it('new connections get subscribed to the lobby', () => {
      const { testSocket, handleOpen, subscribed, lobby } = createTestEnv(false);
      const user = testSocket('id', 'name');

      handleOpen(user);
      expect(subscribed.get(user)?.has(lobby.topic)).toBe(true);
    });
  });

  describe('socket close', () => {
    it('closed connections clean up gracefully', () => {
      const { testSocket, handleOpen, handleClose, subscribed, lobby } = createTestEnv(false);
      const user = testSocket('id', 'name');
      handleOpen(user);
      handleClose(user, 1006, Buffer.from('test'));

      // we expect not to call "unsubscribe" on the websocket when responding
      // to a socket close event -- may be invalid/throw an error, but all
      // subscriptions will go away with the socket anyway
      expect(subscribed.get(user)?.has(lobby.topic)).toBe(true);
    });
  });

  describe('non-mocked ids', () => {
    it('generates uuids like normal', () => {
      const { testSocket, handleOpen, handleMessage, sentMessages } = createTestEnv(false);
      const user = testSocket('id', 'name');

      handleOpen(user);

      // create a room - should have a uuid for its id
      handleMessage(user, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name's room" }).toBinary(), true);

      const sRoomCreated = sentMessages.shift()?.message.kind?.value?.action;
      expect(sRoomCreated?.case).toEqual('sRoomCreated');
      if (sRoomCreated?.case === 'sRoomCreated') {
        expect(sRoomCreated.value.id).toMatch(uuidRE);
      }

      const sRoomAddToList = sentMessages.shift()?.message.kind?.value?.action;
      expect(sRoomAddToList?.case).toEqual('sRoomAddToList');
      expect(sentMessages).toEqual([]);

      // send a chat - should have a uuid for its id
      handleMessage(user, M.cChat({ message: 'hi' }).toBinary(), true);

      const sChat = sentMessages.shift()?.message.kind?.value?.action;
      expect(sChat?.case).toEqual('sChat');
      if (sChat?.case === 'sChat') {
        expect(sChat.value.id).toMatch(uuidRE);
      }

      expect(sentMessages).toEqual([]);
    });
  });

  describe('disconnect handling', () => {
    it('cleans up a room when all active users have disconnected', () => {
      const { testSocket, handleOpen, handleMessage, handleClose, sentMessages } = createTestEnv(false);
      const user = testSocket('id', 'name');

      handleOpen(user);

      // create a room - should have a uuid for its id
      handleMessage(user, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name's room" }).toBinary(), true);

      const sRoomCreated = sentMessages.shift()?.message.kind?.value?.action;
      expect(sRoomCreated?.case).toEqual('sRoomCreated');
      if (sRoomCreated?.case === 'sRoomCreated') {
        expect(sRoomCreated.value.id).toMatch(uuidRE);
      }

      const sRoomAddToList = sentMessages.shift()?.message.kind?.value?.action;
      expect(sRoomAddToList?.case).toEqual('sRoomAddToList');
      expect(sentMessages).toEqual([]);

      handleClose(user, 1006, Buffer.from('test'));

      const sRoomDeleted = sentMessages.shift()?.message.kind?.value?.action;
      expect(sRoomDeleted?.case).toEqual('sRoomDeleted');
      if (sRoomDeleted?.case === 'sRoomDeleted') {
        expect(sRoomDeleted.value.id).toMatch(uuidRE);
      }

      expect(sentMessages).toEqual([]);
    });

    it('leaves a room active when at least one connected user is present', () => {
      const { testSocket, handleOpen, handleMessage, handleClose, sentMessages } = createTestEnv(false);
      const user = testSocket('id', 'name');
      const user2 = testSocket('id2', 'name2');

      handleOpen(user);
      handleOpen(user2);

      // create a room - should have a uuid for its id
      handleMessage(user, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name's room" }).toBinary(), true);

      const sRoomCreated = sentMessages.shift()?.message.kind?.value?.action;
      expect(sRoomCreated?.case).toEqual('sRoomCreated');
      let roomId: string;
      if (sRoomCreated?.case === 'sRoomCreated') {
        expect(sRoomCreated.value.id).toMatch(uuidRE);
        roomId = sRoomCreated.value.id!;
      } else {
        throw new Error('abort');
      }

      const sRoomAddToList = sentMessages.shift()?.message.kind?.value?.action;
      expect(sRoomAddToList?.case).toEqual('sRoomAddToList');
      expect(sentMessages).toEqual([]);

      handleMessage(user2, M.cJoinRoom({ id: roomId }).toBinary(), true);

      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sUserJoinedRoom');
      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sJoinRoomSuccess');
      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sRoomFlagsUpdated');
      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sUserReadyState');

      handleClose(user, 1006, Buffer.from('test'));

      expect(sentMessages).toEqual([]);
    });

    it('allows disconnected users to rejoin locked rooms. owner retains ownership', () => {
      const { testSocket, handleOpen, handleMessage, handleClose, sentMessages } = createTestEnv(false);
      const owner = testSocket('ownerid', 'owner');
      const player = testSocket('playerid', 'player');

      handleOpen(owner);
      handleOpen(player);

      // create a room - should have a uuid for its id
      handleMessage(owner, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name's room" }).toBinary(), true);

      const sRoomCreated = sentMessages.shift()?.message.kind?.value?.action;
      expect(sRoomCreated?.case).toEqual('sRoomCreated');
      let roomId: string;
      if (sRoomCreated?.case === 'sRoomCreated') {
        expect(sRoomCreated.value.id).toMatch(uuidRE);
        roomId = sRoomCreated.value.id!;
      } else {
        throw new Error('abort');
      }

      const sRoomAddToList = sentMessages.shift()?.message.kind?.value?.action;
      expect(sRoomAddToList?.case).toEqual('sRoomAddToList');
      expect(sentMessages).toEqual([]);

      handleMessage(player, M.cJoinRoom({ id: roomId }).toBinary(), true);

      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sUserJoinedRoom');
      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sJoinRoomSuccess');
      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sRoomFlagsUpdated');
      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sUserReadyState');
      expect(sentMessages).toEqual([]);

      handleMessage(owner, M.cRoomUpdate({ locked: true }).toBinary(), true);
      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sRoomUpdated');
      expect(sentMessages).toEqual([]);

      handleClose(owner, 1006, Buffer.from('test'));

      // owner can rejoin
      const owner2 = testSocket('ownerid', 'owner');
      handleOpen(owner2);
      handleMessage(owner2, M.cJoinRoom({ id: roomId }).toBinary(), true);

      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sUserJoinedRoom');
      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sJoinRoomSuccess');
      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sRoomFlagsUpdated');
      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sUserReadyState');
      expect(sentMessages).toEqual([]);

      handleClose(owner, 1006, Buffer.from('test'));

      // player can rejoin
      const player2 = testSocket('playerid', 'player');
      handleOpen(player2);
      handleMessage(player2, M.cJoinRoom({ id: roomId }).toBinary(), true);

      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sUserJoinedRoom');
      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sJoinRoomSuccess');
      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sRoomFlagsUpdated');
      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sUserReadyState');
      expect(sentMessages).toEqual([]);

      // owner can still change room properties = they are still the owner
      handleMessage(owner, M.cRoomUpdate({ locked: false }).toBinary(), true);
      expect(sentMessages.shift()?.message.kind?.value?.action?.case).toEqual('sRoomUpdated');
      expect(sentMessages).toEqual([]);
    });
  });

  describe('dev mode', () => {
    it('rejects room creation from non-devs', () => {
      const { testSocket, handleOpen, handleMessage, handleClose, sentMessages } = createTestEnv(true);
      const user = testSocket('id', 'name');
      const dev = testSocket('id', 'myndzi');

      handleOpen(user);
      handleOpen(dev);

      // create a room - should have a uuid for its id
      handleMessage(user, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name's room" }).toBinary(), true);

      const sRoomCreateFailed = sentMessages.shift()?.message.kind?.value?.action;
      expect(sRoomCreateFailed?.case).toEqual('sRoomCreateFailed');
      expect(sentMessages).toEqual([]);

      handleMessage(dev, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: 'dev room' }).toBinary(), true);

      const sRoomCreated = sentMessages.shift()?.message.kind?.value?.action;
      expect(sRoomCreated?.case).toEqual('sRoomCreated');
      if (sRoomCreated?.case === 'sRoomCreated') {
        expect(sRoomCreated.value.id).toMatch(uuidRE);
      }

      const sRoomAddToList = sentMessages.shift()?.message.kind?.value?.action;
      expect(sRoomAddToList?.case).toEqual('sRoomAddToList');
      expect(sentMessages).toEqual([]);
    });
  });

  describe('stats', () => {
    it('returns stats for rooms that are still open', () => {
      const { testSocket, handleOpen, handleMessage, lobby } = createTestEnv(
        false,
        () => 'room',
        () => 'chat',
        () => 'stats',
      );
      const user = testSocket('id', 'name');

      handleOpen(user);
      handleMessage(user, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name's room" }).toBinary(), true);
      handleMessage(user, M.cStartRun({ forced: false }).toBinary(), true);
      handleMessage(user, M.cRunOver({}).toBinary(), true);

      expect(lobby.getStats('room', 'stats')).toEqual(
        `{"id":"stats","headings":["Player","SteveKill","UserDeath","UserWin","HeartPickup","OrbPickup"],"rows":[["name",0,0,0,0,0]]}`,
      );
    });
    it('returns undefined for invalid stats ids', () => {
      const { lobby } = createTestEnv(false);
      expect(lobby.getStats('room', 'nope')).toBeUndefined();
    });
    it('returns undefined for closed rooms', () => {
      const { testSocket, handleOpen, handleMessage, lobby } = createTestEnv(
        false,
        () => 'room',
        () => 'chat',
        () => 'stats',
      );
      const user = testSocket('id', 'name');

      handleOpen(user);
      handleMessage(user, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name's room" }).toBinary(), true);
      handleMessage(user, M.cStartRun({ forced: false }).toBinary(), true);
      handleMessage(user, M.cRunOver({}).toBinary(), true);
      handleMessage(user, M.cRoomDelete({ id: 'room' }).toBinary(), true);

      expect(lobby.getStats('room', 'stats')).toBeUndefined();
    });
  });

  describe('message handlers', () => {
    type clientMessage = [user: ClientAuthWebSocket, message: Envelope];
    const sm = <E extends PartialMessage<Envelope>>(
      topic: string | null,
      user: ClientAuthWebSocket | null,
      action: E,
    ) => ({
      topic,
      message: action,
      user,
    });

    type test = {
      name: string;
      clientMessages: (users: Record<string, ClientAuthWebSocket>) => clientMessage[];
      serverMessages: (users: Record<string, ClientAuthWebSocket>) => sentMessage[];
    };

    const t = (
      desc: string,
      clientMessages: test['clientMessages'],
      serverMessages: test['serverMessages'] = () => [],
    ): test => ({
      name: desc,
      clientMessages: clientMessages,
      serverMessages: serverMessages,
    });

    const tests: test[] = [];

    ///// lobby messages /////

    // 'cChat, user not in room - invalid; nothing broadcast',
    tests.push(
      t(
        //
        'cChat, user not in room - invalid; nothing broadcast',
        ({ user1 }) => [[user1, M.cChat({ message: 'hi' })]],
      ),
    );

    // 'cRoomCreate - success; room name rewritten; sender receives sRoomCreated; others receive sRoomAddToList',
    const u1create_no_password = t(
      'cRoomCreate - success; room name rewritten; sender receives sRoomCreated; others receive sRoomAddToList',
      ({ user1 }) => [
        [
          user1,
          M.cRoomCreate({
            gamemode: 0,
            maxUsers: 3,
            name: 'room',
          }),
        ],
      ],
      ({ user1 }) => [
        sm(
          null,
          user1,
          M.sRoomCreated({
            id: 'room1',
            gamemode: 0,
            locked: false,
            maxUsers: 3,
            name: "user1's room",
            users: [
              {
                name: 'user1',
                owner: true,
                ready: false,
                userId: '1',
              },
            ],
            password: '',
          }),
        ),
        sm(
          'lobby',
          user1,
          M.sRoomAddToList({
            room: {
              curUsers: 1,
              gamemode: 0,
              id: 'room1',
              locked: false,
              maxUsers: 3,
              name: "user1's room",
              owner: 'user1',
              protected: false,
            },
          }),
        ),
      ],
    );
    tests.push(u1create_no_password);

    // 'cRoomCreate, cJoinRoom - success',
    const u1create_u2join_no_password: test = {
      name: 'cRoomCreate, cJoinRoom - success',
      clientMessages: (users) => [
        ...u1create_no_password.clientMessages(users),
        [
          users.user2,
          M.cJoinRoom({
            id: 'room1',
          }),
        ],
      ],
      serverMessages: (users) => [
        ...u1create_no_password.serverMessages(users),
        sm(
          '/room/room1',
          users.user2,
          M.sUserJoinedRoom({
            userId: '2',
            name: 'user2',
          }),
        ),
        sm(
          null,
          users.user2,
          M.sJoinRoomSuccess({
            gamemode: 0,
            id: 'room1',
            locked: false,
            maxUsers: 3,
            name: "user1's room",
            users: [
              {
                name: 'user1',
                owner: true,
                ready: false,
                userId: '1',
              },
              {
                name: 'user2',
                owner: false,
                ready: false,
                userId: '2',
              },
            ],
            password: '',
          }),
        ),
        sm(
          null,
          users.user2,
          M.sRoomFlagsUpdated({
            flags: [],
          }),
        ),
        sm(
          null,
          users.user2,
          M.sUserReadyState({
            userId: '1',
            mods: [],
            ready: false,
          }),
        ),
      ],
    };
    tests.push(u1create_u2join_no_password);

    // 'cRoomCreate (password), cJoinRoom - success',
    tests.push(
      t(
        'cRoomCreate (password), cJoinRoom - success',
        ({ user1, user2 }) => [
          [
            user1,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 3,
              name: 'room',
              password: 'foo',
            }),
          ],
          [
            user2,
            M.cJoinRoom({
              id: 'room1',
              password: 'foo',
            }),
          ],
        ],
        ({ user1, user2 }) => [
          sm(
            null,
            user1,
            M.sRoomCreated({
              id: 'room1',
              gamemode: 0,
              locked: false,
              maxUsers: 3,
              name: "user1's room",
              users: [
                {
                  name: 'user1',
                  owner: true,
                  ready: false,
                  userId: '1',
                },
              ],
              password: 'foo',
            }),
          ),
          sm(
            'lobby',
            user1,
            M.sRoomAddToList({
              room: {
                curUsers: 1,
                gamemode: 0,
                id: 'room1',
                locked: false,
                maxUsers: 3,
                name: "user1's room",
                owner: 'user1',
                protected: true,
              },
            }),
          ),
          sm(
            '/room/room1',
            user2,
            M.sUserJoinedRoom({
              userId: '2',
              name: 'user2',
            }),
          ),
          sm(
            null,
            user2,
            M.sJoinRoomSuccess({
              gamemode: 0,
              id: 'room1',
              locked: false,
              maxUsers: 3,
              name: "user1's room",
              users: [
                {
                  name: 'user1',
                  owner: true,
                  ready: false,
                  userId: '1',
                },
                {
                  name: 'user2',
                  owner: false,
                  ready: false,
                  userId: '2',
                },
              ],
              password: 'foo',
            }),
          ),
          sm(
            null,
            user2,
            M.sRoomFlagsUpdated({
              flags: [],
            }),
          ),
          sm(
            null,
            user2,
            M.sUserReadyState({
              userId: '1',
              mods: [],
              ready: false,
            }),
          ),
        ],
      ),
    );

    // 'cRoomCreate (password), cJoinRoom - failure (invalid password)',
    tests.push(
      t(
        'cRoomCreate (password), cJoinRoom - failure (invalid password)',
        ({ user1, user2 }) => [
          [
            user1,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 3,
              name: 'room',
              password: 'foo',
            }),
          ],
          [
            user2,
            M.cJoinRoom({
              id: 'room1',
              password: 'bar',
            }),
          ],
        ],
        ({ user1, user2 }) => [
          sm(
            null,
            user1,
            M.sRoomCreated({
              id: 'room1',
              gamemode: 0,
              locked: false,
              maxUsers: 3,
              name: "user1's room",
              users: [
                {
                  name: 'user1',
                  owner: true,
                  ready: false,
                  userId: '1',
                },
              ],
              password: 'foo',
            }),
          ),
          sm(
            'lobby',
            user1,
            M.sRoomAddToList({
              room: {
                curUsers: 1,
                gamemode: 0,
                id: 'room1',
                locked: false,
                maxUsers: 3,
                name: "user1's room",
                owner: 'user1',
                protected: true,
              },
            }),
          ),
          sm(
            null,
            user2,
            M.sJoinRoomFailed({
              reason: 'Bad password.',
            }),
          ),
        ],
      ),
    );

    // 'cRoomCreate - success (password); room name rewritten; password trimmed; sender receives sRoomCreated; others receive sRoomAddToList',
    tests.push(
      t(
        'cRoomCreate - success (password); room name rewritten; password trimmed; sender receives sRoomCreated; others receive sRoomAddToList',
        ({ user1 }) => [
          [
            user1,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 3,
              name: 'room',
              password: ' foo ',
            }),
          ],
        ],
        ({ user1 }) => [
          sm(
            null,
            user1,
            M.sRoomCreated({
              id: 'room1',
              gamemode: 0,
              locked: false,
              maxUsers: 3,
              name: "user1's room",
              users: [
                {
                  name: 'user1',
                  owner: true,
                  ready: false,
                  userId: '1',
                },
              ],
              password: 'foo',
            }),
          ),
          sm(
            'lobby',
            user1,
            M.sRoomAddToList({
              room: {
                curUsers: 1,
                gamemode: 0,
                id: 'room1',
                locked: false,
                maxUsers: 3,
                name: "user1's room",
                owner: 'user1',
                protected: true,
              },
            }),
          ),
        ],
      ),
    );

    // 'cRoomCreate - success (privileged user); room name NOT rewritten; password trimmed; sender receives sRoomCreated; others receive sRoomAddToList',
    tests.push(
      t(
        'cRoomCreate - success (privileged user); room name NOT rewritten; password trimmed; sender receives sRoomCreated; others receive sRoomAddToList',
        ({ myndzi }) => [
          [
            myndzi,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 30,
              name: 'troll room',
              password: ' foo ',
            }),
          ],
        ],
        ({ myndzi }) => [
          sm(
            null,
            myndzi,
            M.sRoomCreated({
              id: 'room1',
              gamemode: 0,
              locked: false,
              maxUsers: 30,
              name: 'troll room',
              users: [
                {
                  name: 'myndzi',
                  owner: true,
                  ready: false,
                  userId: '42069',
                },
              ],
              password: 'foo',
            }),
          ),
          sm(
            'lobby',
            myndzi,
            M.sRoomAddToList({
              room: {
                curUsers: 1,
                gamemode: 0,
                id: 'room1',
                locked: false,
                maxUsers: 30,
                name: 'troll room',
                owner: 'myndzi',
                protected: true,
              },
            }),
          ),
        ],
      ),
    );

    // 'cRoomCreate - failure (bad options)',
    tests.push(
      t(
        'cRoomCreate - failure (bad options)',
        ({ user1 }) => [
          [
            user1,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 9999999,
              name: 'room',
            }),
          ],
        ],
        ({ user1 }) => [
          sm(
            null,
            user1,
            M.sRoomCreateFailed({
              reason: 'Invalid maxUsers',
            }),
          ),
        ],
      ),
    );

    // 'cRoomCreate - failure (bad options) does not destroy previous room',
    tests.push(
      t(
        'cRoomCreate - failure (bad options) does not destroy previous room',
        ({ user1 }) => [
          [
            user1,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 3,
              name: 'room',
            }),
          ],
          [
            user1,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 9999999,
              name: 'room',
            }),
          ],
        ],
        ({ user1 }) => [
          sm(
            null,
            user1,
            M.sRoomCreated({
              id: 'room1',
              gamemode: 0,
              locked: false,
              maxUsers: 3,
              name: "user1's room",
              users: [
                {
                  name: 'user1',
                  owner: true,
                  ready: false,
                  userId: '1',
                },
              ],
              password: '',
            }),
          ),
          sm(
            'lobby',
            user1,
            M.sRoomAddToList({
              room: {
                curUsers: 1,
                gamemode: 0,
                id: 'room1',
                locked: false,
                maxUsers: 3,
                name: "user1's room",
                owner: 'user1',
                protected: false,
              },
            }),
          ),
          sm(
            null,
            user1,
            M.sRoomCreateFailed({
              reason: 'Invalid maxUsers',
            }),
          ),
        ],
      ),
    );

    // 'cRoomDelete - success (creator)',
    tests.push(
      t(
        'cRoomDelete - success (creator)',
        ({ user1 }) => [
          [
            user1,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 3,
              name: 'room',
            }),
          ],
          [
            user1,
            M.cRoomDelete({
              id: 'room1',
            }),
          ],
        ],
        ({ user1 }) => [
          sm(
            null,
            user1,
            M.sRoomCreated({
              id: 'room1',
              gamemode: 0,
              locked: false,
              maxUsers: 3,
              name: "user1's room",
              users: [
                {
                  name: 'user1',
                  owner: true,
                  ready: false,
                  userId: '1',
                },
              ],
              password: '',
            }),
          ),
          sm(
            'lobby',
            user1,
            M.sRoomAddToList({
              room: {
                curUsers: 1,
                gamemode: 0,
                id: 'room1',
                locked: false,
                maxUsers: 3,
                name: "user1's room",
                owner: 'user1',
                protected: false,
              },
            }),
          ),
          sm(
            '/room/room1',
            null,
            M.sRoomDeleted({
              id: 'room1',
            }),
          ),
        ],
      ),
    );

    // 'cRoomCreate - old room is destroyed if a new one is created',
    tests.push(
      t(
        'cRoomCreate - old room is destroyed if a new one is created',
        ({ user1 }) => [
          [
            user1,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 3,
              name: 'room',
            }),
          ],
          [
            user1,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 3,
              name: 'room',
            }),
          ],
        ],
        ({ user1 }) => [
          sm(
            null,
            user1,
            M.sRoomCreated({
              id: 'room1',
              gamemode: 0,
              locked: false,
              maxUsers: 3,
              name: "user1's room",
              users: [
                {
                  name: 'user1',
                  owner: true,
                  ready: false,
                  userId: '1',
                },
              ],
              password: '',
            }),
          ),
          sm(
            'lobby',
            user1,
            M.sRoomAddToList({
              room: {
                curUsers: 1,
                gamemode: 0,
                id: 'room1',
                locked: false,
                maxUsers: 3,
                name: "user1's room",
                owner: 'user1',
                protected: false,
              },
            }),
          ),
          sm(
            '/room/room1',
            null,
            M.sRoomDeleted({
              id: 'room1',
            }),
          ),
          sm(
            null,
            user1,
            M.sRoomCreated({
              id: 'room2',
              gamemode: 0,
              locked: false,
              maxUsers: 3,
              name: "user1's room",
              users: [
                {
                  name: 'user1',
                  owner: true,
                  ready: false,
                  userId: '1',
                },
              ],
              password: '',
            }),
          ),
          sm(
            'lobby',
            user1,
            M.sRoomAddToList({
              room: {
                curUsers: 1,
                gamemode: 0,
                id: 'room2',
                locked: false,
                maxUsers: 3,
                name: "user1's room",
                owner: 'user1',
                protected: false,
              },
            }),
          ),
        ],
      ),
    );

    // 'cJoinRoom - failure (nonexistent room)',
    tests.push(
      t(
        'cJoinRoom - failure (nonexistent room)',
        ({ user1 }) => [[user1, M.cJoinRoom({ id: 'nope' })]],
        ({ user1 }) => [sm(null, user1, M.sJoinRoomFailed({ reason: "Room doesn't exist." }))],
      ),
    );

    // name: 'cBanUser (success); join room (failure - banned)',
    tests.push({
      name: 'cBanUser (success); join room (failure - banned)',
      clientMessages: (users) => [
        ...u1create_u2join_no_password.clientMessages(users),
        [
          users.user1,
          M.cBanUser({
            userId: '2',
          }),
        ],
        [
          users.user2,
          M.cJoinRoom({
            id: 'room1',
          }),
        ],
      ],
      serverMessages: (users) => [
        ...u1create_u2join_no_password.serverMessages(users),
        sm('/room/room1', null, M.sUserBanned({ userId: '2' })),
        sm(
          '/room/room1',
          null,
          M.sChat({
            id: 'chat1',
            userId: SYSTEM_USER.id,
            name: SYSTEM_USER.name,
            message: 'user2 has been banned from this room.',
          }),
        ),
        sm(
          null,
          users.user2,
          M.sJoinRoomFailed({
            reason: 'Banned from this room.',
          }),
        ),
      ],
    });

    // name: 'cJoinRoom - failure (full)',
    tests.push({
      name: 'cJoinRoom - failure (full)',
      clientMessages: (users) => [
        ...u1create_no_password.clientMessages(users),
        [
          users.user1,
          M.cRoomUpdate({
            maxUsers: 1,
          }),
        ],
        [users.user2, M.cJoinRoom({ id: 'room1' })],
      ],
      serverMessages: (users) => [
        ...u1create_no_password.serverMessages(users),
        sm(
          '/room/room1',
          null,
          M.sRoomUpdated({
            maxUsers: 1,
          }),
        ),
        sm(
          null,
          users.user2,
          M.sJoinRoomFailed({
            reason: 'Room is full.',
          }),
        ),
      ],
    });

    // name: 'cKickUser (success); join room (success)',
    tests.push({
      name: 'cKickUser (success); join room (success)',
      clientMessages: (users) => [
        ...u1create_u2join_no_password.clientMessages(users),
        [
          users.user1,
          M.cKickUser({
            userId: '2',
          }),
        ],
        [
          users.user2,
          M.cJoinRoom({
            id: 'room1',
          }),
        ],
      ],
      serverMessages: (users) => [
        ...u1create_u2join_no_password.serverMessages(users),
        sm('/room/room1', null, M.sUserKicked({ userId: '2' })),
        sm(
          '/room/room1',
          null,
          M.sChat({
            id: 'chat1',
            userId: SYSTEM_USER.id,
            name: SYSTEM_USER.name,
            message: 'user2 has been kicked from this room.',
          }),
        ),
        sm(
          '/room/room1',
          users.user2,
          M.sUserJoinedRoom({
            userId: '2',
            name: 'user2',
          }),
        ),
        sm(
          null,
          users.user2,
          M.sJoinRoomSuccess({
            gamemode: 0,
            id: 'room1',
            locked: false,
            maxUsers: 3,
            name: "user1's room",
            users: [
              {
                name: 'user1',
                owner: true,
                ready: false,
                userId: '1',
              },
              {
                name: 'user2',
                owner: false,
                ready: false,
                userId: '2',
              },
            ],
            password: '',
          }),
        ),
        sm(
          null,
          users.user2,
          M.sRoomFlagsUpdated({
            flags: [],
          }),
        ),
        sm(
          null,
          users.user2,
          M.sUserReadyState({
            userId: '1',
            mods: [],
            ready: false,
          }),
        ),
      ],
    });

    // name: "cKickUser - failure (silent; not owner)",
    tests.push({
      name: 'cKickUser - failure (silent; not owner)',
      clientMessages: (users) => [
        ...u1create_u2join_no_password.clientMessages(users),
        [
          users.user2,
          M.cKickUser({
            userId: '2',
          }),
        ],
      ],
      serverMessages: (users) => [...u1create_u2join_no_password.serverMessages(users)],
    });

    // name: "cBanUser - failure (silent; not owner)",
    tests.push({
      name: 'cBanUser - failure (silent; not owner)',
      clientMessages: (users) => [
        ...u1create_u2join_no_password.clientMessages(users),
        [
          users.user2,
          M.cBanUser({
            userId: '2',
          }),
        ],
      ],
      serverMessages: (users) => [...u1create_u2join_no_password.serverMessages(users)],
    });

    // name: 'cJoinRoom - success (twice)',
    tests.push({
      name: 'cRoomUpdate - kick (success); join room (success)',
      clientMessages: (users) => [
        ...u1create_u2join_no_password.clientMessages(users),
        [
          users.user2,
          M.cJoinRoom({
            id: 'room1',
          }),
        ],
      ],
      serverMessages: (users) => [
        ...u1create_u2join_no_password.serverMessages(users),
        sm(
          '/room/room1',
          users.user2,
          M.sUserJoinedRoom({
            userId: '2',
            name: 'user2',
          }),
        ),
        sm(
          null,
          users.user2,
          M.sJoinRoomSuccess({
            gamemode: 0,
            id: 'room1',
            locked: false,
            maxUsers: 3,
            name: "user1's room",
            users: [
              {
                name: 'user1',
                owner: true,
                ready: false,
                userId: '1',
              },
              {
                name: 'user2',
                owner: false,
                ready: false,
                userId: '2',
              },
            ],
            password: '',
          }),
        ),
        sm(
          null,
          users.user2,
          M.sRoomFlagsUpdated({
            flags: [],
          }),
        ),
        sm(
          null,
          users.user2,
          M.sUserReadyState({
            userId: '1',
            mods: [],
            ready: false,
          }),
        ),
      ],
    });

    // name: 'cJoinRoom (room creator switching rooms) - success',
    tests.push({
      name: 'cJoinRoom (room creator switching rooms) - success',
      clientMessages: (users) => [
        ...u1create_no_password.clientMessages(users),
        [
          users.user2,
          M.cRoomCreate({
            gamemode: 0,
            maxUsers: 3,
            name: "user2's room",
          }),
        ],
        [
          users.user2,
          M.cJoinRoom({
            id: 'room1',
          }),
        ],
      ],
      serverMessages: (users) => [
        ...u1create_no_password.serverMessages(users),
        sm(
          null,
          users.user2,
          M.sRoomCreated({
            id: 'room2',
            gamemode: 0,
            locked: false,
            maxUsers: 3,
            name: "user2's room",
            users: [
              {
                name: 'user2',
                owner: true,
                ready: false,
                userId: '2',
              },
            ],
            password: '',
          }),
        ),
        sm(
          'lobby',
          users.user2,
          M.sRoomAddToList({
            room: {
              curUsers: 1,
              gamemode: 0,
              id: 'room2',
              locked: false,
              maxUsers: 3,
              name: "user2's room",
              owner: 'user2',
              protected: false,
            },
          }),
        ),
        sm(
          '/room/room2',
          null,
          M.sRoomDeleted({
            id: 'room2',
          }),
        ),
        sm(
          '/room/room1',
          users.user2,
          M.sUserJoinedRoom({
            userId: '2',
            name: 'user2',
          }),
        ),
        sm(
          null,
          users.user2,
          M.sJoinRoomSuccess({
            gamemode: 0,
            id: 'room1',
            locked: false,
            maxUsers: 3,
            name: "user1's room",
            users: [
              {
                name: 'user1',
                owner: true,
                ready: false,
                userId: '1',
              },
              {
                name: 'user2',
                owner: false,
                ready: false,
                userId: '2',
              },
            ],
            password: '',
          }),
        ),
        sm(
          null,
          users.user2,
          M.sRoomFlagsUpdated({
            flags: [],
          }),
        ),
        sm(
          null,
          users.user2,
          M.sUserReadyState({
            userId: '1',
            mods: [],
            ready: false,
          }),
        ),
      ],
    });

    // name: 'cJoinRoom (room member switching rooms) - success',
    tests.push({
      name: 'cJoinRoom (room member switching rooms) - success',
      clientMessages: (users) => [
        ...u1create_u2join_no_password.clientMessages(users),
        [
          users.myndzi,
          M.cRoomCreate({
            gamemode: 0,
            maxUsers: 3,
            name: 'foo',
          }),
        ],
        [
          users.user2,
          M.cJoinRoom({
            id: 'room2',
          }),
        ],
      ],
      serverMessages: (users) => [
        ...u1create_u2join_no_password.serverMessages(users),
        sm(
          null,
          users.myndzi,
          M.sRoomCreated({
            id: 'room2',
            gamemode: 0,
            locked: false,
            maxUsers: 3,
            name: 'foo',
            users: [
              {
                name: 'myndzi',
                owner: true,
                ready: false,
                userId: '42069',
              },
            ],
            password: '',
          }),
        ),
        sm(
          'lobby',
          users.myndzi,
          M.sRoomAddToList({
            room: {
              curUsers: 1,
              gamemode: 0,
              id: 'room2',
              locked: false,
              maxUsers: 3,
              name: 'foo',
              owner: 'myndzi',
              protected: false,
            },
          }),
        ),
        sm(
          '/room/room1',
          null,
          M.sUserLeftRoom({
            userId: '2',
          }),
        ),
        sm(
          '/room/room1',
          null,
          M.sChat({
            id: 'chat1',
            userId: SYSTEM_USER.id,
            name: SYSTEM_USER.name,
            message: 'user2 has left.',
          }),
        ),
        sm(
          '/room/room2',
          users.user2,
          M.sUserJoinedRoom({
            userId: '2',
            name: 'user2',
          }),
        ),
        sm(
          null,
          users.user2,
          M.sJoinRoomSuccess({
            gamemode: 0,
            id: 'room2',
            locked: false,
            maxUsers: 3,
            name: 'foo',
            users: [
              {
                name: 'myndzi',
                owner: true,
                ready: false,
                userId: '42069',
              },
              {
                name: 'user2',
                owner: false,
                ready: false,
                userId: '2',
              },
            ],
            password: '',
          }),
        ),
        sm(
          null,
          users.user2,
          M.sRoomFlagsUpdated({
            flags: [],
          }),
        ),
        sm(
          null,
          users.user2,
          M.sUserReadyState({
            userId: '42069',
            mods: [],
            ready: false,
          }),
        ),
      ],
    });

    // 'cLeaveRoom - success',
    tests.push({
      name: 'cLeaveRoom - success',
      clientMessages: (users) => [
        ...u1create_u2join_no_password.clientMessages(users),
        [users.user2, M.cLeaveRoom({ userId: 'unused' })],
      ],
      serverMessages: (users) => [
        ...u1create_u2join_no_password.serverMessages(users),
        sm('/room/room1', null, M.sUserLeftRoom({ userId: '2' })),
        sm(
          '/room/room1',
          null,
          M.sChat({
            id: 'chat1',
            userId: SYSTEM_USER.id,
            name: SYSTEM_USER.name,
            message: 'user2 has left.',
          }),
        ),
      ],
    });

    // 'cLeaveRoom - success (owner)',
    tests.push({
      name: 'cLeaveRoom - success (owner)',
      clientMessages: (users) => [
        ...u1create_u2join_no_password.clientMessages(users),
        [users.user1, M.cLeaveRoom({ userId: 'unused' })],
      ],
      serverMessages: (users) => [
        ...u1create_u2join_no_password.serverMessages(users),
        sm(
          '/room/room1',
          null,
          M.sRoomDeleted({
            id: 'room1',
          }),
        ),
      ],
    });

    // 'cChat, user in room - sender receives nothing, others receive chat',
    tests.push(
      t(
        'cChat, user in room - sender receives nothing, others receive chat',
        ({ user1 }) => [
          [
            user1,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 3,
              name: 'room',
            }),
          ],
          [user1, M.cChat({ message: 'hi' })],
        ],
        ({ user1 }) => [
          sm(
            null,
            user1,
            M.sRoomCreated({
              id: 'room1',
              gamemode: 0,
              locked: false,
              maxUsers: 3,
              name: "user1's room",
              users: [
                {
                  name: 'user1',
                  owner: true,
                  ready: false,
                  userId: '1',
                },
              ],
              password: '',
            }),
          ),
          sm(
            'lobby',
            user1,
            M.sRoomAddToList({
              room: {
                curUsers: 1,
                gamemode: 0,
                id: 'room1',
                locked: false,
                maxUsers: 3,
                name: "user1's room",
                owner: 'user1',
                protected: false,
              },
            }),
          ),
          sm(
            '/room/room1',
            user1,
            M.sChat({
              id: 'chat1',
              message: 'hi',
              name: 'user1',
              userId: '1',
            }),
          ),
        ],
      ),
    );

    // 'cChat - silent failure (empty message)',
    tests.push(
      t(
        'cChat - silent failure (empty message)',
        ({ user1 }) => [
          [
            user1,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 3,
              name: 'room',
            }),
          ],
          [user1, M.cChat({ message: '' })],
        ],
        ({ user1 }) => [
          sm(
            null,
            user1,
            M.sRoomCreated({
              id: 'room1',
              gamemode: 0,
              locked: false,
              maxUsers: 3,
              name: "user1's room",
              users: [
                {
                  name: 'user1',
                  owner: true,
                  ready: false,
                  userId: '1',
                },
              ],
              password: '',
            }),
          ),
          sm(
            'lobby',
            user1,
            M.sRoomAddToList({
              room: {
                curUsers: 1,
                gamemode: 0,
                id: 'room1',
                locked: false,
                maxUsers: 3,
                name: "user1's room",
                owner: 'user1',
                protected: false,
              },
            }),
          ),
        ],
      ),
    );

    // name: 'cRequestRoomList - success',
    tests.push({
      name: 'cRequestRoomList - success',
      clientMessages: (users) => [
        ...u1create_no_password.clientMessages(users),
        [users.user2, M.cRequestRoomList({ page: 0 })],
      ],
      serverMessages: (users) => [
        ...u1create_no_password.serverMessages(users),
        sm(
          null,
          users.user2,
          M.sRoomList({
            rooms: [
              {
                curUsers: 1,
                gamemode: 0,
                id: 'room1',
                locked: false,
                maxUsers: 3,
                name: "user1's room",
                owner: 'user1',
                protected: false,
              },
            ],
            pages: 0, // not implemented
          }),
        ),
      ],
    });

    // name: 'cRoomUpdate (lock) - success; cJoinRoom - fail (locked)',
    tests.push({
      name: 'cRoomUpdate (lock) - success',
      clientMessages: (users) => [
        ...u1create_no_password.clientMessages(users),
        [
          users.user1,
          M.cRoomUpdate({
            locked: true,
          }),
        ],
        [
          users.user2,
          M.cJoinRoom({
            id: 'room1',
          }),
        ],
      ],
      serverMessages: (users) => [
        ...u1create_no_password.serverMessages(users),
        sm(
          '/room/room1',
          null,
          M.sRoomUpdated({
            locked: true,
          }),
        ),
        sm(
          null,
          users.user2,
          M.sJoinRoomFailed({
            reason: 'Room is locked.',
          }),
        ),
      ],
    });

    // name: 'cRoomUpdate (maxUsers) - success',
    tests.push({
      name: 'cRoomUpdate (maxUsers) - success',
      clientMessages: (users) => [
        ...u1create_no_password.clientMessages(users),
        [
          users.user1,
          M.cRoomUpdate({
            maxUsers: 10,
          }),
        ],
      ],
      serverMessages: (users) => [
        ...u1create_no_password.serverMessages(users),
        sm(
          '/room/room1',
          null,
          M.sRoomUpdated({
            maxUsers: 10,
          }),
        ),
      ],
    });

    // name: 'cRoomUpdate (gamemode) - success',
    tests.push({
      name: 'cRoomUpdate (gamemode) - success',
      clientMessages: (users) => [
        ...u1create_no_password.clientMessages(users),
        [
          users.user1,
          M.cRoomUpdate({
            gamemode: 1,
          }),
        ],
      ],
      serverMessages: (users) => [
        ...u1create_no_password.serverMessages(users),
        sm(
          '/room/room1',
          null,
          M.sRoomUpdated({
            gamemode: 1,
          }),
        ),
      ],
    });

    // name: 'cRoomUpdate (password) - success',
    tests.push({
      name: 'cRoomUpdate (password) - success',
      clientMessages: (users) => [
        ...u1create_no_password.clientMessages(users),
        [
          users.user1,
          M.cRoomUpdate({
            password: 'foo',
          }),
        ],
        [users.user2, M.cRequestRoomList({ page: 0 })],
      ],
      serverMessages: (users) => [
        ...u1create_no_password.serverMessages(users),
        sm(
          '/room/room1',
          null,
          M.sRoomUpdated({
            password: 'foo',
          }),
        ),
        sm(
          null,
          users.user2,
          M.sRoomList({
            rooms: [
              {
                curUsers: 1,
                gamemode: 0,
                id: 'room1',
                locked: false,
                maxUsers: 3,
                name: "user1's room",
                owner: 'user1',
                protected: true,
              },
            ],
            pages: 0, // not implemented
          }),
        ),
      ],
    });

    // name: 'cRoomUpdate (maxUsers) - failure',
    tests.push({
      name: 'cRoomUpdate (maxUsers) - failure',
      clientMessages: (users) => [
        ...u1create_no_password.clientMessages(users),
        [
          users.user1,
          M.cRoomUpdate({
            maxUsers: 69,
          }),
        ],
      ],
      serverMessages: (users) => [
        ...u1create_no_password.serverMessages(users),
        sm(
          null,
          users.user1,
          M.sRoomUpdateFailed({
            reason: 'Invalid maxUsers',
          }),
        ),
      ],
    });

    // name: 'cRoomUpdate (not owner) - failure',
    tests.push({
      name: 'cRoomUpdate (not owner) - failure',
      clientMessages: (users) => [
        ...u1create_u2join_no_password.clientMessages(users),
        [
          users.user2,
          M.cRoomUpdate({
            maxUsers: 10,
          }),
        ],
      ],
      serverMessages: (users) => [
        ...u1create_u2join_no_password.serverMessages(users),
        sm(
          null,
          users.user2,
          M.sRoomUpdateFailed({
            reason: "Can't do that.",
          }),
        ),
      ],
    });

    // name: 'cRoomUpdate (name; privileged user) - success',
    tests.push(
      t(
        'cRoomUpdate (name; privileged user) - success',
        ({ myndzi, user2 }) => [
          [
            myndzi,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 3,
              name: 'room',
            }),
          ],

          [
            myndzi,
            M.cRoomUpdate({
              name: 'troll room',
            }),
          ],
          [user2, M.cRequestRoomList({ page: 0 })],
        ],
        ({ myndzi, user2 }) => [
          sm(
            null,
            myndzi,
            M.sRoomCreated({
              id: 'room1',
              gamemode: 0,
              locked: false,
              maxUsers: 3,
              name: 'room',
              users: [
                {
                  name: 'myndzi',
                  owner: true,
                  ready: false,
                  userId: '42069',
                },
              ],
              password: '',
            }),
          ),
          sm(
            'lobby',
            myndzi,
            M.sRoomAddToList({
              room: {
                curUsers: 1,
                gamemode: 0,
                id: 'room1',
                locked: false,
                maxUsers: 3,
                name: 'room',
                owner: 'myndzi',
                protected: false,
              },
            }),
          ),
          sm(
            '/room/room1',
            null,
            M.sRoomUpdated({
              name: 'troll room',
            }),
          ),
          sm(
            null,
            user2,
            M.sRoomList({
              rooms: [
                {
                  curUsers: 1,
                  gamemode: 0,
                  id: 'room1',
                  locked: false,
                  maxUsers: 3,
                  name: 'troll room',
                  owner: 'myndzi',
                  protected: false,
                },
              ],
              pages: 0, // not implemented
            }),
          ),
        ],
      ),
    );

    // name: 'cRoomFlagsUpdate (seed) - success; cached flags sent',
    tests.push({
      name: 'cRoomFlagsUpdate (seed) - success; cached flags sent',
      clientMessages: (users) => [
        ...u1create_no_password.clientMessages(users),
        [
          users.user1,
          M.cRoomFlagsUpdate({
            flags: [{ flag: 'NT_sync_world_seed', uIntVal: 123 }],
          }),
        ],
        [
          users.user2,
          M.cJoinRoom({
            id: 'room1',
          }),
        ],
      ],
      serverMessages: (users) => [
        ...u1create_no_password.serverMessages(users),
        sm(
          '/room/room1',
          null,
          M.sRoomFlagsUpdated({
            // lol no room id or user id or anything
            flags: [{ flag: 'NT_sync_world_seed', uIntVal: 123 }],
          }),
        ),
        sm(
          '/room/room1',
          users.user2,
          M.sUserJoinedRoom({
            userId: '2',
            name: 'user2',
          }),
        ),
        sm(
          null,
          users.user2,
          M.sJoinRoomSuccess({
            gamemode: 0,
            id: 'room1',
            locked: false,
            maxUsers: 3,
            name: "user1's room",
            users: [
              {
                name: 'user1',
                owner: true,
                ready: false,
                userId: '1',
              },
              {
                name: 'user2',
                owner: false,
                ready: false,
                userId: '2',
              },
            ],
            password: '',
          }),
        ),
        sm(
          null,
          users.user2,
          M.sRoomFlagsUpdated({
            flags: [{ flag: 'NT_sync_world_seed', uIntVal: 123 }],
          }),
        ),
        sm(
          null,
          users.user2,
          M.sUserReadyState({
            userId: '1',
            mods: [],
            ready: false,
          }),
        ),
      ],
    });

    // name: 'cRoomFlagsUpdate (not owner) - failure',
    tests.push({
      name: 'cRoomFlagsUpdate (not owner) - failure',
      clientMessages: (users) => [
        ...u1create_u2join_no_password.clientMessages(users),
        [
          users.user2,
          M.cRoomFlagsUpdate({
            flags: [{ flag: 'NT_sync_world_seed', uIntVal: 4321 }],
          }),
        ],
      ],
      serverMessages: (users) => [
        ...u1create_u2join_no_password.serverMessages(users),
        sm(
          null,
          users.user2,
          M.sRoomFlagsUpdateFailed({
            reason: "Can't do that.",
          }),
        ),
      ],
    });

    // name: 'cReadyState (mods, ready) - success; cached readystate sent',
    const u1create_u2ready_u3join: test = {
      name: 'cReadyState (mods, ready) - success; cached readystate sent',
      clientMessages: (users) => [
        ...u1create_u2join_no_password.clientMessages(users),
        [
          users.user2,
          M.cReadyState({
            mods: ['thicc mina'],
            ready: true,
          }),
        ],
        [
          users.myndzi,
          M.cJoinRoom({
            id: 'room1',
          }),
        ],
      ],
      serverMessages: (users) => [
        ...u1create_u2join_no_password.serverMessages(users),
        sm(
          '/room/room1',
          null,
          M.sUserReadyState({
            userId: '2',
            mods: ['thicc mina'],
            ready: true,
          }),
        ),
        sm(
          '/room/room1',
          users.myndzi,
          M.sUserJoinedRoom({
            userId: '42069',
            name: 'myndzi',
          }),
        ),
        sm(
          null,
          users.myndzi,
          M.sJoinRoomSuccess({
            gamemode: 0,
            id: 'room1',
            locked: false,
            maxUsers: 3,
            name: "user1's room",
            users: [
              {
                name: 'user1',
                owner: true,
                ready: false,
                userId: '1',
              },
              {
                name: 'user2',
                owner: false,
                ready: true,
                userId: '2',
              },
              {
                name: 'myndzi',
                owner: false,
                ready: false,
                userId: '42069',
              },
            ],
            password: '',
          }),
        ),
        sm(
          null,
          users.myndzi,
          M.sRoomFlagsUpdated({
            flags: [],
          }),
        ),
        sm(
          null,
          users.myndzi,
          M.sUserReadyState({
            userId: '1',
            mods: [],
            ready: false,
          }),
        ),
        sm(
          null,
          users.myndzi,
          M.sUserReadyState({
            userId: '2',
            mods: ['thicc mina'],
            ready: true,
          }),
        ),
      ],
    };
    tests.push(u1create_u2ready_u3join);

    // name: 'cStartRun - failure (not owner)',
    tests.push({
      name: 'cStartRun - failure (not owner)',
      clientMessages: (users) => [
        ...u1create_u2ready_u3join.clientMessages(users),
        [users.user2, M.cStartRun({ forced: true /* ignored*/ })],
      ],
      serverMessages: (users) => [...u1create_u2ready_u3join.serverMessages(users)],
    });

    // name: 'cStartRun - success',
    const u1create_u2ready_u1start: test = {
      name: 'cStartRun - success',
      clientMessages: (users) => [
        ...u1create_u2ready_u3join.clientMessages(users),
        [users.user1, M.cStartRun({ forced: true /* ignored*/ })],
      ],
      serverMessages: (users) => [
        ...u1create_u2ready_u3join.serverMessages(users),
        sm('/room/room1', null, M.sHostStart({ forced: false /* always sent*/ })),
      ],
    };
    tests.push(u1create_u2ready_u1start);

    // name: "cReadyState - run in progress - start sent when mods haven't changed",
    tests.push({
      name: "cReadyState - run in progress - start sent when mods haven't changed",
      clientMessages: (users) => [
        ...u1create_u2ready_u3join.clientMessages(users),
        [users.user1, M.cStartRun({ forced: true /* ignored*/ })],
        [users.myndzi, M.cReadyState({ ready: true, mods: [] })],
      ],
      serverMessages: (users) => [
        ...u1create_u2ready_u3join.serverMessages(users),
        sm('/room/room1', null, M.sHostStart({ forced: false /* always sent*/ })),
        sm(
          '/room/room1',
          null,
          M.sUserReadyState({
            userId: '42069',
            mods: [],
            ready: true,
          }),
        ),
        sm(null, users.myndzi, M.sHostStart({ forced: false })),
      ],
    });

    // name: "cReadyState - run in progress - start NOT sent when mods HAVE changed",
    tests.push({
      name: 'cReadyState - run in progress - start NOT sent when mods HAVE changed',
      clientMessages: (users) => [
        ...u1create_u2ready_u3join.clientMessages(users),
        [users.user1, M.cStartRun({ forced: true /* ignored*/ })],
        [users.myndzi, M.cReadyState({ ready: true, mods: ['cheat mod'] })],
      ],
      serverMessages: (users) => [
        ...u1create_u2ready_u3join.serverMessages(users),
        sm('/room/room1', null, M.sHostStart({ forced: false /* always sent*/ })),
        sm(
          '/room/room1',
          null,
          M.sUserReadyState({
            userId: '42069',
            mods: ['cheat mod'],
            ready: true,
          }),
        ),
      ],
    });

    // name: "cReadyState - run in progress - start sent when mods are changed back",
    tests.push({
      name: 'cReadyState - run in progress - start sent when mods are changed back',
      clientMessages: (users) => [
        ...u1create_u2ready_u3join.clientMessages(users),
        [users.user1, M.cStartRun({ forced: true /* ignored*/ })],
        [users.myndzi, M.cReadyState({ ready: true, mods: ['cheat mod'] })],
        [users.myndzi, M.cReadyState({ ready: true, mods: [] })],
      ],
      serverMessages: (users) => [
        ...u1create_u2ready_u3join.serverMessages(users),
        sm('/room/room1', null, M.sHostStart({ forced: false /* always sent*/ })),
        sm(
          '/room/room1',
          null,
          M.sUserReadyState({
            userId: '42069',
            mods: ['cheat mod'],
            ready: true,
          }),
        ),
        sm(
          '/room/room1',
          null,
          M.sUserReadyState({
            userId: '42069',
            mods: [],
            ready: true,
          }),
        ),
        sm(null, users.myndzi, M.sHostStart({ forced: false })),
      ],
    });

    // name: "cReadyState - started then ended - start NOT sent",
    tests.push({
      name: 'cReadyState - started then ended - start NOT sent',
      clientMessages: (users) => [
        ...u1create_u2ready_u3join.clientMessages(users),
        [users.user1, M.cStartRun({ forced: true /* ignored*/ })],
        [users.user1, M.cRunOver({ idk: true /* ignored*/ })],
        [users.myndzi, M.cReadyState({ ready: true, mods: [] })],
      ],
      serverMessages: (users) => [
        ...u1create_u2ready_u3join.serverMessages(users),
        sm('/room/room1', null, M.sHostStart({ forced: false /* always sent*/ })),
        sm(
          '/room/room1',
          null,
          M.sChat({
            id: 'chat1',
            userId: SYSTEM_USER.id,
            name: SYSTEM_USER.name,
            message: `Stats for run can be found at http://localhost:3000/stats/room1/stats1`,
          }),
        ),
        sm(
          '/room/room1',
          null,
          M.sUserReadyState({
            userId: '42069',
            mods: [],
            ready: true,
          }),
        ),
      ],
    });

    // name: "cRunOver - failure (not owner) - indirect test via readystate update",
    tests.push({
      name: 'cRunOver - failure (not owner) - indirect test via readystate update',
      clientMessages: (users) => [
        ...u1create_u2ready_u3join.clientMessages(users),
        [users.user1, M.cStartRun({ forced: true /* ignored*/ })],
        [users.user2, M.cRunOver({ idk: true /* ignored */ })],
        [users.myndzi, M.cReadyState({ ready: true, mods: [] })],
      ],
      serverMessages: (users) => [
        ...u1create_u2ready_u3join.serverMessages(users),
        sm('/room/room1', null, M.sHostStart({ forced: false /* always sent*/ })),
        sm(
          '/room/room1',
          null,
          M.sUserReadyState({
            userId: '42069',
            mods: [],
            ready: true,
          }),
        ),
        sm(null, users.myndzi, M.sHostStart({ forced: false })),
      ],
    });

    // name: "/endrun - indirect test via readystate update",
    tests.push({
      name: '/endrun - indirect test via readystate update',
      clientMessages: (users) => [
        ...u1create_u2ready_u3join.clientMessages(users),
        [users.user1, M.cStartRun({ forced: true /* ignored*/ })],
        [users.user1, M.cChat({ message: '/endrun' })],
        [users.myndzi, M.cReadyState({ ready: true, mods: [] })],
      ],
      serverMessages: (users) => [
        ...u1create_u2ready_u3join.serverMessages(users),
        sm('/room/room1', null, M.sHostStart({ forced: false /* always sent*/ })),
        sm(
          '/room/room1',
          null,
          M.sChat({
            id: 'chat1',
            userId: SYSTEM_USER.id,
            name: SYSTEM_USER.name,
            message: `Stats for run can be found at http://localhost:3000/stats/room1/stats1`,
          }),
        ),
        sm(
          '/room/room1',
          null,
          M.sUserReadyState({
            userId: '42069',
            mods: [],
            ready: true,
          }),
        ),
      ],
    });

    ///// game messages /////

    type gmTest = ['all' | 'others' | 'toHost' | 'byHost' | 'never', Envelope];

    const gameMessages: gmTest[] = [
      ['others', M.cPlayerUpdate({ curHp: 123 })],
      ['never', M.cPlayerUpdateInventory({ spells: [{ index: 1 }], wands: [], items: [] })],
      ['byHost', M.cHostItemBank({ gold: 1, items: [], objects: [], spells: [], wands: [] })],
      ['byHost', M.cHostUserTake({ id: '1', success: true, userId: '123' })],
      ['byHost', M.cHostUserTakeGold({ amount: 1, success: true, userId: '123' })],
      ['all', M.cPlayerAddGold({ amount: 1 })],
      ['toHost', M.cPlayerTakeGold({ amount: 1 })],
      ['all', M.cPlayerAddItem({ item: { case: 'spells', value: { list: [] } } })],
      ['toHost', M.cPlayerTakeItem({ id: '1' })],
      ['others', M.cPlayerPickup({ kind: { case: 'heart', value: { hpPerk: true } } })],
      ['others', M.cPlayerPickup({ kind: { case: 'orb', value: { id: 1 } } })],
      ['others', M.cNemesisAbility({ gameId: '1' })],
      ['others', M.cNemesisPickupItem({ gameId: '1' })],
      ['others', M.cPlayerNewGamePlus({ amount: 1 })],
      ['others', M.cPlayerSecretHourglass({ material: 'foo' })],
      ['all', M.cCustomModEvent({ payload: 'ohi' })],
      ['others', M.cAngerySteve({ idk: true })],
      ['others', M.cRespawnPenalty({ deaths: 1 })],
      ['others', M.cPlayerDeath({ isWin: true })],
      ['others', M.cPlayerDeath({ isWin: false })],
      ['others', M.playerMove({ frames: [{ x: 1, y: 2 }] })],
      ['never', M.playerMove({ userId: 'disallowed from client', frames: [{ x: 1, y: 2 }] })],
    ];

    const transformC2S = (env: Envelope, userId: string) => {
      const action = env.kind.value!.action;
      if (action.case === 'playerMove') {
        return new Envelope({
          kind: {
            case: 'gameAction',
            value: {
              action: {
                case: 'playerMove',
                value: {
                  ...action.value,
                  userId,
                },
              },
            },
          },
        });
      }
      return new Envelope({
        kind: {
          case: env.kind.case!,
          value: {
            action: {
              case: action.case!.replace(/^c/, 's'),
              value: {
                userId,
                ...action.value!,
              },
            },
          },
        },
      } as any);
    };

    for (const [type, env] of gameMessages) {
      const name = env.kind.value!.action.case;
      tests.push({
        name: `${name} - silent failure (inactive run)`,
        clientMessages: (users) => [...u1create_u2join_no_password.clientMessages(users), [users.user1, env]],
        serverMessages: (users) => [...u1create_u2join_no_password.serverMessages(users)],
      });

      if (type === 'never') {
        tests.push({
          name: `${name} - ${type}`,
          clientMessages: (users) => [...u1create_u2ready_u1start.clientMessages(users), [users.user2, env]],
          serverMessages: (users) => [...u1create_u2ready_u1start.serverMessages(users)],
        });
        continue;
      }

      tests.push({
        name: `${name} - ${type}`,
        clientMessages: (users) => [
          ...u1create_u2ready_u1start.clientMessages(users),
          [type === 'byHost' ? users.user1 : users.user2, env],
        ],
        serverMessages: (users) => [
          ...u1create_u2ready_u1start.serverMessages(users),
          sm(
            type === 'toHost' ? null : '/room/room1',
            type === 'all' || type === 'byHost' ? null : type === 'toHost' ? users.user1 : users.user2,
            transformC2S(env, type === 'byHost' ? '1' : '2'),
          ),
        ],
      });

      if (type === 'byHost') {
        tests.push({
          name: `${name} - ${type} - silent failure (not owner)`,
          clientMessages: (users) => [...u1create_u2ready_u1start.clientMessages(users), [users.user2, env]],
          serverMessages: (users) => [...u1create_u2ready_u1start.serverMessages(users)],
        });
      }
    }

    it.each(tests)('$name', ({ clientMessages, serverMessages }) => {
      let roomId = 1;
      let chatId = 1;
      let statsId = 1;

      const env = createTestEnv(
        false,
        () => `room${roomId++}`,
        () => `chat${chatId++}`,
        () => `stats${statsId++}`,
      );

      const { sentMessages, testSocket, handleOpen, handleMessage } = env;

      const users: Record<string, ClientAuthWebSocket> = {
        user1: testSocket('1', 'user1'),
        user2: testSocket('2', 'user2'),
        myndzi: testSocket('42069', 'myndzi'),
      };
      for (const user of Object.values(users)) {
        handleOpen(user);
      }

      const toSend = clientMessages(users);
      for (const [user, message] of toSend) {
        handleMessage(user, message.toBinary(), true);
      }

      const expectedMessages = serverMessages(users);
      expect(sentMessages.map((v) => v.message.kind?.value?.action?.case)).toEqual(
        expectedMessages.map((v) => v.message.kind?.value?.action?.case),
      );
      if (sentMessages.length === expectedMessages.length) {
        for (const [idx, sent] of sentMessages.entries()) {
          const exp = expectedMessages[idx];
          const sentM = sent.message.kind?.value?.action?.case;
          const expM = sent.message.kind?.value?.action?.case;
          try {
            expect(sent).toStrictEqual(exp);
          } catch (e) {
            if (e instanceof Error) {
              e.message = `Expected: ${expM} Got: ${sentM}\n\n${e.message}`;
            }
            throw e;
          }
        }
      }
    });
  });
});
