const { Client, GatewayIntentBits, Collection, Events } = require("discord.js");
// ✅ Initialize Discord Bot
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
});
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const SQLiteStore = require("connect-sqlite3")(session);
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const flash = require("express-flash");
const passportDiscord = require("passport-discord").Strategy;
const cookieParser = require("cookie-parser");
const { exec } = require("child_process");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");
const { backupDatabase, deleteOldBackups } = require("./database");
const marked = require("marked");
const he = require("he");

// Remove all existing listeners for the interactionCreate event
client.removeAllListeners("interactionCreate");

// Load event files
const eventFiles = fs
  .readdirSync("./events")
  .filter((file) => file.endsWith(".js"));

for (const file of eventFiles) {
  const event = require(`./events/${file}`);
  console.log(`🟢 Loading event: ${event.name} from ${file}`);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client));
  } else {
    client.on(event.name, (...args) => event.execute(...args, client));
  }
}
const lockFile = "./bot.lock";

if (fs.existsSync(lockFile)) {
  console.error("❌ Another bot instance is already running. Exiting...");
  process.exit(1);
}

// Create the lock file
fs.writeFileSync(lockFile, process.pid.toString());

// Clean up the lock file on exit
process.on("exit", () => {
  if (fs.existsSync("./bot.lock")) {
    fs.unlinkSync("./bot.lock");
  }
});

process.on("SIGINT", () => process.exit());
process.on("SIGTERM", () => process.exit());

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection at:", reason);
  process.exit(1);
});

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  PermissionsBitField,
} = require("discord.js");

require("dotenv").config();

client.commands = new Collection();
client.buttons = new Collection();
client.modals = new Collection();

let isBotReady = false;
const readyPromise = new Promise((resolve) => {
  client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`✅ Connected to ${client.guilds.cache.size} servers`);
    isBotReady = true;
    resolve(true);
  });
});

client.isBotReady = () => isBotReady;

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // 🔍 Check if this is a ticket channel
  db.get(
    "SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'",
    [message.channel.id],
    async (err, ticket) => {
      if (err) {
        console.error("❌ Database error checking ticket:", err);
        return;
      }

      if (!ticket) return; // Not a valid ticket channel

      // ✅ Update last_activity timestamp
      db.run(
        "UPDATE tickets SET last_activity = ? WHERE channel_id = ?",
        [new Date().toISOString(), message.channel.id],
        (updateErr) => {
          if (updateErr) {
            console.error("❌ Error updating ticket activity:", updateErr);
          }
        }
      );

      // ✅ Rep detection
      const repWords = ["thank you", "thanks", "thx", "ty", "thanx", "thank"];
      const hasThankYou = repWords.some((word) =>
        message.content.toLowerCase().includes(word)
      );
      const hasMention = message.mentions.users.size > 0;

      if (hasThankYou && hasMention) {
        console.log("🔵 Detected possible rep message:", message.content);

        // Wait 10 seconds to check if another bot added rep reactions
        setTimeout(async () => {
          try {
            const updatedMessage = await message.channel.messages.fetch(
              message.id
            );

            if (
              updatedMessage.reactions.cache.has("👀") &&
              updatedMessage.reactions.cache.has("✅")
            ) {
              console.log("🟢 Confirmed rep message with reactions.");

              // Create "Undo Rep" button
              const undoRepButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`undo_rep_${message.id}`)
                  .setLabel("Undo Rep")
                  .setStyle(ButtonStyle.Danger)
              );

              // Ask user if rep was intentional
              await message.reply({
                content: `🔍 **Did you mean to give rep?** If not, click below to undo it.`,
                components: [undoRepButton],
              });
            }
          } catch (fetchError) {
            console.error(
              "❌ Error fetching message for rep check:",
              fetchError
            );
          }
        }, 10000);
      }
    }
  );
});

