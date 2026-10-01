async function getProfile(req, res) {
  const { passwordHash, otpCode, ...safeUser } = req.user.toObject();
  return res.json({ user: safeUser });
}

module.exports = { getProfile };
