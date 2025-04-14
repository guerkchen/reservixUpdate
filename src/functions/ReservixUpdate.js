const { app } = require('@azure/functions');
const { main } = require('./getReservix');
const dotenv = require('dotenv');
dotenv.config();

async function handle(req, context) {
    await context.log('Timer function started.');
    await main();

    return {
        status: 200,
    };
}

app.timer('ReservixUpdateTimer', {
    schedule: process.env.AZURE_CRON_TIMER,
    handler: handle
});

app.http('ReservixUpdateHttp', {
    route: "trigger",
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: handle
})