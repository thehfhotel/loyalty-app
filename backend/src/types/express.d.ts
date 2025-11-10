import { JWTPayload } from './auth';

declare global {
  namespace Express {
    // Extend Passport's empty User interface with our JWT payload properties
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends JWTPayload {}
  }
}