import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const callToPhone = async (phone) => {
  const apiKey = process.env.API_KEY;
  const campaignId = process.env.CAMPAIGN_ID;
  
  if (!apiKey || !campaignId) {
    console.error('Ошибка: Отсутствуют переменные окружения API_KEY или CAMPAIGN_ID');
    return;
  }
  
  try {
    const myHeaders = new Headers();
    const formdata = new FormData();
    formdata.append('public_key', apiKey);
    formdata.append('phone', phone);
    formdata.append('campaign_id', campaignId);

    const requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: formdata,
      redirect: 'follow',
    };

    const response = await fetch(
      'https://zvonok.com/manager/cabapi_external/api/v1/phones/call/',
      requestOptions,
    );
    
    if (!response.ok) {
      throw new Error(`Ошибка HTTP: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.text();
    console.log(`Звонок на номер ${phone}: ${result}`);
  } catch (error) {
    console.error(`Ошибка при звонке на номер ${phone}:`, error.message);
  }
};

export const callToPhones = async () => {
  console.log('Обзвон начат %c', 'color: green; font-weight: bold;');
  const phonesEnv = process.env.PHONES;
  
  if (!phonesEnv) {
    console.error('Ошибка: Отсутствует переменная окружения PHONES');
    return;
  }
  
  const phones = phonesEnv.split(',');
  console.log(`Начинаем обзвон ${phones.length} номеров...`);

  for (const phone of phones) {
    await callToPhone(phone.trim());
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('Обзвон завершен');
};
