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
    .setName("transfer")
    .setDescription("Transfer ticket claim to another Active Helper")
    .addChannelOption((option) =>
      option
        .setName("ticket")
        .setDescription("The ticket to transfer")
        .setRequired(true)
    )
    .addUserOption((option) =>
      option
        .setName("new_helper")
        .setDescription("The new Active Helper who will take over")
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      const ticketChannel = interaction.options.getChannel("ticket");
      const newHelper = interaction.options.getUser("new_helper");

      if (!ticketChannel || !newHelper) {
        return interaction.reply({
          content: "Invalid ticket or new helper selection.",
          flags: 64,
        });
      }

      // ✅ Ensure the user is a Ticket Moderator
      const guildMember = await interaction.guild.members.fetch(
        interaction.user.id
      );
      const allowedRoles = [
        process.env.TICKET_MODERATOR_ROLE,
        process.env.ELDEN_MODERATOR,
        process.env.ELDEN_ENFORCER,
        process.env.REPUTATION_BOT,
        process.env.BOTS,
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

      // ✅ Check if the ticket exists in the database
      db.get(
        "SELECT * FROM tickets WHERE channel_id = ?",
        [ticketChannel.id],
        async (err, ticket) => {
          try {
            if (err) throw new Error(`Database error: ${err.message}`);
            if (!ticket) {
              return interaction.reply({
                content: "❌ This is not a valid ticket channel.",
                flags: 64,
              });
            }

            const previousHelperId = ticket.claimed_by;

            // ✅ If the ticket is **unclaimed**, allow the moderator to claim it for the new helper
            if (!previousHelperId) {
              console.log(
                `🟡 Ticket is unclaimed. Assigning to ${newHelper.id}.`
              );
            } else {
              // ✅ If already assigned, prevent reassigning to the same helper
              if (previousHelperId === newHelper.id) {
                return interaction.reply({
                  content: "❌ The ticket is already assigned to this user.",
                  flags: 64,
                });
              }
            }

            // ✅ Update the database with the new claimer
            db.run(
              "UPDATE tickets SET claimed_by = ? WHERE channel_id = ?",
              [newHelper.id, ticketChannel.id],
              async (updateErr) => {
                try {
                  if (updateErr)
                    throw new Error(
                      `Error transferring ticket: ${updateErr.message}`
                    );

                  console.log(`✅ Ticket transferred to ${newHelper.id}`);

                  try {
                    // ✅ Revoke previous helper's access (if applicable)
                    if (previousHelperId) {
                      await ticketChannel.permissionOverwrites.delete(
                        previousHelperId
                      );
                    }

                    // ✅ Grant new helper access
                    await ticketChannel.permissionOverwrites.edit(
                      newHelper.id,
                      {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true,
                      }
                    );

                    // ✅ Add "Unclaim" button
                    const unclaimButton = new ActionRowBuilder().addComponents(
                      new ButtonBuilder()
                        .setCustomId(`unclaim_ticket_${ticketChannel.id}`)
                        .setLabel("Unclaim Ticket")
                        .setStyle(ButtonStyle.Danger)
                    );

                    await interaction.reply({
                      content: `✅ Ticket has been transferred to <@${newHelper.id}>.`,
                      components: [unclaimButton],
                    });
                  } catch (permError) {
                    console.error(
                      "❌ Error updating ticket permissions:",
                      permError
                    );
                    return interaction.reply({
                      content:
                        "❌ Failed to update permissions. Please check my role settings.",
                      flags: 64,
                    });
                  }
                } catch (updateError) {
                  console.error("❌ Database update error:", updateError);
                  return interaction.reply({
                    content:
                      "❌ An error occurred while transferring the ticket.",
                    flags: 64,
                  });
                }
              }
            );
          } catch (queryError) {
            console.error("❌ Database query error:", queryError);
            return interaction.reply({
              content:
                "❌ An error occurred while retrieving ticket information.",
              flags: 64,
            });
          }
        }
      );
    } catch (error) {
      console.error("❌ Unexpected error in /transfer command:", error);
      return interaction.reply({
        content:
          "❌ An unexpected error occurred while processing your request.",
        flags: 64,
      });
    }
  },
};
