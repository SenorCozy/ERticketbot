const { db, addUniqueUser, incrementTicketPlatform } = require("../database");
require("dotenv").config();
const marked = require("marked");
const he = require("he");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  PermissionsBitField,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Client,
  Events,
} = require("discord.js");

// Platform-specific helper role IDs
const PLATFORM_HELPER_ROLES = {
  platform_ps: process.env.PLATFORM_HELPER_PS,
  platform_pc: process.env.PLATFORM_HELPER_PC,
  platform_xbox: process.env.PLATFORM_HELPER_XBOX,
};

// Ticket category ID
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;

function clearConversationHistory(ticketId, callback) {
  db.run(
    "DELETE FROM conversation_history WHERE ticket_id = ?",
    [ticketId],
    function (err) {
      if (err) {
        console.error("❌ Error clearing conversation history:", err);
      } else {
        console.log(`✅ Cleared conversation history for ticket ${ticketId}`);
      }
      if (callback) callback(err);
    }
  );
}
//event listeners
module.exports = {
  name: "interactionCreate",
  async execute(interaction, client) {
    try {
      // ✅ Ensure the interaction is only handled once
      if (interaction.replied || interaction.deferred) {
        console.warn("⚠️ Interaction already replied or deferred. Skipping...");
        return;
      }
      console.log(
        `🟢 Received interaction: ${interaction.type}, ID: ${interaction.id}`
      );

      // ✅ Handle Slash Commands
      if (interaction.isCommand()) {
        try {
          console.log(`🟡 Handling command: ${interaction.commandName}`);
          const command = client.commands.get(interaction.commandName);
          if (command) await command.execute(interaction);
        } catch (error) {
          console.error("❌ Error executing command:", error);
          return interaction.reply({
            content: "An error occurred while processing your command.",
            flags: 64,
          });
        }
      }

      // ✅ Handle Modal Submissions (Closing Ticket)
      else if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith("close_ticket_")
      ) {
        try {
          console.log("🟢 Close ticket modal submitted.");
          const ticketChannelId = interaction.customId.split("_").pop();
          const ticketChannel =
            interaction.guild.channels.cache.get(ticketChannelId);

          if (!ticketChannel) {
            console.warn("⚠️ Ticket channel not found.");
            return interaction.reply({
              content: "Ticket channel not found.",
              flags: 64,
            });
          }

          // Get closure reason
          const closureReason =
            interaction.fields.getTextInputValue("closure_reason") ||
            "No reason provided";
          const closedBy = interaction.user;

          // Fetch ticket details
          db.get(
            "SELECT * FROM tickets WHERE channel_id = ?",
            [ticketChannelId],
            async (err, ticket) => {
              if (err) {
                console.error("❌ Database error:", err);
                return interaction.reply({
                  content: "An error occurred while closing the ticket.",
                  flags: 64,
                });
              }
              if (!ticket) {
                console.warn("⚠️ Ticket not found in the database.");
                return interaction.reply({
                  content: "This ticket is not registered in the database.",
                  flags: 64,
                });
              }

              console.log(`🔹 Closing ticket for user: ${ticket.user_id}`);

              // ✅ Generate transcript
              let messages = [];
              try {
                messages = await fetchAllMessages(ticketChannel);
              } catch (fetchError) {
                console.error(
                  "❌ Error fetching messages for transcript:",
                  fetchError
                );
              }

              // ✅ Format transcript messages
              const formattedMessages = messages
                .map((msg) => ({
                  user_id: msg.author.id,
                  username: msg.author.username,
                  avatar: msg.author.displayAvatarURL({ dynamic: true }),
                  content:
                    msg.content && msg.content.trim().length > 0
                      ? msg.content
                      : msg.attachments.size > 0
                      ? "(Image/GIF attached)"
                      : "(No content)",
                  timestamp: msg.createdTimestamp,
                  attachments:
                    msg.attachments.size > 0
                      ? JSON.stringify(msg.attachments.map((a) => a.proxyURL))
                      : null,
                  embeds:
                    msg.embeds.length > 0
                      ? JSON.stringify(msg.embeds.map((e) => e.toJSON()))
                      : null,
                  reactions:
                    msg.reactions.cache.size > 0
                      ? JSON.stringify(
                          msg.reactions.cache.map((r) => ({
                            emoji: r.emoji.name,
                            count: r.count,
                          }))
                        )
                      : null,
                }))
                .reverse();

              const transcriptId = `transcript_${Date.now()}`;

              // ✅ Save transcript in DB
              try {
                db.run(
                  `INSERT INTO transcripts (id, ticket_id, user_id, username, closed_by, closed_by_username, closure_reason, created_at, closed_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    transcriptId,
                    ticket.id,
                    ticket.user_id,
                    ticket.username,
                    closedBy.id,
                    closedBy.username,
                    closureReason,
                    ticket.created_at,
                    new Date().toISOString(),
                  ]
                );

                // ✅ Store messages in DB
                formattedMessages.forEach((msg) => {
                  db.run(
                    `INSERT INTO transcript_messages (transcript_id, user_id, username, avatar_url, message, timestamp, attachment_url, embed_data, reactions)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                      transcriptId,
                      msg.user_id,
                      msg.username,
                      msg.avatar,
                      msg.content,
                      msg.timestamp,
                      msg.attachments,
                      msg.embeds,
                      msg.reactions,
                    ]
                  );
                });
              } catch (dbError) {
                console.error(
                  "❌ Error inserting transcript into database:",
                  dbError
                );
              }

              // ✅ Generate transcript URL
              const transcriptUrl = `${process.env.TRANSCRIPT_BASE_URL}/transcripts/${transcriptId}`;

              // ✅ Format timestamps
              const formatTimestamp = (isoString) =>
                `<t:${Math.floor(new Date(isoString).getTime() / 1000)}:F>`;

              // ✅ Create ticket closure embed
              const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle("🎟️ Ticket Closed")
                .addFields(
                  { name: "📄 Ticket ID", value: `${ticket.id}`, inline: true },
                  {
                    name: "✅ Opened By",
                    value: `<@${ticket.user_id}>`,
                    inline: true,
                  },
                  {
                    name: "🔴 Closed By",
                    value: `<@${closedBy.id}>`,
                    inline: true,
                  },
                  { name: "📝 Reason", value: closureReason, inline: false },
                  {
                    name: "📅 Date Created",
                    value: formatTimestamp(ticket.created_at),
                    inline: true,
                  },
                  {
                    name: "📅 Date Closed",
                    value: formatTimestamp(new Date().toISOString()),
                    inline: true,
                  }
                );

              // ✅ Include "Claimed By" field if applicable
              if (ticket.claimed_by) {
                embed.addFields({
                  name: "🎯 Claimed By",
                  value: `<@${ticket.claimed_by}>`,
                  inline: true,
                });
              }

              // ✅ Create "View Online Transcript" button
              const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setLabel("📜 View Online Transcript")
                  .setStyle(ButtonStyle.Link)
                  .setURL(transcriptUrl)
              );

              // ✅ Send log to transcript channel
              try {
                const logsChannel = interaction.guild.channels.cache.get(
                  process.env.TRANSCRIPT_CHANNEL_ID
                );
                if (logsChannel) {
                  logsChannel.send({ embeds: [embed], components: [row] });
                } else {
                  console.warn("⚠️ Transcript log channel not found.");
                }
              } catch (logError) {
                console.error("❌ Error sending transcript log:", logError);
              }
              // Clear ai conversation history
              clearConversationHistory(ticket.id, (clearErr) => {
                if (clearErr) {
                  console.error(
                    "❌ Error clearing conversation history:",
                    clearErr
                  );
                }
              });
              // ✅ Update DB & Delete Ticket
              try {
                db.run(`UPDATE tickets SET status = 'closed' WHERE id = ?`, [
                  ticket.id,
                ]);
                db.run(`DELETE FROM tickets WHERE id = ?`, [ticket.id]);
                await interaction.reply({
                  content: "Ticket closed successfully. Transcript saved.",
                  flags: 64,
                });
                await ticketChannel.delete();
              } catch (deleteError) {
                console.error("❌ Error deleting ticket channel:", deleteError);
              }
            }
          );
        } catch (modalError) {
          console.error("❌ Error handling ticket closure:", modalError);
        }
      }

      // ✅ Handle Buttons (create ticket button)
      else if (interaction.isButton()) {
        console.log(`🟡 Handling button interaction: ${interaction.customId}`);

        if (interaction.customId === "create_ticket") {
          await promptPlatformSelection(interaction);
        } else if (
          ["platform_ps", "platform_pc", "platform_xbox"].includes(
            interaction.customId
          )
        ) {
          try {
            await createPlatformTicket(interaction, client);
          } catch (error) {
            {
              console.error(
                "❌ Error executing createplatformticket function "
              );
            }
          }
        }

        // ✅ Handle "Claim Ticket" Button
        else if (interaction.customId.startsWith("claim_ticket_")) {
          try {
            console.log("🔵 Claim button clicked");

            const ticketChannelId = interaction.customId.split("_")[2];
            const ticketChannel =
              interaction.guild.channels.cache.get(ticketChannelId);

            if (!ticketChannel) {
              console.error("❌ Ticket channel not found:", ticketChannelId);
              return interaction.reply({
                content: "Ticket channel not found.",
                flags: 64,
              });
            }
            const guildMember = await interaction.guild.members.fetch(
              interaction.user.id
            );
            // ✅ Restrict claiming to Active Helpers
            if (!guildMember.roles.cache.has(process.env.ACTIVE_HELPER_ROLE)) {
              return interaction.reply({
                content:
                  "❌ You need the 'Active Helper' role to claim tickets.",
                flags: 64,
              });
            }

            // ✅ Check if the ticket exists in the database
            db.get(
              "SELECT * FROM tickets WHERE channel_id = ?",
              [ticketChannel.id],
              async (err, ticket) => {
                if (err) {
                  console.error("❌ Database error retrieving ticket:", err);
                  return interaction.reply({
                    content:
                      "An error occurred while retrieving ticket information.",
                    flags: 64,
                  });
                }

                if (!ticket) {
                  console.warn(
                    "⚠️ No ticket found in database for:",
                    ticketChannel.id
                  );
                  return interaction.reply({
                    content: "This ticket is not registered in the database.",
                    flags: 64,
                  });
                }

                // 🚨 Prevent ticket creator from claiming their own ticket unless they are a Ticket Moderator
                if (
                  interaction.user.id === ticket.user_id &&
                  !guildMember.roles.cache.has(
                    process.env.TICKET_MODERATOR_ROLE
                  )
                ) {
                  return interaction.reply({
                    content:
                      "❌ You cannot claim your own ticket unless you are a Ticket Moderator.",
                    flags: 64,
                  });
                }

                if (ticket.claimed_by) {
                  return interaction.reply({
                    content: `This ticket has already been claimed by <@${ticket.claimed_by}>.`,
                    flags: 64,
                  });
                }

                console.log(`🔵 Assigning ticket to ${interaction.user.id}`);

                // Update the database with the claimer
                db.run(
                  "UPDATE tickets SET claimed_by = ? WHERE channel_id = ?",
                  [interaction.user.id, ticketChannel.id],
                  async (updateErr) => {
                    if (updateErr) {
                      console.error(
                        "❌ Error updating claim in database:",
                        updateErr
                      );
                      return interaction.reply({
                        content: "An error occurred while claiming the ticket.",
                        flags: 64,
                      });
                    }

                    // Update permissions: Only ticket creator, helper, and moderator should see it now
                    console.log("🔵 Debugging claim function:");
                    console.log("Ticket Channel ID:", ticketChannel.id);
                    console.log("Ticket Creator ID:", ticket.user_id);
                    console.log("Claiming User ID:", interaction.user.id);
                    console.log(
                      "Ticket Moderator Role:",
                      process.env.TICKET_MODERATOR_ROLE
                    );
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
                        id: interaction.user.id, // The person who claimed the ticket
                        allow: [
                          PermissionsBitField.Flags.ViewChannel,
                          PermissionsBitField.Flags.SendMessages,
                          PermissionsBitField.Flags.ReadMessageHistory,
                        ],
                      },
                      {
                        id: process.env.TICKET_MODERATOR_ROLE, // Ticket Moderators always have access
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
                        id: interaction.client.user.id, // The bot
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
                      content: `You have successfully claimed this ticket. Your ticket will be handled by: <@${interaction.user.id}>.`,
                      components: [unclaimButton],
                    });

                    console.log(
                      `✅ Ticket ${ticketChannel.id} claimed by ${interaction.user.id}`
                    );
                  }
                );
              }
            );
          } catch (claimError) {
            console.error("❌ Error handling claim button:", claimError);
          }
        }
        // ✅ Handle "Unclaim Ticket" Button
        else if (interaction.customId.startsWith("unclaim_ticket_")) {
          console.log("🔴 Unclaim button clicked");

          const ticketChannelId = interaction.customId.split("_")[2];
          const ticketChannel =
            interaction.guild.channels.cache.get(ticketChannelId);

          if (!ticketChannel) {
            return interaction.reply({
              content: "❌ Ticket channel not found.",
              flags: 64,
            });
          }

          // ✅ Check if the user actually claimed this ticket
          db.get(
            "SELECT * FROM tickets WHERE channel_id = ?",
            [ticketChannel.id],
            async (err, ticket) => {
              if (!ticket || ticket.claimed_by !== interaction.user.id) {
                return interaction.reply({
                  content: "❌ You can only unclaim tickets that you claimed.",
                  flags: 64,
                });
              }

              // ✅ Unclaim the ticket in the database
              db.run(
                "UPDATE tickets SET claimed_by = NULL WHERE channel_id = ?",
                [ticketChannel.id]
              );

              // ✅ Restore original permissions

              const activeHelperRole = interaction.guild.roles.cache.get(
                process.env.ACTIVE_HELPER_ROLE
              );
              const ticketModRole = interaction.guild.roles.cache.get(
                process.env.TICKET_MODERATOR_ROLE
              );

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
                  id: activeHelperRole.id, // Restore visibility to all Active Helpers
                  allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                  ],
                },
                {
                  id: ticketModRole.id, // Moderators always have access
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
                  id: interaction.client.user.id, // The bot
                  allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ManageChannels,
                    PermissionsBitField.Flags.ReadMessageHistory,
                  ],
                },
              ]);

              await interaction.reply({
                content:
                  "🔴 You have unclaimed this ticket. It is now available for other helpers.",
                components: [], // Removes buttons
              });

              console.log(
                `🔴 Ticket ${ticketChannel.id} unclaimed by ${interaction.user.id}`
              );
            }
          );
        }
        // Handle undo rep/remove rep button
        else if (interaction.customId.startsWith("undo_rep_")) {
          console.log("🔴 Undo Rep button clicked");

          await interaction.deferReply(); // ✅ Acknowledge interaction immediately

          const messageId = interaction.customId.split("_")[2];
          const channel = interaction.channel;

          try {
            // ✅ Fetch the original message
            const targetMessage = await channel.messages.fetch(messageId);

            if (!targetMessage) {
              return interaction.editReply({
                content: "❌ The message could not be found.",
              });
            }

            // ✅ Ensure only the author, mentioned user, or a moderator can undo
            const mentionedUsers = targetMessage.mentions.users.map(
              (user) => user.id
            );
            const hasPermission =
              interaction.user.id === targetMessage.author.id ||
              mentionedUsers.includes(interaction.user.id) ||
              interaction.member.roles.cache.has(
                process.env.TICKET_MODERATOR_ROLE
              );

            if (!hasPermission) {
              return interaction.followUp({
                content: "❌ You do not have permission to undo this rep.",
              });
            }

            // ✅ Remove rep reactions
            await targetMessage.reactions.cache.get("👀")?.remove();
            await targetMessage.reactions.cache.get("✅")?.remove();

            await interaction.followUp({
              content: "✅ The rep has been removed.",
            });
          } catch (error) {
            console.error("❌ Error removing reactions:", error);
            return interaction.editReply({
              content:
                "Failed to undo rep. Please tag ticket handlers for assistance.",
            });
          }
        }

        // ✅ Handle "Close Ticket" Button (Show Modal Immediately)
        else if (interaction.customId.startsWith("close_ticket_")) {
          console.log("🟢 Close ticket button clicked.");
          const ticketChannelId = interaction.customId.split("_")[2];
          const ticketChannel =
            interaction.guild.channels.cache.get(ticketChannelId);

          if (!ticketChannel) {
            console.warn("⚠️ Ticket channel not found.");
            return interaction.reply({
              content: "Ticket channel not found.",
              flags: 64,
            });
          }

          // ✅ Ensure this is a fresh interaction
          if (!interaction.isRepliable()) {
            console.warn("⚠️ Interaction expired before modal could be shown.");
            return;
          }

          // ✅ Create and Show Modal
          try {
            console.log("🟡 Preparing close ticket modal...");
            const modal = new ModalBuilder()
              .setCustomId(`close_ticket_${ticketChannel.id}`)
              .setTitle("Close Ticket");

            const reasonInput = new TextInputBuilder()
              .setCustomId("closure_reason")
              .setLabel("Enter reason for closing")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false);

            const actionRow = new ActionRowBuilder().addComponents(reasonInput);
            modal.addComponents(actionRow);

            console.log("🟢 Showing modal...");
            await interaction.showModal(modal);
            console.log("✅ Modal successfully displayed.");
          } catch (error) {
            console.error("❌ Error showing close modal:", error);
          }
        }
      }
    } catch (error) {
      console.error("❌ Error handling interaction:", error);
    }
  },
};

