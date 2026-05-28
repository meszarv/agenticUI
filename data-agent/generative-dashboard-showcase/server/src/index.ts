import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { z } from 'zod';
import {
  WrenError,
  askIntent,
  generateChart,
  generateDashboard,
  generateDashboardStream,
  prepareSemantics,
  recommendQuestions,
} from './wren.js';
import type { DashboardStreamEvent } from './wren.js';
import { fetchMdlFromWrenApi } from './mdl.js';
import { loadRuntimeConfig, toWrenConnection } from './runtimeConfig.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST ?? '0.0.0.0';
const runtimeConfig = loadRuntimeConfig();
const wrenConnection = toWrenConnection(runtimeConfig);

app.use(cors());
app.use(express.json({ limit: '5mb' }));

const prepareSchema = z.object({
  mdl: z.string().optional(),
  mdlHash: z.string().optional(),
});

const recommendSchema = z.object({
  mdl: z.string().optional(),
  mdlHash: z.string().optional(),
  previousQuestions: z.array(z.string()).optional(),
  maxQuestions: z.number().int().positive().max(10).optional(),
  maxCategories: z.number().int().positive().max(5).optional(),
});

const askSchema = z.object({
  query: z.string().min(1),
});

const chartSchema = z.object({
  question: z.string().min(1),
  sql: z.string().min(1),
});

const generateDashboardSchema = z.object({
  intent: z.string().min(1),
  maxWidgets: z.number().int().positive().max(12).optional(),
  mdl: z.string().optional(),
  mdlHash: z.string().optional(),
  previousQuestions: z.array(z.string()).optional(),
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/config', (_req, res) => {
  res.json({
    wren: {
      baseUrl: runtimeConfig.wren.baseUrl,
      uiGraphqlUrl: runtimeConfig.wren.uiGraphqlUrl,
      projectId: runtimeConfig.wren.projectId ?? null,
      deployId: runtimeConfig.wren.deployId,
      language: runtimeConfig.wren.language,
      timezoneName: runtimeConfig.wren.timezoneName,
      hasDeployId: Boolean(runtimeConfig.wren.deployId),
      hasMdlApi: Boolean(runtimeConfig.wren.uiGraphqlUrl),
    },
  });
});

const resolveMdl = async (input: {
  mdl?: string;
  mdlHash?: string;
}) => {
  const explicitMdl = input.mdl?.trim();
  const hash = input.mdlHash?.trim() || runtimeConfig.wren.deployId;

  if (explicitMdl) {
    return {
      hash,
      mdl: explicitMdl,
      source: 'request',
    } as const;
  }

  const fetched = await fetchMdlFromWrenApi({
    graphqlUrl: runtimeConfig.wren.uiGraphqlUrl,
    hash,
  });
  return {
    hash: fetched.hash,
    mdl: fetched.mdl,
    source: fetched.source,
  } as const;
};

app.get('/api/wren/mdl', async (req, res) => {
  try {
    const hash = typeof req.query.hash === 'string' ? req.query.hash : undefined;
    const result = await resolveMdl({ mdlHash: hash });
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

app.post('/api/wren/prepare-semantics', async (req, res) => {
  try {
    const payload = prepareSchema.parse(req.body);
    const resolved = await resolveMdl({
      mdl: payload.mdl,
      mdlHash: payload.mdlHash,
    });
    const result = await prepareSemantics({
      connection: wrenConnection,
      mdl: resolved.mdl,
      mdlHash: resolved.hash,
    });
    res.json({
      ...result,
      mdlHash: resolved.hash,
      mdlSource: resolved.source,
    });
  } catch (error) {
    handleError(error, res);
  }
});

app.post('/api/wren/recommend', async (req, res) => {
  try {
    const payload = recommendSchema.parse(req.body);
    const resolved = await resolveMdl({
      mdl: payload.mdl,
      mdlHash: payload.mdlHash,
    });
    const result = await recommendQuestions({
      connection: wrenConnection,
      mdl: resolved.mdl,
      previousQuestions: payload.previousQuestions,
      maxQuestions: payload.maxQuestions,
      maxCategories: payload.maxCategories,
    });
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

app.post('/api/wren/ask', async (req, res) => {
  try {
    const payload = askSchema.parse(req.body);
    const result = await askIntent({
      connection: wrenConnection,
      deployId: runtimeConfig.wren.deployId,
      query: payload.query,
    });
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

app.post('/api/wren/chart', async (req, res) => {
  try {
    const payload = chartSchema.parse(req.body);
    const result = await generateChart({
      connection: wrenConnection,
      question: payload.question,
      sql: payload.sql,
    });
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

app.post('/api/wren/generate-dashboard', async (req, res) => {
  try {
    const payload = generateDashboardSchema.parse(req.body);
    const resolved = await resolveMdl({
      mdl: payload.mdl,
      mdlHash: payload.mdlHash,
    });
    const result = await generateDashboard({
      connection: wrenConnection,
      deployId: runtimeConfig.wren.deployId,
      intent: payload.intent,
      maxWidgets: payload.maxWidgets,
      mdl: resolved.mdl,
      previousQuestions: payload.previousQuestions,
    });
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
});

app.post('/api/wren/generate-dashboard/stream', async (req, res) => {
  let payload: z.infer<typeof generateDashboardSchema>;
  let resolved: Awaited<ReturnType<typeof resolveMdl>>;

  try {
    payload = generateDashboardSchema.parse(req.body);
    resolved = await resolveMdl({
      mdl: payload.mdl,
      mdlHash: payload.mdlHash,
    });
  } catch (error) {
    handleError(error, res);
    return;
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const streamRes = res as express.Response & { flush?: () => void };

  const send = (event: DashboardStreamEvent) => {
    if (streamRes.writableEnded || streamRes.destroyed) {
      return;
    }
    streamRes.write(`${JSON.stringify(event)}\n`);
    streamRes.flush?.();
  };

  try {
    await generateDashboardStream(
      {
        connection: wrenConnection,
        deployId: runtimeConfig.wren.deployId,
        intent: payload.intent,
        maxWidgets: payload.maxWidgets,
        mdl: resolved.mdl,
        previousQuestions: payload.previousQuestions,
      },
      send,
    );
  } catch (error) {
    if (error instanceof WrenError) {
      send({
        type: 'error',
        message: error.message,
        details: error.details ?? null,
      });
    } else if (error instanceof Error) {
      send({
        type: 'error',
        message: error.message,
      });
    } else {
      send({
        type: 'error',
        message: 'Unknown error',
        details: error,
      });
    }
  } finally {
    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  }
});

const handleError = (error: unknown, res: express.Response) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: 'Invalid request body',
      details: error.flatten(),
    });
    return;
  }

  if (error instanceof WrenError) {
    res.status(500).json({
      error: error.message,
      details: error.details ?? null,
    });
    return;
  }

  if (error instanceof Error) {
    res.status(500).json({
      error: error.message,
    });
    return;
  }

  res.status(500).json({
    error: 'Unknown error',
  });
};

app.listen(port, host, () => {
  console.log(`gd-showcase-server running at http://${host}:${port}`);
});
