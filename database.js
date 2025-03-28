const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const schedule = require("node-schedule");

// ✅ Define database and backup paths with fallbacks
const dbPath = path.resolve(process.env.DB_PATH || "./database/tickets.db");
const backupDir = path.resolve(process.env.BACKUP_DIR || "./database/backups");

// ✅ Ensure backup directory exists
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

// ✅ Connect to the SQLite database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("❌ Database Connection Error:", err);
    process.exit(1); // Exit if the database connection fails
  } else {
    console.log("✅ Connected to the SQLite database.");
    db.run("PRAGMA foreign_keys = ON;"); // Enable foreign key constraints
  }
});

// ✅ Function to create a database backup
function backupDatabase() {
  vacuumDatabase((err) => {
    if (err) {
      console.error("❌ Backup aborted due to VACUUM failure:", err);
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `backup-${timestamp}.db`);

    fs.copyFile(dbPath, backupPath, (err) => {
      if (err) {
        console.error("❌ Database backup failed:", err);
      } else {
        console.log(`✅ Database backup created: ${backupPath}`);
      }
    });
  });
}

// ✅ Function to perform a VACUUM operation
function vacuumDatabase(callback) {
  db.run("VACUUM", (err) => {
    if (err) {
      console.error("❌ VACUUM operation failed:", err);
      callback(err);
    } else {
      console.log("✅ Database VACUUM completed.");
      callback();
    }
  });
}

// ✅ Function to check database integrity
function checkDatabaseIntegrity() {
  db.get("PRAGMA integrity_check", (err, row) => {
    if (err) {
      console.error("❌ Database integrity check failed:", err);
    } else if (row.integrity_check !== "ok") {
      console.warn("⚠️ Potential database corruption detected!", row);
    } else {
      console.log("✅ Database integrity check passed.");
    }
  });
}

// ✅ Function to delete old backups (older than 7 days)
async function deleteOldBackups() {
  try {
    const files = fs.readdirSync(backupDir);
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtimeMs > sevenDays) {
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error("❌ Failed to delete old backup:", err);
            } else {
              console.log(`🗑️ Deleted old backup: ${filePath}`);
            }
          });
        }
      })
    );
  } catch (error) {
    console.error("❌ Error cleaning up old backups:", error);
  }
}

