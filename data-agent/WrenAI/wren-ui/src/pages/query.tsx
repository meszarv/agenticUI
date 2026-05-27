import { useState, useCallback } from 'react';
import { Button, Table, Space, Typography, message } from 'antd';
import styled from 'styled-components';
import PlayCircleOutlined from '@ant-design/icons/PlayCircleOutlined';
import ClearOutlined from '@ant-design/icons/ClearOutlined';
import SiderLayout from '@/components/layouts/SiderLayout';
import SQLEditor from '@/components/editor/SQLEditor';
import { usePreviewSqlMutation } from '@/apollo/client/graphql/sql.generated';

const { Text } = Typography;

const EditorSection = styled.div`
  margin-bottom: 16px;
`;

const ToolbarContent = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
`;

const ResultSection = styled.div`
  flex: 1;
  overflow: auto;
`;

const StatusBar = styled.div`
  padding: 8px 0;
  color: var(--gray-7);
  font-size: 13px;
`;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  padding: 24px;
  overflow: hidden;
`;

export default function QueryPage() {
  const [sql, setSql] = useState('');
  const [columns, setColumns] = useState<any[]>([]);
  const [dataSource, setDataSource] = useState<any[]>([]);
  const [executionTime, setExecutionTime] = useState<number | null>(null);

  const [previewSql, { loading }] = usePreviewSqlMutation({
    onError: (error) => {
      message.error(error.message);
    },
  });

  const onExecute = useCallback(async () => {
    if (!sql.trim()) {
      message.warning('Please enter a SQL statement');
      return;
    }

    const start = Date.now();
    const { data } = await previewSql({
      variables: { data: { sql, limit: 500 } },
    });

    const elapsed = Date.now() - start;
    setExecutionTime(elapsed);

    if (data?.previewSql) {
      const result = data.previewSql as any;
      const cols = (result.columns || []).map((col: any, idx: number) => ({
        title: `${col.name} (${col.type})`,
        dataIndex: idx,
        key: idx,
        ellipsis: true,
        width: 180,
      }));
      setColumns(cols);

      const rows = (result.data || []).map((row: any[], rowIdx: number) => {
        const obj: any = { key: rowIdx };
        row.forEach((val, colIdx) => {
          obj[colIdx] = val === null ? 'NULL' : String(val);
        });
        return obj;
      });
      setDataSource(rows);
    }
  }, [sql, previewSql]);

  const onClear = useCallback(() => {
    setColumns([]);
    setDataSource([]);
    setExecutionTime(null);
  }, []);

  const toolbar = (
    <ToolbarContent>
      <Text type="secondary" style={{ fontSize: 12 }}>
        SQL Query Editor
      </Text>
      <Space size={4}>
        <Button
          size="small"
          icon={<ClearOutlined />}
          onClick={onClear}
          disabled={loading}
        >
          Clear
        </Button>
        <Button
          type="primary"
          size="small"
          icon={<PlayCircleOutlined />}
          onClick={onExecute}
          loading={loading}
        >
          Run
        </Button>
      </Space>
    </ToolbarContent>
  );

  return (
    <SiderLayout loading={false}>
      <Container>
        <EditorSection>
          <SQLEditor
            value={sql}
            onChange={setSql}
            autoFocus
            autoComplete
            toolbar={toolbar}
          />
        </EditorSection>

        <StatusBar>
          {executionTime !== null && (
            <Text type="secondary">
              {dataSource.length} rows returned in {executionTime}ms
            </Text>
          )}
        </StatusBar>

        <ResultSection>
          <Table
            columns={columns}
            dataSource={dataSource}
            size="small"
            scroll={{ x: 'max-content', y: 'calc(100vh - 520px)' }}
            pagination={{
              pageSize: 50,
              showSizeChanger: true,
              pageSizeOptions: ['20', '50', '100', '200'],
              showTotal: (total) => `Total ${total} rows`,
            }}
            bordered
            loading={loading}
            locale={{ emptyText: 'Run a SQL query to see results' }}
          />
        </ResultSection>
      </Container>
    </SiderLayout>
  );
}
