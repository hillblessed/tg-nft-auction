// src/seed.ts

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB } from './config/database';
import { User, Auction, Bid, Item, AuctionStatus, RoundStatus } from './models';

dotenv.config();

const seedDatabase = async () => {
    try {
        await connectDB();
        console.log('MongoDB подключена для сидинга...');

        // 1. Очистка старых данных
        console.log('Очистка коллекций...');
        await User.deleteMany({});
        await Auction.deleteMany({});
        await Bid.deleteMany({});
        await Item.deleteMany({});
        console.log('Коллекции очищены.');

        // 2. Создание пользователей
        console.log('Создание пользователей...');
        const usersData = [
            { balance: 10000, frozenFunds: 0 },
            { balance: 5000, frozenFunds: 0 },
            { balance: 2500, frozenFunds: 0 },
            { balance: 1000, frozenFunds: 0 },
            { balance: 500, frozenFunds: 0 },
        ];
        const users = await User.insertMany(usersData);
        console.log(`${users.length} пользователей создано.`);
        console.table(users.map(u => ({ id: u._id.toString(), balance: u.balance })));

        // 3. Создание аукциона
        console.log('Создание активного аукциона...');
        const ROUND_DURATION_MINUTES = 2;
        const rounds = [];
        const itemsPerRound = 3;
        const totalRounds = 5;

        for (let i = 0; i < totalRounds; i++) {
            const startTime = new Date(Date.now() + i * ROUND_DURATION_MINUTES * 60 * 1000);
            const endTime = new Date(startTime.getTime() + ROUND_DURATION_MINUTES * 60 * 1000);
            rounds.push({
                roundNumber: i + 1,
                status: i === 0 ? RoundStatus.ACTIVE : RoundStatus.PENDING,
                startTime: startTime,
                endTime: endTime,
                winners: [],
                itemsInRound: itemsPerRound,
                extendedCount: 0,
            });
        }
        
        const auction = await Auction.create({
            title: 'Rare Digital Collectible',
            description: 'An exclusive limited edition digital collectible NFT',
            status: AuctionStatus.ACTIVE,
            totalItems: itemsPerRound * totalRounds,
            itemsPerRound: itemsPerRound,
            totalRounds: totalRounds,
            currentRound: 1,
            rounds: rounds,
        });
        console.log('Аукцион создан.');

        // 4. Создание предметов для аукциона
        console.log('Создание предметов аукциона...');
        const totalItems = itemsPerRound * totalRounds;
        const itemsData = [];
        
        for (let i = 0; i < totalItems; i++) {
            itemsData.push({
                auctionId: auction._id,
                serialNumber: i + 1,
                ownerId: null,
                roundWon: null,
                wonAt: null,
                bidId: null,
                metadata: {
                    name: `${auction.title} #${i + 1}`,
                    description: auction.description,
                    rarity: i < 3 ? 'legendary' : i < 8 ? 'epic' : 'rare',
                },
            });
        }
        
        await Item.insertMany(itemsData);
        console.log(`${totalItems} предметов создано для аукциона.`);

        console.log('\n✅ Сидинг успешно завершен!');
        console.log('Аукцион активен. Первый раунд закончится через 2 минуты.');
        console.log('\nПримеры ID для тестирования:');
        console.log(`Auction ID: ${auction._id}`);
        console.log(`User ID: ${users[0]._id}`);

    } catch (error) {
        console.error('❌ Ошибка во время сидинга:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('Отключились от MongoDB.');
    }
};

seedDatabase();
