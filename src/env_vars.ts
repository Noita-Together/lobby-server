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
export const APP_LISTEN_PORT = asNumber(process.env.APP_PORT, 4444);
export const WS_PATH = process.env.WS_PATH ?? '/ws';
export const API_PATH = process.env.API_PATH ?? '/api';
export const APP_UNIX_SOCKET = process.env.APP_UNIX_SOCKET ?? '';
export const DEV_MODE = process.env.DEV_MODE === 'true';
export const JWT_SECRET = process.env.JWT_SECRET ?? '';
export const JWT_REFRESH = process.env.JWT_REFRESH ?? '';
export const STATS_URL_TEMPLATE =
  process.env.STATS_URL_TEMPLATE ?? 'https://noitatogether.com/api/stats/[ROOM_ID]/[STATS_ID]/html';

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
