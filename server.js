require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const cron = require('node-cron');
const webpush = require('web-push');
const path = require('path');
const db = require('./db');
const { TOURS } = require('./routes/tours');
const apiRouter = require('./routes/api');
const { ensureAuthenticated } = require('./middleware/auth');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

app.set('io', io);

// Security headers (relaxed CSP for inline scripts/styles in SPA)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'unpkg.com', 'cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
        fontSrc: ["'self'", 'fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'tile.openstreetmap.org', '*.tile.openstreetmap.org', '*.googleusercontent.com'],
        connectSrc: ["'self'", 'wss:']
      }
    }
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session
const sessionStore = process.env.NODE_ENV === 'production'
  ? undefined
  : new FileStore({ path: './data/sessions', retries: 1, logFn: () => {} });

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'change_me',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: false,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
});
app.use(sessionMiddleware);

// Passport
app.use(passport.initialize());
app.use(passport.session());

console.log('[auth] GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'set' : 'MISSING');
console.log('[auth] GOOGLE_CALLBACK_URL:', process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback');

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
}, (accessToken, refreshToken, profile, done) => {
  const email = profile.emails && profile.emails[0] && profile.emails[0].value;
  console.log('[auth] Google callback - email:', email);
  if (!email || !email.endsWith('@symphony.is')) {
    console.log('[auth] Rejected - not @symphony.is');
    return done(null, false, { message: 'Only @symphony.is accounts allowed' });
  }
  const driverEmails = (process.env.DRIVER_EMAILS || '').split(',').map(e => e.trim());
  const user = {
    id: profile.id,
    displayName: profile.displayName,
    email,
    photo: profile.photos && profile.photos[0] && profile.photos[0].value,
    isDriver: driverEmails.includes(email)
  };
  console.log('[auth] Login success:', email);
  return done(null, user);
}));

passport.serializeUser((user, done) => {
  console.log('[auth] Serializing user:', user.email);
  done(null, user);
});
passport.deserializeUser((user, done) => {
  console.log('[auth] Deserializing user:', user && user.email);
  done(null, user);
});

// Web Push
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY &&
    !process.env.VAPID_PUBLIC_KEY.includes('your_')) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@symphony.is',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Auth routes
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=domain' }),
  (req, res) => {
    console.log('[auth] Callback success, session:', JSON.stringify(req.session));
    res.redirect('/');
  }
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/login'));
});

app.get('/auth/user', (req, res) => {
  console.log('[auth] /auth/user - isAuthenticated:', req.isAuthenticated(), 'session:', JSON.stringify(req.session));
  if (req.isAuthenticated()) {
    res.json({ user: req.user });
  } else {
    res.json({ user: null });
  }
});

// Login page
app.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// API routes
app.use('/api', apiRouter);

// Main app (SPA)
app.get('/', ensureAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io
const driverLocations = {};

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.on('connection', (socket) => {
  // Join tour room (location tracking only)
  socket.on('joinTour', (tourId) => {
    socket.join(tourId);
    if (driverLocations[tourId]) {
      socket.emit('driverLocation', driverLocations[tourId]);
    }
  });

  // Join global message channel
  socket.on('joinGlobal', () => {
    socket.join('global');
    socket.emit('messageHistory', db.getMessages('global'));
  });

  // Join driver inbox room (drivers only — notified on every new message)
  socket.on('joinDriverInbox', () => {
    socket.join('driver-inbox');
  });

  // Driver shares location
  socket.on('driverLocation', (data) => {
    const { tourId, lat, lng } = data;
    if (!tourId || lat == null || lng == null) return;
    driverLocations[tourId] = { lat, lng, timestamp: Date.now() };
    io.to(tourId).emit('driverLocation', driverLocations[tourId]);
  });

  // Stop sharing location
  socket.on('driverStopSharing', (tourId) => {
    delete driverLocations[tourId];
    io.to(tourId).emit('driverLocationStopped');
  });

  // Chat message — always global, no tour selection required
  socket.on('sendMessage', (data) => {
    if (!socket.request.session?.passport?.user) return;
    const { text, userName } = data;
    if (!text || !userName) return;
    const msg = { text, userName, timestamp: new Date().toISOString() };
    db.saveMessage('global', msg);
    io.to('global').emit('newMessage', msg);
    // Real-time alert to all connected drivers
    io.to('driver-inbox').emit('driverAlert', msg);
  });
});

// Cron: Reset reservations at 11:00
cron.schedule('0 11 * * *', () => {
  db.resetAllReservations();
  io.emit('reservationsReset');
  console.log('Reservations reset at 11:00');
}, { timezone: 'Europe/Sarajevo' });

// Cron: Send push notification at 15:00
cron.schedule('0 15 * * *', async () => {
  if (!process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY.includes('your_')) return;
  const subscriptions = db.getAllPushSubscriptions();
  const afternoonTimes = Object.values(TOURS)
    .filter(t => t.direction === 'fromOffice')
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime))
    .map(t => t.departureTime)
    .join(' i ');
  const payload = JSON.stringify({
    title: 'Symphony Shuttle',
    body: `Popodnevne ture kreću uskoro! ${afternoonTimes}`,
    icon: '/images/bus-icon.png'
  });
  for (const { subscription } of subscriptions) {
    try {
      await webpush.sendNotification(subscription, payload);
    } catch (err) {
      if (err.statusCode === 410) {
        // Expired subscription — would remove here in production
      }
    }
  }
  console.log(`Push notifications sent to ${subscriptions.length} subscribers`);
}, { timezone: 'Europe/Sarajevo' });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Symphony Shuttle running on http://localhost:${PORT}`);
});
