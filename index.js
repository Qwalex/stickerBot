require('dotenv').config();
const express = require('express');
const NodeCache = require('node-cache');
const TelegramBot = require('node-telegram-bot-api');
const deepEqual = require('deep-equal');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001;

// Пути к файлам
const chatIdsFilePath = path.join(__dirname, 'chatIds.json');
const dataFilePath = path.join(__dirname, 'data.json');

// ID администраторов бота (для доступа к команде /chats)
const adminIds = [];

// Настройка CORS для домена stickerdom.store
const corsOptions = {
  origin: 'https://stickerdom.store',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));

// Инициализация кеша
const cache = new NodeCache({ stdTTL: 0, checkperiod: 0 }); // Бесконечное время хранения

// Инициализация Telegram бота
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
let chatIds = [];
let bot = null;

// Создаем основные кнопки меню
const mainMenuButtons = {
  reply_markup: {
    keyboard: [
      ['📋 Список коллекций', '🔍 Поиск коллекции'],
      ['📊 Статус подписки', '⚙️ Помощь'],
      ['🔕 Остановить все уведомления']
    ],
    resize_keyboard: true
  }
};

// Функция для создания кнопок навигации по страницам коллекций
function getCollectionsNavigationMarkup(page, totalPages) {
  const buttons = [];
  const row = [];
  
  if (page > 1) {
    row.push({
      text: '⬅️ Пред. стр.',
      callback_data: `collections_${page - 1}`
    });
  }
  
  row.push({
    text: `${page} из ${totalPages}`,
    callback_data: 'current_page'
  });
  
  if (page < totalPages) {
    row.push({
      text: 'След. стр. ➡️',
      callback_data: `collections_${page + 1}`
    });
  }
  
  buttons.push(row);
  
  return {
    inline_keyboard: buttons
  };
}

// Функция для создания кнопок для коллекции
function getCollectionButtonsMarkup(id) {
  return {
    inline_keyboard: [
      [
        {
          text: '📲 Открыть в StickerDom',
          url: `https://t.me/sticker_bot/app?startapp=collection_${id}`
        }
      ],
      [
        {
          text: '⬅️ К списку',
          callback_data: 'collections_1'
        }
      ]
    ]
  };
}

// Функция для чтения ID чатов из файла
function loadChatIds() {
  try {
    if (fs.existsSync(chatIdsFilePath)) {
      const data = fs.readFileSync(chatIdsFilePath, 'utf8');
      const parsedData = JSON.parse(data);
      chatIds = parsedData.chatIds || [];
      console.log(`Загружено ${chatIds.length} ID чатов`);
    }
  } catch (error) {
    console.error('Ошибка при загрузке ID чатов:', error);
    chatIds = [];
  }
}

// Функция для сохранения ID чатов в файл
function saveChatIds() {
  try {
    fs.writeFileSync(chatIdsFilePath, JSON.stringify({ chatIds }, null, 2));
    console.log(`Сохранено ${chatIds.length} ID чатов`);
  } catch (error) {
    console.error('Ошибка при сохранении ID чатов:', error);
  }
}

// Функция для загрузки данных из файла
function loadData() {
  try {
    if (fs.existsSync(dataFilePath)) {
      const rawData = fs.readFileSync(dataFilePath, 'utf8');
      const data = JSON.parse(rawData);
      console.log('Данные успешно загружены из файла');
      return data;
    }
  } catch (error) {
    console.error('Ошибка при загрузке данных из файла:', error);
  }
  return null;
}

// Функция для сохранения данных в файл
function saveData(data) {
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
    console.log('Данные успешно сохранены в файл');
    return true;
  } catch (error) {
    console.error('Ошибка при сохранении данных в файл:', error);
    return false;
  }
}

// Загружаем ID чатов при запуске
loadChatIds();

// Загружаем данные из файла и помещаем в кеш
const savedData = loadData();
if (savedData) {
  cache.set('lastData', savedData);
  console.log('Данные из файла загружены в кеш');
}

