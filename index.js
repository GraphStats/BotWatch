import 'dotenv/config';
import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, Collection } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const app = express();
const PORT = 7782;

// Correctly define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    
    rest: {
        timeout: 30000,
    },
    ws: {
        properties: {
            $browser: "Discord iOS"
        }
    }
});

// Files for data storage - using absolute paths
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'uptimeData.json');
const TRACK_FILE = path.join(DATA_DIR, 'trackMessages.json');
const MAX_TRACK = 30 * 24 * 60 * 60 * 1000; 

console.log('----------- Bot starting up -----------');
console.log('Checking data directories and files...');

if (!fs.existsSync(DATA_DIR)) {
    console.log(`Data directory not found, creating: ${DATA_DIR}`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
} else {
    console.log(`Data directory exists: ${DATA_DIR}`);
}

// Create data directory if it doesn't exist
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

let uptimeData = {};
let trackMessages = {};

// Lors du chargement des fichiers
console.log('Loading uptime and track messages data...');
loadData();
console.log('Data loaded:', {
    uptimeDataCount: Object.keys(uptimeData).length,
    trackMessagesCount: Object.keys(trackMessages).length
});

client.on('guildCreate', async guild => {
    try {
        const channels = await guild.channels.fetch();
        const textChannels = channels.filter(
            ch => ch.isTextBased() && ch.permissionsFor(guild.members.me).has('SendMessages')
        );

        if (!textChannels.size) {
            console.log(`No available channel to send the welcome message in ${guild.name}`);
            return;
        }

        const channel = textChannels.random();

        const embed = new EmbedBuilder()
            .setTitle('🤖 Thank you for inviting BotWatch!')
            .setDescription(
                `Botwatch has automatically registered **all bots in this server** (including your own custom bots).\n\n
Data is stored **locally only** (bot username + status) and uptime/downtime is calculated directly from the server.\n\n
You can now start tracking your bots' performance and availability without relying on any external service.`
            )
            .setColor(0xFF7F50)
            .setFooter({ text: 'BotWatch — Automated Bot Monitoring' })
            .setTimestamp();

        await channel.send({ embeds: [embed] });

        console.log(`Welcome message sent in ${guild.name}`);
    } catch (err) {
        console.error('Error in guildCreate event:', err);
    }
});

function getRandomBotFromGuild(guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return null;
    const bots = guild.members.cache.filter(m => m.user.bot && m.user.id !== client.user.id);
    if (bots.size === 0) return null;
    const randomBot = bots.random();
    return randomBot;
}

// Function to load data with better error handling
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            uptimeData = JSON.parse(data);
            
            // Ensure all data has firstTracked
            for (const botId in uptimeData) {
                if (!uptimeData[botId].firstTracked) {
                    uptimeData[botId].firstTracked = Date.now();
                }
            }
            console.log('Uptime data loaded successfully');
        } else {
            console.log('No uptime data file found, starting fresh');
            uptimeData = {};
        }
    } catch (error) {
        console.error('Error reading uptimeData file:', error);
        uptimeData = {};
    }

    try {
        if (fs.existsSync(TRACK_FILE)) {
            const data = fs.readFileSync(TRACK_FILE, 'utf8');
            trackMessages = JSON.parse(data);
            console.log('Track messages loaded successfully');
        } else {
            console.log('No track messages file found, starting fresh');
            trackMessages = {};
        }
    } catch (error) {
        console.error('Error reading trackMessages file:', error);
        trackMessages = {};
    }
}

// File saving with better error handling and retries
function saveData() {
    try {
        const tempFile = DATA_FILE + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(uptimeData, null, 2));
        fs.renameSync(tempFile, DATA_FILE);
        console.log('Uptime data saved successfully');
    } catch (error) {
        console.error('Error saving uptime data:', error);
    }
}

function log(...args) {
    console.log(new Date().toISOString(), ...args);
}

