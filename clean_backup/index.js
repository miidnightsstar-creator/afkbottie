/**
 * ================================
 * AFK VOICE BOTS - MULTI SETUP (4 BOTS)
 * ================================
 */

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType
} = require("@discordjs/voice");
const express = require("express");
const { Readable } = require("stream");

// --- KEEP ALIVE SERVER ---
const app = express();
app.get("/", (req, res) => res.send("Bots are alive and running!"));
app.listen(5000, "0.0.0.0", () => console.log("Keep-alive server listening on port 5000"));

const GUILD_ID = process.env.DISCORD_GUILD_ID;
const OWNER_ID = process.env.DISCORD_OWNER_ID;

if (!GUILD_ID || !OWNER_ID) {
  console.error("Missing critical environment variables: DISCORD_GUILD_ID, DISCORD_OWNER_ID");
  process.exit(1);
}

// Silent Audio Buffer
const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);
class SilenceStream extends Readable {
  _read() {
    this.push(SILENCE_FRAME);
  }
}

class AFKBot {
  constructor(name, token, clientId, botsArray) {
    this.name = name;
    this.token = token;
    this.clientId = clientId;
    this.botsArray = botsArray;
    this.startTime = Date.now();
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
      ],
    });
    this.lastVoiceChannelId = null;
    this.player = null;
  }

  async start() {
    if (!this.token || !this.clientId) {
      console.error(`[${this.name}] Missing token or client ID.`);
      return;
    }

    this.client.once("ready", async () => {
      console.log(`[${this.name}] Logged in as ${this.client.user.tag} (ID: ${this.client.user.id})`);
      this.client.user.setPresence({
        activities: [{ name: "AFK Presence" }],
        status: "idle",
      });

      // Force leave any existing voice channels on startup
      this.client.guilds.cache.forEach(async (guild) => {
        const connection = getVoiceConnection(guild.id, this.name);
        if (connection) {
          console.log(`[${this.name}] Found existing connection in ${guild.name}, cleaning up...`);
          this.stopSilence();
          connection.destroy();
        }
      });

      await this.deployCommands();
    });

    this.client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === "ping") {
        return interaction.reply(`🏓 [${this.name}] Pong! Latency is ${Math.round(this.client.ws.ping)}ms.`);
      }

      if (interaction.commandName === "uptime") {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        return interaction.reply(`⏳ [${this.name}] Uptime: **${hours}h ${minutes}m ${seconds}s**`);
      }

      if (interaction.commandName === "vcstatus") {
        const connection = getVoiceConnection(interaction.guildId, this.name);
        const internalState = this.lastVoiceChannelId ? `Thinking it's in <#${this.lastVoiceChannelId}>` : "Not thinking it's in any channel";
        const connectionState = connection ? `Actual connection exists (${connection.state.status})` : "No actual voice connection";
        return interaction.reply(`📊 [${this.name}] **VC Status:**\n- Internal: ${internalState}\n- Connection: ${connectionState}`);
      }

      if (interaction.commandName === "healthcheck") {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        const memory = process.memoryUsage().heapUsed / 1024 / 1024;
        const connection = getVoiceConnection(interaction.guildId, this.name);
        
        const embed = new EmbedBuilder()
          .setTitle(`🏥 ${this.name} Health Check`)
          .addFields(
            { name: "Uptime", value: `${Math.floor(uptime / 60)} minutes`, inline: true },
            { name: "WS Ping", value: `${this.client.ws.ping}ms`, inline: true },
            { name: "Memory", value: `${memory.toFixed(2)} MB`, inline: true },
            { name: "Voice State", value: connection ? connection.state.status : "Disconnected", inline: true }
          )
          .setColor(connection ? "Green" : "Red");
          
        return interaction.reply({ embeds: [embed] });
      }

      if (interaction.user.id !== OWNER_ID && !interaction.member.permissions.has("Administrator")) {
        return interaction.reply({
          content: "❌ You are not allowed to use this command.",
          flags: [4096],
        });
      }

      if (interaction.commandName === "join") {
        const member = interaction.member;
        if (!member || !member.voice || !member.voice.channel) {
          return interaction.reply({ content: "❌ Join a voice channel first.", flags: [4096] });
        }
        const voiceChannel = member.voice.channel;
        
        if (getVoiceConnection(voiceChannel.guild.id, this.name)) {
          return interaction.reply({ content: "⚠️ Bot is already connected.", flags: [4096] });
        }

        try {
          this.connectToChannel(voiceChannel);
          return await interaction.reply({ content: `✅ [${this.name}] Joined **${voiceChannel.name}**.`, flags: [4096] });
        } catch (error) {
          console.error(`[${this.name}] Error joining VC:`, error);
          if (interaction.deferred || interaction.replied) {
            return interaction.followUp({ content: "❌ Failed to join voice channel.", flags: [4096] });
          } else {
            return interaction.reply({ content: "❌ Failed to join voice channel.", flags: [4096] });
          }
        }
      }

      if (interaction.commandName === "move") {
        const member = interaction.member;
        if (!member || !member.voice || !member.voice.channel) {
          return interaction.reply({ content: "❌ Join a voice channel first.", flags: [4096] });
        }
        const voiceChannel = member.voice.channel;
        
        const connection = getVoiceConnection(interaction.guildId, this.name);
        if (!connection) {
          return interaction.reply({ content: "⚠️ Bot is not currently connected. Use `/join` instead.", flags: [4096] });
        }

        try {
          this.stopSilence();
          connection.destroy();
          this.connectToChannel(voiceChannel);
          return await interaction.reply({ content: `🚀 [${this.name}] Moved to **${voiceChannel.name}**.`, flags: [4096] });
        } catch (error) {
          console.error(`[${this.name}] Error moving VC:`, error);
          return interaction.reply({ content: "❌ Failed to move to the voice channel.", flags: [4096] });
        }
      }

      if (interaction.commandName === "leave") {
        const connection = getVoiceConnection(interaction.guildId, this.name);
        if (connection) {
          this.stopSilence();
          connection.destroy();
          this.lastVoiceChannelId = null;
          return interaction.reply({ content: `✅ [${this.name}] Left the voice channel.`, flags: [4096] });
        } else {
          return interaction.reply({ content: `⚠️ [${this.name}] I am not in a voice channel.`, flags: [4096] });
        }
      }

      if (interaction.commandName === "fixvoice") {
        this.stopSilence();
        const connection = getVoiceConnection(interaction.guildId, this.name);
        if (connection) connection.destroy();
        this.lastVoiceChannelId = null;
        return interaction.reply(`🛠️ [${this.name}] Voice connection destroyed and states cleared.`);
      }

      if (interaction.commandName === "reset") {
        await interaction.reply(`🔄 [${this.name}] Force-leaving and resetting process...`);
        this.stopSilence();
        const connection = getVoiceConnection(interaction.guildId, this.name);
        if (connection) connection.destroy();
        this.lastVoiceChannelId = null;
        
        this.client.user.setPresence({ status: "invisible" });
        
        setTimeout(() => {
          this.client.user.setPresence({ status: "idle", activities: [{ name: "AFK Presence" }] });
          interaction.followUp(`✅ [${this.name}] Bot has been refreshed and is ready.`);
        }, 2000);
      }

      if (interaction.commandName === "joinall") {
        const member = interaction.member;
        if (!member || !member.voice || !member.voice.channel) {
          return interaction.reply({ content: "❌ Join a voice channel first.", flags: [4096] });
        }
        const voiceChannel = member.voice.channel;

        await interaction.reply({ content: `🎬 Starting mass join to **${voiceChannel.name}**...`, flags: [4096] });

        for (const bot of this.botsArray) {
          try {
            // Destroy existing connection if any
            const existingConnection = getVoiceConnection(voiceChannel.guild.id, bot.name);
            if (existingConnection) {
              bot.stopSilence();
              existingConnection.destroy();
              await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Connect
            const connection = joinVoiceChannel({
              channelId: voiceChannel.id,
              guildId: voiceChannel.guild.id,
              adapterCreator: voiceChannel.guild.voiceAdapterCreator,
              selfDeaf: false,
              selfMute: true,
              group: bot.name
            });

            bot.lastVoiceChannelId = voiceChannel.id;

            try {
              // Properly await readiness with 15s timeout
              await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
              bot.playSilence(connection);
              await interaction.followUp({ content: `✅ [${bot.name}] Joined and starting silence loop.`, flags: [4096] });
            } catch (timeout) {
              connection.destroy();
              bot.lastVoiceChannelId = null;
              await interaction.followUp({ content: `❌ [${bot.name}] Timeout: Failed to reach READY state.`, flags: [4096] });
            }

            // Wait at least 2 seconds before the next bot joins
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (err) {
            console.error(`[JoinAll] Error processing ${bot.name}:`, err);
            await interaction.followUp({ content: `❌ [${bot.name}] Error: ${err.message}`, flags: [4096] });
          }
        }
        return interaction.followUp({ content: "🏁 Mass join process completed.", flags: [4096] });
      }

      if (interaction.commandName === "botlist") {
        let statusMessage = "🤖 **19-Bot Network Status**\n\n";
        
        for (const bot of this.botsArray) {
          const isReady = bot.client.isReady();
          const userTag = isReady ? `**${bot.client.user.tag}**` : "OFFLINE";
          const connection = getVoiceConnection(interaction.guildId, bot.name);
          
          let voiceState = "❌ Disconnected";
          if (connection) {
            voiceState = `✅ ${connection.state.status}`;
          }

          // Check Discord's view of the bot's voice state
          const guild = bot.client.guilds.cache.get(interaction.guildId);
          const member = guild?.members.cache.get(bot.client.user?.id);
          const discordVc = member?.voice.channelId;
          const discordState = discordVc ? `<#${discordVc}>` : "Not in VC";

          // Detect Ghost States
          let ghostLabel = "";
          if (connection && !discordVc) {
            ghostLabel = " 👻 **GHOST STATE** (Connection exists but no channel)";
          } else if (!connection && discordVc) {
            ghostLabel = " ⚠️ **DISCORD MISMATCH** (Discord thinks in VC but no connection)";
          }

          statusMessage += `• [${bot.name}] ${userTag}\n`;
          statusMessage += `  - Logged In: ${isReady ? "Yes" : "No"}\n`;
          statusMessage += `  - Internal VC: ${voiceState}\n`;
          statusMessage += `  - Discord VC: ${discordState}${ghostLabel}\n\n`;

          // Split message if it gets too long for Discord (2000 char limit)
          if (statusMessage.length > 1700) {
            await (interaction.replied ? interaction.followUp({ content: statusMessage, flags: [4096] }) : interaction.reply({ content: statusMessage, flags: [4096] }));
            statusMessage = "";
          }
        }

        if (statusMessage.length > 0) {
          if (interaction.replied) {
            return interaction.followUp({ content: statusMessage, flags: [4096] });
          } else {
            return interaction.reply({ content: statusMessage, flags: [4096] });
          }
        }
      }
    });

    this.client.on("error", (error) => {
      console.error(`[${this.name}] Discord Client Error:`, error);
    });

    await this.client.login(this.token);
  }

  async deployCommands() {
    const commands = [
      new SlashCommandBuilder().setName("join").setDescription(`Make ${this.name} join your voice channel`),
      new SlashCommandBuilder().setName("move").setDescription(`Move ${this.name} to your current voice channel`),
      new SlashCommandBuilder().setName("leave").setDescription(`Make ${this.name} leave the voice channel`),
      new SlashCommandBuilder().setName("ping").setDescription("Check bot latency"),
      new SlashCommandBuilder().setName("uptime").setDescription("Check how long the bot has been running"),
      new SlashCommandBuilder().setName("vcstatus").setDescription("Check internal vs actual voice connection state"),
      new SlashCommandBuilder().setName("healthcheck").setDescription("Show bot health stats"),
      new SlashCommandBuilder().setName("fixvoice").setDescription("Forcefully destroy voice connection and clear states"),
      new SlashCommandBuilder().setName("reset").setDescription("Full reset of bot state and voice connection"),
      new SlashCommandBuilder().setName("joinall").setDescription("Make all bots join your current voice channel one by one"),
      new SlashCommandBuilder().setName("botlist").setDescription("Display status and voice state for all 19 bots"),
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(this.token);
    try {
      await rest.put(Routes.applicationGuildCommands(this.clientId, GUILD_ID), { body: commands });
      console.log(`[${this.name}] Commands registered.`);
    } catch (error) {
      console.error(`[${this.name}] Command deployment error:`, error);
    }
  }

  playSilence(connection) {
    if (this.player) {
      this.player.stop();
    }
    this.player = createAudioPlayer();
    const resource = createAudioResource("./silence.mp3");
    
    this.player.play(resource);
    connection.subscribe(this.player);

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.playSilence(connection);
    });

    this.player.on("error", error => {
      console.error(`[${this.name}] Audio player error:`, error);
    });
  }

  stopSilence() {
    if (this.player) {
      this.player.stop();
      this.player = null;
    }
  }

  connectToChannel(channel) {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
      group: this.name
    });

    this.lastVoiceChannelId = channel.id;

    connection.on(VoiceConnectionStatus.Ready, () => {
      console.log(`[${this.name}] Connected to voice. Starting silence loop.`);
      this.playSilence(connection);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      this.stopSilence();
      console.log(`[${this.name}] Disconnected. Attempting to rejoin...`);
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        connection.destroy();
        setTimeout(() => {
          const ch = channel.guild.channels.cache.get(this.lastVoiceChannelId);
          if (ch) this.connectToChannel(ch);
        }, 2000);
      }
    });
  }
}

