import {setTimeout as delay} from 'node:timers/promises';
import {DiscordClient} from '../dist/discord.js';
import {DISCORD_CLIENT_ID} from '../dist/constants.js';
const id = process.argv[2] ?? process.env.DISCORD_CLIENT_ID ?? DISCORD_CLIENT_ID;
if (!/^\d{17,20}$/.test(id ?? '')) throw new Error('Pass a Discord Application ID');
const client = new DiscordClient(id, undefined, undefined, console.error);
async function acknowledged() {
  const start = Date.now();
  while (!client.acknowledged) {
    if (Date.now() - start > 15_000) throw new Error(`No Discord acknowledgement (${client.status})`);
    await delay(100);
  }
}
try {
  const name = 'Testing presence images';
  client.setActivity({type: 0, name, details: 'Working', state: 'Checking Discord title updates', timestamps: {start: Math.floor(Date.now() / 1000)}, assets: {large_image: 'https://cdn.discordapp.com/embed/avatars/0.png', large_text: 'Testing a custom image', small_image: 'https://cdn.discordapp.com/embed/avatars/1.png', small_text: 'Testing a small image'}, buttons: [{label: 'Documentation', url: 'https://discord.com/developers/docs/topics/rpc'}]});
  client.start();
  await acknowledged(); console.log('Discord acknowledged SET_ACTIVITY');
  console.log('Discord returned activity:', JSON.stringify(client.acknowledgedActivity));
  if (client.acknowledgedActivity?.name !== name) throw new Error('Discord did not return the requested summary title');
  if (!client.acknowledgedActivity?.assets?.large_image || !client.acknowledgedActivity?.assets?.small_image) throw new Error('Discord did not return the requested images');
  if (client.acknowledgedActivity.assets.large_text !== 'Testing a custom image') throw new Error('Discord did not return the image hover text');
  client.setActivity(null);
  await acknowledged(); console.log('Discord acknowledged clearing activity');
} finally { client.stop(); }
