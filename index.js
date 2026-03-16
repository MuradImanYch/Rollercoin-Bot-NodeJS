const express = require('express');
const app = express();
const port = 8080;
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cron = require('node-cron');
puppeteer.use(StealthPlugin());
const path = require('path');
const { Jimp } = require('jimp');
const cv = require('@techstark/opencv-js');
const fs = require('fs');

let isRunning = false; // чтобы cron не запускал параллельно

/*----------- START COIN CLICK EXTERNAL FUNC --------------*/

// Только хорошие объекты
const GOOD_TEMPLATES = [
  path.join(__dirname, 'assets', 'coinclick', 'bitcoin.png'),
  path.join(__dirname, 'assets', 'coinclick', 'bitcoin2.png'),
  path.join(__dirname, 'assets', 'coinclick', 'bitcoin3.png'),
  path.join(__dirname, 'assets', 'coinclick', 'bitcoin4.png'),
  path.join(__dirname, 'assets', 'coinclick', 'dashcoin.png'),
  path.join(__dirname, 'assets', 'coinclick', 'dashcoin2.png'),
  path.join(__dirname, 'assets', 'coinclick', 'dashcoin3.png'),
  path.join(__dirname, 'assets', 'coinclick', 'dogecoin.png'),
  path.join(__dirname, 'assets', 'coinclick', 'dogecoin2.png'),
  path.join(__dirname, 'assets', 'coinclick', 'dogecoin3.png'),
  path.join(__dirname, 'assets', 'coinclick', 'ethereum.png'),
  path.join(__dirname, 'assets', 'coinclick', 'ethereum2.png'),
  path.join(__dirname, 'assets', 'coinclick', 'litecoin.png'),
];

const MATCH_THRESHOLD = 0.38;
const LOOP_DELAY_MS = 3;
const CLICK_COOLDOWN_MS = 180;
const DUPLICATE_RADIUS = 28;

const recentClicks = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanupRecentClicks() {
  const border = Date.now() - CLICK_COOLDOWN_MS;
  while (recentClicks.length && recentClicks[0].time < border) {
    recentClicks.shift();
  }
}

function wasRecentlyClicked(x, y) {
  cleanupRecentClicks();

  return recentClicks.some(item => {
    const dx = item.x - x;
    const dy = item.y - y;
    return Math.sqrt(dx * dx + dy * dy) < DUPLICATE_RADIUS;
  });
}

function rememberClick(x, y) {
  recentClicks.push({ x, y, time: Date.now() });
}

async function loadImageToMat(imgPath) {
  if (!fs.existsSync(imgPath)) {
    throw new Error(`Template not found: ${imgPath}`);
  }

  const image = await Jimp.read(imgPath);
  const { data, width, height } = image.bitmap;

  const mat = new cv.Mat(height, width, cv.CV_8UC4);
  mat.data.set(data);

  return mat;
}

async function bufferToMat(buffer) {
  const image = await Jimp.read(buffer);
  const { data, width, height } = image.bitmap;

  const mat = new cv.Mat(height, width, cv.CV_8UC4);
  mat.data.set(data);

  return mat;
}

function matchTemplateMulti(sourceMat, templateMat, threshold) {
  const result = new cv.Mat();
  cv.matchTemplate(sourceMat, templateMat, result, cv.TM_CCOEFF_NORMED);

  const found = [];

  for (let y = 0; y < result.rows; y++) {
    for (let x = 0; x < result.cols; x++) {
      const score = result.floatAt(y, x);

      if (score >= threshold) {
        found.push({
          x,
          y,
          score,
          width: templateMat.cols,
          height: templateMat.rows,
          centerX: x + Math.floor(templateMat.cols / 2),
          centerY: y + Math.floor(templateMat.rows / 2),
        });
      }
    }
  }

  result.delete();

  found.sort((a, b) => b.score - a.score);

  const filtered = [];

  for (const item of found) {
    const duplicate = filtered.some(saved => {
      const dx = saved.centerX - item.centerX;
      const dy = saved.centerY - item.centerY;
      return Math.sqrt(dx * dx + dy * dy) < Math.min(item.width, item.height) * 0.6;
    });

    if (!duplicate) {
      filtered.push(item);
    }
  }

  return filtered;
}

async function prepareGoodTemplates() {
  const prepared = [];

  for (const templatePath of GOOD_TEMPLATES) {
    prepared.push({
      name: path.basename(templatePath),
      mat: await loadImageToMat(templatePath),
    });
  }

  return prepared;
}

async function runCanvasObjectClicker(page, canvasBox, durationMs, preparedTemplates) {
  const endTime = Date.now() + durationMs;

  while (Date.now() < endTime) {
    const screenshot = await page.screenshot({
      type: 'png',
      clip: {
        x: Math.round(canvasBox.x),
        y: Math.round(canvasBox.y),
        width: Math.round(canvasBox.width),
        height: Math.round(canvasBox.height),
      },
    });

    const frameMat = await bufferToMat(screenshot);

    try {
      const allMatches = [];

      for (const tpl of preparedTemplates) {
        const matches = matchTemplateMulti(frameMat, tpl.mat, MATCH_THRESHOLD);

        for (const match of matches) {
          allMatches.push({
            ...match,
            templateName: tpl.name,
          });
        }
      }

      allMatches.sort((a, b) => b.score - a.score);

      if (allMatches.length > 0) {
        console.log(
          'Matches:',
          allMatches.map(x => `${x.templateName}:${x.score.toFixed(2)}`).join(', ')
        );
      }

      for (const item of allMatches) {
        const clickX = Math.round(canvasBox.x + item.centerX);
        const clickY = Math.round(canvasBox.y + item.centerY);

        if (wasRecentlyClicked(clickX, clickY)) {
          continue;
        }

        await page.mouse.click(clickX, clickY);
        rememberClick(clickX, clickY);

        await sleep(10);
      }
    } finally {
      frameMat.delete();
    }

    await sleep(LOOP_DELAY_MS);
  }
}