// Функция для форматирования данных коллекции стикеров
function formatCollectionData(collection) {
  if (!collection) return 'Нет данных о коллекции';
  
  // Функция для экранирования специальных символов Markdown
  function escapeMarkdown(text) {
    if (!text) return '';
    // Экранируем специальные символы Markdown: _ * [ ] ( ) ~ ` > # + - = | { } . !
    return text.toString()
      .replace(/([_*[\]()~`>#+=|{}.!\\-])/g, '\\$1');
  }
  
  // Функция для ограничения длины текста
  function limitText(text, maxLength = 200) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
  
  let result = `🏷 *${escapeMarkdown(collection.title || 'Без названия')}*\n`;
  
  if (collection.description) {
    result += `📝 _${escapeMarkdown(limitText(collection.description))}_\n\n`;
  }
  
  if (collection.creator?.name) {
    result += `👤 *Создатель*: ${escapeMarkdown(collection.creator.name)}\n`;
  }
  
  if (collection.id) {
    result += `🆔 *ID*: ${collection.id}\n`;
  }
  
  if (collection.status) {
    result += `📊 *Статус*: ${escapeMarkdown(collection.status)}\n`;
  }
  
  if (collection.badges && collection.badges.length > 0) {
    result += `🏅 *Значки*: ${collection.badges.map(badge => escapeMarkdown(badge)).join(', ')}\n`;
  }
  
  if (collection.creator?.social_links && collection.creator.social_links.length > 0) {
    result += `\n🔗 *Социальные сети*:\n`;
    // Ограничиваем количество отображаемых ссылок
    const maxLinks = 3;
    const links = collection.creator.social_links.slice(0, maxLinks);
    links.forEach(link => {
      result += `- ${escapeMarkdown(link.type)}: ${escapeMarkdown(limitText(link.url, 50))}\n`;
    });
    if (collection.creator.social_links.length > maxLinks) {
      result += `- и еще ${collection.creator.social_links.length - maxLinks} ссылок\n`;
    }
  }
  
  // Не выводим медиа-файлы в текстовом описании, так как они могут быть слишком длинными
  // и вызывать проблемы с парсингом
  
  return result;
}

// Функция для форматирования списка коллекций
function formatCollectionsList(collections, page = 1, pageSize = 5) {
  if (!collections || !collections.length) return 'Коллекции не найдены';
  
  // Функция для экранирования специальных символов Markdown
  function escapeMarkdown(text) {
    if (!text) return '';
    // Экранируем специальные символы Markdown: _ * [ ] ( ) ~ ` > # + - = | { } . !
    return text.toString()
      .replace(/([_*[\]()~`>#+=|{}.!\\-])/g, '\\$1');
  }
  
  // Функция для ограничения длины текста
  function limitText(text, maxLength = 50) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
  
  const totalPages = Math.ceil(collections.length / pageSize);
  const startIdx = (page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, collections.length);
  const pageCollections = collections.slice(startIdx, endIdx);
  
  let result = `📋 *Список коллекций* (страница ${page}/${totalPages})\n\n`;
  
  pageCollections.forEach(collection => {
    result += `🏷 *${escapeMarkdown(collection.title || 'Без названия')}* (ID: ${collection.id})\n`;
    if (collection.description) {
      // Обрезаем описание, если оно длинное
      const shortDesc = limitText(collection.description);
      result += `📝 _${escapeMarkdown(shortDesc)}_\n`;
    }
    result += `👤 Создатель: ${escapeMarkdown(collection.creator?.name || 'Неизвестно')}\n\n`;
  });
  
  result += `\nДля просмотра коллекции используйте команду /collection [ID]`;
  
  return result;
}

// Проверка наличия токена Telegram
if (telegramToken) {
  bot = new TelegramBot(telegramToken, { polling: true });
  
  // Обработка команды /start
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    // Проверяем, не добавлен ли уже этот ID
    if (!chatIds.includes(chatId)) {
      chatIds.push(chatId);
      saveChatIds();
      bot.sendMessage(
        chatId, 
        'Бот успешно активирован! Вы будете получать уведомления об изменениях в коллекциях стикеров.',
        mainMenuButtons
      );
    } else {
      bot.sendMessage(
        chatId, 
        'Бот уже активирован для этого чата. Вы будете получать уведомления об изменениях.',
        mainMenuButtons
      );
    }
  });
  
  // Обработка команды /stop для отписки от уведомлений
  bot.onText(/\/stop/, (msg) => {
    const chatId = msg.chat.id;
    const index = chatIds.indexOf(chatId);
    
    if (index !== -1) {
      chatIds.splice(index, 1);
      saveChatIds();
      bot.sendMessage(chatId, 'Вы больше не будете получать уведомления.');
    } else {
      bot.sendMessage(chatId, 'Ваш чат не был подписан на уведомления.');
    }
  });
  
  // Обработка команды /chats для получения списка всех чатов
  bot.onText(/\/chats/, (msg) => {
    const chatId = msg.chat.id;
    
    // Проверяем, является ли пользователь администратором
    if (adminIds.length === 0 || adminIds.includes(chatId)) {
      if (chatIds.length > 0) {
        const chatsList = chatIds.join('\n');
        bot.sendMessage(chatId, `Список подписанных чатов:\n${chatsList}`);
      } else {
        bot.sendMessage(chatId, 'Нет подписанных чатов.');
      }
    } else {
      bot.sendMessage(chatId, 'У вас нет доступа к этой команде.');
    }
  });
  
  // Обработка команды /admin для добавления ID администратора
  bot.onText(/\/admin (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const adminPassword = match[1];
    
    // Здесь можно добавить проверку пароля, например:
    if (adminPassword === 'thaozefre') {
      if (!adminIds.includes(chatId)) {
        adminIds.push(chatId);
        bot.sendMessage(chatId, 'Вы добавлены как администратор бота.');
      } else {
        bot.sendMessage(chatId, 'Вы уже являетесь администратором бота.');
      }
    } else {
      bot.sendMessage(chatId, 'Неправильный пароль.');
    }
  });
  
  // Обработка команды /data для получения текущих данных
  bot.onText(/\/data/, (msg) => {
    const chatId = msg.chat.id;
    
    const lastData = cache.get('lastData');
    
    if (lastData) {
      if (lastData.data && Array.isArray(lastData.data)) {
        const collectionsCount = lastData.data.length;
        bot.sendMessage(
          chatId, 
          `В базе найдено ${collectionsCount} коллекций.\n\nИспользуйте команды:`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📋 Список коллекций', callback_data: 'collections_1' }],
                [{ text: '🔍 Поиск по ID', callback_data: 'search_collection' }]
              ]
            }
          }
        );
      } else {
        const formattedData = JSON.stringify(lastData, null, 2).substring(0, 3000); // Ограничиваем длину сообщения
        bot.sendMessage(chatId, `Текущие данные:\n\n${formattedData}`);
      }
    } else {
      bot.sendMessage(chatId, 'Данные еще не получены.');
    }
  });

  // Обработка команды /collections для просмотра списка коллекций
  bot.onText(/\/collections(?:\s+(\d+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const page = match[1] ? parseInt(match[1]) : 1;
    
    sendCollectionsList(chatId, page);
  });

  // Обработка команды /collection [ID] для просмотра конкретной коллекции
  bot.onText(/\/collection\s+(\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const collectionId = parseInt(match[1]);
    
    sendCollectionInfo(chatId, collectionId);
  });

  // Обработка команды /help для вывода справки
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    sendHelpMessage(chatId);
  });
  
  // Функция для отправки справочной информации
  function sendHelpMessage(chatId) {
    const helpText = `
*StickerBot - Помощь*

*Основные команды:*
/start - Активировать бота и подписаться на уведомления
/stop - Отписаться от уведомлений
/data - Показать общую информацию
/collections [страница] - Просмотр списка коллекций
/collection [ID] - Просмотр информации о коллекции
/help - Показать эту справку
/stopnotifications - Остановить все текущие уведомления о новых коллекциях

*Дополнительно:*
- Для просмотра следующих страниц используйте кнопки навигации
- Для открытия коллекции на сайте используйте кнопку "Открыть в StickerDom"

*Команды администратора:*
/resetcache - Сбросить кеш и перезагрузить данные из файла (только для администраторов)
/removecollection [ID] - Удалить коллекцию с указанным ID из кеша (только для администраторов)
    `;
    
    bot.sendMessage(chatId, helpText, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuButtons.reply_markup
    });
  }
  
  // Обработка команды для остановки всех уведомлений
  bot.onText(/\/stopnotifications/, (msg) => {
    const chatId = msg.chat.id;
    
    // Получаем все непрочитанные уведомления
    const unreadNotifications = cache.get('unreadNotifications') || {};
    let notificationsCount = 0;
    
    // Останавливаем все уведомления для этого чата
    Object.keys(unreadNotifications).forEach(key => {
      if (key.startsWith(`${chatId}_`)) {
        // Останавливаем интервал
        if (unreadNotifications[key].intervalId) {
          clearInterval(unreadNotifications[key].intervalId);
        }
        // Удаляем уведомление из кеша
        delete unreadNotifications[key];
        notificationsCount++;
      }
    });
    
    // Сохраняем обновленный кеш
    cache.set('unreadNotifications', unreadNotifications);
    
    if (notificationsCount > 0) {
      bot.sendMessage(chatId, `✅ Остановлено ${notificationsCount} активных уведомлений.`);
    } else {
      bot.sendMessage(chatId, '📝 У вас нет активных уведомлений.');
    }
  });
  
  // Обработка команды для удаления конкретной коллекции из кеша (для тестирования)
  bot.onText(/\/removecollection (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Проверяем, является ли пользователь администратором
    if (adminIds.includes(userId) || adminIds.length === 0) { // Если список админов пуст, разрешаем всем
      const collectionId = parseInt(match[1]);
      
      if (isNaN(collectionId)) {
        bot.sendMessage(chatId, '❌ *Ошибка*\n\nID коллекции должен быть числом.', { parse_mode: 'Markdown' });
        return;
      }
      
      const lastData = cache.get('lastData');
      
      if (!lastData || !lastData.data || !Array.isArray(lastData.data)) {
        bot.sendMessage(chatId, '❌ *Ошибка*\n\nДанные о коллекциях отсутствуют в кеше.', { parse_mode: 'Markdown' });
        return;
      }
      
      // Находим коллекцию в кеше
      const collectionIndex = lastData.data.findIndex(item => item.id === collectionId);
      
      if (collectionIndex === -1) {
        bot.sendMessage(chatId, `❌ *Ошибка*\n\nКоллекция с ID ${collectionId} не найдена в кеше.`, { parse_mode: 'Markdown' });
        return;
      }
      
      // Сохраняем информацию об удаляемой коллекции для вывода
      const removedCollection = lastData.data[collectionIndex];
      
      // Удаляем коллекцию из массива
      lastData.data.splice(collectionIndex, 1);
      
      // Обновляем кеш
      cache.set('lastData', lastData);
      
      // Сообщаем об успешном удалении
      bot.sendMessage(
        chatId, 
        `✅ *Коллекция успешно удалена из кеша*\n\nID: ${collectionId}\nНазвание: ${removedCollection.title || 'Без названия'}\n\nПри следующем обновлении данных эта коллекция будет обнаружена как новая.`, 
        { parse_mode: 'Markdown' }
      );
      
      console.log(`Администратор ${msg.from.username || msg.from.first_name} (ID: ${userId}) удалил коллекцию ${collectionId} из кеша`);
    } else {
      bot.sendMessage(chatId, 'У вас нет доступа к этой команде. Только администраторы могут удалять коллекции из кеша.');
    }
  });
  
  // Обработка команды /resetcache для сброса кеша
  bot.onText(/\/resetcache/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Проверяем, является ли пользователь администратором
    if (adminIds.includes(userId) || adminIds.length === 0) {
      // Очищаем кеш
      cache.flushAll();
      console.log('Кеш успешно очищен по команде из Telegram');
      
      // Загружаем данные из файла
      const data = loadData();
      if (data) {
        // Помещаем данные в кеш
        cache.set('lastData', data);
        console.log('Данные успешно загружены из файла в кеш');
        
        // Отправляем уведомление
        bot.sendMessage(chatId, '🔄 *Кеш успешно сброшен*\n\nДанные были загружены из файла. Новые коллекции будут корректно обнаружены при следующем обновлении.', { 
          parse_mode: 'Markdown' 
        });
      } else {
        bot.sendMessage(chatId, '❌ *Ошибка*\n\nНе удалось загрузить данные из файла.', { 
          parse_mode: 'Markdown' 
        });
      }
    } else {
      bot.sendMessage(chatId, 'У вас нет доступа к этой команде. Только администраторы могут сбрасывать кеш.');
    }
  });
  
  // Обработка текстовых сообщений (для кнопок главного меню)
  bot.on('message', (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    
    switch(msg.text) {
      case '📋 Список коллекций':
        sendCollectionsList(chatId, 1);
        break;
        
      case '🔍 Поиск коллекции':
        bot.sendMessage(chatId, 'Введите ID коллекции для поиска в формате: "поиск ID", например "поиск 23"');
        break;
        
      case '📊 Статус подписки':
        if (chatIds.includes(chatId)) {
          bot.sendMessage(chatId, 'Вы подписаны на уведомления об изменениях в коллекциях.');
        } else {
          bot.sendMessage(
            chatId, 
            'Вы не подписаны на уведомления. Используйте /start для подписки.',
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Подписаться на уведомления', callback_data: 'subscribe' }]
                ]
              }
            }
          );
        }
        break;
        
      case '⚙️ Помощь':
        // Отправляем справку напрямую
        sendHelpMessage(chatId);
        break;
        
      case '🔕 Остановить все уведомления':
        // Получаем все непрочитанные уведомления
        const unreadNotifications = cache.get('unreadNotifications') || {};
        let notificationsCount = 0;
        
        // Останавливаем все уведомления для этого чата
        Object.keys(unreadNotifications).forEach(key => {
          if (key.startsWith(`${chatId}_`)) {
            // Останавливаем интервал
            if (unreadNotifications[key].intervalId) {
              clearInterval(unreadNotifications[key].intervalId);
            }
            // Удаляем уведомление из кеша
            delete unreadNotifications[key];
            notificationsCount++;
          }
        });
        
        // Сохраняем обновленный кеш
        cache.set('unreadNotifications', unreadNotifications);
        
        if (notificationsCount > 0) {
          bot.sendMessage(chatId, `✅ Остановлено ${notificationsCount} активных уведомлений.`);
        } else {
          bot.sendMessage(chatId, '📝 У вас нет активных уведомлений.');
        }
        break;
        
      default:
        // Проверяем на запрос поиска
        if (msg.text.toLowerCase().startsWith('поиск')) {
          const idMatch = msg.text.match(/поиск\s+(\d+)/i);
          if (idMatch && idMatch[1]) {
            const collectionId = parseInt(idMatch[1]);
            sendCollectionInfo(chatId, collectionId);
          } else {
            bot.sendMessage(chatId, 'Некорректный формат запроса. Используйте формат: "поиск ID", например "поиск 23"');
          }
        }
    }
  });
  
  // Обработка нажатий на inline-кнопки
  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    if (data === 'current_page') {
      // Просто скрываем уведомление при нажатии на текущую страницу
      bot.answerCallbackQuery(query.id);
      return;
    }
    
    // Обработка кнопки "Прочитано" для уведомлений о новых коллекциях
    if (data.startsWith('read_notification_')) {
      const collectionId = parseInt(data.split('_')[2]);
      const unreadNotifications = cache.get('unreadNotifications') || {};
      const notificationKey = `${chatId}_${collectionId}`;
      
      if (unreadNotifications[notificationKey]) {
        // Останавливаем интервал повторных уведомлений
        if (unreadNotifications[notificationKey].intervalId) {
          clearInterval(unreadNotifications[notificationKey].intervalId);
          unreadNotifications[notificationKey].intervalId = null;
        }
        
        // Отправляем подтверждение
        bot.answerCallbackQuery(query.id, { text: "Уведомление отмечено как прочитанное" });
        
        // Обновляем текст текущего сообщения, чтобы показать, что оно прочитано
        bot.editMessageReplyMarkup(
          {
            inline_keyboard: [
              [
                { text: '📲 Открыть в StickerDom', url: `https://t.me/sticker_bot/app?startapp=collection_${collectionId}` }
              ]
            ]
          },
          {
            chat_id: chatId,
            message_id: query.message.message_id
          }
        );
        
        // Обновляем все связанные сообщения, если они есть
        const messageIds = unreadNotifications[notificationKey].messageIds || [];
        messageIds.forEach(msgId => {
          if (msgId !== query.message.message_id) { // Не обновляем текущее сообщение дважды
            bot.editMessageReplyMarkup(
              {
                inline_keyboard: [
                  [
                    { text: '📲 Открыть в StickerDom', url: `https://t.me/sticker_bot/app?startapp=collection_${collectionId}` }
                  ]
                ]
              },
              {
                chat_id: chatId,
                message_id: msgId
              }
            ).catch(err => {
              console.log(`Не удалось обновить сообщение ${msgId}: ${err.message}`);
            });
          }
        });
        
        // Удаляем информацию о непрочитанном уведомлении
        delete unreadNotifications[notificationKey];
        cache.set('unreadNotifications', unreadNotifications);
        
        console.log(`Уведомление о коллекции ${collectionId} отмечено как прочитанное пользователем ${query.from.username || query.from.first_name} (ID: ${query.from.id})`);
      } else {
        bot.answerCallbackQuery(query.id, { text: "Уведомление уже отмечено как прочитанное" });
      }
      return;
    }
    
    // Обработка нажатия на кнопку уже прочитанного уведомления
    if (data === 'notification_already_read') {
      bot.answerCallbackQuery(query.id, { text: "Уведомление уже отмечено как прочитанное" });
      return;
    }
    
    // Обработка кнопок для просмотра списка коллекций
    if (data.startsWith('collections_')) {
      const page = parseInt(data.split('_')[1]);
      sendCollectionsList(chatId, page);
      bot.answerCallbackQuery(query.id);
    }
    
    // Обработка кнопки поиска коллекции
    if (data === 'search_collection') {
      bot.sendMessage(chatId, 'Введите ID коллекции для поиска в формате: "поиск ID", например "поиск 23"');
      bot.answerCallbackQuery(query.id);
    }
    
    // Обработка кнопки подписки
    if (data === 'subscribe') {
      if (!chatIds.includes(chatId)) {
        chatIds.push(chatId);
        saveChatIds();
        bot.sendMessage(chatId, 'Вы успешно подписались на уведомления!');
      } else {
        bot.sendMessage(chatId, 'Вы уже подписаны на уведомления.');
      }
      bot.answerCallbackQuery(query.id);
    }
  });
  
  // Функция для отправки списка коллекций
  function sendCollectionsList(chatId, page) {
    const lastData = cache.get('lastData');
    
    if (lastData && lastData.data && Array.isArray(lastData.data)) {
      const collections = lastData.data;
      const pageSize = 5;
      const totalPages = Math.ceil(collections.length / pageSize);
      
      // Проверяем валидность страницы
      if (page < 1) page = 1;
      if (page > totalPages) page = totalPages;
      
      const formattedList = formatCollectionsList(collections, page, pageSize);
      
      const navigationMarkup = getCollectionsNavigationMarkup(page, totalPages);
      
      bot.sendMessage(chatId, formattedList, {
        parse_mode: 'Markdown',
        reply_markup: navigationMarkup
      });
    } else {
      bot.sendMessage(chatId, 'Данные о коллекциях отсутствуют или имеют неверный формат.');
    }
  }
  
  // Функция для отправки информации о коллекции
  function sendCollectionInfo(chatId, collectionId) {
    const lastData = cache.get('lastData');
    
    if (lastData && lastData.data && Array.isArray(lastData.data)) {
      const collection = lastData.data.find(item => item.id === collectionId);
      
      if (collection) {
        const formattedCollection = formatCollectionData(collection);
        bot.sendMessage(chatId, formattedCollection, {
          parse_mode: 'Markdown',
          reply_markup: getCollectionButtonsMarkup(collectionId)
        }).then(() => {
          // Если у коллекции есть логотип, отправляем его отдельно
          const logo = collection.media?.find(m => m.type === 'logo')?.url;
          if (logo) {
            bot.sendPhoto(chatId, logo, { 
              caption: `Логотип коллекции "${collection.title}"`,
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📲 Открыть в StickerDom', url: `https://t.me/sticker_bot/app?startapp=collection_${collectionId}` }]
                ]
              }
            });
          }
        });
      } else {
        bot.sendMessage(chatId, `Коллекция с ID ${collectionId} не найдена.`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 К списку коллекций', callback_data: 'collections_1' }]
            ]
          }
        });
      }
    } else {
      bot.sendMessage(chatId, 'Данные о коллекциях отсутствуют или имеют неверный формат.');
    }
  }
  
} else {
  console.warn('TELEGRAM_BOT_TOKEN не указан в .env файле, уведомления не будут отправляться');
}

