require('dotenv').config();
const express = require('express');
const NodeCache = require('node-cache');
const TelegramBot = require('node-telegram-bot-api');
const deepEqual = require('deep-equal');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const http = require('http');
const https = require('https');

const app = express();
const port = process.env.PORT || 3001;

// Настройка CORS - разрешаем все источники для тестирования
app.use(cors());

// Добавляем middleware для логирования всех запросов
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Специальный маршрут для проверки деплоя, который будет отвечать немедленно
app.get('/deploy-check', (req, res) => {
  console.log('Получен запрос /deploy-check');
  res.status(200).send('DEPLOY_OK');
});

// Обработчик для корневого URL - должен быть определен в начале для проверки развертывания
app.get('/', (req, res) => {
  console.log('Получен запрос /');
  res.status(200).send('StickerBot API работает!');
});

// Специальный маршрут для проверки готовности приложения при деплое
app.get('/ready', (req, res) => {
  console.log('Получен запрос /ready');
  res.status(200).send('OK');
});

// Проверка здоровья системы для мониторинга
app.get('/health', (req, res) => {
  console.log('Получен запрос /health');
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Запускаем HTTP-сервер немедленно
try {
  const httpServer = http.createServer(app).listen(port, '0.0.0.0', () => {
    console.log(`HTTP сервер запущен на порту ${port}`);
  });
} catch (error) {
  console.error(`Ошибка при запуске HTTP сервера: ${error.message}`);
  console.log('Возможно, порт уже занят deploy-check-server.js. Продолжаем инициализацию...');
}

// Остальной код приложения инициализируется после запуска HTTP-сервера
console.log('Запуск основной инициализации приложения...');
setTimeout(() => {
  // Здесь продолжается весь остальной код инициализации
  // ... existing code ...
}, 2000);