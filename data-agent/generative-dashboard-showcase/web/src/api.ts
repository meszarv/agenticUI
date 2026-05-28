import axios from 'axios';
import {
  DashboardStreamEvent,
  GenerateDashboardResponse,
  RuntimeAppConfig,
} from './types';

const defaultBffBaseUrl =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:4100`
    : 'http://localhost:4100';

const BFF_BASE_URL =
  import.meta.env.VITE_BFF_BASE_URL?.toString() || defaultBffBaseUrl;

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

export const generateDashboardStream = async (
  input: {
    intent: string;
    mdl?: string;
    mdlHash?: string;
    previousQuestions?: string[];
    maxWidgets?: number;
  },
  options: {
    onEvent: (event: DashboardStreamEvent) => void;
    signal?: AbortSignal;
  },
) => {
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

  const response = await fetch(`${BFF_BASE_URL}/api/wren/generate-dashboard/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      detail = body?.error ? `${detail}: ${body.error}` : detail;
    } catch {
      // ignore parsing errors and use status-only message
    }
    throw new Error(`Dashboard stream failed. ${detail}`);
  }

  if (!response.body) {
    throw new Error('Dashboard stream response body is not readable');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      options.onEvent(JSON.parse(line) as DashboardStreamEvent);
    }
  }

  const tail = buffer.trim();
  if (tail) {
    options.onEvent(JSON.parse(tail) as DashboardStreamEvent);
  }
};
