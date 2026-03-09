const express = require('express');
const app = express();
const port = 8080;
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cron = require('node-cron');
puppeteer.use(StealthPlugin());

let isRunning = false; // чтобы cron не запускал параллельно

async function start() {
  if (isRunning) return;
  isRunning = true;

  console.log('Task started:', new Date().toLocaleString());

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: './user_data',
    defaultViewport: null,
    ignoreHTTPSErrors: true,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--disable-session-crashed-bubble',

      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  try {
    const pages = await browser.pages();

    // Оставляем только первую вкладку, остальные закрываем
    const page = pages[0];
    for (let i = 1; i < pages.length; i++) {
      await pages[i].close();
    }

    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );
    await page.screenshot({
  path: '52errbefore_login.png',
  fullPage: true
});

    // Очищаем страницу, чтобы не оставался старый сайт
    await page.goto('about:blank');

    await page.goto('https://rollercoin.com/game', {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });

    await page.screenshot({
  path: '52errafter_login.png',
  fullPage: true
});

    // Авторизация при необходимости (если куки не сохранились)
    try {
      await page.waitForSelector('.login-button.google.btn.btn-secondary', { timeout: 4000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.click('.login-button.google.btn.btn-secondary');

      await new Promise(r => setTimeout(r, 2000));

      const pages = await browser.pages();
      const popup = pages[pages.length - 1]; // последняя вкладка

      await popup.bringToFront();
      await popup.waitForLoadState?.(); // если playwright-стиль, можно убрать если ошибка

      const account = await popup.$('div[data-identifier="mura.imanov@gmail.com"]');

      await page.screenshot({
  path: 'before_login.png',
  fullPage: true
});

      if (account) {
        console.log('Account button found, clicking...');
        await account.click();

        await page.screenshot({
  path: 'cliick_on_identifier_login.png',
  fullPage: true
});
      } else {
        await page.screenshot({
  path: 'cliick_on_typing_email_login.png',
  fullPage: true
});

        console.log('Account button not found, typing email...');
        await popup.waitForSelector('input[type="email"]', { timeout: 10000 });
        await popup.type('input[type="email"]', 'mura.imanov@gmail.com');

        await new Promise(r => setTimeout(r, 2000));

        await new Promise(resolve => setTimeout(resolve, 2000));
        await popup.click('#identifierNext > div > button > div.VfPpkd-RLmnJb');
      }

      await popup.waitForSelector('input[type="password"]', { timeout: 10000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      await popup.type('input[type="password"]', 'btljkW3flJbftr3YDoZDd7|5Y');

      await new Promise(resolve => setTimeout(resolve, 2000));
      await popup.click('#passwordNext > div > button > div.VfPpkd-RLmnJb');
      await new Promise(resolve => setTimeout(resolve, 20000));
      
    } catch (e) {
      console.log('Login button not found, skipping...');
    }

    // Закрываем всплывающее окно
    try {
      await page.waitForSelector('.event-popup-modal-body .modal-close-btn', { timeout: 120000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.click('.event-popup-modal-body .modal-close-btn');
    } catch (e) {
      console.log('Popup close button not found, skipping...');
    }

    // Собираем ежедневный бонус
    try {
      await page.waitForSelector('.collect-btn.tree-dimensional-button', { timeout: 120000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.click('.collect-btn.tree-dimensional-button');
    } catch (e) {
      console.log('Collect button not found, skipping...');
    }

    // Заряжаем батарею
    try {
      await page.waitForSelector('.electricity-recharge-btn-container', { timeout: 120000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.click('.electricity-recharge-btn-container');
    } catch (e) {
      console.log('Recharge button not found, skipping...');
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    await page.goto('https://rollercoin.com/game/choose_game', {
      waitUntil: 'domcontentloaded'
    });

    // Закрываем всплывающее окно
    try {
      await page.waitForSelector('.event-popup-modal-body .modal-close-btn', { timeout: 120000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.click('.event-popup-modal-body .modal-close-btn');
    } catch (e) {
      console.log('Popup close button not found, skipping...');
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    /*-- get current game level --*/
    await page.waitForSelector('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(8) .game-information-number', { timeout: 120000 });
    let coinFisherLevel = await page.$eval('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(8) .game-information-number', el => el.textContent.trim());

    await page.waitForSelector('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(13) .game-information-number', { timeout: 120000 });
    let coins2048Level = await page.$eval('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(13) .game-information-number', el => el.textContent.trim());

    let maxLevel = Math.max(coinFisherLevel, coins2048Level);

    async function runRandomGame() {
        const games = [playCoinFisher, play2048];
        const randomGame = games[Math.floor(Math.random() * games.length)];
        await randomGame();
    }
    await runRandomGame();

    async function playCoinFisher() {
        try {
            await new Promise(resolve => setTimeout(resolve, maxLevel < 4 ? 40000 : maxLevel < 7 ? 250000 : 350000));

            await page.waitForSelector('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(8) .game-start-button > button', { timeout: 120000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            await page.click('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(8) .game-start-button > button');

            await new Promise(resolve => setTimeout(resolve, 2000));

            console.log(`Coin fisher started at level ${coinFisherLevel}`);

            await page.waitForSelector('canvas', { timeout: 120000 });

            // Клик по центру канваса, чтобы запустить игру, а так же игровой процесс
            const canvas = await page.$('canvas');
            if (!canvas) {
                throw new Error('Canvas not found');
            }
            const box = await canvas.boundingBox();
            if (!box) {
                throw new Error('Canvas not visible');
            }

            // Центр канваса
            let centerX = box.x + box.width / 2;
            let centerY = box.y + box.height / 2;
            await page.mouse.click(centerX, centerY);

            await new Promise(resolve => setTimeout(resolve, 2000));

            // Игровой процесс
            const steps = coinFisherLevel < 4 ? 60 : 45;        // сколько кликов слева направо
            const delayMs = coinFisherLevel < 4 ? 600 : 500;     // интервал
            const topPaddingReal = coinFisherLevel < 4 ? 60 : 100; // отступ сверху В РЕАЛЬНЫХ пикселях canvas
            const sidePaddingReal = coinFisherLevel < 4 ? 4 : coinFisherLevel < 8 ? 6 : 3; // отступы слева/справа В РЕАЛЬНЫХ пикселях canvas

            // 1) CSS рамка (куда кликаем)
            const canvasHandle = await page.$("canvas");
            if (!canvasHandle) throw new Error("Canvas not found");
            const box2 = await canvasHandle.boundingBox();
            if (!box2) throw new Error("Canvas not visible");

            // 2) Реальный размер буфера canvas (внутренние пиксели)
            const { realW, realH } = await page.evaluate(() => {
                const c = document.querySelector("canvas");
                return { realW: c.width, realH: c.height };
            });

            if (realW <= 0 || realH <= 0) throw new Error("Canvas real size is invalid");

            // 3) scale: real pixels -> CSS pixels
            const scaleX = realW / box2.width;
            const scaleY = realH / box2.height;

            // 4) Линия кликов в реальных координатах
            const startXReal = sidePaddingReal;
            const endXReal = realW - sidePaddingReal;
            const yReal = Math.min(realH - 1, topPaddingReal); // верхняя линия + отступ

            const stepSizeReal = (endXReal - startXReal) / Math.max(1, steps - 1);

            for (let i = 0; i < steps; i++) {
                const xReal = startXReal + stepSizeReal * i;

                // 5) Переводим в CSS координаты клика
                const clickX = box2.x + xReal / scaleX;
                const clickY = box2.y + yReal / scaleY;

                // На всякий — клампим внутри рамки (защита от дробей/погрешностей)
                const safeX = Math.max(box2.x + 1, Math.min(box2.x + box2.width - 1, clickX));
                const safeY = Math.max(box2.y + 1, Math.min(box2.y + box2.height - 1, clickY));

                await page.mouse.click(safeX, safeY);
                await new Promise(r => setTimeout(r, delayMs));
            }

            console.log('Coin fisher finished');
            await new Promise(resolve => setTimeout(resolve, 2000));

            await page.goto('https://rollercoin.com/game/choose_game', {
                waitUntil: 'domcontentloaded'
            });

            await new Promise(resolve => setTimeout(resolve, 2000));

            const pages = await browser.pages();

            for (let i = 1; i < pages.length; i++) {
                await pages[i].close();
            }

            await runRandomGame();
        }
        catch (e) {
            console.log('Coin fisher start button not found, skipping...');
        }
    }
    
    async function play2048() {
        try {
            await new Promise(resolve => setTimeout(resolve, maxLevel < 4 ? 40000 : maxLevel < 7 ? 250000 : 350000));

            await page.waitForSelector('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(13) .game-start-button > button', { timeout: 120000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            await page.click('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(13) .game-start-button > button');

            await new Promise(resolve => setTimeout(resolve, 2000));

            console.log(`2048 Coins started at level ${coins2048Level}`);

            await page.waitForSelector('canvas', { timeout: 120000 });

            // Клик по центру канваса, чтобы запустить игру, а так же игровой процесс
            const canvas = await page.$('canvas');
            if (!canvas) {
                throw new Error('Canvas not found');
            }
            const box = await canvas.boundingBox();
            if (!box) {
                throw new Error('Canvas not visible');
            }

            // Центр канваса
            let centerX = box.x + box.width / 2;
            let centerY = box.y + box.height / 2;
            await page.mouse.click(centerX, centerY);

            await new Promise(resolve => setTimeout(resolve, 2000));

            // Игровой процесс
            let running = true;
            let keys = ['w', 'a', 's', 'd'];

            setTimeout(() => {
                running = false;
            }, 55000);

            while (running) {
                const key = keys[Math.floor(Math.random() * keys.length)];
                await page.keyboard.press(key);
                await new Promise(r => setTimeout(r, 100));
            }

            console.log('2048 Coins finished');
            await new Promise(resolve => setTimeout(resolve, 2000));

            await page.goto('https://rollercoin.com/game/choose_game', {
                waitUntil: 'domcontentloaded'
            });

            await new Promise(resolve => setTimeout(resolve, 2000));

            const pages = await browser.pages();

            for (let i = 1; i < pages.length; i++) {
                await pages[i].close();
            }

            await runRandomGame();
        } 
        catch (e) {
            console.log('2048 Coins start button not found, skipping...');
        }
    }

  } catch (e) {
    console.error('Task error:', e);
  } finally {
    await browser.close();
    isRunning = false;
    console.log('Task finished:', new Date().toLocaleString());

    setTimeout(start, 5000);
  }
}

start();
app.listen(port, () => {
  console.log(`Server is running at PORT: ${port}`);
});