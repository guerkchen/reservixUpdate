const { app } = require('@azure/functions');
const { main } = require('./getReservix');
const dotenv = require('dotenv');
dotenv.config();

async function handle(req, context) {
    try {
        context.log('Reservix Update wurde gestartet');
        await main();

        return {
            status: 200,
            body: "Aufruf erfolgt"
        };
    } catch (err) {
        context.error(err);
        // This rethrown exception will only fail the individual invocation, instead of crashing the whole process
        throw err;
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