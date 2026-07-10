// scheduler.js — Automated follow-up cron jobs

const cron = require('node-cron');
const { getNextFollowUp } = require('./bot');

let twilioClient = null;
let patientsRef = null;
let fromNumber = null;

function initScheduler(client, patients, from) {
  twilioClient = client;
  patientsRef = patients;
  fromNumber = from;

  console.log('⏰ Scheduler initialized');

  // Run every hour and check which patients need follow-up
  cron.schedule('0 * * * *', () => {
    console.log('🔄 Running scheduled follow-up check...');
    checkAndSendFollowUps();
  });

  // Also run every minute in demo mode (for testing)
  if (process.env.DEMO_MODE === 'true') {
    console.log('⚡ Demo mode: running scheduler every minute');
    cron.schedule('* * * * *', () => {
      checkAndSendFollowUps(true);
    });
  }
}

async function checkAndSendFollowUps(demoMode = false) {
  if (!patientsRef || !twilioClient) return;

  const now = new Date();

  for (const patient of patientsRef) {
    if (patient.status !== 'active') continue;

    const visitDate = new Date(patient.visitDate);
    const hoursSinceVisit = (now - visitDate) / (1000 * 60 * 60);
    const followUpsDue = getFollowUpsDue(hoursSinceVisit, patient.followUpStage, demoMode);

    if (followUpsDue && patient.followUpStage < 4) {
      await sendFollowUp(patient);
    }
  }
}

function getFollowUpsDue(hoursSinceVisit, currentStage, demoMode) {
  if (demoMode) {
    // In demo mode, just check if stage needs to advance (don't actually auto-send in demo)
    return false;
  }

  // Stage timing thresholds (hours since visit)
  const STAGE_THRESHOLDS = {
    0: 2,    // Send stage 1 after 2 hours
    1: 24,   // Send stage 2 after 24 hours
    2: 72,   // Send stage 3 after 3 days
    3: 168   // Send stage 4 after 7 days
  };

  const threshold = STAGE_THRESHOLDS[currentStage];
  return threshold && hoursSinceVisit >= threshold;
}

async function sendFollowUp(patient) {
  const nextFollowUp = getNextFollowUp(patient);
  if (!nextFollowUp) return;

  try {
    const message = await twilioClient.messages.create({
      from: fromNumber,
      to: `whatsapp:${patient.phone}`,
      body: nextFollowUp.message
    });

    // Update patient stage
    patient.followUpStage = nextFollowUp.stage;
    patient.lastMessageAt = new Date().toISOString();
    patient.messages.push({
      from: 'bot',
      text: nextFollowUp.message,
      time: new Date().toISOString()
    });

    console.log(`✅ Sent stage ${nextFollowUp.stage} follow-up to ${patient.name} (${message.sid})`);
    return message;
  } catch (error) {
    console.error(`❌ Failed to send follow-up to ${patient.name}:`, error.message);
  }
}

async function sendImmediateMessage(patient, messageText) {
  if (!twilioClient || !fromNumber) {
    throw new Error('Scheduler not initialized with Twilio client');
  }

  const message = await twilioClient.messages.create({
    from: fromNumber,
    to: `whatsapp:${patient.phone}`,
    body: messageText
  });

  patient.lastMessageAt = new Date().toISOString();
  patient.messages.push({
    from: 'bot',
    text: messageText,
    time: new Date().toISOString()
  });

  console.log(`📤 Sent immediate message to ${patient.name} (${message.sid})`);
  return message;
}

module.exports = { initScheduler, checkAndSendFollowUps, sendFollowUp, sendImmediateMessage };