client.on(Events.GuildMemberRemove, async (member) => {
  try {
    console.log(`🔴 User ${member.user.tag} left the server.`);

    // Check if the user has an open ticket
    db.get(
      "SELECT * FROM tickets WHERE user_id = ? AND status = 'open'",
      [member.id],
      async (err, ticket) => {
        if (err) {
          console.error("❌ Database error checking open tickets:", err);
          return;
        }

        if (!ticket) {
          console.log(`✅ No open ticket found for ${member.user.tag}.`);
          return;
        }

        console.log(
          `⚠️ User ${member.user.tag} left with an open ticket. Closing it now.`
        );

        const guild = member.guild;
        const ticketChannel = guild.channels.cache.get(ticket.channel_id);

        if (!ticketChannel) {
          console.warn(
            `⚠️ Ticket channel ${ticket.channel_id} not found, skipping deletion.`
          );
        } else {
          // ✅ Fetch all messages before deletion
          let messages = [];
          try {
            messages = await fetchAllMessages(ticketChannel);
          } catch (fetchError) {
            console.error(
              "❌ Error fetching messages for transcript:",
              fetchError
            );
          }

          // ✅ Format transcript messages
          const formattedMessages = messages.map((msg) => ({
            user_id: msg.author.id,
            username: msg.author.username,
            avatar: msg.author.displayAvatarURL({ dynamic: true }),
            content:
              msg.content && msg.content.trim().length > 0
                ? msg.content
                : msg.attachments.size > 0
                ? "(Image/GIF attached)"
                : "(No content)",
            timestamp: msg.createdTimestamp,
            attachments:
              msg.attachments.size > 0
                ? JSON.stringify(msg.attachments.map((a) => a.proxyURL))
                : null,
            embeds:
              msg.embeds.length > 0
                ? JSON.stringify(msg.embeds.map((e) => e.toJSON()))
                : null,
            reactions:
              msg.reactions.cache.size > 0
                ? JSON.stringify(
                    msg.reactions.cache.map((r) => ({
                      emoji: r.emoji.name,
                      count: r.count,
                    }))
                  )
                : null,
          }));

          const transcriptId = `transcript_${Date.now()}`;

          // ✅ Save transcript in DB
          try {
            db.run(
              `INSERT INTO transcripts (id, ticket_id, user_id, username, closed_by, closed_by_username, closure_reason, created_at, closed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                transcriptId,
                ticket.id,
                ticket.user_id,
                ticket.username,
                "Auto-Closed (User Left)",
                "System",
                "User left the server.",
                ticket.created_at,
                new Date().toISOString(),
              ]
            );

            // ✅ Store messages in DB
            formattedMessages.forEach((msg) => {
              db.run(
                `INSERT INTO transcript_messages (transcript_id, user_id, username, avatar_url, message, timestamp, attachment_url, embed_data, reactions)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  transcriptId,
                  msg.user_id,
                  msg.username,
                  msg.avatar,
                  msg.content,
                  msg.timestamp,
                  msg.attachments,
                  msg.embeds,
                  msg.reactions,
                ]
              );
            });

            console.log(`📜 Transcript saved for ticket ${ticket.id}`);
          } catch (dbError) {
            console.error(
              "❌ Error inserting transcript into database:",
              dbError
            );
          }

          // ✅ Generate transcript URL
          const transcriptUrl = `${process.env.TRANSCRIPT_BASE_URL}/transcripts/${transcriptId}`;

          // ✅ Format timestamps
          const formatTimestamp = (isoString) =>
            `<t:${Math.floor(new Date(isoString).getTime() / 1000)}:F>`;

          // ✅ Create ticket closure embed
          const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle("🚨 Ticket Auto-Closed")
            .setDescription(
              `User **${member.user.tag}** (${member.id}) left the server while having an open ticket.`
            )
            .addFields(
              { name: "📄 Ticket ID", value: `${ticket.id}`, inline: true },
              {
                name: "✅ Opened By",
                value: `<@${ticket.user_id}>`,
                inline: true,
              },
              {
                name: "🔴 Closed By",
                value: "System (Auto-Close)",
                inline: true,
              },
              {
                name: "📝 Reason",
                value: "User left the server.",
                inline: false,
              },
              {
                name: "📅 Date Created",
                value: formatTimestamp(ticket.created_at),
                inline: true,
              },
              {
                name: "📅 Date Closed",
                value: formatTimestamp(new Date().toISOString()),
                inline: true,
              }
            );

          // ✅ Include "Claimed By" field if applicable
          if (ticket.claimed_by) {
            embed.addFields({
              name: "🎯 Claimed By",
              value: `<@${ticket.claimed_by}>`,
              inline: true,
            });
          }

          // ✅ Create "View Online Transcript" button
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel("📜 View Online Transcript")
              .setStyle(ButtonStyle.Link)
              .setURL(transcriptUrl)
          );

          // ✅ Send log to transcript channel
          const logChannel = guild.channels.cache.get(
            process.env.TRANSCRIPT_CHANNEL_ID
          );
          if (logChannel) {
            await logChannel.send({ embeds: [embed], components: [row] });
          } else {
            console.warn("⚠️ Transcript log channel not found.");
          }

          // ✅ Update DB & Delete Ticket
          ddb.run(
            `UPDATE tickets SET status = 'closed' WHERE id = ?`,
            [ticket.id],
            (err) => {
              if (err) {
                console.error(
                  `❌ Error updating ticket status in database for ticket ${ticket.id}:`,
                  err
                );
              } else {
                console.log(
                  `✅ Ticket ${ticket.id} status updated to 'closed'.`
                );
              }
            }
          );
          // Clear conversation history
          clearConversationHistory(ticket.id, (clearErr) => {
            if (clearErr) {
              console.error(
                "❌ Error clearing conversation history:",
                clearErr
              );
            }
          });
          db.run(`DELETE FROM tickets WHERE id = ?`, [ticket.id], (err) => {
            if (err) {
              console.error(
                `❌ Error deleting ticket ${ticket.id} from database:`,
                err
              );
            } else {
              console.log(`✅ Ticket ${ticket.id} deleted from database.`);
            }
          });

          // ✅ Delete ticket channel
          await ticketChannel.delete().catch((error) => {
            console.error("❌ Error deleting ticket channel:", error);
          });

          console.log(
            `✅ Ticket ${ticket.channel_id} closed due to user leaving the server.`
          );
        }
      }
    );
  } catch (error) {
    console.error("❌ Error handling guildMemberRemove event:", error);
  }
});

