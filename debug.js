const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({headless: "new"});
    const page = await browser.newPage();
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    console.log("Navigating to login...");
    await page.goto('http://localhost:3000/login', {waitUntil:'networkidle2'});

    console.log("Logging in...");
    await page.type('#email', '114@fenice.local');
    await page.type('#password', '114'); // Assuming password is 114 or password
    await page.click('button[type=submit]');

    console.log("Waiting for navigation...");
    await page.waitForNavigation({waitUntil:'networkidle2'});
    
    console.log("Dashboard reached. Wait for 2s...");
    await new Promise(r => setTimeout(r, 2000));
    console.log("Done.");
    await browser.close();
})();
