import { FormEvent, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { VegaEmbed } from 'react-vega';
import { Renderer } from '@openuidev/react-lang';
import { ThemeProvider, openuiLibrary } from '@openuidev/react-ui';
import { generateDashboard, getRuntimeConfig } from './api';
import { GenerateDashboardResponse, RuntimeAppConfig } from './types';

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

export default function App() {
  const [intent, setIntent] = useState('Show a health overview dashboard for network quality by region.');
  const [previousQuestionsText, setPreviousQuestionsText] = useState('');
  const [maxWidgets, setMaxWidgets] = useState(4);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeAppConfig | null>(null);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateDashboardResponse | null>(null);

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

    try {
      setBusy(true);
      setStatus('Generating dashboard widgets...');
      const dashboard = await generateDashboard({
        intent,
        previousQuestions,
        maxWidgets,
      });
      setResult(dashboard);
      setStatus(`Generated ${dashboard.widgets.length} widget(s).`);
    } catch (err) {
      setStatus('Dashboard generation failed.');
      setError(extractError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="hero">
        <h1>WrenAI Generative Dashboard Showcase</h1>
        <p>React UI runtime + WrenAI schema intelligence via API only</p>
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
            <button type="submit" disabled={busy}>
              {busy ? 'Generating...' : 'Generate Dashboard'}
            </button>
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
