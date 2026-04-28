import type { AuthedUser } from "../lib/authContext";

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth` after successful authentication */
      authUser?: AuthedUser;
    }
  }
}

export {};
