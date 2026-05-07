function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

function ensureDriver(req, res, next) {
  if (req.isAuthenticated() && req.user.isDriver) return next();
  res.status(403).json({ error: 'Driver access required' });
}

module.exports = { ensureAuthenticated, ensureDriver };
