async function getProfile(req, res) {
  const {
    passwordHash,
    otpCodeHash,
    otpAttempts,
    otpSentAt,
    otpWindowStartedAt,
    otpSendCount,
    ...safeUser
  } = req.user.toObject();
  return res.json({ user: safeUser });
}

module.exports = { getProfile };
