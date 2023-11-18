import { v4 as uuidv4 } from 'uuid';
import { IUser } from './user';

export enum StatsEvent {
  // BigSteveKill,
  SteveKill,
  // EnemyKilled,
  UserDeath,
  UserWin,
  HeartPickup,
  OrbPickup,
}

type Entries<T> = {
  [K in keyof T]: [K, T[K]];
}[keyof T][];

const initialMap = new Map<StatsEvent, number>();
for (const [_, val] of Object.entries(StatsEvent) as Entries<typeof StatsEvent>) {
  initialMap.set(val, 0);
}

export class StatsRecorder {
  readonly id: string;
  private usernames = new Map<string, string>();
  private counters = new Map<string, Map<StatsEvent, number>>();

  constructor(users: IUser[], createId: () => string = uuidv4) {
    this.id = createId();

    // record users that were present at game start, even if they
    // never generate any stats
    for (const { id, name } of users) {
      this.usernames.set(id, name);
      this.counters.set(id, new Map(initialMap));
    }
  }

  increment(user: IUser, event: StatsEvent) {
    this.usernames.set(user.id, user.name);
    const userStats = this.counters.get(user.id) ?? new Map(initialMap);
    userStats.set(event, userStats.get(event)! + 1);
    this.counters.set(user.id, userStats);
  }

  toJSON(name: string) {
    const events = Object.entries(StatsEvent).filter(([k, v]) => typeof v === 'number');

    const headings = ['Player', ...events.map(([key]) => key)];
    const rows: [string, ...number[]][] = [];
    for (const [userId, userStats] of this.counters.entries()) {
      const username = this.usernames.get(userId)!;
      rows.push([username, ...events.map(([_, val]) => userStats.get(val as StatsEvent)!)]);
    }

    return { name, id: this.id, headings, rows };
  }
}
