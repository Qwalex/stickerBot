FROM node:18-alpine

# Создаем рабочую директорию
WORKDIR /app

# Копируем файлы package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем исходный код приложения
COPY . .

# Создаем необходимые файлы и директории
RUN touch chatIds.json && \
    echo '{"chatIds":[]}' > chatIds.json && \
    chmod 755 chatIds.json

# Открываем порт, на котором работает приложение (внутренний порт 3001, снаружи будет доступен на 80)
EXPOSE 3001

# Запускаем приложение
CMD ["node", "index.js"] 