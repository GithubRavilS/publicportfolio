/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGGREGATOR_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
