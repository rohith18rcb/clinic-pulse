// app.js — Admin Dashboard Logic for ClinicPulse

// ─── State ───────────────────────────────────────────────────────────────────
let patients = [];
let selectedPatientId = null;
let currentFilter = 'all';
let eventSource = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadPatients();
  loadAnalytics();
  loadBranding();
  connectSSE();
  checkTwilioMode();
});

// ─── SSE (Live Updates) ───────────────────────────────────────────────────────
function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource('/api/events');

  eventSource.addEventListener('connected', () => {
    updateConnectionStatus(true);
  });

  eventSource.addEventListener('patient_added', (e) => {
    const patient = JSON.parse(e.data);
    const existing = patients.findIndex(p => p.id === patient.id);
    if (existing === -1) patients.unshift(patient);
    else patients[existing] = patient;
    renderPatientsList();
    toast('Patient Added', `Follow-up started for ${patient.name} 🎉`, 'success');
  });

  eventSource.addEventListener('patient_replied', (e) => {
    const { patientId, patient } = JSON.parse(e.data);
    const idx = patients.findIndex(p => p.id === patientId);
    if (idx !== -1) patients[idx] = patient;
    renderPatientsList();
    if (selectedPatientId === patientId) renderChat(patient);
    toast('Reply Received', `${patient.name} replied to your message! 💬`, 'info');
  });

  eventSource.addEventListener('message_sent', (e) => {
    const { patientId, patient } = JSON.parse(e.data);
    const idx = patients.findIndex(p => p.id === patientId);
    if (idx !== -1) patients[idx] = patient;
    renderPatientsList();
    if (selectedPatientId === patientId) renderChat(patient);
  });

  eventSource.addEventListener('patient_removed', (e) => {
    const { id } = JSON.parse(e.data);
    patients = patients.filter(p => p.id !== id);
    if (selectedPatientId === id) clearChat();
    renderPatientsList();
  });

  eventSource.addEventListener('analytics_update', (e) => {
    const stats = JSON.parse(e.data);
    updateAnalyticsUI(stats);
  });

  eventSource.onerror = () => {
    updateConnectionStatus(false);
    setTimeout(connectSSE, 3000);
  };
}

function updateConnectionStatus(online) {
  const dot = document.querySelector('.status-dot');
  const text = document.getElementById('statusText');
  if (online) {
    dot.style.background = 'var(--accent-green)';
    text.textContent = 'System Online';
  } else {
    dot.style.background = 'var(--accent-amber)';
    text.textContent = 'Reconnecting...';
  }
}

// ─── API Calls ────────────────────────────────────────────────────────────────
async function loadPatients() {
  try {
    const res = await fetch('/api/patients');
    patients = await res.json();
    renderPatientsList();
  } catch (err) {
    console.error('Failed to load patients:', err);
    toast('Error', 'Could not connect to server', 'error');
  }
}

async function loadAnalytics() {
  try {
    const res = await fetch('/api/analytics');
    const stats = await res.json();
    updateAnalyticsUI(stats);
  } catch {}
}

// Load clinic branding (name, logo, verification) and apply to UI
async function loadBranding() {
  try {
    const res = await fetch('/api/branding');
    const branding = await res.json();
    if (branding.logoUrl) {
      const logoImg = document.getElementById('clinicLogo');
      if (logoImg) {
        logoImg.src = branding.logoUrl;
        logoImg.style.display = 'inline';
      }
    }
    if (branding.verified) {
      const verifiedSpan = document.getElementById('clinicVerified');
      if (verifiedSpan) verifiedSpan.style.display = 'inline';
    }
    // Optionally replace navbar title with clinic name
    const titleH1 = document.querySelector('.navbar-brand h1');
    if (titleH1 && branding.name) titleH1.textContent = branding.name;
  } catch (e) {
    console.error('Branding load failed', e);
  }
}

async function checkTwilioMode() {
  try {
    // We detect mode by trying the server health check
    // If twilio is configured, server logs it — we check patients to infer
    const banner = document.getElementById('modeBanner');
    const modeText = document.getElementById('twilioMode');
    // Server logs demo mode; we keep UI in demo mode unless credentials confirmed
    // This is fine for the demo flow
  } catch {}
}

// ─── Add Patient ──────────────────────────────────────────────────────────────
async function addPatient(event) {
  event.preventDefault();

  const name = document.getElementById('patientName').value.trim();
  const phone = document.getElementById('patientPhone').value.trim();
  const doctor = document.getElementById('patientDoctor').value.trim();
  const condition = document.getElementById('patientCondition').value;
  const clinic = document.getElementById('clinicName').value.trim();

  if (!name || !phone) {
    toast('Validation Error', 'Name and phone number are required', 'error');
    return;
  }

  const btn = document.getElementById('addPatientBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Sending...';

  try {
    const res = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, doctor, condition, clinic })
    });

    const data = await res.json();

    if (data.success) {
      document.getElementById('patientForm').reset();
      document.getElementById('clinicName').value = 'MediCare Wellness Clinic';

      // Refresh list
      await loadPatients();
      await loadAnalytics();

      toast('🚀 Follow-up Started!', `First WhatsApp message sent to ${name}`, 'success');

      // Auto-select the new patient
      setTimeout(() => selectPatient(data.patient.id), 300);
    } else {
      toast('Error', data.error || 'Failed to add patient', 'error');
    }
  } catch (err) {
    toast('Error', 'Server connection failed', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>💬</span> Start Follow-up Sequence';
  }
}

