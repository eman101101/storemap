/** Bindings + per-request configuration (port of backend/src/config.js). */

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;

  SELF_HOSTED?: string;
  ENABLE_DEV_LOGIN?: string;
  PUBLIC_BASE_URL?: string;
  SESSION_SECRET?: string;
  DEMO_LOGIN_EMAIL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  FACEBOOK_APP_ID?: string;
  FACEBOOK_APP_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  R2_DAILY_BUDGET?: string;
  MAX_UPLOAD_BYTES?: string;
}

export interface Config {
  isProd: boolean;
  selfHosted: boolean;
  devLogin: boolean;
  sessionDays: number;
  sessionSecret: string; // resolved during bootstrap (var or D1-stored generated one)
  publicBaseUrl: string; // var or request origin
  demoLoginEmail: string;
  maxUploadBytes: number;
  google: { clientId: string; clientSecret: string };
  apple: { clientId: string; teamId: string; keyId: string; privateKey: string };
  facebook: { appId: string; appSecret: string };
  // passwordless email codes: Resend-delivered when the key is set, otherwise
  // the code is returned to the login UI (local mode)
  resendApiKey: string;
  emailFrom: string;
}

/** Shared Hono generics: every sub-app sees the same bindings + variables. */
export type AppEnv = {
  Bindings: Env;
  Variables: { user: any; config: Config; store: any; body: any };
};

export function makeConfig(env: Env, origin: string): Config {
  const isProd = true; // Workers run production always — dev gates are explicit
  return {
    isProd,
    selfHosted: env.SELF_HOSTED === 'true',
    // Never available in production unless explicitly enabled — same rule as Node.
    devLogin: env.ENABLE_DEV_LOGIN === 'true',
    sessionDays: 30,
    sessionSecret: env.SESSION_SECRET || '', // filled in by bootstrap (app_settings)
    publicBaseUrl: (env.PUBLIC_BASE_URL || origin).replace(/\/+$/, ''),
    demoLoginEmail: (env.DEMO_LOGIN_EMAIL || 'annex@storemap.demo').toLowerCase(),
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES) || 10 * 1024 * 1024,
    google: {
      clientId: env.GOOGLE_CLIENT_ID || '',
      clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    },
    apple: {
      clientId: env.APPLE_CLIENT_ID || '',
      teamId: env.APPLE_TEAM_ID || '',
      keyId: env.APPLE_KEY_ID || '',
      privateKey: (env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    },
    facebook: {
      appId: env.FACEBOOK_APP_ID || '',
      appSecret: env.FACEBOOK_APP_SECRET || '',
    },
    resendApiKey: env.RESEND_API_KEY || '',
    emailFrom: env.EMAIL_FROM || 'StoreMap <onboarding@resend.dev>',
  };
}

export function providersConfigured(config: Config) {
  return {
    google: Boolean(config.google.clientId && config.google.clientSecret),
    apple: Boolean(config.apple.clientId && config.apple.teamId && config.apple.keyId && config.apple.privateKey),
    facebook: Boolean(config.facebook.appId && config.facebook.appSecret),
    // email codes always work — no key needed (local mode surfaces the code)
    email: true,
    dev: config.devLogin,
  };
}
