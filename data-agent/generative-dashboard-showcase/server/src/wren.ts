import axios, { AxiosError, AxiosInstance } from 'axios';

export type WrenConnection = {
  baseUrl: string;
  projectId?: string;
  language?: string;
  timezoneName?: string;
};

export type AskCandidate = {
  sql: string;
  type: string;
  viewId?: number | null;
  sqlpairId?: number | null;
};

export type AskResult = {
  queryId: string;
  status: string;
  type?: string;
  candidates: AskCandidate[];
  retrievedTables?: string[];
  reasoning?: string;
  raw: Record<string, unknown>;
};

export type ChartResult = {
  queryId: string;
  status: string;
  chartType?: string;
  chartSchema?: Record<string, unknown>;
  reasoning?: string;
  raw: Record<string, unknown>;
};

export type RecommendationQuestion = {
  question: string;
  category: string;
  sql: string;
};

export type DashboardWidget = {
  title: string;
  question: string;
  sql: string;
  chartType?: string;
  chartSchema?: Record<string, unknown>;
  reasoning?: string;
  category?: string;
};

export type ClosestQuery = {
  question: string;
  sql: string;
  category?: string;
  description: string;
  retrievedTables?: string[];
};

export type GenerateDashboardInput = {
  connection: WrenConnection;
  deployId: string;
  intent: string;
  maxWidgets?: number;
  mdl?: string;
  previousQuestions?: string[];
};

export class WrenError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'WrenError';
  }
}

const DEFAULT_TIMEOUT_MS = Number(process.env.WREN_TIMEOUT_MS ?? 180000);
const DEFAULT_POLL_INTERVAL_MS = Number(process.env.WREN_POLL_INTERVAL_MS ?? 1000);

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/$/, '');

