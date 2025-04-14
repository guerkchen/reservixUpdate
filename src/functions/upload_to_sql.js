const sql = require('mssql');
const dotenv = require('dotenv');

dotenv.config();

// Azure SQL-Datenbankverbindungsdetails
const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: true,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectionTimeout: 30000
    },

    debug: true,
};

async function connectToDatabase() {
    console.log("Stelle Datenbankverbindung her")
    const pool = sql.connect(config);
    console.log(`✅ Verbindung zur Datenbank hergestellt`);
    return pool;
}

async function disconnectFromDatabase(pool) {
    console.log("Schließe Datenbankverbindung")
    if (pool) {
        await pool.close();
        console.log('✅ Verbindung geschlossen');
    }
}

async function uploadToDatabase(pool, database, jsonArray) {
    return new Promise(async (resolve, reject) => {
        console.log(`uploadToDatabase ${database}`);
        duplikate = 0
        erfolge = 0

        if (jsonArray.length == 0) {
            console.log("✅ Keine Daten zum Einfügen")
            resolve()
            return
        }
        let columns = Object.keys(jsonArray[0]);
        let placeholders = columns.map((_, i) => `@param${i}`).join(', ');
        let query = `INSERT INTO ${database} (${columns.join(', ')}) VALUES (${placeholders})`;

        for (let row of jsonArray) {
            let request = pool.request();
            columns.forEach((col, i) => request.input(`param${i}`, row[col]));
            try {
                await request.query(query);
                erfolge++;
            } catch (err) {
                if (err.code === 'EREQUEST' && err.number === 2627) { // Unique constraint violation
                    duplikate++;
                } else {
                    console.log(jsonArray)
                    console.error(`❌ Fehler beim Einfügen: `, err);
                    reject(err);
                }
            }
        }

        console.log(`✅ ${database} erfolgreich aktualisiert, ${erfolge} Einträge eingefügt`);
        if (duplikate > 0) {
            console.log(`⚠️ ${duplikate} Einträge waren schon vorhanden, übersprungen`);
        }
        resolve()
    });
}

module.exports = {
    uploadToDatabase, connectToDatabase, disconnectFromDatabase
};