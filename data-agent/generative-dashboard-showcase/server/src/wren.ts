import axios, { AxiosError, AxiosInstance } from 'axios';
import { openuiLibrary, openuiPromptOptions } from '@openuidev/react-ui';

export type WrenConnection = {
  baseUrl: string;
  uiGraphqlUrl?: string;
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
  openUiLang?: string;
  dataPreview?: SqlDataPreview;
};

export type ClosestQuery = {
  question: string;
  sql: string;
  category?: string;
  description: string;
  retrievedTables?: string[];
};

export type SqlDataPreview = {
  columns: Array<{ name: string; type?: string | null }>;
  data: unknown[][];
};

export type GenerateDashboardInput = {
  connection: WrenConnection;
  deployId: string;
  intent: string;
  maxWidgets?: number;
  mdl?: string;
  previousQuestions?: string[];
};

export type GenerateDashboardResult = {
  ask: AskResult;
  recommendations: RecommendationQuestion[];
  widgets: DashboardWidget[];
  closestQueries: ClosestQuery[];
};

export type DashboardStreamEvent =
  | {
      type: 'status';
      stage: string;
      message: string;
      progress?: number;
    }
  | {
      type: 'ask';
      ask: AskResult;
    }
  | {
      type: 'recommendations';
      recommendations: RecommendationQuestion[];
    }
  | {
      type: 'closestQueries';
      closestQueries: ClosestQuery[];
    }
  | {
      type: 'widget';
      index: number;
      widget: DashboardWidget;
    }
  | {
      type: 'final';
      result: GenerateDashboardResult;
    }
  | {
      type: 'error';
      message: string;
      details?: unknown;
    };

export class WrenError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'WrenError';
  }
}

const DEFAULT_TIMEOUT_MS = Number(process.env.WREN_TIMEOUT_MS ?? 180000);
const DEFAULT_POLL_INTERVAL_MS = Number(process.env.WREN_POLL_INTERVAL_MS ?? 1000);
const DEFAULT_SEMANTICS_TTL_MS = Number(
  process.env.WREN_SEMANTICS_PREPARE_TTL_MS ?? 10 * 60 * 1000,
);
const semanticsPreparedAt = new Map<string, number>();
const semanticsInFlight = new Map<string, Promise<void>>();

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

const OPENUI_SYSTEM_PROMPT = openuiLibrary.prompt(openuiPromptOptions);
const OPENUI_SQL_ANSWER_INSTRUCTION = `${OPENUI_SYSTEM_PROMPT}

### TASK
You are generating data UI for a SQL result.
Return ONLY valid openui-lang.
Do not include markdown fences or prose outside openui-lang.
Make a practical UI from the provided rows:
1. Start with root = Stack(...)
2. Include a short title.
3. Include at least one table of the provided rows.
4. If there is at least one numeric measure and one category field, include a simple chart.
5. Keep output concise and robust even for small datasets.
`;

const PREVIEW_SQL_MUTATION = `
  mutation PreviewSql($data: PreviewSQLDataInput) {
    previewSql(data: $data)
  }
`;

const buildUiGraphqlClient = (uiGraphqlUrl: string): AxiosInstance => {
  return axios.create({
    baseURL: uiGraphqlUrl,
    timeout: 60000,
    headers: {
      'Content-Type': 'application/json',
    },
  });
};

const previewSqlData = async (input: {
  connection: WrenConnection;
  sql: string;
  limit?: number;
}): Promise<SqlDataPreview> => {
  const { connection, sql, limit = 200 } = input;
  if (!connection.uiGraphqlUrl) {
    throw new WrenError('Wren UI GraphQL URL is required to preview SQL data');
  }

  const client = buildUiGraphqlClient(connection.uiGraphqlUrl);
  const variables = {
    data: {
      sql,
      projectId: connection.projectId || undefined,
      limit,
      dryRun: false,
    },
  };

  try {
    const res = await client.post('', {
      query: PREVIEW_SQL_MUTATION,
      variables,
    });
    if (Array.isArray(res.data?.errors) && res.data.errors.length) {
      throw new WrenError(
        `Wren UI GraphQL previewSql failed: ${res.data.errors
          .map((item: { message?: string }) => item?.message || 'Unknown error')
          .join('; ')}`,
      );
    }
    const payload = res.data?.data?.previewSql as
      | {
          columns?: Array<{ name?: string; type?: string | null }>;
          data?: unknown[][];
        }
      | undefined;
    const columns = payload?.columns ?? [];
    const data = payload?.data ?? [];

    if (!Array.isArray(columns) || !Array.isArray(data)) {
      throw new WrenError('previewSql did not return expected columns/data payload');
    }

    return {
      columns: columns.map((col) => ({
        name: String(col?.name ?? ''),
        type: col?.type ?? null,
      })),
      data,
    };
  } catch (error) {
    throw new WrenError(`Failed to preview SQL data: ${errorMessage(error)}`);
  }
};

