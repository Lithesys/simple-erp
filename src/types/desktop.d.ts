export {};

declare global {
  interface Window {
    erpDesktop?: {
      getState(): Promise<DesktopState>;
      testDatabase(config: DesktopDatabaseConfig): Promise<DesktopConnectionTest>;
      saveDatabase(
        config: DesktopDatabaseConfig,
        initialize: boolean,
        accessToken: string | undefined,
        recovery: boolean,
      ): Promise<{ ok: boolean }>;
      checkForUpdates(): Promise<unknown>;
      downloadUpdate(): Promise<unknown>;
      installUpdate(): Promise<void>;
      onUpdateState(listener: (state: DesktopUpdateState) => void): () => void;
    };
  }
}

export type DesktopDatabaseMode = "local" | "postgres" | "supabase";

export interface DesktopDatabaseConfig {
  mode: DesktopDatabaseMode;
  connectionString?: string;
  supabaseUrl?: string;
  anonKey?: string;
  serviceRoleKey?: string;
}

export interface DesktopConnectionTest {
  ok: boolean;
  status: "ready" | "empty" | "incompatible";
  message: string;
  migrations?: string[];
  migrationNote?: string;
}

export interface DesktopUpdateState {
  status:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "downloaded"
    | "error"
    | "development";
  currentVersion?: string;
  availableVersion?: string;
  percent?: number;
  message?: string;
}

export interface DesktopState {
  appVersion: string;
  mode: DesktopDatabaseMode;
  status: "starting" | "ready" | "empty" | "error";
  message: string;
  configured: boolean;
  connectionLabel: string;
  update: DesktopUpdateState;
}
