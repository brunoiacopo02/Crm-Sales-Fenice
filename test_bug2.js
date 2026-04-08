const puppeteer = require('puppeteer');

(async () => {
    console.log("Launching browser...");
    const browser = await puppeteer.launch({headless: "new"});
    const page = await browser.newPage();
    
    page.on('pageerror', err => console.error('\n==== BROWSER EXCEPTION ====\n:', err.toString()));
    page.on('console', msg => {
        if (msg.type() === 'error') console.log('\n==== CONSOLE ERROR ====\n', msg.text());
    });

    console.log("Navigating to login...");
    await page.goto('http://localhost:3000/login', {waitUntil:'networkidle2'});

    console.log("Logging in as GDO...");
    await page.evaluate(() => {
        document.querySelector('#email').value = 'gdo@fenice.local'; 
        // I don't know the GDO email, what was it in the seed?
        // Let's check seedConferme.ts or just bypass login or fetch from DB.
    });
    
    await browser.close();
})();
