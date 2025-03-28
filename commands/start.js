const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
} = require("discord.js");

require("dotenv").config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("start")
    .setDescription(
      "Starts the ticket creation process (Ticket Moderators only)."
    ),

  async execute(interaction) {
    // Fetch user information
    const guildMember = await interaction.guild.members.fetch(
      interaction.user.id
    );

    // ✅ Restrict access to users with the "Ticket Moderator" role
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

    // ✅ Create the ticket embed & button
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle("Need Help With a Boss or an Area?")
      .setDescription(
        "Click the button below to open a game request ticket and our Elden Ring Helpers will be happy to assist!"
      );

    const createTicketButton = new ButtonBuilder()
      .setCustomId("create_ticket")
      .setLabel("Open Game Help Ticket")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(createTicketButton);

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};
