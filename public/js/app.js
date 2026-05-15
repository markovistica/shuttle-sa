'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let currentUser = null;
let tours = [];
let activeTour = null;        // tour open in modal
let selectedSeat = null;
let socket = null;
let map = null;
let busMarker = null;
let driverWatchId = null;
let activeMapTourId = null;
let activeMsgTourId = null;
let activeDriverTourId = null;
let driverSharingLocation = false;

const TOTAL_SEATS = 19;

// ── Init ───────────────────────────────────────────────────────────────────
(async function init() {
  const res = await fetch('/auth/user');
  const data = await res.json();
  if (!data.user) { window.location.href = '/login'; return; }
  currentUser = data.user;

  document.getElementById('userName').textContent = currentUser.displayName.split(' ')[0];
  const avatar = document.getElementById('userAvatar');
  if (currentUser.photo) { avatar.src = currentUser.photo; avatar.style.display = 'block'; }

  if (currentUser.isDriver) {
    document.getElementById('driverTabBtn').classList.remove('hidden');
  }

  initSocket();
  initTabs();
  initMap();
  await loadTours();
  initMapTourSelect();
  initMessages();
  initDriverTourSelect();
  initPushNotifications();
  initModal();
})();

// ── Socket ─────────────────────────────────────────────────────────────────
function initSocket() {
  socket = io();

  socket.on('seatUpdate', ({ tourId, seatNumber, status, userName }) => {
    const tour = tours.find(t => t.id === tourId);
    if (!tour) return;
    if (status === 'free') {
      delete tour.seats[seatNumber];
      if (tour.seatNames) delete tour.seatNames[seatNumber];
    } else {
      tour.seats[seatNumber] = status;
      if (userName) {
        if (!tour.seatNames) tour.seatNames = {};
        tour.seatNames[seatNumber] = userName;
      }
    }
    renderTourCard(tour);
    if (activeTour && activeTour.id === tourId) renderSeatGrid(tour);
  });

  socket.on('reservationsReset', () => {
    tours.forEach(t => { t.seats = {}; t.myReservation = null; t.takenCount = 0; });
    tours.forEach(renderTourCard);
    showToast('Rezervacije su resetovane 🔄');
  });

  socket.on('driverLocation', (loc) => {
    if (!map) return;
    const latlng = [loc.lat, loc.lng];
    if (!busMarker) {
      busMarker = L.marker(latlng, { icon: busIcon() }).addTo(map);
    } else {
      busMarker.setLatLng(latlng);
    }
    updateMapStatus(true);
  });

  socket.on('driverLocationStopped', () => {
    if (busMarker) { busMarker.remove(); busMarker = null; }
    updateMapStatus(false);
  });

  socket.on('newMessage', (msg) => {
    appendMessage(msg, false, 'messagesBox');
    if (currentUser.isDriver) {
      appendMessage(msg, false, 'driverMessagesBox');
      if (msg.userName !== currentUser.displayName) playDing();
    }
  });

  socket.on('messageHistory', (messages) => {
    populateMessageBox('messagesBox', messages);
    if (currentUser.isDriver) populateMessageBox('driverMessagesBox', messages);
  });

  socket.on('driverAlert', (msg) => {
    const driverTabActive = document.getElementById('tab-driver').classList.contains('active');
    const msgTabActive = document.getElementById('tab-messages').classList.contains('active');
    if (!driverTabActive && !msgTabActive) {
      showToast(`💬 ${msg.userName}: ${msg.text.slice(0, 40)}${msg.text.length > 40 ? '…' : ''}`);
    }
  });
}

function busIcon() {
  return L.divIcon({
    html: '<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.5))">🚌</div>',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    className: ''
  });
}

// ── Tabs ───────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
      if (tab === 'map' && map) setTimeout(() => map.invalidateSize(), 100);
    });
  });
}

