import { RoomState } from './room';
import { StatsEvent, StatsRecorder } from './stats_recorder';

describe('StatsRecorder', () => {
  describe('toJSON', () => {
    it('returns a table of stats', () => {
      const sr = new StatsRecorder();
      sr.initUsers(
        [
          { id: '12', name: 'foo' },
          { id: '56', name: 'baz' },
        ].values(),
      );
      sr.increment({ id: '12', name: 'foo' }, StatsEvent.SteveKill);
      sr.increment({ id: '12', name: 'foo' }, StatsEvent.HeartPickup);
      sr.increment({ id: '12', name: 'foo' }, StatsEvent.HeartPickup);
      sr.increment({ id: '34', name: 'bar' }, StatsEvent.OrbPickup);

      const res = sr.toJSON({ id: 'roomId', getName: () => 'roomName' } as any);
      expect(res).toStrictEqual({
        id: sr.id,
        roomId: 'roomId',
        name: 'roomName',
        headings: ['Player', 'SteveKill', 'UserDeath', 'UserWin', 'HeartPickup', 'OrbPickup'],
        rows: [
          ['foo', 1, 0, 0, 2, 0],
          ['baz', 0, 0, 0, 0, 0],
          ['bar', 0, 0, 0, 0, 1],
        ],
      });
    });
  });
});
