import { Collapse, Tag, Typography, Space, Tooltip } from 'antd';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import CloseCircleOutlined from '@ant-design/icons/CloseCircleOutlined';
import styled from 'styled-components';
import type { TraceStep } from '@/pages/logs';

const { Text } = Typography;

const StepHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
`;

const PromptBlock = styled.div`
  background: #f6f8fa;
  border: 1px solid #e1e4e8;
  border-radius: 6px;
  padding: 12px;
  margin: 8px 0;
  font-family: 'Menlo', monospace;
  font-size: 12px;
  line-height: 1.6;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
`;

const ResponseBlock = styled(PromptBlock)`
  background: #f0f9ff;
  border-color: #bae0ff;
`;

const ErrorBlock = styled(PromptBlock)`
  background: #fff2f0;
  border-color: #ffccc7;
  color: #cf1322;
`;

const Label = styled(Text)`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
`;

const STEP_LABELS: Record<string, string> = {
  schema_retrieval: '模式检索',
  column_pruning: '列裁剪',
  sql_generation: 'SQL生成',
  sql_dryrun: '语法校验',
  sql_correction: 'SQL纠错',
  sql_execution: 'SQL执行',
  intent_classification: '意图分类',
  question_recommendation: '推荐问题',
  semantics_description: '语义描述',
  relationship_recommendation: '关系推荐',
  llm_call: 'LLM调用',
  sql_answer: 'SQL解读',
  data_assistance: '数据助手',
  misleading_assistance: '非SQL处理',
};

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface Props {
  steps: (TraceStep & { question?: string })[];
}

export default function TraceDetail({ steps }: Props) {
  return (
    <Collapse>
      {steps.map((step, idx) => {
        const stepType = step.step_type || 'unknown';
        const label = STEP_LABELS[stepType] || stepType;
        const isError =
          step.status === 'error' ||
          step.status?.startsWith('error_') ||
          step.error;
        const promptTokens = step.prompt_tokens || 0;
        const completionTokens = step.completion_tokens || 0;

        return (
          <Collapse.Panel
            key={idx}
            header={
              <StepHeader>
                <Space size={8}>
                  {isError ? (
                    <CloseCircleOutlined
                      style={{ color: '#ff4d4f', fontSize: 13 }}
                    />
                  ) : (
                    <CheckCircleOutlined
                      style={{ color: '#52c41a', fontSize: 13 }}
                    />
                  )}
                  <Tag color={isError ? 'red' : 'blue'}>{label}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {step.model}
                  </Text>
                  {step.duration_ms > 0 && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDuration(step.duration_ms)}
                    </Text>
                  )}
                </Space>
                <Space size={4}>
                  {promptTokens > 0 && (
                    <Tooltip title="Prompt tokens">
                      <Tag
                        style={{ fontSize: 11, fontFamily: 'Menlo, monospace' }}
                      >
                        Prompt:{promptTokens.toLocaleString()}
                      </Tag>
                    </Tooltip>
                  )}
                  {completionTokens > 0 && (
                    <Tooltip title="Completion tokens">
                      <Tag
                        style={{ fontSize: 11, fontFamily: 'Menlo, monospace' }}
                      >
                        Completion:{completionTokens.toLocaleString()}
                      </Tag>
                    </Tooltip>
                  )}
                </Space>
              </StepHeader>
            }
          >
            {step.request && (
              <>
                <Label type="secondary">REQUEST</Label>
                <PromptBlock>{step.request}</PromptBlock>
              </>
            )}
            {step.response && (
              <>
                <Label type="secondary">RESPONSE</Label>
                <ResponseBlock>{step.response}</ResponseBlock>
              </>
            )}
            {step.error && (
              <>
                <Label type="secondary">ERROR</Label>
                <ErrorBlock>{step.error}</ErrorBlock>
              </>
            )}
          </Collapse.Panel>
        );
      })}
    </Collapse>
  );
}
