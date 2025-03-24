const {
  SlashCommandBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { db } = require("../database");

require("dotenv").config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim a ticket")
    .addChannelOption((option) =>
      option
        .setName("ticket")
        .setDescription("The ticket you want to claim")
        .setRequired(true)
    ),

  async execute(interaction, client) {
    const ticketChannel = interaction.options.getChannel("ticket");
    const user = interaction.user;
    const guildMember = await interaction.guild.members.fetch(user.id);

    // ✅ Ensure the user has the "Active Helper" role
    if (!guildMember.roles.cache.has(process.env.ACTIVE_HELPER_ROLE)) {
      return interaction.reply({
        content: "❌ You need the 'Active Helper' role to claim tickets.",
        flags: 64,
      });
    }

    // Check if the ticket exists in the database
    db.get(
      "SELECT * FROM tickets WHERE channel_id = ?",
      [ticketChannel.id],
      async (err, ticket) => {
        if (!ticket) {
          return interaction.reply({
            content: "This is not a valid ticket channel.",
            flags: 64,
          });
        }

        // 🚨 Prevent ticket creator from claiming their own ticket unless they are a Ticket Moderator
        if (
          user.id === ticket.user_id &&
          !guildMember.roles.cache.has(process.env.TICKET_MODERATOR_ROLE) &&
          !guildMember.roles.cache.has(process.env.ELDEN_MODERATOR) &&
          !guildMember.roles.cache.has(process.env.ELDEN_ENFORCER)
        ) {
          return interaction.reply({
            content:
              "❌ You cannot claim your own ticket unless you are a Ticket Moderator, Elden Moderator, or Elden Enforcer.",
            flags: 64,
          });
        }

        // Check if the ticket is already claimed
        if (ticket.claimed_by) {
          return interaction.reply({
            content: `This ticket is already claimed by <@${ticket.claimed_by}>.`,
            flags: 64,
          });
        }

        // Update the database to mark the ticket as claimed
        db.run("UPDATE tickets SET claimed_by = ? WHERE channel_id = ?", [
          user.id,
          ticketChannel.id,
        ]);

        // ✅ Update permissions to include new roles
        await ticketChannel.permissionOverwrites.set([
          {
            id: interaction.guild.id, // @everyone
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: ticket.user_id, // Ticket creator
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
          {
            id: user.id, // Claimer
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
          {
            id: process.env.TICKET_MODERATOR_ROLE,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
          {
            id: process.env.ELDEN_MODERATOR, // ✅ New role
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
          {
            id: process.env.ELDEN_ENFORCER, // ✅ New role
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
          {
            id: interaction.client.user.id, // Bot
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageChannels,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
        ]);

        // ✅ Add "Unclaim" button
        const unclaimButton = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`unclaim_ticket_${ticketChannel.id}`)
            .setLabel("Unclaim Ticket")
            .setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({
          content: `You have claimed this ticket: <#${ticketChannel.id}>.`,
          components: [unclaimButton],
        });
      }
    );
  },
};