const extractSseMessages = (raw: string) => {
  if (!raw.trim()) {
    return '';
  }

  const chunks: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) {
      continue;
    }
    const payload = trimmed.slice(5).trim();
    if (!payload) {
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as { message?: string };
      if (typeof parsed.message === 'string') {
        chunks.push(parsed.message);
      }
    } catch {
      continue;
    }
  }

  return chunks.join('');
};

const generateOpenUiLangFromSql = async (input: {
  connection: WrenConnection;
  question: string;
  sql: string;
}): Promise<{ openUiLang: string; dataPreview: SqlDataPreview }> => {
  const { connection, question, sql } = input;
  const client = buildClient(connection.baseUrl);
  const dataPreview = await previewSqlData({
    connection,
    sql,
  });

  const sqlData = {
    columns: dataPreview.columns.map((col) => ({
      name: col.name,
      type: col.type ?? undefined,
    })),
    data: dataPreview.data,
  };

  try {
    const create = await client.post('/v1/sql-answers', {
      query: question,
      sql,
      sql_data: sqlData,
      custom_instruction: OPENUI_SQL_ANSWER_INSTRUCTION,
      project_id: connection.projectId,
      configurations: getConfigurations(connection),
      request_from: 'api',
    });

    const queryId = create.data?.query_id as string;
    if (!queryId) {
      throw new WrenError('SQL answer generation did not return query_id');
    }

    await pollStatus(
      async () => {
        const res = await client.get(`/v1/sql-answers/${queryId}`);
        return res.data as {
          status: string;
          error?: { message?: string };
        };
      },
      (payload) => payload.status,
      'SQL answer',
    );

    const stream = await client.get(`/v1/sql-answers/${queryId}/streaming`, {
      responseType: 'text',
    });

    const openUiLang = extractSseMessages(String(stream.data ?? '')).trim();
    if (!openUiLang) {
      throw new WrenError('SQL answer streaming did not return OpenUI content');
    }

    return {
      openUiLang,
      dataPreview,
    };
  } catch (error) {
    throw new WrenError(`Failed to generate OpenUI lang: ${errorMessage(error)}`);
  }
};

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

