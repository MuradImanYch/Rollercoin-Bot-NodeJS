const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cron = require('node-cron');
puppeteer.use(StealthPlugin());

let isRunning = false; // чтобы cron не запускал параллельно

let coinFisherLevel;

async function coinFisher() {
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
      "--no-sandbox",
      "--disable-setuid-sandbox"
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

    // Очищаем страницу, чтобы не оставался старый сайт
    await page.goto('about:blank');

    await page.goto('https://rollercoin.com/game', {
      waitUntil: 'domcontentloaded'
    });

    // Собираем ежедневный бонус
    try {
      await page.waitForSelector('.collect-btn.tree-dimensional-button', { timeout: 10000 });
      await new Promise(resolve => setTimeout(resolve, 5000));
      await page.click('.collect-btn.tree-dimensional-button');
    } catch (e) {
      console.log('Collect button not found, skipping...');
    }

    // Заряжаем батарею
    try {
      await page.waitForSelector('.electricity-recharge-btn-container', { timeout: 20000 });
      await new Promise(resolve => setTimeout(resolve, 5000));
      await page.click('.electricity-recharge-btn-container');
    } catch (e) {
      console.log('Recharge button not found, skipping...');
    }

    await new Promise(resolve => setTimeout(resolve, 10000));

    await page.goto('https://rollercoin.com/game/choose_game', {
      waitUntil: 'domcontentloaded'
    });

    try {
      await page.waitForSelector('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(8) .game-start-button > button', { timeout: 20000 });
      await new Promise(resolve => setTimeout(resolve, 5000));
      await page.click('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(8) .game-start-button > button');

      coinFisherLevel = await page.$eval('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(8) .game-information-number', el => el.textContent.trim()); // get current game level

      await new Promise(resolve => setTimeout(resolve, 10000));

      console.log(`Coin fisher started at level ${coinFisherLevel}`);

      await page.waitForSelector('canvas', { timeout: 30000 });

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

      await new Promise(resolve => setTimeout(resolve, 3000));




      const steps = 60;        // сколько кликов слева направо
      const delayMs = 500;     // интервал
      const topPaddingReal = 60; // отступ сверху В РЕАЛЬНЫХ пикселях canvas
      const sidePaddingReal = 4; // отступы слева/справа В РЕАЛЬНЫХ пикселях canvas

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
      await new Promise(resolve => setTimeout(resolve, 3000));

      
    } 
    catch (e) {
      console.log('Coin fisher start button not found, skipping...');
    }

  } catch (e) {
    console.error('Task error:', e);
  } finally {
    await browser.close();
    isRunning = false;
    console.log('Task finished:', new Date().toLocaleString());
  }
}

coinFisher();
// Для теста — каждую минуту
cron.schedule(`*/${3} * * * *`, coinFisher);

console.log('Cron started...');