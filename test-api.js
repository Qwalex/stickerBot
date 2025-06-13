// Скрипт для тестирования API бота
const axios = require('axios');

// Первый запрос с данными
console.log('Отправка первого запроса...');
axios.post('http://localhost:3001/api/data', {
  product: 'Смартфон XYZ',
  price: 12999,
  availability: true,
  details: {
    color: 'черный',
    memory: '128GB',
    rating: 4.7
  }
})
.then(response => {
  console.log('Ответ на первый запрос:');
  console.log(response.data);
  
  // Ждем 2 секунды и отправляем второй запрос с измененными данными
  setTimeout(() => {
    console.log('\nОтправка второго запроса с измененными данными...');
    axios.post('http://localhost:3001/api/data', {
      product: 'Смартфон XYZ',
      price: 11999, // Изменена цена
      availability: true,
      details: {
        color: 'черный',
        memory: '128GB',
        rating: 4.8 // Изменен рейтинг
      }
    })
    .then(response => {
      console.log('Ответ на второй запрос:');
      console.log(response.data);
    })
    .catch(error => {
      console.error('Ошибка при отправке второго запроса:', error.message);
    });
  }, 2000);
})
.catch(error => {
  console.error('Ошибка при отправке первого запроса:', error.message);
}); 