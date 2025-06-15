const http = require('http');

// Создаем простой HTTP-сервер для проверки деплоя
const server = http.createServer((req, res) => {
  console.log(`[${new Date().toISOString()}] Получен запрос: ${req.method} ${req.url}`);
  
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('DEPLOY_OK');
});

// Запускаем сервер на порту 3002
server.listen(3002, '0.0.0.0', () => {
  console.log('Сервер проверки деплоя запущен на порту 3002');
}); 