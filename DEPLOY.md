# Инструкция по деплою на VPS

Пошаговое руководство по развертыванию аукционной системы на Linux VPS (Ubuntu 22.04).

---

## ШАГ 1: Аренда VPS

Арендуй VPS у любого провайдера. Подойдут:
- Timeweb Cloud (РФ) — от 199₽/мес
- Selectel (РФ) — от 300₽/мес
- Reg.ru VPS (РФ) — от 300₽/мес
- Hetzner (Европа) — от €4/мес

**Минимальные требования:**
- 1 vCPU
- 2 GB RAM
- 20 GB SSD
- Ubuntu 22.04 LTS

При создании сервера выбери Ubuntu 22.04. Запиши IP-адрес сервера.

---

## ШАГ 2: Подключение к серверу

С Windows (PowerShell):
```powershell
ssh root@IP_СЕРВЕРА
```

Введи пароль, который пришел на почту от провайдера.

---

## ШАГ 3: Обновление системы

После входа на сервер выполни:
```bash
apt update && apt upgrade -y
```

---

## ШАГ 4: Установка Docker

Копируй и вставляй блоки по очереди:

```bash
# Установка зависимостей
apt install -y ca-certificates curl gnupg
```

```bash
# Добавление GPG-ключа Docker
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
```

```bash
# Добавление репозитория Docker
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null
```

```bash
# Установка Docker
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

**Проверка:**
```bash
docker --version
docker compose version
```

Должно показать версии Docker и Docker Compose.

---

## ШАГ 5: Настройка файрвола (безопасность)

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

Теперь открыты только SSH (22), HTTP (80), HTTPS (443).
MongoDB и Redis закрыты от интернета.

---

## ШАГ 6: Клонирование репозитория

```bash
cd /root
git clone https://github.com/hillblessed/tg-nft-auction.git
cd tg-nft-auction
```

---

## ШАГ 7: Настройка переменных окружения

Сгенерируй надежный пароль:
```bash
openssl rand -base64 32
```

Скопируй результат. Теперь создай файл `.env`:
```bash
nano .env
```

Вставь содержимое (замени YOUR_PASSWORD на сгенерированный пароль):
```env
NODE_ENV=production
PORT=3000
MONGO_PASSWORD=YOUR_PASSWORD
MONGODB_URI=mongodb://admin:YOUR_PASSWORD@mongodb:27017/auction_db?authSource=admin
REDIS_HOST=redis
REDIS_PORT=6379
ANTI_SNIPE_WINDOW_SECONDS=30
ANTI_SNIPE_EXTENSION_SECONDS=30
```

Сохрани: `Ctrl+O`, Enter, `Ctrl+X`

---

## ШАГ 8: Запуск проекта

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Дождись завершения сборки (2-5 минут).

**Проверка статуса:**
```bash
docker compose -f docker-compose.prod.yml ps
```

Все контейнеры должны быть в статусе `Up` или `healthy`.

---

## ШАГ 9: Инициализация данных

Первый запуск - создание тестовых пользователей и аукциона:
```bash
docker compose -f docker-compose.prod.yml exec app npm run seed:prod
```

---

## ШАГ 10: Проверка работы

Открой в браузере:
- `http://IP_СЕРВЕРА` - главная страница
- `http://IP_СЕРВЕРА/health` - статус сервера
- `http://IP_СЕРВЕРА/api/auctions` - API аукционов

Если все работает - поздравляю, деплой завершен!

---

## Полезные команды

```bash
# Просмотр логов (все сервисы)
docker compose -f docker-compose.prod.yml logs -f

# Логи конкретного сервиса
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f nginx
docker compose -f docker-compose.prod.yml logs -f mongodb

# Перезапуск всех сервисов
docker compose -f docker-compose.prod.yml restart

# Остановка
docker compose -f docker-compose.prod.yml down

# Пересборка после изменений кода
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Привязка домена (опционально)

Если есть домен:

1. В DNS-панели домена добавь A-запись:
   - Тип: A
   - Имя: @ (или поддомен)
   - Значение: IP_СЕРВЕРА

2. Подожди 5-30 минут пока DNS обновится

3. Проверь: `http://твой-домен.ru`

---

## Настройка HTTPS/SSL (опционально)

После привязки домена:

```bash
# Установка certbot
apt install -y certbot

# Остановка nginx
docker compose -f docker-compose.prod.yml stop nginx

# Получение сертификата (замени домен)
certbot certonly --standalone -d твой-домен.ru

# Копирование сертификатов
mkdir -p /root/tg-nft-auction/nginx/ssl
cp /etc/letsencrypt/live/твой-домен.ru/fullchain.pem /root/tg-nft-auction/nginx/ssl/
cp /etc/letsencrypt/live/твой-домен.ru/privkey.pem /root/tg-nft-auction/nginx/ssl/

# Запуск nginx
docker compose -f docker-compose.prod.yml up -d nginx
```

После этого раскомментируй HTTPS-блок в `nginx/default.conf`.

---

## Решение проблем

**Контейнеры не запускаются:**
```bash
docker compose -f docker-compose.prod.yml logs mongodb
docker compose -f docker-compose.prod.yml logs redis
docker compose -f docker-compose.prod.yml logs app
```

**WebSocket не подключается:**
- Проверь логи nginx
- Убедись что в браузере нет ошибок в консоли (F12)

**Ошибка прав доступа:**
```bash
chown -R root:root /root/tg-nft-auction
```

**Перезапуск с нуля (удалит все данные!):**
```bash
docker compose -f docker-compose.prod.yml down -v
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Контрольный чек-лист

- [ ] VPS арендован (Ubuntu 22.04)
- [ ] Docker установлен
- [ ] Файрвол настроен (22, 80, 443)
- [ ] Репозиторий склонирован
- [ ] Файл .env создан с надежным паролем
- [ ] Контейнеры запущены
- [ ] Seed выполнен
- [ ] Сайт открывается по IP
- [ ] (Опционально) Домен привязан
- [ ] (Опционально) SSL настроен
