# AFK Bots (20-Bot Setup)

Twenty Discord bots running simultaneously in the same project.

## Overview

This project runs twenty separate Discord AFK bots. Each bot has its own credentials and independent voice channel connections.

## Setup

### Required Secrets

The following secrets must be set in Replit:
- `BOT1_TOKEN` to `BOT20_TOKEN`: Tokens for the bots
- `CLIENT_ID_1` to `CLIENT_ID_20`: Application IDs for the bots
- `DISCORD_GUILD_ID`: The ID of the server where commands are registered
- `DISCORD_OWNER_ID`: Your Discord User ID (for admin commands)

## Running the Bots

The bots run via the "Discord Bot" workflow which executes `npm start`. All bots log in automatically.

## Commands

Each bot registers the following commands:

- `/join`: Makes the specific bot join your current voice channel (Admin/Owner only).
- `/move`: Moves the specific bot to your current voice channel (Admin/Owner only).
- `/leave`: Makes the specific bot leave any voice channel (Admin/Owner only).
- `/vcstatus`: Reports internal state vs actual voice connection state.
- `/healthcheck`: Shows uptime, ping, memory, and voice state.
- `/fixvoice`: Force-destroys voice connection and clears ghost states (Admin/Owner only).
- `/reset`: Fully refreshes the bot state and leaves calls (Admin/Owner only).
- `/uptime`: Shows how long the bot has been running.
- `/ping`: Returns bot latency.

## Project Structure

- `index.js` - Multi-bot implementation using a class-based approach.
- `package.json` - Node.js dependencies.

## Recent Changes

- 2026-01-10: Upgraded to 19-bot architecture and added `/move` command.
- 2026-01-10: Identified re-invitation requirements for Bots 1, 18, and 19 due to Missing Access errors. Fixed interaction safety for member voice states.