const buildClient = (baseUrl: string): AxiosInstance => {
  return axios.create({
    baseURL: normalizeBaseUrl(baseUrl),
    timeout: 60000,
    headers: {
      'Content-Type': 'application/json',
    },
  });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const errorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const err = error as AxiosError<{ detail?: string; message?: string }>;
    const status = err.response?.status;
    const detail = err.response?.data?.detail ?? err.response?.data?.message;
    const statusText = status ? `HTTP ${status}` : 'HTTP error';
    return detail ? `${statusText}: ${detail}` : `${statusText}: ${err.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const getConfigurations = (connection: WrenConnection) => ({
  language: connection.language || 'English',
  timezone: { name: connection.timezoneName || 'UTC' },
});

const pollStatus = async <T>(
  fetcher: () => Promise<T>,
  getStatus: (payload: T) => string,
  name: string,
): Promise<T> => {
  const started = Date.now();
  while (Date.now() - started <= DEFAULT_TIMEOUT_MS) {
    const payload = await fetcher();
    const status = getStatus(payload).toLowerCase();

    if (status === 'finished' || status === 'succeeded') {
      return payload;
    }

    if (status === 'failed' || status === 'stopped') {
      throw new WrenError(`${name} failed with status: ${status}`, payload);
    }

    await sleep(DEFAULT_POLL_INTERVAL_MS);
  }

  throw new WrenError(`${name} timed out after ${DEFAULT_TIMEOUT_MS}ms`);
};

export const prepareSemantics = async (input: {
  connection: WrenConnection;
  mdl: string;
  mdlHash: string;
}) => {
  const { connection, mdl, mdlHash } = input;
  const client = buildClient(connection.baseUrl);

  try {
    await client.post('/v1/semantics-preparations', {
      mdl,
      id: mdlHash,
      project_id: connection.projectId,
      configurations: getConfigurations(connection),
      request_from: 'api',
    });

    const statusResult = await pollStatus(
      async () => {
        const res = await client.get(`/v1/semantics-preparations/${mdlHash}/status`);
        return res.data as { status: string; error?: { message?: string } };
      },
      (result) => result.status,
      'Semantics preparation',
    );

    return statusResult;
  } catch (error) {
    throw new WrenError(`Failed to prepare semantics: ${errorMessage(error)}`);
  }
};

export const recommendQuestions = async (input: {
  connection: WrenConnection;
  mdl: string;
  previousQuestions?: string[];
  maxQuestions?: number;
  maxCategories?: number;
}) => {
  const { connection, mdl, previousQuestions = [], maxQuestions = 3, maxCategories = 2 } = input;
  const client = buildClient(connection.baseUrl);

  try {
    const create = await client.post('/v1/question-recommendations', {
      mdl,
      previous_questions: previousQuestions,
      max_questions: maxQuestions,
      max_categories: maxCategories,
      project_id: connection.projectId,
      configuration: getConfigurations(connection),
      request_from: 'api',
    });

    const id = create.data?.id as string;
    if (!id) {
      throw new WrenError('Question recommendation did not return an id');
    }

    const result = await pollStatus(
      async () => {
        const res = await client.get(`/v1/question-recommendations/${id}`);
        return res.data as {
          status: string;
          response?: { questions?: RecommendationQuestion[] };
          error?: { message?: string };
        };
      },
      (payload) => payload.status,
      'Question recommendation',
    );

    return {
      id,
      questions: result.response?.questions || [],
      raw: result,
    };
  } catch (error) {
    throw new WrenError(`Failed to recommend questions: ${errorMessage(error)}`);
  }
};

export const askIntent = async (input: {
  connection: WrenConnection;
  deployId: string;
  query: string;
}) => {
  const { connection, deployId, query } = input;
  const client = buildClient(connection.baseUrl);

  try {
    const create = await client.post('/v1/asks', {
      query,
      id: deployId,
      project_id: connection.projectId,
      configurations: getConfigurations(connection),
      request_from: 'api',
    });

    const queryId = create.data?.query_id as string;
    if (!queryId) {
      throw new WrenError('Ask did not return a query_id');
    }

    const result = await pollStatus(
      async () => {
        const res = await client.get(`/v1/asks/${queryId}/result`);
        return res.data as {
          status: string;
          type?: string;
          response?: AskCandidate[];
          sql_generation_reasoning?: string;
          retrieved_tables?: string[];
        };
      },
      (payload) => payload.status,
      'Ask',
    );

    return {
      queryId,
      status: result.status,
      type: result.type,
      candidates: result.response || [],
      retrievedTables: result.retrieved_tables || [],
      reasoning: result.sql_generation_reasoning,
      raw: result as Record<string, unknown>,
    } as AskResult;
  } catch (error) {
    throw new WrenError(`Failed to ask intent: ${errorMessage(error)}`);
  }
};

export const generateChart = async (input: {
  connection: WrenConnection;
  question: string;
  sql: string;
}) => {
  const { connection, question, sql } = input;
  const client = buildClient(connection.baseUrl);

  try {
    const create = await client.post('/v1/charts', {
      query: question,
      sql,
      project_id: connection.projectId,
      configurations: getConfigurations(connection),
      request_from: 'api',
      remove_data_from_chart_schema: false,
    });

    const queryId = create.data?.query_id as string;
    if (!queryId) {
      throw new WrenError('Chart generation did not return a query_id');
    }

    const result = await pollStatus(
      async () => {
        const res = await client.get(`/v1/charts/${queryId}`);
        return res.data as {
          status: string;
          response?: {
            chart_type?: string;
            chart_schema?: Record<string, unknown>;
            reasoning?: string;
          };
        };
      },
      (payload) => payload.status,
      'Chart generation',
    );

    return {
      queryId,
      status: result.status,
      chartType: result.response?.chart_type,
      chartSchema: result.response?.chart_schema,
      reasoning: result.response?.reasoning,
      raw: result as Record<string, unknown>,
    } as ChartResult;
  } catch (error) {
    throw new WrenError(`Failed to generate chart: ${errorMessage(error)}`);
  }
};

const uniqueBySql = (widgets: DashboardWidget[]) => {
  const seen = new Set<string>();
  return widgets.filter((item) => {
    if (!item.sql || seen.has(item.sql)) {
      return false;
    }
    seen.add(item.sql);
    return true;
  });
};

const normalizeText = (value: unknown) => {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const clarificationDescription = (input: {
  ask: AskResult;
  category?: string;
}) => {
  const rawReasoning = normalizeText(input.ask.raw?.intent_reasoning);
  if (rawReasoning) {
    return rawReasoning;
  }
  const askReasoning = normalizeText(input.ask.reasoning);
  if (askReasoning) {
    return askReasoning;
  }
  const category = normalizeText(input.category);
  if (category) {
    return `Closest ${category.toLowerCase()} query inferred from your intent and available schema.`;
  }
  return 'Closest query inferred from your intent and available schema.';
};

export const generateDashboard = async (
  input: GenerateDashboardInput,
): Promise<{
  ask: AskResult;
  recommendations: RecommendationQuestion[];
  widgets: DashboardWidget[];
  closestQueries: ClosestQuery[];
}> => {
  const { connection, deployId, intent, mdl, previousQuestions = [], maxWidgets = 4 } = input;

  const ask = await askIntent({
    connection,
    deployId,
    query: intent,
  });

  let recommendations: RecommendationQuestion[] = [];
  let closestQueries: ClosestQuery[] = [];
  let primaryQuestion = intent;
  let primarySql: string;
  let primaryCategory: string | undefined;

  if (ask.candidates.length) {
    primarySql = ask.candidates[0].sql;
  } else if (mdl) {
    const desiredClosestCount = 4;
    const recommendationPool: RecommendationQuestion[] = [];
    const recommendationSeen = new Set<string>();
    let recommendationResultRaw: Record<string, unknown> | undefined;
    const seedHistory = [...previousQuestions, intent];

    for (let attempt = 0; attempt < 3 && recommendationPool.length < desiredClosestCount; attempt += 1) {
      const recommendationResult = await recommendQuestions({
        connection,
        mdl,
        previousQuestions: seedHistory,
        maxQuestions: Math.max(desiredClosestCount, maxWidgets),
        maxCategories: Math.min(5, Math.max(2, desiredClosestCount)),
      });
      recommendationResultRaw = recommendationResult.raw;
      for (const item of recommendationResult.questions) {
        const key = `${item.question}::${item.sql}`;
        if (recommendationSeen.has(key)) {
          continue;
        }
        recommendationSeen.add(key);
        recommendationPool.push(item);
      }
      seedHistory.push(...recommendationResult.questions.map((item) => item.question));
    }

    recommendations = recommendationPool;
    const seeded = recommendations.slice(0, 10);
    const seen = new Set<string>();
    for (const rec of seeded) {
      try {
        const recAsk = await askIntent({
          connection,
          deployId,
          query: rec.question,
        });
        const sql = recAsk.candidates[0]?.sql || rec.sql;
        const dedupKey = sql || rec.question;
        if (seen.has(dedupKey)) {
          continue;
        }
        seen.add(dedupKey);
        closestQueries.push({
          question: rec.question,
          sql,
          category: rec.category,
          description: clarificationDescription({ ask: recAsk, category: rec.category }),
          retrievedTables: recAsk.retrievedTables,
        });
      } catch {
        const dedupKey = rec.sql || rec.question;
        if (seen.has(dedupKey)) {
          continue;
        }
        seen.add(dedupKey);
        closestQueries.push({
          question: rec.question,
          sql: rec.sql,
          category: rec.category,
          description:
            `Closest ${rec.category.toLowerCase()} query derived from recommendation fallback.`,
        });
      }

      if (closestQueries.length >= 4) {
        break;
      }
    }

    if (!closestQueries.length) {
      closestQueries = recommendations.slice(0, 4).map((rec) => ({
        question: rec.question,
        sql: rec.sql,
        category: rec.category,
        description: `Closest ${rec.category.toLowerCase()} query derived from recommendation fallback.`,
      }));
    }

    const fallback = closestQueries[0];
    if (!fallback) {
      throw new WrenError(
        'No SQL candidates returned from ask endpoint and fallback recommendations were empty',
        { ask: ask.raw, recommendation: recommendationResultRaw || null },
      );
    }
    primaryQuestion = fallback.question;
    primarySql = fallback.sql;
    primaryCategory = fallback.category;
  } else {
    throw new WrenError('No SQL candidates returned from ask endpoint', ask.raw);
  }

  const baseChart = await generateChart({
    connection,
    question: primaryQuestion,
    sql: primarySql,
  });

  const widgets: DashboardWidget[] = [
    {
      title: primaryQuestion,
      question: primaryQuestion,
      sql: primarySql,
      chartType: baseChart.chartType,
      chartSchema: baseChart.chartSchema,
      reasoning: baseChart.reasoning,
      category: primaryCategory,
    },
  ];

  if (mdl && maxWidgets > 1) {
    if (!recommendations.length) {
      const recommendationResult = await recommendQuestions({
        connection,
        mdl,
        previousQuestions: [...previousQuestions, intent],
        maxQuestions: Math.max(1, maxWidgets - 1),
        maxCategories: Math.min(3, Math.max(1, maxWidgets - 1)),
      });
      recommendations = recommendationResult.questions;
    }

    const selected = recommendations.slice(0, maxWidgets - 1);
    for (const rec of selected) {
      try {
        const chart = await generateChart({
          connection,
          question: rec.question,
          sql: rec.sql,
        });
        widgets.push({
          title: rec.question,
          question: rec.question,
          sql: rec.sql,
          chartType: chart.chartType,
          chartSchema: chart.chartSchema,
          reasoning: chart.reasoning,
          category: rec.category,
        });
      } catch {
        widgets.push({
          title: rec.question,
          question: rec.question,
          sql: rec.sql,
          category: rec.category,
        });
      }
    }
  }

  return {
    ask,
    recommendations,
    widgets: uniqueBySql(widgets).slice(0, maxWidgets),
    closestQueries,
  };
};
