const express = require('express');
const router = express.Router();
const { ensureAuthenticated, ensureDriver } = require('../middleware/auth');
const { TOURS, TOTAL_SEATS } = require('./tours');
const db = require('../db');

const reservationLocks = new Set();

// Get all tours with reservation status
router.get('/tours', ensureAuthenticated, (req, res) => {
  const userId = req.user.id;
  const toursWithStatus = Object.values(TOURS).map(tour => {
    const tourReservations = db.getReservationsForTour(tour.id);
    const seats = {};
    const seatNames = {};
    for (let i = 1; i <= TOTAL_SEATS; i++) {
      const res_user = tourReservations[i];
      if (!res_user) {
        seats[i] = 'free';
      } else if (res_user.userId === userId) {
        seats[i] = 'mine';
        seatNames[i] = res_user.userName;
      } else {
        seats[i] = 'taken';
        seatNames[i] = res_user.userName;
      }
    }
    const myReservation = Object.entries(tourReservations).find(
      ([, r]) => r.userId === userId
    );
    return {
      ...tour,
      seats,
      seatNames,
      myReservation: myReservation
        ? { seatNumber: parseInt(myReservation[0]), stop: myReservation[1].stop }
        : null,
      takenCount: Object.keys(tourReservations).length
    };
  });
  res.json(toursWithStatus);
});

// Reserve a seat
router.post('/reserve', ensureAuthenticated, (req, res) => {
  const { tourId, stop } = req.body;
  const seatNumber = parseInt(req.body.seatNumber, 10);
  const userId = req.user.id;
  const userName = req.user.displayName;

  if (!TOURS[tourId]) return res.status(400).json({ error: 'Invalid tour' });
  if (!stop || !TOURS[tourId].stops.includes(stop))
    return res.status(400).json({ error: 'Invalid stop' });
  if (isNaN(seatNumber) || seatNumber < 1 || seatNumber > TOTAL_SEATS)
    return res.status(400).json({ error: 'Invalid seat number' });

  const lockKey = `${tourId}-${seatNumber}`;
  if (reservationLocks.has(lockKey))
    return res.status(409).json({ error: 'Sjedalo se upravo rezerviše, pokušaj ponovo' });
  reservationLocks.add(lockKey);

  try {
    const tourReservations = db.getReservationsForTour(tourId);

    const existing = Object.entries(tourReservations).find(([, r]) => r.userId === userId);
    if (existing)
      return res.status(400).json({ error: 'Already reserved on this tour', seat: parseInt(existing[0]) });

    // Check group limit: 1 morning tour + 1 afternoon tour per user
    const morningTours = ['morning1', 'morning2'];
    const afternoonTours = ['afternoon1', 'afternoon2'];
    const group = morningTours.includes(tourId) ? morningTours : afternoonTours;
    const sibling = group.find(id => id !== tourId);
    if (sibling) {
      const siblingReservations = db.getReservationsForTour(sibling);
      const siblingExisting = Object.entries(siblingReservations).find(([, r]) => r.userId === userId);
      if (siblingExisting) {
        const label = morningTours.includes(tourId) ? 'jutarnjoj' : 'popodnevnoj';
        return res.status(400).json({ error: `Već imaš rezervaciju u drugoj ${label} turi` });
      }
    }

    if (tourReservations[seatNumber])
      return res.status(400).json({ error: 'Seat already taken' });

    db.reserve(tourId, seatNumber, { userId, userName, stop, reservedAt: new Date().toISOString() });

    req.app.get('io').to(tourId).emit('seatUpdate', {
      tourId,
      seatNumber,
      status: 'taken',
      userName,
      stop
    });

    res.json({ success: true, tourId, seatNumber, stop });
  } finally {
    reservationLocks.delete(lockKey);
  }
});

// Cancel a reservation
router.delete('/reserve/:tourId/:seatNumber', ensureAuthenticated, (req, res) => {
  const { tourId, seatNumber } = req.params;
  const userId = req.user.id;
  const seat = parseInt(seatNumber);

  const tourReservations = db.getReservationsForTour(tourId);
  const reservation = tourReservations[seat];

  if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
  if (reservation.userId !== userId && !req.user.isDriver)
    return res.status(403).json({ error: 'Not your reservation' });

  db.cancelReservation(tourId, seat);

  req.app.get('io').to(tourId).emit('seatUpdate', {
    tourId,
    seatNumber: seat,
    status: 'free'
  });

  res.json({ success: true });
});

// Get passengers for driver
router.get('/driver/passengers/:tourId', ensureDriver, (req, res) => {
  const { tourId } = req.params;
  if (!TOURS[tourId]) return res.status(400).json({ error: 'Invalid tour' });

  const tourReservations = db.getReservationsForTour(tourId);
  const byStop = {};

  Object.entries(tourReservations).forEach(([seat, r]) => {
    if (!byStop[r.stop]) byStop[r.stop] = [];
    byStop[r.stop].push({ seat: parseInt(seat), userName: r.userName });
  });

  // Order by tour stop sequence
  const stops = TOURS[tourId].stops;
  const ordered = stops
    .filter(stop => byStop[stop])
    .map(stop => ({ stop, passengers: byStop[stop] }));

  res.json({ tourId, passengers: ordered, total: Object.keys(tourReservations).length });
});

// Save push subscription
router.post('/push/subscribe', ensureAuthenticated, (req, res) => {
  const subscription = req.body;
  db.addPushSubscription(req.user.id, subscription);
  res.json({ success: true });
});

// Get VAPID public key for push
router.get('/push/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Manual reservation reset (driver only)
router.post('/driver/reset', ensureDriver, (req, res) => {
  db.resetAllReservations();
  req.app.get('io').emit('reservationsReset');
  console.log('Reservations manually reset by driver:', req.user.email);
  res.json({ success: true });
});

module.exports = router;
