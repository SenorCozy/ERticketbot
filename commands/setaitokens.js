const { SlashCommandBuilder } = require("discord.js");
const { db } = require("../database");
require("dotenv").config(); // Ensure .env is loaded

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setaitokens")
    .setDescription(
      "Set the maximum number of tokens for AI responses or ignore the token limit."
    )
    .addIntegerOption((option) =>
      option
        .setName("tokens")
        .setDescription(
          "Enter the token limit (default is 5000, set to 0 to ignore limit)"
        )
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(150000)
    )
    .addBooleanOption((option) =>
      option
        .setName("ignorelimit")
        .setDescription("Set to true to ignore the token limit")
        .setRequired(false)
    ),

  async execute(interaction) {
    // ✅ Use ELDER_TICKET_MODERATOR_ROLE from .env
    const requiredRoleId = process.env.ELDER_TICKET_MODERATOR_ROLE;
    if (!interaction.member.roles.cache.has(requiredRoleId)) {
      return interaction.reply({
        content: "❌ You do not have permission to change AI settings.",
        flags: 64,
      });
    }

    const tokenLimit = interaction.options.getInteger("tokens");
    const ignoreLimit = interaction.options.getBoolean("ignorelimit") || false;

    console.log("🟢 Setting token limit to:", tokenLimit);
    console.log("🟢 Ignore limit:", ignoreLimit);

    db.run(
      `INSERT INTO ai_settings (guild_id, max_tokens, ignore_token_limit) VALUES (?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET max_tokens = excluded.max_tokens, ignore_token_limit = excluded.ignore_token_limit`,
      [interaction.guild.id, tokenLimit, ignoreLimit],
      (err) => {
        if (err) {
          console.error("❌ Error updating AI token limit:", err);
          return interaction.reply({
            content: "An error occurred while updating AI settings.",
            flags: 64,
          });
        }

        if (ignoreLimit) {
          interaction.reply({
            content: "✅ AI token limit is now ignored.",
            flags: 64,
          });
        } else {
          interaction.reply({
            content: `✅ AI token limit has been updated to **${tokenLimit}**.`,
            flags: 64,
          });
        }
      }
    );
  },
};
