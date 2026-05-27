import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { WrenConnection } from './wren.js';

const fileConfigSchema = z.object({
  wren: z.object({
    baseUrl: z.string().min(1),
    uiGraphqlUrl: z.string().optional(),
    projectId: z.string().optional(),
    deployId: z.string().optional(),
    language: z.string().optional(),
    timezoneName: z.string().optional(),
  }),
});

const runtimeConfigSchema = z.object({
  wren: z.object({
    baseUrl: z.string().min(1),
    uiGraphqlUrl: z.string().min(1),
    projectId: z.string().optional(),
    deployId: z.string().min(1),
    language: z.string().min(1),
    timezoneName: z.string().min(1),
  }),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

const defaultConfigPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../config.json',
);

const readFileConfig = (configPath: string) => {
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  return fileConfigSchema.parse(JSON.parse(raw));
};

export const loadRuntimeConfig = (): RuntimeConfig => {
  const configPath = process.env.APP_CONFIG_FILE || defaultConfigPath;
  const fileConfig = readFileConfig(configPath);
  const fileWren = fileConfig?.wren;

  const merged = {
    wren: {
      baseUrl: (process.env.WREN_BASE_URL || fileWren?.baseUrl || '').trim(),
      uiGraphqlUrl: (
        process.env.WREN_UI_GRAPHQL_URL ||
        fileWren?.uiGraphqlUrl ||
        'http://localhost:3000/api/graphql'
      ).trim(),
      projectId: (process.env.WREN_PROJECT_ID || fileWren?.projectId || '').trim() || undefined,
      deployId: (process.env.WREN_DEPLOY_ID || fileWren?.deployId || '').trim(),
      language: (process.env.WREN_LANGUAGE || fileWren?.language || 'English').trim(),
      timezoneName: (process.env.WREN_TIMEZONE_NAME || fileWren?.timezoneName || 'UTC').trim(),
    },
  };

  try {
    return runtimeConfigSchema.parse(merged);
  } catch (error) {
    throw new Error(
      `Invalid runtime config. Set server/config.json (or APP_CONFIG_FILE) and ensure wren.baseUrl + wren.uiGraphqlUrl + wren.deployId exist. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const toWrenConnection = (config: RuntimeConfig): WrenConnection => ({
  baseUrl: config.wren.baseUrl,
  uiGraphqlUrl: config.wren.uiGraphqlUrl,
  projectId: config.wren.projectId,
  language: config.wren.language,
  timezoneName: config.wren.timezoneName,
});
