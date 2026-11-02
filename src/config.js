function parseOrigins(value) {
  if (!value || value.trim() === "*") return "*";
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS);

const corsOptions = {
  origin(origin, callback) {
    // Native mobile apps and server-to-server calls often have no Origin header.
    if (!origin) return callback(null, true);
    if (allowedOrigins === "*") return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-App-Key"]
};

module.exports = { corsOptions };
