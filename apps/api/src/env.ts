export interface HyperdriveBinding {
  connectionString: string
}

export interface Env {
  HYPERDRIVE?: HyperdriveBinding
  DATABASE_URL?: string
  BETTER_AUTH_SECRET: string
  API_ORIGIN: string
  WEB_ORIGIN: string
  STUDIO_ORIGIN?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  REALTIME_TOKEN_SECRET: string
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
}
