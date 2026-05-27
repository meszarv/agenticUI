import assert from 'node:assert/strict';

import { fetchMdlFromWrenApi } from '../src/mdl.ts';
import { loadRuntimeConfig, toWrenConnection } from '../src/runtimeConfig.ts';
import { generateDashboard, recommendQuestions } from '../src/wren.ts';

const run = async () => {
  const runtimeConfig = loadRuntimeConfig();
  const connection = toWrenConnection(runtimeConfig);
  const deployId = runtimeConfig.wren.deployId;

  let intent = process.env.GD_TEST_INTENT;
  let mdl = process.env.GD_TEST_MDL;
  if (!mdl) {
    try {
      const mdlResult = await fetchMdlFromWrenApi({
        graphqlUrl: runtimeConfig.wren.uiGraphqlUrl,
        hash: deployId,
      });
      mdl = mdlResult.mdl;
    } catch (error) {
      if (!intent) {
        throw new Error(
          `Could not fetch MDL from ${runtimeConfig.wren.uiGraphqlUrl}. ` +
            'Either run Wren UI GraphQL locally, or set GD_TEST_MDL / GD_TEST_INTENT explicitly. ' +
            `Original error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      mdl = 'model live_test {}';
    }
  }
  assert.equal(typeof mdl, 'string');
  assert.ok(mdl.length > 0, 'MDL should not be empty');

  if (!intent) {
    try {
      const recommendation = await recommendQuestions({
        connection,
        mdl,
        maxQuestions: 1,
        maxCategories: 1,
      });
      intent = recommendation.questions[0]?.question;
    } catch (error) {
      throw new Error(
        'Could not auto-discover an intent from recommendation API. ' +
          `Set GD_TEST_INTENT manually. Original error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  assert.equal(typeof intent, 'string');
  assert.ok(intent.length > 0, 'Intent should not be empty');

  const maxWidgets = Number(process.env.GD_TEST_MAX_WIDGETS || '1');
  if (!Number.isInteger(maxWidgets) || maxWidgets < 1) {
    throw new Error('GD_TEST_MAX_WIDGETS must be a positive integer');
  }
  const result = await generateDashboard({
    connection,
    deployId,
    intent,
    maxWidgets,
    mdl,
  });

  assert.equal(typeof result.ask.queryId, 'string');
  assert.ok(result.ask.queryId.length > 0, 'ask.queryId should not be empty');
  assert.ok(Array.isArray(result.widgets), 'widgets should be an array');
  assert.ok(result.widgets.length > 0, 'at least one widget should be returned');
  assert.ok(result.widgets.length <= maxWidgets, 'widget count should honor maxWidgets');
  assert.equal(typeof result.widgets[0].sql, 'string');
  assert.ok(result.widgets[0].sql.length > 0, 'first widget should contain SQL');

  console.log(`PASS: generateDashboard live test succeeded (intent: "${intent}")`);
};

run().catch((error) => {
  console.error('FAIL: generateDashboard live test failed');
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
