import jwt from 'jsonwebtoken';
import { Value } from '@sinclair/typebox/value';

import { ClientAuth } from './runtypes/client_auth';

const SECRET_ACCESS = 'cvr9yvg!UQP7gfk7ycq';
const SECRET_REFRESH = 'yhq!ZCM!kdf*twc5qnx';

export const verifyToken = (token: string): Promise<ClientAuth> =>
  new Promise((resolve, reject) => {
    jwt.verify(token, SECRET_ACCESS, (err, decoded: unknown) => {
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