// ✅ Load Commands
const commandFiles = fs
  .readdirSync(path.join(__dirname, "commands"))
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
}
// ✅ Log in Bot
console.log("🔑 Logging in bot...");
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error("❌ Error logging in bot:", err);
});

// ✅ Initialize SQLite Database
const db = new sqlite3.Database("./database/tickets.db", (err) => {
  if (err) {
    console.error("❌ Database connection error:", err);
  } else {
    console.log("✅ Connected to SQLite database.");
  }
});

//port for server to run on
const PORT = 3000;

// ✅ Create a log file if it doesn't exist
const logFile = "bot.log";
if (!fs.existsSync(logFile)) {
  fs.writeFileSync(logFile, "Bot log initialized...\n");
}

// ✅ Initialize Express App
const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(flash());

//bot logs server and setup
const server = http.createServer(app);
const io = new Server(server);

// bot logs code
// ✅ WebSocket for Live Log Updates
io.on("connection", (socket) => {
  console.log("🟢 New client connected to bot logs.");
  socket.on("error", (error) => {
    console.error("❌ WebSocket error:", error);
  });

  // ✅ Send the entire log history when a client connects
  fs.readFile(logFile, "utf8", (err, data) => {
    if (!err && data) {
      const logLines = data.split("\n").filter((line) => line.trim() !== "");
      socket.emit("logHistory", logLines);
    }
  });

  // ✅ Send error log history separately
  fs.readFile("error.log", "utf8", (err, data) => {
    if (!err && data) {
      const errorLines = data.split("\n").filter((line) => line.trim() !== "");
      socket.emit("errorLogUpdate", errorLines);
    }
  });

  // ✅ Listen for manual log update requests
  socket.on("requestLogUpdate", () => {
    fs.readFile(logFile, "utf8", (err, data) => {
      if (!err && data) {
        const logLines = data.split("\n").filter((line) => line.trim() !== "");
        socket.emit("logUpdate", logLines);
      }
    });

    // ✅ Update error log as well
    fs.readFile("error.log", "utf8", (err, data) => {
      if (!err && data) {
        const errorLines = data
          .split("\n")
          .filter((line) => line.trim() !== "");
        socket.emit("errorLogUpdate", errorLines);
      }
    });
  });

  // ✅ Handle Client Disconnection
  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected from bot logs.");
  });
});

// ✅ Overriding `console.log` to also write to `bot.log`
const originalLog = console.log;
console.log = (...args) => {
  try {
    const message = `[${new Date().toLocaleString()}] ${args.join(" ")}`;
    fs.appendFileSync(logFile, message + "\n"); // Save to log file
    io.emit("logUpdate", message); // Send logs to frontend via WebSocket
  } catch (error) {
    originalLog("❌ Error writing to bot.log:", error);
  }
  originalLog(...args);
};

// ✅ Overriding `console.error` to also write to `error.log`
const originalError = console.error;
console.error = (...args) => {
  try {
    const message = `[${new Date().toLocaleString()}] ERROR: ${args.join(" ")}`;
    fs.appendFileSync("error.log", message + "\n"); // Save to error log file
    io.emit("errorLogUpdate", message); // Send errors to frontend
  } catch (error) {
    originalError("❌ Error writing to error.log:", error);
  }
  originalError(...args);
};

// ✅ Function to Log General Bot Events
function logToFile(message) {
  try {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFile(logFile, logMessage, (err) => {
      if (err) console.error("❌ Error writing to log file:", err);
    });

    // ✅ Send real-time log updates
    io.emit("logUpdate", logMessage);
  } catch (error) {
    console.error("❌ Failed to log event:", error);
  }
}

