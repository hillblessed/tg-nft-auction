# Система аукционов цифровых товаров

> Бэкенд для многораундовых аукционов цифровых активов. Модель и правила близки к Telegram Gift Auctions.

[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.0+-green.svg)](https://www.mongodb.com/)
[![Redis](https://img.shields.io/badge/Redis-7.0+-red.svg)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)

---

## Обзор

Проект реализует аукционную систему с несколькими раундами и обновлениями в реальном времени.

Основные требования, на которые ориентирована реализация:
- корректность операций с балансом (исключение double-spend)
- устойчивость к конкурентным запросам
- быстрый лидерборд для ранжирования ставок

---

## Функциональность

- многораундовые аукционы (раунды с фиксированной длительностью)
- ставки в реальном времени через Socket.IO
- перенос ставок между раундами
- anti-sniping (soft close) через продление раунда при активности в конце
- финансовая модель с заморозкой средств на время участия
- Redis ZSET лидерборды

---

## Механика

### Раунды

Лоты распределяются по раундам. В каждом раунде ограниченное число победителей (топ-N).

Пример распределения:

```
15 лотов
- Раунд 1: 3 победителя
- Раунд 2: 3 победителя
- Раунд 3: 3 победителя
- Раунд 4: 3 победителя
- Раунд 5: 3 победителя (финал)
```

### Перенос ставок

Если участник не попал в число победителей текущего раунда, его ставка переносится в следующий раунд.

Схема:
- конец раунда: топ-N фиксируются как победители (списание), остальные переходят дальше
- новый раунд: перенесенные ставки участвуют вместе с новыми
- пользователь может увеличить свою ставку, блокируется только разница

### Anti-sniping

Если ставка сделана в пределах окна anti-sniping до конца раунда, время окончания продлевается.

Пример логики:

```ts
// если ставка сделана менее чем за 30 секунд до конца
if (timeUntilEnd <= 30_000) {
  roundEndTime += 30_000;
}
```

---

## Архитектура

Компоненты:
- Node.js + Express (HTTP API)
- Socket.IO (реалтайм события)
- MongoDB (персистентные данные)
- Redis (лидерборды и быстрые операции ранжирования)

Почему Redis для лидербордов:
- MongoDB сортировка по ставкам при высокой конкуренции дороже и менее предсказуема
- Redis ZSET дает операции порядка O(log N) для обновления и чтения позиций

---

## Запуск

Требуется Docker и Docker Compose.

```bash
# сборка и запуск
docker compose up -d --build

# сидинг
docker compose exec app npm run seed:prod

# нагрузочное тестирование
docker compose exec app npm run load-test:prod

# демо-боты (ожидают активный аукцион)
docker compose exec app npm run demo-bots:prod
```

Адреса:
- UI: http://localhost:3000
- API: http://localhost:3000/api/auctions
- health: http://localhost:3000/health

---

## Нагрузочные сценарии

Команда:

```bash
docker compose exec app npm run load-test:prod
```

Сценарии:
- конкурентные ставки
- стресс-тест (1000 ставок)
- sniping и проверки продления раунда

---

## API

Аукционы:
- GET `/api/auctions`
- POST `/api/auctions`
- GET `/api/auctions/:id`
- POST `/api/auctions/:id/bid`
- GET `/api/auctions/:id/leaderboard`

Пример запроса ставки:

```bash
POST /api/auctions/:id/bid
Content-Type: application/json

{
  "userId": "507f1f77bcf86cd799439011",
  "amount": 1000
}
```

WebSocket события:
- `newBid`
- `roundExtended`
- `roundEnd`
- `itemWon`
- `auctionCreated`

---

## Структура проекта

```
cryptobotproject/
  src/
    config/
    controllers/
    models/
    routes/
    services/
    utils/
    server.ts
    seed.ts
    load-test.ts
    demo-bots.ts
  public/
  docker-compose.yml
  Dockerfile
  README.md
```

---

## Конфигурация

Основные переменные окружения:

| Переменная | Описание | Значение по умолчанию |
|------------|----------|-----------------------|
| PORT | порт сервера | 3000 |
| MONGODB_URI | MongoDB URI | mongodb://localhost:27017/auction |
| REDIS_HOST | Redis host | localhost |
| REDIS_PORT | Redis port | 6379 |
| ANTI_SNIPE_WINDOW_SECONDS | окно anti-sniping | 30 |
| ANTI_SNIPE_EXTENSION_SECONDS | продление раунда | 30 |

---

Автор: @hillblessed
Лицензия: ISC
