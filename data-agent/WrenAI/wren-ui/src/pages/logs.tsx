import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Button,
  Space,
  Switch,
  Tag,
  Typography,
  Select,
  Table,
  Pagination,
  Tooltip,
  Empty,
  message,
} from 'antd';
import styled from 'styled-components';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import CopyOutlined from '@ant-design/icons/CopyOutlined';
import ExpandAltOutlined from '@ant-design/icons/ExpandAltOutlined';
import ShrinkOutlined from '@ant-design/icons/ShrinkOutlined';
import SiderLayout from '@/components/layouts/SiderLayout';

const { Title } = Typography;

// ─── Types ──────────────────────────────────────────────────────────────

export interface TraceStep {
  step_type: string;
  model: string;
  status: string;
  duration_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  request: string;
  response: string;
  error: string;
}

// 兼容旧名称（InlineTrace.tsx 引用）
export type TraceGroup = TraceQuery;

export interface TraceQuery {
  id: number;
  query_id: string;
  question: string;
  source: string;
  status: string;
  total_duration_ms: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  started_at: string;
  steps: TraceStep[];
}

interface TraceSummary {
  total: number;
  success: number;
  warn: number;
  error: number;
  totalTokens: { prompt: number; completion: number; total: number };
  avgDuration: number;
}

interface TraceResponse {
  queries: TraceQuery[];
  total: number;
  page: number;
  size: number;
  summary: TraceSummary;
}

type ViewMode = 'by_query' | 'by_step';
type SourceFilter = 'all' | 'user' | 'recommendation' | 'system';

// ─── Constants ──────────────────────────────────────────────────────────

const STEP_TYPE_LABELS: Record<string, string> = {
  schema_retrieval: '模式检索 / Schema Retrieval',
  column_pruning: '列裁剪 / Column Pruning',
  sql_generation: 'SQL生成 / SQL Generation',
  sql_dryrun: '语法校验 / SQL Dry Run',
  sql_correction: 'SQL修正 / SQL Correction',
  sql_execution: 'SQL执行 / SQL Execution',
  intent_classification: '意图分类 / Intent Classification',
  question_recommendation: '推荐问题 / Question Recommendation',
  semantics_description: '语义描述 / Semantics Description',
};

