const axios = require('axios');
const fs = require('fs');
const iconv = require('iconv-lite');
const csv = require('csv-parser');
const { Readable } = require('stream');
const he = require('he'); // HTML-Decoder
const qs = require('qs'); // Hilft beim Serialisieren von Formulardaten
const { uploadToDatabase, connectToDatabase, disconnectFromDatabase } = require('./upload_to_sql'); // Import der Methode
const { getSessionToken } = require('./get_session_token'); // Import der Methode

async function getVeranstaltungen(eventGrpId, phpSessionId, cookie) {
    console.log(`Hole Veranstaltungsliste für Produktion ${eventGrpId}`)

    var veranstaltungen = []
    for (var page = 1; page < 20; page++) {
        const url = `https://system.reservix.de/sales/sales_detail.php?PHPSESSID=${phpSessionId}&searchEventGrpID=${eventGrpId}&sortBy=datum&sortDir=ASC&pageNo=${page}`;

        try {
            // Send a GET request to the URL
            const response = await axios.get(url, {
                headers: {
                    "Cookie": cookie
                }
            });

            // Encoding fixen
            const contentType = response.headers['content-type'];
            const encodingMatch = contentType.match(/charset=([^;]+)/);
            var encoding = encodingMatch ? encodingMatch[1].toUpperCase() : 'UTF-8';
            // Viele Server deklarieren ISO-8859-1, senden aber Windows-1252!
            if (encoding === 'ISO-8859-1') {
                encoding = 'windows-1252';
            }
            const utf8Response = iconv.decode(Buffer.from(response.data), encoding);
            const decodedString = he.decode(utf8Response); // HTML-Entities dekodieren

            // Extract all matches for the regex
            const regex = /<tr class="rxrow">\s*<td nowrap="nowrap">.{2}, (\d{2}).(\d{2}).(20\d{2})<\/td>\s*<td nowrap="nowrap">(\d{2}):(\d{2}) Uhr<\/td>\s*<td nowrap="nowrap"><a href="javascript:openDetail\('\d+',0\);" title=".*"><strong>.*<\/strong><\/a> \((\d*)\)<\/td>\s*<td style="text-align:right" nowrap="nowrap">(\d+)<\/td>\s*<td style="text-align:right" nowrap="nowrap">(\d+)<\/td>\s*<td style="text-align:right" nowrap="nowrap">(\d+)<\/td>/g;
            const matches = [...decodedString.matchAll(regex)].map(match => {
                for(let i = 0; i < 10; i++){
                    if(!match[i]){
                        throw new Error(`Notwendiger Match ${i} nicht gefunden`)
                    }
                }
                const veranstaltung = {
                    "eventGrpId": eventGrpId,
                    "Veranstaltungsdatum": match[3] + "-" + match[2] + "-" + match[1] + "T" + match[4] + ":" + match[5] + ":00", // Datum und Uhrzeit zusammenfügen
                    "eventId": match[6],
                    "Gesamtkapazitaet": match[7],
                    "VerkaufteTickets": match[8],
                    "Freikarten": match[9]
                }
                veranstaltung["Auslastung"] = Math.round(100 * parseInt(veranstaltung["VerkaufteTickets"]) / parseInt(veranstaltung["Gesamtkapazitaet"]))
                return veranstaltung;
            });
            if (matches.length == 0) break
            veranstaltungen = veranstaltungen.concat(matches)
        } catch (error) {
            // Log any errors that occur during the request
            console.error('Error fetching URL:', error.message);
            return []
        }
    }

    return veranstaltungen
}

async function getTickets(eventGrpId, eventId, phpSessionId, cookie) {
    console.log(`Hole Ticketverkaeufe fuer Veranstaltung ${eventId} der Produktion ${eventGrpId}`)
    const csvUrl = `https://system.reservix.de/admin/reservation_list_full_csv.php?PHPSESSID=${phpSessionId}&eventID=${eventId}`;
    try {
        const csvResponse = await axios.get(csvUrl, {
            headers: {
                'Cookie': cookie
            },
        });

        const tickets = [];
        const desiredColumns = ['EventID', 'Vorverkaufsstelle', 'Ticketcode', 'Anzahl', 'Preis']
        const stream = Readable.from(csvResponse.data); // CSV-String in einen Stream umwandeln
        await new Promise((resolve, reject) => {
            stream.pipe(csv({ separator: ";" })) // CSV-Parser anwenden
                .on('data', (row) => {
                    // Nur die gewünschten Spalten extrahieren
                    const filteredRow = {};
                    desiredColumns.forEach((col) => {
                        if (row[col] !== undefined) {
                            filteredRow[col] = row[col];
                        }
                    });
                    filteredRow["eventGrpId"] = eventGrpId
                    filteredRow["Kaufdatum"] = row["Datum"].substring(6,10) + "-" + row["Datum"].substring(3,5) + "-" + row["Datum"].substring(0,2) + "T" + row["Uhrzeit"]
                    if(filteredRow["Preis"]){
                        filteredRow["Preis"] = filteredRow["Preis"].replace(",", ".")
                    }
                    if (row["Block"] && row["Reihe"] && row["Platz"]) {
                        filteredRow["Sitzplatz"] = row["Block"] + " " + row["Reihe"] + " " + row["Platz"]
                    }
                    tickets.push(filteredRow);
                })
                .on('end', () => {
                    resolve()
                })
                .on('error', (error) => {
                    console.error('Fehler beim Parsen:', error);
                    reject(error)
                });
        });

        return tickets;
    } catch (err) {
        console.error('Error getEvent:', err.message);
    }
}

