const axios = require("axios");
const { Events } = require("discord.js");
const { db } = require("../database");

const cooldowns = new Map();
const apiRateLimiter = new Map(); // Track API call timestamps

// Function to format responses
function formatResponse(content) {
  // Use Markdown for structured responses
  const formattedContent = content
    .replace(/### (.*)/g, "**$1**") // Bold headings
    .replace(/- (.*)/g, "• $1"); // Bullet points

  return formattedContent;
}

// Function to check if a message is relevant
function isRelevant(content) {
  // Implement logic to determine relevance
  return !content.includes("irrelevant keyword");
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    const client = message.client;

    try {
      if (message.author.bot) return;

      console.log("🟢 Message received from:", message.author.username);

      // Only proceed if it's a reply to the bot or a mention
      const isReplyToBot =
        message.reference &&
        (await message.channel.messages
          .fetch(message.reference.messageId)
          .then((msg) => msg.author.id === client.user.id)
          .catch(() => false));

      const isMentioningBot = message.mentions.has(message.client.user.id);

      if (!isReplyToBot && !isMentioningBot) {
        console.log("🔴 Not a bot reply or mention.");
        return;
      }

      // ✅ Already validated it's a relevant AI message, now check DB and channel
      db.get(
        "SELECT ai_enabled FROM ai_settings WHERE guild_id = ?",
        [message.guild.id],
        async (err, settings) => {
          if (err) {
            console.error("❌ DB error checking AI settings:", err);
            return;
          }

          console.log("🔍 AI settings:", settings);

          if (settings && !settings.ai_enabled) {
            console.log("🔴 AI is disabled for this guild.");
            return;
          }

          const isAllowedAIChannel =
            message.channel.id === process.env.AI_CHAT_CHANNEL_ID;

          db.get(
            "SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'",
            [message.channel.id],
            async (err, ticket) => {
              if (err) {
                console.error(
                  "❌ DB error checking ticket for AI response:",
                  err
                );
                return;
              }

              const isValidTicket = Boolean(ticket);
              if (!isAllowedAIChannel && !isValidTicket) {
                console.log(
                  "🔴 Message is not in a valid ticket or AI channel."
                );
                return;
              }

              console.log("🟢 Valid AI interaction channel detected.");

              // **Cooldown: 10 seconds per user**
              const cooldownKey = `${message.author.id}`;
              const lastUsed = cooldowns.get(cooldownKey);
              const now = Date.now();

              if (lastUsed && now - lastUsed < 10_000) {
                console.log(`⏳ Cooldown active for ${cooldownKey}`);
                await message.reply(
                  "⏳ Please wait a moment before asking another question."
                );
                return;
              }
              cooldowns.set(cooldownKey, now);

              // **API Rate Limiting: 5 seconds between API calls**
              const lastApiCall = apiRateLimiter.get("global");
              if (lastApiCall && now - lastApiCall < 5000) {
                await message.reply(
                  "⚠️ The AI is processing too many requests. Please wait a moment."
                );
                return;
              }
              apiRateLimiter.set("global", now);

              // ✅ Send an immediate "thinking" message
              const thinkingMessage = await message.reply({
                content: "💭 Thinking...",
              });

              // Fetch AI settings
              db.get(
                "SELECT ai_mode, max_tokens FROM ai_settings WHERE guild_id = ?",
                [message.guild.id],
                async (settingsErr, settings) => {
                  if (settingsErr) {
                    console.error(
                      "❌ Error fetching AI settings:",
                      settingsErr
                    );
                    await thinkingMessage.edit(
                      "⚠️ An error occurred while fetching AI settings."
                    );
                    return;
                  }

                  const aiMode = settings?.ai_mode || "casual";
                  const ignoreTokenLimit =
                    settings?.ignore_token_limit || false;
                  const maxTokens = ignoreTokenLimit
                    ? null
                    : settings?.max_tokens || 50000;

                  console.log("🟢 AI Mode:", aiMode);

                  // Define AI personality prompts
                  const aiPrompts = {
                    professional:
                      "You are a helpful and professional assistant in a Discord server dedicated to Elden Ring. Please try to prioritize up to date information consistent with the latest game patch. Your primary role is to provide concise and clear advice for defeating bosses, navigating areas, and solving challenges in the game. Do not provide explanations, rationales, or meta-commentary about your response. Just provide the answer or advice directly. If the question is unrelated to Elden Ring, respond appropriately.",
                    casual:
                      "You're a friendly and casual bot in a Discord server for Elden Ring players. Please try to prioritize up to date information consistent with the latest game patch. Your main job is to help users with boss strategies, area navigation, and game tips. Keep your responses engaging and fun! Do not provide explanations, rationales, or meta-commentary about your response. Just provide the answer or advice directly. If the question is unrelated to Elden Ring, keep it light and fun but still answer the questions!",
                    meme: "You're a meme-loving jokester in an Elden Ring Discord server. Please try to prioritize up to date information consistent with the latest game patch. Your goal is to help users with boss fights, area tips, and game challenges, but make it funny and relevant! Do not provide explanations, rationales, or meta-commentary about your response. Just provide the answer or advice directly, but feel free to sprinkle in some humor. If the question is unrelated to Elden Ring, respond appropriately but with a meme or joke!",
                    strict:
                      "You are a strict, no-nonsense assistant in an Elden Ring Discord server. Please try to prioritize up to date information consistent with the latest game patch. Your focus is on providing precise, to-the-point advice for defeating bosses, navigating areas, and overcoming challenges in the game. Do not provide explanations, rationales, or meta-commentary about your response. Just provide the answer or advice directly. If the question is unrelated to Elden Ring, respond politely and move on.",
                    unrestricted: "",
                  };

                  const personality =
                    aiPrompts[aiMode] || aiPrompts.professional;

                  let prompt = message.content.replace(/<@!?(\d+)>/, "").trim();
                  if (isReplyToBot) {
                    const repliedTo = await message.channel.messages.fetch(
                      message.reference.messageId
                    );
                    prompt = `Replying to: "${repliedTo.content}"\n\nUser: ${prompt}`;
                  }

                  if (!prompt) {
                    console.log("🔴 No prompt found.");
                    return;
                  }

                  console.log("🟢 Prompt:", prompt);

                  //ai health tracking variables
                  const modelUsedPrimary = "deepseek/deepseek-r1:free";
                  const modelUsedFallback = "deepseek/deepseek-chat:free";
                  const fallbackUsed = false;
                  const promptLength = prompt.length;
                  const estimatedTokens = Math.round(promptLength / 4);
                  const startTime = Date.now();

                  // Fetch conversation history for this ticket with relevance filtering
                  const history = await new Promise((resolve, reject) => {
                    db.all(
                      "SELECT role, content FROM conversation_history WHERE ticket_id = ? ORDER BY timestamp DESC LIMIT 10",
                      [ticket.id],
                      (err, rows) => {
                        if (err) reject(err);
                        else {
                          // Filter out irrelevant messages
                          const relevantHistory = rows.filter((row) =>
                            isRelevant(row.content)
                          );
                          resolve(relevantHistory.reverse()); // Reverse to maintain chronological order
                        }
                      }
                    );
                  });

                  console.log("🟢 Conversation history:", history);

                  // Add the current prompt to the history
                  db.run(
                    "INSERT INTO conversation_history (ticket_id, role, content) VALUES (?, ?, ?)",
                    [ticket.id, "user", prompt]
                  );

                  try {
                    // Call OpenRouter AI
                    const apiStart = Date.now();
                    const response = await axios.post(
                      "https://openrouter.ai/api/v1/chat/completions",
                      {
                        model: modelUsedPrimary,
                        messages: [
                          { role: "system", content: personality },
                          ...history, // Include conversation history
                          { role: "user", content: prompt },
                        ],
                        max_tokens: maxTokens,
                      },
                      {
                        headers: {
                          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                          "HTTP-Referer": "http://localhost",
                          "X-Title": "TicketBot",
                        },
                        timeout: 10000, // 10-second timeout
                      }
                    );

                    const reply = response.data.choices[0].message.content;
                    const responseTime = Date.now() - apiStart;
                    // Check if the response is empty or invalid
                    if (!reply || reply.trim().length === 0) {
                      console.error("❌ AI returned an empty response.");
                      await thinkingMessage.edit(
                        "⚠️ The AI couldn't generate a response. Please try again."
                      );
                      return;
                    }

                    // Format the response
                    const formattedReply = formatResponse(reply);

                    // Truncate the formatted response to 2000 characters
                    const truncatedReply =
                      formattedReply.length > 2000
                        ? formattedReply.slice(0, 1997) + "..."
                        : formattedReply;

                    // Add the AI's response to the history
                    db.run(
                      "INSERT INTO conversation_history (ticket_id, role, content) VALUES (?, ?, ?)",
                      [ticket.id, "assistant", truncatedReply]
                    );

                    // ✅ Edit the "thinking" message with the formatted response
                    return await thinkingMessage.edit({
                      content: truncatedReply,
                    });
                    db.run(
                      `INSERT INTO ai_logs (
                        user_id, guild_id, ticket_id, prompt_length, model_used,
                        fallback_used, tokens_estimated, response_time_ms, success, error_message
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                      [
                        message.author.id,
                        message.guild.id,
                        ticket.id,
                        promptLength,
                        modelUsedPrimary,
                        false,
                        estimatedTokens,
                        responseTime,
                        true,
                        null,
                      ],
                      (err) => {
                        if (err) {
                          console.error(
                            "❌ Failed to insert AI log:",
                            err.message
                          );
                          // You can optionally log this to a separate fallback log table if needed.
                        }
                      }
                    );
                  } catch (apiError) {
                    console.error("❌ OpenRouter API error:", apiError);
                    if (apiError.response) {
                      console.error(
                        "❌ API response data:",
                        apiError.response.data
                      );
                      console.error(
                        "❌ API response status:",
                        apiError.response.status
                      );
                    }
                    const fallbackStart = Date.now();
                    // **Fallback to DeepSeek Chat v3 if API fails**
                    try {
                      console.log("🔄 Falling back to DeepSeek Chat v3...");
                      const fallbackResponse = await axios.post(
                        "https://openrouter.ai/api/v1/chat/completions",
                        {
                          model: "deepseek/deepseek-chat:free",
                          messages: [
                            { role: "system", content: personality },
                            ...history, // Include conversation history
                            { role: "user", content: prompt },
                          ],
                          max_tokens: maxTokens,
                        },
                        {
                          headers: {
                            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                            "HTTP-Referer": "http://localhost",
                            "X-Title": "TicketBot",
                          },
                          timeout: 10000, // 10-second timeout
                        }
                      );

                      const fallbackReply =
                        fallbackResponse.data.choices[0].message.content;

                      // Check if the fallback response is empty or invalid
                      if (!fallbackReply || fallbackReply.trim().length === 0) {
                        console.error(
                          "❌ Fallback AI returned an empty response."
                        );
                        await thinkingMessage.edit(
                          "⚠️ The AI couldn't generate a response. Please try again."
                        );
                        return;
                      }

                      // Format the fallback response
                      const formattedFallbackReply =
                        formatResponse(fallbackReply);

                      // Truncate the fallback response to 2000 characters
                      const truncatedFallbackReply =
                        formattedFallbackReply.length > 2000
                          ? formattedFallbackReply.slice(0, 1997) + "..."
                          : formattedFallbackReply;

                      // Add the fallback response to the history
                      db.run(
                        "INSERT INTO conversation_history (ticket_id, role, content) VALUES (?, ?, ?)",
                        [ticket.id, "assistant", truncatedFallbackReply]
                      );
                      const responseTime = Date.now() - fallbackStart;
                      // ✅ Edit the "thinking" message with the fallback response
                      return await thinkingMessage.edit({
                        content: truncatedFallbackReply,
                      });
                      db.run(
                        `INSERT INTO ai_logs (
                          user_id, guild_id, ticket_id, prompt_length, model_used,
                          fallback_used, tokens_estimated, response_time_ms, success, error_message
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                          message.author.id,
                          message.guild.id,
                          ticket.id,
                          promptLength,
                          modelUsedPrimary,
                          false,
                          estimatedTokens,
                          responseTime,
                          true,
                          null,
                        ],
                        (err) => {
                          if (err) {
                            console.error(
                              "❌ Failed to insert AI log:",
                              err.message
                            );
                            // You can optionally log this to a separate fallback log table if needed.
                          }
                        }
                      );
                    } catch (fallbackError) {
                      console.error("❌ Error in AI fallback:", fallbackError);

                      await thinkingMessage.edit(
                        "⚠️ AI is struggling to reply right now."
                      );

                      const totalTime = Date.now() - startTime;

                      db.run(
                        `INSERT INTO ai_logs (
                          user_id, guild_id, ticket_id, prompt_length, model_used,
                          fallback_used, tokens_estimated, response_time_ms, success, error_message
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                          message.author.id,
                          message.guild.id,
                          ticket.id,
                          promptLength,
                          modelUsedFallback,
                          true,
                          estimatedTokens,
                          totalTime,
                          false,
                          fallbackError.message || "Unknown fallback error",
                        ],
                        (err) => {
                          if (err) {
                            console.error(
                              "❌ Failed to insert fallback AI log:",
                              err.message
                            );
                          }
                        }
                      );
                    }
                  }
                }
              );
            }
          );
        }
      );
    } catch (err) {
      console.error("❌ Error in AI chat handler:", err);
    }
  },
  cooldowns,
};