/*----------- END COIN CLICK EXTERNAL FUNC --------------*/


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

    // Очищаем страницу, чтобы не оставался старый сайт
    await page.goto('about:blank');

    await page.goto('https://rollercoin.com/game', {
      waitUntil: 'domcontentloaded'
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

      if (account) {
        console.log('Account button found, clicking...');
        await account.click();
      } else {
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
      await page.waitForSelector('.event-popup-modal-body .modal-close-btn', { timeout: 2000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.click('.event-popup-modal-body .modal-close-btn');
    } catch (e) {
      console.log('Popup close button not found, skipping...');
    }

    // Собираем ежедневный бонус
    try {
      await page.waitForSelector('.collect-btn.tree-dimensional-button', { timeout: 2000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.click('.collect-btn.tree-dimensional-button');
    } catch (e) {
      console.log('Collect button not found, skipping...');
    }

    // Заряжаем батарею
    try {
      await page.waitForSelector('.electricity-recharge-btn-container', { timeout: 2000 });
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
      await page.waitForSelector('.event-popup-modal-body .modal-close-btn', { timeout: 2000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.click('.event-popup-modal-body .modal-close-btn');
    } catch (e) {
      console.log('Popup close button not found, skipping...');
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    /*-- get current game level --*/
    await page.waitForSelector('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(8) .game-information-number', { timeout: 2000 });
    let coinFisherLevel = await page.$eval('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(8) .game-information-number', el => el.textContent.trim());

    await page.waitForSelector('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(13) .game-information-number', { timeout: 2000 });
    let coins2048Level = await page.$eval('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(13) .game-information-number', el => el.textContent.trim());

    await page.waitForSelector('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(2) .game-information-number', { timeout: 2000 });
    let coinClickerLevel = await page.$eval('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(2) .game-information-number', el => el.textContent.trim());

    let maxLevel = Math.max(coinFisherLevel, coins2048Level, coinClickerLevel);

    async function runRandomGame() {
        const games = [playCoinFisher, play2048];
        const randomGame = games[Math.floor(Math.random() * games.length)];
        await randomGame();
    }
    await runRandomGame();

    async function playCoinFisher() {
        try {
            await new Promise(resolve => setTimeout(resolve, maxLevel < 4 ? 40000 : maxLevel < 7 ? 250000 : 350000));

            await page.waitForSelector('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(8) .game-start-button > button', { timeout: 2000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            await page.click('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(8) .game-start-button > button');

            await new Promise(resolve => setTimeout(resolve, 2000));

            console.log(`Coin fisher started at level ${coinFisherLevel}`);

            await page.waitForSelector('canvas', { timeout: 2000 });

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

            await page.waitForSelector('.accept-button', { timeout: 20000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            await page.click('.accept-button');
            await new Promise(resolve => setTimeout(resolve, 15000));

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

            await page.waitForSelector('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(13) .game-start-button > button', { timeout: 2000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            await page.click('#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(13) .game-start-button > button');

            await new Promise(resolve => setTimeout(resolve, 2000));

            console.log(`2048 Coins started at level ${coins2048Level}`);

            await page.waitForSelector('canvas', { timeout: 2000 });

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
            
            await page.waitForSelector('.accept-button', { timeout: 20000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            await page.click('.accept-button');
            await new Promise(resolve => setTimeout(resolve, 15000));

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

    async function playCoinClick() {
  let preparedTemplates = [];
  recentClicks.length = 0;

  try {
    await sleep(5000);

    await page.waitForSelector(
      '#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(2) .game-start-button > button',
      { timeout: 2000 }
    );

    await sleep(2000);

    await page.click(
      '#root > div > div.content > div > div.react-wrapper > div > div > div.choose-game-container.col-12.col-lg-10 > div > div.row > div:nth-child(2) .game-start-button > button'
    );

    await sleep(2000);

    console.log(`Coin Clicker started at level ${coinClickerLevel}`);
    console.log(typeof cv.Mat); // должно быть function

    await page.waitForSelector('canvas', { timeout: 5000 });

    const canvas = await page.$('canvas');
    if (!canvas) {
      throw new Error('Canvas not found');
    }

    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error('Canvas not visible');
    }

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await page.mouse.click(centerX, centerY);

    await sleep(1500);

    preparedTemplates = await prepareGoodTemplates();

    const gameDurationMs = 30000;
    await runCanvasObjectClicker(page, box, gameDurationMs, preparedTemplates);

    console.log('Coin Clicker finished');

    await page.waitForSelector('.accept-button', { timeout: 20000 });
    await sleep(2000);
    await page.click('.accept-button');

    await sleep(15000);

    await page.goto('https://rollercoin.com/game/choose_game', {
      waitUntil: 'domcontentloaded',
    });

    await sleep(2000);

    const pages = await browser.pages();

    for (let i = 1; i < pages.length; i++) {
      await pages[i].close();
    }

    await runRandomGame();
  } catch (e) {
    console.log('Coin Clicker start button not found or failed:', e.message);
  } finally {
    for (const tpl of preparedTemplates) {
      if (tpl.mat) {
        tpl.mat.delete();
      }
    }
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