const ensureSemanticsPrepared = async (input: {
  connection: WrenConnection;
  mdl?: string;
  mdlHash: string;
}) => {
  const mdl = input.mdl?.trim();
  if (!mdl) {
    return false;
  }

  const now = Date.now();
  const preparedAt = semanticsPreparedAt.get(input.mdlHash);
  if (preparedAt && now - preparedAt < DEFAULT_SEMANTICS_TTL_MS) {
    return false;
  }

  const inFlight = semanticsInFlight.get(input.mdlHash);
  if (inFlight) {
    await inFlight;
    return true;
  }

  const run = (async () => {
    await prepareSemantics({
      connection: input.connection,
      mdl,
      mdlHash: input.mdlHash,
    });
    semanticsPreparedAt.set(input.mdlHash, Date.now());
  })()
    .finally(() => {
      semanticsInFlight.delete(input.mdlHash);
    });

  semanticsInFlight.set(input.mdlHash, run);
  await run;
  return true;
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

const hasUsableEncodingFields = (encoding: unknown) => {
  if (!encoding || typeof encoding !== 'object') {
    return true;
  }
  const channels = Object.values(encoding as Record<string, unknown>);
  const fieldChannels = channels.filter((channel): channel is Record<string, unknown> => {
    if (!channel || typeof channel !== 'object') {
      return false;
    }
    return Object.prototype.hasOwnProperty.call(channel, 'field');
  });

  if (!fieldChannels.length) {
    return true;
  }

  return fieldChannels.some((channel) => Boolean(normalizeText(channel.field)));
};

const hasUsableChartPayload = (chart: ChartResult | undefined) => {
  if (!chart?.chartSchema || typeof chart.chartSchema !== 'object') {
    return false;
  }
  if (!normalizeText(chart.chartType)) {
    return false;
  }
  const schema = chart.chartSchema as Record<string, unknown>;
  return hasUsableEncodingFields(schema.encoding);
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

type DashboardEventEmitter = (event: DashboardStreamEvent) => void | Promise<void>;

const emitDashboardEvent = async (
  emitter: DashboardEventEmitter | undefined,
  event: DashboardStreamEvent,
) => {
  if (!emitter) {
    return;
  }
  await emitter(event);
};

const buildDashboardWidget = async (input: {
  connection: WrenConnection;
  question: string;
  sql: string;
  category?: string;
}): Promise<DashboardWidget> => {
  const { connection, question, sql, category } = input;
  let chart: ChartResult | undefined;
  let openUi:
    | {
        openUiLang: string;
        dataPreview: SqlDataPreview;
      }
    | undefined;
  const tryGenerateOpenUi = async (attempts: number) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await generateOpenUiLangFromSql({
          connection,
          question,
          sql,
        });
      } catch {
        // ignore and retry
      }
    }
    return undefined;
  };

  try {
    chart = await generateChart({
      connection,
      question,
      sql,
    });
    if (!hasUsableChartPayload(chart)) {
      openUi = await tryGenerateOpenUi(2);
      if (openUi) {
        chart = undefined;
      }
    }
  } catch {
    openUi = await tryGenerateOpenUi(1);
  }

  return {
    title: question,
    question,
    sql,
    chartType: chart?.chartType,
    chartSchema: chart?.chartSchema,
    reasoning: chart?.reasoning,
    category,
    openUiLang: openUi?.openUiLang,
    dataPreview: openUi?.dataPreview,
  };
};

