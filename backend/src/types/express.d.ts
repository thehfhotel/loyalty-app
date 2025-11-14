import { JWTPayload } from './auth';

declare global {
  namespace Express {
    // Extend Express Request interface to include user property
    interface Request {
      user?: JWTPayload;
    }

    // Extend Passport's empty User interface with our JWT payload properties
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends JWTPayload {}
  }
}

// Required for ambient module declarations to be importable
export {};