import axios from 'axios';
import { GenerateDashboardResponse, RuntimeAppConfig } from './types';

const BFF_BASE_URL =
  import.meta.env.VITE_BFF_BASE_URL?.toString() || 'http://localhost:4100';

const client = axios.create({
  baseURL: BFF_BASE_URL,
  timeout: 300000,
});

export const getRuntimeConfig = async (): Promise<RuntimeAppConfig> => {
  const { data } = await client.get('/api/config');
  return data;
};

export const prepareSemantics = async (input: {
  mdl?: string;
  mdlHash?: string;
}) => {
  const payload: { mdl?: string; mdlHash?: string } = {};
  if (input.mdl?.trim()) {
    payload.mdl = input.mdl;
  }
  if (input.mdlHash?.trim()) {
    payload.mdlHash = input.mdlHash;
  }
  const { data } = await client.post('/api/wren/prepare-semantics', payload);
  return data;
};

export const getMdl = async (hash?: string) => {
  const url = hash?.trim()
    ? `/api/wren/mdl?hash=${encodeURIComponent(hash.trim())}`
    : '/api/wren/mdl';
  const { data } = await client.get(url);
  return data as { hash: string; mdl: string; source: string };
};

export const generateDashboard = async (input: {
  intent: string;
  mdl?: string;
  mdlHash?: string;
  previousQuestions?: string[];
  maxWidgets?: number;
}): Promise<GenerateDashboardResponse> => {
  const payload: {
    intent: string;
    mdl?: string;
    mdlHash?: string;
    previousQuestions?: string[];
    maxWidgets?: number;
  } = {
    intent: input.intent,
    previousQuestions: input.previousQuestions,
    maxWidgets: input.maxWidgets,
  };
  if (input.mdl?.trim()) {
    payload.mdl = input.mdl;
  }
  if (input.mdlHash?.trim()) {
    payload.mdlHash = input.mdlHash;
  }
  const { data } = await client.post('/api/wren/generate-dashboard', payload);
  return data;
};
