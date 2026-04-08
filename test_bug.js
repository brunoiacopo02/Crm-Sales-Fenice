const puppeteer = require('puppeteer');

(async () => {
    console.log("Launching browser...");
    const browser = await puppeteer.launch({headless: "new"});
    const page = await browser.newPage();
    page.on('pageerror', err => console.error('PAGE CRASH EXCEPTION:', err));
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    console.log("Navigating to login...");
    await page.goto('http://localhost:3000/login', {waitUntil:'networkidle2'});

    console.log("Logging in as GDO...");
    await page.type('#email', '114@fenice.local');
    await page.type('#password', '114');
    await page.click('button[type=submit]');

    console.log("Waiting for dashboard...");
    await page.waitForFunction(() => window.location.pathname === '/', { timeout: 10000 });
    
    console.log("Looking for NR button in top lead...");
    try {
        await page.waitForSelector('button[title="Non Risposto"]', { timeout: 5000 });
        console.log("Clicking NR button...");
        await page.click('button[title="Non Risposto"]');
        
        console.log("Waiting for network/React state to settle...");
        await new Promise(r => setTimeout(r, 4000));
    } catch(e) {
        console.log("No NR button found or error:", e.message);
    }

    console.log("Closing...");
    await browser.close();
})();