// Middleware для обработки JSON
app.use(express.json({ limit: '10mb' }));

// Эндпоинт для приема данных
app.post('/api/data', (req, res) => {
  try {
    const data = req.body;
    const key = 'lastData'; // Ключ для хранения данных в кеше
    const oldData = cache.get(key);

    // Проверка на наличие данных
    if (!data) {
      return res.status(400).json({ success: false, message: 'Данные отсутствуют' });
    }

    // Если это первый запрос, просто сохраняем данные
    if (!oldData) {
      cache.set(key, data);
      
      // Сохраняем данные в файл
      saveData(data);
      
      return res.status(200).json({ success: true, message: 'Данные успешно получены и сохранены впервые' });
    }

    // Сравниваем новые данные с кешированными
    if (!deepEqual(oldData, data)) {
      // Данные изменились, отправляем уведомление
      const changes = processDataChanges(oldData, data);
      
      // Обновляем кеш и сохраняем в файл
      cache.set(key, data);
      saveData(data);
      
      return res.status(200).json({ 
        success: true, 
        message: 'Данные изменились, отправлено уведомление',
        changes: changes
      });
    }

    // Если данные не изменились
    return res.status(200).json({ 
      success: true, 
      message: 'Данные получены, изменений не обнаружено'
    });
  } catch (error) {
    console.error('Ошибка при обработке запроса:', error);
    return res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
  }
});