app.use(
  session({
    secret: process.env.SESSION_SECRET || "supersecret",
    resave: false,
    saveUninitialized: false,
    store: new SQLiteStore({ db: "sessions.db", dir: "./database" }),
    cookie: {
      secure: false, // ❌ `false` for local development; should be `true` in production with HTTPS
      httpOnly: true, // ✅ Prevents client-side JS access for security
      maxAge: 24 * 60 * 60 * 1000, // ✅ 1-day expiration
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// ✅ Middleware: Ensure Bot is Ready
app.use(async (req, res, next) => {
  if (!client.isBotReady()) {
    console.log("⏳ Waiting for bot to be ready before handling request...");
    await readyPromise;
  }
  next();
});

// ✅ OAuth Callback - Stores Access & Refresh Tokens
passport.use(
  new passportDiscord(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: "https://ticketbot.cc/auth/discord/callback",
      scope: ["identify", "guilds", "guilds.members.read"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        profile.accessToken = accessToken;
        profile.refreshToken = refreshToken;
        profile.expiresAt = Date.now() + 604800000; // ✅ Token valid for 7 days
        console.log("✅ OAuth User Authenticated:", profile.username);
        return done(null, profile);
      } catch (err) {
        console.error("❌ OAuth Error:", err);
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

// ✅ API route to trigger a manual backup
app.post("/backup", ensureAuthenticated, checkModeratorRole, (req, res) => {
  try {
    console.log("⏳ Manual database backup initiated...");
    backupDatabase();
    res.send("✅ Manual backup has been created!");
  } catch (error) {
    console.error("❌ Error in manual backup route:", error);
    res.status(500).send("An error occurred while backing up the database.");
  }
});

// ✅ Discord Login Route - Prevent Storing `/auth/discord` as Return URL
app.get(
  "/auth/discord",
  (req, res, next) => {
    try {
      const currentReturnTo = req.cookies.returnTo;

      // Prevent storing `/auth/discord` itself as returnTo to avoid infinite loop
      if (!currentReturnTo || currentReturnTo === "/auth/discord") {
        res.cookie("returnTo", req.originalUrl, { httpOnly: true });
        console.log("✅ Storing returnTo in cookie:", req.originalUrl);
      }
      next();
    } catch (error) {
      console.error("❌ Error in /auth/discord route:", error);
      res.redirect("/"); // Redirect to home if an error occurs
    }
  },
  passport.authenticate("discord")
);

// ✅ OAuth Callback - Prevent Loop & Clear Cookies on Error
app.get(
  "/auth/discord/callback",
  passport.authenticate("discord", { failureRedirect: "/" }),
  (req, res) => {
    try {
      console.log("✅ OAuth Callback: User Authenticated");

      // Ensure session is saved before redirecting
      req.session.save((err) => {
        if (err) {
          console.error("❌ Error saving session:", err);
          req.logout(() => {}); // Clear session to prevent loop
          res.clearCookie("returnTo");
          return res.redirect("/"); // Redirect to home to break the loop
        }

        // Read `returnTo` from cookie, default to `/tickets`
        let redirectTo = req.cookies.returnTo || "/tickets";

        // Prevent redirecting to `/auth/discord` in case of a loop
        if (redirectTo === "/auth/discord") {
          console.warn("⚠️ Detected potential redirect loop. Resetting...");
          redirectTo = "/dashboard"; // Fallback to a safe page
        }

        console.log("🚀 Redirecting user to:", redirectTo);
        res.clearCookie("returnTo"); // Remove the returnTo cookie after use
        res.redirect(redirectTo);
      });
    } catch (error) {
      console.error("❌ Error in /auth/discord/callback route:", error);
      req.logout(() => {}); // Ensure logout on failure
      res.clearCookie("returnTo");
      res.redirect("/"); // Redirect to a safe page
    }
  }
);

app.post("/restart", ensureAuthenticated, checkModeratorRole, (req, res) => {
  try {
    console.log("🔄 Received /restart request. Attempting to restart...");

    exec("pm2 restart ticketbot", (error, stdout, stderr) => {
      if (error) {
        console.error("❌ Error executing PM2 restart:", error);
        return res.status(500).send("Failed to restart via PM2.");
      }

      console.log("✅ PM2 Restart Command Executed.");
      console.log(`🖥️ STDOUT: ${stdout}`);
      console.log(`⚠️ STDERR: ${stderr}`);

      res.send("✅ Restarting via PM2...");
    });
  } catch (error) {
    console.error("❌ Unexpected error in /restart route:", error);
    res.status(500).send("Unexpected error while restarting the bot.");
  }
});

// 🔁 Redirect root to /dashboard
app.get("/", ensureAuthenticated, checkModeratorRole, (req, res) => {
  res.redirect("/dashboard");
});

// 🧠 Main dashboard route
app.get(
  "/dashboard",
  ensureAuthenticated,
  checkModeratorRole,
  async (req, res) => {
    try {
      await waitForBotReady(); // Ensures the bot is ready before proceeding
      const botUser = await client.user.fetch();
      const botAvatar = botUser.displayAvatarURL({ format: "png", size: 256 });
      const botName = botUser.username;

      // ✅ Fetch bot status
      const botStatus = {
        uptime: Math.floor(process.uptime()),
        serverCount: client.guilds.cache.size,
        userCount: client.users.cache.size,
        status: client.isReady() ? "🟢 Online" : "🔴 Offline",
      };

      // ✅ Fetch active ticket count
      const activeTickets = await new Promise((resolve, reject) => {
        db.get(
          "SELECT COUNT(*) as count FROM tickets WHERE status = 'open'",
          [],
          (err, row) => {
            if (err) reject(err);
            else resolve(row.count);
          }
        );
      });

      // ✅ Fetch recent transcripts
      const transcripts = await new Promise((resolve, reject) => {
        db.all(
          "SELECT * FROM transcripts ORDER BY closed_at DESC LIMIT 5",
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });

      res.render("dashboard", {
        botStatus,
        activeTickets,
        user: req.user,
        transcripts,
        botAvatar,
        botName,
      });
    } catch (error) {
      console.error("❌ Error loading dashboard:", error);
      res.redirect("/auth/discord");
    }
  }
);

//bot log view

// ✅ Bot Logs Route (WebSocket-based real-time logs)
app.get("/botlog", ensureAuthenticated, (req, res) => {
  try {
    fs.readFile(logFile, "utf8", (err, data) => {
      if (err) {
        console.error("❌ Error reading log file:", err);
        return res.status(500).send("Error loading bot logs.");
      }
      res.render("botlog", { logs: data.split("\n"), user: req.user });
    });
  } catch (error) {
    console.error("❌ Unexpected error loading bot logs:", error);
    res.status(500).send("Internal Server Error.");
  }
});

// ✅ Watch `bot.log` for changes and send updates via WebSocket
fs.watch(logFile, (eventType, filename) => {
  if (filename && eventType === "change") {
    try {
      fs.readFile(logFile, "utf8", (err, data) => {
        if (err) {
          console.error("❌ Error reading bot.log:", err);
          return;
        }
        io.emit("logUpdate", data); // Send log updates to connected clients
      });
    } catch (error) {
      console.error("❌ Unexpected error in log watcher:", error);
    }
  }
});

//fake error test
setTimeout(() => {
  console.error(
    "❌ Test Error: This is a fake error to test the error log system!"
  );
}, 5000);

// View List of Transcripts with Correct Numbering
app.get(
  "/transcripts",
  ensureAuthenticated,
  checkModeratorRole,
  async (req, res) => {
    try {
      if (!req.user) {
        console.error("❌ No user found in session.");
        return res.status(403).send("Forbidden: Not authenticated.");
      }

      console.log("🟢 Loading transcripts for user:", req.user.username);

      const page = parseInt(req.query.page) || 1;
      const limit = 25;
      const offset = (page - 1) * limit;

      const totalTranscripts = await new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) as count FROM transcripts", [], (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });

      const transcripts = await new Promise((resolve, reject) => {
        db.all(
          "SELECT id, username, closed_by_username, closed_at FROM transcripts ORDER BY closed_at DESC LIMIT ? OFFSET ?",
          [limit, offset],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });

      transcripts.forEach((transcript, index) => {
        transcript.number = totalTranscripts - offset - index;
      });

      res.render("transcripts", {
        transcripts,
        page,
        totalPages: Math.ceil(totalTranscripts / limit),
        user: req.user, // Ensure the user object is passed
      });
    } catch (error) {
      console.error("❌ Unexpected error in transcripts route:", error);
      res.status(500).send("Error loading transcripts.");
    }
  }
);

// ✅ Delete Transcript Route
app.delete(
  "/transcripts/:id",
  ensureAuthenticated,
  checkModeratorRole,
  async (req, res) => {
    try {
      const transcriptId = req.params.id;
      console.log(`🗑️ Attempting to delete transcript ID: "${transcriptId}"`);

      // Verify if transcript exists
      db.get(
        "SELECT * FROM transcripts WHERE id = ?",
        [transcriptId],
        (err, row) => {
          if (err) {
            console.error("❌ Database error checking transcript:", err);
            return res.status(500).send("Database error.");
          }
          if (!row) {
            console.error("❌ Transcript not found:", transcriptId);
            return res.status(404).send("Transcript not found.");
          }

          console.log(
            `✅ Transcript found, proceeding with deletion: "${transcriptId}"`
          );

          // Delete related messages first
          db.run(
            "DELETE FROM transcript_messages WHERE transcript_id = ?",
            [transcriptId],
            function (err) {
              if (err) {
                console.error("❌ Error deleting transcript messages:", err);
                return res
                  .status(500)
                  .send("Failed to delete transcript messages.");
              }

              // Delete transcript itself
              db.run(
                "DELETE FROM transcripts WHERE id = ?",
                [transcriptId],
                function (err) {
                  if (err) {
                    console.error("❌ Error deleting transcript:", err);
                    return res.status(500).send("Failed to delete transcript.");
                  }

                  console.log(
                    `✅ Successfully deleted transcript ID: "${transcriptId}"`
                  );
                  res.sendStatus(200);
                }
              );
            }
          );
        }
      );
    } catch (error) {
      console.error("❌ Unexpected error deleting transcript:", error);
      res.status(500).send("Failed to delete transcript.");
    }
  }
);

// ✅ View Individual Transcript
app.get("/transcripts/:id", async (req, res) => {
  try {
    const transcriptId = req.params.id;

    // Fetch transcript metadata
    const transcript = await new Promise((resolve, reject) => {
      db.get(
        "SELECT * FROM transcripts WHERE id = ?",
        [transcriptId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!transcript) {
      return res.status(404).send("Transcript not found");
    }

    // Fetch messages
    const messages = await new Promise((resolve, reject) => {
      db.all(
        "SELECT * FROM transcript_messages WHERE transcript_id = ? ORDER BY timestamp ASC",
        [transcriptId],
        (err, rows) => {
          if (err) reject(err);
          else {
            // Decode HTML entities before passing to EJS
            rows.forEach((row) => {
              row.message = he.decode(row.message);
            });
            resolve(rows);
          }
        }
      );
    });

    res.render("transcript", { transcript, messages, marked, he }); // Pass `he` to EJS
  } catch (error) {
    console.error("❌ Error fetching transcript:", error);
    res.status(500).send("Server error");
  }
});

// ✅ Secure Tickets Dashboard View
app.get(
  "/tickets",
  ensureAuthenticated,
  checkModeratorRole,
  async (req, res) => {
    try {
      db.all(
        "SELECT * FROM tickets WHERE status = 'open'",
        [],
        (err, tickets) => {
          if (err) {
            console.error("❌ Database error fetching tickets:", err);
            return res.status(500).send("Internal Server Error.");
          }

          // ✅ Ensure `user` is always defined before rendering
          res.render("tickets", { tickets, user: req.user || {} });
        }
      );
    } catch (error) {
      console.error("❌ Unexpected error in tickets route:", error);
      res.status(500).send("Internal Server Error.");
    }
  }
);

// ✅ Logout Route
app.get("/logout", (req, res) => {
  try {
    req.logout((err) => {
      if (err) {
        console.error("❌ Error during logout:", err);
        return res.status(500).send("Error logging out. Please try again.");
      }
      res.redirect("/");
    });
  } catch (error) {
    console.error("❌ Unexpected error in logout route:", error);
    res.status(500).send("Internal Server Error: Logout failed.");
  }
});

// ✅ Start Server After Bot is Ready (with WebSockets)
(async () => {
  try {
    console.log("⏳ Waiting for bot to be ready...");
    await readyPromise;

    server.listen(PORT, "0.0.0.0", () => {
      console.log(
        `🚀 Web dashboard running with WebSockets on http://0.0.0.0:${PORT}`
      );
    });
  } catch (error) {
    console.error("❌ Error starting server:", error);
    process.exit(1); // ✅ Exit the process if the server fails to start
  }
})();

// ✅ Route: Force Close Ticket from ticket dashboard
app.post("/close/:id", async (req, res) => {
  try {
    const ticketId = req.params.id;
    const user = req.user;

    // Fetch ticket details
    db.get(
      "SELECT * FROM tickets WHERE id = ?",
      [ticketId],
      async (err, ticket) => {
        try {
          if (err || !ticket) {
            return res.status(404).json({ message: "Ticket not found." });
          }

          // 🟢 Ensure the client and guild are available
          const guild = client.guilds.cache.get(process.env.GUILD_ID);
          if (!guild) {
            console.error(
              "❌ Guild not found! Is the bot connected to the server?"
            );
            return res
              .status(500)
              .json({ message: "Bot is not connected to the Discord server." });
          }

          // 🟢 Ensure the ticket channel exists before proceeding
          const ticketChannel = guild.channels.cache.get(ticket.channel_id);
          if (!ticketChannel) {
            console.warn("⚠️ Ticket channel not found, skipping deletion.");
          } else {
            try {
              // ✅ Generate transcript (Fetch last 1000 messages)
              try {
                const messages = await fetchAllMessages(ticketChannel);
              } catch (error) {
                console.error("❌ Error fetching messages:", error);
              }

              // ✅ Process & format messages correctly
              const formattedMessages = messages
                .map((msg) => ({
                  user_id: msg.author.id,
                  username: msg.author.username,
                  avatar: msg.author.displayAvatarURL({ dynamic: true }),
                  content: msg.content?.trim().length
                    ? msg.content
                    : msg.attachments.size > 0
                    ? "(Image/GIF attached)"
                    : "(No content)",
                  timestamp: msg.createdTimestamp,
                  attachments:
                    msg.attachments.size > 0
                      ? JSON.stringify(msg.attachments.map((a) => a.proxyURL))
                      : null,
                  embeds:
                    msg.embeds.length > 0
                      ? JSON.stringify(msg.embeds.map((e) => e.toJSON()))
                      : null,
                  reactions:
                    msg.reactions.cache.size > 0
                      ? JSON.stringify(
                          msg.reactions.cache.map((r) => ({
                            emoji: r.emoji.name,
                            count: r.count,
                          }))
                        )
                      : null,
                }))
                .reverse(); // Reverse order to keep chronological order

              // ✅ Generate a unique transcript ID
              const transcriptId = `transcript_${Date.now()}`;

              // ✅ Save transcript metadata in the database
              db.run(
                `INSERT INTO transcripts (id, ticket_id, user_id, username, closed_by, closed_by_username, closure_reason, created_at, closed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  transcriptId,
                  ticket.id,
                  ticket.user_id,
                  ticket.username,
                  "Admin",
                  "Force closed by admin",
                  "Forced closure via dashboard",
                  ticket.created_at,
                  new Date().toISOString(),
                ],
                function (err) {
                  if (err) console.error("❌ Error inserting transcript:", err);
                  else {
                    console.log(
                      "✅ Transcript created, now storing messages..."
                    );

                    // ✅ Store each message separately
                    formattedMessages.forEach((msg) => {
                      db.run(
                        `INSERT INTO transcript_messages (transcript_id, user_id, username, avatar_url, message, timestamp, attachment_url, embed_data, reactions)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                          transcriptId,
                          msg.user_id,
                          msg.username,
                          msg.avatar,
                          msg.content,
                          msg.timestamp,
                          msg.attachments,
                          msg.embeds,
                          msg.reactions,
                        ],
                        (err) => {
                          if (err)
                            console.error("❌ Error saving message:", err);
                        }
                      );
                    });
                  }
                }
              );

              // ✅ Send transcript link to logs channel
              const logChannel = guild.channels.cache.get(
                process.env.TRANSCRIPT_CHANNEL_ID
              );
              if (logChannel) {
                try {
                  const transcriptUrl = `${process.env.TRANSCRIPT_BASE_URL}/transcripts/${transcriptId}`;
                  await logChannel.send({
                    embeds: [
                      new EmbedBuilder()
                        .setColor(0xff0000)
                        .setTitle("⚠️ Ticket Force Closed")
                        .addFields(
                          {
                            name: "📄 Ticket ID",
                            value: `${ticket.id}`,
                            inline: true,
                          },
                          {
                            name: "✅ Opened By",
                            value: `<@${ticket.user_id}>`,
                            inline: true,
                          },
                          {
                            name: "🔴 Closed By",
                            value: "Admin (Forced Close)",
                            inline: true,
                          },
                          {
                            name: "📝 Reason",
                            value: "Forced closure via dashboard",
                            inline: false,
                          },
                          {
                            name: "📅 Date Created",
                            value: `<t:${Math.floor(
                              new Date(ticket.created_at).getTime() / 1000
                            )}:F>`,
                            inline: true,
                          },
                          {
                            name: "📅 Date Closed",
                            value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                            inline: true,
                          }
                        ),
                    ],
                    components: [
                      new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                          .setLabel("View Transcript")
                          .setStyle(ButtonStyle.Link)
                          .setURL(transcriptUrl)
                      ),
                    ],
                  });
                } catch (logError) {
                  console.error("❌ Error sending transcript log:", logError);
                }
              }

              // ✅ Delete the ticket channel
              await ticketChannel.delete();
            } catch (error) {
              console.error("❌ Error processing forced closure:", error);
              return res
                .status(500)
                .json({ message: "Failed to close ticket properly." });
            }
          }

          // ✅ Mark ticket as closed in the database
          // Clear conversation history
          clearConversationHistory(ticket.id, (clearErr) => {
            if (clearErr) {
              console.error(
                "❌ Error clearing conversation history:",
                clearErr
              );
            }
          });
          db.run(
            "UPDATE tickets SET status = 'closed' WHERE id = ?",
            [ticketId],
            (updateErr) => {
              if (updateErr) {
                console.error("❌ Error updating ticket status:", updateErr);
                return res
                  .status(500)
                  .json({ message: "Failed to update ticket status." });
              }
              res.json({ message: "Ticket closed successfully." });
            }
          );
        } catch (dbError) {
          console.error("❌ Database Error:", dbError);
          return res.status(500).json({
            message: "Internal Server Error while closing the ticket.",
          });
        }
      }
    );
  } catch (error) {
    console.error("❌ Unexpected error in force-close route:", error);
    return res.status(500).json({ message: "Internal Server Error." });
  }
});

//helper functions

async function checkIdleTickets() {
  const THIRTY_MINUTES = 30 * 60 * 1000; // 30 minutes in milliseconds
  const now = Date.now();

  db.all(
    "SELECT * FROM tickets WHERE status = 'open'",
    async (err, tickets) => {
      if (err) {
        console.error("❌ Error fetching open tickets:", err);
        return;
      }

      for (const ticket of tickets) {
        const lastActivity = new Date(ticket.last_activity).getTime();
        const lastReminderSent = ticket.last_reminder_sent
          ? new Date(ticket.last_reminder_sent).getTime()
          : 0;

        // Check if the ticket has been idle for 30 minutes AND no reminder has been sent in the last 30 minutes
        if (
          now - lastActivity >= THIRTY_MINUTES &&
          now - lastReminderSent >= THIRTY_MINUTES
        ) {
          try {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const channel = guild.channels.cache.get(ticket.channel_id);
            if (!channel) {
              console.warn(`⚠️ Ticket channel ${ticket.channel_id} not found.`);
              continue;
            }

            // Send the reminder message
            await channel.send({
              content: `<@${ticket.user_id}> Are you still needing help? If you still need help please let the helpers know so they don't close this ticket for inactivity. Apologies for the wait but ticket help can be slow during certain time periods. If you no longer need help, please let the helpers know and we'll close it for you - thanks!.`,
            });

            console.log(
              `🔔 Sent idle reminder to ticket: ${ticket.channel_id}`
            );

            // Update the last_reminder_sent timestamp in the database
            db.run(
              "UPDATE tickets SET last_reminder_sent = ? WHERE id = ?",
              [new Date().toISOString(), ticket.id],
              (err) => {
                if (err) {
                  console.error("❌ Error updating last_reminder_sent:", err);
                }
              }
            );
          } catch (error) {
            console.error(`❌ Error sending idle ticket reminder:`, error);
          }
        }
      }
    }
  );
}

// Run the check every 5 minutes
setInterval(checkIdleTickets, 5 * 60 * 1000);

// ✅ Fetch All Messages from a Channel
async function fetchAllMessages(channel) {
  try {
    let messages = [];
    let lastMessageId = null;

    while (true) {
      try {
        // ✅ Fetch messages in batches of 100 (Discord limit)
        const fetchedMessages = await channel.messages.fetch({
          limit: 100,
          ...(lastMessageId && { before: lastMessageId }),
        });

        if (fetchedMessages.size === 0) break; // ✅ Stop if no more messages
        messages.push(...fetchedMessages.values());
        lastMessageId = fetchedMessages.last()?.id; // ✅ Prevents possible errors if last() is null
      } catch (fetchError) {
        console.error("❌ Error fetching messages from channel:", fetchError);
        break; // Stop fetching on error to avoid infinite loops
      }
    }

    return messages.reverse(); // ✅ Ensure chronological order
  } catch (error) {
    console.error("❌ Critical error in fetchAllMessages function:", error);
    return []; // ✅ Return empty array to prevent breaking other logic
  }
}

// ✅ Ensure User is Authenticated (Middleware)
function ensureAuthenticated(req, res, next) {
  try {
    console.log("🔍 Checking Authentication:", req.isAuthenticated());

    if (req.isAuthenticated()) {
      return next();
    }

    // Prevent storing `/auth/discord` itself as returnTo to avoid infinite loop
    if (req.originalUrl !== "/auth/discord") {
      res.cookie("returnTo", req.originalUrl, { httpOnly: true });
      console.log("✅ Storing returnTo in cookie:", req.originalUrl);
    }

    res.redirect("/auth/discord");
  } catch (error) {
    console.error("❌ Error in authentication middleware:", error);
    res.status(500).send("Internal Server Error: Authentication failed.");
  }
}

// ✅ Function to Refresh Expired Tokens (with error handling)
async function refreshDiscordTokenIfNeeded(user) {
  try {
    if (!user.expiresAt || Date.now() < user.expiresAt) {
      return null; // Token is still valid
    }

    console.log("🔄 Refreshing Discord OAuth token...");

    const params = new URLSearchParams();
    params.append("client_id", process.env.DISCORD_CLIENT_ID);
    params.append("client_secret", process.env.DISCORD_CLIENT_SECRET);
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", user.refreshToken);

    const response = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Failed to refresh token:", errorText);
      return null;
    }

    const tokenData = await response.json();

    // ✅ Update session with new token
    user.accessToken = tokenData.access_token;
    user.refreshToken = tokenData.refresh_token;
    user.expiresAt = Date.now() + tokenData.expires_in * 1000;

    console.log("✅ Token successfully refreshed!");
    return user.accessToken;
  } catch (error) {
    console.error("❌ Error in refreshDiscordTokenIfNeeded:", error);
    return null;
  }
}

// Middleware: Fetch and Validate User Roles
async function checkModeratorRole(req, res, next) {
  try {
    const user = req.user;

    if (!user || !user.accessToken) {
      console.warn(
        "⚠️ User session missing or expired, redirecting to login..."
      );
      req.logout(() => {}); // Ensure logout before redirect
      return res.redirect("/auth/discord");
    }

    // ✅ Attempt to refresh token if expired
    const newAccessToken = await refreshDiscordTokenIfNeeded(user);
    if (newAccessToken) {
      user.accessToken = newAccessToken;
    }

    // ✅ Fetch user's guild membership
    const guildResponse = await fetch(
      `https://discord.com/api/v10/users/@me/guilds/${process.env.GUILD_ID}/member`,
      {
        headers: { Authorization: `Bearer ${user.accessToken}` },
      }
    );

    if (!guildResponse.ok) {
      console.warn(
        "⚠️ Failed to verify Discord membership. Skipping moderator check."
      );
      return next(); // Instead of redirecting, continue without moderator privileges
    }

    const guildMember = await guildResponse.json();
    const userRoles = guildMember.roles || [];

    if (!userRoles.includes(process.env.TICKET_MODERATOR_ROLE)) {
      console.warn("⚠️ User does not have moderator role. Access denied.");
      return res.status(403).send("Forbidden: You do not have access.");
    }

    next();
  } catch (error) {
    console.error("❌ Error checking moderator role:", error);
    return next(); // Prevent redirect loop
  }
}

// ✅ Wait for Bot to Be Ready
async function waitForBotReady() {
  try {
    if (client.isReady()) return true; // ✅ If already ready, return immediately

    console.log("⏳ Waiting for bot to be ready...");
    await readyPromise; // ✅ Waits for `client.js` to confirm bot readiness
    console.log("✅ Bot is now ready!");
    return true;
  } catch (error) {
    console.error("❌ Error waiting for bot to be ready:", error);
    return false; // Return false in case of failure
  }
}

// ✅ Log errors
client.on("error", (error) => logToFile(`❌ Bot error: ${error}`));