function saveTrackMessages() {
    try {
        console.log('Saving track messages...');
        const tempFile = TRACK_FILE + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(trackMessages, null, 2));
        fs.renameSync(tempFile, TRACK_FILE);
        console.log('Track messages saved successfully:', trackMessages); // ← ajoute ça
    } catch (error) {
        console.error('Error saving track messages:', error);
        console.log('Track messages saved. Current tracking:', JSON.stringify(trackMessages, null, 2));
        console.error('Failed to save track messages:', error);
    }
}

// Function to format time
function formatUptime(ms) {
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const daysMs = ms % (24 * 60 * 60 * 1000);
    const hours = Math.floor(daysMs / (60 * 60 * 1000));
    const hoursMs = ms % (60 * 60 * 1000);
    const minutes = Math.floor(hoursMs / (60 * 1000));
    
    return `${days}d ${hours}h ${minutes}m`;
}

// CORRECTION : Nouvelle fonction pour calculer l'uptime avec une valeur par défaut de 100%
function calculateUptimePercent(data) {
    const now = Date.now();
    const trackingDuration = now - (data.firstTracked || now);
    
    // Si le bot vient d'être tracké ou n'a pas de données suffisantes, retourner 100%
    if (trackingDuration < 60000) { // Moins d'1 minute de tracking
        return '100.00';
    }
    
    const effectiveDuration = Math.min(trackingDuration, MAX_TRACK);
    const cappedUptime = Math.min(data.totalUptime || 0, effectiveDuration);
    
    // Si pas de temps d'activité enregistré mais le bot est en ligne, retourner 100%
    if (cappedUptime === 0 && data.lastStatus && data.lastStatus !== 'offline') {
        return '100.00';
    }
    
    const uptimePercent = effectiveDuration > 0 
        ? ((cappedUptime / effectiveDuration) * 100).toFixed(2)
        : '100.00';
    
    // S'assurer que l'uptime n'est pas NaN ou undefined
    return uptimePercent === 'NaN' || !uptimePercent ? '100.00' : uptimePercent;
}

