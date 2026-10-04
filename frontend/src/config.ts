import { api } from "./api";
import type { AppConfig } from "./types";

/**
 * App configuration, loaded from the server. APP_NAME is defined once, in the backend's
 * app/config.py, and reaches the UI only through this call (and the server-rendered <title>).
 */
export async function loadConfig(): Promise<AppConfig> {
  return api.config();
}
