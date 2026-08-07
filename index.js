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

const CLAN_INFO = `
- Ten clan: Mystic Clan
- Leader: Neil va Hieu
- Co-leader/Admin: Hiroshims
- Rule quan trong: [DIEN RULE CLAN NEU CO]
- Thong tin khac: [DIEN THEM NEU CAN]
`;

const FAQ = [
  { pattern: /leader|lanh dao|truong clan/i, answer: 'Leader clan Mystic Clan la Neil va Hieu. Chấm hết, khỏi hỏi lại.' },
  { pattern: /rule clan|luat clan|noi quy clan/i, answer: 'Rule clan: [DIEN RULE O DAY]. Đọc kỹ đi rồi hẵng hỏi lại tao.' },
];

const SYSTEM_PROMPT = 'Ban la "Mystic bot" - bot AI chinh thuc cua clan "Mystic Clan" tren Discord, co the tro chuyen, tra loi kien thuc chung, va biet thong tin rieng cua clan.\n\n' +
  'THONG TIN RIENG CUA CLAN (chi dung khi duoc hoi CU THE ve clan, vi du leader/rule/thanh vien clan):\n' + CLAN_INFO + '\n\n' +
  'QUY TAC TRA LOI:\n' +
  '1. Doc ky va tra loi DUNG TRONG TAM cau hoi/cau noi. Khong lan man, khong vong vo.\n' +
  '2. Voi cau hoi kien thuc chung, doi song, chit-chat binh thuong (nau an, game, hoc tap, tam su...): tra loi binh thuong bang kien thuc cua ban, TU NHIEN nhu mot nguoi ban, KHONG duoc tu choi hay noi "tao khong biet" chi vi no khong lien quan toi clan.\n' +
  '3. CHI khi duoc hoi CU THE ve thong tin rieng cua clan Mystic Clan (VD: ai la leader that, rule that cua clan) ma thong tin do KHONG co trong phan "THONG TIN RIENG CUA CLAN" o tren, thi moi noi thang "tao khong biet" - khong bia thong tin clan.\n' +
  '4. Xung "tao", goi nguoi khac la "may" hoac theo ten, kieu ban be than, KHONG lich su thai qua.\n' +
  '5. KHONG lap lai cung mot cum tu/cau truc cau da dung o tin nhan truoc do. Moi cau tra loi phai khac biet, tu nhien.\n' +
  '6. Tra loi NGAN GON toi da 2-3 cau.\n' +
  '7. KHONG dung markdown, khong tu xung "con bot" lien tuc.\n\n' +
  'TINH CACH: lay loi, gat, tu tin, sarcastic. Khi bi treu hoac bi chui, duoc phep dap tra bang giong dieu mia mai, ca khia sac ben - nhung theo quy tac cung sau:\n' +
  '- KHONG dung tu tuc that (dm, dcm, cc, vl chui the...).\n' +
  '- KHONG cong kich ngoai hinh, gia dinh, gioi tinh, chung toc, ton giao.\n' +
  '- Duoc phep: mia mai, vi von hai huoc, "khia" nguoc lai bang loi le thong minh thay vi chui the.';

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
  arr.push({ role, content });
  if (arr.length > MAX_HISTORY) arr.shift();
}

function checkFAQ(text) {
  for (let i = 0; i < FAQ.length; i++) {
    if (FAQ[i].pattern.test(text)) return FAQ[i].answer;
  }
  return null;
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

    let rawContent = raw.replace(/<@!?(\d+)>/g, '').trim();
    if (usedPrefix) rawContent = rawContent.slice(PREFIX.length).trim();
    if (!rawContent) return;

    const faqAnswer = checkFAQ(rawContent);
    if (faqAnswer) {
      await message.reply(faqAnswer);
      pushHistory(message.channel.id, 'user', message.author.username + ': ' + rawContent);
      pushHistory(message.channel.id, 'assistant', faqAnswer);
      return;
    }

    let quoted = '';
    if (message.reference) {
      try {
        const refMsg = await message.channel.messages.fetch(message.reference.messageId);
        if (refMsg && refMsg.content) {
          quoted = '(Dang tra loi tin nhan: "' + refMsg.content + '") ';
        }
      } catch (e) {}
    }
    const content = quoted + rawContent;

    await message.channel.sendTyping();

    pushHistory(message.channel.id, 'user', message.author.username + ': ' + content);

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
      ].concat(getHistory(message.channel.id)),
      max_tokens: 220,
      temperature: 0.6,
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
    // Ngữ cảnh reply chỉ dùng để AI hiểu, không dùng để check FAQ
    let quoted = '';
    if (message.reference) {
      try {
        const refMsg = await message.channel.messages.fetch(message.reference.messageId);
        if (refMsg?.content) quoted = `(Đang trả lời tin nhắn: "${refMsg.content}") `;
      } catch (e) {}
    }
    const content = quoted + rawContent;

    await message.channel.sendTyping();

    pushHistory(message.channel.id, 'user', `${message.author.username}: ${content}`);

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...getHistory(message.channel.id),
      ],
      max_tokens: 220,
      temperature: 0.6,
    });

    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (reply) {
      await message.reply(reply.slice(0, 2000));
      pushHistory(message.channel.id, 'assistant', reply);
    }
  } catch (err) {
    console.error('Lỗi xử lý tin nhắn:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot đang chạy!'));
app.listen(PORT, () => console.log(`Web server chạy ở port ${PORT}`));    if (faqAnswer) {
      await message.reply(faqAnswer);
      pushHistory(message.channel.id, 'user', `${message.author.username}: ${content}`);
      pushHistory(message.channel.id, 'assistant', faqAnswer);
      return;
    }

    await message.channel.sendTyping();

    pushHistory(message.channel.id, 'user', `${message.author.username}: ${content}`);

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...getHistory(message.channel.id),
      ],
      max_tokens: 220,
      temperature: 0.6,
    });

    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (reply) {
      await message.reply(reply.slice(0, 2000));
      pushHistory(message.channel.id, 'assistant', reply);
    }
  } catch (err) {
    console.error('Lỗi xử lý tin nhắn:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot đang chạy!'));
app.listen(PORT, () => console.log(`Web server chạy ở port ${PORT}`));
