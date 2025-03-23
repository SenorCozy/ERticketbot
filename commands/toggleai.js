const { SlashCommandBuilder } = require("discord.js");
const { db } = require("../database");
require("dotenv").config(); // Load .env for role ID

module.exports = {
  data: new SlashCommandBuilder()
    .setName("toggleai")
    .setDescription("Enable or disable AI responses in ticket channels")
    .addBooleanOption((option) =>
      option
        .setName("enabled")
        .setDescription("Enable or disable AI")
        .setRequired(true)
    ),

  async execute(interaction) {
    const member = await interaction.guild.members.fetch(interaction.user.id);

    // ✅ Check if the user has the required role
    const hasModRole = member.roles.cache.has(
      process.env.ELDER_TICKET_MODERATOR_ROLE
    );

    if (!hasModRole) {
      return interaction.reply({
        content: "❌ You do not have permission to use this command.",
        flags: 64,
      });
    }

    const enabled = interaction.options.getBoolean("enabled");

    // Update the AI enabled state in the database
    db.run(
      "INSERT OR REPLACE INTO ai_settings (guild_id, ai_enabled) VALUES (?, ?)",
      [interaction.guild.id, enabled],
      (err) => {
        if (err) {
          console.error("❌ Error updating AI settings:", err);
          return interaction.reply({
            content: "❌ An error occurred while updating AI settings.",
            flags: 64,
          });
        }

        interaction.reply({
          content: `✅ AI responses have been **${
            enabled ? "enabled" : "disabled"
          }**.`,
          flags: 64,
        });
      }
    );
  },
};