// Step 1: Ask for platform selection
async function promptPlatformSelection(interaction) {
  try {
    await interaction.deferReply({ flags: 64 });

    //create
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("platform_ps")
        .setLabel("PlayStation")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("platform_pc")
        .setLabel("Steam (PC)")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("platform_xbox")
        .setLabel("Xbox")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.editReply({
      content: "Which platform do you need help on?",
      components: [row],
      flags: 64,
    });
  } catch (error) {
    console.error("❌ Error displaying platform selection:", error);
    try {
      await interaction.reply({
        content:
          "An error occurred while showing platform options. Please try again.",
        flags: 64,
      });
    } catch (replyError) {
      console.error("❌ Failed to send error message to user:", replyError);
    }
  }
}
// Define general platform roles from .env
const GENERAL_PLATFORM_ROLES = {
  platform_ps: process.env.GENERAL_PS_ROLE,
  platform_pc: process.env.GENERAL_PC_ROLE,
  platform_xbox: process.env.GENERAL_XBOX_ROLE,
};
// Step 2: Create a ticket channel based on platform selection
async function createPlatformTicket(interaction, client) {
  try {
    const guild = interaction.guild;
    const ticketCreator = interaction.user;

    // ✅ Ensure user is still in the guild before fetching their roles
    const member = await guild.members.fetch(ticketCreator.id).catch((err) => {
      console.error("❌ Failed to fetch user:", err);
      return null;
    });

    if (!member) {
      return interaction.reply({
        content:
          "An error occurred. You must be in the server to create a ticket.",
        flags: 64,
      });
    }

    // ✅ Check if the user is blacklisted
    db.get(
      "SELECT * FROM blacklist WHERE user_id = ?",
      [ticketCreator.id],
      async (err, row) => {
        if (err) {
          console.error("❌ Database error checking blacklist:", err);
          return interaction.reply({
            content:
              "❌ An error occurred while checking your ticket eligibility.",
            flags: 64,
          });
        }

        if (row) {
          console.warn(
            `⚠️ User ${ticketCreator.id} is blacklisted. Preventing ticket creation.`
          );
          return interaction.reply({
            content: `❌ You are **blacklisted** from creating tickets.\n**Reason:** ${
              row.reason || "No reason provided."
            }`,
            flags: 64,
          });
        }

        // ✅ Continue ticket creation if the user is NOT blacklisted
        const platform = interaction.customId;
        const generalRoleId = GENERAL_PLATFORM_ROLES[platform]; // General platform role
        const platformHelperRoleId = PLATFORM_HELPER_ROLES[platform]; // Helper role

        if (!generalRoleId || !platformHelperRoleId) {
          return interaction.reply({
            content: "An error occurred selecting the platform.",
            flags: 64,
          });
        }

        // ✅ Defer the reply to prevent interaction timeout
        await interaction.deferReply({ flags: 64 });

        // ✅ Attempt to assign the general platform role
        try {
          await assignGeneralPlatformRole(member, generalRoleId);
        } catch (roleError) {
          console.warn(
            "⚠️ Failed to assign platform role, continuing...",
            roleError
          );
        }

        // ✅ Check if the user already has an open ticket
        const existingTicket = await getExistingTicket(ticketCreator.id);
        if (existingTicket) {
          return interaction.editReply({
            content: `You already have an open ticket: <#${existingTicket.channel_id}>`,
          });
        }

        // ✅ Create the ticket channel
        const ticketChannel = await createTicketChannel(
          guild,
          ticketCreator,
          client,
          interaction
        );
        if (!ticketChannel) {
          throw new Error("Failed to create ticket channel.");
        }

        console.log(`✅ Ticket channel created: ${ticketChannel.id}`);

        // ✅ Store the ticket in the database
        try {
          await storeTicketInDatabase(
            ticketCreator,
            platform,
            ticketChannel.id
          );
        } catch (dbError) {
          console.error("❌ Failed to store ticket in the database:", dbError);
          return interaction.editReply({
            content:
              "An error occurred while registering your ticket in the database.",
          });
        }

        // ✅ Send ticket embed & buttons
        await sendTicketEmbed(
          ticketChannel,
          ticketCreator,
          platformHelperRoleId
        );

        // ✅ Notify the user
        return interaction.editReply({
          content: `✅ Your ticket has been created: <#${ticketChannel.id}>`,
        });
      }
    );
  } catch (error) {
    console.error(
      "❌ Unexpected error in createPlatformTicket function:",
      error
    );
    return interaction
      .reply({
        content:
          "An unexpected error occurred while processing your ticket request.",
        flags: 64,
      })
      .catch(() => console.error("⚠️ Failed to send error message to user."));
  }
}

