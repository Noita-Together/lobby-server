import { M, NT, tagPlayerMove } from '@noita-together/nt-message';

import {
  CreateBigRoomOpts,
  CreateRoomOpts,
  UpdateBigRoomOpts,
  UpdateRoomOpts,
  validateRoomOpts,
} from '../runtypes/room_opts';
import { Deferred, Publishers, createChat, formatDuration, makeDeferred, randomRoomName } from '../util';
import { GameActionHandlers } from '../types';
import { defaultEnv, statsUrl } from '../env_vars';
const { DRAIN_GRACE_TIMEOUT_MS, DRAIN_NOTIFY_INTERVAL_MS } = defaultEnv;

import { IUser, UserState } from './user';
import { LobbyState, SYSTEM_USER } from './lobby';
import { StatsEvent, StatsRecorder } from './stats_recorder';
import { RoomName } from '../room_tracker';

import { v4 as uuidv4 } from 'uuid';

import Debug from 'debug';
const debug = Debug('nt:room');

let id = 0;

const DESIGN_PLAYER_START_POS_X = 227;
const DESIGN_PLAYER_START_POS_Y = -85;

export type RoomUserUpdate = {
  userId: string;
  name: string;
  ready: boolean;
  owner: boolean;
};
export type RoomUpdate = {
  id: string;
  name: string;
  gamemode: number;
  curUsers: number;
  maxUsers: number;
  protected: boolean;
  locked: boolean;
  owner: string;
  password: string; // lol. remove?
  users: RoomUserUpdate[];
};

export type RoomStateCreateOpts = CreateRoomOpts | CreateBigRoomOpts;
export type RoomStateUpdateOpts = UpdateRoomOpts | UpdateBigRoomOpts;

/**
 * Represents the state of a room in an NT lobby
 */
export class RoomState implements GameActionHandlers<'cPlayerMove'> {
  private static readonly emptyFlags = M.sRoomFlagsUpdated({}, true);

  private readonly lobby: LobbyState;
  private readonly broadcast: ReturnType<Publishers['broadcast']>;

  readonly id: string;
  readonly owner: UserState;
  readonly topic: string;

  private users = new Set<UserState>();
  private bannedUsers = new Set<string>();
  private allowedMods = new WeakMap<UserState, string>();

  private name: string;
  private gamemode: number;
  private maxUsers: number;
  private locked: boolean;
  private inProgress: boolean;
  private password?: string;

  private lastFlags: Uint8Array;
  private stats: StatsRecorder | undefined = undefined;
  private pastStats = new Map<string, string>();

  private $drain: Deferred | undefined = undefined;

  private chat: (user: IUser, message: string) => NT.Envelope;
  // private playerPositions: PlayerPositions;

  private constructor(
    lobby: LobbyState,
    owner: UserState,
    { name, password, gamemode, maxUsers }: RoomStateCreateOpts,
    publishers: Publishers,
    private releaseRoomName: () => void,
    roomId?: string,
    createChatId?: () => string,
    private createStatsId?: () => string,
  ) {
    this.chat = createChat(createChatId);
    this.lobby = lobby;

    // this.id = `${id++}`;
    this.id = roomId ?? uuidv4();

    this.owner = owner;
    this.topic = `/room/${this.id}`;

    this.broadcast = publishers.broadcast(this.topic);

    this.name = name;
    this.password = password ?? undefined;
    this.gamemode = gamemode;
    this.maxUsers = maxUsers;
    this.locked = false;
    this.inProgress = false;

    this.lastFlags = RoomState.emptyFlags;

    // this.playerPositions = new PlayerPositions(this.broadcast, 50);
  }

  /**
   * Return an iterator for the users present in this  room
   */
  getUsers(): IterableIterator<UserState> {
    return this.users.values();
  }

