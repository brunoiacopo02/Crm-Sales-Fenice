const puppeteer = require('puppeteer');

(async () => {
    console.log("Launching browser for unauthenticated test...");
    const browser = await puppeteer.launch({headless: "new"});
    const page = await browser.newPage();
    
    page.on('pageerror', err => console.error('\n==== BROWSER EXCEPTION ====\n', err.stack || err.toString()));
    page.on('console', msg => {
        if (msg.type() === 'error') console.log('\n==== CONSOLE ERROR ====\n', msg.text());
    });

    console.log("Navigating to /test-wsod...");
    await page.goto('http://localhost:3000/test-wsod', {waitUntil:'networkidle0'});
    console.log("Wait 2 seconds...");
    await new Promise(r => setTimeout(r, 2000));
    
    // click second tab to render it
    console.log("Clicking second tab...");
    try {
        await page.evaluate(() => {
            const btns = document.querySelectorAll('button');
            btns.forEach(b => {
                if (b.textContent.includes('2ª Chiamata')) b.click();
            });
        });
        await new Promise(r => setTimeout(r, 2000));
    } catch(e) {}

    console.log("Done.");
    await browser.close();
})();
