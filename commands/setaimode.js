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
    const guildMember = await interaction.guild.members.fetch(
      interaction.user.id
    );
    // ✅ Check for the correct role
    const allowedRoles = [
      process.env.ELDER_TICKET_MODERATOR_ROLE,
      process.env.ELDEN_MODERATOR,
      process.env.ELDEN_ENFORCER,
    ];

    const hasRequiredRole = guildMember.roles.cache.some((role) =>
      allowedRoles.includes(role.id)
    );

    if (!hasRequiredRole) {
      return interaction.reply({
        content: "❌ You do not have permission to use this command.",
        flags: 64,
      });
    }

    const selectedMode = interaction.options.getString("mode");
    const formattedMode =
      selectedMode.charAt(0).toUpperCase() + selectedMode.slice(1);

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
          content: `✅ AI personality mode has been updated to **${formattedMode}**.`,
          flags: 64,
        });
      }
    );
  },
};
