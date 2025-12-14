import { JWTPayload } from './auth';

// Proper Express module augmentation
// This extends the Express Request interface with our custom properties
declare module 'express-serve-static-core' {
  interface Request {
    user?: JWTPayload;
  }
}

// Extend Passport's User interface
declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends JWTPayload {}
  }
}