  /**
   * The room's name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Return the simplified representation of a user, used to
   * construct "users in this room" messages
   */
  private roomUpdateUserData(user: UserState) {
    return {
      userId: user.id,
      name: user.name,
      ready: user.isReady(),
      owner: user === this.owner,
    };
  }

  /**
   * Return the simplified representation of a room, used to
   * construct room update messages
   */
  getState(): RoomUpdate {
    // TODO: not all of these fields get used by every protobuf message. in particular,
    // `password` is elided from most of the messages when being encoded. ideally, we
    // wouldn't send password at all, ever, but the PB for create room confirmation
    // currently expects it, so we'll keep it for now. to avoid needing to make changes
    // to the NT app
    return {
      id: this.id,
      name: this.name,
      gamemode: this.gamemode,
      curUsers: this.users.size,
      maxUsers: this.maxUsers,
      protected: !!this.password,
      locked: this.locked,
      owner: this.owner.name,
      password: this.password ?? '',
      users: [...this.users.values()].map((u) => this.roomUpdateUserData(u)),
    };
  }

  /**
   * Create a new room. Returns `null` if the room could not be created.
   *
   * `roomId` and `createChatId` are test stubs, and should not be used
   * in production.
   */
  static create({
    lobby,
    owner,
    opts: _opts,
    publishers,
    devMode,
    roomId,
    createChatId,
    createStatsId,
    createRoomName,
  }: {
    lobby: LobbyState;
    owner: UserState;
    opts: RoomStateCreateOpts;
    publishers: Publishers;
    devMode: boolean;
    roomId?: string;
    createChatId?: () => string;
    createStatsId?: () => string;
    createRoomName?: (userSuppliedName: string | null) => RoomName;
  }): RoomState | void {
    let opts: RoomStateCreateOpts | string;

    if (devMode && owner.uaccess < 3) {
      owner.send(M.sRoomCreateFailed({ reason: 'Room creation is disabled at the moment, Server is in dev mode :)' }));
      return;
    }

    // if the room name is specified *and* the user has access, use the name as-is. otherwise,
    // pull a random room name from the pool
    const trimmed = owner.uaccess > 0 ? _opts.name?.trim() : null;
    const roomName: RoomName = (createRoomName ?? randomRoomName)(trimmed);

    if (roomName.ok === false) {
      // no available room names
      owner.send(M.sRoomCreateFailed({ reason: roomName.error }));
      return;
    }

    _opts.name = roomName.name;

    opts = validateRoomOpts(owner.uaccess > 1 ? CreateBigRoomOpts : CreateRoomOpts, _opts);

    if (typeof opts === 'string') {
      owner.send(M.sRoomCreateFailed({ reason: opts }));
      return;
    }

    // user owned another room. probably they reconnected. destroy old room.
    owner.room()?.delete(owner);

    const room = new RoomState(lobby, owner, opts, publishers, roomName.release, roomId, createChatId, createStatsId);
    debug(room.id, 'created');

    room.users.add(owner);

    const roomData = room.getState();
    owner.send(M.sRoomCreated(roomData));

    owner.joined(room, true);
    // lobby.broadcast(M.sRoomAddToList({ room: roomData }));

    // room.playerPositions.updatePlayers(room.users);
    // room.playerPositions.push(
    //   owner.id,
    //   M.sPlayerPos({
    //     userId: owner.id,
    //     x: DESIGN_PLAYER_START_POS_X,
    //     y: DESIGN_PLAYER_START_POS_Y,
    //   }),
    // );

    return room;
  }

  /**
   * Get stats for a concluded run, if present
   */
  getStats(statsId: string): string | void {
    return this.pastStats.get(statsId);
  }