// Эндпоинт для получения последних данных
app.get('/api/data', (req, res) => {
  try {
    const lastData = cache.get('lastData');
    
    if (!lastData) {
      return res.status(404).json({ success: false, message: 'Данные еще не получены' });
    }
    
    return res.status(200).json({ 
      success: true, 
      data: lastData
    });
  } catch (error) {
    console.error('Ошибка при обработке запроса:', error);
    return res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
  }
});

// Эндпоинт для сброса кеша и перезагрузки данных из файла
app.post('/api/reset-cache', (req, res) => {
  try {
    // Очищаем кеш
    cache.flushAll();
    console.log('Кеш успешно очищен');
    
    // Загружаем данные из файла
    const data = loadData();
    if (data) {
      // Помещаем данные в кеш
      cache.set('lastData', data);
      console.log('Данные успешно загружены из файла и помещены в кеш');
    }
    
    return res.status(200).json({ 
      success: true, 
      message: 'Кеш успешно сброшен и данные перезагружены' 
    });
  } catch (error) {
    console.error('Ошибка при сбросе кеша:', error);
    return res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
  }
});

// Эндпоинт для просмотра всех данных из кеша
app.get('/api/cache', (req, res) => {
  try {
    // Получаем все ключи из кеша
    const keys = cache.keys();
    const cacheData = {};
    
    // Собираем данные по всем ключам
    keys.forEach(key => {
      cacheData[key] = cache.get(key);
    });
    
    return res.status(200).json({
      success: true,
      keys: keys,
      cache: cacheData
    });
  } catch (error) {
    console.error('Ошибка при получении данных из кеша:', error);
    return res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
  }
});

