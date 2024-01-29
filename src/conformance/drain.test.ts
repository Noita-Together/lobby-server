import { M } from '@noita-together/nt-message';
import { createTestEnv } from './common';

const flushPromises = () => new Promise(jest.requireActual('timers').setImmediate);

describe('server drain', () => {
  it('resolves immediately with no connected users', async () => {
    jest.useFakeTimers();

    const { lobby } = createTestEnv(false);

    const cb = jest.fn();
    lobby.drain(2).then(cb);

    jest.advanceTimersByTime(1);
    await flushPromises();
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('resolves immediately with users connected but no open rooms', async () => {
    jest.useFakeTimers();

    const { testSocket, handleOpen, lobby } = createTestEnv(false);
    const user = testSocket('id', 'name');
    handleOpen(user);

    const cb = jest.fn();
    lobby.drain(2).then(cb);

    jest.advanceTimersByTime(1);
    await flushPromises();
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it("resolves after the drop-dead timeout with open rooms that ARE actively in a run that doesn't finish", async () => {
    jest.useFakeTimers();

    const { testSocket, handleOpen, handleMessage, lobby } = createTestEnv(false);
    const user = testSocket('id', 'name');
    handleOpen(user);
    handleMessage(user, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name's room" }, true), true);
    handleMessage(user, M.cStartRun({}, true), true);

    const cb = jest.fn();
    lobby.drain(10 * 60 * 1000).then(cb);

    jest.advanceTimersByTime(6 * 60 * 1000);
    await flushPromises();
    expect(cb).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(4 * 60 * 1000);
    await flushPromises();
    expect(cb).toHaveBeenCalledTimes(1);
  });
  // when drop-dead time is later than the 5-minute run-end timeout
  it('resolves after the 5-minute timeout with open rooms that ARE actively in a run when the run ends', async () => {
    jest.useFakeTimers();

    const { testSocket, handleOpen, handleMessage, lobby } = createTestEnv(false);
    const user = testSocket('id', 'name');
    handleOpen(user);
    handleMessage(user, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name's room" }, true), true);
    handleMessage(user, M.cStartRun({}, true), true);

    const cb = jest.fn();
    lobby.drain(10 * 60 * 1000).then(cb);

    await flushPromises();

    handleMessage(user, M.cRunOver({}, true), true);

    jest.advanceTimersByTime(5 * 60 * 1000 - 1);
    await flushPromises();
    expect(cb).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(1);
    await flushPromises();
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('resolves immediately when all open rooms are destroyed', async () => {
    jest.useFakeTimers();

    const { testSocket, handleOpen, handleMessage, lobby } = createTestEnv(false);
    const user1 = testSocket('id1', 'name1');

    handleOpen(user1);
    handleMessage(user1, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name1's room" }, true), true);

    const user2 = testSocket('id2', 'name2');
    handleOpen(user2);
    handleMessage(user2, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name2's room" }, true), true);

    const cb = jest.fn();
    lobby.drain(2).then(cb);

    jest.advanceTimersByTime(1);
    await flushPromises();

    handleMessage(user1, M.cLeaveRoom({ userId: 'unused' }, true), true);
    jest.advanceTimersByTime(1);
    await flushPromises();

    expect(cb).toHaveBeenCalledTimes(0);

    handleMessage(user2, M.cLeaveRoom({ userId: 'unused' }, true), true);
    jest.advanceTimersByTime(1);
    await flushPromises();

    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('prevents creation of new rooms when draining', async () => {
    const { testSocket, handleOpen, handleMessage, lobby, sentMessages, expectLobbyAction } = createTestEnv(false);

    lobby.drain(2);
    jest.advanceTimersByTime(10);
    await flushPromises();

    const user = testSocket('id', 'name');
    handleOpen(user);
    handleMessage(user, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name's room" }, true), true);

    const sRoomCreated = expectLobbyAction('sRoomCreateFailed');
    expect(sRoomCreated.reason).toMatch(/shutting down/i);
    expect(sentMessages).toEqual([]);
  });
  it('prevents starting new runs when draining', async () => {
    const { testSocket, handleOpen, handleMessage, lobby, sentMessages, expectGameAction, expectLobbyAction } =
      createTestEnv(false);
    const user = testSocket('id', 'name');
    handleOpen(user);
    handleMessage(user, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name's room" }, true), true);
    expectLobbyAction('sRoomCreated');
    expectLobbyAction('sRoomAddToList');

    lobby.drain(30_000);

    jest.advanceTimersByTime(1);
    await flushPromises();

    const chat1 = expectGameAction('sChat');
    expect(chat1.message).toMatch(/will shut down.*minute/i);

    handleMessage(user, M.cStartRun({}, true), true);

    jest.advanceTimersByTime(29_999);
    await flushPromises();

    const chat2 = expectGameAction('sChat');
    expect(chat2.message).toMatch(/shutting down/i);

    // there is no response to cStartRun - so it is not expected to be able to fail
    // since we can't check for a failure response, we'll instead ensure no "start game" message was sent
    expect(sentMessages).toEqual([]);
  });
  it('notifies rooms immediately of a pending shutdown', async () => {
    jest.useFakeTimers();

    const { testSocket, handleOpen, handleMessage, lobby, sentMessages, expectGameAction, expectLobbyAction } =
      createTestEnv(false);
    const user = testSocket('id', 'name');

    handleOpen(user);
    handleMessage(user, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name's room" }, true), true);
    handleMessage(user, M.cStartRun({}, true), true);

    expectLobbyAction('sRoomCreated');
    expectLobbyAction('sRoomAddToList');
    expectLobbyAction('sHostStart');

    lobby.drain(10 * 60 * 1000);

    jest.advanceTimersByTime(1);
    await flushPromises();

    const chat1 = expectGameAction('sChat');
    expect(chat1.message).toMatch(/will shut down/i);

    jest.advanceTimersByTime(60 * 1000 - 2);
    await flushPromises();
    expect(sentMessages).toEqual([]);

    jest.advanceTimersByTime(1);
    await flushPromises();

    const chat2 = expectGameAction('sChat');
    expect(chat2.message).toMatch(/will shut down.*minutes/i);
    expect(sentMessages).toEqual([]);
  });
  it('notifies rooms after a run finishes', async () => {
    jest.useFakeTimers();

    const { testSocket, handleOpen, handleMessage, lobby, sentMessages, expectGameAction, expectLobbyAction } =
      createTestEnv(false);
    const user = testSocket('id', 'name');

    handleOpen(user);
    handleMessage(user, M.cRoomCreate({ gamemode: 0, maxUsers: 5, name: "name's room" }, true), true);
    handleMessage(user, M.cStartRun({}, true), true);

    expectLobbyAction('sRoomCreated');
    expectLobbyAction('sRoomAddToList');
    expectLobbyAction('sHostStart');

    lobby.drain(10 * 60 * 1000);

    jest.advanceTimersByTime(1);
    await flushPromises();

    // initial broadcast notification
    const chat1 = expectGameAction('sChat');
    expect(chat1.message).toMatch(/will shut down/i);

    handleMessage(user, M.cRunOver({}, true), true);

    jest.advanceTimersByTime(1);
    await flushPromises();

    // run-over stats message (optional)
    const chat2 = (() => {
      const maybeStatsChat = expectGameAction('sChat');
      if (!/stats for run/i.test(maybeStatsChat.message ?? '')) return maybeStatsChat;
      return expectGameAction('sChat');
    })();

    expect(chat2.message).toMatch(/shutting down.*self-destruct.*minutes/i);
    expect(sentMessages).toEqual([]);
  });
});
