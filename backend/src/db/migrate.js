#!/usr/bin/env node
/**
 * Database migration runner.
 * Usage: node src/db/migrate.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./index.js');

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('[migrate] Connecting to database...');
  const client = await pool.connect();

  try {
    console.log('[migrate] Running schema...');
    await client.query(sql);
    console.log('[migrate] ✓ Schema applied successfully');
  } catch (err) {
    console.error('[migrate] ✗ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