  /**
   * Drain the room by the given time
   *
   * @param inMs The drop-dead time after which the room will be destroyed
   */
  drain(inMs: number): Promise<void> {
    // notify the room every minute that things are going to implode
    const drainEnd = Date.now() + inMs;

    const notify = () => {
      this.broadcast(
        this.chat(
          SYSTEM_USER,
          `Server will shut down in ${formatDuration(
            drainEnd - Date.now(),
          )}. Please finish ongoing runs and re-launch the Noita Together application.`,
        ),
      );
    };

    let interval: NodeJS.Timeout;
    if (!this.$drain) {
      interval = setInterval(notify, DRAIN_NOTIFY_INTERVAL_MS).unref();
      notify();
    }

    let timer: NodeJS.Timeout;

    const deferred = makeDeferred(() => {
      clearInterval(interval);
      clearTimeout(timer);
      this.destroy();
    });

    const destroyRoomIn = this.inProgress ? inMs : DRAIN_GRACE_TIMEOUT_MS;
    // destroy the room directly after the drop dead time expires
    timer = setTimeout(deferred.resolve, destroyRoomIn).unref();

    this.$drain = deferred;
    return deferred.promise;
  }

  /**
   * Update the room's settings
   *
   * @param actor UserState instance of the user making the change
   */
  update(actor: UserState, opts: RoomStateUpdateOpts): string | void {
    if (this.owner !== actor) return "Can't do that.";

    const _opts = validateRoomOpts(this.owner.uaccess > 1 ? UpdateBigRoomOpts : UpdateRoomOpts, opts);
    if (typeof _opts === 'string') return _opts;

    /* istanbul ignore next */
    if (debug.enabled) {
      debug(this.id, 'updating options', this.DEBUG_ONLY_optsValue(opts, _opts));
    }

    if (_opts.name !== undefined) this.name = _opts.name;
    if (_opts.password != undefined) this.password = _opts.password;
    if (_opts.gamemode !== undefined) this.gamemode = _opts.gamemode;
    if (_opts.maxUsers !== undefined) this.maxUsers = _opts.maxUsers;
    if (_opts.locked !== undefined) this.locked = _opts.locked;

    this.broadcast(M.sRoomUpdated(_opts));
  }

  /**
   * Update the room's flags
   *
   * Most flags are set to `true` if present in the `flags` array in the payload,
   * and `false` if not present (even though the payload has a boolean value that
   * could be used for this purpose)
   *
   * @param actor UserState instance of the user making the change
   */
  setFlags(actor: UserState, payload: NT.ClientRoomFlagsUpdate): string | void {
    if (this.owner !== actor) return "Can't do that.";

    debug(this.id, 'updating flags', payload.flags.map(this.DEBUG_ONLY_flagValue));

    const flags = M.sRoomFlagsUpdated(payload, true);

    // store the last-known flags as an already-encoded buffer, since we'll be
    // replaying it to people who join
    this.lastFlags = flags;

    this.broadcast(flags);
  }

  /**
   * Return the encoded ServerRoomFlagsUpdated message representing the
   * current room flags
   */
  getFlags(): Uint8Array {
    return this.lastFlags;
  }

  /**
   * Called when the readyState of a user present in this room has changed
   *
   * @param actor UserState instance of the user whose readyState changed
   */
  onUserReadyStateChange(actor: UserState, payload: NT.ClientReadyState) {
    this.broadcast(M.sUserReadyState({ userId: actor.id, ...payload }));

    // if the game is already in progress, and the user's mods have not
    // changed from what they were when the game started, send them a
    // synthetic "start" message so that they can immediately begin playing
    if (this.inProgress && payload.ready) {
      const allowedMods = this.allowedMods.get(actor);
      if (allowedMods !== actor.mods()) return;
      actor.send(M.sHostStart({ forced: false }));
    }
  }