async function getProduktionen(phpSessionId, cookie) {
    console.log(`Hole Liste der Produktionen`)

    var produktionen = []
    // Loop through pages until no more matches are found
    for (var page = 1; page < 20; page++) {
        let url;
        if(page == 1){
            url = `https://system.reservix.de/rx/events/overview?PHPSESSID=${phpSessionId}&sortBy=maxdatum&change=5&sortDir=DESC&pageNo=${page}`;    
        } else {
            // Please dont ask
            // Reservix wechselt bei "change=5" zwischen "Zeige alle Produktionen" und "Zeige nur aktive Produktionen"
            // Default ist, dass nur die aktive Produktionen gezeigt werden
            url = `https://system.reservix.de/rx/events/overview?PHPSESSID=${phpSessionId}&sortBy=maxdatum&sortDir=DESC&pageNo=${page}`;
        }
        
        // Send a GET request to the URL
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: {
                "Cookie": cookie
            }
        });

        // Encoding fixen
        const contentType = response.headers['content-type'];
        const encodingMatch = contentType.match(/charset=([^;]+)/);
        var encoding = encodingMatch ? encodingMatch[1].toUpperCase() : 'UTF-8';
        // Viele Server deklarieren ISO-8859-1, senden aber Windows-1252!
        if (encoding === 'ISO-8859-1') {
            encoding = 'windows-1252';
        }
        const utf8Response = iconv.decode(Buffer.from(response.data), encoding);
        const decodedString = he.decode(utf8Response); // HTML-Entities dekodieren

        // Namen und Ids extrahieren
        const regex = /<tr class="rxrow"><td>(\d+)<\/td><td>(.*?)<\/td><td>\s*<div class="utils-display-flex">\s*<div class="utils-display-flex-1 noLineWrap">Veranstaltung \((\d+)\)([\s\S]*?)<\/tr>/g;
        const aktivRegex = /(\d+) geöffnet/;
        const matches = [...decodedString.matchAll(regex)].map(match => {
            for(let i = 0; i < 5; i++){
                if(!match[i]){
                    throw new Error(`Notwendiger Match ${i} nicht gefunden`)
                }
            }
            const produktion = {
                eventGrpId: match[1],
                Titel: match[2],
                Veranstaltungszahl: match[3],
                Aktiv: aktivRegex.test(match[4]),
                Jahr: match[4].match(/(\d{2}\.\d{2}\.20\d{2})/)[0].substring(6, 10),
            }
            produktion.Langname = produktion.Jahr + " " + produktion.Titel
            return produktion
        });
        if (matches.length == 0) break
        produktionen = produktionen.concat(matches)
    }

    return produktionen;
}

function filterProduktionen(produktionen) {
    if(process.env.UPDATE_ONLY_ACTIVE_PRODUKTIONEN == "true"){
        console.log("Filtere inaktive Produktionen")
        produktionen = produktionen.filter(produktion => produktion.Aktiv);
    }
    return produktionen;
}

async function main() {
    const pool = await connectToDatabase();

    // Get phpSessionId and Cookie
    console.log("Generiere Session Token von Reservix")
    const auth = await getSessionToken();

    var produktionen = await getProduktionen(auth.phpSessionId, auth.cookie);
    produktionen = filterProduktionen(produktionen);
    await uploadToDatabase(pool, "produktionen", produktionen);

    for(const produktion of produktionen) {
        console.log(`Verarbeite Produktion ${produktion.Langname}`)
        const veranstaltungen = await getVeranstaltungen(produktion.eventGrpId, auth.phpSessionId, auth.cookie);
        await uploadToDatabase(pool, "veranstaltungen", veranstaltungen);

        for (const veranstaltung of veranstaltungen) {
            console.log(`Verarbeite Veranstaltung ${veranstaltung.Veranstaltungsdatum}`)
            const tickets = await getTickets(produktion.eventGrpId, veranstaltung.eventId, auth.phpSessionId, auth.cookie);

            // Daten in die Datenbank hochladen
            await uploadToDatabase(pool, "tickets", tickets);
        }
    }

    // Verbindung zur Datenbank schließen
    await disconnectFromDatabase(pool);
}

module.exports = { main };
main()
