const asNumber = (v: unknown, dflt: number): number => {
  if (typeof v !== 'string') return dflt;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return n;
};

export const TLS_KEY_FILE: string = process.env.TLS_KEY_FILE ?? '';
export const TLS_CERT_FILE: string = process.env.TLS_CERT_FILE ?? '';
export const TLS_SERVER_NAME: string = process.env.TLS_SERVER_NAME ?? '';
export const USE_TLS = TLS_KEY_FILE !== '' && TLS_CERT_FILE !== '' && TLS_SERVER_NAME !== '';
export const APP_LISTEN_ADDRESS = process.env.APP_LISTEN_ADDRESS ?? '0.0.0.0';
export const APP_LISTEN_PORT = asNumber(process.env.APP_LISTEN_PORT, 4444);
export const WS_PATH = process.env.WS_PATH ?? '/ws';
export const API_PATH = process.env.API_PATH ?? '/api';
export const APP_UNIX_SOCKET = process.env.APP_UNIX_SOCKET ?? '';
export const DEV_MODE = process.env.DEV_MODE === 'true';
export const JWT_SECRET = process.env.JWT_SECRET ?? '';
export const JWT_REFRESH = process.env.JWT_REFRESH ?? '';
export const WEBFACE_ORIGIN = process.env.WEBFACE_ORIGIN ?? 'noitatogether.com';
export const STATS_URL_TEMPLATE =
  process.env.STATS_URL_TEMPLATE ?? 'https://noitatogether.com/api/stats/[ROOM_ID]/[STATS_ID]/html';

// app tunable values
// configured in seconds at the env level, but stored in milliseconds at the app level
export const DRAIN_DROP_DEAD_TIMEOUT_MS = asNumber(process.env.DRAIN_DROP_DEAD_TIMEOUT_S, 60 * 60) * 1000;
export const DRAIN_GRACE_TIMEOUT_MS = asNumber(process.env.DRAIN_GRACE_TIMEOUT_S, 5 * 60) * 1000;
export const DRAIN_NOTIFY_INTERVAL_MS = asNumber(process.env.DRAIN_NOTIFY_INTERVAL_S, 1 * 60) * 1000;

// uWS tunable values
export const UWS_IDLE_TIMEOUT = asNumber(process.env.UWS_IDLE_TIMEOUT, 120);
export const UWS_MAX_PAYLOAD_LENGTH_BYTES = asNumber(process.env.UWS_MAX_PAYLOAD_LENGTH_BYTES, 16 * 1024 * 1024);
export const WARN_PAYLOAD_LENGTH_BYTES = asNumber(
  process.env.WARN_PAYLOAD_LENGTH_BYTES,
  Math.floor(UWS_MAX_PAYLOAD_LENGTH_BYTES * 0.8),
);

export const statsUrl = (() => {
  const statsUrl = (roomId: string, statsId: string) =>
    STATS_URL_TEMPLATE.replace(/\[([^\]]+)\]/g, (match, capture) => {
      if (capture === 'ROOM_ID') return roomId;
      if (capture === 'STATS_ID') return statsId;
      return match; // allow other [TEXT] unchanged
    });

  return statsUrl;
})();

export const assertEnvRequirements = () => {
  // don't allow program to run with invalid template
  // URL template must contain [ROOM_ID] and [STATS_ID]
  const url = statsUrl('roomId', 'statsId');
  if (url.indexOf('/roomId/') === -1 || url.indexOf('/statsId/') === -1) {
    console.error(`Invalid STATS_URL_TEMPLATE: ${STATS_URL_TEMPLATE}`);
    process.exit(1);
  }

  if (!JWT_SECRET || !JWT_REFRESH) {
    console.error('JWT_SECRET and JWT_REFRESH are required environment variables');
    process.exit(1);
  }
};
