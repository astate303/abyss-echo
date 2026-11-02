# 深渊回响 ABYSS ECHO · H5 公开版

暗黑克苏鲁风三消 × Roguelike 战斗。纯静态页面，无依赖、无构建，任何静态托管都能直接跑。

## 本地跑

双击 `index.html`，或在本目录起一个静态服务：

```bash
python -m http.server 8080
# 打开 http://localhost:8080
```

## 部署（任选其一）

**Netlify Drop（最快，无需 git）**

1. 打开 https://app.netlify.com/drop
2. 把本文件夹整个拖进去
3. 10 秒后得到 `https://xxx.netlify.app` 链接

**Vercel**

```bash
npx vercel --prod
```

**GitHub Pages**

把本文件夹内容推到仓库根目录（或 `docs/`），Settings → Pages → 选择分支 → 保存。

**任意静态托管**：OSS / COS / Cloudflare Pages / Nginx，上传即用。

> 国内访问建议用已备案域名 + 国内对象存储；GitHub Pages / Netlify 在国内速度一般，但微信内可直接打开链接。

## 玩法

- 按住宝石向任意方向滑动，三连即消除；也可点选两颗相邻宝石交换
- 四连生成直线炸弹（↯），拐角生成爆破弹（✹）
- 骨颅回理智、孢子回生命，充能满可释放生物武器
- BOSS 每 3 回合发动一次深渊凝视

## 文件

- `index.html` 入口
- `style.css` 样式与动画
- `game.js` 交互与战斗流程
- `board.js` 三消引擎（可被 Node 直接 require）
- `assets/` 五张像素宝石图标

## 许可

代码 MIT；美术素材（gem_*.png）CC BY-NC 4.0，禁止商用。

## 单文件版

`single.html` 把 CSS / 逻辑 / 宝石图全部内联，只有一个请求，弱网和隧道环境下加载更快，适合临时分享。