async function updateEmbed(client, guildId, botId) {
    console.log(`Updating embed for bot ${botId} in guild ${guildId}`);
    console.log('Current uptimeData:', uptimeData[botId]);
    
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            console.log(`Guild ${guildId} not found`);
            return;
        }
        
        const member = await guild.members.fetch(botId).catch(() => {
            console.log(`Bot ${botId} not found in guild ${guildId}`);
            return null;
        });
        
        if (!member) {
            // Remove tracking if bot is no longer on the server
            if (trackMessages[guildId]?.[botId]) {
                delete trackMessages[guildId][botId];
                if (Object.keys(trackMessages[guildId]).length === 0) {
                    delete trackMessages[guildId];
                }
                saveTrackMessages();
                
                // Stop the update interval
                const intervalId = updateIntervals.get(`${guildId}-${botId}`);
                if (intervalId) {
                    clearInterval(intervalId);
                    updateIntervals.delete(`${guildId}-${botId}`);
                }
            }
            return;
        }

        const channelId = trackMessages[guildId]?.[botId]?.channelId;
        const messageId = trackMessages[guildId]?.[botId]?.messageId;
        
        if (!channelId || !messageId) {
            console.log(`No tracking message found for bot ${botId} in guild ${guildId}`);
            return;
        }

        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isTextBased()) {
            console.log(`Channel ${channelId} not found or not text-based`);
            return;
        }

        const message = await channel.messages.fetch(messageId).catch(() => {
            console.log(`Message ${messageId} not found in channel ${channelId}`);
            return null;
        });
        
        // CORRECTION : Cette ligne était mal placée - maintenant elle est dans le bon contexte
        console.log(`Editing message ${messageId} in channel ${channelId} → found: ${!!message}`);
        
        if (!message) {
            // Remove reference if message no longer exists
            delete trackMessages[guildId][botId];
            if (Object.keys(trackMessages[guildId]).length === 0) {
                delete trackMessages[guildId];
            }
            saveTrackMessages();
            
            // Stop the update interval
            const intervalId = updateIntervals.get(`${guildId}-${botId}`);
            if (intervalId) {
                clearInterval(intervalId);
                updateIntervals.delete(`${guildId}-${botId}`);
            }
            return;
        }

        const status = member.presence?.status || 'offline';
        const isUp = status !== 'offline';

        // Initialize data if necessary
        if (!uptimeData[botId]) {
            uptimeData[botId] = { 
                onlineTime: 0, 
                lastChecked: Date.now(),
                lastStatus: status,
                totalUptime: 0,
                totalDowntime: 0,
                statusChanges: 0,
                firstTracked: Date.now()
            };
            saveData();
        }

        const data = uptimeData[botId];
        
        // Ensure firstTracked is set
        if (!data.firstTracked) {
            data.firstTracked = Date.now();
            saveData();
        }
        
        // CORRECTION : Utilisation de la nouvelle fonction pour calculer l'uptime
        const uptimePercent = calculateUptimePercent(data);

        const statusEmoji = isUp ? '✅' : '❌';
        const statusText = isUp ? 'Online' : 'Offline';
        const now = Date.now();
        const upDuration = isUp ? formatSince(now - (data.lastUp || now)) : null;
        const downDuration = !isUp ? formatSince(now - (data.lastDown || now)) : null;

        const embed = new EmbedBuilder()
            .setTitle(`Status of ${member.user.tag}`)
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: 'Current status', value: `${statusEmoji} ${statusText}`, inline: true },
                { name: 'Uptime (30d)', value: `${uptimePercent}%`, inline: true },
                { name: 'Total online time', value: formatUptime(data.totalUptime), inline: false },
                { name: 'Status changes', value: data.statusChanges.toString(), inline: true },
                { name: 'Tracked since', value: `<t:${Math.floor(data.firstTracked / 1000)}:R>`, inline: false },
                { name: 'Currently up for', value: upDuration || 'N/A', inline: true },
                { name: 'Currently down for', value: downDuration || 'N/A', inline: true }
            )
            .setColor(isUp ? 0x00FF00 : 0xFF0000)
            .setFooter({ text: `Last updated` })
            .setTimestamp();

        await message.edit({ embeds: [embed] });
        console.log(`Embed updated for ${member.user.tag} in ${guild.name} - Uptime: ${data.totalUptime}ms (${uptimePercent}%)`);
    } catch (err) {
        console.error('Error updating embed:', err);
    }
}

// Lors de la vérification des statuts
console.log('Checking bot statuses...');
console.log(`Total guilds cached: ${client.guilds.cache.size}`);
client.guilds.cache.forEach(guild => {
    console.log(`Checking guild: ${guild.name} (${guild.id})`);
    guild.members.cache.forEach(member => {
        if (member.user.bot) {
            console.log(`Bot found: ${member.user.tag} - status: ${member.presence?.status || 'offline'}`);
        }
    });
});

// Store intervals to be able to stop them later
const updateIntervals = new Collection();

// On startup: restart existing updates
client.once('ready', async () => {
    console.log(`${client.user.tag} is online!`);
    
    client.guilds.cache.forEach(g => {
        g.members.fetch().then(() => {
            console.log(`Fetched members for ${g.name}`);
        });
    });
    
    // Load data on startup
    loadData();
    
    // Register commands
    registerCommands();
    
    // Récupérer un guild quelconque (le premier dans le cache)
    const guild = client.guilds.cache.first();
    if (!guild) return console.log("Aucune guild disponible");
    
    await guild.members.fetch();
    const bots = guild.members.cache.filter(m => m.user.bot);
    console.log(`Bots in ${guild.name}:`, Array.from(bots.values()).map(b => b.user.tag));
    
    // CORRECTION : Initialiser l'uptime à 100% pour tous les bots existants
    const now = Date.now();
    for (const botId in uptimeData) {
        const data = uptimeData[botId];
        // Si le bot n'a pas de données d'uptime mais est tracké, initialiser à 100%
        if ((!data.totalUptime || data.totalUptime === 0) && data.firstTracked) {
            const trackingDuration = now - data.firstTracked;
            data.totalUptime = Math.min(trackingDuration, MAX_TRACK);
            console.log(`Initialized uptime to 100% for bot ${botId}`);
        }
    }
    saveData();
    
    // Start tracking for all registered bots
    for (const guildId in trackMessages) {
        for (const botId in trackMessages[guildId]) {
            // Immediate update
            updateEmbed(client, guildId, botId);
            
            // Then periodic update every 30 seconds
            const intervalId = setInterval(() => updateEmbed(client, guildId, botId), 60000);
            updateIntervals.set(`${guildId}-${botId}`, intervalId);
            console.log(`Tracking started for bot ${botId} in guild ${guildId}`);
        }
    }
    
    // Start periodic status check
    startStatusCheckInterval();
    
    // Start periodic update of all embeds
    startEmbedUpdateInterval();
});

