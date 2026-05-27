/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('trace_query', (table) => {
    table.increments('id').primary();
    table.string('query_id', 64);
    table.text('question');
    table.string('source', 20).defaultTo('user');
    table.string('status', 20).defaultTo('success');
    table.integer('total_duration_ms').defaultTo(0);
    table.integer('total_prompt_tokens').defaultTo(0);
    table.integer('total_completion_tokens').defaultTo(0);
    table.timestamp('started_at');
    table.timestamp('finished_at');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('started_at', 'idx_trace_query_started');
    table.index('status', 'idx_trace_query_status');
    table.index('source', 'idx_trace_query_source');
  });

  await knex.schema.createTable('trace_step', (table) => {
    table.increments('id').primary();
    table
      .integer('trace_query_id')
      .references('id')
      .inTable('trace_query')
      .onDelete('CASCADE');
    table.integer('step_index').defaultTo(0);
    table.string('step_type', 40);
    table.string('model', 60);
    table.string('status', 20).defaultTo('success');
    table.integer('duration_ms').defaultTo(0);
    table.integer('prompt_tokens').defaultTo(0);
    table.integer('completion_tokens').defaultTo(0);
    table.integer('total_tokens').defaultTo(0);
    table.text('request');
    table.text('response');
    table.text('error');
    table.timestamp('started_at');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('step_type', 'idx_trace_step_type');
    table.index('trace_query_id', 'idx_trace_step_query');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('trace_step');
  await knex.schema.dropTableIfExists('trace_query');
};
