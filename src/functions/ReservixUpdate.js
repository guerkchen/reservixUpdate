const { app } = require('@azure/functions');
const { main } = require('./getReservix');
const dotenv = require('dotenv');
dotenv.config();

app.timer('ReservixUpdate', {
    schedule: process.env.AZURE_CRON_TIMER,
    handler: (myTimer, context) => async () => {
        context.log('Timer function started.');
        await main()
    }
});
