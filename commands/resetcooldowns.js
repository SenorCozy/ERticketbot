const { SlashCommandBuilder } = require("discord.js");
const { cooldowns } = require("../events/aiMessageHandler");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("resetcooldowns")
    .setDescription("Reset AI cooldowns for all users."),

  async execute(interaction) {
    if (
      !interaction.member.roles.cache.has(process.env.TICKET_MODERATOR_ROLE)
    ) {
      return interaction.reply({
        content: "❌ You do not have permission to reset cooldowns.",
        flags: 64,
      });
    }

    cooldowns.clear();
    await interaction.reply({
      content: "✅ AI cooldowns have been reset for all users.",
      flags: 64,
    });
  },
};
