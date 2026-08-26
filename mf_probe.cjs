// mineflayer 直连冒烟测试 — 连 25599，站 15 秒收聊天，退出
const mineflayer = require("mineflayer");

const bot = mineflayer.createBot({
  host: process.argv[2] || "127.0.0.1",
  port: 25599,
  username: "SmokeProbe",
  version: "1.21.1",
  auth: "offline",
});

const t0 = Date.now();
bot.once("login", () => console.log(`[login] ok in ${Date.now() - t0}ms`));
bot.once("spawn", () => {
  console.log(`[spawn] at ${bot.entity.position.floored()}`);
  bot.chat("冒烟探针上线，10 秒后离开");
  setTimeout(() => {
    console.log("[done] 玩家数:", Object.keys(bot.players).length);
    bot.quit();
    process.exit(0);
  }, 10000);
});
bot.on("kicked", (r) => { console.log("[kicked]", String(r).slice(0, 200)); process.exit(1); });
bot.on("error", (e) => { console.log("[error]", String(e).slice(0, 200)); process.exit(1); });
