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
    if (!guildMember.roles.cache.has(process.env.TICKET_MODERATOR_ROLE)) {
      return interaction.reply({
        content: "❌ You need the 'Ticket Moderator' role to use this command.",
        flags: 64, // Ephemeral message
      });
    }

    // ✅ Create the ticket embed & button
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle("Need Help?")
      .setDescription("Click the button below to open a game request ticket.");

    const createTicketButton = new ButtonBuilder()
      .setCustomId("create_ticket")
      .setLabel("Open Ticket")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(createTicketButton);

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};
