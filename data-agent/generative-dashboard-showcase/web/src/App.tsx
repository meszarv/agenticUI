import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { VegaEmbed } from 'react-vega';
import { Renderer } from '@openuidev/react-lang';
import { ThemeProvider, openuiLibrary } from '@openuidev/react-ui';
import { generateDashboard, generateDashboardStream, getRuntimeConfig } from './api';
import { DashboardStreamEvent, GenerateDashboardResponse, RuntimeAppConfig } from './types';

const extractError = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.error || error.response?.data?.details;
    return detail ? JSON.stringify(detail) : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const makeEmptyStreamResult = (): GenerateDashboardResponse => ({
  ask: {
    queryId: '',
    status: 'running',
    candidates: [],
  },
  recommendations: [],
  widgets: [],
  closestQueries: [],
});

export default function App() {
  const [intent, setIntent] = useState('Show a health overview dashboard for network quality by region.');
  const [previousQuestionsText, setPreviousQuestionsText] = useState('');
  const [maxWidgets, setMaxWidgets] = useState(4);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeAppConfig | null>(null);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateDashboardResponse | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  const previousQuestions = useMemo(() => {
    return previousQuestionsText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  }, [previousQuestionsText]);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await getRuntimeConfig();
        setRuntimeConfig(config);
      } catch (err) {
        setError(`Failed to load backend config: ${extractError(err)}`);
      }
    };

    loadConfig();
  }, []);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  const handleGenerate = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!runtimeConfig?.wren?.hasDeployId) {
      setError('Backend config is missing wren.deployId.');
      return;
    }

    if (!intent.trim()) {
      setError('Intent is required.');
      return;
    }

    streamAbortRef.current?.abort();
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    try {
      setBusy(true);
      setResult(makeEmptyStreamResult());
      setStatus('Starting dashboard generation...');

      let finalReceived = false;
      let streamFailure: string | null = null;
      const input = {
        intent,
        previousQuestions,
        maxWidgets,
      };

      const onEvent = (streamEvent: DashboardStreamEvent) => {
        switch (streamEvent.type) {
          case 'status': {
            setStatus(streamEvent.message);
            return;
          }
          case 'ask': {
            setResult((prev) => ({
              ...(prev || makeEmptyStreamResult()),
              ask: streamEvent.ask,
            }));
            return;
          }
          case 'recommendations': {
            setResult((prev) => ({
              ...(prev || makeEmptyStreamResult()),
              recommendations: streamEvent.recommendations,
            }));
            return;
          }
          case 'closestQueries': {
            setResult((prev) => ({
              ...(prev || makeEmptyStreamResult()),
              closestQueries: streamEvent.closestQueries,
            }));
            return;
          }
          case 'widget': {
            setResult((prev) => {
              const base = prev || makeEmptyStreamResult();
              const widgets = [...base.widgets];
              const existingIndex = widgets.findIndex((item) => item.sql === streamEvent.widget.sql);
              if (existingIndex >= 0) {
                widgets[existingIndex] = streamEvent.widget;
              } else {
                widgets.push(streamEvent.widget);
              }
              return {
                ...base,
                widgets,
              };
            });
            setStatus(`Generated ${streamEvent.index + 1} widget(s)...`);
            return;
          }
          case 'final': {
            finalReceived = true;
            setResult(streamEvent.result);
            setStatus(`Generated ${streamEvent.result.widgets.length} widget(s).`);
            return;
          }
          case 'error': {
            streamFailure = streamEvent.details
              ? `${streamEvent.message} (${JSON.stringify(streamEvent.details)})`
              : streamEvent.message;
          }
        }
      };

      try {
        await generateDashboardStream(input, {
          onEvent,
          signal: abortController.signal,
        });

        if (streamFailure) {
          throw new Error(streamFailure);
        }
        if (!finalReceived) {
          throw new Error('Dashboard stream ended before final result.');
        }
      } catch (streamErr) {
        if ((streamErr as Error).name === 'AbortError') {
          throw streamErr;
        }
        setStatus('Streaming failed. Falling back to standard request...');
        const dashboard = await generateDashboard(input);
        setResult(dashboard);
        setStatus(`Generated ${dashboard.widgets.length} widget(s).`);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatus('Generation cancelled.');
        return;
      }
      setStatus('Dashboard generation failed.');
      setError(extractError(err));
    } finally {
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
      }
      setBusy(false);
    }
  };

  const handleCancel = () => {
    if (!busy) {
      return;
    }
    streamAbortRef.current?.abort();
  };

  return (
    <div className="page">
      <header className="hero">
        <h1>Generative Dashboard Showcase</h1>
      </header>

      <div className="layout">
        <section className="panel">
          <h2>Backend Config</h2>
          <div className="summary">
            <p>
              <strong>Base URL:</strong> {runtimeConfig?.wren.baseUrl || 'loading...'}
            </p>
            <p>
              <strong>MDL API:</strong> {runtimeConfig?.wren.uiGraphqlUrl || 'N/A'}
            </p>
            <p>
              <strong>Project ID:</strong> {runtimeConfig?.wren.projectId || 'N/A'}
            </p>
            <p>
              <strong>Language:</strong> {runtimeConfig?.wren.language || 'N/A'}
            </p>
            <p>
              <strong>Timezone:</strong> {runtimeConfig?.wren.timezoneName || 'N/A'}
            </p>
            <p>
              <strong>Deploy ID:</strong>{' '}
              {runtimeConfig?.wren.hasDeployId ? 'configured' : 'missing'}
            </p>
            {runtimeConfig?.wren.hasDeployId ? (
              <p>
                <strong>Deploy Hash:</strong> <code>{runtimeConfig.wren.deployId}</code>
              </p>
            ) : null}
            <p>
              <strong>Schema Context:</strong> using Wren server prepared context
            </p>
          </div>

          <h2>Intent</h2>
          <form onSubmit={handleGenerate} className="stack gap-m">
            <label>
              <span>User Intent</span>
              <textarea
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                rows={4}
              />
            </label>
            <label>
              <span>Previous Questions (one per line)</span>
              <textarea
                value={previousQuestionsText}
                onChange={(e) => setPreviousQuestionsText(e.target.value)}
                rows={4}
                placeholder="optional context"
              />
            </label>
            <label>
              <span>Max Widgets</span>
              <input
                type="number"
                min={1}
                max={12}
                value={maxWidgets}
                onChange={(e) => setMaxWidgets(Number(e.target.value))}
              />
            </label>
            <div className="inline-actions">
              <button type="submit" disabled={busy}>
                {busy ? 'Generating...' : 'Generate Dashboard'}
              </button>
              {busy ? (
                <button type="button" className="ghost" onClick={handleCancel}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>

          <div className="status">
            <div>
              <strong>Status:</strong> {status}
            </div>
            {error ? (
              <pre className="error">{error}</pre>
            ) : null}
          </div>
        </section>

        <section className="panel output">
          <h2>Generated Dashboard</h2>
          {!result ? (
            <p className="muted">Generate a dashboard to see widgets here.</p>
          ) : (
            <>
              <div className="summary">
                <p>
                  <strong>Ask Type:</strong> {result.ask.type || 'N/A'}
                </p>
                <p>
                  <strong>Candidates:</strong> {result.ask.candidates.length}
                </p>
                <p>
                  <strong>Recommendations:</strong> {result.recommendations.length}
                </p>
              </div>

              {result.closestQueries.length ? (
                <div className="summary">
                  <p>
                    <strong>Closest Query Options:</strong> {result.closestQueries.length}
                  </p>
                  {result.closestQueries.map((item, idx) => (
                    <details key={`${item.question}-${idx}`}>
                      <summary>{item.question}</summary>
                      <p>{item.description}</p>
                      {item.category ? (
                        <p>
                          <strong>Category:</strong> {item.category}
                        </p>
                      ) : null}
                      {item.retrievedTables?.length ? (
                        <p>
                          <strong>Retrieved Tables:</strong> {item.retrievedTables.join(', ')}
                        </p>
                      ) : null}
                      <pre>{item.sql}</pre>
                    </details>
                  ))}
                </div>
              ) : null}

              <ThemeProvider mode="light" cssSelector=".openui-light-scope">
                <div className="widgets openui-light-scope">
                  {result.widgets.map((widget, index) => (
                    <article className="widget" key={`${widget.sql}-${index}`}>
                      <header>
                        <h3>{widget.title || `Widget ${index + 1}`}</h3>
                        {widget.category ? <span className="pill">{widget.category}</span> : null}
                      </header>
                      <p className="question">{widget.question}</p>
                      {widget.chartSchema ? (
                        <div className="chart-frame">
                          <VegaEmbed
                            spec={widget.chartSchema as any}
                            options={{ actions: false, renderer: 'svg' }}
                          />
                        </div>
                      ) : widget.openUiLang ? (
                        <div className="chart-frame">
                          <Renderer
                            library={openuiLibrary}
                            response={widget.openUiLang}
                            isStreaming={false}
                          />
                        </div>
                      ) : (
                        <p className="muted">No chart schema available for this widget.</p>
                      )}
                      {widget.dataPreview ? (
                        <details>
                          <summary>Data Preview</summary>
                          <pre>{JSON.stringify(widget.dataPreview, null, 2)}</pre>
                        </details>
                      ) : null}
                      {widget.openUiLang ? (
                        <details>
                          <summary>OpenUI Lang</summary>
                          <pre>{widget.openUiLang}</pre>
                        </details>
                      ) : null}
                      <details>
                        <summary>SQL</summary>
                        <pre>{widget.sql}</pre>
                      </details>
                    </article>
                  ))}
                </div>
              </ThemeProvider>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