// ✅ Helper function to fetch all messages in a channel
async function fetchAllMessages(channel) {
  try {
    let messages = [];
    let lastMessageId = null;

    while (true) {
      try {
        // ✅ Fetch messages in batches of 100 (Discord limit)
        const fetchedMessages = await channel.messages.fetch({
          limit: 100,
          ...(lastMessageId && { before: lastMessageId }),
        });

        if (fetchedMessages.size === 0) break; // ✅ Stop if no more messages

        messages.push(...fetchedMessages.values());
        lastMessageId = fetchedMessages.last()?.id;

        if (!lastMessageId) break; // ✅ Prevents infinite loop if there's an unexpected issue
      } catch (fetchError) {
        console.error("❌ Error fetching messages batch:", fetchError);
        break; // ✅ Stop fetching if there's an error
      }
    }

    return messages.reverse(); // ✅ Ensure chronological order
  } catch (error) {
    console.error("❌ Unexpected error in fetchAllMessages function:", error);
    return []; // ✅ Return an empty array in case of failure to prevent crashes
  }
}

async function assignGeneralPlatformRole(member, roleId) {
  if (!member.roles.cache.has(roleId)) {
    try {
      await member.roles.add(roleId);
      console.log(
        `✅ Assigned general platform role <@&${roleId}> to ${member.user.username}`
      );
    } catch (error) {
      console.error("❌ Failed to assign general platform role:", error);
    }
  } else {
    console.log(
      `ℹ️ User ${member.user.username} already has the general platform role.`
    );
  }
}

