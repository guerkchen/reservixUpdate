const axios = require('axios');
const { URL } = require('url');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const dotenv = require('dotenv');
dotenv.config();

// Wrap Axios to support cookies and enable automatic handling of redirects
const jar = new CookieJar();
const client = wrapper(axios.create({
    jar,
    withCredentials: true, // Ensure cookies are sent with requests
    maxRedirects: 10, // Follow up to 10 redirects
}));

async function getSessionToken() {
    try {
        // CookieJar aufraeumen
        await jar.removeAllCookies();

        const loginPageResponse = await client.get("https://system.reservix.de/rx/auth/login");

        // Manually add cookies from the response to the CookieJar
        const setCookieHeaders = loginPageResponse.headers['set-cookie'];
        if (setCookieHeaders) {
            for (const cookie of setCookieHeaders) {
                await jar.setCookie(cookie, loginPageResponse.request.res.responseUrl);
            }
        }

        const loginURLMatch = loginPageResponse.data.match(/<form id="kc-form-login" onsubmit="login\.disabled = true; return true;" action="(https:\/\/b2b-auth\.reservix\.com\/auth\/realms\/b2b\/login-actions\/authenticate\?.+)" method="post">/);
        if (loginURLMatch === null) {  
            throw new Error(`Login URL not found in the login page response. ${loginPageResponse.data}`);
        }
        const loginURL = loginURLMatch[1]; // Extract the first group

        // Eigentlicher Login
        const loginResponse = await client.post(loginURL, {
            "username": process.env.RESERVIX_USERNAME,
            "password": process.env.RESERVIX_PASSWORD,
            "credentialId": "",
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const phpSessionIDMatch = loginResponse.request.res.responseUrl.match(/https:\/\/system\.reservix\.de(?:\/rx)?\/home\?PHPSESSID=(.+)/);
        if(phpSessionIDMatch === null) {
            throw new Error(`PHPSESSID not found in the response URL. ${loginResponse.request.res.responseUrl}`);
        }
        const orgaResponse = await client.get("https://system.reservix.de/rx/home/organizations/employee/" + process.env.RESERVIX_EMPLOYEE_ID + "?PHPSESSID=" + phpSessionIDMatch[1]);

        const statistikUrl = ("https://system.reservix.de" + orgaResponse.data.result.match(/href="(\/off\/login_check\.php\?target=[\S]+)"/)[1]).replace(/&amp;/g, "&")
        const statistikResponse = await client.get(statistikUrl, {
            headers: {
                "Referer": `https://system.reservix.de/rx/home?PHPSESSID=${phpSessionIDMatch[1]}`
            }
        });

        const finalphpSessionId = statistikResponse.request.res.responseUrl.match(/PHPSESSID=(.+)/)[1]; // Extract the final URL
        if (finalphpSessionId === null) {
            throw new Error(`PHPSESSID not found in the final response URL. ${statistikResponse.request.res.responseUrl}`);
        }
        const finalCookies = await jar.getCookies("https://system.reservix.de"); // Get cookies after the final redirect
        const matchingCookie = finalCookies.find(cookie => /rx-sec=.+?/.test(cookie.cookieString()));

        const result = { "phpSessionId": finalphpSessionId, "cookie": matchingCookie.cookieString() }
        return result;
    } catch (error) {
        console.error('Error during authentication:', error.message);
        throw error;
    }
}

module.exports = { getSessionToken };
