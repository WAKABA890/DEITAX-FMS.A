// src/types/electron.d.ts
// Add this file anywhere already covered by tsconfig's "include"
// (e.g. src/types/) so `window.desktop` type-checks in Reports.tsx.

export {};

declare global {
  interface Window {
    desktop: {
      // ...add other Stage 2+ capabilities here as they're exposed...

      saveExcelFile: (
        fileBuffer: Uint8Array,
        fileName: string
      ) => Promise<{
        success: boolean;
        canceled: boolean;
        filePath?: string;
        error?: string;
      }>;
    };
  }
}