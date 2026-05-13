export interface AppConfig {
  mode: string;
  port: number;
  databaseUrl?: string;
}

export function loadConfig(): AppConfig {
  return {
    mode: process.env.NODE_ENV ?? "development",
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL
  };
}
