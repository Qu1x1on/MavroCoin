const express = require("express");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Раздача статических файлов (index.html, style.css, app.js)
app.use(express.static(path.join(__dirname, "..")));

// SPA маршрут — отдаем index.html для всех запросов
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 MavroCoin Telegram Mini App running on http://0.0.0.0:${PORT}`);
});