// Функция для обработки изменений в данных и отправки уведомлений
function processDataChanges(oldData, newData) {
  // Проверяем, есть ли данные коллекций
  if (oldData.data && newData.data && Array.isArray(oldData.data) && Array.isArray(newData.data)) {
    // Проверяем, действительно ли изменились данные или только порядок элементов
    const oldDataSorted = JSON.stringify([...oldData.data].sort((a, b) => a.id - b.id));
    const newDataSorted = JSON.stringify([...newData.data].sort((a, b) => a.id - b.id));
    
    // Если данные идентичны после сортировки, значит изменился только порядок - не отправляем уведомления
    if (oldDataSorted === newDataSorted) {
      console.log('Порядок элементов изменился, но сами данные остались прежними. Уведомления не отправляются.');
      return { added: [], removed: [], updated: [] };
    }
    
    const collectionsChanges = getCollectionsChanges(oldData.data, newData.data);
    
    // Если есть какие-то изменения в коллекциях
    if (collectionsChanges.added.length > 0 || collectionsChanges.removed.length > 0 || collectionsChanges.updated.length > 0) {
      // Отправляем уведомления о новых коллекциях отдельно
      if (collectionsChanges.added.length > 0) {
        chatIds.forEach(chatId => {
          sendNewCollectionsNotification(chatId, collectionsChanges.added);
        });
      }
      
      // Отправляем уведомление об обновлении/удалении коллекций только если есть такие изменения
      if (collectionsChanges.removed.length > 0 || collectionsChanges.updated.length > 0) {
        chatIds.forEach(chatId => {
          sendCollectionsChangeNotification(chatId, collectionsChanges, newData.data);
        });
      }
      
      return collectionsChanges;
    }
  }
  
  // Если изменения не связаны с коллекциями, отправляем общее сообщение с отличиями
  const differences = getDifference(oldData, newData);
  const message = `🔔 *Обнаружены изменения в данных:*\n\n${formatDifferences(differences)}`;

  // Отправляем сообщение во все подписанные чаты
  chatIds.forEach(chatId => {
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' })
      .then(() => console.log(`Уведомление успешно отправлено в чат ${chatId}`))
      .catch(error => console.error(`Ошибка при отправке уведомления в чат ${chatId}:`, error));
  });
  
  return differences;
}

