import type { DBCraftApi } from '@shared/ipc-contract';

declare global {
  interface Window {
    dbcraft?: DBCraftApi;
  }
}

export {};
