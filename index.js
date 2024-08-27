const puppeteer = require("puppeteer");
const fs = require("fs");
const { decodeQR, generateQRtoTerminal } = require("./utils");
require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

const DIR_PATH = "./config";
const COOKIE_PATH = DIR_PATH + "/cookies.json";
const QR_CODE_PATH = DIR_PATH + "/qrcode.png";

let cookies = [];
let msg = `今日签到状态：{checkin}, 获得矿石：{point}`;
let errMsg = "";
let checkin = "";
let point = "-1";

const QYWX_ROBOT = process.env.QYWX_ROBOT;

if (!fs.existsSync(DIR_PATH)) {
    fs.mkdirSync(DIR_PATH);
}

if (!QYWX_ROBOT) {
    console.log("未配置 企业微信群机器人webhook地址, 跳过推送");
}

const pushMsg = async (msg) => {
    if (QYWX_ROBOT) {
        try {
            const response = await axios.post(
                QYWX_ROBOT,
                {
                    msgtype: "text",
                    text: {
                        content: msg,
                        mentioned_list: ['@all']
                    }
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data.errcode === 0) {
                console.log("推送成功");
            } else {
                console.log("推送失败: ", response.data);
            }
        } catch (error) {
            console.error("请求失败: ", error.message);
        }
    }
};

const pushQRCode = async (base64Data) => {
    if (QYWX_ROBOT) {
        try {
            // 移除可能的 base64 前缀
            const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, "");
            
            // 计算 MD5
            const md5 = crypto.createHash('md5').update(Buffer.from(base64Image, 'base64')).digest('hex');
            
            const response = await axios.post(
                QYWX_ROBOT,
                {
                    msgtype: "image",
                    image: {
                        base64: base64Image,
                        md5: md5
                    }
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data.errcode === 0) {
                console.log("二维码推送成功");
            } else {
                console.log("二维码推送失败: ", response.data);
            }
        } catch (error) {
            console.error("二维码推送请求失败: ", error.message);
        }
    }
};

const getRandomInt = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

const delay = (time) => {
    return new Promise(resolve => setTimeout(resolve, time));
};

const browseRandomArticles = async (page) => {
    await page.goto("https://juejin.cn/", {
        waitUntil: "networkidle0",
    });

    const articles = await page.$$('[data-entry-id]');
    const articlesToBrowse = getRandomInt(1, Math.min(7, articles.length)); // 1-7篇文章

    console.log(`准备浏览 ${articlesToBrowse} 篇文章...`);

    for (let i = 0; i < articlesToBrowse; i++) {
        const article = articles[i];
        const newPagePromise = new Promise((x) => page.once('popup', x));
        await article.click();
        const newPage = await newPagePromise;

        // 等待新页面加载并获取文章标题
        await newPage.waitForSelector('.jj-link.title');
        const title = await newPage.$eval('.jj-link.title', el => el.textContent.trim());

        await delay(getRandomInt(2000, 5000)); // 随机浏览2-5秒

        console.log(`已浏览文章 ${i + 1} - 标题: ${title}`);
        await newPage.close();
    }
};

const main = async () => {
    console.log("开始签到");
    try {
        const browser = await puppeteer.launch({
            args: [
                "--no-sandbox",
            ],
            executablePath: fs.existsSync("/usr/bin/chromium")
                ? "/usr/bin/chromium"
                : undefined,
        });

        const page = await browser.newPage();
        page.setDefaultTimeout(1000 * 60 * 5);

        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
        );

        await page.setViewport({
            width: 1920,
            height: 1080,
        });

        await page.goto("https://juejin.cn/", {
            waitUntil: "networkidle0",
        });

        const login = async (retryCount = 0) => {
            if (retryCount > 3) {
                throw new Error("二维码获取失败，重试次数过多");
            }

            const loginButton = await page.$(".login-button");
            await loginButton?.click();

            // 等待二维码图片的容器出现
            await page.waitForSelector(".qrcode-img", { timeout: 5000 }).catch(async () => {
                console.log("二维码图片未找到，正在刷新页面...");
                await page.reload({ waitUntil: "networkidle0" });
                await login(retryCount + 1); // 递归调用login，增加重试次数
            });

            // 增加延迟，确保图片完全加载
            await new Promise(resolve => setTimeout(resolve, 1000)); // 延迟1秒

            const qrCodeImg = await page.$(".qrcode-img");
            if (!qrCodeImg) {
                throw new Error("未找到二维码图片");
            }

            // 确保二维码图片元素的尺寸已经大于零（即加载完成）
            const boundingBox = await qrCodeImg.boundingBox();
            if (!boundingBox || boundingBox.width === 0 || boundingBox.height === 0) {
                console.log("二维码图片尚未加载完成，正在重试...");
                await page.reload({ waitUntil: "networkidle0" });
                await login(retryCount + 1); // 递归调用login，增加重试次数
                return;
            }

            const base64Data = await qrCodeImg.screenshot({
                encoding: "base64",
                type: "png"  // 明确指定图片类型
            });
            
            await pushQRCode(base64Data);
            console.log("二维码已推送到企业微信，请查看并扫描");

            const url = await decodeQR(Buffer.from(base64Data, 'base64'));
            console.log(generateQRtoTerminal(url));

            page.on("framenavigated", async (frame) => {
                if (frame === page.mainFrame()) {
                    const cookies = await page.cookies();
                    fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
                }
            });

            await page.waitForNavigation({ waitUntil: "networkidle0" });
        };

        // 检查是否有已保存的 cookies 文件
        if (fs.existsSync(COOKIE_PATH)) {
            cookies = JSON.parse(fs.readFileSync(COOKIE_PATH, "utf-8"));
            await page.setCookie(...cookies);
        } else {
            // 如果没有 cookies 文件，执行登录流程
            await login();

            // 上传 cookies 文件到 GitHub Artifact
            const { execSync } = require('child_process');
            execSync('echo "::set-output name=COOKIE_PATH::./config/cookies.json"');
        }

        await page.goto("https://juejin.cn/user/center/signin?from=main_page", {
            waitUntil: "networkidle0",
        });

        await page.waitForSelector(".signin");
        const checkinButton = await page.$(".code-calender");
        await checkinButton?.click();

        await page.waitForSelector(".header-text > .figure-text");
        const figureText = await page.$(".header-text > .figure-text");
        point =
            (await page.evaluate((el) => el && el.textContent, figureText)) || point;

        page.on("response", async (response) => {
            const url = response.url();
            if (
                url.includes("get_today_status") &&
                response.request().method() === "GET"
            ) {
                const data = await response.json();
                checkin = data.data.check_in_done ? "已签到" : "未签到";
                console.log(checkin);
            }
        });

        await page.goto("https://juejin.cn/user/center/lottery?from=sign_in_success", {
            waitUntil: "networkidle0",
        });

        await page.waitForSelector("#turntable-item-0");
        const lotteryButton = await page.$("#turntable-item-0");

        if (lotteryButton) {
            await lotteryButton.click();
            console.log("已点击抽奖按钮");
        } else {
            console.log("未找到抽奖按钮");
        }

        // 浏览随机数量的文章
        await browseRandomArticles(page);

        await page.reload({
            waitUntil: "networkidle0",
        });

        if (!point) {
            point = "-1";
        }

        msg = msg.replace("{checkin}", checkin).replace("{point}", point);
        console.log(msg);
        await pushMsg(msg);

        await browser.close();
    } catch (e) {
        const error = e;
        console.error(error);
        errMsg = error.message;
        await pushMsg(`签到失败: ${errMsg}`);
        throw error;
    }
    console.log("本轮签到结束");
};

main();