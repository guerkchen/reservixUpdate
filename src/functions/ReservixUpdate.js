const { app } = require('@azure/functions');
const { main } = require('./getReservix');
const dotenv = require('dotenv');
dotenv.config();

let isRunning = false; // In-memory Lock

async function handle(req, context) {
    if (isRunning) {
        context.log('Function is already running. Skipping execution.');
        return {
            status: 429, // Too Many Requests
            body: "Function is already running. Please try again later."
        };
    }

    isRunning = true; // Set lock
    try {
        context.log('Reservix Update wurde gestartet');
        await main();

        return {
            status: 200,
            body: "Aufruf erfolgt"
        };
    } catch (err) {
        context.error(err);
        throw err;
    } finally {
        isRunning = false; // Release lock
    }
}

app.timer('ReservixUpdateTimer', {
    schedule: process.env.AZURE_CRON_TIMER,
    handler: handle
});

app.http('ReservixUpdateHttp', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: handle
})

module.exports = handle