// Функция для определения изменений в коллекциях
function getCollectionsChanges(oldCollections, newCollections) {
  const changes = {
    added: [],
    removed: [],
    updated: []
  };
  
  // Создаем индексированные мапы для быстрого доступа по ID
  const oldCollMap = new Map(oldCollections.map(coll => [coll.id, coll]));
  const newCollMap = new Map(newCollections.map(coll => [coll.id, coll]));
  
  // Находим новые коллекции
  for (const [id, newColl] of newCollMap) {
    const oldColl = oldCollMap.get(id);
    if (!oldColl) {
      changes.added.push(newColl);
    } else if (!deepEqual(oldColl, newColl)) {
      changes.updated.push({
        old: oldColl,
        new: newColl,
        id: newColl.id
      });
    }
  }
  
  // Находим удаленные коллекции
  for (const [id, oldColl] of oldCollMap) {
    if (!newCollMap.has(id)) {
      changes.removed.push(oldColl);
    }
  }
  
  return changes;
}

// Функция для отправки уведомлений только о новых коллекциях
function sendNewCollectionsNotification(chatId, newCollections) {
  // Функция для экранирования специальных символов Markdown
  function escapeMarkdown(text) {
    if (!text) return '';
    // Экранируем специальные символы Markdown: _ * [ ] ( ) ~ ` > # + - = | { } . !
    return text.toString()
      .replace(/([_*[\]()~`>#+=|{}.!\\-])/g, '\\$1');
  }
  
  // Для каждой новой коллекции отправляем отдельное красивое уведомление
  newCollections.forEach((collection, index) => {
    // Добавляем задержку для последовательной отправки
    setTimeout(() => {
      // Создаем уникальный ID для кнопки "Прочитано"
      const readButtonId = `read_notification_${collection.id}`;
      
      // Сохраняем информацию о непрочитанных уведомлениях
      if (!cache.get('unreadNotifications')) {
        cache.set('unreadNotifications', {});
      }
      const unreadNotifications = cache.get('unreadNotifications');
      
      // Проверяем, если уведомление уже существует, не создаем новое
      if (unreadNotifications[`${chatId}_${collection.id}`]) {
        console.log(`Уведомление для коллекции ${collection.id} в чате ${chatId} уже существует`);
        return;
      }
      
      unreadNotifications[`${chatId}_${collection.id}`] = {
        collection,
        chatId,
        notificationCount: 0,
        intervalId: null,
        messageIds: [] // Для хранения ID всех сообщений, связанных с этим уведомлением
      };
      cache.set('unreadNotifications', unreadNotifications);
      
      const message = `🎉 *НОВАЯ КОЛЛЕКЦИЯ ДОБАВЛЕНА!*\n\n${formatCollectionData(collection)}`;
      
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📲 Открыть в StickerDom', url: `https://t.me/sticker_bot/app?startapp=collection_${collection.id}` }
            ],
            [
              { text: '✅ Прочитано', callback_data: readButtonId }
            ]
          ]
        }
      }).then((sentMessage) => {
        // Сохраняем ID сообщения
        const unreadNotifications = cache.get('unreadNotifications');
        if (unreadNotifications[`${chatId}_${collection.id}`]) {
          unreadNotifications[`${chatId}_${collection.id}`].messageIds.push(sentMessage.message_id);
          cache.set('unreadNotifications', unreadNotifications);
        }
        
        // Если у коллекции есть логотип, отправляем его отдельно
        const logo = collection.media?.find(m => m.type === 'logo')?.url;
        if (logo) {
          bot.sendPhoto(chatId, logo, { 
            caption: `Логотип новой коллекции "${escapeMarkdown(collection.title)}"`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📲 Открыть в StickerDom', url: `https://t.me/sticker_bot/app?startapp=collection_${collection.id}` }],
                [{ text: '✅ Прочитано', callback_data: readButtonId }]
              ]
            }
          }).then((photoMessage) => {
            // Сохраняем ID сообщения с фото
            const unreadNotifications = cache.get('unreadNotifications');
            if (unreadNotifications[`${chatId}_${collection.id}`]) {
              unreadNotifications[`${chatId}_${collection.id}`].messageIds.push(photoMessage.message_id);
              cache.set('unreadNotifications', unreadNotifications);
            }
          });
        }
        
        // Запускаем интервал для повторной отправки уведомлений
        const notificationData = unreadNotifications[`${chatId}_${collection.id}`];
        
        if (notificationData) {
          notificationData.intervalId = setInterval(() => {
            // Проверяем, существует ли еще это уведомление
            const currentNotifications = cache.get('unreadNotifications') || {};
            if (!currentNotifications[`${chatId}_${collection.id}`]) {
              clearInterval(notificationData.intervalId);
              return;
            }
            
            // Увеличиваем счетчик уведомлений
            notificationData.notificationCount++;
            
            // Отправляем повторное уведомление
            bot.sendMessage(chatId, 
              `⚠️ *НАПОМИНАНИЕ: НОВАЯ КОЛЛЕКЦИЯ!*\n\nКоллекция "${escapeMarkdown(collection.title)}" была добавлена.\nЭто напоминание №${notificationData.notificationCount}`, {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '📲 Открыть в StickerDom', url: `https://t.me/sticker_bot/app?startapp=collection_${collection.id}` }
                  ],
                  [
                    { text: '✅ Прочитано', callback_data: readButtonId }
                  ]
                ]
              }
            }).then((reminderMessage) => {
              // Сохраняем ID напоминания
              const currentNotifications = cache.get('unreadNotifications') || {};
              if (currentNotifications[`${chatId}_${collection.id}`]) {
                currentNotifications[`${chatId}_${collection.id}`].messageIds.push(reminderMessage.message_id);
                cache.set('unreadNotifications', currentNotifications);
              }
            });
          }, 2000); // Интервал в 2 секунды
          
          unreadNotifications[`${chatId}_${collection.id}`].intervalId = notificationData.intervalId;
          cache.set('unreadNotifications', unreadNotifications);
        }
      }).catch(error => 
        console.error(`Ошибка при отправке информации о новой коллекции:`, error)
      );
    }, index * 1500); // Задержка между сообщениями
  });
}