// ✅ Function to initialize database tables
function initializeTables() {
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    //create ai_info table
    db.run(
      `CREATE TABLE IF NOT EXISTS ai_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        guild_id TEXT,
        ticket_id TEXT,
        prompt_length INTEGER,
        model_used TEXT,
        fallback_used BOOLEAN,
        tokens_estimated INTEGER,
        response_time_ms INTEGER,
        success BOOLEAN,
        error_message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      function (err) {
        if (err) {
          console.error("❌ Error creating 'ai_logs' table:", err);
        } else {
          console.log("✅ 'ai_logs' table created or already exists.");
        }
      }
    );

    // Create tickets table
    db.run(
      `CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        platform TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        claimed_by TEXT DEFAULT NULL,
        status TEXT DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_activity TEXT DEFAULT CURRENT_TIMESTAMP,
        last_reminder_sent TIMESTAMP DEFAULT NULL
      )`,
      function (err) {
        if (err) {
          console.error("❌ Error creating 'tickets' table:", err);
        } else {
          console.log("✅ 'tickets' table created or already exists.");
        }
      }
    );

    // Create ticket_users table
    db.run(
      `CREATE TABLE IF NOT EXISTS ticket_users (
        user_id TEXT PRIMARY KEY
      )`,
      function (err) {
        if (err) {
          console.error("❌ Error creating 'ticket_users' table:", err);
        } else {
          console.log("✅ 'ticket_users' table created or already exists.");
        }
      }
    );

    db.run(
      `CREATE TABLE IF NOT EXISTS ai_settings (
        guild_id TEXT PRIMARY KEY,
    
        ticket_ai_enabled BOOLEAN DEFAULT TRUE,
        ticket_ai_mode TEXT DEFAULT 'professional',
        ticket_ai_max_tokens INTEGER DEFAULT 50000,
    
        ai_chat_enabled BOOLEAN DEFAULT TRUE,
        ai_chat_mode TEXT DEFAULT 'casual',
        ai_chat_max_tokens INTEGER DEFAULT 2000,
    
        ignore_token_limit BOOLEAN DEFAULT FALSE
      )`,
      function (err) {
        if (err) {
          console.error("❌ Error creating 'ai_settings' table:", err);
        } else {
          console.log("✅ 'ai_settings' table created or already exists.");
        }
      }
    );

    // Create conversation_history table
    db.run(
      `CREATE TABLE IF NOT EXISTS conversation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_id TEXT
      )`,
      function (err) {
        if (err) {
          console.error("❌ Error creating 'conversation_history' table:", err);
        } else {
          console.log(
            "✅ 'conversation_history' table created or already exists."
          );
        }
      }
    );

    // Create ticket_platforms table
    db.run(
      `CREATE TABLE IF NOT EXISTS ticket_platforms (
        platform TEXT PRIMARY KEY,
        ticket_count INTEGER DEFAULT 0
      )`,
      function (err) {
        if (err) {
          console.error("❌ Error creating 'ticket_platforms' table:", err);
        } else {
          console.log("✅ 'ticket_platforms' table created or already exists.");
        }
      }
    );

    // Create blacklist table
    db.run(
      `CREATE TABLE IF NOT EXISTS blacklist (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        reason TEXT DEFAULT NULL
      )`,
      function (err) {
        if (err) {
          console.error("❌ Error creating 'blacklist' table:", err);
        } else {
          console.log("✅ 'blacklist' table created or already exists.");
        }
      }
    );

    // Create settings table
    db.run(
      `CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        ticket_creation_paused BOOLEAN DEFAULT 0
      )`,
      function (err) {
        if (err) {
          console.error("❌ Error creating 'settings' table:", err);
        } else {
          console.log("✅ 'settings' table created or already exists.");
        }
      }
    );

    // Create transcripts table
    db.run(
      `CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        ticket_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        closed_by TEXT NOT NULL,
        closed_by_username TEXT NOT NULL,
        closure_reason TEXT DEFAULT NULL,
        created_at TIMESTAMP NOT NULL,
        closed_at TIMESTAMP NOT NULL
      )`,
      function (err) {
        if (err) {
          console.error("❌ Error creating 'transcripts' table:", err);
        } else {
          console.log("✅ 'transcripts' table created or already exists.");
        }
      }
    );

    // Create transcript_messages table
    db.run(
      `CREATE TABLE IF NOT EXISTS transcript_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transcript_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        avatar_url TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        attachment_url TEXT DEFAULT NULL,
        embed_data TEXT DEFAULT NULL,
        reactions TEXT DEFAULT NULL,
        FOREIGN KEY (transcript_id) REFERENCES transcripts(id)
      )`,
      function (err) {
        if (err) {
          console.error("❌ Error creating 'transcript_messages' table:", err);
        } else {
          console.log(
            "✅ 'transcript_messages' table created or already exists."
          );
        }
      }
    );

    db.run("COMMIT");
  });
}

// ✅ Initialize tables
initializeTables();

// ✅ Schedule daily tasks
schedule.scheduleJob("0 2 * * *", () => {
  try {
    console.log("🔍 Running daily database integrity check...");
    checkDatabaseIntegrity();
  } catch (error) {
    console.error("❌ Error during integrity check:", error);
  }
});

schedule.scheduleJob("0 3 * * *", () => {
  try {
    console.log("⏳ Running scheduled database backup...");
    backupDatabase();
  } catch (error) {
    console.error("❌ Error during scheduled backup:", error);
  }
});

schedule.scheduleJob("0 4 * * *", () => {
  try {
    console.log("⏳ Running scheduled backup cleanup...");
    deleteOldBackups();
  } catch (error) {
    console.error("❌ Error during backup cleanup:", error);
  }
});

// Function to record a unique user (inserts only if not already present)
function addUniqueUser(userId, callback) {
  db.run(
    `INSERT OR IGNORE INTO ticket_users (user_id) VALUES (?)`,
    [userId],
    function (err) {
      if (err) {
        console.error("Error adding unique user:", err);
      }
      if (callback) callback(err);
    }
  );
}

// Function to increment the ticket count for a given platform
function incrementTicketPlatform(platform, callback) {
  db.run(
    `UPDATE ticket_platforms SET ticket_count = ticket_count + 1 WHERE platform = ?`,
    [platform],
    function (err) {
      if (err) {
        console.error("Error updating ticket platform:", err);
        if (callback) callback(err);
      } else if (this.changes === 0) {
        // No row updated, so insert new record
        db.run(
          `INSERT INTO ticket_platforms (platform, ticket_count) VALUES (?, 1)`,
          [platform],
          function (err) {
            if (err) {
              console.error("Error inserting ticket platform:", err);
            }
            if (callback) callback(err);
          }
        );
      } else {
        if (callback) callback(null);
      }
    }
  );
}

// (Optional) Function to retrieve stats for display or logging
function getStats(callback) {
  db.get(`SELECT COUNT(*) AS count FROM ticket_users`, (err, row) => {
    if (err) {
      return callback(err);
    }
    const uniqueUserCount = row.count;
    db.all(
      `SELECT platform, ticket_count FROM ticket_platforms`,
      (err, rows) => {
        if (err) {
          return callback(err);
        }
        callback(null, { uniqueUserCount, platformStats: rows });
      }
    );
  });
}

// ✅ Export modules
module.exports = {
  db,
  backupDatabase,
  deleteOldBackups,
  addUniqueUser,
  incrementTicketPlatform,
  getStats,
};
