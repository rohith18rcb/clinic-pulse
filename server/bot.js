// bot.js — Conversation flow logic for clinic follow-up bot

// Load clinic branding from environment
const { CLINIC_NAME = "MediCare Wellness Clinic", CLINIC_LOGO_URL = "", CLINIC_VERIFIED = "false" } = process.env;


// Follow-up message sequences per stage
const FOLLOW_UP_STAGES = {
  1: (patient) => ({
    message: `Hi ${patient.name}! 👋 Hope your visit with ${patient.doctor} went well today at ${CLINIC_NAME}${CLINIC_VERIFIED === 'true' ? ' ✅' : ''}.\n\nHow are you feeling after your ${patient.condition.toLowerCase()} visit? Reply anytime — we're here to help! 😊${CLINIC_LOGO_URL ? "\n🖼️ " + CLINIC_LOGO_URL : ''}`,
    delay: 2 * 60 * 60 * 1000 // 2 hours after visit
  }),
  2: (patient) => ({
    message: `Good morning ${patient.name}! ☀️\n\nThis is a gentle reminder from ${CLINIC_NAME}${CLINIC_VERIFIED === 'true' ? ' ✅' : ''}.\n\n📋 Please remember to:\n• Take your medications as prescribed by ${patient.doctor}\n• Stay hydrated and rest well\n• Avoid strenuous activity if advised\n\nReply with any questions or if you feel unwell. We're here! 💊${CLINIC_LOGO_URL ? "\n🖼️ " + CLINIC_LOGO_URL : ''}`,
    delay: 24 * 60 * 60 * 1000 // 1 day after visit
  }),
  3: (patient) => ({
    message: `Hi ${patient.name}! 👋 It's been 3 days since your visit with ${patient.doctor}.\n\nQuick check-in:\n✅ How are you feeling overall?\n💊 Have you been taking your medications regularly?\n\nReply:\n• *GOOD* — if you're recovering well\n• *ISSUE* — if you have any concerns\n• *CALL* — if you need to speak to us urgently${CLINIC_LOGO_URL ? "\n🖼️ " + CLINIC_LOGO_URL : ''}`,
    delay: 3 * 24 * 60 * 60 * 1000 // 3 days
  }),
  4: (patient) => ({
    message: `Hi ${patient.name}! 🩺 Weekly check-in from ${CLINIC_NAME}${CLINIC_VERIFIED === 'true' ? ' ✅' : ''}.\n\nIt's been a week since your ${patient.condition} appointment. We hope you're feeling much better!\n\n📅 Would you like to book a follow-up appointment with ${patient.doctor}?\n\nReply:\n• *YES* to book an appointment\n• *NO* if you're all good\n• *CALL* to speak to our team${CLINIC_LOGO_URL ? "\n🖼️ " + CLINIC_LOGO_URL : ''}`,
    delay: 7 * 24 * 60 * 60 * 1000 // 7 days
  })
};

// Smart response handler based on patient reply
function handlePatientReply(message, patient) {
  const msg = message.trim().toUpperCase();
  const name = patient ? patient.name.split(' ')[0] : 'there';
  const clinic = patient ? patient.clinic : 'our clinic';
  const doctor = patient ? patient.doctor : 'your doctor';

  // Appointment booking intent
  if (msg === 'YES' || msg.includes('BOOK') || msg.includes('APPOINTMENT')) {
    if (patient) {
      patient.appointmentBooked = true;
    }
    return `✅ *Appointment Requested!*\n\nThank you ${name}! Our team will confirm your appointment with ${doctor} within 2 hours.\n\n📞 Or call us directly if you need an urgent slot.\n\nSee you soon! 😊 — ${clinic}`;
  }

  // Call request
  if (msg === 'CALL' || msg.includes('URGENT') || msg.includes('CALL US')) {
    return `📞 *We'll call you shortly!*\n\nHi ${name}, our team has been notified. Someone from ${clinic} will call you within 30 minutes.\n\nIf this is a medical emergency, please call 102 immediately. 🚑`;
  }

  // Concern / issue
  if (msg === 'ISSUE' || msg.includes('PAIN') || msg.includes('WORSE') || msg.includes('PROBLEM') || msg.includes('BAD')) {
    return `😟 We're sorry to hear you're having some issues, ${name}.\n\nPlease tell us more about what you're experiencing so we can help. Our medical team is available.\n\n📞 You can also call ${clinic} directly for immediate assistance.`;
  }

  // Doing well
  if (msg === 'GOOD' || msg === 'FINE' || msg === 'OKAY' || msg === 'OK' || msg.includes('BETTER') || msg.includes('GREAT') || msg.includes('WELL')) {
    return `That's wonderful to hear, ${name}! 🎉\n\nWe're so glad your recovery is going well. Keep it up!\n\n💊 Don't forget to complete your full course of medication if prescribed.\n\n— ${clinic} Team`;
  }

  // No / not needed
  if (msg === 'NO' || msg.includes('NOT NOW') || msg.includes('LATER')) {
    return `No problem, ${name}! 😊\n\nWe're here whenever you need us. Take care and stay healthy!\n\nFeel free to reach out anytime. — ${clinic}`;
  }

  // Help
  if (msg === 'HELP' || msg === 'STOP' || msg === 'UNSUBSCRIBE') {
    return `Hi ${name}! Here are your options:\n\n• *YES* — Book an appointment\n• *CALL* — Request a callback\n• *GOOD* — Confirm you're feeling well\n• *ISSUE* — Report a concern\n• *STOP* — Stop receiving messages\n\nThank you for choosing ${clinic}! 🏥`;
  }

  // Default / conversational fallback
  return `Thank you for the update, ${name}! 😊\n\nOur team at ${clinic} is always here if you need anything.\n\nReply *CALL* if you'd like us to reach out, or *YES* to book a follow-up appointment with ${doctor}.`;
}

// Get the next follow-up message for a patient
function getNextFollowUp(patient) {
  const nextStage = patient.followUpStage + 1;
  if (FOLLOW_UP_STAGES[nextStage]) {
    return {
      stage: nextStage,
      ...FOLLOW_UP_STAGES[nextStage](patient)
    };
  }
  return null; // No more follow-ups
}

// Get immediate first follow-up message (for demo)
function getImmediateFollowUp(patient) {
  return FOLLOW_UP_STAGES[1](patient).message;
}

module.exports = {
  FOLLOW_UP_STAGES,
  handlePatientReply,
  getNextFollowUp,
  getImmediateFollowUp
};
