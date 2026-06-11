const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET;

function signToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), username: user.username },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Missing token" });

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.userId).select("-passwordHash");
    if (!user) return res.status(401).json({ error: "Invalid session" });

    req.user = user;
    req.auth = payload;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid session" });
  }
}

module.exports = { authRequired, signToken, JWT_SECRET };