  /**
   * Set the room's run status to "in progress" and notify the room's users.
   *
   * For each user, stores their current list of mods; this is used to auto-
   * start the run if they rejoin (and their mods haven't changed)
   *
   * @param actor UserState instance of the initiating user
   */
  startRun(actor: UserState, payload: NT.ClientStartRun) {
    // no error for this yet
    if (this.owner !== actor) return;

    debug(this.id, 'start run');

    if (this.gamemode === 0) {
      // only tracking coop stats for now
      this.stats ??= new StatsRecorder(this.createStatsId);
      this.stats.initUsers(this.users);
    }

    // store the mods that users had at the start of a run
    for (const user of this.users) {
      this.allowedMods.set(user, user.mods());
    }

    this.inProgress = true;

    // current server just sends this with {forced: false} even though
    // the message payload contains various things. imitating that for now
    this.broadcast(M.sHostStart({ forced: false }));

    // this.broadcast(M.sHostStart(payload));
  }

  /**
   * Reset the room's state.
   */
  private reset() {
    this.inProgress = false;

    // if server is draining, close the room shortly after the run is ended
    if (this.$drain) {
      const deferred = this.$drain;

      this.broadcast(
        this.chat(
          SYSTEM_USER,
          `Server is shutting down for an upgrade. Please restart the Noita Together application. Room will self-destruct in ${formatDuration(
            DRAIN_GRACE_TIMEOUT_MS,
          )}!`,
        ),
      );

      // give people time to copy / view the stats link
      setTimeout(deferred.resolve, DRAIN_GRACE_TIMEOUT_MS).unref();
    }

    if (this.stats) {
      this.pastStats.set(this.stats.id, JSON.stringify(this.stats.toJSON(this)));
    }
    this.stats = undefined;

    // the run is over. reset the "allowed mods" list
    this.allowedMods = new WeakMap();

    // TODO: should the _server_ reset the "ready" flag on
    // the users, or will the app do the right thing out of
    // the box?
    //
    // since there's no message for "the run ended", i'm
    // guessing not, but i also don't know whether the clients
    // will correctly send a ready state update if i push out
    // an empty readystate. investigation needed
  }

  /**
   * End the current run
   *
   * @param actor UserState instance of the initiating user
   */
  finishRun(actor: UserState) {
    // no error for this yet
    if (this.owner !== actor) return;

    debug(this.id, 'finish run');
    if (this.stats) {
      const url = statsUrl(this.id, this.stats.id);
      this.broadcast(this.chat(SYSTEM_USER, `Stats for run can be found at ${url}`));
    }

    this.reset();
  }

  /**
   * Attempt to join a user to this room
   *
   * @param user UserState instance of the joining user
   * @param password Supplied password, if any, that the user gave when attempting to join
   */
  join(user: UserState, password?: string | null): void {
    let reason: string | null = null;
    let joinMessage = 'joined the room.';
    const room = user.room();

    if (!room) {
      // user isn't in any room, do the usual checks
      if (this.bannedUsers.has(user.id)) reason = 'Banned from this room.';
      else if (this.users.size >= this.maxUsers) reason = 'Room is full.';
      else if (this.password && this.password !== password) reason = 'Bad password.';
      else if (this.locked) reason = 'Room is locked.';
    } else if (room !== this) {
      // user (probably) got disconnected while in a room, but is trying to join a different
      // room. delete the old room if user is the owner, otherwise just leave
      room.delete(user) || room.part(user);
    } else {
      joinMessage = 'rejoined the room.';
      // user (probably) got disconnected while in a room, and is rejoining it. allow them in
      // the NT app currently provides no way to join a room without leaving the
      // current room, but could in the future. if so, this assumption changes
    }

    if (reason) {
      user.send(M.sJoinRoomFailed({ reason }));
      return;
    }

    debug(this.id, joinMessage, user.id, user.name);
    this.users.add(user);

    // broadcast the join to everyone except the user that joined
    // that user will receive a different confirmation in `user.joined`
    user.broadcast(
      this.topic,
      M.sUserJoinedRoom({
        userId: user.id,
        name: user.name,
      }),
    );
    this.broadcast(this.chat(SYSTEM_USER, `${user.name} ${joinMessage}`));

    user.joined(this);

    // this.playerPositions.updatePlayers(this.users);
    // this.playerPositions.push(
    //   user.id,
    //   M.sPlayerPos({
    //     userId: user.id,
    //     x: DESIGN_PLAYER_START_POS_X,
    //     y: DESIGN_PLAYER_START_POS_Y,
    //   }),
    // );
  }