// ── Tours ──────────────────────────────────────────────────────────────────
async function loadTours() {
  const res = await fetch('/api/tours');
  tours = await res.json();
  const grid = document.getElementById('toursGrid');
  grid.innerHTML = '';
  tours.forEach(tour => {
    const card = document.createElement('div');
    card.className = 'tour-card';
    card.id = `tour-card-${tour.id}`;
    card.addEventListener('click', () => openModal(tour));
    grid.appendChild(card);
    renderTourCard(tour);
    socket.emit('joinTour', tour.id);
  });
}

function renderTourCard(tour) {
  const card = document.getElementById(`tour-card-${tour.id}`);
  if (!card) return;
  const taken = Object.values(tour.seats).filter(s => s === 'taken' || s === 'mine').length;
  const free = TOTAL_SEATS - taken;
  card.classList.toggle('has-reservation', !!tour.myReservation);
  card.innerHTML = `
    <div class="tour-card-accent"></div>
    <div class="tour-header">
      <div class="tour-name">${tour.name}</div>
      <div class="tour-time">${tour.departureTime}</div>
    </div>
    <div class="tour-meta">
      <span class="seats-text">${free} slobodnih mjesta</span>
      ${tour.myReservation ? `<span class="my-res-badge">S${tour.myReservation.seatNumber}</span>` : ''}
    </div>
  `;
}

// ── Modal / Seat Grid ──────────────────────────────────────────────────────
function initModal() {
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('seatModal').addEventListener('click', e => {
    if (e.target === document.getElementById('seatModal')) closeModal();
  });
  document.getElementById('reserveBtn').addEventListener('click', doReserve);
  document.getElementById('cancelBtn').addEventListener('click', doCancel);
}

