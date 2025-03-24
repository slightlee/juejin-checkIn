const Jimp = require("jimp");
const jsQR = require("jsqr");
const QRCode = require("qrcode");
const fs = require("fs");

const decodeQR = async (path) => {
    try {
        // 检查文件是否存在
        if (!fs.existsSync(path)) {
            console.log(`二维码文件不存在: ${path}`);
            return "";
        }
        
        // 检查文件大小
        const stats = fs.statSync(path);
        if (stats.size === 0) {
            console.log(`二维码文件大小为0: ${path}`);
            return "";
        }
        
        console.log(`开始读取图片文件: ${path}`);
        const image = await Jimp.read(path);
        console.log(`成功读取图片，大小: ${image.bitmap.width}x${image.bitmap.height}`);
        
        const imageData = {
            data: new Uint8ClampedArray(image.bitmap.data),
            width: image.bitmap.width,
            height: image.bitmap.height,
        };
        
        console.log("开始解码二维码...");
        const decodedQR = jsQR(imageData.data, imageData.width, imageData.height);
        
        if (!decodedQR) {
            console.log("未找到二维码，但允许程序继续执行");
            return "";  // 返回空字符串而不是抛出错误
        }
        
        console.log("二维码解码成功");
        return decodedQR.data;
    } catch (error) {
        console.error(`解码二维码时出错: ${error.message}`);
        return "";  // 出错时返回空字符串，允许程序继续执行
    }
};

const generateQRtoTerminal = (text) => {
    if (!text) {
        console.log("没有提供有效的二维码文本，无法生成终端二维码");
        return "";
    }
    
    try {
        return QRCode.toString(
            text,
            { type: "terminal", errorCorrectionLevel: 'L', version: 7 },
            function (err) {
                if (err) console.error("生成终端二维码出错:", err.message);
            }
        );
    } catch (error) {
        console.error(`生成终端二维码时出错: ${error.message}`);
        return "";
    }
};

module.exports = {
    decodeQR,
    generateQRtoTerminal,
};