const STEP_TYPE_OPTIONS = Object.entries(STEP_TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

const SOURCE_LABELS: Record<string, string> = {
  user: '用户查询',
  recommendation: '推荐生成',
  system: '系统调用',
};

const SOURCE_COLORS: Record<string, string> = {
  user: '#1677ff',
  recommendation: '#722ed1',
  system: '#8c8c8c',
};

const SOURCE_BG: Record<string, string> = {
  user: '#e6f4ff',
  recommendation: '#f3e8ff',
  system: '#f0f0f0',
};

// ─── Status helpers ─────────────────────────────────────────────────────

type StatusLevel = 'success' | 'warn' | 'error';

function getStatusLevel(status: string): StatusLevel {
  if (!status) return 'success';
  if (status === 'success') return 'success';
  if (status.startsWith('warn')) return 'warn';
  if (
    status.startsWith('error') ||
    status === 'model_error' ||
    status === 'sql_error' ||
    status === 'exec_fail' ||
    status === 'no_result'
  ) {
    // Legacy compat: no_result is warn level
    if (status === 'no_result') return 'warn';
    return 'error';
  }
  return 'success';
}

const STATUS_CONFIG: Record<
  StatusLevel,
  { color: string; bg: string; label: string; dotColor: string }
> = {
  success: {
    color: '#389e0d',
    bg: '#f6ffed',
    label: '成功',
    dotColor: '#52c41a',
  },
  warn: { color: '#d48806', bg: '#fffbe6', label: '告警', dotColor: '#faad14' },
  error: {
    color: '#cf1322',
    bg: '#fff2f0',
    label: '错误',
    dotColor: '#ff4d4f',
  },
};

const STEP_STATUS_BORDER_COLORS: Record<StatusLevel, string> = {
  success: '#52c41a',
  warn: '#faad14',
  error: '#ff4d4f',
};

// ─── Utility functions ──────────────────────────────────────────────────

function formatDuration(ms: number | undefined | null): string {
  if (ms == null || ms === 0) return '0ms';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(n: number | undefined | null): string {
  if (n == null) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function getStepLabel(stepType: string): string {
  return STEP_TYPE_LABELS[stepType] || stepType;
}

function formatTimestamp(ts: string | undefined | null): string {
  if (!ts) return '';
  // Already in "YYYY-MM-DD HH:MM:SS" format from API
  return ts.replace(/\.\d+$/, '').slice(0, 19);
}

// ─── Styled Components ──────────────────────────────────────────────────

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  overflow: hidden;
`;

const TopBar = styled.div`
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
  padding: 10px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
`;

const TopBarLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
`;

const SummaryStats = styled.div`
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  align-items: center;
`;

const StatItem = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #8c8c8c;
  white-space: nowrap;
`;

const StatValue = styled.span<{ $color?: string }>`
  font-family: 'Menlo', monospace;
  font-weight: 600;
  font-size: 13px;
  color: ${(p) => p.$color || '#1f1f1f'};
`;

const ViewTabs = styled.div`
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
  padding: 0 24px;
  display: flex;
  gap: 0;
`;

const ViewTab = styled.div<{ $active: boolean }>`
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  border-bottom: 2px solid ${(p) => (p.$active ? '#1677ff' : 'transparent')};
  color: ${(p) => (p.$active ? '#1677ff' : '#8c8c8c')};
  transition: all 0.15s;
  &:hover {
    color: ${(p) => (p.$active ? '#1677ff' : '#1f1f1f')};
  }
`;

const Toolbar = styled.div`
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
  padding: 6px 24px;
  display: flex;
  align-items: center;
  gap: 12px;
`;

const ToolbarLabel = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: #8c8c8c;
`;

const MainLayout = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`;

const LeftPanel = styled.div`
  width: 380px;
  min-width: 380px;
  background: #fff;
  border-right: 1px solid #e8e8e8;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;

const LeftPanelList = styled.div`
  flex: 1;
  overflow-y: auto;
`;

const LeftPanelFooter = styled.div`
  border-top: 1px solid #e8e8e8;
  padding: 8px 16px;
  display: flex;
  justify-content: center;
`;

const RightPanel = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px;
`;

const QueryItem = styled.div<{ $active: boolean }>`
  padding: 12px 16px;
  border-bottom: 1px solid #e8e8e8;
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
  background: ${(p) => (p.$active ? '#e6f4ff' : 'transparent')};
  border-right: ${(p) => (p.$active ? '3px solid #1677ff' : 'none')};
  &:hover {
    background: ${(p) => (p.$active ? '#e6f4ff' : '#f0f5ff')};
  }
`;

const QIndex = styled.div`
  font-family: 'Menlo', monospace;
  font-size: 11px;
  color: #8c8c8c;
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const QText = styled.div`
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const QMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  font-size: 11px;
  color: #8c8c8c;
`;

const DurBarWrap = styled.div`
  width: 60px;
  height: 4px;
  background: #f0f0f0;
  border-radius: 2px;
  overflow: hidden;
  flex-shrink: 0;
`;

const DurBar = styled.div<{ $pct: number; $color?: string }>`
  height: 100%;
  border-radius: 2px;
  background: ${(p) => p.$color || '#1677ff'};
  width: ${(p) => p.$pct}%;
  transition: width 0.3s;
`;

const StatusDot = styled.span<{ $color: string }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
  background: ${(p) => p.$color};
`;

const StatusBadge = styled.span<{ $bg: string; $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  background: ${(p) => p.$bg};
  color: ${(p) => p.$color};
`;

const SourceTag = styled.span<{ $bg: string; $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.6;
  white-space: nowrap;
  background: ${(p) => p.$bg};
  color: ${(p) => p.$color};
`;

const NoSelection = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #8c8c8c;
  font-size: 14px;
`;

const TimelineHeader = styled.div`
  margin-bottom: 20px;
`;

const ThQuestion = styled.div`
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
  margin-bottom: 8px;
`;

const ThMeta = styled.div`
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #8c8c8c;
  align-items: center;
`;

const TimelineActions = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
`;

const Timeline = styled.div`
  position: relative;
  padding-left: 28px;
  &::before {
    content: '';
    position: absolute;
    left: 9px;
    top: 12px;
    bottom: 12px;
    width: 2px;
    border-left: 2px dashed #d9d9d9;
  }
`;

const TimelineStep = styled.div`
  position: relative;
  margin-bottom: 16px;
`;

const StepDot = styled.div<{ $color: string }>`
  position: absolute;
  left: -28px;
  top: 14px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid ${(p) => p.$color};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  z-index: 2;
  color: ${(p) => p.$color};
`;

const StepCard = styled.div<{ $borderColor: string }>`
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  overflow: hidden;
  transition: box-shadow 0.15s;
  border-left: 3px solid ${(p) => p.$borderColor};
  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  }
`;

const StepCardHeader = styled.div`
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  cursor: pointer;
`;

const StepName = styled.span`
  font-weight: 600;
  font-size: 13px;
`;

const StepModel = styled.span`
  font-size: 11px;
  background: #f0f0f0;
  padding: 1px 8px;
  border-radius: 4px;
  font-family: 'Menlo', monospace;
  color: #8c8c8c;
`;

const StepMetrics = styled.div`
  padding: 0 16px 10px;
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
`;

const StepDuration = styled.div`
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const DurText = styled.span`
  font-family: 'Menlo', monospace;
  font-weight: 500;
`;

const StepDurBarWrap = styled.div`
  width: 100px;
  height: 6px;
  background: #f0f0f0;
  border-radius: 3px;
  overflow: hidden;
`;

const StepTokens = styled.div`
  font-size: 11px;
  color: #8c8c8c;
  font-family: 'Menlo', monospace;
`;

const TokLabel = styled.span`
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
`;

const ExpandContent = styled.div<{ $open: boolean }>`
  display: ${(p) => (p.$open ? 'block' : 'none')};
  border-top: 1px solid #e8e8e8;
`;

const ExpandSectionHeader = styled.div`
  padding: 8px 16px;
  background: #fafafa;
  border-bottom: 1px solid #e8e8e8;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const CodeBlock = styled.div<{ $isSql?: boolean }>`
  max-height: 300px;
  overflow-y: auto;
  padding: 8px 12px;
  background: ${(p) => (p.$isSql ? '#f0f4f8' : '#f6f8fa')};
  color: #24292f;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
  ${(p) => p.$isSql && 'border-left: 3px solid #3b82f6;'}
`;

const ByStepContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px;
  display: flex;
  flex-direction: column;
`;

const ByStepControls = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
`;

const MonoCell = styled.span`
  font-family: 'Menlo', monospace;
  font-size: 12px;
`;

const QLink = styled.a`
  color: #1677ff;
  cursor: pointer;
  text-decoration: none;
  max-width: 250px;
  display: inline-block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
  &:hover {
    text-decoration: underline;
  }
`;

// ─── Sub-components ─────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  const label = SOURCE_LABELS[source] || source;
  const color = SOURCE_COLORS[source] || '#8c8c8c';
  const bg = SOURCE_BG[source] || '#f0f0f0';
  return (
    <SourceTag $bg={bg} $color={color}>
      {label}
    </SourceTag>
  );
}

function StatusBadgeComp({ status }: { status: string }) {
  const level = getStatusLevel(status);
  const cfg = STATUS_CONFIG[level];
  return (
    <StatusBadge $bg={cfg.bg} $color={cfg.color}>
      <StatusDot $color={cfg.dotColor} />
      {cfg.label}
    </StatusBadge>
  );
}

function CopyButton({ text }: { text: string }) {
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text || '').then(() => {
      message.success('Copied!');
    });
  };
  return (
    <Button
      size="small"
      type="text"
      icon={<CopyOutlined />}
      onClick={handleCopy}
      style={{ fontSize: 11 }}
    >
      Copy
    </Button>
  );
}

const PREVIEW_LIMIT = 500;

function ExpandSection({
  title,
  content,
  isSql,
}: {
  title: string;
  content: string;
  isSql?: boolean;
}) {
  const [showFull, setShowFull] = useState(false);
  if (!content) return null;

  const isLong = content.length > PREVIEW_LIMIT;
  const displayText =
    showFull || !isLong
      ? content
      : content.slice(0, PREVIEW_LIMIT) +
        '\n... (' +
        (content.length - PREVIEW_LIMIT) +
        ' chars more)';

  return (
    <div>
      <ExpandSectionHeader>
        <Space size={8}>
          <span>{title}</span>
          {isLong && (
            <Button
              size="small"
              type="link"
              onClick={(e) => {
                e.stopPropagation();
                setShowFull(!showFull);
              }}
              style={{ fontSize: 11, padding: 0 }}
            >
              {showFull ? '收起' : `展开全部 (${content.length} chars)`}
            </Button>
          )}
        </Space>
        <CopyButton text={content} />
      </ExpandSectionHeader>
      <CodeBlock $isSql={isSql}>{displayText}</CodeBlock>
    </div>
  );
}

// ─── Step Timeline Item ─────────────────────────────────────────────────

function StepTimelineItem({
  step,
  maxDuration,
  forceExpand,
}: {
  step: TraceStep;
  maxDuration: number;
  forceExpand: boolean | null;
}) {
  const level = getStatusLevel(step.status);
  const borderColor = STEP_STATUS_BORDER_COLORS[level];
  const isError = level === 'error';

  const [expanded, setExpanded] = useState(isError);

  useEffect(() => {
    if (forceExpand === true) setExpanded(true);
    else if (forceExpand === false) setExpanded(isError);
  }, [forceExpand, isError]);

  const durPct =
    maxDuration > 0
      ? Math.max(4, ((step.duration_ms || 0) / maxDuration) * 100)
      : 4;
  const statusIcon =
    level === 'success'
      ? '\u2705'
      : level === 'warn'
        ? '\u26A0\uFE0F'
        : '\u274C';

  const hasTokens =
    (step.prompt_tokens || 0) +
      (step.completion_tokens || 0) +
      (step.total_tokens || 0) >
    0;

  return (
    <TimelineStep>
      <StepDot $color={borderColor}>{statusIcon}</StepDot>
      <StepCard $borderColor={borderColor}>
        <StepCardHeader onClick={() => setExpanded((v) => !v)}>
          <StepName>{getStepLabel(step.step_type)}</StepName>
          {step.model && <StepModel>{step.model}</StepModel>}
          <span style={{ marginLeft: 'auto' }}>
            <StatusBadgeComp status={step.status} />
          </span>
        </StepCardHeader>
        <StepMetrics>
          <StepDuration>
            <DurText>{formatDuration(step.duration_ms)}</DurText>
            <StepDurBarWrap>
              <DurBar $pct={durPct} />
            </StepDurBarWrap>
          </StepDuration>
          {hasTokens ? (
            <StepTokens>
              <TokLabel>Prompt: </TokLabel>
              {formatTokens(step.prompt_tokens)}
              <TokLabel> Completion: </TokLabel>
              {formatTokens(step.completion_tokens)}
              <TokLabel> Total: </TokLabel>
              {formatTokens(step.total_tokens)}
            </StepTokens>
          ) : (
            <StepTokens style={{ color: '#bfbfbf' }}>
              -- no tokens --
            </StepTokens>
          )}
        </StepMetrics>
        <ExpandContent $open={expanded}>
          <ExpandSection title="请求 Request" content={step.request} />
          <ExpandSection title="响应 Response" content={step.response} />
          {step.error && (
            <ExpandSection title="错误 Error" content={step.error} />
          )}
        </ExpandContent>
      </StepCard>
    </TimelineStep>
  );
}

// ─── Main Page Component ────────────────────────────────────────────────

export default function LogsPage() {
  const [queries, setQueries] = useState<TraceQuery[]>([]);
  const [summary, setSummary] = useState<TraceSummary | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const [autoRefresh, setAutoRefresh] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('by_query');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  // By Query view state
  const [selectedQueryId, setSelectedQueryId] = useState<number | null>(null);
  const [allStepsExpand, setAllStepsExpand] = useState<boolean | null>(null);

  // By Step view state
  const [stepTypeFilter, setStepTypeFilter] = useState('schema_retrieval');
  const [_stepSortField, setStepSortField] = useState<string>('timestamp');
  const [_stepSortOrder, setStepSortOrder] = useState<'ascend' | 'descend'>(
    'ascend',
  );
  const [stepPage, setStepPage] = useState(1);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTraces = useCallback(
    async (page?: number) => {
      const p = page ?? currentPage;
      try {
        setLoading(true);
        const params = new URLSearchParams({
          page: String(p),
          size: String(pageSize),
        });
        if (sourceFilter !== 'all') {
          params.set('source', sourceFilter);
        }
        const res = await fetch(`/api/traces?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: TraceResponse = await res.json();
        setQueries(data.queries || []);
        setTotalCount(data.total || 0);
        setSummary(data.summary || null);
      } catch (e) {
        console.error('Failed to fetch traces:', e);
      } finally {
        setLoading(false);
      }
    },
    [currentPage, pageSize, sourceFilter],
  );

  // Initial fetch and filter/page change
  useEffect(() => {
    fetchTraces(currentPage);
  }, [currentPage, sourceFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoRefresh) {
      timerRef.current = setInterval(() => fetchTraces(), 5000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh, fetchTraces]);

  // Reset selection when page/filter changes
  useEffect(() => {
    setSelectedQueryId(null);
    setAllStepsExpand(null);
  }, [currentPage, sourceFilter]);

  // Selected query
  const selectedQuery = useMemo(
    () => queries.find((q) => q.id === selectedQueryId) || null,
    [queries, selectedQueryId],
  );

  // Max duration in selected query (for bar calculation)
  const maxStepDuration = useMemo(() => {
    if (!selectedQuery) return 1;
    return Math.max(...selectedQuery.steps.map((s) => s.duration_ms || 0), 1);
  }, [selectedQuery]);

  // Max duration across all queries (for left panel bar)
  const maxQueryDuration = useMemo(() => {
    return Math.max(...queries.map((q) => q.total_duration_ms || 0), 1);
  }, [queries]);

  // By Step: gather all matching steps across current page queries
  const byStepData = useMemo(() => {
    const instances: Array<{
      key: string;
      queryId: number;
      question: string;
      queryStatus: string;
      querySource: string;
      step: TraceStep;
    }> = [];
    queries.forEach((q) => {
      (q.steps || []).forEach((step, idx) => {
        if (step.step_type === stepTypeFilter) {
          instances.push({
            key: `${q.id}-${idx}`,
            queryId: q.id,
            question: q.question || q.query_id,
            queryStatus: q.status,
            querySource: q.source,
            step,
          });
        }
      });
    });
    return instances;
  }, [queries, stepTypeFilter]);

  // Handle page change
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleStepPageChange = (page: number) => {
    setStepPage(page);
  };

  // Handle query click in By Step view -> switch to By Query view
  const handleJumpToQuery = (queryId: number) => {
    setViewMode('by_query');
    setSelectedQueryId(queryId);
  };

  // ─── Render: Summary Bar ───────────────────────────────────────────

  const renderSummary = () => {
    const s = summary;
    if (!s) return null;
    return (
      <SummaryStats>
        <StatItem>
          查询 <StatValue>{s.total}</StatValue>
        </StatItem>
        <StatItem>
          {'\u2705'} 成功 <StatValue $color="#52c41a">{s.success}</StatValue>
        </StatItem>
        <StatItem>
          {'\u26A0\uFE0F'} 告警 <StatValue $color="#faad14">{s.warn}</StatValue>
        </StatItem>
        <StatItem>
          {'\u274C'} 错误 <StatValue $color="#ff4d4f">{s.error}</StatValue>
        </StatItem>
        <StatItem>
          Tokens <StatValue>{formatTokens(s.totalTokens?.total)}</StatValue>
          <span style={{ fontSize: 10, color: '#8c8c8c' }}>
            (Prompt: {formatTokens(s.totalTokens?.prompt)} / Completion:{' '}
            {formatTokens(s.totalTokens?.completion)})
          </span>
        </StatItem>
        <StatItem>
          平均耗时 <StatValue>{formatDuration(s.avgDuration)}</StatValue>
        </StatItem>
      </SummaryStats>
    );
  };

  // ─── Render: Left Panel (Query List) ──────────────────────────────

  const renderQueryList = () => (
    <LeftPanel>
      <LeftPanelList>
        {queries.length === 0 ? (
          <div style={{ padding: 40 }}>
            <Empty description="暂无查询记录 / No traces yet" />
          </div>
        ) : (
          queries.map((q, qIdx) => {
            const level = getStatusLevel(q.status);
            const cfg = STATUS_CONFIG[level];
            const durPct = Math.max(
              4,
              ((q.total_duration_ms || 0) / maxQueryDuration) * 100,
            );
            return (
              <QueryItem
                key={q.id}
                $active={q.id === selectedQueryId}
                onClick={() => {
                  setSelectedQueryId(q.id);
                  setAllStepsExpand(null);
                }}
              >
                <QIndex>
                  #{qIdx + 1} <SourceBadge source={q.source} />
                </QIndex>
                <QText>{q.question || q.query_id}</QText>
                <QMeta>
                  <StatusBadge $bg={cfg.bg} $color={cfg.color}>
                    <StatusDot $color={cfg.dotColor} />
                    {cfg.label}
                  </StatusBadge>
                  <span style={{ fontFamily: "'Menlo', monospace" }}>
                    {formatDuration(q.total_duration_ms)}
                  </span>
                  <DurBarWrap>
                    <DurBar $pct={durPct} />
                  </DurBarWrap>
                  <span style={{ fontFamily: "'Menlo', monospace" }}>
                    {formatTimestamp(q.started_at)}
                  </span>
                </QMeta>
              </QueryItem>
            );
          })
        )}
      </LeftPanelList>
      <LeftPanelFooter>
        <Pagination
          size="small"
          current={currentPage}
          pageSize={pageSize}
          total={totalCount}
          onChange={handlePageChange}
          showSizeChanger={false}
          showTotal={(total) => `${total} 条`}
        />
      </LeftPanelFooter>
    </LeftPanel>
  );

  // ─── Render: Right Panel (Timeline) ───────────────────────────────

  const renderTimeline = () => {
    if (!selectedQuery) {
      return (
        <RightPanel>
          <NoSelection>
            {'\uD83D\uDC48'} 选择左侧查询以查看调用链 / Select a query to view
            pipeline
          </NoSelection>
        </RightPanel>
      );
    }

    const q = selectedQuery;
    const level = getStatusLevel(q.status);
    const cfg = STATUS_CONFIG[level];

    return (
      <RightPanel>
        <TimelineHeader>
          <ThQuestion>
            <SourceBadge source={q.source} /> {q.question || q.query_id}
          </ThQuestion>
          <ThMeta>
            <StatusBadge $bg={cfg.bg} $color={cfg.color}>
              <StatusDot $color={cfg.dotColor} />
              {cfg.label}
            </StatusBadge>
            <span style={{ fontFamily: "'Menlo', monospace" }}>
              总耗时 {formatDuration(q.total_duration_ms)}
            </span>
            <span style={{ fontFamily: "'Menlo', monospace" }}>
              {formatTimestamp(q.started_at)}
            </span>
            <span style={{ fontFamily: "'Menlo', monospace" }}>
              Tokens: Prompt {formatTokens(q.total_prompt_tokens)} / Completion{' '}
              {formatTokens(q.total_completion_tokens)}
            </span>
          </ThMeta>
        </TimelineHeader>

        <TimelineActions>
          <Button
            size="small"
            icon={allStepsExpand ? <ShrinkOutlined /> : <ExpandAltOutlined />}
            onClick={() =>
              setAllStepsExpand((v) => (v === true ? false : true))
            }
          >
            {allStepsExpand ? '全部收起' : '全部展开'}
          </Button>
        </TimelineActions>

        <Timeline>
          {(q.steps || []).map((step, idx) => (
            <StepTimelineItem
              key={idx}
              step={step}
              maxDuration={maxStepDuration}
              forceExpand={allStepsExpand}
            />
          ))}
          {(!q.steps || q.steps.length === 0) && (
            <Empty description="该查询没有步骤记录" />
          )}
        </Timeline>
      </RightPanel>
    );
  };

  // ─── Render: By Step View ─────────────────────────────────────────

  const byStepColumns = [
    {
      title: '来源',
      dataIndex: 'querySource',
      key: 'source',
      width: 80,
      render: (source: string) => <SourceBadge source={source} />,
    },
    {
      title: '问题 Question',
      dataIndex: 'question',
      key: 'question',
      ellipsis: true,
      width: 280,
      render: (text: string, record: (typeof byStepData)[0]) => (
        <span>
          <StatusDot
            $color={STATUS_CONFIG[getStatusLevel(record.queryStatus)].dotColor}
            style={{ marginRight: 6, verticalAlign: 'middle' }}
          />
          <QLink onClick={() => handleJumpToQuery(record.queryId)} title={text}>
            {text}
          </QLink>
        </span>
      ),
    },
    {
      title: '模型 Model',
      key: 'model',
      width: 140,
      render: (_: unknown, record: (typeof byStepData)[0]) => (
        <MonoCell>{record.step.model || '-'}</MonoCell>
      ),
    },
    {
      title: '耗时 Duration',
      key: 'duration',
      width: 110,
      sorter: (a: (typeof byStepData)[0], b: (typeof byStepData)[0]) =>
        (a.step.duration_ms || 0) - (b.step.duration_ms || 0),
      render: (_: unknown, record: (typeof byStepData)[0]) => (
        <MonoCell>{formatDuration(record.step.duration_ms)}</MonoCell>
      ),
    },
    {
      title: 'Tokens (Prompt / Completion / Total)',
      key: 'tokens',
      width: 220,
      sorter: (a: (typeof byStepData)[0], b: (typeof byStepData)[0]) =>
        (a.step.total_tokens || 0) - (b.step.total_tokens || 0),
      render: (_: unknown, record: (typeof byStepData)[0]) => {
        const s = record.step;
        const hasTokens =
          (s.prompt_tokens || 0) +
            (s.completion_tokens || 0) +
            (s.total_tokens || 0) >
          0;
        if (!hasTokens)
          return <MonoCell style={{ color: '#bfbfbf' }}>--</MonoCell>;
        return (
          <MonoCell>
            {formatTokens(s.prompt_tokens)} /{' '}
            {formatTokens(s.completion_tokens)} / {formatTokens(s.total_tokens)}
          </MonoCell>
        );
      },
    },
    {
      title: '状态 Status',
      key: 'status',
      width: 90,
      render: (_: unknown, record: (typeof byStepData)[0]) => (
        <StatusBadgeComp status={record.step.status} />
      ),
    },
  ];

  const renderByStepView = () => {
    const paginatedData = byStepData.slice(
      (stepPage - 1) * pageSize,
      stepPage * pageSize,
    );

    return (
      <ByStepContainer>
        <ByStepControls>
          <ToolbarLabel>步骤类型 Step Type:</ToolbarLabel>
          <Select
            value={stepTypeFilter}
            onChange={(v) => {
              setStepTypeFilter(v);
              setStepPage(1);
            }}
            style={{ width: 280 }}
            options={STEP_TYPE_OPTIONS}
          />
        </ByStepControls>

        {byStepData.length === 0 ? (
          <Empty description="该步骤类型暂无记录 / No instances of this step type" />
        ) : (
          <>
            <Table
              dataSource={paginatedData}
              columns={byStepColumns}
              pagination={false}
              size="small"
              rowKey="key"
              scroll={{ x: 900 }}
              onChange={(_pagination, _filters, sorter: any) => {
                if (sorter.field) {
                  setStepSortField(sorter.field);
                  setStepSortOrder(sorter.order || 'ascend');
                }
              }}
            />
            <div
              style={{
                marginTop: 16,
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              <Pagination
                size="small"
                current={stepPage}
                pageSize={pageSize}
                total={byStepData.length}
                onChange={handleStepPageChange}
                showSizeChanger={false}
                showTotal={(total) => `${total} 条`}
              />
            </div>
          </>
        )}
      </ByStepContainer>
    );
  };

  // ─── Main Render ──────────────────────────────────────────────────

  return (
    <SiderLayout loading={false}>
      <Container>
        {/* Top Bar */}
        <TopBar>
          <TopBarLeft>
            <Title level={5} style={{ margin: 0, whiteSpace: 'nowrap' }}>
              NL2SQL Trace Viewer
            </Title>
            {renderSummary()}
          </TopBarLeft>
          <Space size={8}>
            <Tag color={autoRefresh ? 'green' : 'default'}>
              {autoRefresh ? 'LIVE' : 'PAUSED'}
            </Tag>
            <Switch
              size="small"
              checked={autoRefresh}
              onChange={setAutoRefresh}
            />
            <Tooltip title="刷新 Refresh">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => fetchTraces()}
                loading={loading}
              />
            </Tooltip>
          </Space>
        </TopBar>

        {/* View Tabs */}
        <ViewTabs>
          <ViewTab
            $active={viewMode === 'by_query'}
            onClick={() => setViewMode('by_query')}
          >
            按问题 By Query
          </ViewTab>
          <ViewTab
            $active={viewMode === 'by_step'}
            onClick={() => setViewMode('by_step')}
          >
            按步骤 By Step
          </ViewTab>
        </ViewTabs>

        {/* Source Filter */}
        <Toolbar>
          <ToolbarLabel>来源:</ToolbarLabel>
          <Select
            size="small"
            value={sourceFilter}
            onChange={(v) => {
              setSourceFilter(v);
              setCurrentPage(1);
              setStepPage(1);
            }}
            style={{ width: 140 }}
            options={[
              { value: 'all', label: '全部来源' },
              { value: 'user', label: '用户查询' },
              { value: 'recommendation', label: '推荐生成' },
              { value: 'system', label: '系统调用' },
            ]}
          />
        </Toolbar>

        {/* Main Content */}
        {viewMode === 'by_query' ? (
          <MainLayout>
            {renderQueryList()}
            {renderTimeline()}
          </MainLayout>
        ) : (
          renderByStepView()
        )}
      </Container>
    </SiderLayout>
  );
}
