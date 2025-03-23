const { SlashCommandBuilder } = require("discord.js");
const { db } = require("../database");
require("dotenv").config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setaimode")
    .setDescription("Change the AI personality mode.")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Select the AI mode")
        .setRequired(true)
        .addChoices(
          { name: "Professional", value: "professional" },
          { name: "Casual", value: "casual" },
          { name: "Meme", value: "meme" },
          { name: "Strict", value: "strict" },
          { name: "Unrestricted", value: "unrestricted" }
        )
    ),

  async execute(interaction) {
    // ✅ Check for the correct role
    const requiredRoleId = process.env.ELDER_TICKET_MODERATOR_ROLE;
    if (!interaction.member.roles.cache.has(requiredRoleId)) {
      return interaction.reply({
        content: "❌ You do not have permission to change AI settings.",
        flags: 64, // ephemeral
      });
    }

    const selectedMode = interaction.options.getString("mode");

    db.run(
      `INSERT INTO ai_settings (guild_id, ai_mode) VALUES (?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET ai_mode = excluded.ai_mode`,
      [interaction.guild.id, selectedMode],
      (err) => {
        if (err) {
          console.error("❌ Error updating AI mode:", err);
          return interaction.reply({
            content: "An error occurred while updating AI settings.",
            flags: 64,
          });
        }

        interaction.reply({
          content: `✅ AI personality mode has been updated to **${selectedMode}**.`,
          flags: 64,
        });
      }
    );
  },
};
