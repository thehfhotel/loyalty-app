import { JWTPayload } from './auth';

declare global {
  namespace Express {
    // Extend Passport's empty User interface with our JWT payload properties
    interface User extends JWTPayload {}
  }
}