const bots = [];

bots.push(
  new AFKBot("Bot 1", process.env.BOT1_TOKEN || process.env.BOT_TOKEN_1, process.env.CLIENT_ID_1, bots),
  new AFKBot("Bot 2", process.env.BOT2_TOKEN || process.env.BOT_TOKEN_2, process.env.CLIENT_ID_2, bots),
  new AFKBot("Bot 3", process.env.BOT3_TOKEN || process.env.BOT_TOKEN_3, process.env.CLIENT_ID_3, bots),
  new AFKBot("Bot 4", process.env.BOT4_TOKEN || process.env.BOT_TOKEN_4, process.env.CLIENT_ID_4, bots),
  new AFKBot("Bot 5", process.env.BOT5_TOKEN, process.env.CLIENT_ID_5, bots),
  new AFKBot("Bot 6", process.env.BOT6_TOKEN, process.env.CLIENT_ID_6, bots),
  new AFKBot("Bot 7", process.env.BOT7_TOKEN, process.env.CLIENT_ID_7, bots),
  new AFKBot("Bot 8", process.env.BOT8_TOKEN, process.env.CLIENT_ID_8, bots),
  new AFKBot("Bot 9", process.env.BOT9_TOKEN, process.env.CLIENT_ID_9, bots),
  new AFKBot("Bot 10", process.env.BOT10_TOKEN, process.env.CLIENT_ID_10, bots),
  new AFKBot("Bot 11", process.env.BOT11_TOKEN, process.env.CLIENT_ID_11, bots),
  new AFKBot("Bot 12", process.env.BOT12_TOKEN, process.env.CLIENT_ID_12, bots),
  new AFKBot("Bot 13", process.env.BOT13_TOKEN, process.env.CLIENT_ID_13, bots),
  new AFKBot("Bot 14", process.env.BOT14_TOKEN, process.env.CLIENT_ID_14, bots),
  new AFKBot("Bot 15", process.env.BOT15_TOKEN, process.env.CLIENT_ID_15, bots),
  new AFKBot("Bot 16", process.env.BOT16_TOKEN, process.env.CLIENT_ID_16, bots),
  new AFKBot("Bot 17", process.env.BOT17_TOKEN, process.env.CLIENT_ID_17, bots),
  new AFKBot("Bot 18", process.env.BOT18_TOKEN, process.env.CLIENT_ID_18, bots),
  new AFKBot("Bot 19", process.env.BOT19_TOKEN, process.env.CLIENT_ID_19, bots),
  new AFKBot("Bot 20", process.env.BOT20_TOKEN, process.env.CLIENT_ID_20, bots)
);

bots.forEach(bot => bot.start().catch(console.error));