const generateDashboardInternal = async (
  input: GenerateDashboardInput,
  onEvent?: DashboardEventEmitter,
): Promise<GenerateDashboardResult> => {
  const { connection, deployId, intent, mdl, previousQuestions = [], maxWidgets = 4 } = input;
  const widgetLimit = Math.max(1, maxWidgets);

  if (mdl?.trim()) {
    await emitDashboardEvent(onEvent, {
      type: 'status',
      stage: 'semantics',
      message: 'Preparing semantic context...',
      progress: 2,
    });
    const prepared = await ensureSemanticsPrepared({
      connection,
      mdl,
      mdlHash: deployId,
    });
    if (prepared) {
      await emitDashboardEvent(onEvent, {
        type: 'status',
        stage: 'semantics',
        message: 'Semantic context ready.',
        progress: 4,
      });
    }
  }

  await emitDashboardEvent(onEvent, {
    type: 'status',
    stage: 'ask',
    message: 'Analyzing intent and generating SQL candidates...',
    progress: 5,
  });

  const ask = await askIntent({
    connection,
    deployId,
    query: intent,
  });
  await emitDashboardEvent(onEvent, { type: 'ask', ask });

  let recommendations: RecommendationQuestion[] = [];
  let closestQueries: ClosestQuery[] = [];
  let primaryQuestion = intent;
  let primarySql: string;
  let primaryCategory: string | undefined;

  if (ask.candidates.length) {
    primarySql = ask.candidates[0].sql;
    await emitDashboardEvent(onEvent, {
      type: 'status',
      stage: 'ask',
      message: 'Primary SQL candidate found.',
      progress: 18,
    });
  } else if (mdl) {
    await emitDashboardEvent(onEvent, {
      type: 'status',
      stage: 'fallback',
      message: 'No direct SQL candidate. Searching closest query alternatives...',
      progress: 18,
    });
    const desiredClosestCount = 4;
    const recommendationPool: RecommendationQuestion[] = [];
    const recommendationSeen = new Set<string>();
    let recommendationResultRaw: Record<string, unknown> | undefined;
    const seedHistory = [...previousQuestions, intent];

    for (let attempt = 0; attempt < 3 && recommendationPool.length < desiredClosestCount; attempt += 1) {
      await emitDashboardEvent(onEvent, {
        type: 'status',
        stage: 'fallback',
        message: `Recommendation fallback attempt ${attempt + 1}/3...`,
        progress: 20 + attempt * 8,
      });
      const recommendationResult = await recommendQuestions({
        connection,
        mdl,
        previousQuestions: seedHistory,
        maxQuestions: Math.max(desiredClosestCount, widgetLimit),
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
    if (recommendations.length) {
      await emitDashboardEvent(onEvent, {
        type: 'recommendations',
        recommendations,
      });
    }

    const seeded = recommendations.slice(0, 10);
    const seen = new Set<string>();
    for (let i = 0; i < seeded.length; i += 1) {
      const rec = seeded[i];
      await emitDashboardEvent(onEvent, {
        type: 'status',
        stage: 'fallback',
        message: `Evaluating closest query option ${i + 1}/${seeded.length}...`,
        progress: 42,
      });
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
    if (closestQueries.length) {
      await emitDashboardEvent(onEvent, {
        type: 'closestQueries',
        closestQueries,
      });
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

  const widgets: DashboardWidget[] = [];
  const seenSql = new Set<string>();
  const pushWidget = async (widget: DashboardWidget) => {
    if (!widget.sql || seenSql.has(widget.sql) || widgets.length >= widgetLimit) {
      return;
    }
    seenSql.add(widget.sql);
    widgets.push(widget);
    await emitDashboardEvent(onEvent, {
      type: 'widget',
      index: widgets.length - 1,
      widget,
    });
  };

  await emitDashboardEvent(onEvent, {
    type: 'status',
    stage: 'primary-widget',
    message: 'Generating primary widget...',
    progress: 55,
  });
  const primaryWidget = await buildDashboardWidget({
    connection,
    question: primaryQuestion,
    sql: primarySql,
    category: primaryCategory,
  });
  await pushWidget(primaryWidget);

  if (mdl && widgetLimit > 1) {
    if (!recommendations.length) {
      await emitDashboardEvent(onEvent, {
        type: 'status',
        stage: 'recommendations',
        message: 'Generating additional widget recommendations...',
        progress: 65,
      });
      const recommendationResult = await recommendQuestions({
        connection,
        mdl,
        previousQuestions: [...previousQuestions, intent],
        maxQuestions: Math.max(1, widgetLimit - 1),
        maxCategories: Math.min(3, Math.max(1, widgetLimit - 1)),
      });
      recommendations = recommendationResult.questions;
      await emitDashboardEvent(onEvent, {
        type: 'recommendations',
        recommendations,
      });
    }

    const selected = recommendations.slice(0, Math.max(0, widgetLimit - 1));
    for (let i = 0; i < selected.length; i += 1) {
      const rec = selected[i];
      await emitDashboardEvent(onEvent, {
        type: 'status',
        stage: 'widget',
        message: `Generating widget ${i + 2} of ${Math.min(widgetLimit, selected.length + 1)}...`,
        progress: 72 + Math.round(((i + 1) / Math.max(1, selected.length)) * 22),
      });
      const widget = await buildDashboardWidget({
        connection,
        question: rec.question,
        sql: rec.sql,
        category: rec.category,
      });
      await pushWidget(widget);
    }
  }

  return {
    ask,
    recommendations,
    widgets: uniqueBySql(widgets).slice(0, widgetLimit),
    closestQueries,
  };
};

export const generateDashboard = async (
  input: GenerateDashboardInput,
): Promise<GenerateDashboardResult> => {
  return generateDashboardInternal(input);
};

export const generateDashboardStream = async (
  input: GenerateDashboardInput,
  onEvent: DashboardEventEmitter,
): Promise<GenerateDashboardResult> => {
  const result = await generateDashboardInternal(input, onEvent);
  await emitDashboardEvent(onEvent, {
    type: 'status',
    stage: 'done',
    message: `Completed ${result.widgets.length} widget(s).`,
    progress: 100,
  });
  await emitDashboardEvent(onEvent, {
    type: 'final',
    result,
  });
  return result;
};