function openModal(tour) {
  activeTour = tour;
  selectedSeat = null;
  document.getElementById('modalTourName').textContent = tour.name + ' · ' + tour.departureTime;
  renderSeatGrid(tour);
  updateModalPanels(tour);
  document.getElementById('seatModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('seatModal').classList.add('hidden');
  document.body.style.overflow = '';
  activeTour = null;
  selectedSeat = null;
}

function renderSeatGrid(tour) {
  const grid = document.getElementById('seatGrid');
  grid.className = 'bus-layout';
  grid.innerHTML = '';

  // Row 0: [Vozač][empty] | aisle | [S1]
  const row0 = document.createElement('div');
  row0.className = 'bus-row';
  const leftPair0 = document.createElement('div');
  leftPair0.className = 'bus-left-pair';
  leftPair0.innerHTML = `<div class="seat driver" title="Vozač">Vozač</div>`;
  leftPair0.appendChild(makeEmptySeatEl());
  row0.appendChild(leftPair0);
  const aisle0 = document.createElement('div');
  aisle0.className = 'bus-aisle';
  row0.appendChild(aisle0);
  row0.appendChild(makeSeatEl(1, tour));
  grid.appendChild(row0);

  // Rows 1-6: base = 2 + r*3 → [base][base+1] | aisle | [base+2]
  // Row 1: 2,3 | 4  — Row 2: 5,6 | 7  — ... — Row 6: 17,18 | 19
  for (let r = 0; r < 6; r++) {
    const base = 2 + r * 3;
    const row = document.createElement('div');
    row.className = 'bus-row';

    const leftPair = document.createElement('div');
    leftPair.className = 'bus-left-pair';
    leftPair.appendChild(makeSeatEl(base, tour));
    leftPair.appendChild(makeSeatEl(base + 1, tour));
    row.appendChild(leftPair);

    const aisle = document.createElement('div');
    aisle.className = 'bus-aisle';
    row.appendChild(aisle);

    row.appendChild(makeSeatEl(base + 2, tour));
    grid.appendChild(row);
  }
}

function getInitials(name) {
  return (name || '').split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function makeSeatEl(num, tour) {
  const status = tour.seats[num] || 'free';
  const div = document.createElement('div');
  div.className = `seat ${status}`;
  div.dataset.seat = num;
  if (status === 'taken' || status === 'mine') {
    const initials = getInitials(tour.seatNames?.[num] || '');
    div.classList.add('seat--named');
    div.innerHTML = `<span class="seat-num">${num}</span><span class="seat-initials">${initials}</span>`;
  } else {
    div.textContent = num;
  }
  if (status !== 'taken') {
    div.addEventListener('click', () => onSeatClick(num, status, tour));
  }
  return div;
}

function makeEmptySeatEl() {
  const div = document.createElement('div');
  div.className = 'seat-empty';
  return div;
}

function onSeatClick(seatNum, status, tour) {
  if (status === 'taken') return;
  if (status === 'mine') {
    // Just show cancel panel
    updateModalPanels(tour);
    return;
  }
  // Free seat — select it
  selectedSeat = seatNum;
  document.querySelectorAll('.seat').forEach(s => s.classList.remove('selected'));
  document.querySelector(`.seat[data-seat="${seatNum}"]`)?.classList.add('selected');
  populateStopSelect(tour);
  document.getElementById('stopSelector').classList.remove('hidden');
  document.getElementById('myReservationPanel').classList.add('hidden');
}

function updateModalPanels(tour) {
  const stopSel = document.getElementById('stopSelector');
  const myResPanel = document.getElementById('myReservationPanel');
  if (tour.myReservation) {
    stopSel.classList.add('hidden');
    myResPanel.classList.remove('hidden');
    document.getElementById('myResInfo').innerHTML =
      `✅ Rezervisano: <strong>Sjedište ${tour.myReservation.seatNumber}</strong><br>📍 Stanica: <strong>${tour.myReservation.stop}</strong>`;
  } else {
    stopSel.classList.add('hidden');
    myResPanel.classList.add('hidden');
  }
}

function populateStopSelect(tour) {
  const sel = document.getElementById('stopSelect');
  sel.innerHTML = '';
  // Exclude last stop (Office/Dobrinja) — destination
  const stops = tour.direction === 'toOffice'
    ? tour.stops.slice(0, -1)
    : tour.stops.slice(1);
  stops.forEach(stop => {
    const opt = document.createElement('option');
    opt.value = stop;
    opt.textContent = stop;
    sel.appendChild(opt);
  });
}

async function doReserve() {
  if (!activeTour || !selectedSeat) return;
  const stop = document.getElementById('stopSelect').value;
  const btn = document.getElementById('reserveBtn');
  btn.disabled = true;
  btn.textContent = 'Rezervišem...';

  try {
    const res = await fetch('/api/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tourId: activeTour.id, seatNumber: selectedSeat, stop })
    });
    if (res.redirected || res.status === 401) {
      showToast('❌ Sesija istekla — prijavite se ponovo', 'error');
      setTimeout(() => window.location.href = '/login', 1500);
      return;
    }
    const data = await res.json();
    if (data.success) {
      const tour = tours.find(t => t.id === activeTour.id);
      if (tour) {
        tour.seats[selectedSeat] = 'mine';
        if (!tour.seatNames) tour.seatNames = {};
        tour.seatNames[selectedSeat] = currentUser.displayName;
        tour.myReservation = { seatNumber: selectedSeat, stop };
        activeTour = tour;
        renderSeatGrid(tour);
        updateModalPanels(tour);
        renderTourCard(tour);
      }
      showToast(`✅ Rezervisano sjedište ${selectedSeat} na ${stop}`);
    } else {
      showToast('❌ ' + (data.error || 'Greška'), 'error');
    }
  } catch (e) {
    showToast('❌ Greška pri rezervaciji', 'error');
    console.error('Reserve error:', e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Rezerviši sjedište';
  }
}

async function doCancel() {
  if (!activeTour || !activeTour.myReservation) return;
  const { seatNumber } = activeTour.myReservation;
  const res = await fetch(`/api/reserve/${activeTour.id}/${seatNumber}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.success) {
    const tour = tours.find(t => t.id === activeTour.id);
    if (tour) {
      delete tour.seats[seatNumber];
      if (tour.seatNames) delete tour.seatNames[seatNumber];
      tour.myReservation = null;
      activeTour = tour;
      renderSeatGrid(tour);
      updateModalPanels(tour);
      renderTourCard(tour);
    }
    showToast('Rezervacija otkazana');
  } else {
    showToast('❌ Greška', 'error');
  }
}

// ── Map ────────────────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([43.847, 18.356], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19
  }).addTo(map);
}

function initMapTourSelect() {
  const sel = document.getElementById('mapTourSelect');
  tours.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.name} · ${t.departureTime}`;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    if (activeMapTourId) socket.emit('leaveRoom', activeMapTourId);
    activeMapTourId = sel.value;
    if (activeMapTourId) socket.emit('joinTour', activeMapTourId);
    if (busMarker) { busMarker.remove(); busMarker = null; }
    updateMapStatus(false);
  });
}

function updateMapStatus(online) {
  const el = document.getElementById('mapStatus');
  el.innerHTML = online
    ? '<span class="status-dot online"></span> Bus je aktivan — live praćenje'
    : '<span class="status-dot offline"></span> Bus nije aktivan';
}

// ── Messages ───────────────────────────────────────────────────────────────
function initMessages() {
  socket.emit('joinGlobal');
  if (currentUser.isDriver) socket.emit('joinDriverInbox');

  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('msgInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') sendMessage();
  });
}

