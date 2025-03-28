const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { db } = require("../database");

require("dotenv").config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unclaim")
    .setDescription("Unclaim a ticket, making it available for other helpers")
    .addChannelOption((option) =>
      option
        .setName("ticket")
        .setDescription("The ticket channel you want to unclaim")
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      const ticketChannel = interaction.options.getChannel("ticket");
      const user = interaction.user;
      const guildMember = await interaction.guild.members.fetch(user.id);

      if (!ticketChannel) {
        return interaction.reply({
          content: "Invalid ticket channel selection.",
          flags: 64,
        });
      }

      // ✅ Ensure the user has the "Active Helper" role
      if (!guildMember.roles.cache.has(process.env.ACTIVE_HELPER_ROLE)) {
        return interaction.reply({
          content: "❌ You need the 'Active Helper' role to unclaim tickets.",
          flags: 64,
        });
      }

      // Check if the ticket exists
      db.get(
        "SELECT * FROM tickets WHERE channel_id = ?",
        [ticketChannel.id],
        async (err, ticket) => {
          if (err) {
            console.error("❌ Database error:", err);
            return interaction.reply({
              content:
                "❌ An error occurred while retrieving ticket information.",
              flags: 64,
            });
          }

          if (!ticket) {
            return interaction.reply({
              content: "❌ This is not a valid ticket channel.",
              flags: 64,
            });
          }

          // Check if the ticket is claimed
          if (!ticket.claimed_by) {
            return interaction.reply({
              content: "❌ This ticket is not currently claimed.",
              flags: 64,
            });
          }

          // Ensure only the claimer or a Ticket Moderator can unclaim
          if (
            ticket.claimed_by !== user.id &&
            !guildMember.roles.cache.has(process.env.TICKET_MODERATOR_ROLE) &&
            !guildMember.roles.cache.has(process.env.ELDEN_MODERATOR) &&
            !guildMember.roles.cache.has(process.env.ELDEN_ENFORCER)
          ) {
            return interaction.reply({
              content:
                "❌ Only the person who claimed this ticket or a Ticket Moderator can unclaim it.",
              flags: 64,
            });
          }

          // Remove claim from database
          db.run(
            "UPDATE tickets SET claimed_by = NULL WHERE channel_id = ?",
            [ticketChannel.id],
            async (updateErr) => {
              if (updateErr) {
                console.error("❌ Error updating database:", updateErr);
                return interaction.reply({
                  content: "❌ An error occurred while unclaiming the ticket.",
                  flags: 64,
                });
              }

              // Reset channel permissions so all Active Helpers can see it again
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
                  id: process.env.ACTIVE_HELPER_ROLE, // All Active Helpers regain access
                  allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                  ],
                },
                {
                  id: process.env.TICKET_MODERATOR_ROLE, // Moderators always have access
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
                  id: process.env.REPUTATION_BOT, // ✅ New role
                  allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                  ],
                },
                {
                  id: process.env.BOTS, // ✅ New role
                  allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                  ],
                },
                {
                  id: interaction.client.user.id, // The bot
                  allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ManageChannels,
                    PermissionsBitField.Flags.ReadMessageHistory,
                    PermissionsBitField.Flags.ManageMessages,
                  ],
                },
              ]);

              await interaction.reply({
                content: `✅ The ticket has been unclaimed and is now available for other helpers.`,
              });
            }
          );
        }
      );
    } catch (error) {
      console.error("❌ Unexpected error in /unclaim command:", error);
      return interaction.reply({
        content:
          "❌ An unexpected error occurred while processing your request.",
        flags: 64,
      });
    }
  },
};