function formatSince(ms) {
    if (!ms || ms < 0) return '0m';
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    ms %= 24 * 60 * 60 * 1000;
    const hours = Math.floor(ms / (60 * 60 * 1000));
    ms %= 60 * 60 * 1000;
    const minutes = Math.floor(ms / (60 * 1000));

    let str = '';
    if (days) str += `${days}d `;
    if (hours) str += `${hours}h `;
    str += `${minutes}m`;

    return str.trim();
}

// Status check every 30 seconds
function startStatusCheckInterval() {
    setInterval(() => {
        console.log('Checking bot statuses...');
        const now = Date.now();
        client.guilds.cache.forEach(guild => {
            guild.members.cache.forEach(member => {
                if (member.user.bot && member.user.id !== client.user.id) {
                    const botId = member.id;
                    const status = member.presence?.status || 'offline';

                    if (!uptimeData[botId]) {
                        uptimeData[botId] = { 
                            onlineTime: 0, 
                            lastChecked: now,
                            lastStatus: status,
                            totalUptime: 0,
                            totalDowntime: 0,
                            statusChanges: 0,
                            firstTracked: now
                        };
                    }

                    const data = uptimeData[botId];
                    const timeSinceLastCheck = now - data.lastChecked;
                    
                    // CORRECTION : Si c'est la première vérification, initialiser l'uptime au temps écoulé
                    if (data.totalUptime === 0 && status !== 'offline') {
                        const trackingDuration = now - data.firstTracked;
                        data.totalUptime = Math.min(trackingDuration, MAX_TRACK);
                        console.log(`Initial uptime set for bot ${botId}: ${data.totalUptime}ms`);
                    }
                    
                    // Count status changes
                    if (status !== data.lastStatus) {
                        data.statusChanges++;
                        if (status !== 'offline') {
                            data.lastUp = now;
                        } else {
                            data.lastDown = now;
                        }
                        data.lastStatus = status;
                    }

                    if (status !== 'offline') {
                        data.totalUptime = Math.min(data.totalUptime + timeSinceLastCheck, MAX_TRACK);
                    } else {
                        data.totalDowntime += timeSinceLastCheck;
                    }

                    // Ensure lastUp / lastDown are initialized
                    if (!data.lastUp) data.lastUp = now;
                    if (!data.lastDown) data.lastDown = now;

                    data.lastChecked = now;
                }
            });
        });
        saveData();
    }, 30000); // Every 30 seconds
}

// Update all embeds every 30 seconds
function startEmbedUpdateInterval() {
    setInterval(() => {
        console.log('Updating all embeds...');
        for (const guildId in trackMessages) {
            for (const botId in trackMessages[guildId]) {
                updateEmbed(client, guildId, botId);
            }
        }
    }, 120000); // Every 30 seconds
}