// Функция для отправки уведомления об изменениях в коллекциях (кроме новых)
function sendCollectionsChangeNotification(chatId, changes, newCollections) {
  // Функция для экранирования специальных символов Markdown
  function escapeMarkdown(text) {
    if (!text) return '';
    // Экранируем специальные символы Markdown: _ * [ ] ( ) ~ ` > # + - = | { } . !
    return text.toString()
      .replace(/([_*[\]()~`>#+=|{}.!\\-])/g, '\\$1');
  }
  
  let message = '🔔 *Обновление коллекций стикеров*\n\n';
  
  // Удаленные коллекции
  if (changes.removed.length > 0) {
    message += `❌ *Удалены коллекции (${changes.removed.length}):*\n`;
    changes.removed.forEach(coll => {
      message += `- ID ${coll.id}: ${escapeMarkdown(coll.title || 'Без названия')}\n`;
    });
    message += '\n';
  }
  
  // Обновленные коллекции
  if (changes.updated.length > 0) {
    message += `📝 *Обновлены коллекции (${changes.updated.length}):*\n`;
    changes.updated.forEach(change => {
      message += `- ID ${change.id}: ${escapeMarkdown(change.new.title || 'Без названия')}\n`;
    });
    message += '\n';
  }
  
  // Добавляем информацию о новых коллекциях, если они есть
  if (newCollections && newCollections.length > 0) {
    message += `✨ *Добавлены новые коллекции (${newCollections.length}):*\n`;
    newCollections.forEach(coll => {
      message += `- ID ${coll.id}: ${escapeMarkdown(coll.title || 'Без названия')}\n`;
    });
    message += '\n';
    message += 'Для каждой новой коллекции будет отправлено отдельное уведомление.\n';
  }
  
  // Добавляем кнопку для просмотра списка коллекций
  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 Список коллекций', callback_data: 'collections_1' }],
        [{ text: '📲 Открыть StickerDom', url: 'https://t.me/sticker_bot/app' }]
      ]
    }
  }).catch(error => {
    console.error('Ошибка при отправке уведомления об изменениях:', error);
    // В случае ошибки с разметкой Markdown, пробуем отправить без форматирования
    if (error.response && error.response.statusCode === 400 && error.response.body && error.response.body.description && error.response.body.description.includes("can't parse entities")) {
      console.log('Ошибка с Markdown разметкой, отправляем без форматирования');
      // Удаляем символы разметки Markdown
      const cleanMessage = message.replace(/[*_`]/g, '');
      bot.sendMessage(chatId, cleanMessage, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Список коллекций', callback_data: 'collections_1' }],
            [{ text: '📲 Открыть StickerDom', url: 'https://t.me/sticker_bot/app' }]
          ]
        }
      });
    }
  });
}

