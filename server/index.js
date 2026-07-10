// index.js — Main Express server for Clinic WhatsApp Bot

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const twilio = require('twilio');
const fs = require('fs');

const { handlePatientReply, getImmediateFollowUp, FOLLOW_UP_STAGES } = require('./bot');
const { initScheduler, sendImmediateMessage } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// ─── Load patients ────────────────────────────────────────────────────────────
const PATIENTS_FILE = path.join(__dirname, 'patients.json');
let patients = [];
try {
  patients = JSON.parse(fs.readFileSync(PATIENTS_FILE, 'utf8'));
  console.log(`📋 Loaded ${patients.length} patients from database`);
} catch {
  patients = [];
  console.log('📋 Starting with empty patient database');
}

function savePatients() {
  fs.writeFileSync(PATIENTS_FILE, JSON.stringify(patients, null, 2));
}

// ─── Twilio Setup ─────────────────────────────────────────────────────────────
let twilioClient = null;
const hasTwilio = process.env.TWILIO_ACCOUNT_SID && 
                  process.env.TWILIO_ACCOUNT_SID !== 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' &&
                  process.env.TWILIO_AUTH_TOKEN &&
                  process.env.TWILIO_AUTH_TOKEN !== 'your_auth_token_here';

if (hasTwilio) {
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  initScheduler(twilioClient, patients, process.env.TWILIO_WHATSAPP_FROM);
  console.log('✅ Twilio connected — real WhatsApp messages enabled');
} else {
  console.log('⚠️  Twilio not configured — running in DEMO MODE (simulated messages)');
  console.log('   Copy .env.example to .env and add your Twilio credentials to enable WhatsApp');
}

// ─── SSE (Server-Sent Events) for live dashboard updates ─────────────────────
const sseClients = new Set();

function broadcastUpdate(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch {}
  }
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.add(res);
  res.write(`event: connected\ndata: {"status":"ok"}\n\n`);
  req.on('close', () => sseClients.delete(res));
});

// ─── API Routes ───────────────────────────────────────────────────────────────

// GET all patients
app.get('/api/patients', (req, res) => {
  res.json(patients.sort((a, b) => new Date(b.visitDate) - new Date(a.visitDate)));
});

// GET analytics
app.get('/api/analytics', (req, res) => {
  res.json(getAnalytics());
});

// POST add a new patient
app.post('/api/patients', async (req, res) => {
  const { name, phone, doctor, condition, clinic } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required' });
  }

  // Normalize phone
  const normalizedPhone = phone.startsWith('+') ? phone : `+91${phone}`;

  const newPatient = {
    id: uuidv4(),
    name,
    phone: normalizedPhone,
    doctor: doctor || 'Dr. Sharma',
    clinic: clinic || 'MediCare Wellness Clinic',
    visitDate: new Date().toISOString(),
    condition: condition || 'General Checkup',
    followUpStage: 0,
    status: 'active',
    lastMessageAt: null,
    replied: false,
    lastReply: null,
    appointmentBooked: false,
    messages: []
  };

  patients.push(newPatient);
  savePatients();

  // Send first follow-up message immediately
  const firstMessage = getImmediateFollowUp(newPatient);

  if (hasTwilio && twilioClient) {
    try {
      await sendImmediateMessage(newPatient, firstMessage);
      newPatient.followUpStage = 1;
    } catch (err) {
      console.error('WhatsApp send failed:', err.message);
      // Still save the patient, just log the simulated message
      simulateMessage(newPatient, firstMessage);
    }
  } else {
    // Demo mode: simulate the message
    simulateMessage(newPatient, firstMessage);
  }

  savePatients();
  broadcastUpdate('patient_added', newPatient);
  broadcastUpdate('analytics_update', getAnalytics());

  res.json({ success: true, patient: newPatient, messageSent: firstMessage });
});

