import jwt from 'jsonwebtoken';
import { Value } from '@sinclair/typebox/value';

import { ClientAuth } from './runtypes/client_auth';

const JWT_SECRET = process.env.JWT_SECRET ?? null;
const JWT_REFRESH = process.env.JWT_REFRESH ?? null;

if (!JWT_SECRET || !JWT_REFRESH) {
  console.error('JWT_SECRET and JWT_REFRESH are required environment variables');
  process.exit(1);
}

export const verifyToken = (token: string): Promise<ClientAuth> =>
  new Promise((resolve, reject) => {
    jwt.verify(token, JWT_SECRET, (err, decoded: unknown) => {
      if (err) {
        reject(new Error(`JWT verification failed: ${err.message}`));
        return;
      }

      if (Value.Check(ClientAuth, decoded)) {
        resolve(decoded);
        return;
      }

      const errs = [...Value.Errors(ClientAuth, decoded)].map((ve) => `${ve.path}: ${ve.message}`);
      console.error('JWT validated, but contents were unexpected', errs);
      reject(new Error(`JWT validation failed`));
    });
  });