// Функция для определения различий между объектами
function getDifference(oldObj, newObj) {
  const differences = {};

  // Ищем изменения в новом объекте
  Object.keys(newObj).forEach(key => {
    // Если ключ отсутствует в старом объекте или значения отличаются
    if (!oldObj.hasOwnProperty(key) || !deepEqual(oldObj[key], newObj[key])) {
      differences[key] = {
        old: oldObj[key],
        new: newObj[key]
      };
    }
  });

  // Ищем удаленные ключи
  Object.keys(oldObj).forEach(key => {
    if (!newObj.hasOwnProperty(key)) {
      differences[key] = {
        old: oldObj[key],
        new: undefined
      };
    }
  });

  return differences;
}

// Функция для форматирования различий для читаемого вывода в Telegram
function formatDifferences(differences) {
  let message = '';
  
  Object.keys(differences).forEach(key => {
    const diff = differences[key];
    
    // Проверяем, является ли значение массивом или объектом
    const isOldComplex = diff.old && typeof diff.old === 'object';
    const isNewComplex = diff.new && typeof diff.new === 'object';
    
    let oldValue, newValue;
    
    if (isOldComplex) {
      oldValue = Array.isArray(diff.old) ? 
        `массив из ${diff.old.length} элементов` : 
        `объект с ${Object.keys(diff.old).length} свойствами`;
    } else {
      oldValue = diff.old !== undefined ? String(diff.old) : 'отсутствует';
    }
    
    if (isNewComplex) {
      newValue = Array.isArray(diff.new) ? 
        `массив из ${diff.new.length} элементов` : 
        `объект с ${Object.keys(diff.new).length} свойствами`;
    } else {
      newValue = diff.new !== undefined ? String(diff.new) : 'удалено';
    }
    
    message += `*Поле*: \`${key}\`\n`;
    message += `*Было*: ${oldValue}\n`;
    message += `*Стало*: ${newValue}\n\n`;
  });
  
  return message || 'Не удалось определить конкретные изменения';
}

// Добавляем middleware для парсинга тела запроса
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Обработчик для корневого URL - приветственная страница
app.get('/', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StickerBot - Telegram бот для уведомлений о стикерах</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
      color: #333;
      line-height: 1.6;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    header {
      background-color: #0088cc;
      color: white;
      padding: 20px 0;
      text-align: center;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    h1 {
      margin: 0;
      font-size: 36px;
    }
    h2 {
      color: #0088cc;
      border-bottom: 2px solid #eee;
      padding-bottom: 10px;
      margin-top: 30px;
    }
    .features {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      margin: 30px 0;
    }
    .feature {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      width: calc(50% - 15px);
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      box-sizing: border-box;
    }
    .feature h3 {
      color: #0088cc;
      margin-top: 0;
    }
    .cta {
      text-align: center;
      background-color: white;
      padding: 30px;
      border-radius: 8px;
      margin: 30px 0;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .btn {
      display: inline-block;
      background-color: #0088cc;
      color: white;
      padding: 12px 25px;
      border-radius: 5px;
      text-decoration: none;
      font-weight: bold;
      transition: background-color 0.3s;
    }
    .btn:hover {
      background-color: #006699;
    }
    footer {
      text-align: center;
      margin-top: 40px;
      padding: 20px;
      color: #666;
      font-size: 14px;
    }
    @media (max-width: 768px) {
      .feature {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>StickerBot</h1>
      <p>Telegram бот для уведомлений о новых стикерах StickerDom</p>
    </header>
    
    <section>
      <h2>О боте</h2>
      <p>StickerBot — это бот, который уведомляет вас о новых коллекциях стикеров и их обновлениях. Подписавшись на уведомления, вы всегда будете в курсе свежих релизов на платформе StickerDom.</p>
    </section>
    
    <section class="features">
      <div class="feature">
        <h3>🔔 Мгновенные уведомления</h3>
        <p>Получайте уведомления о новых коллекциях стикеров сразу после их добавления.</p>
      </div>
      <div class="feature">
        <h3>📋 Список коллекций</h3>
        <p>Просматривайте список доступных коллекций прямо в чате с ботом.</p>
      </div>
      <div class="feature">
        <h3>🔍 Поиск коллекций</h3>
        <p>Быстрый поиск нужной коллекции по названию или ключевым словам.</p>
      </div>
      <div class="feature">
        <h3>📊 Статус подписки</h3>
        <p>Управляйте своими подписками и настраивайте получение уведомлений.</p>
      </div>
    </section>
    
    <div class="cta">
      <h2>Начните использовать бота прямо сейчас</h2>
      <p>Присоединяйтесь к тысячам пользователей, которые уже получают уведомления о новых коллекциях стикеров!</p>
      <a href="https://t.me/sticker_bot" class="btn">Открыть бота в Telegram</a>
    </div>
    
    <footer>
      <p>&copy; ${new Date().getFullYear()} StickerBot. Все права защищены.</p>
    </footer>
  </div>
</body>
</html>
  `;
  
  res.send(html);
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
  console.log(`CORS настроен для домена: https://stickerdom.store`);
}); 