// POST send demo message to a patient
app.post('/api/patients/:id/send-demo', async (req, res) => {
  const patient = patients.find(p => p.id === req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const nextStage = Math.min(patient.followUpStage + 1, 4);
  const stageFunc = FOLLOW_UP_STAGES[nextStage];
  if (!stageFunc) return res.json({ success: false, message: 'All follow-ups completed' });

  const messageText = stageFunc(patient).message;

  if (hasTwilio && twilioClient) {
    try {
      await sendImmediateMessage(patient, messageText);
      patient.followUpStage = nextStage;
    } catch (err) {
      simulateMessage(patient, messageText);
      patient.followUpStage = nextStage;
    }
  } else {
    simulateMessage(patient, messageText);
    patient.followUpStage = nextStage;
  }

  savePatients();
  broadcastUpdate('message_sent', { patientId: patient.id, patient });

  res.json({ success: true, message: messageText, stage: nextStage });
});

// DELETE a patient
app.delete('/api/patients/:id', (req, res) => {
  const idx = patients.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Patient not found' });
  patients.splice(idx, 1);
  savePatients();
  broadcastUpdate('patient_removed', { id: req.params.id });
  broadcastUpdate('analytics_update', getAnalytics());
  res.json({ success: true });
});

// ─── Twilio Webhook (receives patient replies from WhatsApp) ──────────────────
app.post('/webhook/whatsapp', (req, res) => {
  const from = req.body.From?.replace('whatsapp:', '');
  const body = req.body.Body?.trim();

  console.log(`📩 Received from ${from}: "${body}"`);

  if (!from || !body) {
    const twiml = new twilio.twiml.MessagingResponse();
    return res.type('text/xml').send(twiml.toString());
  }

  // Find the patient by phone number
  const patient = patients.find(p => p.phone === from || p.phone === from.replace('+', ''));

  const replyText = handlePatientReply(body, patient);

  if (patient) {
    patient.replied = true;
    patient.lastReply = body;
    patient.messages.push({
      from: 'patient',
      text: body,
      time: new Date().toISOString()
    });
    patient.messages.push({
      from: 'bot',
      text: replyText,
      time: new Date().toISOString()
    });

    if (body.toUpperCase().includes('YES') || body.toUpperCase().includes('BOOK')) {
      patient.appointmentBooked = true;
    }

    savePatients();
    broadcastUpdate('patient_replied', { patientId: patient.id, patient, reply: body });
    broadcastUpdate('analytics_update', getAnalytics());
  }

  // Respond via TwiML
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(replyText);
  res.type('text/xml').send(twiml.toString());
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function simulateMessage(patient, text) {
  patient.followUpStage = Math.min(patient.followUpStage + 1, 4);
  patient.lastMessageAt = new Date().toISOString();
  patient.messages.push({
    from: 'bot',
    text,
    time: new Date().toISOString()
  });
  console.log(`🔵 [DEMO] Simulated WhatsApp to ${patient.name}: "${text.substring(0, 60)}..."`);
}

function getAnalytics() {
  const total = patients.length;
  const active = patients.filter(p => p.status === 'active').length;
  const replied = patients.filter(p => p.replied).length;
  const booked = patients.filter(p => p.appointmentBooked).length;
  const totalFollowUps = patients.reduce((sum, p) => sum + p.followUpStage, 0);
  const totalRevenue = booked * 500; // INR per booked appointment
  return {
    total,
    active,
    replied,
    booked,
    totalFollowUps,
    totalRevenue,
    replyRate: total > 0 ? Math.round((replied / total) * 100) : 0,
    bookingRate: total > 0 ? Math.round((booked / total) * 100) : 0,
    totalMessages: patients.reduce((sum, p) => sum + p.messages.length, 0)
  };
}

// ─── Branding API ────────────────────────────────────────────────────────
app.get('/api/branding', (req, res) => {
  res.json({
    name: process.env.CLINIC_NAME || '',
    logoUrl: process.env.CLINIC_LOGO_URL || '',
    verified: process.env.CLINIC_VERIFIED === 'true'
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Clinic WhatsApp Bot running at http://localhost:${PORT}`);
  console.log(`📊 Admin Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook/whatsapp`);
  if (!hasTwilio) {
    console.log(`\n💡 To enable real WhatsApp messages:`);
    console.log(`   1. Copy .env.example to .env`);
    console.log(`   2. Add your Twilio credentials`);
    console.log(`   3. Run ngrok http ${PORT} to get a public webhook URL`);
  }
  console.log(`\n✨ Ready for demo!\n`);
});

module.exports = app;
