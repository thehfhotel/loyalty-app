declare module 'passport-line-auth' {
  import { Strategy as PassportStrategy } from 'passport';
  import { Request } from 'express';

  interface User {
    id: string;
    [key: string]: unknown;
  }
  
  interface LineProfile {
    id: string;
    displayName: string;
    userId: string;
    pictureUrl?: string;
    statusMessage?: string;
    provider: 'line';
    _raw: string;
    _json: Record<string, unknown>;
  }
  
  interface StrategyOptions {
    channelID: string;
    channelSecret: string;
    callbackURL: string;
    scope?: string[];
    state?: boolean;
  }
  
  interface AuthenticateOptions {
    [key: string]: unknown;
  }

  interface VerifyCallback {
    (error?: Error | null, user?: User, info?: unknown): void;
  }

  interface VerifyFunction {
    (accessToken: string, refreshToken: string, profile: LineProfile, done: VerifyCallback): void;
  }
  
  export class Strategy extends PassportStrategy {
    constructor(options: StrategyOptions, verify: VerifyFunction);
    name: string;
    authenticate(req: Request, options?: AuthenticateOptions): void;
  }

  export { LineProfile, VerifyCallback };
}