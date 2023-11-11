import { PartialMessage, PlainMessage } from '@bufbuild/protobuf';
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

const createTestEnv = (createRoomId?: () => string, createChatId?: () => string) => {
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

  const lobby = new LobbyState(publishers, createRoomId, createChatId);

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

describe('lobby conformance tests', () => {
  describe('socket open', () => {
    it('new connections get subscribed to the lobby', () => {
      const { testSocket, handleOpen, subscribed, lobby } = createTestEnv();
      const user = testSocket('id', 'name');

      handleOpen(user);
      expect(subscribed.get(user)?.has(lobby.topic)).toBe(true);
    });
  });

  describe('socket close', () => {
    it('closed connections clean up gracefully', () => {
      const { testSocket, handleOpen, handleClose, subscribed, lobby } = createTestEnv();
      const user = testSocket('id', 'name');
      handleOpen(user);
      handleClose(user, 1006, Buffer.from('test'));

      // we expect not to call "unsubscribe" on the websocket when responding
      // to a socket close event -- may be invalid/throw an error, but all
      // subscriptions will go away with the socket anyway
      expect(subscribed.get(user)?.has(lobby.topic)).toBe(true);
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
            maxUsers: 5,
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
            maxUsers: 5,
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
              maxUsers: 5,
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
            maxUsers: 5,
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
              maxUsers: 5,
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
              maxUsers: 5,
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
                maxUsers: 5,
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
              maxUsers: 5,
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
              maxUsers: 5,
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
              maxUsers: 5,
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
                maxUsers: 5,
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
              maxUsers: 5,
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
              maxUsers: 5,
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
                maxUsers: 5,
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
              maxUsers: 50,
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
              maxUsers: 50,
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
                maxUsers: 50,
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
              maxUsers: 5,
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
              maxUsers: 5,
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
                maxUsers: 5,
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
              maxUsers: 5,
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
              maxUsers: 5,
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
                maxUsers: 5,
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
              maxUsers: 5,
              name: 'room',
            }),
          ],
          [
            user1,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 5,
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
              maxUsers: 5,
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
                maxUsers: 5,
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
              maxUsers: 5,
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
                maxUsers: 5,
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

    // 'cChat, user in room - sender receives nothing, others receive chat',
    tests.push(
      t(
        'cChat, user in room - sender receives nothing, others receive chat',
        ({ user1 }) => [
          [
            user1,
            M.cRoomCreate({
              gamemode: 0,
              maxUsers: 5,
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
              maxUsers: 5,
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
                maxUsers: 5,
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
                maxUsers: 5,
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

    // name: 'cRoomUpdate (lock) - success',
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
                maxUsers: 5,
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
              maxUsers: 5,
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
              maxUsers: 5,
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
                maxUsers: 5,
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
                  maxUsers: 5,
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
            maxUsers: 5,
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
    tests.push({
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
            maxUsers: 5,
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
    });

    it.each(tests)('$name', ({ clientMessages, serverMessages }) => {
      let roomId = 1;
      let chatId = 1;
      const env = createTestEnv(
        () => `room${roomId++}`,
        () => `chat${chatId++}`,
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

      expect(sentMessages).toEqual(serverMessages(users));
    });
  });
});
