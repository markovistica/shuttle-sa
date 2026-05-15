const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { reservations: {}, pushSubscriptions: [], messages: [] };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getReservationsForTour(tourId) {
  const db = readDB();
  return db.reservations[tourId] || {};
}

function reserve(tourId, seatNumber, data) {
  const db = readDB();
  if (!db.reservations[tourId]) db.reservations[tourId] = {};
  db.reservations[tourId][seatNumber] = data;
  writeDB(db);
}

function cancelReservation(tourId, seatNumber) {
  const db = readDB();
  if (db.reservations[tourId]) {
    delete db.reservations[tourId][seatNumber];
    writeDB(db);
  }
}

function resetAllReservations() {
  const db = readDB();
  db.reservations = {};
  writeDB(db);
}

function addPushSubscription(userId, subscription) {
  const db = readDB();
  if (!Array.isArray(db.pushSubscriptions)) db.pushSubscriptions = [];
  // Remove existing for this user
  db.pushSubscriptions = db.pushSubscriptions.filter(s => s.userId !== userId);
  db.pushSubscriptions.push({ userId, subscription });
  writeDB(db);
}

function getAllPushSubscriptions() {
  return readDB().pushSubscriptions || [];
}

function saveMessage(tourId, message) {
  const db = readDB();
  if (!Array.isArray(db.messages)) db.messages = [];
  db.messages.push({ tourId, ...message, timestamp: new Date().toISOString() });
  if (db.messages.length > 200) db.messages = db.messages.slice(-200);
  writeDB(db);
}

function getMessages(tourId) {
  const db = readDB();
  return (db.messages || []).filter(m => m.tourId === tourId);
}

module.exports = {
  getReservationsForTour,
  reserve,
  cancelReservation,
  resetAllReservations,
  addPushSubscription,
  getAllPushSubscriptions,
  saveMessage,
  getMessages
};
