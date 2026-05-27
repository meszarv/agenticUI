import { useState, useEffect, useCallback } from 'react';
import { Empty, Spin, Tag, Space, Typography, Tooltip } from 'antd';
import styled from 'styled-components';
import TraceDetail from '@/components/trace/TraceDetail';
import type { TraceQuery } from '@/pages/logs';

const { Text } = Typography;

const Summary = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--gray-4);
`;

const TokenTag = styled(Tag)`
  font-family: 'Menlo', monospace;
  font-size: 11px;
`;

interface Props {
  queryId?: string | null;
}

export default function InlineTrace({ queryId }: Props) {
  const [trace, setTrace] = useState<TraceQuery | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchTrace = useCallback(async () => {
    if (!queryId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/traces?page=1&size=50`);
      const data = await res.json();
      // 从返回的 queries 中找到匹配的 query_id
      const match = (data.queries || []).find(
        (q: TraceQuery) => q.query_id === queryId,
      );
      if (match) setTrace(match);
    } catch (e) {
      console.error('Failed to fetch trace:', e);
    } finally {
      setLoading(false);
    }
  }, [queryId]);

  useEffect(() => {
    fetchTrace();
    const timer = setTimeout(fetchTrace, 3000);
    return () => clearTimeout(timer);
  }, [fetchTrace]);

  if (!queryId) {
    return (
      <Empty
        description="No query ID available"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  if (loading && !trace) {
    return <Spin size="small" />;
  }

  if (!trace || !trace.steps || trace.steps.length === 0) {
    return (
      <Empty
        description="No LLM calls recorded for this query"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  const totalDuration = trace.total_duration_ms || 0;
  const promptTokens = trace.total_prompt_tokens || 0;
  const completionTokens = trace.total_completion_tokens || 0;
  const totalTokens = promptTokens + completionTokens;

  return (
    <div>
      <Summary>
        <Space size={8}>
          <Text type="secondary">{trace.steps.length} LLM calls</Text>
          <Text type="secondary">
            {totalDuration > 1000
              ? `${(totalDuration / 1000).toFixed(1)}s`
              : `${totalDuration}ms`}
          </Text>
        </Space>
        <Space size={4}>
          <Tooltip title="Prompt tokens">
            <TokenTag color="blue">
              Prompt: {promptTokens.toLocaleString()}
            </TokenTag>
          </Tooltip>
          <Tooltip title="Completion tokens">
            <TokenTag color="green">
              Completion: {completionTokens.toLocaleString()}
            </TokenTag>
          </Tooltip>
          <Tooltip title="Total tokens">
            <TokenTag color="orange">
              Total: {totalTokens.toLocaleString()}
            </TokenTag>
          </Tooltip>
        </Space>
      </Summary>
      <TraceDetail steps={trace.steps} />
    </div>
  );
}