  /**
   * Remove a user from this room
   *
   * @param actor UserState instance of the user initiating the removal, or `null` if voluntary
   * @param target UserState instance of the user being removed
   * @param pb Envelope creator for the control message to be sent
   * @param message Human-readable message explaining why the user left
   */
  private removeUser<T extends (...args: any) => NT.Envelope>(
    actor: UserState | null,
    target: UserState | undefined,
    pb: T,
    message: string,
  ) {
    /* istanbul ignore next */
    if (!target) {
      // this should never happen, but the return type of (Map)users.get(userid) is _technically_
      // UserState|undefined, so if some state gets wrong we want to know about it
      console.error('BUG: removeUser called with an undefined user', new Error().stack);
      return;
    }

    // when actor is specified, it's an admin action like a kick or a ban. there's
    // no response message in the proto yet to describe a failed attempt, so we just
    // ignore these
    if (actor !== null && this.owner !== actor) return;

    // when the owner leaves the room, destroy it
    if (this.delete(target)) return;

    // otherwise, remove user from room and notify everybody
    this.users.delete(target);

    // send the control message confirming the removal
    this.broadcast(pb({ userId: target.id }));

    // send a chat message to the room
    this.broadcast(this.chat(SYSTEM_USER, `${target.name} ${message}`));

    // update leaving user state and subscriptions before sending the chat update
    target.parted(this);

    // this.playerPositions.updatePlayers(this.users);
    debug(this.id, 'user left', target.id, target.name, message);
  }

  /**
   * Voluntary leave this room
   *
   * @param actor UserState instance of the user leaving the room
   */
  part(actor: UserState) {
    this.removeUser(null, actor, M.sUserLeftRoom, 'has left.');
  }

  disconnected(actor: UserState) {
    if (this.inProgress) {
      // if user disconnected while game is in progress, leave them in the list of
      // users so that they can reconnect.

      // send a "user left room" message to the lobby to update the NT app's UI
      this.broadcast(M.sUserLeftRoom({ userId: actor.id }));
      // send a message explaining what happened
      this.broadcast(this.chat(SYSTEM_USER, `${actor.name} disconnected.`));
    } else {
      // if user disconnected while game is NOT in progress, just remove them
      this.removeUser(null, actor, M.sUserLeftRoom, 'disconnected.');
    }
  }

  /**
   * Remove a user from this room. They may rejoin.
   *
   * @param actor UserState instance of the initiating user
   * @param target UserState instance of the user being removed
   */
  kick(actor: UserState, target: UserState) {
    this.removeUser(actor, target, M.sUserKicked, 'has been kicked from this room.');
  }

  /**
   * Remove a user from this room. They may NOT rejoin.
   *
   * @param actor UserState instance of the initiating user
   * @param target UserState instance of the user being removed
   */
  ban(actor: UserState, target: UserState) {
    this.bannedUsers.add(target.id);
    this.removeUser(actor, target, M.sUserBanned, 'has been banned from this room.');
  }

  /**
   * Gracefully tear down this room. Checks permissions of the actor.
   *
   * @param actor UserState instance of the initiating user
   */
  delete(actor: UserState): boolean {
    // no error for this one either if invalid
    if (this.owner !== actor) return false;

    this.destroy();
    return true;
  }

