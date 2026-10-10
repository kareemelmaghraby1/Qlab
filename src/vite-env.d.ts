/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GROK_API_KEY: string;
  // Add other VITE_ keys here if needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}