function sendMessage() {
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('sendMessage', { text, userName: currentUser.displayName });
  input.value = '';
}

function populateMessageBox(boxId, messages) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.innerHTML = '';
  if (!messages.length) {
    box.innerHTML = '<div class="msg-empty">Nema poruka</div>';
    return;
  }
  messages.forEach(m => appendMessage(m, true, boxId));
  box.scrollTop = box.scrollHeight;
}

function appendMessage(msg, skipScroll = false, boxId = 'messagesBox') {
  const box = document.getElementById(boxId);
  if (!box) return;
  const empty = box.querySelector('.msg-empty');
  if (empty) empty.remove();

  const isMine = msg.userName === currentUser.displayName;
  const div = document.createElement('div');
  div.className = `msg-item${isMine ? ' mine' : ''}`;
  div.innerHTML = `
    <div class="msg-sender">${escapeHtml(msg.userName)}</div>
    <div class="msg-text">${escapeHtml(msg.text)}</div>
    <div class="msg-time">${formatTime(msg.timestamp)}</div>
  `;
  box.appendChild(div);
  if (!skipScroll) box.scrollTop = box.scrollHeight;
}

function playDing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

// ── Driver Panel ───────────────────────────────────────────────────────────
function initDriverTourSelect() {
  if (!currentUser.isDriver) return;
  const sel = document.getElementById('driverTourSelect');
  tours.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.name} · ${t.departureTime}`;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    activeDriverTourId = sel.value;
    if (activeDriverTourId) loadPassengers(activeDriverTourId);
    else document.getElementById('passengerList').innerHTML = '';
  });

  document.getElementById('startLocBtn').addEventListener('click', startSharingLocation);
  document.getElementById('stopLocBtn').addEventListener('click', stopSharingLocation);
  document.getElementById('driverResetBtn').addEventListener('click', doDriverReset);

  document.getElementById('driverSendBtn').addEventListener('click', sendDriverMessage);
  document.getElementById('driverMsgInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') sendDriverMessage();
  });
}

function sendDriverMessage() {
  const input = document.getElementById('driverMsgInput');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('sendMessage', { text, userName: currentUser.displayName });
  input.value = '';
}

async function doDriverReset() {
  if (!confirm('Resetovati sve rezervacije?')) return;
  const res = await fetch('/api/driver/reset', { method: 'POST' });
  const data = await res.json();
  if (data.success) showToast('Sve rezervacije su resetovane');
  else showToast('❌ Greška pri resetovanju', 'error');
}

async function loadPassengers(tourId) {
  const res = await fetch(`/api/driver/passengers/${tourId}`);
  const data = await res.json();
  const container = document.getElementById('passengerList');
  if (!data.passengers || !data.passengers.length) {
    container.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;padding:0.5rem 0">Nema rezervacija za ovu turu.</p>';
    return;
  }
  container.innerHTML = `
    <div class="section-title" style="margin-bottom:0.75rem">Putnici po stanicama · ${data.total} ukupno</div>
    ${data.passengers.map(s => `
      <div class="passenger-stop">
        <div class="passenger-stop-name">📍 ${escapeHtml(s.stop)}</div>
        ${s.passengers.map(p => `
          <div class="passenger-row">
            <span class="seat-badge">S${p.seat}</span>
            <span>${escapeHtml(p.userName)}</span>
          </div>
        `).join('')}
      </div>
    `).join('')}
  `;
}

function startSharingLocation() {
  if (!navigator.geolocation) { showToast('GPS nije dostupan', 'error'); return; }
  driverSharingLocation = true;
  document.getElementById('startLocBtn').classList.add('hidden');
  document.getElementById('stopLocBtn').classList.remove('hidden');
  document.getElementById('locStatus').innerHTML =
    '<span class="status-dot online"></span> Dijeljenje lokacije aktivno';

  const tourId = activeDriverTourId;
  driverWatchId = navigator.geolocation.watchPosition(pos => {
    socket.emit('driverLocation', {
      tourId,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude
    });
  }, err => {
    showToast('GPS greška: ' + err.message, 'error');
    stopSharingLocation();
  }, { enableHighAccuracy: true, maximumAge: 5000 });
}

function stopSharingLocation() {
  if (driverWatchId != null) navigator.geolocation.clearWatch(driverWatchId);
  driverWatchId = null;
  driverSharingLocation = false;
  socket.emit('driverStopSharing', activeDriverTourId);
  document.getElementById('stopLocBtn').classList.add('hidden');
  document.getElementById('startLocBtn').classList.remove('hidden');
  document.getElementById('locStatus').innerHTML =
    '<span class="status-dot offline"></span> Lokacija nije aktivna';
}

// ── Push Notifications ─────────────────────────────────────────────────────
async function initPushNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (Notification.permission === 'granted') {
    registerPushSubscription();
    return;
  }
  if (Notification.permission === 'default') {
    const banner = document.getElementById('notifyBanner');
    banner.classList.remove('hidden');
    document.getElementById('enableNotify').addEventListener('click', async () => {
      banner.classList.add('hidden');
      const perm = await Notification.requestPermission();
      if (perm === 'granted') registerPushSubscription();
    });
    document.getElementById('dismissNotify').addEventListener('click', () => {
      banner.classList.add('hidden');
    });
  }
}

async function registerPushSubscription() {
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const keyRes = await fetch('/api/push/vapid-key');
    const { publicKey } = await keyRes.json();
    if (!publicKey || publicKey.includes('your_')) return;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub)
    });
  } catch {}
}

// ── Utilities ──────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  const bg = type === 'error' ? 'rgba(239,68,68,0.95)' : 'rgba(30,34,48,0.97)';
  const border = type === 'error' ? 'rgba(239,68,68,0.5)' : 'rgba(79,142,247,0.3)';
  const icon = type === 'error' ? '' : '';
  el.style.cssText = `
    position:fixed;top:calc(var(--nav-h, 56px) + 0.75rem);bottom:auto;
    left:50%;transform:translateX(-50%) translateY(0);
    background:${bg};border:1px solid ${border};
    color:#fff;padding:0.65rem 1.25rem;border-radius:12px;
    font-size:0.85rem;font-weight:600;z-index:9999;
    white-space:nowrap;box-shadow:0 8px 32px rgba(0,0,0,0.4);
    backdrop-filter:blur(8px);
    animation:toastIn 0.3s cubic-bezier(0.16,1,0.3,1);
    transition:opacity 0.2s,transform 0.2s;
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(8px)';
    setTimeout(() => el.remove(), 200);
  }, 2800);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('bs', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
