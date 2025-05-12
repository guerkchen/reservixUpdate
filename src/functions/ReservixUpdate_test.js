const { main } = require('./getReservix');

async function handle(req, context) {
    await main();
}

handle();