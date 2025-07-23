declare module 'passport-line-auth' {
  import { Strategy as PassportStrategy } from 'passport';
  
  interface LineProfile {
    id: string;
    displayName: string;
    userId: string;
    pictureUrl?: string;
    statusMessage?: string;
    provider: 'line';
    _raw: string;
    _json: any;
  }
  
  interface StrategyOptions {
    channelID: string;
    channelSecret: string;
    callbackURL: string;
    scope?: string[];
    state?: boolean;
  }
  
  interface VerifyFunction {
    (accessToken: string, refreshToken: string, profile: LineProfile, done: any): void;
  }
  
  export class Strategy extends PassportStrategy {
    constructor(options: StrategyOptions, verify: VerifyFunction);
    name: string;
    authenticate(req: any, options?: any): void;
  }
}