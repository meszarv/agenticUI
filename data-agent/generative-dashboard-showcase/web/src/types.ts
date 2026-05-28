export type RuntimeAppConfig = {
  wren: {
    baseUrl: string;
    uiGraphqlUrl: string;
    projectId: string | null;
    deployId: string;
    language: string;
    timezoneName: string;
    hasDeployId: boolean;
    hasMdlApi: boolean;
  };
};

export type AskCandidate = {
  sql: string;
  type: string;
};

export type AskResult = {
  queryId: string;
  status: string;
  type?: string;
  candidates: AskCandidate[];
  reasoning?: string;
  retrievedTables?: string[];
};

export type ChartResult = {
  queryId: string;
  status: string;
  chartType?: string;
  chartSchema?: Record<string, unknown>;
  reasoning?: string;
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
  dataPreview?: {
    columns: Array<{ name: string; type?: string | null }>;
    data: unknown[][];
  };
};

export type ClosestQuery = {
  question: string;
  sql: string;
  category?: string;
  description: string;
  retrievedTables?: string[];
};

export type GenerateDashboardResponse = {
  ask: AskResult;
  recommendations: Array<{
    question: string;
    category: string;
    sql: string;
  }>;
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
      recommendations: Array<{
        question: string;
        category: string;
        sql: string;
      }>;
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
      result: GenerateDashboardResponse;
    }
  | {
      type: 'error';
      message: string;
      details?: unknown;
    };