function getExistingTicket(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT * FROM tickets WHERE user_id = ? AND status = 'open'",
      [userId],
      (err, row) => {
        if (err) {
          console.error("❌ Database error checking existing tickets:", err);
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

function getExistingTicket(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT * FROM tickets WHERE user_id = ? AND status = 'open'",
      [userId],
      (err, row) => {
        if (err) {
          console.error("❌ Database error checking existing tickets:", err);
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

function storeTicketInDatabase(user, platform, channelId) {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO tickets (user_id, username, platform, channel_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        user.id,
        user.username,
        platform,
        channelId,
        "open",
        new Date().toISOString(),
      ],
      (dbErr) => {
        if (dbErr) {
          console.error("❌ Error inserting ticket into database:", dbErr);
          reject(dbErr);
        } else {
          console.log(`✅ Ticket for ${user.username} stored in the database.`);
          resolve();
        }
      }
    );
  });
}
async function sendTicketEmbed(ticketChannel, user, platformHelperRoleId) {
  try {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`claim_ticket_${ticketChannel.id}`)
        .setLabel("✅ Claim Ticket")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`close_ticket_${ticketChannel.id}`)
        .setLabel("❌ Close Ticket with Reason")
        .setStyle(ButtonStyle.Danger)
    );

    const ticketEmbed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("🛡️ Elden Ring Boss Help Ticket")
      .setDescription(
        `Hello <@${user.id}>, a <@&${platformHelperRoleId}> will assist you shortly. Please provide the following details:
        
🔹 **What do you need help with?**  
   - 🎮 Which **boss**, **area**, or **other assistance** you need.

🔹 **Game Details (Please Provide):**  
   - 🌎 **Region & Character Level**  
   - 🌿 **Scadutree Blessing** _(Required for DLC assistance)_  
   - 🔄 **NG+ Level (Game Cycle)**  

🔹 **Multiplayer Settings:**  
   - ⚙️ **Enable Cross-Region Play:** Set *"Cross-Region Play"* to *"Perform Matchmaking"* in *System Settings > Network Tab*.  
   - 🔑 **Use an In-Game Password:** Your helper will provide one.  
   - 📝 **Passwords are case-sensitive** → Enter in *"Multiplayer Password"* under *Multiplayer Menu*.  

🔹 **After you’ve been helped:**  
   - 🏆 **Thank your helper** by mentioning them **(\`@username\`) in this ticket and saying thanks (otherwise they don't get credit!).**  
   - 💬 Say **"thank you"** in the same message → This helps them **gain ranks and unlock new roles!** 🎖️  

⚠️ *Please follow these steps for smooth assistance.*`
      )
      .setFooter({
        text: "🔹 The buttons below are for Active Helpers to manage this ticket.",
      });

    await ticketChannel.send({
      content: `<@${user.id}> <@&${platformHelperRoleId}>`, // ✅ Pings the user & helper role
      embeds: [ticketEmbed],
      components: [row],
    });

    console.log(`✅ Ticket embed successfully sent to ${ticketChannel.id}`);
  } catch (error) {
    console.error("❌ Error sending ticket embed:", error);
  }
}

async function createTicketChannel(guild, user, client, interaction) {
  const ticketChannel = await guild.channels.create({
    name: `ticket-${user.username}`,
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID,
    permissionOverwrites: [
      {
        id: guild.id, // @everyone
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: user.id, // Ticket creator
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
      {
        id: process.env.ACTIVE_HELPER_ROLE, // Active Helper role
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
      {
        id: process.env.TICKET_MODERATOR_ROLE, // Ticket Moderators
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
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
        id: client.user.id, // The bot
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
    ],
  });

  // Update statistics after ticket channel creation
  // Record unique user creating the ticket
  addUniqueUser(user.id, (err) => {
    if (err) console.error("Error adding unique user:", err);
  });

  const platformMapping = {
    platform_ps: "PlayStation",
    platform_pc: "PC",
    platform_xbox: "Xbox",
  };

  const platformName = interaction?.customId
    ? platformMapping[interaction.customId] || "Unknown"
    : "Unknown";

  incrementTicketPlatform(platformName, (err) => {
    if (err) console.error("Error incrementing ticket platform count:", err);
  });

  return ticketChannel;
}
