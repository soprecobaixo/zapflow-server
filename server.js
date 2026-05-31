const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.API_KEY || '';

app.use((req, res, next) => {
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

let sock = null;
let currentQR = null;
let isConnected = false;
let connectedPhone = '';

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  sock = makeWASocket({ auth: state, printQRInTerminal: true });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) { currentQR = await qrcode.toDataURL(qr); isConnected = false; }
    if (connection === 'close') {
      isConnected = false; connectedPhone = '';
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) setTimeout(startSock, 3000);
    } else if (connection === 'open') {
      isConnected = true; currentQR = null;
      connectedPhone = sock.user?.id?.split(':')[0] || '';
      console.log('WhatsApp conectado:', connectedPhone);
    }
  });
}

startSock();

app.get('/qr', (req, res) => {
  if (isConnected) return res.json({ status: 'connected', phone: connectedPhone });
  if (currentQR) return res.json({ qr: currentQR });
  res.json({ status: 'waiting' });
});

app.get('/status', (req, res) => {
  res.json({ status: isConnected ? 'connected' : 'disconnected', phone: connectedPhone, qr: currentQR || null });
});

app.post('/send', async (req, res) => {
  const { phone, message } = req.body;
  if (!isConnected) return res.status(400).json({ error: 'WhatsApp nao conectado' });
  if (!phone || !message) return res.status(400).json({ error: 'phone e message sao obrigatorios' });
  const jid = phone.includes('@') ? phone : (phone.includes('-') || phone.length > 15)
    ? phone + '@g.us' : phone + '@s.whatsapp.net';
  await sock.sendMessage(jid, { text: message });
  res.json({ success: true, message_id: Date.now().toString() });
});

app.post('/disconnect', async (req, res) => {
  if (sock) await sock.logout();
  isConnected = false; currentQR = null; connectedPhone = '';
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor rodando na porta', PORT));
