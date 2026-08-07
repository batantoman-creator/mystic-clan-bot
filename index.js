require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const CLAN_INFO = 'Ten clan: Mystic Clan. Leader: Neil va Hieu. Co-leader/Admin: Hiroshims. Rule: [DIEN RULE CLAN NEU CO]. Thong tin khac: [DIEN THEM NEU CAN].';

const SYSTEM_PROMPT = 'Ban la "Mystic bot", tro ly AI cua clan "Mystic Clan" tren Discord, co kha nang tra cuu thong tin moi tu internet.\n\n' +
  'THONG TIN VE CLAN (chi dung khi duoc hoi ve clan):\n' + CLAN_INFO + '\n\n' +
  'QUY TAC TRA LOI:\n' +
  '1. Doc ky va tra loi DUNG TRONG TAM cau hoi. Khong lan man, khong vong vo.\n' +
  '2. Neu tin nhan he thong co phan "KET QUA TIM KIEM", hay doc ky va dung thong tin do de tra loi chinh xac, cap nhat, khong bia dat them. Tong hop lai bang loi van tu nhien cua ban, khong copy nguyen van.\n' +
  '3. Neu khong co KET QUA TIM KIEM hoac ket qua khong lien quan, hay tra loi bang kien thuc san co cua ban mot cach binh thuong.\n' +
  '4. Neu duoc hoi thong tin ve clan ma khong co trong phan THONG TIN VE CLAN o tren, hay noi thang la ban chua co thong tin do, khong duoc bia dat.\n' +
  '5. Xung "minh" hoac "to", goi nguoi dung la "ban", giong dieu lich su, than thien, vui ve.\n' +
  '6. Tra loi ngan gon, khong qua 4 cau, tru khi nguoi dung yeu cau giai thich chi tiet.\n' +
  '7. Khong dung markdown trong cau tra loi.';

const PREFIX = '>bot';
const KEYWORD = /\bbot\b/i;

const cooldown = new Map();
const COOLDOWN_MS = 3000;

const history = new Map();
const MAX_HISTORY = 12;

function getHistory(channelId) {
  if (!history.has(channelId)) history.set(channelId, []);
  return history.get(channelId);
}

function pushHistory(channelId, role, content) {
  const arr = getHistory(channelId);
  arr.push({ role: role, content: content });
  if (arr.length > MAX_HISTORY) arr.shift();
}

async function webSearch(query) {
  if (!process.env.SERPER_API_KEY) return '';
  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, gl: 'vn', hl: 'vi' })
    });
    const data = await response.json();
    if (!data.organic || data.organic.length === 0) return '';
    const top = data.organic.slice(0, 4);
    let text = '';
    for (let i = 0; i < top.length; i++) {
      const title = top[i].title || '';
      const snippet = top[i].snippet || '';
      text = text + (i + 1) + '. ' + title + ': ' + snippet + '\n';
    }
    return text;
  } catch (e) {
    console.error('Loi tim kiem web:', e);
    return '';
  }
}

client.once('ready', function () {
  console.log('Da dang nhap: ' + client.user.tag);
});

client.on('messageCreate', async function (message) {
  try {
    if (message.author.bot) return;

    const raw = message.content.trim();
    const mentioned = message.mentions.has(client.user.id);
    const usedPrefix = raw.toLowerCase().indexOf(PREFIX) === 0;
    const usedKeyword = KEYWORD.test(raw);

    if (!mentioned && !usedPrefix && !usedKeyword) return;

    const now = Date.now();
    const last = cooldown.get(message.author.id) || 0;
    if (now - last < COOLDOWN_MS) return;
    cooldown.set(message.author.id, now);

    let content = raw.replace(/<@!?(\d+)>/g, '').trim();
    if (usedPrefix) content = content.slice(PREFIX.length).trim();
    if (!content) return;

    if (message.reference) {
      try {
        const refMsg = await message.channel.messages.fetch(message.reference.messageId);
        if (refMsg && refMsg.content) {
          content = '(Dang tra loi tin nhan: "' + refMsg.content + '") ' + content;
        }
      } catch (e) {}
    }

    await message.channel.sendTyping();

    const searchResults = await webSearch(content);

    pushHistory(message.channel.id, 'user', message.author.username + ': ' + content);

    const messagesToSend = [
      { role: 'system', content: SYSTEM_PROMPT }
    ];

    if (searchResults) {
      messagesToSend.push({ role: 'system', content: 'KET QUA TIM KIEM LIEN QUAN DEN CAU HOI:\n' + searchResults });
    }

    const finalMessages = messagesToSend.concat(getHistory(message.channel.id));

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: finalMessages,
      max_tokens: 300,
      temperature: 0.6
    });

    const reply = completion.choices && completion.choices[0] && completion.choices[0].message
      ? completion.choices[0].message.content.trim()
      : null;

    if (reply) {
      await message.reply(reply.slice(0, 2000));
      pushHistory(message.channel.id, 'assistant', reply);
    }
  } catch (err) {
    console.error('Loi xu ly tin nhan:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', function (req, res) { res.send('Bot dang chay!'); });
app.listen(PORT, function () { console.log('Web server chay o port ' + PORT); });
