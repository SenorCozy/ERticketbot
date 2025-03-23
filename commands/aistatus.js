const { SlashCommandBuilder } = require("discord.js");
const { db } = require("../database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("aistatus")
    .setDescription("Check the current AI settings."),

  async execute(interaction) {
    db.get(
      "SELECT ai_mode, max_tokens, ignore_token_limit FROM ai_settings WHERE guild_id = ?",
      [interaction.guild.id],
      (err, settings) => {
        if (err) {
          console.error("❌ Error fetching AI settings:", err);
          return interaction.reply({
            content: "An error occurred while fetching AI settings.",
            flags: 64,
          });
        }

        const aiMode = settings?.ai_mode || "professional";
        const maxTokens = settings?.max_tokens || 50000; // Use 50000 as the default if no value is found
        const ignoreLimit = settings?.ignore_token_limit || false;

        let response = `🟢 AI Mode: **${aiMode}**\n🟢 Max Tokens: **${maxTokens}**`;
        if (ignoreLimit) {
          response += "\n🟢 Token Limit: **Ignored**";
        }

        interaction.reply({
          content: response,
          flags: 64,
        });
      }
    );
  },
};
