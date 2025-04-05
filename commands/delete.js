const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

require("dotenv").config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("delete")
    .setDescription(
      "Deletes a ticket channel if it starts with 'ticket-' (Ticket Moderators only)"
    )
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Select the ticket channel to delete")
        .setRequired(true)
    ),

  async execute(interaction) {
    // Fetch user information
    const guildMember = await interaction.guild.members.fetch(
      interaction.user.id
    );

    // ✅ Restrict access to users with the "Ticket Moderator" role
    const allowedRoles = [
      process.env.ELDER_TICKET_MODERATOR_ROLE,
      process.env.TICKET_MODERATOR_ROLE,
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

    // Get the selected channel
    const channel = interaction.options.getChannel("channel");

    // Check if the channel starts with "ticket-"
    if (!channel || !channel.name.startsWith("ticket-")) {
      return await interaction.reply({
        content: "❌ The selected channel is not a valid ticket channel.",
        flags: 64,
      });
    }

    try {
      await channel.delete();
      await interaction.reply({
        content: `✅ The ticket channel **#${channel.name}** has been deleted.`,
        flags: 64,
      });
    } catch (error) {
      console.error("❌ Error deleting ticket channel:", error);
      await interaction.reply({
        content:
          "❌ Failed to delete the channel. Please check the bot's permissions.",
        flags: 64,
      });
    }
  },
};
