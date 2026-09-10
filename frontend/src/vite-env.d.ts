/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_TRANSLATION_ENABLED?: string
  readonly VITE_LIFF_ID?: string
  /** Front-desk phone for The Harbour Front Hotel, shown on /d. Blank = no number. */
  readonly VITE_DESK_PHONE_HF?: string
  /** Front-desk phone for HF Ville, shown on /d. Blank = no number. */
  readonly VITE_DESK_PHONE_HFVILLE?: string
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
