const asNumber = (v: unknown, dflt: number): number => {
  if (typeof v !== 'string') return dflt;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return n;
};

const asURL = (v: string): URL | undefined => {
  try {
    return new URL(v);
  } catch (e) {
    if (Object.prototype.hasOwnProperty.call(e, 'code')) {
      if ((e as any).code! === 'ERR_INVALID_URL') return undefined;
    }
    throw e;
  }
};

const asOrigin = (v: unknown, dflt: string): string => {
  const url = typeof v === 'string' && v !== '' ? asURL(v) : asURL(dflt);
  if (!url) throw new Error(`Invalid origin or default: url=${v} dflt=${dflt}`);
  return url.origin;
};

export type EnvFns = {
  assertRequirements: () => void;
  getForDisplay: () => Env;
};
export type Env = {
  JWT_SECRET: string;
  JWT_REFRESH: string;

  TLS_KEY_FILE: string;
  TLS_CERT_FILE: string;
  TLS_SERVER_NAME: string;
  USE_TLS: boolean;

  APP_UNIX_SOCKET: string;
  APP_LISTEN_ADDRESS: string;
  APP_LISTEN_PORT: number;
  USE_UNIX_SOCKET: boolean;

  WS_PATH: string;
  API_PATH: string;

  DEV_MODE: boolean;

  WEBFACE_ORIGIN: string;
  STATS_URL_TEMPLATE: string;

  DRAIN_DROP_DEAD_TIMEOUT_MS: number;
  DRAIN_GRACE_TIMEOUT_MS: number;
  DRAIN_NOTIFY_INTERVAL_MS: number;

  UWS_IDLE_TIMEOUT_S: number;
  UWS_MAX_PAYLOAD_LENGTH_BYTES: number;
  WARN_PAYLOAD_LENGTH_BYTES: number;
};

export const getEnv = (source: any): EnvFns & Env => {
  if (!source || typeof source !== 'object') throw new Error('Invalid env source');

  const JWT_SECRET = source.JWT_SECRET ?? '';
  const JWT_REFRESH = source.JWT_REFRESH ?? '';

  const TLS_KEY_FILE: string = source.TLS_KEY_FILE ?? '';
  const TLS_CERT_FILE: string = source.TLS_CERT_FILE ?? '';
  const TLS_SERVER_NAME: string = source.TLS_SERVER_NAME ?? '';
  const USE_TLS = TLS_KEY_FILE !== '' && TLS_CERT_FILE !== '' && TLS_SERVER_NAME !== '';

  const APP_UNIX_SOCKET = source.APP_UNIX_SOCKET ?? '';
  const APP_LISTEN_ADDRESS = source.APP_LISTEN_ADDRESS ?? '0.0.0.0';
  const APP_LISTEN_PORT = asNumber(source.APP_LISTEN_PORT, 4444);
  const USE_UNIX_SOCKET = APP_UNIX_SOCKET !== '';

  const WS_PATH = source.WS_PATH ?? '/ws';
  const API_PATH = source.API_PATH ?? '/api';

  const DEV_MODE = source.DEV_MODE === 'true';

  const WEBFACE_ORIGIN = asOrigin(source.WEBFACE_ORIGIN, 'https://noitatogether.com');
  const STATS_URL_TEMPLATE = source.STATS_URL_TEMPLATE ?? `${WEBFACE_ORIGIN}/api/stats/[ROOM_ID]/[STATS_ID]/html`;

  // app tunable values
  // configured in seconds at the env level, but stored in milliseconds at the app level
  const DRAIN_DROP_DEAD_TIMEOUT_MS = asNumber(source.DRAIN_DROP_DEAD_TIMEOUT_S, 60 * 60) * 1000;
  const DRAIN_GRACE_TIMEOUT_MS = asNumber(source.DRAIN_GRACE_TIMEOUT_S, 5 * 60) * 1000;
  const DRAIN_NOTIFY_INTERVAL_MS = asNumber(source.DRAIN_NOTIFY_INTERVAL_S, 1 * 60) * 1000;

  // uWS tunable values
  const UWS_IDLE_TIMEOUT_S = asNumber(source.UWS_IDLE_TIMEOUT_S, 120);
  const UWS_MAX_PAYLOAD_LENGTH_BYTES = asNumber(source.UWS_MAX_PAYLOAD_LENGTH_BYTES, 16 * 1024 * 1024);
  const WARN_PAYLOAD_LENGTH_BYTES = asNumber(
    source.WARN_PAYLOAD_LENGTH_BYTES,
    Math.floor(UWS_MAX_PAYLOAD_LENGTH_BYTES * 0.8),
  );

  const env: Env = {
    JWT_SECRET,
    JWT_REFRESH,

    TLS_KEY_FILE,
    TLS_CERT_FILE,
    TLS_SERVER_NAME,
    USE_TLS,

    APP_UNIX_SOCKET,
    APP_LISTEN_ADDRESS,
    APP_LISTEN_PORT,
    USE_UNIX_SOCKET,

    WS_PATH,
    API_PATH,

    DEV_MODE,

    WEBFACE_ORIGIN,
    STATS_URL_TEMPLATE,

    DRAIN_DROP_DEAD_TIMEOUT_MS,
    DRAIN_GRACE_TIMEOUT_MS,
    DRAIN_NOTIFY_INTERVAL_MS,

    UWS_IDLE_TIMEOUT_S,
    UWS_MAX_PAYLOAD_LENGTH_BYTES,
    WARN_PAYLOAD_LENGTH_BYTES,
  };

  const assertRequirements = () => {
    // throw when the environment supplies an invalid template
    // URL template must contain [ROOM_ID] and [STATS_ID]
    const url = statsUrl('roomId', 'statsId');
    if (url.indexOf('/roomId/') === -1 || url.indexOf('/statsId/') === -1) {
      console.error(`Invalid STATS_URL_TEMPLATE: ${STATS_URL_TEMPLATE}`);
      process.exit(1);
    }

    // throw when the environment does not include the JWT secrets
    if (!JWT_SECRET || !JWT_REFRESH) {
      console.error('JWT_SECRET and JWT_REFRESH are required environment variables');
      process.exit(1);
    }
  };

  const redact = (v: string): string => (v === '' ? '<empty>' : '<present>');

  type stringValuedEnvKeys = keyof { [K in keyof Env as Env[K] extends string ? K : never]: true };
  const getForDisplay = (): Env => {
    const obj: Env = Object.assign({}, env);

    const redactKeys: stringValuedEnvKeys[] = ['JWT_SECRET', 'JWT_REFRESH'];
    redactKeys.forEach((k) => {
      obj[k] = redact(obj[k]);
    });
    return obj;
  };

  return { assertRequirements, getForDisplay, ...env };
};

export const createStatsUrlFormatter = (template: string) => {
  const statsUrl = (roomId: string, statsId: string) =>
    template.replace(/\[([^\]]+)\]/g, (match, capture) => {
      if (capture === 'ROOM_ID') return roomId;
      if (capture === 'STATS_ID') return statsId;
      return match; // allow other [TEXT] unchanged
    });

  return statsUrl;
};

export const defaultEnv = getEnv(process.env);
export const statsUrl = createStatsUrlFormatter(defaultEnv.STATS_URL_TEMPLATE);