  /**
   * Gracefully tear down this room. Does NOT check permissions; should
   * be used only by system processes.
   */
  destroy() {
    // give this room's name back to the pool
    this.releaseRoomName();
    this.broadcast(M.sRoomDeleted({ id: this.id }));

    // this.playerPositions.destroy();

    for (const user of this.users) {
      // uWS _says_ that ordering of sends and unsubscribes is guaranteed, but if
      // we broadcast to the topic and then unsubscribe, the client does not appear
      // to be receiving the message.
      user.parted(this);
    }

    this.lobby.roomDestroyed(this);
    this.users.clear();

    if (this.$drain) {
      this.$drain.resolve();
    }

    debug(this.id, 'destroyed');
  }

  //// message handlers ////

  cPlayerMove(cpf: Buffer, user: UserState) {
    if (!this.inProgress) return;

    const bigUpdate = tagPlayerMove(cpf, user.playerIdBuf);
    if (!bigUpdate) return;

    user.broadcast(this.topic, new Uint8Array(bigUpdate));
  }

  cPlayerUpdate(payload: NT.ClientPlayerUpdate, user: UserState) {
    if (!this.inProgress) return;
    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sPlayerUpdate({ userId: user.id, ...payload }));
  }
  cPlayerUpdateInventory(payload: NT.ClientPlayerUpdateInventory, user: UserState) {
    // not implemented in current server
  }
  cHostItemBank(payload: NT.ClientHostItemBank, user: UserState) {
    if (!this.inProgress) return;

    // { ownerOnly: true }
    if (this.owner !== user) return;

    this.broadcast(M.sHostItemBank(payload));
  }
  cHostUserTake(payload: NT.ClientHostUserTake, user: UserState) {
    if (!this.inProgress) return;

    // { ownerOnly: true }
    if (this.owner !== user) return;

    this.broadcast(M.sHostUserTake(payload));
  }
  cHostUserTakeGold(payload: NT.ClientHostUserTakeGold, user: UserState) {
    if (!this.inProgress) return;

    // { ownerOnly: true }
    if (this.owner !== user) return;

    this.broadcast(M.sHostUserTakeGold(payload));
  }
  cPlayerAddGold(payload: NT.ClientPlayerAddGold, { id: userId }: UserState) {
    if (!this.inProgress) return;
    this.broadcast(M.sPlayerAddGold({ userId, ...payload }));
  }
  cPlayerTakeGold(payload: NT.ClientPlayerTakeGold, { id: userId }: UserState) {
    if (!this.inProgress) return;

    // { toHost: true }
    this.owner.send(M.sPlayerTakeGold({ userId, ...payload }));
  }
  cPlayerAddItem(payload: NT.ClientPlayerAddItem, { id: userId }: UserState) {
    if (!this.inProgress) return;
    this.broadcast(M.sPlayerAddItem({ userId, ...payload }));
  }
  cPlayerTakeItem(payload: NT.ClientPlayerTakeItem, { id: userId }: UserState) {
    if (!this.inProgress) return;

    // { toHost: true }
    this.owner.send(M.sPlayerTakeItem({ userId, ...payload }));
  }
  cPlayerPickup(payload: NT.ClientPlayerPickup, user: UserState) {
    debug('cPlayerPickup', this.inProgress, user.name, payload);
    if (!this.inProgress) return;

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sPlayerPickup({ userId: user.id, ...payload }));

    switch (payload.kind) {
      case 'heart':
        this.stats?.increment(user, StatsEvent.HeartPickup);
        break;
      case 'orb':
        this.stats?.increment(user, StatsEvent.OrbPickup);
        break;
      default:
        debug('unknown oneof case in cPlayerPickup: ', payload.kind);
        break;
    }
  }
  cNemesisAbility(payload: NT.ClientNemesisAbility, user: UserState) {
    if (!this.inProgress) return;

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sNemesisAbility({ userId: user.id, ...payload }));
  }
  cNemesisPickupItem(payload: NT.ClientNemesisPickupItem, user: UserState) {
    if (!this.inProgress) return;

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sNemesisPickupItem({ userId: user.id, ...payload }));
  }
  cPlayerNewGamePlus(payload: NT.ClientPlayerNewGamePlus, user: UserState) {
    if (!this.inProgress) return;

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sPlayerNewGamePlus({ userId: user.id, ...payload }));
  }
  cPlayerSecretHourglass(payload: NT.ClientPlayerSecretHourglass, user: UserState) {
    if (!this.inProgress) return;

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sPlayerSecretHourglass({ userId: user.id, ...payload }));
  }
  cCustomModEvent(payload: NT.ClientCustomModEvent, { id: userId }: UserState) {
    if (!this.inProgress) return;
    // in the original source:
    // {
    //   ignoreSelf: payload.ignoreSelf,
    //   toHost: payload.toHost
    // }
    // but `payload` is a string, so these would always be undefined?
    // if it's parsed as json, i don't see where that is happening
    this.broadcast(M.sCustomModEvent({ userId, ...payload }));
  }
  // cCustomModHostEvent - implemented in original, but doesn't seem to be referenced, and has no proto message
  cAngerySteve(payload: NT.ClientAngerySteve, user: UserState) {
    if (!this.inProgress) return;

    this.stats?.increment(user, StatsEvent.SteveKill);

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sAngerySteve({ userId: user.id, ...payload }));
  }
  cRespawnPenalty(payload: NT.ClientRespawnPenalty, user: UserState) {
    if (!this.inProgress) return;

    this.stats?.increment(user, StatsEvent.UserDeath);

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sRespawnPenalty({ userId: user.id, ...payload }));
  }
  cPlayerDeath(payload: NT.ClientPlayerDeath, user: UserState) {
    if (!this.inProgress) return;

    this.stats?.increment(user, payload.isWin ? StatsEvent.UserWin : StatsEvent.UserDeath);

    // { ignoreSelf: true }
    user.broadcast(this.topic, M.sPlayerDeath({ userId: user.id, ...payload }));
  }
  cChat(payload: NT.ClientChat, user: UserState) {
    if (!payload.message) return;
    const msg = payload.message!;
    if (this.owner === user && msg.startsWith('/')) {
      switch (msg.toLowerCase()) {
        case '/endrun':
          this.finishRun(user);
          break;
      }
      return;
    }
    user.withSocket(this.broadcast, this.chat(user, msg));
  }
  // cPlayerEmote - implemented in original, but doesn't seem to be referenced, and has no proto message

  //// helpers ////
  private static readonly validProps = new Set<string>(Object.keys(CreateRoomOpts.properties));
  private static readonly sym_unknown: unique symbol = Symbol('unknown');

  /*istanbul ignore next*/
  private DEBUG_ONLY_flagValue = (flag: NT.ClientRoomFlagsUpdate.IGameFlag) => {
    // TODO: the NT app weirdly/incorrectly uses _optionality_ of flag message fields to signal
    // whether they are enabled or disabled. improving this requires a change to the app itself.
    // since we are unable to determine the expected type of a flag, we must currently rely on
    // assumptions about how the app behaves:
    // - the app only sends numeric or boolean flags
    // - numbers are set in the "uIntVal" field
    // - booleans are true if present, false if absent
    if (flag.uIntVal !== undefined) {
      return `${flag.flag}=${flag.uIntVal ?? 0}`;
    } else {
      return `${flag.flag}=true`;
    }
  };

  /* istanbul ignore next */
  private DEBUG_ONLY_optsValue = (received: Partial<CreateRoomOpts>, validated: Partial<CreateRoomOpts>) => {
    const res: any = {};
    const unknown: string[] = [];
    for (const key of Object.keys(validated) as (keyof CreateRoomOpts)[]) {
      if (validated[key] === undefined) continue;

      if (RoomState.validProps.has(key)) {
        res[key] = [this[key], received[key], validated[key]];
      } else {
        unknown.push(key);
      }
    }
    if (unknown.length > 0) res[RoomState.sym_unknown] = unknown;
    return res;
  };
}