// ─── Send Next Follow-up ──────────────────────────────────────────────────────
async function sendNextFollowUp() {
  if (!selectedPatientId) return;

  const btn = document.getElementById('sendNextBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Sending...';

  try {
    const res = await fetch(`/api/patients/${selectedPatientId}/send-demo`, {
      method: 'POST'
    });
    const data = await res.json();

    if (data.success) {
      await loadPatients();
      const patient = patients.find(p => p.id === selectedPatientId);
      if (patient) renderChat(patient);
      toast('Message Sent!', `Stage ${data.stage} follow-up delivered 📤`, 'success');
    } else {
      toast('Info', data.message || 'No more follow-ups scheduled', 'info');
    }
  } catch {
    toast('Error', 'Could not send message', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📤 Send Next Follow-up';
  }
}

// ─── Delete Patient ───────────────────────────────────────────────────────────
async function deletePatient() {
  if (!selectedPatientId) return;
  const patient = patients.find(p => p.id === selectedPatientId);
  if (!patient) return;

  if (!confirm(`Remove ${patient.name} from follow-up list?`)) return;

  try {
    await fetch(`/api/patients/${selectedPatientId}`, { method: 'DELETE' });
    patients = patients.filter(p => p.id !== selectedPatientId);
    clearChat();
    renderPatientsList();
    await loadAnalytics();
    toast('Removed', `${patient.name} has been removed`, 'info');
  } catch {
    toast('Error', 'Could not remove patient', 'error');
  }
}

// ─── Render Patients List ─────────────────────────────────────────────────────
function renderPatientsList() {
  const container = document.getElementById('patientsList');
  const emptyState = document.getElementById('emptyState');

  const filtered = filterList(patients, currentFilter);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-patients">
        <div class="empty-icon">🏥</div>
        <h3>${patients.length === 0 ? 'No patients yet' : 'No patients match this filter'}</h3>
        <p>${patients.length === 0 ? 'Add a patient above to start the follow-up sequence' : 'Try a different filter'}</p>
      </div>`;
    return;
  }

  const rows = filtered.map(p => renderPatientRow(p)).join('');
  container.innerHTML = `<div class="patients-list">${rows}</div>`;
}

function filterList(list, filter) {
  switch (filter) {
    case 'active': return list.filter(p => p.status === 'active');
    case 'replied': return list.filter(p => p.replied);
    default: return list;
  }
}

function renderPatientRow(p) {
  const initials = p.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const colors = ['#00d68f', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4', '#ef4444'];
  const color = colors[p.name.charCodeAt(0) % colors.length];

  const statusBadge = p.appointmentBooked
    ? '<span class="badge badge-booked">📅 Booked</span>'
    : p.replied
      ? '<span class="badge badge-replied">✓ Replied</span>'
      : '<span class="badge badge-pending">⏳ Pending</span>';

  const stageDots = [1, 2, 3, 4].map(i => {
    const cls = i < p.followUpStage ? 'done' : i === p.followUpStage ? 'current' : '';
    return `<div class="stage-dot ${cls}" title="Stage ${i}"></div>`;
  }).join('');

  const isSelected = p.id === selectedPatientId;
  const timeAgo = p.lastMessageAt ? getTimeAgo(p.lastMessageAt) : 'Not started';

  return `
    <div class="patient-row ${isSelected ? 'active-patient' : ''}"
         onclick="selectPatient('${p.id}')"
         role="button"
         tabindex="0"
         aria-label="View conversation with ${p.name}"
         onkeypress="if(event.key==='Enter') selectPatient('${p.id}')">
      <div class="patient-avatar" style="background: ${color}22; color: ${color}; font-size: 13px;">${initials}</div>
      <div class="patient-info">
        <h4>${escapeHtml(p.name)}</h4>
        <p>${escapeHtml(p.condition)} <span>•</span> ${escapeHtml(p.doctor)}</p>
      </div>
      <div class="patient-meta">
        ${statusBadge}
        <div class="stage-indicator" title="Follow-up stage ${p.followUpStage} of 4">${stageDots}</div>
      </div>
      <div class="text-muted fs-12" style="white-space: nowrap;">${timeAgo}</div>
    </div>`;
}

// ─── Select & Render Chat ─────────────────────────────────────────────────────
function selectPatient(id) {
  selectedPatientId = id;
  const patient = patients.find(p => p.id === id);
  if (!patient) return;

  renderPatientsList(); // re-render to highlight selected row
  renderChat(patient);

  document.getElementById('chatPatientName').textContent = patient.name;
  document.getElementById('chatPatientInfo').style.display = 'block';
  document.getElementById('chatActions').style.display = 'block';

  const colors = ['#00d68f', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4', '#ef4444'];
  const color = colors[patient.name.charCodeAt(0) % colors.length];
  const initials = patient.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  document.getElementById('chatAvatar').textContent = initials;
  document.getElementById('chatAvatar').style.background = color + '22';
  document.getElementById('chatAvatar').style.color = color;
  document.getElementById('chatNameHeader').textContent = patient.name;
  document.getElementById('chatSubHeader').textContent = `${patient.condition} • Stage ${patient.followUpStage}/4 • ${patient.messages.length} messages`;

  // Update send button state
  const sendBtn = document.getElementById('sendNextBtn');
  sendBtn.disabled = patient.followUpStage >= 4;
  sendBtn.title = patient.followUpStage >= 4 ? 'All follow-ups completed' : 'Send next follow-up';
}

function renderChat(patient) {
  const container = document.getElementById('chatMessages');

  if (!patient.messages || patient.messages.length === 0) {
    container.innerHTML = `
      <div class="chat-empty">
        <div class="empty-icon">💬</div>
        <span>No messages yet — click "Send Next Follow-up"</span>
      </div>`;
    return;
  }

  container.innerHTML = patient.messages.map(msg => {
    const isBot = msg.from === 'bot';
    const timeStr = formatTime(msg.time);
    const text = escapeHtml(msg.text).replace(/\n/g, '<br>').replace(/\*(.*?)\*/g, '<strong>$1</strong>');
    return `
      <div class="bubble ${isBot ? 'bot' : 'patient'}" role="article">
        ${isBot ? '🤖 ' : '👤 '}${text}
        <span class="bubble-time">${timeStr}</span>
      </div>`;
  }).join('');

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

function clearChat() {
  selectedPatientId = null;
  document.getElementById('chatMessages').innerHTML = `
    <div class="chat-empty">
      <div class="empty-icon">💬</div>
      <span>Select a patient to view conversation</span>
    </div>`;
  document.getElementById('chatPatientName').textContent = 'Select a patient';
  document.getElementById('chatPatientInfo').style.display = 'none';
  document.getElementById('chatActions').style.display = 'none';
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────
function filterPatients(filter) {
  currentFilter = filter;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
    btn.setAttribute('aria-selected', 'false');
  });
  const activeBtn = document.getElementById(`tab-${filter}`);
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.setAttribute('aria-selected', 'true');
  }
  renderPatientsList();
}

// ─── Toggle Form ──────────────────────────────────────────────────────────────
function toggleForm() {
  const form = document.getElementById('addPatientForm');
  const btn = document.getElementById('toggleFormBtn');
  const isHidden = form.style.display === 'none';
  form.style.display = isHidden ? 'block' : 'none';
  btn.textContent = isHidden ? 'Collapse' : 'Expand';
  btn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
}

// ─── Analytics UI ─────────────────────────────────────────────────────────────
function updateAnalyticsUI(stats) {
  document.getElementById('statTotal').textContent = stats.total ?? 0;
  document.getElementById('statActive').textContent = `${stats.active ?? 0} active`;
  // New metrics
  if (document.getElementById('statFollowUps')) {
    document.getElementById('statFollowUps').textContent = stats.totalFollowUps ?? 0;
  }
  if (document.getElementById('statRevenue')) {
    document.getElementById('statRevenue').textContent = `₹${stats.totalRevenue ?? 0}`;
  }
  // Existing metrics
  document.getElementById('statMessages').textContent = stats.totalMessages ?? 0;
  document.getElementById('statReplied').textContent = `${stats.replied ?? 0} replied`;
  document.getElementById('statReplyRate').textContent = `${stats.replyRate ?? 0}%`;
  document.getElementById('statReplyBadge').textContent = 'engagement';
  document.getElementById('statBooked').textContent = stats.booked ?? 0;
  document.getElementById('statBookRate').textContent = `${stats.bookingRate ?? 0}% rate`;
}

// Razorpay payment stub – replace with real integration later
function startRazorpayPayment() {
  // TODO: integrate Razorpay Checkout here.
  // Example: create order on server, then open Razorpay payment modal.
  console.log('Razorpay payment triggered (stub)');
  alert('Razorpay payment flow will be implemented soon.');
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openSetupModal() {
  const modal = document.getElementById('setupModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeSetupModal() {
  document.getElementById('setupModal').style.display = 'none';
  document.body.style.overflow = '';
}

// Close modal on backdrop click
document.getElementById('setupModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('setupModal')) closeSetupModal();
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSetupModal();
});

// ─── Toast Notifications ──────────────────────────────────────────────────────
function toast(title, body, type = 'success') {
  const container = document.getElementById('toastContainer');
  const id = 'toast-' + Date.now();
  const typeClass = type === 'error' ? 'error' : type === 'info' ? 'info' : '';

  const el = document.createElement('div');
  el.className = `toast ${typeClass}`;
  el.id = id;
  el.setAttribute('role', 'alert');
  el.innerHTML = `
    <div class="toast-title">${title}</div>
    <div class="toast-body">${body}</div>`;

  container.appendChild(el);

  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) +
    ' · ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function getTimeAgo(isoStr) {
  if (!isoStr) return 'Never';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
