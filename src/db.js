// src/db.js
const knex = require('knex');
const path = require('path');
const fs = require('fs');

let db = null; // Initialize db as null

try {
  let dbConnectionConfig;

  if (process.env.DATABASE_URL) {
    console.log("DATABASE_URL detected. Configuring for PostgreSQL...");
    dbConnectionConfig = {
      client: 'pg',
      connection: {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      },
    };
    db = knex(dbConnectionConfig);
  } else if (process.env.SPACE_ID) {
    console.log("Hugging Face environment detected. Configuring for SQLite...");
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir);
    }
    const defaultDbPath = path.join(dataDir, 'aiolists.sqlite');
    
    dbConnectionConfig = {
      client: 'sqlite3',
      connection: {
        filename: defaultDbPath
      },
      useNullAsDefault: true
    };
    db = knex(dbConnectionConfig);
  } else {
    console.log("No DATABASE_URL or Hugging Face environment detected. Addon will run in non-database mode.");
  }
} catch (error) {
    console.error("Failed to initialize knex configuration:", error.message);
    db = null; // Ensure db is null if knex fails to initialize
}

async function setupDatabase() {
  if (!db) {
    return;
  }

  try {
    await db.raw('select 1');
    console.log("Database connection successful.");

    const hasTable = await db.schema.hasTable('users');
    if (!hasTable) {
      console.log("Creating 'users' table...");
      await db.schema.createTable('users', table => {
        table.string('uuid').primary();
        table.string('trakt_access_token').notNullable();
        table.string('trakt_refresh_token').notNullable();
        table.bigInteger('trakt_expires_at').notNullable();
      });
    }
  } catch (error) {
    console.error("DATABASE_SETUP_FAILED:", error.message);
    console.warn("The addon will revert to non-database mode.");
    db = null; // Nullify db on setup failure
  }
}

module.exports = { db, setupDatabase };