// Slash command registration
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: [
                new SlashCommandBuilder()
                    .setName('track')
                    .setDescription('Track a bot\'s uptime on the server')
                    .addUserOption(option => 
                        option.setName('bot')
                            .setDescription('The bot to track')
                            .setRequired(true)
                    )
                    .toJSON(),
                new SlashCommandBuilder()
                    .setName('untrack')
                    .setDescription('Stop tracking a bot')
                    .addUserOption(option => 
                        option.setName('bot')
                            .setDescription('The bot to stop tracking')
                            .setRequired(true)
                    )
                    .toJSON(),
                new SlashCommandBuilder()
                    .setName('botinfo')
                    .setDescription('Show information about a bot')
                    .addUserOption(option => 
                        option.setName('bot')
                            .setDescription('The bot to inspect')
                            .setRequired(true)
                    )
                    .toJSON(),
                new SlashCommandBuilder()
                    .setName('refresh')
                    .setDescription('Force update all embeds')
                    .toJSON(),
                new SlashCommandBuilder()
                    .setName('debug')
                    .setDescription('Debug information about tracking')
                    .toJSON(),
                new SlashCommandBuilder()
                    .setName('average')
                    .setDescription('Calculate the average uptime of all tracked bots on the server')
                    .toJSON(),
                new SlashCommandBuilder()
                    .setName('help')
                    .setDescription('Show all available commands and their descriptions')
                    .toJSON(),
 

            ]}
        );
        console.log('Commands registered successfully.');
    } catch (err) { 
        console.error('Error registering commands:', err); 
    }
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    console.log(`Command received: ${interaction.commandName} from ${interaction.user.tag} in guild ${interaction.guild?.name || 'DM'}`);

    try {
        if (interaction.commandName === 'track') {
            console.log(`Attempting to track bot: ${interaction.options.getUser('bot').tag}`);
            const botUser = interaction.options.getUser('bot');
            if (!botUser.bot) 
                return interaction.reply({ content: 'This is not a bot!', ephemeral: true });
            
            if (botUser.id === client.user.id)
                return interaction.reply({ content: 'I cannot track myself!', ephemeral: true });

            const channel = interaction.channel;
            
            // Check if bot is already tracked in this channel
            if (trackMessages[interaction.guildId]?.[botUser.id]?.channelId === channel.id) {
                console.log(`Tracking already started for ${botUser.tag} in channel ${channel.id}`);
                return interaction.reply({ content: 'This bot is already tracked in this channel!', ephemeral: true });
            }

            // Verify the bot is on the server
            const member = await interaction.guild.members.fetch(botUser.id).catch(() => null);
            if (!member) {
                return interaction.reply({ content: 'This bot is not on this server!', ephemeral: true });
            }

            const status = member.presence?.status || 'offline';
            const isUp = status !== 'offline';

            // Initialize data if necessary
            if (!uptimeData[botUser.id]) {
                uptimeData[botUser.id] = { 
                    onlineTime: 0, 
                    lastChecked: Date.now(),
                    lastStatus: status,
                    totalUptime: 0,
                    totalDowntime: 0,
                    statusChanges: 0,
                    firstTracked: Date.now()
                };
                saveData();
            }

            const data = uptimeData[botUser.id];
            
            // Ensure firstTracked is set
            if (!data.firstTracked) {
                data.firstTracked = Date.now();
                saveData();
            }
            
            // CORRECTION : Initialiser l'uptime à 100% pour les nouveaux bots trackés
            if (data.totalUptime === 0 && isUp) {
                const trackingDuration = Date.now() - data.firstTracked;
                data.totalUptime = Math.min(trackingDuration, MAX_TRACK);
                saveData();
            }
            
            const now = Date.now();
            const upDuration = isUp ? formatSince(now - (data.lastUp || now)) : null;
            const downDuration = !isUp ? formatSince(now - (data.lastDown || now)) : null;
            
            // CORRECTION : Utilisation de la nouvelle fonction pour calculer l'uptime
            const uptimePercent = calculateUptimePercent(data);

            const statusEmoji = isUp ? '✅' : '❌';
            const statusText = isUp ? 'Online' : 'Offline';

            const embed = new EmbedBuilder()
                .setTitle(`Status of ${botUser.tag}`)
                .setThumbnail(botUser.displayAvatarURL())
                .addFields(
                    { name: 'Current status', value: `${statusEmoji} ${statusText}`, inline: true },
                    { name: 'Uptime (30d)', value: `${uptimePercent}%`, inline: true },
                    { name: 'Total online time', value: formatUptime(data.totalUptime), inline: false },
                    { name: 'Status changes', value: data.statusChanges.toString(), inline: true },
                    { name: 'Tracked since', value: `<t:${Math.floor(data.firstTracked / 1000)}:R>`, inline: false },
                    { name: 'Currently up for', value: upDuration || 'N/A', inline: true },
                    { name: 'Currently down for', value: downDuration || 'N/A', inline: true }
                )
                .setColor(isUp ? 0x00FF00 : 0xFF0000)
                .setFooter({ text: `Last updated` })
                .setTimestamp();

            // Envoie le message directement dans le channel et récupère l'objet Message
            const sentMessage = await channel.send({ embeds: [embed] });

            // Save message ID
            if (!trackMessages[interaction.guildId]) trackMessages[interaction.guildId] = {};
            trackMessages[interaction.guildId][botUser.id] = {
                channelId: channel.id,
                messageId: sentMessage.id
            };
            saveTrackMessages();

            // Répond à l'utilisateur que le suivi a commencé
            await interaction.reply({ content: `Tracking started for ${botUser.tag}!`, ephemeral: true });

            // Start updates every 30 seconds
            const intervalId = setInterval(() => updateEmbed(client, interaction.guildId, botUser.id), 60000);
            updateIntervals.set(`${interaction.guildId}-${botUser.id}`, intervalId);
            
            console.log(`New tracking started for ${botUser.tag} in ${interaction.guild.name}`);
        }
        
        if (interaction.commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('📖 BotWatch Help')
                .setDescription('Here are all the available commands:')
                .addFields(
                    { name: '/track <bot>', value: 'Start tracking a bot\'s uptime in this server.' },
                    { name: '/untrack <bot>', value: 'Stop tracking a bot\'s uptime.' },
                    { name: '/botinfo <bot>', value: 'Show detailed information about a tracked bot.' },
                    { name: '/average', value: 'Calculate the average uptime of all tracked bots.' },
                    { name: '/refresh', value: 'Force update all uptime embeds.' },
                    { name: '/debug', value: 'Show debug information about tracking.' },
                    { name: '/help', value: 'Show this help message.' }
                )
                .setColor(0xFF7F50)
                .setFooter({ text: 'BotWatch — Automated Bot Monitoring' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        
        if (interaction.commandName === 'untrack') {
            const botUser = interaction.options.getUser('bot');
            if (!botUser.bot) 
                return interaction.reply({ content: 'This is not a bot!', ephemeral: true });

            if (trackMessages[interaction.guildId]?.[botUser.id]) {
                // Stop update interval
                const intervalId = updateIntervals.get(`${interaction.guildId}-${botUser.id}`);
                if (intervalId) {
                    clearInterval(intervalId);
                    updateIntervals.delete(`${interaction.guildId}-${botUser.id}`);
                }
                
                // Remove reference
                delete trackMessages[interaction.guildId][botUser.id];
                if (Object.keys(trackMessages[interaction.guildId]).length === 0) {
                    delete trackMessages[interaction.guildId];
                }
                saveTrackMessages();
                
                await interaction.reply({ content: `Tracking of ${botUser.tag} stopped.`, ephemeral: true });
                console.log(`Tracking stopped for ${botUser.tag} in ${interaction.guild.name}`);
            } else {
                await interaction.reply({ content: `This bot is not tracked on this server.`, ephemeral: true });
            }
        }
        
        if (interaction.commandName === 'average') {
            const guildTracks = trackMessages[interaction.guildId] || {};
            const botIds = Object.keys(guildTracks);

            if (botIds.length === 0) {
                return interaction.reply({ content: 'No bots are being tracked on this server.', ephemeral: true });
            }

            let totalPercent = 0;
            let count = 0;

            const now = Date.now();
            const MAX_TRACK = 30 * 24 * 60 * 60 * 1000; // 30 jours

            botIds.forEach(botId => {
                const data = uptimeData[botId];
                if (data) {
                    // CORRECTION : Utilisation de la nouvelle fonction pour chaque bot
                    const uptimePercent = parseFloat(calculateUptimePercent(data));
                    totalPercent += uptimePercent;
                    count++;
                }
            });

            const averagePercent = count > 0 ? (totalPercent / count).toFixed(2) : '100.00';

            const embed = new EmbedBuilder()
                .setTitle('Average Uptime of Tracked Bots')
                .setDescription(`The average uptime of **${count}** tracked bots over the last 30 days is **${averagePercent}%**`)
                .setColor(0x00FFFF)
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }
        
        if (interaction.commandName === 'botinfo') {
            const botUser = interaction.options.getUser('bot');
            if (!botUser.bot) 
                return interaction.reply({ content: 'This is not a bot!', ephemeral: true });
                
            const member = await interaction.guild.members.fetch(botUser.id).catch(() => null);
            if (!member) 
                return interaction.reply({ content: 'This bot is not on this server!', ephemeral: true });
                
            const status = member.presence?.status || 'offline';
            const isUp = status !== 'offline';
            
            const data = uptimeData[botUser.id] || { 
                totalUptime: 0, 
                totalDowntime: 0, 
                statusChanges: 0,
                firstTracked: Date.now()
            };
            
            // Ensure firstTracked is set
            if (!data.firstTracked) {
                data.firstTracked = Date.now();
            }
            
            // CORRECTION : Utilisation de la nouvelle fonction pour calculer l'uptime
            const uptimePercent = calculateUptimePercent(data);
                
            const statusEmoji = isUp ? '✅' : '❌';
            const statusText = isUp ? 'Online' : 'Offline';
            const now = Date.now();
            const upDuration = isUp ? formatSince(now - (data.lastUp || now)) : null;
            const downDuration = !isUp ? formatSince(now - (data.lastDown || now)) : null;

            const embed = new EmbedBuilder()
                .setTitle(`Status of ${member.user.tag}`)
                .setThumbnail(member.user.displayAvatarURL())
                .addFields(
                    { name: 'Current status', value: `${statusEmoji} ${statusText}`, inline: true },
                    { name: 'Uptime (30d)', value: `${uptimePercent}%`, inline: true },
                    { name: 'Total online time', value: formatUptime(data.totalUptime), inline: false },
                    { name: 'Status changes', value: data.statusChanges.toString(), inline: true },
                    { name: 'Tracked since', value: `<t:${Math.floor(data.firstTracked / 1000)}:R>`, inline: false },
                    { name: 'Currently up for', value: upDuration || 'N/A', inline: true },
                    { name: 'Currently down for', value: downDuration || 'N/A', inline: true }
                )
                .setColor(isUp ? 0x00FF00 : 0xFF0000)
                .setFooter({ text: `Last updated` })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        }
        
        if (interaction.commandName === 'refresh') {
            // Force update all embeds
            for (const guildId in trackMessages) {
                for (const botId in trackMessages[guildId]) {
                    updateEmbed(client, guildId, botId);
                }
            }
            await interaction.reply({ content: 'Update of all embeds requested!', ephemeral: true });
            console.log(`Forced update requested by ${interaction.user.tag}`);
        }
        
        if (interaction.commandName === 'debug') {
            // Debug command to show current tracking status
            const guildTracks = trackMessages[interaction.guildId] || {};
            const trackCount = Object.keys(guildTracks).length;
            
            let debugInfo = `**Tracking Debug Information**\n`;
            debugInfo += `Bots currently tracked: ${trackCount}\n\n`;
            
            if (trackCount > 0) {
                debugInfo += "**Tracked Bots:**\n";
                for (const botId in guildTracks) {
                    const botData = guildTracks[botId];
                    debugInfo += `- <@${botId}> in <#${botData.channelId}>\n`;
                }
            }
            
            debugInfo += `\n**Data Files:**\n`;
            debugInfo += `Uptime data: ${fs.existsSync(DATA_FILE) ? '✅ Exists' : '❌ Missing'}\n`;
            debugInfo += `Track messages: ${fs.existsSync(TRACK_FILE) ? '✅ Exists' : '❌ Missing'}\n`;
            
            await interaction.reply({ content: debugInfo, ephemeral: true });
        }
    } catch (error) {
        console.error('Error processing command:', error);
        await interaction.reply({ content: 'An error occurred while processing the command.', ephemeral: true });
    }
});

// Clean shutdown handling
process.on('SIGINT', () => {
    console.log('Shutting down bot...');
    // Save data before exiting
    saveData();
    saveTrackMessages();
    // Clean up all intervals
    updateIntervals.forEach(interval => clearInterval(interval));
    client.destroy();
    process.exit(0);
});

// Load data on startup
loadData();

app.get('/', (req, res) => {
    const auth = req.query.password; // Récupère le mot de passe depuis l'URL

    if (!auth || auth !== process.env.PASSWORD) {
        return res.status(401).send(`
  <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
            <h1>Accès refusé</h1>
        <style>
            body { font-family: Arial, sans-serif; background: #111; color: #eee; padding: 20px; }
            h1 { color: orange; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { padding: 10px; border: 1px solid #333; text-align: left; }
            th { background-color: #222; }
            tr:nth-child(even) { background-color: #1a1a1a; }
        </style>
        <meta http-equiv="refresh" content="30">
            <p>Vous devez fournir le mot de passe correct pour voir cette page.</p>
            <form method="get">
                <input type="password" name="password" placeholder="Mot de passe">
                <button type="submit">Valider</button>
            </form>
        `);
    }

    // Si le mot de passe est correct, on affiche le tableau
    let html = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <title>Bot Uptime Dashboard</title>
        <style>
            body { font-family: Arial, sans-serif; background: #111; color: #eee; padding: 20px; }
            h1 { color: orange; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { padding: 10px; border: 1px solid #333; text-align: left; }
            th { background-color: #222; }
            tr:nth-child(even) { background-color: #1a1a1a; }
        </style>
        <meta http-equiv="refresh" content="30">
    </head>
    <script defer data-domain="79.99.40.71" src="https://plausible.io/js/script.file-downloads.hash.outbound-links.pageview-props.revenue.tagged-events.js"></script>
<script>window.plausible = window.plausible || function() { (window.plausible.q = window.plausible.q || []).push(arguments) }</script>
    <body>
        <h1>Bot Uptime Dashboard</h1>
        <table>
            <tr>
                <th>Bot</th>
                <th>Status</th>
                <th>Total Uptime</th>
                <th>Total Downtime</th>
                <th>Status Changes</th>
                <th>Tracked Since</th>
                <th>Uptime %</th>
            </tr>
    `;

    for (const botId in uptimeData) {
        const data = uptimeData[botId];
        const isUp = data.lastStatus !== 'offline';
        const uptimePercent = calculateUptimePercent(data);
        html += `
        <tr>
            <td>${botId}</td>
            <td>${isUp ? '✅ Online' : '❌ Offline'}</td>
            <td>${formatUptime(data.totalUptime)}</td>
            <td>${formatUptime(data.totalDowntime)}</td>
            <td>${data.statusChanges}</td>
            <td>${new Date(data.firstTracked).toLocaleString()}</td>
            <td>${uptimePercent}%</td>
        </tr>
        `;
    }

    html += `
        </table>
    </body>
    </html>
    `;

    res.send(html);
});

// Lancer le serveur
app.listen(PORT, () => {
    console.log(`Bot dashboard running at http://localhost:${PORT}`);
});

client.login(process.env.TOKEN);
